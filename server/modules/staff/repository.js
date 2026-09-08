'use strict';
/**
 * Staff repository — the ONLY place that runs SQL for the staff domain.
 * Talks to the database exclusively through server/db/connection.js, so a
 * future SQLite -> Postgres port touches this file (and the connection) and
 * nothing else.
 */
const c = require('../../db/connection');

function _j(str, def) { try { return JSON.parse(str); } catch (e) { return def; } }

const COLUMNS = ['category', 'name', 'phone', 'phone2', 'notes', 'sort_order'];

async function list() {
  return await c.query('SELECT * FROM staff ORDER BY sort_order, id');
}

async function getById(id) {
  return await c.query1('SELECT * FROM staff WHERE id=?', [id]);
}

async function exists(id) {
  return !!await c.query1('SELECT id FROM staff WHERE id=?', [id]);
}

// Highest current sort_order, or null when the table is empty.
async function maxSortOrder() {
  const r = await c.query1('SELECT MAX(sort_order) AS m FROM staff');
  return (r && r.m != null) ? r.m : null;
}

// Insert a fully-normalized row; returns the created record.
async function insert({ category, name, phone, phone2, notes, sort_order }) {
  const info = await c.run(
    'INSERT INTO staff (category,name,phone,phone2,notes,sort_order) VALUES (?,?,?,?,?,?)',
    [category, name, phone, phone2, notes, sort_order]
  );
  return await c.query1('SELECT * FROM staff WHERE id=?', [info.lastInsertRowid]);
}

// Patch only the provided columns (mirrors the original per-field UPDATEs).
async function update(id, fields) {
  for (const col of COLUMNS) {
    if (fields[col] !== undefined) await c.run(`UPDATE staff SET ${col}=? WHERE id=?`, [fields[col], id]);
  }
}

async function remove(id) {
  await c.run('DELETE FROM staff WHERE id=?', [id]);
}

// staff_categories is stored in the settings k/v table (no settings module yet).
// Returns the parsed value, or null when unset.
async function getCategories() {
  const row = await c.query1('SELECT value FROM settings WHERE key=?', ['staff_categories']);
  if (!row) return null;
  return _j(row.value, row.value);
}

async function setCategories(arr) {
  await c.run('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value=excluded.value', ['staff_categories', JSON.stringify(arr)]);
}

module.exports = { list, getById, exists, maxSortOrder, insert, update, remove, getCategories, setCategories };
