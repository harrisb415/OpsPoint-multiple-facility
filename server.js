/**
 * OpsPoint — Server v2.3.7
 * SQLite + HTTPS + Session Auth + Role-based access
 */
'use strict';
const http    = require('http');
const https   = require('https');
const express = require('express');
const session = require('express-session');
const WebSocket = require('ws');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const db      = require('./db');

// ── Modular foundation (Part A refactor — see server/ARCHITECTURE.md) ──────
// Pure, low-coupling pieces extracted from this file. Behaviour is identical;
// these are the seams the cloud migration (config, real-time backplane) needs.
const config = require('./server/config');
const { hashPw, verifyPw, validatePw } = require('./server/lib/crypto');
const { nowLocal, timeToMins }         = require('./server/lib/time');
const { getLocalIP }                   = require('./server/lib/net');
const { sanitizeText: _sanitizeText, validTime: _validTime } = require('./server/lib/text');
const { broadcast, setWss }            = require('./server/realtime/broadcast');
const { securityHeaders, cors }        = require('./server/middleware/security');
const { csrfCheck, originHost }        = require('./server/middleware/csrf');
const { audit, auditRead }             = require('./server/middleware/audit');
const { userPerms: _userPerms, requireAuth, requirePermission, requireAnyPermission } = require('./server/middleware/auth');
const { idleSessionCheck, requireForceChangePw } = require('./server/middleware/session');
const { loginRateCheck, loginRateClear, apiRateCheck } = require('./server/middleware/rateLimit');

const app  = express();
app.disable('x-powered-by');
const PORT = config.PORT;
const BASE = config.BASE;

const DATA           = config.DATA_DIR;
const DB_PATH        = config.DB_PATH;
const LEGACY_DB_PATH = config.LEGACY_DB_PATH;

// One-time rename: data/shift.db → data/opspoint.db (legacy DB filename)
try {
  if (fs.existsSync(LEGACY_DB_PATH) && !fs.existsSync(DB_PATH)) {
    fs.renameSync(LEGACY_DB_PATH, DB_PATH);
    const shm = LEGACY_DB_PATH + '-shm', wal = LEGACY_DB_PATH + '-wal';
    if (fs.existsSync(shm)) fs.renameSync(shm, DB_PATH + '-shm');
    if (fs.existsSync(wal)) fs.renameSync(wal, DB_PATH + '-wal');
    console.log('  Migrated legacy DB: shift.db → opspoint.db');
  }
} catch (e) { console.warn('  DB rename failed:', e.message); }
// React SPA — always served
const REACT_DIST = config.REACT_DIST;
const serveSPA = (res) => res.sendFile(path.join(REACT_DIST, 'index.html'));

fs.mkdirSync(DATA,             { recursive:true });
fs.mkdirSync(config.PHOTOS_DIR,{ recursive:true });

// Password helpers (hashPw/verifyPw/validatePw), time helpers (nowLocal/
// timeToMins), getLocalIP, and broadcast now live in ./server/lib +
// ./server/realtime and are required at the top of this file.
let wss;  // the live WebSocket.Server; handed to the broadcast module via setWss()

// Restart the server. Under the bootstrap supervisor (run.bat → bootstrap.js,
// sets OPSPOINT_BOOTSTRAP=1) we simply exit and let bootstrap relaunch +
// health-check + auto-rollback. Launched directly (dev), self-respawn detached.
function restartServer() {
  if (process.env.OPSPOINT_BOOTSTRAP === '1') { setTimeout(() => process.exit(0), 200); return; }
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, [path.join(BASE, 'server.js')], { detached: true, stdio: 'ignore', cwd: BASE });
  child.unref();
  process.exit(0);
}

// ── Middleware ───────────────────────────────────────────────────
// Request guards (securityHeaders, cors, csrfCheck, audit, requireAuth,
// requirePermission(+Any), idleSessionCheck, requireForceChangePw, login
// rate-limit) now live in ./server/middleware and are required up top.

app.use(securityHeaders);
app.use(express.json({ limit: config.JSON_LIMIT })); // large limit needed for base64 photo uploads
app.use(cors);

const SESSION_SECRET = config.loadSessionSecret();

// Force-change middleware applied after session
var _sessionMiddleware = null;
function buildSession(secure) {
  return session({
    secret:SESSION_SECRET, resave:false, saveUninitialized:false,
    cookie:{ secure:!!secure, httpOnly:true, sameSite:'lax', maxAge:config.SESSION_MAX_AGE_MS }
  });
}
_sessionMiddleware = buildSession(false);
app.use((req,res,next) => _sessionMiddleware(req,res,next));

app.use(idleSessionCheck);  // HIPAA idle timeout — server/middleware/session.js

// Lightweight passive endpoint — client can poll this to check session validity
// without bumping last_activity. (POST /api/heartbeat bumps activity.)
app.get('/api/heartbeat', (req,res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ok:false});
  res.json({ok:true, idleMins:parseInt(db.getSetting('session_idle_mins',config.SESSION_IDLE_DEFAULT_MINS))||config.SESSION_IDLE_DEFAULT_MINS});
});

app.use(requireForceChangePw);  // forced-password-change gate — server/middleware/session.js

// _validTime / _sanitizeText now live in ./server/lib/text (required up top).
// Is the named report closed? Used to gate edits to sealed shift reports.
function _isReportClosed(reportId) {
  const r = db.query1('SELECT is_closed FROM reports WHERE id=?', [reportId]);
  return !!(r && r.is_closed);
}

// ── Admin count helper — counts users with admin.users permission ─
function _countAdmins(excludeUserId) {
  return db.query('SELECT id,permissions FROM users',[]).filter(function(u){
    if(excludeUserId!=null&&u.id===excludeUserId) return false;
    try{return JSON.parse(u.permissions||'[]').includes('admin.users');}catch(e){return false;}
  }).length;
}

// audit / csrfCheck / loginRateCheck / loginRateClear now live in
// ./server/middleware (audit.js, csrf.js, rateLimit.js) — required up top.

// ── Login ────────────────────────────────────────────────────────
// Login / logout — React SPA handles the UI
app.get('/login',(req,res)=>{
  if(req.session&&req.session.userId) return res.redirect('/');
  serveSPA(res);
});

app.post('/logout', csrfCheck, (req,res)=>{
  audit(req,'auth.logout','user',req.session.userId,req.session.displayName||req.session.username);
  req.session.destroy(()=>res.json({ok:true}));
});


// ── Force password change ────────────────────────────────────
app.get('/change-password', requireAuth, (req, res) => serveSPA(res));

app.post('/api/force-change-password', requireAuth, csrfCheck, (req, res) => {
  // H2: Only usable when the account is actually in must_change_pw state
  if (!req.session.must_change_pw)
    return res.status(403).json({error:'Not applicable'});
  const{newPassword}=req.body;
  if(!newPassword) return res.status(400).json({error:'Password required'});
  const err=validatePw(newPassword); if(err) return res.status(400).json({error:err});
  const{hash,salt}=hashPw(newPassword);
  db.run('UPDATE users SET hash=?,salt=?,must_change_pw=0 WHERE id=?',[hash,salt,req.session.userId]);
  db.save();
  audit(req,'auth.pw_change','user',req.session.userId,req.session.displayName||req.session.username,{type:'forced_change'});
  req.session.must_change_pw=false;
  res.json({ok:true});
});

// ── Page routes (React SPA handles client-side routing) ──────────
app.get('/', requireAuth, (req,res)=> serveSPA(res));
app.get('/facility', requireAuth, (req,res)=> res.redirect('/admin'));
app.get('/admin', requireAuth, requirePermission('admin.users'), (req,res)=> serveSPA(res));
app.get('/mobile', requireAuth, requirePermission('mobile.access'), (req,res)=> serveSPA(res));
app.get('/about', requireAuth, (req,res)=> serveSPA(res));
app.use('/static/icons', express.static(path.join(BASE,'static','icons'))); // public (favicon on login page)
app.use('/static', requireAuth, express.static(path.join(BASE,'static')));
app.get('/sw.js',(req,res)=>{
  // Unregisters any legacy service worker from the vanilla build
  res.setHeader('Content-Type','application/javascript');
  res.setHeader('Service-Worker-Allowed','/');
  res.send('self.addEventListener("install",()=>self.skipWaiting());self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.map(n=>caches.delete(n)))).then(()=>self.registration.unregister()));});');
});

// ── React SPA static assets (served early — won't conflict with API routes) ──
app.use(express.static(REACT_DIST));

// ── Users API ─────────────────────────────────────────────────────
app.get('/api/users', requireAuth, requirePermission('admin.users'),(req,res)=>{
  const rows = db.query('SELECT id,username,display_name,role,created_at,permissions,is_protected,must_change_pw FROM users ORDER BY id');
  res.json(rows.map(u=>{
    let perms = null;
    try { perms = u.permissions ? JSON.parse(u.permissions) : db.ROLE_PRESETS[u.role]||[]; } catch(e) { perms = db.ROLE_PRESETS[u.role]||[]; }
    const groups = db.getUserGroups(u.id).map(g=>({id:g.id,key:g.key,label:g.label}));
    return {id:u.id,username:u.username,displayName:u.display_name,role:u.role,createdAt:u.created_at,permissions:perms,is_protected:!!u.is_protected,must_change_pw:!!u.must_change_pw,groups};
  }));
});
app.post('/api/users', requireAuth, csrfCheck, requirePermission('admin.users'),(req,res)=>{
  const{username,displayName,password,role,groupIds}=req.body;
  if(!username||!password||!role) return res.status(400).json({error:'Missing fields'});
  // Role can be any group key or any existing role value
  const err=validatePw(password); if(err) return res.status(400).json({error:err});
  if(db.query1('SELECT id FROM users WHERE LOWER(username)=LOWER(?)',[username]))
    return res.status(409).json({error:'Username already exists'});
  const{hash,salt}=hashPw(password);
  // Compute permissions from selected groups, or fall back to role preset
  const validGroupIds = Array.isArray(groupIds) ? groupIds.filter(gid=>db.query1('SELECT id FROM groups WHERE id=?',[gid])) : [];
  const perms = validGroupIds.length>0 ? db.computeGroupsPermissions(validGroupIds) : (db.ROLE_PRESETS[role]||[]);
  // must_change_pw=1 — all new accounts must set their own password on first login
  db.run('INSERT INTO users (username,display_name,role,hash,salt,permissions,must_change_pw) VALUES (?,?,?,?,?,?,1)',
    [username,displayName||username,role,hash,salt,JSON.stringify(perms)]);
  db.save();
  const _newU=db.query1('SELECT id FROM users WHERE LOWER(username)=LOWER(?)',[username]);
  if(_newU && validGroupIds.length>0) db.setUserGroups(_newU.id, validGroupIds);
  audit(req,'user.add','user',_newU?_newU.id:null,displayName||username,{username,role,groupIds:validGroupIds});
  res.json({ok:true});
});
app.put('/api/users/:id', requireAuth, csrfCheck, requirePermission('admin.users'),(req,res)=>{
  const id=parseInt(req.params.id);
  if(!db.query1('SELECT id FROM users WHERE id=?',[id])) return res.status(404).json({error:'Not found'});
  const{displayName,password,role,permissions}=req.body;
  if(displayName) db.run('UPDATE users SET display_name=? WHERE id=?',[displayName,id]);
  // Allow any role key that exists in the current permission profiles
  if(role){
    const validRoles=db.getPermissionProfiles().map(p=>p.key);
    if(validRoles.includes(role)) db.run('UPDATE users SET role=? WHERE id=?',[role,id]);
  }
  let permissionsChanged=false;
  let perms=null;
  if(Array.isArray(permissions)){
    const tgtU=db.query1('SELECT is_protected,permissions FROM users WHERE id=?',[id]);
    perms = permissions.filter(p=>db.PERMISSIONS.includes(p));
    // Prevent removing admin.users from last admin
    const hadAdmin = tgtU && JSON.parse(tgtU.permissions||'[]').includes('admin.users');
    const willHaveAdmin = perms.includes('admin.users');
    if(hadAdmin && !willHaveAdmin && _countAdmins(id)===0)
      return res.status(400).json({error:'Cannot remove administrator access from the last administrator.'});
    // Prevent self-removal of own admin access
    if(id===req.session.userId && hadAdmin && !willHaveAdmin)
      return res.status(400).json({error:'You cannot remove your own administrator access.'});
    db.run('UPDATE users SET permissions=? WHERE id=?',[JSON.stringify(perms),id]);
    permissionsChanged=true;
  }
  if(password){
    const err=validatePw(password); if(err) return res.status(400).json({error:err});
    const{hash,salt}=hashPw(password);
    // Mark must_change_pw=1 when admin resets another user's password
    const isOwnPw = (id === req.session.userId);
    db.run('UPDATE users SET hash=?,salt=?,must_change_pw=? WHERE id=?',[hash,salt,isOwnPw?0:1,id]);
  }
  db.save();
  // Notify affected user's active sessions to reload and get fresh permissions
  if(permissionsChanged) broadcast({type:'permissions_updated',userId:id});
  const _tgtU=db.query1('SELECT username,display_name FROM users WHERE id=?',[id]);
  const _tgtName=_tgtU?(_tgtU.display_name||_tgtU.username):String(id);
  if(permissionsChanged) audit(req,'user.perm_change','user',id,_tgtName,{permissions:perms});
  if(role){const _vr=db.getPermissionProfiles().map(p=>p.key);if(_vr.includes(role))audit(req,'user.role_change','user',id,_tgtName,{role});}
  if(password&&id!==req.session.userId) audit(req,'user.pw_reset','user',id,_tgtName);
  if(password&&id===req.session.userId) audit(req,'auth.pw_change','user',id,_tgtName,{type:'self_change'});
  if(displayName&&!permissionsChanged&&!password) audit(req,'user.edit','user',id,_tgtName,{displayName});
  res.json({ok:true});
});
app.delete('/api/users/:id', requireAuth, csrfCheck, requirePermission('admin.users'),(req,res)=>{
  const id=parseInt(req.params.id);
  if(id===req.session.userId) return res.status(400).json({error:'You cannot delete your own account.'});
  const _delU=db.query1('SELECT username,display_name,is_protected,permissions FROM users WHERE id=?',[id]);
  if(!_delU) return res.status(404).json({error:'User not found'});
  if(_delU.is_protected) return res.status(403).json({error:'This is a protected account and cannot be deleted.'});
  try {
    if(JSON.parse(_delU.permissions||'[]').includes('admin.users')&&_countAdmins(id)===0)
      return res.status(400).json({error:'Cannot delete the last administrator account.'});
  } catch(e){}
  db.run('DELETE FROM users WHERE id=?',[id]); db.save();
  audit(req,'user.delete','user',id,_delU.display_name||_delU.username);
  broadcast({type:'user_deleted',userId:id});
  res.json({ok:true});
});

app.put('/api/users/:id/protect', requireAuth, csrfCheck, requirePermission('admin.users'),(req,res)=>{
  const id=parseInt(req.params.id);
  if(id===req.session.userId) return res.status(400).json({error:'You cannot protect your own account.'});
  const u=db.query1('SELECT id,display_name,username,is_protected FROM users WHERE id=?',[id]);
  if(!u) return res.status(404).json({error:'User not found'});
  const newVal=u.is_protected?0:1;
  db.run('UPDATE users SET is_protected=? WHERE id=?',[newVal,id]);
  db.save();
  audit(req,'user.protect','user',id,u.display_name||u.username,{protected:newVal===1});
  res.json({ok:true,protected:newVal===1});
});

// ── Permission profiles ───────────────────────────────────────────
app.get('/api/permission-profiles', requireAuth, requirePermission('admin.users'),(req,res)=>{
  res.json(db.getPermissionProfiles());
});
app.put('/api/permission-profiles', requireAuth, csrfCheck, requirePermission('admin.users'),(req,res)=>{
  const profiles=req.body;
  if(!Array.isArray(profiles)||!profiles.length) return res.status(400).json({error:'Expected non-empty array'});
  for(const p of profiles){
    if(!p.key||typeof p.key!=='string'||!p.label||!Array.isArray(p.permissions))
      return res.status(400).json({error:'Invalid profile format'});
    if(!/^[a-z][a-z0-9_]{0,49}$/.test(p.key))
      return res.status(400).json({error:'Invalid profile key: '+p.key});
    p.permissions=p.permissions.filter(x=>db.PERMISSIONS.includes(x));
  }
  db.setPermissionProfiles(profiles);
  db.save();
  audit(req,'profile.edit','settings',null,'Permission Profiles',{count:profiles.length,profiles:profiles.map(p=>p.key)});
  res.json({ok:true});
});
// ── Groups API ────────────────────────────────────────────────────
app.get('/api/groups', requireAuth, requirePermission('admin.users'),(req,res)=>{
  const groups = db.getGroups();
  res.json(groups.map(g=>{
    const cnt=db.query1('SELECT COUNT(*) as c FROM user_groups WHERE group_id=?',[g.id]);
    return {...g, memberCount: cnt?cnt.c:0};
  }));
});
app.post('/api/groups', requireAuth, csrfCheck, requirePermission('admin.users'),(req,res)=>{
  const{key,label,permissions}=req.body;
  if(!key||!label) return res.status(400).json({error:'Key and label required'});
  if(!/^[a-z][a-z0-9_]{0,49}$/.test(key)) return res.status(400).json({error:'Key must start with a letter and use only lowercase letters, numbers, underscores'});
  if(db.query1('SELECT id FROM groups WHERE key=?',[key])) return res.status(409).json({error:'A group with that key already exists'});
  const g=db.createGroup(key,label,Array.isArray(permissions)?permissions:[]);
  audit(req,'group.create','group',g?g.id:null,label,{key});
  res.json({ok:true,id:g?g.id:null});
});
app.put('/api/groups/:id', requireAuth, csrfCheck, requirePermission('admin.users'),(req,res)=>{
  const id=parseInt(req.params.id);
  const g=db.query1('SELECT * FROM groups WHERE id=?',[id]);
  if(!g) return res.status(404).json({error:'Group not found'});
  const{label,permissions}=req.body;
  if(!label) return res.status(400).json({error:'Label required'});
  db.updateGroup(id,label,Array.isArray(permissions)?permissions:[]);
  const members=db.query('SELECT user_id FROM user_groups WHERE group_id=?',[id]);
  members.forEach(m=>broadcast({type:'permissions_updated',userId:m.user_id}));
  audit(req,'group.edit','group',id,label,{permCount:(permissions||[]).length});
  res.json({ok:true});
});
app.delete('/api/groups/:id', requireAuth, csrfCheck, requirePermission('admin.users'),(req,res)=>{
  const id=parseInt(req.params.id);
  const g=db.query1('SELECT * FROM groups WHERE id=?',[id]);
  if(!g) return res.status(404).json({error:'Group not found'});
  if(g.is_protected) return res.status(403).json({error:'This group is protected and cannot be deleted.'});
  const affectedIds=db.deleteGroup(id);
  affectedIds.forEach(uid=>broadcast({type:'permissions_updated',userId:uid}));
  audit(req,'group.delete','group',id,g.label);
  res.json({ok:true});
});
app.put('/api/users/:id/groups', requireAuth, csrfCheck, requirePermission('admin.users'),(req,res)=>{
  const id=parseInt(req.params.id);
  const u=db.query1('SELECT id,display_name,username FROM users WHERE id=?',[id]);
  if(!u) return res.status(404).json({error:'User not found'});
  const{groupIds}=req.body;
  if(!Array.isArray(groupIds)) return res.status(400).json({error:'groupIds must be an array'});
  for(const gid of groupIds){
    if(!db.query1('SELECT id FROM groups WHERE id=?',[gid]))
      return res.status(400).json({error:'Invalid group ID: '+gid});
  }
  const currentPerms=db.getUserEffectivePermissions(id);
  const newPerms=db.computeGroupsPermissions(groupIds);
  const hadAdmin=currentPerms.includes('admin.users');
  const willHaveAdmin=newPerms.includes('admin.users');
  if(hadAdmin&&!willHaveAdmin&&_countAdmins(id)===0)
    return res.status(400).json({error:'Cannot remove administrator access from the last administrator.'});
  if(id===req.session.userId&&hadAdmin&&!willHaveAdmin)
    return res.status(400).json({error:'You cannot remove your own administrator access.'});
  db.setUserGroups(id,groupIds);
  broadcast({type:'permissions_updated',userId:id});
  audit(req,'user.groups_change','user',id,u.display_name||u.username,{groupIds});
  res.json({ok:true});
});

app.post('/api/users/me/password', requireAuth, csrfCheck,(req,res)=>{
  if(apiRateCheck(req)) return res.status(429).json({error:'Too many requests'});
  const{currentPassword,newPassword}=req.body;
  if(!currentPassword||!newPassword) return res.status(400).json({error:'Missing fields'});
  const err=validatePw(newPassword); if(err) return res.status(400).json({error:err});
  const u=db.query1('SELECT * FROM users WHERE id=?',[req.session.userId]);
  if(!u) return res.status(404).json({error:'User not found'});
  if(!verifyPw(currentPassword,u.hash,u.salt)) return res.status(401).json({error:'Current password incorrect'});
  const{hash,salt}=hashPw(newPassword);
  db.run('UPDATE users SET hash=?,salt=? WHERE id=?',[hash,salt,req.session.userId]);
  db.save();
  audit(req,'auth.pw_change','user',req.session.userId,req.session.displayName||req.session.username,{type:'self_change'});
  res.json({ok:true});
});

// ── Image magic-byte validator (VULN-13) ─────────────────────────
function _validImageMagicBytes(dataUri) {
  try {
    if (!dataUri || !dataUri.match(/^data:image\/(jpeg|jpg|png|gif|webp);base64,/i)) return false;
    const bytes = Buffer.from(dataUri.split(',')[1].slice(0, 12), 'base64');
    const isJpeg = bytes[0]===0xFF&&bytes[1]===0xD8&&bytes[2]===0xFF;
    const isPng  = bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4E&&bytes[3]===0x47;
    const isGif  = bytes[0]===0x47&&bytes[1]===0x49&&bytes[2]===0x46;
    const isWebp = bytes[8]===0x57&&bytes[9]===0x45&&bytes[10]===0x42&&bytes[11]===0x50;
    return isJpeg||isPng||isGif||isWebp;
  } catch(e) { return false; }
}

// API rate limiting (apiRateCheck) now lives in server/middleware/rateLimit.js

// ── Data API ──────────────────────────────────────────────────────
app.get('/api/data', requireAuth,(req,res)=>{
  if(apiRateCheck(req)) return res.status(429).json({error:'Too many requests'});
  res.json(db.getAllData(_userPerms(req)));
});

app.post('/api/data', requireAuth, csrfCheck,(req,res)=>{
  const d=req.body;
  if(apiRateCheck(req)) return res.status(429).json({error:'Too many requests'});

  // Per-section permission enforcement (was previously missing — any authenticated user could write)
  const _pu = db.query1('SELECT permissions,role FROM users WHERE id=?',[req.session.userId]);
  const _perms = (_pu && _pu.permissions) ? JSON.parse(_pu.permissions) : (db.ROLE_PRESETS[req.session.role]||[]);
  if (Array.isArray(d.clients) && d.clients.length > 0 && !_perms.includes('residents.edit') && !_perms.includes('facility.manage')) {
    return res.status(403).json({error:'Permission denied (residents.edit or facility.manage required)'});
  }
  if (Array.isArray(d.reports) && d.reports.length > 0) {
    const wantsClose = d.reports.some(r => r.is_closed);
    if (!_perms.includes('reports.create')) {
      return res.status(403).json({error:'Permission denied (reports.create required)'});
    }
    if (wantsClose && !_perms.includes('reports.close')) {
      return res.status(403).json({error:'Permission denied (reports.close required to close a shift)'});
    }
  }
  if (d.logos && !_perms.includes('admin.settings')) {
    return res.status(403).json({error:'Permission denied (admin.settings required to change logos)'});
  }

  if(Array.isArray(d.clients) && d.clients.length > 0) {
    // First: delete any VACANT rows for rooms that now have an active named resident
    const activeRooms = d.clients
      .filter(c=>c.is_active&&!c.is_special&&c.name!=='VACANT')
      .map(c=>c.room);
    const incomingIds = d.clients.map(c=>c.id).filter(Boolean);
    // Delete DB rows not present in incoming list (handles VACANT removal)
    const existingClients = db.query('SELECT id,name,room FROM clients');
    existingClients.forEach(ec => {
      if (!incomingIds.includes(ec.id)) {
        db.run('DELETE FROM clients WHERE id=?',[ec.id]);
      }
    });
    d.clients.forEach(c=>{
      let photo=c.photo;
      if(photo&&photo.startsWith('data:')){
        // VULN-13: Validate size (4 MB) and magic bytes before saving client photo
        if((photo.split(',')[1]||'').length > 5592406) { photo=null; }
        else if(!_validImageMagicBytes(photo)) { photo=null; }
        else photo=db.savePhoto(photo,`client_${String(c.id).replace(/[^a-zA-Z0-9_-]/g,'_')}.${photo.includes('gif')?'gif':'jpg'}`);
      }
      const ex=db.query1('SELECT id FROM clients WHERE id=?',[c.id]);
      if(ex) {
        db.run(`UPDATE clients SET room=?,name=?,case_manager=?,phone=?,photo=?,
          intake_date=?,discharge_date=?,is_special=?,is_active=?,special_label=?,sort_order=? WHERE id=?`,
          [c.room,c.name,c.case_manager||'',c.phone||'',photo||null,
           c.intake_date||null,c.discharge_date||null,c.is_special?1:0,c.is_active?1:0,
           c.special_label||null,c.sort_order||0,c.id]);
      } else {
        db.run(`INSERT INTO clients (id,room,name,case_manager,phone,photo,intake_date,
          discharge_date,is_special,is_active,special_label,sort_order)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [c.id,c.room,c.name,c.case_manager||'',c.phone||'',photo||null,
           c.intake_date||null,c.discharge_date||null,c.is_special?1:0,c.is_active?1:0,
           c.special_label||null,c.sort_order||0]);
      }
    });
  }
  if(Array.isArray(d.reports)) {
    for (const r of d.reports) {
      // VULN #2: never overwrite a closed (sealed) report
      if (r.id && _isReportClosed(r.id) && !r.is_closed) {
        // Existing is closed and client is trying to mutate (not just re-send the closed state)
        return res.status(403).json({error:`Report ${r.id} is closed (sealed). Cannot modify.`});
      }
      if (r.id && _isReportClosed(r.id) && r.is_closed) {
        // Both sides agree it's closed — no-op (skip upsert to prevent silent data swap)
        continue;
      }
      // VULN #3: sanitize user-supplied mod_name (100 chars, no control chars)
      if (r.mod_name != null) r.mod_name = _sanitizeText(r.mod_name, 100);
      // VULN #5: validate log entry times (regex H:MM AM/PM)
      if (Array.isArray(r.log_entries)) {
        for (const e of r.log_entries) {
          if (e.time && !_validTime(e.time)) {
            return res.status(400).json({error:`Invalid log entry time "${String(e.time).slice(0,20)}" — expected format H:MM AM/PM`});
          }
          if (e.text != null) e.text = _sanitizeText(e.text, 2000);
        }
      }
      // Sanitize other free-text fields
      if (r.shift != null) r.shift = _sanitizeText(r.shift, 50);
      db.upsertReport(r);
    }
  }
  if(d.active_report_id!==undefined) db.setSetting('active_report_id',d.active_report_id);
  db.save();
  if(Array.isArray(d.reports)) d.reports.forEach(function(r){
    const _act=r.is_closed?'report.close':'report.save';
    audit(req,_act,'report',r.id,(r.shift||'')+(r.report_date?' '+r.report_date:''));
  });
  if(Array.isArray(d.clients)&&d.clients.length>0) audit(req,'client.bulk_edit','client',null,d.clients.length+' clients');
  broadcast({type:'data_saved',user:req.session.displayName,
    active_report_id:db.getSetting('active_report_id',null)});
  res.json({ok:true});
});

app.patch('/api/data', requireAuth, csrfCheck,(req,res)=>{
  const patch=req.body;
  // Per-field permission checks — always read from DB for real-time enforcement
  const _pu2 = db.query1('SELECT permissions,role FROM users WHERE id=?',[req.session.userId]);
  const _patchPerms = (_pu2 && _pu2.permissions) ? JSON.parse(_pu2.permissions) : (db.ROLE_PRESETS[req.session.role]||[]);
  if (patch.statuses    && !_patchPerms.includes('status.edit')) return res.status(403).json({error:'Permission denied'});
  if (patch.log_entry   && !_patchPerms.includes('log.add'))     return res.status(403).json({error:'Permission denied'});
  if (patch.issues      !== undefined && !_patchPerms.includes('issues.edit')) return res.status(403).json({error:'Permission denied'});
  if (patch.med_notes   !== undefined && !_patchPerms.includes('issues.edit')) return res.status(403).json({error:'Permission denied'});
  if (patch.shiftData   && !_patchPerms.includes('reports.create')) return res.status(403).json({error:'Permission denied'});
  if (patch.last_ua          !== undefined && !_patchPerms.includes('ua.request'))   return res.status(403).json({error:'Permission denied'});
  if (patch.last_room_search !== undefined && !_patchPerms.includes('log.add'))      return res.status(403).json({error:'Permission denied'});
  const rptId=parseInt(patch.reportId);

  // VULN #1: reportId ownership — must be the active report
  if (rptId) {
    const activeReportId = parseInt(db.getSetting('active_report_id', null));
    if (!activeReportId || rptId !== activeReportId) {
      return res.status(403).json({error:'Cannot patch a report that is not currently active'});
    }
    // VULN #2: never patch a closed report
    if (_isReportClosed(rptId)) {
      return res.status(403).json({error:'Report is closed (sealed). Cannot modify.'});
    }
  }

  // VULN #5: log entry time format
  if (patch.log_entry && patch.log_entry.time && !_validTime(patch.log_entry.time)) {
    return res.status(400).json({error:`Invalid log entry time "${String(patch.log_entry.time).slice(0,20)}" — expected format H:MM AM/PM`});
  }
  // VULN #3: sanitize free-text shiftData fields
  if (patch.shiftData && typeof patch.shiftData === 'object') {
    if (patch.shiftData.mod_name != null) patch.shiftData.mod_name = _sanitizeText(patch.shiftData.mod_name, 100);
    if (patch.shiftData.shift     != null) patch.shiftData.shift     = _sanitizeText(patch.shiftData.shift, 50);
  }
  // Sanitize log entry text
  if (patch.log_entry && patch.log_entry.text != null) {
    patch.log_entry.text = _sanitizeText(patch.log_entry.text, 2000);
  }

  if(rptId) {
    if(patch.statuses){
      const cur=db.query1('SELECT statuses FROM reports WHERE id=?',[rptId]);
      if(cur){
        let s={}; try{s=JSON.parse(cur.statuses);}catch(e){}
        Object.assign(s,patch.statuses);
        db.run('UPDATE reports SET statuses=?,updated_at=? WHERE id=?',
          [JSON.stringify(s),new Date().toISOString(),rptId]);
      }
    }
    if(patch.log_entry){
      const e=patch.log_entry;
      const _leIns=db.run('INSERT INTO log_entries (report_id,time,text) VALUES (?,?,?)',
        [rptId,e.time||'',e.text||'']);
      patch._log_entry_id = _leIns.lastInsertRowid || null;
      db.run('UPDATE reports SET updated_at=? WHERE id=?',[new Date().toISOString(),rptId]);
    }
    if(patch.shiftData){
      const sd=patch.shiftData;
      if(sd.report_date||sd.shift||sd.mod_name){
        db.run(`UPDATE reports SET
          report_date=COALESCE(?,report_date),
          shift=COALESCE(?,shift),
          mod_name=COALESCE(?,mod_name),
          updated_at=? WHERE id=?`,
          [sd.report_date||null,sd.shift||null,sd.mod_name||null,new Date().toISOString(),rptId]);
      }
    }
    if(patch.issues!==undefined){
      db.run('UPDATE reports SET issues=?,updated_at=? WHERE id=?',
        [JSON.stringify(patch.issues),new Date().toISOString(),rptId]);
    }
    if(patch.med_notes!==undefined){
      db.run('UPDATE reports SET med_notes=?,updated_at=? WHERE id=?',
        [JSON.stringify(patch.med_notes),new Date().toISOString(),rptId]);
    }
    if(patch.last_ua && typeof patch.last_ua === 'object'){
      const cur=db.query1('SELECT last_ua FROM reports WHERE id=?',[rptId]);
      if(cur){ let u={}; try{u=JSON.parse(cur.last_ua||'{}')}catch(e){} Object.assign(u,patch.last_ua);
        db.run('UPDATE reports SET last_ua=?,updated_at=? WHERE id=?',[JSON.stringify(u),new Date().toISOString(),rptId]);
      }
    }
    if(patch.last_room_search && typeof patch.last_room_search === 'object'){
      const cur=db.query1('SELECT last_room_search FROM reports WHERE id=?',[rptId]);
      if(cur){ let u={}; try{u=JSON.parse(cur.last_room_search||'{}')}catch(e){} Object.assign(u,patch.last_room_search);
        db.run('UPDATE reports SET last_room_search=?,updated_at=? WHERE id=?',[JSON.stringify(u),new Date().toISOString(),rptId]);
      }
    }
    db.save();
  }
  if(patch.log_entry) audit(req,'log.add','log_entry',null,(patch.log_entry.text||'').slice(0,80),{reportId:rptId});
  if(patch.statuses)  audit(req,'status.edit','report',rptId,'Status update',{count:Object.keys(patch.statuses).length});
  if(patch.issues!==undefined)    audit(req,'issues.edit','report',rptId,'Issues update');
  if(patch.med_notes!==undefined) audit(req,'mednote.edit','report',rptId,'Med notes update');
  // H4: Only broadcast safe, known fields — never relay raw user-controlled patch
  const safePatch = {};
  if (patch.reportId) safePatch.reportId = parseInt(patch.reportId);
  if (patch.statuses && typeof patch.statuses === 'object') safePatch.statuses = patch.statuses;
  if (patch.log_entry && typeof patch.log_entry === 'object') {
    safePatch.log_entry = {
      time: String(patch.log_entry.time||'').slice(0,20),
      text: String(patch.log_entry.text||'').slice(0,2000)
    };
  }
  if (patch.shiftData && typeof patch.shiftData === 'object') {
    safePatch.shiftData = {
      report_date: patch.shiftData.report_date||null,
      shift: patch.shiftData.shift||null,
      mod_name: patch.shiftData.mod_name||null
    };
  }
  if (patch.issues !== undefined) safePatch.issues = patch.issues;
  if (patch.med_notes !== undefined) safePatch.med_notes = patch.med_notes;
  if (patch.last_ua && typeof patch.last_ua === 'object') safePatch.last_ua = patch.last_ua;
  if (patch.last_room_search && typeof patch.last_room_search === 'object') safePatch.last_room_search = patch.last_room_search;
  broadcast({type:'patched', patch:safePatch, user:req.session.displayName,
    active_report_id:db.getSetting('active_report_id',null)});
  res.json({ok:true, log_entry_id: patch._log_entry_id || null});
});

// Delete log entry — log.delete or ua.delete both grant access
app.delete('/api/log/:id', requireAuth, csrfCheck, requireAnyPermission('log.delete','ua.delete'),(req,res)=>{
  const id=parseInt(req.params.id);
  const _le=db.query1('SELECT text FROM log_entries WHERE id=?',[id]);
  db.run('DELETE FROM log_entries WHERE id=?',[id]);
  db.save();
  audit(req,'log.delete','log_entry',id,_le?(String(_le.text||'').slice(0,80)):String(id));
  broadcast({type:'data_saved',user:req.session.displayName});
  res.json({ok:true});
});

// ── Delete report ────────────────────────────────────────────────
app.delete('/api/reports/:id', requireAuth, csrfCheck, requirePermission('reports.delete'),(req,res)=>{
  const id=parseInt(req.params.id);
  const _rpt=db.query1('SELECT shift,report_date FROM reports WHERE id=?',[id]);
  if(!_rpt) return res.status(404).json({error:'Report not found'});
  db.run('DELETE FROM log_entries WHERE report_id=?',[id]);
  db.run('DELETE FROM reports WHERE id=?',[id]);
  db.save();
  audit(req,'report.delete','report',id,(_rpt.shift||'')+(_rpt.report_date?' '+_rpt.report_date:''));
  broadcast({type:'data_saved',user:req.session.displayName});
  res.json({ok:true});
});

// ── UA Photo ──────────────────────────────────────────────────────
// Helper: resolve a log entry for any authenticated user (VULN-6: existence validated)
function resolveLogEntry(id) {
  return db.query1('SELECT * FROM log_entries WHERE id=?',[id]) || null;
}
app.post('/api/log/:id/photo', requireAuth, csrfCheck,(req,res)=>{
  const id=parseInt(req.params.id);
  // VULN-6: Verify log entry exists and belongs to an open report (IDOR prevention)
  const le = db.query1('SELECT le.id, r.is_closed FROM log_entries le JOIN reports r ON r.id=le.report_id WHERE le.id=?',[id]);
  if (!le) return res.status(404).json({error:'Log entry not found'});
  if (le.is_closed) return res.status(403).json({error:'Cannot modify a closed report'});
  const{photo}=req.body;
  if(!photo) return res.status(400).json({error:'No photo'});
  // Validate it's actually an image data URI
  if(!photo.match(/^data:image\/(jpeg|jpg|png|gif|webp);base64,/i))
    return res.status(400).json({error:'Invalid image format'});
  const b64Portion = photo.split(',')[1] || '';
  if (b64Portion.length > 5592406) return res.status(400).json({error:'Image too large (max 4 MB)'});
  // Validate magic bytes (JPEG=FFD8FF, PNG=89504E47, GIF=47494638)
  try {
    const b64 = photo.split(',')[1];
    const bytes = Buffer.from(b64.slice(0,12),'base64');
    const isJpeg = bytes[0]===0xFF&&bytes[1]===0xD8&&bytes[2]===0xFF;
    const isPng  = bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4E&&bytes[3]===0x47;
    const isGif  = bytes[0]===0x47&&bytes[1]===0x49&&bytes[2]===0x46;
    const isWebp = bytes[8]===0x57&&bytes[9]===0x45&&bytes[10]===0x42&&bytes[11]===0x50;
    if(!isJpeg&&!isPng&&!isGif&&!isWebp)
      return res.status(400).json({error:'File does not appear to be an image'});
  } catch(e) { return res.status(400).json({error:'Invalid image data'}); }
  const fname='ua_'+id+'_'+Date.now()+'.jpg';
  const p=db.savePhoto(photo,fname);
  db.run('UPDATE log_entries SET ua_photo=? WHERE id=?',[p,id]);
  db.save();
  res.json({ok:true,photo:p});
});
app.get('/api/log/:id/photo', requireAuth,(req,res)=>{  // VULN-6: all roles may view UA photos
  const id=parseInt(req.params.id);
  const e=resolveLogEntry(id);
  if(!e||!e.ua_photo) return res.status(404).json({error:'No photo'});
  const b64=db.getPhotoB64(e.ua_photo);
  if(!b64) return res.status(404).json({error:'File missing'});
  res.json({ok:true,photo:b64});
});

// ── UA Log (log entries containing UA results) ────────────────────
app.get('/api/ua-log', requireAuth, (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)  || 200, 500);
  const offset = parseInt(req.query.offset) || 0;
  const rows = db.query(`
    SELECT le.id, le.text, le.time, le.ua_photo, le.created_at,
           r.report_date, r.shift, r.id AS report_id
    FROM log_entries le
    JOIN reports r ON r.id = le.report_id
    WHERE le.text LIKE '% — UA:%'
    ORDER BY r.report_date DESC, r.id DESC, le.id DESC
    LIMIT ? OFFSET ?
  `, [limit, offset]);
  res.json(rows || []);
});

// ── Facility settings ─────────────────────────────────────────────
app.get('/api/facility/settings', requireAuth,(req,res)=>{
  res.json({
    facility_name:          db.getSetting('facility_name',          'OpsPoint'),
    wellness_interval_mins: db.getSetting('wellness_interval_mins', 120),
    walk_interval_mins:     db.getSetting('walk_interval_mins',     240),
    walk_areas:             db.getSetting('walk_areas',             db.DEFAULT_WALK_AREAS),
    ua_panel:               db.getSetting('ua_panel',               db.DEFAULT_UA_PANEL),
    wellness_schedule:      db.getSetting('wellness_schedule',      []),
    walk_schedule:          db.getSetting('walk_schedule',          []),
    shift_day_start:        db.getSetting('shift_day_start',        '07:00'),
    shift_swing_start:      db.getSetting('shift_swing_start',      '15:00'),
    shift_grave_start:      db.getSetting('shift_grave_start',      '23:00'),
    ui_visibility:          db.getSetting('ui_visibility',          {tabs:{staff:true,chores:true,passes:true,caseloads:true,mail:true,reports:true,violations:true},buttons:{wellness:true,walkthrough:true}}),
  });
});
app.put('/api/facility/settings', requireAuth, csrfCheck, requirePermission('admin.settings'),(req,res)=>{
  const{facility_name,wellness_interval_mins,walk_interval_mins,
        walk_areas,ua_panel,wellness_schedule,walk_schedule,
        shift_day_start,shift_swing_start,shift_grave_start,ui_visibility}=req.body;
  if(!facility_name||!facility_name.trim()) return res.status(400).json({error:'Facility name required'});
  if(facility_name.trim().length > 200) return res.status(400).json({error:'Facility name too long (max 200 chars)'});
  db.setSetting('facility_name',facility_name.trim());
  if(wellness_interval_mins) db.setSetting('wellness_interval_mins',parseInt(wellness_interval_mins));
  if(walk_interval_mins)     db.setSetting('walk_interval_mins',    parseInt(walk_interval_mins));
  if(Array.isArray(walk_areas)&&walk_areas.length) db.setSetting('walk_areas',walk_areas.filter(a=>a.trim()));
  if(Array.isArray(ua_panel))               db.setSetting('ua_panel',ua_panel.filter(a=>a.trim()));
  if(Array.isArray(wellness_schedule))      db.setSetting('wellness_schedule',wellness_schedule);
  if(Array.isArray(walk_schedule))          db.setSetting('walk_schedule',walk_schedule);
  if(shift_day_start&&typeof shift_day_start==='string')   db.setSetting('shift_day_start',   shift_day_start.trim());
  if(shift_swing_start&&typeof shift_swing_start==='string') db.setSetting('shift_swing_start', shift_swing_start.trim());
  if(shift_grave_start&&typeof shift_grave_start==='string') db.setSetting('shift_grave_start', shift_grave_start.trim());
  if(ui_visibility && typeof ui_visibility==='object') db.setSetting('ui_visibility', ui_visibility);
  db.save();
  const settings={
    facility_name:          db.getSetting('facility_name'),
    wellness_interval_mins: db.getSetting('wellness_interval_mins'),
    walk_interval_mins:     db.getSetting('walk_interval_mins'),
    walk_areas:             db.getSetting('walk_areas'),
    ua_panel:               db.getSetting('ua_panel'),
    wellness_schedule:      db.getSetting('wellness_schedule'),
    walk_schedule:          db.getSetting('walk_schedule'),
    shift_day_start:        db.getSetting('shift_day_start'),
    shift_swing_start:      db.getSetting('shift_swing_start'),
    shift_grave_start:      db.getSetting('shift_grave_start'),
    ui_visibility:          db.getSetting('ui_visibility'),
  };
  broadcast({type:'settings_updated',settings});
  audit(req,'facility.settings','settings',null,'Facility Settings',{facility_name:facility_name.trim()});
  res.json({ok:true});
});

// ── Facility room management ──────────────────────────────────────
app.get('/api/facility/rooms', requireAuth, requirePermission('facility.manage'),(req,res)=>{
  res.json(db.query(`SELECT * FROM clients WHERE is_active=1 ORDER BY CAST(room AS INTEGER), room`));
});
app.get('/api/facility/rooms/vacant', requireAuth,(req,res)=>{
  // Only return rooms that have a VACANT placeholder AND no active non-vacant client
  res.json(db.query(
    `SELECT id,room,sort_order FROM clients
     WHERE name='VACANT' AND is_active=1 AND is_special=0
     AND room NOT IN (
       SELECT room FROM clients WHERE name!='VACANT' AND is_active=1 AND is_special=0
     )
     ORDER BY CAST(room AS INTEGER), room`));
});

// ── Add new client ─────────────────────────────────────────────
app.post('/api/clients', requireAuth, csrfCheck, requirePermission('residents.edit'),(req,res)=>{
  const{room,name,case_manager,phone,intake_date,
        referral_source,program_track,emergency_contacts,intake_notes}=req.body;
  if(!name||!String(name).trim()) return res.status(400).json({error:'Name is required'});
  if(!room||!String(room).trim())  return res.status(400).json({error:'Room is required'});
  // Block if a real (non-VACANT) resident already has this room
  const occ=db.query1(`SELECT name FROM clients WHERE room=? AND name!='VACANT' AND is_active=1 AND is_special=0`,[String(room)]);
  if(occ) return res.status(409).json({error:'Room '+room+' is already occupied by '+occ.name});
  const ecJson = Array.isArray(emergency_contacts) ? JSON.stringify(emergency_contacts) : '[]';
  // If a VACANT row exists for this room, update it in-place (avoids duplicates)
  const vacant=db.query1(`SELECT id FROM clients WHERE room=? AND name='VACANT' AND is_active=1`,[String(room)]);
  let resultId;
  if(vacant){
    db.run(`UPDATE clients SET name=?,case_manager=?,phone=?,intake_date=?,is_active=1,
            referral_source=?,program_track=?,emergency_contacts=?,intake_notes=? WHERE id=?`,
      [String(name).trim(),case_manager||'',phone||'',intake_date||null,
       referral_source||'', program_track||'', ecJson, intake_notes||'',
       vacant.id]);
    resultId=vacant.id;
  } else {
    const maxRow=db.query1('SELECT MAX(sort_order) AS m FROM clients');
    const sortOrder=(maxRow&&maxRow.m!=null?maxRow.m:0)+1;
    db.run(`INSERT INTO clients (room,name,case_manager,phone,intake_date,is_active,is_special,sort_order,
            referral_source,program_track,emergency_contacts,intake_notes)
      VALUES (?,?,?,?,?,1,0,?,?,?,?,?)`,
      [String(room),String(name).trim(),case_manager||'',phone||'',intake_date||null,sortOrder,
       referral_source||'', program_track||'', ecJson, intake_notes||'']);
    const newId=db.query1('SELECT last_insert_rowid() AS id');
    resultId=newId?newId.id:null;
  }
  // Add intake log entry to active shift report
  const _intakeActiveId = db.getSetting('active_report_id', null);
  if (_intakeActiveId) {
    const _n=new Date(),_h=_n.getHours(),_m=String(_n.getMinutes()).padStart(2,'0');
    const _ap=_h>=12?'PM':'AM',_h12=_h%12||12;
    const _ts=`${_h12}:${_m} ${_ap}`;
    let _intakeStr='';
    if(intake_date){try{const _d=new Date(intake_date+'T12:00:00');_intakeStr=' Intake: '+_d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+'.';}catch(e){}}
    db.run('INSERT INTO log_entries (report_id,time,text) VALUES (?,?,?)',
      [_intakeActiveId,_ts,`Resident admitted: ${String(name).trim()}, Rm. ${String(room)}.${_intakeStr}`]);
    db.run('UPDATE reports SET updated_at=? WHERE id=?',[new Date().toISOString(),_intakeActiveId]);
  }
  db.save();
  const newClient=resultId?db.query1('SELECT * FROM clients WHERE id=?',[resultId]):null;
  audit(req,'client.add','client',resultId,String(name).trim()+' Rm.'+String(room));
  broadcast({type:'data_saved',user:req.session.displayName||req.session.username});
  res.json({ok:true,id:resultId,client:newClient});
});

// ── Direct client update (all authenticated roles) ─────────────
app.put('/api/clients/:id', requireAuth, csrfCheck, requirePermission('residents.edit'),(req,res)=>{

  const id=parseInt(req.params.id,10);
  if(!db.query1('SELECT id FROM clients WHERE id=?',[id])) return res.status(404).json({error:'Not found'});
  const{room,name,case_manager,phone,intake_date,discharge_date,photo,is_active,
        referral_source,program_track,emergency_contacts,intake_notes}=req.body;
  if(name!==undefined&&!name.trim()) return res.status(400).json({error:'Name cannot be empty'});
  // Check room conflict if room is changing
  if(room!==undefined){
    const cur=db.query1('SELECT room,is_active FROM clients WHERE id=?',[id]);
    if(cur&&String(room)!==String(cur.room)){
      const occ=db.query1(
        `SELECT name FROM clients WHERE room=? AND name!='VACANT' AND is_active=1 AND is_special=0 AND id!=?`,
        [String(room),id]);
      if(occ) return res.status(409).json({error:'Room '+room+' is already occupied by '+occ.name});
    }
    // Remove any VACANT placeholder for the target room when the client is active (or being reactivated)
    const becomingActive = is_active !== undefined ? !!is_active : !!(cur && cur.is_active);
    if(becomingActive) {
      db.run(`DELETE FROM clients WHERE room=? AND name='VACANT' AND id!=?`,[String(room),id]);
    }
    db.run('UPDATE clients SET room=? WHERE id=?',[String(room),id]);
  }
  if(name!==undefined)          db.run('UPDATE clients SET name=? WHERE id=?',[name.trim(),id]);
  if(case_manager!==undefined)  db.run('UPDATE clients SET case_manager=? WHERE id=?',[case_manager,id]);
  if(phone!==undefined)         db.run('UPDATE clients SET phone=? WHERE id=?',[phone,id]);
  if(intake_date!==undefined)   db.run('UPDATE clients SET intake_date=? WHERE id=?',[intake_date||null,id]);
  if(discharge_date!==undefined)db.run('UPDATE clients SET discharge_date=? WHERE id=?',[discharge_date||null,id]);
  if(is_active!==undefined)     db.run('UPDATE clients SET is_active=? WHERE id=?',[is_active?1:0,id]);
  if(referral_source!==undefined)  db.run('UPDATE clients SET referral_source=? WHERE id=?',[String(referral_source||''),id]);
  if(program_track!==undefined)    db.run('UPDATE clients SET program_track=? WHERE id=?',[String(program_track||''),id]);
  if(emergency_contacts!==undefined) db.run('UPDATE clients SET emergency_contacts=? WHERE id=?',
    [JSON.stringify(Array.isArray(emergency_contacts)?emergency_contacts:[]),id]);
  if(intake_notes!==undefined)     db.run('UPDATE clients SET intake_notes=? WHERE id=?',[String(intake_notes||''),id]);
  if(photo!==undefined){
    let pval=null;
    if(photo&&typeof photo==='string'&&photo.startsWith('data:image/')){
      const b64Part=photo.split(',')[1]||'';
      if(b64Part.length<=5592406){
        try{
          const bytes=Buffer.from(b64Part.slice(0,12),'base64');
          const isJpeg=bytes[0]===0xFF&&bytes[1]===0xD8&&bytes[2]===0xFF;
          const isPng =bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4E&&bytes[3]===0x47;
          const isGif =bytes[0]===0x47&&bytes[1]===0x49&&bytes[2]===0x46;
          const isWebp=bytes[8]===0x57&&bytes[9]===0x45&&bytes[10]===0x42&&bytes[11]===0x50;
          if(isJpeg||isPng||isGif||isWebp){
            const ext=isGif?'gif':isPng?'png':isWebp?'webp':'jpg';
            pval=db.savePhoto(photo,`client_${id}.${ext}`);
          }
        }catch{}
      }
    }
    db.run('UPDATE clients SET photo=? WHERE id=?',[pval,id]);
  }
  db.save();
  const _clt=db.query1('SELECT * FROM clients WHERE id=?',[id]);
  audit(req,'client.edit','client',id,_clt?(_clt.name+' Rm.'+_clt.room):String(id),{fields:Object.keys(req.body)});
  broadcast({type:'data_saved',user:req.session.displayName||req.session.username});
  res.json({ok:true,client:_clt});
});
// ── Client profile view (audit gate — HIPAA §164.312(b)) ─────────────
app.get('/api/clients/:id/profile', requireAuth, (req,res)=>{
  if(apiRateCheck(req)) return res.status(429).json({error:'Too many requests'});
  const id=parseInt(req.params.id,10);
  if(isNaN(id)) return res.status(400).json({error:'Invalid id'});
  const c=db.query1('SELECT id,name,room FROM clients WHERE id=?',[id]);
  if(!c) return res.status(404).json({error:'Not found'});
  // auditRead is defined later in the file but hoisted as a function declaration
  audit(req,'record.read','client_profile',id,c.name+' Rm.'+c.room,'Profile drawer opened');
  res.json({ok:true});
});

app.put('/api/facility/rooms/:id', requireAuth, csrfCheck, requirePermission('facility.manage'),(req,res)=>{
  const id=parseInt(req.params.id);
  if(!db.query1('SELECT id FROM clients WHERE id=?',[id])) return res.status(404).json({error:'Not found'});
  const{room,name,is_special,special_label}=req.body;
  if(room!==undefined){
    const cur=db.query1('SELECT room FROM clients WHERE id=?',[id]);
    if(cur&&String(room)!==String(cur.room)){
      const dup=db.query1('SELECT id FROM clients WHERE room=? AND is_active=1 AND id!=?',[String(room),id]);
      if(dup) return res.status(409).json({error:'Room '+room+' already exists. Each room must have a unique number.'});
    }
    db.run('UPDATE clients SET room=? WHERE id=?',[String(room),id]);
  }
  if(name!==undefined) db.run('UPDATE clients SET name=? WHERE id=?',[name,id]);
  if(is_special!==undefined) db.run('UPDATE clients SET is_special=? WHERE id=?',[is_special?1:0,id]);
  if(special_label!==undefined) db.run('UPDATE clients SET special_label=? WHERE id=?',[special_label,id]);
  db.save();
  const _fr=db.query1('SELECT room FROM clients WHERE id=?',[id]);
  audit(req,'facility.room_edit','room',id,'Room '+(_fr?_fr.room:id));
  res.json({ok:true});
});
app.post('/api/facility/rooms', requireAuth, csrfCheck, requirePermission('facility.manage'),(req,res)=>{
  const{room,name,is_special,special_label}=req.body;
  if(!room) return res.status(400).json({error:'Room number required'});
  const dup=db.query1('SELECT id FROM clients WHERE room=? AND is_active=1',[String(room)]);
  if(dup) return res.status(409).json({error:'Room '+room+' already exists. Each room must have a unique number.'});
  const maxSort=db.query1('SELECT MAX(sort_order) as m FROM clients');
  const so=(maxSort&&maxSort.m!=null)?maxSort.m+1:0;
  db.run(`INSERT INTO clients (room,name,is_active,is_special,special_label,sort_order)
    VALUES (?,?,1,?,?,?)`,[String(room),name||'VACANT',is_special?1:0,special_label||null,so]);
  const newClient=db.query1('SELECT * FROM clients ORDER BY id DESC LIMIT 1');
  // Add intake log entry to active shift report when a named (non-VACANT) client is added
  if(name&&name!=='VACANT'&&!is_special){
    const activeId=db.getSetting('active_report_id',null);
    if(activeId){
      const _n=new Date(),_h=_n.getHours(),_m=String(_n.getMinutes()).padStart(2,'0');
      const _ap=_h>=12?'PM':'AM',_h12=_h%12||12;
      const _ts=`${_h12}:${_m} ${_ap}`;
      let _intakeStr='';
      if(newClient&&newClient.intake_date){
        try{
          const _d=new Date(newClient.intake_date+'T12:00:00');
          _intakeStr=' Intake: '+_d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+'.';
        }catch(e){}
      }
      db.run('INSERT INTO log_entries (report_id,time,text) VALUES (?,?,?)',
        [activeId,_ts,`New resident admitted: ${name}, Rm. ${String(room)}.${_intakeStr}`]);
      db.run('UPDATE reports SET updated_at=? WHERE id=?',[new Date().toISOString(),activeId]);
    }
  }
  db.save();
  audit(req,'facility.room_add','room',null,'Room '+String(room),{name:name||'VACANT',is_special:!!is_special});
  broadcast({type:'data_saved',user:req.session.displayName||req.session.username});
  res.json({ok:true,client:newClient});
});
app.delete('/api/facility/rooms/:id', requireAuth, csrfCheck, requirePermission('facility.manage'),(req,res)=>{
  const id=parseInt(req.params.id);
  const c=db.query1('SELECT * FROM clients WHERE id=?',[id]);
  if(!c) return res.status(404).json({error:'Not found'});
  if(c.is_active&&!c.is_special&&c.name!=='VACANT')
    return res.status(400).json({error:'Cannot delete active resident. Discharge first.'});
  db.run('DELETE FROM clients WHERE id=?',[id]); db.save();
  audit(req,'facility.room_delete','room',id,'Room '+c.room,{name:c.name});
  res.json({ok:true});
});
app.post('/api/facility/reorder', requireAuth, csrfCheck, requirePermission('facility.manage'),(req,res)=>{
  const{order}=req.body;
  if(!Array.isArray(order)) return res.status(400).json({error:'order must be array'});
  order.forEach((id,i)=>db.run('UPDATE clients SET sort_order=? WHERE id=?',[i,id]));
  db.save();
  audit(req,'facility.reorder','room',null,'Room reorder',{count:order.length});
  res.json({ok:true});
});
app.post('/api/facility/reset', requireAuth, csrfCheck, requirePermission('facility.manage'),(req,res)=>{
  const{rooms}=req.body;
  if(!Array.isArray(rooms)) return res.status(400).json({error:'rooms must be an array'});
  db.run('DELETE FROM clients');
  rooms.forEach((r,i)=>db.run(
    `INSERT INTO clients (room,name,is_active,is_special,special_label,sort_order) VALUES (?,?,1,?,?,?)`,
    [String(r.room),r.name||'VACANT',r.is_special?1:0,r.special_label||null,i]));
  db.save();
  audit(req,'facility.reset','room',null,'Roster reset',{count:rooms.length});
  broadcast({type:'data_saved',user:req.session.displayName});
  res.json({ok:true,count:rooms.length});
});

// ── Serve data photos (auth-protected) ───────────────────────────
app.get('/photos/:filename', requireAuth,(req,res)=>{
  const fname = path.basename(req.params.filename); // prevent traversal
  const full = path.join(DATA,'photos',fname);
  if(!fs.existsSync(full)) return res.status(404).json({error:'Not found'});
  res.sendFile(full);
});

app.get('/api/me', requireAuth,(req,res)=>{
  const _u = db.query1('SELECT permissions,role FROM users WHERE id=?',[req.session.userId]);
  const perms = (_u&&_u.permissions)?JSON.parse(_u.permissions):(db.ROLE_PRESETS[req.session.role]||[]);
  res.json({
    id:req.session.userId, username:req.session.username,
    displayName:req.session.displayName, role:req.session.role,
    permissions:perms, mustChangePw:!!req.session.must_change_pw
  });
});

// JSON login endpoint for React frontend
app.post('/api/login', express.json(), (req,res)=>{
  const loginOrigin = req.headers.origin;
  if (loginOrigin && originHost(loginOrigin) !== req.headers.host) {
    return res.status(403).json({error:'Forbidden'});
  }
  const ip = req.ip||req.connection.remoteAddress||'unknown';
  if (loginRateCheck(ip)) return res.status(429).json({error:'Too many login attempts. Wait 15 minutes.'});
  const {username,password} = req.body||{};
  const u = db.query1('SELECT * FROM users WHERE LOWER(username)=LOWER(?)',[username||'']);
  if (!u) {
    const _dummy = crypto.randomBytes(16).toString('hex');
    crypto.pbkdf2Sync('dummy',_dummy,600000,64,'sha512');
    audit(req,'auth.login_fail','user',null,username||'?',{reason:'user_not_found'},{actorId:null,actorName:username||'?'});
    return res.status(401).json({error:'Invalid username or password.'});
  }
  try { if (!verifyPw(password||'',u.hash,u.salt)) {
    audit(req,'auth.login_fail','user',u.id,u.username,{reason:'bad_password'},{actorId:null,actorName:u.username});
    return res.status(401).json({error:'Invalid username or password.'});
  }} catch(e){ return res.status(500).json({error:'Login error.'}); }
  const savedReturnTo = req.session.returnTo;
  req.session.regenerate(function(err) {
    if (err) return res.status(500).json({error:'Login error.'});
    req.session.userId=u.id; req.session.username=u.username;
    req.session.displayName=u.display_name; req.session.role=u.role;
    const _pu=db.query1('SELECT permissions FROM users WHERE id=?',[u.id]);
    req.session.permissions=(_pu&&_pu.permissions)?JSON.parse(_pu.permissions):(db.ROLE_PRESETS[u.role]||[]);
    audit(req,'auth.login','user',u.id,u.display_name||u.username,null,{actorId:u.id,actorName:u.display_name||u.username});
    if (u.must_change_pw) {
      req.session.must_change_pw = true;
      return req.session.save(()=>res.json({ok:true,mustChangePw:true}));
    }
    req.session.save(()=>res.json({ok:true,mustChangePw:false}));
  });
});

// ── Staff Directory (modular: server/modules/staff) ─────────
require('./server/modules/staff/routes').register(app);

// ── Chores (modular: server/modules/chores) ─────────
require('./server/modules/chores/routes').register(app);

// ── Group Sessions (modular: server/modules/groups) ─────────
require('./server/modules/groups/routes').register(app);

// ── Weekend Passes (modular: server/modules/passes) ─────────
require('./server/modules/passes/routes').register(app);


// ── UA Requests + Draws (modular: server/modules/ua) ─────────
require('./server/modules/ua/routes').register(app);

// ── Broadcasts ─────────────────────────────────────────────────────
app.get('/api/broadcasts', requireAuth, (req,res)=>{
  const hours = parseInt(req.query.hours)||24;
  res.json(db.getBroadcasts(hours));
});

app.post('/api/broadcasts', requireAuth, csrfCheck, requirePermission('broadcast.send'), (req,res)=>{
  const text = String(req.body.message||'').trim().slice(0,500);
  if (!text) return res.status(400).json({error:'message required'});
  const msg = db.createBroadcast(
    req.session.userId,
    req.session.displayName||req.session.username,
    text
  );
  audit(req,'broadcast.send','broadcast',msg.id,text.slice(0,80));
  broadcast({type:'broadcast_message', message:msg});
  res.json({ok:true, message:msg});
});

// ── Mail Log (modular: server/modules/mail) ─────────
require('./server/modules/mail/routes').register(app);

// ── Violations (modular: server/modules/violations) ─────────
require('./server/modules/violations/routes').register(app);

// ── Server restart (admin only) ───────────────────────────────────
app.post('/api/admin/restart', requireAuth, csrfCheck, requirePermission('admin.system'), (req,res)=>{
  audit(req,'server.restart','server',null,'Server Restart',{by:req.session.displayName||req.session.username});
  broadcast({type:'server_restarting',user:req.session.displayName||req.session.username});
  res.json({ok:true});
  setTimeout(()=>restartServer(), 600);
});

// ════════════════════════════════════════════════════════════════════
// EHR EXPANSION — clinical records, immutability, consent, idle session
// ════════════════════════════════════════════════════════════════════

// Helper: audit PHI read events. action='record.read' per HIPAA Security Rule.
// Helper: 403 if the named clinical record is locked (24h immutability).
// Records.unlock holders can bypass by calling the /unlock route first.
function requireUnlocked(table) {
  return function(req, res, next) {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({error:'Invalid id'});
    if (db.isRecordLocked(table, id)) {
      return res.status(403).json({
        error:'Record is locked (24h immutability window has elapsed). A supervisor must unlock it first.',
        code:'RECORD_LOCKED'
      });
    }
    next();
  };
}

// Helper: 42 CFR Part 2 consent gate — used by external-disclosure routes only.
// Internal staff reads are exempt under the 2024 rule update (treatment/operations)
// but are still audit-logged via auditRead().
function requireConsent(clientIdFn, informationType) {
  return function(req, res, next) {
    try {
      const cid = parseInt(typeof clientIdFn === 'function' ? clientIdFn(req) : req.params.client_id);
      if (!cid) return res.status(400).json({error:'client_id required'});
      const consent = db.findActiveConsent(cid, informationType);
      if (!consent) {
        audit(req,'consent.blocked','consent',cid,'External disclosure blocked',{informationType});
        return res.status(403).json({
          error:'42 CFR Part 2: No valid consent on file for this disclosure. Obtain written consent first.',
          code:'CONSENT_REQUIRED'
        });
      }
      req._consent = consent;
      next();
    } catch(e) {
      res.status(500).json({error:'Consent check failed'});
    }
  };
}

// Compute days_in_program for a discharge record.
function _daysBetween(a, b) {
  if (!a || !b) return 0;
  try {
    const da = new Date(a + 'T00:00:00');
    const db = new Date(b + 'T00:00:00');
    return Math.max(0, Math.round((db - da) / 86400000));
  } catch(e) { return 0; }
}

// ── UA Records (Phase 2) ─────────────────────────────────────────
app.get('/api/ua-records', requireAuth, (req, res) => {
  const filter = {
    client_id: req.query.client_id ? parseInt(req.query.client_id) : null,
    result:    req.query.result || null,
    from:      req.query.from   || null,
    to:        req.query.to     || null,
  };
  const rows = db.getUARecords(filter);
  auditRead(req, 'ua_records', null, `UA records list (${rows.length})`, filter);
  res.json(rows);
});
app.get('/api/ua-records/:id', requireAuth, (req, res) => {
  const r = db.getUARecord(parseInt(req.params.id));
  if (!r) return res.status(404).json({error:'Not found'});
  auditRead(req, 'ua_records', r.id, r.client_name);
  res.json(r);
});
app.post('/api/ua-records', requireAuth, csrfCheck, requirePermission('ua.record'), (req,res) => {
  const b = req.body || {};
  if (!b.client_id && !b.is_interview) return res.status(400).json({error:'client_id required'});
  if (!b.tested_at) return res.status(400).json({error:'tested_at required'});
  const me = req.session;
  const rec = db.createUARecord({
    ...b,
    witnessed_by_id:   b.witnessed_by_id   || me.userId,
    witnessed_by_name: b.witnessed_by_name || me.displayName || me.username || '',
    created_by_id:     me.userId,
    created_by_name:   me.displayName || me.username || '',
  });
  audit(req,'ua.record.create','ua_records',rec.id,rec.client_name,{result:rec.result});
  broadcast({type:'ua_records_updated'});
  res.json({ok:true, record:rec});
});
app.patch('/api/ua-records/:id', requireAuth, csrfCheck, requirePermission('ua.record'),
  requireUnlocked('ua_records'), (req,res) => {
  const id = parseInt(req.params.id);
  const cur = db.getUARecord(id);
  if (!cur) return res.status(404).json({error:'Not found'});
  const updated = db.updateUARecord(id, req.body||{});
  audit(req,'ua.record.edit','ua_records',id,cur.client_name,{fields:Object.keys(req.body||{})});
  broadcast({type:'ua_records_updated'});
  res.json({ok:true, record:updated});
});
app.delete('/api/ua-records/:id', requireAuth, csrfCheck, requirePermission('ua.delete'),
  requireUnlocked('ua_records'), (req,res) => {
  const id = parseInt(req.params.id);
  const cur = db.getUARecord(id);
  if (!cur) return res.status(404).json({error:'Not found'});
  db.deleteUARecord(id);
  audit(req,'ua.record.delete','ua_records',id,cur.client_name);
  broadcast({type:'ua_records_updated'});
  res.json({ok:true});
});

// ── Med Administration Log (Phase 3) ─────────────────────────────
app.get('/api/med-log', requireAuth, (req, res) => {
  const filter = {
    client_id: req.query.client_id ? parseInt(req.query.client_id) : null,
    report_id: req.query.report_id ? parseInt(req.query.report_id) : null,
    from:      req.query.from || null,
  };
  const rows = db.getMedLog(filter);
  auditRead(req,'med_administration_log',null,`Med log list (${rows.length})`, filter);
  res.json(rows);
});
app.post('/api/med-log', requireAuth, csrfCheck, requirePermission('med.witness'), (req,res) => {
  const b = req.body || {};
  if (!b.client_id) return res.status(400).json({error:'client_id required'});
  if (!b.administered_at) return res.status(400).json({error:'administered_at required'});
  if (!b.medication || !String(b.medication).trim()) return res.status(400).json({error:'medication required'});
  const me = req.session;
  const rec = db.createMedLog({
    ...b,
    witnessed_by_id:   b.witnessed_by_id   || me.userId,
    witnessed_by_name: b.witnessed_by_name || me.displayName || me.username || '',
    created_by_id:     me.userId,
    created_by_name:   me.displayName || me.username || '',
  });
  audit(req,'med.witness','med_administration_log',rec.id,rec.client_name,{med:rec.medication});
  broadcast({type:'med_log_updated'});
  res.json({ok:true, record:rec});
});
app.patch('/api/med-log/:id', requireAuth, csrfCheck, requirePermission('med.witness'),
  requireUnlocked('med_administration_log'), (req,res) => {
  const id = parseInt(req.params.id);
  const updated = db.updateMedLog(id, req.body||{});
  if (!updated) return res.status(404).json({error:'Not found'});
  audit(req,'med.edit','med_administration_log',id,updated.client_name);
  broadcast({type:'med_log_updated'});
  res.json({ok:true, record:updated});
});
app.delete('/api/med-log/:id', requireAuth, csrfCheck, requirePermission('med.delete'),
  requireUnlocked('med_administration_log'), (req,res) => {
  const id = parseInt(req.params.id);
  db.deleteMedLog(id);
  audit(req,'med.delete','med_administration_log',id,'');
  broadcast({type:'med_log_updated'});
  res.json({ok:true});
});

// ── Milestones (Phase 4) ─────────────────────────────────────────
app.get('/api/milestones', requireAuth, (req, res) => {
  const filter = {
    client_id: req.query.client_id ? parseInt(req.query.client_id) : null,
    status:    req.query.status || null,
  };
  const rows = db.getMilestones(filter);
  auditRead(req,'milestones',null,`Milestones list (${rows.length})`, filter);
  res.json(rows);
});
app.post('/api/milestones', requireAuth, csrfCheck, requirePermission('milestones.edit'), (req,res) => {
  const b = req.body || {};
  if (!b.client_id) return res.status(400).json({error:'client_id required'});
  if (!b.objective || !String(b.objective).trim()) return res.status(400).json({error:'objective required'});
  const me = req.session;
  const rec = db.createMilestone({
    ...b,
    created_by_name: me.displayName || me.username || '',
  });
  audit(req,'milestone.create','milestones',rec.id,rec.client_name,{phase:rec.phase,objective:rec.objective});
  broadcast({type:'milestones_updated'});
  res.json({ok:true, record:rec});
});
app.put('/api/milestones/:id', requireAuth, csrfCheck, requirePermission('milestones.edit'),
  requireUnlocked('milestones'), (req,res) => {
  const id = parseInt(req.params.id);
  const updated = db.updateMilestone(id, req.body||{});
  if (!updated) return res.status(404).json({error:'Not found'});
  audit(req,'milestone.edit','milestones',id,updated.client_name);
  broadcast({type:'milestones_updated'});
  res.json({ok:true, record:updated});
});
app.put('/api/milestones/:id/signoff', requireAuth, csrfCheck, requirePermission('milestones.signoff'), (req,res) => {
  const id = parseInt(req.params.id);
  const me = req.session;
  const updated = db.signoffMilestone(id, me.userId, me.displayName || me.username || '');
  if (!updated) return res.status(404).json({error:'Not found'});
  audit(req,'milestone.signoff','milestones',id,updated.client_name);
  broadcast({type:'milestones_updated'});
  res.json({ok:true, record:updated});
});
app.delete('/api/milestones/:id', requireAuth, csrfCheck, requirePermission('milestones.edit'),
  requireUnlocked('milestones'), (req,res) => {
  const id = parseInt(req.params.id);
  db.deleteMilestone(id);
  audit(req,'milestone.delete','milestones',id,'');
  broadcast({type:'milestones_updated'});
  res.json({ok:true});
});

// ── Incidents (Phase 5) ──────────────────────────────────────────
app.get('/api/incidents', requireAuth, (req, res) => {
  const filter = {
    client_id: req.query.client_id ? parseInt(req.query.client_id) : null,
    severity:  req.query.severity || null,
    status:    req.query.status || null,
  };
  const rows = db.getIncidents(filter);
  auditRead(req,'incidents',null,`Incidents list (${rows.length})`, filter);
  res.json(rows);
});
app.post('/api/incidents', requireAuth, csrfCheck, requirePermission('incidents.log'), (req,res) => {
  const b = req.body || {};
  if (!b.client_id) return res.status(400).json({error:'client_id required'});
  if (!b.incident_date) return res.status(400).json({error:'incident_date required'});
  if (!b.narrative || !String(b.narrative).trim()) return res.status(400).json({error:'narrative required'});
  const sev = String(b.severity||'low').toLowerCase();
  if (!['low','medium','high','critical'].includes(sev)) return res.status(400).json({error:'severity must be low|medium|high|critical'});
  // Server enforces minimum required notifications based on severity (HIPAA + facility policy)
  const policy = db.getSetting('incident_notifications', {});
  const minReq = Array.isArray(policy[sev]) ? policy[sev] : [];
  const supplied = Array.isArray(b.notifications_required) ? b.notifications_required : [];
  const merged = Array.from(new Set([...minReq, ...supplied]));
  const me = req.session;
  const rec = db.createIncident({
    ...b, severity:sev, notifications_required:merged,
    logged_by_id:   me.userId,
    logged_by_name: me.displayName || me.username || '',
  });
  audit(req,'incident.create','incidents',rec.id,rec.client_name,{severity:sev,notifications:merged});
  broadcast({type:'incidents_updated'});
  // Alert staff who have incidents.review permission
  broadcast({type:'incident_notification', incident:{
    id:rec.id, client_name:rec.client_name, room:rec.room,
    severity:sev, incident_type:rec.incident_type, incident_date:rec.incident_date,
    logged_by:me.displayName||me.username||'',
  }});
  res.json({ok:true, record:rec});
});
app.put('/api/incidents/:id', requireAuth, csrfCheck, requirePermission('incidents.log'),
  requireUnlocked('incidents'), (req,res) => {
  const id = parseInt(req.params.id);
  const updated = db.updateIncident(id, req.body||{});
  if (!updated) return res.status(404).json({error:'Not found'});
  audit(req,'incident.edit','incidents',id,updated.client_name);
  broadcast({type:'incidents_updated'});
  res.json({ok:true, record:updated});
});
app.put('/api/incidents/:id/review', requireAuth, csrfCheck, requirePermission('incidents.review'), (req,res) => {
  const id = parseInt(req.params.id);
  const me = req.session;
  const { review_notes, status } = req.body || {};
  const newStatus = ['reviewed','closed'].includes(status) ? status : 'reviewed';
  const updated = db.reviewIncident(id, me.userId, me.displayName || me.username || '',
    review_notes || '', newStatus);
  if (!updated) return res.status(404).json({error:'Not found'});
  audit(req,'incident.review','incidents',id,updated.client_name,{status:newStatus});
  broadcast({type:'incidents_updated'});
  res.json({ok:true, record:updated});
});
app.delete('/api/incidents/:id', requireAuth, csrfCheck, requirePermission('incidents.delete'),
  requireUnlocked('incidents'), (req,res) => {
  const id = parseInt(req.params.id);
  db.deleteIncident(id);
  audit(req,'incident.delete','incidents',id,'');
  broadcast({type:'incidents_updated'});
  res.json({ok:true});
});

// ── Discharge Records (Phase 6) ──────────────────────────────────
app.get('/api/discharge-records', requireAuth, (req,res) => {
  const rows = db.getDischargeRecords({});
  auditRead(req,'discharge_records',null,`Discharge records list (${rows.length})`);
  res.json(rows);
});
app.get('/api/discharge-records/:client_id', requireAuth, (req,res) => {
  const cid = parseInt(req.params.client_id);
  const rows = db.getDischargeRecords({client_id:cid});
  auditRead(req,'discharge_records',null,`Discharges for client ${cid}`,{client_id:cid});
  res.json(rows);
});
app.post('/api/discharge-records', requireAuth, csrfCheck, requirePermission('residents.edit'), (req,res) => {
  const b = req.body || {};
  if (!b.client_id) return res.status(400).json({error:'client_id required'});
  if (!b.discharge_date) return res.status(400).json({error:'discharge_date required'});
  if (!b.reason || !['graduate','ama','therapeutic','administrative'].includes(b.reason))
    return res.status(400).json({error:'reason must be graduate|ama|therapeutic|administrative'});
  const client = db.query1('SELECT * FROM clients WHERE id=?',[b.client_id]);
  if (!client) return res.status(404).json({error:'Client not found'});
  const me = req.session;
  const rec = db.createDischargeRecord({
    ...b,
    client_name:    b.client_name    || client.name,
    room:           b.room           || client.room,
    program_track:  b.program_track  || client.program_track || '',
    intake_date:    b.intake_date    || client.intake_date || null,
    days_in_program:_daysBetween(client.intake_date, b.discharge_date),
    created_by_id:   me.userId,
    created_by_name: me.displayName || me.username || '',
  });
  // Also flip the client to inactive + stamp discharge date
  db.run('UPDATE clients SET is_active=0, discharge_date=? WHERE id=?',
    [b.discharge_date, b.client_id]);
  // Free the room — insert a VACANT placeholder so the room shows available for new intake.
  // POST /api/clients will update this row in-place; PUT (reactivate) will delete it.
  db.run(`INSERT INTO clients (room,name,is_active,is_special,sort_order) VALUES (?,?,1,0,?)`,
    [client.room, 'VACANT', client.sort_order || 0]);
  // Add discharge log entry to active shift report
  const _dischActiveId = db.getSetting('active_report_id', null);
  if (_dischActiveId) {
    const _n=new Date(),_h=_n.getHours(),_m=String(_n.getMinutes()).padStart(2,'0');
    const _ap=_h>=12?'PM':'AM',_h12=_h%12||12;
    const _ts=`${_h12}:${_m} ${_ap}`;
    const _reasonLabels={graduate:'Graduate',ama:'AMA',therapeutic:'Therapeutic discharge',administrative:'Administrative discharge'};
    const _rLabel=_reasonLabels[b.reason]||b.reason;
    db.run('INSERT INTO log_entries (report_id,time,text) VALUES (?,?,?)',
      [_dischActiveId,_ts,`Resident discharged: ${client.name}, Rm. ${client.room}. Reason: ${_rLabel}.`]);
    db.run('UPDATE reports SET updated_at=? WHERE id=?',[new Date().toISOString(),_dischActiveId]);
  }
  db.save();
  audit(req,'discharge.create','discharge_records',rec.id,client.name,{reason:rec.reason});
  broadcast({type:'data_saved',user:req.session.displayName||req.session.username});
  broadcast({type:'discharge_records_updated'});
  res.json({ok:true, record:rec});
});

// ── 42 CFR Part 2 Consent (Phase 7) ──────────────────────────────
app.get('/api/consent-records/:client_id', requireAuth, requirePermission('consent.manage'), (req,res) => {
  const cid = parseInt(req.params.client_id);
  const rows = db.getConsentRecords(cid);
  auditRead(req,'consent_records',null,`Consents for client ${cid}`,{client_id:cid});
  res.json(rows);
});
app.post('/api/consent-records', requireAuth, csrfCheck, requirePermission('consent.manage'), (req,res) => {
  const b = req.body || {};
  if (!b.client_id) return res.status(400).json({error:'client_id required'});
  if (!b.recipient_name) return res.status(400).json({error:'recipient_name required'});
  if (!b.purpose) return res.status(400).json({error:'purpose required'});
  if (!b.effective_date) return res.status(400).json({error:'effective_date required'});
  const facility = db.getSetting('facility_name','OpsPoint');
  const me = req.session;
  const rec = db.createConsentRecord({
    ...b,
    program_name:    b.program_name || facility,
    created_by_id:   me.userId,
    created_by_name: me.displayName || me.username || '',
  });
  audit(req,'consent.create','consent_records',rec.id,b.recipient_name,
    {client_id:b.client_id,information_type:b.information_type,expires:b.expiration_date});
  res.json({ok:true, record:rec});
});
app.put('/api/consent-records/:id/revoke', requireAuth, csrfCheck, requirePermission('consent.manage'), (req,res) => {
  const id = parseInt(req.params.id);
  const me = req.session;
  const cur = db.getConsentRecord(id);
  if (!cur) return res.status(404).json({error:'Not found'});
  const updated = db.revokeConsent(id, me.displayName || me.username || '');
  audit(req,'consent.revoke','consent_records',id,cur.recipient_name,{client_id:cur.client_id});
  res.json({ok:true, record:updated});
});
app.get('/api/disclosures/:client_id', requireAuth, requirePermission('disclosures.view'), (req,res) => {
  const cid = parseInt(req.params.client_id);
  const rows = db.getDisclosures(cid);
  auditRead(req,'disclosures',null,`Disclosures for client ${cid}`,{client_id:cid});
  res.json(rows);
});
// Log an external disclosure (called by export / print / share flows).
// Gated by requireConsent — the client cannot trigger this without a valid consent.
app.post('/api/disclosures', requireAuth, csrfCheck,
  requireConsent(req => req.body && req.body.client_id, 'all'), (req,res) => {
  const b = req.body || {};
  const me = req.session;
  const rec = db.logDisclosure({
    ...b,
    consent_id: b.consent_id || (req._consent && req._consent.id) || null,
    disclosed_by_id: me.userId,
    disclosed_by_name: me.displayName || me.username || '',
  });
  audit(req,'disclosure.log','disclosures',rec.id,b.recipient||'',
    {client_id:b.client_id,information_type:b.information_type,method:b.method});
  res.json({ok:true, record:rec});
});

// ── Phase 8: Supervisor unlock for clinical records ──────────────
app.post('/api/:table/:id/unlock', requireAuth, csrfCheck, requirePermission('records.unlock'), (req,res) => {
  const table = String(req.params.table||'');
  if (!db.CLINICAL_TABLES.includes(table)) return res.status(400).json({error:'Invalid table'});
  const id = parseInt(req.params.id);
  const reason = (req.body && req.body.reason) || '';
  if (!reason || !String(reason).trim())
    return res.status(400).json({error:'Reason required to unlock a sealed record'});
  const me = req.session;
  if (!db.isRecordLocked(table, id))
    return res.status(400).json({error:'Record is not locked'});
  db.unlockRecord(table, id, me.displayName || me.username || '', reason);
  audit(req,'record.unlock', table, id, '', {reason});
  res.json({ok:true});
});

// ── Facility settings extension — program tracks / phases / etc. ──
app.get('/api/facility/ehr-config', requireAuth, (req,res) => {
  res.json({
    program_tracks:         db.getSetting('program_tracks',         []),
    program_phases:         db.getSetting('program_phases',         []),
    incident_notifications: db.getSetting('incident_notifications', {}),
    session_idle_mins:      parseInt(db.getSetting('session_idle_mins',30))||30,
  });
});
app.put('/api/facility/ehr-config', requireAuth, csrfCheck, requirePermission('admin.settings'), (req,res) => {
  const b = req.body || {};
  if (Array.isArray(b.program_tracks)) db.setSetting('program_tracks', b.program_tracks.filter(s => String(s||'').trim()));
  if (Array.isArray(b.program_phases)) db.setSetting('program_phases', b.program_phases);
  if (b.incident_notifications && typeof b.incident_notifications === 'object')
    db.setSetting('incident_notifications', b.incident_notifications);
  if (b.session_idle_mins != null) {
    const m = Math.max(5, Math.min(240, parseInt(b.session_idle_mins) || 30));
    db.setSetting('session_idle_mins', String(m));
  }
  db.save();
  audit(req,'facility.ehr_config','settings',null,'EHR configuration',{fields:Object.keys(b)});
  broadcast({type:'settings_updated'});
  res.json({ok:true});
});

// ── Audit Log API ─────────────────────────────────────────────────
app.get('/api/audit-log', requireAuth, requirePermission('admin.audit'), (req,res)=>{
  const{action,actorId,from,to,search,limit,offset}=req.query;
  const prefixes=action?action.split(',').map(s=>s.trim()).filter(Boolean):[];
  const result=db.getAuditLog({
    actionPrefixes:prefixes,
    actorId:actorId?parseInt(actorId):null,
    from:from||null, to:to||null, search:search||null,
    limit:Math.min(parseInt(limit)||100,500),
    offset:parseInt(offset)||0
  });
  res.json(result);
});

// ════════════════════════════════════════════════════════════════════════
// Structured Clinical Lite — clinical_notes, treatment_plans, assessments,
// group_notes (+attendees), discharge_summaries.
//   • Every route is gated behind requirePermission().
//   • goals (treatment-plans) and content (assessments) are JSON-parsed before
//     the response is sent — clients always receive objects, never strings.
//   • group-notes responses embed an `attendees` array (done in the db layer).
//   • Draft lock: clinical_notes + discharge_summaries return 400 on PUT/DELETE
//     once status==='final'.
//   • Every mutation broadcasts a typed WebSocket event.
// ════════════════════════════════════════════════════════════════════════
function _clinicalParse(row, jsonFields) {
  if (!row || !jsonFields || !jsonFields.length) return row;
  jsonFields.forEach(f => {
    if (typeof row[f] === 'string') {
      try { row[f] = JSON.parse(row[f]); }
      catch (e) { row[f] = (f === 'content') ? {} : []; }
    }
  });
  return row;
}

function registerClinicalRoutes(opts) {
  const { seg, perm, entity, required = [], jsonFields = [], locked = false, wsType, authorField = 'author_id' } = opts;
  const base  = `/api/clinical/${seg}`;
  const ttype = seg.replace(/-/g, '_');

  // LIST — accepts ?clientId= filter
  app.get(base, requireAuth, requirePermission(perm), (req, res) => {
    const clientId = req.query.clientId ? parseInt(req.query.clientId) : null;
    const rows = entity.getAll(undefined, clientId);
    rows.forEach(r => _clinicalParse(r, jsonFields));
    auditRead(req, ttype, null, `Clinical ${seg} list (${rows.length})`, clientId ? { clientId } : undefined);
    res.json(rows);
  });

  // SINGLE
  app.get(`${base}/:id`, requireAuth, requirePermission(perm), (req, res) => {
    const row = entity.getById(undefined, parseInt(req.params.id));
    if (!row) return res.status(404).json({ error: 'Not found' });
    _clinicalParse(row, jsonFields);
    auditRead(req, ttype, row.id, `Clinical ${seg} #${row.id}`);
    res.json(row);
  });

  // CREATE
  app.post(base, requireAuth, csrfCheck, requirePermission(perm), (req, res) => {
    const b = req.body || {};
    for (const f of required) {
      if (b[f] == null || b[f] === '') return res.status(400).json({ error: `${f} required` });
    }
    const fields = { ...b, [authorField]: req.session.userId };
    const rec = entity.create(undefined, fields);
    _clinicalParse(rec, jsonFields);
    audit(req, `${wsType}.create`, ttype, rec.id, '');
    broadcast({ type: `${wsType}_created`, data: rec });
    res.json({ ok: true, record: rec });
  });

  // UPDATE — blocked once finalised for locked resources
  app.put(`${base}/:id`, requireAuth, csrfCheck, requirePermission(perm), (req, res) => {
    const id = parseInt(req.params.id);
    const existing = entity.getById(undefined, id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (locked && existing.status === 'final')
      return res.status(400).json({ error: 'Record is finalised and can no longer be edited.' });
    const rec = entity.update(undefined, id, req.body || {}, req.session.userId);
    _clinicalParse(rec, jsonFields);
    audit(req, `${wsType}.update`, ttype, id, '');
    broadcast({ type: `${wsType}_updated`, data: rec });
    res.json({ ok: true, record: rec });
  });

  // SIGN / finalise
  app.patch(`${base}/:id/sign`, requireAuth, csrfCheck, requirePermission(perm), (req, res) => {
    const id = parseInt(req.params.id);
    const existing = entity.getById(undefined, id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const rec = entity.sign(undefined, id, req.session.userId);
    _clinicalParse(rec, jsonFields);
    audit(req, `${wsType}.sign`, ttype, id, '');
    broadcast({ type: `${wsType}_signed`, data: rec });
    res.json({ ok: true, record: rec });
  });

  // DELETE — blocked once finalised for locked resources
  app.delete(`${base}/:id`, requireAuth, csrfCheck, requirePermission(perm), (req, res) => {
    const id = parseInt(req.params.id);
    const existing = entity.getById(undefined, id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (locked && existing.status === 'final')
      return res.status(400).json({ error: 'Record is finalised and cannot be deleted.' });
    entity.delete(undefined, id, req.session.userId);
    audit(req, `${wsType}.delete`, ttype, id, '');
    broadcast({ type: `${wsType}_deleted`, id });
    res.json({ ok: true });
  });
}

registerClinicalRoutes({ seg: 'notes',               perm: 'clinical.notes',       entity: db.clinicalDb.notes,              required: ['client_id'],  locked: true, wsType: 'clinical_note' });
registerClinicalRoutes({ seg: 'treatment-plans',     perm: 'clinical.treatment',   entity: db.clinicalDb.treatmentPlans,     required: ['client_id'],  jsonFields: ['goals'],   wsType: 'treatment_plan' });
registerClinicalRoutes({ seg: 'assessments',         perm: 'clinical.assessments', entity: db.clinicalDb.assessments,        required: ['client_id'],  jsonFields: ['content'], wsType: 'assessment' });
registerClinicalRoutes({ seg: 'discharge-summaries', perm: 'clinical.discharge',   entity: db.clinicalDb.dischargeSummaries, required: ['client_id'],  locked: true, wsType: 'discharge_summary' });

// ── Group notes — shared between the main Groups tab (attendance entry) and
// the clinical section (full note + sign). Two roles on ONE record:
//   • groups.log    → create/edit attendance only (content + status stripped)
//   • clinical.groups → add the clinical note + sign
//   • groups.view   → read-only
// PAs do the attendance footwork; clinicians finish the note. ────────────────
const _GN = db.clinicalDb.groupNotes;
const _hasClinicalGroups = req => _userPerms(req).includes('clinical.groups');

app.get('/api/clinical/group-notes', requireAuth, requireAnyPermission('clinical.groups', 'groups.log', 'groups.view'), (req, res) => {
  const clientId = req.query.clientId ? parseInt(req.query.clientId) : null;
  const rows = _GN.getAll(undefined, clientId);
  auditRead(req, 'group_notes', null, `Group notes list (${rows.length})`, clientId ? { clientId } : undefined);
  res.json(rows);
});
app.get('/api/clinical/group-notes/:id', requireAuth, requireAnyPermission('clinical.groups', 'groups.log', 'groups.view'), (req, res) => {
  const row = _GN.getById(undefined, parseInt(req.params.id));
  if (!row) return res.status(404).json({ error: 'Not found' });
  auditRead(req, 'group_notes', row.id, `Group note #${row.id}`);
  res.json(row);
});
app.post('/api/clinical/group-notes', requireAuth, csrfCheck, requireAnyPermission('clinical.groups', 'groups.log'), (req, res) => {
  const b = req.body || {};
  if (!b.group_name) return res.status(400).json({ error: 'group_name required' });
  const fields = { ...b, facilitator_id: req.session.userId };
  if (!_hasClinicalGroups(req)) { delete fields.content; delete fields.status; }  // attendance-only
  const rec = _GN.create(undefined, fields);
  audit(req, 'group_note.create', 'group_notes', rec.id, fields.group_name || '');
  broadcast({ type: 'group_note_created', data: rec });
  res.json({ ok: true, record: rec });
});
app.put('/api/clinical/group-notes/:id', requireAuth, csrfCheck, requireAnyPermission('clinical.groups', 'groups.log'), (req, res) => {
  const id = parseInt(req.params.id);
  const existing = _GN.getById(undefined, id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const clinical = _hasClinicalGroups(req);
  if (!clinical && existing.status === 'final') return res.status(400).json({ error: 'Finalised — only clinical staff can edit.' });
  const b = { ...req.body };
  if (!clinical) { delete b.content; delete b.status; }     // attendance-only edit can't touch the note
  const rec = _GN.update(undefined, id, b, req.session.userId);
  audit(req, 'group_note.update', 'group_notes', id, '');
  broadcast({ type: 'group_note_updated', data: rec });
  res.json({ ok: true, record: rec });
});
app.patch('/api/clinical/group-notes/:id/sign', requireAuth, csrfCheck, requirePermission('clinical.groups'), (req, res) => {
  const id = parseInt(req.params.id);
  const existing = _GN.getById(undefined, id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const rec = _GN.sign(undefined, id, req.session.userId);
  audit(req, 'group_note.sign', 'group_notes', id, '');
  broadcast({ type: 'group_note_signed', data: rec });
  res.json({ ok: true, record: rec });
});
app.delete('/api/clinical/group-notes/:id', requireAuth, csrfCheck, requireAnyPermission('clinical.groups', 'groups.log'), (req, res) => {
  const id = parseInt(req.params.id);
  const existing = _GN.getById(undefined, id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!_hasClinicalGroups(req) && existing.status === 'final') return res.status(400).json({ error: 'Finalised — only clinical staff can delete.' });
  _GN.delete(undefined, id, req.session.userId);
  audit(req, 'group_note.delete', 'group_notes', id, '');
  broadcast({ type: 'group_note_deleted', id });
  res.json({ ok: true });
});

// ── Auto-update (Option B — manifest + signed bundle) ─────────────
const { createUpdater } = require('./updater');
const updater = createUpdater({
  baseDir: BASE, dataDir: DATA, dbPath: DB_PATH, db,
  broadcast, restart: restartServer, log: (...a) => console.log('[updater]', ...a),
  // When the manifest/bundle is served by our HQ relay, authenticate with the
  // facility API key so HQ can serve on-prem (facilities never touch the internet).
  authFor: (urlStr) => {
    try {
      const cu = db.getSetting('central_url', '') || '';
      const key = db.getSetting('central_api_key', '') || '';
      if (cu && key && new URL(urlStr).host === new URL(cu).host) return { 'x-facility-key': key };
    } catch (e) {}
    return {};
  },
  insecureFor: (urlStr) => {
    try {
      const cu = db.getSetting('central_url', '') || '';
      if (cu && db.getSetting('central_insecure_tls', false) && new URL(urlStr).host === new URL(cu).host) return true;
    } catch (e) {}
    return false;
  },
});

app.get('/api/update/status', requireAuth, requirePermission('admin.system'), (req,res)=>{
  res.json(updater.status());
});
app.post('/api/update/check', requireAuth, csrfCheck, requirePermission('admin.system'), async (req,res)=>{
  try { const r = await updater.check(); res.json(r); }
  catch(e){ res.status(502).json({error:(e&&e.message)||'Check failed'}); }
});
app.post('/api/update/apply', requireAuth, csrfCheck, requirePermission('admin.system'), (req,res)=>{
  const st = updater.status();
  if (st.progress && st.progress.applying) return res.status(409).json({error:'An update is already in progress'});
  const actor = req.session.displayName || req.session.username || 'admin';
  audit(req,'update.apply.start','system',null,'Software update started',{by:actor});
  updater.apply(actor).catch(()=>{}); // runs in background; client polls /status
  res.json({ ok:true, started:true });
});
app.get('/api/update/backups', requireAuth, requirePermission('admin.system'), (req,res)=>{
  res.json(updater.backups());
});
app.post('/api/update/rollback', requireAuth, csrfCheck, requirePermission('admin.system'), async (req,res)=>{
  const actor = req.session.displayName || req.session.username || 'admin';
  try { const r = await updater.rollback(actor); res.json(r); }
  catch(e){ res.status(400).json({error:(e&&e.message)||'Rollback failed'}); }
});

// Liveness probe for the bootstrap supervisor (unauthenticated — no PHI).
app.get('/api/health', (req,res)=>{ let v='0.0.0'; try { v=require('./package.json').version; } catch(e){} res.json({ ok:true, version:v }); });

// ── Central / HQ link (Phase 0: connect + check-in) ───────────────
// Facility node → central HQ server. OUTBOUND only; the facility keeps operating
// normally if HQ is unreachable. Phase 0 is enrollment + liveness; sync is Phase 1.
const _httpsMod = require('https');
const _httpMod  = require('http');
function _centralRequest(method, urlStr, { headers = {}, body = null, insecure = false, timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(urlStr); } catch (e) { return reject(new Error('Invalid HQ URL')); }
    const mod = u.protocol === 'https:' ? _httpsMod : _httpMod;
    const data = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const opts = {
      method, hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: { 'content-type': 'application/json', ...(data ? { 'content-length': data.length } : {}), ...headers },
      timeout,
    };
    if (u.protocol === 'https:' && insecure) opts.rejectUnauthorized = false; // scoped to this call only
    const r = mod.request(opts, resp => {
      let buf = ''; resp.on('data', d => buf += d);
      resp.on('end', () => { let parsed = null; try { parsed = JSON.parse(buf); } catch (e) {} resolve({ status: resp.statusCode, body: parsed }); });
    });
    r.on('error', reject);
    r.on('timeout', () => r.destroy(new Error('HQ connection timed out')));
    if (data) r.write(data);
    r.end();
  });
}
function _centralTs() { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }
const _appVersion = (() => { try { return require('./package.json').version; } catch (e) { return ''; } })();

app.get('/api/central/status', requireAuth, requirePermission('admin.system'), (req, res) => {
  const url = db.getSetting('central_url', '');
  const facility_id = db.getSetting('central_facility_id', '');
  const api_key = db.getSetting('central_api_key', '');
  res.json({
    connected: !!(url && facility_id && api_key),
    url, facility_id,
    key_prefix: api_key ? String(api_key).slice(0, 8) : '', // never return the full key
    insecure: !!db.getSetting('central_insecure_tls', false),
    last_checkin: db.getSetting('central_last_checkin', ''),
    last_status: db.getSetting('central_last_status', ''),
    pending: db.outboxPending(),
    last_sync: db.getSetting('central_last_sync', ''),
    sync_error: db.getSetting('central_sync_error', ''),
    manages_users: !!db.getSetting('central_manages_users', false),
    users_last_pull: db.getSetting('central_users_last_pull', ''),
    users_count: parseInt(db.getSetting('central_users_count', '0')) || 0,
    target_version: db.getSetting('central_target_version', ''),
    current_version: _appVersion,
    update_available: !!(db.getSetting('central_target_version', '') && db.getSetting('central_target_version', '') !== _appVersion),
    auto_update: !!db.getSetting('central_auto_update', false),
    update_window: db.getSetting('central_update_window', ''),
  });
});

// Opt-in to HQ-driven rollouts (auto-apply within an optional maintenance window).
app.post('/api/central/auto-update', requireAuth, csrfCheck, requirePermission('admin.system'), (req, res) => {
  const b = req.body || {};
  db.setSetting('central_auto_update', !!b.auto_update);
  if (b.window !== undefined) {
    const w = String(b.window || '').trim();
    if (w && !/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(w)) return res.status(400).json({ error: 'window must be "HH:MM-HH:MM" or empty' });
    db.setSetting('central_update_window', w);
  }
  audit(req, 'central.auto_update', 'system', null, 'Auto-update ' + (b.auto_update ? 'enabled' : 'disabled'), { window: db.getSetting('central_update_window', '') });
  res.json({ ok: true, auto_update: !!db.getSetting('central_auto_update', false), update_window: db.getSetting('central_update_window', '') });
});

app.post('/api/central/connect', requireAuth, csrfCheck, requirePermission('admin.system'), async (req, res) => {
  const url = String((req.body && req.body.url) || '').trim().replace(/\/+$/, '');
  const facility_id = String((req.body && req.body.facility_id) || '').trim();
  const api_key = String((req.body && req.body.api_key) || '').trim();
  const insecure = !!(req.body && req.body.insecure);
  if (!url || !facility_id || !api_key) return res.status(400).json({ error: 'HQ URL, Facility ID and enrollment key are all required' });
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'HQ URL must start with http:// or https://' });
  let r;
  try { r = await _centralRequest('POST', url + '/enroll/checkin', { headers: { 'x-facility-key': api_key }, body: { app_version: _appVersion }, insecure }); }
  catch (e) { return res.status(502).json({ error: 'Could not reach HQ: ' + ((e && e.message) || 'network error') }); }
  if (r.status !== 200 || !r.body || !r.body.ok)
    return res.status(r.status === 401 || r.status === 403 ? r.status : 502).json({ error: (r.body && r.body.error) || ('HQ rejected check-in (HTTP ' + r.status + ')') });
  if (r.body.facility && r.body.facility.id && r.body.facility.id !== facility_id)
    return res.status(400).json({ error: 'This key belongs to a different facility — check the Facility ID' });
  db.setSetting('central_url', url);
  db.setSetting('central_facility_id', facility_id);
  db.setSetting('central_api_key', api_key);
  db.setSetting('central_insecure_tls', insecure);
  db.setSetting('central_last_checkin', _centralTs());
  db.setSetting('central_last_status', 'connected');
  db.setSetting('central_sync_error', '');
  db.setSetting('central_target_version', (r.body && r.body.target_version) || '');
  // Phase 5: pull updates from HQ on the LAN. Preserve the original (GitHub)
  // manifest URL so disconnect can restore it.
  if (!db.getSetting('update_manifest_url_origin', '')) db.setSetting('update_manifest_url_origin', db.getSetting('update_manifest_url', ''));
  db.setSetting('update_manifest_url', url + '/fleet/manifest');
  try { db.enqueueSyncBackfill(); } catch (e) {}        // queue a full snapshot for HQ
  setImmediate(() => { syncTick().catch(() => {}); });   // start draining in the background
  audit(req, 'central.connect', 'system', null, 'Connected to HQ', { url, facility_id, central_name: (r.body.facility && r.body.facility.name) || '' });
  res.json({ ok: true, central: { name: (r.body.facility && r.body.facility.name) || '', server_time: r.body.server_time || '' } });
});

app.post('/api/central/checkin', requireAuth, csrfCheck, requirePermission('admin.system'), async (req, res) => {
  const url = db.getSetting('central_url', ''), api_key = db.getSetting('central_api_key', '');
  const insecure = !!db.getSetting('central_insecure_tls', false);
  if (!url || !api_key) return res.status(400).json({ error: 'Not connected to HQ' });
  let r;
  try { r = await _centralRequest('POST', url + '/enroll/checkin', { headers: { 'x-facility-key': api_key }, body: { app_version: _appVersion }, insecure }); }
  catch (e) { db.setSetting('central_last_status', 'unreachable'); return res.status(502).json({ error: 'Could not reach HQ: ' + ((e && e.message) || 'network error') }); }
  if (r.status !== 200 || !r.body || !r.body.ok) {
    db.setSetting('central_last_status', 'rejected');
    return res.status(502).json({ error: (r.body && r.body.error) || ('HQ rejected check-in (HTTP ' + r.status + ')') });
  }
  db.setSetting('central_last_checkin', _centralTs());
  db.setSetting('central_last_status', 'connected');
  db.setSetting('central_target_version', (r.body && r.body.target_version) || '');
  res.json({ ok: true, central: { name: (r.body.facility && r.body.facility.name) || '', server_time: r.body.server_time || '' } });
});

app.post('/api/central/disconnect', requireAuth, csrfCheck, requirePermission('admin.system'), (req, res) => {
  // Restore the original (GitHub) update source before clearing central settings.
  const origin = db.getSetting('update_manifest_url_origin', '');
  if (origin) { db.setSetting('update_manifest_url', origin); db.setSetting('update_manifest_url_origin', ''); }
  ['central_url', 'central_facility_id', 'central_api_key', 'central_insecure_tls',
   'central_last_checkin', 'central_last_status', 'central_last_sync', 'central_sync_error',
   'central_manages_users', 'central_users_last_pull', 'central_users_count', 'central_target_version',
   'central_auto_update', 'central_update_window']
    .forEach(k => db.setSetting(k, ''));
  // Previously-provisioned managed users are LEFT in place (real accounts with
  // their own passwords) so disconnecting never locks staff out.
  audit(req, 'central.disconnect', 'system', null, 'Disconnected from HQ', {});
  try { db.clearOutbox(); } catch (e) {}   // clear LAST so the audit row above doesn't linger in the outbox
  res.json({ ok: true });
});

// Drain the outbox to HQ. Safe to call anytime; when no central is configured it
// just keeps the outbox bounded (standalone facility). Runs on a timer, after a
// successful connect, and on demand via /api/central/sync-now.
let _syncing = false;
async function syncTick() {
  if (_syncing) return;
  _syncing = true;
  try {
    const url = db.getSetting('central_url', ''), key = db.getSetting('central_api_key', '');
    const insecure = !!db.getSetting('central_insecure_tls', false);
    if (!url || !key) { db.clearOutbox(); return; }   // standalone: nothing to send
    let batches = 0, lastUpdate = null;
    do {
      const batch = db.getSyncBatch(50);   // may be empty → still send as a heartbeat (refreshes liveness + target)
      let r;
      try { r = await _centralRequest('POST', url + '/sync/ingest', { headers: { 'x-facility-key': key }, body: { rows: batch, app_version: _appVersion, update_status: _localUpdateStatus() }, insecure, timeout: 30000 }); }
      catch (e) { db.setSetting('central_sync_error', (e && e.message) || 'network error'); db.setSetting('central_last_status', 'unreachable'); return; }
      if (r.status !== 200 || !r.body || !r.body.ok) {
        db.setSetting('central_sync_error', (r.body && r.body.error) || ('HTTP ' + r.status));
        db.setSetting('central_last_status', r.status === 401 || r.status === 403 ? 'rejected' : 'error');
        return;
      }
      if (batch.length) db.markSynced(batch.map(b => b.id));
      db.setSetting('central_last_status', 'connected');
      db.setSetting('central_sync_error', '');
      if (r.body.target_version !== undefined) db.setSetting('central_target_version', r.body.target_version || '');
      lastUpdate = r.body.update || null;
      batches++;
    } while (db.outboxPending() > 0 && batches < 20);
    db.pruneOutbox();
    db.setSetting('central_last_sync', _centralTs());
    await pullManagedUsers();
    await _maybeAutoUpdate(lastUpdate);   // Phase 5: act on a rollout directive (opt-in + window-gated)
  } finally { _syncing = false; }
}

// ── Phase 5: rollout auto-apply agent ─────────────────────────────────────
// Report this node's update outcome to HQ, derived from updater/bootstrap markers.
function _localUpdateStatus() {
  try {
    const upDir = path.join(DATA, 'updates');
    const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(upDir, f), 'utf8')); } catch (e) { return null; } };
    const applied = rd('last-applied.json');     // updater wrote on apply {to, ts}
    const rolled = rd('last-rollback.json');      // bootstrap wrote on auto-rollback {from, to, ts}
    if (rolled && (!applied || String(rolled.ts) >= String(applied.ts)))
      return { state: 'rolled_back', version: _appVersion, attempted: rolled.to || '' };
    if (applied && applied.to === _appVersion)
      return { state: 'updated', version: _appVersion, attempted: applied.to };
    return { state: 'idle', version: _appVersion };
  } catch (e) { return { state: 'idle', version: _appVersion }; }
}
// "HH:MM-HH:MM" local window; empty = anytime. Handles windows crossing midnight.
function _inUpdateWindow() {
  const w = String(db.getSetting('central_update_window', '') || '').trim();
  if (!w) return true;
  const m = w.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return true;
  const now = new Date(), cur = now.getHours() * 60 + now.getMinutes();
  const a = parseInt(m[1]) * 60 + parseInt(m[2]), b = parseInt(m[3]) * 60 + parseInt(m[4]);
  return a <= b ? (cur >= a && cur <= b) : (cur >= a || cur <= b);
}
const _autoTried = new Set();   // versions attempted this process (avoid tight retry loops)
async function _maybeAutoUpdate(d) {
  if (!d || !d.version || d.apply !== 'auto') return;
  if (!db.getSetting('central_auto_update', false)) return;       // opt-in per facility
  if (d.version === _appVersion || _autoTried.has(d.version)) return;
  if (!_inUpdateWindow()) return;                                 // outside maintenance window
  const st = updater.status();
  if (st && st.progress && st.progress.applying) return;          // already applying
  _autoTried.add(d.version);
  try {
    db.auditLog(null, 'central-rollout', '127.0.0.1', 'update.auto', 'system', null, _appVersion + ' -> ' + d.version, {});
    await updater.apply('central-rollout');   // pulls HQ fleet manifest (update_manifest_url), verifies signature, applies, restarts
  } catch (e) { db.setSetting('central_sync_error', 'auto-update: ' + ((e && e.message) || 'error')); }
}

// Pull HQ-managed users down and apply locally (Phase 2b; opt-in). No-op unless
// connected AND central_manages_users is enabled for this facility.
async function pullManagedUsers() {
  const url = db.getSetting('central_url', ''), key = db.getSetting('central_api_key', '');
  const insecure = !!db.getSetting('central_insecure_tls', false);
  if (!url || !key || !db.getSetting('central_manages_users', false)) return;
  let r;
  try { r = await _centralRequest('GET', url + '/sync/users', { headers: { 'x-facility-key': key }, insecure, timeout: 20000 }); }
  catch (e) { db.setSetting('central_sync_error', 'users: ' + ((e && e.message) || 'network error')); return; }
  if (r.status !== 200 || !r.body || !r.body.ok) { db.setSetting('central_sync_error', 'users: ' + ((r.body && r.body.error) || ('HTTP ' + r.status))); return; }
  try { db.applyManagedUsers(r.body.users || []); db.setSetting('central_users_last_pull', _centralTs()); }
  catch (e) { db.setSetting('central_sync_error', 'users-apply: ' + ((e && e.message) || 'error')); }
}

app.post('/api/central/sync-now', requireAuth, csrfCheck, requirePermission('admin.system'), async (req, res) => {
  if (!db.getSetting('central_url', '') || !db.getSetting('central_api_key', ''))
    return res.status(400).json({ error: 'Not connected to HQ' });
  await syncTick();
  res.json({ ok: true, pending: db.outboxPending(), last_sync: db.getSetting('central_last_sync', ''), last_status: db.getSetting('central_last_status', ''), error: db.getSetting('central_sync_error', '') });
});

// Toggle opt-in HQ user management for this facility (default off → no change to
// current behavior). Enabling triggers an immediate pull.
app.post('/api/central/manage-users', requireAuth, csrfCheck, requirePermission('admin.users'), async (req, res) => {
  if (!db.getSetting('central_url', '') || !db.getSetting('central_api_key', ''))
    return res.status(400).json({ error: 'Not connected to HQ' });
  const enabled = !!(req.body && req.body.enabled);
  db.setSetting('central_manages_users', enabled);
  audit(req, 'central.manage_users', 'system', null, enabled ? 'Enabled HQ user management' : 'Disabled HQ user management', {});
  if (enabled) await pullManagedUsers();
  res.json({ ok: true, enabled, count: parseInt(db.getSetting('central_users_count', '0')) || 0, last_pull: db.getSetting('central_users_last_pull', '') });
});

app.post('/api/central/pull-users', requireAuth, csrfCheck, requirePermission('admin.users'), async (req, res) => {
  if (!db.getSetting('central_url', '') || !db.getSetting('central_api_key', ''))
    return res.status(400).json({ error: 'Not connected to HQ' });
  if (!db.getSetting('central_manages_users', false)) return res.status(400).json({ error: 'HQ user management is off' });
  await pullManagedUsers();
  res.json({ ok: true, count: parseInt(db.getSetting('central_users_count', '0')) || 0, last_pull: db.getSetting('central_users_last_pull', ''), error: db.getSetting('central_sync_error', '') });
});

// ── React SPA catch-all (MUST be last — after all API routes) ────
app.get('*',(req,res)=>{
  if (!req.path.startsWith('/api/')) res.sendFile(path.join(REACT_DIST,'index.html'));
  else res.status(404).json({error:'Not found'});
});

// ── Start ─────────────────────────────────────────────────────────
db.init(DB_PATH);

// Export app + db so integration tests (supertest) can import the configured
// Express app without binding a port. The listener, TLS detection, WebSocket
// server, and browser launch only run when server.js is executed directly.
module.exports = { app, db };

if (require.main === module) (()=>{
  // Clean up mojibake middle-dot in facility name (Â· = double-encoded ·)
  {
    const fn = db.getSetting('facility_name','');
    if (fn && fn.includes('Â·')) {
      const fixed = fn.replace(/Â·/g, '·');
      db.setSetting('facility_name', fixed);
      db.save();
      console.log('  Fixed facility name encoding:', fixed);
    }
  }

  const CERT=path.join(DATA,'cert.pem'), KEY=path.join(DATA,'key.pem');
  const useTLS=fs.existsSync(CERT)&&fs.existsSync(KEY);
  let server;
  if(useTLS){ server=https.createServer({cert:fs.readFileSync(CERT),key:fs.readFileSync(KEY)},app); console.log('  TLS: HTTPS enabled'); }
  else { server=http.createServer(app); }

  // Now we know TLS status — update session cookie secure flag
  _sessionMiddleware = buildSession(useTLS);
  wss=new WebSocket.Server({server,verifyClient:(info,cb)=>{
    // Authenticate WebSocket handshake using the same session middleware
    const req=info.req; req.res={setHeader:()=>{},getHeader:()=>null};
    _sessionMiddleware(req,{},()=>{
      if(req.session&&req.session.userId) cb(true);
      else cb(false,401,'Unauthorized');
    });
  }});
  setWss(wss);  // hand the live server to the broadcast module
  wss.on('connection',ws=>{
    // C1: Drop all incoming messages from clients — server-only broadcasts
    // Clients must use REST API; no peer-to-peer relay allowed
    ws.on('message',()=>{});
  });

  // Hourly lock sweep — auto-locks clinical records past their 24h grace window
  setInterval(() => {
    try {
      const n = db.runLockSweep();
      if (n > 0) console.log(`  [lock-sweep] locked ${n} clinical records past 24h grace`);
    } catch(e) {}
  }, 60 * 60 * 1000);

  const proto=useTLS?'https':'http', ip=getLocalIP();
  db.auditLog(null,'system','127.0.0.1','server.start','server',null,'OpsPoint',{version:'2.3.7',tls:useTLS});
  server.listen(PORT,'0.0.0.0',()=>{
    console.log('\n══════════════════════════════════════════════');
    console.log('  OpsPoint v2.3.7');
    console.log('══════════════════════════════════════════════');
    console.log(`  Desktop:  ${proto}://localhost:${PORT}`);
    console.log(`  Mobile:   ${proto}://${ip}:${PORT}`);
    console.log(`  Admin:    ${proto}://localhost:${PORT}/admin`);
    console.log('══════════════════════════════════════════════');
    console.log('══════════════════════════════════════════════\n');
    const{exec}=require('child_process');
    setTimeout(()=>exec(`start ${proto}://localhost:${PORT}`),1200);
  });

  // Multi-facility sync agent — drain the outbox to HQ shortly after boot, then
  // every 20s. No-op (and keeps the outbox bounded) when no central is configured.
  setTimeout(() => { syncTick().catch(() => {}); }, 5000);
  setInterval(() => { syncTick().catch(() => {}); }, 20000);
})();
