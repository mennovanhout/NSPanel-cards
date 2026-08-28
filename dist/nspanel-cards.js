/*!
 * nspanel-cards - Lovelace cards built for the Sonoff NSPanel Pro 86 (480x480)
 *
 * Cards in this bundle:
 *   custom:nspanel-light-card    brightness, drag anywhere, long-press for more
 *   custom:nspanel-cover-card    position, drag anywhere, long-press for more
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

const NSPANEL_VERSION = '0.1.0';

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
      name: null,
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
      tap_action: 'toggle',
      long_press: 'sheet',
    }, config);
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

  static getStubConfig(hass) {
    const found = hass && hass.states
      ? Object.keys(hass.states).find((e) => e.indexOf('light.') === 0)
      : null;
    return { entity: found || 'light.example', height: 200 };
  }

  setConfig(config) {
    super.setConfig(config);
    this._config.presets = Array.isArray(config.presets) ? config.presets : [
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
      title: this._config.name || friendly(s, this._config.entity),
      state: isOn(s) ? 'On' : 'Off',
      value: this._displayValue(),
      accent: this._accent(),
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

    this._elIcon.setAttribute('icon',
      cfg.icon || (s && s.attributes.icon) || (on ? 'mdi:lightbulb-on' : 'mdi:lightbulb-outline'));
    this._elName.textContent = cfg.name || friendly(s, cfg.entity);

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

  setConfig(config) {
    super.setConfig(config);
    this._config.show_presets = config.show_presets !== false;
    this._config.presets = Array.isArray(config.presets) ? config.presets : [
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
      title: this._config.name || friendly(s, this._config.entity),
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
    this._elName.textContent = cfg.name || friendly(s, cfg.entity);

    if (this._valueShown !== pct || this._movingShown !== moving) {
      this._valueShown = pct;
      this._movingShown = moving;
      this._elValue.innerHTML = broken ? '&mdash;' : `${pct}<small>%</small>`;
      this._elSub.textContent = broken ? 'Unavailable' : this._stateText(s, pct);
    }
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
 * registration
 * ================================================================== */

customElements.define('nspanel-light-card', NsPanelLightCard);
customElements.define('nspanel-cover-card', NsPanelCoverCard);
customElements.define('nspanel-probe-card', NsPanelProbeCard);

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
  NsSheet,
};
