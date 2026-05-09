// ── Printable sheets, utilities & init ──────────────────────
function printWalkthroughSheet() {
  const shift   = document.getElementById('meta-shift').value;
  const dateVal = document.getElementById('meta-date').value;
  const mod     = document.getElementById('meta-mod').value;

  const dateStr = dateVal
    ? new Date(dateVal + 'T12:00:00').toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric', year:'numeric'})
    : new Date().toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric', year:'numeric'});

  const shiftConfig = {
    'Day Shift': {
      label:    'Day Shift (7:00 a.m. – 3:30 p.m.)',
      allTimes: ['7:00 AM','8:00 AM','9:00 AM','10:00 AM','11:00 AM','12:00 PM','1:00 PM','2:00 PM'],
      wellness: new Set(['10:00 AM','12:00 PM','2:00 PM']),
    },
    'Swing Shift': {
      label:    'Swing Shift (3:00 p.m. – 11:30 p.m.)',
      allTimes: ['3:00 PM','4:00 PM','5:00 PM','6:00 PM','7:00 PM','8:00 PM','9:00 PM','10:00 PM'],
      wellness: new Set(['4:00 PM','8:00 PM','10:00 PM']),
    },
    'Graveyard Shift': {
      label:    'Graveyard Shift (11:00 p.m. – 7:30 a.m.)',
      allTimes: ['11:00 PM','12:00 AM','1:00 AM','2:00 AM','3:00 AM','4:00 AM','5:00 AM','6:00 AM'],
      wellness: new Set(['11:00 PM','6:00 AM']),
    },
  };

  const cfg = shiftConfig[shift] || shiftConfig['Swing Shift'];
  const times = cfg.allTimes;
  const wellnessTimes = cfg.wellness;

  const areas = [
    'Supply Room',
    'Basement / Offices',
    'Kitchen',
    'Meeting Room',
    'Dining Room',
    'Laundry Area',
    'Clothing Closet',
    'Stairs to Roof',
    'Floors 2, 3 & 4',
    'Stairs Down to 6th St.',
    'Perimeter Check',
  ];

  const colW = Math.floor(58 - (times.length > 6 ? (times.length - 6) * 2 : 0));

  const headerCells = times.map(t => {
    const isW = wellnessTimes.has(t);
    return '<th class="t-th' + (isW ? ' wc-th' : '') + '">'
      + (isW ? '<div class="wc-lbl">Wellness<br>Check</div>' : '')
      + t + '</th>';
  }).join('');

  const areaRows = areas.map((area, i) =>
    '<tr class="' + (i % 2 === 1 ? 'alt' : '') + '">'
    + '<td class="area-td">' + area + '</td>'
    + times.map(t => '<td class="' + (wellnessTimes.has(t) ? 'wc-td' : 'mark-td') + '"></td>').join('')
    + '<td class="notes-td"></td>'
    + '</tr>'
  ).join('');

  const winHtml = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
    + '<title>Building Walkthrough — ' + shift + ' — ' + dateStr + '</title>'
    + '<style>'
    + '* { box-sizing:border-box; margin:0; padding:0; }'
    + 'body { font-family:Arial,sans-serif; font-size:11.5px; color:#111; background:#fff; }'

    // Page header — same style as wellness sheet
    + '.page-hdr { display:flex; justify-content:space-between; align-items:flex-end;'
    + '  border-bottom:2.5px solid #1a3327; padding:18px 22px 9px; }'
    + '.org { font-size:7.5px; font-weight:700; letter-spacing:.8px; color:#2d6a4f; text-transform:uppercase; margin-bottom:3px; }'
    + '.title { font-size:16px; font-weight:700; color:#1a3327; }'
    + '.sub-title { font-size:10px; color:#444; margin-top:3px; }'
    + '.hdr-right { text-align:right; font-size:10px; color:#444; line-height:2; }'
    + '.hdr-right b { color:#1a3327; }'

    // Meta row (MOD + Date inline under title)
    + '.meta-row { display:flex; gap:32px; padding:7px 22px 4px; font-size:10.5px; border-bottom:1px solid #d4e6da; }'
    + '.meta-field { display:flex; align-items:baseline; gap:6px; }'
    + '.meta-field label { font-weight:700; font-size:9.5px; color:#2d6a4f; letter-spacing:.4px; text-transform:uppercase; }'
    + '.meta-field .val { border-bottom:1px solid #555; min-width:160px; padding-bottom:1px; font-size:11px; }'

    + '.hint { font-size:8.5px; color:#888; font-style:italic; padding:4px 22px 2px; }'
    + '.wrap { padding:0 22px; }'

    + 'table { width:100%; border-collapse:collapse; }'
    + 'thead { display:table-header-group; }'

    // Header rows — same dark green as wellness sheet
    + 'thead tr th { background:#1a3327; color:#fff; padding:5px 4px; font-size:9px;'
    + '  font-weight:700; letter-spacing:.3px; border:1px solid #163825; text-align:center; vertical-align:bottom; line-height:1.3; }'
    + '.area-th  { text-align:left; width:148px; font-size:9.5px; }'
    + '.t-th     { width:' + colW + 'px; border-left:1px solid #245c3a; }'
    + '.wc-th    { background:#444444 !important; }'
    + '.wc-lbl   { font-size:6.5px; color:#ffffff; letter-spacing:.2px; display:block; line-height:1.2; margin-bottom:2px; }'
    + '.notes-th { text-align:left; }'

    // Body rows — generous height to fill 1 page with 11 areas
    + 'tbody tr { border-bottom:1px solid #cde0d4; }'
    + 'tbody tr.alt { background:#f4faf6; }'
    + 'td { padding:0 4px; height:68px; vertical-align:middle; border-right:1px solid #cde0d4; font-size:11.5px; }'
    + 'td:last-child { border-right:none; }'
    + '.area-td  { font-weight:600; font-size:11.5px; padding-left:6px; }'
    + '.mark-td  { border-left:1px solid #8dbda0; text-align:center; }'
    + '.wc-td    { border-left:1px solid #8dbda0; text-align:center; background:#bbbbbb; }'
    + '.notes-td { }'

    + '.footer-note { text-align:center; font-size:10.5px; font-weight:700; letter-spacing:.4px;'
    + '  color:#2d6a4f; border-top:2px solid #1a3327; padding:8px 22px; margin-top:4px; }'

    + '@media print {'
    + '  @page { size:letter portrait; margin:0.4in; }'
    + '  body { font-size:11.5px; }'
    + '  .page-hdr { padding:0 0 9px; }'
    + '  .meta-row { padding:6px 0 3px; }'
    + '  .wrap { padding:0; }'
    + '  .hint { padding:3px 0 1px; }'
    + '  .footer-note { padding:7px 0; margin-top:2px; }'
    + '}'
    + '</style></head><body>'

    + '<div class="page-hdr">'
    + '<div>'
    + '<div class="org">Positive Directions Equals Change · Westside Community Services</div>'
    + '<div class="title">' + (window.FACILITY_NAME||'ShiftPoint') + ' — Building Walkthrough Log</div>'
    + '<div class="sub-title">' + esc(cfg.label) + '  |  ' + dateStr + '</div>'
    + '</div>'
    + '<div class="hdr-right">'
    + '<b>Total Areas:</b> ' + areas.length + '<br>'
    + '<b>Required Checks:</b> ' + times.length + '<br>'
    + '<b>Wellness Checks:</b> ' + [...wellnessTimes].join(', ')
    + '</div>'
    + '</div>'

    + '<div class="meta-row">'
    + '<div class="meta-field"><label>Monitor on Duty:</label><div class="val">' + (esc(mod) || '') + '</div></div>'
    + '<div class="meta-field"><label>Date:</label><div class="val">'
    +   (dateVal ? (parseInt(dateVal.split('-')[1]) + '/' + parseInt(dateVal.split('-')[2]) + '/' + dateVal.split('-')[0].slice(2)) : '')
    + '</div></div>'
    + '</div>'

    + '<div class="hint">Initial each cell when area is checked. Mark any issues in the Notes column. Shaded columns — wellness check times.</div>'
    + '<div class="wrap">'
    + '<table>'
    + '<thead><tr>'
    + '<th class="area-th">Area</th>'
    + headerCells
    + '<th class="notes-th">Notes</th>'
    + '</tr></thead>'
    + '<tbody>' + areaRows + '</tbody>'
    + '</table>'
    + '</div>'

    + '<div class="footer-note">Please initial your name in each cell every hour.</div>'

    + '<scr' + 'ipt>window.onload=function(){window.print()};</scr' + 'ipt>'
    + '</body></html>';

  const win = window.open('', '_blank');
  if (win) { win.document.write(winHtml); win.document.close(); }
  else { alert('Please allow pop-ups to print the walkthrough sheet.'); }
}


// ── Printable Wellness Check Sheet ────────────────────────────
function printWellnessSheet() {
  const shift   = document.getElementById('meta-shift').value;
  const dateVal = document.getElementById('meta-date').value;
  const mod     = document.getElementById('meta-mod').value;

  const dateStr = dateVal
    ? new Date(dateVal + 'T12:00:00').toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric', year:'numeric'})
    : new Date().toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric', year:'numeric'});

  const shiftTimes = {
    'Day Shift':       ['10:00 AM', '12:00 PM', '2:00 PM'],
    'Swing Shift':     ['4:00 PM',  '8:00 PM',  '10:00 PM'],
    'Graveyard Shift': ['11:00 PM', '6:00 AM'],
  };
  const shiftLabels = {
    'Day Shift':       'Day Shift (7:00 a.m. – 3:30 p.m.)',
    'Swing Shift':     'Swing Shift (3:00 p.m. – 11:30 p.m.)',
    'Graveyard Shift': 'Graveyard Shift (11:00 p.m. – 7:30 a.m.)',
  };

  const times = shiftTimes[shift] || [];
  const activeClients = CLIENTS.filter(c => c.is_active && !c.is_special && c.name !== 'VACANT');

  // One column per time (status mark) + notes column
  const thTimes = times.map(t => '<th class="init-th">' + t + '</th>').join('');

  const clientRows = activeClients.map((c, i) => {
    const st = shiftStatuses[c.id] || (c.name === 'VACANT' ? 'vacant' : 'building');
    const statusMap = {
      building: { mark: '',     bg: '',        color: '#111' },
      work:     { mark: '',     bg: '',        color: '#111' },
      pass:     { mark: '',     bg: '',        color: '#111' },
      bhc:      { mark: 'BHC', bg: '#ede9fe', color: '#6d28d9' },
      efc:      { mark: 'EFC', bg: '#fce7f3', color: '#be185d' },
      hospital: { mark: 'HOSP',bg: '#fee2e2', color: '#991b1b' },
      out:      { mark: '',     bg: '',        color: '#111' },
      vacant:   { mark: '',     bg: '',        color: '#111' },
    };
    const info = statusMap[st] || { mark: '', bg: '', color: '#111' };
    const autoStyle = info.mark
      ? ' style="background:' + info.bg + ';color:' + info.color + ';font-weight:700;font-size:10px;text-align:center;"'
      : '';
    const timeCells = times.map(() =>
      '<td class="status-td"' + autoStyle + '>' + info.mark + '</td>'
    ).join('');
    const rowStyle = (st !== 'building') ? ' style="opacity:.8;"' : '';
    return '<tr class="' + (i % 2 === 1 ? 'alt' : '') + '"' + rowStyle + '>'
      + '<td class="rm-td">' + esc(c.room) + '</td>'
      + '<td class="name-td">' + esc(c.name) + '</td>'
      + timeCells
      + '<td class="notes-td"></td>'
      + '</tr>';
  }).join('');

  // Footer: totals row + monitor initials row
  const totalRow = '<tr class="sum">'
    + '<td colspan="2">Total Accounted For:</td>'
    + times.map(() => '<td class="status-td">___ / ' + activeClients.length + '</td>').join('')
    + '<td class="notes-td"></td>'
    + '</tr>';

  const initialsRow = '<tr class="init-row">'
    + '<td colspan="2" style="font-weight:700;font-size:10px;text-align:right;padding-right:8px;">Monitor Initials:</td>'
    + times.map(() => '<td class="init-box"></td>').join('')
    + '<td></td>'
    + '</tr>';

  const sigRow = '<div class="sig">'
    + '<div class="sig-b">Filed By: <span class="sig-l"></span></div>'
    + '<div class="sig-b">Supervisor Review: <span class="sig-l"></span></div>'
    + '<div class="sig-b">Date Filed: <span class="sig-l"></span></div>'
    + '</div>';

  const winHtml = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
    + '<title>Wellness Check — ' + shift + '</title>'
    + '<style>'
    + '* { box-sizing:border-box; margin:0; padding:0; }'
    + 'body { font-family:Arial,sans-serif; font-size:11px; color:#111; background:#fff; }'
    + '.page-hdr { display:flex; justify-content:space-between; align-items:flex-end;'
    + '  border-bottom:2.5px solid #1a3327; padding:16px 20px 8px; }'
    + '.org { font-size:7px; font-weight:700; letter-spacing:.8px; color:#2d6a4f; text-transform:uppercase; margin-bottom:2px; }'
    + '.title { font-size:15px; font-weight:700; color:#1a3327; }'
    + '.sub-title { font-size:9.5px; color:#444; margin-top:2px; }'
    + '.hdr-right { text-align:right; font-size:9.5px; color:#444; line-height:1.85; }'
    + '.hdr-right b { color:#1a3327; }'
    + '.hint { font-size:8px; color:#888; font-style:italic; padding:4px 20px 2px; }'
    + '.wrap { padding:0 20px 10px; }'
    + 'table { width:100%; border-collapse:collapse; }'
    + 'thead { display:table-header-group; }'
    + 'tfoot { display:table-footer-group; }'
    + 'thead tr th { background:#1a3327; color:#fff; padding:6px 7px; font-size:10px;'
    + '  font-weight:700; text-transform:uppercase; letter-spacing:.4px; border:1px solid #163825; }'
    + '.rm-th   { width:42px; text-align:left; }'
    + '.name-th { width:155px; text-align:left; }'
    + '.init-th { width:62px; text-align:center; border-left:1px solid #245c3a; }'
    + '.notes-th { text-align:left; }'
    + 'tbody tr { border-bottom:1px solid #cde0d4; }'
    + 'tbody tr.alt { background:#f4faf6; }'
    + 'td { padding:4.5px 6px; vertical-align:middle; border-right:1px solid #cde0d4; font-size:11px; }'
    + 'td:last-child { border-right:none; }'
    + '.rm-td     { font-family:monospace; font-weight:700; color:#555; text-align:center; }'
    + '.name-td   { font-weight:500; }'
    + '.status-td { border-left:1.5px solid #8dbda0; text-align:center; font-size:13px; }'
    + '.notes-td  { }'
    + 'tfoot tr.sum td { background:#dff0e6; border-top:2px solid #1a3327; font-weight:700; font-size:10px; padding:5px 6px; text-align:center; }'
    + 'tfoot tr.sum td:first-child, tfoot tr.sum td:nth-child(2) { text-align:left; }'
    + 'tfoot tr.init-row td { background:#f0f7f2; border-top:1px solid #8dbda0; padding:6px; }'
    + '.init-box { border-left:1.5px solid #8dbda0; border-bottom:2px solid #1a3327; height:26px; text-align:center; }'
    + '.sig { display:flex; gap:20px; padding:10px 20px 14px; border-top:1.5px solid #999; margin-top:4px; }'
    + '.sig-b { flex:1; font-size:9px; font-weight:700; color:#333; }'
    + '.sig-l { display:inline-block; border-bottom:1px solid #333; width:55%; margin-left:4px; }'
    + '@media print {'
    + '  @page { size:letter portrait; margin:0.4in; }'
    + '  body { font-size:11px; }'
    + '  .page-hdr { padding:0 0 8px; }'
    + '  .wrap { padding:0; }'
    + '  .hint { padding:3px 0 1px; }'
    + '  .sig { padding:8px 0 0; }'
    + '}'
    + '</style></head><body>'
    + '<div class="page-hdr">'
    + '<div>'
    + '<div class="org">Positive Directions Equals Change · Westside Community Services</div>'
    + '<div class="title">' + (window.FACILITY_NAME||'ShiftPoint') + ' — Wellness Check Sheet</div>'
    + '<div class="sub-title">' + esc(shiftLabels[shift] || shift) + '  |  ' + dateStr + '</div>'
    + '</div>'
    + '<div class="hdr-right">'
    + '<b>Monitor on Duty:</b> ' + (esc(mod) || '_______________') + '<br>'
    + '<b>Checks:</b> ' + times.join(', ') + '<br>'
    + '<b>Total Clients:</b> ' + activeClients.length
    + '</div>'
    + '</div>'
    + '<div class="hint">Mark each cell: ✓ present   X absent   W work   O out/pass   H hospital   BHC/EFC as applicable</div>'
    + '<div class="wrap">'
    + '<table>'
    + '<thead><tr><th class="rm-th">Rm</th><th class="name-th">Client Name</th>' + thTimes + '<th class="notes-th">Notes / Observations</th></tr></thead>'
    + '<tfoot>' + totalRow + initialsRow + '</tfoot>'
    + '<tbody>' + clientRows + '</tbody>'
    + '</table>'
    + '</div>'
    + sigRow
    + '<scr' + 'ipt>window.onload=function(){window.print()};</scr' + 'ipt>'
    + '</body></html>';

  const win = window.open('', '_blank');
  if (win) { win.document.write(winHtml); win.document.close(); }
  else { alert('Please allow pop-ups to print the wellness check sheet.'); }
}


// ── Utilities ──────────────────────────────────────────────────
function setSaveMsg(msg,cls){const el=document.getElementById('save-status'),m=document.getElementById('save-msg');el.className='save-status'+(cls?' '+cls:'');m.textContent=msg;}

// ── Floating toast notification ─────────────────────────────────
function showToast(type, text) {
  var container = document.getElementById('sp-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'sp-toast-container';
    container.style.cssText = 'position:fixed;top:72px;right:14px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
    document.body.appendChild(container);
  }
  var toast = document.createElement('div');
  var isOk = type === 'ok' || type === 'saved';
  toast.style.cssText = 'background:'+(isOk?'#1A5C42':'#B91C1C')+';color:#fff;padding:10px 16px;border-radius:9px;font-size:.84rem;font-weight:600;font-family:Outfit,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);max-width:300px;opacity:0;transition:opacity .2s;pointer-events:auto;';
  toast.textContent = text;
  container.appendChild(toast);
  requestAnimationFrame(function(){ toast.style.opacity = '1'; });
  setTimeout(function() {
    toast.style.opacity = '0';
    setTimeout(function(){ if(toast.parentNode) toast.parentNode.removeChild(toast); }, 250);
  }, isOk ? 3500 : 5000);
}
function today(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function fmt(s){if(!s)return'';try{return new Date(s+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}catch(e){return s;}}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
document.querySelectorAll('.modal-overlay').forEach(m=>m.addEventListener('click',function(e){if(e.target===this)this.classList.remove('open');}));

// ── Init ───────────────────────────────────────────────────────
(async function(){
  document.getElementById('meta-date').value=today();
  loadDefaultLog('Swing Shift');
  updateFolderUI();buildRoster();renderIssues();renderMedNotes();
  // Apply logos immediately — LOGOS already has defaults embedded
  applyLogo('pdec');
  applyLogo('wcs');
  const restored=await tryRestoreHandle();
  if(restored){
    await loadData();buildRoster();renderLog();renderIssues();renderMedNotes();
    setSaveMsg('Auto-save on','saved');
  } else {
    if(LOGOS.pdec){var gp=document.getElementById('gate-pdec');gp.src=LOGOS.pdec;gp.style.display='block';}
    if(LOGOS.wcs){var gw=document.getElementById('gate-wcs');gw.src=LOGOS.wcs;gw.style.display='block';}
    document.getElementById('folder-gate-modal').classList.add('open');
    setSaveMsg('Select a folder to continue','');
  }
})();

// ── File Wellness Checks (filled filing copy) ──────────────────
function fileWellnessChecks() {
  const shift   = document.getElementById('meta-shift').value;
  const dateVal = document.getElementById('meta-date').value;
  const mod     = document.getElementById('meta-mod').value;
  const dateStr = dateVal
    ? new Date(dateVal + 'T12:00:00').toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric', year:'numeric'})
    : new Date().toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric', year:'numeric'});
  const shiftLabels = {
    'Day Shift':       'Day Shift (7:00 a.m. – 3:30 p.m.)',
    'Swing Shift':     'Swing Shift (3:00 p.m. – 11:30 p.m.)',
    'Graveyard Shift': 'Graveyard Shift (11:00 p.m. – 7:30 a.m.)',
  };

  // Parse every wellness check entry from the activity log
  const checks = logEntries.filter(e => e.text && e.text.toLowerCase().startsWith('wellness check'));
  if (checks.length === 0) {
    alert('No wellness checks found in the activity log for this shift.');
    return;
  }

  // Build one column per check — header = time + monitor
  const checkCols = checks.map(e => {
    const byMatch = e.text.match(/conducted(?:\s+by\s+(.+?))?\./i);
    const monitor = (byMatch && byMatch[1]) ? byMatch[1].trim() : mod || '—';
    // Pull "not located" client IDs from the log text
    const notLocated = [];
    const nlMatch = e.text.match(/Not located:\s*(.+)\.?$/i);
    if (nlMatch) {
      nlMatch[1].split(',').forEach(function(s) {
        const rm = s.trim().match(/Rm\.?\s*(\d+)/i);
        if (rm) notLocated.push(parseInt(rm[1]));
      });
    }
    return { time: e.time, monitor: monitor, notLocated: notLocated };
  });

  const activeClients = CLIENTS.filter(c => c.is_active && !c.is_special && c.name !== 'VACANT');

  // Column headers: time + monitor name underneath
  const thCols = checkCols.map(function(col) {
    return '<th class="chk-th">' + esc(col.time)
      + '<div style="font-size:8px;font-weight:400;color:#a8d5b5;margin-top:2px;">' + esc(col.monitor) + '</div></th>';
  }).join('');

  // One row per client
  const clientRows = activeClients.map(function(c, i) {
    const st = shiftStatuses[c.id] || (c.name === 'VACANT' ? 'vacant' : 'building');
    const isOut = ['work','pass','bhc','efc','hospital','out'].includes(st);
    const statusLabel = { bhc:'BHC', efc:'EFC', hospital:'HOSP', work:'WORK', pass:'PASS', out:'OUT', building:'', vacant:'' };
    const statusBg = { bhc:'#ede9fe', efc:'#fce7f3', hospital:'#fee2e2', work:'#dbeafe', pass:'#fef9c3', out:'#fff7ed', building:'', vacant:'' };

    const cells = checkCols.map(function(col) {
      const wasNotLocated = col.notLocated.includes(parseInt(c.room));
      if (isOut && !wasNotLocated) {
        // Client was out/pass/work — show their status, not a check mark
        const lbl = statusLabel[st] || st.toUpperCase();
        const bg  = statusBg[st] || '';
        return '<td class="chk-td" style="background:' + bg + ';font-size:9px;font-weight:700;text-align:center;">' + lbl + '</td>';
      }
      if (wasNotLocated) {
        return '<td class="chk-td" style="background:#fee2e2;color:#991b1b;font-weight:700;text-align:center;font-size:13px;">✗</td>';
      }
      return '<td class="chk-td" style="text-align:center;font-size:13px;color:#15803d;">✓</td>';
    }).join('');

    const rowBg = i % 2 === 1 ? '#f4faf6' : '#fff';
    return '<tr style="background:' + rowBg + ';border-bottom:1px solid #cde0d4;">'
      + '<td class="rm-td">' + esc(c.room) + '</td>'
      + '<td class="name-td">' + esc(c.name) + '</td>'
      + cells
      + '<td class="notes-td"></td>'
      + '</tr>';
  }).join('');

  // Totals row
  const totalCells = checkCols.map(function(col) {
    const notLocCount = col.notLocated.length;
    const accounted = activeClients.length - notLocCount;
    return '<td class="chk-td" style="text-align:center;font-weight:700;font-size:10px;">' + accounted + ' / ' + activeClients.length + '</td>';
  }).join('');

  // Monitor initials row
  const initCells = checkCols.map(function(col) {
    return '<td class="chk-td" style="border-bottom:2px solid #1a3327;text-align:center;height:26px;font-size:9px;font-weight:700;color:#2d6a4f;">' + esc(col.monitor.split(' ')[0]) + '</td>';
  }).join('');

  const colWidth = Math.max(55, Math.min(80, Math.floor(400 / checkCols.length)));

  const winHtml = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
    + '<title>Wellness Check Filing — ' + shift + '</title>'
    + '<style>'
    + '* { box-sizing:border-box; margin:0; padding:0; }'
    + 'body { font-family:Arial,sans-serif; font-size:11px; color:#111; background:#fff; }'
    + '.page-hdr { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2.5px solid #1a3327; padding:16px 20px 8px; }'
    + '.org { font-size:7px; font-weight:700; letter-spacing:.8px; color:#2d6a4f; text-transform:uppercase; margin-bottom:2px; }'
    + '.title { font-size:15px; font-weight:700; color:#1a3327; }'
    + '.sub-title { font-size:9.5px; color:#444; margin-top:2px; }'
    + '.hdr-right { text-align:right; font-size:9.5px; color:#444; line-height:1.85; }'
    + '.hdr-right b { color:#1a3327; }'
    + '.badge { display:inline-block; background:#d1fae5; color:#065f46; font-weight:700; font-size:9px; padding:2px 8px; border-radius:10px; border:1px solid #6ee7b7; }'
    + '.hint { font-size:8px; color:#888; font-style:italic; padding:4px 20px 2px; }'
    + '.wrap { padding:0 20px 10px; }'
    + 'table { width:100%; border-collapse:collapse; }'
    + 'thead { display:table-header-group; } tfoot { display:table-footer-group; }'
    + 'thead tr th { background:#1a3327; color:#fff; padding:6px 7px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.4px; border:1px solid #163825; text-align:left; }'
    + '.rm-td { font-family:monospace; font-weight:700; color:#555; text-align:center; width:42px; padding:4px 6px; }'
    + '.name-td { width:155px; padding:4px 6px; font-weight:500; }'
    + '.chk-th { width:' + colWidth + 'px; text-align:center; border-left:1px solid #245c3a; padding:5px 4px; }'
    + '.chk-td { width:' + colWidth + 'px; border-left:1.5px solid #8dbda0; padding:4px; vertical-align:middle; }'
    + '.notes-td { padding:4px 6px; }'
    + 'td { vertical-align:middle; border-right:1px solid #cde0d4; font-size:11px; }'
    + 'td:last-child { border-right:none; }'
    + 'tfoot tr.sum td { background:#dff0e6; border-top:2px solid #1a3327; font-weight:700; font-size:10px; padding:5px 6px; }'
    + 'tfoot tr.init-row td { background:#f0f7f2; border-top:1px solid #8dbda0; padding:4px; }'
    + '.sig { display:flex; gap:20px; padding:10px 20px 14px; border-top:1.5px solid #999; margin-top:4px; }'
    + '.sig-b { flex:1; font-size:9px; font-weight:700; color:#333; }'
    + '.sig-l { display:inline-block; border-bottom:1px solid #333; width:55%; margin-left:4px; }'
    + '@media print { @page { size:letter portrait; margin:0.35in; } body { font-size:10px; } .wrap { padding:0; } .hint { padding:3px 0 1px; } .sig { padding:8px 0 0; } }'
    + '</style></head><body>'
    + '<div class="page-hdr"><div>'
    + '<div class="org">Positive Directions Equals Change · Westside Community Services</div>'
    + '<div class="title">' + (window.FACILITY_NAME||'ShiftPoint') + ' — Wellness Check Filing Record</div>'
    + '<div class="sub-title">' + esc(shiftLabels[shift] || shift) + '  |  ' + dateStr + '</div>'
    + '</div><div class="hdr-right">'
    + '<b>Monitor on Duty:</b> ' + (esc(mod) || '_______________') + '<br>'
    + '<b>Checks Conducted:</b> ' + checks.length + '<br>'
    + '<b>Active Clients:</b> ' + activeClients.length + ' &nbsp; <span class="badge">FILING COPY</span>'
    + '</div></div>'
    + '<div class="hint">✓ = present &nbsp; ✗ = not located &nbsp; WORK / PASS / OUT / BHC / EFC / HOSP = off-site status</div>'
    + '<div class="wrap"><table>'
    + '<thead><tr><th class="rm-td" style="width:42px;">Rm</th><th style="width:155px;">Client Name</th>' + thCols + '<th class="notes-td">Notes</th></tr></thead>'
    + '<tfoot>'
    + '<tr class="sum"><td colspan="2" style="text-align:left;padding-left:6px;">Total Accounted For:</td>' + totalCells + '<td></td></tr>'
    + '<tr class="init-row"><td colspan="2" style="text-align:right;padding-right:8px;font-size:10px;font-weight:700;">Monitor:</td>' + initCells + '<td></td></tr>'
    + '</tfoot>'
    + '<tbody>' + clientRows + '</tbody>'
    + '</table></div>'
    + '<div class="sig">'
    + '<div class="sig-b">Filed By: <span class="sig-l"></span></div>'
    + '<div class="sig-b">Supervisor Review: <span class="sig-l"></span></div>'
    + '<div class="sig-b">Date Filed: <span class="sig-l"></span></div>'
    + '</div>'
    + '<scr' + 'ipt>window.onload=function(){window.print()};</scr' + 'ipt>'
    + '</body></html>';

  const win = window.open('', '_blank');
  if (win) { win.document.write(winHtml); win.document.close(); }
  else { alert('Please allow pop-ups to print.'); }
}

// ── File Building Walkthroughs (filled filing copy) ────────────
function fileWalkthroughs() {
  const shift   = document.getElementById('meta-shift').value;
  const dateVal = document.getElementById('meta-date').value;
  const mod     = document.getElementById('meta-mod').value;
  const dateStr = dateVal
    ? new Date(dateVal + 'T12:00:00').toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric', year:'numeric'})
    : new Date().toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric', year:'numeric'});

  const shiftLabels = {
    'Day Shift':       'Day Shift (7:00 a.m. – 3:30 p.m.)',
    'Swing Shift':     'Swing Shift (3:00 p.m. – 11:30 p.m.)',
    'Graveyard Shift': 'Graveyard Shift (11:00 p.m. – 7:30 a.m.)',
  };

  // Parse walkthrough entries from the activity log
  const walks = logEntries.filter(e => e.text && e.text.toLowerCase().includes('walkthrough'));

  if (walks.length === 0) {
    alert('No building walkthroughs found in the activity log for this shift.');
    return;
  }

  const rows = walks.map((e, i) => {
    // Extract monitor name: "conducted by [name]"
    const byMatch = e.text.match(/conducted(?:\s+by\s+(.+?))?[.\-,]/i);
    const monitor = byMatch && byMatch[1] ? byMatch[1].trim() : (mod || '—');

    // Extract area if present: "walkthrough conducted — [Area] by [name]"
    const areaMatch = e.text.match(/—\s*([^b][^\s][^.]+?)\s+by\s/i);
    const area = areaMatch ? areaMatch[1].trim() : 'Full Building';

    // Result / notes: everything after the first period
    const dotIdx = e.text.indexOf('. ');
    const notes = dotIdx > -1 ? e.text.slice(dotIdx + 2) : e.text;

    const hasIssue = !e.text.toLowerCase().includes('all is well') && !e.text.toLowerCase().includes('nothing to report');
    const rowBg = hasIssue ? 'background:#fef9c3;' : (i % 2 === 1 ? 'background:#f4faf6;' : '');

    return '<tr style="' + rowBg + 'border-bottom:1px solid #cde0d4;">'
      + '<td style="padding:6px 8px;font-weight:700;font-family:monospace;color:#1a3327;white-space:nowrap;">' + esc(e.time) + '</td>'
      + '<td style="padding:6px 8px;font-weight:600;color:#2d6a4f;">' + esc(monitor) + '</td>'
      + '<td style="padding:6px 8px;color:#555;">' + esc(area) + '</td>'
      + '<td style="padding:6px 8px;">' + esc(notes) + '</td>'
      + '</tr>';
  }).join('');

  const html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
    + '<title>Building Walkthrough Filing — ' + shift + '</title>'
    + '<style>'
    + '* { box-sizing:border-box; margin:0; padding:0; }'
    + 'body { font-family:Arial,sans-serif; font-size:11px; color:#111; background:#fff; }'
    + '.page-hdr { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2.5px solid #1a3327; padding:16px 20px 10px; }'
    + '.org { font-size:7px; font-weight:700; letter-spacing:.8px; color:#2d6a4f; text-transform:uppercase; margin-bottom:3px; }'
    + '.title { font-size:16px; font-weight:700; color:#1a3327; }'
    + '.sub-title { font-size:9.5px; color:#444; margin-top:3px; }'
    + '.hdr-right { text-align:right; font-size:9.5px; color:#444; line-height:2; }'
    + '.hdr-right b { color:#1a3327; }'
    + '.badge { display:inline-block; background:#dbeafe; color:#1e40af; font-weight:700; font-size:9px; padding:2px 8px; border-radius:10px; border:1px solid #93c5fd; }'
    + '.wrap { padding:12px 20px; }'
    + 'table { width:100%; border-collapse:collapse; }'
    + 'thead th { background:#1a3327; color:#fff; padding:7px 8px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.4px; text-align:left; }'
    + '.summary { margin:14px 20px 0; padding:10px 14px; background:#f4faf6; border:1px solid #cde0d4; border-radius:6px; font-size:10px; color:#333; }'
    + '.sig { display:flex; gap:24px; padding:16px 20px 18px; border-top:1.5px solid #999; margin-top:10px; }'
    + '.sig-b { flex:1; font-size:9.5px; font-weight:700; color:#333; }'
    + '.sig-l { display:inline-block; border-bottom:1px solid #333; width:55%; margin-left:4px; }'
    + '@media print { @page { size:letter portrait; margin:0.4in; } .wrap { padding:0; } .sig { padding:12px 0 0; } .summary { margin:12px 0 0; } }'
    + '</style></head><body>'
    + '<div class="page-hdr">'
    + '<div>'
    + '<div class="org">Positive Directions Equals Change · Westside Community Services</div>'
    + '<div class="title">' + (window.FACILITY_NAME||'ShiftPoint') + ' — Building Walkthrough Filing Record</div>'
    + '<div class="sub-title">' + esc(shiftLabels[shift] || shift) + ' &nbsp;|&nbsp; ' + dateStr + '</div>'
    + '</div>'
    + '<div class="hdr-right">'
    + '<b>Monitor on Duty:</b> ' + (esc(mod) || '_______________') + '<br>'
    + '<b>Total Walkthroughs:</b> ' + walks.length + '<br>'
    + '<span class="badge">FILING COPY</span>'
    + '</div>'
    + '</div>'
    + '<div class="wrap">'
    + '<table>'
    + '<thead><tr><th style="width:80px;">Time</th><th style="width:150px;">Conducted By</th><th style="width:130px;">Area</th><th>Notes / Findings</th></tr></thead>'
    + '<tbody>' + rows + '</tbody>'
    + '</table>'
    + '</div>'
    + '<div class="summary">'
    + '<strong>Summary:</strong> &nbsp; ' + walks.length + ' walkthrough(s) conducted this shift.'
    + '</div>'
    + '<div class="sig">'
    + '<div class="sig-b">Filed By: <span class="sig-l"></span></div>'
    + '<div class="sig-b">Supervisor Review: <span class="sig-l"></span></div>'
    + '<div class="sig-b">Date Filed: <span class="sig-l"></span></div>'
    + '</div>'
    + '<scr' + 'ipt>window.onload=function(){window.print()};</scr' + 'ipt>'
    + '</body></html>';

  const win = window.open('', '_blank');
  if (win) { win.document.write(html); win.document.close(); }
  else { alert('Please allow pop-ups to print.'); }
}

// ── UA Report Filing ──────────────────────────────────────────
function fileUAReport(targetWin) {
  const facilityName = window.FACILITY_NAME || 'ShiftPoint';

  // Gather ALL UA entries across all reports + current shift
  const allUAs = [];

  function parseUAEntry(entry, reportMeta) {
    if (!entry.text || !entry.text.toLowerCase().startsWith('ua conducted on')) return null;
    const m = entry.text.match(/UA conducted on (.+?) \(Rm\. (.+?)\) by (.+?)\. Reason: (.+?)\. Results: (.+?)\.?$/i);
    if (!m) return null;
    return {
      date:    reportMeta.date || '',
      shift:   reportMeta.shift || '',
      time:    entry.time || '',
      name:    m[1],
      room:    m[2],
      staff:   m[3],
      reason:  m[4],
      results: m[5],
    };
  }

  // Current shift
  const curDate  = (document.getElementById('meta-date')||{}).value || '';
  const curShift = (document.getElementById('meta-shift')||{}).value || '';
  logEntries.forEach(function(e){
    const ua = parseUAEntry(e, {date:curDate, shift:curShift});
    if (ua) allUAs.push(ua);
  });

  // Archived reports
  (REPORTS||[]).forEach(function(r){
    (r.log_entries||[]).forEach(function(e){
      const ua = parseUAEntry(e, {date:r.report_date||'', shift:r.shift||''});
      if (ua) allUAs.push(ua);
    });
  });

  // Sort by date desc, then time desc by default
  allUAs.sort(function(a,b){
    const dc = (b.date||'').localeCompare(a.date||'');
    if (dc !== 0) return dc;
    return (b.time||'').localeCompare(a.time||'');
  });

  const substances = [
    {code:'ETG', full:'Alcohol'},
    {code:'THC', full:'Marijuana'},
    {code:'K2',  full:'Spice'},
    {code:'FEN', full:'Fentanyl'},
    {code:'AMP', full:'Amphetamines'},
    {code:'MDMA',full:'Ecstasy'},
    {code:'MET', full:'Meth'},
    {code:'PCP', full:'PCP'},
    {code:'MOR', full:'Morphine'},
    {code:'OXY', full:'Oxycodone'},
    {code:'OPI', full:'Opiates'},
    {code:'BZO', full:'Benzos'},
    {code:'MTD', full:'Methadone'},
    {code:'BUP', full:'Buprenorphine'},
    {code:'COC', full:'Cocaine'},
  ];

  function getSubResult(resultsStr, code) {
    if (!resultsStr) return '';
    // New format: "POS: THC, COC | NEG: ETG | NT: K2"
    const posMatch = resultsStr.match(/POS:\s*([^|]+)/i);
    const negMatch = resultsStr.match(/NEG:\s*([^|]+)/i);
    const ntMatch  = resultsStr.match(/NT:\s*([^|]+)/i);
    const inList   = function(match){ return match && match[1].split(/,\s*/).map(function(c){return c.trim().toUpperCase();}).indexOf(code.toUpperCase()) !== -1; };
    if (inList(posMatch)) return 'POS';
    if (inList(negMatch)) return 'NEG';
    if (inList(ntMatch))  return 'NT';
    // Legacy: plain "Negative"/"Positive"
    const r = resultsStr.toLowerCase();
    if (r === 'negative' || r === 'neg') return 'NEG';
    if (r === 'positive' || r === 'pos') return 'POS';
    return '';
  }

  const subCols = substances.map(function(sub){
    return '<th class="sortable" data-col="sub_'+sub.code+'" style="cursor:pointer;white-space:nowrap;padding:7px 8px;">'+sub.code+'<br><span style="font-size:.55rem;font-weight:400;opacity:.7;">'+sub.full+'</span></th>';
  }).join('');

  function rowHtml(ua, ri) {
    const subCells = substances.map(function(sub){
      const v = getSubResult(ua.results, sub.code);
      const bg = v==='POS'?'#FEE2E2':v==='NEG'?'#D8F3DC':v==='NT'?'#F1F5F9':'';
      const col= v==='POS'?'#991B1B':v==='NEG'?'#15803D':v==='NT'?'#94A3B8':'#D1D5DB';
      const txt= v||'—';
      return '<td style="text-align:center;padding:4px 6px;font-size:.75rem;font-weight:700;color:'+col+';background:'+bg+';">'+txt+'</td>';
    }).join('');
    const fmtDate = ua.date ? new Date(ua.date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
    return '<tr data-ri="'+ri+'" style="border-bottom:1px solid #E2E8F0;'+(ri%2===0?'background:#F4FAF6':'background:#fff')+'">'
      +'<td style="padding:6px 10px;font-size:.8rem;white-space:nowrap;">'+fmtDate+'</td>'
      +'<td style="padding:6px 10px;font-size:.78rem;color:#4B5563;white-space:nowrap;">'+esc(ua.shift.replace(' Shift',''))+'</td>'
      +'<td style="padding:6px 10px;font-family:monospace;font-size:.8rem;color:#2D6A4F;white-space:nowrap;">'+esc(ua.time)+'</td>'
      +'<td style="padding:6px 10px;font-weight:700;">'+esc(ua.name)+'</td>'
      +'<td style="padding:6px 10px;font-family:monospace;font-size:.8rem;text-align:center;">'+esc(ua.room)+'</td>'
      +'<td style="padding:6px 10px;font-size:.82rem;color:#4B5563;">'+esc(ua.staff)+'</td>'
      +'<td style="padding:6px 10px;font-size:.82rem;color:#4B5563;">'+esc(ua.reason)+'</td>'
      +subCells
      +'</tr>';
  }

  const initialRows = allUAs.map(function(ua,i){return rowHtml(ua,i);}).join('');

  const html = '<!DOCTYPE html><html lang="en"><head>'
    +'<meta charset="UTF-8">'
    +'<title>'+facilityName+' \u2014 UA Report</title>'
    +'<style>'
    +'*{box-sizing:border-box;margin:0;padding:0;}'
    +'body{font-family:Calibri,"Segoe UI",sans-serif;background:#F4F6F8;color:#0F172A;font-size:13px;}'
    +'.topbar{background:#1A3327;color:#fff;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #D4A017;}'
    +'.topbar h1{font-size:1rem;font-weight:800;letter-spacing:.02em;}'
    +'.topbar .sub{font-size:.65rem;color:#A8D5B5;margin-top:1px;letter-spacing:.08em;text-transform:uppercase;}'
    +'.toolbar{background:#fff;border-bottom:1px solid #D4E6DA;padding:10px 20px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;}'
    +'.toolbar input,.toolbar select{padding:7px 10px;border:1.5px solid #D4E6DA;border-radius:7px;font-size:.84rem;font-family:inherit;outline:none;}'
    +'.toolbar input:focus,.toolbar select:focus{border-color:#2D6A4F;}'
    +'.btn{padding:7px 14px;border:none;border-radius:7px;font-size:.82rem;font-weight:700;cursor:pointer;font-family:inherit;}'
    +'.btn-green{background:#2D6A4F;color:#fff;} .btn-green:hover{background:#1A5C42;}'
    +'.btn-outline{background:#fff;color:#2D6A4F;border:1.5px solid #D4E6DA;} .btn-outline:hover{border-color:#2D6A4F;}'
    +'.count{font-size:.8rem;color:#64748B;margin-left:auto;}'
    +'.table-wrap{overflow-x:auto;margin:0;}'
    +'table{width:100%;border-collapse:collapse;background:#fff;font-size:.85rem;}'
    +'thead th{background:#1A3327;color:#A8D5B5;font-size:.65rem;font-weight:700;padding:9px 10px;text-align:left;letter-spacing:.07em;white-space:nowrap;position:sticky;top:0;z-index:1;}'
    +'thead th.sortable{cursor:pointer;user-select:none;}'
    +'thead th.sortable:hover{color:#D4A017;}'
    +'thead th.asc::after{content:" \u2191";color:#D4A017;}'
    +'thead th.desc::after{content:" \u2193";color:#D4A017;}'
    +'tbody tr:hover{filter:brightness(.96);}'
    +'.summary{background:#1A3327;color:#A8D5B5;padding:8px 20px;font-size:.78rem;display:flex;gap:24px;flex-wrap:wrap;}'
    +'.summary strong{color:#D4A017;}'
    +'@media print{'
    +'.topbar,.toolbar,.summary{-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
    +'body{background:#fff;}'
    +'thead th{-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
    +'tbody tr{background:#fff!important;}'
    +'tbody tr:nth-child(even){background:#F4FAF6!important;}'
    +'td[style*="FEE2E2"]{-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
    +'td[style*="D8F3DC"]{-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
    +'}'
    +'</style></head><body>'

    +'<div class="topbar"><div><div class="topbar-title" style="font-size:1rem;font-weight:800;">'+facilityName+' \u2014 UA Log Report</div><div class="sub">Positive Directions Equals Change &nbsp;&middot;&nbsp; Westside Community Services</div></div>'
    +'<button class="btn btn-green" onclick="window.print()" style="background:#D4A017;color:#1A3327;">&#128424; Print / Save PDF</button></div>'

    +'<div class="toolbar">'
    +'<input type="text" id="f-client" placeholder="Filter by client..." oninput="applyFilters()">'
    +'<select id="f-shift" onchange="applyFilters()"><option value="">All Shifts</option><option>Day Shift</option><option>Swing Shift</option><option>Graveyard Shift</option></select>'
    +'<select id="f-reason" onchange="applyFilters()"><option value="">All Reasons</option><option>Random</option><option>Return from Pass</option><option>Suspicion</option><option>CM Request</option><option>Other</option></select>'
    +'<select id="f-result" onchange="applyFilters()"><option value="">Any Result</option><option value="has_pos">Has Positive</option><option value="all_neg">All Negative</option></select>'
    +'<input type="date" id="f-from" onchange="applyFilters()" title="From date">'
    +'<input type="date" id="f-to" onchange="applyFilters()" title="To date">'
    +'<button class="btn btn-outline" onclick="clearFilters()">Clear</button>'
    +'<span class="count" id="row-count"></span>'
    +'</div>'

    +'<div class="summary" id="summary-bar"></div>'

    +'<div class="table-wrap"><table>'
    +'<thead><tr>'
    +'<th class="sortable" data-col="date">DATE</th>'
    +'<th class="sortable" data-col="shift">SHIFT</th>'
    +'<th class="sortable" data-col="time">TIME</th>'
    +'<th class="sortable" data-col="name">CLIENT</th>'
    +'<th class="sortable" data-col="room" style="text-align:center;">RM</th>'
    +'<th class="sortable" data-col="staff">STAFF</th>'
    +'<th class="sortable" data-col="reason">REASON</th>'
    +subCols
    +'</tr></thead>'
    +'<tbody id="ua-tbody">'+initialRows+'</tbody>'
    +'</table></div>'

    +'<script>'
    +'var ALL_UAS = '+JSON.stringify(allUAs)+';\n'
    +'var SUBSTANCES = '+JSON.stringify(substances)+';\n'
    +'var sortCol = "date", sortDir = -1;\n'
    +'\n'
    +'function getSubResult(resultsStr, code) {\n'
    +'  if (!resultsStr) return "";\n'
    +'  var posMatch = resultsStr.match(/POS:\\s*([^|]+)/i);\n'
    +'  var negMatch = resultsStr.match(/NEG:\\s*([^|]+)/i);\n'
    +'  var ntMatch  = resultsStr.match(/NT:\\s*([^|]+)/i);\n'
    +'  function inList(m){ return m && m[1].split(/,\\s*/).map(function(c){return c.trim().toUpperCase();}).indexOf(code.toUpperCase())!==-1; }\n'
    +'  if (inList(posMatch)) return "POS";\n'
    +'  if (inList(negMatch)) return "NEG";\n'
    +'  if (inList(ntMatch))  return "NT";\n'
    +'  var r = resultsStr.toLowerCase();\n'
    +'  if (r==="negative"||r==="neg") return "NEG";\n'
    +'  if (r==="positive"||r==="pos") return "POS";\n'
    +'  return "";\n'
    +'}\n'
    +'\n'
    +'function hasPos(ua){ return SUBSTANCES.some(function(s){return getSubResult(ua.results,s.code)==="POS";}); }\n'
    +'function allNeg(ua){ return SUBSTANCES.every(function(s){var v=getSubResult(ua.results,s.code);return v===""||v==="NEG"||v==="NT";}); }\n'
    +'\n'
    +'function applyFilters() {\n'
    +'  var fc = (document.getElementById("f-client").value||"").toLowerCase();\n'
    +'  var fs = document.getElementById("f-shift").value;\n'
    +'  var fr = document.getElementById("f-reason").value;\n'
    +'  var ff = document.getElementById("f-result").value;\n'
    +'  var fd = document.getElementById("f-from").value;\n'
    +'  var ft = document.getElementById("f-to").value;\n'
    +'  var filtered = ALL_UAS.filter(function(ua){\n'
    +'    if (fc && ua.name.toLowerCase().indexOf(fc)===-1 && ua.room.toLowerCase().indexOf(fc)===-1) return false;\n'
    +'    if (fs && ua.shift !== fs) return false;\n'
    +'    if (fr && ua.reason.indexOf(fr)===-1) return false;\n'
    +'    if (ff==="has_pos" && !hasPos(ua)) return false;\n'
    +'    if (ff==="all_neg" && !allNeg(ua)) return false;\n'
    +'    if (fd && ua.date < fd) return false;\n'
    +'    if (ft && ua.date > ft) return false;\n'
    +'    return true;\n'
    +'  });\n'
    +'  filtered.sort(function(a,b){\n'
    +'    var av = sortCol.startsWith("sub_") ? getSubResult(a.results,sortCol.slice(4)) : (a[sortCol]||"");\n'
    +'    var bv = sortCol.startsWith("sub_") ? getSubResult(b.results,sortCol.slice(4)) : (b[sortCol]||"");\n'
    +'    return av < bv ? sortDir : av > bv ? -sortDir : 0;\n'
    +'  });\n'
    +'  var tbody = document.getElementById("ua-tbody");\n'
    +'  tbody.innerHTML = filtered.length ? filtered.map(function(ua,i){ return buildRow(ua,i); }).join("") : "<tr><td colspan=\\"'+(7+substances.length)+'\\" style=\\"text-align:center;padding:28px;color:#94A3B8;font-style:italic;\\">No matching UA records.</td></tr>";\n'
    +'  document.getElementById("row-count").textContent = filtered.length + " record" + (filtered.length!==1?"s":"");\n'
    +'  updateSummary(filtered);\n'
    +'}\n'
    +'\n'
    +'function buildRow(ua,ri) {\n'
    +'  var subCells = SUBSTANCES.map(function(sub){\n'
    +'    var v = getSubResult(ua.results,sub.code);\n'
    +'    var bg = v==="POS"?"#FEE2E2":v==="NEG"?"#D8F3DC":v==="NT"?"#F1F5F9":"";\n'
    +'    var col= v==="POS"?"#991B1B":v==="NEG"?"#15803D":v==="NT"?"#94A3B8":"#D1D5DB";\n'
    +'    return "<td style=\\"text-align:center;padding:4px 6px;font-size:.75rem;font-weight:700;color:"+col+";background:"+bg+";\\">"+(v||"\u2014")+"</td>";\n'
    +'  }).join("");\n'
    +'  var fd = ua.date ? new Date(ua.date+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "\u2014";\n'
    +'  return "<tr style=\\"border-bottom:1px solid #E2E8F0;background:"+(ri%2===0?"#F4FAF6":"#fff")+";\\">"'
    +'    +"<td style=\\"padding:6px 10px;font-size:.8rem;white-space:nowrap;\\">"+fd+"</td>"'
    +'    +"<td style=\\"padding:6px 10px;font-size:.78rem;color:#4B5563;white-space:nowrap;\\">"+ua.shift.replace(" Shift","")+"</td>"'
    +'    +"<td style=\\"padding:6px 10px;font-family:monospace;font-size:.8rem;color:#2D6A4F;white-space:nowrap;\\">"+ua.time+"</td>"'
    +'    +"<td style=\\"padding:6px 10px;font-weight:700;\\">"+ua.name+"</td>"'
    +'    +"<td style=\\"padding:6px 10px;font-family:monospace;font-size:.8rem;text-align:center;\\">"+ua.room+"</td>"'
    +'    +"<td style=\\"padding:6px 10px;font-size:.82rem;color:#4B5563;\\">"+ua.staff+"</td>"'
    +'    +"<td style=\\"padding:6px 10px;font-size:.82rem;color:#4B5563;\\">"+ua.reason+"</td>"'
    +'    +subCells+"</tr>";\n'
    +'}\n'
    +'\n'
    +'function updateSummary(rows) {\n'
    +'  var total = rows.length;\n'
    +'  var withPos = rows.filter(hasPos).length;\n'
    +'  var perSub = SUBSTANCES.map(function(s){\n'
    +'    var n = rows.filter(function(ua){return getSubResult(ua.results,s.code)==="POS";}).length;\n'
    +'    return n>0 ? "<strong>"+s.code+":</strong> "+n+" POS" : null;\n'
    +'  }).filter(Boolean).join(" &nbsp;&bull;&nbsp; ");\n'
    +'  document.getElementById("summary-bar").innerHTML = "<span>Total UAs: <strong>"+total+"</strong></span>"'
    +'    +(withPos ? "<span>Positives: <strong>"+withPos+"</strong></span>" : "")'
    +'    +(perSub ? "<span style=\\"font-size:.75rem;\\">"+perSub+"</span>" : "");\n'
    +'}\n'
    +'\n'
    +'function clearFilters() {\n'
    +'  ["f-client","f-shift","f-reason","f-result"].forEach(function(id){document.getElementById(id).value="";});\n'
    +'  document.getElementById("f-from").value="";\n'
    +'  document.getElementById("f-to").value="";\n'
    +'  applyFilters();\n'
    +'}\n'
    +'\n'
    +'document.querySelectorAll("thead th.sortable").forEach(function(th){\n'
    +'  th.addEventListener("click",function(){\n'
    +'    var col = this.dataset.col;\n'
    +'    if (sortCol===col) sortDir*=-1; else { sortCol=col; sortDir=1; }\n'
    +'    document.querySelectorAll("thead th").forEach(function(t){t.classList.remove("asc","desc");});\n'
    +'    this.classList.add(sortDir===1?"asc":"desc");\n'
    +'    applyFilters();\n'
    +'  });\n'
    +'});\n'
    +'\n'
    +'applyFilters();\n'
    +'<\/script></body></html>';

  var win = targetWin || window.open('','_blank');
  win.document.write(html);
  win.document.close();
  win.document.title = facilityName + ' \u2014 UA Report';
}
