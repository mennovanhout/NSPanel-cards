# NSPanel Cards

Lovelace cards built for one specific piece of hardware: the **Sonoff NSPanel Pro 86** — the
3.95″ 480×480 square wall panel.

> Note on model names: "86" and "120" are **wall-box millimetres, not screen sizes**. The Pro 86
> is the square 480×480 panel. The Pro 120 is a 4.7″ 750×1334 portrait screen. These cards are
> designed for the square one; they are fluid, so they render on the 120, but the layout is
> tuned for a square.

The panel runs a Rockchip PX30 with 2 GB of RAM and a Mali-G31, behind Android 8.1. That is
2018-class silicon. The usual card packs are built for phones, and on this hardware their
sliders lag, their hitboxes are small and their text is tiny. Everything here is shaped by
the constraint.

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
2. URL: `https://github.com/<you>/nspanel-cards`, category **Dashboard**
3. Install, then add the resource if HACS doesn't:
   `/hacsfiles/nspanel-cards/nspanel-cards.js`, type **JavaScript module**

### Manual

1. Copy `dist/nspanel-cards.js` to `/config/www/nspanel-cards.js`
2. Settings → Dashboards → ⋮ → Resources → `/local/nspanel-cards.js?v=0.1.0`, type
   **JavaScript module**

Home Assistant caches `/local/` hard. Bump the `?v=` when you update, or you will be looking at
the old file and wondering why nothing changed.

## Configuration

### Light

```yaml
type: custom:nspanel-light-card
entity: light.dining_lights
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

A preset takes any of `brightness_pct`, `color_temp_kelvin`, `rgb_color`, `effect`, or `scene`
(to fire a scene instead). `brightness_pct: 0` turns the light off.

### Cover

```yaml
type: custom:nspanel-cover-card
entity: cover.blinds_living_room
height: 260
presets:
  - name: Open
    position: 100
  - name: Privacy
    position: 35
  - name: Shut
    position: 0
```

Falls back to `open_cover` / `close_cover` when the entity doesn't advertise `SET_POSITION`.

### Shared options

| Option | Default | |
| --- | --- | --- |
| `entity` | — | required |
| `name` | friendly name | |
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
                height: 258
              - type: custom:nspanel-light-card
                entity: light.kitchen_spots
                height: 158
                show_presets: false
          - type: vertical-stack
            cards:
              - type: custom:nspanel-cover-card
                entity: cover.blinds_living_room
                height: 258
              - type: custom:nspanel-cover-card
                entity: cover.bedroom_blackout
                height: 158
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
