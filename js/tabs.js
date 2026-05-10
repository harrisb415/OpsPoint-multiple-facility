// ═══════════════════════════════════════════════════════════════
// tabs.js — Staff, Chores, Passes, Caseloads
// ShiftPoint v1.13
// ═══════════════════════════════════════════════════════════════

// ── Shared helpers ─────────────────────────────────────────────
var _retPassPage = 0;

function tabEsc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
// Phone formatting — uses formatPhone from app.js if available, else inline fallback
function _fmtPhone(raw){
  if(typeof formatPhone === 'function') return formatPhone(raw);
  if(!raw) return '';
  var d=String(raw).replace(/\D/g,'');
  if(d.length===11&&d[0]==='1') d=d.slice(1);
  if(d.length===10) return '('+d.slice(0,3)+') '+d.slice(3,6)+'-'+d.slice(6);
  return raw;
}
function hasPerm(perm) {
  return window.SESSION && Array.isArray(window.SESSION.permissions) && window.SESSION.permissions.includes(perm);
}
// Legacy alias — kept for backward compat; prefer hasPerm() for new code
function isSup() {
  return hasPerm('ua.request') || hasPerm('reports.close');
}

// ═══════════════════════════════════════════════════════════════
// STAFF DIRECTORY
// ═══════════════════════════════════════════════════════════════

var _staffFilter = 'All';
var _staffEditId = null;

function renderStaffTab() {
  var addBtn = document.getElementById('btn-add-staff');
  var actionsTh = document.getElementById('staff-actions-th');
  if (addBtn)    addBtn.style.display    = '';
  if (actionsTh) actionsTh.style.display = '';

  // Category filter chips
  var cats = ['All'].concat(window.STAFF_CATEGORIES || ['Director','Case Manager','Monitor','Other']);
  var filterBar = document.getElementById('staff-filter-bar');
  if (filterBar) {
    filterBar.innerHTML = cats.map(function(c) {
      return '<button class="filter-chip' + (_staffFilter === c ? ' active' : '') + '" ' +
        'onclick="setStaffFilter(\'' + tabEsc(c) + '\')" ' +
        'style="padding:4px 14px;border-radius:20px;font-size:.8em;font-weight:600;cursor:pointer;border:2px solid ' +
        (_staffFilter === c ? 'var(--crimson)' : '#ccd5e0') + ';background:' +
        (_staffFilter === c ? 'var(--crimson)' : 'white') + ';color:' +
        (_staffFilter === c ? 'white' : '#555') + ';">' + tabEsc(c) + '</button>';
    }).join('');
  }

  var filtered = (window.STAFF || []).filter(function(s) {
    return _staffFilter === 'All' || s.category === _staffFilter;
  });

  var tbody = document.getElementById('staff-table-body');
  if (!tbody) return;

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:26px;font-style:italic;">' +
      (_staffFilter !== 'All' ? 'No staff in this category.' : 'No staff added yet.') + '</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(function(s) {
    var actions = '<button class="btn btn-outline btn-sm" onclick="openEditStaffModal(' + s.id + ')" style="margin-right:5px;">Edit</button>' +
      '<button class="btn-danger-sm" onclick="deleteStaff(' + s.id + ')">Delete</button>';
    return '<tr>' +
      '<td><span style="background:var(--sky);color:var(--crimson);padding:2px 10px;border-radius:20px;font-size:.74em;font-weight:700;">' + tabEsc(s.category||'—') + '</span></td>' +
      '<td style="font-weight:600;">' + tabEsc(s.name||'') + '</td>' +
      '<td style="font-family:var(--mono);font-size:.83em;">' + tabEsc(_fmtPhone(s.phone)||'—') + '</td>' +
      '<td style="font-family:var(--mono);font-size:.83em;">' + tabEsc(_fmtPhone(s.phone2)||'—') + '</td>' +
      '<td style="font-size:.85em;color:#64748b;">' + tabEsc(s.notes||'') + '</td>' +
      '<td style="white-space:nowrap;">' + actions + '</td>' +
      '</tr>';
  }).join('');
}

function setStaffFilter(cat) {
  _staffFilter = cat;
  renderStaffTab();
}

function openAddStaffModal() {
  _staffEditId = null;
  populateStaffCategorySelect(null);
  document.getElementById('staff-modal-title').textContent = 'Add Staff';
  document.getElementById('staff-modal-submit').textContent = 'Add';
  document.getElementById('sm-name').value = '';
  document.getElementById('sm-phone').value = '';
  document.getElementById('sm-phone2').value = '';
  document.getElementById('sm-notes').value = '';
  if(typeof attachPhoneMask==='function'){
    attachPhoneMask(document.getElementById('sm-phone'));
    attachPhoneMask(document.getElementById('sm-phone2'));
  }
  openModal('staff-modal');
}

function openEditStaffModal(id) {
  var s = (window.STAFF || []).find(function(x){ return x.id === id; });
  if (!s) return;
  _staffEditId = id;
  populateStaffCategorySelect(s.category);
  document.getElementById('staff-modal-title').textContent = 'Edit Staff';
  document.getElementById('staff-modal-submit').textContent = 'Save';
  document.getElementById('sm-name').value  = s.name   || '';
  document.getElementById('sm-phone').value = _fmtPhone(s.phone)  || '';
  document.getElementById('sm-phone2').value= _fmtPhone(s.phone2) || '';
  document.getElementById('sm-notes').value = s.notes  || '';
  if(typeof attachPhoneMask==='function'){
    attachPhoneMask(document.getElementById('sm-phone'));
    attachPhoneMask(document.getElementById('sm-phone2'));
  }
  openModal('staff-modal');
}

function populateStaffCategorySelect(selected) {
  var sel = document.getElementById('sm-category');
  if (!sel) return;
  var cats = window.STAFF_CATEGORIES || ['Director','Case Manager','Monitor','Other'];
  // If selected is a custom value not in the list, map it to Other + pre-fill the text field
  var isCustom = selected && !cats.includes(selected);
  sel.innerHTML = '<option value="">— Select —</option>' + cats.map(function(c) {
    var pick = isCustom ? 'Other' : selected;
    return '<option value="' + tabEsc(c) + '"' + (c === pick ? ' selected' : '') + '>' + tabEsc(c) + '</option>';
  }).join('');
  var otherInp = document.getElementById('sm-category-other');
  if (otherInp) {
    if (isCustom) { otherInp.style.display = 'block'; otherInp.value = selected; }
    else if (selected === 'Other') { otherInp.style.display = 'block'; otherInp.value = ''; }
    else { otherInp.style.display = 'none'; otherInp.value = ''; }
  }
}

async function submitStaffModal() {
  var name = document.getElementById('sm-name').value.trim();
  if (!name) { alert('Name is required.'); return; }
  var catSel = document.getElementById('sm-category').value;
  var catOther = (document.getElementById('sm-category-other').value || '').trim();
  var category = (catSel === 'Other' && catOther) ? catOther : catSel;
  var payload = {
    category:  category,
    name:      name,
    phone:     document.getElementById('sm-phone').value.trim(),
    phone2:    document.getElementById('sm-phone2').value.trim(),
    notes:     document.getElementById('sm-notes').value.trim(),
  };
  try {
    var url    = _staffEditId ? '/api/staff/' + _staffEditId : '/api/staff';
    var method = _staffEditId ? 'PUT' : 'POST';
    var res  = await fetch(url, { method:method, headers:{'Content-Type':'application/json'}, credentials:'include', body:JSON.stringify(payload) });
    var data = await res.json();
    if (data.error) { alert(data.error); return; }
    closeModal('staff-modal');
    await _reloadStaff();
    renderStaffTab();
  } catch(e) { alert('Error saving staff member.'); }
}

async function deleteStaff(id) {
  if (!confirm('Remove this staff member?')) return;
  try {
    await fetch('/api/staff/' + id, { method:'DELETE', credentials:'include' });
    await _reloadStaff();
    renderStaffTab();
  } catch(e) { alert('Error deleting.'); }
}

async function _reloadStaff() {
  try {
    var r = await fetch('/api/staff', {credentials:'include'});
    window.STAFF = await r.json();
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════════
// CHORES
// ═══════════════════════════════════════════════════════════════

var _choreLog = {};  // { client_id: initials } for the displayed date
var _choreEditClientId = null;

function setChoreToday() {
  var inp = document.getElementById('chore-date-input');
  if (inp) inp.value = new Date().toISOString().slice(0,10);
  loadChoreLog();
}

async function loadChoreLog() {
  var date = (document.getElementById('chore-date-input') || {}).value || new Date().toISOString().slice(0,10);
  try {
    var r = await fetch('/api/chore-log?date=' + date, {credentials:'include'});
    var rows = await r.json();
    _choreLog = {};
    rows.forEach(function(row){ _choreLog[row.client_id] = row.initials; });
  } catch(e) {}
  renderChoresTab();
}

function renderChoresTab() {
  var _canChores = typeof hasPerm === 'function' && hasPerm('chores.edit');

  var dateInp = document.getElementById('chore-date-input');
  if (dateInp && !dateInp.value) dateInp.value = new Date().toISOString().slice(0,10);

  var addRow = document.getElementById('master-chore-add-row');
  if (addRow) addRow.style.display = _canChores ? 'flex' : 'none';

  var clients = (CLIENTS || []).filter(function(c) {
    return c.is_active && !c.is_special && c.name !== 'VACANT';
  }).sort(function(a,b){ return (parseInt(a.room)||0) - (parseInt(b.room)||0); });

  var tbody = document.getElementById('chore-table-body');
  if (!tbody) return;

  var badge = document.getElementById('chore-total-badge');
  if (badge) badge.textContent = clients.length + ' resident' + (clients.length !== 1 ? 's' : '');

  if (!clients.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:26px;font-style:italic;">No active residents.</td></tr>';
    renderMasterChores();
    return;
  }

  tbody.innerHTML = clients.map(function(c) {
    var st = (shiftStatuses[c.id]) || 'building';
    var isOnPass = (st === 'pass');
    var statusBadge = isOnPass
      ? '<span style="background:#fef9c3;color:#854d0e;padding:2px 9px;border-radius:20px;font-size:.74em;font-weight:700;border:1px solid #fde047;white-space:nowrap;">Weekend Pass</span>'
      : '<span style="background:#dcfce7;color:#15803d;padding:2px 9px;border-radius:20px;font-size:.74em;font-weight:700;border:1px solid #86efac;">Active</span>';

    var choreName = c.chore || '—';
    var choreCell = _canChores
      ? '<span style="cursor:pointer;text-decoration:underline;text-decoration-style:dotted;color:var(--text);" ' +
        'onclick="openChoreAssignModal(' + c.id + ')" title="Click to assign chore">' + tabEsc(choreName) + '</span>'
      : '<span>' + tabEsc(choreName) + '</span>';

    var timeSlot = c.chore_time
      ? '<span style="background:var(--sky);padding:1px 7px;border-radius:10px;font-size:.74em;font-weight:700;color:var(--steel);">' + tabEsc(c.chore_time) + '</span>'
      : '—';

    var initials = _choreLog[c.id] || '';
    var initialsCell = _canChores
      ? '<input type="text" value="' + tabEsc(initials) + '" maxlength="6" ' +
        'style="width:58px;text-align:center;font-family:var(--mono);font-size:.88rem;padding:3px 6px;' +
        'border:1.5px solid var(--line);border-radius:5px;outline:none;" ' +
        'placeholder="—" ' +
        'onblur="saveChoreInitials(' + c.id + ',this.value)" ' +
        'onfocus="this.style.borderColor=\'var(--crimson)\'" ' +
        'onblur="this.style.borderColor=\'var(--line)\';saveChoreInitials(' + c.id + ',this.value)" ' +
        'onkeydown="if(event.key===\'Enter\')this.blur()">'
      : '<span style="font-family:var(--mono);font-size:.88rem;color:var(--steel);">' + tabEsc(initials || '—') + '</span>';

    return '<tr>' +
      '<td class="rm">' + tabEsc(c.room) + '</td>' +
      '<td style="font-weight:600;">' + tabEsc(c.name) + '</td>' +
      '<td style="text-align:center;">' + timeSlot + '</td>' +
      '<td>' + choreCell + '</td>' +
      '<td style="text-align:center;">' + statusBadge + '</td>' +
      '<td style="text-align:center;">' + initialsCell + '</td>' +
      '</tr>';
  }).join('');

  renderMasterChores();
}

function openChoreAssignModal(clientId) {
  var c = (CLIENTS || []).find(function(x){ return x.id === clientId; });
  if (!c) return;
  _choreEditClientId = clientId;
  var titleEl = document.getElementById('chore-assign-title');
  var labelEl = document.getElementById('chore-assign-client-label');
  if (titleEl) titleEl.textContent = 'Assign Chore — ' + c.name;
  if (labelEl) labelEl.textContent = 'Room ' + c.room + ' · ' + c.name;

  var masterChores = window.MASTER_CHORES || [];
  var sel = document.getElementById('cam-chore');
  if (sel) {
    sel.innerHTML = '<option value="">— No chore assigned —</option>' +
      masterChores.map(function(ch) {
        return '<option value="' + tabEsc(ch) + '"' + (c.chore === ch ? ' selected' : '') + '>' + tabEsc(ch) + '</option>';
      }).join('');
    // If current chore not in master list, add it as custom
    if (c.chore && !masterChores.includes(c.chore)) {
      sel.innerHTML += '<option value="' + tabEsc(c.chore) + '" selected>' + tabEsc(c.chore) + ' (custom)</option>';
    }
  }
  var timeEl = document.getElementById('cam-time');
  if (timeEl) timeEl.value = c.chore_time || '';
  openModal('chore-assign-modal');
}

async function submitChoreAssign() {
  if (!_choreEditClientId) return;
  var chore     = document.getElementById('cam-chore').value;
  var choreTime = document.getElementById('cam-time').value;
  try {
    var r = await fetch('/api/clients/' + _choreEditClientId + '/chore', {
      method: 'PATCH',
      headers: {'Content-Type':'application/json'},
      credentials: 'include',
      body: JSON.stringify({ chore: chore, chore_time: choreTime })
    });
    var d = await r.json();
    if (d.error) { alert(d.error); return; }
    // Update in-memory client
    var c = (CLIENTS||[]).find(function(x){ return x.id === _choreEditClientId; });
    if (c) { c.chore = chore; c.chore_time = choreTime; }
    closeModal('chore-assign-modal');
    renderChoresTab();
  } catch(e) { alert('Error saving chore.'); }
}

async function saveChoreInitials(clientId, initials) {
  var date = (document.getElementById('chore-date-input') || {}).value || new Date().toISOString().slice(0,10);
  _choreLog[clientId] = initials;
  try {
    await fetch('/api/chore-log', {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      credentials: 'include',
      body: JSON.stringify({ client_id: clientId, log_date: date, initials: initials })
    });
  } catch(e) {}
}

function renderMasterChores() {
  var _canChores = typeof hasPerm === 'function' && hasPerm('chores.edit');
  var masterChores = window.MASTER_CHORES || [];
  var container = document.getElementById('master-chore-tags');
  if (!container) return;

  if (!masterChores.length) {
    container.innerHTML = '<span style="color:#94a3b8;font-size:.82em;font-style:italic;">No chores in master list.' + (_canChores ? ' Add one below.' : '') + '</span>';
    return;
  }

  // Filter out chores already assigned to a resident
  var assignedChores = (CLIENTS || []).map(function(c) { return c.chore; }).filter(Boolean);
  var available = masterChores.filter(function(ch) { return assignedChores.indexOf(ch) === -1; });

  if (!available.length) {
    container.innerHTML = '<span style="color:#94a3b8;font-size:.82em;font-style:italic;">All chores are currently assigned.</span>';
    return;
  }

  container.innerHTML = available.map(function(ch) {
    var i = masterChores.indexOf(ch);
    var del = _canChores
      ? '<button onclick="removeMasterChore(' + i + ')" ' +
        'style="background:none;border:none;cursor:pointer;color:#999;font-size:.95em;padding:0 0 0 4px;" ' +
        'title="Remove">&times;</button>'
      : '';
    return '<span style="background:#e5eef8;color:var(--crimson);padding:3px 10px;border-radius:20px;' +
      'font-size:.82em;display:inline-flex;align-items:center;gap:2px;">' +
      tabEsc(ch) + del + '</span>';
  }).join('');
}

async function addMasterChore() {
  var input = document.getElementById('new-chore-input');
  var val = (input ? input.value : '').trim();
  if (!val) return;
  var chores = (window.MASTER_CHORES || []).slice();
  if (chores.indexOf(val) !== -1) { alert('Already in master list.'); return; }
  chores.push(val);
  await _saveMasterChores(chores);
  if (input) input.value = '';
}

async function removeMasterChore(index) {
  var chores = (window.MASTER_CHORES || []).slice();
  chores.splice(index, 1);
  await _saveMasterChores(chores);
}

async function _saveMasterChores(chores) {
  try {
    await fetch('/api/master-chores', {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      credentials: 'include',
      body: JSON.stringify({ chores: chores })
    });
    window.MASTER_CHORES = chores;
    renderChoresTab();
  } catch(e) { alert('Error saving master chore list.'); }
}

// ═══════════════════════════════════════════════════════════════
// WEEKEND PASSES
// ═══════════════════════════════════════════════════════════════

var _passEditId = null;

function renderPassesTab() {
  var _canEdit   = typeof hasPerm === 'function' && hasPerm('passes.edit');
  var _canStatus = typeof hasPerm === 'function' && hasPerm('passes.status');

  // Add Pass button and Actions column header
  var addBtn    = document.getElementById('btn-add-pass');
  var actionsTh = document.getElementById('passes-actions-th');
  if (addBtn)    addBtn.style.display    = _canEdit ? '' : 'none';
  if (actionsTh) actionsTh.style.display = _canEdit ? '' : 'none';

  // Notice board
  var notice     = window.PASS_NOTICE || '';
  var noticeView = document.getElementById('pass-notice-view');
  var noticeEdit = document.getElementById('pass-notice-edit');
  var noticeHint = document.getElementById('pass-notice-hint');
  if (noticeView) {
    noticeView.textContent   = notice || (_canEdit ? 'No notice posted — click to add one.' : 'No notice posted.');
    noticeView.style.cursor  = _canEdit ? 'pointer' : 'default';
    noticeView.onclick       = _canEdit ? editPassNotice : null;
    noticeView.title         = _canEdit ? 'Click to edit notice' : '';
    noticeView.style.display = '';
  }
  if (noticeEdit) { noticeEdit.value = notice; noticeEdit.style.display = 'none'; }
  if (noticeHint) noticeHint.style.display = _canEdit ? '' : 'none';

  // Split passes into active (In/Out) and returned (archived)
  var passes   = window.PASSES || [];
  var active   = passes.filter(function(p){ return p.status !== 'Returned'; });
  var returned = passes.filter(function(p){ return p.status === 'Returned'; });
  var cols     = _canEdit ? '8' : '7';
  var tbody    = document.getElementById('passes-table-body');
  if (tbody) {
    tbody.innerHTML = active.length
      ? active.map(function(p){ return _passRow(p, _canEdit, _canStatus); }).join('')
      : '<tr><td colspan="'+cols+'" style="text-align:center;color:#94a3b8;padding:26px;font-style:italic;">No active passes.</td></tr>';
  }
  // Returned passes section (paginated, 25 per page)
  var retSection = document.getElementById('returned-passes-section');
  if (retSection) {
    if (returned.length) {
      retSection.style.display = '';
      var retTotal = returned.length, retSz = 25;
      if (_retPassPage >= Math.ceil(retTotal / retSz)) _retPassPage = Math.max(0, Math.ceil(retTotal / retSz) - 1);
      var retPaged = returned.slice(_retPassPage * retSz, (_retPassPage + 1) * retSz);
      var retBody = document.getElementById('returned-passes-body');
      if (retBody) retBody.innerHTML = retPaged.map(function(p){ return _returnedPassRow(p, _canEdit); }).join('');
      var retPagerEl = document.getElementById('returned-passes-pager');
      if (retPagerEl && typeof _spPager === 'function') {
        retPagerEl.innerHTML = _spPager(_retPassPage, retTotal, retSz, '_retPassPage=Math.max(0,_retPassPage-1);renderPassesTab();', '_retPassPage++;renderPassesTab();');
      }
    } else {
      retSection.style.display = 'none';
    }
  }
}

function _passRow(p, canEdit, canStatus) {
  // Normalise legacy Extended → Out for display
  var displayStatus = (p.status === 'In') ? 'In' : 'Out';
  var colors = {
    'In':  { bg:'#dcfce7', fg:'#15803d', border:'#86efac' },
    'Out': { bg:'#fef9c3', fg:'#854d0e', border:'#fde047' },
  };
  var sc = colors[displayStatus];

  // Status cell: dropdown only for users with passes.status; others see read-only badge
  var statusCell = canStatus
    ? '<select onchange="updatePassStatus(' + p.id + ',' + p.client_id + ',this.value)" ' +
      'style="background:' + sc.bg + ';color:' + sc.fg + ';border:1.5px solid ' + sc.border + ';' +
      'border-radius:20px;font-size:.75em;font-weight:700;padding:2px 8px;outline:none;' +
      'font-family:var(--sans);cursor:pointer;">' +
      ['In','Out'].map(function(s){
        return '<option value="' + s + '"' + (displayStatus===s?' selected':'') + '>' + s + '</option>';
      }).join('') + '</select>'
    : '<span style="background:' + sc.bg + ';color:' + sc.fg + ';border:1.5px solid ' + sc.border + ';' +
      'border-radius:20px;font-size:.75em;font-weight:700;padding:2px 8px;display:inline-block;">' +
      tabEsc(displayStatus) + '</span>';

  var row = '<tr>' +
    '<td class="rm">' + tabEsc(p.room||'') + '</td>' +
    '<td style="font-weight:600;">' + tabEsc(p.name||'') + '</td>' +
    '<td style="font-size:.83em;">' + tabEsc(p.departure||'—') + '</td>' +
    '<td style="font-size:.83em;">' + tabEsc(p.return_date||'—') + '</td>' +
    '<td style="font-size:.83em;color:#64748b;">' + tabEsc(p.ua_notes||'—') + '</td>' +
    '<td style="font-size:.83em;color:#64748b;">' + tabEsc(p.notes||'—') + '</td>' +
    '<td style="text-align:center;">' + statusCell + '</td>';

  if (canEdit) {
    row += '<td style="white-space:nowrap;">' +
      // Return button: requires passes.status
      (canStatus
        ? '<button class="btn btn-sm" onclick="returnFromPass(' + p.id + ',' + p.client_id + ')" ' +
          'style="margin-right:4px;background:#dcfce7;color:#15803d;border:1.5px solid #86efac;border-radius:6px;padding:3px 8px;font-size:.75em;font-weight:700;cursor:pointer;">&#10003; Return</button>'
        : '') +
      '<button class="btn btn-outline btn-sm" onclick="openEditPassModal(' + p.id + ')" style="margin-right:4px;">Edit</button>' +
      '<button class="btn-danger-sm" onclick="deletePass(' + p.id + ')">Delete</button>' +
      '</td>';
  }

  return row + '</tr>';
}

function _returnedPassRow(p, canEdit) {
  var row = '<tr style="opacity:.75;">' +
    '<td class="rm">' + tabEsc(p.room||'') + '</td>' +
    '<td style="font-weight:600;">' + tabEsc(p.name||'') + '</td>' +
    '<td style="font-size:.83em;">' + tabEsc(p.departure||'—') + '</td>' +
    '<td style="font-size:.83em;">' + tabEsc(p.return_date||'—') + '</td>' +
    '<td style="font-size:.83em;color:#64748b;">' + tabEsc(p.ua_notes||'—') + '</td>' +
    '<td style="font-size:.83em;color:#64748b;">' + tabEsc(p.notes||'—') + '</td>' +
    '<td style="text-align:center;"><span style="background:#dcfce7;color:#15803d;border:1.5px solid #86efac;' +
    'border-radius:20px;font-size:.75em;font-weight:700;padding:2px 8px;display:inline-block;">Returned</span></td>';
  if (canEdit) {
    row += '<td style="white-space:nowrap;">' +
      '<button class="btn-danger-sm" onclick="deletePass(' + p.id + ')">Delete</button>' +
      '</td>';
  }
  return row + '</tr>';
}

function editPassNotice() {
  var view = document.getElementById('pass-notice-view');
  var edit = document.getElementById('pass-notice-edit');
  if (view) view.style.display = 'none';
  if (edit) { edit.style.display = ''; edit.focus(); edit.select(); }
}

async function savePassNotice() {
  var edit = document.getElementById('pass-notice-edit');
  var view = document.getElementById('pass-notice-view');
  var val = edit ? edit.value.trim() : '';
  if (edit) edit.style.display = 'none';
  var _canEdit = typeof hasPerm === 'function' && hasPerm('passes.edit');
  if (view) { view.textContent = val || (_canEdit ? 'No notice posted — click to add one.' : 'No notice posted.'); view.style.display = ''; }
  window.PASS_NOTICE = val;
  try {
    await fetch('/api/pass-notice', {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      credentials: 'include',
      body: JSON.stringify({ notice: val })
    });
  } catch(e) {}
}

function openAddPassModal() {
  _passEditId = null;
  document.getElementById('pass-modal-title').textContent  = 'Add Pass';
  document.getElementById('pass-modal-submit').textContent = 'Add Pass';
  _populatePassClientSelect(null);
  document.getElementById('pm-departure').value = '';
  document.getElementById('pm-return').value    = '';
  document.getElementById('pm-ua').value        = '';
  document.getElementById('pm-notes').value     = '';
  document.getElementById('pm-status').value    = 'In';
  // Hide status field for users without passes.status permission
  var statusField = document.getElementById('pm-status') && document.getElementById('pm-status').closest('.field');
  var canStatus = typeof hasPerm === 'function' && hasPerm('passes.status');
  if (statusField) statusField.style.display = canStatus ? '' : 'none';
  openModal('pass-modal');
}

function openEditPassModal(id) {
  var p = (window.PASSES || []).find(function(x){ return x.id === id; });
  if (!p) return;
  _passEditId = id;
  document.getElementById('pass-modal-title').textContent  = 'Edit Pass — ' + p.name;
  document.getElementById('pass-modal-submit').textContent = 'Save';
  _populatePassClientSelect(p.client_id);
  document.getElementById('pm-departure').value = _toDatetimeLocal(p.departure);
  document.getElementById('pm-return').value    = _toDatetimeLocal(p.return_date);
  document.getElementById('pm-ua').value        = p.ua_notes || '';
  document.getElementById('pm-notes').value     = p.notes    || '';
  // Normalise legacy Extended → Out; Returned passes aren't editable via this modal
  var st = p.status === 'In' ? 'In' : (p.status === 'Out' || p.status === 'Extended') ? 'Out' : 'In';
  document.getElementById('pm-status').value = st;
  // Hide status field for users without passes.status permission
  var statusField = document.getElementById('pm-status') && document.getElementById('pm-status').closest('.field');
  var canStatus = typeof hasPerm === 'function' && hasPerm('passes.status');
  if (statusField) statusField.style.display = canStatus ? '' : 'none';
  openModal('pass-modal');
}

function _toDatetimeLocal(str) {
  if (!str) return '';
  try {
    var d = new Date(str);
    if (!isNaN(d)) {
      var pad = function(n){ return String(n).padStart(2,'0'); };
      return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
    }
  } catch(e) {}
  return '';
}

function _fromDatetimeLocal(str) {
  if (!str) return '';
  try {
    var d = new Date(str);
    if (!isNaN(d)) {
      return d.toLocaleDateString('en-US',{month:'numeric',day:'numeric',year:'numeric'}) + ' ' +
             d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
    }
  } catch(e) {}
  return str;
}

function _populatePassClientSelect(selectedId) {
  var sel = document.getElementById('pm-client');
  if (!sel) return;
  var active = (CLIENTS || []).filter(function(c){
    return c.is_active && !c.is_special && c.name !== 'VACANT';
  }).sort(function(a,b){ return (parseInt(a.room)||0) - (parseInt(b.room)||0); });
  sel.innerHTML = '<option value="">— Select client —</option>' +
    active.map(function(c){
      return '<option value="' + c.id + '"' + (c.id === selectedId ? ' selected' : '') + '>' +
        'Rm ' + tabEsc(c.room) + ' — ' + tabEsc(c.name) + '</option>';
    }).join('');
}

function onPassClientSelect() { /* room auto-fills on save from server */ }

async function submitPassModal() {
  var clientIdVal = document.getElementById('pm-client').value;
  if (!clientIdVal && !_passEditId) { alert('Please select a client.'); return; }
  var clientId = parseInt(clientIdVal) || null;
  var client   = clientId ? (CLIENTS||[]).find(function(c){ return c.id === clientId; }) : null;
  var payload  = {
    departure:   _fromDatetimeLocal(document.getElementById('pm-departure').value),
    return_date: _fromDatetimeLocal(document.getElementById('pm-return').value),
    ua_notes:    document.getElementById('pm-ua').value.trim(),
    notes:       document.getElementById('pm-notes').value.trim(),
    status:      document.getElementById('pm-status').value,
  };
  if (clientId)    payload.client_id = clientId;
  if (client)      { payload.room = client.room; payload.name = client.name; }
  try {
    var url    = _passEditId ? '/api/passes/' + _passEditId : '/api/passes';
    var method = _passEditId ? 'PUT' : 'POST';
    var res  = await fetch(url, { method:method, headers:{'Content-Type':'application/json'}, credentials:'include', body:JSON.stringify(payload) });
    var data = await res.json();
    if (data.error) { alert(data.error); return; }
    // Sync client roster status — only when user has passes.status permission
    var _canStatusSync = typeof hasPerm === 'function' && hasPerm('passes.status');
    if (clientId && _canStatusSync) {
      _setClientStatusFromPass(clientId, payload.status === 'Out' ? 'pass' : 'building');
    }
    closeModal('pass-modal');
    await _reloadPasses();
    renderPassesTab();
  } catch(e) { alert('Error saving pass.'); }
}

async function updatePassStatus(id, clientId, status) {
  try {
    await fetch('/api/passes/' + id, {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      credentials: 'include',
      body: JSON.stringify({ status: status })
    });
    var p = (window.PASSES||[]).find(function(x){ return x.id === id; });
    if (p) p.status = status;
    // Out → Weekend Pass on roster; In → In Building
    _setClientStatusFromPass(clientId, status === 'Out' ? 'pass' : 'building');
    renderPassesTab();
  } catch(e) {}
}

// Mark pass as returned, archive it, and set client status to In Building
async function returnFromPass(passId, clientId) {
  try {
    await fetch('/api/passes/' + passId, {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      credentials: 'include',
      body: JSON.stringify({ status: 'Returned' })
    });
    var p = (window.PASSES||[]).find(function(x){ return x.id === passId; });
    if (p) p.status = 'Returned';
    // Update client status to In Building on active report
    _setClientStatusFromPass(clientId, 'building');
    renderPassesTab();
  } catch(e) { alert('Error marking pass as returned.'); }
}

// Helper: update resident status on active report after pass change
function _setClientStatusFromPass(clientId, statusKey) {
  if (!clientId) return;
  // Log departure / return to shift activity log
  var _prevStatus = typeof shiftStatuses !== 'undefined' ? shiftStatuses[clientId] : null;
  if (typeof addLogEntry === 'function' && typeof nowTs === 'function') {
    var _client = (CLIENTS||[]).find(function(c){ return c.id === clientId; });
    if (_client) {
      var _ts = nowTs('');
      if (statusKey === 'pass' && _prevStatus !== 'pass') {
        addLogEntry(_ts, _client.name + ' (Rm. ' + _client.room + ') departed on weekend pass.');
      } else if (statusKey !== 'pass' && _prevStatus === 'pass') {
        addLogEntry(_ts, _client.name + ' (Rm. ' + _client.room + ') returned from weekend pass.');
      }
    }
  }
  // Update in-memory status
  if (typeof shiftStatuses !== 'undefined') {
    shiftStatuses[clientId] = statusKey;
  }
  if (typeof buildRoster === 'function') buildRoster();
  // Persist via PATCH /api/data if there's an active report
  var reportId = typeof currentReportId !== 'undefined' ? currentReportId : null;
  if (reportId) {
    var statPatch = {};
    statPatch[clientId] = statusKey;
    fetch('/api/data', {
      method: 'PATCH',
      headers: {'Content-Type':'application/json'},
      credentials: 'include',
      body: JSON.stringify({ reportId: reportId, statuses: statPatch })
    }).catch(function(){});
  }
}

async function deletePass(id) {
  if (!confirm('Remove this pass record?')) return;
  try {
    await fetch('/api/passes/' + id, { method:'DELETE', credentials:'include' });
    await _reloadPasses();
    renderPassesTab();
  } catch(e) { alert('Error deleting pass.'); }
}

async function _reloadPasses() {
  try {
    var r = await fetch('/api/passes', {credentials:'include'});
    window.PASSES = await r.json();
  } catch(e) {}
}


// ═══════════════════════════════════════════════════════════════
// CASELOADS
// ═══════════════════════════════════════════════════════════════

function renderCaseloadsTab() {
  var clients = (CLIENTS || []).filter(function(c) {
    return c.is_active && !c.is_special && c.name !== 'VACANT' &&
           c.case_manager && c.case_manager.trim();
  });

  var container = document.getElementById('caseload-container');
  var empty     = document.getElementById('caseload-empty');

  if (!clients.length) {
    if (container) container.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  // Group by case manager
  var grouped = {};
  clients.forEach(function(c) {
    var cm = (c.case_manager || 'Unassigned').trim();
    if (!grouped[cm]) grouped[cm] = [];
    grouped[cm].push(c);
  });

  var managers = Object.keys(grouped).sort();
  container.innerHTML = managers.map(function(mgr) {
    var roster = grouped[mgr].slice().sort(function(a,b){ return (parseInt(a.room)||0) - (parseInt(b.room)||0); });
    var rows = roster.map(function(c) {
      var st     = (shiftStatuses[c.id]) || 'building';
      var stOpt  = (STATUS_OPTS||[]).find(function(o){ return o.v === st; });
      var stLabel= stOpt ? stOpt.l : 'In Building';
      var stC    = stCls(st);
      var intakeStr = c.intake_date
        ? new Date(c.intake_date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
        : '—';
      return '<tr>' +
        '<td class="rm">' + tabEsc(c.room) + '</td>' +
        '<td style="font-weight:600;">' + tabEsc(c.name) + '</td>' +
        '<td class="date-cell">' + intakeStr + '</td>' +
        '<td style="font-family:var(--mono);font-size:.83em;">' + tabEsc(c.phone||'—') + '</td>' +
        '<td><span class="ss ' + stC + '" style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:.74em;font-weight:700;pointer-events:none;cursor:default;">' + tabEsc(stLabel) + '</span></td>' +
        '</tr>';
    }).join('');

    return '<div class="section" style="margin-bottom:14px;">' +
      '<div class="section-head">' +
        '<div class="sh-left"><div class="sh-dot"></div>' + tabEsc(mgr) + '</div>' +
        '<span style="font-size:.65rem;color:#94a3b8;">' + roster.length + ' client' + (roster.length!==1?'s':'') + '</span>' +
      '</div>' +
      '<div class="roster-wrap"><table>' +
        '<thead><tr>' +
          '<th class="tc">Rm #</th><th>Name</th><th>Intake Date</th><th>Phone</th><th>Status</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>' +
    '</div>';
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
// PRINT FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function printStaffDirectory() {
  var facility = window.FACILITY_NAME || 'ShiftPoint';
  var cats = window.STAFF_CATEGORIES || ['Director','Case Manager','Monitor','Other'];
  var staff = (window.STAFF || []).slice().sort(function(a,b){
    var ci = cats.indexOf(a.category) - cats.indexOf(b.category);
    return ci !== 0 ? ci : (a.name||'').localeCompare(b.name||'');
  });

  var rows = staff.map(function(s,i){
    return '<tr style="background:'+(i%2===1?'#F4FAF6':'#fff')+';">' +
      '<td style="padding:7px 10px;"><span style="background:#EEF2F7;color:#0F172A;padding:2px 9px;border-radius:20px;font-size:9px;font-weight:700;">'+tabEsc(s.category||'—')+'</span></td>' +
      '<td style="padding:7px 10px;font-weight:700;">'+tabEsc(s.name||'')+'</td>' +
      '<td style="padding:7px 10px;font-family:monospace;">'+tabEsc(s.phone||'—')+'</td>' +
      '<td style="padding:7px 10px;font-family:monospace;">'+tabEsc(s.phone2||'—')+'</td>' +
      '<td style="padding:7px 10px;color:#64748b;font-size:11px;">'+tabEsc(s.notes||'')+'</td>' +
      '</tr>';
  }).join('');

  var html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>'+facility+' — Staff Directory</title>'
    +'<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;font-size:12px;color:#111;background:#fff;}'
    +'.hdr{background:#1A3327;color:#fff;padding:14px 20px;display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #D4A017;}'
    +'.hdr h1{font-size:16px;font-weight:800;letter-spacing:.04em;}.hdr .sub{font-size:9px;color:#A8D5B5;margin-top:2px;letter-spacing:.06em;}'
    +'.hdr .meta{text-align:right;font-size:10px;color:#A8D5B5;}'
    +'table{width:100%;border-collapse:collapse;}thead th{background:#1A3327;color:#94a3b8;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:8px 10px;text-align:left;}'
    +'tbody tr{border-bottom:1px solid #E2E8F0;}td{vertical-align:middle;font-size:12px;border-right:1px solid #E2E8F0;}td:last-child{border-right:none;}'
    +'.footer{text-align:center;font-size:9px;color:#94a3b8;border-top:1.5px solid #E2E8F0;padding:8px 20px;margin-top:6px;}'
    +'@media print{@page{size:letter portrait;margin:.4in;}body{font-size:11px;}.hdr{-webkit-print-color-adjust:exact;print-color-adjust:exact;}thead th{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}'
    +'</style></head><body>'
    +'<div class="hdr"><div><h1>'+tabEsc(facility)+' — Staff Directory</h1><div class="sub">Positive Directions Equals Change · Westside Community Services</div></div>'
    +'<div class="meta">Printed: '+new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+'<br>'+staff.length+' staff members</div></div>'
    +'<table><thead><tr><th>Category</th><th>Name</th><th>Phone</th><th>Alt. Phone</th><th>Notes</th></tr></thead>'
    +'<tbody>'+rows+'</tbody></table>'
    +'<div class="footer">'+tabEsc(facility)+' Staff Directory &nbsp;·&nbsp; Confidential — Not for Distribution &nbsp;·&nbsp; © 2026 Westside Community Services</div>'
    +'<scr'+'ipt>window.onload=function(){window.print()};</scr'+'ipt></body></html>';

  var w = window.open('','_blank');
  if(w){w.document.write(html);w.document.close();}
  else{alert('Please allow pop-ups to print.');}
}

function printChoreList() {
  var facility = window.FACILITY_NAME || 'ShiftPoint';
  var dateEl = document.getElementById('chore-date-input');
  var dateStr = dateEl && dateEl.value
    ? new Date(dateEl.value+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})
    : new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});

  var clients = (CLIENTS||[]).filter(function(c){
    return c.is_active && !c.is_special && c.name!=='VACANT' && c.chore;
  }).sort(function(a,b){ return (parseInt(a.room)||0)-(parseInt(b.room)||0); });

  var rows = clients.map(function(c,i){
    var isOnPass = (shiftStatuses[c.id]==='pass');
    var status = isOnPass ? '<span style="color:#854d0e;font-size:10px;font-weight:700;">PASS</span>' : '<span style="color:#15803d;font-size:10px;font-weight:700;">Active</span>';
    return '<tr style="background:'+(i%2===1?'#F4FAF6':'#fff')+';">'
      +'<td style="padding:8px 10px;font-family:monospace;font-weight:700;text-align:center;">'+tabEsc(c.room)+'</td>'
      +'<td style="padding:8px 10px;font-weight:700;">'+tabEsc(c.name)+'</td>'
      +'<td style="padding:8px 10px;"><span style="background:#EEF2F7;color:#475569;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;">'+tabEsc(c.chore_time||'—')+'</span></td>'
      +'<td style="padding:8px 10px;font-weight:600;">'+tabEsc(c.chore)+'</td>'
      +'<td style="padding:8px 10px;text-align:center;">'+status+'</td>'
      +'<td style="padding:8px 10px;text-align:center;border:1.5px solid #ccc;min-width:70px;">&nbsp;</td>'
      +'</tr>';
  }).join('');

  if(!rows) rows='<tr><td colspan="6" style="text-align:center;padding:24px;color:#94a3b8;font-style:italic;">No chores assigned.</td></tr>';

  var html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>'+facility+' — Daily Chores</title>'
    +'<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;font-size:12px;color:#111;background:#fff;}'
    +'.hdr{background:#1A3327;color:#fff;padding:14px 20px;display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #D4A017;}'
    +'.hdr h1{font-size:16px;font-weight:800;}.hdr .sub{font-size:9px;color:#A8D5B5;margin-top:2px;letter-spacing:.06em;}'
    +'.hdr .meta{text-align:right;font-size:10px;color:#A8D5B5;}'
    +'table{width:100%;border-collapse:collapse;}thead th{background:#1A3327;color:#94a3b8;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:8px 10px;text-align:left;}'
    +'tbody tr{border-bottom:1px solid #E2E8F0;}td{vertical-align:middle;}'
    +'.footer{text-align:center;font-size:9px;color:#94a3b8;border-top:1.5px solid #E2E8F0;padding:8px 20px;margin-top:4px;}'
    +'.sig{display:flex;gap:30px;padding:12px 20px;border-top:1px solid #ccc;font-size:10px;}'
    +'.sig-f{flex:1;}.sig-l{display:inline-block;border-bottom:1px solid #555;width:60%;margin-left:4px;}'
    +'@media print{@page{size:letter portrait;margin:.4in;}body{font-size:11px;}.hdr{-webkit-print-color-adjust:exact;print-color-adjust:exact;}thead th{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}'
    +'</style></head><body>'
    +'<div class="hdr"><div><h1>'+tabEsc(facility)+' — Daily Chore Assignment</h1><div class="sub">Positive Directions Equals Change · Westside Community Services</div></div>'
    +'<div class="meta">'+dateStr+'<br>'+clients.length+' assignments</div></div>'
    +'<table><thead><tr><th class="tc" style="width:50px;">Rm</th><th>Resident</th><th style="width:70px;">Time</th><th>Chore Assignment</th><th style="width:70px;">Status</th><th style="width:80px;text-align:center;">Initials</th></tr></thead>'
    +'<tbody>'+rows+'</tbody></table>'
    +'<div class="sig"><div class="sig-f"><b>Supervisor Review:</b><span class="sig-l"></span></div><div class="sig-f"><b>Date:</b><span class="sig-l"></span></div></div>'
    +'<div class="footer">Post at front desk. Residents must initial upon completion. Supervisor verifies at end of shift.</div>'
    +'<scr'+'ipt>window.onload=function(){window.print()};</scr'+'ipt></body></html>';

  var w = window.open('','_blank');
  if(w){w.document.write(html);w.document.close();}
  else{alert('Please allow pop-ups to print.');}
}

function printCaseloadList() {
  var facility = window.FACILITY_NAME || 'ShiftPoint';
  var clients = (CLIENTS||[]).filter(function(c){
    return c.is_active && !c.is_special && c.name!=='VACANT' && c.case_manager && c.case_manager.trim();
  });

  // Group by CM
  var grouped = {};
  clients.forEach(function(c){
    var cm = (c.case_manager||'Unassigned').trim();
    if(!grouped[cm]) grouped[cm]=[];
    grouped[cm].push(c);
  });
  var managers = Object.keys(grouped).sort();

  var sections = managers.map(function(mgr){
    var roster = grouped[mgr].slice().sort(function(a,b){ return (parseInt(a.room)||0)-(parseInt(b.room)||0); });
    var rows = roster.map(function(c,i){
      var intake = c.intake_date ? new Date(c.intake_date+'T12:00:00').toLocaleDateString('en-US',{month:'numeric',day:'numeric',year:'2-digit'}) : '—';
      return '<tr style="background:'+(i%2===1?'#F4FAF6':'#fff')+';">'
        +'<td style="padding:6px 8px;font-family:monospace;font-weight:700;text-align:center;">'+tabEsc(c.room)+'</td>'
        +'<td style="padding:6px 8px;font-weight:700;">'+tabEsc(c.name)+'</td>'
        +'<td style="padding:6px 8px;font-family:monospace;font-size:11px;">'+tabEsc(c.phone||'—')+'</td>'
        +'<td style="padding:6px 8px;font-size:11px;color:#64748b;">'+intake+'</td>'
        +'<td style="padding:6px 8px;font-size:11px;color:#64748b;"></td>'
        +'</tr>';
    }).join('');
    return '<tr style="background:#1A3327;"><td colspan="5" style="padding:6px 10px;color:#A8D5B5;font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;-webkit-print-color-adjust:exact;print-color-adjust:exact;">'+tabEsc(mgr)+' &nbsp;('+roster.length+' client'+(roster.length!==1?'s':'')+')</td></tr>'
      +rows;
  }).join('');

  var html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>'+facility+' — Caseloads</title>'
    +'<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;font-size:12px;color:#111;background:#fff;}'
    +'.hdr{background:#1A3327;color:#fff;padding:12px 18px;display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #D4A017;-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
    +'.hdr h1{font-size:15px;font-weight:800;}.hdr .sub{font-size:8.5px;color:#A8D5B5;margin-top:2px;}'
    +'.hdr .meta{text-align:right;font-size:9px;color:#A8D5B5;line-height:1.7;}'
    +'table{width:100%;border-collapse:collapse;}td{vertical-align:middle;border-bottom:1px solid #E2E8F0;}'
    +'thead th{background:#163825;color:#94a3b8;font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;padding:6px 8px;text-align:left;-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
    +'.footer{text-align:center;font-size:8.5px;color:#94a3b8;border-top:1px solid #E2E8F0;padding:7px;margin-top:4px;}'
    +'@media print{@page{size:letter portrait;margin:.35in;}body{font-size:11px;}}'
    +'</style></head><body>'
    +'<div class="hdr"><div><h1>'+tabEsc(facility)+' — Caseload Roster</h1><div class="sub">Positive Directions Equals Change · Westside Community Services</div></div>'
    +'<div class="meta">Printed: '+new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+'<br>'+clients.length+' active clients &nbsp;·&nbsp; '+managers.length+' case managers</div></div>'
    +'<table><thead><tr><th style="width:45px;">Rm</th><th>Resident Name</th><th>Phone</th><th>Intake Date</th><th>Notes</th></tr></thead>'
    +'<tbody>'+sections+'</tbody></table>'
    +'<div class="footer">Caseload Roster &nbsp;·&nbsp; '+tabEsc(facility)+' &nbsp;·&nbsp; Confidential — Not for Distribution &nbsp;·&nbsp; © 2026 Westside Community Services</div>'
    +'<scr'+'ipt>window.onload=function(){window.print()};</scr'+'ipt></body></html>';

  var w = window.open('','_blank');
  if(w){w.document.write(html);w.document.close();}
  else{alert('Please allow pop-ups to print.');}
}
