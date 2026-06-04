// Unit tests for the Structured Clinical Lite db layer (clinicalDb).
// Runs against an in-memory better-sqlite3 database seeded with the migration
// SQL plus the minimal parent tables the helpers reference (clients, users,
// audit_log). Helpers accept the db instance explicitly, so these never touch
// the real database.
'use strict';
const Database = require('better-sqlite3');
const fs   = require('fs');
const path = require('path');
const { clinicalDb } = require('../db');

const MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_clinical_lite.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE clients(id INTEGER PRIMARY KEY, name TEXT, room TEXT, is_active INTEGER DEFAULT 1, is_special INTEGER DEFAULT 0);
    CREATE TABLE users(id INTEGER PRIMARY KEY, display_name TEXT, username TEXT);
    CREATE TABLE audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (datetime('now')),
      actor_id INTEGER, actor_name TEXT, ip TEXT, action TEXT, target_type TEXT, target_id TEXT, target_label TEXT, detail TEXT);
  `);
  db.prepare('INSERT INTO clients(id,name,room) VALUES (1,?,?)').run('John Doe', '101');
  db.prepare('INSERT INTO clients(id,name,room) VALUES (2,?,?)').run('Jane Roe', '102');
  db.prepare('INSERT INTO users(id,display_name,username) VALUES (1,?,?)').run('Dr. Smith', 'smith');
  db.exec(MIGRATION);
  return db;
}

function auditCount(db, action) {
  return db.prepare('SELECT COUNT(*) c FROM audit_log WHERE action=?').get(action).c;
}

let db;
beforeEach(() => { db = freshDb(); });
afterEach(() => { db.close(); });

describe('migration', () => {
  test('creates all clinical tables + guard row', () => {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    ['clinical_notes', 'treatment_plans', 'assessments', 'group_notes', 'group_note_attendees', 'discharge_summaries', 'schema_migrations']
      .forEach(t => expect(names).toContain(t));
    expect(db.prepare("SELECT 1 FROM schema_migrations WHERE version='001_clinical_lite'").get()).toBeTruthy();
  });

  test('is idempotent (re-running does not throw or duplicate guard)', () => {
    expect(() => db.exec(MIGRATION)).not.toThrow();
    expect(db.prepare('SELECT COUNT(*) c FROM schema_migrations').get().c).toBe(1);
  });
});

describe('clinical_notes', () => {
  test('create / getById / getByClient / getAll', () => {
    const n = clinicalDb.notes.create(db, { client_id: 1, author_id: 1, note_type: 'progress', note_date: '2026-06-02', content: 'x' });
    expect(n.id).toBeGreaterThan(0);
    expect(n.status).toBe('draft');
    expect(clinicalDb.notes.getById(db, n.id).content).toBe('x');
    expect(clinicalDb.notes.getByClient(db, 1)).toHaveLength(1);
    expect(clinicalDb.notes.getByClient(db, 2)).toHaveLength(0);
    expect(clinicalDb.notes.getAll(db)).toHaveLength(1);
  });

  test('update / sign / delete + audit rows', () => {
    const n = clinicalDb.notes.create(db, { client_id: 1, author_id: 1, content: 'a' });
    clinicalDb.notes.update(db, n.id, { content: 'b' }, 1);
    expect(clinicalDb.notes.getById(db, n.id).content).toBe('b');
    const signed = clinicalDb.notes.sign(db, n.id, 1);
    expect(signed.status).toBe('final');
    expect(signed.signed_by).toBe(1);
    expect(signed.signed_at).toBeTruthy();
    clinicalDb.notes.delete(db, n.id, 1);
    expect(clinicalDb.notes.getById(db, n.id)).toBeNull();
    expect(auditCount(db, 'clinical_notes.create')).toBe(1);
    expect(auditCount(db, 'clinical_notes.update')).toBe(1);
    expect(auditCount(db, 'clinical_notes.sign')).toBe(1);
    expect(auditCount(db, 'clinical_notes.delete')).toBe(1);
  });
});

describe('treatment_plans', () => {
  test('goals stored as JSON string, parseable; sign keeps lifecycle status', () => {
    const tp = clinicalDb.treatmentPlans.create(db, {
      client_id: 1, author_id: 1, plan_date: '2026-06-02', status: 'active',
      goals: [{ goal: 'Sobriety', objectives: ['Attend group'], interventions: ['CBT'] }],
    });
    const row = clinicalDb.treatmentPlans.getById(db, tp.id);
    expect(typeof row.goals).toBe('string');                 // stored as string
    expect(JSON.parse(row.goals)[0].goal).toBe('Sobriety');  // parseable
    const signed = clinicalDb.treatmentPlans.sign(db, tp.id, 1);
    expect(signed.status).toBe('active');                    // NOT 'final'
    expect(signed.signed_at).toBeTruthy();
    expect(auditCount(db, 'treatment_plans.create')).toBe(1);
    expect(auditCount(db, 'treatment_plans.sign')).toBe(1);
  });
});

describe('assessments', () => {
  test('content stored as JSON string, parseable; sign sets final', () => {
    const a = clinicalDb.assessments.create(db, {
      client_id: 1, author_id: 1, assessment_type: 'risk', assessment_date: '2026-06-02',
      content: { 'Suicide Risk': { Ideation: 'denied' } }, score: 3, score_label: 'Low',
    });
    const row = clinicalDb.assessments.getById(db, a.id);
    expect(typeof row.content).toBe('string');
    expect(JSON.parse(row.content)['Suicide Risk'].Ideation).toBe('denied');
    expect(row.score).toBe(3);
    expect(clinicalDb.assessments.sign(db, a.id, 1).status).toBe('final');
  });
});

describe('group_notes (+ attendees)', () => {
  test('create bulk-inserts attendees; getById embeds them', () => {
    const g = clinicalDb.groupNotes.create(db, {
      group_name: 'Morning Group', facilitator_id: 1, session_date: '2026-06-02', topic: 'Coping',
      attendees: [
        { client_id: 1, participation: 'present', individual_note: 'engaged' },
        { client_id: 2, participation: 'absent' },
      ],
    });
    expect(g.attendees).toHaveLength(2);
    expect(g.attendees.find(a => a.client_id === 1).client_name).toBe('John Doe');
    expect(clinicalDb.groupNotes.getById(db, g.id).attendees).toHaveLength(2);
  });

  test('update replaces attendees; delete cascades', () => {
    const g = clinicalDb.groupNotes.create(db, {
      group_name: 'G', facilitator_id: 1, session_date: '2026-06-02',
      attendees: [{ client_id: 1, participation: 'present' }, { client_id: 2, participation: 'excused' }],
    });
    const upd = clinicalDb.groupNotes.update(db, g.id, { attendees: [{ client_id: 1, participation: 'present' }] }, 1);
    expect(upd.attendees).toHaveLength(1);
    clinicalDb.groupNotes.delete(db, g.id, 1);
    expect(db.prepare('SELECT COUNT(*) c FROM group_note_attendees WHERE group_note_id=?').get(g.id).c).toBe(0);
  });

  test('getByClient finds groups a client attended', () => {
    clinicalDb.groupNotes.create(db, { group_name: 'A', facilitator_id: 1, session_date: '2026-06-02', attendees: [{ client_id: 1 }] });
    clinicalDb.groupNotes.create(db, { group_name: 'B', facilitator_id: 1, session_date: '2026-06-02', attendees: [{ client_id: 2 }] });
    expect(clinicalDb.groupNotes.getByClient(db, 1)).toHaveLength(1);
    expect(clinicalDb.groupNotes.getByClient(db, 1)[0].group_name).toBe('A');
  });
});

describe('discharge_summaries', () => {
  test('create / sign / getByClient + audit', () => {
    const d = clinicalDb.dischargeSummaries.create(db, {
      client_id: 1, author_id: 1, discharge_date: '2026-06-02', discharge_type: 'planned', aftercare_plan: 'IOP',
    });
    expect(d.status).toBe('draft');
    expect(clinicalDb.dischargeSummaries.getByClient(db, 1)).toHaveLength(1);
    expect(clinicalDb.dischargeSummaries.sign(db, d.id, 1).status).toBe('final');
    expect(auditCount(db, 'discharge_summaries.create')).toBe(1);
    expect(auditCount(db, 'discharge_summaries.sign')).toBe(1);
  });
});
