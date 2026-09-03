/* A fake Home Assistant for kiosk/index.html?mock=1.
 *
 * It replaces window.WebSocket with something that speaks the same protocol
 * the real one does - auth_required, auth, auth_ok, get_states,
 * subscribe_events, call_service - so the page's whole connection path runs
 * for real against it. That is the part worth testing off the panel: the
 * websocket handling is what you cannot easily debug standing in a hallway.
 *
 * Service calls mutate these states and echo back a state_changed, so the
 * cards round-trip properly: drag a light, let go, watch the value come back
 * from "HA" rather than from the card's own local value.
 *
 * Dev only. Never needs copying to the panel.
 */
(function () {
  const now = () => new Date().toISOString();
  const st = (entity_id, state, attributes) => ({
    entity_id, state, attributes: attributes || {},
    last_changed: now(), last_updated: now(), context: { id: 'mock' },
  });

  const STATES = {
    'light.dining_lights': st('light.dining_lights', 'on', {
      friendly_name: 'Shelly Dimmer 2 Dining', brightness: 173,
      color_mode: 'color_temp', color_temp_kelvin: 2700, rgb_color: [255, 169, 87],
      supported_color_modes: ['color_temp'],
    }),
    'light.lounge_lamp': st('light.lounge_lamp', 'on', {
      friendly_name: 'Hue Lounge Lamp', brightness: 120,
      color_mode: 'hs', rgb_color: [120, 96, 255], supported_color_modes: ['hs'],
    }),
    'cover.blinds_living_room': st('cover.blinds_living_room', 'open', {
      friendly_name: 'Somfy Living Room Roller', current_position: 62,
      supported_features: 15,
    }),
    'cover.bedroom_blackout': st('cover.bedroom_blackout', 'closed', {
      friendly_name: 'Bedroom Roller 2', current_position: 0, supported_features: 15,
    }),
    'climate.living_room': st('climate.living_room', 'heat', {
      friendly_name: 'Living Room TRV', current_temperature: 20.4, temperature: 21.5,
      min_temp: 7, max_temp: 30, hvac_action: 'heating',
      hvac_modes: ['off', 'heat', 'auto'],
    }),
    'sensor.outside_temp': st('sensor.outside_temp', '12.4', {
      friendly_name: 'Outside Temperature', unit_of_measurement: '°C',
      device_class: 'temperature',
    }),
    'sensor.outside_hum': st('sensor.outside_hum', '78', {
      friendly_name: 'Outside Humidity', unit_of_measurement: '%',
      device_class: 'humidity',
    }),
    'sensor.wind': st('sensor.wind', '11', {
      friendly_name: 'Wind Speed', unit_of_measurement: 'km/h', device_class: 'wind_speed',
    }),
    'script.goodnight': st('script.goodnight', 'off', { friendly_name: 'Goodnight' }),
    'script.good_morning': st('script.good_morning', 'off', { friendly_name: 'Good morning' }),
    'script.leaving': st('script.leaving', 'off', { friendly_name: 'Leaving' }),
    'scene.movie': st('scene.movie', 'unknown', { friendly_name: 'Movie' }),
    // arms without a code, disarms with 1234 and refuses anything else
    'alarm_control_panel.home': st('alarm_control_panel.home', 'disarmed', {
      friendly_name: 'Home Alarm', code_format: 'number', code_arm_required: false,
      supported_features: 7, changed_by: null,
    }),
  };

  /* What a service call does to the mock house. Only enough to make the
     round-trip real; this is not a Home Assistant. */
  function applyService(domain, service, data) {
    const id = data && data.entity_id;
    const s = id && STATES[id];
    if (!s) return null;
    const a = s.attributes;

    if (domain === 'light') {
      if (service === 'toggle') s.state = s.state === 'on' ? 'off' : 'on';
      if (service === 'turn_off') s.state = 'off';
      if (service === 'turn_on') {
        s.state = 'on';
        if (typeof data.brightness_pct === 'number') {
          a.brightness = Math.round(data.brightness_pct * 2.55);
        }
        if (typeof data.brightness === 'number') a.brightness = data.brightness;
        if (Array.isArray(data.rgb_color)) a.rgb_color = data.rgb_color;
      }
    } else if (domain === 'cover') {
      if (service === 'set_cover_position') a.current_position = data.position;
      if (service === 'open_cover') a.current_position = 100;
      if (service === 'close_cover') a.current_position = 0;
      s.state = a.current_position > 0 ? 'open' : 'closed';
    } else if (domain === 'climate') {
      if (service === 'set_temperature') a.temperature = data.temperature;
      if (service === 'set_hvac_mode') s.state = data.hvac_mode;
    } else if (domain === 'script') {
      // Run for a moment, so the button card's "running" accent is visible.
      s.state = 'on';
      setTimeout(() => {
        s.state = 'off';
        push(id);
      }, 2500);
    } else if (domain === 'scene') {
      s.state = now();
    } else if (domain === 'homeassistant' && service === 'toggle') {
      s.state = s.state === 'on' ? 'off' : 'on';
    } else if (domain === 'alarm_control_panel') {
      if (service === 'alarm_disarm') {
        if (data.code !== '1234') return { error: { code: 'invalid_code', message: 'Invalid alarm code provided' } };
        s.state = 'disarmed';
      } else {
        const to = service.replace('alarm_arm_', 'armed_');
        s.state = 'arming';
        setTimeout(() => { s.state = to; push(id); }, 1500);
      }
      a.changed_by = 'panel';
    }
    s.last_updated = now();
    return id;
  }

  const sockets = [];
  function push(entityId) {
    const s = STATES[entityId];
    if (!s) return;
    const copy = JSON.parse(JSON.stringify(s));
    sockets.forEach((sock) => sock._pushState(copy));
  }

  class MockSocket {
    constructor() {
      this.readyState = 0;
      this._subs = new Map();
      sockets.push(this);
      setTimeout(() => {
        this.readyState = 1;
        this._recv({ type: 'auth_required', ha_version: '2026.8.0 (mock)' });
      }, 60);
    }

    _recv(obj) {
      if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) });
    }

    _pushState(newState) {
      this._subs.forEach((eventType, id) => {
        if (eventType !== 'state_changed') return;
        this._recv({
          id, type: 'event',
          event: {
            event_type: 'state_changed',
            data: { entity_id: newState.entity_id, new_state: newState, old_state: null },
          },
        });
      });
    }

    send(raw) {
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }

      if (msg.type === 'auth') {
        // Any non-empty token passes; an empty one exercises the failure path.
        setTimeout(() => this._recv(msg.access_token
          ? { type: 'auth_ok', ha_version: '2026.8.0 (mock)' }
          : { type: 'auth_invalid', message: 'invalid access token' }), 40);
        return;
      }
      if (msg.type === 'get_states') {
        const result = Object.keys(STATES).map((k) => JSON.parse(JSON.stringify(STATES[k])));
        setTimeout(() => this._recv({ id: msg.id, type: 'result', success: true, result }), 30);
        return;
      }
      if (msg.type === 'subscribe_events') {
        this._subs.set(msg.id, msg.event_type);
        setTimeout(() => this._recv({ id: msg.id, type: 'result', success: true, result: null }), 10);
        return;
      }
      if (msg.type === 'unsubscribe_events') {
        this._subs.delete(msg.subscription);
        this._recv({ id: msg.id, type: 'result', success: true, result: null });
        return;
      }
      if (msg.type === 'call_service') {
        const touched = applyService(msg.domain, msg.service, msg.service_data || {});
        window.__mockCalls = (window.__mockCalls || []).concat(
          msg.domain + '.' + msg.service + ' ' + JSON.stringify(msg.service_data || {}));
        setTimeout(() => {
          if (touched && touched.error) {
            this._recv({ id: msg.id, type: 'result', success: false, error: touched.error });
            return;
          }
          this._recv({ id: msg.id, type: 'result', success: true, result: null });
          if (touched) push(touched);
        }, 25);
        return;
      }
      // Anything else (weather/subscribe_forecast, say) fails the way an older
      // core would, so the card's fallback path gets exercised too.
      setTimeout(() => this._recv({
        id: msg.id, type: 'result', success: false,
        error: { code: 'unknown_command', message: 'mock does not implement ' + msg.type },
      }), 10);
    }

    close() { this.readyState = 3; if (this.onclose) this.onclose(); }
  }

  window.WebSocket = MockSocket;
  window.__mockStates = STATES;

  // A token, so the page goes straight past its setup screen.
  try {
    localStorage.setItem('nspanel-kiosk', JSON.stringify({ url: location.origin, token: 'mock' }));
  } catch (e) { /* private mode */ }

  console.info('%c kiosk mock ', 'background:#8ddba4;color:#0b0d10;font-weight:700',
    'fake Home Assistant active - no real instance is being contacted');
}());
