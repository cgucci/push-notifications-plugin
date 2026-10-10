# Forerunner Skills / Super Panel — UI Design Spec

The visual system used by the Skills Library site (same look as Super Panel).
Pulled from the live code in this repo: tokens and components come from
[`src/assets/site.css`](src/assets/site.css), markup from [`src/templates/`](src/templates/).
To reuse the look elsewhere, copy `site.css` wholesale — this doc is the map to it.

**Feel:** restrained, high-density SaaS dashboard. Inter at small sizes, near-white
canvas, translucent hairline borders, 6–12px radii, feather-soft shadows, one warm
orange accent against near-black primary buttons. Light mode only.

---

## 1. Design tokens

### Type

| Token | Value | Use |
| :-- | :-- | :-- |
| `--font-sans` | Inter, -apple-system, Segoe UI, Roboto | Everything |
| `--font-mono` | ui-monospace, SF Mono, Menlo, Consolas | Invocations, SHAs, raw view, code |
| `--text-2xs` | 10px | Eyebrows, badges, field labels (uppercase) |
| `--text-xs` | 12px | Meta, card footers, ToC, changelog cells |
| `--text-sm` | 13px | Buttons, nav, inputs, summaries |
| `--text-base` | 15px | Body, card titles |
| `--text-lg` | 18px | Section titles, prose h3 |
| `--text-xl` | 20px | Prose h2, modal title |
| `--text-2xl` | 24px | Page / skill titles |

Headings 700 weight, line-height 1.3, slight negative tracking (-0.01em) on big ones.
Body line-height 1.6. Labels/eyebrows: 10px, 500, uppercase, tertiary text.

### Color

| Group | Tokens |
| :-- | :-- |
| Surfaces | page `#fcfcfc` · card `#ffffff` · subtle `#f5f5f5` · sunken `#efefef` · highlight `rgba(0,0,0,.03)` |
| Text | primary `#171717` · secondary `#525252` · tertiary `#737373` · inverse `#fff` |
| Primary action | `#2f3037`, hover `#1f2026` (near-black, not brand color) |
| Brand accent | `#ff591e` → `#fb432c` — **sparingly**: link hover, active ToC rail, "+" on create card |
| Focus | `#3b82f6` ring, inputs get `0 0 0 3px rgba(59,130,246,.12)` halo |
| Borders | alpha-black hairlines, never solid gray: `.08` primary · `.05` secondary · `.03` tertiary · `.07` divider |
| Gray ramp | 50 `#fcfcfc` → 950 `#0d0d0d` (100 `#f5f5f5`, 300 `#e0e0e0`, 500 `#8f8f8f`, 700 `#525252`, 900 `#171717`) |

**Semantic tints** (10% alpha bg + darkened text so it passes on white):

| Meaning | Background | Text |
| :-- | :-- | :-- |
| Success / stable / added | `rgba(34,197,94,.1)` | `#197b41` |
| Info / modified | `rgba(59,130,246,.1)` | `#2160c4` |
| Experimental / renamed | `rgba(168,85,247,.1)` | `#7c30c4` |
| Warning / beta | `rgba(234,179,8,.1)` | `#8a6100` |
| Danger / deprecated / removed | `rgba(239,68,68,.1)` | `#b02525` |

### Radii, shadow, layout

- Radii: `sm 6` (buttons, inputs, badges) · `8` (bars, code) · `lg 12` (cards, panels) · `xl 16` (modal) · pills `999px`
- Shadows: layered and very soft — `xs 0 1px 2px /.04` default on every raised thing; `md` on card hover; `xl` on modal only
- Widths: content max `1180px`, reading column `800px`, gutters 24px (16px under 640px)

---

## 2. App shell

- **Header** — sticky, 52px tall, `rgba(252,252,252,.85)` with `backdrop-filter: saturate(180%) blur(12px)`, 1px divider below.
  Left: 20px rounded-square logo + product name (13px/500). Right: text nav links (13px, secondary, 5×10 padding, subtle bg on hover; active = subtle bg + primary text + 500) and a primary dark button at the end.
- **Main** — centered `.shell`, top padding clears the header.
- **Footer** — 12px tertiary text, divider above, 64px top margin. Build provenance (repo, commit SHA, count, timestamp), links underlined with a hairline.

---

## 3. Components

| Component | Spec |
| :-- | :-- |
| **Button** | 30px tall, 0 11px, 13px/500, radius 6, white bg, hairline border, `shadow-xs` + inset top highlight. Hover → subtle bg. `--sm` 26px/12px · `--lg` 40px · `--primary` near-black, white text. Icons 13px, 6px gap |
| **Badge** | 20px tall, 10px uppercase 500, radius 6, semantic tint (table above) |
| **Chip (filter)** | 26px pill, 12px/500, white + hairline + `shadow-xs`; pressed = solid near-black, white text. Grouped with a 10px uppercase label |
| **Search input** | 36px, leading 14px icon, trailing clear (×) button, focus = blue border + 3px halo |
| **Select** | 30px, same border/shadow/focus as search |
| **Card** | white, hairline, radius 12, 15×16 padding, `shadow-xs`. Hover lifts 1px + `shadow-md`. Whole card clickable via title `::after` overlay; interactive children (copy button) sit at `z-index: 2` above it |
| **Copy button** | 22px, 10px/500, tertiary; copied state turns green tint + "Copied" |
| **Invocation bar** | mono 13px in a white bordered bar (radius 8) — command in primary, argument hint in tertiary, copy button right. Card variant is a subtle-bg 12px strip with ellipsis |
| **Segmented toggle** | sunken track, 2px padding; selected segment = white + `shadow-xs` (Pretty ⇄ Raw) |
| **Meta strip** | row of label (10px uppercase tertiary) over value (13px primary), dividers above/below |
| **Avatar** | 18px circle, sunken bg, initials 10px |
| **Panel** | white, hairline, radius 12, 14×16 padding |
| **Section** | 40px top margin; head = 18px title + right-aligned 12px link, divider under |
| **Feedback note** | subtle bg info strip, 14px icon, radius 8, bold link — "Something wrong? → #channel" |
| **Empty state** | dashed hairline box, radius 12, centered 13px tertiary text, 48px padding |
| **File / tool list** | bordered list (radius 12), 9×13 rows, faint zebra striping, mono name column + description |
| **Modal** | native `<dialog>`, ≤620px, radius 16, `shadow-xl`, backdrop `rgba(0,0,0,.32)` + 2px blur. Head: 20px title + 26px square close. Fields: 12px/500 label, 36px inputs, `REQUIRED` in red / `OPTIONAL` tertiary 10px. Error = red tint box. Actions row under a divider |
| **"Create" card** | dashed border, transparent, no shadow; hover → white, brand-orange border. Big thin orange "+", bold label, tertiary hint |

---

## 4. Pages

### Index / library (`/`)
1. Page title (24px) + lede, stat row on the right (`**14** skills · updated 2h ago`)
2. Toolbar: search (flex-grows) + chip groups for category / status
3. Card grid — `repeat(auto-fill, minmax(320px, 1fr))`, 12px gap. Card: title + badges → 3-line clamped summary → invocation strip w/ copy → footer (owner avatar · relative date)
4. Dashed "Create a skill" card → opens the submit modal (describe an idea **or** upload a file)
5. Feedback note

### Detail (`/skills/<name>/`)
- Two-column grid: content `1fr` + 216px sticky ToC (dropped under 900px or when < ~4 headings)
- Breadcrumb → title row with badge → lede → invocation bar → meta strip (owner, category, status, last modified, contributors)
- Detail toolbar: Pretty/Raw toggle left, button row right (View on GitHub · History · Edit)
- **Pretty**: prose at 800px — h2 20px / h3 18px, hover-revealed `#` anchors, inline code in subtle pill, code blocks in subtle bordered box, tables wrapped in bordered radius-8 container with subtle header row, links underline → orange on hover
- **Raw**: white bordered `<pre>` (radius 12), 12px mono, copy-all button pinned top-right
- ToC: 12px links on a 1px left rail; active item gets the orange rail + 500 weight; h3s indented
- Sections below: supporting files, tools used, recent changes (last 5), feedback note

### Changelog (`/changelog/`)
- Title + stat row, filter selects (skill, author)
- Grouped by month; month label is sticky under the header
- 7-column grid table with a sticky uppercase header row: date (+ "3d ago") · type glyph (✚ ✎ ⤳ ✖ in green/blue/purple/red) · skill (mono, underlined) + commit subject · `+42 −8` delta · PR # · SHA pill · author avatar + name
- Rows: 9×8 padding, faint bottom hairline, highlight on hover

---

## 5. Responsive & behaviour

| Breakpoint | Change |
| :-- | :-- |
| ≤1000px | Changelog drops author-name column (avatar keeps it via `title`) |
| ≤900px | Detail page goes single column, ToC hidden |
| ≤700px | Changelog rows stack into mini records, header row dropped |
| ≤640px | 16px gutters, single-column cards, titles 20px, invocation strings allowed to break |

- Relative dates everywhere ("just now", "20 min ago", "3d ago"), exact timestamp in `title` tooltip
- Toggle state is linkable (`?view=raw`); filters are client-side, no fetch
- `[hidden] { display: none !important }` is load-bearing — filtered items set `display:flex/grid`, which otherwise beats the UA `hidden` rule
- Print stylesheet hides header/footer/chrome
- Syntax highlighting (highlight.js) retuned to the same palette: keywords purple, strings green, numbers amber `#b45309`, functions blue, attrs red, comments gray italic
