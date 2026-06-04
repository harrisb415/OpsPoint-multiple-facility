# OpsPoint Design System

A design system for **OpsPoint** — a shift-management platform for residential
facilities (sober-living / transitional / treatment housing). The product is an
on-premise, HIPAA-conscious React SPA that staff use to run a shift: track each
resident's whereabouts, log wellness checks and walkthroughs, record UAs,
medications, passes, mail, incidents and violations, and export a signed shift
report.

This system captures that product's structure and **re-skins it** with a richer,
"souped-up but still clinically appropriate" palette.

---

## The redesign brief

> *"I LOVE the layout, but the colors are bland. We need to soup it up while
> keeping it clinically appropriate."*

The shipped app used a **flat teal `#0f4c5c` sidebar** + **flat web-orange
`#f97316` accent** on a grey page. It read as bland — and, critically, it ignored
the product's **own app icon**: a deep navy-teal disc with a **glowing gold
doorway** (the "way forward" motif of a residential / recovery program).

This system unifies the brand around that icon:

- a **deeper, jewel-saturated teal** as the trustworthy clinical anchor
- a **warm gold** as the hero accent — the "door light" — replacing flat orange
- **depth** via tinted shadows and gradients (sidebar, census totals, CTAs) instead of flat slabs
- **richer jewel-tone status colors** for the resident-state system

Calm, legible, clinical. No neon, no purple gradients. Warm where it counts, cool everywhere else.

See `preview/brand-before-after.html` for the side-by-side.

---

## Sources

Built from the OpsPoint codebase (private GitHub — explore further if you have access):

- **`harrisb415/OpsPoint-FULL-HIPAA`** — `https://github.com/harrisb415/OpsPoint-FULL-HIPAA`
  React 19 + Vite SPA frontend; Node/Express + SQLite backend. Design tokens were
  lifted from `client/src/index.css`; screen structure from `client/src/pages/*`
  and `client/src/components/AppShell.jsx`. Icons are **lucide-react**. The app icon
  (`static/icons/icon-512.png`) drives the palette.
- A sibling repo, `harrisb415/shiftpoint`, exists but was **not** used here.

> **Note:** OpsPoint is the generic product. It is **not** tied to any specific
> named operator or franchise — keep recreations brand-neutral ("Cedar House" in
> the UI kit is a fictional sample facility).

---

## Index / manifest

| File / folder | What it is |
|---|---|
| `README.md` | This file — context, content & visual foundations, iconography |
| `SKILL.md` | Agent-Skills front-matter so this folder works as a Claude skill |
| `colors_and_type.css` | **The source of truth.** All color + type tokens as CSS vars |
| `assets/` | `opspoint-icon.png` (512) + `-192` — the navy/gold doorway app mark |
| `preview/` | Design-system spec cards (colors, type, spacing, components) |
| `ui_kits/opspoint/` | Interactive UI-kit recreation of the product → see its own README |

---

## CONTENT FUNDAMENTALS

OpsPoint is an **operational record**, not a marketing surface. Copy is written
the way a careful staff member writes a shift log: factual, time-stamped, terse.

- **Voice & person.** Third-person, past-tense, observational:
  *"Wellness check conducted by D. Okonkwo. All 16 accounted for."* The author is
  named, not "I." Residents are referenced by **room + name** ("Rm 214 M. Johnson").
- **Tone.** Neutral and non-judgmental. Even violations are recorded flatly
  ("rule violation observed. Incident report to follow.") — no editorializing.
- **Casing.** Sentence case for body and entries. **UPPERCASE eyebrow labels**
  for section/group headers (`PEOPLE`, `HEALTH & COMPLIANCE`, field labels like
  `PROGRAM ASSISTANT ON DUTY`). Title Case for buttons and screen titles.
- **Domain vocabulary.** Census, roster, wellness check, walkthrough, UA
  (urinalysis), UA draw, weekend pass, BHC (behavioral health care), EFC (extended
  family care), case manager, med pass, milestone, incident, violation, consent.
- **Numbers & time.** Times in 12-hour with AM/PM, set in **tabular monospace**
  ("8:30 PM"). Counts and room numbers also monospace so they align in columns.
  Dates as `2026-05-28` (ISO) in mono.
- **Status as a control.** A resident's state ("In Building", "At Work", "Weekend
  Pass", "Hospital"…) is the single most important datum — short, capitalized labels.
- **Compliance phrasing.** Footers carry quiet assurances: *"On-premise · HIPAA ·
  42 CFR Part 2 · All sessions are audit-logged."* Confident, not alarmist.
- **No emoji** in product copy or records. (The UI kit uses a couple of emoji as
  decorative glyphs on quick-action pills only; the real product leans on lucide
  icons — prefer those.) No exclamation points. No filler.
- **Vibe.** Trustworthy, calm, end-of-shift. The screen should feel like a clean
  clipboard handed to the next staff member.

---

## VISUAL FOUNDATIONS

**Colors.** Two-color brand: **jewel teal** (anchor, structure, navigation, links)
+ **warm gold** (hero accent, primary actions, active states, focus). Neutrals are
a teal-tinted ink, not pure slate. A jewel-tone **clinical status** palette
(green/blue/amber/violet/pink/red/orange/grey) encodes resident state; four
**semantic signals** (success/info/warning/danger) handle save state, reminders,
and validation. All defined in `colors_and_type.css`.

**Type.** Native **system-UI sans** stack — fast, familiar, no webfont flash,
appropriately clinical. A **tabular monospace** (SF Mono / ui-monospace stack)
carries times, room numbers and census counts, which is core to the "log" feel.
Scale runs 11px eyebrow → 14px body → 20px page title → 30–32px census counts /
auth headline. Weights 400/500/600/700. Uppercase eyebrows track +0.08em; large
headings track −0.01em.

**Spacing.** 4px base scale (`--sp-1..10`). Cards pad to 20–24px; controls are
36px tall (28px for small); the dense operational grid stays tidy with 4px-step gaps.

**Backgrounds.** No photography, no illustration, no texture. The page is a
subtle top-down **wash** (`--grad-page`, light→`#eaf1f4`). The depth comes from
**gradients**: the sidebar fades teal→navy (`--grad-sidebar`); the census *Total*
card and other highlighted stats use `--grad-census`; primary CTAs use a gold
glow (`--grad-gold`); the login screen sits on the full sidebar gradient.

**Borders.** Hairline `--line` (`#e1e8ed`) everywhere — 1px on cards, table rows,
inputs. Status pills and reminder cards use a 1.5px tinted border matching their
fill family. Faint `--line-2` for alternating table rows and inner dividers.

**Corner radii.** Controls & table cells 5–6px; inputs/buttons 6px; cards &
modals 12px; auth card & big containers 12–16px; badges, status selects and pills
fully rounded (`999px`).

**Shadows / elevation.** Teal-tinted (`rgba(7,51,63,…)`) rather than pure black —
warmer, richer. Four steps: `--shadow-xs` (hairline) → `--shadow-card` (resting) →
`--shadow-drop` (hover/popover) → `--shadow-modal` (overlay). Focus uses a gold
glow ring (`--glow-gold`, a 3px gold halo) — there is no harsh outline.

**Hover states.** Sidebar items lighten with a translucent white overlay; ghost
icon buttons get a `--raised-bg` fill; quick-action pills **lift** (`translateY(-1px)`
+ drop shadow); table rows tint to `--teal-50`; primary buttons deepen to the next
gold step and grow their glow. Links/secondary darken.

**Press states.** Buttons scale to `.97` on `:active` (a subtle physical press).
No bounce.

**Active / selected.** The active sidebar item gets a translucent fill **and a
glowing gold rail** on its left edge (`box-shadow` halo). Section heads carry a
small glowing gold dot. The census *Total* card is the gradient hero.

**Animation.** Restrained and functional. 120–150ms ease on color/background/box-shadow;
80ms on the active-press scale; a single 0.25s `toastIn` slide-up for confirmations.
No parallax, no scroll-jacking, no decorative motion.

**Transparency & blur.** Modal overlay is `rgba(7,42,51,.42)` with a light
`backdrop-filter: blur(2px)`. Sidebar hover/active overlays use translucent white.
Otherwise surfaces are solid.

**Cards.** White, 1px `--line` border, 12px radius, `--shadow-card`, ~20px padding.
"Section" cards add a `--raised-bg` header strip with an uppercase label + glowing
gold dot. The census *Total* and highlighted stats invert to the teal gradient.

---

## ICONOGRAPHY

- **System:** OpsPoint uses **lucide** (`lucide-react`) throughout — thin (2px
  stroke), rounded-cap, 24×24 line icons. This system **recreates the exact
  lucide paths inline** in `ui_kits/opspoint/icons.jsx` as a single `<Icon>`
  component (stroke = `currentColor`, so they inherit text color). Icons used:
  users, user-check, clipboard-list, file-text, check-square, ticket, mail, flask,
  pill, award, alert-triangle, ban, pen-line, archive, dice-5, bell, settings,
  log-out, search, plus, x, printer, check, clock, layout-dashboard, chevron-right,
  refresh.
- **To extend:** pull more icons from **lucide.dev** (CDN: `lucide@latest`) — same
  family, stroke weight and viewBox; or add paths to `icons.jsx`. Don't mix in a
  second icon family.
- **App mark:** `assets/opspoint-icon.png` — a navy-teal disc with a glowing gold
  open doorway. Used as favicon, login art, and the header logo. **This icon is
  the source of the whole palette.** Do not redraw it; copy it.
- **Emoji:** **not** used in the product or in records. (A few emoji appear only as
  decorative glyphs on the UI kit's quick-action pills; prefer lucide icons in real
  work.) No Unicode dingbats as functional icons.
- **No hand-drawn SVG decoration**, no spot illustrations, no stock photography.
  The visual interest comes from color, depth and the icon — not imagery.

---

## How to use this system

1. Link `colors_and_type.css` first; it defines every token + a few semantic type
   primitives (`.ds-h1`, `.ds-eyebrow`, `.ds-mono`, etc.).
2. For product-style screens, also link `ui_kits/opspoint/opspoint.css` and reuse
   its component classes (`.section`, `.census-card`, `.ss.s-*`, `.btn-primary`, …).
3. Copy `assets/opspoint-icon.png` into your artifact for branding.
4. Use lucide icons (CDN or `icons.jsx`); never hand-roll iconography.
5. Keep copy factual, third-person, time-stamped; uppercase eyebrows, sentence-case body.
