/**
 * env.js — GM.Env (SPEC 8.3): sky dome (sun, moon, stars, clouds), the
 * day/night clock, weather state machine, wind, rain/snow particles, fog,
 * lightning flashes and the water level.
 *
 * Gameplay (clock, weather timers, storm lightning, wind, water tween) runs in
 * update(dt) with sim seconds. Visuals (sky, lights, fog, particles) run in
 * frame(realDt) so the sky keeps blending even while paused.
 *
 * World (world.js) creates scene / sun / hemi / fog / water; Env animates them.
 * Env writes World.sunDir (ground -> light) and World.skyColor (water reflection).
 *
 * Visuals are HDR (linear): an analytic sky with Mie glow, a limb-darkened sun,
 * a phased moon, stars + Milky Way and lit fbm clouds. The same sky is rendered
 * into a PMREM environment map (ambient light + reflections, refreshed a few
 * times per second). Env also drives the shared shader uniforms (GM.Gfx: sun,
 * sky, height fog, wetness, snow cover, cloud shadows) and the post grade
 * (GM.Post: exposure, bloom, sun shafts, colour balance).
 */
(function () {
  'use strict';
  const GM = window.GM;
  const CFG = GM.CFG;
  const U = GM.U;
  const THREE = window.THREE;

  GM.i18n.add({
    en: {
      'log.env.dawn': 'The sun rises. Day {day} begins.',
      'log.env.dusk': 'The sun goes down. Night falls on the arena.',
      'log.env.weather.clear': 'The weather clears up.',
      'log.env.weather.rain': 'It starts to rain.',
      'log.env.weather.fog': 'Thick fog covers the arena.',
      'log.env.weather.storm': 'A storm hits the arena. Watch out for lightning!',
      'log.env.weather.snow': 'Snow starts to fall. It is getting cold.',
      'log.env.weather.heat': 'A heat wave hits the arena. Water is precious now.',
      'ann.env.day': 'Day {day}',
      'ann.env.storm': 'A storm is coming!',
    },
    hu: {
      'log.env.dawn': 'Felkelt a nap. Új nap kezdődik ({day}. nap).',
      'log.env.dusk': 'Lement a nap. Leszállt az éjszaka az arénára.',
      'log.env.weather.clear': 'Kitisztult az idő.',
      'log.env.weather.rain': 'Eleredt az eső.',
      'log.env.weather.fog': 'Sűrű köd lepte el az arénát.',
      'log.env.weather.storm': 'Vihar tört ki. Vigyázz, villámlik!',
      'log.env.weather.snow': 'Havazni kezdett. Egyre hidegebb van.',
      'log.env.weather.heat': 'Hőség van az arénában. A víz most nagyon értékes.',
      'ann.env.day': '{day}. nap',
      'ann.env.storm': 'Vihar közeleg!',
    },
  });

  const TYPES = ['clear', 'rain', 'storm', 'fog', 'snow', 'heat'];
  const WVIS = { clear: 1, rain: 0.75, storm: 0.55, fog: 0.3, snow: 0.6, heat: 0.9 };
  const WMOVE = { clear: 1, rain: 0.95, storm: 0.85, fog: 1, snow: 0.8, heat: 0.92 };
  const WIND_RANGE = { clear: [1, 4], rain: [3.5, 7], storm: [10, 16], fog: [0.3, 1.5], snow: [2.5, 6], heat: [0.8, 2.5] };
  const NATURAL_DUR = { rain: [70, 140], fog: [60, 120], storm: [50, 100], snow: [70, 130], heat: [80, 150] };
  const DAY_SPAN = CFG.DUSK - CFG.DAWN;

  const Env = (GM.Env = {
    timeOfDay: CFG.START_TIME_OF_DAY,
    weather: 'clear',
    wind: { x: 1.2, z: 0.7 },
    waterLevel: CFG.BASE_WATER_LEVEL,
  });

  // ------------------------------------------------------------ state
  // arena theme (js/arenas.js): natural weather odds, minimum snow cover / wetness (set by applyArena)
  let themeWeather = { rain: 1, fog: 1, storm: 1, snow: 1, heat: 1 };
  let snowFloor = 0, wetFloor = 0;
  let weatherLeft = 0;          // sim s until the current non-clear weather ends
  let weatherNatural = false;   // current weather came from the natural cycle
  let nextNatural = 200;        // sim s of clear sky before the next natural change
  let stormNext = 5;            // sim s until the next natural lightning strike
  let windAng = 0.5, windSpd = 2, windTargetAng = 0.5, windTargetSpd = 2, windTimer = 0;
  // water tween
  let wActive = false, wFrom = 0, wTo = 0, wDur = 0, wT = 0, wEmitT = 0, wLastEmitted = CFG.BASE_WATER_LEVEL;

  function rng() { return GM.R && typeof GM.R.random === 'function' ? GM.R : null; }
  function rr(a, b) { const R = rng(); return R ? R.range(a, b) : a + (b - a) * Math.random(); }
  function frac(x) { return x - Math.floor(x); }

  // ------------------------------------------------------------ clock
  /** Sun angle along its path: 0 at DAWN (rising), PI at DUSK (setting), 2PI next dawn. */
  function sunAngle(tod) {
    const d = frac(tod - CFG.DAWN);
    if (d < DAY_SPAN) return Math.PI * d / DAY_SPAN;
    return Math.PI + Math.PI * (d - DAY_SPAN) / (1 - DAY_SPAN);
  }
  function daylightOf(elev) { return U.smoothstep(-0.14, 0.32, elev); }

  /** True between dusk and dawn. */
  Env.isNight = function () {
    const t = GM.state.timeOfDay;
    return t < CFG.DAWN || t > CFG.DUSK;
  };
  /** Smooth light factor 0 (night) .. 1 (full day). */
  Env.daylight = function () { return daylightOf(Math.sin(sunAngle(GM.state.timeOfDay))); };
  /** i18n key of the current part of the day. */
  Env.phaseKey = function () {
    const t = GM.state.timeOfDay;
    if (t < CFG.DAWN - 0.02 || t > CFG.DUSK + 0.03) return 'tod.night';
    if (t < CFG.DAWN + 0.05) return 'tod.dawn';
    if (t > CFG.DUSK - 0.04) return 'tod.dusk';
    return 'tod.day';
  };

  function distFwd(from, b) { const d = frac(b - from); return d <= 0 ? 1 : d; }

  function fireDawn() {
    const st = GM.state;
    st.day = (st.day | 0) + 1;
    GM.emit('day:start', { day: st.day });
    GM.log('event', 'log.env.dawn', { day: st.day }, { important: true });
    GM.announce('ann.env.day', { day: st.day }, { style: 'info', duration: 3 });
  }
  function fireDusk() {
    const st = GM.state;
    GM.emit('night:start', { day: st.day });
    GM.log('event', 'log.env.dusk', { day: st.day }, {});
  }

  /** Move the clock forward by delta (0..1 of a day), firing dawn/dusk events in order when asked. */
  function advanceClock(delta, events) {
    const st = GM.state;
    const t0 = st.timeOfDay;
    if (events && delta > 0) {
      const dDawn = distFwd(t0, CFG.DAWN), dDusk = distFwd(t0, CFG.DUSK);
      const firstDawn = dDawn <= dDusk;
      for (let k = 0; k < 2; k++) {
        const isDawn = (k === 0) === firstDawn;
        const dist = isDawn ? dDawn : dDusk;
        if (dist > delta) continue;
        st.timeOfDay = isDawn ? CFG.DAWN : CFG.DUSK;
        Env.timeOfDay = st.timeOfDay;
        try { if (isDawn) fireDawn(); else fireDusk(); } catch (e) { GM.reportError('Env.clock', e); }
      }
    }
    st.timeOfDay = frac(t0 + delta);
    Env.timeOfDay = st.timeOfDay;
  }

  /**
   * Jump to a time of day (0..1), always forward (time-skip power).
   * Crossing dawn / dusk fires 'day:start' / 'night:start' while the games run.
   */
  Env.setTimeOfDay = function (tod) {
    tod = +tod;
    if (tod !== tod) return;
    tod = frac(tod);
    const st = GM.state;
    const delta = frac(tod - st.timeOfDay);
    if (delta <= 1e-9) return;
    advanceClock(delta, st.phase === 'running');
    st.timeOfDay = tod;
    Env.timeOfDay = tod;
    envForce = true;       // re-light the environment map right away
  };

  // ------------------------------------------------------------ weather
  function retargetWind() {
    const r = WIND_RANGE[Env.weather] || WIND_RANGE.clear;
    windTargetSpd = rr(r[0], r[1]);
    windTargetAng += rr(-0.9, 0.9);
    windTimer = rr(15, 40);
  }

  function applyWeather(type, duration, natural, log) {
    const prev = Env.weather;
    if (type === 'clear') {
      weatherLeft = 0;
      nextNatural = rr(150, 320);
    } else {
      weatherLeft = Math.max(5, duration);
    }
    weatherNatural = !!natural;
    if (type === prev) return;
    Env.weather = type;
    if (type === 'storm') stormNext = rr(3, 8);
    retargetWind();
    GM.emit('weather:changed', { type: type, prev: prev });
    if (log) {
      GM.log('event', 'log.env.weather.' + type, {}, { important: type === 'storm' });
      if (type === 'storm') GM.announce('ann.env.storm', {}, { style: 'danger', duration: 3 });
    }
  }

  /** Change the weather for `duration` sim seconds (default 90), then back to clear. */
  Env.setWeather = function (type, duration) {
    if (TYPES.indexOf(type) < 0) return false;
    const d = duration == null ? 90 : +duration;
    applyWeather(type, d === d && d > 0 ? d : 90, false, false);
    return true;
  };

  function pickNatural() {
    const night = Env.isNight();
    const R = rng();
    const tw = themeWeather;
    const w = {
      rain: 4 * tw.rain,
      fog: (night || Math.abs(GM.state.timeOfDay - CFG.DAWN) < 0.06 ? 3 : 1.4) * tw.fog,
      storm: 1.1 * tw.storm,
      snow: (night ? 0.7 : 0.25) * tw.snow,
      heat: (night ? 0 : 0.6) * tw.heat,
    };
    if (R && typeof R.weighted === 'function') {
      try { const k = R.weighted(w); if (NATURAL_DUR[k]) return k; } catch (e) { /* fall through */ }
    }
    let sum = 0;
    for (const k in w) sum += w[k];
    let x = (R ? R.random() : Math.random()) * sum;
    for (const k in w) { x -= w[k]; if (x <= 0) return k; }
    return 'rain';
  }

  function updateWeather(dt) {
    if (Env.weather !== 'clear') {
      weatherLeft -= dt;
      if (weatherLeft <= 0) applyWeather('clear', 0, true, true);
    } else {
      nextNatural -= dt;
      if (nextNatural <= 0) {
        const type = pickNatural();
        const r = NATURAL_DUR[type];
        applyWeather(type, rr(r[0], r[1]), true, true);
      }
    }
    if (Env.weather === 'storm') {
      stormNext -= dt;
      if (stormNext <= 0) {
        stormNext = rr(10, 25);
        naturalLightning();
      }
    }
  }

  function naturalLightning() {
    const T = GM.Terrain;
    let p = null;
    if (T && typeof T.randomLandPoint === 'function') {
      try { p = T.randomLandPoint({ maxR: CFG.ARENA_RADIUS - 8 }); } catch (e) { p = null; }
    }
    if (!p) {
      const a = rr(0, Math.PI * 2), r = Math.sqrt(rr(0, 1)) * (CFG.ARENA_RADIUS - 10);
      p = { x: Math.sin(a) * r, z: Math.cos(a) * r };
    }
    const H = GM.Hazards;
    if (H && typeof H.lightning === 'function') {
      try { H.lightning(p, { natural: true }); } catch (e) { GM.reportError('Env.lightning', e); }
    } else {
      skyFlash(1);
    }
  }

  function updateWind(dt) {
    windTimer -= dt;
    if (windTimer <= 0) retargetWind();
    const storm = Env.weather === 'storm';
    windAng = U.lerpAngle(windAng, windTargetAng, Math.min(1, dt * (storm ? 0.25 : 0.06)));
    windSpd = U.damp(windSpd, windTargetSpd, storm ? 0.5 : 0.12, dt);
    const gust = storm ? 1 + 0.25 * Math.sin(GM.state.time * 1.7) * Math.sin(GM.state.time * 0.63) : 1;
    Env.wind.x = Math.sin(windAng) * windSpd * gust;
    Env.wind.z = Math.cos(windAng) * windSpd * gust;
  }

  /** Sight multiplier for the AI (0.15..1). Goggles are handled by the AI. */
  Env.visibility = function () {
    const v = U.lerp(0.45, 1, Env.daylight()) * (WVIS[Env.weather] || 1);
    return U.clamp(v, 0.15, 1);
  };
  /** 'cold' | 'normal' | 'hot'. */
  Env.temperature = function () {
    const w = Env.weather;
    if (w === 'snow') return 'cold';
    const night = Env.isNight();
    if (w === 'heat') return night ? 'normal' : 'hot';
    return night ? 'cold' : 'normal';
  };
  /** Movement multiplier 0.7..1 (snow, storm, rain, heat). */
  Env.moveFactor = function () { return WMOVE[Env.weather] || 1; };

  // ------------------------------------------------------------ water
  function emitWater() {
    wLastEmitted = Env.waterLevel;
    GM.emit('water:changed', { level: Env.waterLevel });
  }
  /** Smoothly move the water surface to y over `seconds` sim seconds (0 = now). */
  Env.setWaterLevel = function (y, seconds) {
    y = +y;
    if (y !== y) return;
    y = U.clamp(y, CFG.BASE_WATER_LEVEL - 12, CFG.BASE_WATER_LEVEL + 60);
    const s = Math.max(0, +seconds || 0);
    if (s <= 0) {
      wActive = false;
      Env.waterLevel = y;
      if (Math.abs(y - wLastEmitted) > 1e-4) emitWater();
      return;
    }
    wFrom = Env.waterLevel; wTo = y; wDur = s; wT = 0; wEmitT = 0; wActive = true;
  };
  function tickWater(dt) {
    if (!wActive) return;
    wT += dt;
    const k = Math.min(1, wT / wDur);
    Env.waterLevel = wFrom + (wTo - wFrom) * (k * k * (3 - 2 * k));
    wEmitT += dt;
    if (k >= 1) {
      wActive = false;
      Env.waterLevel = wTo;
      emitWater();
    } else if (wEmitT >= 0.6 && Math.abs(Env.waterLevel - wLastEmitted) > 0.05) {
      wEmitT = 0;
      emitWater();
    }
  }

  // ================================================================ visuals
  // HDR, linear colours. The sky shader also feeds: the image-based light
  // (a PMREM environment rendered from the same sky), the fog colour, the
  // shared sun/sky uniforms (gfx.js) and the post-processing grade (post.js).
  const V = { ready: false };
  let flash = 0, flash2At = -1, flash2S = 0, flickerT = 6;
  let precipT = 0, cloudX = 0, cloudZ = 0;
  let wetness = 0, snowCover = 0;
  let envTimer = 0, envForce = true;
  const WW = { clear: 1, rain: 0, storm: 0, fog: 0, snow: 0, heat: 0 };   // blended weather weights

  /** Surface state (debug / tests): wetness and snow cover 0..1 (null keeps the value). */
  Env.setSurface = function (wet, snow) {
    if (wet != null && wet === +wet) wetness = U.clamp01(wet);
    if (snow != null && snow === +snow) snowCover = U.clamp01(snow);
  };
  /** Current surface state {wet, snow}. */
  Env.surface = function () { return { wet: wetness, snow: snowCover }; };

  /** Light up the sky for a moment (lightning). strength 0..1.5 */
  function skyFlash(s) {
    s = +s || 1;
    flash = Math.max(flash, s);
    flash2At = 0.09 + Math.random() * 0.12;
    flash2S = s * (0.5 + Math.random() * 0.4);
  }
  Env.skyFlash = skyFlash;

  if (THREE) {
    const C = function (h) { return new THREE.Color(h); };
    // authored as sRGB hex (converted to linear by THREE.Color); multiplied into HDR below
    V.col = {
      dayZen: C(0x3f7fd6), dayHor: C(0xa8cdf0), twiZen: C(0x2c3f86), twiHor: C(0xf2a068), glow: C(0xff8a3c),
      nightZen: C(0x03081c), nightHor: C(0x101d3e),
      overDay: C(0x98a2ad), overNight: C(0x1a2030),
      fogDay: C(0xb4bcc4), fogNight: C(0x243048),
      heat: C(0xf2d4a0), heatZen: C(0x7fa6d2),
      sunNoon: C(0xfff1dc), sunLow: C(0xffa04a), sunHeat: C(0xffcf8a), sunGrey: C(0xd9dfe6),
      discNoon: C(0xfff6e6), discLow: C(0xffa050),
      moon: C(0x93adf2),
      gndDay: C(0x3c4230), gndNight: C(0x05070c),
      cloudD: C(0xffffff), cloudN: C(0x2a3552), cloudTwi: C(0xffa07a),
      shadeD: C(0x7d8aa0), shadeN: C(0x0c1222), shadeTwi: C(0x5a4a6a),
      rainD: C(0xb4c4d6), rainN: C(0x56657e), snowD: C(0xf4f7ff), snowN: C(0x9aa8c6),
    };
    V.baseCol = {};                                  // the classic palette, restored whenever an arena theme leaves
    for (const k in V.col) V.baseCol[k] = V.col[k].clone();
    V.zen = C(0); V.hor = C(0); V.over = C(0); V.tmp = C(0); V.fog = C(0); V.cloud = C(0); V.shade = C(0); V.disc = C(0);
    V.gnd = C(0); V.sunC = C(0);
    V.sunDir = new THREE.Vector3(); V.moonDir = new THREE.Vector3(); V.lightDir = new THREE.Vector3();
  }

  const SKY_VS = [
    'varying vec3 vDir;',
    'void main() {',
    '  vDir = position;',
    '  vec4 p = viewMatrix * vec4( position, 0.0 );',
    '  gl_Position = projectionMatrix * vec4( p.xyz, 1.0 );',
    '  gl_Position.z = gl_Position.w * 0.99999;',
    '}',
  ].join('\n');
  const SKY_FS = [
    '#include <common>',
    '#include <gm_common>',
    'uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround;',
    'uniform vec3 uGlow; uniform float uTwi;',
    'uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uSunVis;',
    'uniform vec3 uMoonDir; uniform float uMoonVis; uniform float uMoonPhase;',
    'uniform float uCloud; uniform vec3 uCloudCol; uniform vec3 uCloudShade; uniform vec2 uCloudOff;',
    'uniform float uFlash; uniform float uHaze; uniform vec3 uHazeCol;',
    'uniform float uStars; uniform float uTime;',
    'uniform vec4 uFogSky;',      // x horizon haze strength
    'varying vec3 vDir;',
    'float cloudField( vec2 p ) {',
    '  float w = texture2D( gmNoise, p * 0.043 ).g;',
    '  float n = texture2D( gmNoise, p * 0.11 + w * 0.35 ).r * 0.58;',
    '  n += texture2D( gmNoise, p * 0.29 - w * 0.2 + 0.37 ).g * 0.28;',
    '  n += texture2D( gmNoise, p * 0.83 + 0.71 ).b * 0.14;',
    '  return n;',
    '}',
    'float starField( vec3 d ) {',
    '  vec3 q = d * 260.0;',
    '  vec3 c = floor( q );',
    '  vec3 f = fract( q ) - 0.5;',
    '  float h = fract( sin( dot( c, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 );',
    '  if ( h < 0.9965 ) return 0.0;',
    '  vec3 o = vec3( fract( h * 17.0 ), fract( h * 31.0 ), fract( h * 47.0 ) ) - 0.5;',
    '  float r = length( f - o * 0.6 );',
    '  float b = pow( fract( h * 7919.0 ), 3.0 ) * 2.5 + 0.35;',
    '  float tw = 0.7 + 0.3 * sin( uTime * ( 1.5 + fract( h * 91.0 ) * 3.0 ) + h * 60.0 );',
    '  return smoothstep( 0.14, 0.0, r ) * b * tw;',
    '}',
    'void main() {',
    '  vec3 d = normalize( vDir );',
    '  float h = d.y;',
    '  float up = clamp( h, 0.0, 1.0 );',
    '  vec3 col = mix( uHorizon, uZenith, pow( up, 0.42 ) );',
    '  float cosS = dot( d, uSunDir );',
    '  float fwd = max( cosS, 0.0 );',
    // Mie forward scattering glow + horizon twilight band towards the sun
    '  col += uGlow * ( pow( fwd, 5.0 ) * 0.28 + pow( fwd, 36.0 ) * 0.9 ) * uSunVis;',
    '  vec2 sxz = uSunDir.xz; float sl = length( sxz );',
    '  vec2 dxz = d.xz; float dl = length( dxz );',
    '  float az = ( sl > 1e-4 && dl > 1e-4 ) ? clamp( dot( dxz / dl, sxz / sl ) * 0.5 + 0.5, 0.0, 1.0 ) : 0.5;',
    '  col += uGlow * uTwi * pow( az, 2.5 ) * exp( -abs( h ) * 7.0 );',
    '  col = mix( col, uHazeCol, clamp( uHaze * exp( -max( h, 0.0 ) * 3.0 ), 0.0, 1.0 ) );',
    // night: stars and the Milky Way
    '  #ifndef ENV_CUBE',
    '  if ( uStars > 0.01 && h > 0.0 ) {',
    '    vec3 bn = normalize( vec3( 0.35, 0.55, 0.75 ) );',
    '    float band = exp( -pow( dot( d, bn ), 2.0 ) * 18.0 );',
    '    vec2 mp = vec2( atan( d.x, d.z ), d.y ) * 3.0;',
    '    float mw = texture2D( gmNoise, mp * 0.35 ).r * texture2D( gmNoise, mp * 1.1 + 0.3 ).g;',
    '    col += vec3( 0.45, 0.5, 0.75 ) * band * mw * 0.35 * uStars;',
    '    col += vec3( 0.9, 0.93, 1.0 ) * starField( d ) * uStars * ( 1.0 + band * 1.5 ) * smoothstep( 0.0, 0.15, h );',
    '  }',
    '  #endif',
    '  float above = smoothstep( -0.03, 0.012, h );',
    // moon with phase shading
    '  float md = dot( d, uMoonDir );',
    '  col += vec3( 0.25, 0.32, 0.55 ) * ( pow( max( md, 0.0 ), 60.0 ) * 0.5 + pow( max( md, 0.0 ), 8.0 ) * 0.05 ) * uMoonVis;',
    '  #ifndef ENV_CUBE',
    '  if ( md > 0.9985 ) {',
    '    vec3 mr = normalize( cross( uMoonDir, vec3( 0.0, 1.0, 0.0 ) ) );',
    '    vec3 mu = cross( mr, uMoonDir );',
    '    vec2 mq = vec2( dot( d - uMoonDir, mr ), dot( d - uMoonDir, mu ) ) / 0.0265;',
    '    float mrr = length( mq );',
    '    if ( mrr < 1.0 ) {',
    '      vec3 sn = vec3( mq, sqrt( 1.0 - mrr * mrr ) );',
    '      vec3 ld = normalize( vec3( cos( uMoonPhase ), 0.15, sin( uMoonPhase ) ) );',
    '      float lit = smoothstep( -0.05, 0.12, dot( sn, ld ) );',
    '      float crater = 0.72 + 0.28 * texture2D( gmNoise, mq * 0.35 + 0.5 ).r;',
    '      vec3 mc = vec3( 0.95, 0.96, 1.0 ) * crater * ( 0.05 + 1.6 * lit );',
    '      col = mix( col, mc * 1.4, smoothstep( 1.0, 0.94, mrr ) * uMoonVis * above );',
    '    }',
    '  }',
    // sun disc (HDR, limb darkened)
    '  float sunR = 0.99958;',
    '  if ( cosS > sunR - 0.0004 ) {',
    '    float k = smoothstep( sunR - 0.0004, sunR + 0.00008, cosS );',
    '    float limb = 0.6 + 0.4 * smoothstep( sunR, 1.0, cosS );',
    '    col = mix( col, uSunCol * 28.0 * limb, k * uSunVis * above );',
    '  }',
    '  #endif',
    // clouds: fbm layer projected on a dome, lit from the sun side
    '  if ( uCloud > 0.01 && h > -0.02 ) {',
    '    float hc = max( h, 0.0 );',
    '    vec2 p = d.xz / ( hc + 0.1 ) * 0.62 + uCloudOff;',
    '    float n = cloudField( p );',
    '    float lo = 1.0 - uCloud;',
    '    float dens = smoothstep( lo, lo + 0.32, n );',
    '    vec2 sdir = uSunDir.xz / max( length( uSunDir.xz ), 1e-3 );',
    '    float n2 = cloudField( p + sdir * 0.18 );',
    '    float dens2 = smoothstep( lo, lo + 0.32, n2 );',
    '    float light = clamp( 0.62 + ( dens - dens2 ) * 2.2 - dens * 0.35, 0.0, 1.0 );',
    '    vec3 cc = mix( uCloudShade, uCloudCol, light );',
    '    cc += uGlow * pow( fwd, 8.0 ) * ( 1.0 - dens ) * 1.8 * uSunVis;',
    '    float fadeH = smoothstep( -0.02, 0.16, h );',
    '    col = mix( col, cc, dens * fadeH * 0.96 );',
    '  }',
    // haze toward the horizon (matches the fog colour + sun in-scatter)
    '  float hz = uFogSky.x * exp( -max( h, 0.0 ) * 9.0 );',
    '  col = mix( col, gmFogTintSky( d ), clamp( hz, 0.0, 1.0 ) );',
    '  col = mix( col, uGround, smoothstep( 0.0, -0.1, h ) );',
    '  col += uFlash * vec3( 0.7, 0.78, 1.0 ) * ( 0.4 + 0.9 * up );',
    '  #ifdef ENV_CUBE',
    // ambient light: less saturated than the visible sky (haze, multiple bounces)
    '  float el = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );',
    '  col = mix( vec3( el ), col, 0.55 );',
    // never let a non-finite value into the environment map (comparisons with NaN are false)
    '  if ( !( col.r >= 0.0 && col.r < 60000.0 ) ) col.r = 0.0;',
    '  if ( !( col.g >= 0.0 && col.g < 60000.0 ) ) col.g = 0.0;',
    '  if ( !( col.b >= 0.0 && col.b < 60000.0 ) ) col.b = 0.0;',
    '  #endif',
    '  gl_FragColor = vec4( col, 1.0 );',
    '}',
  ].join('\n');

  // shared by rain (lines) and snow (points): world-anchored drops wrapped in a box around the camera
  const PRECIP_COMMON = [
    'uniform vec3 uCenter; uniform vec3 uBox; uniform vec3 uVel;',
    'uniform float uTime; uniform float uDensity; uniform float uAlpha;',
    'varying float vA;',
  ].join('\n');
  const RAIN_VS = [
    PRECIP_COMMON,
    'attribute float aEnd;',
    'uniform float uLen;',
    'void main() {',
    '  float rank = fract( position.x * 91.37 + position.z * 47.13 + position.y * 13.7 );',
    '  if ( rank > uDensity ) { vA = 0.0; gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); return; }',
    '  float spd = 0.8 + 0.4 * fract( rank * 7.31 );',
    '  vec3 w = position * uBox + uVel * ( uTime * spd );',
    '  vec3 rel = mod( w - uCenter + 0.5 * uBox, uBox ) - 0.5 * uBox;',
    '  vec3 p = uCenter + rel - normalize( uVel ) * ( uLen * aEnd * spd );',
    '  vA = uAlpha * ( 1.0 - aEnd * 0.9 ) * ( 0.5 + 0.5 * fract( rank * 3.7 ) ) * ( 1.0 - smoothstep( 0.2, 0.5, length( rel.xz ) / uBox.x ) );',
    '  gl_Position = projectionMatrix * viewMatrix * vec4( p, 1.0 );',
    '}',
  ].join('\n');
  const SNOW_VS = [
    PRECIP_COMMON,
    'uniform float uSize; uniform float uPix;',
    'void main() {',
    '  float rank = fract( position.x * 91.37 + position.z * 47.13 + position.y * 13.7 );',
    '  if ( rank > uDensity ) { vA = 0.0; gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); gl_PointSize = 1.0; return; }',
    '  float spd = 0.75 + 0.5 * fract( rank * 7.31 );',
    '  vec3 w = position * uBox + uVel * ( uTime * spd );',
    '  w.x += sin( uTime * 1.1 + position.y * 40.0 ) * 0.8;',
    '  w.z += cos( uTime * 0.9 + position.x * 40.0 ) * 0.8;',
    '  vec3 rel = mod( w - uCenter + 0.5 * uBox, uBox ) - 0.5 * uBox;',
    '  vec4 mv = viewMatrix * vec4( uCenter + rel, 1.0 );',
    '  gl_Position = projectionMatrix * mv;',
    '  gl_PointSize = clamp( uSize * uPix / max( 0.5, -mv.z ), 1.0, 16.0 );',
    '  vA = uAlpha * ( 1.0 - smoothstep( 0.3, 0.5, length( rel.xz ) / uBox.x ) );',
    '}',
  ].join('\n');
  const RAIN_FS = [
    'uniform vec3 uColor;',
    'varying float vA;',
    'void main() { gl_FragColor = vec4( uColor, vA ); }',
  ].join('\n');
  const SNOW_FS = [
    'uniform vec3 uColor;',
    'varying float vA;',
    'void main() {',
    '  vec2 c = gl_PointCoord - 0.5;',
    '  float a = smoothstep( 0.25, 0.03, dot( c, c ) ) * vA;',
    '  if ( a < 0.01 ) discard;',
    '  gl_FragColor = vec4( uColor, a );',
    '}',
  ].join('\n');
  // rain splashes: expanding rings on the ground around the camera
  const SPLASH_VS = [
    'attribute vec4 aSplash;',      // xyz ground position, w phase
    'uniform float uTime; uniform float uPix; uniform float uAlpha;',
    'varying float vA; varying float vK;',
    'void main() {',
    '  float k = fract( uTime * 1.9 + aSplash.w );',
    '  vK = k;',
    '  vec4 mv = viewMatrix * vec4( aSplash.xyz + vec3( 0.0, 0.03, 0.0 ), 1.0 );',
    '  gl_Position = projectionMatrix * mv;',
    '  gl_PointSize = clamp( ( 0.08 + 0.3 * k ) * uPix / max( 0.5, -mv.z ), 1.0, 22.0 );',
    '  vA = uAlpha * ( 1.0 - k ) * ( 1.0 - smoothstep( 14.0, 22.0, -mv.z ) );',
    '}',
  ].join('\n');
  const SPLASH_FS = [
    'uniform vec3 uColor;',
    'varying float vA; varying float vK;',
    'void main() {',
    '  vec2 c = ( gl_PointCoord - 0.5 ) * vec2( 1.0, 2.6 );',
    '  float r = length( c ) * 2.0;',
    '  float ring = smoothstep( 0.55, 0.8, r ) * ( 1.0 - smoothstep( 0.8, 1.0, r ) );',
    '  float a = ( ring + ( 1.0 - vK ) * smoothstep( 0.4, 0.0, r ) * 0.6 ) * vA;',
    '  if ( a < 0.01 ) discard;',
    '  gl_FragColor = vec4( uColor, a );',
    '}',
  ].join('\n');

  const RAIN_MAX = 3600, RAIN_LOW = 1400, SNOW_MAX = 2800, SNOW_LOW = 1100, SPLASH_MAX = 520;

  function isLow() { const s = GM.state.settings; return !!(s && s.quality === 'low'); }

  function skyUniforms() {
    return {
      uZenith: { value: new THREE.Color(0x2e6cc2) }, uHorizon: { value: new THREE.Color(0xb3d5ef) },
      uGround: { value: new THREE.Color(0x303828) }, uGlow: { value: new THREE.Color(0xff7b30) }, uTwi: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(0xfff8e8) }, uSunVis: { value: 1 },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) }, uMoonVis: { value: 0 }, uMoonPhase: { value: 1 },
      uCloud: { value: 0.28 }, uCloudCol: { value: new THREE.Color(0xf2f4f8) }, uCloudShade: { value: new THREE.Color(0x8090a0) },
      uCloudOff: { value: new THREE.Vector2() },
      uFlash: { value: 0 }, uHaze: { value: 0 }, uHazeCol: { value: new THREE.Color(0xb0b8bf) },
      uStars: { value: 0 }, uTime: { value: 0 }, uFogSky: { value: new THREE.Vector4(0.8, 0, 0, 0) },
    };
  }

  function buildVisuals() {
    const W = GM.World;
    if (!THREE || !W || !W.scene || !GM.Gfx) return;
    const scene = W.scene;
    const Gfx = GM.Gfx;
    // the sky needs the fog tint function with a "sky" variant (no fog uniforms from THREE.Fog)
    const skyFS = SKY_FS.replace('varying vec3 vDir;', 'varying vec3 vDir;\n' + Gfx.FOG_FUNCS +
      '\nvec3 gmFogTintSky( vec3 d ) { return gmFogTint( d, uHorizon ); }');
    const own = skyUniforms();
    const skyMat = new THREE.ShaderMaterial({
      uniforms: Gfx.uniformsWith(own, false),
      vertexShader: SKY_VS,
      fragmentShader: skyFS,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    for (const k of ['gmFogA', 'gmFogB', 'gmFogSun', 'gmFogSunCol']) skyMat.uniforms[k] = Gfx.uniforms[k];
    const sky = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), skyMat);
    sky.name = 'skyDome';
    sky.frustumCulled = false;
    sky.renderOrder = -1000;
    sky.matrixAutoUpdate = false;
    scene.add(sky);
    V.sky = sky;
    V.su = own;

    // ---- image based lighting: the same sky (no sun disc / stars) rendered into a cube, then PMREM
    try {
      const envMat = skyMat.clone();
      envMat.uniforms = skyMat.uniforms;          // share the uniform objects
      envMat.defines = { ENV_CUBE: '' };
      envMat.depthTest = false;
      const envScene = new THREE.Scene();
      const envSky = new THREE.Mesh(sky.geometry, envMat);
      envSky.frustumCulled = false;
      envScene.add(envSky);
      const cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: false });
      const cubeCam = new THREE.CubeCamera(0.1, 100, cubeRT);
      envScene.add(cubeCam);
      V.envScene = envScene;
      V.cubeRT = cubeRT;
      V.cubeCam = cubeCam;
      V.pmrem = new THREE.PMREMGenerator(W.renderer);
      V.envRT = null;
    } catch (e) {
      GM.reportError('Env.ibl', e);
      V.pmrem = null;
    }

    // ---- rain streaks
    const rp = new Float32Array(RAIN_MAX * 6), re = new Float32Array(RAIN_MAX * 2);
    for (let i = 0; i < RAIN_MAX; i++) {
      const x = Math.random(), y = Math.random(), z = Math.random();
      rp[i * 6] = rp[i * 6 + 3] = x; rp[i * 6 + 1] = rp[i * 6 + 4] = y; rp[i * 6 + 2] = rp[i * 6 + 5] = z;
      re[i * 2] = 0; re[i * 2 + 1] = 1;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    rg.setAttribute('aEnd', new THREE.BufferAttribute(re, 1));
    const rainMat = new THREE.ShaderMaterial({
      uniforms: {
        uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(50, 32, 50) }, uVel: { value: new THREE.Vector3(0, -22, 0) },
        uTime: { value: 0 }, uDensity: { value: 0 }, uAlpha: { value: 0 }, uLen: { value: 1.6 }, uColor: { value: new THREE.Color(0xaebfd2) },
      },
      vertexShader: RAIN_VS,
      fragmentShader: RAIN_FS,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const rain = new THREE.LineSegments(rg, rainMat);
    rain.name = 'rain';
    rain.frustumCulled = false;
    rain.renderOrder = 8;
    rain.visible = false;
    scene.add(rain);
    V.rain = rain;

    // ---- splashes
    const sp = new Float32Array(SPLASH_MAX * 4);
    for (let i = 0; i < SPLASH_MAX; i++) sp[i * 4 + 3] = Math.random();
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPLASH_MAX * 3), 3));
    sg.setAttribute('aSplash', new THREE.BufferAttribute(sp, 4).setUsage(THREE.DynamicDrawUsage));
    const splashMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPix: { value: 800 }, uAlpha: { value: 0 }, uColor: { value: new THREE.Color(0xc8d4e2) } },
      vertexShader: SPLASH_VS,
      fragmentShader: SPLASH_FS,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const splash = new THREE.Points(sg, splashMat);
    splash.name = 'rainSplash';
    splash.frustumCulled = false;
    splash.renderOrder = 8;
    splash.visible = false;
    scene.add(splash);
    V.splash = splash;
    V.splashCycle = new Float32Array(SPLASH_MAX).fill(-1);

    // ---- snow flakes
    const np = new Float32Array(SNOW_MAX * 3);
    for (let i = 0; i < np.length; i++) np[i] = Math.random();
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.BufferAttribute(np, 3));
    const snowMat = new THREE.ShaderMaterial({
      uniforms: {
        uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(70, 40, 70) }, uVel: { value: new THREE.Vector3(0, -2.2, 0) },
        uTime: { value: 0 }, uDensity: { value: 0 }, uAlpha: { value: 0 }, uSize: { value: 0.14 }, uPix: { value: 800 },
        uColor: { value: new THREE.Color(0xf4f7ff) },
      },
      vertexShader: SNOW_VS,
      fragmentShader: SNOW_FS,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const snow = new THREE.Points(ng, snowMat);
    snow.name = 'snow';
    snow.frustumCulled = false;
    snow.renderOrder = 8;
    snow.visible = false;
    scene.add(snow);
    V.snow = snow;

    V.ready = true;
    envForce = true;
  }

  function snapWeights() {
    for (let i = 0; i < TYPES.length; i++) WW[TYPES[i]] = TYPES[i] === Env.weather ? 1 : 0;
    envForce = true;
  }

  const _cam = { x: 0, y: 30, z: 0 };
  function cameraPos() {
    const Cm = GM.Cameras;
    const c = Cm && Cm.main;
    if (c && c.position) { _cam.x = c.position.x; _cam.y = c.position.y; _cam.z = c.position.z; }
    else { _cam.x = 0; _cam.y = 30; _cam.z = 0; }
    return _cam;
  }

  function setArr(a, c, k) { a[0] = c.r * k; a[1] = c.g * k; a[2] = c.b * k; }

  /** Re-render the sky into the environment map used for ambient + reflections (throttled). */
  function updateEnvMap(realDt, speed) {
    if (!V.pmrem || !V.cubeCam) return;
    envTimer -= realDt * Math.max(1, Math.min(4, speed || 1));
    if (!envForce && envTimer > 0) return;
    envTimer = 0.45;
    envForce = false;
    const W = GM.World, r = W.renderer;
    const prevTarget = r.getRenderTarget();
    const prevScissor = r.getScissorTest();
    r.setScissorTest(false);
    V.cubeCam.update(r, V.envScene);
    V.envRT = V.pmrem.fromCubemap(V.cubeRT.texture, V.envRT || null);
    if (W.scene.environment !== V.envRT.texture) W.scene.environment = V.envRT.texture;
    r.setRenderTarget(prevTarget);
    r.setScissorTest(prevScissor);
  }

  /** Recompute sky, lights, fog, grade and particles. Allocation-free. */
  function updateVisuals(realDt) {
    const W = GM.World;
    if (!V.ready || !W) return;
    const col = V.col;
    const st = GM.state;
    const paused = !!st.paused;
    const Gfx = GM.Gfx, SU = Gfx.uniforms;
    const P = GM.Post && GM.Post.settings;

    // blend weather weights (~2 s transitions; stays a one-hot sum of 1)
    const kb = Math.min(1, realDt * 0.6);
    for (let i = 0; i < TYPES.length; i++) {
      const k = TYPES[i];
      WW[k] += ((k === Env.weather ? 1 : 0) - WW[k]) * kb;
    }
    const wr = WW.rain, ws = WW.storm, wf = WW.fog, wn = WW.snow, wh = WW.heat, wc = WW.clear;
    const o = Math.min(1, wr * 0.72 + ws * 0.96 + wn * 0.7 + wf * 0.8);          // overcast amount
    const sunMul = wc + wr * 0.42 + ws * 0.28 + wf * 0.45 + wn * 0.55 + wh * 1.08;

    // wetness and snow cover build up and fade with sim time
    const simDt = paused || st.phase === 'setup' ? 0 : realDt * (st.speed || 1);
    const rainNow = wr + ws;
    if (rainNow > 0.3) wetness = Math.min(1, wetness + simDt / 35 * rainNow);
    else wetness = Math.max(0, wetness - simDt / (wh > 0.5 ? 40 : 110));
    if (wn > 0.3) snowCover = Math.min(1, snowCover + simDt / 55 * wn);
    else snowCover = Math.max(0, snowCover - simDt / (wh > 0.5 ? 30 : 140));
    if (snowCover < snowFloor) snowCover = snowFloor;           // frozen arenas stay white
    if (wetness < wetFloor) wetness = wetFloor;                 // marshes stay wet

    // flashes
    if (flash2At > 0) { flash2At -= realDt; if (flash2At <= 0) { flash = Math.max(flash, flash2S); flash2At = -1; } }
    flash = Math.max(0, flash - realDt * 5);
    if (!paused && ws > 0.5 && (st.phase === 'running' || st.phase === 'ended' || st.phase === 'countdown')) {
      flickerT -= realDt;
      if (flickerT <= 0) { flickerT = 4 + Math.random() * 8; skyFlash(0.35 + Math.random() * 0.35); }
    }

    // sun / moon
    const a = sunAngle(st.timeOfDay);
    const e = Math.sin(a);
    const d = daylightOf(e);
    const twi = 1 - U.smoothstep(0.0, 0.3, Math.abs(e + 0.03));
    const sunDir = V.sunDir.set(-Math.cos(a), Math.sin(a) * 0.92, 0.36).normalize();
    const moonDir = V.moonDir.set(Math.cos(a) * 0.9, -Math.sin(a) * 0.85, -0.32).normalize();
    const clearSky = (1 - 0.92 * o) * (1 - 0.9 * wf);

    // ---------------------------------------------------------- sky colours (HDR)
    const skyK = U.lerp(0.085, 1.25, d);                 // overall sky radiance
    const zen = V.zen.lerpColors(col.nightZen, col.dayZen, d).lerp(col.twiZen, twi * 0.4);
    const hor = V.hor.lerpColors(col.nightHor, col.dayHor, d).lerp(col.twiHor, twi * 0.55 * (1 - o));
    const over = V.over.lerpColors(col.overNight, col.overDay, d).multiplyScalar(1 - 0.4 * ws);
    zen.lerp(over, o * 0.92);
    hor.lerp(over, o);
    if (wh > 0.001) {
      hor.lerp(col.heat, wh * 0.45 * (0.3 + 0.7 * d));
      zen.lerp(col.heatZen, wh * 0.15 * d);
    }
    const fogGrey = V.tmp.lerpColors(col.fogNight, col.fogDay, d);
    if (wf > 0.001) { hor.lerp(fogGrey, wf * 0.92); zen.lerp(fogGrey, wf * 0.8); }
    const nightK = U.lerp(1, 0.9, d);
    const gloom = 1 - 0.4 * wr - 0.62 * ws - 0.15 * wn;       // rain and storms darken the whole sky
    zen.multiplyScalar(skyK * (1 - 0.3 * o) * nightK * gloom);
    hor.multiplyScalar(skyK * 1.08 * (1 - 0.22 * o) * nightK * gloom);
    const gnd = V.gnd.lerpColors(col.gndNight, col.gndDay, d).multiplyScalar(skyK * 0.9);
    if (snowCover > 0.01) gnd.lerp(V.tmp.setRGB(0.5, 0.52, 0.56).multiplyScalar(skyK), snowCover * 0.6);

    // sun colour + intensity (the directional light)
    const sunC = V.sunC;
    let sunI;
    if (e >= 0) {
      sunC.lerpColors(col.sunLow, col.sunNoon, U.smoothstep(0.03, 0.55, e));
      if (wh > 0.001) sunC.lerp(col.sunHeat, wh * 0.35);
      sunC.lerp(col.sunGrey, o * 0.6);
      // strongest in the golden hours relative to the sky; slightly softer at noon
      sunI = (3.2 - 0.5 * U.smoothstep(0.3, 0.9, e)) * U.smoothstep(0, 0.14, e) * sunMul;
    } else {
      sunC.copy(col.moon);
      sunI = 0.85 * U.smoothstep(0, 0.16, -e) * (0.4 + 0.6 * clearSky);
    }

    const su = V.su;
    su.uZenith.value.copy(zen);
    su.uHorizon.value.copy(hor);
    su.uGround.value.copy(gnd);
    const glowK = U.smoothstep(-0.08, 0.05, e) * (1 - o) * (1 - wf);
    su.uGlow.value.copy(col.glow).lerp(col.sunNoon, U.smoothstep(0.1, 0.6, e)).multiplyScalar((0.35 + 2.6 * twi) * glowK * U.lerp(0.6, 1.5, d));
    su.uTwi.value = twi * 0.55;
    su.uHaze.value = wh * 0.4 + wf * 0.65;
    su.uHazeCol.value.copy(hor);
    su.uSunDir.value.copy(sunDir);
    su.uSunCol.value.lerpColors(col.discLow, col.discNoon, U.smoothstep(0, 0.4, e));
    su.uSunVis.value = U.smoothstep(-0.05, 0.02, e) * clearSky;
    su.uMoonDir.value.copy(moonDir);
    su.uMoonVis.value = U.smoothstep(-0.02, 0.08, moonDir.y) * clearSky * (1 - d * 0.75);
    su.uMoonPhase.value = 0.6 + ((st.day | 0) % 8) * 0.55;
    su.uCloud.value = wc * 0.3 + wr * 0.8 + ws * 0.95 + wf * 0.6 + wn * 0.8 + wh * 0.1;
    const cloud = V.cloud.lerpColors(col.cloudN, col.cloudD, d).lerp(col.cloudTwi, twi * 0.55 * (1 - o));
    cloud.lerp(over, o * 0.75);
    cloud.multiplyScalar(U.lerp(0.05, 1.7, d) * (1 - 0.35 * ws));
    su.uCloudCol.value.copy(cloud);
    const shade = V.shade.lerpColors(col.shadeN, col.shadeD, d).lerp(col.shadeTwi, twi * 0.5 * (1 - o));
    shade.multiplyScalar(U.lerp(0.04, 0.95, d) * (1 - 0.45 * ws));
    su.uCloudShade.value.copy(shade);
    if (!paused) {
      cloudX += Env.wind.x * realDt * 0.0035;
      cloudZ += Env.wind.z * realDt * 0.0035;
      if (cloudX > 1000 || cloudX < -1000) cloudX = 0;
      if (cloudZ > 1000 || cloudZ < -1000) cloudZ = 0;
    }
    su.uCloudOff.value.set(cloudX, cloudZ);
    // cloud shadows on the ground drift with the same wind
    {
      const cs = SU.gmCloud.value;
      cs[0] = U.clamp(su.uCloud.value * 0.9 + 0.05, 0, 0.95);
      cs[1] = 0.62 * U.smoothstep(0.0, 0.12, e) * (1 - o * 0.75) * (1 - wf);
      cs[2] = cloudX * 0.55;
      cs[3] = cloudZ * 0.55;
    }
    su.uFlash.value = Math.min(1.5, flash * 1.4);
    su.uStars.value = U.clamp01(1 - d * 1.5) * (1 - o) * (1 - wf);
    su.uTime.value = st.realTime || 0;

    // ---------------------------------------------------------- lights
    const sun = W.sun, hemi = W.hemi;
    const ld = V.lightDir;
    ld.copy(e >= 0 ? sunDir : moonDir);
    // keep the key light at least ~17 deg high (long but readable shadows; the rim
    // does not cast shadows into the arena, see world.js); colour still follows the sun
    const minY = 0.3;
    if (ld.y < minY) {
      const h = Math.sqrt(ld.x * ld.x + ld.z * ld.z) || 1;
      const k = Math.sqrt(1 - minY * minY) / h;
      ld.x *= k; ld.z *= k; ld.y = minY;
    }
    if (W.sunDir && W.sunDir.isVector3) W.sunDir.copy(ld); else W.sunDir = ld.clone();
    if (typeof W.updateSun === 'function') W.updateSun();
    if (sun) {
      sun.color.copy(sunC);
      sun.intensity = sunI;
    }
    if (hemi) {
      // the environment map is the ambient; the hemisphere adds lightning flashes
      hemi.color.setRGB(0.7, 0.78, 1.0);
      hemi.groundColor.setRGB(0.25, 0.27, 0.3);
      hemi.intensity = flash * 1.6;
    }

    // shared uniforms for all custom shaders
    SU.gmSunDir.value[0] = ld.x; SU.gmSunDir.value[1] = ld.y; SU.gmSunDir.value[2] = ld.z;
    setArr(SU.gmSunCol.value, sunC, sunI);
    setArr(SU.gmSkyZen.value, zen, 1);
    setArr(SU.gmSkyHor.value, hor, 1);
    setArr(SU.gmSkyGnd.value, gnd, 1);
    SU.gmEnv.value[1] = wetness;
    SU.gmEnv.value[2] = snowCover;
    SU.gmEnv2.value[3] = d;
    SU.gmShadow.value[3] = flash;
    if (W.skyColor && W.skyColor.isColor) W.skyColor.lerpColors(hor, zen, 0.4);

    // ---------------------------------------------------------- fog
    const scene = W.scene;
    const fogA = SU.gmFogA.value, fogB = SU.gmFogB.value, fogS = SU.gmFogSun.value, fogSC = SU.gmFogSunCol.value;
    const dens = (wc * 0.0021 + wr * 0.0075 + ws * 0.011 + wf * 0.034 + wn * 0.009 + wh * 0.0042) * (1 + (1 - d) * 0.45);
    fogA[0] = dens;
    fogA[1] = wf > 0.3 ? 0.016 : 0.03;
    fogA[2] = CFG.BASE_WATER_LEVEL - 2;
    fogA[3] = 0.97;
    fogB[0] = wf > 0.3 ? 2 : 8;
    fogB[1] = U.lerp(4, 9, U.smoothstep(0.05, 0.5, e));
    const fogCol = V.fog.copy(hor).lerp(zen, 0.12);
    fogS[0] = sunDir.x; fogS[1] = sunDir.y; fogS[2] = sunDir.z;
    fogS[3] = U.smoothstep(-0.1, 0.05, e) * (0.25 + 1.4 * twi) * (1 - o * 0.8);
    setArr(fogSC, sunC, U.lerp(0.25, 1.1, d) * (1 - wf * 0.6));
    if (scene && scene.fog) scene.fog.color.copy(fogCol);
    if (scene && scene.background && scene.background.isColor) scene.background.copy(hor);
    su.uFogSky.value.set(0.55 + wf * 0.45 + o * 0.25, 0, 0, 0);

    // ---------------------------------------------------------- post grade
    if (P) {
      const night = 1 - d;
      P.exposure = U.lerp(0.9, 2.3, night * night) * (1 + twi * 0.14) * (1 + o * 0.08) + flash * 0.25;
      SU.gmPost.value[0] = P.exposure;
      SU.gmPost.value[1] = Math.pow(1 / Math.max(0.5, P.exposure), 0.75);
      // only real highlights bloom by day (sun disc, glints, fire, emissives)
      P.bloomThreshold = U.lerp(3.2, 1.0, night);
      P.bloom = 0.5 + 0.06 * night + 0.1 * wf;
      P.saturation = U.lerp(1.08, 0.82, night) * (1 - o * 0.12) + wh * 0.06;
      P.contrast = 0.2 - o * 0.08;
      P.vignette = 0.3 + 0.1 * night;
      P.shadowTint[0] = U.lerp(0.97, 0.9, night); P.shadowTint[1] = U.lerp(0.99, 0.97, night); P.shadowTint[2] = U.lerp(1.05, 1.16, night);
      P.highTint[0] = 1.02 + twi * 0.06 + wh * 0.04; P.highTint[1] = 1.0 + twi * 0.005; P.highTint[2] = U.lerp(0.95, 1.02, night) - twi * 0.05;
      const sunUp = U.smoothstep(-0.02, 0.06, e);
      P.rays = sunUp * clearSky * (0.18 + 0.9 * twi) * (1 - wf * 0.5);
      P.raysColor[0] = sunC.r; P.raysColor[1] = sunC.g * 0.95; P.raysColor[2] = sunC.b * 0.85;
      P.sunDir.copy(sunDir);
    }

    // ---------------------------------------------------------- environment map
    updateEnvMap(realDt, st.speed);

    // ---------------------------------------------------------- precipitation around the main camera
    if (!paused) { precipT += realDt; if (precipT > 2000) precipT -= 2000; }
    const cam = cameraPos();
    const rainAmt = wr + ws;
    const rain = V.rain;
    rain.visible = rainAmt > 0.02;
    if (rain.visible) {
      const ru = rain.material.uniforms;
      ru.uCenter.value.set(cam.x, cam.y, cam.z);
      ru.uVel.value.set(Env.wind.x * 0.6, -(22 + 6 * ws), Env.wind.z * 0.6);
      ru.uTime.value = precipT;
      ru.uDensity.value = U.clamp01(wr * 0.65 + ws);
      ru.uAlpha.value = U.clamp01(rainAmt) * U.lerp(0.12, 0.46, d);
      ru.uColor.value.lerpColors(col.rainN, col.rainD, d).multiplyScalar(U.lerp(0.25, 1.0, d));
      rain.geometry.setDrawRange(0, (isLow() ? RAIN_LOW : RAIN_MAX) * 2);
    }
    const splash = V.splash;
    splash.visible = rainAmt > 0.15 && !isLow();
    if (splash.visible) {
      const sa = splash.geometry.attributes.aSplash, arr = sa.array, cyc = V.splashCycle;
      const T = GM.Terrain;
      const t = precipT * 1.9;
      let changed = false;
      for (let i = 0; i < SPLASH_MAX; i++) {
        const c = Math.floor(t + arr[i * 4 + 3]);
        if (c === cyc[i]) continue;
        cyc[i] = c;
        const ang = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * 18;
        const x = cam.x + Math.sin(ang) * rr, z = cam.z + Math.cos(ang) * rr;
        const gy = T && T.heightAt ? T.heightAt(x, z) : 0;
        arr[i * 4] = x; arr[i * 4 + 1] = Math.max(gy, Env.waterLevel); arr[i * 4 + 2] = z;
        changed = true;
      }
      if (changed) sa.needsUpdate = true;
      const pu = splash.material.uniforms;
      pu.uTime.value = precipT;
      pu.uAlpha.value = U.clamp01(rainAmt) * U.lerp(0.15, 0.5, d);
      const cnv = W.renderer && W.renderer.domElement;
      pu.uPix.value = cnv ? Math.max(200, cnv.height * 0.5 / 0.52) : 800;
      pu.uColor.value.lerpColors(col.rainN, col.rainD, d).multiplyScalar(U.lerp(0.25, 1.1, d));
    }
    const snow = V.snow;
    snow.visible = wn > 0.02;
    if (snow.visible) {
      const nu = snow.material.uniforms;
      nu.uCenter.value.set(cam.x, cam.y, cam.z);
      nu.uVel.value.set(Env.wind.x * 0.35, -2.2, Env.wind.z * 0.35);
      nu.uTime.value = precipT;
      nu.uDensity.value = U.clamp01(wn);
      nu.uAlpha.value = U.clamp01(wn) * 0.9;
      nu.uColor.value.lerpColors(col.snowN, col.snowD, d).multiplyScalar(U.lerp(0.3, 1.25, d));
      const cnv = W.renderer && W.renderer.domElement;
      nu.uPix.value = cnv ? Math.max(200, cnv.height * 0.5 / 0.52) : 800;
      snow.geometry.setDrawRange(0, isLow() ? SNOW_LOW : SNOW_MAX);
    }
  }

  // ================================================================ lifecycle
  function resetEnvState(emit) {
    const prev = Env.weather;
    Env.weather = 'clear';
    weatherLeft = 0;
    weatherNatural = false;
    nextNatural = rr(120, 260);
    stormNext = 5;
    flash = 0; flash2At = -1; flickerT = 6;
    precipT = 0;
    wetness = wetFloor;
    snowCover = snowFloor;
    if (emit && prev !== 'clear') GM.emit('weather:changed', { type: 'clear', prev: prev });
    wActive = false;
    Env.waterLevel = CFG.BASE_WATER_LEVEL;
    if (emit && Math.abs(wLastEmitted - Env.waterLevel) > 1e-4) emitWater();
    wLastEmitted = Env.waterLevel;
    GM.state.timeOfDay = CFG.START_TIME_OF_DAY;
    Env.timeOfDay = CFG.START_TIME_OF_DAY;
    snapWeights();
  }

  /** Take the sky palette, weather odds and surface floors from the active arena theme. */
  function applyArena() {
    const E = GM.Arenas && GM.Arenas.params().env;
    if (!E) return;
    if (V.col && V.baseCol) {
      for (const k in V.baseCol) V.col[k].copy(V.baseCol[k]);
      for (const k in E.sky) if (V.col[k]) V.col[k].setHex(E.sky[k]);
    }
    themeWeather = Object.assign({ rain: 1, fog: 1, storm: 1, snow: 1, heat: 1 }, E.weather);
    snowFloor = U.clamp01(E.snowFloor || 0);
    wetFloor = U.clamp01(E.wetFloor || 0);
    // a new arena starts from its own surface state (arena:generated only fires for a preview or a new Show)
    snowCover = snowFloor;
    wetness = wetFloor;
    envForce = true;
  }

  GM.registerSystem({
    name: 'Env',
    order: 25,
    init: function () {
      buildVisuals();
      GM.on('arena:generated', applyArena);
      GM.on('hazard:lightning', function (ev) { skyFlash(ev && ev.natural ? 1.1 : 0.9); });
      GM.on('weather:changed', function () { envForce = true; });
      snapWeights();
    },
    clear: function () {
      resetEnvState(true);
    },
    reset: function () {
      resetEnvState(true);
      windAng = windTargetAng = rr(0, Math.PI * 2);
      windSpd = windTargetSpd = rr(1, 3);
      windTimer = rr(15, 40);
      Env.wind.x = Math.sin(windAng) * windSpd;
      Env.wind.z = Math.cos(windAng) * windSpd;
    },
    update: function (dt) {
      const st = GM.state;
      Env.timeOfDay = st.timeOfDay;
      if (st.phase === 'running') {
        advanceClock(dt / CFG.DAY_LENGTH, true);
        updateWeather(dt);
      }
      updateWind(dt);
      tickWater(dt);
    },
    frame: function (realDt) {
      const st = GM.state;
      Env.timeOfDay = st.timeOfDay;
      // update() does not run on the setup screen: keep water tweens moving there
      if (st.phase === 'setup' || st.phase === 'boot') tickWater(realDt);
      updateVisuals(Math.min(0.25, Math.max(0, realDt || 0)));
    },
  });
})();
