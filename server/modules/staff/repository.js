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

function list() {
  return c.query('SELECT * FROM staff ORDER BY sort_order, id');
}

function getById(id) {
  return c.query1('SELECT * FROM staff WHERE id=?', [id]);
}

function exists(id) {
  return !!c.query1('SELECT id FROM staff WHERE id=?', [id]);
}

// Highest current sort_order, or null when the table is empty.
function maxSortOrder() {
  const r = c.query1('SELECT MAX(sort_order) AS m FROM staff');
  return (r && r.m != null) ? r.m : null;
}

// Insert a fully-normalized row; returns the created record.
function insert({ category, name, phone, phone2, notes, sort_order }) {
  const info = c.run(
    'INSERT INTO staff (category,name,phone,phone2,notes,sort_order) VALUES (?,?,?,?,?,?)',
    [category, name, phone, phone2, notes, sort_order]
  );
  return c.query1('SELECT * FROM staff WHERE id=?', [info.lastInsertRowid]);
}

// Patch only the provided columns (mirrors the original per-field UPDATEs).
function update(id, fields) {
  for (const col of COLUMNS) {
    if (fields[col] !== undefined) c.run(`UPDATE staff SET ${col}=? WHERE id=?`, [fields[col], id]);
  }
}

function remove(id) {
  c.run('DELETE FROM staff WHERE id=?', [id]);
}

// staff_categories is stored in the settings k/v table (no settings module yet).
// Returns the parsed value, or null when unset.
function getCategories() {
  const row = c.query1('SELECT value FROM settings WHERE key=?', ['staff_categories']);
  if (!row) return null;
  return _j(row.value, row.value);
}

function setCategories(arr) {
  c.run('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', ['staff_categories', JSON.stringify(arr)]);
}

module.exports = { list, getById, exists, maxSortOrder, insert, update, remove, getCategories, setCategories };
