# OpsPoint Reskin — Complete Handoff (CSS + Markup)

Everything to take your app from the flat teal/orange look to the jewel-teal + gold
system. **Two files to touch. ~10 minutes. No Claude Code needed.**

1. `client/src/index.css`  → paste one CSS block (does ~90% automatically)
2. `client/src/components/AppShell.jsx` → one small header edit (visible nav + gear menu)

Your **Report tab needs no changes** — its Date / Shift / PA(MOD) inputs already use
`.section`/`.meta-grid`/`.field`, so the CSS restyles them for free.

---

## STEP 1 — CSS  (the big one, mostly automatic)

Open **`client/src/index.css`**. Scroll to the very bottom. If you pasted an earlier
version of this override before, **delete it first**: find the banner comment
`OpsPoint — Jewel-Teal + Gold THEME OVERRIDE` and delete from there to the end of the
file (do a Find for `THEME OVERRIDE` — there should be **zero** hits after you delete,
then **one** after you paste).

Now paste the entire contents of **`opspoint-theme-override.css`** at the bottom. Save.

This instantly restyles: teal gradient header, gradient sidebar with the glowing gold
active rail, teal-tinted section & table headers, the census fix (only the Total tile is
filled — the rest become white cards with teal numbers), jewel-tone status pills, gold
focus rings, the teal/gold login, modals, page wash. **The header nav + gear menu styling
is in here too — but it only "wakes up" once you do Step 2** (the buttons currently carry
inline styles that override CSS, which is exactly why they looked washed-out).

---

## STEP 2 — Markup  (header: visible nav + gear menu)

Open **`client/src/components/AppShell.jsx`**. In the `Header` component, find this block
(around **line 872**, inside `<div className="header-actions">`):

### FIND  ▼
```jsx
          {hasPerm('reports.create') && (
            <>
              {uiVis.buttons?.walkthrough !== false && (
                <button onClick={fileWalkthroughs} title="File Walkthrough — filled filing record" style={ghostBtn}>
                  File Walkthrough
                </button>
              )}
              {uiVis.buttons?.wellness !== false && (
                <button onClick={fileWellnessChecks} title="File Wellness Check — filled filing record" style={ghostBtn}>
                  File Wellness
                </button>
              )}
              <button onClick={sendOutlook} title="Email shift report" style={ghostBtn}>
                Email
              </button>
            </>
          )}

          {hasPerm('broadcast.send') && (
            <button onClick={() => setBroadcastOpen(true)} title="Send Announcement" style={ghostBtn}>
              <Megaphone size={14} />
              Announce
            </button>
          )}

          {hasPerm('admin.users') && (
            <Link to="/admin" style={{ ...ghostBtn, textDecoration: 'none' }}>
              <Settings size={14} />
              Admin
            </Link>
          )}
          <Link to="/about" style={{ ...ghostBtn, textDecoration: 'none', opacity: .7 }}>
            <Info size={14} />
            About
          </Link>
          <button style={{ ...ghostBtn }} onClick={handleLogout}
            onMouseEnter={e => { e.currentTarget.style.color='var(--danger)'; e.currentTarget.style.background='var(--danger-bg)' }}
            onMouseLeave={e => { e.currentTarget.style.color='var(--text-muted)'; e.currentTarget.style.background='none' }}
          >
            <LogOut size={14} />
            Sign Out
          </button>
```

### REPLACE WITH  ▼
```jsx
          {hasPerm('reports.create') && (
            <>
              {uiVis.buttons?.walkthrough !== false && (
                <button onClick={fileWalkthroughs} title="File Walkthrough — filled filing record" className="hdr-pill">
                  File Walkthrough
                </button>
              )}
              {uiVis.buttons?.wellness !== false && (
                <button onClick={fileWellnessChecks} title="File Wellness Check — filled filing record" className="hdr-pill">
                  File Wellness
                </button>
              )}
              <button onClick={sendOutlook} title="Email shift report" className="hdr-pill">
                <Mail size={14} />
                Email
              </button>
            </>
          )}

          {hasPerm('broadcast.send') && (
            <button onClick={() => setBroadcastOpen(true)} title="Send Announcement" className="hdr-pill">
              <Megaphone size={14} />
              Announce
            </button>
          )}

          {/* Settings gear → About / Admin / Sign Out (zero-JS native dropdown) */}
          <details className="hdr-menu">
            <summary className="hdr-gear" title="Settings"><Settings size={18} /></summary>
            <div className="hdr-menu-pop">
              {hasPerm('admin.users') && (
                <Link to="/admin" className="hdr-menu-item"
                  onClick={e => { e.currentTarget.closest('details').open = false }}>
                  <Settings size={16} /> Admin
                </Link>
              )}
              <Link to="/about" className="hdr-menu-item"
                onClick={e => { e.currentTarget.closest('details').open = false }}>
                <Info size={16} /> About
              </Link>
              <div className="hdr-menu-sep" />
              <button className="hdr-menu-item danger"
                onClick={e => { e.currentTarget.closest('details').open = false; handleLogout() }}>
                <LogOut size={16} /> Sign Out
              </button>
            </div>
          </details>
```

Save. That's the whole change.

**What it does:**
- The four primary actions (File Walkthrough, File Wellness, Email, Announce) become
  bright bordered **pills with gold icons** that brighten + lift on hover.
- **About, Admin, Sign Out** move under the **gear** (a native `<details>` dropdown —
  no extra state/hooks; clicking any item closes it).
- The bordered logo, **{facility} name**, Live indicator and **bell** stay exactly where
  they are.

**No new imports needed** — `Mail`, `Settings`, `Info`, `LogOut`, `Megaphone` are already
imported at the top of AppShell.jsx. You can leave the now-unused `ghostBtn` object where
it is (harmless), or delete it.

---

## That's it

Reference for the finished look: open `ui_kits/opspoint/index.html` from this bundle and
sign in — your app should match it (teal header with pill nav + gear, gradient sidebar,
teal-tinted sections, fixed census, Shift Report inputs).

### If something looks off
- **Nav still washed-out?** You're still seeing the old inline `style={ghostBtn}` — make
  sure you replaced it with `className="hdr-pill"` on all four buttons.
- **Two override copies?** Find `THEME OVERRIDE` in index.css — keep only one.
- **Census still orange?** Confirm the override is the **last** thing in index.css so its
  rules win the cascade.
