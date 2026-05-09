/**
 * ShiftPoint — Server v1.14.0
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
  // If user must change password, only allow /change-password and /api/force-change-password and /logout
  if (req.session && req.session.must_change_pw) {
    if (req.path === '/change-password' || req.path === '/api/force-change-password' || req.path === '/logout') return next();
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

function serveLogin(res,err='') {
  let h = fs.readFileSync(path.join(BASE,'login.html'),'utf8');
  h = h.replace('{{ERROR}}', err?`<div class="err">\u26a0 ${err}</div>`:'');
  res.setHeader('Content-Type','text/html; charset=utf-8'); res.send(h);
}
// Certificate download — no auth required so mobile devices can install it
// Visit https://<LAN-IP>:3000/cert on the phone, accept the warning, download & install
app.get('/cert',(req,res)=>{
  const certPath = path.join(DATA,'cert.pem');
  if(!fs.existsSync(certPath)) return res.status(404).send('No certificate on this server.');
  res.setHeader('Content-Type','application/x-x509-ca-cert');
  res.setHeader('Content-Disposition','attachment; filename="shiftpoint.crt"');
  res.sendFile(certPath);
});

app.get('/login',(req,res)=>{
  if(req.session&&req.session.userId) return res.redirect('/');
  serveLogin(res);
});
app.post('/login', express.urlencoded({extended:false}),(req,res)=>{
  // VULN-7: Reject cross-origin login POSTs (CSRF defence)
  // Compare Origin against the Host the browser actually connected to — works for any LAN IP
  const loginOrigin = req.headers.origin;
  if (loginOrigin) {
    const proto = req.secure ? 'https' : 'http';
    const expectedOrigin = proto + '://' + req.headers.host;
    if (loginOrigin !== expectedOrigin) return res.status(403).send('<h2>Forbidden</h2>');
  }
  const ip=req.ip||req.connection.remoteAddress||'unknown';
  if (loginRateCheck(ip)) return res.status(429).send('<h2>Too many login attempts. Wait 15 minutes.</h2>');
  const {username,password}=req.body;
  const u = db.query1('SELECT * FROM users WHERE LOWER(username)=LOWER(?)',[username||'']);
  if(!u) {
    // H3: Constant-time response — run dummy PBKDF2 so invalid user takes same time as wrong password
    const _dummy = crypto.randomBytes(16).toString('hex');
    crypto.pbkdf2Sync('dummy',_dummy,600000,64,'sha512');
    audit(req,'auth.login_fail','user',null,username||'?',{reason:'user_not_found'},{actorId:null,actorName:username||'?'});
    return serveLogin(res,'Invalid username or password.');
  }
  try { if(!verifyPw(password||'',u.hash,u.salt)) {
    audit(req,'auth.login_fail','user',u.id,u.username,{reason:'bad_password'},{actorId:null,actorName:u.username});
    return serveLogin(res,'Invalid username or password.');
  }} catch(e){ return serveLogin(res,'Login error.'); }
  // VULN-16: Do NOT clear the rate limit on success — prevents NAT-shared IP bypass
  // VULN-14: Regenerate session ID on login to prevent session fixation
  const savedReturnTo = req.session.returnTo;
  req.session.regenerate(function(err) {
    if (err) return serveLogin(res, 'Login error.');
    req.session.userId=u.id; req.session.username=u.username;
    req.session.displayName=u.display_name; req.session.role=u.role;
    // Load per-user permissions from DB; fall back to role preset for legacy users
    const _pu=db.query1('SELECT permissions FROM users WHERE id=?',[u.id]);
    req.session.permissions=(_pu&&_pu.permissions)?JSON.parse(_pu.permissions):(db.ROLE_PRESETS[u.role]||[]);
    audit(req,'auth.login','user',u.id,u.display_name||u.username,null,{actorId:u.id,actorName:u.display_name||u.username});
    if (u.must_change_pw) {
      req.session.must_change_pw = true;
      return req.session.save(()=>res.redirect('/change-password'));
    }
    const raw = savedReturnTo || '/';
    const dest = (raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\')) ? raw : '/';
    // Explicitly save session before redirect so the follow-up GET sees the session
    // immediately — avoids a race condition where the store write is still pending
    req.session.save(()=>res.redirect(dest));
  });
});
app.post('/logout', csrfCheck, (req,res)=>{
  audit(req,'auth.logout','user',req.session.userId,req.session.displayName||req.session.username);
  req.session.destroy(()=>res.redirect('/login'));
});


// ── Force password change ────────────────────────────────────
app.get('/change-password', requireAuth, (req, res) => {
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Change Password</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Outfit',sans-serif;background:#F4F6F8;display:flex;align-items:center;justify-content:center;min-height:100vh;}
.box{background:#fff;border-radius:14px;padding:36px 32px;max-width:420px;width:100%;box-shadow:0 4px 20px rgba(0,0,0,.1);}
.logo{background:#1A3327;color:#A8D5B5;padding:10px 16px;border-radius:8px;font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:24px;display:inline-block;}
h2{font-size:1.2rem;font-weight:800;color:#1A3327;margin-bottom:6px;}
p{font-size:.84rem;color:#4B5563;margin-bottom:22px;line-height:1.5;}
.field{margin-bottom:14px;}
.field label{display:block;font-size:.7rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#4B5563;margin-bottom:5px;}
.field input{width:100%;padding:10px 13px;border:1.5px solid #D4E6DA;border-radius:8px;font-size:.9rem;font-family:'Outfit',sans-serif;outline:none;}
.field input:focus{border-color:#2D6A4F;}
.btn{width:100%;padding:11px;background:#2D6A4F;color:#fff;border:none;border-radius:8px;font-size:.9rem;font-weight:700;cursor:pointer;font-family:'Outfit',sans-serif;margin-top:4px;}
.btn:hover{background:#1A5C42;}
.err{background:#FEE2E2;color:#991B1B;border:1px solid #FCA5A5;padding:9px 13px;border-radius:8px;font-size:.82rem;margin-bottom:14px;}
.req{font-size:.76rem;color:#94A3B8;margin-top:14px;line-height:1.7;}
</style></head><body><div class="box">
<div class="logo">ShiftPoint</div>
<h2>Password Change Required</h2>
<p>An administrator has reset your password. You must set a new password before continuing.</p>
<div id="err-msg"></div>
<div class="field"><label>New Password</label><input type="password" id="pw1" placeholder="New password" autocomplete="new-password"></div>
<div class="field"><label>Confirm Password</label><input type="password" id="pw2" placeholder="Repeat new password" autocomplete="new-password"></div>
<button class="btn" onclick="submit()">Set New Password</button>
<p class="req">8+ characters &bull; Uppercase &bull; Lowercase &bull; Number &bull; Symbol</p>
<script>
async function submit(){
  var pw1=document.getElementById('pw1').value,pw2=document.getElementById('pw2').value;
  var err=document.getElementById('err-msg');
  if(!pw1||!pw2){err.className='err';err.textContent='Both fields required.';return;}
  if(pw1!==pw2){err.className='err';err.textContent='Passwords do not match.';return;}
  var res=await fetch('/api/force-change-password',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({newPassword:pw1})});
  var data=await res.json();
  if(data.error){err.className='err';err.textContent=data.error;return;}
  window.location='/';
}
document.getElementById('pw1').addEventListener('keydown',function(e){if(e.key==='Enter')document.getElementById('pw2').focus();});
document.getElementById('pw2').addEventListener('keydown',function(e){if(e.key==='Enter')submit();});
<\/script>
</div></body></html>`;
  res.setHeader('Content-Type','text/html');
  res.send(html);
});

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

// ── Static files ──────────────────────────────────────────────────
function inject(html,req) {
  // Escape < > / to prevent script tag breakout XSS
  // Must use \\u003c etc so JSON output contains literal \u003c not the < char
  // Always read permissions from DB so the injected SESSION is always current
  const _iu = db.query1('SELECT permissions,role FROM users WHERE id=?',[req.session.userId]);
  const perms = (_iu && _iu.permissions) ? JSON.parse(_iu.permissions) : (db.ROLE_PRESETS[req.session.role]||[]);
  const s=JSON.stringify({id:req.session.userId,username:req.session.username,displayName:req.session.displayName,role:req.session.role,permissions:perms})
    .replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/\//g,'\\u002f');
  return html.replace('<\/head>',`<script>window.SESSION=${s}<\/script>\n<\/head>`);
}
const isMobile = req=>/mobile|android|iphone|ipad|ipod|blackberry|opera mini|iemobile/i.test(req.headers['user-agent']||'');

function userHasPerm(req, perm) {
  const _u = db.query1('SELECT permissions,role FROM users WHERE id=?',[req.session.userId]);
  if (!_u) return false;
  const perms = _u.permissions ? JSON.parse(_u.permissions) : (db.ROLE_PRESETS[_u.role]||[]);
  return perms.includes(perm);
}
const _mobileAccessDenied = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Access Denied</title><style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:system-ui,sans-serif;background:#1C0A10;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}div{background:#fff;border-radius:14px;padding:32px 28px;max-width:360px;width:100%;text-align:center;}h2{color:#7B1535;font-size:1.2rem;margin-bottom:10px;}p{color:#4B5563;font-size:.9rem;line-height:1.5;margin-bottom:16px;}a{color:#7B1535;font-size:.85rem;}</style></head><body><div><h2>&#128683; Mobile Access Denied</h2><p>Your account does not have permission to use the mobile interface. Contact your administrator.</p><a href="/login">Return to Login</a></div></body></html>';
app.get('/', requireAuth,(req,res)=>{
  if(isMobile(req)&&!req.query.desktop){
    if(userHasPerm(req,'mobile.full'))   return res.redirect('/mobile-full.html');
    if(userHasPerm(req,'mobile.access')) return res.redirect('/mobile.html');
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.send(inject(fs.readFileSync(path.join(BASE,'index.html'),'utf8'),req));
});
app.get('/mobile.html', requireAuth,(req,res)=>{
  if(!userHasPerm(req,'mobile.access')&&!userHasPerm(req,'mobile.full'))
    return res.status(403).send(_mobileAccessDenied);
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.send(inject(fs.readFileSync(path.join(BASE,'mobile.html'),'utf8'),req));
});
app.get('/mobile-full.html', requireAuth,(req,res)=>{
  if(!userHasPerm(req,'mobile.full'))
    return res.status(403).send(_mobileAccessDenied);
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.send(inject(fs.readFileSync(path.join(BASE,'mobile-full.html'),'utf8'),req));
});
app.get('/facility', requireAuth,(req,res)=>{ res.redirect('/admin'); });
app.get('/admin', requireAuth, requirePermission('admin.users'),(req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.send(inject(fs.readFileSync(path.join(BASE,'admin.html'),'utf8'),req));
});

app.get('/about', requireAuth, (req,res) => {
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.send(inject(fs.readFileSync(path.join(BASE,'about.html'),'utf8'), req));
});

app.use('/js', requireAuth, express.static(path.join(BASE,'js')));
app.use('/css', requireAuth, express.static(path.join(BASE,'css')));
app.use('/static/icons', express.static(path.join(BASE,'static','icons'))); // icons are public (favicon on login page)
app.use('/static', requireAuth, express.static(path.join(BASE,'static')));
app.get('/manifest.json', requireAuth,(req,res)=>res.sendFile(path.join(BASE,'manifest.json'))); // VULN-18
app.get('/sw.js',(req,res)=>{
  res.setHeader('Content-Type','application/javascript');
  res.setHeader('Service-Worker-Allowed','/');
  res.send('self.addEventListener("install",()=>self.skipWaiting());self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.map(n=>caches.delete(n)))).then(()=>self.registration.unregister()));});');
});
app.get('/index.html',(req,res)=>res.redirect(301,'/'));

// ── Users API ─────────────────────────────────────────────────────
app.get('/api/users', requireAuth, requirePermission('admin.users'),(req,res)=>{
  const rows = db.query('SELECT id,username,display_name,role,created_at,permissions FROM users');
  res.json(rows.map(u=>{
    let perms = null;
    try { perms = u.permissions ? JSON.parse(u.permissions) : db.ROLE_PRESETS[u.role]||[]; } catch(e) { perms = db.ROLE_PRESETS[u.role]||[]; }
    return {id:u.id,username:u.username,displayName:u.display_name,role:u.role,createdAt:u.created_at,permissions:perms};
  }));
});
app.post('/api/users', requireAuth, csrfCheck, requirePermission('admin.users'),(req,res)=>{
  const{username,displayName,password,role,permissions}=req.body;
  if(!username||!password||!role) return res.status(400).json({error:'Missing fields'});
  const _validRoles=db.getPermissionProfiles().map(p=>p.key);
  if(!_validRoles.includes(role)) return res.status(400).json({error:'Invalid role'});
  const err=validatePw(password); if(err) return res.status(400).json({error:err});
  if(db.query1('SELECT id FROM users WHERE LOWER(username)=LOWER(?)',[username]))
    return res.status(409).json({error:'Username already exists'});
  const{hash,salt}=hashPw(password);
  // Use provided permissions or fall back to the role's profile preset
  const _roleProfile=db.getPermissionProfiles().find(p=>p.key===role);
  const perms = Array.isArray(permissions) ? permissions.filter(p=>db.PERMISSIONS.includes(p)) : (_roleProfile?_roleProfile.permissions:(db.ROLE_PRESETS[role]||[]));
  // must_change_pw=1 — all new accounts must set their own password on first login
  db.run('INSERT INTO users (username,display_name,role,hash,salt,permissions,must_change_pw) VALUES (?,?,?,?,?,?,1)',
    [username,displayName||username,role,hash,salt,JSON.stringify(perms)]);
  db.save();
  const _newU=db.query1('SELECT id FROM users WHERE LOWER(username)=LOWER(?)',[username]);
  audit(req,'user.add','user',_newU?_newU.id:null,displayName||username,{username,role});
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
    perms = permissions.filter(p=>db.PERMISSIONS.includes(p));
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
  if(id===req.session.userId) return res.status(400).json({error:"Can't delete yourself"});
  const _delU=db.query1('SELECT username,display_name FROM users WHERE id=?',[id]);
  db.run('DELETE FROM users WHERE id=?',[id]); db.save();
  audit(req,'user.delete','user',id,_delU?(_delU.display_name||_delU.username):String(id));
  broadcast({type:'user_deleted',userId:id});
  res.json({ok:true});
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
  if (patch.issues      !== undefined && !_patchPerms.includes('log.add')) return res.status(403).json({error:'Permission denied'});
  if (patch.med_notes   !== undefined && !_patchPerms.includes('log.add')) return res.status(403).json({error:'Permission denied'});
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
  });
});
app.put('/api/facility/settings', requireAuth, csrfCheck, requirePermission('admin.settings'),(req,res)=>{
  const{facility_name,wellness_interval_mins,walk_interval_mins,
        walk_areas,ua_panel,wellness_schedule,walk_schedule}=req.body;
  if(!facility_name||!facility_name.trim()) return res.status(400).json({error:'Facility name required'});
  if(facility_name.trim().length > 200) return res.status(400).json({error:'Facility name too long (max 200 chars)'});
  db.setSetting('facility_name',facility_name.trim());
  if(wellness_interval_mins) db.setSetting('wellness_interval_mins',parseInt(wellness_interval_mins));
  if(walk_interval_mins)     db.setSetting('walk_interval_mins',    parseInt(walk_interval_mins));
  if(Array.isArray(walk_areas)&&walk_areas.length) db.setSetting('walk_areas',walk_areas.filter(a=>a.trim()));
  if(Array.isArray(ua_panel))               db.setSetting('ua_panel',ua_panel.filter(a=>a.trim()));
  if(Array.isArray(wellness_schedule))      db.setSetting('wellness_schedule',wellness_schedule);
  if(Array.isArray(walk_schedule))          db.setSetting('walk_schedule',walk_schedule);
  db.save();
  const settings={
    facility_name:          db.getSetting('facility_name'),
    wellness_interval_mins: db.getSetting('wellness_interval_mins'),
    walk_interval_mins:     db.getSetting('walk_interval_mins'),
    walk_areas:             db.getSetting('walk_areas'),
    ua_panel:               db.getSetting('ua_panel'),
    wellness_schedule:      db.getSetting('wellness_schedule'),
    walk_schedule:          db.getSetting('walk_schedule'),
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

// ── Direct client update (all authenticated roles) ─────────────
app.put('/api/clients/:id', requireAuth, csrfCheck, requirePermission('residents.edit'),(req,res)=>{

  const id=parseInt(req.params.id,10);
  if(!db.query1('SELECT id FROM clients WHERE id=?',[id])) return res.status(404).json({error:'Not found'});
  const{room,name,case_manager,phone,intake_date,discharge_date}=req.body;
  if(name!==undefined&&!name.trim()) return res.status(400).json({error:'Name cannot be empty'});
  // Check room conflict if room is changing
  if(room!==undefined){
    const cur=db.query1('SELECT room FROM clients WHERE id=?',[id]);
    if(cur&&String(room)!==String(cur.room)){
      const occ=db.query1(
        `SELECT name FROM clients WHERE room=? AND name!='VACANT' AND is_active=1 AND is_special=0 AND id!=?`,
        [String(room),id]);
      if(occ) return res.status(409).json({error:'Room '+room+' is already occupied by '+occ.name});
    }
    db.run('UPDATE clients SET room=? WHERE id=?',[String(room),id]);
  }
  if(name!==undefined)          db.run('UPDATE clients SET name=? WHERE id=?',[name.trim(),id]);
  if(case_manager!==undefined)  db.run('UPDATE clients SET case_manager=? WHERE id=?',[case_manager,id]);
  if(phone!==undefined)         db.run('UPDATE clients SET phone=? WHERE id=?',[phone,id]);
  if(intake_date!==undefined)   db.run('UPDATE clients SET intake_date=? WHERE id=?',[intake_date||null,id]);
  if(discharge_date!==undefined)db.run('UPDATE clients SET discharge_date=? WHERE id=?',[discharge_date||null,id]);
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
  res.json({id:req.session.userId,username:req.session.username,
    displayName:req.session.displayName,role:req.session.role});
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
// Get chore log for a specific date
app.get('/api/chore-log', requireAuth,(req,res)=>{
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
app.put('/api/passes/:id', requireAuth, csrfCheck, requirePermission('passes.edit'),(req,res)=>{
  const id=parseInt(req.params.id);
  if(!db.query1('SELECT id FROM passes WHERE id=?',[id])) return res.status(404).json({error:'Not found'});
  const{departure,return_date,ua_notes,notes,status}=req.body;
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
  const {client_id, client_name, room} = req.body;
  if (!client_id) return res.status(400).json({error:'client_id required'});
  db.run(
    `INSERT INTO ua_requests (client_id,client_name,room,requested_by) VALUES (?,?,?,?)`,
    [client_id, client_name||'', room||'', req.session.displayName||req.session.username]
  );
  db.save();
  audit(req,'ua.request','client',client_id,client_name||String(client_id),{room:room||''});
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
  // No broadcast — each session manages its own dismissed view independently
  res.json({ok:true});
});

// ── Mail Log ──────────────────────────────────────────────────────
app.get('/api/mail', requireAuth, (req,res)=>{
  res.json(db.query('SELECT * FROM mail_log ORDER BY logged_at DESC'));
});

app.post('/api/mail', requireAuth, csrfCheck, requirePermission('mail.log'), (req,res)=>{
  // Accept bulk array OR legacy single client_id
  let list=[];
  if(Array.isArray(req.body.clients)&&req.body.clients.length) list=req.body.clients;
  else if(req.body.client_id) list=[{client_id:req.body.client_id,client_name:req.body.client_name,room:req.body.room}];
  if(!list.length) return res.status(400).json({error:'No clients selected'});
  const{logged_at,logged_by,notes}=req.body;
  if(notes&&notes.length>500) return res.status(400).json({error:'Notes too long (max 500 chars)'});
  const by=String(logged_by||req.session.displayName||req.session.username||'').slice(0,100);
  const atTime=logged_at||new Date().toISOString();
  // Validate and resolve each client
  const resolved=[];
  for(const item of list){
    const cid=parseInt(item.client_id);
    if(!cid) continue;
    const client=db.query1('SELECT id,room,name FROM clients WHERE id=?',[cid]);
    if(!client) continue;
    resolved.push({
      client_id:client.id,
      client_name:String(item.client_name||client.name||'').slice(0,200),
      room:String(item.room||client.room||'').slice(0,20),
    });
  }
  if(!resolved.length) return res.status(404).json({error:'No valid clients found'});
  // Insert one mail_log record per client
  for(const r of resolved){
    db.run(
      `INSERT INTO mail_log (client_id,client_name,room,logged_by,logged_at,notes,status) VALUES (?,?,?,?,?,?,'pending')`,
      [r.client_id,r.client_name,r.room,by,atTime,notes||'']
    );
    audit(req,'mail.log','mail',null,r.client_name+' Rm.'+r.room,{notes:notes||''});
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
      logText=`Mail received for ${r.client_name} (Rm. ${r.room}) — logged by ${by}`;
    } else {
      const names=resolved.map(r=>`${r.client_name} (Rm. ${r.room})`).join(', ');
      logText=`Mail received for ${resolved.length} residents: ${names} — logged by ${by}`;
    }
    if(notes) logText+=` [${notes}]`;
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

app.delete('/api/mail/:id', requireAuth, csrfCheck, requirePermission('log.delete'), (req,res)=>{
  const id=parseInt(req.params.id);
  const _mlDel=db.query1('SELECT client_name,room FROM mail_log WHERE id=?',[id]);
  if(!_mlDel) return res.status(404).json({error:'Not found'});
  db.run('DELETE FROM mail_log WHERE id=?',[id]);
  db.save();
  audit(req,'mail.delete','mail',id,_mlDel.client_name+' Rm.'+_mlDel.room);
  broadcast({type:'mail_updated',user:req.session.displayName||req.session.username});
  res.json({ok:true});
});

// ── Server restart (admin only) ───────────────────────────────────
app.post('/api/admin/restart', requireAuth, csrfCheck, requirePermission('admin.settings'), (req,res)=>{
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
app.get('/api/audit-log', requireAuth, requirePermission('admin.users'), (req,res)=>{
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

// ── Start ─────────────────────────────────────────────────────────
db.init(DB_PATH).then(()=>{
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
  db.auditLog(null,'system','127.0.0.1','server.start','server',null,'ShiftPoint',{version:'1.14.0',tls:useTLS});
  server.listen(PORT,'0.0.0.0',()=>{
    console.log('\n══════════════════════════════════════════════');
    console.log('  ShiftPoint v1.14.0');
    console.log('══════════════════════════════════════════════');
    console.log(`  Desktop:  ${proto}://localhost:${PORT}`);
    console.log(`  Mobile:   ${proto}://${ip}:${PORT}`);
    console.log(`  Admin:    ${proto}://localhost:${PORT}/admin`);
    console.log('══════════════════════════════════════════════');
    console.log('══════════════════════════════════════════════\n');
    const{exec}=require('child_process');
    setTimeout(()=>exec(`start ${proto}://localhost:${PORT}`),1200);
  });
}).catch(err=>{ console.error('FATAL: DB init failed:',err); process.exit(1); });
