# NSPanel Cards

Lovelace cards built for one specific piece of hardware: the **Sonoff NSPanel Pro 86** — the
3.95″ 480×480 square wall panel.

The panel runs a Rockchip PX30 with 2 GB of RAM and a Mali-G31, behind Android 8.1. That is
2018-class silicon. The usual card packs are built for phones, and on this hardware their
sliders lag, their hitboxes are small and their text is tiny. Everything here is shaped by
the constraint.

<table>
<tr>
<td><img src="docs/images/light.png" alt="Two light cards on a 480x480 panel: a dimmed dining light at 68% with preset buttons, and an off kitchen light" width="320"></td>
<td><img src="docs/images/cover.png" alt="Two cover cards: living room blinds 62% open, bedroom blackout closed" width="320"></td>
<td><img src="docs/images/sheet.png" alt="The long-press control: a full-screen absolute slider at 68%, big plus and minus buttons, preset and turn-off buttons" width="320"></td>
</tr>
<tr>
<td align="center"><sub>Lights</sub></td>
<td align="center"><sub>Covers</sub></td>
<td align="center"><sub>Long-press</sub></td>
</tr>
</table>

<sub>Rendered from `dist/nspanel-cards.js` at the panel's own 480×480, by
[`dev/bench.html`](dev/bench.html) — not mockups.</sub>

## Cards

| Card | What it does |
| --- | --- |
| `custom:nspanel-light-card` | Brightness. Drag anywhere, tap to toggle, long-press for the full-screen control. |
| `custom:nspanel-cover-card` | Blind/cover position. Same gestures; a tap while it is moving **stops** it. |
| `custom:nspanel-probe-card` | Diagnostics. Prints viewport, devicePixelRatio, WebView version and CSS feature support, read straight off the glass. |

## Gestures

| | |
| --- | --- |
| **Tap** | Toggle. On a moving cover, stop. |
| **Drag up / down** | Adjust, relative to the current value. The full card height is the full range. |
| **Long-press** (500 ms) | Full-screen control: an absolute slider, big ± steps, preset and action buttons. |
| **Drag sideways** | Released back to the page, so a swipe card still changes page. |

## Why it isn't laggy

- **No service calls during a drag.** The card moves a block with `translate3d` and the CSS
  transition switched off, so the fill tracks your finger on the compositor. One call goes out
  when you let go. (`live: true` if you want throttled mid-drag updates.)
- **State can't yank the value back.** After a change the card ignores incoming state for
  `echo_ms` (1.5 s), so a slow round-trip can't make the slider jump backwards under your hand.
- **`hass` updates are diffed to one entity.** Home Assistant hands every card a fresh `hass`
  object whenever anything in the house changes; these cards compare the single state object
  they care about and return immediately otherwise.
- **Nothing expensive is animated.** Only `transform` and `opacity`. No `backdrop-filter`, no
  animated shadows, no continuous animation — the classic Mali-G31 killers.
- **The DOM is built once.** Updates touch custom properties and `textContent`, never `innerHTML`.
- **No framework, no dependencies.** Plain custom elements. The whole bundle is one file.

Browser baseline is **Chromium 108**, the minimum the HA Companion app needs on Android 8.1.
That rules out `color-mix()` and CSS nesting; neither is used.

## Install

### HACS (custom repository)

1. HACS → ⋮ → **Custom repositories**
2. URL: `https://github.com/mennovanhout/nspanel-cards`, category **Dashboard**
3. Install, then add the resource if HACS doesn't:
   `/hacsfiles/nspanel-cards/nspanel-cards.js`, type **JavaScript module**

### Manual

1. Copy `dist/nspanel-cards.js` to `/config/www/nspanel-cards.js`
2. Settings → Dashboards → ⋮ → Resources → `/local/nspanel-cards.js?v=0.2.0`, type
   **JavaScript module**

Home Assistant caches `/local/` hard. Bump the `?v=` when you update, or you will be looking at
the old file and wondering why nothing changed.

## Configuration

Both the light and cover cards have a **visual editor** — add one from the dashboard's card
picker, or click the pencil on an existing card, and you get HA's own controls: entity picker,
icon picker, switches, the lot. Everything in the shared options table below is in there.

`presets` is the one exception. It is a list of objects and HA's form builder has no control
for that, so presets stay in YAML — the editor leaves the key untouched, so opening the GUI on
a card with hand-written presets will not eat them. (The probe card has no options and no
editor.)

### Light

<table>
<tr>
<td valign="top">

```yaml
type: custom:nspanel-light-card
entity: light.dining_lights
title: Dining table
height: 260
presets:
  - name: Low
    brightness_pct: 15
  - name: Dinner
    brightness_pct: 45
    color_temp_kelvin: 2400
  - name: Full
    brightness_pct: 100
```

</td>
<td><img src="docs/images/light.png" alt="The card described on the left, at the top of a 480x480 panel, with a second preset-less light card below it" width="300"></td>
</tr>
</table>

That is the card at the top of the picture; below it is a second one with
`show_presets: false` and `height: 184`.

A preset takes any of `brightness_pct`, `color_temp_kelvin`, `rgb_color`, `effect`, or `scene`
(to fire a scene instead). `brightness_pct: 0` turns the light off.

### Cover

<table>
<tr>
<td valign="top">

```yaml
type: custom:nspanel-cover-card
entity: cover.blinds_living_room
title: Living room blinds
height: 260
presets:
  - name: Open
    position: 100
  - name: Privacy
    position: 35
  - name: Shut
    position: 0
```

</td>
<td><img src="docs/images/cover.png" alt="The card described on the left at 62% open, above a second cover card showing a closed blackout blind" width="300"></td>
</tr>
</table>

The fill descends from the top, the way a blind actually does: at 62% open it
covers the top 38% of the card.

Falls back to `open_cover` / `close_cover` when the entity doesn't advertise `SET_POSITION`.

### Shared options

| Option | Default | |
| --- | --- | --- |
| `entity` | — | required |
| `title` | the entity's friendly name | what the card calls it |
| `name` | — | the older spelling of `title`; still works |
| `icon` | domain default | |
| `height` | `200` | card height in px |
| `accent` | amber / sky | any hex |
| `presets` | 3 sensible ones | max 4 shown on the card |
| `show_presets` | `true` | |
| `live` | `false` | send updates mid-drag, throttled to 400 ms |
| `echo_ms` | `1500` | ignore incoming state for this long after a change |
| `drag_travel` | card height | px of travel for the full range |
| `swipe_safe` | `true` | give horizontal drags back to the page |
| `long_press` | `sheet` | or `none` |
| `long_press_ms` | `500` | |
| `step` | `5` | the ± buttons in the full-screen control |
| `haptics` | `true` | fires HA's `haptic` event |

### A full 480×480 panel view

```yaml
kiosk_mode:
  hide_header: true
views:
  - type: panel
    cards:
      - type: custom:simple-swipe-card
        card_spacing: 12
        cards:
          - type: vertical-stack
            cards:
              - type: custom:nspanel-light-card
                entity: light.dining_lights
                title: Dining table
                height: 260
              - type: custom:nspanel-light-card
                entity: light.kitchen_spots
                title: Kitchen spots
                height: 184
                show_presets: false
          - type: vertical-stack
            cards:
              - type: custom:nspanel-cover-card
                entity: cover.blinds_living_room
                title: Living room blinds
                height: 260
              - type: custom:nspanel-cover-card
                entity: cover.bedroom_blackout
                title: Bedroom blackout
                height: 184
                show_presets: false
```

## Sizing for your panel

The panel is 480 physical pixels, but Android density decides how many **CSS** pixels the page
gets. Stock is often not 160 dpi, and the community fix is `adb shell wm density 148` (with
kiosk-mode) or `133` (without) — which hands the page ~519 or ~577 CSS px instead of 480.

Drop `custom:nspanel-probe-card` on a dashboard once and read the real numbers off the glass,
then set `height` to suit. Delete it afterwards; it is a tool, not furniture.

## Licence

MIT
