/* ==========================================================================
 * core.js — shared foundation for "The Game Master's Arena".
 *
 * Namespace (GM), config, seeded RNG, simplex noise, math helpers, event bus,
 * system registry, error reporting, logging, announcements, points of
 * interest and tribute selection.
 *
 * Owner: core. Feature modules must NOT edit this file (see SPEC.md).
 * ========================================================================== */
(function () {
  'use strict';

  const GM = (window.GM = window.GM || {});
  GM.VERSION = '1.0.0';

  // ------------------------------------------------------------------ config
  GM.CFG = {
    MAP_SIZE: 360,            // terrain extent in metres; x,z in [-180, 180]
    TERRAIN_RES: 181,         // height samples per side (2 m spacing)
    ARENA_RADIUS: 150,        // force-field radius; tributes can never leave it
    CORNUCOPIA_RADIUS: 24,    // flat plaza around the cornucopia at (0,0)
    PEDESTAL_RADIUS: 18,      // ring on which tributes start
    NAV_RES: 120,             // navigation grid cells per side (3 m cells)
    BASE_WATER_LEVEL: 0,      // normal water height (y)
    DAY_LENGTH: 300,          // sim seconds for one full day + night
    START_TIME_OF_DAY: 0.30,  // 0 = midnight, 0.25 = 06:00, 0.5 = noon
    DAWN: 0.25,               // 06:00 -> 'day:start'
    DUSK: 0.79,               // ~19:00 -> 'night:start'
    COUNTDOWN: 10,            // seconds on the pedestals
    MIN_TRIBUTES: 2,
    MAX_TRIBUTES: 48,
    DEFAULT_TRIBUTES: 24,
    SIM_STEP: 1 / 30,         // max simulation sub-step (sim seconds)
    MAX_SUBSTEPS: 12,         // per rendered frame (prevents spiral of death)
    SPEEDS: [0.5, 1, 2, 4, 8, 16],
  };

  // --------------------------------------------------------- district colors
  const DISTRICT_COLORS = [
    '#e8b931', '#d64541', '#3a7bd5', '#2fa36b', '#9b59b6', '#e67e22',
    '#1abc9c', '#c0567a', '#95a5a6', '#f06ecb', '#22b8e0', '#7fbf3f',
  ];
  /** District number (1-based) -> CSS hex colour. Works for any district count. */
  GM.districtColor = function (district) {
    const i = (district - 1) | 0;
    if (i >= 0 && i < DISTRICT_COLORS.length) return DISTRICT_COLORS[i];
    const hue = (i * 137.508) % 360;
    return hslToHex(hue, 62, 55);
  };
  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const to = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
    return '#' + to(f(0)) + to(f(8)) + to(f(4));
  }

  // --------------------------------------------------------------------- RNG
  /** mulberry32 — returns a function producing floats in [0, 1). */
  GM.makeRng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  /** FNV-1a string hash -> uint32 (lets players type words as seeds). */
  GM.hashString = function (str) {
    let h = 2166136261 >>> 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };
  GM.randomSeed = function () {
    return 100000 + Math.floor(Math.random() * 900000);
  };

  /**
   * GM.R — the shared, seedable gameplay RNG. main.js re-seeds it for every
   * game. Use it for anything that affects the simulation. Purely cosmetic
   * randomness (particle jitter) may use Math.random().
   * All functions are closures: safe to destructure (const { pick } = GM.R).
   */
  let rng = GM.makeRng(1);
  const R = (GM.R = {
    seed(s) { rng = GM.makeRng(s >>> 0); },
    random() { return rng(); },
    range(a, b) { return a + (b - a) * rng(); },
    int(a, b) { return a + Math.floor((b - a + 1) * rng()); },   // inclusive
    chance(p) { return rng() < p; },
    pick(arr) { return arr.length ? arr[Math.floor(rng() * arr.length)] : undefined; },
    angle() { return rng() * Math.PI * 2; },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
      }
      return arr;
    },
    gauss(mean, sd) {
      let u = 0, v = 0;
      while (u === 0) u = rng();
      while (v === 0) v = rng();
      return (mean || 0) + (sd === undefined ? 1 : sd) * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    /** weighted({a: 3, b: 1}) or weighted([['a', 3], ['b', 1]]) -> key/value */
    weighted(entries) {
      const list = Array.isArray(entries) ? entries : Object.entries(entries);
      let total = 0;
      for (const e of list) total += Math.max(0, e[1]);
      if (total <= 0) return list.length ? list[0][0] : undefined;
      let r = rng() * total;
      for (const e of list) {
        r -= Math.max(0, e[1]);
        if (r <= 0) return e[0];
      }
      return list[list.length - 1][0];
    },
  });

  // ------------------------------------------------------------ simplex noise
  /**
   * GM.Noise.create(seed) -> { noise2(x, y) in [-1, 1], fbm(x, y, oct, lac, gain),
   *                            ridged(x, y, oct) in [0, 1] }
   */
  GM.Noise = {
    create(seed) {
      const rnd = GM.makeRng(seed);
      const p = new Uint8Array(256);
      for (let i = 0; i < 256; i++) p[i] = i;
      for (let i = 255; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
      }
      const perm = new Uint8Array(512);
      for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
      const GX = [1, -1, 1, -1, 1, -1, 0, 0];
      const GY = [1, 1, -1, -1, 0, 0, 1, -1];
      const F2 = 0.5 * (Math.sqrt(3) - 1);
      const G2 = (3 - Math.sqrt(3)) / 6;

      function noise2(xin, yin) {
        let n0 = 0, n1 = 0, n2 = 0;
        const s = (xin + yin) * F2;
        const i = Math.floor(xin + s), j = Math.floor(yin + s);
        const t = (i + j) * G2;
        const x0 = xin - (i - t), y0 = yin - (j - t);
        const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
        const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
        const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
        const ii = i & 255, jj = j & 255;
        let t0 = 0.5 - x0 * x0 - y0 * y0;
        if (t0 > 0) { const g = perm[ii + perm[jj]] & 7; t0 *= t0; n0 = t0 * t0 * (GX[g] * x0 + GY[g] * y0); }
        let t1 = 0.5 - x1 * x1 - y1 * y1;
        if (t1 > 0) { const g = perm[ii + i1 + perm[jj + j1]] & 7; t1 *= t1; n1 = t1 * t1 * (GX[g] * x1 + GY[g] * y1); }
        let t2 = 0.5 - x2 * x2 - y2 * y2;
        if (t2 > 0) { const g = perm[ii + 1 + perm[jj + 1]] & 7; t2 *= t2; n2 = t2 * t2 * (GX[g] * x2 + GY[g] * y2); }
        const v = 70 * (n0 + n1 + n2);
        return v < -1 ? -1 : v > 1 ? 1 : v;
      }
      function fbm(x, y, octaves, lacunarity, gain) {
        octaves = octaves || 4; lacunarity = lacunarity || 2; gain = gain || 0.5;
        let amp = 1, freq = 1, sum = 0, norm = 0;
        for (let o = 0; o < octaves; o++) {
          sum += amp * noise2(x * freq, y * freq);
          norm += amp; amp *= gain; freq *= lacunarity;
        }
        return sum / norm;
      }
      function ridged(x, y, octaves) {
        octaves = octaves || 4;
        let amp = 1, freq = 1, sum = 0, norm = 0;
        for (let o = 0; o < octaves; o++) {
          const n = 1 - Math.abs(noise2(x * freq, y * freq));
          sum += amp * n * n;
          norm += amp; amp *= 0.5; freq *= 2;
        }
        return sum / norm;
      }
      return { noise2, fbm, ridged };
    },
  };

  // -------------------------------------------------------------- math utils
  const TAU = Math.PI * 2;
  let uidCounter = 0;
  const U = (GM.U = {
    TAU,
    clamp(v, a, b) { return v < a ? a : v > b ? b : v; },
    clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; },
    lerp(a, b, t) { return a + (b - a) * t; },
    invLerp(a, b, v) { return a === b ? 0 : (v - a) / (b - a); },
    remap(v, a1, b1, a2, b2) { return a2 + (b2 - a2) * U.clamp01(U.invLerp(a1, b1, v)); },
    smoothstep(e0, e1, x) { const t = U.clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); },
    /** Frame-rate independent exponential approach of a towards b. */
    damp(a, b, lambda, dt) { return a + (b - a) * (1 - Math.exp(-lambda * dt)); },
    dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); },
    /** Distance on the ground plane between two objects with .x/.z (Vector3 or {x,z}). */
    distXZ(a, b) { const dx = a.x - b.x, dz = a.z - b.z; return Math.sqrt(dx * dx + dz * dz); },
    distSqXZ(a, b) { const dx = a.x - b.x, dz = a.z - b.z; return dx * dx + dz * dz; },
    /**
     * Heading convention used everywhere: models face +Z at rotation.y = 0,
     * and heading = atan2(dx, dz). So object.rotation.y = U.headingTo(from, to).
     */
    headingTo(from, to) { return Math.atan2(to.x - from.x, to.z - from.z); },
    wrapAngle(a) { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; },
    angleDiff(from, to) { return U.wrapAngle(to - from); },
    lerpAngle(a, b, t) { return a + U.angleDiff(a, b) * t; },
    lenXZ(x, z) { return Math.sqrt(x * x + z * z); },
    uid() { return ++uidCounter; },
    /** 0..1 time of day -> "HH:MM" */
    formatClock(tod) {
      const m = Math.floor((((tod % 1) + 1) % 1) * 1440);
      return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    },
    /** seconds -> "m:ss" */
    formatDuration(sec) {
      sec = Math.max(0, Math.floor(sec));
      return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    },
    /** Copy a position-like object into a plain {x, y, z}. */
    toPos(p) { return p ? { x: +p.x || 0, y: +p.y || 0, z: +p.z || 0 } : null; },
  });

  // --------------------------------------------------------------- event bus
  const listeners = Object.create(null);
  /** Subscribe. Returns an unsubscribe function. */
  GM.on = function (name, fn) {
    (listeners[name] || (listeners[name] = [])).push(fn);
    return function () { GM.off(name, fn); };
  };
  GM.off = function (name, fn) {
    const l = listeners[name];
    if (!l) return;
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  };
  GM.once = function (name, fn) {
    const off = GM.on(name, function (d) { off(); fn(d); });
    return off;
  };
  /** Synchronous emit. A throwing listener is reported and does not stop others. */
  GM.emit = function (name, data) {
    const l = listeners[name];
    if (!l || !l.length) return;
    const copy = l.slice();
    for (let i = 0; i < copy.length; i++) {
      try { copy[i](data); } catch (e) { GM.reportError('event:' + name, e); }
    }
  };

  // --------------------------------------------------------- error reporting
  GM.errors = [];
  const errorCounts = Object.create(null);
  /** Report an error without crashing the loop. Only the first few per site hit the console. */
  GM.reportError = function (where, err) {
    const n = (errorCounts[where] = (errorCounts[where] || 0) + 1);
    if (n <= 3) console.error('[GM] ' + where + ':', err);
    if (n === 4) console.warn('[GM] ' + where + ': further errors from here are muted');
    if (GM.errors.length < 100) GM.errors.push({ where, message: String(err && err.message || err), count: n });
  };

  // --------------------------------------------------------- system registry
  /**
   * Every module registers one or more systems:
   *   GM.registerSystem({
   *     name: 'Tributes', order: 50,
   *     init()          // once at boot (THREE + DOM ready, terrain NOT generated yet)
   *     clear()         // back to setup screen: remove all game entities from the scene
   *     reset(settings) // new game: terrain already generated; build game entities
   *     update(dt)      // simulation step (sim seconds; scaled by speed; not when paused/setup)
   *     frame(realDt)   // once per rendered frame, always (also paused/setup): visuals, UI, camera
   *   })
   * Systems run in ascending `order`. Missing methods are skipped.
   */
  GM.systems = [];
  GM.registerSystem = function (sys) {
    if (!sys || !sys.name) throw new Error('registerSystem: system needs a name');
    GM.systems.push(sys);
    GM.systems.sort((a, b) => (a.order || 0) - (b.order || 0));
    return sys;
  };

  // -------------------------------------------------------------- game state
  /**
   * GM.state is ONE long-lived object. main.js mutates it in place on each new
   * game. Always read GM.state.x at use time; never cache its arrays.
   */
  GM.state = {
    phase: 'boot',         // 'boot' | 'setup' | 'countdown' | 'running' | 'ended'
    settings: null,        // see SPEC.md "Settings"
    seed: 0,
    time: 0,               // sim seconds since the games began (countdown end)
    realTime: 0,           // real seconds since boot
    countdown: 0,          // seconds left on the pedestals
    day: 1,                // advanced by Env at dawn
    timeOfDay: 0.3,        // 0..1, advanced by Env
    speed: 1,
    paused: false,
    tributes: [],          // owned by Tributes; tributes[i].id === i
    mutts: [],             // owned by Mutts
    selectedId: null,      // selected tribute id or null
    winner: null,          // tribute id or null (after 'game:end')
    endTime: 0,
    interests: [],         // points of interest (see GM.addInterest)
    log: [],               // log entries (see GM.log)
    deaths: [],            // [{id, killerId, cause, weapon, time, day}] in order of death
    fallenSinceRecap: [],  // tribute ids that died since the last night recap
    revealUntil: 0,        // sim time until which every tribute knows where all others are
    feast: null,           // {x, z, at, ready} while a feast is announced/active
    stats: { powersUsed: 0, peakViewers: 0, kills: 0 },
  };

  /** Called by main.js for a new game. Mutates GM.state in place. */
  GM.resetState = function (settings) {
    const st = GM.state;
    st.settings = settings;
    st.seed = settings ? settings.seed : st.seed;
    st.time = 0;
    st.countdown = 0;
    st.day = 1;
    st.timeOfDay = GM.CFG.START_TIME_OF_DAY;
    st.paused = false;
    st.tributes = [];
    st.mutts = [];
    st.selectedId = null;
    st.winner = null;
    st.endTime = 0;
    st.interests = [];
    st.log = [];
    st.deaths = [];
    st.fallenSinceRecap = [];
    st.revealUntil = 0;
    st.feast = null;
    st.stats = { powersUsed: 0, peakViewers: 0, kills: 0 };
  };

  // --------------------------------------------------------------- logging
  let logId = 0;
  /**
   * Add an entry to the event log (rendered by the UI, re-translated live).
   *   type:   'kill' | 'death' | 'combat' | 'alliance' | 'betrayal' | 'item' |
   *           'gm' | 'hazard' | 'event' | 'mind' | 'system'
   *   key:    i18n key; params: i18n params (strings starting with '@' are keys)
   *   opts:   { pos, tributeIds: [ids], important: bool }
   */
  GM.log = function (type, key, params, opts) {
    const st = GM.state;
    opts = opts || {};
    const entry = {
      id: ++logId,
      type: type || 'event',
      key,
      params: params || {},
      time: st.time,
      day: st.day,
      tod: st.timeOfDay,
      pos: U.toPos(opts.pos),
      tributeIds: opts.tributeIds || [],
      important: !!opts.important,
    };
    st.log.push(entry);
    if (st.log.length > 600) st.log.shift();
    GM.emit('log', entry);
    return entry;
  };

  /**
   * Big centre-screen message. style: 'info' | 'danger' | 'gold' | 'gm'.
   * duration in real seconds.
   */
  GM.announce = function (key, params, opts) {
    opts = opts || {};
    GM.emit('announce', {
      key,
      params: params || {},
      style: opts.style || 'info',
      duration: opts.duration || 4,
    });
  };

  // ------------------------------------------------------ points of interest
  let interestId = 0;
  /**
   * Register something worth watching (used by the auto director and live feeds).
   *   { pos, score, duration (sim s, default 8), label: {key, params},
   *     followId (tribute to track), kind, key (dedupe: same key refreshes) }
   * Score guide: wandering 1-2, supply drop 3, fight 5-8, hazard 6-9,
   *              betrayal 9, death 10, finale 12.
   */
  GM.addInterest = function (o) {
    const st = GM.state;
    if (!o || !o.pos) return null;
    const duration = o.duration || 8;
    if (o.key) {
      for (const it of st.interests) {
        if (it.key === o.key) {
          it.score = Math.max(it.score * 0.8, o.score || 1);
          it.expires = st.time + duration;
          it.pos = U.toPos(o.pos);
          if (o.label) it.label = o.label;
          if (o.followId != null) it.followId = o.followId;
          return it;
        }
      }
    }
    const it = {
      id: ++interestId,
      key: o.key || null,
      kind: o.kind || 'event',
      pos: U.toPos(o.pos),
      score: o.score || 1,
      created: st.time,
      expires: st.time + duration,
      label: o.label || null,
      followId: o.followId != null ? o.followId : null,
    };
    st.interests.push(it);
    if (st.interests.length > 64) {
      st.interests.sort((a, b) => b.score - a.score);
      st.interests.length = 48;
    }
    GM.emit('interest', it);
    return it;
  };
  /** Drop expired interests (main.js calls this every frame). */
  GM.pruneInterests = function () {
    const st = GM.state;
    const now = st.time;
    let w = 0;
    for (let i = 0; i < st.interests.length; i++) {
      const it = st.interests[i];
      if (it.expires > now) st.interests[w++] = it;
    }
    st.interests.length = w;
  };

  // --------------------------------------------------------------- selection
  /** Select a tribute by id (or null). Emits 'select' {id}. */
  GM.select = function (id) {
    const st = GM.state;
    if (id != null && !st.tributes[id]) id = null;
    if (st.selectedId === id) return;
    st.selectedId = id;
    GM.emit('select', { id });
  };
  GM.selected = function () {
    const st = GM.state;
    return st.selectedId == null ? null : st.tributes[st.selectedId] || null;
  };

  /** Translation shortcut (real implementation installed by i18n.js). */
  GM.t = function (key) { return key; };

  /** Convenience: is the simulation in live gameplay? */
  GM.isRunning = function () { return GM.state.phase === 'running'; };
})();
