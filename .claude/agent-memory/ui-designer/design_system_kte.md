---
name: KTE Jegyportál – Design System
description: Palette, typography, spacing, and component patterns used across all KTE Jegyportál Paper designs. Reference before any new artboard.
type: project
---

## Mood

**Rusted** — graphite ground × rust/burnt-orange accent. Gritty, earned, stadium-grade.

## Palette

| Role | Hex | Usage |
|---|---|---|
| Background | `#1A1A1A` | Page background, hero |
| Surface dark | `#222222` | Sidebar, card backgrounds |
| Surface mid | `#2E2E2E` | Input fields, dividers, secondary surfaces |
| Surface light | `#3A3A3A` | Borders, active input borders |
| Primary accent | `#C94B1E` | CTAs, active nav, section markers, tags |
| White | `#FFFFFF` | Primary text, button labels |
| Secondary text | `#ABABAB` | Subtitles, muted body text |
| Tertiary text | `#6B6B6B` | Labels, placeholders, captions |
| Bone tint | `#E8E0D4` | Occasional light tag backgrounds |
| Success green | `#4CAF50` | Free seats, positive delta, success states |
| Error red | `#EF5350` | Occupied seats, negative delta |
| VIP gold | `#FFD700` | VIP seat category |
| Accessible blue | `#2196F3` | Accessible seat category, weather warning |

## Typography

| Level | Font | Weight | Size | Notes |
|---|---|---|---|---|
| Display | Barlow Condensed | 800 | 64–80px | Hero headlines, uppercase, letter-spacing: -0.02em |
| H1 | Barlow Condensed | 800 | 40–48px | Page titles |
| H2 | Barlow Condensed | 700 | 28–36px | Section headings, uppercase |
| H3 | Barlow Condensed | 700 | 16–22px | Card headers, panel titles, uppercase |
| Price | Barlow Condensed | 700 | 24–32px | Prices, countdowns, stats |
| Body | Inter | 400–500 | 14–16px | Body text, descriptions |
| Label | Inter | 600 | 11–13px | Field labels, uppercase, letter-spacing: 0.08–0.12em |
| Caption | Inter | 400–500 | 11–13px | Secondary info, timestamps |

## Spacing rhythm

- Page padding: 80px horizontal, 40–48px vertical
- Section gap: 24–32px
- Card internal padding: 16–24px
- Row height (table/list): 44–48px
- Divider: 1px `#2E2E2E`

## Common components

### Navigation
- Height: 72px, background: `#1A1A1A`, border-bottom: `1px solid #2E2E2E`
- Logo: 36×36px rust square + icon, + Barlow Condensed 800 text
- Links: Inter 500 14px, color `#6B6B6B` inactive, `#FFFFFF` active
- CTA button: `#C94B1E` fill, Inter 600 13px

### Section header pattern
- 3px × 20–24px rust vertical bar + Barlow Condensed 700–800 uppercase heading

### Buttons
- Primary: `#C94B1E` fill, border-radius: 4px, padding: 14–16px 32–40px
- Secondary: border `1px solid #2E2E2E`, same radius/padding
- Destructive / subtle: no border, text color only

### Form inputs
- Background: `#2E2E2E`, border: `1px solid #3A3A3A`
- Active/focus: border `1px solid #C94B1E`
- Validated/success: border `1px solid #4CAF50`
- Border-radius: 4px, padding: 13px 14–16px
- Label: Inter 600 11px uppercase, color `#ABABAB`

### Seat category color coding
- Free: `#4CAF50`
- Occupied: `#EF5350`
- VIP: `#FFD700`
- Accessible: `#2196F3`

### Loyalty tier colors
- Kék: `#4B8EC9`
- Ezüst: `#AAAAAA`
- Arany: `#FFD700`
- KTE Legenda: `#C94B1E`
