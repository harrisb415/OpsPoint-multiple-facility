# Header Patch — visible nav + settings-gear menu

Two changes to your top header (in `client/src/components/AppShell.jsx`, the
`.site-header` block):

1. **Make the primary links visible** — File Walkthrough, File Wellness, Email,
   Announce become bright bordered pills with hover. → **Pure CSS, already in
   `opspoint-theme-override.css` (section 3b). Nothing to do** beyond making sure
   the override's selector matches your markup (see note at the bottom).

2. **Move About / Admin / Sign Out under the gear** — this one needs a small
   markup change, below.

---

## The gear dropdown (markup change)

Find the part of the header that renders About, Admin, Sign Out (currently inline
links). Replace those three with a single gear button that toggles a dropdown.

```jsx
import { useState, useRef, useEffect } from 'react';
import { Settings, Info, Shield, LogOut } from 'lucide-react';

function SettingsMenu({ onAbout, onAdmin, onSignOut }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onDoc = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  return (
    <div className="header-menu" ref={ref} style={{ position: 'relative' }}>
      <button
        className="settings-gear-btn"
        onClick={() => setOpen(o => !o)}
        title="Settings"
        style={{ display:'inline-flex', alignItems:'center', justifyContent:'center',
                 width:34, height:34, border:'none', background:'none', borderRadius:6, cursor:'pointer' }}
      >
        <Settings size={18} />
      </button>
      {open && (
        <div className="header-dropdown">
          <button className="dropdown-item" onClick={() => { setOpen(false); onAbout?.(); }}>
            <Info size={16} /> About
          </button>
          <button className="dropdown-item" onClick={() => { setOpen(false); onAdmin?.(); }}>
            <Shield size={16} /> Admin
          </button>
          <div className="dropdown-sep" />
          <button className="dropdown-item danger" onClick={() => { setOpen(false); onSignOut?.(); }}>
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
```

Then in the header JSX, where About / Admin / Sign Out used to be:

```jsx
{/* was: <Link to="/about">About</Link> <Link to="/admin">Admin</Link> <button onClick={signOut}>Sign Out</button> */}
<SettingsMenu
  onAbout={() => navigate('/about')}
  onAdmin={() => navigate('/admin')}
  onSignOut={handleSignOut}
/>
```

Keep the **bell** to the right of the gear (unchanged). All the dropdown styling
is already in `opspoint-theme-override.css`.

---

## Optional: give the 4 primary links icons

If you want the gold leading icons shown in the reference, wrap each link's label:

```jsx
import { Footprints, HeartPulse, Mail, Megaphone } from 'lucide-react';

<a className="header-link" href="..."><Footprints size={15} /> File Walkthrough</a>
<a className="header-link" href="..."><HeartPulse size={15} /> File Wellness</a>
<a className="header-link" href="..."><Mail size={15} /> Email</a>
<a className="header-link" href="..."><Megaphone size={15} /> Announce</a>
```

The pill background, border and hover-lift come from the CSS automatically.

---

## Make sure the CSS selector matches your markup

In `opspoint-theme-override.css` section **3b**, the visible-pill rule targets:

```css
.site-header nav a, .site-header .header-link, .site-header .nav-link { … }
```

If your four links use a different wrapper/class, either:
- add `className="header-link"` to each link (simplest), **or**
- change the selector in the override to whatever your links already use.

Reference for the finished look: `ui_kits/opspoint/index.html` (signed-in view) —
the header there is exactly this pattern.
