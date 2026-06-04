# Depth Pass — "Reduce the White"

The color token swap alone leaves the app looking white & flat. This pass adds
the brand color back onto the **surfaces** (header, page, report top, section
headers) and fixes the census cards. These are concrete, per-surface changes —
not token renames — so apply them against your real components.

> ⚠️ **Census bug first:** right now every populated census tile is filled solid
> orange/gold. That's wrong. In the design **only the `Total` tile is filled**
> (with the teal→navy gradient + a gold number). All other tiles are **white
> cards with a teal number and a small uppercase label.** Fix that first.

---

## Token values these rules rely on

Make sure these exist in your `:root` (from `colors_and_type.css`):

```css
--teal-600:#106f88;  --teal-700:#0d5a6e;  --teal-800:#0a4655;
--teal-900:#07333f;  --teal-200:#aaddeb;  --teal-100:#d4eef4;
--gold-300:#fcc858;  --gold-500:#e8920f;
--page-bg:#d4e4ea;        /* teal-tinted, NOT grey/white */
--page-bg-2:#e0edf1;
--raised-bg:#eaf3f6;      /* section/table header tint */
--raised-bg-2:#e0eef2;
--ink-900:#0f2430;
--grad-sidebar: linear-gradient(180deg,#0a4655 0%,#07333f 78%,#062a33 100%);
--grad-teal:    linear-gradient(135deg,#106f88 0%,#0a4655 100%);
--grad-census:  linear-gradient(150deg,#106f88 0%,#0a4655 100%);
--grad-page:    linear-gradient(170deg,#d4eef4 0%,#e0edf1 180px,#d4e4ea 460px);
--shadow-drop:  0 8px 24px rgba(7,51,63,.13);
```

---

## 1. Page background — stop it being white

The main scroll/content area must use the teal wash, not white or grey.

```css
/* whatever wraps your routed page content */
.app-content, main.content {
  background: var(--grad-page);
}
```

## 2. Top header — make it teal

Your top bar (logo, "File Walkthrough / Email / Admin / Sign Out", bell) is
currently white. Make it the teal gradient with light text/icons.

```css
.site-header /* your top header */ {
  background: var(--grad-teal);
  border-bottom: 1px solid var(--teal-900);
  box-shadow: 0 1px 2px rgba(7,51,63,.06), 0 3px 10px rgba(7,51,63,.05);
}
.site-header .brand-name { color: #fff; }
.site-header .facility   { color: var(--teal-200); border-left-color: rgba(255,255,255,.18); }
.site-header a, .site-header button { color: var(--teal-100); }   /* nav links + icons */
.site-header a:hover { color: #fff; }
.site-header .live-dot, .site-header .saved { color: var(--gold-300); }  /* status accent */
```

## 3. Report top — teal hero band

Wrap the "SHIFT REPORT #2 / date / shift / PA" header block (or just the title
row) in a teal gradient band instead of a plain white card:

```css
.report-hero {
  background: var(--grad-census);
  border-radius: 12px;
  padding: 18px 22px;
  margin-bottom: 18px;
  box-shadow: var(--shadow-drop);
  position: relative; overflow: hidden;
}
.report-hero::after {            /* soft gold glow, top-right */
  content:''; position:absolute; right:-40px; top:-60px; width:220px; height:220px;
  background: radial-gradient(circle, rgba(247,173,46,.22) 0%, transparent 68%);
  pointer-events:none;
}
.report-hero .eyebrow { color: var(--gold-300); }     /* "DAILY OPS · SHIFT REPORT" */
.report-hero h1       { color: #fff; }                /* "Swing Shift Report" */
.report-hero .meta    { color: var(--teal-200); }     /* date · shift · facility */
```

## 4. Section headers — teal tint

The "● CENSUS", "● ACTIVITY LOG", "● ROSTER" header strips and all table
`<thead>` rows should be teal-tinted, not white:

```css
.section-head, thead th {
  background: var(--raised-bg);
  color: var(--teal-700);
  border-bottom: 1px solid var(--teal-200);
}
.section { border: 1px solid var(--teal-200); }   /* card outline picks up teal */
```

## 5. Census cards — fix the all-orange fill

```css
.census-card {
  background: #fff;
  border: 1px solid var(--teal-200);
  border-radius: 12px;
}
.census-card .count  { color: var(--teal-600); font-variant-numeric: tabular-nums; }
.census-card .label  { color: #5c7081; text-transform: uppercase; letter-spacing:.05em; }

/* ONLY the total tile is filled */
.census-card.is-total {
  background: var(--grad-census);
  border-color: transparent;
  box-shadow: var(--shadow-drop);
}
.census-card.is-total .count { color: var(--gold-300); }
.census-card.is-total .label { color: rgba(255,255,255,.82); }
```

---

## Prompt to give Claude Code

> "Apply the **Depth Pass** from `.claude/skills/opspoint-design/DEPTH_PASS.md`.
> Specifically: (1) fix the census tiles so only the Total tile is filled with the
> teal gradient and the rest are white cards with teal numbers; (2) make the top
> header the teal gradient with light text/icons; (3) wrap the report's title block
> in a teal hero band; (4) tint the section headers and table heads teal; (5) set the
> main content background to the teal page wash. Use the exact values in that file
> and map the selectors to our real components. Show me the diff first."

Reference: see `ui_kits/opspoint/index.html` (signed-in view) and
`ui_kits/opspoint/opspoint.css` for the finished look these rules reproduce.
