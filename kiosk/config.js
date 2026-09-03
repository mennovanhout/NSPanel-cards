/* Your panel, one page per swipe.
 *
 * This file is yours - index.html never overwrites it. Each page is a vertical
 * stack of cards, and the card configs are exactly the ones from the README,
 * written as JS objects instead of YAML. The `custom:` prefix is optional, so
 * you can paste a Lovelace card config straight in.
 *
 * A 480px panel fits about 480px of cards per page once you count the 12px
 * gaps and the 12px padding: 260 + 184, or 300 + 144, or one 444.
 */
window.NSPANEL_CONFIG = {
  /* Where Home Assistant is. Leave null when this page is served by HA itself
     (from /local/), which is the normal case - it will use this page's origin. */
  url: null,

  pages: [
    {
      cards: [
        {
          type: 'nspanel-light-card',
          entity: 'light.dining_lights',
          title: 'Dining table',
          height: 260,
          presets: [
            { name: 'Low', brightness_pct: 15 },
            { name: 'Dinner', brightness_pct: 45, color_temp_kelvin: 2400 },
            { name: 'Full', brightness_pct: 100 },
          ],
        },
        {
          type: 'nspanel-light-card',
          entity: 'light.lounge_lamp',
          title: 'Lounge lamp',
          height: 184,
          show_presets: false,
        },
      ],
    },
    {
      cards: [
        {
          type: 'nspanel-cover-card',
          entity: 'cover.blinds_living_room',
          title: 'Living room blinds',
          height: 260,
          presets: [
            { name: 'Open', position: 100 },
            { name: 'Privacy', position: 35 },
            { name: 'Shut', position: 0 },
          ],
        },
        {
          type: 'nspanel-cover-card',
          entity: 'cover.bedroom_blackout',
          title: 'Bedroom blackout',
          height: 184,
          show_presets: false,
        },
      ],
    },
    {
      cards: [
        {
          type: 'nspanel-climate-card',
          entity: 'climate.living_room',
          title: 'Living room',
          height: 300,
        },
        {
          type: 'nspanel-sensors-card',
          title: 'Outside',
          height: 144,
          entities: [
            { entity: 'sensor.outside_temp', name: 'Outside' },
            { entity: 'sensor.outside_hum', name: 'Humidity' },
            { entity: 'sensor.wind', name: 'Wind' },
          ],
        },
      ],
    },
    {
      cards: [
        {
          type: 'nspanel-button-card',
          height: 300,
          columns: 2,
          buttons: [
            { entity: 'script.goodnight', name: 'Goodnight', icon: 'mdi:weather-night',
              confirm: true },
            { entity: 'script.good_morning', name: 'Good morning',
              icon: 'mdi:weather-sunset' },
            { entity: 'scene.movie', name: 'Movie', icon: 'mdi:sofa-outline' },
            { entity: 'script.leaving', name: 'Leaving', icon: 'mdi:lock' },
          ],
        },
        {
          type: 'nspanel-clock-card',
          height: 144,
          show_date: true,
        },
      ],
    },
    {
      cards: [
        {
          type: 'nspanel-alarm-card',
          entity: 'alarm_control_panel.home',
          title: 'Alarm',
          modes: ['home', 'away', 'night'],
          height: 200,
        },
        {
          type: 'nspanel-clock-card',
          height: 244,
          show_date: true,
        },
      ],
    },
  ],
};
