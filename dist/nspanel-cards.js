/*!
 * nspanel-cards - Lovelace cards built for the Sonoff NSPanel Pro 86 (480x480)
 *
 * Cards in this bundle:
 *   custom:nspanel-light-card    brightness, drag anywhere, long-press for more
 *   custom:nspanel-cover-card    position, drag anywhere, long-press for more
 *   custom:nspanel-climate-card  target temperature, same gestures, modes in the sheet
 *   custom:nspanel-media-card    volume on the drag, transport on the face
 *   custom:nspanel-button-card   scenes/scripts/automations, with real press feedback
 *   custom:nspanel-sensor-card   one reading, large
 *   custom:nspanel-sensors-card  two to four readings side by side
 *   custom:nspanel-status-card   doors/windows/locks; quiet unless something is wrong
 *   custom:nspanel-weather-card  current conditions and a short forecast
 *   custom:nspanel-clock-card    time, date, and an optional line from any entity
 *   custom:nspanel-probe-card    diagnostics - viewport, WebView, CSS support
 *
 * Why this exists: HA's stock sliders and the usual card packs are built for
 * phones with a fast WebView. The NSPanel Pro 86 is a 2018-class Rockchip PX30
 * with 2 GB of RAM and a Mali-G31, so this bundle is written to a strict budget:
 *
 *   - no framework, no LitElement, no dependencies
 *   - the DOM is built once; updates only touch CSS custom properties,
 *     transforms and textContent
 *   - during a drag NO service calls are sent and NO transitions run, so the
 *     fill tracks your finger at compositor speed
 *   - hass updates are diffed down to the attributes each card actually uses
 *   - nothing animates except transform and opacity; no blur, no box-shadow
 *     transitions, no continuous animation
 *
 * Browser baseline: Chromium 108 (the minimum the HA Companion app needs on
 * Android 8.1). That rules out color-mix() and CSS nesting; everything else -
 * flex gap, aspect-ratio, :has, container queries, dvh - is fair game, but this
 * file avoids them where a cheaper construct does the same job.
 *
 * Gestures, and why they are what they are:
 *   tap          toggle
 *   drag up/down adjust, relative to the current value
 *   long-press   full-screen control surface
 *
 * Horizontal drags are deliberately released back to the page on the first
 * move, so a swipe card wrapping these cards keeps working. See _onMove.
 */

const NSPANEL_VERSION = '0.7.0';

console.info(
  `%c NSPANEL-CARDS %c v${NSPANEL_VERSION} `,
  'color:#0b0d10;background:#ffb74a;font-weight:700;border-radius:3px 0 0 3px;padding:2px 6px',
  'color:#ffb74a;background:#0b0d10;border-radius:0 3px 3px 0;padding:2px 6px'
);

/* ================================================================== *
 * helpers
 * ================================================================== */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function fireEvent(node, type, detail, options) {
  const o = options || {};
  const event = new Event(type, {
    bubbles: o.bubbles === undefined ? true : o.bubbles,
    cancelable: !!o.cancelable,
    composed: o.composed === undefined ? true : o.composed,
  });
  event.detail = detail === undefined ? {} : detail;
  node.dispatchEvent(event);
  return event;
}

/* The companion app turns this into a real vibration. Silent no-op elsewhere. */
function haptic(node, kind) {
  fireEvent(node, 'haptic', kind || 'light');
}

/* One accent in, two translucent stops out. Kept in JS rather than color-mix()
   because the Chromium 108 baseline predates it. */
function tintStops(hex) {
  const h = String(hex).trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16) || 255;
  const g = parseInt(full.slice(2, 4), 16) || 183;
  const b = parseInt(full.slice(4, 6), 16) || 74;
  return {
    strong: `rgba(${r},${g},${b},.62)`,
    weak: `rgba(${r},${g},${b},.34)`,
  };
}

/* A light's own colour, made safe to put white text on.
 *
 * The fill is a tint over a dark card, and the card's text sits on top of it.
 * Raw bulb colours break that at both ends: a white or pale light washes the
 * fill out until the text disappears into it, and a saturated blue or deep red
 * is so dark it vanishes against the card instead. So the colour is pulled
 * into a usable luminance band - scaled down when it is too bright, mixed
 * toward white when it is too dark. Hue survives, which is the part that
 * matters: a blue lamp still reads blue.
 */
function readableTint(rgb) {
  let r = clamp(rgb[0], 0, 255);
  let g = clamp(rgb[1], 0, 255);
  let b = clamp(rgb[2], 0, 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (lum > 170) {
    const k = 170 / lum;
    r *= k; g *= k; b *= k;
  } else if (lum < 70) {
    // Scaling up cannot help a colour that is already at full channel, so lift
    // it toward white instead. That desaturates, which is the right trade for
    // a deep blue on a near-black card.
    const k = (70 - lum) / (255 - lum);
    r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k;
  }
  return [Math.round(r), Math.round(g), Math.round(b)];
}

function isOn(stateObj) {
  return !!stateObj && stateObj.state !== 'off' && stateObj.state !== 'closed' &&
    stateObj.state !== 'unavailable' && stateObj.state !== 'unknown';
}

function isBroken(stateObj) {
  return !stateObj || stateObj.state === 'unavailable' || stateObj.state === 'unknown';
}

function friendly(stateObj, entityId) {
  return (stateObj && stateObj.attributes && stateObj.attributes.friendly_name) ||
    (entityId ? entityId.split('.')[1].replace(/_/g, ' ') : '');
}

/* Shared design tokens. One string, injected into every shadow root, so the
   browser parses it once per card rather than once per rule. */
const BASE_CSS = `
:host {
  --ns-ground: #0b0d10;
  --ns-surface: #16191f;
  --ns-surface-2: #1e232b;
  --ns-line: rgba(255,255,255,.09);
  --ns-text: #f2f4f7;
  --ns-muted: #98a1b0;
  --ns-accent: #ffb74a;
  --ns-accent-dim: rgba(255,183,74,.16);
  --ns-radius: 22px;
  --ns-danger: #f87171;
  display: block;
}
* { box-sizing: border-box; }
/* Every block below sets display, and a class rule outranks the UA sheet's
   [hidden] { display: none } - so without this, setting .hidden on a flex
   element does nothing at all. */
[hidden] { display: none !important; }
.card {
  position: relative;
  display: block;
  width: 100%;
  height: var(--ns-height, 200px);
  border-radius: var(--ns-radius);
  overflow: hidden;
  background: var(--ns-surface);
  color: var(--ns-text);
  font-family: Roboto, system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  -webkit-user-select: none;
  /* the browser keeps horizontal panning (swipe cards); we take the vertical */
  touch-action: pan-x;
  cursor: pointer;
}
.card.unavailable { opacity: .45; }

/* the fill is a solid block that slides - compositor only, never repainted */
.fillwrap {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: inherit;
}
.fill {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 100%;
  /* A tint, not a floodlight. A solid accent block forces the text above and
     below the boundary into opposite contrast requirements and one of them
     always loses; a tint keeps light text readable across the whole card. */
  background: linear-gradient(180deg,
    var(--ns-fill-strong, rgba(255,183,74,.62)) 0%,
    var(--ns-fill-weak, rgba(255,183,74,.34)) 100%);
  opacity: var(--ns-fill-opacity, 1);
  transform: translate3d(0, calc((1 - var(--ns-fill, 0)) * 100%), 0);
  transition: transform .18s cubic-bezier(.22,.61,.36,1), opacity .18s linear;
  will-change: transform;
}
/* the level itself, unmistakable at arm's length */
.fill::after {
  content: '';
  position: absolute;
  left: 0; right: 0; top: 0;
  height: 3px;
  background: var(--ns-accent);
}
.fill.from-top::after { top: auto; bottom: 0; }
.card.dragging .fill { transition: none; }
.fill.from-top {
  transform: translate3d(0, calc(var(--ns-fill, 0) * -100%), 0);
}

.content {
  position: relative;
  height: 100%;
  padding: 18px 20px;
  text-shadow: 0 1px 3px rgba(0,0,0,.45);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  pointer-events: none;
}
.row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.icon {
  width: 52px;
  height: 52px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,.10);
  color: var(--ns-text);
  flex: none;
}
.card.on .icon { background: rgba(255,255,255,.16); }
.icon ha-icon { --mdc-icon-size: 30px; }
.value {
  font-size: 40px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  padding-top: 4px;
}
.value small { font-size: 20px; font-weight: 600; opacity: .65; margin-left: 2px; }
.name {
  font-size: 22px;
  font-weight: 600;
  line-height: 28px;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sub {
  font-size: 15px;
  font-weight: 500;
  line-height: 20px;
  color: rgba(255,255,255,.72);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.presets {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  pointer-events: auto;
}
.chip {
  flex: 1 1 0;
  min-width: 0;
  height: 56px;
  border: 0;
  border-radius: 14px;
  background: rgba(0,0,0,.28);
  color: #fff;
  font-family: inherit;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 6px;
  transition: transform .1s ease-out;
}
.chip:active { transform: scale(.94); }
.chip { background: rgba(0,0,0,.34); }
.card:not(.on) .chip { background: rgba(255,255,255,.10); }

.badge {
  position: absolute;
  top: 12px;
  right: 14px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--ns-danger);
  pointer-events: none;
}
`;

/* ================================================================== *
 * Full-screen control sheet
 *
 * Lives on document.body, not inside the card, so no ancestor overflow or
 * transform can clip it. One instance is reused for every card on the panel.
 * ================================================================== */

const SHEET_CSS = `
:host {
  position: fixed;
  inset: 0;
  z-index: 10000;
  overflow: hidden;
  display: block;
  font-family: Roboto, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #f2f4f7;
  --ns-accent: #ffb74a;
}
* { box-sizing: border-box; }
.scrim {
  position: absolute;
  inset: 0;
  background: #0b0d10;
  opacity: 0;
  transition: opacity .16s linear;
}
.scrim.in { opacity: 1; }
.wrap {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 14px;
  opacity: 0;
  transform: translate3d(0, 12px, 0);
  transition: opacity .18s linear, transform .18s cubic-bezier(.22,.61,.36,1);
}
.wrap.in { opacity: 1; transform: none; }
.head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
}
.title { font-size: 22px; font-weight: 700; letter-spacing: -0.01em; flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.state { font-size: 15px; color: #98a1b0; font-weight: 500; }
.x {
  width: 56px; height: 56px; flex: none;
  border: 0; border-radius: 18px;
  background: rgba(255,255,255,.10);
  color: #fff;
  font-size: 26px; line-height: 1;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
.x:active { transform: scale(.94); }

.body { flex: 1; display: flex; gap: 14px; min-height: 0; }
.track {
  position: relative;
  flex: 1;
  border-radius: 24px;
  overflow: hidden;
  background: rgba(255,255,255,.08);
  touch-action: none;
  cursor: pointer;
}
.tfill {
  position: absolute;
  left: 0; right: 0; top: 0;
  height: 100%;
  background: var(--ns-accent);
  opacity: .8;
  transform: translate3d(0, calc((1 - var(--ns-fill, 0)) * 100%), 0);
  transition: transform .16s cubic-bezier(.22,.61,.36,1);
}
.track.dragging .tfill { transition: none; }
.tfill.from-top { transform: translate3d(0, calc(var(--ns-fill, 0) * -100%), 0); }
.tval {
  position: absolute;
  left: 0; right: 0; bottom: 18px;
  text-align: center;
  font-size: 46px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  pointer-events: none;
  color: #ffffff;
  text-shadow: 0 2px 8px rgba(0,0,0,.55);
}
.steps { display: flex; flex-direction: column; gap: 14px; flex: none; width: 96px; }
.step {
  flex: 1;
  border: 0;
  border-radius: 22px;
  background: rgba(255,255,255,.10);
  color: #fff;
  font-size: 34px;
  font-weight: 600;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  transition: transform .1s ease-out;
}
.step:active { transform: scale(.95); }

.actions { display: flex; gap: 10px; flex: none; }
.act {
  flex: 1 1 0;
  min-width: 0;
  height: 76px;
  border: 0;
  border-radius: 20px;
  background: rgba(255,255,255,.10);
  color: #fff;
  font-family: inherit;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  overflow: hidden;
  padding: 0 6px;
  transition: transform .1s ease-out;
}
.act:active { transform: scale(.95); }
.act.primary { background: var(--ns-accent); color: #14161a; }
.act ha-icon { --mdc-icon-size: 28px; }
`;

class NsSheet extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>${SHEET_CSS}</style>
      <div class="scrim"></div>
      <div class="wrap">
        <div class="head">
          <div style="flex:1;min-width:0">
            <div class="title"></div>
            <div class="state"></div>
          </div>
          <button class="x" aria-label="Close">&#10005;</button>
        </div>
        <div class="body">
          <div class="track"><div class="tfill"></div><div class="tval"></div></div>
          <div class="steps">
            <button class="step up" aria-label="Increase">+</button>
            <button class="step down" aria-label="Decrease">&minus;</button>
          </div>
        </div>
        <div class="actions"></div>
      </div>
    `;
    this._scrim = this.shadowRoot.querySelector('.scrim');
    this._wrap = this.shadowRoot.querySelector('.wrap');
    this._title = this.shadowRoot.querySelector('.title');
    this._state = this.shadowRoot.querySelector('.state');
    this._track = this.shadowRoot.querySelector('.track');
    this._tfill = this.shadowRoot.querySelector('.tfill');
    this._tval = this.shadowRoot.querySelector('.tval');
    this._actions = this.shadowRoot.querySelector('.actions');

    this.shadowRoot.querySelector('.x').addEventListener('click', () => this.close());
    this._scrim.addEventListener('click', () => this.close());
    this.shadowRoot.querySelector('.up')
      .addEventListener('click', () => this._step(+this._opts.step));
    this.shadowRoot.querySelector('.down')
      .addEventListener('click', () => this._step(-this._opts.step));

    this._bindTrack();
  }

  /* opts: {title, state, value 0..1, fromTop, step, accent, onInput(v), onCommit(v),
            actions:[{label, icon, primary, run}] } */
  open(opts) {
    this._opts = Object.assign({ step: 5, fromTop: false, accent: '#ffb74a' }, opts);
    this.style.setProperty('--ns-accent', this._opts.accent);
    this._title.textContent = opts.title || '';
    this._state.textContent = opts.state || '';
    this._tfill.classList.toggle('from-top', !!this._opts.fromTop);
    this.setValue(opts.value);

    this._actions.innerHTML = '';
    (opts.actions || []).forEach((a) => {
      const b = document.createElement('button');
      b.className = 'act' + (a.primary ? ' primary' : '');
      b.innerHTML = (a.icon ? `<ha-icon icon="${a.icon}"></ha-icon>` : '') +
        `<span>${a.label}</span>`;
      b.addEventListener('click', () => {
        haptic(this, 'light');
        a.run();
        if (a.close !== false) this.close();
      });
      this._actions.appendChild(b);
    });
    this._actions.style.display = (opts.actions && opts.actions.length) ? '' : 'none';

    const host = (window.NsPanelCards && window.NsPanelCards.sheetHost) || document.body;
    if (this.parentNode !== host) {
      this.style.position = host === document.body ? 'fixed' : 'absolute';
      host.appendChild(this);
    }
    // one frame so the transition has a starting point to run from
    requestAnimationFrame(() => {
      this._scrim.classList.add('in');
      this._wrap.classList.add('in');
    });
  }

  setValue(v) {
    this._value = clamp(v, 0, 1);
    this.style.setProperty('--ns-fill', String(this._value));
    this._tval.textContent = Math.round(this._value * 100) + '%';
  }

  close() {
    this._scrim.classList.remove('in');
    this._wrap.classList.remove('in');
    const done = () => { if (this.parentNode) this.parentNode.removeChild(this); };
    setTimeout(done, 200);
  }

  _step(delta) {
    haptic(this, 'light');
    const v = clamp(this._value + delta / 100, 0, 1);
    this.setValue(v);
    if (this._opts.onInput) this._opts.onInput(v);
    if (this._opts.onCommit) this._opts.onCommit(v);
  }

  _bindTrack() {
    const t = this._track;
    let active = false;

    // the sheet's track is absolute: touch position IS the value. It is a
    // dedicated full-height surface, so there is nothing to be precise about.
    // fromTop only changes where the fill is anchored, never the mapping: the
    // top of the track is always "more", so your finger sits on the boundary.
    const valueAt = (clientY) => {
      const r = t.getBoundingClientRect();
      return clamp(1 - (clientY - r.top) / r.height, 0, 1);
    };

    t.addEventListener('pointerdown', (e) => {
      active = true;
      t.setPointerCapture(e.pointerId);
      t.classList.add('dragging');
      const v = valueAt(e.clientY);
      this.setValue(v);
      if (this._opts.onInput) this._opts.onInput(v);
      haptic(this, 'selection');
    });
    t.addEventListener('pointermove', (e) => {
      if (!active) return;
      const v = valueAt(e.clientY);
      this.setValue(v);
      if (this._opts.onInput) this._opts.onInput(v);
    });
    const end = () => {
      if (!active) return;
      active = false;
      t.classList.remove('dragging');
      if (this._opts.onCommit) this._opts.onCommit(this._value);
    };
    t.addEventListener('pointerup', end);
    t.addEventListener('pointercancel', end);
  }
}
customElements.define('ns-sheet', NsSheet);

let _sheet = null;
function sheet() {
  if (!_sheet) _sheet = document.createElement('ns-sheet');
  return _sheet;
}

/* ================================================================== *
 * Base card - gestures, hass diffing, render scheduling
 * ================================================================== */

class NsBaseCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._built = false;
    this._local = null;          // value being dragged / just committed
    this._localUntil = 0;        // ignore incoming hass echoes until this time
    this._lastSent = 0;
    this._raf = null;
  }

  /* ---- config ---- */

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error(`${this.constructor.cardType}: an "entity" is required`);
    }
    const domain = config.entity.split('.')[0];
    if (domain !== this.constructor.domain) {
      throw new Error(
        `${this.constructor.cardType}: "${config.entity}" is a ${domain} entity, ` +
        `this card takes ${this.constructor.domain}.*`
      );
    }
    this._config = Object.assign({
      title: null,
      name: null,            // the original spelling of title; still honoured
      icon: null,
      height: 200,
      accent: null,
      step: 5,
      long_press_ms: 500,
      drag_travel: 0,          // px of travel for the full range; 0 = card height
      live: false,             // send updates mid-drag (off = quieter, snappier)
      echo_ms: 1500,
      haptics: true,
      swipe_safe: true,        // release horizontal drags back to the page
      show_presets: true,
      long_press: 'sheet',
    }, this.constructor.defaultOptions, config);
    // Presets have to be settled here, not in a subclass after super() returns:
    // _build() below reads them, so a config without a `presets` key - which is
    // what getStubConfig and the GUI editor both hand over - used to throw.
    if (!Array.isArray(this._config.presets)) {
      this._config.presets = this.constructor.defaultPresets;
    }
    this._built = false;
    if (this.shadowRoot) this._build();
    if (this._hass) this._sync(true);
  }

  set hass(hass) {
    const prev = this._hass;
    this._hass = hass;
    if (!this._config) return;
    // Diff down to the one entity we care about. HA pushes a new hass object on
    // every state change in the house; on this hardware that is the difference
    // between a smooth panel and a stuttering one.
    const id = this._config.entity;
    if (prev && prev.states[id] === hass.states[id]) return;
    this._sync(false);
  }

  get hass() { return this._hass; }

  /* HA asks the class for its GUI editor; each card registers one under its
     own tag. See the editor section near the bottom of this file. */
  static getConfigElement() { return document.createElement(this.cardType + '-editor'); }

  /* Overridden per card; the base has none so the subclass list is the only
     place a card's own defaults live. Same rule as defaultPresets: a card
     cannot set these after super.setConfig(), because _build() has run. */
  static get defaultPresets() { return []; }
  static get defaultOptions() { return {}; }

  getCardSize() { return Math.max(2, Math.round(this._config.height / 50)); }
  getLayoutOptions() { return { grid_rows: this.getCardSize(), grid_columns: 6 }; }

  connectedCallback() { this._build(); if (this._hass) this._sync(true); }
  disconnectedCallback() { this._cancelPress(); }

  /* ---- state helpers ---- */

  get _stateObj() {
    return this._hass && this._config ? this._hass.states[this._config.entity] : null;
  }

  _accent() {
    return this._config.accent || this.constructor.accent;
  }

  /* What the card calls the thing. `title` wins, `name` is the older spelling
     of the same option, and the entity's friendly_name is the fallback - which
     is why a card with no title says "Dining table" and not "dining lights". */
  _title() {
    const s = this._stateObj;
    return this._config.title || this._config.name || friendly(s, this._config.entity);
  }

  /* Value currently on screen: the local drag value wins while it is fresh,
     so a slow HA round-trip can never yank the fill back under your finger. */
  _displayValue() {
    if (this._local !== null && Date.now() < this._localUntil) return this._local;
    if (this._local !== null && this._dragging) return this._local;
    this._local = null;
    return this._entityValue();
  }

  /* ---- rendering ---- */

  _scheduleRender() {
    if (this._raf !== null) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this._render();
    });
  }

  _sync() { this._scheduleRender(); }

  /* ---- service calls ---- */

  _call(domain, service, data) {
    if (!this._hass) return;
    this._hass.callService(domain, service, Object.assign({
      entity_id: this._config.entity,
    }, data || {}));
  }

  _haptic(kind) {
    if (this._config.haptics) haptic(this, kind);
  }

  /* ---- gesture engine ---- */

  _bindGestures(surface) {
    this._surface = surface;
    surface.addEventListener('pointerdown', (e) => this._onDown(e));
    surface.addEventListener('pointermove', (e) => this._onMove(e));
    surface.addEventListener('pointerup', (e) => this._onUp(e));
    surface.addEventListener('pointercancel', () => this._onCancel());
    // A long-press on Android otherwise pops the text-selection / context menu
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (isBroken(this._stateObj)) return;
    this._p = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      t: Date.now(),
      axis: null,
      startValue: this._displayValue(),
    };
    this._dragging = false;
    if (this._config.long_press !== 'none') {
      this._pressTimer = setTimeout(() => {
        this._pressTimer = null;
        if (!this._p || this._p.axis) return;
        this._p.consumed = true;
        this._haptic('medium');
        this._openSheet();
      }, this._config.long_press_ms);
    }
  }

  _onMove(e) {
    const p = this._p;
    if (!p || e.pointerId !== p.id || p.consumed) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;

    if (!p.axis) {
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      if (adx < 8 && ady < 8) return;
      // Axis lock. A horizontal-first gesture is somebody swiping between pages
      // in a swipe card, so we let go of it entirely rather than fighting for it.
      if (this._config.swipe_safe && adx >= ady) {
        p.axis = 'x';
        this._cancelPress();
        return;
      }
      p.axis = 'y';
      this._cancelPress();
      this._dragging = true;
      this._card.classList.add('dragging');
      try { this._surface.setPointerCapture(p.id); } catch (err) { /* ignore */ }
      this._haptic('selection');
    }
    if (p.axis !== 'y') return;

    const travel = this._config.drag_travel || this._card.clientHeight || 200;
    const next = clamp(p.startValue - dy / travel, 0, 1);
    this._local = next;
    this._scheduleRender();

    if (this._config.live && Date.now() - this._lastSent > 400) {
      this._lastSent = Date.now();
      this._commit(next, true);
    }
  }

  _onUp(e) {
    const p = this._p;
    this._cancelPress();
    if (!p || (e && e.pointerId !== p.id)) { this._reset(); return; }

    if (p.consumed) { this._reset(); return; }

    if (p.axis === 'y') {
      this._localUntil = Date.now() + this._config.echo_ms;
      this._commit(this._local, false);
      this._haptic('light');
    } else if (!p.axis && Date.now() - p.t < this._config.long_press_ms) {
      this._haptic('light');
      this._onTap();
    }
    this._reset();
  }

  _onCancel() { this._cancelPress(); this._reset(); }

  _cancelPress() {
    if (this._pressTimer) { clearTimeout(this._pressTimer); this._pressTimer = null; }
  }

  _reset() {
    if (this._p && this._surface) {
      try { this._surface.releasePointerCapture(this._p.id); } catch (err) { /* ignore */ }
    }
    this._p = null;
    this._dragging = false;
    if (this._card) this._card.classList.remove('dragging');
    this._scheduleRender();
  }

  /* subclasses implement: _entityValue, _commit, _onTap, _openSheet, _render, _build */
}

/* ================================================================== *
 * Light
 * ================================================================== */

class NsPanelLightCard extends NsBaseCard {
  static get cardType() { return 'nspanel-light-card'; }
  static get domain() { return 'light'; }
  static get accent() { return '#ffb74a'; }
  static get defaultOptions() { return { follow_color: true }; }

  static getStubConfig(hass) {
    const found = hass && hass.states
      ? Object.keys(hass.states).find((e) => e.indexOf('light.') === 0)
      : null;
    return { entity: found || 'light.example', height: 200 };
  }

  static get defaultPresets() {
    return [
      { name: 'Low', brightness_pct: 15 },
      { name: 'Mid', brightness_pct: 50 },
      { name: 'Full', brightness_pct: 100 },
    ];
  }

  _entityValue() {
    const s = this._stateObj;
    if (!s || s.state !== 'on') return 0;
    const b = s.attributes.brightness;
    return typeof b === 'number' ? clamp(b / 255, 0, 1) : 1;
  }

  /* The colour to paint the card in: the bulb's own when it has one and is on,
     otherwise the configured accent. An explicit `accent:` always wins - if
     someone picked a colour, the card is not going to argue.
     HA reports rgb_color for colour-temperature lights too, computed from the
     kelvin, so a warm white lamp tints the card warm without any special case
     here. A brightness-only or on/off light reports none, and keeps the amber. */
  _tint() {
    const cfg = this._config;
    if (cfg.accent || cfg.follow_color === false) return null;
    const s = this._stateObj;
    if (!s || s.state !== 'on') return null;
    const rgb = s.attributes.rgb_color;
    if (!Array.isArray(rgb) || rgb.length < 3) return null;
    if (rgb.some((c) => typeof c !== 'number')) return null;
    return readableTint(rgb);
  }

  /* What the sheet and the fill should use right now. */
  _liveAccent() {
    const t = this._tint();
    return t ? `rgb(${t[0]},${t[1]},${t[2]})` : this._accent();
  }

  /* Push the colour into the custom properties, but only when it has actually
     changed - this runs on every frame of a drag. */
  _paintTint() {
    const t = this._tint();
    const stamp = t ? t.join(',') : '';
    if (stamp === this._tintShown) return;
    this._tintShown = stamp;
    const stops = t
      ? { strong: `rgba(${t[0]},${t[1]},${t[2]},.62)`, weak: `rgba(${t[0]},${t[1]},${t[2]},.34)` }
      : tintStops(this._accent());
    this._card.style.setProperty('--ns-accent', t ? `rgb(${t[0]},${t[1]},${t[2]})` : this._accent());
    this._card.style.setProperty('--ns-fill-strong', stops.strong);
    this._card.style.setProperty('--ns-fill-weak', stops.weak);
  }

  _build() {
    if (this._built || !this._config) return;
    this._built = true;
    const cfg = this._config;

    this.shadowRoot.innerHTML = `
      <style>${BASE_CSS}</style>
      <div class="card" style="--ns-height:${cfg.height}px;--ns-accent:${this._accent()};
        --ns-fill-strong:${tintStops(this._accent()).strong};
        --ns-fill-weak:${tintStops(this._accent()).weak}">
        <div class="fillwrap"><div class="fill"></div></div>
        <div class="badge" hidden>Offline</div>
        <div class="content">
          <div class="row">
            <div class="icon"><ha-icon></ha-icon></div>
            <div class="value">0<small>%</small></div>
          </div>
          <div>
            <div class="name"></div>
            <div class="sub"></div>
            <div class="presets" hidden></div>
          </div>
        </div>
      </div>
    `;

    this._card = this.shadowRoot.querySelector('.card');
    this._elIcon = this.shadowRoot.querySelector('.icon ha-icon');
    this._elValue = this.shadowRoot.querySelector('.value');
    this._elName = this.shadowRoot.querySelector('.name');
    this._elSub = this.shadowRoot.querySelector('.sub');
    this._elBadge = this.shadowRoot.querySelector('.badge');
    this._elPresets = this.shadowRoot.querySelector('.presets');

    if (cfg.show_presets && cfg.presets.length) {
      this._elPresets.hidden = false;
      cfg.presets.slice(0, 4).forEach((p) => {
        const b = document.createElement('button');
        b.className = 'chip';
        b.type = 'button';
        b.textContent = p.name || `${p.brightness_pct}%`;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this._haptic('light');
          this._applyPreset(p);
        });
        // keep chip touches out of the card's drag engine entirely
        b.addEventListener('pointerdown', (e) => e.stopPropagation());
        this._elPresets.appendChild(b);
      });
    }

    this._bindGestures(this._card);
  }

  _applyPreset(p) {
    const data = {};
    if (p.brightness_pct !== undefined) data.brightness_pct = p.brightness_pct;
    if (p.color_temp_kelvin !== undefined) data.color_temp_kelvin = p.color_temp_kelvin;
    if (p.rgb_color !== undefined) data.rgb_color = p.rgb_color;
    if (p.effect !== undefined) data.effect = p.effect;
    if (p.scene) {
      this._hass.callService('scene', 'turn_on', { entity_id: p.scene });
      return;
    }
    if (p.brightness_pct === 0) { this._call('light', 'turn_off'); return; }
    this._local = (data.brightness_pct || 100) / 100;
    this._localUntil = Date.now() + this._config.echo_ms;
    this._scheduleRender();
    this._call('light', 'turn_on', data);
  }

  _onTap() { this._call('light', 'toggle'); }

  _commit(v) {
    const pct = Math.round(v * 100);
    if (pct <= 0) this._call('light', 'turn_off');
    else this._call('light', 'turn_on', { brightness_pct: pct });
  }

  _openSheet() {
    const s = this._stateObj;
    const acts = (this._config.presets || []).slice(0, 3).map((p) => ({
      label: p.name || `${p.brightness_pct}%`,
      icon: p.icon || 'mdi:lightbulb-on-outline',
      run: () => this._applyPreset(p),
    }));
    acts.push({
      label: isOn(s) ? 'Turn off' : 'Turn on',
      icon: isOn(s) ? 'mdi:lightbulb-off' : 'mdi:lightbulb-on',
      primary: true,
      run: () => this._call('light', 'toggle'),
    });
    sheet().open({
      title: this._title(),
      state: isOn(s) ? 'On' : 'Off',
      value: this._displayValue(),
      accent: this._liveAccent(),
      step: this._config.step,
      actions: acts,
      onInput: (v) => {
        this._local = v;
        this._localUntil = Date.now() + this._config.echo_ms;
        this._scheduleRender();
      },
      onCommit: (v) => this._commit(v),
    });
  }

  _render() {
    if (!this._card) return;
    const cfg = this._config;
    const s = this._stateObj;
    const broken = isBroken(s);
    const on = isOn(s);
    const v = this._displayValue();
    const pct = Math.round(v * 100);

    this._card.classList.toggle('unavailable', broken);
    this._card.classList.toggle('on', on && !broken);
    this._elBadge.hidden = !broken;

    this._card.style.setProperty('--ns-fill', String(on && !broken ? v : 0));
    this._card.style.setProperty('--ns-fill-opacity', on && !broken ? '1' : '0');
    this._paintTint();

    this._elIcon.setAttribute('icon',
      cfg.icon || (s && s.attributes.icon) || (on ? 'mdi:lightbulb-on' : 'mdi:lightbulb-outline'));
    this._elName.textContent = this._title();

    if (this._valueShown !== pct || this._onShown !== on) {
      this._valueShown = pct;
      this._onShown = on;
      this._elValue.innerHTML = on ? `${pct}<small>%</small>` : '';
      this._elSub.textContent = broken ? 'Unavailable' : (on ? `On · ${pct}%` : 'Off');
    }
  }
}

/* ================================================================== *
 * Cover
 * ================================================================== */

class NsPanelCoverCard extends NsBaseCard {
  static get cardType() { return 'nspanel-cover-card'; }
  static get domain() { return 'cover'; }
  static get accent() { return '#7cc4ff'; }

  static getStubConfig(hass) {
    const found = hass && hass.states
      ? Object.keys(hass.states).find((e) => e.indexOf('cover.') === 0)
      : null;
    return { entity: found || 'cover.example', height: 200 };
  }

  static get defaultPresets() {
    return [
      { name: 'Open', position: 100 },
      { name: 'Half', position: 50 },
      { name: 'Shut', position: 0 },
    ];
  }

  _supports(bit) {
    const s = this._stateObj;
    const f = s && s.attributes ? (s.attributes.supported_features || 0) : 0;
    return (f & bit) !== 0;
  }

  /* value = how OPEN it is, 0..1 */
  _entityValue() {
    const s = this._stateObj;
    if (!s) return 0;
    const p = s.attributes.current_position;
    if (typeof p === 'number') return clamp(p / 100, 0, 1);
    return s.state === 'open' ? 1 : 0;
  }

  _build() {
    if (this._built || !this._config) return;
    this._built = true;
    const cfg = this._config;

    this.shadowRoot.innerHTML = `
      <style>${BASE_CSS}
        /* the fill descends from the top, the way a blind actually does */
        .slats {
          position: absolute;
          left: 0; right: 0; top: 0;
          height: 100%;
          background-image: repeating-linear-gradient(
            to bottom,
            rgba(0,0,0,.16) 0px,
            rgba(0,0,0,.16) 1px,
            rgba(0,0,0,0) 1px,
            rgba(0,0,0,0) 14px);
          pointer-events: none;
        }
      </style>
      <div class="card" style="--ns-height:${cfg.height}px;--ns-accent:${this._accent()};
        --ns-fill-strong:${tintStops(this._accent()).strong};
        --ns-fill-weak:${tintStops(this._accent()).weak}">
        <div class="fillwrap">
          <div class="fill from-top"><div class="slats"></div></div>
        </div>
        <div class="badge" hidden>Offline</div>
        <div class="content">
          <div class="row">
            <div class="icon"><ha-icon></ha-icon></div>
            <div class="value">0<small>%</small></div>
          </div>
          <div>
            <div class="name"></div>
            <div class="sub"></div>
            <div class="presets" hidden></div>
          </div>
        </div>
      </div>
    `;

    this._card = this.shadowRoot.querySelector('.card');
    this._elIcon = this.shadowRoot.querySelector('.icon ha-icon');
    this._elValue = this.shadowRoot.querySelector('.value');
    this._elName = this.shadowRoot.querySelector('.name');
    this._elSub = this.shadowRoot.querySelector('.sub');
    this._elBadge = this.shadowRoot.querySelector('.badge');
    this._elPresets = this.shadowRoot.querySelector('.presets');

    if (cfg.show_presets && cfg.presets.length) {
      this._elPresets.hidden = false;
      cfg.presets.slice(0, 4).forEach((p) => {
        const b = document.createElement('button');
        b.className = 'chip';
        b.type = 'button';
        b.textContent = p.name || `${p.position}%`;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this._haptic('light');
          this._local = clamp(p.position / 100, 0, 1);
          this._localUntil = Date.now() + this._config.echo_ms;
          this._scheduleRender();
          this._commit(this._local);
        });
        b.addEventListener('pointerdown', (e) => e.stopPropagation());
        this._elPresets.appendChild(b);
      });
    }

    this._bindGestures(this._card);
  }

  /* A moving blind should stop, not reverse. That is what the button does on
     every physical remote, and it is what people reach for mid-travel. */
  _onTap() {
    const s = this._stateObj;
    if (s && (s.state === 'opening' || s.state === 'closing')) {
      this._call('cover', 'stop_cover');
      return;
    }
    this._call('cover', 'toggle');
  }

  _commit(v) {
    const pct = Math.round(v * 100);
    if (this._supports(4)) this._call('cover', 'set_cover_position', { position: pct });
    else if (pct > 50) this._call('cover', 'open_cover');
    else this._call('cover', 'close_cover');
  }

  _openSheet() {
    const s = this._stateObj;
    sheet().open({
      title: this._title(),
      state: this._stateText(s, Math.round(this._displayValue() * 100)),
      value: this._displayValue(),
      fromTop: true,
      accent: this._accent(),
      step: this._config.step,
      actions: [
        { label: 'Open', icon: 'mdi:arrow-up', run: () => this._call('cover', 'open_cover') },
        { label: 'Stop', icon: 'mdi:stop', primary: true, close: false,
          run: () => this._call('cover', 'stop_cover') },
        { label: 'Close', icon: 'mdi:arrow-down', run: () => this._call('cover', 'close_cover') },
      ],
      onInput: (v) => {
        this._local = v;
        this._localUntil = Date.now() + this._config.echo_ms;
        this._scheduleRender();
      },
      onCommit: (v) => this._commit(v),
    });
  }

  _stateText(s, pct) {
    if (!s) return '';
    if (s.state === 'opening') return 'Opening';
    if (s.state === 'closing') return 'Closing';
    const p = pct === undefined ? s.attributes.current_position : pct;
    if (typeof p === 'number') return p >= 99 ? 'Open' : (p <= 0 ? 'Closed' : `${p}% open`);
    return s.state === 'open' ? 'Open' : 'Closed';
  }

  _render() {
    if (!this._card) return;
    const cfg = this._config;
    const s = this._stateObj;
    const broken = isBroken(s);
    const v = this._displayValue();
    const pct = Math.round(v * 100);
    const moving = s && (s.state === 'opening' || s.state === 'closing');

    this._card.classList.toggle('unavailable', broken);
    this._card.classList.toggle('on', !broken && pct < 55);
    this._elBadge.hidden = !broken;

    // --ns-fill is the value, always; .fill.from-top turns it into coverage,
    // so at 62% open the blind covers the top 38%.
    this._card.style.setProperty('--ns-fill', String(broken ? 1 : v));
    this._card.style.setProperty('--ns-fill-opacity', broken ? '0' : '1');

    this._elIcon.setAttribute('icon', cfg.icon || (s && s.attributes.icon) ||
      (pct >= 99 ? 'mdi:blinds-open' : pct <= 0 ? 'mdi:blinds' : 'mdi:blinds-horizontal'));
    this._elName.textContent = this._title();

    if (this._valueShown !== pct || this._movingShown !== moving) {
      this._valueShown = pct;
      this._movingShown = moving;
      this._elValue.innerHTML = broken ? '&mdash;' : `${pct}<small>%</small>`;
      this._elSub.textContent = broken ? 'Unavailable' : this._stateText(s, pct);
    }
  }
}

/* ================================================================== *
 * Info cards - read-only, and deliberately not NsBaseCard
 *
 * A control card carries a gesture engine, a local-value echo window and a
 * hass diff pinned to one entity. A sensor card needs none of that and often
 * watches several entities at once, so it gets its own smaller base rather
 * than inheriting machinery it would have to switch off.
 *
 * What it does share: the diff (widened to a list), the rAF-coalesced render,
 * build-once DOM, and BASE_CSS.
 * ================================================================== */

const INFO_CSS = `
.card.info { cursor: default; }

/* one number, read from across the room */
.big {
  font-size: 64px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}
.big small { font-size: 26px; font-weight: 600; opacity: .7; margin-left: 3px; }

/* a row of 2-4 readings */
.strip { display: flex; gap: 10px; height: 100%; align-items: stretch; pointer-events: auto; }
.cell {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  background: rgba(255,255,255,.06);
  border-radius: 16px;
  padding: 12px 10px;
  cursor: pointer;
}
.cell ha-icon { --mdc-icon-size: 22px; color: var(--ns-muted); }
.cell .cv {
  font-size: 30px;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.cell .cv small { font-size: 15px; font-weight: 600; opacity: .65; margin-left: 1px; }
.cell .cl {
  font-size: 13px;
  color: var(--ns-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* the status grid */
.grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-content: flex-start;
  overflow: hidden;
  pointer-events: auto;
}
.tile {
  /* (100% - the gaps) / columns. One rule for 1, 2 or 3 across, rather than a
     class per width. shrink 0 or the tiles squeeze onto one row instead of
     wrapping, and a 90px target is not a target on a wall panel. */
  flex: 1 0 calc((100% - (var(--ns-cols, 2) - 1) * 10px) / var(--ns-cols, 2));
  min-width: 0;
  height: 62px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border: 0;
  border-radius: 14px;
  background: rgba(255,255,255,.06);
  color: var(--ns-text);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition: transform .1s ease-out;
}
.tile:active { transform: scale(.97); }
.tile.alert { background: var(--ns-accent-dim); }
.tile ha-icon { --mdc-icon-size: 24px; color: var(--ns-muted); flex: none; }
.tile.alert ha-icon { color: var(--ns-accent); }
.tile .tt { min-width: 0; }
.tile .tn {
  font-size: 15px;
  font-weight: 600;
  line-height: 18px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tile .ts {
  font-size: 12px;
  line-height: 16px;
  color: var(--ns-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tile.alert .ts { color: var(--ns-accent); }
.grid[data-cols="3"] .tile { padding: 0 8px; gap: 8px; }
.grid[data-cols="3"] .tile ha-icon { --mdc-icon-size: 20px; }
.grid[data-cols="3"] .tile .tn { font-size: 14px; }

/* nothing is wrong, and that is the whole message */
.clear {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--ns-muted);
}
.clear ha-icon { --mdc-icon-size: 44px; color: var(--ns-accent); }
.clear div { font-size: 18px; font-weight: 600; }

/* clock */
.clock-t {
  font-size: 88px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
}
.clock-t small { font-size: 34px; font-weight: 600; opacity: .55; margin-left: 4px; }
.clock-d { font-size: 20px; font-weight: 600; color: var(--ns-muted); margin-top: 10px; }

/* weather forecast strip */
.fc { display: flex; gap: 8px; margin-top: 14px; }
.fc .d {
  flex: 1 1 0;
  min-width: 0;
  background: rgba(255,255,255,.06);
  border-radius: 12px;
  padding: 8px 2px 10px;
  text-align: center;
}
.fc .dd { font-size: 12px; color: var(--ns-muted); }
.fc ha-icon { --mdc-icon-size: 22px; margin: 2px 0; }
.fc .dt { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
.fc .dt span { font-weight: 500; opacity: .55; margin-left: 2px; }
`;

/* Icons by device_class, so a sensor card with no icon still looks like the
   thing it measures. */
const CLASS_ICONS = {
  temperature: 'mdi:thermometer',
  humidity: 'mdi:water-percent',
  pressure: 'mdi:gauge',
  power: 'mdi:flash',
  energy: 'mdi:lightning-bolt',
  battery: 'mdi:battery',
  illuminance: 'mdi:brightness-5',
  carbon_dioxide: 'mdi:molecule-co2',
  wind_speed: 'mdi:weather-windy',
  moisture: 'mdi:water-alert',
  door: 'mdi:door-open',
  window: 'mdi:window-open',
  garage_door: 'mdi:garage-open',
  motion: 'mdi:motion-sensor',
  smoke: 'mdi:smoke-detector',
  problem: 'mdi:alert',
  occupancy: 'mdi:account',
};

function deviceClass(stateObj) {
  return (stateObj && stateObj.attributes && stateObj.attributes.device_class) || null;
}

/* Openable things get an icon per state - a door-open glyph next to the word
   "Closed" is the kind of detail that makes a panel feel wrong at a glance. */
const STATE_ICONS = {
  door: ['mdi:door-closed', 'mdi:door-open'],
  window: ['mdi:window-closed', 'mdi:window-open'],
  garage_door: ['mdi:garage', 'mdi:garage-open'],
  opening: ['mdi:door-closed', 'mdi:door-open'],
  motion: ['mdi:motion-sensor-off', 'mdi:motion-sensor'],
};

function classIcon(stateObj, entityId) {
  const c = deviceClass(stateObj);
  const state = stateObj ? stateObj.state : '';
  const open = state === 'on' || state === 'open' || state === 'opening';
  if (c && STATE_ICONS[c]) return STATE_ICONS[c][open ? 1 : 0];
  if (c && CLASS_ICONS[c]) return CLASS_ICONS[c];
  const domain = entityId ? entityId.split('.')[0] : '';
  if (domain === 'lock') return state === 'locked' ? 'mdi:lock' : 'mdi:lock-open';
  if (domain === 'cover') {
    return c === 'garage' || c === 'garage_door'
      ? (open ? 'mdi:garage-open' : 'mdi:garage')
      : 'mdi:window-shutter';
  }
  if (domain === 'person' || domain === 'device_tracker') return 'mdi:account';
  return 'mdi:eye-outline';
}

/* A number if the state is one, otherwise null - which is the difference
   between "22.4" and "unavailable" everywhere below. */
function numeric(stateObj) {
  if (!stateObj) return null;
  const n = parseFloat(stateObj.state);
  return isNaN(n) ? null : n;
}

function unitOf(stateObj) {
  return (stateObj && stateObj.attributes &&
    stateObj.attributes.unit_of_measurement) || '';
}

/* Round for display. Default: one decimal below 100, none above, because
   three decimals of humidity is noise at arm's length. */
function fmt(n, decimals) {
  if (n === null || n === undefined) return '—';
  const d = decimals === null || decimals === undefined
    ? (Math.abs(n) >= 100 || Math.round(n) === n ? 0 : 1)
    : decimals;
  return n.toFixed(d);
}

function moreInfo(node, entityId) {
  fireEvent(node, 'hass-more-info', { entityId });
}

class NsInfoCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._built = false;
    this._raf = null;
  }

  /* Cards that need an entity say so; the clock does not. */
  static get requiresEntity() { return true; }
  static get accent() { return '#7cc4ff'; }
  static get defaultOptions() { return {}; }
  static getConfigElement() { return document.createElement(this.cardType + '-editor'); }

  setConfig(config) {
    if (this.constructor.requiresEntity && (!config || !config.entity)) {
      throw new Error(`${this.constructor.cardType}: an "entity" is required`);
    }
    this._config = Object.assign({
      title: null,
      name: null,
      icon: null,
      height: 200,
      accent: null,
      more_info: true,
    }, this.constructor.defaultOptions, config || {});
    this._built = false;
    this._teardown();
    if (this.shadowRoot) this._build();
    if (this._hass) this._sync();
  }

  /* Every entity this card draws. The base diff walks the list, so a card that
     reads several entities overrides this and not the diff itself. */
  _entityIds() {
    return this._config && this._config.entity ? [this._config.entity] : [];
  }

  set hass(hass) {
    const prev = this._hass;
    this._hass = hass;
    if (!this._config) return;
    this._afterHass(prev);
    if (prev) {
      const ids = this._entityIds();
      let changed = false;
      for (let i = 0; i < ids.length; i++) {
        if (prev.states[ids[i]] !== hass.states[ids[i]]) { changed = true; break; }
      }
      if (!changed) return;
    }
    this._sync();
  }

  get hass() { return this._hass; }

  /* For cards that want the connection rather than the states - the weather
     forecast subscription. Runs on every hass, changed entities or not. */
  _afterHass() {}

  getCardSize() { return Math.max(2, Math.round(this._config.height / 50)); }
  getLayoutOptions() { return { grid_rows: this.getCardSize(), grid_columns: 6 }; }

  connectedCallback() { this._build(); if (this._hass) this._sync(); }
  disconnectedCallback() { this._teardown(); }

  /* Timers and subscriptions are released here, so no card leaks one. */
  _teardown() {}

  get _stateObj() {
    return this._hass && this._config ? this._hass.states[this._config.entity] : null;
  }

  _state(id) { return this._hass ? this._hass.states[id] : null; }

  _accent() { return this._config.accent || this.constructor.accent; }

  _title() {
    const s = this._stateObj;
    return this._config.title || this._config.name ||
      friendly(s, this._config && this._config.entity);
  }

  _scheduleRender() {
    if (this._raf !== null) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this._render();
    });
  }

  _sync() { this._scheduleRender(); }

  /* Tap on a read-only card opens HA's own more-info dialog, which is where
     history and settings already live. Nothing worth reimplementing. */
  _bindMoreInfo(surface, entityIdFn) {
    surface.addEventListener('click', () => {
      if (!this._config.more_info) return;
      const id = entityIdFn ? entityIdFn() : this._config.entity;
      if (id) moreInfo(this, id);
    });
  }

  /* The opening of every info card's shadow DOM: tokens, height, accent. */
  /* A card with CSS of its own returns it here; _shell puts it after INFO_CSS
     so it can override. Forgetting this leaves a card's markup completely
     unstyled, which looks like a layout bug rather than a missing stylesheet. */
  static get extraCss() { return ''; }

  _shell(extraClass) {
    const tint = tintStops(this._accent());
    return `
      <style>${BASE_CSS}${INFO_CSS}${this.constructor.extraCss}</style>
      <div class="card info ${extraClass || ''}"
        style="--ns-height:${this._config.height}px;--ns-accent:${this._accent()};
          --ns-accent-dim:${tint.weak};
          --ns-fill-strong:${tint.strong};--ns-fill-weak:${tint.weak}">
    `;
  }
}

/* ================================================================== *
 * Sensor card - one reading, as large as the card allows
 * ================================================================== */

class NsPanelSensorCard extends NsInfoCard {
  static get cardType() { return 'nspanel-sensor-card'; }
  static get accent() { return '#7cc4ff'; }
  static get defaultOptions() {
    return {
      decimals: null, unit: null, min: null, max: null, bar: null,
      severity: null, secondary: null,
    };
  }

  static getStubConfig(hass) {
    const found = hass && hass.states
      ? Object.keys(hass.states).find((e) => e.indexOf('sensor.') === 0)
      : null;
    return { entity: found || 'sensor.example', height: 160 };
  }

  _entityIds() {
    const ids = [this._config.entity];
    if (this._config.secondary) ids.push(this._config.secondary);
    return ids;
  }

  /* A bar needs both ends of a range; asking for one without them is a config
     mistake worth ignoring rather than crashing over. */
  _hasBar() {
    const c = this._config;
    if (c.bar === false) return false;
    return typeof c.min === 'number' && typeof c.max === 'number';
  }

  /* severity: [{above: 800, color: '#f87171'}, ...]. Last match wins, so the
     list reads top to bottom the way a person would say it. */
  _severityColour(n) {
    const list = this._config.severity;
    if (!Array.isArray(list) || n === null) return null;
    let hit = null;
    list.forEach((s) => {
      if (typeof s.above === 'number' && n > s.above) hit = s.color || s.colour || null;
    });
    return hit;
  }

  _build() {
    if (this._built || !this._config) return;
    this._built = true;
    this.shadowRoot.innerHTML = `
      ${this._shell()}
        <div class="fillwrap"><div class="fill"></div></div>
        <div class="badge" hidden>Offline</div>
        <div class="content">
          <div class="row"><div class="icon"><ha-icon></ha-icon></div></div>
          <div>
            <div class="big"></div>
            <div class="name"></div>
            <div class="sub"></div>
          </div>
        </div>
      </div>
    `;
    this._card = this.shadowRoot.querySelector('.card');
    this._elIcon = this.shadowRoot.querySelector('ha-icon');
    this._elValue = this.shadowRoot.querySelector('.big');
    this._elName = this.shadowRoot.querySelector('.name');
    this._elSub = this.shadowRoot.querySelector('.sub');
    this._elBadge = this.shadowRoot.querySelector('.badge');
    if (!this._hasBar()) this.shadowRoot.querySelector('.fillwrap').hidden = true;
    this._bindMoreInfo(this._card);
  }

  _render() {
    if (!this._card) return;
    const cfg = this._config;
    const s = this._stateObj;
    const broken = isBroken(s);
    const n = numeric(s);

    this._card.classList.toggle('unavailable', broken);
    this._elBadge.hidden = !broken;

    const sev = this._severityColour(n);
    if (sev !== this._sevShown) {
      this._sevShown = sev;
      const accent = sev || this._accent();
      const tint = tintStops(accent);
      this._card.style.setProperty('--ns-accent', accent);
      this._card.style.setProperty('--ns-fill-strong', tint.strong);
      this._card.style.setProperty('--ns-fill-weak', tint.weak);
    }

    if (this._hasBar()) {
      const v = clamp((n - cfg.min) / (cfg.max - cfg.min), 0, 1);
      this._card.style.setProperty('--ns-fill', String(broken || n === null ? 0 : v));
      this._card.style.setProperty('--ns-fill-opacity', broken || n === null ? '0' : '1');
    }

    this._elIcon.setAttribute('icon',
      cfg.icon || (s && s.attributes.icon) || classIcon(s, cfg.entity));
    this._elName.textContent = this._title();

    const unit = cfg.unit === null || cfg.unit === undefined ? unitOf(s) : cfg.unit;
    const text = broken ? '—' : (n === null ? (s ? s.state : '—') : fmt(n, cfg.decimals));
    const stamp = text + '|' + unit;
    if (this._textShown !== stamp) {
      this._textShown = stamp;
      this._elValue.innerHTML = unit && !broken ? `${text}<small>${unit}</small>` : text;
    }

    const sec = cfg.secondary ? this._state(cfg.secondary) : null;
    const subText = broken ? 'Unavailable'
      : (sec ? `${friendly(sec, cfg.secondary)} ${fmt(numeric(sec), null)}${unitOf(sec)}` : '');
    if (this._subShown !== subText) {
      this._subShown = subText;
      this._elSub.textContent = subText;
      this._elSub.hidden = !subText;
    }
  }
}

/* ================================================================== *
 * Sensors card - two to four readings side by side
 *
 * The density card. Four separate sensor cards do not fit a 480px page; one
 * of these does, without shrinking any of the numbers below legible.
 * ================================================================== */

class NsPanelSensorsCard extends NsInfoCard {
  static get cardType() { return 'nspanel-sensors-card'; }
  static get requiresEntity() { return false; }
  static get accent() { return '#7cc4ff'; }
  static get defaultOptions() { return { entities: [], show_icons: true }; }

  static getStubConfig(hass) {
    const found = hass && hass.states
      ? Object.keys(hass.states).filter((e) => e.indexOf('sensor.') === 0).slice(0, 3)
      : [];
    return { entities: found.length ? found : ['sensor.example'], height: 130 };
  }

  setConfig(config) {
    super.setConfig(config);
    if (!this._items.length) {
      throw new Error(`${this.constructor.cardType}: "entities" needs at least one entity`);
    }
  }

  /* Each item is either "sensor.x" or {entity, name, icon, unit, decimals}. */
  get _items() {
    const list = Array.isArray(this._config.entities) ? this._config.entities : [];
    return list
      .map((it) => (typeof it === 'string' ? { entity: it } : it))
      .filter((it) => it && it.entity)
      .slice(0, 4);
  }

  _entityIds() { return this._items.map((i) => i.entity); }

  _build() {
    if (this._built || !this._config) return;
    this._built = true;
    this.shadowRoot.innerHTML = `
      ${this._shell()}
        <div class="content"><div class="strip"></div></div>
      </div>
    `;
    this._card = this.shadowRoot.querySelector('.card');
    const strip = this.shadowRoot.querySelector('.strip');

    this._cells = this._items.map((item) => {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.innerHTML = (this._config.show_icons ? '<ha-icon></ha-icon>' : '') +
        '<div class="cv"></div><div class="cl"></div>';
      cell.addEventListener('click', () => {
        if (this._config.more_info) moreInfo(this, item.entity);
      });
      strip.appendChild(cell);
      return {
        item,
        icon: cell.querySelector('ha-icon'),
        value: cell.querySelector('.cv'),
        label: cell.querySelector('.cl'),
      };
    });
  }

  _render() {
    if (!this._cells) return;
    this._cells.forEach((c) => {
      const s = this._state(c.item.entity);
      const broken = isBroken(s);
      const n = numeric(s);
      const unit = c.item.unit === undefined || c.item.unit === null
        ? unitOf(s) : c.item.unit;
      const text = broken ? '—'
        : (n === null ? (s ? s.state : '—') : fmt(n, c.item.decimals));
      c.value.innerHTML = unit && !broken ? `${text}<small>${unit}</small>` : text;
      c.label.textContent = c.item.name || friendly(s, c.item.entity);
      if (c.icon) {
        c.icon.setAttribute('icon',
          c.item.icon || (s && s.attributes.icon) || classIcon(s, c.item.entity));
      }
    });
  }
}

/* ================================================================== *
 * Button card - scenes, scripts, automations
 *
 * Every other card in this bundle reflects a state. A script or a scene has
 * none: you press "Goodnight", the house does fifteen things over the next
 * minute, and the entity you pressed looks exactly as it did before. So this
 * card's whole design problem is feedback - the panel has to say "yes, that
 * landed" itself, because the state will not say it.
 *
 * It does that three ways: the press scales the button (transform, so it is
 * free), a haptic fires, and the button holds an accent tick for a second and
 * a bit afterwards. A script that does report `on` while it runs keeps the
 * accent for as long as it is running.
 *
 * The other half of the problem is misfires. "Goodnight" at four in the
 * afternoon is a genuinely annoying thing to do to a household, and a wall
 * panel is exactly the sort of thing people brush past. `confirm: true` makes
 * a button ask for a second tap.
 * ================================================================== */

const BUTTON_CSS = `
.pad {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  flex: 1 1 auto;
  min-height: 0;
  align-content: stretch;
  pointer-events: auto;
}
.btn {
  /* (100% - the gaps) / columns, and shrink 0 - otherwise four buttons squeeze
     onto one row instead of wrapping, and a 60px-wide target is not a target
     on a wall panel. */
  flex: 1 0 calc((100% - (var(--ns-cols, 2) - 1) * 10px) / var(--ns-cols, 2));
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px;
  border: 0;
  border-radius: 18px;
  background: var(--ns-surface-2);
  color: var(--ns-text);
  font-family: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition: transform .1s ease-out;
}
.btn:active { transform: scale(.96); }
.btn ha-icon { --mdc-icon-size: 40px; color: var(--ns-muted); flex: none; }
.btn .bl {
  font-size: 18px;
  font-weight: 600;
  line-height: 22px;
  letter-spacing: -0.01em;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* fired, running, or waiting for the second tap - all three are "this button
   is what you are dealing with right now" */
.btn.hot { background: var(--ns-accent-dim); }
.btn.hot ha-icon, .btn.hot .bl { color: var(--ns-accent); }
.btn.ask .bl { color: var(--ns-accent); }
/* three across is narrow; shrink to stay readable rather than clipped */
.pad[data-cols="3"] .btn ha-icon { --mdc-icon-size: 32px; }
.pad[data-cols="3"] .btn .bl { font-size: 15px; line-height: 19px; }
.btn[disabled] { opacity: .45; }
`;

/* What to call for a bare entity, by domain. Anything not listed toggles,
   which is the right answer for lights, switches, fans and input_booleans. */
const BUTTON_SERVICE = {
  script: ['script', 'turn_on'],
  scene: ['scene', 'turn_on'],
  automation: ['automation', 'trigger'],
  button: ['button', 'press'],
  input_button: ['input_button', 'press'],
  vacuum: ['vacuum', 'start'],
};

const BUTTON_ICONS = {
  script: 'mdi:script-text-outline',
  scene: 'mdi:palette-outline',
  automation: 'mdi:robot-outline',
};

class NsPanelButtonCard extends NsInfoCard {
  static get cardType() { return 'nspanel-button-card'; }
  static get extraCss() { return BUTTON_CSS; }
  static get requiresEntity() { return false; }
  static get accent() { return '#8ddba4'; }
  static get defaultOptions() {
    return {
      buttons: [], columns: 2, haptics: true, confirm: false,
      confirm_text: 'Tap again', feedback_ms: 1200, more_info: true,
    };
  }

  /* 1, 2 or 3 across; a lone button always takes the whole card, because a
     half-width button with empty space beside it just looks like a mistake. */
  get _columns() {
    if (this._items.length === 1) return 1;
    return clamp(Math.round(this._config.columns) || 2, 1, 3);
  }

  static getStubConfig(hass) {
    const found = hass && hass.states
      ? Object.keys(hass.states).find((e) => e.indexOf('script.') === 0 ||
          e.indexOf('scene.') === 0)
      : null;
    return { entity: found || 'script.example', height: 140 };
  }

  setConfig(config) {
    super.setConfig(config);
    if (!this._items.length) {
      throw new Error(
        `${this.constructor.cardType}: needs an "entity", or "buttons" with at least one`);
    }
  }

  /* One button from `entity`, or a list from `buttons`. The shorthand exists
     because a single big button is the common case and should not need a
     list to say so. */
  get _items() {
    const cfg = this._config;
    const list = Array.isArray(cfg.buttons) && cfg.buttons.length
      ? cfg.buttons
      : (cfg.entity ? [{ entity: cfg.entity, name: cfg.title || cfg.name, icon: cfg.icon }] : []);
    return list
      .map((it) => (typeof it === 'string' ? { entity: it } : it))
      .filter((it) => it && (it.entity || it.service))
      .slice(0, 6);
  }

  _entityIds() { return this._items.map((i) => i.entity).filter(Boolean); }

  _teardown() {
    (this._timers || []).forEach((t) => clearTimeout(t));
    this._timers = [];
  }

  _later(fn, ms) {
    this._timers = this._timers || [];
    const t = setTimeout(fn, ms);
    this._timers.push(t);
    return t;
  }

  _label(item) {
    const s = item.entity ? this._state(item.entity) : null;
    return item.name || friendly(s, item.entity) || 'Run';
  }

  _icon(item) {
    const s = item.entity ? this._state(item.entity) : null;
    if (item.icon) return item.icon;
    if (s && s.attributes && s.attributes.icon) return s.attributes.icon;
    const domain = item.entity ? item.entity.split('.')[0] : '';
    return BUTTON_ICONS[domain] || 'mdi:gesture-tap-button';
  }

  _fire(item) {
    const parts = item.service ? item.service.split('.') : null;
    const byDomain = item.entity ? BUTTON_SERVICE[item.entity.split('.')[0]] : null;
    const domain = parts ? parts[0] : (byDomain ? byDomain[0] : 'homeassistant');
    const service = parts ? parts[1] : (byDomain ? byDomain[1] : 'toggle');
    const data = Object.assign({}, item.data || {});
    if (item.entity && !data.entity_id) data.entity_id = item.entity;
    if (this._hass) this._hass.callService(domain, service, data);
  }

  _press(b) {
    if (this._config.haptics) haptic(this, 'light');

    // confirm: the first tap arms, the second fires. The armed state times out
    // on its own so a half-pressed button never sits there waiting.
    const wants = b.item.confirm === undefined ? this._config.confirm : b.item.confirm;
    if (wants && !b.armed) {
      b.armed = true;
      b.el.classList.add('ask');
      b.label.textContent = b.item.confirm_text || this._config.confirm_text;
      this._later(() => {
        b.armed = false;
        b.el.classList.remove('ask');
        this._scheduleRender();
      }, 3000);
      return;
    }
    b.armed = false;
    b.el.classList.remove('ask');

    this._fire(b.item);

    // The acknowledgement. Nothing in the state will confirm this for us.
    b.fired = true;
    b.el.classList.add('hot');
    this._later(() => {
      b.fired = false;
      this._scheduleRender();
    }, this._config.feedback_ms);
    this._scheduleRender();
  }

  _build() {
    if (this._built || !this._config) return;
    this._built = true;
    this.shadowRoot.innerHTML = `
      ${this._shell()}
        <div class="content"><div class="pad"></div></div>
      </div>
    `;
    this._card = this.shadowRoot.querySelector('.card');
    const pad = this.shadowRoot.querySelector('.pad');
    const items = this._items;
    pad.style.setProperty('--ns-cols', String(this._columns));
    pad.setAttribute('data-cols', String(this._columns));

    this._btns = items.map((item) => {
      const el = document.createElement('button');
      el.className = 'btn';
      el.innerHTML = '<ha-icon></ha-icon><div class="bl"></div>';
      const b = {
        item, el,
        icon: el.querySelector('ha-icon'),
        label: el.querySelector('.bl'),
        armed: false,
        fired: false,
      };
      el.addEventListener('click', () => this._press(b));
      // A long-press opens more-info on the entity behind the button, which is
      // where you go to find out why the scene did not do what you expected.
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (item.entity && this._config.more_info) moreInfo(this, item.entity);
      });
      pad.appendChild(el);
      return b;
    });
  }

  _render() {
    if (!this._btns) return;
    this._btns.forEach((b) => {
      const s = b.item.entity ? this._state(b.item.entity) : null;
      const running = !!s && s.state === 'on' && b.item.entity.indexOf('script.') === 0;
      // Not isBroken(): that counts `unknown` as broken, which is the normal
      // resting state of a scene or a button that has never been fired. Only a
      // missing or unavailable entity is actually a dead button.
      const broken = b.item.entity ? (!s || s.state === 'unavailable') : false;

      b.el.classList.toggle('hot', b.fired || running);
      if (broken) b.el.setAttribute('disabled', ''); else b.el.removeAttribute('disabled');

      const icon = broken ? 'mdi:alert-circle-outline'
        : (b.fired ? 'mdi:check' : this._icon(b.item));
      b.icon.setAttribute('icon', icon);
      if (!b.armed) b.label.textContent = this._label(b.item);
    });
  }
}

/* ================================================================== *
 * Status card - is the house alright?
 *
 * Quiet when everything is normal, loud when it is not. With only_problems
 * the usual state of this card is an empty one, which is the fastest thing
 * on the panel to read.
 * ================================================================== */

/* What counts as "not normal", by domain. Anything not listed here is never a
   problem unless the card config says so with problem_when. */
const PROBLEM_WHEN = {
  lock: ['unlocked', 'open', 'opening', 'jammed'],
  cover: ['open', 'opening'],
  binary_sensor: ['on'],
  input_boolean: ['on'],
  switch: ['on'],
  person: ['not_home'],
  device_tracker: ['not_home'],
};

class NsPanelStatusCard extends NsInfoCard {
  static get cardType() { return 'nspanel-status-card'; }
  static get requiresEntity() { return false; }
  static get accent() { return '#f0a03c'; }
  static get defaultOptions() {
    return { entities: [], only_problems: false, columns: 2, all_clear: 'All clear' };
  }

  /* 1, 2 or 3 across. More than 3 on a 480px panel is a list of things you
     cannot read, let alone hit. */
  get _columns() {
    return clamp(Math.round(this._config.columns) || 2, 1, 3);
  }

  static getStubConfig(hass) {
    const found = hass && hass.states
      ? Object.keys(hass.states).filter((e) => e.indexOf('binary_sensor.') === 0).slice(0, 4)
      : [];
    return { entities: found.length ? found : ['binary_sensor.example'], height: 200 };
  }

  setConfig(config) {
    super.setConfig(config);
    if (!this._items.length) {
      throw new Error(`${this.constructor.cardType}: "entities" needs at least one entity`);
    }
  }

  get _items() {
    const list = Array.isArray(this._config.entities) ? this._config.entities : [];
    return list
      .map((it) => (typeof it === 'string' ? { entity: it } : it))
      .filter((it) => it && it.entity);
  }

  _entityIds() { return this._items.map((i) => i.entity); }

  _isProblem(item, s) {
    if (!s) return true;                    // a missing entity is itself a problem
    if (s.state === 'unavailable' || s.state === 'unknown') return true;
    if (Array.isArray(item.problem_when)) return item.problem_when.indexOf(s.state) !== -1;
    const list = PROBLEM_WHEN[item.entity.split('.')[0]];
    return list ? list.indexOf(s.state) !== -1 : false;
  }

  _stateLabel(item, s) {
    if (!s) return 'Missing';
    if (s.state === 'unavailable') return 'Unavailable';
    if (s.state === 'unknown') return 'Unknown';
    if (item.entity.split('.')[0] === 'binary_sensor') {
      const c = deviceClass(s);
      const on = s.state === 'on';
      if (c === 'door' || c === 'window' || c === 'garage_door' || c === 'opening') {
        return on ? 'Open' : 'Closed';
      }
      if (c === 'motion' || c === 'occupancy') return on ? 'Detected' : 'Clear';
      if (c === 'moisture') return on ? 'Wet' : 'Dry';
      if (c === 'problem') return on ? 'Problem' : 'OK';
      return on ? 'On' : 'Off';
    }
    return s.state.charAt(0).toUpperCase() + s.state.slice(1).replace(/_/g, ' ');
  }

  _build() {
    if (this._built || !this._config) return;
    this._built = true;
    this.shadowRoot.innerHTML = `
      ${this._shell()}
        <div class="content">
          <div class="grid"></div>
          <div class="clear" hidden>
            <ha-icon icon="mdi:check-circle-outline"></ha-icon>
            <div></div>
          </div>
        </div>
      </div>
    `;
    this._card = this.shadowRoot.querySelector('.card');
    this._grid = this.shadowRoot.querySelector('.grid');
    this._grid.style.setProperty('--ns-cols', String(this._columns));
    this._grid.setAttribute('data-cols', String(this._columns));
    this._clear = this.shadowRoot.querySelector('.clear');
    this._clear.querySelector('div').textContent = this._config.all_clear;

    // Every tile is built once and hidden when not shown. Rebuilding the grid
    // on each state change would be the one expensive thing this card could do.
    this._tiles = this._items.map((item) => {
      const el = document.createElement('button');
      el.className = 'tile';
      el.innerHTML = '<ha-icon></ha-icon><div class="tt">' +
        '<div class="tn"></div><div class="ts"></div></div>';
      el.addEventListener('click', () => {
        if (this._config.more_info) moreInfo(this, item.entity);
      });
      this._grid.appendChild(el);
      return {
        item,
        el,
        icon: el.querySelector('ha-icon'),
        name: el.querySelector('.tn'),
        sub: el.querySelector('.ts'),
      };
    });
  }

  _render() {
    if (!this._tiles) return;
    let problems = 0;
    this._tiles.forEach((t) => {
      const s = this._state(t.item.entity);
      const bad = this._isProblem(t.item, s);
      if (bad) problems++;
      const hidden = this._config.only_problems && !bad;
      t.el.hidden = hidden;
      if (hidden) return;
      t.el.classList.toggle('alert', bad);
      t.icon.setAttribute('icon',
        t.item.icon || (s && s.attributes.icon) || classIcon(s, t.item.entity));
      t.name.textContent = t.item.name || friendly(s, t.item.entity);
      t.sub.textContent = this._stateLabel(t.item, s);
    });
    const showClear = this._config.only_problems && problems === 0;
    this._clear.hidden = !showClear;
    this._grid.hidden = showClear;
  }
}

/* ================================================================== *
 * Climate card - the setpoint under the same thumb as everything else
 *
 * A control card, so it is an NsBaseCard: drag sets the target temperature
 * across the thermostat's own min/max, and the long-press sheet carries the
 * HVAC modes. Tap opens more-info rather than toggling - switching a heating
 * system off by brushing past the panel is a bad afternoon.
 * ================================================================== */

const HVAC_ICONS = {
  off: 'mdi:power',
  heat: 'mdi:fire',
  cool: 'mdi:snowflake',
  heat_cool: 'mdi:sun-snowflake-variant',
  auto: 'mdi:thermostat-auto',
  dry: 'mdi:water-percent',
  fan_only: 'mdi:fan',
};

const HVAC_LABELS = {
  off: 'Off',
  heat: 'Heat',
  cool: 'Cool',
  heat_cool: 'Auto',
  auto: 'Auto',
  dry: 'Dry',
  fan_only: 'Fan',
};

class NsPanelClimateCard extends NsBaseCard {
  static get cardType() { return 'nspanel-climate-card'; }
  static get domain() { return 'climate'; }
  static get accent() { return '#ff8a65'; }
  /* step in degrees, not percent - the base default of 5 would be absurd here.
     more_info because this card's tap opens the dialog instead of toggling. */
  static get defaultOptions() {
    return { step: 0.5, more_info: true, min: null, max: null };
  }
  static get defaultPresets() {
    return [
      { name: 'Eco', temperature: 17 },
      { name: 'Day', temperature: 20.5 },
      { name: 'Warm', temperature: 22 },
    ];
  }

  static getStubConfig(hass) {
    const found = hass && hass.states
      ? Object.keys(hass.states).find((e) => e.indexOf('climate.') === 0)
      : null;
    return { entity: found || 'climate.example', height: 220 };
  }

  /* The thermostat's own limits unless the config narrows them, which is worth
     doing: 7-35 makes every drag a wild one. */
  _range() {
    const s = this._stateObj;
    const a = (s && s.attributes) || {};
    const min = typeof this._config.min === 'number' ? this._config.min
      : (typeof a.min_temp === 'number' ? a.min_temp : 7);
    const max = typeof this._config.max === 'number' ? this._config.max
      : (typeof a.max_temp === 'number' ? a.max_temp : 35);
    return { min, max: max > min ? max : min + 1 };
  }

  _target() {
    const s = this._stateObj;
    const a = (s && s.attributes) || {};
    if (typeof a.temperature === 'number') return a.temperature;
    // A heat_cool thermostat has no single target; the midpoint is the honest
    // thing to drag, and the sheet shows the real state text.
    if (typeof a.target_temp_low === 'number' && typeof a.target_temp_high === 'number') {
      return (a.target_temp_low + a.target_temp_high) / 2;
    }
    return this._range().min;
  }

  _entityValue() {
    const r = this._range();
    return clamp((this._target() - r.min) / (r.max - r.min), 0, 1);
  }

  /* Back from 0..1 to degrees, rounded to the configured step so the panel
     never sends 20.4999 to a thermostat that shows whole halves. */
  _degrees(v) {
    const r = this._range();
    const step = this._config.step || 0.5;
    const raw = r.min + v * (r.max - r.min);
    return clamp(Math.round(raw / step) * step, r.min, r.max);
  }

  _hvacModes() {
    const s = this._stateObj;
    const modes = (s && s.attributes && s.attributes.hvac_modes) || [];
    return modes.filter((m) => HVAC_LABELS[m]);
  }

  _build() {
    if (this._built || !this._config) return;
    this._built = true;
    const cfg = this._config;
    const tint = tintStops(this._accent());
    this.shadowRoot.innerHTML = `
      <style>${BASE_CSS}</style>
      <div class="card" style="--ns-height:${cfg.height}px;--ns-accent:${this._accent()};
        --ns-fill-strong:${tint.strong};--ns-fill-weak:${tint.weak}">
        <div class="fillwrap"><div class="fill"></div></div>
        <div class="badge" hidden>Offline</div>
        <div class="content">
          <div class="row">
            <div class="icon"><ha-icon></ha-icon></div>
            <div class="value">0<small>&deg;</small></div>
          </div>
          <div>
            <div class="name"></div>
            <div class="sub"></div>
            <div class="presets"></div>
          </div>
        </div>
      </div>
    `;
    this._card = this.shadowRoot.querySelector('.card');
    this._elIcon = this.shadowRoot.querySelector('.icon ha-icon');
    this._elValue = this.shadowRoot.querySelector('.value');
    this._elName = this.shadowRoot.querySelector('.name');
    this._elSub = this.shadowRoot.querySelector('.sub');
    this._elBadge = this.shadowRoot.querySelector('.badge');
    this._elPresets = this.shadowRoot.querySelector('.presets');

    if (cfg.show_presets && cfg.presets.length) {
      cfg.presets.slice(0, 4).forEach((p) => {
        const b = document.createElement('button');
        b.className = 'chip';
        b.textContent = p.name;
        b.addEventListener('click', (e) => { e.stopPropagation(); this._applyPreset(p); });
        this._elPresets.appendChild(b);
      });
    } else {
      this._elPresets.hidden = true;
    }

    this._bindGestures(this._card);
  }

  _applyPreset(p) {
    this._haptic('light');
    if (p.hvac_mode) this._call('climate', 'set_hvac_mode', { hvac_mode: p.hvac_mode });
    if (p.preset_mode) this._call('climate', 'set_preset_mode', { preset_mode: p.preset_mode });
    if (typeof p.temperature === 'number') {
      this._call('climate', 'set_temperature', { temperature: p.temperature });
      const r = this._range();
      this._local = clamp((p.temperature - r.min) / (r.max - r.min), 0, 1);
      this._localUntil = Date.now() + this._config.echo_ms;
      this._scheduleRender();
    }
  }

  _onTap() {
    if (this._config.more_info === false) return;
    moreInfo(this, this._config.entity);
  }

  _commit(v) {
    this._call('climate', 'set_temperature', { temperature: this._degrees(v) });
  }

  _openSheet() {
    const s = this._stateObj;
    const acts = this._hvacModes().map((m) => ({
      label: HVAC_LABELS[m],
      icon: HVAC_ICONS[m],
      primary: s && s.state === m,
      run: () => this._call('climate', 'set_hvac_mode', { hvac_mode: m }),
    })).slice(0, 4);

    sheet().open({
      title: this._title(),
      state: this._stateText(s),
      value: this._displayValue(),
      accent: this._accent(),
      step: (this._config.step / (this._range().max - this._range().min)) * 100,
      actions: acts,
      onInput: (v) => {
        this._local = v;
        this._localUntil = Date.now() + this._config.echo_ms;
        this._scheduleRender();
      },
      onCommit: (v) => this._commit(v),
    });
  }

  _stateText(s) {
    if (!s) return '';
    const a = s.attributes || {};
    const now = typeof a.current_temperature === 'number'
      ? `Now ${fmt(a.current_temperature, 1)}°` : '';
    const action = a.hvac_action
      ? a.hvac_action.charAt(0).toUpperCase() + a.hvac_action.slice(1)
      : (HVAC_LABELS[s.state] || s.state);
    return now ? `${now} · ${action}` : action;
  }

  _render() {
    if (!this._card) return;
    const cfg = this._config;
    const s = this._stateObj;
    const broken = isBroken(s);
    const off = !s || s.state === 'off';
    const v = this._displayValue();
    const target = this._degrees(v);

    this._card.classList.toggle('unavailable', broken);
    this._card.classList.toggle('on', !off && !broken);
    this._elBadge.hidden = !broken;

    this._card.style.setProperty('--ns-fill', String(broken ? 0 : v));
    this._card.style.setProperty('--ns-fill-opacity', off || broken ? '0' : '1');

    this._elIcon.setAttribute('icon', cfg.icon || (s && s.attributes.icon) ||
      HVAC_ICONS[s ? s.state : 'off'] || 'mdi:thermostat');
    this._elName.textContent = this._title();

    const stamp = `${target}|${off}|${broken}`;
    if (this._shown !== stamp) {
      this._shown = stamp;
      this._elValue.innerHTML = broken || off ? '' : `${fmt(target, 1)}<small>&deg;</small>`;
      this._elSub.textContent = broken ? 'Unavailable' : this._stateText(s);
    }
  }
}

/* ================================================================== *
 * Media card
 *
 * A control card, because the gesture that matters on a media player is
 * volume and that is exactly what NsBaseCard's drag does: drag anywhere for
 * volume, tap for play/pause, long-press for the sheet. Transport buttons sit
 * on the face with the same 56px hitboxes as the preset chips.
 *
 * Album art is the one thing in this bundle that decodes a bitmap, so it is
 * kept to a fixed 76px box and - this is the part that matters on a PX30 -
 * the src is only assigned when the URL actually changes. Assigning the same
 * src on every render makes the browser re-decode, and a render happens on
 * every volume tick.
 * ================================================================== */

/* media_player supported_features */
const MP_PAUSE = 1;
const MP_VOLUME_SET = 4;
const MP_PREV = 16;
const MP_NEXT = 32;
const MP_TURN_OFF = 256;
const MP_STOP = 4096;
const MP_PLAY = 16384;

const MEDIA_CSS = `
.art {
  width: 76px;
  height: 76px;
  border-radius: 14px;
  overflow: hidden;
  flex: none;
  background: rgba(255,255,255,.10);
}
.art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.chip ha-icon { --mdc-icon-size: 26px; }
.chip[disabled] { opacity: .35; }
/* The other cards let the fill tint show through their chips, because their
   fill sits below the row. Volume puts the boundary at an arbitrary height,
   and a translucent button cut in half by it reads as a rendering fault - so
   these are opaque. The second selector matches BASE_CSS's specificity for
   the off state and wins on order. */
.chip, .card:not(.on) .chip { background: var(--ns-surface-2); }
`;

class NsPanelMediaCard extends NsBaseCard {
  static get cardType() { return 'nspanel-media-card'; }
  static get domain() { return 'media_player'; }
  static get accent() { return '#a78bfa'; }
  static get defaultOptions() {
    return { show_art: true, show_transport: true, more_info: false };
  }

  static getStubConfig(hass) {
    const found = hass && hass.states
      ? Object.keys(hass.states).find((e) => e.indexOf('media_player.') === 0)
      : null;
    return { entity: found || 'media_player.example', height: 220 };
  }

  /* Favourites rather than levels: a preset takes `source`, or a
     media_content_id/type pair, or a volume. None by default - the transport
     row is what most panels want, and both rows need a 300px card. */
  static get defaultPresets() { return []; }

  _supports(bit) {
    const s = this._stateObj;
    const f = s && s.attributes ? (s.attributes.supported_features || 0) : 0;
    return (f & bit) !== 0;
  }

  _playing() {
    const s = this._stateObj;
    return !!s && s.state === 'playing';
  }

  _idle() {
    const s = this._stateObj;
    return !s || s.state === 'off' || s.state === 'idle' || s.state === 'standby';
  }

  _entityValue() {
    const s = this._stateObj;
    const v = s && s.attributes ? s.attributes.volume_level : null;
    return typeof v === 'number' ? clamp(v, 0, 1) : 0;
  }

  _commit(v) {
    // Without VOLUME_SET there is nothing to commit to; the drag still moves
    // the fill under the finger, it just does not go anywhere.
    if (!this._supports(MP_VOLUME_SET)) return;
    this._call('media_player', 'volume_set', { volume_level: Math.round(v * 100) / 100 });
  }

  _onTap() {
    if (this._config.more_info) { moreInfo(this, this._config.entity); return; }
    this._call('media_player', 'media_play_pause');
  }

  _applyPreset(p) {
    this._haptic('light');
    if (p.source) this._call('media_player', 'select_source', { source: p.source });
    if (p.media_content_id) {
      this._call('media_player', 'play_media', {
        media_content_id: p.media_content_id,
        media_content_type: p.media_content_type || 'music',
      });
    }
    if (typeof p.volume_pct === 'number') {
      const v = clamp(p.volume_pct / 100, 0, 1);
      this._call('media_player', 'volume_set', { volume_level: v });
      this._local = v;
      this._localUntil = Date.now() + this._config.echo_ms;
      this._scheduleRender();
    }
  }

  /* What the card says it is playing. media_title if there is one, otherwise
     the device, so the card never reads as blank. */
  _lines() {
    const s = this._stateObj;
    const a = (s && s.attributes) || {};
    const device = this._title();
    if (isBroken(s)) return { top: device, sub: 'Unavailable' };
    if (this._idle()) {
      return { top: device, sub: s && s.state === 'off' ? 'Off' : 'Nothing playing' };
    }
    const top = a.media_title || device;
    const sub = a.media_artist || a.media_series_title || a.media_channel ||
      a.media_album_name || (a.media_title ? device : (s.state === 'paused' ? 'Paused' : 'Playing'));
    return { top, sub: s.state === 'paused' ? `Paused · ${sub}` : sub };
  }

  _defaultIcon() {
    const s = this._stateObj;
    const cls = s && s.attributes ? s.attributes.device_class : null;
    if (cls === 'tv') return 'mdi:television';
    if (cls === 'receiver') return 'mdi:speaker';
    return 'mdi:music';
  }

  _build() {
    if (this._built || !this._config) return;
    this._built = true;
    const cfg = this._config;
    const tint = tintStops(this._accent());
    this.shadowRoot.innerHTML = `
      <style>${BASE_CSS}${MEDIA_CSS}</style>
      <div class="card" style="--ns-height:${cfg.height}px;--ns-accent:${this._accent()};
        --ns-fill-strong:${tint.strong};--ns-fill-weak:${tint.weak}">
        <div class="fillwrap"><div class="fill"></div></div>
        <div class="badge" hidden>Offline</div>
        <div class="content">
          <div class="row">
            <div class="art" hidden><img alt=""></div>
            <div class="icon"><ha-icon></ha-icon></div>
            <div class="value"></div>
          </div>
          <div>
            <div class="name"></div>
            <div class="sub"></div>
            <div class="presets transport" hidden></div>
            <div class="presets favourites" hidden></div>
          </div>
        </div>
      </div>
    `;
    this._card = this.shadowRoot.querySelector('.card');
    this._elArt = this.shadowRoot.querySelector('.art');
    this._elImg = this.shadowRoot.querySelector('.art img');
    this._elIconBox = this.shadowRoot.querySelector('.icon');
    this._elIcon = this.shadowRoot.querySelector('.icon ha-icon');
    this._elValue = this.shadowRoot.querySelector('.value');
    this._elName = this.shadowRoot.querySelector('.name');
    this._elSub = this.shadowRoot.querySelector('.sub');
    this._elBadge = this.shadowRoot.querySelector('.badge');
    this._elTransport = this.shadowRoot.querySelector('.transport');
    this._elFavourites = this.shadowRoot.querySelector('.favourites');

    if (cfg.show_transport) {
      this._elTransport.hidden = false;
      this._buttons = [
        { key: 'prev', icon: 'mdi:skip-previous', bit: MP_PREV,
          run: () => this._call('media_player', 'media_previous_track') },
        { key: 'play', icon: 'mdi:play', bit: MP_PLAY | MP_PAUSE,
          run: () => this._call('media_player', 'media_play_pause') },
        { key: 'next', icon: 'mdi:skip-next', bit: MP_NEXT,
          run: () => this._call('media_player', 'media_next_track') },
      ].map((b) => {
        const el = document.createElement('button');
        el.className = 'chip';
        el.innerHTML = `<ha-icon icon="${b.icon}"></ha-icon>`;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          if (el.hasAttribute('disabled')) return;
          this._haptic('light');
          b.run();
        });
        this._elTransport.appendChild(el);
        return { def: b, el, icon: el.querySelector('ha-icon') };
      });
    }

    if (cfg.show_presets && cfg.presets.length) {
      this._elFavourites.hidden = false;
      cfg.presets.slice(0, 4).forEach((p) => {
        const b = document.createElement('button');
        b.className = 'chip';
        b.textContent = p.name;
        b.addEventListener('click', (e) => { e.stopPropagation(); this._applyPreset(p); });
        this._elFavourites.appendChild(b);
      });
    }

    this._bindGestures(this._card);
  }

  _openSheet() {
    const s = this._stateObj;
    const acts = [];
    if (this._supports(MP_PREV)) {
      acts.push({ label: 'Previous', icon: 'mdi:skip-previous',
        close: false, run: () => this._call('media_player', 'media_previous_track') });
    }
    acts.push({
      label: this._playing() ? 'Pause' : 'Play',
      icon: this._playing() ? 'mdi:pause' : 'mdi:play',
      primary: true,
      close: false,
      run: () => this._call('media_player', 'media_play_pause'),
    });
    if (this._supports(MP_NEXT)) {
      acts.push({ label: 'Next', icon: 'mdi:skip-next',
        close: false, run: () => this._call('media_player', 'media_next_track') });
    }
    if (this._supports(MP_STOP)) {
      acts.push({ label: 'Stop', icon: 'mdi:stop',
        run: () => this._call('media_player', 'media_stop') });
    } else if (this._supports(MP_TURN_OFF)) {
      acts.push({ label: 'Off', icon: 'mdi:power',
        run: () => this._call('media_player', 'turn_off') });
    }

    const lines = this._lines();
    sheet().open({
      title: lines.top,
      state: lines.sub,
      value: this._displayValue(),
      accent: this._accent(),
      step: this._config.step,
      actions: acts.slice(0, 4),
      onInput: (v) => {
        this._local = v;
        this._localUntil = Date.now() + this._config.echo_ms;
        this._scheduleRender();
      },
      onCommit: (v) => this._commit(v),
    });
  }

  _render() {
    if (!this._card) return;
    const cfg = this._config;
    const s = this._stateObj;
    const broken = isBroken(s);
    const a = (s && s.attributes) || {};
    const idle = this._idle();
    const v = this._displayValue();
    const pct = Math.round(v * 100);

    this._card.classList.toggle('unavailable', broken);
    this._card.classList.toggle('on', !idle && !broken);
    this._elBadge.hidden = !broken;

    this._card.style.setProperty('--ns-fill', String(broken ? 0 : v));
    this._card.style.setProperty('--ns-fill-opacity', broken || idle ? '0' : '1');

    // Only touch src when the URL changes: same src reassigned is a re-decode,
    // and this runs on every volume frame.
    const art = cfg.show_art && !broken ? (a.entity_picture || null) : null;
    if (art !== this._artShown) {
      this._artShown = art;
      if (art) this._elImg.setAttribute('src', art);
      else this._elImg.removeAttribute('src');
      this._elArt.hidden = !art;
      this._elIconBox.hidden = !!art;
    }
    if (!art) {
      this._elIcon.setAttribute('icon', cfg.icon || a.icon || this._defaultIcon());
    }

    const lines = this._lines();
    const stamp = `${lines.top}|${lines.sub}|${pct}|${idle}|${broken}`;
    if (this._shown !== stamp) {
      this._shown = stamp;
      this._elValue.innerHTML = broken || idle || typeof a.volume_level !== 'number'
        ? '' : `${pct}<small>%</small>`;
      this._elName.textContent = lines.top;
      this._elSub.textContent = lines.sub;
    }

    if (this._buttons) {
      const playing = this._playing();
      this._buttons.forEach((b) => {
        const on = broken ? false : (b.def.bit === (MP_PLAY | MP_PAUSE)
          ? true : this._supports(b.def.bit));
        if (on) b.el.removeAttribute('disabled'); else b.el.setAttribute('disabled', '');
        if (b.def.key === 'play') {
          b.icon.setAttribute('icon', playing ? 'mdi:pause' : 'mdi:play');
        }
      });
    }
  }
}

/* ================================================================== *
 * Weather card
 *
 * Current conditions come off the entity. The forecast does not: since HA
 * 2024.4 it is a websocket subscription with a lifecycle of its own, so the
 * card subscribes once it has both a connection and a config, and drops the
 * subscription when it leaves the DOM. Panels get rebuilt on every page
 * swipe, and a leaked subscription per swipe would be a slow bleed.
 * ================================================================== */

const WEATHER_ICONS = {
  'clear-night': 'mdi:weather-night',
  cloudy: 'mdi:weather-cloudy',
  fog: 'mdi:weather-fog',
  hail: 'mdi:weather-hail',
  lightning: 'mdi:weather-lightning',
  'lightning-rainy': 'mdi:weather-lightning-rainy',
  partlycloudy: 'mdi:weather-partly-cloudy',
  pouring: 'mdi:weather-pouring',
  rainy: 'mdi:weather-rainy',
  snowy: 'mdi:weather-snowy',
  'snowy-rainy': 'mdi:weather-snowy-rainy',
  sunny: 'mdi:weather-sunny',
  windy: 'mdi:weather-windy',
  'windy-variant': 'mdi:weather-windy',
  exceptional: 'mdi:alert-circle-outline',
};

/* The HA condition slugs that do not survive a naive de-slugging. */
const CONDITION_LABELS = {
  partlycloudy: 'Partly cloudy',
  'clear-night': 'Clear',
  'lightning-rainy': 'Thunder, rain',
  'snowy-rainy': 'Sleet',
  'windy-variant': 'Windy',
  pouring: 'Heavy rain',
  exceptional: 'Severe',
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

class NsPanelWeatherCard extends NsInfoCard {
  static get cardType() { return 'nspanel-weather-card'; }
  static get accent() { return '#7cc4ff'; }
  static get defaultOptions() {
    return { show_forecast: true, forecast_type: 'daily', forecast_count: 4 };
  }

  static getStubConfig(hass) {
    const found = hass && hass.states
      ? Object.keys(hass.states).find((e) => e.indexOf('weather.') === 0)
      : null;
    return { entity: found || 'weather.home', height: 240 };
  }

  _teardown() {
    if (this._unsub) { this._unsub(); this._unsub = null; }
    this._wantSub = false;
    this._forecast = null;
  }

  _afterHass() {
    this._subscribeForecast();
  }

  connectedCallback() {
    super.connectedCallback();
    this._subscribeForecast();
  }

  _subscribeForecast() {
    const conn = this._hass && this._hass.connection;
    if (!conn || !this._config || !this._config.show_forecast) return;
    if (this._unsub || this._wantSub) return;             // already on, or in flight
    if (!conn.subscribeMessage) return;                   // very old frontend
    this._wantSub = true;
    conn.subscribeMessage(
      (msg) => {
        this._forecast = (msg && msg.forecast) || [];
        this._scheduleRender();
      },
      {
        type: 'weather/subscribe_forecast',
        forecast_type: this._config.forecast_type,
        entity_id: this._config.entity,
      }
    ).then((unsub) => {
      // The card can leave the DOM while the subscribe is still in flight.
      if (!this._wantSub) { unsub(); return; }
      this._unsub = unsub;
    }).catch(() => {
      // Older cores have no such command; the attribute fallback covers them.
      this._wantSub = false;
      this._scheduleRender();
    });
  }

  _forecastList() {
    const s = this._stateObj;
    const list = this._forecast ||
      (s && s.attributes && s.attributes.forecast) || [];
    return list.slice(0, clamp(this._config.forecast_count || 4, 1, 5));
  }

  _build() {
    if (this._built || !this._config) return;
    this._built = true;
    this.shadowRoot.innerHTML = `
      ${this._shell()}
        <div class="badge" hidden>Offline</div>
        <div class="content">
          <div class="row">
            <div class="icon"><ha-icon></ha-icon></div>
            <div class="big"></div>
          </div>
          <div>
            <div class="name"></div>
            <div class="sub"></div>
            <div class="fc"></div>
          </div>
        </div>
      </div>
    `;
    this._card = this.shadowRoot.querySelector('.card');
    this._elIcon = this.shadowRoot.querySelector('.icon ha-icon');
    this._elValue = this.shadowRoot.querySelector('.big');
    this._elName = this.shadowRoot.querySelector('.name');
    this._elSub = this.shadowRoot.querySelector('.sub');
    this._elBadge = this.shadowRoot.querySelector('.badge');
    this._elFc = this.shadowRoot.querySelector('.fc');
    this._bindMoreInfo(this._card);
  }

  _render() {
    if (!this._card) return;
    const cfg = this._config;
    const s = this._stateObj;
    const broken = isBroken(s);
    const a = (s && s.attributes) || {};

    this._card.classList.toggle('unavailable', broken);
    this._elBadge.hidden = !broken;

    this._elIcon.setAttribute('icon',
      cfg.icon || WEATHER_ICONS[s ? s.state : ''] || 'mdi:weather-cloudy');
    this._elName.textContent = this._title();

    const temp = typeof a.temperature === 'number' ? a.temperature : null;
    const unit = (a.temperature_unit || '°');
    this._elValue.innerHTML = temp === null ? '—' : `${fmt(temp, 0)}<small>${unit}</small>`;

    const bits = [];
    if (s && s.state) {
      bits.push(CONDITION_LABELS[s.state] ||
        s.state.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()));
    }
    if (typeof a.humidity === 'number') bits.push(`${fmt(a.humidity, 0)}%`);
    if (typeof a.wind_speed === 'number') {
      bits.push(`${fmt(a.wind_speed, 0)} ${a.wind_speed_unit || ''}`.trim());
    }
    this._elSub.textContent = broken ? 'Unavailable' : bits.join(' · ');

    this._renderForecast(unit);
  }

  /* The forecast rebuilds only when the data actually changes - it arrives on
     its own subscription, not with every hass update, but a repaint per state
     change would still be wasteful. */
  _renderForecast(unit) {
    const list = this._config.show_forecast ? this._forecastList() : [];
    const stamp = JSON.stringify(list.map((f) => [f.datetime, f.condition,
      f.temperature, f.templow]));
    if (stamp === this._fcShown) return;
    this._fcShown = stamp;

    this._elFc.hidden = !list.length;
    this._elFc.innerHTML = '';
    list.forEach((f) => {
      const d = document.createElement('div');
      d.className = 'd';
      const when = f.datetime ? new Date(f.datetime) : null;
      const label = when
        ? (this._config.forecast_type === 'hourly'
          ? String(when.getHours()).padStart(2, '0')
          : DAY_NAMES[when.getDay()])
        : '';
      const low = typeof f.templow === 'number' ? `<span>${fmt(f.templow, 0)}</span>` : '';
      d.innerHTML =
        `<div class="dd">${label}</div>` +
        `<ha-icon icon="${WEATHER_ICONS[f.condition] || 'mdi:weather-cloudy'}"></ha-icon>` +
        `<div class="dt">${fmt(f.temperature, 0)}${unit === '%' ? '' : ''}${low}</div>`;
      this._elFc.appendChild(d);
    });
  }
}

/* ================================================================== *
 * Clock card
 *
 * Panels idle far more than they are touched, and a wall panel showing the
 * time is doing something useful for free. One timer, aligned to the top of
 * the minute so the digits change when they should, writing textContent.
 * ================================================================== */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday',
  'Friday', 'Saturday'];

class NsPanelClockCard extends NsInfoCard {
  static get cardType() { return 'nspanel-clock-card'; }
  static get requiresEntity() { return false; }
  static get accent() { return '#7cc4ff'; }
  static get defaultOptions() {
    return { hour_24: true, show_date: true, show_seconds: false, entity: null };
  }

  static getStubConfig() { return { height: 200 }; }

  /* The optional entity is a line under the clock - a calendar's next event,
     an alarm, whatever the panel should say when nobody is touching it. */
  _entityIds() { return this._config.entity ? [this._config.entity] : []; }

  _build() {
    if (this._built || !this._config) return;
    this._built = true;
    this.shadowRoot.innerHTML = `
      ${this._shell()}
        <div class="content" style="justify-content:center">
          <div>
            <div class="clock-t"></div>
            <div class="clock-d"></div>
            <div class="sub" style="margin-top:8px"></div>
          </div>
        </div>
      </div>
    `;
    this._card = this.shadowRoot.querySelector('.card');
    this._elTime = this.shadowRoot.querySelector('.clock-t');
    this._elDate = this.shadowRoot.querySelector('.clock-d');
    this._elSub = this.shadowRoot.querySelector('.sub');
    if (this._config.entity) this._bindMoreInfo(this._card);
    this._startTimer();
  }

  connectedCallback() {
    super.connectedCallback();
    this._startTimer();
  }

  _teardown() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  /* Re-armed each tick against the wall clock rather than set on an interval,
     so it cannot drift and cannot fire twice in a second after a resume. */
  _startTimer() {
    this._teardown();
    // connectedCallback can land before setConfig - HA is free to attach the
    // element first - and a tick without a config throws inside a custom
    // element reaction, where nothing catches it. setConfig starts the timer.
    if (!this.isConnected || !this._config) return;
    const tick = () => {
      this._scheduleRender();
      const now = Date.now();
      const period = this._config.show_seconds ? 1000 : 60000;
      this._timer = setTimeout(tick, period - (now % period) + 20);
    };
    tick();
  }

  _render() {
    if (!this._elTime) return;
    const cfg = this._config;
    const now = new Date();
    let h = now.getHours();
    let suffix = '';
    if (!cfg.hour_24) {
      suffix = h < 12 ? 'am' : 'pm';
      h = h % 12 || 12;
    }
    const hh = cfg.hour_24 ? String(h).padStart(2, '0') : String(h);
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = cfg.show_seconds ? ':' + String(now.getSeconds()).padStart(2, '0') : '';
    this._elTime.innerHTML = `${hh}:${mm}${ss}` + (suffix ? `<small>${suffix}</small>` : '');

    this._elDate.hidden = !cfg.show_date;
    if (cfg.show_date) {
      this._elDate.textContent =
        `${DAYS_LONG[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`;
    }

    const s = cfg.entity ? this._state(cfg.entity) : null;
    const line = s
      ? (this._config.title ? `${this._config.title}: ` : '') +
        (s.attributes && s.attributes.message ? s.attributes.message : s.state)
      : '';
    this._elSub.textContent = line;
    this._elSub.hidden = !line;
  }
}

/* ================================================================== *
 * Probe - what is this panel actually running?
 *
 * Drop it on a dashboard once, read the numbers off the glass, delete it.
 * ================================================================== */

class NsPanelProbeCard extends HTMLElement {
  static getStubConfig() { return {}; }
  setConfig(c) { this._config = c || {}; this._render(); }
  set hass(h) { this._hass = h; }
  getCardSize() { return 8; }

  connectedCallback() { this._render(); }

  _render() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    if (this._done) return;
    this._done = true;

    const ua = navigator.userAgent;
    const chrome = (/Chrome\/(\d+)/.exec(ua) || [])[1] || '?';
    const wv = /; wv\)/.test(ua) ? 'WebView' : 'Browser';
    const supports = (prop, val) => {
      try { return CSS.supports(prop, val); } catch (e) { return false; }
    };

    const rows = [
      ['viewport', `${window.innerWidth} x ${window.innerHeight} CSS px`],
      ['devicePixelRatio', String(window.devicePixelRatio)],
      ['physical', `${Math.round(window.innerWidth * window.devicePixelRatio)} x ` +
        `${Math.round(window.innerHeight * window.devicePixelRatio)} device px`],
      ['chromium', `${chrome} (${wv})`],
      ['touch points', String(navigator.maxTouchPoints)],
      ['cores', String(navigator.hardwareConcurrency || '?')],
      ['memory', navigator.deviceMemory ? `${navigator.deviceMemory} GB` : 'not reported'],
      ['PointerEvent', String(typeof window.PointerEvent === 'function')],
      ['ResizeObserver', String(typeof window.ResizeObserver === 'function')],
      ['flex gap', String(supports('gap', '1px'))],
      ['aspect-ratio', String(supports('aspect-ratio', '1/1'))],
      ['dvh units', String(supports('height', '1dvh'))],
      ['color-mix()', String(supports('color', 'color-mix(in srgb, red, blue)'))],
      [':has()', String(supports('selector(:has(a))', '') || (() => {
        try { document.querySelector(':has(*)'); return true; } catch (e) { return false; }
      })())],
      ['backdrop-filter', String(supports('backdrop-filter', 'blur(2px)'))],
      ['WebGL', String((() => {
        try {
          const c = document.createElement('canvas');
          return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
        } catch (e) { return false; }
      })())],
    ];

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .p {
          background: #16191f;
          color: #f2f4f7;
          border-radius: 22px;
          padding: 16px 18px;
          font-family: "Roboto Mono", ui-monospace, monospace;
          font-size: 13px;
          line-height: 1.7;
        }
        h3 { margin: 0 0 10px; font-size: 15px; letter-spacing: .1em;
             text-transform: uppercase; color: #98a1b0; font-weight: 700; }
        .r { display: flex; justify-content: space-between; gap: 12px;
             border-bottom: 1px solid rgba(255,255,255,.06); padding: 3px 0; }
        .k { color: #98a1b0; }
        .v { text-align: right; word-break: break-word; }
        .v.no { color: #f87171; }
        .v.yes { color: #6ee7b7; }
        .fps { color: #ffb74a; }
        .ua { margin-top: 10px; color: #6b7482; font-size: 11px; word-break: break-all; }
      </style>
      <div class="p">
        <h3>Panel probe · v${NSPANEL_VERSION}</h3>
        ${rows.map(([k, v]) => {
          const cls = v === 'true' ? ' yes' : v === 'false' ? ' no' : '';
          return `<div class="r"><span class="k">${k}</span><span class="v${cls}">${v}</span></div>`;
        }).join('')}
        <div class="r"><span class="k">paint fps</span><span class="v fps" id="fps">measuring…</span></div>
        <div class="ua">${ua}</div>
      </div>
    `;

    // a short animation-frame sample, then stop - never leave a wall panel busy
    const el = this.shadowRoot.getElementById('fps');
    let frames = 0;
    const t0 = performance.now();
    const tick = () => {
      frames++;
      const dt = performance.now() - t0;
      if (dt < 2000) { requestAnimationFrame(tick); return; }
      el.textContent = `${Math.round((frames / dt) * 1000)} fps (idle)`;
    };
    requestAnimationFrame(tick);
  }
}


/* ================================================================== *
 * Visual editor
 *
 * HA calls Card.getConfigElement() to build the GUI editor behind the
 * dashboard's pencil. The form is driven by ha-form, the frontend's own
 * schema-rendered form, so the controls are the ones HA users already know
 * (entity picker, icon picker, switches) and this file still ships no
 * dependencies of its own.
 *
 * KEEP IN SYNC: every option in NsBaseCard.setConfig's defaults literal and in
 * the README's shared-options table needs a row in SHARED_SCHEMA below, or the
 * GUI will silently drop it. The three lists are one list in three places.
 *
 * `presets` is deliberately absent - it is a list of objects, which ha-form has
 * no control for. The editor says so and leaves that key untouched, so
 * switching to the GUI never destroys presets written in YAML.
 * ================================================================== */

const EDITOR_LABELS = {
  entity: 'Entity',
  title: 'Title',
  icon: 'Icon',
  height: 'Height (px)',
  accent: 'Accent colour (hex)',
  show_presets: 'Show presets',
  live: 'Update while dragging',
  echo_ms: 'Ignore state echo (ms)',
  drag_travel: 'Drag travel (px, 0 = card height)',
  swipe_safe: 'Let sideways drags change page',
  long_press: 'Long press',
  long_press_ms: 'Long press (ms)',
  step: 'Step for the +/- buttons',
  haptics: 'Haptics',
  more_info: 'Tap opens more-info',
  follow_color: 'Use the light\'s own colour',
  secondary: 'Second entity (shown underneath)',
  unit: 'Unit (blank = the entity\'s own)',
  decimals: 'Decimals',
  min: 'Range minimum',
  max: 'Range maximum',
  bar: 'Show the level as a bar',
  show_icons: 'Show icons',
  only_problems: 'Only show what is wrong',
  columns: 'Columns',
  all_clear: 'All-clear text',
  show_forecast: 'Show forecast',
  forecast_type: 'Forecast',
  forecast_count: 'Forecast entries',
  hour_24: '24-hour clock',
  show_date: 'Show the date',
  show_seconds: 'Show seconds',
  show_art: 'Show album art',
  show_transport: 'Show transport buttons',
  confirm: 'Ask for a second tap',
  confirm_text: 'Text while waiting for it',
  feedback_ms: 'Hold the tick for (ms)',
  haptics: 'Haptics',
};

/* The options every card takes. The entity row is prepended per card, because
   its picker is filtered to that card's domain. */
const SHARED_SCHEMA = [
  { name: 'title', selector: { text: {} } },
  {
    name: '', type: 'grid', schema: [
      { name: 'icon', selector: { icon: {} } },
      { name: 'height', selector: { number: { min: 60, max: 480, step: 2, mode: 'box' } } },
    ],
  },
  { name: 'accent', selector: { text: {} } },
  {
    name: '', type: 'grid', schema: [
      { name: 'show_presets', selector: { boolean: {} } },
      { name: 'haptics', selector: { boolean: {} } },
      { name: 'live', selector: { boolean: {} } },
      { name: 'swipe_safe', selector: { boolean: {} } },
    ],
  },
  {
    name: '', type: 'grid', schema: [
      {
        name: 'long_press',
        selector: { select: { mode: 'dropdown', options: [
          { value: 'sheet', label: 'Full-screen control' },
          { value: 'none', label: 'Nothing' },
        ] } },
      },
      { name: 'long_press_ms', selector: { number: { min: 200, max: 2000, step: 50, mode: 'box' } } },
      { name: 'step', selector: { number: { min: 1, max: 50, step: 1, mode: 'box' } } },
      { name: 'echo_ms', selector: { number: { min: 0, max: 10000, step: 100, mode: 'box' } } },
      { name: 'drag_travel', selector: { number: { min: 0, max: 1000, step: 10, mode: 'box' } } },
    ],
  },
];

class NsBaseCardEditor extends HTMLElement {
  static get rows() { return SHARED_SCHEMA; }
  static get hasEntityRow() { return true; }
  static get entityRequired() { return true; }
  static get domain() { return null; }
  static get note() {
    return 'Presets are a list, which this form cannot draw. Edit them in YAML - ' +
      'the GUI leaves them alone.';
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        .note {
          color: var(--secondary-text-color, #8a8a8a);
          font-size: 12px;
          line-height: 1.45;
          padding: 12px 4px 0;
        }
        code { font-size: 12px; }
      </style>
      <ha-form></ha-form>
      <div class="note"></div>
    `;
    this.shadowRoot.querySelector('.note').textContent = this.constructor.note;
    this._form = this.shadowRoot.querySelector('ha-form');
    this._form.computeLabel = (schema) => EDITOR_LABELS[schema.name] || schema.name;
    this._form.addEventListener('value-changed', (e) => this._valueChanged(e));
  }

  setConfig(config) {
    this._config = config || {};
    this._push();
  }

  set hass(hass) {
    this._hass = hass;
    this._form.hass = hass;
  }

  /* rows = the card's own options; the entity row is prepended here because
     only the editor knows whether the picker should be filtered to a domain,
     optional (the clock), or absent entirely (the list cards). */
  get _schema() {
    const c = this.constructor;
    if (!c.hasEntityRow) return c.rows;
    const selector = c.domain ? { entity: { domain: c.domain } } : { entity: {} };
    return [{ name: 'entity', required: c.entityRequired, selector }].concat(c.rows);
  }

  /* `name` was the old spelling of `title`. Show it in the title box so the
     value is not invisible in the GUI; writing back stores `title`. */
  _push() {
    const c = this._config;
    this._form.schema = this._schema;
    this._form.data = Object.assign({}, c, {
      title: c.title || c.name || '',
    });
  }

  _valueChanged(e) {
    e.stopPropagation();
    const value = e.detail.value || {};
    // Start from the old config so keys the form does not own - presets above
    // all - survive a trip through the GUI.
    const config = Object.assign({}, this._config, value);
    delete config.name;                       // migrated into title by _push
    Object.keys(config).forEach((k) => {
      if (config[k] === '' || config[k] === undefined || config[k] === null) delete config[k];
    });
    config.type = this._config.type || ('custom:' + this.constructor.cardType);
    this._config = config;
    // Feed the new config straight back into the form. HA normally re-calls
    // setConfig after a config-changed, but not reliably enough to lean on: if
    // the form keeps its first snapshot, the next edit ships that stale copy
    // and silently reverts the field edited before it.
    this._push();
    fireEvent(this, 'config-changed', { config });
  }
}

class NsPanelLightCardEditor extends NsBaseCardEditor {
  static get cardType() { return 'nspanel-light-card'; }
  static get domain() { return 'light'; }
  static get rows() { return LIGHT_SCHEMA; }
}

class NsPanelCoverCardEditor extends NsBaseCardEditor {
  static get cardType() { return 'nspanel-cover-card'; }
  static get domain() { return 'cover'; }
}


/* The read-only cards share these four; everything else is per card. */
const INFO_SCHEMA = [
  { name: 'title', selector: { text: {} } },
  {
    name: '', type: 'grid', schema: [
      { name: 'icon', selector: { icon: {} } },
      { name: 'height', selector: { number: { min: 60, max: 480, step: 2, mode: 'box' } } },
    ],
  },
  { name: 'accent', selector: { text: {} } },
  { name: 'more_info', selector: { boolean: {} } },
];

const SENSOR_SCHEMA = INFO_SCHEMA.concat([
  { name: 'secondary', selector: { entity: {} } },
  {
    name: '', type: 'grid', schema: [
      { name: 'unit', selector: { text: {} } },
      { name: 'decimals', selector: { number: { min: 0, max: 4, step: 1, mode: 'box' } } },
      { name: 'min', selector: { number: { mode: 'box' } } },
      { name: 'max', selector: { number: { mode: 'box' } } },
    ],
  },
  { name: 'bar', selector: { boolean: {} } },
]);

const SENSORS_SCHEMA = INFO_SCHEMA.concat([
  { name: 'show_icons', selector: { boolean: {} } },
]);

const STATUS_SCHEMA = INFO_SCHEMA.concat([
  {
    name: '', type: 'grid', schema: [
      { name: 'only_problems', selector: { boolean: {} } },
      { name: 'columns', selector: { number: { min: 1, max: 3, step: 1, mode: 'box' } } },
    ],
  },
  { name: 'all_clear', selector: { text: {} } },
]);

const WEATHER_SCHEMA = INFO_SCHEMA.concat([
  { name: 'show_forecast', selector: { boolean: {} } },
  {
    name: '', type: 'grid', schema: [
      {
        name: 'forecast_type',
        selector: { select: { mode: 'dropdown', options: [
          { value: 'daily', label: 'Daily' },
          { value: 'hourly', label: 'Hourly' },
        ] } },
      },
      { name: 'forecast_count', selector: { number: { min: 1, max: 5, step: 1, mode: 'box' } } },
    ],
  },
]);

const CLOCK_SCHEMA = [
  { name: 'title', selector: { text: {} } },
  {
    name: '', type: 'grid', schema: [
      { name: 'icon', selector: { icon: {} } },
      { name: 'height', selector: { number: { min: 60, max: 480, step: 2, mode: 'box' } } },
    ],
  },
  { name: 'accent', selector: { text: {} } },
  {
    name: '', type: 'grid', schema: [
      { name: 'hour_24', selector: { boolean: {} } },
      { name: 'show_date', selector: { boolean: {} } },
      { name: 'show_seconds', selector: { boolean: {} } },
      { name: 'more_info', selector: { boolean: {} } },
    ],
  },
];

/* The climate card is a control card, so it takes the control options plus a
   range of its own. */
const CLIMATE_SCHEMA = SHARED_SCHEMA.concat([
  {
    name: '', type: 'grid', schema: [
      { name: 'min', selector: { number: { min: 4, max: 35, step: 0.5, mode: 'box' } } },
      { name: 'max', selector: { number: { min: 4, max: 35, step: 0.5, mode: 'box' } } },
    ],
  },
  { name: 'more_info', selector: { boolean: {} } },
]);

/* The light card is the only one whose accent can come from the entity. */
const LIGHT_SCHEMA = SHARED_SCHEMA.concat([
  { name: 'follow_color', selector: { boolean: {} } },
]);

/* The media card is a control card, minus the options that make no sense for
   one: there are no levels to preset by dragging, and no ± step worth a row. */
const MEDIA_SCHEMA = SHARED_SCHEMA.concat([
  {
    name: '', type: 'grid', schema: [
      { name: 'show_art', selector: { boolean: {} } },
      { name: 'show_transport', selector: { boolean: {} } },
      { name: 'more_info', selector: { boolean: {} } },
    ],
  },
]);

/* The button card's entity row is the one-button shorthand; a list of buttons
   is YAML, like every other list here. */
const BUTTON_SCHEMA = [
  { name: 'title', selector: { text: {} } },
  {
    name: '', type: 'grid', schema: [
      { name: 'icon', selector: { icon: {} } },
      { name: 'height', selector: { number: { min: 60, max: 480, step: 2, mode: 'box' } } },
    ],
  },
  { name: 'accent', selector: { text: {} } },
  {
    name: '', type: 'grid', schema: [
      { name: 'columns', selector: { number: { min: 1, max: 3, step: 1, mode: 'box' } } },
      { name: 'feedback_ms', selector: { number: { min: 0, max: 5000, step: 100, mode: 'box' } } },
      { name: 'confirm', selector: { boolean: {} } },
      { name: 'haptics', selector: { boolean: {} } },
      { name: 'more_info', selector: { boolean: {} } },
    ],
  },
  { name: 'confirm_text', selector: { text: {} } },
];

const LIST_NOTE = 'Entities are a list, which this form cannot draw. Edit them in ' +
  'YAML - the GUI leaves them alone.';

class NsPanelClimateCardEditor extends NsBaseCardEditor {
  static get cardType() { return 'nspanel-climate-card'; }
  static get domain() { return 'climate'; }
  static get rows() { return CLIMATE_SCHEMA; }
}

class NsPanelMediaCardEditor extends NsBaseCardEditor {
  static get cardType() { return 'nspanel-media-card'; }
  static get domain() { return 'media_player'; }
  static get rows() { return MEDIA_SCHEMA; }
  static get note() {
    return 'Presets on this card are favourites - a source, or a media id to play. ' +
      'They are a list, so edit them in YAML; the GUI leaves them alone.';
  }
}

class NsPanelButtonCardEditor extends NsBaseCardEditor {
  static get cardType() { return 'nspanel-button-card'; }
  static get entityRequired() { return false; }
  static get rows() { return BUTTON_SCHEMA; }
  static get note() {
    return 'One entity here is the single-button shorthand. For several buttons use ' +
      'a `buttons:` list in YAML - the GUI leaves it alone.';
  }
}

class NsPanelSensorCardEditor extends NsBaseCardEditor {
  static get cardType() { return 'nspanel-sensor-card'; }
  static get rows() { return SENSOR_SCHEMA; }
  static get note() {
    return 'Severity colours are a list, which this form cannot draw. Edit them ' +
      'in YAML - the GUI leaves them alone.';
  }
}

class NsPanelSensorsCardEditor extends NsBaseCardEditor {
  static get cardType() { return 'nspanel-sensors-card'; }
  static get hasEntityRow() { return false; }
  static get rows() { return SENSORS_SCHEMA; }
  static get note() { return LIST_NOTE; }
}

class NsPanelStatusCardEditor extends NsBaseCardEditor {
  static get cardType() { return 'nspanel-status-card'; }
  static get hasEntityRow() { return false; }
  static get rows() { return STATUS_SCHEMA; }
  static get note() { return LIST_NOTE; }
}

class NsPanelWeatherCardEditor extends NsBaseCardEditor {
  static get cardType() { return 'nspanel-weather-card'; }
  static get domain() { return 'weather'; }
  static get rows() { return WEATHER_SCHEMA; }
  static get note() {
    return 'The forecast comes from Home Assistant on its own subscription; ' +
      'turn it off above if the entity has none.';
  }
}

class NsPanelClockCardEditor extends NsBaseCardEditor {
  static get cardType() { return 'nspanel-clock-card'; }
  static get entityRequired() { return false; }
  static get rows() { return CLOCK_SCHEMA; }
  static get note() {
    return 'The entity is optional: pick a calendar or sensor to print a line ' +
      'under the clock, or leave it empty for just the time.';
  }
}

/* ================================================================== *
 * Screensaver config card
 *
 * Not a card: a place in the dashboard to configure the native app's
 * screensaver (after, image_url, clock, proximity wake - see the app's
 * README). The app reads it out of the Lovelace config and drops it from
 * the pages. In a browser it renders nothing at all; it exists here so
 * Lovelace does not show "custom element doesn't exist" where it sits.
 * ================================================================== */

class NsPanelScreensaverCard extends HTMLElement {
  static getStubConfig() { return { after: 300 }; }
  setConfig(c) { this._config = c || {}; }
  set hass(h) { this._hass = h; }
  getCardSize() { return 0; }
  getLayoutOptions() { return { grid_rows: 0, grid_columns: 'full' }; }
  connectedCallback() { this.style.display = 'none'; }
}

/* ================================================================== *
 * registration
 * ================================================================== */

customElements.define('nspanel-light-card', NsPanelLightCard);
customElements.define('nspanel-cover-card', NsPanelCoverCard);
customElements.define('nspanel-probe-card', NsPanelProbeCard);
customElements.define('nspanel-climate-card', NsPanelClimateCard);
customElements.define('nspanel-media-card', NsPanelMediaCard);
customElements.define('nspanel-button-card', NsPanelButtonCard);
customElements.define('nspanel-sensor-card', NsPanelSensorCard);
customElements.define('nspanel-sensors-card', NsPanelSensorsCard);
customElements.define('nspanel-status-card', NsPanelStatusCard);
customElements.define('nspanel-weather-card', NsPanelWeatherCard);
customElements.define('nspanel-clock-card', NsPanelClockCard);
customElements.define('nspanel-screensaver', NsPanelScreensaverCard);

customElements.define('nspanel-light-card-editor', NsPanelLightCardEditor);
customElements.define('nspanel-cover-card-editor', NsPanelCoverCardEditor);
customElements.define('nspanel-climate-card-editor', NsPanelClimateCardEditor);
customElements.define('nspanel-media-card-editor', NsPanelMediaCardEditor);
customElements.define('nspanel-button-card-editor', NsPanelButtonCardEditor);
customElements.define('nspanel-sensor-card-editor', NsPanelSensorCardEditor);
customElements.define('nspanel-sensors-card-editor', NsPanelSensorsCardEditor);
customElements.define('nspanel-status-card-editor', NsPanelStatusCardEditor);
customElements.define('nspanel-weather-card-editor', NsPanelWeatherCardEditor);
customElements.define('nspanel-clock-card-editor', NsPanelClockCardEditor);

window.customCards = window.customCards || [];
window.customCards.push(
  {
    type: 'nspanel-light-card',
    name: 'NSPanel Light',
    description: 'Big-touch light control for the NSPanel Pro 86. Drag to dim, long-press for more.',
    preview: true,
  },
  {
    type: 'nspanel-cover-card',
    name: 'NSPanel Cover',
    description: 'Big-touch blind and cover control for the NSPanel Pro 86.',
    preview: true,
  },
  {
    type: 'nspanel-climate-card',
    name: 'NSPanel Climate',
    description: 'Thermostat for the NSPanel Pro 86. Drag to set the target, long-press for modes.',
    preview: true,
  },
  {
    type: 'nspanel-media-card',
    name: 'NSPanel Media',
    description: 'Media player for the NSPanel Pro 86. Drag for volume, tap to play or pause.',
    preview: true,
  },
  {
    type: 'nspanel-button-card',
    name: 'NSPanel Button',
    description: 'Scenes, scripts and automations. Big targets, and it tells you the tap landed.',
    preview: true,
  },
  {
    type: 'nspanel-sensor-card',
    name: 'NSPanel Sensor',
    description: 'One reading, large enough to read from across the room.',
    preview: true,
  },
  {
    type: 'nspanel-sensors-card',
    name: 'NSPanel Sensors',
    description: 'Two to four readings side by side, for a panel page that has to earn its space.',
    preview: true,
  },
  {
    type: 'nspanel-status-card',
    name: 'NSPanel Status',
    description: 'Doors, windows, locks: quiet when all is well, loud when it is not.',
    preview: true,
  },
  {
    type: 'nspanel-weather-card',
    name: 'NSPanel Weather',
    description: 'Current conditions and a short forecast, sized for the panel.',
    preview: true,
  },
  {
    type: 'nspanel-clock-card',
    name: 'NSPanel Clock',
    description: 'Time, date and an optional line from any entity. For the page a panel idles on.',
    preview: true,
  },
  {
    type: 'nspanel-screensaver',
    name: 'NSPanel Screensaver',
    description: 'Configures the native NSPanel app\'s screensaver. Renders nothing in a browser.',
    preview: false,
  },
  {
    type: 'nspanel-probe-card',
    name: 'NSPanel Probe',
    description: 'Diagnostics: viewport, WebView version and CSS feature support, read off the panel.',
    preview: true,
  }
);

window.NsPanelCards = {
  version: NSPANEL_VERSION,
  /* Set to an element to mount the full-screen sheet inside it instead of on
     document.body. Used by the preview bench to keep the sheet inside the
     simulated panel; also handy inside a kiosk shell. */
  sheetHost: null,
  NsPanelLightCard,
  NsPanelCoverCard,
  NsPanelProbeCard,
  NsPanelClimateCard,
  NsPanelMediaCard,
  NsPanelButtonCard,
  NsPanelSensorCard,
  NsPanelSensorsCard,
  NsPanelStatusCard,
  NsPanelWeatherCard,
  NsPanelClockCard,
  NsInfoCard,
  NsPanelLightCardEditor,
  NsPanelCoverCardEditor,
  NsPanelClimateCardEditor,
  NsPanelMediaCardEditor,
  NsPanelButtonCardEditor,
  NsPanelSensorCardEditor,
  NsPanelSensorsCardEditor,
  NsPanelStatusCardEditor,
  NsPanelWeatherCardEditor,
  NsPanelClockCardEditor,
  NsSheet,
};
