/* ==================================================================== *
 * A standalone panel page: the cards, a websocket to Home Assistant,
 * and nothing else.
 *
 * The point of this file is that the HA frontend is not in it. The cards
 * only ever touch two things - hass.states and hass.callService (plus
 * hass.connection.subscribeMessage, for the weather forecast) - so the
 * whole of Lovelace, Lit, the entity registry and the theme system can be
 * left out. If the panel is smooth here and laggy in the companion app,
 * the frontend was the cost, not the cards.
 *
 * Serve it from HA: copy dist/ and kiosk/ into /config/www/nspanel/ and
 * open /local/nspanel/kiosk/index.html on the panel.
 * ==================================================================== */

const CFG = window.NSPANEL_CONFIG || null;
const STATS = /[?&]stats=1/.test(location.search);
const STORE = 'nspanel-kiosk';

const pagerEl = document.getElementById('pager');
const dotsEl = document.getElementById('dots');
const connEl = document.getElementById('conn');

/* ---- stored credentials ------------------------------------------- *
 * The token lives in this panel's localStorage and nowhere else. Do not
 * put it in config.js: /local/ is served without authentication, so a
 * token in a file there is readable by anything on the network. */
function saved() {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) { return {}; }
}
function save(v) {
  try { localStorage.setItem(STORE, JSON.stringify(v)); } catch (e) { /* private mode */ }
}

function wsUrl(base) {
  const raw = base || (CFG && CFG.url) || location.origin;
  const u = new URL(raw, location.href);
  return (u.protocol === 'https:' ? 'wss://' : 'ws://') + u.host + '/api/websocket';
}

/* ==================================================================== *
 * Home Assistant websocket
 * ==================================================================== */

class HaSocket {
  constructor(url, token, onState, onStatus) {
    this._url = url;
    this._token = token;
    this._onState = onState;
    this._onStatus = onStatus;
    this._id = 1;
    this._pending = new Map();     // id -> {resolve, reject}
    this._subs = new Map();        // id -> callback for event messages
    this._backoff = 1000;
    this._closed = false;
    this.connect();
  }

  connect() {
    this._onStatus('connecting');
    let ws;
    try { ws = new WebSocket(this._url); } catch (e) { this._retry(); return; }
    this._ws = ws;

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      this._handle(msg);
    };
    ws.onclose = () => { if (!this._closed) this._retry(); };
    ws.onerror = () => { /* onclose follows */ };
  }

  _retry() {
    this._onStatus('offline');
    this._pending.forEach((p) => p.reject(new Error('socket closed')));
    this._pending.clear();
    this._subs.clear();
    // Back off, but never so far that a panel left overnight takes minutes
    // to notice HA came back.
    setTimeout(() => this.connect(), this._backoff);
    this._backoff = Math.min(this._backoff * 2, 15000);
  }

  _handle(msg) {
    if (msg.type === 'auth_required') {
      this._ws.send(JSON.stringify({ type: 'auth', access_token: this._token }));
      return;
    }
    if (msg.type === 'auth_invalid') {
      this._closed = true;
      this._onStatus('auth');
      return;
    }
    if (msg.type === 'auth_ok') {
      this._backoff = 1000;
      this._onStatus('online');
      this._seed();
      return;
    }
    if (msg.type === 'result') {
      const p = this._pending.get(msg.id);
      if (p) {
        this._pending.delete(msg.id);
        if (msg.success) p.resolve(msg.result);
        else p.reject(new Error((msg.error && msg.error.message) || 'call failed'));
      }
      return;
    }
    if (msg.type === 'event') {
      const cb = this._subs.get(msg.id);
      if (cb) cb(msg.event);
    }
  }

  send(payload) {
    if (!this._ws || this._ws.readyState !== 1) {
      return Promise.reject(new Error('not connected'));
    }
    const id = this._id++;
    this._ws.send(JSON.stringify(Object.assign({ id }, payload)));
    return new Promise((resolve, reject) => this._pending.set(id, { resolve, reject }));
  }

  /* Same shape as HA's own connection.subscribeMessage, because the weather
     card calls exactly that. Resolves to an unsubscribe function. */
  subscribeMessage(cb, payload) {
    if (!this._ws || this._ws.readyState !== 1) {
      return Promise.reject(new Error('not connected'));
    }
    const id = this._id++;
    this._subs.set(id, cb);
    this._ws.send(JSON.stringify(Object.assign({ id }, payload)));
    return new Promise((resolve, reject) => {
      this._pending.set(id, {
        resolve: () => resolve(() => {
          this._subs.delete(id);
          this.send({ type: 'unsubscribe_events', subscription: id }).catch(() => {});
        }),
        reject: (e) => { this._subs.delete(id); reject(e); },
      });
    });
  }

  /* get_states once, then every state_changed. Not subscribe_entities: its
     compressed diff format is a lot more code to get right, and this page
     exists to measure rendering, not bandwidth. Worth revisiting if a busy
     house turns out to flood it. */
  _seed() {
    this.send({ type: 'get_states' }).then((states) => {
      const map = {};
      states.forEach((s) => { map[s.entity_id] = s; });
      this._onState(map, true);
      return this.subscribeMessage((ev) => {
        const d = ev && ev.data;
        if (!d || !d.entity_id) return;
        this._onState({ [d.entity_id]: d.new_state }, false);
      }, { type: 'subscribe_events', event_type: 'state_changed' });
    }).catch(() => { /* the socket will retry */ });
  }

  callService(domain, service, data) {
    return this.send({
      type: 'call_service', domain, service, service_data: data || {},
    }).catch((e) => console.warn('call_service failed', domain + '.' + service, e.message));
  }
}

/* ==================================================================== *
 * hass, and handing it to the cards
 * ==================================================================== */

let states = {};
let hass = null;
let cards = [];
let pendingFlush = false;

/* Every update builds a NEW hass object and a NEW states map. That is not
   ceremony: each card's diff is `prev.states[id] === hass.states[id]`, so
   mutating in place would make every card decide nothing had changed and
   skip its render. HA's frontend allocates the same way. */
function applyStates(changes, replace) {
  const next = replace ? {} : Object.assign({}, states);
  Object.keys(changes).forEach((id) => {
    if (changes[id] === null) delete next[id];
    else next[id] = changes[id];
  });
  states = next;
  if (pendingFlush) return;
  pendingFlush = true;
  // Coalesce a burst of state_changed into one hass per frame.
  requestAnimationFrame(() => {
    pendingFlush = false;
    hass = { states, callService: (d, s, data) => socket.callService(d, s, data),
             connection: socket };
    for (let i = 0; i < cards.length; i++) cards[i].hass = hass;
  });
}

function setStatus(kind) {
  connEl.className = 'conn' +
    (kind === 'online' ? '' : kind === 'connecting' ? ' warn' : ' bad');
  if (kind === 'auth') showSetup('That token was rejected. Paste a new one.');
}

/* ==================================================================== *
 * Building the pages
 * ==================================================================== */

function buildCard(conf) {
  const type = String(conf.type || '').replace(/^custom:/, '');
  const el = document.createElement(type);
  if (!customElements.get(type)) {
    return broken(`Unknown card type "${conf.type}"`);
  }
  try {
    el.setConfig(Object.assign({}, conf, { type }));
  } catch (e) {
    return broken(`${conf.type}: ${e.message}`);
  }
  cards.push(el);
  return el;
}

function broken(message) {
  const d = document.createElement('div');
  d.className = 'broken';
  d.textContent = message;
  return d;
}

function buildPages() {
  pagerEl.innerHTML = '';
  dotsEl.innerHTML = '';
  cards = [];
  const pages = (CFG && Array.isArray(CFG.pages) && CFG.pages.length)
    ? CFG.pages
    : [{ cards: [] }];

  pages.forEach(() => {
    const dot = document.createElement('div');
    dot.className = 'dot';
    dotsEl.appendChild(dot);
  });
  document.body.classList.toggle('paged', pages.length > 1);
  dotsEl.hidden = pages.length < 2;

  pages.forEach((page) => {
    const el = document.createElement('div');
    el.className = 'page';
    (page.cards || []).forEach((conf) => el.appendChild(buildCard(conf)));
    pagerEl.appendChild(el);
  });
  markDot(0);
}

let dotShown = -1;
function markDot(i) {
  if (i === dotShown) return;
  dotShown = i;
  const all = dotsEl.children;
  for (let n = 0; n < all.length; n++) all[n].classList.toggle('on', n === i);
}

/* The only thing running during a swipe. Passive, rAF-coalesced, and it
   writes nothing unless the page actually changed. */
let scrollQueued = false;
pagerEl.addEventListener('scroll', () => {
  if (scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(() => {
    scrollQueued = false;
    const w = pagerEl.clientWidth || 1;
    markDot(Math.round(pagerEl.scrollLeft / w));
  });
}, { passive: true });

/* ==================================================================== *
 * Setup screen
 * ==================================================================== */

function showSetup(message) {
  if (document.querySelector('.setup')) return;
  const s = saved();
  const wrap = document.createElement('div');
  wrap.className = 'setup';
  wrap.innerHTML = `
    <h1>Connect to Home Assistant</h1>
    <p>Create a long-lived access token in Home Assistant under your profile,
       Security, at the bottom. It is stored on this panel only.</p>
    <label for="u">Home Assistant URL</label>
    <input id="u" type="url" autocapitalize="off" autocorrect="off" spellcheck="false">
    <label for="t">Long-lived access token</label>
    <textarea id="t" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea>
    <div class="err"></div>
    <button type="button">Connect</button>
  `;
  document.body.appendChild(wrap);
  const u = wrap.querySelector('#u');
  const t = wrap.querySelector('#t');
  u.value = s.url || (CFG && CFG.url) || location.origin;
  t.value = '';
  if (message) wrap.querySelector('.err').textContent = message;
  wrap.querySelector('button').addEventListener('click', () => {
    const token = t.value.trim();
    if (!token) { wrap.querySelector('.err').textContent = 'Paste the token first.'; return; }
    save({ url: u.value.trim(), token });
    location.reload();
  });
}

/* ==================================================================== *
 * ?stats=1 - frame timing, for deciding whether this is worth a rewrite
 * ==================================================================== */

function startStats() {
  const el = document.createElement('div');
  el.className = 'stats';
  document.body.appendChild(el);
  let last = performance.now();
  let frames = 0;
  let worst = 0;
  let since = last;
  const tick = (now) => {
    const dt = now - last;
    last = now;
    frames++;
    if (dt > worst) worst = dt;
    if (now - since >= 1000) {
      el.textContent = `${Math.round(frames * 1000 / (now - since))} fps` +
        `  worst ${worst.toFixed(1)}ms`;
      frames = 0; worst = 0; since = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ==================================================================== *
 * Go
 * ==================================================================== */

let socket = null;

function boot() {
  if (!window.NSPANEL_CONFIG) {
    document.body.appendChild(broken('kiosk/config.js is missing or did not parse.'));
    return;
  }
  buildPages();
  if (STATS) startStats();
  const s = saved();
  if (!s.token) {
    showSetup('');
  } else {
    socket = new HaSocket(wsUrl(s.url), s.token, applyStates, setStatus);
  }
}

/* ?mock=1 swaps in a fake Home Assistant that speaks the same websocket
   protocol, so this page can be developed and demonstrated without a real
   instance. The file lives in dev/ and never needs copying to the panel. */
if (/[?&]mock=1/.test(location.search)) {
  const tag = document.createElement('script');
  tag.src = '../dev/kiosk-mock.js';
  tag.onload = boot;
  tag.onerror = () => {
    document.body.appendChild(broken('?mock=1 needs dev/kiosk-mock.js next to kiosk/.'));
  };
  document.head.appendChild(tag);
} else {
  boot();
}

/* There is no more-info dialog outside Lovelace; swallow the request rather
   than letting it bubble into nothing and look like a dead tap. */
document.addEventListener('hass-more-info', (e) => {
  e.stopPropagation();
  if (STATS) console.log('more-info', e.detail && e.detail.entityId);
});

/* Triple-tap the top-left corner to get the setup screen back. */
let taps = [];
document.addEventListener('pointerdown', (e) => {
  if (e.clientX > 60 || e.clientY > 60) return;
  const now = Date.now();
  taps = taps.filter((t) => now - t < 900).concat(now);
  if (taps.length >= 3) { taps = []; showSetup(''); }
});
