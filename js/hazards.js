/* ==========================================================================
 * hazards.js — the arena as a weapon.
 *
 *   GM.Hazards.dangerAt(x, z) -> 0..1          O(1): fire grid + gas clouds + zone + incoming fireballs
 *   GM.Hazards.dangers(pos, r) -> [{x, z, radius, type, level}]   nearby danger sources (AI flees)
 *   GM.Hazards.fire                            wildfire grid (4 m cells): fuel from forest + grass,
 *                                              wind / slope / dryness driven spread, rain puts it out
 *   GM.Hazards.ignite(x, z, radius) / isBurning(x, z) / extinguish(x, z, radius)
 *   GM.Hazards.lightning(pos, {natural, damage, visualOnly, ignite})
 *   GM.Hazards.explosion(pos, radius, damage, cause = 'explosion')
 *   GM.Hazards.fireball(pos)                   meteor from the sky -> explosion + fire + small crater
 *   GM.Hazards.gasCloud(pos, radius, duration, kind)   'poison' | 'madness', drifts with the wind
 *   GM.Hazards.earthquake(pos, radius, strength)
 *   GM.Hazards.flood(height = 4, duration = 60)
 *   GM.Hazards.zone / shrinkZone(center, radius, seconds) / isInsideZone(x, z) / previewZone(p, r)
 *
 * Sudden death: from dawn of day 4 (>= 2 alive) the zone closes to r 35 over ~1.5 days.
 * Owner: SHOWRUNNER.
 * ========================================================================== */
(function () {
  'use strict';
  const GM = window.GM;
  const CFG = GM.CFG;
  const U = GM.U;
  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------- strings
  GM.i18n.add({
    en: {
      'hazard.fire': 'Fire',
      'hazard.gas': 'Poison fog',
      'hazard.madness': 'Madness gas',
      'hazard.zone': 'Force field',
      'hazard.fireball': 'Fireball',
      'hazard.flood': 'Flood',
      'hazard.quake': 'Earthquake',
      'hazard.lightning': 'Lightning',
      'hazard.explosion': 'Explosion',
      'hazard.zoneSize': 'Force field: {n} m',
      'hazard.interest.fire': 'Wildfire',
      'hazard.interest.fireNear': 'Fire near {name}',
      'hazard.interest.gas': '{name} is in the gas',
      'hazard.interest.gasCloud': 'Gas cloud',
      'hazard.interest.zone': '{name} is outside the force field',
      'hazard.interest.lightning': 'Lightning strike',
      'hazard.interest.explosion': 'Explosion',
      'hazard.interest.fireball': 'Fireballs are falling',
      'hazard.interest.quake': 'Earthquake',
      'hazard.interest.flood': 'The water is rising',
      'log.hazard.lightningHit': 'Lightning hit {name}.',
      'log.hazard.lightningFire': 'Lightning started a fire.',
      'log.hazard.caughtFire': '{name} is in the fire!',
      'log.hazard.gasHit': '{name} breathed the poison fog.',
      'log.hazard.madnessHit': '{name} breathed the madness gas and went mad.',
      'log.hazard.explosionHit': 'An explosion hit {name}.',
      'log.hazard.quakeHit': 'The earthquake threw {name} to the ground.',
      'log.hazard.outsideZone': '{name} is outside the force field and is getting hurt.',
      'log.hazard.zoneDone': 'The force field stopped moving.',
      'log.hazard.suddenDeath': 'Sudden death: the force field closes around the last contestants.',
      'log.hazard.floodEnd': 'The flood is over. The water goes down.',
      'log.hazard.fireOut': 'The big fire has burned out.',
      'ann.gm.suddenDeath': 'Sudden death! The force field is closing.',
    },
    hu: {
      'hazard.fire': 'Tűz',
      'hazard.gas': 'Mérges köd',
      'hazard.madness': 'Őrület-gáz',
      'hazard.zone': 'Erőtér',
      'hazard.fireball': 'Tűzgolyó',
      'hazard.flood': 'Árvíz',
      'hazard.quake': 'Földrengés',
      'hazard.lightning': 'Villám',
      'hazard.explosion': 'Robbanás',
      'hazard.zoneSize': 'Erőtér: {n} m',
      'hazard.interest.fire': 'Erdőtűz',
      'hazard.interest.fireNear': 'Közel van a tűz: {name}',
      'hazard.interest.gas': 'A gázban van: {name}',
      'hazard.interest.gasCloud': 'Gázfelhő',
      'hazard.interest.zone': 'Az erőtéren kívül van: {name}',
      'hazard.interest.lightning': 'Villámcsapás',
      'hazard.interest.explosion': 'Robbanás',
      'hazard.interest.fireball': 'Tűzgolyók zuhannak',
      'hazard.interest.quake': 'Földrengés',
      'hazard.interest.flood': 'Emelkedik a víz',
      'log.hazard.lightningHit': 'Villám csapott le. Eltalálta: {name}.',
      'log.hazard.lightningFire': 'A villám tüzet okozott.',
      'log.hazard.caughtFire': 'A tűzben van: {name}!',
      'log.hazard.gasHit': 'Belélegezte a mérges ködöt: {name}.',
      'log.hazard.madnessHit': 'Belélegezte az őrület-gázt, és megőrült: {name}.',
      'log.hazard.explosionHit': 'Robbanás találta el: {name}.',
      'log.hazard.quakeHit': 'A földrengés a földre döntötte: {name}.',
      'log.hazard.outsideZone': 'Az erőtéren kívül van, és sérül: {name}.',
      'log.hazard.zoneDone': 'Az erőtér megállt.',
      'log.hazard.suddenDeath': 'Hirtelen halál: az erőtér bezárul az utolsó versenyzők körül.',
      'log.hazard.floodEnd': 'Vége az árvíznek. A víz visszahúzódik.',
      'log.hazard.fireOut': 'A nagy tűz kialudt.',
      'ann.gm.suddenDeath': 'Hirtelen halál! Szűkül az erőtér.',
    },
  });

  const THREE = window.THREE;
  if (!THREE) return; // main.js shows the fatal screen

  const Hazards = (GM.Hazards = {});

  // -------------------------------------------------------------- constants
  const CELL = 4;                                   // fire cell size (m)
  const HALF = CFG.MAP_SIZE / 2;
  const N = Math.ceil(CFG.MAP_SIZE / CELL);          // cells per side (90)
  const NN = N * N;
  const FIRE_TICK = 0.25;                           // fire simulation step (sim s)
  const DAMAGE_TICK = 0.5;                          // hazard damage step (sim s)
  const FIRE_DPS = 12;
  const GAS_DPS = 8;
  const SPREAD_RATE = 1.1;                          // base spread chance per second
  const MAX_BURNING = 2600;
  const BUCKET = 4;                                 // cells per danger cluster bucket side (16 m)
  const NB = Math.ceil(N / BUCKET);
  const GRASS_FUEL = { grass: 0.3, forest: 0.18, swamp: 0.1, sand: 0.03, rock: 0.03, snow: 0, plaza: 0, water: 0 };
  const DRY_TARGET = { clear: 0.55, heat: 1, fog: 0.35, rain: 0.1, storm: 0.12, snow: 0.05 };
  const WETNESS = { rain: 0.75, storm: 1, snow: 0.6 };
  const FLAME_CAP = 1300;
  const GAS_PUFFS_HIGH = 28;
  const GAS_PUFFS_LOW = 14;
  const MAX_CLOUDS = 10;
  const GAS_CAP = MAX_CLOUDS * GAS_PUFFS_HIGH;
  const SCORCH_MAX = 1800;
  const FB_MAX = 14;
  const BOLT_MAX = 4;
  const BOLT_MAIN = 20;
  const BOLT_SEGS = 34;
  const BOLT_LIFE = 0.55;
  const WALL_SEG = 160;
  const WALL_BELOW = 3;
  const WALL_ABOVE = 60;
  const SMOULDER_N = 96;
  const NOOP = function () {};

  // ------------------------------------------------------------ fire grid
  const fuel = new Float32Array(NN);        // remaining fuel 0..1
  const fuel0 = new Float32Array(NN);       // fuel at game start
  const forestC = new Float32Array(NN);     // forest part of the fuel (tree fires)
  const fstate = new Uint8Array(NN);        // 0 unburnt, 1 burning, 2 burnt
  const inten = new Float32Array(NN);       // burning intensity 0..1
  const burnLeft = new Float32Array(NN);
  const burnTotal = new Float32Array(NN);
  const cellH = new Float32Array(NN);       // ground height at the cell centre
  const fy0 = new Float32Array(NN);         // ground height under flame 0
  const fy1 = new Float32Array(NN);         // ground height under flame 1
  const fdanger = new Float32Array(NN);     // precomputed fire danger (dilated)
  const listPos = new Int32Array(NN).fill(-1);
  const burnList = new Int32Array(NN);
  let burnCount = 0;
  let burntCount = 0;
  let peakBurn = 0;
  // constant per-cell jitter (flame placement)
  const jx0 = new Float32Array(NN), jz0 = new Float32Array(NN), jx1 = new Float32Array(NN), jz1 = new Float32Array(NN);
  const jSeed = new Float32Array(NN);
  // danger clusters
  const bCount = new Float32Array(NB * NB), bSumX = new Float32Array(NB * NB), bSumZ = new Float32Array(NB * NB), bMax = new Float32Array(NB * NB);
  const bTouched = new Int32Array(NB * NB);
  const clusters = [];
  for (let i = 0; i < NB * NB; i++) clusters.push({ x: 0, z: 0, radius: 0, level: 0, count: 0 });
  let clusterCount = 0;
  let biggestCluster = -1;
  // burnt forest cells waiting for Terrain.burnForest (batched)
  const burnQueue = [];
  let burnQueueHead = 0;
  // recently burnt cells (smouldering smoke)
  const smoulderCell = new Int32Array(SMOULDER_N).fill(-1);
  const smoulderTime = new Float32Array(SMOULDER_N);
  let smoulderHead = 0;

  function hash01(n) {
    n = n | 0;
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    n = n ^ (n >>> 16);
    return (n >>> 0) / 4294967296;
  }
  for (let i = 0; i < NN; i++) {
    jx0[i] = (hash01(i * 7 + 1) - 0.5) * 2.6;
    jz0[i] = (hash01(i * 7 + 2) - 0.5) * 2.6;
    jx1[i] = (hash01(i * 7 + 3) - 0.5) * 2.2;
    jz1[i] = (hash01(i * 7 + 4) - 0.5) * 2.2;
    jSeed[i] = hash01(i * 7 + 5);
  }

  function cellOf(x, z) {
    const ix = Math.floor((x + HALF) / CELL);
    const iz = Math.floor((z + HALF) / CELL);
    if (ix < 0 || iz < 0 || ix >= N || iz >= N || !(ix === ix)) return -1;
    return iz * N + ix;
  }
  function cellX(i) { return -HALF + ((i % N) + 0.5) * CELL; }
  function cellZ(i) { return -HALF + (((i / N) | 0) + 0.5) * CELL; }

  // ------------------------------------------------------------- state
  let dryness = 0.55;
  let curWater = CFG.BASE_WATER_LEVEL;
  let fireAcc = 0, dmgAcc = 0, flushAcc = 0, interestAcc = 0, suddenAcc = 0;
  let lastFireLog = [];        // per contestant id: sim time of the last "caught fire" log
  let lastZoneLog = [];        // per contestant id: shrink id of the last "outside" log
  let lastBlastLog = [];
  let zoneShrinkId = 0;
  const clouds = [];           // gas clouds
  const quakes = [];
  const floodState = { active: false, level: CFG.BASE_WATER_LEVEL, until: 0, height: 0 };
  let cloudUid = 0;
  let visualTime = 0;

  const zone = {
    active: false,
    center: { x: 0, z: 0 },
    radius: CFG.ARENA_RADIUS,
    targetRadius: CFG.ARENA_RADIUS,
    targetCenter: { x: 0, z: 0 },
    damage: 5,
    shrinking: false,
    startRadius: CFG.ARENA_RADIUS,
    startCenter: { x: 0, z: 0 },
    t0: 0,
    t1: 0,
    suddenDeath: false,
  };

  // ---------------------------------------------------------------- temps
  const UP = new THREE.Vector3(0, 1, 0);
  const _p = new THREE.Vector3();
  const _p2 = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _q2 = new THREE.Quaternion();
  const _m = new THREE.Matrix4();
  const _c = new THREE.Color();
  const _fxPos = new THREE.Vector3();
  const ZERO_WIND = { x: 0, z: 0 };

  // ------------------------------------------------------ module helpers
  function groundY(x, z) {
    const Tr = GM.Terrain;
    if (Tr && Tr.heightAt) {
      const y = Tr.heightAt(x, z);
      if (y === y) return y;
    }
    return 0;
  }
  function waterY() {
    const Tr = GM.Terrain;
    if (Tr && Tr.waterLevel) {
      const w = Tr.waterLevel();
      if (w === w && w != null) return w;
    }
    const E = GM.Env;
    if (E && typeof E.waterLevel === 'number') return E.waterLevel;
    return CFG.BASE_WATER_LEVEL;
  }
  function waterDepthAt(x, z) {
    const Tr = GM.Terrain;
    if (Tr && Tr.waterDepth) return Tr.waterDepth(x, z) || 0;
    return Math.max(0, waterY() - groundY(x, z));
  }
  function inArena(x, z, margin) {
    const Tr = GM.Terrain;
    if (Tr && Tr.inArena) return Tr.inArena(x, z, margin || 0);
    const r = CFG.ARENA_RADIUS - (margin || 0);
    return x * x + z * z <= r * r;
  }
  function weather() { return (GM.Env && GM.Env.weather) || 'clear'; }
  function wind() {
    const w = GM.Env && GM.Env.wind;
    return w && typeof w.x === 'number' && w.x === w.x ? w : ZERO_WIND;
  }
  function daylight() {
    const E = GM.Env;
    if (E && E.daylight) {
      const d = E.daylight();
      if (d === d) return U.clamp01(d);
    }
    return 1;
  }
  function isLow() {
    const s = GM.state.settings;
    return !!(s && s.quality === 'low');
  }
  function fx(method, a, b, c, d, e) {
    const F = GM.FX;
    if (!F || typeof F[method] !== 'function') return;
    try { F[method](a, b, c, d, e); } catch (err) { GM.reportError('Hazards.FX.' + method, err); }
  }
  function sfx(name, pos, volume) {
    const A = GM.Audio;
    if (!A || typeof A.play !== 'function') return;
    try { A.play(name, { pos: pos, volume: volume == null ? 1 : volume }); } catch (err) { GM.reportError('Hazards.audio', err); }
  }
  function aiNoise(pos, radius, kind, src) {
    const AI = GM.AI;
    if (!AI || typeof AI.noise !== 'function') return;
    try { AI.noise(pos, radius, kind, src == null ? null : src); } catch (err) { GM.reportError('Hazards.noise', err); }
  }
  function cameraPos() {
    const C = GM.Cameras;
    return C && C.main && C.main.position ? C.main.position : null;
  }
  /** Camera shake scaled by the distance between the camera and (x, z). */
  function shakeAt(x, z, intensity, seconds, range) {
    const C = GM.Cameras;
    if (!C || typeof C.shake !== 'function') return;
    const cp = cameraPos();
    let k = 1;
    if (cp) {
      const d = Math.sqrt((cp.x - x) * (cp.x - x) + (cp.z - z) * (cp.z - z) + Math.pow(Math.max(0, cp.y - groundY(x, z) - 20), 2) * 0.3);
      k = U.clamp01(1.15 - d / range);
    }
    if (k < 0.04) return;
    try { C.shake(intensity * k, seconds); } catch (err) { GM.reportError('Hazards.shake', err); }
  }
  function hurt(t, amount, cause, pos) {
    const Tr = GM.Contestants;
    if (!Tr || typeof Tr.damage !== 'function' || !t || !t.alive || !(amount > 0)) return 0;
    try {
      return Tr.damage(t, amount, { cause: cause, attacker: null, beast: null, weapon: null, pos: pos || t.pos }) || 0;
    } catch (err) {
      GM.reportError('Hazards.damage', err);
      return 0;
    }
  }
  function hurtBeast(m, amount) {
    const M = GM.Beasts;
    if (!M || typeof M.damage !== 'function' || !m || !m.alive || !(amount > 0)) return;
    try { M.damage(m, amount, null); } catch (err) { GM.reportError('Hazards.beastDamage', err); }
  }
  function tribCall(method, a, b, c, d) {
    const Tr = GM.Contestants;
    if (!Tr || typeof Tr[method] !== 'function') return;
    try { Tr[method](a, b, c, d); } catch (err) { GM.reportError('Hazards.Contestants.' + method, err); }
  }
  function applyMindStatus(t, status, seconds) {
    const AI = GM.AI;
    try {
      if (AI && typeof AI.applyStatus === 'function') AI.applyStatus(t, status, seconds);
      else tribCall('setStatus', t, status, seconds);
    } catch (err) { GM.reportError('Hazards.applyStatus', err); }
  }
  function noPick(obj) {
    obj.traverse(function (o) { o.raycast = NOOP; });
    return obj;
  }
  function scene() { return GM.World && GM.World.scene ? GM.World.scene : null; }
  function interest(o) {
    try { GM.addInterest(o); } catch (err) { GM.reportError('Hazards.interest', err); }
  }
  function P3(x, y, z) { return { x: x, y: y, z: z }; }

  // ---------------------------------------------------------------- shaders
  const FLAME_VS = [
    'attribute vec3 aOffset;',
    'attribute vec4 aData;',
    'uniform float uTime;',
    'varying vec2 vUv;',
    'varying float vInt;',
    'varying float vSeed;',
    'varying float vKind;',
    'void main() {',
    '  vUv = uv;',
    '  vInt = aData.y;',
    '  vSeed = aData.z;',
    '  vKind = aData.w;',
    '  float s = aData.x;',
    '  float flick = 1.0 + 0.1 * sin(uTime * (5.0 + aData.z * 5.0) + aData.z * 40.0) + 0.05 * sin(uTime * 13.0 + aData.z * 11.0);',
    '  vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);',
    '  mv.x += position.x * s * (0.72 + 0.25 * aData.w);',
    '  mv.y += position.y * s * flick - s * 0.08;',
    '  gl_Position = projectionMatrix * mv;',
    '}',
  ].join('\n');
  // Noise-driven flame: rising, licking tongues; black-body style colour ramp (HDR).
  const FLAME_FS = [
    'uniform float uTime;',
    'uniform sampler2D gmNoise;',
    'uniform vec4 gmPost;',
    'varying vec2 vUv;',
    'varying float vInt;',
    'varying float vSeed;',
    'varying float vKind;',
    'void main() {',
    '  float y = vUv.y;',
    '  float x = vUv.x * 2.0 - 1.0;',
    '  float t = uTime * (0.9 + vSeed * 0.3);',
    '  float n1 = texture2D(gmNoise, vec2(vUv.x * 0.45 + vSeed * 7.0, y * 0.5 - t * 0.75)).g;',
    '  float n2 = texture2D(gmNoise, vec2(vUv.x * 1.05 - vSeed * 3.0, y * 1.1 - t * 1.6)).b;',
    '  float n = n1 * 0.62 + n2 * 0.38;',
    '  float w = mix(0.86, 0.62, vKind) * pow(1.0 - y, 0.72) * (0.5 + 0.5 * smoothstep(0.0, 0.32, y)) + 0.035;',
    '  float xd = x + (n - 0.5) * (0.8 + 0.5 * vKind) * y;',
    '  float body = 1.0 - smoothstep(w * 0.3, w, abs(xd));',
    '  float heat = body * smoothstep(0.0, 0.14, y) * (1.0 - smoothstep(0.18, 0.95, y + (n - 0.5) * 0.75));',
    '  heat = clamp(heat * 1.55 - (1.0 - n) * 0.62 * y - (1.0 - n2) * 0.2 * y * y, 0.0, 1.0);',
    '  float a = heat * vInt;',
    '  if (a < 0.01) discard;',
    '  float core = (1.0 - smoothstep(0.0, w * 0.5, abs(xd))) * (1.0 - smoothstep(0.04, 0.45, y));',
    '  vec3 c1 = vec3(0.5, 0.045, 0.01), c2 = vec3(1.0, 0.28, 0.03), c3 = vec3(1.0, 0.62, 0.16), c4 = vec3(1.0, 0.88, 0.58);',
    '  vec3 col = mix(c1, c2, smoothstep(0.0, 0.4, heat));',
    '  col = mix(col, c3, smoothstep(0.45, 0.85, heat) * (0.35 + 0.65 * core));',
    '  col = mix(col, c4, core * smoothstep(0.55, 1.0, heat));',
    '  gl_FragColor = vec4(col * (0.55 + 1.3 * heat * heat + 1.6 * core) * gmPost.y, a * 0.85);',
    '}',
  ].join('\n');

  const GAS_VS = [
    'attribute vec3 aOffset;',
    'attribute vec4 aData;',
    'attribute vec3 aColor;',
    'uniform float uTime;',
    'varying vec2 vUv;',
    'varying float vAlpha;',
    'varying float vSeed;',
    'varying vec3 vColor;',
    'void main() {',
    '  vUv = uv;',
    '  vAlpha = aData.y;',
    '  vSeed = aData.z;',
    '  vColor = aColor;',
    '  float ang = aData.z * 6.2831 + uTime * aData.w;',
    '  float c = cos(ang);',
    '  float s = sin(ang);',
    '  vec2 p = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * aData.x;',
    '  vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);',
    '  mv.xy += p;',
    '  gl_Position = projectionMatrix * mv;',
    '}',
  ].join('\n');
  const GAS_FS = [
    'uniform float uTime;',
    'uniform float uLight;',
    'varying vec2 vUv;',
    'varying float vAlpha;',
    'varying float vSeed;',
    'varying vec3 vColor;',
    'void main() {',
    '  vec2 p = vUv * 2.0 - 1.0;',
    '  float r = length(p);',
    '  float n = sin(p.x * 4.0 + uTime * 0.6 + vSeed * 12.0) * sin(p.y * 3.5 - uTime * 0.45 + vSeed * 7.0);',
    '  n += 0.5 * sin((p.x + p.y) * 7.0 + uTime * 0.9 + vSeed * 3.0);',
    '  float a = (1.0 - smoothstep(0.2, 1.0, r + n * 0.12)) * vAlpha * (0.8 + 0.2 * n);',
    '  if (a < 0.003) discard;',
    '  gl_FragColor = vec4(vColor * uLight * (0.85 + 0.25 * n), a);',
    '}',
  ].join('\n');

  const WALL_VS = [
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}',
  ].join('\n');
  const WALL_FS = [
    'uniform vec4 gmPost;',
    'uniform float uTime;',
    'uniform vec3 uColor;',
    'uniform float uAlpha;',
    'uniform float uCirc;',
    'uniform float uPulse;',
    'varying vec2 vUv;',
    'float hexDist(vec2 p) { p = abs(p); return max(dot(p, vec2(0.5, 0.8660254)), p.x); }',
    'void main() {',
    '  float hgt = ' + (WALL_BELOW + WALL_ABOVE).toFixed(1) + ';',
    '  vec2 uv = vec2(vUv.x * uCirc / 3.2, vUv.y * hgt / 3.2 - uTime * 0.15);',
    '  vec2 r = vec2(1.0, 1.7320508);',
    '  vec2 h = r * 0.5;',
    '  vec2 a = mod(uv, r) - h;',
    '  vec2 b = mod(uv - h, r) - h;',
    '  vec2 gv = dot(a, a) < dot(b, b) ? a : b;',
    '  float edge = 0.5 - hexDist(gv);',
    '  float lines = 1.0 - smoothstep(0.0, 0.05, edge);',
    '  vec2 id = uv - gv;',
    '  float flick = 0.5 + 0.5 * sin(uTime * 2.0 + id.x * 1.7 + id.y * 2.3);',
    '  float y = vUv.y;',
    '  float ground = ' + (WALL_BELOW / (WALL_BELOW + WALL_ABOVE)).toFixed(4) + ';',
    '  float fade = pow(clamp(1.0 - (y - ground) / (1.0 - ground), 0.0, 1.0), 1.7);',
    '  float band = 1.0 - smoothstep(0.0, 0.035, abs(y - ground - 0.012));',
    '  float scan = pow(0.5 + 0.5 * sin(y * 40.0 - uTime * 4.0), 14.0);',
    '  float al = (0.08 + lines * 0.5 * (0.55 + 0.45 * flick) + scan * 0.22) * fade * (0.8 + 0.4 * uPulse) + band * 0.95;',
    '  gl_FragColor = vec4(uColor * (0.7 + 0.7 * lines + band) * 2.2 * gmPost.y, al * uAlpha);',
    '}',
  ].join('\n');

  const TRAIL_VS = [
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}',
  ].join('\n');
  const TRAIL_FS = [
    'uniform vec3 uColor;',
    'varying vec2 vUv;',
    'void main() {',
    '  float a = pow(1.0 - vUv.y, 1.6) * 0.85;',
    '  gl_FragColor = vec4(mix(uColor, vec3(1.0, 0.95, 0.7), 1.0 - vUv.y) * (2.5 + 3.0 * (1.0 - vUv.y)), a);',
    '}',
  ].join('\n');

  // ---------------------------------------------------------------- visuals
  let built = false;
  let glowTex = null;
  // flames
  let flameMesh = null, flameGeo = null, flameMat = null, flameOff = null, flameData = null;
  // gas
  let gasMesh = null, gasGeo = null, gasMat = null, gasOff = null, gasData = null, gasCol = null;
  // scorch
  let scorchMesh = null, scorchN = 0, scorchHead = 0, scorchDirty = false;
  const scX = new Float32Array(SCORCH_MAX), scZ = new Float32Array(SCORCH_MAX), scS = new Float32Array(SCORCH_MAX);
  const scR = new Float32Array(SCORCH_MAX), scC = new Float32Array(SCORCH_MAX);
  // zone wall
  let wallMesh = null, wallGeo = null, wallMat = null, wallPos = null;
  let wallR = -1, wallCx = 1e9, wallCz = 1e9, wallAlpha = 0;
  // fire light
  let fireLight = null;
  const lightTarget = { x: 0, y: 0, z: 0, i: 0 };
  let lightAcc = 0;
  // fireballs / bolts
  const fbPool = [];
  const bolts = [];
  let fbCoreGeo, fbCoreMat, fbGlowMat, fbTrailGeo, fbTrailMat, warnGeo, warnMat;
  // bolt temp segment arrays
  const SA = new Float32Array(BOLT_SEGS * 3), SB = new Float32Array(BOLT_SEGS * 3);
  const SW0 = new Float32Array(BOLT_SEGS), SW1 = new Float32Array(BOLT_SEGS);
  const MP = new Float32Array((BOLT_MAIN + 1) * 3);
  const WX = new Float32Array(BOLT_MAIN + 1), WZ = new Float32Array(BOLT_MAIN + 1);
  // smoke emitter state
  let smokeAcc = 0, smoulderAcc = 0;
  const SMOKE_OPTS = { count: 1, color: 0x2b2724, color2: 0x6a645c, speed: 0.6, spread: 1.6, up: 2.8, gravity: 1.2, size: 2.6, life: 3.8, additive: false };
  const EMBER_OPTS = { count: 2, color: 0xffa040, color2: 0xff4010, speed: 1.4, spread: 1.2, up: 4.5, gravity: 1.5, size: 0.18, life: 1.4, additive: true };
  const THIN_SMOKE = { count: 1, color: 0x3a3632, color2: 0x7a756d, speed: 0.4, spread: 1.2, up: 1.8, gravity: 0.8, size: 1.8, life: 3.2, additive: false };
  const TRAIL_FIRE = { count: 2, color: 0xffb040, color2: 0xff3a08, speed: 1.5, spread: 0.8, up: 0.5, gravity: 0, size: 1.1, life: 0.45, additive: true };
  const TRAIL_SMOKE = { count: 1, color: 0x2a2420, color2: 0x5a524a, speed: 0.6, spread: 0.8, up: 0.8, gravity: 0.5, size: 2.2, life: 1.6, additive: false };
  const GAS_SPARK = { count: 1, color: 0x9cff60, color2: 0x3a7a20, speed: 0.3, spread: 3, up: 0.6, gravity: 0.2, size: 0.25, life: 1.6, additive: true };

  function makeGlowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.65)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.15)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  /** Irregular flat splat (XZ plane, normal +Y) used for scorch marks. */
  function splatGeometry() {
    const segs = 16;
    const pos = [0, 0, 0];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * TAU;
      const r = 0.72 + 0.28 * hash01(i * 13 + 5);
      pos.push(Math.sin(a) * r, 0, Math.cos(a) * r);
    }
    const idx = [];
    for (let i = 0; i < segs; i++) idx.push(0, 1 + i, 1 + ((i + 1) % segs));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function ribbonGeometry(segs) {
    const g = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(segs * 4 * 3), 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', pos);
    const idx = [];
    for (let s = 0; s < segs; s++) {
      const a = s * 4;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    return g;
  }

  function buildVisuals() {
    const sc = scene();
    if (built || !sc) return;
    built = true;
    glowTex = makeGlowTexture();

    // --- flames: instanced camera-facing billboards
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.translate(0, 0.5, 0);
    flameGeo = new THREE.InstancedBufferGeometry();
    flameGeo.index = plane.index;
    flameGeo.setAttribute('position', plane.getAttribute('position'));
    flameGeo.setAttribute('uv', plane.getAttribute('uv'));
    flameOff = new THREE.InstancedBufferAttribute(new Float32Array(FLAME_CAP * 3), 3);
    flameData = new THREE.InstancedBufferAttribute(new Float32Array(FLAME_CAP * 4), 4);
    flameOff.setUsage(THREE.DynamicDrawUsage);
    flameData.setUsage(THREE.DynamicDrawUsage);
    flameGeo.setAttribute('aOffset', flameOff);
    flameGeo.setAttribute('aData', flameData);
    flameGeo.instanceCount = 0;
    flameMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, gmNoise: GM.Gfx ? GM.Gfx.uniforms.gmNoise : { value: null }, gmPost: GM.Gfx ? GM.Gfx.uniforms.gmPost : { value: [1, 1, 0, 0] } },
      vertexShader: FLAME_VS,
      fragmentShader: FLAME_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    flameMesh = new THREE.Mesh(flameGeo, flameMat);
    flameMesh.frustumCulled = false;
    flameMesh.renderOrder = 6;
    flameMesh.visible = false;
    flameMesh.name = 'hazards-flames';
    sc.add(noPick(flameMesh));

    // --- gas clouds: instanced soft puffs
    const gplane = new THREE.PlaneGeometry(1, 1);
    gasGeo = new THREE.InstancedBufferGeometry();
    gasGeo.index = gplane.index;
    gasGeo.setAttribute('position', gplane.getAttribute('position'));
    gasGeo.setAttribute('uv', gplane.getAttribute('uv'));
    gasOff = new THREE.InstancedBufferAttribute(new Float32Array(GAS_CAP * 3), 3);
    gasData = new THREE.InstancedBufferAttribute(new Float32Array(GAS_CAP * 4), 4);
    gasCol = new THREE.InstancedBufferAttribute(new Float32Array(GAS_CAP * 3), 3);
    gasOff.setUsage(THREE.DynamicDrawUsage);
    gasData.setUsage(THREE.DynamicDrawUsage);
    gasCol.setUsage(THREE.DynamicDrawUsage);
    gasGeo.setAttribute('aOffset', gasOff);
    gasGeo.setAttribute('aData', gasData);
    gasGeo.setAttribute('aColor', gasCol);
    gasGeo.instanceCount = 0;
    gasMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uLight: { value: 1 } },
      vertexShader: GAS_VS,
      fragmentShader: GAS_FS,
      transparent: true,
      depthWrite: false,
    });
    gasMesh = new THREE.Mesh(gasGeo, gasMat);
    gasMesh.frustumCulled = false;
    gasMesh.renderOrder = 7;
    gasMesh.visible = false;
    gasMesh.name = 'hazards-gas';
    sc.add(noPick(gasMesh));

    // --- scorch marks (instanced splats that follow the ground)
    // lit (not basic): scorch marks must darken with the scene at night
    const scMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    scorchMesh = new THREE.InstancedMesh(splatGeometry(), scMat, SCORCH_MAX);
    scorchMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _c.setRGB(0.018, 0.015, 0.012);
    for (let i = 0; i < SCORCH_MAX; i++) scorchMesh.setColorAt(i, _c);
    scorchMesh.count = 0;
    scorchMesh.frustumCulled = false;
    scorchMesh.renderOrder = 1;
    scorchMesh.name = 'hazards-scorch';
    sc.add(noPick(scorchMesh));

    // --- zone wall
    wallGeo = new THREE.BufferGeometry();
    wallPos = new THREE.BufferAttribute(new Float32Array((WALL_SEG + 1) * 2 * 3), 3);
    wallPos.setUsage(THREE.DynamicDrawUsage);
    const wuv = new Float32Array((WALL_SEG + 1) * 2 * 2);
    for (let i = 0; i <= WALL_SEG; i++) {
      wuv[i * 4] = i / WALL_SEG; wuv[i * 4 + 1] = 0;
      wuv[i * 4 + 2] = i / WALL_SEG; wuv[i * 4 + 3] = 1;
    }
    const widx = [];
    for (let i = 0; i < WALL_SEG; i++) {
      const a = i * 2;
      widx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    wallGeo.setAttribute('position', wallPos);
    wallGeo.setAttribute('uv', new THREE.BufferAttribute(wuv, 2));
    wallGeo.setIndex(widx);
    wallMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xff3a5c) },
        uAlpha: { value: 0 },
        uCirc: { value: TAU * CFG.ARENA_RADIUS },
        uPulse: { value: 0 },
        gmPost: GM.Gfx ? GM.Gfx.uniforms.gmPost : { value: [1, 1, 0, 0] },
      },
      vertexShader: WALL_VS,
      fragmentShader: WALL_FS,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    wallMesh = new THREE.Mesh(wallGeo, wallMat);
    wallMesh.frustumCulled = false;
    wallMesh.visible = false;
    wallMesh.renderOrder = 8;
    wallMesh.name = 'hazards-zone';
    sc.add(noPick(wallMesh));

    // --- fire glow light (always in the scene: toggling lights recompiles shaders)
    fireLight = new THREE.PointLight(0xff7a2a, 0, 70, 1.6);
    fireLight.position.set(0, -50, 0);
    fireLight.castShadow = false;
    fireLight.name = 'hazards-firelight';
    sc.add(fireLight);

    // --- fireballs
    fbCoreGeo = new THREE.SphereGeometry(1, 12, 8);
    fbCoreMat = new THREE.MeshBasicMaterial({ color: 0xfff1c4, fog: false });
    fbCoreMat.color.multiplyScalar(9);
    fbGlowMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xff8a2a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    fbGlowMat.color.multiplyScalar(3.5);
    fbTrailGeo = new THREE.CylinderGeometry(0, 1, 1, 10, 1, true);
    fbTrailGeo.translate(0, 0.5, 0);
    fbTrailMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xff5a14) } },
      vertexShader: TRAIL_VS,
      fragmentShader: TRAIL_FS,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    warnGeo = new THREE.RingGeometry(0.82, 1, 48);
    warnGeo.rotateX(-Math.PI / 2);
    warnMat = new THREE.MeshBasicMaterial({ color: 0xff3a1a, transparent: true, opacity: 0.8, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    for (let i = 0; i < FB_MAX; i++) {
      const group = new THREE.Group();
      const core = new THREE.Mesh(fbCoreGeo, fbCoreMat);
      core.scale.setScalar(1.25);
      const glow = new THREE.Sprite(fbGlowMat);
      glow.scale.set(11, 11, 1);
      const trail = new THREE.Mesh(fbTrailGeo, fbTrailMat);
      trail.scale.set(1.3, 16, 1.3);
      group.add(core, glow, trail);
      group.visible = false;
      noPick(group);
      sc.add(group);
      const warn = new THREE.Mesh(warnGeo, warnMat);
      warn.visible = false;
      warn.renderOrder = 20;
      noPick(warn);
      sc.add(warn);
      fbPool.push({ active: false, group: group, glow: glow, trail: trail, warn: warn, sx: 0, sy: 0, sz: 0, tx: 0, ty: 0, tz: 0, x: 0, y: 0, z: 0, t: 0, dur: 1.5, ex: 0, ey: 0, ez: 0 });
    }

    // --- lightning bolts (own ribbon geometry facing the camera)
    for (let i = 0; i < BOLT_MAX; i++) {
      const coreMat = new THREE.MeshBasicMaterial({ color: 0xeef3ff, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
      const glowMat = new THREE.MeshBasicMaterial({ color: 0x6f8cff, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
      coreMat.color.multiplyScalar(10);
      glowMat.color.multiplyScalar(4);
      const core = new THREE.Mesh(ribbonGeometry(BOLT_SEGS), coreMat);
      const glow = new THREE.Mesh(ribbonGeometry(BOLT_SEGS), glowMat);
      core.frustumCulled = glow.frustumCulled = false;
      core.visible = glow.visible = false;
      core.renderOrder = 12;
      glow.renderOrder = 11;
      noPick(core); noPick(glow);
      sc.add(core, glow);
      bolts.push({ active: false, age: 0, core: core, glow: glow });
    }
  }

  // ================================================================= FIRE
  function computeGrid() {
    const Tr = GM.Terrain;
    fstate.fill(0);
    inten.fill(0);
    burnLeft.fill(0);
    burnTotal.fill(0);
    fdanger.fill(0);
    listPos.fill(-1);
    burnCount = 0;
    burntCount = 0;
    peakBurn = 0;
    clusterCount = 0;
    biggestCluster = -1;
    burnQueue.length = 0;
    burnQueueHead = 0;
    smoulderCell.fill(-1);
    const wl = waterY();
    curWater = wl;
    const hasForest = !!(Tr && Tr.forestAt);
    const hasBiome = !!(Tr && Tr.biomeAt);
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const i = iz * N + ix;
        const x = -HALF + (ix + 0.5) * CELL;
        const z = -HALF + (iz + 0.5) * CELL;
        const h = groundY(x, z);
        cellH[i] = h;
        let f = 0, fr = 0;
        if (inArena(x, z, 1) && h > wl + 0.1) {
          if (hasForest) {
            fr = (Tr.forestAt(x, z) + Tr.forestAt(x - 1.3, z - 1.3) + Tr.forestAt(x + 1.3, z + 1.3)) / 3;
            if (!(fr >= 0)) fr = 0;
          }
          const b = hasBiome ? Tr.biomeAt(x, z) : 'grass';
          f = fr * 0.85 + (GRASS_FUEL[b] || 0);
        }
        forestC[i] = fr > 1 ? 1 : fr;
        fuel[i] = fuel0[i] = f > 1 ? 1 : f;
        fy0[i] = groundY(x + jx0[i], z + jz0[i]);
        fy1[i] = groundY(x + jx1[i], z + jz1[i]);
      }
    }
  }

  function refreshCellHeights(x, z, radius) {
    const r = radius + CELL * 2;
    const i0 = Math.max(0, Math.floor((x - r + HALF) / CELL)), i1 = Math.min(N - 1, Math.floor((x + r + HALF) / CELL));
    const k0 = Math.max(0, Math.floor((z - r + HALF) / CELL)), k1 = Math.min(N - 1, Math.floor((z + r + HALF) / CELL));
    for (let iz = k0; iz <= k1; iz++) {
      for (let ix = i0; ix <= i1; ix++) {
        const i = iz * N + ix;
        const cx = -HALF + (ix + 0.5) * CELL, cz = -HALF + (iz + 0.5) * CELL;
        cellH[i] = groundY(cx, cz);
        fy0[i] = groundY(cx + jx0[i], cz + jz0[i]);
        fy1[i] = groundY(cx + jx1[i], cz + jz1[i]);
      }
    }
    // scorch marks in the area follow the new ground
    if (scorchMesh && scorchN > 0) {
      const rr = (radius + 4) * (radius + 4);
      for (let k = 0; k < scorchN; k++) {
        const dx = scX[k] - x, dz = scZ[k] - z;
        if (dx * dx + dz * dz <= rr) writeScorch(k);
      }
    }
  }

  function removeFromList(i) {
    const p = listPos[i];
    if (p < 0) return;
    const last = burnList[--burnCount];
    burnList[p] = last;
    listPos[last] = p;
    listPos[i] = -1;
  }

  function igniteCell(i, force) {
    if (i < 0 || i >= NN || fstate[i] !== 0) return false;
    if (burnCount >= MAX_BURNING) return false;
    if (cellH[i] < curWater - 0.1) return false;
    const f = fuel[i];
    if (f < 0.04) {
      if (!force) return false;
      burnTotal[i] = burnLeft[i] = 2.2 + GM.R.random() * 1.5;  // short flash fire on bare ground
    } else {
      const tot = 5 + 16 * f + forestC[i] * 7 + GM.R.random() * 3;
      burnTotal[i] = burnLeft[i] = tot;
    }
    fstate[i] = 1;
    inten[i] = 0.2;
    listPos[i] = burnCount;
    burnList[burnCount++] = i;
    if (burnCount > peakBurn) peakBurn = burnCount;
    return true;
  }

  function burnOut(i) {
    removeFromList(i);
    fstate[i] = 2;
    inten[i] = 0;
    const had = fuel[i];
    fuel[i] = 0;
    burntCount++;
    if (forestC[i] > 0.06) burnQueue.push(i);
    if (had > 0.08) {
      addScorch(cellX(i) + jx1[i] * 0.4, cellZ(i) + jz1[i] * 0.4, 2.3 + jSeed[i] * 0.9, 0.05 + jSeed[i] * 0.07);
    }
    smoulderCell[smoulderHead] = i;
    smoulderTime[smoulderHead] = GM.state.time;
    smoulderHead = (smoulderHead + 1) % SMOULDER_N;
  }

  function extinguishCell(i) {
    removeFromList(i);
    fstate[i] = 0;
    inten[i] = 0;
    const tot = burnTotal[i];
    fuel[i] *= tot > 0 ? U.clamp01(0.3 + burnLeft[i] / tot) : 0.5;
  }

  function wetness() { return WETNESS[weather()] || 0; }

  const NDX = [1, -1, 0, 0, 1, 1, -1, -1];
  const NDZ = [0, 0, 1, -1, 1, -1, 1, -1];
  function spread(i, it, wnx, wnz, wStr, dry) {
    const ix = i % N, iz = (i / N) | 0;
    const base = SPREAD_RATE * FIRE_TICK * it * dry;
    const R = GM.R;
    for (let n = 0; n < 8; n++) {
      const jx = ix + NDX[n], jz = iz + NDZ[n];
      if (jx < 0 || jz < 0 || jx >= N || jz >= N) continue;
      const j = jz * N + jx;
      if (fstate[j] !== 0) continue;
      const f = fuel[j];
      if (f < 0.04) continue;
      const diag = n >= 4;
      const dot = (NDX[n] * wnx + NDZ[n] * wnz) * (diag ? 0.7071 : 1);
      let wm = 1 + 2.4 * dot * wStr;
      if (wm < 0.12) wm = 0.12;
      const slope = (cellH[j] - cellH[i]) / (diag ? CELL * 1.414 : CELL);
      const sm = U.clamp(1 + slope * 1.5, 0.5, 2);  // fire runs uphill
      const p = base * f * wm * sm * (diag ? 0.7 : 1);
      if (R.random() < p) igniteCell(j, false);
    }
    // wind-blown embers jump ahead of the fire front
    if (forestC[i] > 0.45 && wStr > 0.35 && dry > 0.45 && R.random() < 0.006 * wStr * dry * it) {
      const d = 2 + R.random() * 3;
      const tx = ix + Math.round(wnx * d + (R.random() - 0.5) * 2);
      const tz = iz + Math.round(wnz * d + (R.random() - 0.5) * 2);
      if (tx >= 0 && tz >= 0 && tx < N && tz < N) igniteCell(tz * N + tx, false);
    }
  }

  function fireTick() {
    curWater = waterY();
    if (burnCount === 0) {
      if (clusterCount !== 0 || biggestCluster !== -1) rebuildDanger();
      if (peakBurn >= 25) {
        GM.log('hazard', 'log.hazard.fireOut', {}, {});
        peakBurn = 0;
      } else peakBurn = 0;
      return;
    }
    const w = wind();
    const wl = Math.sqrt(w.x * w.x + w.z * w.z);
    const wnx = wl > 0.01 ? w.x / wl : 0;
    const wnz = wl > 0.01 ? w.z / wl : 0;
    const wStr = U.clamp01(wl / 7);
    const wet = wetness();
    const dry = dryness;
    let k = burnCount;
    while (k-- > 0) {
      if (k >= burnCount) continue;
      const i = burnList[k];
      if (cellH[i] < curWater - 0.15) { extinguishCell(i); continue; }
      const tot = burnTotal[i];
      const left = burnLeft[i] - FIRE_TICK * (1 + wet * 2.2);
      burnLeft[i] = left;
      if (left <= 0) { burnOut(i); continue; }
      const age = tot - left;
      let it = Math.min(1, age / 2.2 + 0.15) * Math.min(1, left / (0.35 * tot));
      it *= (0.55 + 0.45 * Math.min(1, fuel0[i] * 1.4)) * (1 - wet * 0.45);
      inten[i] = it;
      if (it > 0.2) spread(i, it, wnx, wnz, wStr, dry);
    }
    rebuildDanger();
  }

  function rebuildDanger() {
    fdanger.fill(0);
    let touched = 0;
    for (let k = 0; k < burnCount; k++) {
      const i = burnList[k];
      const it = inten[i];
      const ix = i % N, iz = (i / N) | 0;
      const v0 = 0.55 + 0.45 * Math.min(1, it * 1.6);
      for (let dz = -2; dz <= 2; dz++) {
        const z2 = iz + dz;
        if (z2 < 0 || z2 >= N) continue;
        const adz = dz < 0 ? -dz : dz;
        for (let dx = -2; dx <= 2; dx++) {
          const x2 = ix + dx;
          if (x2 < 0 || x2 >= N) continue;
          const adx = dx < 0 ? -dx : dx;
          const c = adx > adz ? adx : adz;
          const v = c === 0 ? v0 : c === 1 ? v0 * 0.55 : v0 * 0.22;
          const j = z2 * N + x2;
          if (fdanger[j] < v) fdanger[j] = v;
        }
      }
      const b = ((iz / BUCKET) | 0) * NB + ((ix / BUCKET) | 0);
      if (bCount[b] === 0) bTouched[touched++] = b;
      bCount[b] += 1;
      bSumX[b] += -HALF + (ix + 0.5) * CELL;
      bSumZ[b] += -HALF + (iz + 0.5) * CELL;
      if (it > bMax[b]) bMax[b] = it;
    }
    clusterCount = 0;
    biggestCluster = -1;
    let best = 0;
    for (let k = 0; k < touched; k++) {
      const b = bTouched[k];
      const c = bCount[b];
      const cl = clusters[clusterCount];
      cl.x = bSumX[b] / c;
      cl.z = bSumZ[b] / c;
      cl.count = c;
      cl.radius = 2.5 + 2.3 * Math.sqrt(c);
      cl.level = 0.5 + 0.5 * Math.min(1, bMax[b] * 1.3);
      if (c > best) { best = c; biggestCluster = clusterCount; }
      clusterCount++;
      bCount[b] = 0; bSumX[b] = 0; bSumZ[b] = 0; bMax[b] = 0;
    }
  }

  function flushBurnQueue() {
    const Tr = GM.Terrain;
    const pending = burnQueue.length - burnQueueHead;
    if (pending <= 0) {
      if (burnQueue.length) { burnQueue.length = 0; burnQueueHead = 0; }
      return;
    }
    const n = Math.min(pending, 3 + Math.floor(pending / 6));
    for (let k = 0; k < n; k++) {
      const i = burnQueue[burnQueueHead++];
      if (Tr && typeof Tr.burnForest === 'function') {
        try { Tr.burnForest(cellX(i), cellZ(i), CELL * 0.75); } catch (err) { GM.reportError('Hazards.burnForest', err); }
      }
    }
    if (burnQueueHead > 512) {
      burnQueue.splice(0, burnQueueHead);
      burnQueueHead = 0;
    }
  }

  /** Set fire to every cell whose centre is within `radius` of (x, z). */
  function ignite(x, z, radius) {
    x = +x || 0; z = +z || 0;
    const r = Math.max(1.5, +radius || 3);
    curWater = waterY();
    const rr = (r + CELL * 0.5) * (r + CELL * 0.5);
    const i0 = Math.max(0, Math.floor((x - r - CELL + HALF) / CELL)), i1 = Math.min(N - 1, Math.floor((x + r + CELL + HALF) / CELL));
    const k0 = Math.max(0, Math.floor((z - r - CELL + HALF) / CELL)), k1 = Math.min(N - 1, Math.floor((z + r + CELL + HALF) / CELL));
    let lit = 0;
    for (let iz = k0; iz <= k1; iz++) {
      for (let ix = i0; ix <= i1; ix++) {
        const cx = -HALF + (ix + 0.5) * CELL, cz = -HALF + (iz + 0.5) * CELL;
        const dx = cx - x, dz = cz - z;
        if (dx * dx + dz * dz > rr) continue;
        const i = iz * N + ix;
        if (!inArena(cx, cz, 0)) continue;
        if (igniteCell(i, true)) lit++;
      }
    }
    if (lit > 0) {
      sfx('fire', P3(x, groundY(x, z), z), 0.8);
      GM.emit('hazard:fire', { pos: P3(x, groundY(x, z), z), radius: r });
      rebuildDanger();
    }
    return lit;
  }

  /** Put out fire in an area (cells stay partly unburnt and can burn again later). */
  function extinguish(x, z, radius) {
    const r = Math.max(1, +radius || 4);
    const rr = r * r;
    let n = 0;
    for (let k = burnCount - 1; k >= 0; k--) {
      if (k >= burnCount) continue;
      const i = burnList[k];
      const dx = cellX(i) - x, dz = cellZ(i) - z;
      if (dx * dx + dz * dz <= rr) { extinguishCell(i); n++; }
    }
    if (n) rebuildDanger();
    return n;
  }

  function isBurning(x, z) {
    const i = cellOf(x, z);
    return i >= 0 && fstate[i] === 1 && inten[i] > 0.05;
  }

  const fire = {
    CELL: CELL,
    N: N,
    get count() { return burnCount; },
    get burnt() { return burntCount; },
    get dryness() { return dryness; },
    state: fstate,
    intensity: inten,
    fuel: fuel,
    cellOf: cellOf,
    cellCenter: function (i, out) {
      out = out || { x: 0, z: 0 };
      out.x = cellX(i); out.z = cellZ(i);
      return out;
    },
    intensityAt: function (x, z) {
      const i = cellOf(x, z);
      return i >= 0 && fstate[i] === 1 ? inten[i] : 0;
    },
    isBurnt: function (x, z) {
      const i = cellOf(x, z);
      return i >= 0 && fstate[i] === 2;
    },
    /** fn(x, z, intensity, cellIndex) for every burning cell (no allocations). */
    forEachBurning: function (fn) {
      for (let k = 0; k < burnCount; k++) {
        const i = burnList[k];
        fn(cellX(i), cellZ(i), inten[i], i);
      }
    },
    /** fn(x, z, cellIndex) for every burnt cell. */
    forEachBurnt: function (fn) {
      for (let i = 0; i < NN; i++) if (fstate[i] === 2) fn(cellX(i), cellZ(i), i);
    },
    list: function () {
      const out = [];
      for (let k = 0; k < burnCount; k++) {
        const i = burnList[k];
        out.push({ x: cellX(i), z: cellZ(i), intensity: inten[i] });
      }
      return out;
    },
    clusters: function () {
      const out = [];
      for (let k = 0; k < clusterCount; k++) {
        const c = clusters[k];
        out.push({ x: c.x, z: c.z, radius: c.radius, level: c.level, count: c.count });
      }
      return out;
    },
    nearest: function (x, z, maxDist) {
      const md = maxDist == null ? 1e9 : maxDist;
      let best = -1, bd = md * md;
      for (let k = 0; k < burnCount; k++) {
        const i = burnList[k];
        const dx = cellX(i) - x, dz = cellZ(i) - z;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = i; }
      }
      return best < 0 ? null : { x: cellX(best), z: cellZ(best), dist: Math.sqrt(bd) };
    },
  };

  // =============================================================== SCORCH
  function addScorch(x, z, size, shade) {
    if (!scorchMesh) return;
    const k = scorchHead;
    scorchHead = (scorchHead + 1) % SCORCH_MAX;
    if (scorchN < SCORCH_MAX) scorchN++;
    scX[k] = x; scZ[k] = z; scS[k] = size;
    scR[k] = hash01((x * 73.1 + z * 19.7) | 0) * TAU;
    scC[k] = shade == null ? 0.07 : shade;
    writeScorch(k);
    scorchMesh.count = scorchN;
  }
  function writeScorch(k) {
    const x = scX[k], z = scZ[k];
    const Tr = GM.Terrain;
    const y = groundY(x, z) + 0.14;
    if (Tr && Tr.normalAt) {
      const nn = Tr.normalAt(x, z, _n);
      if (nn && nn !== _n && typeof nn.x === 'number') _n.set(nn.x, nn.y, nn.z);
      if (!(_n.y > 0.05)) _n.set(0, 1, 0);
      _n.normalize();
    } else _n.set(0, 1, 0);
    _q.setFromUnitVectors(UP, _n);
    _q2.setFromAxisAngle(UP, scR[k]);
    _q.multiply(_q2);
    _p.set(x, y, z);
    _s.set(scS[k], 1, scS[k]);
    _m.compose(_p, _q, _s);
    scorchMesh.setMatrixAt(k, _m);
    const c = scC[k];
    _c.setRGB(c * 1.25, c, c * 0.8);
    scorchMesh.setColorAt(k, _c);
    scorchDirty = true;
  }

  // ============================================================ LIGHTNING
  function spawnBolt(x, y, z) {
    if (!bolts.length) return;
    let b = null;
    for (let i = 0; i < bolts.length; i++) if (!bolts[i].active) { b = bolts[i]; break; }
    if (!b) {
      b = bolts[0];
      for (let i = 1; i < bolts.length; i++) if (bolts[i].age > b.age) b = bolts[i];
    }
    // main channel: random walk from the clouds, pinned to the strike point
    const topY = y + 110;
    const tx = x + (Math.random() - 0.5) * 34, tz = z + (Math.random() - 0.5) * 34;
    let ox = 0, oz = 0;
    WX[0] = 0; WZ[0] = 0;
    for (let i = 1; i <= BOLT_MAIN; i++) {
      ox += (Math.random() - 0.5) * 10;
      oz += (Math.random() - 0.5) * 10;
      WX[i] = ox; WZ[i] = oz;
    }
    for (let i = 0; i <= BOLT_MAIN; i++) {
      const t = i / BOLT_MAIN;
      MP[i * 3] = tx + (x - tx) * t + (WX[i] - WX[BOLT_MAIN] * t);
      MP[i * 3 + 1] = topY + (y - topY) * t + (i > 0 && i < BOLT_MAIN ? (Math.random() - 0.5) * 3 : 0);
      MP[i * 3 + 2] = tz + (z - tz) * t + (WZ[i] - WZ[BOLT_MAIN] * t);
    }
    let ns = 0;
    for (let i = 0; i < BOLT_MAIN; i++) {
      SA[ns * 3] = MP[i * 3]; SA[ns * 3 + 1] = MP[i * 3 + 1]; SA[ns * 3 + 2] = MP[i * 3 + 2];
      SB[ns * 3] = MP[i * 3 + 3]; SB[ns * 3 + 1] = MP[i * 3 + 4]; SB[ns * 3 + 2] = MP[i * 3 + 5];
      SW0[ns] = 0.2; SW1[ns] = 0.2;
      ns++;
    }
    // two forks
    for (let br = 0; br < 2; br++) {
      const s = 4 + ((Math.random() * (BOLT_MAIN - 10)) | 0);
      let px = MP[s * 3], py = MP[s * 3 + 1], pz = MP[s * 3 + 2];
      const ang = Math.random() * TAU;
      const dxs = Math.sin(ang), dzs = Math.cos(ang);
      const steps = 6;
      for (let k = 0; k < steps && ns < BOLT_SEGS; k++) {
        const len = 4 + Math.random() * 4;
        const nx = px + dxs * len * 0.7 + (Math.random() - 0.5) * 4;
        const ny = py - len * (0.7 + Math.random() * 0.4);
        const nz = pz + dzs * len * 0.7 + (Math.random() - 0.5) * 4;
        SA[ns * 3] = px; SA[ns * 3 + 1] = py; SA[ns * 3 + 2] = pz;
        SB[ns * 3] = nx; SB[ns * 3 + 1] = ny; SB[ns * 3 + 2] = nz;
        SW0[ns] = 0.14 * (1 - k / steps) + 0.03;
        SW1[ns] = 0.14 * (1 - (k + 1) / steps) + 0.02;
        ns++;
        px = nx; py = ny; pz = nz;
      }
    }
    const cp = cameraPos();
    const cx = cp ? cp.x : x + 60, cy = cp ? cp.y : y + 40, cz = cp ? cp.z : z + 60;
    fillRibbon(b.core.geometry, ns, 1, cx, cy, cz);
    fillRibbon(b.glow.geometry, ns, 3.2, cx, cy, cz);
    b.active = true;
    b.age = 0;
    b.core.visible = b.glow.visible = true;
    b.core.material.opacity = 1;
    b.glow.material.opacity = 0.45;
  }

  function fillRibbon(geo, ns, scale, cx, cy, cz) {
    const arr = geo.attributes.position.array;
    for (let s = 0; s < ns; s++) {
      const ax = SA[s * 3], ay = SA[s * 3 + 1], az = SA[s * 3 + 2];
      const bx = SB[s * 3], by = SB[s * 3 + 1], bz = SB[s * 3 + 2];
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let sx = dy * vz - dz * vy, sy = dz * vx - dx * vz, sz = dx * vy - dy * vx;
      let len = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (len < 1e-6) { sx = 1; sy = 0; sz = 0; len = 1; }
      sx /= len; sy /= len; sz /= len;
      const w0 = SW0[s] * scale, w1 = SW1[s] * scale;
      const o = s * 12;
      arr[o] = ax - sx * w0; arr[o + 1] = ay - sy * w0; arr[o + 2] = az - sz * w0;
      arr[o + 3] = ax + sx * w0; arr[o + 4] = ay + sy * w0; arr[o + 5] = az + sz * w0;
      arr[o + 6] = bx - sx * w1; arr[o + 7] = by - sy * w1; arr[o + 8] = bz - sz * w1;
      arr[o + 9] = bx + sx * w1; arr[o + 10] = by + sy * w1; arr[o + 11] = bz + sz * w1;
    }
    geo.attributes.position.needsUpdate = true;
    geo.setDrawRange(0, ns * 6);
  }

  /**
   * Lightning strike from the sky at pos.
   * opts {natural: bool (storm), damage: 70 (inner), visualOnly: bool, ignite: bool = true}
   * Damage: `damage` within 3 m, 25/70 of it within 8 m (12 m when it hits water).
   */
  function lightning(pos, opts) {
    opts = opts || {};
    if (!pos) return 0;
    const x = +pos.x || 0, z = +pos.z || 0;
    const y = groundY(x, z);
    const natural = !!opts.natural;
    const base = opts.damage != null ? Math.max(0, +opts.damage || 0) : 70;
    const P = P3(x, y, z);
    spawnBolt(x, y, z);
    fx('flash', P3(x, y + 12, z), 0xd8e4ff, 8, 150, 0.35);
    fx('ring', P3(x, y + 0.3, z), 0xbfd8ff, 9, 0.5);
    fx('burst', P3(x, y + 0.5, z), { count: 26, color: 0xeef4ff, color2: 0x7fa0ff, speed: 9, spread: 0.6, up: 5, gravity: -14, size: 0.22, life: 0.6, additive: true });
    fx('burst', P3(x, y + 0.5, z), { count: 10, color: 0x3a342e, color2: 0x6d655b, speed: 2.5, spread: 1.2, up: 3, gravity: 0.6, size: 1.8, life: 2.2, additive: false });
    sfx('thunder', P, 1);
    addScorch(x, z, 2.4, 0.05);
    shakeAt(x, z, 0.35, 0.5, 120);
    aiNoise(P, 120, 'explosion', null);
    let hits = 0;
    if (!opts.visualOnly && base > 0) {
      const inWater = waterDepthAt(x, z) > 0.3;
      const outer = inWater ? 12 : 8;
      const trs = GM.state.contestants;
      for (let k = 0; k < trs.length; k++) {
        const t = trs[k];
        if (!t || !t.alive) continue;
        const dx = t.pos.x - x, dz = t.pos.z - z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > outer + (t.radius || 0.45)) continue;
        let dmg = d <= 3 ? base : base * (25 / 70);
        if (inWater && t.inWater) dmg *= 1.3;       // water carries the shock
        hurt(t, dmg, 'lightning', P);
        if (t.alive) {
          tribCall('stun', t, d <= 3 ? 2.5 : 1.2);
          if (d > 0.1) tribCall('knockback', t, dx / d, dz / d, d <= 3 ? 5 : 3);
        }
        hits++;
        if (natural) GM.log('hazard', 'log.hazard.lightningHit', { name: t.name }, { pos: t.pos, contestantIds: [t.id] });
      }
      const ms = GM.state.beasts;
      for (let k = 0; k < ms.length; k++) {
        const m = ms[k];
        if (!m || !m.alive) continue;
        const dx = m.pos.x - x, dz = m.pos.z - z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > outer + (m.radius || 0.6)) continue;
        hurtBeast(m, d <= 3 ? base : base * (25 / 70));
      }
      if (opts.ignite !== false) {
        const ci = cellOf(x, z);
        const f = ci >= 0 ? fuel[ci] : 0;
        if (f > 0.12) {
          const chance = natural ? 0.2 + 0.6 * dryness : 0.5 + 0.5 * dryness;
          if (GM.R.random() < chance) {
            const lit = ignite(x, z, 3.5);
            if (lit && natural) GM.log('hazard', 'log.hazard.lightningFire', {}, { pos: P });
          }
        }
      }
    }
    GM.emit('hazard:lightning', { pos: P, radius: 8, natural: natural });
    interest({ pos: P, score: natural ? (hits ? 7 : 5) : 7, duration: 5, kind: 'hazard', key: 'lightning', label: { key: 'hazard.interest.lightning' } });
    return hits;
  }

  // ============================================================ EXPLOSION
  /** Blast with damage falloff (100 % at the centre, 25 % at the edge), knockback and fire. */
  function explosion(pos, radius, damage, cause) {
    if (!pos) return 0;
    const x = +pos.x || 0, z = +pos.z || 0;
    const y = groundY(x, z);
    radius = radius > 0 ? radius : 6;
    damage = damage >= 0 ? damage : 40;
    cause = cause || 'explosion';
    const P = P3(x, y, z);
    const low = isLow();
    fx('burst', P3(x, y + 1, z), { count: low ? 22 : 44, color: 0xffb040, color2: 0xff3000, speed: 11, spread: 1.2, up: 6, gravity: -5, size: 0.7, life: 0.9, additive: true });
    fx('burst', P3(x, y + 1.5, z), { count: low ? 8 : 16, color: 0x3a3530, color2: 0x777066, speed: 4, spread: 2, up: 5, gravity: 1, size: 2.6, life: 2.8, additive: false });
    fx('burst', P3(x, y + 0.5, z), { count: low ? 8 : 16, color: 0x4a3a2a, color2: 0x2a2018, speed: 10, spread: 1, up: 8, gravity: -18, size: 0.32, life: 1.4, additive: false });
    fx('flash', P3(x, y + 3, z), 0xffa040, 6, radius * 5, 0.4);
    fx('ring', P3(x, y + 0.3, z), 0xffb060, radius * 1.6, 0.6);
    sfx('explosion', P, 1);
    aiNoise(P, 110, 'explosion', null);
    shakeAt(x, z, 0.6, 0.6, 100);
    addScorch(x, z, Math.max(2, radius * 0.55), 0.04);
    let hits = 0;
    const trs = GM.state.contestants;
    const now = GM.state.time;
    for (let k = 0; k < trs.length; k++) {
      const t = trs[k];
      if (!t || !t.alive) continue;
      const dx = t.pos.x - x, dz = t.pos.z - z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const reach = radius + (t.radius || 0.45);
      if (d > reach) continue;
      const f = U.clamp01(1 - d / reach);
      hurt(t, damage * (0.25 + 0.75 * f), cause, P);
      hits++;
      if (t.alive) {
        if (d > 0.1) tribCall('knockback', t, dx / d, dz / d, 3 + 7 * f);
        if (f > 0.5) tribCall('stun', t, 0.8);
        if (!(lastBlastLog[t.id] > now - 4)) {
          lastBlastLog[t.id] = now;
          GM.log('hazard', 'log.hazard.explosionHit', { name: t.name }, { pos: t.pos, contestantIds: [t.id] });
        }
      }
    }
    const ms = GM.state.beasts;
    for (let k = 0; k < ms.length; k++) {
      const m = ms[k];
      if (!m || !m.alive) continue;
      const dx = m.pos.x - x, dz = m.pos.z - z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > radius + (m.radius || 0.6)) continue;
      hurtBeast(m, damage * (0.25 + 0.75 * U.clamp01(1 - d / radius)));
    }
    GM.emit('hazard:explosion', { pos: P, radius: radius, cause: cause });
    interest({ pos: P, score: 8, duration: 5, kind: 'hazard', key: 'explosion', label: { key: 'hazard.interest.explosion' } });
    return hits;
  }

  // ============================================================= FIREBALL
  /** One fireball from the sky. Lands after ~1.5 sim s: explosion, fire, small crater. */
  function fireball(pos) {
    if (!pos) return false;
    let x = +pos.x || 0, z = +pos.z || 0;
    const d = Math.sqrt(x * x + z * z);
    const maxR = CFG.ARENA_RADIUS - 2;
    if (d > maxR) { x *= maxR / d; z *= maxR / d; }
    let fb = null;
    for (let i = 0; i < fbPool.length; i++) if (!fbPool[i].active) { fb = fbPool[i]; break; }
    const ty = groundY(x, z);
    if (!fb) {
      impactFireball(x, ty, z);
      return true;
    }
    const ang = Math.random() * TAU;
    fb.active = true;
    fb.t = 0;
    fb.dur = 1.35 + Math.random() * 0.35;
    fb.tx = x; fb.ty = ty + 0.5; fb.tz = z;
    fb.sx = x + Math.sin(ang) * 48; fb.sy = ty + 95; fb.sz = z + Math.cos(ang) * 48;
    fb.x = fb.sx; fb.y = fb.sy; fb.z = fb.sz;
    fb.ex = fb.sx; fb.ey = fb.sy; fb.ez = fb.sz;
    if (fb.group) {
      fb.group.position.set(fb.x, fb.y, fb.z);
      // trail cone points back along the path
      _p.set(fb.sx - fb.tx, fb.sy - fb.ty, fb.sz - fb.tz).normalize();
      fb.trail.quaternion.setFromUnitVectors(UP, _p);
      fb.group.visible = true;
      fb.warn.position.set(x, ty + 0.6, z);
      fb.warn.visible = true;
    }
    sfx('fireball', P3(fb.sx, fb.sy, fb.sz), 1);
    interest({ pos: P3(x, ty, z), score: 7, duration: 4, kind: 'hazard', key: 'fireball', label: { key: 'hazard.interest.fireball' } });
    return true;
  }

  function impactFireball(x, y, z) {
    explosion(P3(x, y, z), 9, 55, 'fireball');
    ignite(x, z, 7);
    fx('burst', P3(x, y + 1, z), { count: isLow() ? 10 : 22, color: 0xffe08a, color2: 0xff5a10, speed: 14, spread: 0.6, up: 12, gravity: -16, size: 0.35, life: 1.3, additive: true });
    shakeAt(x, z, 0.8, 0.7, 120);
    const Tr = GM.Terrain;
    const r0 = Math.sqrt(x * x + z * z);
    if (Tr && typeof Tr.deform === 'function' && r0 > CFG.NEXUS_RADIUS + 4 && waterDepthAt(x, z) < 0.2) {
      try { Tr.deform(x, z, 3.5, 1.1, 'crater'); } catch (err) { GM.reportError('Hazards.deform', err); }
    }
  }

  function updateFireballs(dt) {
    for (let i = 0; i < fbPool.length; i++) {
      const fb = fbPool[i];
      if (!fb.active) continue;
      fb.t += dt;
      const u = Math.min(1, fb.t / fb.dur);
      const e = Math.pow(u, 1.5);
      fb.x = fb.sx + (fb.tx - fb.sx) * e;
      fb.y = fb.sy + (fb.ty - fb.sy) * e;
      fb.z = fb.sz + (fb.tz - fb.sz) * e;
      if (u >= 1) {
        fb.active = false;
        if (fb.group) { fb.group.visible = false; fb.warn.visible = false; }
        impactFireball(fb.tx, fb.ty - 0.5, fb.tz);
      }
    }
  }

  // ================================================================= GAS
  /** Drifting gas cloud. kind 'poison' (8 dmg/s, cause 'gas') | 'madness' (victims go mad). */
  function gasCloud(pos, radius, duration, kind) {
    if (!pos) return null;
    const x = +pos.x || 0, z = +pos.z || 0;
    radius = U.clamp(+radius || 16, 4, 40);
    duration = Math.max(5, +duration || 40);
    kind = kind === 'madness' ? 'madness' : 'poison';
    while (clouds.length >= MAX_CLOUDS) clouds.shift();
    const P = isLow() ? GAS_PUFFS_LOW : GAS_PUFFS_HIGH;
    const puffs = new Float32Array(P * 6);
    for (let k = 0; k < P; k++) {
      const a = Math.random() * TAU;
      const rr = Math.sqrt(Math.random()) * 0.85;
      const o = k * 6;
      puffs[o] = Math.sin(a) * rr;
      puffs[o + 1] = Math.cos(a) * rr;
      puffs[o + 2] = 0.4 + Math.random() * 2.6 + (1 - rr) * 1.5;
      puffs[o + 3] = 0.45 + Math.random() * 0.45;
      puffs[o + 4] = Math.random();
      puffs[o + 5] = Math.random();
    }
    const cloud = {
      id: ++cloudUid,
      kind: kind,
      x: x, z: z,
      radius: radius,
      r: radius * 0.35,
      age: 0,
      duration: duration,
      alpha: 0,
      swirl: Math.random() * TAU,
      swirlSpeed: (Math.random() < 0.5 ? -1 : 1) * (0.04 + Math.random() * 0.04),
      puffs: puffs,
      puffCount: P,
      hit: new Set(),
      sparkAcc: 0,
    };
    clouds.push(cloud);
    const y = groundY(x, z);
    const col = kind === 'madness' ? 0xb266ff : 0x8fe04a;
    fx('burst', P3(x, y + 1, z), { count: 30, color: col, color2: kind === 'madness' ? 0x5a2a9a : 0x3a7a20, speed: 5, spread: 2, up: 2, gravity: 0.4, size: 1.6, life: 2.2, additive: false });
    fx('ring', P3(x, y + 0.3, z), col, radius, 1.2);
    sfx('zap', P3(x, y, z), 0.8);
    GM.emit('hazard:gas', { pos: P3(x, y, z), radius: radius, kind: kind });
    interest({ pos: P3(x, y, z), score: 7, duration: 6, kind: 'hazard', key: 'gas:' + cloud.id, label: { key: 'hazard.interest.gasCloud' } });
    return cloud;
  }

  function updateGas(dt) {
    if (!clouds.length) return;
    const w = wind();
    const wet = wetness();
    for (let i = clouds.length - 1; i >= 0; i--) {
      const c = clouds[i];
      c.age += dt * (1 + wet * 0.6);
      const drift = 0.55;
      c.x += (w.x * drift + Math.sin(c.age * 0.13 + c.id) * 0.25) * dt;
      c.z += (w.z * drift + Math.cos(c.age * 0.11 + c.id * 2) * 0.25) * dt;
      c.swirl += c.swirlSpeed * dt;
      c.r = c.radius * (0.35 + 0.65 * U.smoothstep(0, 4, c.age));
      if (!inArena(c.x, c.z, -c.radius * 0.5)) c.age += dt * 2;
      const fin = U.smoothstep(0, 2.5, c.age);
      const fout = 1 - U.smoothstep(c.duration - 6, c.duration, c.age);
      c.alpha = fin * fout;
      if (c.age >= c.duration) clouds.splice(i, 1);
    }
  }

  // ============================================================ EARTHQUAKE
  /** Rolling earthquake: stun + small damage, then a crater or a ridge rises. */
  function earthquake(pos, radius, strength) {
    if (!pos) return null;
    const x = +pos.x || 0, z = +pos.z || 0;
    radius = U.clamp(+radius || 22, 5, 60);
    strength = strength == null ? 1 : U.clamp(+strength || 1, 0.2, 2);
    const q = {
      x: x, z: z, radius: radius, strength: strength, t: 0,
      deformed: false, after: false,
      mode: GM.R.chance(0.5) ? 'crater' : 'ridge',
      angle: GM.R.angle(),
      dustAcc: 0,
    };
    quakes.push(q);
    const y = groundY(x, z);
    const P = P3(x, y, z);
    sfx('quake', P, 1);
    shakeAt(x, z, 0.9 * strength, 3, 160);
    fx('ring', P3(x, y + 0.3, z), 0xa08060, radius * 1.2, 1.2);
    quakeDust(q, 6);
    quakeJolt(q, true);
    aiNoise(P, 150, 'explosion', null);
    GM.emit('hazard:quake', { pos: P, radius: radius, strength: strength });
    interest({ pos: P, score: 8, duration: 6, kind: 'hazard', key: 'quake', label: { key: 'hazard.interest.quake' } });
    return q;
  }

  function quakeDust(q, n) {
    const low = isLow();
    for (let k = 0; k < n; k++) {
      const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * q.radius;
      const px = q.x + Math.sin(a) * r, pz = q.z + Math.cos(a) * r;
      fx('burst', P3(px, groundY(px, pz) + 0.3, pz), { count: low ? 6 : 12, color: 0x8a7458, color2: 0x5c4a36, speed: 3, spread: 2, up: 2.5, gravity: -1.5, size: 1.5, life: 2, additive: false });
    }
  }

  function quakeJolt(q, first) {
    const trs = GM.state.contestants;
    for (let k = 0; k < trs.length; k++) {
      const t = trs[k];
      if (!t || !t.alive) continue;
      const dx = t.pos.x - q.x, dz = t.pos.z - q.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > q.radius) continue;
      const f = 1 - d / q.radius;
      tribCall('stun', t, (first ? 0.8 + 1.6 * f : 0.6) * q.strength);
      if (first) {
        hurt(t, (3 + 9 * f) * q.strength, 'quake', t.pos);
        if (t.alive) {
          const a = GM.R.angle();
          tribCall('knockback', t, Math.sin(a), Math.cos(a), 2 + 3 * f);
          if (f > 0.45 && GM.R.chance(0.6)) applyMindStatus(t, 'panic', 4);
          if (f > 0.3) GM.log('hazard', 'log.hazard.quakeHit', { name: t.name }, { pos: t.pos, contestantIds: [t.id] });
        }
      }
    }
    if (first) {
      const ms = GM.state.beasts;
      for (let k = 0; k < ms.length; k++) {
        const m = ms[k];
        if (!m || !m.alive) continue;
        const dx = m.pos.x - q.x, dz = m.pos.z - q.z;
        if (dx * dx + dz * dz <= q.radius * q.radius) hurtBeast(m, 8 * q.strength);
      }
    }
  }

  function updateQuakes(dt) {
    for (let i = quakes.length - 1; i >= 0; i--) {
      const q = quakes[i];
      q.t += dt;
      if (!q.deformed && q.t >= 0.5) {
        q.deformed = true;
        const Tr = GM.Terrain;
        // never reshape the plaza: the Nexus and the pedestals stand there
        const plazaSafe = Math.sqrt(q.x * q.x + q.z * q.z) - q.radius * 0.5 > CFG.NEXUS_RADIUS + 2;
        if (Tr && typeof Tr.deform === 'function' && plazaSafe) {
          try {
            if (q.mode === 'crater') {
              Tr.deform(q.x, q.z, q.radius * 0.5, 4.5 * q.strength, 'crater');
            } else {
              const sx = Math.sin(q.angle), sz = Math.cos(q.angle);
              for (let k = -1; k <= 1; k++) {
                const px = q.x + sx * k * q.radius * 0.42, pz = q.z + sz * k * q.radius * 0.42;
                if (!inArena(px, pz, 4)) continue;
                if (Math.sqrt(px * px + pz * pz) - q.radius * 0.38 < CFG.NEXUS_RADIUS + 2) continue;
                Tr.deform(px, pz, q.radius * 0.38, (k === 0 ? 6 : 4.5) * q.strength, 'raise');
              }
            }
          } catch (err) { GM.reportError('Hazards.quakeDeform', err); }
        }
        const y = groundY(q.x, q.z);
        fx('ring', P3(q.x, y + 0.3, q.z), 0x8a6a48, q.radius * 0.9, 0.9);
        quakeDust(q, 8);
      }
      if (!q.after && q.t >= 1.5) {
        q.after = true;
        quakeJolt(q, false);
        quakeDust(q, 4);
        fx('ring', P3(q.x, groundY(q.x, q.z) + 0.3, q.z), 0xa08060, q.radius, 1);
      }
      if (q.t >= 3.2) quakes.splice(i, 1);
    }
  }

  // ================================================================ FLOOD
  /** Raise the water `height` metres for `duration` sim seconds, then let it go back down. */
  function flood(height, duration) {
    const E = GM.Env;
    if (!E || typeof E.setWaterLevel !== 'function') return false;
    height = height == null ? 4 : U.clamp(+height || 4, 0.5, 12);
    duration = duration == null ? 60 : Math.max(10, +duration || 60);
    const base = CFG.BASE_WATER_LEVEL;
    const level = base + height;
    try { E.setWaterLevel(level, 10); } catch (err) { GM.reportError('Hazards.flood', err); return false; }
    floodState.active = true;
    floodState.level = level;
    floodState.height = height;
    floodState.until = GM.state.time + duration;
    const Tr = GM.Terrain;
    const lake = Tr && Tr.landmarks && Tr.landmarks.lakes && Tr.landmarks.lakes[0];
    const p = lake ? P3(lake.x, level, lake.z) : P3(0, level, 0);
    GM.emit('hazard:flood', { pos: p, radius: CFG.ARENA_RADIUS, level: level });
    interest({ pos: p, score: 7, duration: 12, kind: 'hazard', key: 'flood', label: { key: 'hazard.interest.flood' } });
    sfx('splash', p, 1);
    return true;
  }

  function updateFlood() {
    if (!floodState.active) return;
    if (GM.state.time >= floodState.until) {
      floodState.active = false;
      const E = GM.Env;
      if (E && typeof E.setWaterLevel === 'function') {
        try { E.setWaterLevel(CFG.BASE_WATER_LEVEL, 15); } catch (err) { GM.reportError('Hazards.floodEnd', err); }
      }
      GM.log('hazard', 'log.hazard.floodEnd', {}, {});
    }
  }

  // ================================================================= ZONE
  function resetZone() {
    zone.active = false;
    zone.center.x = 0; zone.center.z = 0;
    zone.radius = CFG.ARENA_RADIUS;
    zone.targetRadius = CFG.ARENA_RADIUS;
    zone.targetCenter.x = 0; zone.targetCenter.z = 0;
    zone.startRadius = CFG.ARENA_RADIUS;
    zone.startCenter.x = 0; zone.startCenter.z = 0;
    zone.shrinking = false;
    zone.suddenDeath = false;
    zone.t0 = zone.t1 = 0;
    zone.damage = 5;
    wallAlpha = 0;
    wallR = -1;
  }

  /** Where a zone of `radius` around `center` would really go (kept inside the current zone). */
  function previewZone(center, radius) {
    let r = U.clamp(+radius || 20, 12, zone.radius);
    let cx = center ? +center.x || 0 : 0, cz = center ? +center.z || 0 : 0;
    const dx = cx - zone.center.x, dz = cz - zone.center.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const maxOff = Math.max(0, zone.radius - r);
    if (d > maxOff && d > 0.001) {
      cx = zone.center.x + (dx / d) * maxOff;
      cz = zone.center.z + (dz / d) * maxOff;
    }
    return { x: cx, z: cz, radius: r };
  }

  /** Smoothly close the force field to `radius` around `center` over `seconds` (sim). */
  function shrinkZone(center, radius, seconds) {
    const pz = previewZone(center, radius);
    if (pz.radius >= zone.radius - 0.5) return false;
    const now = GM.state.time;
    zone.startCenter.x = zone.center.x;
    zone.startCenter.z = zone.center.z;
    zone.startRadius = zone.radius;
    zone.targetCenter.x = pz.x;
    zone.targetCenter.z = pz.z;
    zone.targetRadius = pz.radius;
    zone.t0 = now;
    zone.t1 = now + Math.max(1, +seconds || 60);
    zone.active = true;
    zone.shrinking = true;
    zoneShrinkId++;
    GM.emit('zone:shrink', { center: { x: pz.x, z: pz.z }, radius: zone.radius, targetRadius: pz.radius });
    sfx('alarm', P3(pz.x, groundY(pz.x, pz.z), pz.z), 0.7);
    return true;
  }

  function isInsideZone(x, z) {
    const dx = x - zone.center.x, dz = z - zone.center.z;
    return dx * dx + dz * dz <= zone.radius * zone.radius;
  }

  function updateZone() {
    if (!zone.shrinking) return;
    const now = GM.state.time;
    const u = U.clamp01((now - zone.t0) / Math.max(0.001, zone.t1 - zone.t0));
    const s = u * u * (3 - 2 * u);
    zone.radius = zone.startRadius + (zone.targetRadius - zone.startRadius) * s;
    zone.center.x = zone.startCenter.x + (zone.targetCenter.x - zone.startCenter.x) * s;
    zone.center.z = zone.startCenter.z + (zone.targetCenter.z - zone.startCenter.z) * s;
    if (u >= 1) {
      zone.shrinking = false;
      GM.log('hazard', 'log.hazard.zoneDone', {}, { pos: P3(zone.center.x, 0, zone.center.z) });
    }
  }

  function aliveCount() {
    const trs = GM.state.contestants;
    let n = 0;
    for (let i = 0; i < trs.length; i++) if (trs[i] && trs[i].alive) n++;
    return n;
  }

  function suddenDeathCheck() {
    const st = GM.state;
    if (zone.suddenDeath || st.phase !== 'running') return;
    let day = st.day || 1;
    if (!GM.Env) {
      const sinceDawn = st.time + (CFG.START_TIME_OF_DAY - CFG.DAWN) * CFG.DAY_LENGTH;
      day = Math.max(day, 1 + Math.floor(sinceDawn / CFG.DAY_LENGTH));
    }
    if (day < 4 || aliveCount() < 2) return;
    zone.suddenDeath = true;
    let p = null;
    const Tr = GM.Terrain;
    if (Tr && typeof Tr.randomLandPoint === 'function') {
      try { p = Tr.randomLandPoint({ minR: 0, maxR: 30 }); } catch (err) { p = null; }
    }
    if (!p) p = { x: 0, z: 0 };
    // the Showrunner may already have closed the field: then close it further
    const target = zone.radius > 45 ? 35 : Math.max(12, zone.radius * 0.6);
    if (target < zone.radius - 0.5) shrinkZone(p, target, (zone.radius > 45 ? 1.5 : 0.75) * CFG.DAY_LENGTH);
    GM.announce('ann.gm.suddenDeath', {}, { style: 'danger', duration: 6 });
    GM.log('hazard', 'log.hazard.suddenDeath', {}, { important: true, pos: P3(p.x, 0, p.z) });
  }

  // =============================================================== DANGER
  /** Combined danger 0..1 at a point (fire, gas, zone, incoming fireballs, flood). O(1). */
  function dangerAt(x, z) {
    let d = 0;
    const ci = cellOf(x, z);
    if (ci < 0) return 1;
    d = fdanger[ci];
    for (let k = 0; k < clouds.length; k++) {
      const c = clouds[k];
      if (c.alpha < 0.15) continue;
      const dx = x - c.x, dz = z - c.z;
      const rr = c.r + 3;
      const dsq = dx * dx + dz * dz;
      if (dsq < rr * rr) {
        const v = (c.kind === 'madness' ? 0.75 : 0.85) * c.alpha * (1 - 0.45 * Math.sqrt(dsq) / rr);
        if (v > d) d = v;
      }
    }
    for (let k = 0; k < fbPool.length; k++) {
      const fb = fbPool[k];
      if (!fb.active) continue;
      const dx = x - fb.tx, dz = z - fb.tz;
      if (dx * dx + dz * dz < 121) { if (d < 0.85) d = 0.85; }
    }
    if (zone.active) {
      const dx = x - zone.center.x, dz = z - zone.center.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > zone.radius) d = 1;
      else if (dist > zone.radius - 8) {
        const v = 0.35 * (dist - (zone.radius - 8)) / 8;
        if (v > d) d = v;
      }
      if (zone.shrinking) {
        // where the field is going: mild danger outside the final circle
        const tx = x - zone.targetCenter.x, tz = z - zone.targetCenter.z;
        if (tx * tx + tz * tz > zone.targetRadius * zone.targetRadius && d < 0.25) d = 0.25;
      }
    }
    if (floodState.active && cellH[ci] < floodState.level + 0.3 && d < 0.3) d = 0.3;
    return d > 1 ? 1 : d;
  }

  /** Nearby danger sources: [{x, z, radius, type, level}] (fire clusters, gas, fireballs, quakes, zone). */
  function dangers(pos, r) {
    const out = [];
    if (!pos) return out;
    const px = +pos.x || 0, pz = +pos.z || 0;
    r = r == null ? 40 : +r;
    for (let k = 0; k < clusterCount; k++) {
      const c = clusters[k];
      const dx = c.x - px, dz = c.z - pz;
      const lim = r + c.radius;
      if (dx * dx + dz * dz <= lim * lim) out.push({ x: c.x, z: c.z, radius: c.radius, type: 'fire', level: c.level });
    }
    for (let k = 0; k < clouds.length; k++) {
      const c = clouds[k];
      if (c.alpha < 0.1) continue;
      const dx = c.x - px, dz = c.z - pz;
      const lim = r + c.r;
      if (dx * dx + dz * dz <= lim * lim) out.push({ x: c.x, z: c.z, radius: c.r + 2, type: c.kind === 'madness' ? 'madness' : 'gas', level: 0.85 * c.alpha });
    }
    for (let k = 0; k < fbPool.length; k++) {
      const fb = fbPool[k];
      if (!fb.active) continue;
      const dx = fb.tx - px, dz = fb.tz - pz;
      const lim = r + 10;
      if (dx * dx + dz * dz <= lim * lim) out.push({ x: fb.tx, z: fb.tz, radius: 10, type: 'fireball', level: 0.9 });
    }
    for (let k = 0; k < quakes.length; k++) {
      const q = quakes[k];
      const dx = q.x - px, dz = q.z - pz;
      const lim = r + q.radius;
      if (dx * dx + dz * dz <= lim * lim) out.push({ x: q.x, z: q.z, radius: q.radius, type: 'quake', level: 0.6 });
    }
    if (zone.active) {
      const dx = px - zone.center.x, dz = pz - zone.center.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const toEdge = zone.radius - d;
      if (toEdge < r) {
        const ux = d > 0.001 ? dx / d : 1, uz = d > 0.001 ? dz / d : 0;
        if (d > zone.radius) {
          // outside: the source sits further out, so fleeing from it leads back inside
          out.push({ x: zone.center.x + ux * (d + 20), z: zone.center.z + uz * (d + 20), radius: d - zone.radius + 22, type: 'zone', level: 1 });
        } else {
          out.push({ x: zone.center.x + ux * (zone.radius + 8), z: zone.center.z + uz * (zone.radius + 8), radius: 10, type: 'zone', level: 0.4 });
        }
      }
    }
    return out;
  }

  // ========================================================= DAMAGE TICK
  function damageTick() {
    const st = GM.state;
    const trs = st.contestants;
    const now = st.time;
    for (let k = 0; k < trs.length; k++) {
      const t = trs[k];
      if (!t || !t.alive || !t.pos) continue;
      const x = t.pos.x, z = t.pos.z;
      // fire
      const ci = cellOf(x, z);
      if (ci >= 0 && fstate[ci] === 1 && inten[ci] > 0.12 && !t.swimming) {
        hurt(t, FIRE_DPS * DAMAGE_TICK * (0.45 + 0.55 * inten[ci]), 'fire', t.pos);
        if (t.alive) tribCall('setStatus', t, 'burning', 2.5);
        if (!(lastFireLog[t.id] > now - 25)) {
          lastFireLog[t.id] = now;
          GM.log('hazard', 'log.hazard.caughtFire', { name: t.name }, { pos: t.pos, contestantIds: [t.id] });
        }
      }
      // gas
      for (let c = 0; c < clouds.length && t.alive; c++) {
        const cl = clouds[c];
        if (cl.alpha < 0.25) continue;
        const dx = x - cl.x, dz = z - cl.z;
        const dsq = dx * dx + dz * dz;
        if (dsq > cl.r * cl.r) continue;
        const dens = (1 - 0.5 * Math.sqrt(dsq) / cl.r) * cl.alpha;
        const first = !cl.hit.has(t.id);
        if (cl.kind === 'poison') {
          hurt(t, GAS_DPS * DAMAGE_TICK * dens, 'gas', t.pos);
          if (first && t.alive) {
            cl.hit.add(t.id);
            GM.log('hazard', 'log.hazard.gasHit', { name: t.name }, { pos: t.pos, contestantIds: [t.id] });
            const brave = t.traits && typeof t.traits.bravery === 'number' ? t.traits.bravery : 0.5;
            if (brave < 0.55) applyMindStatus(t, 'panic', 3);
          }
        } else {
          const left = t.status && typeof t.status.madness === 'number' ? t.status.madness : 0;
          if (first || left < 8) applyMindStatus(t, 'madness', first ? 25 : 12);
          if (first) {
            cl.hit.add(t.id);
            GM.log('hazard', 'log.hazard.madnessHit', { name: t.name }, { pos: t.pos, contestantIds: [t.id], important: true });
          }
        }
        interest({ pos: t.pos, score: 7, duration: 3, kind: 'hazard', key: 'gas:' + cl.id, followId: t.id, label: { key: 'hazard.interest.gas', params: { name: t.name } } });
      }
      // force field
      if (zone.active && t.alive) {
        const dx = x - zone.center.x, dz = z - zone.center.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > zone.radius) {
          const outside = d - zone.radius;
          hurt(t, zone.damage * DAMAGE_TICK * (1 + Math.min(2, outside / 20)), 'forcefield', t.pos);
          if (t.alive && d > 0.01) tribCall('knockback', t, -dx / d, -dz / d, 1.2);
          fx('burst', P3(x, t.pos.y + 1, z), { count: 6, color: 0xff5a8a, color2: 0xff2a4a, speed: 3, spread: 0.6, up: 1.5, gravity: -4, size: 0.18, life: 0.5, additive: true });
          if (lastZoneLog[t.id] !== zoneShrinkId) {
            lastZoneLog[t.id] = zoneShrinkId;
            GM.log('hazard', 'log.hazard.outsideZone', { name: t.name }, { pos: t.pos, contestantIds: [t.id] });
          }
          interest({ pos: t.pos, score: 7, duration: 3, kind: 'hazard', key: 'zone:' + t.id, followId: t.id, label: { key: 'hazard.interest.zone', params: { name: t.name } } });
        }
      }
    }
    // beasts suffer from fire and poison too
    const ms = st.beasts;
    for (let k = 0; k < ms.length; k++) {
      const m = ms[k];
      if (!m || !m.alive || !m.pos) continue;
      const ci = cellOf(m.pos.x, m.pos.z);
      if (ci >= 0 && fstate[ci] === 1 && inten[ci] > 0.12) hurtBeast(m, FIRE_DPS * DAMAGE_TICK * (0.6 + 0.6 * inten[ci]));
      for (let c = 0; c < clouds.length && m.alive; c++) {
        const cl = clouds[c];
        if (cl.kind !== 'poison' || cl.alpha < 0.25) continue;
        const dx = m.pos.x - cl.x, dz = m.pos.z - cl.z;
        if (dx * dx + dz * dz <= cl.r * cl.r) hurtBeast(m, GAS_DPS * DAMAGE_TICK * cl.alpha);
      }
    }
  }

  function interestTick() {
    if (burnCount > 0 && biggestCluster >= 0 && biggestCluster < clusterCount) {
      const c = clusters[biggestCluster];
      interest({ pos: P3(c.x, groundY(c.x, c.z), c.z), score: 5 + Math.min(2, c.count / 20), duration: 4, kind: 'hazard', key: 'fire', label: { key: 'hazard.interest.fire' } });
    }
    if (burnCount > 0) {
      const trs = GM.state.contestants;
      for (let k = 0; k < trs.length; k++) {
        const t = trs[k];
        if (!t || !t.alive) continue;
        const ci = cellOf(t.pos.x, t.pos.z);
        if (ci >= 0 && fdanger[ci] >= 0.4) {
          interest({ pos: t.pos, score: 7.5, duration: 4, kind: 'hazard', key: 'fire:' + t.id, followId: t.id, label: { key: 'hazard.interest.fireNear', params: { name: t.name } } });
        }
      }
    }
  }

  // ============================================================== VISUALS
  function drawFlames() {
    if (!flameMesh) return;
    if (burnCount === 0) {
      flameMesh.visible = false;
      flameGeo.instanceCount = 0;
      return;
    }
    const cap = isLow() ? 420 : FLAME_CAP;
    const off = flameOff.array, dat = flameData.array;
    const stride = Math.max(1, Math.ceil((burnCount * 2) / cap));
    let n = 0;
    for (let k = 0; k < burnCount && n < cap; k += stride) {
      const i = burnList[k];
      const it = inten[i];
      if (it < 0.03) continue;
      const cx = cellX(i), cz = cellZ(i);
      const fr = forestC[i];
      const sd = jSeed[i];
      // ground flame
      off[n * 3] = cx + jx0[i]; off[n * 3 + 1] = fy0[i] - 0.1; off[n * 3 + 2] = cz + jz0[i];
      dat[n * 4] = (fr > 0.3 ? 2.8 : 1.7) * (0.45 + 0.75 * it);
      dat[n * 4 + 1] = Math.min(1, 0.35 + it);
      dat[n * 4 + 2] = sd;
      dat[n * 4 + 3] = 0;
      n++;
      // burning tree crown
      if (fr > 0.3 && n < cap && it > 0.3) {
        off[n * 3] = cx + jx1[i]; off[n * 3 + 1] = fy1[i] + 2 + fr * 3.5; off[n * 3 + 2] = cz + jz1[i];
        dat[n * 4] = (3.2 + 3.2 * fr) * (0.4 + 0.7 * it);
        dat[n * 4 + 1] = Math.min(1, 0.2 + it * 0.9);
        dat[n * 4 + 2] = (sd + 0.37) % 1;
        dat[n * 4 + 3] = 1;
        n++;
      }
      // extra ground flame in dense forest
      if (fr > 0.6 && it > 0.55 && n < cap) {
        off[n * 3] = cx - jx0[i] * 0.8; off[n * 3 + 1] = fy0[i] - 0.1; off[n * 3 + 2] = cz - jz0[i] * 0.8;
        dat[n * 4] = 2.2 * it;
        dat[n * 4 + 1] = it * 0.9;
        dat[n * 4 + 2] = (sd + 0.71) % 1;
        dat[n * 4 + 3] = 0;
        n++;
      }
    }
    flameGeo.instanceCount = n;
    flameMesh.visible = n > 0;
    flameOff.updateRange.offset = 0;
    flameOff.updateRange.count = n * 3;
    flameData.updateRange.offset = 0;
    flameData.updateRange.count = n * 4;
    flameOff.needsUpdate = true;
    flameData.needsUpdate = true;
  }

  const POISON_RGB = [0.52, 0.86, 0.26];
  const MADNESS_RGB = [0.66, 0.36, 0.95];
  function drawGas() {
    if (!gasMesh) return;
    if (!clouds.length) {
      gasMesh.visible = false;
      gasGeo.instanceCount = 0;
      return;
    }
    const off = gasOff.array, dat = gasData.array, col = gasCol.array;
    const wl = waterY();
    let n = 0;
    for (let c = 0; c < clouds.length; c++) {
      const cl = clouds[c];
      const rgb = cl.kind === 'madness' ? MADNESS_RGB : POISON_RGB;
      const cs = Math.cos(cl.swirl), sn = Math.sin(cl.swirl);
      const hScale = 0.6 + cl.r / 20;
      const baseAlpha = cl.kind === 'madness' ? 0.3 : 0.32;
      for (let k = 0; k < cl.puffCount && n < GAS_CAP; k++) {
        const o = k * 6;
        const ux = cl.puffs[o], uz = cl.puffs[o + 1];
        const x = cl.x + (ux * cs - uz * sn) * cl.r;
        const z = cl.z + (ux * sn + uz * cs) * cl.r;
        let gy = groundY(x, z);
        if (gy < wl) gy = wl;
        off[n * 3] = x;
        off[n * 3 + 1] = gy + cl.puffs[o + 2] * hScale;
        off[n * 3 + 2] = z;
        dat[n * 4] = cl.puffs[o + 3] * cl.r * 1.25 + 2;
        dat[n * 4 + 1] = cl.alpha * baseAlpha * (0.55 + 0.45 * cl.puffs[o + 5]);
        dat[n * 4 + 2] = cl.puffs[o + 4];
        dat[n * 4 + 3] = (cl.puffs[o + 4] - 0.5) * 0.35;
        col[n * 3] = rgb[0]; col[n * 3 + 1] = rgb[1]; col[n * 3 + 2] = rgb[2];
        n++;
      }
    }
    gasGeo.instanceCount = n;
    gasMesh.visible = n > 0;
    gasOff.updateRange.offset = 0; gasOff.updateRange.count = n * 3;
    gasData.updateRange.offset = 0; gasData.updateRange.count = n * 4;
    gasCol.updateRange.offset = 0; gasCol.updateRange.count = n * 3;
    gasOff.needsUpdate = gasData.needsUpdate = gasCol.needsUpdate = true;
  }

  function drawZone(realDt) {
    if (!wallMesh) return;
    const show = zone.active && zone.radius < CFG.ARENA_RADIUS - 0.25;
    wallAlpha = U.damp(wallAlpha, show ? 1 : 0, 2.5, realDt);
    if (wallAlpha < 0.01 && !show) {
      wallMesh.visible = false;
      return;
    }
    wallMesh.visible = true;
    const R = zone.radius, cx = zone.center.x, cz = zone.center.z;
    if (Math.abs(R - wallR) > 0.01 || Math.abs(cx - wallCx) > 0.01 || Math.abs(cz - wallCz) > 0.01) {
      wallR = R; wallCx = cx; wallCz = cz;
      const pos = wallPos.array;
      const wl = waterY();
      for (let i = 0; i <= WALL_SEG; i++) {
        const a = (i / WALL_SEG) * TAU;
        const x = cx + Math.sin(a) * R, z = cz + Math.cos(a) * R;
        let g = groundY(x, z);
        if (g < wl) g = wl;
        const o = i * 6;
        pos[o] = x; pos[o + 1] = g - WALL_BELOW; pos[o + 2] = z;
        pos[o + 3] = x; pos[o + 4] = g + WALL_ABOVE; pos[o + 5] = z;
      }
      wallPos.needsUpdate = true;
      wallMat.uniforms.uCirc.value = TAU * R;
    }
    wallMat.uniforms.uAlpha.value = wallAlpha;
    wallMat.uniforms.uPulse.value = zone.shrinking ? 0.5 + 0.5 * Math.sin(visualTime * 5) : 0.2;
  }

  function drawFireballs(realDt, paused) {
    const pulse = 0.55 + 0.45 * Math.sin(visualTime * 14);
    if (warnMat) warnMat.opacity = 0.35 + 0.55 * pulse;
    for (let i = 0; i < fbPool.length; i++) {
      const fb = fbPool[i];
      if (!fb.active || !fb.group) continue;
      fb.group.position.set(fb.x, fb.y, fb.z);
      const gs = 10 + Math.sin(visualTime * 30 + i) * 1.5;
      fb.glow.scale.set(gs, gs, 1);
      const u = Math.min(1, fb.t / fb.dur);
      const ws = 9 * (1.15 - 0.25 * u) * (0.92 + 0.08 * pulse);
      fb.warn.scale.set(ws, 1, ws);
      if (!paused) {
        // particle trail between the last emit point and now
        const dx = fb.x - fb.ex, dy = fb.y - fb.ey, dz = fb.z - fb.ez;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const steps = Math.min(4, Math.max(1, Math.floor(dist / 5)));
        for (let s = 1; s <= steps; s++) {
          const f = s / steps;
          _fxPos.set(fb.ex + dx * f, fb.ey + dy * f, fb.ez + dz * f);
          fx('emit', _fxPos, TRAIL_FIRE);
          if (s === steps && !isLow()) fx('emit', _fxPos, TRAIL_SMOKE);
        }
        fb.ex = fb.x; fb.ey = fb.y; fb.ez = fb.z;
      }
    }
  }

  function drawBolts(realDt, paused) {
    for (let i = 0; i < bolts.length; i++) {
      const b = bolts[i];
      if (!b.active) continue;
      if (!paused) b.age += realDt;
      const a = b.age;
      let o;
      if (a < 0.06) o = 1;
      else if (a < 0.1) o = 0.25;
      else if (a < 0.18) o = 1;
      else o = Math.max(0, 1 - (a - 0.18) / (BOLT_LIFE - 0.18));
      b.core.material.opacity = o;
      b.glow.material.opacity = 0.45 * o;
      if (a >= BOLT_LIFE) {
        b.active = false;
        b.core.visible = b.glow.visible = false;
      }
    }
  }

  function emitSmoke(realDt, paused) {
    if (paused || !GM.FX) return;
    const low = isLow();
    if (burnCount > 0) {
      smokeAcc += realDt * Math.min(low ? 7 : 16, 1.5 + burnCount * 0.12);
      let guard = 0;
      while (smokeAcc >= 1 && guard++ < 16) {
        smokeAcc -= 1;
        const i = burnList[(Math.random() * burnCount) | 0];
        const fr = forestC[i];
        _fxPos.set(cellX(i) + (Math.random() - 0.5) * 3, cellH[i] + (fr > 0.3 ? 4 + fr * 3 : 1), cellZ(i) + (Math.random() - 0.5) * 3);
        SMOKE_OPTS.size = 2.4 + fr * 2.2;
        fx('emit', _fxPos, SMOKE_OPTS);
        if (Math.random() < 0.4) {
          _fxPos.y = cellH[i] + 1 + fr * 3;
          fx('emit', _fxPos, EMBER_OPTS);
        }
      }
    } else smokeAcc = 0;
    // smouldering ground after the fire
    smoulderAcc += realDt;
    if (smoulderAcc >= (low ? 0.6 : 0.3)) {
      smoulderAcc = 0;
      const now = GM.state.time;
      const k = (Math.random() * SMOULDER_N) | 0;
      const i = smoulderCell[k];
      if (i >= 0 && now - smoulderTime[k] < 30 && fstate[i] === 2) {
        _fxPos.set(cellX(i) + (Math.random() - 0.5) * 3, cellH[i] + 0.5, cellZ(i) + (Math.random() - 0.5) * 3);
        fx('emit', _fxPos, THIN_SMOKE);
      }
    }
    // gas sparkles make the clouds read as alive
    if (!low) {
      for (let c = 0; c < clouds.length; c++) {
        const cl = clouds[c];
        cl.sparkAcc += realDt * 3 * cl.alpha;
        if (cl.sparkAcc >= 1) {
          cl.sparkAcc = 0;
          const a = Math.random() * TAU, r = Math.random() * cl.r * 0.8;
          const x = cl.x + Math.sin(a) * r, z = cl.z + Math.cos(a) * r;
          _fxPos.set(x, groundY(x, z) + 1 + Math.random() * 3, z);
          GAS_SPARK.color = cl.kind === 'madness' ? 0xd29aff : 0x9cff60;
          GAS_SPARK.color2 = cl.kind === 'madness' ? 0x6a2aaa : 0x3a7a20;
          fx('emit', _fxPos, GAS_SPARK);
        }
      }
    }
  }

  function updateFireLight(realDt) {
    if (!fireLight) return;
    lightAcc += realDt;
    if (lightAcc >= 0.4) {
      lightAcc = 0;
      if (burnCount === 0 || isLow()) {
        lightTarget.i = 0;
      } else {
        const cp = cameraPos();
        const fx0 = cp ? cp.x : 0, fz0 = cp ? cp.z : 0;
        let best = -1, bd = 1e12;
        for (let k = 0; k < burnCount; k++) {
          const i = burnList[k];
          const dx = cellX(i) - fx0, dz = cellZ(i) - fz0;
          const d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = i; }
        }
        if (best >= 0) {
          const bx = cellX(best), bz = cellZ(best);
          let sx = 0, sz = 0, sw = 0, cnt = 0;
          for (let k = 0; k < burnCount; k++) {
            const i = burnList[k];
            const dx = cellX(i) - bx, dz = cellZ(i) - bz;
            if (dx * dx + dz * dz > 1600) continue;
            const w = inten[i];
            sx += cellX(i) * w; sz += cellZ(i) * w; sw += w; cnt++;
          }
          if (sw > 0.001) {
            lightTarget.x = sx / sw;
            lightTarget.z = sz / sw;
            lightTarget.y = groundY(lightTarget.x, lightTarget.z) + 6;
            const night = 1.35 - 0.75 * daylight();
            lightTarget.i = Math.min(2.6, 0.5 + 0.06 * cnt) * night;
          } else lightTarget.i = 0;
        }
      }
    }
    const lp = fireLight.position;
    if (fireLight.intensity < 0.02 && lightTarget.i > 0) lp.set(lightTarget.x, lightTarget.y, lightTarget.z);
    lp.x = U.damp(lp.x, lightTarget.x, 3, realDt);
    lp.y = U.damp(lp.y, lightTarget.y, 3, realDt);
    lp.z = U.damp(lp.z, lightTarget.z, 3, realDt);
    const flick = 0.85 + 0.15 * Math.sin(visualTime * 17) * Math.sin(visualTime * 7.3);
    fireLight.intensity = U.damp(fireLight.intensity, lightTarget.i, 2, realDt) * (lightTarget.i > 0 ? flick : 1);
    if (fireLight.intensity < 0.005) fireLight.intensity = 0;
  }

  // ============================================================ LIFECYCLE
  function clearAll() {
    fstate.fill(0);
    inten.fill(0);
    fdanger.fill(0);
    listPos.fill(-1);
    burnCount = 0;
    burntCount = 0;
    peakBurn = 0;
    clusterCount = 0;
    biggestCluster = -1;
    burnQueue.length = 0;
    burnQueueHead = 0;
    smoulderCell.fill(-1);
    clouds.length = 0;
    quakes.length = 0;
    floodState.active = false;
    floodState.until = 0;
    resetZone();
    fireAcc = dmgAcc = flushAcc = interestAcc = suddenAcc = 0;
    smokeAcc = smoulderAcc = 0;
    lastFireLog = [];
    lastZoneLog = [];
    lastBlastLog = [];
    zoneShrinkId = 0;
    for (let i = 0; i < fbPool.length; i++) {
      const fb = fbPool[i];
      fb.active = false;
      if (fb.group) { fb.group.visible = false; fb.warn.visible = false; }
    }
    for (let i = 0; i < bolts.length; i++) {
      bolts[i].active = false;
      bolts[i].core.visible = bolts[i].glow.visible = false;
    }
    scorchN = 0;
    scorchHead = 0;
    if (scorchMesh) scorchMesh.count = 0;
    if (flameMesh) { flameMesh.visible = false; flameGeo.instanceCount = 0; }
    if (gasMesh) { gasMesh.visible = false; gasGeo.instanceCount = 0; }
    if (wallMesh) wallMesh.visible = false;
    if (fireLight) { fireLight.intensity = 0; lightTarget.i = 0; }
  }

  GM.registerSystem({
    name: 'Hazards',
    order: 30,
    init() {
      buildVisuals();
      GM.on('terrain:changed', function (e) {
        if (!e || GM.state.phase === 'setup' || GM.state.phase === 'boot') return;
        refreshCellHeights(+e.x || 0, +e.z || 0, +e.radius || 10);
      });
      GM.on('day:start', function () {
        try { suddenDeathCheck(); } catch (err) { GM.reportError('Hazards.suddenDeath', err); }
      });
    },
    clear() {
      clearAll();
    },
    reset() {
      buildVisuals();
      clearAll();
      computeGrid();
      const s = GM.state.settings;
      if (s) dryness = DRY_TARGET[weather()] != null ? DRY_TARGET[weather()] : 0.55;
      // safety net: a flood from the last game must not leak into this one
      const E = GM.Env;
      if (E && typeof E.waterLevel === 'number' && Math.abs(E.waterLevel - CFG.BASE_WATER_LEVEL) > 0.05 && typeof E.setWaterLevel === 'function') {
        try { E.setWaterLevel(CFG.BASE_WATER_LEVEL, 0.5); } catch (err) { GM.reportError('Hazards.resetWater', err); }
      }
    },
    update(dt) {
      const st = GM.state;
      const target = DRY_TARGET[weather()];
      dryness = U.damp(dryness, target == null ? 0.55 : target, 0.04, dt);
      fireAcc += dt;
      if (fireAcc >= FIRE_TICK) {
        fireAcc -= FIRE_TICK;
        if (fireAcc > FIRE_TICK) fireAcc = 0;
        fireTick();
      }
      updateGas(dt);
      updateFireballs(dt);
      updateQuakes(dt);
      updateFlood();
      updateZone();
      dmgAcc += dt;
      if (dmgAcc >= DAMAGE_TICK) {
        dmgAcc -= DAMAGE_TICK;
        if (dmgAcc > DAMAGE_TICK) dmgAcc = 0;
        damageTick();
      }
      flushAcc += dt;
      if (flushAcc >= 0.4) { flushAcc = 0; flushBurnQueue(); }
      interestAcc += dt;
      if (interestAcc >= 2) { interestAcc = 0; interestTick(); }
      suddenAcc += dt;
      if (suddenAcc >= 1) {
        suddenAcc = 0;
        if (st.phase === 'running') suddenDeathCheck();
      }
    },
    frame(realDt) {
      if (!built) return;
      const paused = GM.state.paused;
      visualTime += realDt;
      flameMat.uniforms.uTime.value = visualTime;
      gasMat.uniforms.uTime.value = visualTime;
      gasMat.uniforms.uLight.value = 0.45 + 0.55 * daylight();
      wallMat.uniforms.uTime.value = visualTime;
      drawFlames();
      drawGas();
      drawZone(realDt);
      drawFireballs(realDt, paused);
      drawBolts(realDt, paused);
      emitSmoke(realDt, paused);
      updateFireLight(realDt);
      if (scorchDirty && scorchMesh) {
        scorchDirty = false;
        scorchMesh.instanceMatrix.needsUpdate = true;
        if (scorchMesh.instanceColor) scorchMesh.instanceColor.needsUpdate = true;
      }
    },
  });

  // ============================================================ PUBLIC API
  Hazards.fire = fire;
  Hazards.zone = zone;
  Hazards.gas = clouds;
  Hazards.clouds = clouds;
  Hazards.quakes = quakes;
  Hazards.flooding = floodState;
  Hazards.fireballs = fbPool;
  Hazards.dangerAt = dangerAt;
  Hazards.dangers = dangers;
  Hazards.ignite = ignite;
  Hazards.extinguish = extinguish;
  Hazards.isBurning = isBurning;
  Hazards.lightning = lightning;
  Hazards.explosion = explosion;
  Hazards.fireball = fireball;
  Hazards.gasCloud = gasCloud;
  Hazards.earthquake = earthquake;
  Hazards.flood = flood;
  Hazards.shrinkZone = shrinkZone;
  Hazards.isInsideZone = isInsideZone;
  Hazards.previewZone = previewZone;
  Hazards.scorch = addScorch;
  /** Current fire dryness 0..1 (heat raises it, rain/snow lower it). */
  Hazards.dryness = function () { return dryness; };
  /** Is (x, z) inside any gas cloud? Returns the cloud or null. */
  Hazards.gasAt = function (x, z) {
    for (let k = 0; k < clouds.length; k++) {
      const c = clouds[k];
      const dx = x - c.x, dz = z - c.z;
      if (c.alpha > 0.2 && dx * dx + dz * dz <= c.r * c.r) return c;
    }
    return null;
  };
})();
