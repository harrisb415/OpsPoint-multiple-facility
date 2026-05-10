// ── Server sync module ────────────────────────────────────────
// Loaded by index.html between app.js and sheets.js.
// When opened via file://, does nothing.
// When served via HTTP, overrides storage functions to use the
// server API and connects WebSocket for live updates.

(function() {
  if (location.protocol === 'file:') return; // file:// mode — do nothing

  // ── WebSocket ───────────────────────────────────────────────
  var ws = null;
  var wsTimer = null;
  var _restarting = false;

  function connectWS() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host);

    ws.onopen = function() {
      clearTimeout(wsTimer);
      if (_restarting) {
        _restarting = false;
        setSaveMsg('Server restarted \u2713', 'saved');
        setTimeout(function(){ setSaveMsg('Live \u2022 Auto-save on', 'saved'); }, 2500);
        serverLoad(); // reload data after restart
      } else {
        setSaveMsg('Live \u2022 Auto-save on', 'saved');
      }
    };

    ws.onclose = function() {
      setSaveMsg(_restarting ? 'Server restarting\u2026 reconnecting' : 'Reconnecting\u2026', 'err');
      wsTimer = setTimeout(connectWS, 3000);
    };

    ws.onmessage = function(ev) {
      try {
        var msg = JSON.parse(ev.data);
        if (msg.type === 'data_saved') {
          serverLoad();
        } else if (msg.type === 'staff_updated') {
          fetch('/api/staff').then(function(r){ return r.json(); }).then(function(d){
            window.STAFF = d;
            var tab = document.getElementById('tab-staff');
            if (tab && tab.classList.contains('active')) renderStaffTab();
          }).catch(function(){});
        } else if (msg.type === 'passes_updated') {
          fetch('/api/passes').then(function(r){ return r.json(); }).then(function(d){
            window.PASSES = d;
            var tab = document.getElementById('tab-passes');
            if (tab && tab.classList.contains('active')) renderPassesTab();
          }).catch(function(){});
        } else if (msg.type === 'pass_notice_updated') {
          window.PASS_NOTICE = msg.notice || '';
          var tab = document.getElementById('tab-passes');
          if (tab && tab.classList.contains('active')) renderPassesTab();
        } else if (msg.type === 'chore_log_updated') {
          // Handled inline — chore log reloads on tab switch
        } else if (msg.type === 'patched' && msg.patch) {
          var applied = applyPatch(msg.patch);
          if (!applied) serverLoad();
        } else if (msg.type === 'settings_updated' && msg.settings) {
          if (typeof applySettings === 'function') applySettings(msg.settings);
          var n = msg.settings.facility_name;
          if (n) {
            var fnel=document.getElementById('facility-name-header');if(fnel)fnel.textContent=n;
            document.title = n + ' — Shift Report';
            window.FACILITY_NAME = n;
            try{FACILITY_NAME=n;}catch(e2){}
          }
          if (typeof checkReminders === 'function') checkReminders();
        } else if (msg.type === 'ua_request') {
          showUABanner(msg.requests || []);
        } else if (msg.type === 'mail_updated') {
          var mailTab = document.getElementById('tab-mail');
          if (mailTab && mailTab.classList.contains('active')) loadMailLog();
        } else if (msg.type === 'permissions_updated') {
          // If the change affects this session's user, reload to get fresh permissions
          if (window.SESSION && msg.userId === window.SESSION.id) {
            location.reload();
          }
        } else if (msg.type === 'user_deleted') {
          // If this user's account was deleted, kick them to login immediately
          if (window.SESSION && msg.userId === window.SESSION.id) {
            location.replace('/login');
          }
        } else if (msg.type === 'server_restarting') {
          _restarting = true;
          setSaveMsg('Server restarting… reconnecting shortly', 'err');
        }
      } catch(e) {}
    };
  }

  // ── Apply a live patch from mobile ─────────────────────────
  function applyPatch(p) {
    // Use loose equality — JSON may send reportId as string or number
    var rpt = REPORTS.find(function(r){ return r.id == p.reportId; });
    if (!rpt) return false;
    var isCurrent = (currentReportId == p.reportId);
    if (p.statuses) {
      rpt.statuses = rpt.statuses || {};
      Object.assign(rpt.statuses, p.statuses);
      if (isCurrent) Object.assign(shiftStatuses, p.statuses);
    }
    if (p.log_entry) {
      rpt.log_entries = rpt.log_entries || [];
      rpt.log_entries.push(p.log_entry);
      rpt.log_entries.sort(function(a,b){ return toMins(a.time)-toMins(b.time); });
      // Also push to logEntries — the working copy renderLog() reads from
      if (isCurrent) {
        logEntries.push(p.log_entry);
        logEntries.sort(function(a,b){ return toMins(a.time)-toMins(b.time); });
        renderLog();
      }
    }
    if (isCurrent) {
      updateCensus();
      buildRoster();
    }
    setSaveMsg('Live update \u2713', 'saved');
    setTimeout(function(){ setSaveMsg('Live \u2022 Auto-save on','saved'); }, 2000);
    return true;
  }

  function toMins(t) {
    if (!t) return 0;
    var m = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!m) return 0;
    var h=parseInt(m[1]), mn=parseInt(m[2]), ap=m[3].toUpperCase();
    if (ap==='AM' && h===12) h=0;
    if (ap==='PM' && h!==12) h+=12;
    return h*60+mn;
  }

  // ── Server API calls ────────────────────────────────────────
  async function serverLoad() {
    try {
      var res  = await fetch('/api/data', {credentials:'include'});
      if (!res.ok) { setSaveMsg('Load error (' + res.status + ')', 'err'); return; }
      var data = await res.json();
      if (data.clients) CLIENTS = data.clients;
      // Merge reports — never let a server reload shrink the in-memory list
      if (data.reports) {
        data.reports.forEach(function(r) {
          var idx = REPORTS.findIndex(function(x){ return x.id === r.id; });
          if (idx >= 0) {
            // Update only if server version is newer or same
            if (!REPORTS[idx].updated_at || r.updated_at >= REPORTS[idx].updated_at) {
              REPORTS[idx] = r;
            }
          } else {
            REPORTS.push(r);
          }
        });
      }
      if (data.logos) {
        // Only accept data URIs from server — never store raw paths (stale from old versions)
        if (data.logos.pdec && data.logos.pdec.startsWith('data:')) { LOGOS.pdec = data.logos.pdec; applyLogo('pdec'); }
        if (data.logos.wcs  && data.logos.wcs.startsWith('data:'))  { LOGOS.wcs  = data.logos.wcs;  applyLogo('wcs');  }
      }
      // Re-apply settings from server data
      if (typeof applySettings === 'function') {
        applySettings({
          walk_areas: data.walk_areas,
          wellness_interval_mins: data.wellness_interval_mins,
          walk_interval_mins: data.walk_interval_mins,
        });
      }
      nextClientId = (CLIENTS.reduce(function(m,c){ return Math.max(m,c.id); },0)||99)+1;
      nextReportId = (REPORTS.reduce(function(m,r){ return Math.max(m,r.id); },0)||0)+1;
      // Load extended module data
      if (data.staff)            window.STAFF            = data.staff;
      if (data.passes)           window.PASSES           = data.passes;
      if (data.master_chores)    window.MASTER_CHORES    = data.master_chores;
      if (data.pass_notice !== undefined) window.PASS_NOTICE = data.pass_notice;
      if (data.staff_categories) window.STAFF_CATEGORIES = data.staff_categories;
      // After init, sync in-memory report state from freshly-loaded REPORTS so
      // renderLog/renderIssues/renderMedNotes see the latest data, not stale globals.
      if (window._syncInitDone && currentReportId) {
        var _fr = REPORTS.find(function(r){ return r.id === currentReportId; });
        if (_fr) {
          logEntries.length = 0;
          (_fr.log_entries || []).forEach(function(e){ logEntries.push(e); });
          issues.length = 0;
          (_fr.issues || []).forEach(function(i){ issues.push(i); });
          medNotes.length = 0;
          (Array.isArray(_fr.med_notes) ? _fr.med_notes :
           Array.isArray(_fr.med_clients) ? _fr.med_clients :
           (_fr.med_clients ? [_fr.med_clients] : [])).forEach(function(n){ medNotes.push(n); });
          shiftStatuses      = Object.assign({}, _fr.statuses       || {});
          shiftComments      = Object.assign({}, _fr.comments       || {});
          shiftLastUA        = Object.assign({}, _fr.last_ua        || {});
          shiftLastRoomSearch= Object.assign({}, _fr.last_room_search|| {});
        }
      }
      buildRoster(); renderLog(); renderIssues(); renderMedNotes(); updateCensus();
      // Load pending UA requests and show banner if any
      fetch('/api/ua-requests', {credentials:'include'}).then(function(r){ return r.json(); }).then(function(list){
        showUABanner(list||[]);
      }).catch(function(){});
      // On every page load: always load the most recently CREATED open report.
      // Falls back to most recent closed report if no open reports exist.
      if (!window._syncInitDone && REPORTS.length > 0) {
        var openReports = REPORTS.filter(function(r){ return !r.is_closed; });
        var pool = openReports.length > 0 ? openReports : REPORTS;
        var latest = pool.slice().sort(function(a,b){
          return (b.created_at||b.updated_at||'').localeCompare(a.created_at||a.updated_at||'');
        })[0];
        if (latest) {
          applyReportToUI(latest);
          buildRoster(); renderLog(); renderIssues(); renderMedNotes();
        }
      }
      window._syncInitDone = true;
      // First run: server has clients but no reports yet — auto-save
      if (CLIENTS.length > 0 && REPORTS.length === 0) {
        setTimeout(function() { scheduleSave(); }, 3000);
      }
    } catch(e) {
      setSaveMsg('Server error — is server running?', 'err');
    }
  }

  async function serverSave(data) {
    try {
      var r = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
      });
      if (!r.ok) {
        setSaveMsg('Save failed (' + r.status + ') — check login', 'err');
        return false;
      }
      return true;
    } catch(e) {
      setSaveMsg('Save error — server unreachable', 'err');
      return false;
    }
  }

  // ── Override storage functions ──────────────────────────────
  // tryRestoreHandle: tell init that "restoration" succeeded so it
  // calls loadData() (overridden below) and shows "Auto-save on"
  window.tryRestoreHandle = async function() {
    connectWS();   // start WebSocket now
    return true;   // triggers the if(restored) branch in init
  };

  // loadData: fetch from server instead of File System API
  window.loadData = serverLoad;

  // writeJsonData: POST to server
  window.writeJsonData = async function(data) {
    await serverSave(data);
  };

  // doSave: override to bypass the dirHandle check and save to server instead
  window.doSave = async function() {
    const p = buildPayload();
    localStorage.setItem('sp_draft', JSON.stringify(p));
    // Track the active report ID for archive navigation
    if (currentReportId) window._currentActiveId = currentReportId;
    // Add/update in REPORTS
    if (currentReportId) {
      const i = REPORTS.findIndex(function(r){ return r.id === currentReportId; });
      if (i >= 0) REPORTS[i] = p; else REPORTS.push(p);
    } else {
      currentReportId = nextReportId++;
      p.id = currentReportId;
      p.created_at = p.updated_at;
      REPORTS.push(p);
      var lbl = document.getElementById('report-id-label');
      if (lbl) lbl.textContent = 'Report #' + currentReportId;
    }
    await serverSave({ clients: CLIENTS, reports: REPORTS, logos: LOGOS, active_report_id: currentReportId });
    // Sync logEntries IDs from server after every save — fixes photo button and prevents UA deletion
    try {
      var syncRes = await fetch('/api/data', {credentials:'include'});
      var syncData = await syncRes.json();
      if (syncData.reports && currentReportId) {
        var syncRpt = syncData.reports.find(function(r){ return r.id === currentReportId; });
        if (syncRpt && syncRpt.log_entries) {
          syncRpt.log_entries.forEach(function(se) {
            var local = logEntries.find(function(e){
              return !e.id && e.time === se.time && e.text === se.text;
            });
            if (local) { local.id = se.id; if (se.ua_photo) local.ua_photo = se.ua_photo; }
          });
          renderLog();
        }
      }
    } catch(ignoreErr) {}
    setSaveMsg('Live • Saved', 'saved');
    setTimeout(function(){ setSaveMsg('Live • Auto-save on', 'saved'); }, 2000);
  };

  // writeDocxFile: no-op — docx downloads directly in server mode
  window.writeDocxFile = async function() {};

  // saveLogos: POST full state including logos
  window.saveLogos = async function() {
    await serverSave({ clients: CLIENTS, reports: REPORTS, logos: LOGOS });
    setSaveMsg('Logos saved', 'saved');
    setTimeout(function(){ setSaveMsg('Live \u2022 Auto-save on','saved'); }, 2000);
  };

  // renderArchive: override to remove dirHandle check, with role-based controls
  window.renderArchive = function() {
    var el = document.getElementById('report-list');
    if (!el) return;
    var isSup = window.SESSION && (window.SESSION.role === 'supervisor' || window.SESSION.role === 'admin');
    var sorted = REPORTS.slice().sort(function(a,b){
      return (b.report_date||'').localeCompare(a.report_date||'') ||
             (b.updated_at||'').localeCompare(a.updated_at||'');
    });
    if (!sorted.length) {
      el.innerHTML = '<div class="empty-state">No saved reports yet. Fill in the Current Report tab and it will appear here.</div>';
      return;
    }
    el.innerHTML = '';
    sorted.forEach(function(r) {
      var tot = CLIENTS.filter(function(c){return c.is_active&&!c.is_special&&c.name!=='VACANT';}).length || '—';
      // Format timestamps
      function fmtTs(ts) {
        if (!ts) return null;
        var d = new Date(ts);
        return d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
      }
      var createdTime = fmtTs(r.created_at);
      var closedTime  = r.is_closed ? fmtTs(r.updated_at) : null;
      var timeInfo = createdTime ? ('<span style="font-size:.72rem;color:#94A3B8;margin-left:6px;">Started '+createdTime+(closedTime?' &nbsp;&bull;&nbsp; Closed '+closedTime:'')+'</span>') : '';
      var d = document.createElement('div'); d.className = 'report-card';
      if (r.id === currentReportId) d.style.cssText='border:2px solid var(--gold);';
      var openLbl = 'View';
      var isAdmin = window.SESSION && window.SESSION.role === 'admin';
      var delBtn  = isAdmin ? '<button class="rc-del" onclick="deleteReport('+r.id+',event)">×</button>' : '';
      d.innerHTML = '<div class="rc-date">'+(r.report_date ? new Date(r.report_date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}) : 'No date')+'</div>'
        +'<div class="rc-shift">'+esc(r.shift||'—')+timeInfo+'</div>'
        +'<div class="rc-mod">MOD: '+esc(r.mod_name||'—')+'</div>'
        +'<div class="rc-total">'+tot+' clients</div>'
        +'<button class="btn btn-outline btn-sm" onclick="loadReport('+r.id+')">'+openLbl+'</button>'
        +delBtn;
      el.appendChild(d);
    });
  };

  // ── UA Request banner ───────────────────────────────────────
  // Dismissed IDs persisted to localStorage per user so they survive logins
  var _dismissedUAIds = new Set();

  function _uaDismissKey() {
    return 'sp_dis_ua_' + ((window.SESSION && window.SESSION.username) || '');
  }
  function _loadDismissed(activeIds) {
    try {
      var saved = JSON.parse(localStorage.getItem(_uaDismissKey()) || '[]');
      // Prune IDs no longer on the server (globally acknowledged/cleaned up)
      var pruned = saved.filter(function(id){ return activeIds.has(id); });
      _dismissedUAIds = new Set(pruned);
      if (pruned.length !== saved.length)
        localStorage.setItem(_uaDismissKey(), JSON.stringify(pruned));
    } catch(e) { _dismissedUAIds = new Set(); }
  }
  function _saveDismissed() {
    try { localStorage.setItem(_uaDismissKey(), JSON.stringify(Array.from(_dismissedUAIds))); }
    catch(e) {}
  }

  function showUABanner(requests) {
    var banner    = document.getElementById('ua-banner');
    var items     = document.getElementById('ua-banner-items');
    var ackAllBtn = banner && banner.querySelector('.ua-banner-dismiss');
    if (!banner || !items) return;

    // Only users with ua.acknowledge permission see the UA banner
    var canAck = typeof hasPerm === 'function' ? hasPerm('ua.acknowledge')
      : (window.SESSION && (window.SESSION.role === 'supervisor' || window.SESSION.role === 'monitor'));
    if (!canAck) return;

    // "Acknowledge All" requires ua.acknowledge — hide if lacking permission
    var canAckAll = typeof hasPerm === 'function' ? hasPerm('ua.acknowledge') : canAck;
    if (ackAllBtn) ackAllBtn.style.display = canAckAll ? '' : 'none';

    // Sync dismissed list with localStorage, pruning stale entries
    var activeIds = new Set((requests || []).map(function(r){ return r.id; }));
    _loadDismissed(activeIds);

    var myName = (window.SESSION && (window.SESSION.displayName || window.SESSION.username)) || '';

    var _showInterviews = localStorage.getItem('sp_ua_show_interviews') !== '0';

    var pending = (requests || []).filter(function(r) {
      return !r.acknowledged
          && !_dismissedUAIds.has(r.id)
          && r.requested_by !== myName;
    });

    // Separate interviews from residents
    var residents  = pending.filter(function(r){ return !r.is_interview; });
    var interviews = pending.filter(function(r){ return  r.is_interview; });
    var visible = _showInterviews ? pending : residents;

    if (!visible.length && !interviews.length) { banner.classList.remove('active'); return; }
    if (!visible.length && !_showInterviews)   { banner.classList.remove('active'); return; }

    var toggleBtn = '<button onclick="toggleUAInterviews()" style="'
      + 'background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);color:#fff;'
      + 'border-radius:5px;padding:3px 9px;font-size:.7rem;font-weight:700;cursor:pointer;'
      + 'font-family:var(--sans);white-space:nowrap;margin-left:4px;">'
      + (_showInterviews ? '👁 Hide Interviews' : '👁 Show Interviews ('+interviews.length+')')
      + '</button>';

    items.innerHTML = visible.map(function(r) {
      var isIntv = r.is_interview;
      var label = isIntv
        ? '🧪 <strong>Interview: '+esc(String(r.interview_name||r.client_name||''))+'</strong>'
        : '🧪 <strong>Rm '+esc(String(r.room||''))+' &mdash; '+esc(String(r.client_name||''))+'</strong>';
      return '<span class="ua-banner-item" onclick="acknowledgeUA('+parseInt(r.id)+')" style="cursor:pointer;">'
        + label + ' &nbsp;|&nbsp; Requested by '+esc(String(r.requested_by||''))
        + ' &nbsp;[click to clear]</span>';
    }).join('') + (interviews.length ? toggleBtn : '');
    banner.classList.add('active');
  }

  // Toggle interview UAs in the banner
  window.toggleUAInterviews = function() {
    var cur = localStorage.getItem('sp_ua_show_interviews') !== '0';
    localStorage.setItem('sp_ua_show_interviews', cur ? '0' : '1');
    fetch('/api/ua-requests', {credentials:'include'})
      .then(function(r){ return r.json(); })
      .then(function(list){ showUABanner(list||[]); })
      .catch(function(){});
  };

  // Dismiss for this user — persisted to localStorage, never affects other users
  window.acknowledgeUA = function(id) {
    _dismissedUAIds.add(id);
    _saveDismissed();
    fetch('/api/ua-requests', {credentials:'include'})
      .then(function(r){ return r.json(); })
      .then(function(list){ showUABanner(list||[]); })
      .catch(function(){});
  };

  // Acknowledge All (supervisor only) — local + global server cleanup
  window.acknowledgeAllUA = function() {
    fetch('/api/ua-requests', {credentials:'include'})
      .then(function(r){ return r.json(); })
      .then(function(list){
        var ids = (list||[]).map(function(r){ return r.id; });
        if (!ids.length) return;
        ids.forEach(function(id){ _dismissedUAIds.add(id); });
        _saveDismissed();
        var banner = document.getElementById('ua-banner');
        if (banner) banner.classList.remove('active');
        // Mark acknowledged on server so they're removed from DB for everyone
        Promise.all(ids.map(function(id){
          return fetch('/api/ua-requests/'+id+'/acknowledge', {
            method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include'
          });
        })).catch(function(){});
      }).catch(function(){});
  };

  window.requestUA = function(clientId, clientName, room) {
    fetch('/api/ua-requests', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      credentials: 'include',
      body: JSON.stringify({client_id: clientId, client_name: clientName, room: room})
    }).then(function(r){
      if(r.ok){ showToast('saved','🧪 UA request sent — Rm '+room+' '+clientName); }
      else{ showToast('err','UA request failed ('+r.status+')'); }
    }).catch(function(){ showToast('err','UA request failed — check connection'); });
  };

  // selectFolder: no-op — no folder needed in server mode
  window.selectFolder = function() {};

  // updateFolderUI: show server address instead of folder path
  window.updateFolderUI = function() {
    var el = document.getElementById('fb-path');
    if (!el) return;
    el.textContent = '\u2022 Server mode \u2014 auto-saving to ' + location.host;
    el.classList.remove('none');
    // Hide the Select Folder button
    var btn = el.parentElement && el.parentElement.querySelector('button');
    if (btn) btn.style.display = 'none';
  };

})();
