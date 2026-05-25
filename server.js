/**
 * ShiftPoint — Server v1.15.0
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
const os      = require('os');
const crypto  = require('crypto');
const db      = require('./db');

const app  = express();
app.disable('x-powered-by');
const PORT = 3000;
const BASE = __dirname;
const DATA = path.join(BASE, 'data');
const DB_PATH = path.join(DATA, 'shift.db');
// React SPA — always served
const REACT_DIST = path.join(BASE, 'client', 'dist');
const serveSPA = (res) => res.sendFile(path.join(REACT_DIST, 'index.html'));

fs.mkdirSync(DATA,                    { recursive:true });
fs.mkdirSync(path.join(DATA,'photos'),{ recursive:true });

// ── Password helpers ─────────────────────────────────────────────
function hashPw(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  return { hash: crypto.pbkdf2Sync(pw,salt,600000,64,'sha512').toString('hex'), salt };
}
function verifyPw(pw, hash, salt) {
  // Try 600000 first (new), fall back to 100000 (legacy hashes from before security update)
  try {
    const r600 = crypto.pbkdf2Sync(pw,salt,600000,64,'sha512').toString('hex');
    if (crypto.timingSafeEqual(Buffer.from(r600,'hex'), Buffer.from(hash,'hex'))) return true;
  } catch(e) {}
  try {
    const r100 = crypto.pbkdf2Sync(pw,salt,100000,64,'sha512').toString('hex');
    if (crypto.timingSafeEqual(Buffer.from(r100,'hex'), Buffer.from(hash,'hex'))) {
      return true; // legacy hash — will be re-hashed at 600000 on next password change
    }
  } catch(e) {}
  return false;
}
function validatePw(pw) {
  if (!pw||pw.length<8)       return 'At least 8 characters required';
  if (!/[A-Z]/.test(pw))      return 'Needs an uppercase letter';
  if (!/[a-z]/.test(pw))      return 'Needs a lowercase letter';
  if (!/[0-9]/.test(pw))      return 'Needs a number';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Needs a symbol (!@#$%^&* etc.)';
  return null;
}

function getLocalIP() {
  try {
    for (const iface of Object.values(os.networkInterfaces()).flat())
      if (iface.family==='IPv4'&&!iface.internal) return iface.address;
  } catch(e) {} return 'localhost';
}
function timeToMins(t) {
  if (!t) return 0;
  const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return 0;
  let h=parseInt(m[1]),mn=parseInt(m[2]),ap=m[3].toUpperCase();
  if(ap==='AM'&&h===12)h=0; if(ap==='PM'&&h!==12)h+=12;
  return h*60+mn;
}

let wss;
function broadcast(msg) {
  if (!wss) return;
  const s = JSON.stringify(msg);
  wss.clients.forEach(c=>{ if(c.readyState===WebSocket.OPEN) c.send(s); });
}

// ── Middleware ───────────────────────────────────────────────────

// ── Security headers ─────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self)');
  // CSP: scoped for local-network app (VULN-15)
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; " + // VULN-11: unsafe-eval removed
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' data: https://fonts.gstatic.com; " +
    "img-src 'self' data: blob:; " +
    "connect-src 'self' ws: wss:; " +
    "worker-src blob:; " +
    "object-src 'none'; frame-src 'none';"
  );
  next();
});

app.use(express.json({ limit:'50mb' })); // 50mb needed for base64 photo uploads
// CORS: only allow same-host origins (localhost variants and LAN IP)
app.use((req,res,next)=>{
  const origin = req.headers.origin;
  // Build CORS allowlist dynamically — handles DHCP IP changes without restart
  const localIP = getLocalIP();
  const allowed = new Set([
    'http://localhost:3000','https://localhost:3000',
    'http://127.0.0.1:3000','https://127.0.0.1:3000',
    'http://'+localIP+':3000','https://'+localIP+':3000'
  ]);
  if (origin && allowed.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials','true');
  }
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.sendStatus(200);
  next();
});

const SECRET_FILE = path.join(DATA,'secret.key');
if (!fs.existsSync(SECRET_FILE)) {
  fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'), {mode:0o600});
  try { fs.chmodSync(SECRET_FILE, 0o600); } catch(e) {}
}
const SESSION_SECRET = fs.readFileSync(SECRET_FILE,'utf8').trim();

// Force-change middleware applied after session
var _sessionMiddleware = null;
function buildSession(secure) {
  return session({
    secret:SESSION_SECRET, resave:false, saveUninitialized:false,
    cookie:{ secure:!!secure, httpOnly:true, sameSite:'lax', maxAge:12*60*60*1000 }
  });
}
_sessionMiddleware = buildSession(false);
app.use((req,res,next) => _sessionMiddleware(req,res,next));

const requireForceChangePw = (req,res,next) => {
  // If user must change password, only allow specific routes until they do
  if (req.session && req.session.must_change_pw) {
    const allowed = ['/change-password', '/api/force-change-password', '/logout', '/api/me', '/api/login'];
    if (allowed.includes(req.path)) return next();
    // Always allow static assets — they don't contain sensitive data and the React
    // SPA needs its CSS/JS to render the change-password page itself
    if (req.path.startsWith('/assets/') || req.path.startsWith('/static/') ||
        req.path.startsWith('/js/') || req.path.startsWith('/css/')) return next();
    if (req.path.startsWith('/api/')) return res.status(403).json({error:'Password change required'});
    return res.redirect('/change-password');
  }
  next();
};

app.use(requireForceChangePw);

const requireAuth = (req,res,next) => {
  if (req.session&&req.session.userId) {
    // Verify user still exists — catches deleted accounts that still have an active session
    if (db.query1('SELECT id FROM users WHERE id=?',[req.session.userId])) return next();
    req.session.destroy(()=>{});
  }
  if (req.path.startsWith('/api/')) return res.status(401).json({error:'Not authenticated'});
  req.session.returnTo = req.originalUrl; res.redirect('/login');
};
function requirePermission(perm) {
  return function(req,res,next) {
    if (!req.session||!req.session.userId) {
      if (req.path.startsWith('/api/')) return res.status(401).json({error:'Not authenticated'});
      req.session.returnTo = req.originalUrl; return res.redirect('/login');
    }
    // Always read from DB — permission changes take effect immediately without re-login
    const _u = db.query1('SELECT permissions,role FROM users WHERE id=?',[req.session.userId]);
    if (!_u) {
      if (req.path.startsWith('/api/')) return res.status(401).json({error:'Not authenticated'});
      return res.redirect('/login');
    }
    const perms = _u.permissions ? JSON.parse(_u.permissions) : (db.ROLE_PRESETS[_u.role]||[]);
    if (perms.includes(perm)) return next();
    if (req.path.startsWith('/api/')) return res.status(403).json({error:'Permission denied'});
    return res.status(403).send('Access denied.');
  };
}

function requireAnyPermission(...perms) {
  return function(req,res,next) {
    if (!req.session||!req.session.userId) {
      if (req.path.startsWith('/api/')) return res.status(401).json({error:'Not authenticated'});
      req.session.returnTo = req.originalUrl; return res.redirect('/login');
    }
    const _u = db.query1('SELECT permissions,role FROM users WHERE id=?',[req.session.userId]);
    if (!_u) {
      if (req.path.startsWith('/api/')) return res.status(401).json({error:'Not authenticated'});
      return res.redirect('/login');
    }
    const userPerms = _u.permissions ? JSON.parse(_u.permissions) : (db.ROLE_PRESETS[_u.role]||[]);
    if (perms.some(p => userPerms.includes(p))) return next();
    if (req.path.startsWith('/api/')) return res.status(403).json({error:'Permission denied'});
    return res.status(403).send('Access denied.');
  };
}

// ── Admin count helper — counts users with admin.users permission ─
function _countAdmins(excludeUserId) {
  return db.query('SELECT id,permissions FROM users',[]).filter(function(u){
    if(excludeUserId!=null&&u.id===excludeUserId) return false;
    try{return JSON.parse(u.permissions||'[]').includes('admin.users');}catch(e){return false;}
  }).length;
}

// ── Audit helper — wraps db.auditLog with request context ────────
function audit(req, action, targetType, targetId, targetLabel, detail, override) {
  try {
    const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
    const actorId   = (override && override.actorId   != null) ? override.actorId   : (req.session && req.session.userId)   || null;
    const actorName = (override && override.actorName)          ? override.actorName  : (req.session && (req.session.displayName || req.session.username)) || 'system';
    db.auditLog(actorId, actorName, ip, action, targetType || '', targetId != null ? String(targetId) : '', targetLabel || '', detail || '');
  } catch(e) {}
}

// VULN-1: CSRF defence — reject cross-origin state-changing requests
function csrfCheck(req, res, next) {
  var origin = req.headers.origin;
  if (origin) {
    var proto = req.secure ? 'https' : 'http';
    var expected = proto + '://' + req.headers.host;
    if (origin !== expected) return res.status(403).json({error:'Forbidden'});
  }
  next();
}

// ── Login ────────────────────────────────────────────────────────

// ── Login rate limiting ──────────────────────────────────────
var _loginAttempts = {}; // in-memory only — resets on server restart (intentional)
function loginRateCheck(ip) {
  var now = Date.now();
  if (!_loginAttempts[ip]) _loginAttempts[ip] = {count:0, resetAt: now + 15*60*1000};
  if (now > _loginAttempts[ip].resetAt) _loginAttempts[ip] = {count:0, resetAt: now + 15*60*1000};
  _loginAttempts[ip].count++;
  return _loginAttempts[ip].count > 10;
}
function loginRateClear(ip) {
  delete _loginAttempts[ip];
}

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

// ── API rate limiting (per IP, in-memory) ────────────────────────
var _apiHits = {};
function apiRateCheck(req) {
  var ip = req.ip||req.connection.remoteAddress||'?';
  var now = Date.now();
  if (!_apiHits[ip]) _apiHits[ip] = {count:0, resetAt: now + 60000};
  if (now > _apiHits[ip].resetAt) _apiHits[ip] = {count:0, resetAt: now + 60000};
  _apiHits[ip].count++;
  return _apiHits[ip].count > 300; // 300 requests/min per IP
}

// ── Data API ──────────────────────────────────────────────────────
app.get('/api/data', requireAuth,(req,res)=>{
  if(apiRateCheck(req)) return res.status(429).json({error:'Too many requests'});
  res.json(db.getAllData());
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
  if(Array.isArray(d.reports)) d.reports.forEach(r=>db.upsertReport(r));
  if(d.logos){
    ['pdec','wcs'].forEach(k=>{
      if(d.logos[k]){
        let v=d.logos[k];
        if(v.startsWith('data:')){
          // VULN-13: Validate logo magic bytes
          if(!_validImageMagicBytes(v)) return;
          v=db.savePhoto(v,`logo_${k}.${v.includes('gif')?'gif':'jpg'}`);
        }
        db.setSetting('logo_'+k,v);
      }
    });
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
      db.run('INSERT INTO log_entries (report_id,time,text) VALUES (?,?,?)',
        [rptId,e.time||'',e.text||'']);
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
  res.json({ok:true});
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
    facility_name:          db.getSetting('facility_name',          'ShiftPoint'),
    wellness_interval_mins: db.getSetting('wellness_interval_mins', 120),
    walk_interval_mins:     db.getSetting('walk_interval_mins',     240),
    walk_areas:             db.getSetting('walk_areas',             db.DEFAULT_WALK_AREAS),
    ua_panel:               db.getSetting('ua_panel',               db.DEFAULT_UA_PANEL),
    wellness_schedule:      db.getSetting('wellness_schedule',      []),
    walk_schedule:          db.getSetting('walk_schedule',          []),
    shift_day_start:        db.getSetting('shift_day_start',        '07:00'),
    shift_swing_start:      db.getSetting('shift_swing_start',      '15:00'),
    shift_grave_start:      db.getSetting('shift_grave_start',      '23:00'),
    ui_visibility:          db.getSetting('ui_visibility',          {tabs:{staff:true,chores:true,passes:true,caseloads:true,mail:true,reports:true,infractions:true},buttons:{wellness:true,walkthrough:true}}),
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
  const{room,name,case_manager,phone,intake_date}=req.body;
  if(!name||!String(name).trim()) return res.status(400).json({error:'Name is required'});
  if(!room||!String(room).trim())  return res.status(400).json({error:'Room is required'});
  // Block if a real (non-VACANT) resident already has this room
  const occ=db.query1(`SELECT name FROM clients WHERE room=? AND name!='VACANT' AND is_active=1 AND is_special=0`,[String(room)]);
  if(occ) return res.status(409).json({error:'Room '+room+' is already occupied by '+occ.name});
  // If a VACANT row exists for this room, update it in-place (avoids duplicates)
  const vacant=db.query1(`SELECT id FROM clients WHERE room=? AND name='VACANT' AND is_active=1`,[String(room)]);
  let resultId;
  if(vacant){
    db.run(`UPDATE clients SET name=?,case_manager=?,phone=?,intake_date=?,is_active=1 WHERE id=?`,
      [String(name).trim(),case_manager||'',phone||'',intake_date||null,vacant.id]);
    resultId=vacant.id;
  } else {
    const maxRow=db.query1('SELECT MAX(sort_order) AS m FROM clients');
    const sortOrder=(maxRow&&maxRow.m!=null?maxRow.m:0)+1;
    db.run(`INSERT INTO clients (room,name,case_manager,phone,intake_date,is_active,is_special,sort_order)
      VALUES (?,?,?,?,?,1,0,?)`,
      [String(room),String(name).trim(),case_manager||'',phone||'',intake_date||null,sortOrder]);
    const newId=db.query1('SELECT last_insert_rowid() AS id');
    resultId=newId?newId.id:null;
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
  const{room,name,case_manager,phone,intake_date,discharge_date,photo,is_active}=req.body;
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
  if(!Array.isArray(rooms)||!rooms.length) return res.status(400).json({error:'rooms array required'});
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
  if (loginOrigin) {
    const proto = req.secure ? 'https' : 'http';
    const expectedOrigin = proto + '://' + req.headers.host;
    if (loginOrigin !== expectedOrigin) return res.status(403).json({error:'Forbidden'});
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

// ── Staff Directory ───────────────────────────────────────────────
app.get('/api/staff', requireAuth,(req,res)=>{
  res.json(db.query('SELECT * FROM staff ORDER BY sort_order, id'));
});
app.post('/api/staff', requireAuth, csrfCheck, requirePermission('staff.edit'),(req,res)=>{
  const{category,name,phone,phone2,notes}=req.body;
  if(!name||!name.trim()) return res.status(400).json({error:'Name required'});
  if(name.trim().length > 200) return res.status(400).json({error:'Name too long (max 200 chars)'});
  if(phone && phone.length > 30) return res.status(400).json({error:'Phone too long (max 30 chars)'});
  if(phone2 && phone2.length > 30) return res.status(400).json({error:'Phone2 too long (max 30 chars)'});
  if(notes && notes.length > 2000) return res.status(400).json({error:'Notes too long (max 2000 chars)'});
  if(category && category.length > 100) return res.status(400).json({error:'Category too long (max 100 chars)'});
  const maxSort=db.query1('SELECT MAX(sort_order) as m FROM staff');
  const so=(maxSort&&maxSort.m!=null)?maxSort.m+1:0;
  db.run('INSERT INTO staff (category,name,phone,phone2,notes,sort_order) VALUES (?,?,?,?,?,?)',
    [category||'',name.trim(),phone||'',phone2||'',notes||'',so]);
  db.save();
  audit(req,'staff.add','staff',null,name.trim(),{category:category||''});
  broadcast({type:'staff_updated',user:req.session.displayName});
  res.json({ok:true,staff:db.query1('SELECT * FROM staff ORDER BY id DESC LIMIT 1')});
});
app.put('/api/staff/:id', requireAuth, csrfCheck, requirePermission('staff.edit'),(req,res)=>{
  const id=parseInt(req.params.id);
  if(!db.query1('SELECT id FROM staff WHERE id=?',[id])) return res.status(404).json({error:'Not found'});
  const{category,name,phone,phone2,notes,sort_order}=req.body;
  if(name!==undefined&&name.trim().length>200) return res.status(400).json({error:'Name too long'});
  if(phone!==undefined&&phone.length>30) return res.status(400).json({error:'Phone too long'});
  if(phone2!==undefined&&phone2.length>30) return res.status(400).json({error:'Phone2 too long'});
  if(notes!==undefined&&notes.length>2000) return res.status(400).json({error:'Notes too long'});
  if(category!==undefined&&category.length>100) return res.status(400).json({error:'Category too long'});
  if(category!==undefined) db.run('UPDATE staff SET category=? WHERE id=?',[category,id]);
  if(name!==undefined)     db.run('UPDATE staff SET name=? WHERE id=?',[name.trim(),id]);
  if(phone!==undefined)    db.run('UPDATE staff SET phone=? WHERE id=?',[phone,id]);
  if(phone2!==undefined)   db.run('UPDATE staff SET phone2=? WHERE id=?',[phone2,id]);
  if(notes!==undefined)    db.run('UPDATE staff SET notes=? WHERE id=?',[notes,id]);
  if(sort_order!==undefined) db.run('UPDATE staff SET sort_order=? WHERE id=?',[parseInt(sort_order),id]);
  db.save();
  const _stfE=db.query1('SELECT name FROM staff WHERE id=?',[id]);
  audit(req,'staff.edit','staff',id,_stfE?_stfE.name:String(id));
  broadcast({type:'staff_updated',user:req.session.displayName});
  res.json({ok:true});
});
app.delete('/api/staff/:id', requireAuth, csrfCheck, requirePermission('staff.edit'),(req,res)=>{
  const id=parseInt(req.params.id);
  const _stfD=db.query1('SELECT name,category FROM staff WHERE id=?',[id]);
  if(!_stfD) return res.status(404).json({error:'Not found'});
  db.run('DELETE FROM staff WHERE id=?',[id]); db.save();
  audit(req,'staff.delete','staff',id,_stfD.name,{category:_stfD.category});
  broadcast({type:'staff_updated',user:req.session.displayName});
  res.json({ok:true});
});
// Staff categories setting
app.get('/api/staff/categories', requireAuth,(req,res)=>{
  res.json(db.getSetting('staff_categories',['Director','Case Manager','Monitor','Other']));
});
app.put('/api/staff/categories', requireAuth, csrfCheck, requirePermission('staff.edit'),(req,res)=>{
  const{categories}=req.body;
  if(!Array.isArray(categories)) return res.status(400).json({error:'categories must be array'});
  db.setSetting('staff_categories',categories.filter(c=>c&&c.trim()));
  db.save();
  audit(req,'staff.categories','settings',null,'Staff Categories',{categories:categories.filter(c=>c&&c.trim())});
  res.json({ok:true});
});

// ── Chores — chore assignments live on clients, log per day ──────
// Get master chore list
app.get('/api/master-chores', requireAuth,(req,res)=>{
  res.json(db.getSetting('master_chores',[]));
});
app.put('/api/master-chores', requireAuth, csrfCheck, requirePermission('chores.edit'),(req,res)=>{
  const{chores}=req.body;
  if(!Array.isArray(chores)) return res.status(400).json({error:'chores must be array'});
  db.setSetting('master_chores',chores.filter(c=>c&&c.trim()));
  db.save();
  audit(req,'chore.master_edit','settings',null,'Master Chores',{count:chores.length});
  res.json({ok:true});
});
// Update a single client's chore assignment (supervisor only)
app.patch('/api/clients/:id/chore', requireAuth, csrfCheck, requirePermission('chores.edit'),(req,res)=>{
  const id=parseInt(req.params.id);
  if(!db.query1('SELECT id FROM clients WHERE id=?',[id])) return res.status(404).json({error:'Not found'});
  const{chore,chore_time}=req.body;
  if(chore!==undefined)      db.run('UPDATE clients SET chore=? WHERE id=?',[chore||'',id]);
  if(chore_time!==undefined) db.run('UPDATE clients SET chore_time=? WHERE id=?',[chore_time||'',id]);
  db.save();
  const _cc=db.query1('SELECT name,room FROM clients WHERE id=?',[id]);
  audit(req,'chore.assign','client',id,_cc?(_cc.name+' Rm.'+_cc.room):String(id),{chore:chore||'',chore_time:chore_time||''});
  broadcast({type:'data_saved',user:req.session.displayName});
  res.json({ok:true});
});
// Get chore log — single date or date range (?from=YYYY-MM-DD&to=YYYY-MM-DD)
app.get('/api/chore-log', requireAuth,(req,res)=>{
  if(req.query.from && req.query.to){
    return res.json(db.query('SELECT * FROM chore_log WHERE log_date>=? AND log_date<=? ORDER BY log_date',[req.query.from,req.query.to]));
  }
  const date=req.query.date||new Date().toISOString().slice(0,10);
  res.json(db.query('SELECT * FROM chore_log WHERE log_date=?',[date]));
});
// Upsert a chore log entry (any authenticated user can initial)
app.put('/api/chore-log', requireAuth, csrfCheck, requirePermission('chores.edit'),(req,res)=>{
  const{client_id,log_date,initials}=req.body;
  if(!client_id||!log_date) return res.status(400).json({error:'client_id and log_date required'});
  db.run('INSERT OR REPLACE INTO chore_log (client_id,log_date,initials) VALUES (?,?,?)',
    [parseInt(client_id),log_date,initials||'']);
  db.save();
  audit(req,'chore.initial','client',client_id,String(client_id),{log_date,initials:initials||''});
  broadcast({type:'chore_log_updated',user:req.session.displayName,client_id,log_date,initials});
  res.json({ok:true});
});

// ── Weekend Passes ────────────────────────────────────────────────
app.get('/api/passes', requireAuth,(req,res)=>{
  res.json(db.query(`SELECT * FROM passes ORDER BY
    CASE status WHEN 'Out' THEN 0 WHEN 'Extended' THEN 1 ELSE 2 END, return_date ASC`));
});
app.post('/api/passes', requireAuth, csrfCheck, requirePermission('passes.edit'),(req,res)=>{
  const{client_id,room,name,departure,return_date,ua_notes,notes,status}=req.body;
  if(!client_id||!name) return res.status(400).json({error:'client_id and name required'});
  const client=db.query1('SELECT id,room,name FROM clients WHERE id=?',[parseInt(client_id)]);
  if(!client) return res.status(404).json({error:'Client not found'});
  if(ua_notes && ua_notes.length > 500) return res.status(400).json({error:'UA notes too long (max 500 chars)'});
  if(notes && notes.length > 1000) return res.status(400).json({error:'Notes too long (max 1000 chars)'});
  db.run(`INSERT INTO passes (client_id,room,name,departure,return_date,ua_notes,notes,status)
    VALUES (?,?,?,?,?,?,?,?)`,
    [parseInt(client_id),room||client.room,name||client.name,
     departure||'',return_date||'',ua_notes||'',notes||'',status||'Out']);
  db.save();
  audit(req,'passes.add','pass',null,name||client.name,{departure:departure||'',return_date:return_date||'',status:status||'Out'});
  broadcast({type:'passes_updated',user:req.session.displayName});
  res.json({ok:true,pass:db.query1('SELECT * FROM passes ORDER BY id DESC LIMIT 1')});
});
app.put('/api/passes/:id', requireAuth, csrfCheck, requireAnyPermission('passes.edit','passes.status'),(req,res)=>{
  const id=parseInt(req.params.id);
  if(!db.query1('SELECT id FROM passes WHERE id=?',[id])) return res.status(404).json({error:'Not found'});
  const{departure,return_date,ua_notes,notes,status}=req.body;

  // Status-only callers (passes.status) cannot touch any other field
  const _pu = db.query1('SELECT permissions,role FROM users WHERE id=?',[req.session.userId]);
  const _perms = (_pu && _pu.permissions) ? JSON.parse(_pu.permissions) : (db.ROLE_PRESETS[req.session.role]||[]);
  const hasEdit = _perms.includes('passes.edit');
  const touchingNonStatusField = departure !== undefined || return_date !== undefined || ua_notes !== undefined || notes !== undefined;
  if (!hasEdit && touchingNonStatusField) {
    return res.status(403).json({error:'Permission denied (passes.edit required to change pass details)'});
  }

  if(departure!==undefined)   db.run('UPDATE passes SET departure=? WHERE id=?',[departure,id]);
  if(return_date!==undefined) db.run('UPDATE passes SET return_date=? WHERE id=?',[return_date,id]);
  if(ua_notes!==undefined)    db.run('UPDATE passes SET ua_notes=? WHERE id=?',[ua_notes,id]);
  if(notes!==undefined)       db.run('UPDATE passes SET notes=? WHERE id=?',[notes,id]);
  if(status!==undefined&&['Out','Extended','Returned'].includes(status))
    db.run('UPDATE passes SET status=? WHERE id=?',[status,id]);
  db.save();
  const _psE=db.query1('SELECT name,status FROM passes WHERE id=?',[id]);
  if(status!==undefined&&_psE) audit(req,'passes.status','pass',id,_psE.name,{status});
  else audit(req,'passes.edit','pass',id,_psE?_psE.name:String(id));
  broadcast({type:'passes_updated',user:req.session.displayName});
  res.json({ok:true});
});
app.delete('/api/passes/:id', requireAuth, csrfCheck, requirePermission('passes.edit'),(req,res)=>{
  const id=parseInt(req.params.id);
  const _psD=db.query1('SELECT name FROM passes WHERE id=?',[id]);
  if(!_psD) return res.status(404).json({error:'Not found'});
  db.run('DELETE FROM passes WHERE id=?',[id]); db.save();
  audit(req,'passes.delete','pass',id,_psD.name);
  broadcast({type:'passes_updated',user:req.session.displayName});
  res.json({ok:true});
});
// Pass notice board
app.get('/api/pass-notice', requireAuth,(req,res)=>{
  res.json({notice:db.getSetting('pass_notice','')});
});
app.put('/api/pass-notice', requireAuth, csrfCheck, requirePermission('passes.edit'),(req,res)=>{
  const{notice}=req.body;
  if(String(notice||'').length > 1000) return res.status(400).json({error:'Notice too long (max 1000 chars)'});
  db.setSetting('pass_notice',String(notice||''));
  db.save();
  audit(req,'passes.notice','settings',null,'Pass Notice',{notice:String(notice||'').slice(0,100)});
  broadcast({type:'pass_notice_updated',user:req.session.displayName,notice:notice||''});
  res.json({ok:true});
});


// ── UA Requests ────────────────────────────────────────────────────
app.get('/api/ua-requests', requireAuth, (req,res)=>{
  const rows = db.query('SELECT * FROM ua_requests WHERE acknowledged=0 ORDER BY requested_at DESC');
  res.json(rows);
});

app.post('/api/ua-requests', requireAuth, csrfCheck, requirePermission('ua.request'), (req,res)=>{
  const {client_id, client_name, room, is_interview, interview_name} = req.body;
  const isIntv = is_interview ? 1 : 0;
  const intvName = String(interview_name||'').slice(0,200);
  if (!isIntv && !client_id) return res.status(400).json({error:'client_id required'});
  if (isIntv && !intvName) return res.status(400).json({error:'interview_name required'});
  const by = req.session.displayName||req.session.username;
  db.run(
    `INSERT INTO ua_requests (client_id,client_name,room,requested_by,is_interview,interview_name) VALUES (?,?,?,?,?,?)`,
    [client_id||0, client_name||'', room||'', by, isIntv, intvName]
  );
  db.save();
  audit(req,'ua.request','client',client_id||null,isIntv?intvName:(client_name||String(client_id)),{room:room||'',interview:isIntv});
  const pending = db.query('SELECT * FROM ua_requests WHERE acknowledged=0 ORDER BY requested_at DESC');
  broadcast({type:'ua_request', requests: pending});
  res.json({ok:true});
});

app.post('/api/ua-requests/:id/acknowledge', requireAuth, csrfCheck, requirePermission('ua.acknowledge'), (req,res)=>{
  const id = parseInt(req.params.id,10);
  const _uar=db.query1('SELECT client_name,room FROM ua_requests WHERE id=?',[id]);
  db.run(
    `UPDATE ua_requests SET acknowledged=1, acknowledged_by=?, acknowledged_at=datetime('now') WHERE id=?`,
    [req.session.displayName||req.session.username, id]
  );
  db.save();
  audit(req,'ua.acknowledge','ua_request',id,_uar?(_uar.client_name+(_uar.room?' Rm.'+_uar.room:'')):String(id));
  const pending = db.query('SELECT * FROM ua_requests WHERE acknowledged=0 ORDER BY requested_at DESC');
  broadcast({type:'ua_request', requests: pending});
  res.json({ok:true});
});

// ── UA Draws ───────────────────────────────────────────────────────
app.get('/api/ua-draws', requireAuth, (req,res)=>{
  const since = req.query.since || new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  res.json(db.getUADraws(since));
});

app.get('/api/ua-draws/recent-clients', requireAuth, requirePermission('ua.draw'), (req,res)=>{
  const days = Math.min(parseInt(req.query.days)||30, 365);
  const ids = db.getRecentDrawnClientIds(days);
  res.json({ ids: Array.from(ids) });
});

app.post('/api/ua-draws', requireAuth, csrfCheck, requirePermission('ua.draw'), (req,res)=>{
  const { residents } = req.body;
  if (!Array.isArray(residents)||residents.length===0)
    return res.status(400).json({error:'residents required'});
  const by   = req.session.displayName||req.session.username;
  const byId = req.session.userId;
  const draw = db.createUADraw(byId, by, residents);
  residents.forEach(c=>{
    db.run(
      `INSERT INTO ua_requests (client_id,client_name,room,requested_by,is_interview,interview_name) VALUES (?,?,?,?,0,'')`,
      [c.id||0, c.name||'', c.room||'', by]
    );
  });
  db.save();
  audit(req,'ua.draw','ua_draw',draw.id,`${residents.length} residents`,{residents});
  const pending = db.query('SELECT * FROM ua_requests WHERE acknowledged=0 ORDER BY requested_at DESC');
  broadcast({type:'ua_draw_created', drawId:draw.id, draw, requests:pending});
  res.json({ok:true, drawId:draw.id});
});

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

// ── Mail Log ──────────────────────────────────────────────────────
app.get('/api/mail', requireAuth, (req,res)=>{
  res.json(db.query('SELECT * FROM mail_log ORDER BY logged_at DESC'));
});

app.post('/api/mail', requireAuth, csrfCheck, requirePermission('mail.log'), (req,res)=>{
  // Accept bulk array OR legacy single client_id
  let list=[];
  if(Array.isArray(req.body.clients)&&req.body.clients.length) list=req.body.clients;
  else if(req.body.client_id) list=[{client_id:req.body.client_id,client_name:req.body.client_name,room:req.body.room,notes:req.body.notes}];
  if(!list.length) return res.status(400).json({error:'No clients selected'});
  const{logged_at,logged_by}=req.body;
  const by=String(logged_by||req.session.displayName||req.session.username||'').slice(0,100);
  const atTime=logged_at||new Date().toISOString();
  // Validate and resolve each client
  const resolved=[];
  for(const item of list){
    const cid=parseInt(item.client_id);
    if(!cid) continue;
    const client=db.query1('SELECT id,room,name FROM clients WHERE id=?',[cid]);
    if(!client) continue;
    const itemNotes=String(item.notes||'').slice(0,500);
    resolved.push({
      client_id:client.id,
      client_name:String(item.client_name||client.name||'').slice(0,200),
      room:String(item.room||client.room||'').slice(0,20),
      notes:itemNotes,
    });
  }
  if(!resolved.length) return res.status(404).json({error:'No valid clients found'});
  // Insert one mail_log record per client (each with its own notes)
  for(const r of resolved){
    db.run(
      `INSERT INTO mail_log (client_id,client_name,room,logged_by,logged_at,notes,status) VALUES (?,?,?,?,?,?,'pending')`,
      [r.client_id,r.client_name,r.room,by,atTime,r.notes]
    );
    audit(req,'mail.log','mail',null,r.client_name+' Rm.'+r.room,{notes:r.notes});
  }
  // ONE consolidated log entry for the active shift report
  const activeId=db.getSetting('active_report_id',null);
  if(activeId){
    const now=new Date();
    const h=now.getHours(),m=String(now.getMinutes()).padStart(2,'0');
    const ap=h>=12?'PM':'AM',h12=h%12||12;
    const timeStr=`${h12}:${m} ${ap}`;
    let logText;
    if(resolved.length===1){
      const r=resolved[0];
      logText=`Mail received for ${r.client_name} (Rm. ${r.room})`;
      if(r.notes) logText+=` [${r.notes}]`;
      logText+=` — logged by ${by}`;
    } else {
      const names=resolved.map(r=>r.notes?`${r.client_name} (Rm. ${r.room}) [${r.notes}]`:`${r.client_name} (Rm. ${r.room})`).join(', ');
      logText=`Mail received for ${resolved.length} residents: ${names} — logged by ${by}`;
    }
    db.run('INSERT INTO log_entries (report_id,time,text) VALUES (?,?,?)',[activeId,timeStr,logText]);
    db.run('UPDATE reports SET updated_at=? WHERE id=?',[new Date().toISOString(),activeId]);
    broadcast({type:'data_saved',user:req.session.displayName||req.session.username});
  }
  db.save();
  broadcast({type:'mail_updated',user:req.session.displayName||req.session.username});
  res.json({ok:true});
});

app.put('/api/mail/:id/approve', requireAuth, csrfCheck, requirePermission('mail.approve'), (req,res)=>{
  const id=parseInt(req.params.id);
  if(!db.query1('SELECT id FROM mail_log WHERE id=?',[id])) return res.status(404).json({error:'Not found'});
  const by=req.session.displayName||req.session.username;
  const _mlA=db.query1('SELECT client_name,room FROM mail_log WHERE id=?',[id]);
  db.run(`UPDATE mail_log SET status='approved',approved_by=?,approved_at=datetime('now') WHERE id=?`,[by,id]);
  db.save();
  audit(req,'mail.approve','mail',id,_mlA?(_mlA.client_name+' Rm.'+_mlA.room):String(id));
  broadcast({type:'mail_updated',user:by});
  res.json({ok:true});
});

app.put('/api/mail/:id/deliver', requireAuth, csrfCheck, (req,res)=>{
  const id=parseInt(req.params.id);
  const _mlD=db.query1('SELECT client_name,room FROM mail_log WHERE id=?',[id]);
  if(!_mlD) return res.status(404).json({error:'Not found'});
  db.run(`UPDATE mail_log SET status='delivered',delivered_at=datetime('now') WHERE id=?`,[id]);
  db.save();
  audit(req,'mail.deliver','mail',id,_mlD.client_name+' Rm.'+_mlD.room);
  broadcast({type:'mail_updated',user:req.session.displayName||req.session.username});
  res.json({ok:true});
});

app.delete('/api/mail/:id', requireAuth, csrfCheck, requirePermission('mail.delete'), (req,res)=>{
  const id=parseInt(req.params.id);
  const _mlDel=db.query1('SELECT client_name,room FROM mail_log WHERE id=?',[id]);
  if(!_mlDel) return res.status(404).json({error:'Not found'});
  db.run('DELETE FROM mail_log WHERE id=?',[id]);
  db.save();
  audit(req,'mail.delete','mail',id,_mlDel.client_name+' Rm.'+_mlDel.room);
  broadcast({type:'mail_updated',user:req.session.displayName||req.session.username});
  res.json({ok:true});
});

// ── Infractions ───────────────────────────────────────────────────
function _infractionCounts() {
  const r=db.query1('SELECT COUNT(*) as c FROM infractions WHERE status=?',['pending']);
  const a=db.query1('SELECT COUNT(*) as c FROM infractions WHERE status=?',['assigned']);
  return {pendingReview:r?r.c:0, pendingConsequences:a?a.c:0};
}

app.get('/api/infractions', requireAuth, (req,res)=>{
  if(apiRateCheck(req)) return res.status(429).json({error:'Too many requests'});
  const{status,client_id}=req.query;
  let sql='SELECT * FROM infractions';
  const params=[];
  if(status&&status!=='all'){sql+=' WHERE status=?';params.push(status);}
  if(client_id){sql+=(params.length?' AND':' WHERE')+' client_id=?';params.push(parseInt(client_id));}
  sql+=' ORDER BY logged_at DESC';
  res.json(db.query(sql,params));
});

app.post('/api/infractions', requireAuth, csrfCheck, requirePermission('infractions.log'), (req,res)=>{
  if(apiRateCheck(req)) return res.status(429).json({error:'Too many requests'});
  const{client_id,client_name,room,infraction_date,description,notes}=req.body;
  if(!client_id||!description) return res.status(400).json({error:'client_id and description required'});
  const loggedBy=req.session.displayName||req.session.username;
  db.run('INSERT INTO infractions (client_id,client_name,room,infraction_date,description,notes,logged_by) VALUES (?,?,?,?,?,?,?)',
    [client_id,client_name||'',room||'',infraction_date||'',description,notes||'',loggedBy]);
  const v=db.query1('SELECT * FROM infractions ORDER BY id DESC LIMIT 1');
  audit(req,'infraction.log','infraction',v?v.id:null,String(client_name||client_id),{description});
  broadcast({type:'infractions_updated',..._infractionCounts()});
  res.json({ok:true,id:v?v.id:null});
});

app.put('/api/infractions/:id/review', requireAuth, csrfCheck, requirePermission('infractions.review'), (req,res)=>{
  const id=parseInt(req.params.id);
  const v=db.query1('SELECT * FROM infractions WHERE id=?',[id]);
  if(!v) return res.status(404).json({error:'Not found'});
  if(v.status!=='pending') return res.status(400).json({error:'Infraction is not pending review'});
  const{action,consequence}=req.body;
  const by=req.session.displayName||req.session.username;
  const now=new Date().toISOString().slice(0,19).replace('T',' ');
  if(action==='waive'){
    db.run('UPDATE infractions SET status=?,consequence_by=?,consequence_at=? WHERE id=?',['waived',by,now,id]);
  } else {
    if(!consequence) return res.status(400).json({error:'consequence required'});
    db.run('UPDATE infractions SET status=?,consequence=?,consequence_by=?,consequence_at=? WHERE id=?',['assigned',consequence,by,now,id]);
  }
  audit(req,'infraction.review','infraction',id,v.client_name,{action,consequence});
  broadcast({type:'infractions_updated',..._infractionCounts()});
  res.json({ok:true});
});

app.put('/api/infractions/:id/complete', requireAuth, csrfCheck, requirePermission('infractions.complete'), (req,res)=>{
  const id=parseInt(req.params.id);
  const v=db.query1('SELECT * FROM infractions WHERE id=?',[id]);
  if(!v) return res.status(404).json({error:'Not found'});
  if(v.status!=='assigned') return res.status(400).json({error:'Infraction must have an assigned consequence'});
  const by=req.session.displayName||req.session.username;
  const now=new Date().toISOString().slice(0,19).replace('T',' ');
  db.run('UPDATE infractions SET status=?,completed_by=?,completed_at=? WHERE id=?',['completed',by,now,id]);
  audit(req,'infraction.complete','infraction',id,v.client_name);
  broadcast({type:'infractions_updated',..._infractionCounts()});
  res.json({ok:true});
});

app.delete('/api/infractions/:id', requireAuth, csrfCheck, requirePermission('infractions.delete'), (req,res)=>{
  const id=parseInt(req.params.id);
  const v=db.query1('SELECT client_name FROM infractions WHERE id=?',[id]);
  if(!v) return res.status(404).json({error:'Not found'});
  db.run('DELETE FROM infractions WHERE id=?',[id]);
  audit(req,'infraction.delete','infraction',id,v.client_name);
  broadcast({type:'infractions_updated',..._infractionCounts()});
  res.json({ok:true});
});

// ── Server restart (admin only) ───────────────────────────────────
app.post('/api/admin/restart', requireAuth, csrfCheck, requirePermission('admin.system'), (req,res)=>{
  audit(req,'server.restart','server',null,'Server Restart',{by:req.session.displayName||req.session.username});
  broadcast({type:'server_restarting',user:req.session.displayName||req.session.username});
  res.json({ok:true});
  setTimeout(()=>{
    const{spawn}=require('child_process');
    const child=spawn(process.execPath,[path.join(BASE,'server.js')],{
      detached:true, stdio:'ignore', cwd:BASE
    });
    child.unref();
    process.exit(0);
  }, 600);
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

// ── React SPA catch-all (MUST be last — after all API routes) ────
app.get('*',(req,res)=>{
  if (!req.path.startsWith('/api/')) res.sendFile(path.join(REACT_DIST,'index.html'));
  else res.status(404).json({error:'Not found'});
});

// ── Start ─────────────────────────────────────────────────────────
db.init(DB_PATH);
(()=>{
  // Clean up stale logo paths from old installations (not data URIs = unusable)
  ['logo_pdec','logo_wcs'].forEach(k=>{
    const v = db.getSetting(k,'');
    if (v && !v.startsWith('data:')) {
      db.setSetting(k,'');
      db.save();
      console.log('  Cleared stale logo path:', k, '=', v);
    }
  });
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
  wss.on('connection',ws=>{
    // C1: Drop all incoming messages from clients — server-only broadcasts
    // Clients must use REST API; no peer-to-peer relay allowed
    ws.on('message',()=>{});
  });

  const proto=useTLS?'https':'http', ip=getLocalIP();
  db.auditLog(null,'system','127.0.0.1','server.start','server',null,'ShiftPoint',{version:'1.15.0',tls:useTLS});
  server.listen(PORT,'0.0.0.0',()=>{
    console.log('\n══════════════════════════════════════════════');
    console.log('  ShiftPoint v1.15.0');
    console.log('══════════════════════════════════════════════');
    console.log(`  Desktop:  ${proto}://localhost:${PORT}`);
    console.log(`  Mobile:   ${proto}://${ip}:${PORT}`);
    console.log(`  Admin:    ${proto}://localhost:${PORT}/admin`);
    console.log('══════════════════════════════════════════════');
    console.log('══════════════════════════════════════════════\n');
    const{exec}=require('child_process');
    setTimeout(()=>exec(`start ${proto}://localhost:${PORT}`),1200);
  });
})();
