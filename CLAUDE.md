# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A HACS-installable Lovelace plugin: three custom cards for the **Sonoff NSPanel Pro 86**
(square 480×480 wall panel, Rockchip PX30 / 2 GB / Mali-G31, Android 8.1). Distributed as a
single JavaScript file that Home Assistant loads as a module resource.

Cards, in two families:

- **Controls** (`NsBaseCard`): `nspanel-light-card`, `nspanel-cover-card`,
  `nspanel-climate-card`, `nspanel-media-card`. Gesture engine, echo window, one entity each.
  What the drag sets differs per card: brightness, position, target temperature, volume.
- **Information** (`NsInfoCard`): `nspanel-sensor-card`, `nspanel-sensors-card`,
  `nspanel-status-card`, `nspanel-weather-card`, `nspanel-clock-card`. Read-only, often several
  entities, tap opens more-info.
- **Actions** (`NsInfoCard` too, since it needs the multi-entity diff and the timers but no
  drag): `nspanel-button-card`. Scenes, scripts, automations.
- `nspanel-probe-card` is neither — a standalone diagnostics element.

## Repo layout

```
dist/nspanel-cards.js      the entire project — hand-written source AND the shipped artifact
hacs.json                  HACS manifest (points at the filename above)
README.md                  user-facing docs: options tables, YAML examples, install steps
.github/workflows/         HACS validation + `node --check dist/nspanel-cards.js`
dev/bench.html             preview bench: mock hass + an ha-icon stub, renders the real
                           bundle in a 480x480 frame outside Home Assistant
dev/editor.html            harness for the GUI editor: stubs ha-form, shows the emitted
                           config-changed payload, and runs the option sync check
dev/kiosk-mock.js          fake HA websocket for kiosk/index.html?mock=1
dev/serve.py               no-cache static server for both (plain http.server lets Chrome
                           cache the bundle and render the previous build)
dev/shots.ps1              drives headless Chrome over the bench to regenerate the README
                           screenshots
docs/images/               those screenshots; referenced from the README
kiosk/                     the standalone panel page - same cards, a websocket to HA, and
                           none of the HA frontend. index.html + app.js + icons.js, plus
                           config.js which belongs to the user and is never rewritten
```

### Regenerating the screenshots

HACS's repo validation fails if the README has no images, so `docs/images/*.png` must keep
existing. They are real Chromium renders of the shipped bundle, never mockups:

```bash
python dev/serve.py               # from the repo root, then, in another shell:
powershell -NoProfile -File dev/shots.ps1
```

`dev/bench.html?shot=<id>` is the bare 480x480 capture mode the script drives - ids are
`light`, `cover`, `sheet`, `climate`, `media`, `info`, `scenes`, `status`, `sky`, one per
panel in the bench.
Loading `dev/bench.html` with no query string gives the whole rack for eyeballing changes.

HA's `ha-icon` does not exist outside HA. `kiosk/icons.js` defines it (only if nothing else
has) and carries the MDI path data for every icon the cards pick themselves; the bench and the
kiosk page both load that one file, so there is no second table to drift. Icons named in a
user's config are fetched from the CDN on first use and cached in localStorage.

**A card that starts choosing an icon not in that table draws an empty box on a panel with no
internet**, so add it to `kiosk/icons.js` rather than relying on the fetch. Take the path data
from `https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/<name>.svg` - do not write it from
memory, it will be wrong.

## There is no build step

`dist/nspanel-cards.js` is edited directly. No bundler, no npm, no `package.json`, no
transpile. Do not introduce one, do not split the file into modules, and do not add
dependencies — HACS serves this one file and the panel loads it over the local network.

Verify a change with:

```bash
node --check dist/nspanel-cards.js
```

That is the only automated check that exists (CI runs it plus HACS validation). There is no
test suite; behaviour is verified by loading the card on a real panel, or in `dev/bench.html`
(see below).

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
6. `NsPanelLightCard`, `NsPanelCoverCard`, `NsPanelClimateCard` — subclasses supplying
   `static cardType`, `static domain`, `static accent`, `getStubConfig`, `_entityValue`,
   `_build`, `_render`, `_commit`, `_onTap`, `_openSheet`.
7. `INFO_CSS`, the `NsInfoCard` base and the five information cards — see below.
8. `NsPanelProbeCard` — standalone diagnostics element, belonging to neither base.
9. `NsBaseCardEditor` + one subclass per card — the GUI editor HA builds from
   `Card.getConfigElement()`. It renders `ha-form` (the frontend's own schema-driven form, so
   still no dependency of ours) from `SHARED_SCHEMA`, and on every change merges the form
   value over the previous config so keys the form does not own — `presets` above all —
   survive a trip through the GUI. It also writes the form data back to itself after emitting
   `config-changed`; without that the next edit ships a stale snapshot and reverts the one
   before it.
10. Registration: `customElements.define`, `window.customCards` entries, `window.NsPanelCards`.

### Conventions

- Private members are `_`-prefixed; public API is what HA calls (`setConfig`, `hass`,
  `getCardSize`, `getLayoutOptions`, `getStubConfig`).
- `setConfig` validates the entity and its domain, then `Object.assign`s over a literal of
  defaults. Anything a card reads from `this._config` must come from that literal — a subclass
  cannot fill a key in after `super.setConfig()`, because the base has already run `_build()`
  from it. That ordering bug is why `defaultPresets` is a static on the class.

**An option lives in three places, and all three must agree:**

1. the defaults - the literal in `NsBaseCard`/`NsInfoCard.setConfig`, or the card's own
   `static defaultOptions`,
2. the README: the shared-options table, or the card's own section,
3. the card's editor schema (`SHARED_SCHEMA`, `INFO_SCHEMA`, `SENSOR_SCHEMA`, … ) plus a
   label in `EDITOR_LABELS`.

Miss (3) and the GUI silently drops the option from any card the user edits. `dev/editor.html`
prints a sync check comparing (1) against (3) for **every** card - open it after touching
options; all ten rows should say `ok`. The exempt keys are the ones `ha-form` cannot draw:
`presets`, `entities`, `severity`, `buttons`, and the legacy `name`.
- Comments explain *why*, in prose, at the point where the reasoning is non-obvious. Match
  that density — this file is written to be read.
- Single quotes, semicolons, 2-space indent, ~90 column soft wrap.
- A new card means: a subclass, a `customElements.define`, a `window.customCards` entry, an
  export on `window.NsPanelCards`, and a README row.

### The `title` option

`title` is what the card calls the thing; `name` is the older spelling and still works. Both
resolve through `_title()`, which falls back to the entity's `friendly_name` — read the
display name through that, never from the config directly. The editor migrates `name` into
`title` when a user touches a card in the GUI.

### Two bases, and which one a new card wants

`NsBaseCard` is for cards you *set*: it carries the pointer-gesture engine, the `_local` echo
window and a `hass` diff pinned to one entity. `NsInfoCard` is for cards you *read*: a diff
over a list of entities (`_entityIds()`), the same rAF render and build-once DOM, no gestures,
and `_teardown()` for anything with a lifetime — the clock's timer, the weather forecast
subscription. A read-only card on `NsBaseCard` would spend its life switching machinery off.

Both resolve per-card defaults through `static get defaultOptions()`, and control cards also
have `static get defaultPresets()`. Use them. A subclass that assigns to `this._config` after
`super.setConfig()` is writing into a config `_build()` has already read — that is the exact
shape of a bug this repo has shipped once already.

### The one bitmap in the bundle

The media card's album art is the only image this bundle decodes. Two rules hold it in place:
a fixed 76px box, and `src` assigned **only when the URL changes**. A render happens on every
volume frame, and reassigning an identical `src` makes the browser decode the image again —
which is exactly the kind of thing a Mali-G31 cannot absorb. `_artShown` is what guards it; if
you touch `_render` there, keep that guard.

### Colour taken from an entity

The light card paints itself in the bulb's `rgb_color` (`_tint`/`_paintTint`/`_liveAccent`).
Two things make that safe, and both matter if another card ever does the same:

- **`readableTint()` is not optional.** The fill is a tint under the card's own white text.
  Raw bulb colours fail at both ends - a white light washes the fill out until the label is
  invisible, a saturated blue disappears against the card - so the colour is clamped into a
  luminance band (scaled down above 170, mixed toward white below 70). Hue survives.
- **The custom properties are only written when the colour changes.** `_paintTint` guards on
  `_tintShown`; without it, three `setProperty` calls land on every frame of a drag.

Precedence is: an explicit `accent` in the config, then the entity's colour, then the card's
`static accent`. `follow_color: false` skips the middle one. HA reports `rgb_color` for
colour-temp lights too, so there is no kelvin conversion here and there should not need to be.

### A card with CSS of its own

`NsInfoCard._shell()` injects `BASE_CSS + INFO_CSS + this.constructor.extraCss`. A card that
brings its own stylesheet returns it from `static get extraCss()` — the button card does.
Forget it and the markup renders completely unstyled, which reads as a broken layout rather
than a missing stylesheet, so it costs more to diagnose than it should.

### `unknown` is not broken

`isBroken()` counts `unknown` as broken, which is right for a sensor and wrong for an action:
a scene or a `button` that has never been fired sits at `unknown` forever. The button card
therefore tests `!s || s.state === 'unavailable'` itself. Any future card over
scenes/scripts/buttons wants the same test.

### `hidden` needs the CSS rule

`BASE_CSS` carries `[hidden] { display: none !important; }`. Without it, setting `.hidden` on
anything with a `display` of its own — every flex block here — does nothing at all, because a
class rule outranks the UA sheet's `[hidden]`. The status grid and the presets row both fell
into this.

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

## The standalone panel page

`kiosk/` is an experiment: is the panel slow because of the cards, or because of the HA
frontend around them? It renders the same cards against a hand-rolled websocket client, so if
it is smooth there and laggy in the companion app, the frontend was the cost.

Three things in it are load-bearing:

- **A new `hass` object per update.** `applyStates` rebuilds both the wrapper and the `states`
  map. Each card's diff is `prev.states[id] === hass.states[id]`, so mutating in place would
  make every card conclude nothing had changed and skip its render.
- **The pager is CSS, not JavaScript.** A scroll-snap container, because the cards already
  declare `touch-action: pan-x` and release horizontal-first drags. Do not "fix" this with a
  pointer handler; it would fight the cards and move the pan off the compositor.
- **The token lives in localStorage, never in a file.** `/local/` is unauthenticated.

`?mock=1` loads `dev/kiosk-mock.js`, which replaces `window.WebSocket` with a fake HA speaking
the real protocol - auth, get_states, subscribe_events, call_service, state_changed. That is
what makes the connection path testable off the panel, which is the part you cannot debug
standing in a hallway. `app.js` is a separate file from `index.html` precisely so the mock can
be installed before it boots.

## The Flutter app is a sibling, not a subfolder

`../nspanel-app` renders the same cards natively and reads the same Lovelace config. It is a
separate git repo on purpose: this one stays a single-file HACS plugin with no toolchain.
When a card gains an option here, the app needs the same option - its `lib/cards/` mirrors
`dist/` card for card, and its README says so.

`kiosk/app.js` now looks for `nspanel-cards.js` beside itself as well as in `../dist/`, and
says which paths it tried when neither is there. That was the "unknown card type" report:
only `kiosk/` had been copied to the panel.

## HACS validation

`.github/workflows/validate.yml` runs `hacs/action`. Three of its checks depend on things
outside the code, and all three have bitten this repo:

- **topics** and **description** live in the GitHub repository settings, not in any file. They
  cannot be fixed by a commit — the repo owner sets them in the repo's About panel.
- **images** requires at least one image in the README; see the screenshot section above.

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
