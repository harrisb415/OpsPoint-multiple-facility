/* OpsPoint UI Kit — shell: Login, Header, Sidebar */

function Login({ onLogin }) {
  const [u, setU] = React.useState('dokonkwo');
  const [p, setP] = React.useState('••••••••••');
  const [busy, setBusy] = React.useState(false);
  function submit(e) {
    e.preventDefault();
    setBusy(true);
    setTimeout(() => { setBusy(false); onLogin(); }, 550);
  }
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card-top">
          <img className="auth-app-icon" src="../../assets/opspoint-icon.png" alt="OpsPoint" />
          <h1>OpsPoint</h1>
          <div className="auth-sub">Staff Login · Cedar House</div>
        </div>
        <div className="auth-gold-bar"></div>
        <div className="auth-card-body">
          <form onSubmit={submit}>
            <div className="auth-field" style={{ marginBottom: 14 }}>
              <label>Username</label>
              <input className="text-input" value={u} onChange={e => setU(e.target.value)} />
            </div>
            <div className="auth-field" style={{ marginBottom: 4 }}>
              <label>Password</label>
              <input className="text-input" type="password" value={p} onChange={e => setP(e.target.value)} />
            </div>
            <button className="auth-btn" type="submit" disabled={busy}>
              {busy ? 'Signing In…' : 'Sign In  →'}
            </button>
          </form>
          <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 16, textAlign: 'center', lineHeight: 1.5 }}>
            On-premise · HIPAA · 42 CFR Part 2<br />All sessions are audit-logged.
          </div>
        </div>
      </div>
    </div>
  );
}

function Header({ facility, saveState, onBell, notifCount }) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef(null);
  React.useEffect(() => {
    function onDoc(e) { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const primary = [
    { id: 'walkthrough', label: 'File Walkthrough', icon: 'footprints' },
    { id: 'wellness',    label: 'File Wellness',    icon: 'heartPulse' },
    { id: 'email',       label: 'Email',            icon: 'mail' },
    { id: 'announce',    label: 'Announce',         icon: 'megaphone' },
  ];
  return (
    <header className="site-header">
      <div className="header-brand">
        <img className="header-brand-logo" src="../../assets/opspoint-icon.png" alt="" />
        <span className="header-brand-name">OpsPoint</span>
      </div>
      <span className="header-facility">{facility}</span>

      <div className="header-actions">
        <span className="header-live"><span className="live-dot"></span>Live</span>

        <nav className="header-nav">
          {primary.map(p => (
            <button key={p.id} className="header-nav-link" title={p.label}>
              <Icon name={p.icon} size={15} />
              <span>{p.label}</span>
            </button>
          ))}
        </nav>

        <div className="header-divider"></div>

        <div className="header-menu" ref={menuRef}>
          <button className={`icon-ghost${menuOpen ? ' is-open' : ''}`} title="Settings" onClick={() => setMenuOpen(o => !o)}>
            <Icon name="settings" size={18} />
          </button>
          {menuOpen && (
            <div className="header-dropdown">
              <button className="dropdown-item"><Icon name="info" size={16} /> About</button>
              <button className="dropdown-item"><Icon name="shield" size={16} /> Admin</button>
              <div className="dropdown-sep"></div>
              <button className="dropdown-item danger"><Icon name="logOut" size={16} /> Sign Out</button>
            </div>
          )}
        </div>

        <button className="icon-ghost" onClick={onBell} title="Notifications" style={{ position: 'relative' }}>
          <Icon name="bell" size={18} />
          {notifCount > 0 && <span className="notif-dot">{notifCount}</span>}
        </button>
      </div>
    </header>
  );
}

function Sidebar({ active, onNavigate, user, onDraw }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-body">
        {window.OP_DATA.sidebar.map(group => (
          <div key={group.label}>
            <div className="sidebar-group-label">{group.label}</div>
            {group.items.map(it => (
              <button key={it.id}
                className={`sidebar-item${active === it.id ? ' active' : ''}`}
                onClick={() => onNavigate(it.id)}>
                <Icon name={it.icon} size={16} className="sidebar-icon" />
                {it.label}
              </button>
            ))}
          </div>
        ))}
        <div>
          <div className="sidebar-group-label">ACTIONS</div>
          <button className="sidebar-item" onClick={onDraw}>
            <Icon name="dice5" size={16} className="sidebar-icon" />
            UA Draw
          </button>
        </div>
      </div>
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-avatar">{user.initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sidebar-user-name">{user.name}</div>
            <div className="sidebar-user-role">{user.role}</div>
          </div>
          <button className="icon-ghost" title="Sign out" style={{ color: 'var(--teal-200)' }}>
            <Icon name="logOut" size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}

Object.assign(window, { Login, Header, Sidebar });
