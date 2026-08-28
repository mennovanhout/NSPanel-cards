# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A HACS-installable Lovelace plugin: three custom cards for the **Sonoff NSPanel Pro 86**
(square 480×480 wall panel, Rockchip PX30 / 2 GB / Mali-G31, Android 8.1). Distributed as a
single JavaScript file that Home Assistant loads as a module resource.

Cards: `custom:nspanel-light-card`, `custom:nspanel-cover-card`, `custom:nspanel-probe-card`.

## Repo layout

```
dist/nspanel-cards.js      the entire project — hand-written source AND the shipped artifact
hacs.json                  HACS manifest (points at the filename above)
README.md                  user-facing docs: options tables, YAML examples, install steps
.github/workflows/         HACS validation + `node --check dist/nspanel-cards.js`
dev/                       empty, untracked; scratch space for a local preview bench
```

## There is no build step

`dist/nspanel-cards.js` is edited directly. No bundler, no npm, no `package.json`, no
transpile. Do not introduce one, do not split the file into modules, and do not add
dependencies — HACS serves this one file and the panel loads it over the local network.

Verify a change with:

```bash
node --check dist/nspanel-cards.js
```

That is the only automated check that exists (CI runs it plus HACS validation). There is no
test suite; behaviour is verified by loading the card on a real panel or in a browser.

## The hardware constraint drives every decision

This is 2018-class silicon behind a WebView. The rules below are why the cards feel smooth;
breaking one is a regression even if it looks fine on a desktop.

- **Browser baseline is Chromium 108.** No `color-mix()`, no CSS nesting. Colour tints are
  computed in JS (`tintStops`) precisely because `color-mix()` is unavailable.
- **No framework, no LitElement, no dependencies.** Plain `HTMLElement` + shadow DOM.
- **The DOM is built once** in `_build()`. Updates go through `_render()` and touch only CSS
  custom properties, `transform` and `textContent`. Never `innerHTML` on update.
- **Animate only `transform` and `opacity`.** No `backdrop-filter`, no blur, no animated
  `box-shadow`, no continuous animation — those are the Mali-G31 killers.
- **No service calls during a drag** (unless `live: true`, which is throttled). One call goes
  out on release.
- **`hass` updates are diffed to a single entity** in `set hass` — HA pushes a fresh `hass`
  object on every state change in the house, and re-rendering on each one is the difference
  between a smooth panel and a stuttering one.
- **Renders are rAF-coalesced** via `_scheduleRender()`.

## Code structure inside the bundle

Ordered top to bottom, separated by banner comments:

1. Header comment (the rationale above), `NSPANEL_VERSION`, console banner.
2. Helpers: `clamp`, `fireEvent`, `haptic`, `tintStops`, `isOn`, `isBroken`, `friendly`.
3. `BASE_CSS` / `SHEET_CSS` — design tokens as template strings, injected into shadow roots.
4. `NsSheet` — the shared full-screen long-press control surface (`<ns-sheet>`, a singleton
   via `sheet()`; mount target overridable through `window.NsPanelCards.sheetHost`).
5. `NsBaseCard` — config normalisation, `hass` diffing, render scheduling, service calls, and
   the whole pointer-gesture engine (`_onDown`/`_onMove`/`_onUp`/`_onCancel`).
6. `NsPanelLightCard`, `NsPanelCoverCard` — subclasses supplying `static cardType`,
   `static domain`, `static accent`, `getStubConfig`, `_entityValue`, `_build`, `_render`,
   `_commit`, `_onTap`, `_openSheet`.
7. `NsPanelProbeCard` — standalone diagnostics element, not a `NsBaseCard`.
8. Registration: `customElements.define`, `window.customCards` entries, `window.NsPanelCards`.

### Conventions

- Private members are `_`-prefixed; public API is what HA calls (`setConfig`, `hass`,
  `getCardSize`, `getLayoutOptions`, `getStubConfig`).
- `setConfig` validates the entity and its domain, then `Object.assign`s over a literal of
  defaults. **Any new option must be added to that defaults literal and to the options table
  in the README.**
- Comments explain *why*, in prose, at the point where the reasoning is non-obvious. Match
  that density — this file is written to be read.
- Single quotes, semicolons, 2-space indent, ~90 column soft wrap.
- A new card means: a subclass, a `customElements.define`, a `window.customCards` entry, an
  export on `window.NsPanelCards`, and a README row.

### Local state vs. incoming state

`_local` holds the value under the user's finger; `_localUntil` (default `echo_ms: 1500`)
makes incoming `hass` state lose to it for a moment after a change, so a slow round-trip can
never yank the slider backwards. `_displayValue()` is the single place that resolves this —
read values through it, not from the entity directly.

### Gestures

Tap toggles (on a moving cover, stops). Vertical drag adjusts relative to the current value
over `drag_travel` px. Long-press (`long_press_ms`, 500 ms) opens the sheet. Horizontal drags
are deliberately **released back to the page** on the first move when `swipe_safe` is on, so a
wrapping swipe card still changes page — see `_onMove`.

## Versioning

`NSPANEL_VERSION` in `dist/nspanel-cards.js` and the `?v=` in the README's manual-install step
must stay in sync. Bump both when shipping user-visible changes; HA caches `/local/` hard, so
the query string is how users actually get the new file.

## Git

**Commit and push straight to `main`. No branches, no PRs, no asking first.** That is the
standing instruction from the repo owner for this project.

```bash
git add -A && git commit -m "..." && git push
```

Keep commit subjects short and imperative, lowercase, no trailing period, describing the
behaviour change rather than the file touched.
