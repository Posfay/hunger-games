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
    const w = {
      rain: 4,
      fog: night || Math.abs(GM.state.timeOfDay - CFG.DAWN) < 0.06 ? 3 : 1.4,
      storm: 1.1,
      snow: night ? 0.7 : 0.25,
      heat: night ? 0 : 0.6,
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
  const V = { ready: false };
  let flash = 0, flash2At = -1, flash2S = 0, flickerT = 6;
  let precipT = 0, cloudX = 0, cloudZ = 0;
  const WW = { clear: 1, rain: 0, storm: 0, fog: 0, snow: 0, heat: 0 };   // blended weather weights

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
    V.col = {
      dayZen: C(0x2e6cc2), dayHor: C(0xb3d5ef), twiZen: C(0x3b4c88), twiHor: C(0xf09a5e), glow: C(0xff7b30),
      nightZen: C(0x040a1f), nightHor: C(0x19294f),
      overDay: C(0x8e979f), overNight: C(0x1c2231),
      fogDay: C(0xb0b8bf), fogNight: C(0x2b3752),
      heat: C(0xf0d09a), heatZen: C(0x8fb4d8),
      sunNoon: C(0xfff2dc), sunLow: C(0xffa55c), sunHeat: C(0xffd08c), sunGrey: C(0xd6dce4),
      discNoon: C(0xfff8e8), discLow: C(0xffb468),
      moon: C(0x9fb6f2),
      hemiSkyD: C(0xcfe6ff), hemiSkyN: C(0x5a74b4), hemiTwi: C(0xffc9a6), hemiOverD: C(0xb8c0ca), hemiOverN: C(0x56648a),
      hemiGrD: C(0x6f7a52), hemiGrN: C(0x283146), hemiSnow: C(0xc6ced8), hemiHeat: C(0xffe2b8),
      cloudD: C(0xf2f4f8), cloudN: C(0x2c3654), cloudTwi: C(0xffa77a),
      rainD: C(0xaebfd2), rainN: C(0x6f809a), snowD: C(0xf4f7ff), snowN: C(0xa3b0cc),
    };
    V.zen = C(0); V.hor = C(0); V.over = C(0); V.tmp = C(0); V.fog = C(0); V.cloud = C(0); V.disc = C(0);
    V.sunDir = new THREE.Vector3(); V.moonDir = new THREE.Vector3(); V.lightDir = new THREE.Vector3();
  }

  const SKY_VS = [
    'varying vec3 vDir;',
    'void main() {',
    '  vDir = position;',
    '  vec4 p = viewMatrix * vec4(position, 0.0);',
    '  gl_Position = projectionMatrix * vec4(p.xyz, 1.0);',
    '}',
  ].join('\n');
  const SKY_FS = [
    'uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround;',
    'uniform vec3 uGlow; uniform float uGlowAmt;',
    'uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uSunVis;',
    'uniform vec3 uMoonDir; uniform float uMoonVis;',
    'uniform float uCloud; uniform vec3 uCloudCol; uniform vec2 uCloudOff;',
    'uniform float uFlash; uniform float uHaze; uniform vec3 uHazeCol;',
    'varying vec3 vDir;',
    'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float vnoise(vec2 p) {',
    '  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);',
    '}',
    'void main() {',
    '  vec3 d = normalize(vDir);',
    '  float h = d.y;',
    '  float up = clamp(h, 0.0, 1.0);',
    '  vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));',
    '  col = mix(col, uGround, smoothstep(0.0, -0.2, h));',
    '  vec2 sxz = uSunDir.xz; float sl = length(sxz);',
    '  vec2 dxz = d.xz; float dl = length(dxz);',
    '  float az = (sl > 1e-4 && dl > 1e-4) ? dot(dxz / dl, sxz / sl) * 0.5 + 0.5 : 0.5;',
    '  float glow = uGlowAmt * pow(az, 3.0) * exp(-abs(h) * 5.5);',
    '  col = mix(col, uGlow, clamp(glow, 0.0, 1.0));',
    '  col = mix(col, uHazeCol, clamp(uHaze * exp(-abs(h) * 3.5), 0.0, 1.0));',
    '  float above = smoothstep(-0.03, 0.01, h);',
    '  float sd = max(dot(d, uSunDir), 0.0);',
    '  col += uSunCol * (pow(sd, 20.0) * 0.2 + pow(sd, 350.0) * 0.45) * uSunVis;',
    '  col = mix(col, uSunCol * 1.1 + 0.08, smoothstep(0.99875, 0.9991, sd) * uSunVis * above);',
    '  float md = max(dot(d, uMoonDir), 0.0);',
    '  col += vec3(0.35, 0.45, 0.75) * pow(md, 70.0) * 0.3 * uMoonVis;',
    '  vec3 mcol = vec3(0.86, 0.9, 1.0) * (0.8 + 0.2 * vnoise(d.xz * 700.0 + d.y * 300.0));',
    '  col = mix(col, mcol, smoothstep(0.99905, 0.99935, md) * uMoonVis * above);',
    '  if (uCloud > 0.01 && h > 0.0) {',
    '    vec2 uv = d.xz / (h + 0.15) * 1.6 + uCloudOff;',
    '    float n = vnoise(uv) * 0.55 + vnoise(uv * 2.3 + 7.1) * 0.3 + vnoise(uv * 5.1 - 3.7) * 0.15;',
    '    float c = smoothstep(1.0 - uCloud, 1.0 - uCloud + 0.3, n) * smoothstep(0.0, 0.2, h);',
    '    col = mix(col, uCloudCol, c * 0.9);',
    '  }',
    '  col += uFlash * vec3(0.75, 0.8, 1.0) * (0.3 + 0.7 * up);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}',
  ].join('\n');

  const STAR_VS = [
    'attribute float aSize;',
    'attribute float aPhase;',
    'uniform float uAlpha; uniform float uTime; uniform float uPix;',
    'varying float vA;',
    'void main() {',
    '  vec3 wd = (modelMatrix * vec4(position, 0.0)).xyz;',
    '  vec4 p = viewMatrix * vec4(wd, 0.0);',
    '  gl_Position = projectionMatrix * vec4(p.xyz, 1.0);',
    '  gl_PointSize = aSize * uPix;',
    '  float tw = 0.72 + 0.28 * sin(uTime * (1.3 + aPhase) + aPhase * 17.0);',
    '  vA = uAlpha * tw * smoothstep(0.0, 0.25, normalize(wd).y);',
    '}',
  ].join('\n');
  const STAR_FS = [
    'varying float vA;',
    'void main() {',
    '  vec2 c = gl_PointCoord - 0.5;',
    '  float a = smoothstep(0.25, 0.02, dot(c, c)) * vA;',
    '  gl_FragColor = vec4(0.9, 0.93, 1.0, a);',
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
    '  float rank = fract(position.x * 91.37 + position.z * 47.13 + position.y * 13.7);',
    '  if (rank > uDensity) { vA = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }',
    '  float spd = 0.8 + 0.4 * fract(rank * 7.31);',
    '  vec3 w = position * uBox + uVel * (uTime * spd);',
    '  vec3 rel = mod(w - uCenter + 0.5 * uBox, uBox) - 0.5 * uBox;',
    '  vec3 p = uCenter + rel - normalize(uVel) * (uLen * aEnd * spd);',
    '  vA = uAlpha * (1.0 - aEnd * 0.85) * (1.0 - smoothstep(0.25, 0.5, length(rel.xz) / uBox.x));',
    '  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);',
    '}',
  ].join('\n');
  const SNOW_VS = [
    PRECIP_COMMON,
    'uniform float uSize; uniform float uPix;',
    'void main() {',
    '  float rank = fract(position.x * 91.37 + position.z * 47.13 + position.y * 13.7);',
    '  if (rank > uDensity) { vA = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 1.0; return; }',
    '  float spd = 0.75 + 0.5 * fract(rank * 7.31);',
    '  vec3 w = position * uBox + uVel * (uTime * spd);',
    '  w.x += sin(uTime * 1.1 + position.y * 40.0) * 0.8;',
    '  w.z += cos(uTime * 0.9 + position.x * 40.0) * 0.8;',
    '  vec3 rel = mod(w - uCenter + 0.5 * uBox, uBox) - 0.5 * uBox;',
    '  vec4 mv = viewMatrix * vec4(uCenter + rel, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    '  gl_PointSize = clamp(uSize * uPix / max(0.5, -mv.z), 1.0, 14.0);',
    '  vA = uAlpha * (1.0 - smoothstep(0.3, 0.5, length(rel.xz) / uBox.x));',
    '}',
  ].join('\n');
  const RAIN_FS = [
    'uniform vec3 uColor;',
    'varying float vA;',
    'void main() { gl_FragColor = vec4(uColor, vA); }',
  ].join('\n');
  const SNOW_FS = [
    'uniform vec3 uColor;',
    'varying float vA;',
    'void main() {',
    '  vec2 c = gl_PointCoord - 0.5;',
    '  float a = smoothstep(0.25, 0.05, dot(c, c)) * vA;',
    '  if (a < 0.01) discard;',
    '  gl_FragColor = vec4(uColor, a);',
    '}',
  ].join('\n');

  const RAIN_MAX = 2600, RAIN_LOW = 1100, SNOW_MAX = 2400, SNOW_LOW = 950, STAR_HIGH = 1100, STAR_LOW = 520;

  function isLow() { const s = GM.state.settings; return !!(s && s.quality === 'low'); }

  function buildVisuals() {
    const W = GM.World;
    if (!THREE || !W || !W.scene) return;
    const scene = W.scene;
    // ---- sky dome (camera-centred, drawn first, never depth-tested)
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: new THREE.Color(0x2e6cc2) }, uHorizon: { value: new THREE.Color(0xb3d5ef) },
        uGround: { value: new THREE.Color(0xa0bcd4) }, uGlow: { value: new THREE.Color(0xff7b30) }, uGlowAmt: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(0xfff8e8) }, uSunVis: { value: 1 },
        uMoonDir: { value: new THREE.Vector3(0, -1, 0) }, uMoonVis: { value: 0 },
        uCloud: { value: 0.28 }, uCloudCol: { value: new THREE.Color(0xf2f4f8) }, uCloudOff: { value: new THREE.Vector2() },
        uFlash: { value: 0 }, uHaze: { value: 0 }, uHazeCol: { value: new THREE.Color(0xb0b8bf) },
      },
      vertexShader: SKY_VS,
      fragmentShader: SKY_FS,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMat);
    sky.name = 'skyDome';
    sky.frustumCulled = false;
    sky.renderOrder = -1000;
    sky.matrixAutoUpdate = false;
    scene.add(sky);
    V.sky = sky;

    // ---- stars (additive, in the opaque queue right after the sky so terrain covers them)
    const sp = new Float32Array(STAR_HIGH * 3), ss = new Float32Array(STAR_HIGH), sph = new Float32Array(STAR_HIGH);
    for (let i = 0; i < STAR_HIGH; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      sp[i * 3] = Math.cos(a) * r * 9; sp[i * 3 + 1] = u * 9; sp[i * 3 + 2] = Math.sin(a) * r * 9;
      const b = Math.random();
      ss[i] = 0.9 + b * b * b * 2.2;
      sph[i] = Math.random() * 3;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('aSize', new THREE.BufferAttribute(ss, 1));
    sg.setAttribute('aPhase', new THREE.BufferAttribute(sph, 1));
    const starMat = new THREE.ShaderMaterial({
      uniforms: { uAlpha: { value: 0 }, uTime: { value: 0 }, uPix: { value: 1 } },
      vertexShader: STAR_VS,
      fragmentShader: STAR_FS,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    const stars = new THREE.Points(sg, starMat);
    stars.name = 'stars';
    stars.frustumCulled = false;
    stars.renderOrder = -999;
    stars.visible = false;
    scene.add(stars);
    V.stars = stars;

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
        uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(60, 36, 60) }, uVel: { value: new THREE.Vector3(0, -22, 0) },
        uTime: { value: 0 }, uDensity: { value: 0 }, uAlpha: { value: 0 }, uLen: { value: 1.3 }, uColor: { value: new THREE.Color(0xaebfd2) },
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
  }

  function snapWeights() {
    for (let i = 0; i < TYPES.length; i++) WW[TYPES[i]] = TYPES[i] === Env.weather ? 1 : 0;
  }

  const _cam = { x: 0, y: 30, z: 0 };
  function cameraPos() {
    const Cm = GM.Cameras;
    const c = Cm && Cm.main;
    if (c && c.position) { _cam.x = c.position.x; _cam.y = c.position.y; _cam.z = c.position.z; }
    else { _cam.x = 0; _cam.y = 30; _cam.z = 0; }
    return _cam;
  }

  /** Recompute sky, lights, fog and particles. Allocation-free. */
  function updateVisuals(realDt) {
    const W = GM.World;
    if (!V.ready || !W) return;
    const col = V.col;
    const st = GM.state;
    const paused = !!st.paused;

    // blend weather weights (~2 s transitions; stays a one-hot sum of 1)
    const kb = Math.min(1, realDt * 0.6);
    for (let i = 0; i < TYPES.length; i++) {
      const k = TYPES[i];
      WW[k] += ((k === Env.weather ? 1 : 0) - WW[k]) * kb;
    }
    const wr = WW.rain, ws = WW.storm, wf = WW.fog, wn = WW.snow, wh = WW.heat, wc = WW.clear;
    const o = wr * 0.7 + ws * 0.95 + wn * 0.65 + wf * 0.8;          // overcast amount
    const wMul = wc + wr * 0.55 + ws * 0.4 + wf * 0.55 + wn * 0.72 + wh * 1.1;

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
    const twi = 1 - U.smoothstep(0.0, 0.32, Math.abs(e + 0.04));
    const sunDir = V.sunDir.set(-Math.cos(a), Math.sin(a) * 0.92, 0.36).normalize();
    const moonDir = V.moonDir.set(Math.cos(a) * 0.9, -Math.sin(a) * 0.85, -0.32).normalize();

    // sky colours
    const zen = V.zen.lerpColors(col.nightZen, col.dayZen, d).lerp(col.twiZen, twi * 0.45);
    const hor = V.hor.lerpColors(col.nightHor, col.dayHor, d).lerp(col.twiHor, twi * 0.55);
    const over = V.over.lerpColors(col.overNight, col.overDay, d).multiplyScalar(1 - 0.35 * ws);
    zen.lerp(over, Math.min(1, o * 0.9));
    hor.lerp(over, Math.min(1, o));
    if (wh > 0.001) {
      hor.lerp(col.heat, wh * 0.45 * (0.3 + 0.7 * d));
      zen.lerp(col.heatZen, wh * 0.15 * d);
    }
    const fogGrey = V.tmp.lerpColors(col.fogNight, col.fogDay, d);
    if (wf > 0.001) { hor.lerp(fogGrey, wf * 0.9); zen.lerp(fogGrey, wf * 0.75); }
    const fogCol = V.fog.copy(hor);

    const sky = V.sky.material.uniforms;
    sky.uZenith.value.copy(zen);
    sky.uHorizon.value.copy(hor);
    sky.uGround.value.copy(hor).multiplyScalar(0.9);
    sky.uGlow.value.copy(col.glow);
    sky.uGlowAmt.value = twi * 0.85 * (1 - Math.min(1, o)) * (1 - wf);
    sky.uHaze.value = wh * 0.45 + wf * 0.6;
    sky.uHazeCol.value.copy(fogCol);
    sky.uSunDir.value.copy(sunDir);
    sky.uSunCol.value.lerpColors(col.discLow, col.discNoon, U.smoothstep(0, 0.4, e));
    const clearSky = (1 - 0.92 * Math.min(1, o)) * (1 - 0.9 * wf);
    sky.uSunVis.value = U.smoothstep(-0.06, 0.02, e) * clearSky;
    sky.uMoonDir.value.copy(moonDir);
    sky.uMoonVis.value = U.smoothstep(-0.02, 0.08, moonDir.y) * clearSky * (1 - d * 0.7);
    sky.uCloud.value = wc * 0.28 + wr * 0.75 + ws * 0.92 + wf * 0.6 + wn * 0.75 + wh * 0.08;
    const cloud = V.cloud.lerpColors(col.cloudN, col.cloudD, d).lerp(col.cloudTwi, twi * 0.4 * (1 - o));
    cloud.lerp(over, Math.min(1, o * 0.85));
    sky.uCloudCol.value.copy(cloud);
    if (!paused) {
      cloudX += Env.wind.x * realDt * 0.004;
      cloudZ += Env.wind.z * realDt * 0.004;
      if (cloudX > 1000 || cloudX < -1000) cloudX = 0;
      if (cloudZ > 1000 || cloudZ < -1000) cloudZ = 0;
    }
    sky.uCloudOff.value.set(cloudX, cloudZ);
    sky.uFlash.value = Math.min(1.2, flash * 0.9);

    // stars
    const starA = U.clamp01(1 - d * 1.6) * (1 - Math.min(1, o)) * (1 - wf) * 0.95;
    const stars = V.stars;
    stars.visible = starA > 0.01;
    if (stars.visible) {
      const su = stars.material.uniforms;
      su.uAlpha.value = starA;
      su.uTime.value = st.realTime || 0;
      su.uPix.value = W.renderer ? W.renderer.getPixelRatio() : 1;
      stars.rotation.set(0.45, 0, -a);
      stars.geometry.setDrawRange(0, isLow() ? STAR_LOW : STAR_HIGH);
    }

    // directional light: sun by day, cool moonlight by night (never below ~12 deg: sane shadows)
    const sun = W.sun, hemi = W.hemi;
    const ld = V.lightDir;
    if (e >= 0) {
      ld.copy(sunDir);
      if (sun) {
        sun.color.lerpColors(col.sunLow, col.sunNoon, U.smoothstep(0.04, 0.5, e));
        if (wh > 0.001) sun.color.lerp(col.sunHeat, wh * 0.35);
        sun.color.lerp(col.sunGrey, Math.min(1, o) * 0.6);
        sun.intensity = 1.05 * U.smoothstep(0, 0.16, e) * wMul;
      }
    } else {
      ld.copy(moonDir);
      if (sun) {
        sun.color.copy(col.moon);
        sun.intensity = 0.55 * U.smoothstep(0, 0.16, -e) * (0.55 + 0.45 * Math.min(1, wMul));
      }
    }
    if (ld.y < 0.22) { ld.y = 0.22; ld.normalize(); }
    if (W.sunDir && W.sunDir.isVector3) W.sunDir.copy(ld); else W.sunDir = ld.clone();
    if (typeof W.updateSun === 'function') W.updateSun();

    if (hemi) {
      hemi.color.lerpColors(col.hemiSkyN, col.hemiSkyD, d).lerp(col.hemiTwi, twi * 0.3);
      hemi.color.lerp(V.tmp.lerpColors(col.hemiOverN, col.hemiOverD, d), Math.min(1, o) * 0.5);
      if (wh > 0.001) hemi.color.lerp(col.hemiHeat, wh * 0.25);
      hemi.groundColor.lerpColors(col.hemiGrN, col.hemiGrD, d);
      if (wn > 0.001) hemi.groundColor.lerp(col.hemiSnow, wn * 0.5 * (0.4 + 0.6 * d));
      hemi.intensity = (0.64 + 0.05 * (1 - d)) * (1 + 0.12 * o - 0.18 * ws) + flash * 1.4;
    }

    // fog (distance shrinks at night and in bad weather; night fog stays bluish)
    const scene = W.scene;
    if (scene) {
      const baseNear = U.lerp(60, 140, d), baseFar = U.lerp(520, 900, d);
      const near = wc * baseNear + wr * Math.min(baseNear, 32) + ws * Math.min(baseNear, 20) +
        wf * 6 + wn * Math.min(baseNear, 24) + wh * Math.min(baseNear, 70);
      const far = wc * baseFar + wr * Math.min(baseFar, 360) + ws * Math.min(baseFar, 250) +
        wf * U.lerp(150, 190, d) + wn * Math.min(baseFar, 270) + wh * Math.min(baseFar, 560);
      const fog = scene.fog;
      if (fog) {
        fog.color.copy(fogCol);
        if (fog.isFogExp2) fog.density = 2.2 / Math.max(40, far);
        else { fog.near = near; fog.far = Math.max(near + 20, far); }
      }
      if (scene.background && scene.background.isColor) scene.background.copy(hor);
    }

    // water reflection / lighting
    if (W.skyColor && W.skyColor.isColor) W.skyColor.lerpColors(hor, zen, 0.4);
    const water = W.water;
    const wu = water && water.material && water.material.uniforms;
    if (wu) {
      if (wu.uLevel) wu.uLevel.value = Env.waterLevel;
      if (wu.uSky && W.skyColor) wu.uSky.value.copy(W.skyColor);
      if (wu.uSunDir) wu.uSunDir.value.copy(ld);
      if (wu.uSunColor && sun) wu.uSunColor.value.copy(sun.color).multiplyScalar(Math.min(1.1, sun.intensity));
      if (wu.uAmbient && hemi) wu.uAmbient.value.copy(hemi.color).multiplyScalar(hemi.intensity * 0.95);
    }

    // precipitation around the main camera
    if (!paused) { precipT += realDt; if (precipT > 2000) precipT -= 2000; }
    const cam = cameraPos();
    const rainAmt = wr + ws;
    const rain = V.rain;
    rain.visible = rainAmt > 0.02;
    if (rain.visible) {
      const ru = rain.material.uniforms;
      ru.uCenter.value.set(cam.x, cam.y, cam.z);
      ru.uVel.value.set(Env.wind.x * 0.6, -(20 + 6 * ws), Env.wind.z * 0.6);
      ru.uTime.value = precipT;
      ru.uDensity.value = U.clamp01(wr * 0.6 + ws);
      ru.uAlpha.value = U.clamp01(rainAmt) * U.lerp(0.28, 0.42, d);
      ru.uColor.value.lerpColors(col.rainN, col.rainD, d);
      rain.geometry.setDrawRange(0, (isLow() ? RAIN_LOW : RAIN_MAX) * 2);
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
      nu.uColor.value.lerpColors(col.snowN, col.snowD, d);
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
    if (emit && prev !== 'clear') GM.emit('weather:changed', { type: 'clear', prev: prev });
    wActive = false;
    Env.waterLevel = CFG.BASE_WATER_LEVEL;
    if (emit && Math.abs(wLastEmitted - Env.waterLevel) > 1e-4) emitWater();
    wLastEmitted = Env.waterLevel;
    GM.state.timeOfDay = CFG.START_TIME_OF_DAY;
    Env.timeOfDay = CFG.START_TIME_OF_DAY;
    snapWeights();
  }

  GM.registerSystem({
    name: 'Env',
    order: 25,
    init: function () {
      buildVisuals();
      GM.on('hazard:lightning', function (ev) { skyFlash(ev && ev.natural ? 1.1 : 0.9); });
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
