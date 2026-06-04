# Using the OpsPoint Design System in Claude Code

This whole folder is a self-contained **Agent Skill**. Drop it into your repo and
Claude Code can read it to reskin OpsPoint with the souped-up jewel-teal + gold
system — or to build any new, on-brand UI.

---

## 1. Install the skill into your repo

From the root of your `OpsPoint-FULL-HIPAA` checkout:

```bash
mkdir -p .claude/skills/opspoint-design
# copy the entire contents of this download into that folder:
cp -R <this-folder>/* .claude/skills/opspoint-design/
```

Your tree should end up like:

```
OpsPoint-FULL-HIPAA/
└── .claude/
    └── skills/
        └── opspoint-design/
            ├── SKILL.md            ← Claude Code auto-discovers this
            ├── README.md           ← full design guidelines
            ├── colors_and_type.css ← the token source of truth
            ├── assets/             ← app icon
            ├── preview/            ← spec cards
            └── ui_kits/opspoint/   ← reference recreation
```

(`SKILL.md` already has the required front-matter — `name: opspoint-design`,
`description`, `user-invocable: true` — so Claude Code will pick it up automatically.)

---

## 2. The fastest, most reliable path: the drop-in override

**`opspoint-theme-override.css`** is a verified, drop-in reskin. Paste it at the
**bottom of `client/src/index.css`** (after everything, incl. the print block), or
import it *after* `index.css`. It maps the new palette onto your existing variable
names **and** overrides the rules that hardcode colors (white header, white table
heads, orange census fills, low-contrast nav) — which a token-only swap can't reach.
Zero component changes for everything except the header gear-menu.

Companion docs:
- **`HANDOFF.md`** — the complete manual install (CSS + the one header markup edit),
  with exact find/replace blocks against the real AppShell.jsx. **Start here.**

## 3. Or do a manual token swap (more control)

Your app's components already read CSS variables from the `:root` block in
`client/src/index.css` (`--sidebar-bg`, `--accent`, `--accent-bg`, status colors, …).
The fastest path to the new look is to **overwrite the values of those existing
variables** with the new palette from `colors_and_type.css`. No component edits
needed for the core color change. Then layer in the depth pieces (sidebar gradient,
gold focus glow, teal-tinted shadows, the report hero band).

---

## 3. What to tell Claude Code

Open the repo in Claude Code and try a prompt like:

> **"Use the opspoint-design skill. Apply the new jewel-teal + gold palette to our
> app by mapping it onto the existing CSS variables in `client/src/index.css` — keep
> every variable name the same, just change the values. Then add the depth pieces
> (sidebar gradient, gold focus ring, teal-tinted shadows). Show me the diff to
> `index.css` first before touching any components."**

Other good prompts once the skill is installed:

- *"Reskin the Login page (`client/src/pages/Login.jsx`) to match the design system's login — teal header band on the card, gold halo behind the app icon, glowing gold divider."*
- *"Add the teal hero band to the top of the Report page, per the design system."*
- *"Build a new <X> screen using the opspoint-design tokens and component patterns."*

---

## 4. Mapping cheat-sheet (old → new)

| Concept | Old (shipped) | New (this system) |
|---|---|---|
| Sidebar / structure | flat teal `#0f4c5c` | jewel teal `--teal-800 #0a4655`, as a gradient `--grad-sidebar` |
| Primary accent | web-orange `#f97316` | gold `--gold-600 #c9780c` fill / `--gold-500 #e8920f` glow |
| Page background | flat grey `#f4f7f9` | teal-tinted `--page-bg #d4e4ea` + `--grad-page` wash |
| Text | slate | teal-tinted ink `--ink-900 #0f2430` |
| Focus | (default outline) | gold glow ring `--glow-gold` |
| Shadows | neutral/black | teal-tinted `rgba(7,51,63,…)` |
| Status colors | flat pastels | jewel-tone `--st-*` (bg / fg / border each) |

Full values + rationale are in `README.md` (VISUAL FOUNDATIONS) and `colors_and_type.css`.

---

## 5. Notes

- **Icons:** the app uses `lucide-react` — keep using it. `ui_kits/opspoint/icons.jsx`
  is just a standalone recreation for the HTML reference; you don't need it in-repo.
- **Fonts:** the system intentionally uses the native system-UI font stack — there's
  nothing to install. (That's why the design tool flagged "missing brand fonts" — safe to ignore.)
- The HTML in `ui_kits/` is a **visual reference / prototype**, not production code to
  paste in. Recreate the look using your existing React components and patterns.
- Keep OpsPoint brand-neutral — "Cedar House" is just a sample facility name.
