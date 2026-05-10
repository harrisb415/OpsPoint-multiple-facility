// ── HTML escape helper (VULN-5, VULN-9) ──────────────────────
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// ── Phone formatting ──────────────────────────────────────────
// Formats raw digits to (XXX) XXX-XXXX. Returns original if not 10 digits.
function formatPhone(raw){
  if(!raw) return '';
  var d=String(raw).replace(/\D/g,'');
  if(d.length===11&&d[0]==='1') d=d.slice(1);
  if(d.length===10) return '('+d.slice(0,3)+') '+d.slice(3,6)+'-'+d.slice(6);
  return raw;
}
// Attach phone mask to an input element
function attachPhoneMask(el){
  if(!el||el._phoneMasked) return;
  el._phoneMasked=true;
  el.addEventListener('input',function(){
    var d=this.value.replace(/\D/g,'');
    if(d.length===11&&d[0]==='1') d=d.slice(1);
    if(d.length>10) d=d.slice(0,10);
    if(d.length===0){this.value='';return;}
    if(d.length<=3){this.value='('+d;return;}
    if(d.length<=6){this.value='('+d.slice(0,3)+') '+d.slice(3);return;}
    this.value='('+d.slice(0,3)+') '+d.slice(3,6)+'-'+d.slice(6);
  });
}

// ── Core application logic ──────────────────────────────────
function getDefaultLog(shift){ return []; }

function loadDefaultLog(shift){
  logEntries.length=0;
  getDefaultLog(shift).forEach(e=>logEntries.push(e));
  renderLog();
}

// ── Save ───────────────────────────────────────────────────────
function buildPayload(){
  const cnt={building:0,work:0,pass:0,bhc:0,efc:0,hospital:0,out:0};
  CLIENTS.filter(c=>c.is_active&&!c.is_special&&c.name!=='VACANT').forEach(c=>{const st=shiftStatuses[c.id]||'building';if(cnt.hasOwnProperty(st))cnt[st]++;}); 
  return{id:currentReportId,report_date:document.getElementById('meta-date').value,shift:document.getElementById('meta-shift').value,mod_name:document.getElementById('meta-mod').value,log_entries:[...logEntries],issues:[...issues],med_notes:medNotes.slice(),statuses:{...shiftStatuses},comments:{...shiftComments},last_ua:{...shiftLastUA},last_room_search:{...shiftLastRoomSearch},census:cnt,docx_filename:docxFilename(),updated_at:new Date().toISOString()};
}
function scheduleSave(){setSaveMsg('Saving\u2026','saving');clearTimeout(saveTimer_ref.t);saveTimer_ref.t=setTimeout(doSave,900);}
async function doSave(){
  const p=buildPayload();
  localStorage.setItem('sp_draft',JSON.stringify(p));
  if(!dirHandle){setSaveMsg('No folder \u2014 draft kept locally','err');return;}
  try{
    if(currentReportId){const i=REPORTS.findIndex(r=>r.id===currentReportId);if(i>=0)REPORTS[i]=p;else REPORTS.push(p);}
    else{currentReportId=nextReportId++;p.id=currentReportId;p.created_at=p.updated_at;REPORTS.push(p);document.getElementById('report-id-label').textContent='Report #'+currentReportId;}
    await writeJsonData({clients:CLIENTS,reports:REPORTS});
    const u8=await generateDocx();
    await writeDocxFile(docxFilename(),u8);
    setSaveMsg('Saved \u2192 '+docxFilename(),'saved');
    setTimeout(()=>setSaveMsg('Auto-save on',''),3500);
  }catch(e){setSaveMsg('Save error','err');console.error(e);}
}
async function loadData(){
  const data=await readData();
  if(!data){await writeJsonData({clients:CLIENTS,reports:REPORTS});return;}
  if(data.clients)CLIENTS=data.clients;
  if(data.reports)REPORTS=data.reports;
  // Reload photos/logos from images folder
  let imgDir=null;
  try{imgDir=await dirHandle.getDirectoryHandle('images');}catch(e){}
  async function loadImg(path){
    if(!imgDir||!path||!path.startsWith('images/'))return path;
    try{
      const fname=path.replace('images/','');
      const fh2=await imgDir.getFileHandle(fname);const f2=await fh2.getFile();
      const ab=await f2.arrayBuffer();
      const b64=btoa(String.fromCharCode(...new Uint8Array(ab)));
      return 'data:'+(fname.endsWith('.gif')?'image/gif':'image/jpeg')+';base64,'+b64;
    }catch(e){return null;}
  }
  if(imgDir){
    await Promise.all(CLIENTS.map(async c=>{if(c.photo)c.photo=await loadImg(c.photo);}));
    if(data.logos){for(const k of ['pdec','wcs']){if(data.logos[k])data.logos[k]=(await loadImg(data.logos[k]))||data.logos[k];}}
  }
  loadLogos(data);
  nextClientId=(CLIENTS.reduce((m,c)=>Math.max(m,c.id),0)||99)+1;
  nextReportId=(REPORTS.reduce((m,r)=>Math.max(m,r.id),0)||0)+1;
  loadLocalDraft();
}
function loadLocalDraft(){
  const raw=localStorage.getItem('sp_draft');if(!raw)return;
  try{const d=JSON.parse(raw);const inf=d.id&&REPORTS.find(r=>r.id===d.id);if(inf&&inf.updated_at>=d.updated_at)return;applyReportToUI(d);}catch(e){}
}
function applyReportToUI(r){
  currentReportId=r.id||null;
  document.getElementById('meta-date').value=r.report_date||'';
  document.getElementById('meta-shift').value=r.shift||'Swing Shift';
  document.getElementById('meta-mod').value=r.mod_name||'';

  logEntries.length=0;(r.log_entries||[]).forEach(e=>logEntries.push(e));
  issues.length=0;(r.issues||[]).forEach(i=>issues.push(i));
  medNotes.length=0;(Array.isArray(r.med_notes)?r.med_notes:Array.isArray(r.med_clients)?r.med_clients:(r.med_clients?[r.med_clients]:[])).forEach(n=>medNotes.push(n));
  shiftStatuses={...(r.statuses||{})};shiftComments={...(r.comments||{})};shiftLastUA={...(r.last_ua||{})};shiftLastRoomSearch={...(r.last_room_search||{})};
  if(r.id)document.getElementById('report-id-label').textContent='Report #'+r.id;
}

// ── Tabs ───────────────────────────────────────────────────────
function switchTab(name){
  const names=['report','archive','clients','staff','chores','passes','caseloads','mail','reports'];
  document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active',names[i]===name));
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
  document.getElementById('tab-'+name).classList.add('active');
  if(name==='archive')   renderArchive();
  if(name==='clients')   renderClientTable();
  if(name==='reports')   renderUAReport();
  if(name==='staff')     renderStaffTab();
  if(name==='chores')    renderChoresTab();
  if(name==='passes')    renderPassesTab();
  if(name==='caseloads') renderCaseloadsTab();
  if(name==='mail')      loadMailLog();
}

// ── Roster ─────────────────────────────────────────────────────
// ── Roster sort ────────────────────────────────────────────────
let rosterSortKey = 'room', rosterSortDir = 1; // 1=asc, -1=desc

function sortRoster(key, th) {
  if (rosterSortKey === key) {
    rosterSortDir *= -1;
  } else {
    rosterSortKey = key;
    rosterSortDir = 1;
  }
  // Update header classes
  document.querySelectorAll('#roster-body').forEach(()=>{});
  document.querySelectorAll('th.sortable').forEach(function(el) {
    el.classList.remove('asc','desc');
  });
  th.classList.add(rosterSortDir === 1 ? 'asc' : 'desc');
  buildRoster();
}

function rosterSortFn(a, b) {
  const stLblSort = {building:'In Building',work:'Work',pass:'Weekend Pass',bhc:'BHC',efc:'EFC',hospital:'Hospital',out:'Out/Other',vacant:'Vacant'};
  let av, bv;
  switch(rosterSortKey) {
    case 'room':
      av = parseInt(a.room) || 0; bv = parseInt(b.room) || 0;
      return (av - bv) * rosterSortDir;
    case 'name':
      av = (a.name||'').toLowerCase(); bv = (b.name||'').toLowerCase();
      break;
    case 'status':
      av = stLblSort[shiftStatuses[a.id]||(a.name==='VACANT'?'vacant':'building')]||'';
      bv = stLblSort[shiftStatuses[b.id]||(b.name==='VACANT'?'vacant':'building')]||'';
      break;
    case 'last_ua':
      av = shiftLastUA[a.id] || ''; bv = shiftLastUA[b.id] || '';
      break;
    case 'last_rs':
      av = shiftLastRoomSearch[a.id] || ''; bv = shiftLastRoomSearch[b.id] || '';
      break;
    default:
      av = ''; bv = '';
  }
  return av < bv ? -rosterSortDir : av > bv ? rosterSortDir : 0;
}

function buildRoster(){
  const tbody=document.getElementById('roster-body');tbody.innerHTML='';
  const uaReqTh=document.getElementById('ua-req-th');
  if(uaReqTh)uaReqTh.style.display=(typeof hasPerm==='function'&&hasPerm('ua.request'))?'':'none';
  const srchEl=document.getElementById('roster-search');
  const q=(srchEl?srchEl.value:'').toLowerCase().trim();
  CLIENTS.filter(c=>c.is_active).filter(c=>{
    if(!q)return true;
    return String(c.room).toLowerCase().includes(q)||c.name.toLowerCase().includes(q);
  }).slice().sort(rosterSortFn).forEach(c=>{
    const tr=document.createElement('tr');if(c.is_special)tr.classList.add('srow');
    const rmTd=document.createElement('td');rmTd.className='rm';rmTd.textContent=c.room;
    const nmTd=document.createElement('td');nmTd.className='name-cell';nmTd.textContent=c.name;
    const stTd=document.createElement('td');
    if(c.is_special){stTd.textContent='\u2014';stTd.style.color='#cbd5e1';}
    else if(c.name==='VACANT'){
      const badge=document.createElement('span');badge.className='ss s-vacant';badge.textContent='Vacant';
      badge.style.cssText='cursor:default;pointer-events:none;display:inline-block;';
      stTd.appendChild(badge);
    }
    else{
      const cur=shiftStatuses[c.id]||'building';
      const _canStatus = typeof hasPerm==='function' && hasPerm('status.edit');
      if (window._archiveMode || !_canStatus) {
        const lbl = (STATUS_OPTS.find(o=>o.v===cur)||{l:cur}).l;
        const badge=document.createElement('span');badge.className='ss '+stCls(cur);
        badge.style.cssText='display:inline-block;padding:3px 10px;border-radius:6px;font-size:.72rem;font-weight:700;pointer-events:none;';
        badge.textContent=lbl; stTd.appendChild(badge);
      } else {
        const sel=document.createElement('select');sel.className='ss '+stCls(cur);
        STATUS_OPTS.forEach(o=>{const opt=document.createElement('option');opt.value=o.v;opt.textContent=o.l;if(o.v===cur)opt.selected=true;sel.appendChild(opt);});
        sel.onchange=function(){this.className='ss '+stCls(this.value);shiftStatuses[c.id]=this.value;updateCensus();scheduleSave();syncPassFromRosterStatus(c.id,this.value);};
        stTd.appendChild(sel);
      }
    }
    const uaTd=document.createElement('td');uaTd.style.cssText='font-size:.72rem;color:#5c6b5e;white-space:nowrap;text-align:center;';
    if(!c.is_special)uaTd.textContent=shiftLastUA[c.id]||'\u2014';
    const rsTd=document.createElement('td');rsTd.style.cssText='font-size:.72rem;color:#5c6b5e;white-space:nowrap;text-align:center;';
    if(!c.is_special)rsTd.textContent=shiftLastRoomSearch[c.id]||'\u2014';
    const cmTd=document.createElement('td');cmTd.className='cmt';
    if(!c.is_special){const inp=document.createElement('input');inp.type='text';inp.placeholder='\u2014';inp.value=shiftComments[c.id]||'';inp.oninput=function(){shiftComments[c.id]=this.value;scheduleSave();};cmTd.appendChild(inp);}
    const _canUA=typeof hasPerm==='function'&&hasPerm('ua.request');
    if(_canUA){
      const actTd=document.createElement('td');actTd.style.cssText='text-align:center;';actTd.setAttribute('data-ua-col','1');
      if(!c.is_special&&c.name!=='VACANT'){
        const uaBtn=document.createElement('button');
        uaBtn.className='btn btn-sm';uaBtn.title='Request UA for '+c.name;
        uaBtn.style.cssText='font-size:.7rem;padding:3px 8px;background:#C8500A;color:#fff;border:none;border-radius:5px;cursor:pointer;white-space:nowrap;';
        uaBtn.textContent='\ud83e\uddea UA';
        uaBtn.onclick=function(){requestUA(c.id,c.name,c.room);};
        actTd.appendChild(uaBtn);
      }
      tr.append(rmTd,nmTd,stTd,uaTd,rsTd,cmTd,actTd);
    } else {
      tr.append(rmTd,nmTd,stTd,uaTd,rsTd,cmTd);
    }
    tbody.appendChild(tr);
  });
  updateCensus();
}
function updateCensus(){
  const cnt={building:0,work:0,pass:0,bhc:0,efc:0,hospital:0,out:0};
  CLIENTS.filter(c=>c.is_active&&!c.is_special&&c.name!=='VACANT').forEach(c=>{const st=shiftStatuses[c.id]||'building';if(cnt.hasOwnProperty(st))cnt[st]++;});
  const tot=Object.values(cnt).reduce((a,b)=>a+b,0);
  ['building','work','pass','bhc','efc','hospital','out'].forEach(k=>document.getElementById('cnt-'+k).textContent=cnt[k]);
  document.getElementById('cnt-total').textContent=tot;
}


// ── Settings ───────────────────────────────────────────────────
function applySettings(cfg) {
  if (!cfg) return;
  if (cfg.walk_areas && cfg.walk_areas.length) WALK_AREAS = cfg.walk_areas;
  if (cfg.wellness_interval_mins != null) WELLNESS_INTERVAL_MINS = cfg.wellness_interval_mins;
  if (cfg.walk_interval_mins     != null) WALK_INTERVAL_MINS     = cfg.walk_interval_mins;
  if (cfg.wellness_schedule)      WELLNESS_SCHEDULE      = cfg.wellness_schedule;
  if (cfg.walk_schedule)          WALK_SCHEDULE          = cfg.walk_schedule;
  if (cfg.ua_panel && cfg.ua_panel.length) {
    window.UA_PANEL = cfg.ua_panel;
    var fullNames = {ETG:'Alcohol',THC:'Marijuana',K2:'Spice',FEN:'Fentanyl',AMP:'Amphetamines',MDMA:'Ecstasy / Molly',MET:'Methamphetamines',PCP:'Phencyclidine',MOR:'Morphine',OXY:'Oxycodone',OPI:'Opiates',BZO:'Benzodiazepines',MTD:'Methadone',BUP:'Buprenorphine',COC:'Cocaine'};
    UA_SUBSTANCES = cfg.ua_panel.map(function(code){ return {code:code,label:code,full:fullNames[code]||code}; });
  }
}

async function loadSettings() {
  try {
    const res = await fetch('/api/facility/settings', {credentials:'include'});
    if (!res.ok) return;
    const cfg = await res.json();
    const n = cfg.facility_name || 'ShiftPoint';
    // Update all facility name elements
    var el = document.getElementById('facility-name-header');
    if (el) el.textContent = n;
    document.title = n + ' \u2014 Shift Report';
    window.FACILITY_NAME = n;
    try { FACILITY_NAME = n; } catch(e2) {}
    if (cfg.ua_panel && cfg.ua_panel.length) window.UA_PANEL = cfg.ua_panel;
    applySettings(cfg);
    startReminderEngine();
  } catch(err) {}
}

// ── Reminder engine ────────────────────────────────────────────
var _reminderTimer = null;

function parseLogTimeToDate(timeStr) {
  if (!timeStr) return null;
  const m = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1]), mn = parseInt(m[2]), ap = m[3].toUpperCase();
  if (ap === 'AM' && h === 12) h = 0;
  if (ap === 'PM' && h !== 12) h += 12;
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, mn, 0);
}

function getMostRecentLogMatch(keyword) {
  for (let i = logEntries.length - 1; i >= 0; i--) {
    const e = logEntries[i];
    if (e.text && e.text.toLowerCase().indexOf(keyword) !== -1) {
      const t = parseLogTimeToDate(e.time);
      if (t) return t;
    }
  }
  return null;
}

// Track which scheduled time-slots have been dismissed in this session
var _scheduledAcked = new Set();

// Play a short ding using Web Audio API
function playDing() {
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.25);
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.6);
    osc.onended = function() { ctx.close(); };
  } catch(e) {}
}

function checkReminders() {
  if (typeof hasPerm==='function'&&!hasPerm('reminders.view')) { clearReminder(); return; }
  if (!currentReportId) { clearReminder(); return; }
  const now = new Date();
  const nowMins = now.getHours()*60 + now.getMinutes();
  const wellnessTime = getMostRecentLogMatch('wellness check');
  const walkTime     = getMostRecentLogMatch('walkthrough');
  // Interval-based: still fires if overdue
  var wellnessDue = WELLNESS_INTERVAL_MINS > 0 && (!wellnessTime || (now - wellnessTime) > WELLNESS_INTERVAL_MINS * 60000);
  var walkDue     = WALK_INTERVAL_MINS     > 0 && (!walkTime     || (now - walkTime)     > WALK_INTERVAL_MINS     * 60000);
  // Scheduled: always fires at the time regardless of last check
  function schedTriggered(schedule, prefix) {
    if (!schedule || !schedule.length) return false;
    return schedule.some(function(t) {
      var pm = t.match(/(\d+):(\d+)\s*(AM|PM)/i); if (!pm) return false;
      var h=parseInt(pm[1]),m=parseInt(pm[2]),ap=pm[3].toUpperCase();
      if(ap==='AM'&&h===12)h=0; if(ap==='PM'&&h!==12)h+=12;
      var sm = h*60+m;
      // Fire within a 2-minute window of the scheduled time
      if (nowMins < sm || nowMins > sm + 1) return false;
      var key = prefix + ':' + sm;
      if (_scheduledAcked.has(key)) return false;
      return true;
    });
  }
  var wellnessScheduled = schedTriggered(WELLNESS_SCHEDULE, 'w');
  var walkScheduled     = schedTriggered(WALK_SCHEDULE, 'wk');
  if (wellnessScheduled) wellnessDue = true;
  if (walkScheduled)     walkDue     = true;
  var wasHidden = document.getElementById('reminder-bar') && document.getElementById('reminder-bar').style.display === 'none';
  if (wellnessDue && walkDue) showReminder('both');
  else if (wellnessDue)       showReminder('wellness');
  else if (walkDue)           showReminder('walk');
  else                        clearReminder();
  // Play ding when a new reminder appears
  if ((wellnessDue || walkDue) && wasHidden) playDing();
}

function showReminder(type) {
  const bar = document.getElementById('reminder-bar');
  const msg = document.getElementById('reminder-msg');
  if (!bar || !msg) return;
  if (type === 'wellness') {
    msg.innerHTML = '<strong>\u26a0 Wellness Check Due</strong> &mdash; Last check was over ' + WELLNESS_INTERVAL_MINS + ' minutes ago.';
    bar.style.background = 'var(--crimson)';
  } else if (type === 'walk') {
    msg.innerHTML = '<strong>\u26a0 Building Walkthrough Due</strong> &mdash; Last walkthrough was over ' + WALK_INTERVAL_MINS + ' minutes ago.';
    bar.style.background = '#C8860A';
  } else {
    msg.innerHTML = '<strong>\u26a0 Action Required</strong> &mdash; Both a wellness check and building walkthrough are overdue.';
    bar.style.background = 'var(--dark)';
  }
  bar.style.display = 'flex';
}

function clearReminder() {
  const bar = document.getElementById('reminder-bar');
  if (bar) bar.style.display = 'none';
}
function dismissReminder() {
  // Ack all currently triggered scheduled times so they don't re-fire this minute
  const now = new Date();
  const nowMins = now.getHours()*60 + now.getMinutes();
  function ackSchedule(schedule, prefix) {
    if (!schedule) return;
    schedule.forEach(function(t) {
      var pm = t.match(/(\d+):(\d+)\s*(AM|PM)/i); if (!pm) return;
      var h=parseInt(pm[1]),m=parseInt(pm[2]),ap=pm[3].toUpperCase();
      if(ap==='AM'&&h===12)h=0; if(ap==='PM'&&h!==12)h+=12;
      var sm = h*60+m;
      if (nowMins >= sm && nowMins <= sm + 1) _scheduledAcked.add(prefix+':'+sm);
    });
  }
  ackSchedule(WELLNESS_SCHEDULE, 'w');
  ackSchedule(WALK_SCHEDULE, 'wk');
  clearReminder();
}

function startReminderEngine() {
  if (_reminderTimer) clearInterval(_reminderTimer);
  checkReminders();
  _reminderTimer = setInterval(checkReminders, 60000);
}

// ── Log ────────────────────────────────────────────────────────
function renderLog(){
  const el=document.getElementById('log-entries');el.innerHTML='';
  const _canDelLog=typeof hasPerm==='function'&&hasPerm('log.delete');
  logEntries.forEach((e,i)=>{const d=document.createElement('div');d.className='log-entry';d.innerHTML=(function(){
      var isPos = e.text && /POS:/.test(e.text);
      var isUA  = e.text && e.text.toLowerCase().indexOf('ua conducted on') === 0;
      if (isPos) {
        d.style.cssText='border-left:4px solid #DC2626;background:#fff5f5;padding-left:8px;';
        var highlighted = esc(e.text).replace(/(POS:[^|<]+)/g,'<strong style="color:#DC2626;">$1</strong>');
        var photoBtn = '';
        if (isUA) {
          if (e.ua_photo) {
            photoBtn = '<button onclick="viewUAPhotoById('+e.id+')" title="View test photo" style="margin-left:8px;background:#fee2e2;border:1px solid #fca5a5;color:#991b1b;border-radius:5px;padding:2px 7px;font-size:.72rem;font-weight:700;cursor:pointer;">&#128247; View Photo</button>';
          } else {
            photoBtn = '<button class="ua-photo-btn" onclick="openUAPhoto('+(e.id||0)+',this)" title="Attach test photo" style="margin-left:8px;background:#fee2e2;border:1px solid #fca5a5;color:#991b1b;border-radius:5px;padding:2px 7px;font-size:.72rem;font-weight:700;cursor:pointer;">&#128247; Photo</button>';
          }
        }
        return '<span class="ts">'+esc(e.time)+'</span><span class="msg">'+highlighted+photoBtn+'</span>';
      }
      return '<span class="ts">'+esc(e.time)+'</span><span class="msg">'+esc(e.text)+'</span>';
    })()+(_canDelLog?`<button class="del-btn" onclick="removeLog(${i})" title="Delete entry">&times;</button>`:'');el.appendChild(d);});
}
function addLog(){
  const tEl=document.getElementById('log-time'),txtEl=document.getElementById('log-text');const text=txtEl.value.trim();if(!text)return;
  let ts=tEl.value;
  if(ts){const[h,m]=ts.split(':');const hr=parseInt(h);ts=`${hr%12||12}:${m} ${hr>=12?'PM':'AM'}`;}
  else{const n=new Date();ts=`${n.getHours()%12||12}:${String(n.getMinutes()).padStart(2,'0')} ${n.getHours()>=12?'PM':'AM'}`;}
  logEntries.push({time:ts,text});
  // Sort by time
  logEntries.sort((a,b)=>{
    function toMins(t){
      const m=t.match(/(\d+):(\d+)\s*(AM|PM)/i);if(!m)return 0;
      let h=parseInt(m[1]),mn=parseInt(m[2]),ap=m[3].toUpperCase();
      if(ap==='AM'&&h===12)h=0;
      if(ap==='PM'&&h!==12)h+=12;
      return h*60+mn;
    }
    return toMins(a.time)-toMins(b.time);
  });
  txtEl.value='';renderLog();scheduleSave();
}
function removeLog(i){logEntries.splice(i,1);renderLog();scheduleSave();}
document.getElementById('log-text').addEventListener('keydown',e=>{if(e.key==='Enter')addLog();});

// ── Issues ─────────────────────────────────────────────────────
function renderIssues(){
  const el=document.getElementById('issues-list');el.innerHTML='';
  const _canEdit=typeof hasPerm==='function'&&hasPerm('issues.edit');
  const _delBtn=_canEdit?`<button class="del-btn" onclick="removeIssue(IDX)">\xd7</button>`:'';
  issues.forEach((v,i)=>{const d=document.createElement('div');d.className='issue-item';d.innerHTML=`<span class="issue-text">${esc(v)}</span>${_delBtn.replace('IDX',i)}`;el.appendChild(d);});
}
function addIssue(){const inp=document.getElementById('issue-text');const t=inp.value.trim();if(!t)return;issues.push(t);inp.value='';renderIssues();scheduleSave();}
function removeIssue(i){issues.splice(i,1);renderIssues();scheduleSave();}
document.getElementById('issue-text').addEventListener('keydown',e=>{if(e.key==='Enter')addIssue();});

function renderMedNotes(){
  const el=document.getElementById('med-list');if(!el)return;
  el.innerHTML='';
  const _canEdit=typeof hasPerm==='function'&&hasPerm('issues.edit');
  const _delBtn=_canEdit?`<button class="del-btn" onclick="removeMedNote(IDX)">\xd7</button>`:'';
  medNotes.forEach((v,i)=>{const d=document.createElement('div');d.className='issue-item';d.innerHTML=`<span class="issue-text">${esc(v)}</span>${_delBtn.replace('IDX',i)}`;el.appendChild(d);});
}
function addMedNote(){const inp=document.getElementById('med-input');const t=inp.value.trim();if(!t)return;medNotes.push(t);inp.value='';renderMedNotes();scheduleSave();}
function removeMedNote(i){medNotes.splice(i,1);renderMedNotes();scheduleSave();}
document.getElementById('med-input').addEventListener('keydown',e=>{if(e.key==='Enter')addMedNote();});



['meta-date','meta-mod'].forEach(id=>{
  document.getElementById(id).addEventListener('input',scheduleSave);
  document.getElementById(id).addEventListener('change',scheduleSave);
});
document.getElementById('meta-shift').addEventListener('change',function(){
  if(logEntries.length===0||confirm('Reset the activity log with default entries for '+this.value+'?\n\nManually added entries will be lost.')){
    loadDefaultLog(this.value);
  }
  scheduleSave();
});
document.getElementById('roster-body').addEventListener('input',scheduleSave);

// ── New Report (carries issues) ────────────────────────────────
function newReport(){
  if(!confirm('Start a new report?\n\nIssues & Concerns and roster status will carry over.\nShift log will be reset.'))return;
  // Save current report first so it is never lost
  if(currentReportId){
    const snap=buildPayload();
    const i=REPORTS.findIndex(r=>r.id===currentReportId);
    if(i>=0)REPORTS[i]=snap;else REPORTS.push(snap);
    writeJsonData({clients:CLIENTS,reports:REPORTS});
  }
  const kept=[...issues];
  const keptStatuses={...shiftStatuses};
  const keptComments={...shiftComments};
  currentReportId=null;
  logEntries.length=0;issues.length=0;kept.forEach(i=>issues.push(i));
  // medNotes carry over — pinned to every shift
  shiftStatuses={...keptStatuses};
  shiftComments={...keptComments};
  shiftLastUA={};
  shiftLastRoomSearch={};
  document.getElementById('meta-date').value=today();
  document.getElementById('meta-shift').value='Swing Shift';
  document.getElementById('meta-mod').value='';

  document.getElementById('report-id-label').textContent='';
  localStorage.removeItem('sp_draft');
  loadDefaultLog('Swing Shift');
  buildRoster();renderIssues();
  setSaveMsg('New report','');
}

// ── Return to current report ──────────────────────────────────
function returnToCurrentReport() {
  // Re-enable fields that may have been disabled by read-only view
  ['meta-date','meta-shift','meta-mod'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.disabled = false;
  });
  // Restore all hidden input rows
  document.querySelectorAll('.log-add,.issue-add').forEach(function(el){ el.style.display=''; });
  // Restore quick-action buttons and wellness check
  var qbtns = document.querySelector('.quick-btns');
  if (qbtns) qbtns.style.display = '';
  document.querySelectorAll('[onclick="openWellnessCheck()"]').forEach(function(b){ b.style.display=''; });
  // Restore all × buttons
  document.querySelectorAll('.issue-del,.med-del,.del-btn,.issue-x,.med-x,.item-del').forEach(function(b){ b.style.display=''; });
  // Re-enable roster inputs
  document.querySelectorAll('#client-list-body input, #client-list-body select, #client-list-body textarea').forEach(function(el){ el.disabled=false; });
  // Remove read-only banner
  var roBanner = document.getElementById('ro-banner');
  if (roBanner) roBanner.remove();
  var actBtns = document.getElementById('action-btns');
  if (actBtns) {
    actBtns.querySelectorAll('button').forEach(function(btn){ btn.style.display=''; });
    actBtns.style.display = 'inline-flex';
  }
  // Find the active report — the one matching the stored active ID
  var activeId = window._currentActiveId;
  if (activeId) {
    var r = REPORTS.find(function(x){ return x.id === activeId; });
    if (r) { applyReportToUI(r); buildRoster(); renderLog(); renderIssues(); renderMedNotes(); }
  }
  // Hide the back button, show close shift button
  var backBtn = document.getElementById('back-to-current-btn');
  if (backBtn) backBtn.style.display = 'none';
  switchTab('report');
  setSaveMsg('Back to current report','saved');
  setTimeout(function(){ setSaveMsg('Auto-save on',''); }, 2000);
}

// ── Close Shift ───────────────────────────────────────────────
function closeShift(){
  if(!currentReportId){
    alert('No active report to close. Fill in the date, shift, and monitor name first.');
    return;
  }
  const shift = document.getElementById('meta-shift').value || 'this shift';
  const date  = document.getElementById('meta-date').value;
  const ds = date ? new Date(date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}) : '';
  if(!confirm('Close ' + shift + (ds?' ('+ds+')':'') + '?\n\nThis will save and lock the current report, then start a fresh one for the next shift.\n\nThe closed report will remain in the archive and cannot be overwritten.')) return;

  // Store active ID for returnToCurrentReport
  window._currentActiveId = currentReportId;
  // Mark report as closed
  const snap = buildPayload();
  snap.closed = true;
  snap.closed_at = new Date().toISOString();
  snap.roster_snapshot = CLIENTS.slice();
  const i = REPORTS.findIndex(r=>r.id===currentReportId);
  if(i>=0) REPORTS[i] = snap; else REPORTS.push(snap);
  writeJsonData({clients:CLIENTS,reports:REPORTS});
  setSaveMsg('Shift closed \u2713','saved');

  // Now start fresh — carry over issues and statuses
  const kept=[...issues];
  const keptStatuses={...shiftStatuses};
  const keptComments={...shiftComments};
  currentReportId=null;
  logEntries.length=0;issues.length=0;kept.forEach(i=>issues.push(i));
  shiftStatuses={...keptStatuses};
  shiftComments={...keptComments};
  shiftLastUA={};shiftLastRoomSearch={};
  document.getElementById('meta-date').value=today();
  document.getElementById('meta-shift').value='Swing Shift';
  document.getElementById('meta-mod').value='';
  document.getElementById('report-id-label').textContent='';
  localStorage.removeItem('sp_draft');
  buildRoster();renderLog();renderIssues();renderMedNotes();updateCensus();
  setSaveMsg('Ready for next shift','');
  setTimeout(()=>switchTab('report'),100);
}

// ── Archive ────────────────────────────────────────────────────
function renderArchive(){
  const el=document.getElementById('report-list');
  if(!dirHandle){el.innerHTML='<div class="empty-state">Select a save folder to view reports.</div>';return;}
  const sorted=[...REPORTS].sort((a,b)=>(b.report_date||'').localeCompare(a.report_date||'')||(b.updated_at||'').localeCompare(a.updated_at||''));
  if(!sorted.length){el.innerHTML='<div class="empty-state">No saved reports yet.</div>';return;}
  el.innerHTML='';
  sorted.forEach(r=>{
    const tot=Object.values(r.census||{}).reduce((a,b)=>a+b,0)||'\u2014';
    const d=document.createElement('div');d.className='report-card';
    const canManage = typeof hasPerm==='function'&&hasPerm('reports.delete');
    const delBtn = canManage ? `<button class="rc-del" onclick="deleteReport(${r.id},event)">×</button>` : '';
    const openLbl = canManage ? 'Open' : 'View';
    d.innerHTML=`<div class="rc-date">${fmt(r.report_date)||'No date'}</div><div class="rc-shift">${esc(r.shift||'—')}</div><div class="rc-mod">MOD: ${esc(r.mod_name||'—')}</div><div class="rc-total">${tot} clients</div><div class="rc-file">${esc(r.docx_filename||'')}</div><button class="btn btn-outline btn-sm" onclick="loadReport(${r.id})">${openLbl}</button>${delBtn}`;
    el.appendChild(d);
  });
}
function loadReport(id){
  const r=REPORTS.find(x=>x.id===id);if(!r)return;
  const canEdit = typeof hasPerm==='function'&&(hasPerm('reports.create')||hasPerm('reports.close'));
  openArchiveTab(r, canEdit);
}

function openArchiveTab(r, canEdit) {
  var roster = (r.roster_snapshot&&r.roster_snapshot.length)
    ? r.roster_snapshot
    : CLIENTS.filter(function(c){ return c.is_active && !c.is_special; });

  var STATUS_LABELS = {'building':'In Building','work':'At Work','pass':'Weekend Pass',
    'bhc':'BHC','efc':'EFC','hospital':'Hospital','other':'Out / Other','vacant':'Vacant'};
  var STATUS_COLORS = {'building':'#d1fae5','work':'#dbeafe','pass':'#fef3c7',
    'bhc':'#ede9fe','efc':'#fce7f3','hospital':'#fee2e2','other':'#f1f5f9','vacant':'#f8fafc'};
  var STATUS_TEXT = {'building':'#065f46','work':'#1e40af','pass':'#92400e',
    'bhc':'#5b21b6','efc':'#9d174d','hospital':'#991b1b','other':'#475569','vacant':'#94a3b8'};

  var fmt = function(ds){if(!ds)return'';var d=new Date(ds+'T12:00:00');return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});};
  var esc2 = function(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');};

  var logHtml = (r.log_entries||[]).length ? (r.log_entries||[]).map(function(e){
    var isPos = e.text&&/POS:/.test(e.text);
    var style = isPos ? 'border-left:4px solid #dc2626;background:#fff5f5;padding-left:8px;' : '';
    var txt = isPos ? esc2(e.text).replace(/(POS:[^|<]+)/g,'<strong style="color:#dc2626;">$1</strong>') : esc2(e.text);
    return '<div style="padding:6px 0;border-bottom:1px solid #f1f5f9;'+style+'"><span style="font-family:monospace;font-size:.75rem;color:#64748b;margin-right:10px;">'+esc2(e.time)+'</span><span>'+txt+'</span></div>';
  }).join('') : '<div style="color:#94a3b8;font-style:italic;padding:10px 0;">No log entries.</div>';

  var issuesHtml = (r.issues||[]).length ? (r.issues||[]).map(function(v){
    return '<div style="background:#fefce8;border:1px solid #fde68a;border-radius:6px;padding:7px 12px;margin-bottom:6px;font-size:.84rem;">'+esc2(v)+'</div>';
  }).join('') : '<div style="color:#94a3b8;font-style:italic;">None.</div>';

  var medHtml = (r.med_notes||[]).length ? (r.med_notes||[]).map(function(v){
    return '<div style="background:#fefce8;border:1px solid #fde68a;border-radius:6px;padding:7px 12px;margin-bottom:6px;font-size:.84rem;">'+esc2(v)+'</div>';
  }).join('') : '<div style="color:#94a3b8;font-style:italic;">None.</div>';

  var rosterHtml = '<table style="width:100%;border-collapse:collapse;font-size:.8rem;">'
    +'<thead><tr style="background:#1a3327;color:#a8d5b5;">'
    +'<th style="padding:6px 10px;text-align:left;">RM</th><th style="padding:6px 10px;text-align:left;">NAME</th>'
    +'<th style="padding:6px 10px;text-align:left;">STATUS</th><th style="padding:6px 10px;text-align:left;">LAST UA</th>'
    +'<th style="padding:6px 10px;text-align:left;">LAST ROOM SEARCH</th></tr></thead><tbody>';
  roster.filter(function(c){return !c.is_special;}).sort(function(a,b){
    return (parseInt(a.room)||0)-(parseInt(b.room)||0)||(String(a.room).localeCompare(String(b.room)));
  }).forEach(function(c){
    var st = (r.statuses||{})[c.id]||(c.name==='VACANT'?'vacant':'building');
    var lbl = STATUS_LABELS[st]||st;
    var bg = STATUS_COLORS[st]||'#f8fafc';
    var tc = STATUS_TEXT[st]||'#475569';
    rosterHtml += '<tr style="border-bottom:1px solid #f1f5f9;background:'+(c.name==='VACANT'?'#f8fafc':'#fff')+';">'
      +'<td style="padding:5px 10px;font-family:monospace;color:#64748b;">'+esc2(c.room)+'</td>'
      +'<td style="padding:5px 10px;font-weight:'+(c.name==='VACANT'?'400':'600')+';">'+esc2(c.name)+'</td>'
      +'<td style="padding:5px 10px;"><span style="background:'+bg+';color:'+tc+';padding:2px 10px;border-radius:10px;font-size:.72rem;font-weight:700;">'+lbl+'</span></td>'
      +'<td style="padding:5px 10px;color:#64748b;">'+esc2(((r.last_ua||{})[c.id])||'—')+'</td>'
      +'<td style="padding:5px 10px;color:#64748b;">'+esc2(((r.last_room_search||{})[c.id])||'—')+'</td>'
      +'</tr>';
  });
  rosterHtml += '</tbody></table>';

  var win = window.open('', '_blank');
  if (!win) { alert('Popup blocked — allow popups for this site.'); return; }
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">'
    +'<title>'+esc2(r.shift||'Shift')+' — '+fmt(r.report_date)+'</title>'
    +'<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Calibri,Arial,sans-serif;font-size:13px;background:#f8fafc;}'
    +'.wrap{max-width:960px;margin:0 auto;padding:24px;}'
    +'.hdr{background:#1a3327;color:#fff;padding:14px 20px;border-radius:10px 10px 0 0;border-bottom:3px solid #d4a017;}'
    +'.hdr-sub{color:#a8d5b5;font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px;}'
    +'.hdr h1{font-size:1.1rem;font-weight:800;margin-bottom:2px;}'
    +'.meta{color:#a8d5b5;font-size:.78rem;}'
    +'.card{background:#fff;border:1px solid #e2e8f0;border-radius:0 0 10px 10px;padding:20px;margin-bottom:20px;}'
    +'.sh{font-weight:800;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#1a3327;border-bottom:2px solid #1a3327;padding-bottom:4px;margin:20px 0 10px;}'
    +'.sh:first-child{margin-top:0;}'
    +'table{width:100%;border-collapse:collapse;}th{background:#1a3327;color:#a8d5b5;padding:7px 10px;text-align:left;font-size:.68rem;letter-spacing:.06em;}td{padding:6px 10px;border-bottom:1px solid #f1f5f9;}'
    +'@media print{.no-print{display:none;}}</style></head><body><div class="wrap">'
    +'<div class="no-print" style="margin-bottom:12px;display:flex;gap:8px;">'
    +'<button onclick="window.print()" style="background:#1a3327;color:#fff;border:none;padding:8px 16px;border-radius:6px;font-weight:700;cursor:pointer;">&#128424; Print / Save PDF</button>'
    +'<button onclick="window.close()" style="background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;padding:8px 16px;border-radius:6px;font-weight:700;cursor:pointer;">Close</button>'
    +'</div>'
    +'<div class="hdr"><div class="hdr-sub">Archived Shift Report'+(canEdit?' · Supervisor View':'')+'</div>'
    +'<h1>'+esc2(r.shift||'Shift')+' &nbsp;&bull;&nbsp; '+fmt(r.report_date)+'</h1>'
    +'<div class="meta">MOD: '+esc2(r.mod_name||'—')+'</div></div>'
    +'<div class="card">'
    +'<div class="sh">Shift Activity Log</div>'+logHtml
    +'<div class="sh">Issues &amp; Concerns</div>'+issuesHtml
    +'<div class="sh">Medical Notes</div>'+medHtml
    +'<div class="sh">Resident Roster</div>'+rosterHtml
    +'</div></div></body></html>';
  win.document.write(html); win.document.close();
}


async function deleteReport(id,evt){
  evt.stopPropagation();
  if(!confirm('Delete this report permanently?')) return;
  const res=await fetch('/api/reports/'+id,{method:'DELETE',credentials:'include'});
  const d=await res.json();
  if(!d.ok){alert('Delete failed: '+(d.error||'unknown'));return;}
  REPORTS=REPORTS.filter(r=>r.id!==id);
  if(currentReportId===id){currentReportId=null;document.getElementById('report-id-label').textContent='';}
  renderArchive();
}


// ── Client table sort ──────────────────────────────────────────
let clientSortKey='room', clientSortDir=1;
function sortClientTable(key, th){
  if(clientSortKey===key){clientSortDir*=-1;}else{clientSortKey=key;clientSortDir=1;}
  document.querySelectorAll('#client-list-body').forEach(()=>{});
  document.querySelectorAll('#tab-clients th.sortable').forEach(el=>el.classList.remove('asc','desc'));
  th.classList.add(clientSortDir===1?'asc':'desc');
  renderClientTable();
}
function clientSortFn(a,b){
  let av,bv;
  switch(clientSortKey){
    case 'room': av=parseInt(a.room)||0;bv=parseInt(b.room)||0;return(av-bv)*clientSortDir;
    case 'name': av=(a.name||'').toLowerCase();bv=(b.name||'').toLowerCase();break;
    case 'cm': av=(a.case_manager||'').toLowerCase();bv=(b.case_manager||'').toLowerCase();break;
    case 'intake': av=a.intake_date||'';bv=b.intake_date||'';break;
    case 'discharge': av=a.discharge_date||'';bv=b.discharge_date||'';break;
    case 'status': av=a.is_active?'Active':'Discharged';bv=b.is_active?'Active':'Discharged';break;
    default: av='';bv='';
  }
  return av<bv?-clientSortDir:av>bv?clientSortDir:0;
}

// ── Client management ──────────────────────────────────────────
function renderClientTable(){
  var _roster = (window._archiveMode && window._archiveClients) ? window._archiveClients : CLIENTS;
  const showDis=document.getElementById('show-discharged').checked;
  const tbody=document.getElementById('client-list-body');tbody.innerHTML='';
  const srchEl=document.getElementById('client-search');
  const q=(srchEl?srchEl.value:'').toLowerCase().trim();
  const list=_roster.filter(c=>!c.is_special&&(showDis||c.is_active)).filter(c=>{
    if(!q)return true;
    return String(c.room).toLowerCase().includes(q)
        ||c.name.toLowerCase().includes(q)
        ||(c.case_manager||'').toLowerCase().includes(q)
        ||(c.phone||'').toLowerCase().includes(q);
  }).slice().sort(clientSortFn);
  if(!list.length){tbody.innerHTML='<tr><td colspan="8" style="padding:18px;text-align:center;color:#94a3b8;">No clients.</td></tr>';return;}
  const _canResEdit=typeof hasPerm==='function'&&hasPerm('residents.edit');
  list.forEach(c=>{
    const tr=document.createElement('tr');if(!c.is_active)tr.classList.add('drow');
    const photoBtn=c.name==='VACANT' ? '' : c.photo
      ?`<button class="btn-photo" onclick="viewPhoto(${c.id})">&#128247; See Photo</button>`
      :`<button class="btn-no-photo" onclick="updateClientPhoto(${c.id})" style="cursor:pointer;" title="Upload photo">+ Photo</button>`;
    const fmtD=function(s){return s?new Date(s+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—';};
    tr.innerHTML=`
      <td class="rm">${esc(c.room)}</td>
      <td class="name-cell">${esc(c.name)}${!c.is_active?'<span style="margin-left:8px;font-size:.62rem;font-weight:700;background:#fee2e2;color:#991b1b;padding:2px 6px;border-radius:10px;text-transform:uppercase;">Discharged</span>':''}</td>
      <td style="font-size:.82rem;">${esc(c.case_manager||'—')}</td>
      <td style="font-family:var(--mono);font-size:.74rem;">${esc(formatPhone(c.phone)||'—')}</td>
      <td class="date-cell">${fmtD(c.intake_date)}</td>
      <td class="date-cell">${fmtD(c.discharge_date)}</td>
      <td><span style="font-size:.73rem;font-weight:600;color:${c.is_active?'#15803d':'#94a3b8'};">${c.is_active?'Active':'Discharged'}</span></td>
      <td style="display:flex;gap:5px;padding:6px 10px;white-space:nowrap;min-width:240px;">
        ${_canResEdit&&c.name!=='VACANT'&&!c.is_special?`<button class="btn btn-outline btn-sm" onclick="openEditClientModal(${c.id})">&#9998; Edit</button>`:''}
        ${_canResEdit&&c.name!=='VACANT'?(c.is_active?`<button class="btn-danger-sm" onclick="openDischargeModal(${c.id},'${esc(c.name)}')">Discharge</button>`:`<button class="btn btn-outline btn-sm" onclick="reactivate(${c.id})">Reactivate</button>`):''}
        ${photoBtn}
      </td>`;
    tbody.appendChild(tr);
  });
}

let _editClientId=null;
function openEditClientModal(id){
  const c=CLIENTS.find(x=>x.id===id);
  if(!c)return;
  _editClientId=id;
  document.getElementById('ec-room').value=c.room||'';
  document.getElementById('ec-name').value=c.name||'';
  document.getElementById('ec-cm').value=c.case_manager||'';
  document.getElementById('ec-phone').value=formatPhone(c.phone)||'';
  attachPhoneMask(document.getElementById('ec-phone'));
  attachPhoneMask(document.getElementById('ac-phone'));
  document.getElementById('ec-intake').value=c.intake_date||'';
  document.getElementById('ec-discharge').value=c.discharge_date||'';
  document.getElementById('ec-title').textContent='Edit — '+(c.name||'Client');
  openModal('edit-client-modal');
  setTimeout(function(){var n=document.getElementById('ec-name');if(n)n.focus();},80);
}
async function submitEditClient(){
  if(!_editClientId)return;
  const c=CLIENTS.find(x=>x.id===_editClientId);
  if(!c)return;
  const room=document.getElementById('ec-room').value.trim();
  const name=document.getElementById('ec-name').value.trim();
  if(!name){alert('Name is required.');return;}
  // Check room conflict if room changed
  if(room&&room!==c.room){
    const occ=CLIENTS.find(x=>x.room===room&&x.is_active&&!x.is_special&&x.name!=='VACANT'&&x.id!==_editClientId);
    if(occ){alert('Room '+room+' is already occupied by '+occ.name+'.');return;}
  }
  try {
    const res=await fetch('/api/clients/'+_editClientId,{
      method:'PUT',
      headers:{'Content-Type':'application/json'},
      credentials:'include',
      body:JSON.stringify({
        room:room||c.room,
        name:name,
        case_manager:document.getElementById('ec-cm').value.trim(),
        phone:document.getElementById('ec-phone').value.trim(),
        intake_date:document.getElementById('ec-intake').value||null,
        discharge_date:document.getElementById('ec-discharge').value||null
      })
    });
    const d=await res.json();
    if(d.error){alert(d.error);return;}
    // Update in-memory client
    c.room=d.client?d.client.room:room||c.room;
    c.name=d.client?d.client.name:name;
    c.case_manager=d.client?d.client.case_manager:document.getElementById('ec-cm').value.trim();
    c.phone=d.client?d.client.phone:document.getElementById('ec-phone').value.trim();
    c.intake_date=d.client?d.client.intake_date:document.getElementById('ec-intake').value||null;
    c.discharge_date=d.client?d.client.discharge_date:document.getElementById('ec-discharge').value||null;
    closeModal('edit-client-modal');
    buildRoster();renderClientTable();showToast('saved','Client updated');
  } catch(e){alert('Error saving client.');}
}
function openAddClientModal(){
  document.getElementById('ac-name').value='';
  document.getElementById('ac-room').value='';
  document.getElementById('ac-intake').value=today();
  document.getElementById('ac-cm').value='';
  document.getElementById('ac-phone').value='';
  document.getElementById('ac-photo-input').value='';
  document.getElementById('ac-photo-name').textContent='';
  document.getElementById('ac-photo-zone').textContent='Click to upload photo';
  document.getElementById('ac-photo-zone').classList.remove('has-photo');
  window._pendingPhoto=null;
  openModal('add-client-modal');
  setTimeout(function(){ var n=document.getElementById('ac-name'); if(n)n.focus(); }, 80);
  fetch('/api/facility/rooms/vacant',{credentials:'include'}).then(function(r){return r.json();}).then(function(rooms){
    var sel=document.getElementById('ac-room');
    if(!sel||sel.tagName!=='SELECT') return;
    sel.innerHTML = rooms.length
      ? '<option value="">-- Select vacant room --</option>'+rooms.map(function(r){return '<option value="'+r.room+'">Room '+r.room+'</option>';}).join('')
      : '<option value="">-- No vacant rooms available --</option>';
  }).catch(function(){});
}
async function submitAddClient(){
  const name=document.getElementById('ac-name').value.trim();
  var acRoomEl=document.getElementById('ac-room'); const room=(acRoomEl.tagName==='SELECT'?acRoomEl.value:(acRoomEl.value||'').trim());
  const intake=document.getElementById('ac-intake').value;
  const cm=document.getElementById('ac-cm').value.trim();
  const phone=document.getElementById('ac-phone').value.trim();
  const photo=window._pendingPhoto||null;
  if(!name||!room){alert('Name and room are required.');return;}
  // Check if room is already occupied by an active, non-vacant client
  const occupied=CLIENTS.find(c=>c.room===room&&c.is_active&&!c.is_special&&c.name!=='VACANT');
  if(occupied){alert('Room '+room+' is already occupied by '+occupied.name+'.\n\nPlease discharge or reassign that client first.');return;}
  // Remove VACANT placeholder for this room if present
  CLIENTS=CLIENTS.filter(c=>!(c.room===room&&c.name==='VACANT'));
  var newId = nextClientId++;
  CLIENTS.push({id:newId,room,name,case_manager:cm||'',phone:phone||'',photo:photo,intake_date:intake||null,discharge_date:null,is_special:false,is_active:true,sort_order:CLIENTS.length});
  if (currentReportId) {
    var ts2 = nowTs('');
    var intakeStr = intake ? ' Intake: ' + new Date(intake+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) + '.' : '';
    addLogEntry(ts2, 'New resident admitted: ' + name + ', Rm. ' + room + '.' + intakeStr);
  }
  CLIENTS.sort((a,b)=>(parseInt(a.room)||9999)-(parseInt(b.room)||9999));
  closeModal('add-client-modal');clearTimeout(saveTimer_ref.t);await doSave();buildRoster();renderClientTable();showToast('saved','Client added');
}
// Sync the active pass status when roster status changes
function syncPassFromRosterStatus(clientId, rosterStatus) {
  var passes = window.PASSES;
  if (!passes) return;
  var activePass = passes.find(function(p){ return p.client_id === clientId && p.status !== 'Returned'; });
  if (!activePass) return;
  var passStatus = rosterStatus === 'pass' ? 'Out' : 'In';
  if (activePass.status === passStatus) return; // already in sync
  activePass.status = passStatus;
  if (typeof renderPassesTab === 'function') renderPassesTab();
  fetch('/api/passes/' + activePass.id, {
    method:'PUT', headers:{'Content-Type':'application/json'}, credentials:'include',
    body: JSON.stringify({status: passStatus})
  }).catch(function(){});
}

let dcTargetId=null;
function openDischargeModal(id,name){dcTargetId=id;document.getElementById('dc-name-label').textContent=name;document.getElementById('dc-date').value=today();openModal('discharge-modal');}
async function submitDischarge(){
  const date=document.getElementById('dc-date').value;
  if(!date){alert('Please enter a discharge date.');return;}
  const c=CLIENTS.find(x=>x.id===dcTargetId);
  if(c){
    c.discharge_date=date;c.is_active=false;
    if(!CLIENTS.find(x=>x.room===c.room&&x.name==='VACANT'&&x.is_active)){
      CLIENTS.push({id:nextClientId++,room:c.room,name:'VACANT',case_manager:'',phone:'',photo:null,intake_date:null,discharge_date:null,is_special:false,is_active:true,sort_order:CLIENTS.length});
      CLIENTS.sort((a,b)=>(parseInt(a.room)||9999)-(parseInt(b.room)||9999));
    }
    if(currentReportId){
      const dcStr=' Discharge date: '+new Date(date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+'.';
      addLogEntry(nowTs(''),'Client discharged: '+c.name+', Rm. '+c.room+'.'+dcStr);
    }
  }
  closeModal('discharge-modal');clearTimeout(saveTimer_ref.t);await doSave();buildRoster();renderClientTable();showToast('saved','Client discharged');
}
async function reactivate(id){
  if(!confirm('Reactivate this client?'))return;
  const c=CLIENTS.find(x=>x.id===id);
  if(c){
    c.discharge_date=null;c.is_active=true;
    CLIENTS=CLIENTS.filter(x=>!(x.room===c.room&&x.name==='VACANT'&&x.is_active));
  }
  await writeJsonData({clients:CLIENTS,reports:REPORTS});buildRoster();renderClientTable();showToast('saved','Client reactivated');
}
async function deleteClient(id,name){if(!confirm('Permanently delete '+name+'?\nThis cannot be undone.'))return;CLIENTS=CLIENTS.filter(c=>c.id!==id);await writeJsonData({clients:CLIENTS,reports:REPORTS});buildRoster();renderClientTable();}

// ── Send via Outlook (.eml with .docx attached) ────────────────
async function sendOutlook(){
  // Show attachment reminder before proceeding
  if(!confirm('\u26a0 Reminder: After clicking OK, a .docx file will download to your Downloads folder.\n\nYou MUST attach that file to the email before sending.\n\nClick OK to download the file and open your email client.')) return;
  setSaveMsg('Preparing…','saving');
  try{
    const u8=await generateDocx();
    const fname=docxFilename();
    // Save to selected folder if connected
    if(dirHandle) await writeDocxFile(fname,u8);
    // Download the .docx file to the user's Downloads folder
    const blob=new Blob([u8],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=fname;
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    // Open Outlook with subject + body pre-filled
    const dv=document.getElementById('meta-date').value;
    const sv=document.getElementById('meta-shift').value;
    const mv=document.getElementById('meta-mod').value;
    const ds=dv?new Date(dv+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}):'';
    const subj=encodeURIComponent([(typeof FACILITY_NAME!=='undefined'?FACILITY_NAME:'ShiftPoint'),sv+' Report',ds].filter(Boolean).join(' — '));
    const body=encodeURIComponent(
      sv+' Report'+
      (ds?'\nDate: '+ds:'')+
      (mv?'\nMOD: '+mv:'')+
      '\n\nPlease find the shift report attached.'+
      '\nFile: '+fname+
      '\n\n(Attach the downloaded file to this email before sending.)'
    );
    // Delay slightly so download dialog doesn't interfere
    setTimeout(()=>{ window.location.href='mailto:?subject='+subj+'&body='+body; }, 500);
    showToast('saved','Downloaded — attach to Outlook email');
  }catch(e){showToast('err','Could not generate report');alert('Could not generate: '+e.message);console.error(e);}
}




// ── Photo handling ─────────────────────────────────────────────
window._pendingPhoto = null;

function handlePhotoUpload(input){
  const file=input.files[0];if(!file)return;
  if(file.size>5*1024*1024){alert('Photo must be under 5MB.');return;}
  const reader=new FileReader();
  reader.onload=function(e){
    window._pendingPhoto=e.target.result;
    document.getElementById('ac-photo-zone').textContent='\u2713 '+file.name;
    document.getElementById('ac-photo-zone').classList.add('has-photo');
    document.getElementById('ac-photo-name').textContent=Math.round(file.size/1024)+'KB';
  };
  reader.readAsDataURL(file);
}

let currentPhotoClientId=null;
function viewPhoto(clientId){
  const c=CLIENTS.find(x=>x.id===clientId);if(!c||!c.photo)return;
  currentPhotoClientId=clientId;
  document.getElementById('photo-view-name').textContent='Rm '+c.room+' — '+c.name;
  document.getElementById('photo-view-img').src=c.photo;
  openModal('photo-view-modal');
}

function updateClientPhoto(clientId){
  const input=document.createElement('input');input.type='file';input.accept='image/*';
  input.onchange=async function(){
    const file=input.files[0];if(!file)return;
    if(file.size>5*1024*1024){alert('Photo must be under 5MB.');return;}
    const reader=new FileReader();
    reader.onload=async function(e){
      const c=CLIENTS.find(x=>x.id===clientId);if(!c)return;
      c.photo=e.target.result;
      await writeJsonData({clients:CLIENTS,reports:REPORTS});
      renderClientTable();showToast('saved','Photo saved');
      // Refresh modal if it's currently open for this client
      const modalImg=document.getElementById('photo-view-img');
      if(modalImg&&currentPhotoClientId===clientId)modalImg.src=e.target.result;
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

// ── Quick log buttons ──────────────────────────────────────────
function nowTs(inputVal){
  if(inputVal){
    const[h,m]=inputVal.split(':');const hr=parseInt(h);
    return(hr%12||12)+':'+m+' '+(hr>=12?'PM':'AM');
  }
  const n=new Date();return(n.getHours()%12||12)+':'+String(n.getMinutes()).padStart(2,'0')+' '+(n.getHours()>=12?'PM':'AM');
}
function nowH24(){const n=new Date();return String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0');}
function addLogEntry(time,text){logEntries.push({time,text});renderLog();scheduleSave();}

// ── Shared quick modal ─────────────────────────────────────────
let _quickSubmitFn=null;
function openQuickModal(title,bodyHtml,submitFn){
  document.getElementById('quick-modal-title').textContent=title;
  document.getElementById('quick-modal-body').innerHTML=bodyHtml;
  _quickSubmitFn=submitFn;
  openModal('quick-modal');
  const first=document.querySelector('#quick-modal-body input:not([type=time])');
  if(first)setTimeout(()=>first.focus(),80);
}
function quickModalSubmit(){if(_quickSubmitFn)_quickSubmitFn();}

function timeField(){
  return '<div class="field" style="margin-bottom:0;"><label>Time <span style="font-weight:400;text-transform:none;letter-spacing:0;color:#94a3b8;">(leave blank for now)</span></label>'
    +'<input type="time" id="qm-time" value="'+nowH24()+'"></div>';
}

// ── Walkthrough ────────────────────────────────────────────────
var WALK_AREAS = ['Supply Room','Basement / Offices','Kitchen','Meeting Room','Dining Room',
  'Laundry Area','Clothing Closet','Stairs to Roof','Floors 2, 3 & 4','Stairs Down to Main','Perimeter Check'];
var WELLNESS_INTERVAL_MINS = 120;
var WALK_INTERVAL_MINS = 240;
var WELLNESS_SCHEDULE = [];
var WALK_SCHEDULE = [];

function quickWalkthrough(){
  // Build location checklist HTML
  const locationHtml = '<div class="field"><label>Locations Checked</label>'
    + '<div id="qm-walk-areas" style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;margin-top:4px;">'
    + WALK_AREAS.map(function(area){
        const safeId = 'qwa_' + area.replace(/[^a-z0-9]/gi,'_');
        // VULN-9: Escape area values before inserting into HTML
        return '<label style="display:flex;align-items:center;gap:6px;font-size:.85rem;font-weight:400;text-transform:none;letter-spacing:0;cursor:pointer;padding:3px 0;">'
          + '<input type="checkbox" id="' + safeId + '" value="' + esc(area) + '" style="width:16px;height:16px;accent-color:var(--mid);cursor:pointer;">'
          + esc(area) + '</label>';
      }).join('')
    + '</div>'
    + '<div style="margin-top:8px;display:flex;gap:8px;">'
    + '<button type="button" onclick="walkCheckAll(true)" style="font-size:.72rem;padding:3px 9px;border:1px solid var(--line);border-radius:5px;background:var(--bg);cursor:pointer;">All Clear</button>'
    + '<button type="button" onclick="walkCheckAll(false)" style="font-size:.72rem;padding:3px 9px;border:1px solid var(--line);border-radius:5px;background:var(--bg);cursor:pointer;">Clear All</button>'
    + '</div>'
    + '</div>';

  openQuickModal('\uD83D\uDD50 Walkthrough',
    timeField()
    +'<div class="field"><label>Conducted by</label><input type="text" id="qm-by" value="" placeholder="Monitor name"></div>'
    +locationHtml
    +'<div class="field" id="qm-flag-field" style="margin-top:4px;">'
    +'<label>Issues / Notes (optional)</label>'
    +'<input type="text" id="qm-issues" placeholder="Leave blank if all clear">'
    +'</div>',
    function(){
      const by=(document.getElementById('qm-by').value.trim())||'monitor on duty';
      const ts=nowTs(document.getElementById('qm-time').value);
      const checkboxes=document.querySelectorAll('#qm-walk-areas input[type=checkbox]');
      const checked=[], unchecked=[];
      checkboxes.forEach(function(cb){ (cb.checked?checked:unchecked).push(cb.value); });
      const issues=(document.getElementById('qm-issues').value||'').trim();
      let msg;
      if(checked.length===0){
        msg='Building walkthrough conducted by '+by+'. All is well, nothing to report.';
      } else if(unchecked.length===0){
        msg='Building walkthrough conducted by '+by+'. All areas checked: '+checked.join(', ')+'. '+(issues||'All is well, nothing to report.');
      } else {
        msg='Building walkthrough conducted by '+by+'. Areas checked: '+checked.join(', ')+'.'+(unchecked.length?' Not checked: '+unchecked.join(', ')+'.':'')+' '+(issues||'All is well, nothing to report.');
      }
      addLogEntry(ts,msg);
      closeModal('quick-modal');
    }
  );
}

function walkCheckAll(state){
  document.querySelectorAll('#qm-walk-areas input[type=checkbox]').forEach(function(cb){ cb.checked=state; });
}

// ── Lunch break ────────────────────────────────────────────────
function quickLunch(){
  openQuickModal('\uD83C\uDF55 Lunch Break',
    timeField()
    +'<div class="field"><label>Monitor name</label><input type="text" id="qm-by" value="" placeholder="Monitor name"></div>'
    +'<div class="modal-note">A return entry will be added automatically 30 minutes after the lunch time.</div>',
    function(){
      const nm=(document.getElementById('qm-by').value.trim())||'Monitor';
      const tVal=document.getElementById('qm-time').value;
      let h,m;
      if(tVal){[h,m]=[parseInt(tVal.split(':')[0]),parseInt(tVal.split(':')[1])];}
      else{const n=new Date();h=n.getHours();m=n.getMinutes();}
      const ts1=(h%12||12)+':'+String(m).padStart(2,'0')+' '+(h>=12?'PM':'AM');
      let rh=h,rm=m+30;if(rm>=60){rh++;rm-=60;}if(rh>=24)rh-=24;
      const ts2=(rh%12||12)+':'+String(rm).padStart(2,'0')+' '+(rh>=12?'PM':'AM');
      addLogEntry(ts1,nm+' took lunch.');
      addLogEntry(ts2,nm+' returned from lunch.');
      closeModal('quick-modal');
    }
  );
}

// ── Client dropdown helper ─────────────────────────────────────
function clientDropdown(selId){
  const active=CLIENTS.filter(c=>c.is_active&&!c.is_special&&c.name!=='VACANT');
  const opts=active.map(c=>`<option value="${c.id}">${esc(c.name)} — Rm. ${esc(c.room)}</option>`).join('');
  return `<div class="field"><label>Client</label><select id="${selId}" style="width:100%;padding:8px 10px;border:1.5px solid var(--line);border-radius:8px;font-size:.85rem;"><option value="">— Select client —</option>${opts}</select></div>`;
}
function selectedClient(selId){
  const el=document.getElementById(selId);
  if(!el||!el.value)return null;
  return CLIENTS.find(c=>c.id===parseInt(el.value))||null;
}

// ── UA ─────────────────────────────────────────────────────────

// ── UA Substance definitions ───────────────────────────────────
var UA_SUBSTANCES = [
  {code:'ETG',  label:'ETG',  full:'Alcohol'},
  {code:'THC',  label:'THC',  full:'Marijuana'},
  {code:'K2',   label:'K2',   full:'Spice'},
  {code:'FEN',  label:'FEN',  full:'Fentanyl'},
  {code:'AMP',  label:'AMP',  full:'Amphetamines'},
  {code:'MDMA', label:'MDMA', full:'Ecstasy / Molly'},
  {code:'MET',  label:'MET',  full:'Methamphetamines'},
  {code:'PCP',  label:'PCP',  full:'Phencyclidine'},
  {code:'MOR',  label:'MOR',  full:'Morphine'},
  {code:'OXY',  label:'OXY',  full:'Oxycodone'},
  {code:'OPI',  label:'OPI',  full:'Opiates'},
  {code:'BZO',  label:'BZO',  full:'Benzodiazepines'},
  {code:'MTD',  label:'MTD',  full:'Methadone'},
  {code:'BUP',  label:'BUP',  full:'Buprenorphine'},
  {code:'COC',  label:'COC',  full:'Cocaine'},
];

function quickUA(){
  // Widen modal for substance grid
  const modal = document.querySelector('#quick-modal .modal');
  if (modal) modal.style.maxWidth = '620px';

  const substanceGrid = UA_SUBSTANCES.map(function(sub){
    // VULN-5: Escape sub.code and sub.full before inserting into HTML
    return '<div class="ua-sub-cell" data-code="'+esc(sub.code)+'" onclick="cycleUASub(this)"'
      +' title="'+esc(sub.full)+'"'
      +' style="display:flex;flex-direction:column;align-items:center;justify-content:center;'
      +'padding:7px 4px;border-radius:8px;border:1.5px solid #D4E6DA;cursor:pointer;user-select:none;'
      +'min-width:56px;background:#fff;transition:all .15s;">'
      +'<span style="font-size:.78rem;font-weight:800;color:#0F172A;">'+esc(sub.code)+'</span>'
      +'<span style="font-size:.62rem;color:#64748B;line-height:1.2;text-align:center;">'+esc(sub.full)+'</span>'
      +'<span class="ua-sub-result" style="font-size:.7rem;font-weight:700;color:#94A3B8;margin-top:3px;">—</span>'
      +'</div>';
  }).join('');

  openQuickModal('\u{1F9EA} UA (Urinalysis)',
    timeField()
    +'<div id="qm-client-wrap">'+clientDropdown('qm-client-sel')+'</div>'
    +'<div class="field" id="qm-interview-wrap" style="display:none;"><label>Interviewee Name</label><input type="text" id="qm-interview-name" placeholder="Name of person being interviewed..." style="width:100%;font-family:var(--sans);font-size:.9rem;padding:8px 10px;border:1.5px solid var(--line);border-radius:6px;"></div>'
    +'<div class="field"><label>Conducted by</label><input type="text" id="qm-staff" placeholder="Staff name"></div>'
    +'<div class="field"><label>Reason</label>'
    +'<select id="qm-reason" style="width:100%;font-family:var(--sans);font-size:.9rem;padding:8px 10px;border:1.5px solid var(--line);border-radius:6px;">'
    +'<option value="Random">Random</option>'
    +'<option value="Return from Pass">Return from Pass</option>'
    +'<option value="Suspicion">Suspicion</option>'
    +'<option value="CM Request">CM Request</option>'
    +'<option value="Interview">Interview (prospective client)</option>'
    +'<option value="Other">Other (specify below)</option>'
    +'</select>'
    +'<input type="text" id="qm-reason-cm" placeholder="Case manager name..." style="display:none;margin-top:6px;width:100%;font-family:var(--sans);font-size:.9rem;padding:8px 10px;border:1.5px solid var(--line);border-radius:6px;">'
    +'<input type="text" id="qm-reason-other" placeholder="Specify reason..." style="display:none;margin-top:6px;width:100%;font-family:var(--sans);font-size:.9rem;padding:8px 10px;border:1.5px solid var(--line);border-radius:6px;">'
    +'</div>'
    +'<div class="field"><label>Results <span style="font-weight:400;font-size:.7rem;color:#94A3B8;">— tap each substance to cycle: \u2014 \u2192 NEG \u2192 POS</span></label>'
    +'<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-top:4px;">'
    +substanceGrid
    +'</div></div>',
    function(){
      const reasonSel = document.getElementById('qm-reason').value;
      const isInterview = reasonSel === 'Interview';
      const c = !isInterview ? selectedClient('qm-client-sel') : null;
      const interviewName = isInterview ? (document.getElementById('qm-interview-name').value || '').trim() : '';
      const staff = document.getElementById('qm-staff').value.trim();
      if (!isInterview && !c) { alert('Please select a client.'); return; }
      if (isInterview && !interviewName) { alert('Please enter the interviewee\'s name.'); return; }
      if (!staff) { alert('Staff name is required.'); return; }
      const cmName = (document.getElementById('qm-reason-cm').value || '').trim();
      const reason = reasonSel === 'Other'
        ? (document.getElementById('qm-reason-other').value.trim() || 'Other')
        : reasonSel === 'CM Request' && cmName
          ? 'CM Request (' + cmName + ')'
          : reasonSel;
      // Build results string from substance grid
      const pos=[], neg=[], nt=[];
      document.querySelectorAll('#quick-modal-body .ua-sub-cell').forEach(function(cell){
        const code = cell.dataset.code;
        const res  = cell.querySelector('.ua-sub-result').textContent.trim();
        if (res === 'POS') pos.push(code);
        else if (res === 'NEG') neg.push(code);
        else nt.push(code);
      });
      // Format: "POS: THC, COC | NEG: ETG, FEN | NT: K2"
      let resultParts = [];
      if (pos.length) resultParts.push('POS: '+pos.join(', '));
      if (neg.length) resultParts.push('NEG: '+neg.join(', '));
      if (nt.length)  resultParts.push('NT: '+nt.join(', '));
      const resultStr = resultParts.join(' | ') || 'No results entered';
      const ts = nowTs(document.getElementById('qm-time').value);
      const logName = isInterview ? interviewName : c.name;
      const logLoc  = isInterview ? 'Interview' : ('Rm. ' + c.room);
      addLogEntry(ts,'UA conducted on '+logName+' ('+logLoc+') by '+staff+'. Reason: '+reason+'. Results: '+resultStr+'.');
      if (!isInterview && c) { shiftLastUA[c.id] = dateStamp(); buildRoster(); }
      // Reset modal width
      const modal = document.querySelector('#quick-modal .modal');
      if (modal) modal.style.maxWidth = '';
      closeModal('quick-modal');
    }
  );

  // Wire reason dropdown to show/hide CM / Other inputs
  setTimeout(function(){
    const sel = document.getElementById('qm-reason');
    if (sel) sel.addEventListener('change', function(){
      const cm  = document.getElementById('qm-reason-cm');
      const oth = document.getElementById('qm-reason-other');
      const itv = document.getElementById('qm-interview-wrap');
      const clientWrap = document.getElementById('qm-client-wrap');
      const isItv = this.value === 'Interview';
      if (cm)  cm.style.display  = this.value === 'CM Request' ? 'block' : 'none';
      if (oth) oth.style.display = this.value === 'Other'      ? 'block' : 'none';
      if (itv) itv.style.display = isItv ? 'block' : 'none';
      if (clientWrap) clientWrap.style.display = isItv ? 'none' : '';
    });
  }, 50);
}

function cycleUASub(cell) {
  const el = cell.querySelector('.ua-sub-result');
  const states = ['\u2014', 'NEG', 'POS'];
  const colors = {
    '\u2014': { bg:'#fff',      border:'#D4E6DA', text:'#94A3B8' },
    'NEG':   { bg:'#D8F3DC',   border:'#86EFAC', text:'#15803D' },
    'POS':   { bg:'#FEE2E2',   border:'#FCA5A5', text:'#991B1B' },
  };
  const cur = el.textContent.trim();
  const next = states[(states.indexOf(cur) + 1) % states.length];
  el.textContent = next;
  const c = colors[next];
  cell.style.background = c.bg;
  cell.style.borderColor = c.border;
  el.style.color = c.text;
}

function dateStamp(){const d=new Date();return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}
// ── Room Search ────────────────────────────────────────────────
function quickRoomSearch(){
  openQuickModal('\uD83D\uDD0E Room Search',
    timeField()
    +clientDropdown('qm-client-sel')
    +'<div class="field"><label>Conducted by</label><input type="text" id="qm-staff" value="" placeholder="Staff name"></div>'
    +'<div class="field"><label>Findings</label><input type="text" id="qm-findings" value="Nothing found"></div>',
    function(){
      const c=selectedClient('qm-client-sel');
      const staff=document.getElementById('qm-staff').value.trim();
      if(!c){alert('Please select a client.');return;}
      if(!staff){alert('Staff name is required.');return;}
      const findings=document.getElementById('qm-findings').value.trim()||'Nothing found';
      const ts=nowTs(document.getElementById('qm-time').value);
      addLogEntry(ts,'Room search conducted on '+c.name+' (Rm. '+c.room+') by '+staff+'. Findings: '+findings+'.');
      shiftLastRoomSearch[c.id]=dateStamp();
      buildRoster();
      closeModal('quick-modal');
    }
  );
}

// ── Pass return ────────────────────────────────────────────────
function quickPassReturn(){
  openQuickModal('\uD83C\uDFE0 Pass Return',
    timeField()
    +clientDropdown('qm-client-sel'),
    function(){
      const c=selectedClient('qm-client-sel');
      if(!c){alert('Please select a client.');return;}
      const ts=nowTs(document.getElementById('qm-time').value);
      addLogEntry(ts,c.name+' (Rm. '+c.room+') returned from weekend pass.');
      closeModal('quick-modal');
    }
  );
}

// ── Wellness Check ─────────────────────────────────────────────
function openWellnessCheck(){
  const now=new Date();
  const h=String(now.getHours()).padStart(2,'0'),m=String(now.getMinutes()).padStart(2,'0');
  document.getElementById('wc-time').value=h+':'+m;
  document.getElementById('wc-by').value='';
  const list=document.getElementById('wc-client-list');
  list.innerHTML='';
  const active=CLIENTS.filter(c=>c.is_active&&!c.is_special&&c.name!=='VACANT'&&(shiftStatuses[c.id]||'building')!=='vacant');
  active.forEach(c=>{
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:5px;background:var(--bg);border:1px solid var(--line);';
    const chk=document.createElement('input');chk.type='checkbox';chk.id='wc_'+c.id;chk.style.accentColor='var(--red)';
    const lbl=document.createElement('label');lbl.htmlFor='wc_'+c.id;
    lbl.style.cssText='font-size:.81rem;flex:1;cursor:pointer;';
    lbl.textContent='Rm '+c.room+' — '+c.name;
    const st=document.createElement('span');
    st.style.cssText='font-size:.68rem;color:var(--steel);';
    const stLbl={building:'In Building',work:'Work',pass:'Weekend Pass',bhc:'BHC',efc:'EFC',hospital:'Hospital',out:'Out/Other'};
    st.textContent=stLbl[shiftStatuses[c.id]||'building']||'';
    row.appendChild(chk);row.appendChild(lbl);row.appendChild(st);
    list.appendChild(row);
  });
  openModal('wellness-modal');
}

function submitWellnessCheck(){
  const tVal=document.getElementById('wc-time').value;
  const by=document.getElementById('wc-by').value.trim();
  let ts=tVal;
  if(ts){const[h,m]=ts.split(':');const hr=parseInt(h);ts=(hr%12||12)+':'+m+' '+(hr>=12?'PM':'AM');}
  else{const n=new Date();ts=(n.getHours()%12||12)+':'+String(n.getMinutes()).padStart(2,'0')+' '+(n.getHours()>=12?'PM':'AM');}
  const notPresent=[];
  CLIENTS.filter(c=>c.is_active&&!c.is_special&&c.name!=='VACANT'&&(shiftStatuses[c.id]||'building')!=='vacant').forEach(c=>{
    if(document.getElementById('wc_'+c.id)&&document.getElementById('wc_'+c.id).checked) notPresent.push('Rm '+c.room+' '+c.name);
  });
  const total=CLIENTS.filter(c=>c.is_active&&!c.is_special&&c.name!=='VACANT'&&(shiftStatuses[c.id]||'building')!=='vacant').length;
  let msg='Wellness check conducted'+(by?' by '+by:'')+'. ';
  if(notPresent.length===0){msg+='All '+total+' clients accounted for.';}
  else{msg+=(total-notPresent.length)+' of '+total+' clients accounted for. Not located: '+notPresent.join(', ')+'.';}
  logEntries.push({time:ts,text:msg});
  renderLog();scheduleSave();checkReminders();
  closeModal('wellness-modal');
}




// ── Printable Building Walkthrough Sheet ──────────────────────

// ── UA Photo functions ────────────────────────────────────
function _openPhotoOverlay(src) {
  var ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:pointer;';
  ov.onclick=function(){ov.remove();};
  var img=document.createElement('img'); img.src=src;
  img.style.cssText='max-width:90vw;max-height:90vh;border-radius:10px;box-shadow:0 0 40px rgba(0,0,0,.5);';
  var lbl=document.createElement('div');
  lbl.style.cssText='position:absolute;bottom:20px;left:0;right:0;text-align:center;color:#fff;font-size:.8rem;opacity:.7;';
  lbl.textContent='Click anywhere to close';
  ov.appendChild(img); ov.appendChild(lbl); document.body.appendChild(ov);
}
var _currentUAPhotoLogId = null;

function _openUAPhotoModal(src, entry) {
  var label = document.getElementById('ua-photo-view-label');
  var img   = document.getElementById('ua-photo-view-img');
  if (label) label.textContent = 'UA Photo' + (entry && entry.time ? ' — ' + entry.time : '');
  if (img)   img.src = src;
  openModal('ua-photo-view-modal');
}
function _fetchAndShowUAPhoto(id) {
  var entry = logEntries.find(function(e){ return e.id === id; });
  fetch('/api/log/'+id+'/photo',{credentials:'include'}).then(function(r){return r.json();}).then(function(d){
    if(d.ok&&d.photo) _openUAPhotoModal(d.photo, entry);
    else showToast('err','Photo not available');
  }).catch(function(){ showToast('err','Could not load photo'); });
}
function viewUAPhotoById(id) {
  var entry = logEntries.find(function(e){ return e.id === id; });
  if (!entry || !entry.ua_photo) { showToast('err','Photo not found'); return; }
  _currentUAPhotoLogId = id;
  var p = entry.ua_photo;
  if (p === true || p === 1 || (typeof p === 'string' && !p.startsWith('data:'))) {
    _fetchAndShowUAPhoto(id);
  } else {
    _openUAPhotoModal(p, entry);
  }
}
function replaceUAPhoto() {
  if (!_currentUAPhotoLogId) return;
  var inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = function() {
    if (!inp.files[0]) return;
    if (inp.files[0].size > 5*1024*1024) { showToast('err','Photo must be under 5MB.'); return; }
    var reader = new FileReader();
    reader.onload = function(ev) {
      // Update modal image immediately for instant feedback
      var img = document.getElementById('ua-photo-view-img');
      if (img) img.src = ev.target.result;
      _attachUAPhoto(_currentUAPhotoLogId, ev.target.result);
    };
    reader.readAsDataURL(inp.files[0]);
  };
  inp.click();
}

function viewUAPhoto(src){
  if (!src || typeof src !== 'string') return;
  viewUAPhotoById(0); // fallback — call with src directly
  var ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:pointer;';
  ov.onclick=function(){ov.remove();};
  var img=document.createElement('img'); img.src=src;
  img.style.cssText='max-width:90vw;max-height:90vh;border-radius:10px;';
  ov.appendChild(img); document.body.appendChild(ov);
}

function openUAPhoto(logId, btn) {
  if (!logId) {
    if (btn) { btn.textContent = 'Saving...'; btn.disabled = true; }
    doSave().then(function() {
      return fetch('/api/data', {credentials:'include'});
    }).then(function(r){ return r.json(); }).then(function(data) {
      if (data.reports && currentReportId) {
        var curRpt = data.reports.find(function(r){ return r.id === currentReportId; });
        if (curRpt && curRpt.log_entries) {
          logEntries = curRpt.log_entries.slice();
          renderLog();
        }
      }
      if (btn) { btn.textContent = '&#128247; Photo'; btn.disabled = false; }
      showToast('saved','Entry saved \u2014 click Photo again to attach image');
    }).catch(function() {
      if (btn) { btn.textContent = '&#128247; Photo'; btn.disabled = false; }
    });
    return;
  }
  var inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = function() {
    if (!inp.files[0]) return;
    var reader = new FileReader();
    reader.onload = function(ev) { _attachUAPhoto(logId, ev.target.result); };
    reader.readAsDataURL(inp.files[0]);
  };
  inp.click();
}

function _attachUAPhoto(logId, b64) {
  fetch('/api/log/'+logId+'/photo',{method:'POST',headers:{'Content-Type':'application/json'},
    credentials:'include',body:JSON.stringify({photo:b64})}).then(function(r){return r.json();}).then(function(data){
    if(data.ok){
      showToast('saved','Photo saved');
      var entry=logEntries.find(function(e){return e.id===logId;});
      if(entry){entry.ua_photo=b64;renderLog();}
      REPORTS.forEach(function(r){
        (r.log_entries||[]).forEach(function(le){if(le.id===logId)le.ua_photo=b64;});
      });
    }
  });
}

// ── Inline UA Report ──────────────────────────────────────
var UA_SUBS_RPT = [
  {code:'ETG',full:'Alcohol'},{code:'THC',full:'Marijuana'},{code:'K2',full:'Spice'},
  {code:'FEN',full:'Fentanyl'},{code:'AMP',full:'Amphetamines'},{code:'MDMA',full:'Ecstasy'},
  {code:'MET',full:'Meth'},{code:'PCP',full:'PCP'},{code:'MOR',full:'Morphine'},
  {code:'OXY',full:'Oxycodone'},{code:'OPI',full:'Opiates'},{code:'BZO',full:'Benzos'},
  {code:'MTD',full:'Methadone'},{code:'BUP',full:'Buprenorphine'},{code:'COC',full:'Cocaine'},
];
var _uar_sortCol='date', _uar_sortDir=-1;

function getSubResultRpt(results, code) {
  if (!results) return '';
  var pm=results.match(/POS:\s*([^|]+)/i),nm=results.match(/NEG:\s*([^|]+)/i),ntm=results.match(/NT:\s*([^|]+)/i);
  function inList(m){ return m && m[1].split(/,\s*/).map(function(c){return c.trim().toUpperCase();}).indexOf(code.toUpperCase())!==-1; }
  if (inList(pm)) return 'POS'; if (inList(nm)) return 'NEG'; if (inList(ntm)) return 'NT';
  var r=(results||'').toLowerCase();
  if(r==='negative'||r==='neg') return 'NEG'; if(r==='positive'||r==='pos') return 'POS';
  return '';
}

function getAllUAEntries() {
  var all = [];
  function parse(e, date, shift) {
    if (!e.text || e.text.toLowerCase().indexOf('ua conducted on') !== 0) return;
    var m = e.text.match(/UA conducted on (.+?) \(Rm\. (.+?)\) by (.+?)\. Reason: (.+?)\. Results: (.+?)\.?$/i);
    if (!m) return;
    all.push({id:e.id,date:date,shift:shift,time:e.time||'',name:m[1],room:m[2],staff:m[3],reason:m[4],results:m[5],ua_photo:e.ua_photo||null});
  }
  (REPORTS||[]).forEach(function(r){ (r.log_entries||[]).forEach(function(e){ parse(e,r.report_date,r.shift); }); });
  all.sort(function(a,b){ return (b.date||'').localeCompare(a.date||'')||(b.time||'').localeCompare(a.time||''); });
  return all;
}

function renderUAReport() {
  try {
    var wrap = document.getElementById('uar-table-wrap'); if (!wrap) return;
    var all = getAllUAEntries();
    var fc=(document.getElementById('uar-client')||{value:''}).value||'';
    var fs=(document.getElementById('uar-shift')||{value:''}).value||'';
    var fr=(document.getElementById('uar-reason')||{value:''}).value||'';
    var ff=(document.getElementById('uar-result')||{value:''}).value||'';
    var fd=(document.getElementById('uar-from')||{value:''}).value||'';
    var ft=(document.getElementById('uar-to')||{value:''}).value||'';
    var filtered = all.filter(function(ua){
      if(fc&&ua.name.toLowerCase().indexOf(fc.toLowerCase())===-1&&ua.room.toLowerCase().indexOf(fc.toLowerCase())===-1) return false;
      if(fs&&ua.shift!==fs) return false;
      if(fr&&ua.reason.indexOf(fr)===-1) return false;
      if(ff==='pos'&&!/POS:/.test(ua.results)) return false;
      if(ff==='neg'&&/POS:/.test(ua.results)) return false;
      if(fd&&ua.date<fd) return false;
      if(ft&&ua.date>ft) return false;
      return true;
    });
    filtered.sort(function(a,b){
      var av=_uar_sortCol.startsWith('sub_')?getSubResultRpt(a.results,_uar_sortCol.slice(4)):(a[_uar_sortCol]||'');
      var bv=_uar_sortCol.startsWith('sub_')?getSubResultRpt(b.results,_uar_sortCol.slice(4)):(b[_uar_sortCol]||'');
      return av<bv?_uar_sortDir:av>bv?-_uar_sortDir:0;
    });
    var cntEl=document.getElementById('uar-count'); if(cntEl) cntEl.textContent=filtered.length+' record'+(filtered.length!==1?'s':'');
    var subs=(window.UA_PANEL&&window.UA_PANEL.length)?window.UA_PANEL.map(function(code){return UA_SUBS_RPT.find(function(s){return s.code===code;})||{code:code,full:code};}):UA_SUBS_RPT;
    var withPos=filtered.filter(function(u){return /POS:/.test(u.results);}).length;
    var perSub=subs.map(function(sub){var n=filtered.filter(function(u){return getSubResultRpt(u.results,sub.code)==='POS';}).length;return n>0?'<strong style="color:#D4A017;">'+sub.code+':</strong> '+n+' POS':null;}).filter(Boolean).join(' &nbsp;&bull;&nbsp; ');
    var sumEl=document.getElementById('uar-summary');
    if(sumEl) sumEl.innerHTML='<span>Total: <strong style="color:#fff;">'+filtered.length+'</strong></span>'+(withPos?'<span>Positives: <strong style="color:#FCA5A5;">'+withPos+'</strong></span>':'')+(perSub?'<span style="font-size:.75rem;">'+perSub+'</span>':'');
    var _canDelUA = typeof hasPerm === 'function' && hasPerm('ua.delete');
    var thead='<thead><tr style="background:#1A3327;">'+'<th style="background:#1A3327;color:#A8D5B5;padding:8px 6px;font-size:.65rem;font-weight:700;width:90px;">PHOTO</th>'+['date','shift','time','name','room','staff','reason'].map(function(col){var labels={date:'DATE',shift:'SHIFT',time:'TIME',name:'CLIENT',room:'RM',staff:'STAFF',reason:'REASON'};var active=_uar_sortCol===col;return '<th class="uar-sort" data-col="'+col+'" style="background:#1A3327;color:#A8D5B5;padding:8px;font-size:.65rem;font-weight:700;cursor:pointer;white-space:nowrap;">'+labels[col]+(active?(_uar_sortDir===1?' &#8593;':' &#8595;'):'')+'</th>';}).join('')+subs.map(function(sub){var active=_uar_sortCol==='sub_'+sub.code;return '<th class="uar-sort" data-col="sub_'+sub.code+'" style="background:#1A3327;color:#A8D5B5;padding:7px 5px;font-size:.63rem;font-weight:700;text-align:center;cursor:pointer;white-space:nowrap;">'+sub.code+'<br><span style="font-size:.55rem;font-weight:400;opacity:.7;">'+sub.full+'</span>'+(active?(_uar_sortDir===1?' &#8593;':' &#8595;'):'')+'</th>';}).join('')+(_canDelUA?'<th style="background:#1A3327;color:#A8D5B5;padding:8px 6px;font-size:.65rem;font-weight:700;width:44px;"></th>':'')+'</tr></thead>';
    var rows=filtered.length?filtered.map(function(ua,ri){
      var hasPos=subs.some(function(sub){return getSubResultRpt(ua.results,sub.code)==='POS';});
      var rowBg=hasPos?'#FFF5F5':(ri%2===0?'#F4FAF6':'#fff');
      var border=hasPos?'border-left:4px solid #DC2626;':'';
      var fd2=ua.date?new Date(ua.date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'--';
      var photoCell=ua.ua_photo?'<td style="padding:4px 6px;"><button onclick="viewUAPhotoInReport('+ua.id+')" style="background:#fee2e2;border:1px solid #fca5a5;color:#991b1b;border-radius:6px;padding:3px 10px;font-size:.75rem;font-weight:700;cursor:pointer;white-space:nowrap;">Show Photo</button></td>':'<td style="padding:4px 6px;text-align:center;color:#D1D5DB;font-size:.8rem;">--</td>';
      var subCells=subs.map(function(sub){var v=getSubResultRpt(ua.results,sub.code);var bg=v==='POS'?'#FEE2E2':v==='NEG'?'#D8F3DC':v==='NT'?'#F1F5F9':'';var col=v==='POS'?'#991B1B':v==='NEG'?'#15803D':v==='NT'?'#94A3B8':'#D1D5DB';return '<td style="text-align:center;padding:4px 5px;font-size:.75rem;font-weight:700;color:'+col+';background:'+bg+';">'+(v||'--')+'</td>';}).join('');
      var delCell=_canDelUA&&ua.id?'<td style="padding:4px 6px;text-align:center;"><button onclick="deleteUAEntry('+ua.id+')" style="background:none;border:none;cursor:pointer;color:#DC2626;font-size:1.15rem;line-height:1;padding:2px 6px;border-radius:4px;" title="Delete entry">&times;</button></td>':'';
      return '<tr style="border-bottom:1px solid #E2E8F0;background:'+rowBg+';'+border+'">'+photoCell+'<td style="padding:6px 8px;font-size:.78rem;white-space:nowrap;">'+fd2+'</td><td style="padding:6px 8px;font-size:.76rem;color:#4B5563;white-space:nowrap;">'+(ua.shift||'').replace(' Shift','')+'</td><td style="padding:6px 8px;font-family:monospace;font-size:.78rem;color:#2D6A4F;white-space:nowrap;">'+esc(ua.time)+'</td><td style="padding:6px 8px;font-weight:700;">'+esc(ua.name)+'</td><td style="padding:6px 8px;font-family:monospace;font-size:.78rem;text-align:center;">'+esc(ua.room)+'</td><td style="padding:6px 8px;font-size:.8rem;color:#4B5563;">'+esc(ua.staff)+'</td><td style="padding:6px 8px;font-size:.8rem;color:#4B5563;">'+esc(ua.reason)+'</td>'+subCells+delCell+'</tr>';
    }).join(''):'<tr><td colspan="'+(8+subs.length+(_canDelUA?1:0))+'" style="text-align:center;padding:28px;color:#94A3B8;font-style:italic;">'+(all.length===0?'No UA records found in any shift report.':'No records match the current filters.')+'</td></tr>';
    wrap.innerHTML='<table style="width:100%;border-collapse:collapse;">'+thead+'<tbody>'+rows+'</tbody></table>';
    wrap.querySelectorAll('.uar-sort').forEach(function(th){th.addEventListener('click',function(){var col=this.dataset.col;if(_uar_sortCol===col)_uar_sortDir*=-1;else{_uar_sortCol=col;_uar_sortDir=1;}renderUAReport();});});
  } catch(e) { var w=document.getElementById('uar-table-wrap');if(w)w.innerHTML='<div style="padding:20px;color:#DC2626;">Error: '+e.message+'</div>'; }
}

async function deleteUAEntry(id) {
  if (!confirm('Permanently delete this UA log entry? This cannot be undone.')) return;
  try {
    var res = await fetch('/api/log/' + id, {method:'DELETE', credentials:'include'});
    var data = await res.json();
    if (data.error) { alert('Error: ' + data.error); return; }
    // Remove from all in-memory reports so the UI reflects the change
    (REPORTS||[]).forEach(function(r){
      r.log_entries = (r.log_entries||[]).filter(function(e){ return e.id !== id; });
    });
    renderUAReport();
  } catch(e) { alert('Error deleting entry.'); }
}

function viewUAPhotoInReport(id) {
  var all = getAllUAEntries();
  var entry = all.find(function(u){ return u.id === id; });
  if (!entry || !entry.ua_photo) return;
  var p = entry.ua_photo;
  if (p === true || p === 1 || (typeof p === 'string' && !p.startsWith('data:'))) {
    _fetchAndShowUAPhoto(id);
  } else {
    _openPhotoOverlay(p);
  }
}

function clearUARFilters() {
  ['uar-client','uar-shift','uar-reason','uar-result','uar-from','uar-to'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  _uar_sortCol='date'; _uar_sortDir=-1; renderUAReport();
}

function printUAReport() {
  var fn=window.FACILITY_NAME||'ShiftPoint';
  var tableHtml=(document.getElementById('uar-table-wrap')||{}).innerHTML||'';
  var summaryHtml=(document.getElementById('uar-summary')||{}).innerHTML||'';
  var win=window.open('','_blank','width=1200,height=800');
  var fnSafe=String(fn).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>'+fnSafe+' \u2014 UA Report</title><style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Calibri,sans-serif;font-size:12px;padding:16px;}.hdr{background:#1A3327;color:#fff;padding:10px 16px;margin-bottom:8px;border-bottom:3px solid #D4A017;-webkit-print-color-adjust:exact;print-color-adjust:exact;}.sum{background:#1A3327;color:#A8D5B5;padding:6px 12px;font-size:.75rem;display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}table{width:100%;border-collapse:collapse;}th{background:#1A3327;color:#A8D5B5;font-size:.63rem;font-weight:700;padding:6px 5px;text-align:left;-webkit-print-color-adjust:exact;print-color-adjust:exact;}td{padding:5px;border-bottom:1px solid #E2E8F0;font-size:.78rem;}@media print{.no-print{display:none!important;}}</style></head><body><div class="no-print" style="margin-bottom:10px;"><button onclick="window.print()" style="background:#1A3327;color:#fff;border:none;padding:8px 16px;border-radius:6px;font-weight:700;cursor:pointer;">&#128424; Print / Save PDF</button></div><div class="hdr"><div style="font-size:1rem;font-weight:800;">'+fnSafe+' \u2014 UA Log Report</div><div style="font-size:.65rem;color:#A8D5B5;letter-spacing:.08em;">ShiftPoint \u00b7 Deployed for Westside Community Services / PDEC</div></div><div class="sum">'+summaryHtml+'</div>'+tableHtml+'</body></html>');
  win.document.close();
}

// ── Reports tab quick stats (legacy) ──────────────────────
function loadUAQuickStats() { renderUAReport(); }
