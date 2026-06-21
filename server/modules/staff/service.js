'use strict';
/**
 * Staff service — business logic for the staff domain. No SQL, no req/res.
 * Validates and normalizes input, then delegates persistence to the repository.
 * Validation failures throw an Error carrying a `.status` so the route layer can
 * map them straight to an HTTP response.
 */
const repo = require('./repository');

const DEFAULT_CATEGORIES = ['Director', 'Case Manager', 'Program Assistant', 'Other'];

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function list() {
  return repo.list();
}

// Create a staff member. Returns the created row (for the response + audit label).
function create(input = {}) {
  const { category, name, phone, phone2, notes } = input;
  if (!name || !name.trim())             throw httpError(400, 'Name required');
  if (name.trim().length > 200)          throw httpError(400, 'Name too long (max 200 chars)');
  if (phone && phone.length > 30)        throw httpError(400, 'Phone too long (max 30 chars)');
  if (phone2 && phone2.length > 30)      throw httpError(400, 'Phone2 too long (max 30 chars)');
  if (notes && notes.length > 2000)      throw httpError(400, 'Notes too long (max 2000 chars)');
  if (category && category.length > 100) throw httpError(400, 'Category too long (max 100 chars)');

  const max = repo.maxSortOrder();
  const sort_order = (max != null) ? max + 1 : 0;
  return repo.insert({
    category: category || '',
    name: name.trim(),
    phone: phone || '',
    phone2: phone2 || '',
    notes: notes || '',
    sort_order,
  });
}

// Update provided fields. Returns the staff member's name (for the audit label).
function update(id, patch = {}) {
  if (!repo.exists(id)) throw httpError(404, 'Not found');
  const { category, name, phone, phone2, notes, sort_order } = patch;
  if (name !== undefined && name.trim().length > 200) throw httpError(400, 'Name too long');
  if (phone !== undefined && phone.length > 30)       throw httpError(400, 'Phone too long');
  if (phone2 !== undefined && phone2.length > 30)     throw httpError(400, 'Phone2 too long');
  if (notes !== undefined && notes.length > 2000)     throw httpError(400, 'Notes too long');
  if (category !== undefined && category.length > 100) throw httpError(400, 'Category too long');

  const fields = {};
  if (category !== undefined)   fields.category = category;
  if (name !== undefined)       fields.name = name.trim();
  if (phone !== undefined)      fields.phone = phone;
  if (phone2 !== undefined)     fields.phone2 = phone2;
  if (notes !== undefined)      fields.notes = notes;
  if (sort_order !== undefined) fields.sort_order = parseInt(sort_order);
  repo.update(id, fields);

  const row = repo.getById(id);
  return row ? row.name : String(id);
}

// Delete a staff member. Returns { name, category } captured before deletion.
function remove(id) {
  const row = repo.getById(id);
  if (!row) throw httpError(404, 'Not found');
  repo.remove(id);
  return { name: row.name, category: row.category };
}

function getCategories() {
  const v = repo.getCategories();
  return Array.isArray(v) ? v : DEFAULT_CATEGORIES;
}

// Persist filtered categories; returns the cleaned array (for the audit detail).
function setCategories(categories) {
  if (!Array.isArray(categories)) throw httpError(400, 'categories must be array');
  const clean = categories.filter(c => c && c.trim());
  repo.setCategories(clean);
  return clean;
}

module.exports = { list, create, update, remove, getCategories, setCategories, DEFAULT_CATEGORIES };
