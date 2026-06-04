---
name: opspoint-design
description: Use this skill to generate well-branded interfaces and assets for OpsPoint, a shift-management platform for residential facilities, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the `README.md` file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets
out and create static HTML files for the user to view. If working on production code,
you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to
build or design, ask some questions, and act as an expert designer who outputs HTML
artifacts _or_ production code, depending on the need.

## Quick orientation
- **`colors_and_type.css`** — the token source of truth. Link it first. Jewel **teal**
  (anchor) + warm **gold** (accent, the app icon's "door light"); teal-tinted neutrals;
  jewel-tone clinical status colors; tinted shadows; depth gradients.
- **`ui_kits/opspoint/`** — interactive recreation of the product. `opspoint.css` has the
  component classes; `icons.jsx` is the lucide icon set; `index.html` is the live demo.
- **`assets/opspoint-icon.png`** — the navy/gold doorway app mark. Copy it for branding;
  never redraw it.
- **`preview/`** — spec cards for colors, type, spacing and components.

## Non-negotiables
- Two-color brand: jewel teal + gold. Depth from gradients + teal-tinted shadows, never flat slabs.
- Native system-sans UI text; tabular **monospace** for times, room numbers, counts.
- **lucide** icons only (use `icons.jsx` or lucide.dev CDN). No emoji in records, no hand-drawn SVG.
- Copy is factual, third-person, past-tense, time-stamped. UPPERCASE eyebrow labels, sentence-case body.
- Clinical and calm — no neon, no purple gradients, no marketing flourish. Keep it brand-neutral
  (no specific named operator).
