# OpsPoint UI Kit

A high-fidelity, interactive recreation of **OpsPoint** — the shift-management
platform for residential facilities. This is the souped-up jewel-teal + gold
redesign of the product's own UI, built on the design system tokens in
`../../colors_and_type.css`.

## Run it
Open `index.html`. You'll land on the **Staff Login**; sign in (any
credentials — it's a mock) to reach the **Swing Shift Report**, the product's
core daily-ops screen.

## What's interactive
- **Login → app** transition with the gold "door light" CTA.
- **Census** recomputes live as you change resident statuses.
- **Roster** — change any resident's status via the pill-select; search by name/room.
- **Activity log** — quick-action pills (Wellness, Walkthrough auto-log; UA, Room
  Search, Mail, Violation open a modal); free-text add with auto-classified type badge.
- **Issues / Med Notes** — add & remove editable list items.
- **UA Draw** (sidebar → Actions) — randomly selects In-Building residents, redraw, log to report.
- **Export** & **Notifications** modals; toast confirmations.

## Files
| File | Purpose |
|---|---|
| `index.html` | Entry point — loads React + all component scripts |
| `opspoint.css` | Component styles, mapped onto the design-system tokens |
| `data.js` | Mock data (`window.OP_DATA`) — **fictional** residents, no real PHI |
| `icons.jsx` | `<Icon>` — inline recreations of the lucide icons the product uses |
| `shell.jsx` | `Login`, `Header`, `Sidebar` |
| `report.jsx` | `Census`, `Roster`, `ActivityLog`, `ListPanel`, `Modal` |
| `app.jsx` | `App` root — state, wiring, quick-action & UA-draw modals |

## Component coverage
Login · gradient sidebar w/ grouped nav · top header with save-state + notifications ·
page header · reminder cards · census cards · roster table with status pill-selects ·
activity log with type badges + quick-action pills · editable issue/med lists ·
buttons (gold / teal / ghost / danger) · form fields · modals · toasts · empty states.

## Fidelity notes
Layout & structure are faithful to the shipped React app (`harrisb415/OpsPoint-FULL-HIPAA`).
**Color & depth are the redesign** — the original flat teal + web-orange is replaced
with the jewel-teal + gold system. Module screens other than **Report** are intentionally
stubbed (`Placeholder`) — the Report screen demonstrates the full component system.
