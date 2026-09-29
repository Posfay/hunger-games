/* ==========================================================================
 * terrain.js — GM.Terrain: the arena as data (heights, biomes, forest cover,
 * navigation grid, landmarks) plus all spatial queries.
 *
 * The mesh lives in world.js; this module is pure data + queries and must be
 * cheap to call from AI code many times per frame.
 *
 * Layout (deterministic from the seed):
 *   - flat plaza (radius CFG.CORNUCOPIA_RADIUS, y ~2) with the cornucopia at 0,0
 *   - meadows, noise-driven forest belts (clearing of ~30 m around the plaza)
 *   - 1-3 lakes 45-120 m from the centre with sandy shores, maybe a stream
 *   - 2-4 rocky hills, rock shelters / caves at their feet
 *   - rim mountains that rise steeply from ~135 m, so the force field
 *     (CFG.ARENA_RADIUS) stands on the slopes
 *
 * Height sampling is piecewise-linear on the SAME triangles the World mesh
 * uses (diagonal from (ix,iz) to (ix+1,iz+1)), so feet sit exactly on the
 * rendered ground.
 *
 * Compass used by the helpers: north = -Z, east = +X.
 *
 * Owner: WORLD.
 * ========================================================================== */
(function () {
  'use strict';
  const GM = window.GM;
  const CFG = GM.CFG;
  const U = GM.U;
  const THREE = window.THREE;
  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------- strings
  GM.i18n.add({
    en: {
      'terrain.biome.plaza': 'Cornucopia plaza',
      'terrain.biome.sand': 'Beach',
      'terrain.biome.grass': 'Meadow',
      'terrain.biome.forest': 'Forest',
      'terrain.biome.rock': 'Rocks',
      'terrain.biome.snow': 'Snowy peak',
      'terrain.biome.water': 'Water',
      'terrain.biome.swamp': 'Swamp',
      'terrain.cornucopia': 'Cornucopia',
      'terrain.lake': 'Lake',
      'terrain.stream': 'Stream',
      'terrain.hill': 'Hill',
      'terrain.cave': 'Cave',
      'terrain.thicket': 'Thick forest',
      'terrain.mountains': 'Mountains',
      'terrain.place.plaza': 'at the Cornucopia',
      'terrain.place.sand': 'on the beach',
      'terrain.place.grass': 'in the meadow',
      'terrain.place.forest': 'in the forest',
      'terrain.place.rock': 'in the rocks',
      'terrain.place.snow': 'high in the mountains',
      'terrain.place.water': 'in the water',
      'terrain.place.swamp': 'in the swamp',
      'terrain.place.cave': 'in a cave',
      'terrain.place.lake': 'by the lake',
      'terrain.place.hill': 'on a hill',
      'terrain.place.thicket': 'in the thick forest',
      'terrain.dir.n': 'north',
      'terrain.dir.ne': 'north-east',
      'terrain.dir.e': 'east',
      'terrain.dir.se': 'south-east',
      'terrain.dir.s': 'south',
      'terrain.dir.sw': 'south-west',
      'terrain.dir.w': 'west',
      'terrain.dir.nw': 'north-west',
      'terrain.dir.c': 'centre',
    },
    hu: {
      'terrain.biome.plaza': 'A Bőségszaru tere',
      'terrain.biome.sand': 'Homokos part',
      'terrain.biome.grass': 'Rét',
      'terrain.biome.forest': 'Erdő',
      'terrain.biome.rock': 'Sziklák',
      'terrain.biome.snow': 'Havas csúcs',
      'terrain.biome.water': 'Víz',
      'terrain.biome.swamp': 'Mocsár',
      'terrain.cornucopia': 'Bőségszaru',
      'terrain.lake': 'Tó',
      'terrain.stream': 'Patak',
      'terrain.hill': 'Domb',
      'terrain.cave': 'Barlang',
      'terrain.thicket': 'Sűrű erdő',
      'terrain.mountains': 'Hegyek',
      'terrain.place.plaza': 'a Bőségszarunál',
      'terrain.place.sand': 'a parton',
      'terrain.place.grass': 'a réten',
      'terrain.place.forest': 'az erdőben',
      'terrain.place.rock': 'a sziklák között',
      'terrain.place.snow': 'fent a hegyekben',
      'terrain.place.water': 'a vízben',
      'terrain.place.swamp': 'a mocsárban',
      'terrain.place.cave': 'egy barlangban',
      'terrain.place.lake': 'a tó partján',
      'terrain.place.hill': 'egy dombon',
      'terrain.place.thicket': 'a sűrű erdőben',
      'terrain.dir.n': 'észak',
      'terrain.dir.ne': 'északkelet',
      'terrain.dir.e': 'kelet',
      'terrain.dir.se': 'délkelet',
      'terrain.dir.s': 'dél',
      'terrain.dir.sw': 'délnyugat',
      'terrain.dir.w': 'nyugat',
      'terrain.dir.nw': 'északnyugat',
      'terrain.dir.c': 'közép',
    },
  });

  // -------------------------------------------------------------- constants
  const SIZE = CFG.MAP_SIZE;
  const RES = CFG.TERRAIN_RES;
  const CELL = SIZE / (RES - 1);          // 2 m
  const HALF = SIZE / 2;
  const VN = RES * RES;
  const NAV = CFG.NAV_RES;
  const NCELL = SIZE / NAV;               // 3 m
  const NN = NAV * NAV;
  const ARENA_R = CFG.ARENA_RADIUS;
  const PLAZA_R = CFG.CORNUCOPIA_RADIUS;
  const PLAZA_Y = 2;
  const HALF_PI = Math.PI / 2;
  const SQRT2 = Math.SQRT2;
  const MIN_H = -12;                      // deform clamps
  const MAX_H = 120;

  // biome codes (static classification; forest is an overlay from the cover grid)
  const B_PLAZA = 0, B_SAND = 1, B_GRASS = 2, B_FOREST = 3, B_ROCK = 4, B_SNOW = 5, B_WATER = 6, B_SWAMP = 7;
  const BIOME_NAMES = ['plaza', 'sand', 'grass', 'forest', 'rock', 'snow', 'water', 'swamp'];

  // ------------------------------------------------------------ data arrays
  const heights = new Float32Array(VN);
  const baseCode = new Uint8Array(VN);     // static biome code per vertex
  const forest = new Float32Array(VN);     // live tree cover 0..1
  const burnt = new Uint8Array(VN);        // 1 = charred ground
  const vary = new Float32Array(VN);       // 0..1 cosmetic variation noise
  const moist = new Float32Array(VN);      // 0..1 moisture
  const slopeV = new Float32Array(VN);     // 0..1 slope per vertex
  const colors = new Uint8Array(VN * 3);   // ground colour per vertex (0..255), no water overlay

  const navH = new Float32Array(NN);       // ground height at cell centre
  const navCost = new Float32Array(NN);    // base land cost (>= 1); water is added at query time
  const navWalk = new Uint8Array(NN);      // 1 = walkable
  const navCover = new Float32Array(NN);   // cover from rocks / caves (0..1)
  const navForest = new Float32Array(NN);  // forest cover at the cell centre
  const navBlock = new Uint8Array(NN);     // 1 = blocked by a big rock
  const dangerCache = new Float32Array(NN);
  const dangerStamp = new Uint32Array(NN);
  let dangerEpoch = 1;
  let dangerTimer = 0;

  // A* buffers (reused between searches; stamps avoid clearing)
  const HEAP_CAP = NN * 8;
  const heapNode = new Int32Array(HEAP_CAP);
  const heapKey = new Float32Array(HEAP_CAP);
  let heapSize = 0;
  const gScore = new Float32Array(NN);
  const parent = new Int32Array(NN);
  const openStamp = new Uint32Array(NN);
  const closedStamp = new Uint32Array(NN);
  const pathCells = new Int32Array(NN);
  let searchId = 0;
  // neighbour offsets: 4 orthogonal first, then 4 diagonal
  const NDX = [1, -1, 0, 0, 1, 1, -1, -1];
  const NDZ = [0, 0, 1, -1, 1, -1, 1, -1];
  const HW = 1.15;                        // heuristic weight (slightly greedy = much faster)

  let noise = null;
  let maxHeight = 60;
  let minHeight = -4;
  let generatedSeed = -1;
  let ready = false;
  let ctx = { lakes: [], hills: [], stream: [], caves: [] };
  let rocks = [];

  // shoreline cache for nearestWater (rebuilt lazily when water or terrain changes)
  const SB = 16;                            // buckets per side
  const SBS = SIZE / SB;                    // bucket size (22.5 m)
  let shoreX = new Float32Array(1024);
  let shoreZ = new Float32Array(1024);
  let shoreSortedX = new Float32Array(1024);
  let shoreSortedZ = new Float32Array(1024);
  const shoreBucketStart = new Int32Array(SB * SB + 1);
  const shoreBucketFill = new Int32Array(SB * SB);
  let shoreCount = 0;
  let shoreDirty = true;
  let shoreLevel = NaN;
  let shoreBuiltAt = -1;

  // --------------------------------------------------------------- helpers
  const clamp = U.clamp;
  const smooth = U.smoothstep;
  function lerp(a, b, t) { return a + (b - a) * t; }
  function idx(ix, iz) { return iz * RES + ix; }
  function vx(i) { return -HALF + (i % RES) * CELL; }
  function vz(i) { return -HALF + ((i / RES) | 0) * CELL; }
  function cellX(c) { return -HALF + ((c % NAV) + 0.5) * NCELL; }
  function cellZ(c) { return -HALF + (((c / NAV) | 0) + 0.5) * NCELL; }

  /** Nav cell index for a world point, -1 outside the map. */
  function navIndex(x, z) {
    const cx = Math.floor((x + HALF) / NCELL), cz = Math.floor((z + HALF) / NCELL);
    if (!(cx >= 0 && cz >= 0 && cx < NAV && cz < NAV)) return -1;
    return cz * NAV + cx;
  }
  /** Nav cell index clamped into the map (NaN -> centre cell). */
  function navIndexClamped(x, z) {
    let cx = Math.floor((x + HALF) / NCELL), cz = Math.floor((z + HALF) / NCELL);
    if (!(cx === cx)) cx = NAV >> 1;
    if (!(cz === cz)) cz = NAV >> 1;
    cx = cx < 0 ? 0 : cx >= NAV ? NAV - 1 : cx;
    cz = cz < 0 ? 0 : cz >= NAV ? NAV - 1 : cz;
    return cz * NAV + cx;
  }
  /** Nearest vertex index for a world point (clamped). */
  function vIndex(x, z) {
    let ix = Math.round((x + HALF) / CELL), iz = Math.round((z + HALF) / CELL);
    if (!(ix >= 0)) ix = 0; else if (ix > RES - 1) ix = RES - 1;
    if (!(iz >= 0)) iz = 0; else if (iz > RES - 1) iz = RES - 1;
    return iz * RES + ix;
  }
  /** Tiny deterministic hash -> [0, 1). */
  function hash3(a, b, c) {
    let h = Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  /** Current water level (Env may be missing during development). */
  function waterY() {
    const E = GM.Env;
    return E && typeof E.waterLevel === 'number' && isFinite(E.waterLevel) ? E.waterLevel : CFG.BASE_WATER_LEVEL;
  }

  /** Distance from point to segment (2D). */
  function segDist(px, pz, ax, az, bx, bz) {
    const vx_ = bx - ax, vz_ = bz - az;
    const wx = px - ax, wz = pz - az;
    const l2 = vx_ * vx_ + vz_ * vz_;
    let t = l2 > 0 ? (wx * vx_ + wz * vz_) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - (ax + vx_ * t), dz = pz - (az + vz_ * t);
    return Math.sqrt(dx * dx + dz * dz);
  }

  // ======================================================= height sampling
  /** Ground height, piecewise-linear on the render triangles. Clamped outside the map. */
  function heightAt(x, z) {
    let fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
    if (!(fx > 0)) fx = 0; else if (fx > RES - 1.0001) fx = RES - 1.0001;
    if (!(fz > 0)) fz = 0; else if (fz > RES - 1.0001) fz = RES - 1.0001;
    const ix = fx | 0, iz = fz | 0;
    const tx = fx - ix, tz = fz - iz;
    const i = iz * RES + ix;
    const ha = heights[i], hc = heights[i + RES + 1];
    if (tz >= tx) {
      const hb = heights[i + RES];
      return ha + (hc - hb) * tx + (hb - ha) * tz;
    }
    const hd = heights[i + 1];
    return ha + (hd - ha) * tx + (hc - hd) * tz;
  }

  /** Bilinear sample of a per-vertex Float32Array. */
  function sampleV(arr, x, z) {
    let fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
    if (!(fx > 0)) fx = 0; else if (fx > RES - 1.0001) fx = RES - 1.0001;
    if (!(fz > 0)) fz = 0; else if (fz > RES - 1.0001) fz = RES - 1.0001;
    const ix = fx | 0, iz = fz | 0;
    const tx = fx - ix, tz = fz - iz;
    const i = iz * RES + ix;
    const a = arr[i], b = arr[i + 1], c = arr[i + RES], d = arr[i + RES + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }

  // ============================================================ generation
  /** Choose lakes, hills and a stream for a seed. */
  function planLayout(rnd) {
    const lakes = [];
    const lakeCount = rnd() < 0.2 ? 1 : rnd() < 0.55 ? 2 : 3;
    const baseAngle = rnd() * Math.PI * 2;
    for (let i = 0; i < lakeCount; i++) {
      for (let tries = 0; tries < 30; tries++) {
        const r = 11 + rnd() * 10;
        const a = baseAngle + (i / lakeCount) * Math.PI * 2 + (rnd() - 0.5) * 1.1;
        const d = 45 + r * 0.6 + rnd() * Math.max(1, 120 - r * 0.4 - (45 + r * 0.6));
        const x = Math.sin(a) * d, z = Math.cos(a) * d;
        let ok = true;
        for (const L of lakes) {
          if (U.dist2(x, z, L.x, L.z) < L.r + r + 22) { ok = false; break; }
        }
        if (ok) { lakes.push({ x, z, r, a }); break; }
      }
    }

    const hills = [];
    const hillCount = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < hillCount; i++) {
      for (let tries = 0; tries < 40; tries++) {
        const r = 13 + rnd() * 11;
        const a = rnd() * Math.PI * 2;
        const d = 55 + rnd() * 68;
        const x = Math.sin(a) * d, z = Math.cos(a) * d;
        let ok = true;
        for (const L of lakes) if (U.dist2(x, z, L.x, L.z) < L.r + r + 12) { ok = false; break; }
        if (ok) for (const H of hills) if (U.dist2(x, z, H.x, H.z) < H.r + r + 16) { ok = false; break; }
        if (ok) { hills.push({ x, z, r, h: 10 + rnd() * 14 }); break; }
      }
    }

    // A stream: from the first lake out to the rim mountains (meandering).
    let stream = [];
    if (lakes.length && rnd() < 0.7) {
      const L = lakes[0];
      const la = Math.atan2(L.x, L.z) + (rnd() - 0.5) * 0.9;
      let x = L.x, z = L.z;
      const pts = [{ x, z }];
      const side = (rnd() - 0.5) * 2;
      for (let s = 0; s < 40; s++) {
        const k = s / 40;
        const wob = Math.sin(k * 9 + side * 3) * 0.55 + side * 0.15;
        x += Math.sin(la + wob) * 6;
        z += Math.cos(la + wob) * 6;
        pts.push({ x, z });
        if (Math.sqrt(x * x + z * z) > 146) break;
      }
      // must not come close to the plaza
      let ok = true;
      for (const p of pts) if (Math.sqrt(p.x * p.x + p.z * p.z) < PLAZA_R + 16) { ok = false; break; }
      if (ok) stream = pts;
    }
    return { lakes, hills, stream, caves: [] };
  }

  /** Raw height function (before plaza/lakes are carved). */
  function rawHeight(x, z) {
    const r = Math.sqrt(x * x + z * z);
    let h = 3.0 + 3.6 * smooth(26, 130, r) +
      noise.fbm(x / 75 + 3.1, z / 75 - 1.7, 4) * 3.4 +
      noise.noise2(x / 19 + 9.2, z / 19 + 4.4) * 0.7;
    // rocky hills
    for (let i = 0; i < ctx.hills.length; i++) {
      const H = ctx.hills[i];
      const dx = x - H.x, dz = z - H.z;
      const d2 = (dx * dx + dz * dz) / (H.r * H.r);
      if (d2 < 6) {
        const bell = Math.exp(-d2 * 2.1);
        h += H.h * bell * (0.62 + 0.55 * noise.ridged(x / 21 + i * 7.7, z / 21 - i * 3.3, 3));
      }
    }
    // rim mountains: rise steeply from ~130 m
    if (r > 118) {
      const t = smooth(124, 166, r);
      h += t * t * (40 + noise.ridged(x / 45 + 17, z / 45 - 5, 4) * 34) + t * 7;
    }
    return h;
  }

  /** Full height with lakes, stream and plaza carved in. Also returns wetness via out.wet. */
  function carvedHeight(x, z, out) {
    let h = rawHeight(x, z);
    const r = Math.sqrt(x * x + z * z);
    let wet = 0;
    for (let i = 0; i < ctx.lakes.length; i++) {
      const L = ctx.lakes[i];
      const dx = x - L.x, dz = z - L.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > L.r * 2.4) { wet = Math.max(wet, Math.exp(-(d - L.r) / 18) * 0.6); continue; }
      const ang = Math.atan2(dx, dz);
      const pert = 1 + 0.2 * noise.noise2(Math.cos(ang) * 1.3 + i * 5, Math.sin(ang) * 1.3 - i * 3) +
        0.08 * noise.noise2(x / 9, z / 9);
      const s = d / (L.r * pert);
      if (s < 1.9) {
        const target = s < 1
          ? -3.6 + 3.6 * smooth(0.12, 1.0, s)
          : (s - 1) * 1.6;
        const w = 1 - smooth(1.0, 1.9, s);
        h = lerp(h, target, w);
      }
      wet = Math.max(wet, 1 - smooth(1, 2.6, s));
    }
    // stream: shallow wading channel, fades out before the force field
    const st = ctx.stream;
    if (st.length > 1 && r < 150) {
      let best = 1e9;
      for (let i = 0; i < st.length - 1; i++) {
        const a = st[i], b = st[i + 1];
        if (Math.abs(x - a.x) > 16 && Math.abs(x - b.x) > 16) continue;
        if (Math.abs(z - a.z) > 16 && Math.abs(z - b.z) > 16) continue;
        const d = segDist(x, z, a.x, a.z, b.x, b.z);
        if (d < best) best = d;
      }
      if (best < 9) {
        const fade = 1 - smooth(134, 146, r);
        const w = (1 - smooth(1.8, 7.5, best)) * fade;
        const bed = -0.75 + smooth(0, 3.2, best) * 1.6;
        if (h > bed) h = lerp(h, bed, w);
        wet = Math.max(wet, (1 - smooth(2, 12, best)) * fade);
      }
    }
    // plaza flatten
    const pw = 1 - smooth(PLAZA_R, PLAZA_R + 12, r);
    if (pw > 0) h = lerp(h, PLAZA_Y, pw);
    if (out) out.wet = wet;
    return h;
  }

  function computeSlopeAt(ix, iz) {
    const x0 = ix > 0 ? ix - 1 : ix, x1 = ix < RES - 1 ? ix + 1 : ix;
    const z0 = iz > 0 ? iz - 1 : iz, z1 = iz < RES - 1 ? iz + 1 : iz;
    const gx = (heights[idx(x1, iz)] - heights[idx(x0, iz)]) / ((x1 - x0) * CELL || 1);
    const gz = (heights[idx(ix, z1)] - heights[idx(ix, z0)]) / ((z1 - z0) * CELL || 1);
    return Math.atan(Math.sqrt(gx * gx + gz * gz)) / HALF_PI;
  }

  /** Static biome code for vertex i (forest handled by the cover overlay). */
  function classify(i, x, z) {
    const h = heights[i];
    const r = Math.sqrt(x * x + z * z);
    const v = vary[i];
    const sl = slopeV[i];
    if (h < CFG.BASE_WATER_LEVEL) return B_WATER;
    if (r < PLAZA_R + 0.5) return B_PLAZA;
    if (h > 44 + v * 7 && sl < 0.62) return B_SNOW;
    const rocky = smooth(0.3, 0.48, sl) + smooth(24, 34, h) + (v > 0.62 && h > 13 ? 0.35 : 0);
    if (rocky > 0.5) return B_ROCK;
    if (h < CFG.BASE_WATER_LEVEL + 0.9 + v * 0.5 && moist[i] > 0.25) return B_SAND;
    if (h < 2.6 && moist[i] > 0.58 && r > PLAZA_R + 10) return B_SWAMP;
    return B_GRASS;
  }

  /** Natural tree cover for vertex i (0..1). */
  function forestCover(i, x, z) {
    const h = heights[i];
    const r = Math.sqrt(x * x + z * z);
    const code = baseCode[i];
    if (code === B_WATER || code === B_SAND || code === B_SNOW || code === B_PLAZA) return 0;
    const belt = 1 - Math.abs(noise.noise2(x / 88 + 11.3, z / 88 - 7.1));
    const blob = noise.fbm(x / 46 + 40, z / 46 - 13, 3) * 0.5 + 0.5;
    let f = smooth(0.5, 0.78, belt * 0.55 + blob * 0.62 - 0.08);
    f *= smooth(30, 44, r);                 // clearing around the plaza
    f *= 1 - smooth(0.36, 0.55, slopeV[i]); // no trees on cliffs
    f *= 1 - smooth(30, 42, h);             // tree line
    f *= smooth(0.6, 1.6, h - CFG.BASE_WATER_LEVEL);
    if (code === B_ROCK) f *= 0.35;
    if (code === B_SWAMP) f *= 0.7;
    return clamp(f, 0, 1);
  }

  // ---------------------------------------------------------------- colours
  // All colours are 0..255. World converts them to 0..1 for the mesh.
  const _plz = { r: 0, g: 0, b: 0 };
  /** Stone pattern of the Cornucopia plaza (rings, gold inlay, pedestal ring). */
  function plazaColor(x, z, v, out) {
    const r = Math.sqrt(x * x + z * z);
    let cr = 178, cg = 170, cb = 150;
    const ring = (r / 4) % 1;
    if (ring < 0.14) { cr = 150; cg = 143; cb = 126; }
    const spokes = Math.abs(((Math.atan2(x, z) / TAU) * 16 + 16.5) % 1 - 0.5);
    if (spokes > 0.44 && r > 3) { cr -= 16; cg -= 16; cb -= 14; }
    if (r < 2.6) { cr = 196; cg = 160; cb = 70; }                       // gold seal in the centre
    else if (r > 6.4 && r < 7.6) { cr = 204; cg = 164; cb = 66; }       // gold inlay ring
    else if (Math.abs(r - CFG.PEDESTAL_RADIUS) < 1.1) { cr = 104; cg = 108; cb = 116; } // pedestal ring (metal)
    else if (r > PLAZA_R - 1.6) { cr = 132; cg = 125; cb = 112; }        // darker rim
    const j = (v - 0.5) * 14;
    out.r = cr + j; out.g = cg + j; out.b = cb + j * 0.8;
    return out;
  }

  /** Recompute the ground colour of vertex i (no water overlay). */
  function computeColor(i) {
    const h = heights[i], v = vary[i], m = moist[i], code = baseCode[i];
    const x = vx(i), z = vz(i);
    let r, g, b;
    switch (code) {
      case B_WATER: { // lake bed: sand to dark mud with depth
        const d = clamp(-h / 3.6, 0, 1);
        r = lerp(166, 76, d); g = lerp(150, 86, d); b = lerp(104, 66, d);
        break;
      }
      case B_SAND:
        r = 214 + v * 16; g = 196 + v * 14; b = 142 + v * 10;
        break;
      case B_PLAZA:
        plazaColor(x, z, v, _plz);
        r = _plz.r; g = _plz.g; b = _plz.b;
        break;
      case B_ROCK: {
        const hi = smooth(20, 55, h);
        r = lerp(112, 138, hi) + v * 22; g = lerp(106, 134, hi) + v * 20; b = lerp(98, 132, hi) + v * 18;
        if (v < 0.32) { r -= 12; g -= 10; b -= 8; }
        break;
      }
      case B_SNOW:
        r = 232 + v * 12; g = 236 + v * 12; b = 242 + v * 10;
        break;
      case B_SWAMP:
        r = 78 + v * 16; g = 92 + v * 14; b = 50 + v * 8;
        break;
      default: { // meadow: three greens, drier higher up, alpine near the rim
        const k = v;
        if (k < 0.33) { r = 88; g = 138; b = 54; }
        else if (k < 0.66) { r = 106; g = 152; b = 60; }
        else { r = 124; g = 162; b = 66; }
        const jitter = (hash3(i, 7, 3) - 0.5) * 10;
        r += jitter; g += jitter; b += jitter * 0.5;
        const dry = smooth(8, 22, h) * 0.55 + (1 - m) * 0.18;
        r = lerp(r, 150, dry * 0.5); g = lerp(g, 150, dry * 0.35); b = lerp(b, 78, dry * 0.4);
        const alpine = smooth(26, 40, h);
        r = lerp(r, 118, alpine); g = lerp(g, 122, alpine); b = lerp(b, 96, alpine);
        break;
      }
    }
    if (code !== B_WATER && code !== B_SAND && code !== B_SNOW && code !== B_PLAZA) {
      const f = forest[i];
      if (f > 0.02) {
        const k = f * 0.8;
        r = lerp(r, 50 + v * 14, k); g = lerp(g, 80 + v * 12, k); b = lerp(b, 38 + v * 6, k);
      }
    }
    if (burnt[i]) {
      r = lerp(r, 44 + v * 16, 0.86); g = lerp(g, 38 + v * 12, 0.86); b = lerp(b, 34 + v * 10, 0.86);
    }
    const o = i * 3;
    colors[o] = clamp(r, 0, 255) | 0;
    colors[o + 1] = clamp(g, 0, 255) | 0;
    colors[o + 2] = clamp(b, 0, 255) | 0;
  }

  // ------------------------------------------------------ caves and rocks
  function addRock(x, z, s, kind, sx, sy, sz, rot, lift, block) {
    const rk = { x, z, s, kind, sx, sy, sz, rot, lift, block: !!block };
    rocks.push(rk);
    if (block) {
      const c = navIndex(x, z);
      if (c >= 0) navBlock[c] = 1;
    }
    // no trees inside rocks
    const rr = s * Math.max(sx, sz) * 1.25 + 1;
    clearForest(x, z, rr);
    return rk;
  }

  function clearForest(x, z, rr) {
    const ix0 = Math.max(0, Math.floor((x - rr + HALF) / CELL)), ix1 = Math.min(RES - 1, Math.ceil((x + rr + HALF) / CELL));
    const iz0 = Math.max(0, Math.floor((z - rr + HALF) / CELL)), iz1 = Math.min(RES - 1, Math.ceil((z + rr + HALF) / CELL));
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const i = iz * RES + ix;
        const d = U.dist2(vx(i), vz(i), x, z);
        if (d < rr) forest[i] *= smooth(rr * 0.6, rr, d);
      }
    }
  }

  /** Is a nav cell a good dry floor for a cave (terrain only; nav not built yet)? */
  function caveFloorOk(c, minR) {
    if (c < 0) return false;
    const x = cellX(c), z = cellZ(c);
    const r = Math.sqrt(x * x + z * z);
    if (r < minR || r > ARENA_R - 8) return false;
    if (heightAt(x, z) < CFG.BASE_WATER_LEVEL + 0.6) return false;
    const hx = heightAt(x + 1.5, z) - heightAt(x - 1.5, z), hz = heightAt(x, z + 1.5) - heightAt(x, z - 1.5);
    const sl = Math.atan(Math.sqrt(hx * hx + hz * hz) / 3) / HALF_PI;
    return sl < 0.42;
  }

  function tryCave(px, pz, fdx, fdz, caves) {
    // snap the opening to a grid direction so the walls fill whole nav cells
    let fx = 0, fz = 0;
    if (Math.abs(fdx) > Math.abs(fdz)) fx = fdx > 0 ? 1 : -1; else fz = fdz > 0 ? 1 : -1;
    const c = navIndex(px, pz);
    if (c < 0) return false;
    const cx = c % NAV, cz = (c / NAV) | 0;
    const cell = (dx, dz) => {
      const nx = cx + dx, nz = cz + dz;
      return nx >= 0 && nz >= 0 && nx < NAV && nz < NAV ? nz * NAV + nx : -1;
    };
    const front = cell(fx, fz), back = cell(-fx, -fz);
    const left = cell(-fz, fx), right = cell(fz, -fx);
    const front2 = cell(fx * 2, fz * 2);
    if (front < 0 || back < 0 || left < 0 || right < 0 || front2 < 0) return false;
    if (!caveFloorOk(c, PLAZA_R + 16) || !caveFloorOk(front, PLAZA_R + 12) || !caveFloorOk(front2, PLAZA_R + 10)) return false;
    const x = cellX(c), z = cellZ(c);
    for (const C of caves) if (U.dist2(C.x, C.z, x, z) < 30) return false;
    for (const L of ctx.lakes) if (U.dist2(L.x, L.z, x, z) < L.r * 1.35 + 4) return false;
    if (navBlock[c] || navBlock[front] || navBlock[front2]) return false;

    const heading = Math.atan2(fx, fz);
    const g0 = heightAt(x, z);
    const roofY = g0 + 2.55;
    const wall = (cc, s, sx, sz, jitter) => {
      const wx = cellX(cc), wz = cellZ(cc);
      const gw = heightAt(wx, wz);
      const lift = -0.35;
      const sy = clamp((roofY + 0.15 - gw - lift) / s, 0.8, 2.4);
      return addRock(wx + fx * jitter, wz + fz * jitter, s, 'boulder', sx, sy, sz, heading + (hash3(cc, 5, 1) - 0.5) * 0.25, lift, true);
    };
    wall(back, 1.8, 1.35, 0.95, 0.25);
    wall(left, 1.55, 0.85, 1.3, -0.3);
    wall(right, 1.55, 0.85, 1.3, -0.3);
    // roof slab (does not block: the floor below is the hiding place)
    addRock(x - fx * 0.35, z - fz * 0.35, 1, 'slab', 2.75, 0.42, 2.55, heading + 0.12, roofY - g0 + 0.2, false);
    clearForest(x + fx * 1.5, z + fz * 1.5, 7);
    navCover[c] = 1;
    navCover[front] = Math.max(navCover[front], 0.45);
    caves.push({ x, z, heading, fx, fz });
    return true;
  }

  function placeFeatures(rnd) {
    rocks = [];
    const caves = [];
    // caves / rock shelters at the feet of the hills
    for (const H of ctx.hills) {
      for (let tries = 0; tries < 14; tries++) {
        const a = rnd() * TAU;
        const d = H.r * (0.8 + rnd() * 0.45);
        if (tryCave(H.x + Math.sin(a) * d, H.z + Math.cos(a) * d, Math.sin(a), Math.cos(a), caves)) break;
      }
    }
    // shelters in the foothills of the rim, opening towards the centre
    const rimCount = 1 + (rnd() < 0.6 ? 1 : 0);
    for (let k = 0; k < rimCount; k++) {
      for (let tries = 0; tries < 20; tries++) {
        const a = rnd() * TAU;
        const d = 118 + rnd() * 14;
        if (tryCave(Math.sin(a) * d, Math.cos(a) * d, -Math.sin(a), -Math.cos(a), caves)) break;
      }
    }
    ctx.caves = caves;

    const nearCave = (x, z, r) => {
      for (const C of caves) if (U.dist2(C.x, C.z, x, z) < r) return true;
      return false;
    };
    const dryAt = (x, z, m) => heightAt(x, z) > CFG.BASE_WATER_LEVEL + (m || 0.3);

    // hill boulders
    for (const H of ctx.hills) {
      const n = 4 + Math.floor(rnd() * 5);
      for (let k = 0; k < n; k++) {
        const a = rnd() * TAU;
        const d = H.r * (0.15 + rnd() * 1.15);
        const x = H.x + Math.sin(a) * d, z = H.z + Math.cos(a) * d;
        if (!dryAt(x, z, 0.5) || nearCave(x, z, 8) || x * x + z * z < 34 * 34) continue;
        const s = 0.9 + rnd() * 1.9;
        addRock(x, z, s, 'boulder', 0.9 + rnd() * 0.5, 0.6 + rnd() * 0.5, 0.9 + rnd() * 0.5, rnd() * TAU, -0.28 * s, s > 1.6);
      }
    }
    // lonely meadow boulders
    const meadow = 14 + Math.floor(rnd() * 9);
    for (let k = 0; k < meadow; k++) {
      const a = rnd() * TAU;
      const d = 36 + rnd() * 104;
      const x = Math.sin(a) * d, z = Math.cos(a) * d;
      const vi = vIndex(x, z);
      if (!dryAt(x, z, 0.6) || slopeV[vi] > 0.4 || nearCave(x, z, 8)) continue;
      const s = 0.7 + rnd() * 1.4;
      addRock(x, z, s, 'boulder', 0.9 + rnd() * 0.5, 0.55 + rnd() * 0.45, 0.9 + rnd() * 0.5, rnd() * TAU, -0.3 * s, s > 1.6);
    }
    // big rocks on the rim slopes (outside the force field; scenery)
    for (let k = 0; k < 34; k++) {
      const a = rnd() * TAU;
      const d = 152 + rnd() * 24;
      const x = Math.sin(a) * d, z = Math.cos(a) * d;
      if (Math.abs(x) > HALF - 4 || Math.abs(z) > HALF - 4) continue;
      const s = 2 + rnd() * 2.6;
      addRock(x, z, s, 'boulder', 0.9 + rnd() * 0.6, 0.6 + rnd() * 0.5, 0.9 + rnd() * 0.6, rnd() * TAU, -0.3 * s, false);
    }
    // shore stones
    for (const L of ctx.lakes) {
      const n = 9 + Math.floor(rnd() * 8);
      for (let k = 0; k < n; k++) {
        const a = rnd() * TAU;
        const d = L.r * (0.95 + rnd() * 0.35);
        const x = L.x + Math.sin(a) * d, z = L.z + Math.cos(a) * d;
        if (x * x + z * z > (ARENA_R - 4) * (ARENA_R - 4)) continue;
        const s = 0.3 + rnd() * 0.55;
        addRock(x, z, s, 'stone', 1, 0.55 + rnd() * 0.3, 1, rnd() * TAU, -0.25 * s, false);
      }
    }
    // small stones in rocky ground
    for (let k = 0; k < 260; k++) {
      const x = (rnd() - 0.5) * (SIZE - 8), z = (rnd() - 0.5) * (SIZE - 8);
      const vi = vIndex(x, z);
      if (baseCode[vi] !== B_ROCK || nearCave(x, z, 6)) continue;
      const s = 0.4 + rnd() * 0.9;
      addRock(x, z, s, 'stone', 0.9 + rnd() * 0.4, 0.5 + rnd() * 0.4, 0.9 + rnd() * 0.4, rnd() * TAU, -0.25 * s, false);
    }
  }

  // ------------------------------------------------------------- nav grid
  /** Recompute one nav cell from the height/forest data. */
  function updateNavCell(c) {
    const x = cellX(c), z = cellZ(c);
    const h = heightAt(x, z);
    navH[c] = h;
    const hx = heightAt(x + 1.5, z) - heightAt(x - 1.5, z);
    const hz = heightAt(x, z + 1.5) - heightAt(x, z - 1.5);
    const sl = Math.atan(Math.sqrt(hx * hx + hz * hz) / 3) / HALF_PI;
    const f = sampleV(forest, x, z);
    navForest[c] = f;
    const inside = x * x + z * z <= (ARENA_R - 1) * (ARENA_R - 1);
    navWalk[c] = inside && sl < 0.6 && !navBlock[c] ? 1 : 0;
    let cost = 1 + 5 * sl * sl + f * 0.3;
    const code = baseCode[vIndex(x, z)];
    if (code === B_SWAMP) cost += 0.5;
    else if (code === B_ROCK) cost += 0.15;
    navCost[c] = cost;
  }

  function updateNavRect(x0, z0, x1, z1) {
    const cx0 = clamp(Math.floor((x0 + HALF) / NCELL), 0, NAV - 1), cx1 = clamp(Math.floor((x1 + HALF) / NCELL), 0, NAV - 1);
    const cz0 = clamp(Math.floor((z0 + HALF) / NCELL), 0, NAV - 1), cz1 = clamp(Math.floor((z1 + HALF) / NCELL), 0, NAV - 1);
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) updateNavCell(cz * NAV + cx);
  }

  function buildNav() {
    for (let c = 0; c < NN; c++) updateNavCell(c);
    // rocks give cover to the cells around them
    for (const rk of rocks) {
      if (!rk.block) continue;
      const c = navIndex(rk.x, rk.z);
      if (c < 0) continue;
      const cx = c % NAV, cz = (c / NAV) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= NAV || nz >= NAV) continue;
          const n = nz * NAV + nx;
          if (!navBlock[n]) navCover[n] = Math.max(navCover[n], 0.5);
        }
      }
    }
  }

  // --------------------------------------------------- landmarks & hiding
  let thickets = [];
  let hideSpots = [];
  let landmarks = { cornucopia: { x: 0, z: 0 }, lakes: [], hills: [], caves: [], thickets: [], stream: [] };

  function findThickets() {
    const cand = [];
    for (let c = 0; c < NN; c++) {
      if (!navWalk[c] || navForest[c] < 0.8) continue;
      const x = cellX(c), z = cellZ(c);
      const r = Math.sqrt(x * x + z * z);
      if (r < 40 || r > ARENA_R - 12 || navH[c] < CFG.BASE_WATER_LEVEL + 0.6) continue;
      const cx = c % NAV, cz = (c / NAV) | 0;
      let sum = 0, n = 0;
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx, nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= NAV || nz >= NAV) continue;
          sum += navForest[nz * NAV + nx]; n++;
        }
      }
      const dens = n ? sum / n : 0;
      if (dens > 0.72) cand.push({ c, dens });
    }
    cand.sort((a, b) => b.dens - a.dens || a.c - b.c);
    thickets = [];
    for (const k of cand) {
      const x = cellX(k.c), z = cellZ(k.c);
      let ok = true;
      for (const th of thickets) if (U.dist2(th.x, th.z, x, z) < 30) { ok = false; break; }
      if (!ok) continue;
      thickets.push({ x, z, r: 9, density: k.dens });
      if (thickets.length >= 9) break;
    }
  }

  function buildHideSpots() {
    hideSpots = [];
    for (const C of ctx.caves) hideSpots.push({ x: C.x, z: C.z, quality: 0.95, kind: 'cave' });
    for (const th of thickets) hideSpots.push({ x: th.x, z: th.z, quality: clamp(0.55 + th.density * 0.3, 0, 0.88), kind: 'thicket' });
    // walkable cells right next to big hill boulders
    const used = [];
    for (const rk of rocks) {
      if (!rk.block || rk.kind !== 'boulder') continue;
      const r = Math.sqrt(rk.x * rk.x + rk.z * rk.z);
      if (r > ARENA_R - 10) continue;
      let near = false;
      for (const u of used) if (U.dist2(u.x, u.z, rk.x, rk.z) < 22) { near = true; break; }
      if (near) continue;
      const c = navIndex(rk.x, rk.z);
      if (c < 0) continue;
      const cx = c % NAV, cz = (c / NAV) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = cx + NDX[k], nz = cz + NDZ[k];
        if (nx < 0 || nz < 0 || nx >= NAV || nz >= NAV) continue;
        const n = nz * NAV + nx;
        if (navWalk[n] && navH[n] > CFG.BASE_WATER_LEVEL + 0.4) {
          hideSpots.push({ x: cellX(n), z: cellZ(n), quality: 0.5 + Math.min(0.15, navForest[n] * 0.2), kind: 'rocks' });
          used.push(rk);
          break;
        }
      }
      if (used.length >= 10) break;
    }
    hideSpots.sort((a, b) => b.quality - a.quality);
  }

  function buildLandmarks() {
    const streamPts = [];
    for (const p of ctx.stream) if (p.x * p.x + p.z * p.z < (ARENA_R - 2) * (ARENA_R - 2)) streamPts.push({ x: p.x, z: p.z });
    landmarks = {
      cornucopia: { x: 0, z: 0, heading: 0, mouth: { x: 0, z: 3 }, radius: PLAZA_R },
      lakes: ctx.lakes.map((L) => ({ x: L.x, z: L.z, r: L.r })),
      hills: ctx.hills.map((H) => ({ x: H.x, z: H.z, r: H.r, h: heightAt(H.x, H.z) })),
      caves: ctx.caves.map((C) => ({ x: C.x, z: C.z, heading: C.heading })),
      thickets: thickets.map((th) => ({ x: th.x, z: th.z, r: th.r })),
      stream: streamPts,
      mountainsFrom: 135,
    };
  }

  /** Build the whole arena for a seed (deterministic). */
  function generate(seed) {
    seed = seed >>> 0;
    noise = GM.Noise.create(seed);
    const rnd = GM.makeRng((seed ^ 0x9e3779b9) >>> 0);
    ctx = planLayout(rnd);
    navBlock.fill(0);
    navCover.fill(0);

    const tmp = { wet: 0 };
    for (let iz = 0; iz < RES; iz++) {
      const z = -HALF + iz * CELL;
      for (let ix = 0; ix < RES; ix++) {
        const x = -HALF + ix * CELL;
        const i = iz * RES + ix;
        heights[i] = carvedHeight(x, z, tmp);
        vary[i] = clamp(noise.noise2(x / 14 + 5.5, z / 14 - 2.2) * 0.42 + noise.noise2(x / 4.3 - 1.1, z / 4.3 + 7.7) * 0.18 + 0.5, 0, 1);
        moist[i] = clamp(tmp.wet * 1.05 + (noise.fbm(x / 70 - 8, z / 70 + 3, 3) * 0.5 + 0.5) * 0.45 - 0.08, 0, 1);
      }
    }
    for (let iz = 0; iz < RES; iz++) for (let ix = 0; ix < RES; ix++) slopeV[iz * RES + ix] = computeSlopeAt(ix, iz);
    for (let i = 0; i < VN; i++) baseCode[i] = classify(i, vx(i), vz(i));
    for (let i = 0; i < VN; i++) { forest[i] = forestCover(i, vx(i), vz(i)); burnt[i] = 0; }

    placeFeatures(rnd);
    for (let i = 0; i < VN; i++) computeColor(i);
    buildNav();
    findThickets();
    buildHideSpots();
    buildLandmarks();

    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < VN; i++) { const h = heights[i]; if (h < mn) mn = h; if (h > mx) mx = h; }
    minHeight = mn; maxHeight = mx;

    dangerEpoch++;
    shoreDirty = true;
    generatedSeed = seed;
    ready = true;
    T.modified = false;
    T.version++;
    T.seed = seed;
    T.landmarks = landmarks;
    T.hideSpots = hideSpots;
    T.rocks = rocks;
  }

  // ================================================================ queries
  /** 0 flat .. 1 vertical, from the rendered surface. */
  function slopeAt(x, z) {
    const e = 1.0;
    const gx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
    const gz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    return Math.atan(Math.sqrt(gx * gx + gz * gz)) / HALF_PI;
  }

  /** Surface normal (writes into out when given). */
  function normalAt(x, z, out) {
    const e = CELL * 0.5;
    let nx = heightAt(x - e, z) - heightAt(x + e, z);
    let nz = heightAt(x, z - e) - heightAt(x, z + e);
    let ny = 2 * e;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (out && typeof out.set === 'function') return out.set(nx, ny, nz);
    if (out) { out.x = nx; out.y = ny; out.z = nz; return out; }
    return THREE ? new THREE.Vector3(nx, ny, nz) : { x: nx, y: ny, z: nz };
  }

  function isWater(x, z) { return heightAt(x, z) < waterY(); }
  function waterDepth(x, z) { const d = waterY() - heightAt(x, z); return d > 0 ? d : 0; }
  function inArena(x, z, margin) {
    const r = ARENA_R - (margin || 0);
    return r > 0 && x * x + z * z <= r * r;
  }

  /** Biome name at a point ('forest' is the live tree-cover overlay). */
  function biomeAt(x, z) {
    if (!ready) return 'grass';
    if (heightAt(x, z) < waterY()) return 'water';
    const code = baseCode[vIndex(x, z)];
    if (code === B_WATER) return 'sand';               // lake bed above a lowered water line
    if ((code === B_GRASS || code === B_SWAMP || code === B_ROCK) && sampleV(forest, x, z) > 0.45) return 'forest';
    return BIOME_NAMES[code];
  }

  function forestAt(x, z) {
    if (!ready) return 0;
    const f = sampleV(forest, x, z);
    return f < 0 ? 0 : f > 1 ? 1 : f;
  }

  /** Cover from trees, rocks and caves (0..1). */
  function coverAt(x, z) {
    const f = forestAt(x, z);
    const c = navIndex(x, z);
    const r = c >= 0 ? navCover[c] : 0;
    return f > r ? f : r;
  }

  /** Set tree cover to 0 (charred ground) in a circle; emits 'forest:burnt'. */
  function burnForest(x, z, radius) {
    if (!ready) return;
    x = +x; z = +z;
    if (!(x === x && z === z)) return;
    radius = Math.max(0.5, +radius || 0);
    const rr = radius + CELL * 0.75;
    const ix0 = Math.max(0, Math.floor((x - rr + HALF) / CELL)), ix1 = Math.min(RES - 1, Math.ceil((x + rr + HALF) / CELL));
    const iz0 = Math.max(0, Math.floor((z - rr + HALF) / CELL)), iz1 = Math.min(RES - 1, Math.ceil((z + rr + HALF) / CELL));
    let changed = false;
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const i = iz * RES + ix;
        const d = U.dist2(-HALF + ix * CELL, -HALF + iz * CELL, x, z);
        if (d > rr) continue;
        const code = baseCode[i];
        const fuel = code === B_GRASS || code === B_SWAMP || code === B_ROCK;
        const before = forest[i];
        forest[i] = d <= radius ? 0 : forest[i] * 0.5;
        const scorch = fuel && d <= radius && !burnt[i] && (before > 0.02 || code !== B_ROCK);
        if (scorch) burnt[i] = 1;
        if (scorch || before !== forest[i]) { computeColor(i); changed = true; }
      }
    }
    if (!changed) return;
    updateNavRect(x - rr, z - rr, x + rr, z + rr);
    for (let k = 0; k < hideSpots.length; k++) {
      const s = hideSpots[k];
      if (s.kind === 'thicket' && U.dist2(s.x, s.z, x, z) < radius + 9) {
        s.quality = Math.min(s.quality, 0.1 + 0.75 * sampleV(forest, s.x, s.z));
      }
    }
    T.forestVersion++;
    GM.emit('forest:burnt', { x, z, radius });
  }

  /** Ground colour {r, g, b} 0..255 with the water tint (minimap palette). */
  function colorAt(x, z, out) {
    out = out || { r: 0, g: 0, b: 0 };
    if (!ready) { out.r = 96; out.g = 138; out.b = 62; return out; }
    let fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
    if (!(fx > 0)) fx = 0; else if (fx > RES - 1.0001) fx = RES - 1.0001;
    if (!(fz > 0)) fz = 0; else if (fz > RES - 1.0001) fz = RES - 1.0001;
    const ix = fx | 0, iz = fz | 0;
    const tx = fx - ix, tz = fz - iz;
    const i = iz * RES + ix;
    const a = i * 3, b = (i + 1) * 3, c = (i + RES) * 3, d = (i + RES + 1) * 3;
    const w00 = (1 - tx) * (1 - tz), w10 = tx * (1 - tz), w01 = (1 - tx) * tz, w11 = tx * tz;
    let r = colors[a] * w00 + colors[b] * w10 + colors[c] * w01 + colors[d] * w11;
    let g = colors[a + 1] * w00 + colors[b + 1] * w10 + colors[c + 1] * w01 + colors[d + 1] * w11;
    let bl = colors[a + 2] * w00 + colors[b + 2] * w10 + colors[c + 2] * w01 + colors[d + 2] * w11;
    const depth = waterY() - heightAt(x, z);
    if (depth > 0) {
      const k = 0.5 + 0.45 * clamp(depth / 3.2, 0, 1);
      r = lerp(r, 40, k); g = lerp(g, 112, k); bl = lerp(bl, 142, k);
    }
    out.r = clamp(r, 0, 255) | 0; out.g = clamp(g, 0, 255) | 0; out.b = clamp(bl, 0, 255) | 0;
    return out;
  }

  // ---------------------------------------------------------------- deform
  /**
   * Sculpt the ground. mode 'raise' | 'lower' | 'crater' | 'smooth' | 'flatten'.
   * The Cornucopia plaza is reinforced (barely changes). Emits 'terrain:changed'.
   */
  function deform(x, z, radius, amount, mode) {
    if (!ready) return;
    x = +x; z = +z;
    if (!(x === x && z === z)) return;
    radius = clamp(+radius || 0, 0.5, 90);
    amount = +amount || 0;
    mode = mode || 'raise';
    const ix0 = Math.max(0, Math.floor((x - radius + HALF) / CELL)), ix1 = Math.min(RES - 1, Math.ceil((x + radius + HALF) / CELL));
    const iz0 = Math.max(0, Math.floor((z - radius + HALF) / CELL)), iz1 = Math.min(RES - 1, Math.ceil((z + radius + HALF) / CELL));
    const w = ix1 - ix0 + 1;
    const hgt = iz1 - iz0 + 1;
    const h0 = heightAt(x, z);
    const strength = clamp(Math.abs(amount), 0, 1) || (mode === 'smooth' || mode === 'flatten' ? 1 : 0);
    let passes = 1;
    if (mode === 'smooth') passes = clamp(Math.round(Math.abs(amount)) || 1, 1, 4);
    for (let pass = 0; pass < passes; pass++) {
      // snapshot of the region (+1 ring) for smoothing
      let snap = null;
      if (mode === 'smooth') {
        snap = new Float32Array((w + 2) * (hgt + 2));
        for (let iz = -1; iz <= hgt; iz++) {
          for (let ix = -1; ix <= w; ix++) {
            const gx = clamp(ix0 + ix, 0, RES - 1), gz = clamp(iz0 + iz, 0, RES - 1);
            snap[(iz + 1) * (w + 2) + (ix + 1)] = heights[gz * RES + gx];
          }
        }
      }
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const i = iz * RES + ix;
          const px = -HALF + ix * CELL, pz = -HALF + iz * CELL;
          const d = U.dist2(px, pz, x, z);
          if (d >= radius) continue;
          const t = d / radius;
          const bell = (1 - t * t) * (1 - t * t);
          const rc = Math.sqrt(px * px + pz * pz);
          const prot = smooth(PLAZA_R - 1, PLAZA_R + 5, rc);
          if (prot <= 0) continue;
          let h = heights[i];
          switch (mode) {
            case 'lower': h -= amount * bell * prot; break;
            case 'crater': {
              const bowl = 1 - smooth(0.05, 0.78, t);
              const rim = Math.exp(-((t - 0.84) / 0.12) * ((t - 0.84) / 0.12));
              h += (-amount * bowl + amount * 0.32 * rim) * prot;
              break;
            }
            case 'flatten': {
              const k = (1 - smooth(0.55, 1, t)) * strength * prot;
              h = lerp(h, h0, k);
              break;
            }
            case 'smooth': {
              const sx = ix - ix0 + 1, sz = iz - iz0 + 1;
              let sum = 0;
              for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) sum += snap[(sz + dz) * (w + 2) + sx + dx];
              h = lerp(h, sum / 9, bell * strength * prot);
              break;
            }
            default: h += amount * bell * prot; break;   // 'raise'
          }
          heights[i] = clamp(h, MIN_H, MAX_H);
          if ((mode === 'crater' || mode === 'lower') && amount > 0.5) {
            forest[i] *= 1 - 0.85 * bell * clamp(amount / 4, 0, 1) * prot;
          }
        }
      }
    }
    // derived data in the region (+1 vertex for slopes)
    const jx0 = Math.max(0, ix0 - 1), jx1 = Math.min(RES - 1, ix1 + 1);
    const jz0 = Math.max(0, iz0 - 1), jz1 = Math.min(RES - 1, iz1 + 1);
    for (let iz = jz0; iz <= jz1; iz++) for (let ix = jx0; ix <= jx1; ix++) slopeV[iz * RES + ix] = computeSlopeAt(ix, iz);
    for (let iz = jz0; iz <= jz1; iz++) {
      for (let ix = jx0; ix <= jx1; ix++) {
        const i = iz * RES + ix;
        if (baseCode[i] !== B_PLAZA) baseCode[i] = classify(i, vx(i), vz(i));
        const code = baseCode[i];
        if (code === B_WATER || code === B_SAND || code === B_SNOW) forest[i] = 0;
        if (heights[i] < minHeight) minHeight = heights[i];
        if (heights[i] > maxHeight) maxHeight = heights[i];
        computeColor(i);
      }
    }
    const m = radius + NCELL;
    updateNavRect(x - m, z - m, x + m, z + m);
    shoreDirty = true;
    dangerEpoch++;
    T.modified = true;
    T.version++;
    GM.emit('terrain:changed', { x, z, radius });
  }

  // ------------------------------------------------------------ random pick
  /** Random walkable land point. opts {minR, maxR, biome, avoidWater=true, rng=GM.R, center:{x,z}}. */
  function randomLandPoint(opts) {
    opts = opts || {};
    const rng = opts.rng || GM.R;
    const rf = typeof rng === 'function' ? rng
      : rng && typeof rng.random === 'function' ? function () { return rng.random(); } : Math.random;
    let minR = Math.max(0, opts.minR != null ? +opts.minR || 0 : 0);
    let maxR = opts.maxR != null ? +opts.maxR || 0 : ARENA_R - 6;
    if (maxR < minR) { const t = maxR; maxR = minR; minR = t; }
    const cx = opts.center ? +opts.center.x || 0 : 0, cz = opts.center ? +opts.center.z || 0 : 0;
    const avoidWater = opts.avoidWater !== false;
    const biome = opts.biome || null;
    if (!ready) return biome ? null : { x: 0, z: PLAZA_R * 0.5 };
    const wl = waterY();
    for (let k = 0; k < 90; k++) {
      const u = rf();
      const r = Math.sqrt(minR * minR + (maxR * maxR - minR * minR) * u);
      const a = rf() * TAU;
      const x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      if (!inArena(x, z, 3)) continue;
      const c = navIndex(x, z);
      if (c < 0 || !navWalk[c]) continue;
      if (avoidWater && heightAt(x, z) < wl + 0.25) continue;
      if (biome && biomeAt(x, z) !== biome) continue;
      return { x, z };
    }
    if (biome) return null;
    const fa = rf() * TAU;                     // fallback: the plaza is always dry land
    return { x: Math.sin(fa) * PLAZA_R * 0.6, z: Math.cos(fa) * PLAZA_R * 0.6 };
  }

  // ------------------------------------------------------- shoreline cache
  function rebuildShore() {
    const wl = waterY();
    shoreCount = 0;
    const lim = (ARENA_R - 2) * (ARENA_R - 2);
    for (let iz = 1; iz < RES - 1; iz++) {
      for (let ix = 1; ix < RES - 1; ix++) {
        const i = iz * RES + ix;
        if (heights[i] < wl + 0.05) continue;
        if (!(heights[i - 1] < wl || heights[i + 1] < wl || heights[i - RES] < wl || heights[i + RES] < wl)) continue;
        const x = -HALF + ix * CELL, z = -HALF + iz * CELL;
        if (x * x + z * z > lim) continue;
        const c = navIndex(x, z);
        if (c < 0 || navBlock[c]) continue;
        if (shoreCount >= shoreX.length) {
          const nx = new Float32Array(shoreX.length * 2), nz = new Float32Array(shoreX.length * 2);
          nx.set(shoreX); nz.set(shoreZ);
          shoreX = nx; shoreZ = nz;
          shoreSortedX = new Float32Array(nx.length); shoreSortedZ = new Float32Array(nx.length);
        }
        shoreX[shoreCount] = x; shoreZ[shoreCount] = z; shoreCount++;
      }
    }
    if (shoreSortedX.length < shoreX.length) {
      shoreSortedX = new Float32Array(shoreX.length); shoreSortedZ = new Float32Array(shoreX.length);
    }
    shoreBucketFill.fill(0);
    for (let k = 0; k < shoreCount; k++) shoreBucketFill[shoreBucket(shoreX[k], shoreZ[k])]++;
    shoreBucketStart[0] = 0;
    for (let b = 0; b < SB * SB; b++) shoreBucketStart[b + 1] = shoreBucketStart[b] + shoreBucketFill[b];
    shoreBucketFill.fill(0);
    for (let k = 0; k < shoreCount; k++) {
      const b = shoreBucket(shoreX[k], shoreZ[k]);
      const o = shoreBucketStart[b] + shoreBucketFill[b]++;
      shoreSortedX[o] = shoreX[k]; shoreSortedZ[o] = shoreZ[k];
    }
    shoreLevel = wl;
    shoreDirty = false;
    shoreBuiltAt = GM.state.realTime || 0;
  }
  function shoreBucket(x, z) {
    const bx = clamp(Math.floor((x + HALF) / SBS), 0, SB - 1), bz = clamp(Math.floor((z + HALF) / SBS), 0, SB - 1);
    return bz * SB + bx;
  }
  function ensureShore() {
    const wl = waterY();
    if (shoreDirty || !(shoreLevel === shoreLevel)) { rebuildShore(); return; }
    if (Math.abs(wl - shoreLevel) > 0.05) {
      const now = GM.state.realTime || 0;
      if (now - shoreBuiltAt > 0.75 || now < shoreBuiltAt) rebuildShore();
    }
  }

  /** A land point within ~2 m of water (to drink), or null. */
  function nearestWater(x, z, maxDist) {
    if (!ready) return null;
    maxDist = maxDist > 0 ? maxDist : 120;
    x = +x || 0; z = +z || 0;
    ensureShore();
    if (!shoreCount) return null;
    const bx = clamp(Math.floor((x + HALF) / SBS), 0, SB - 1), bz = clamp(Math.floor((z + HALF) / SBS), 0, SB - 1);
    let best = maxDist * maxDist, bi = -1;
    const maxRing = Math.ceil(maxDist / SBS) + 1;
    for (let ring = 0; ring <= maxRing; ring++) {
      if (bi >= 0 && (ring - 1) * SBS > Math.sqrt(best)) break;
      for (let dz = -ring; dz <= ring; dz++) {
        const qz = bz + dz;
        if (qz < 0 || qz >= SB) continue;
        const edgeZ = dz === -ring || dz === ring;
        for (let dx = -ring; dx <= ring; dx += edgeZ ? 1 : 2 * ring || 1) {
          const qx = bx + dx;
          if (qx < 0 || qx >= SB) continue;
          const b = qz * SB + qx;
          for (let k = shoreBucketStart[b], e = shoreBucketStart[b + 1]; k < e; k++) {
            const ddx = shoreSortedX[k] - x, ddz = shoreSortedZ[k] - z;
            const d2 = ddx * ddx + ddz * ddz;
            if (d2 < best) { best = d2; bi = k; }
          }
        }
      }
    }
    return bi >= 0 ? { x: shoreSortedX[bi], z: shoreSortedZ[bi] } : null;
  }

  // ---------------------------------------------------------------- danger
  function cellDanger(c) {
    if (dangerStamp[c] === dangerEpoch) return dangerCache[c];
    let d = 0;
    const H = GM.Hazards;
    if (H && typeof H.dangerAt === 'function') {
      try { d = +H.dangerAt(cellX(c), cellZ(c)) || 0; } catch (e) { GM.reportError('Terrain.dangerAt', e); d = 0; }
    }
    d = d < 0 ? 0 : d > 1 ? 1 : d;
    dangerCache[c] = d;
    dangerStamp[c] = dangerEpoch;
    return d;
  }

  /** Nearby point with high cover (forest, rocks, caves), or null. */
  function findCover(x, z, maxDist) {
    if (!ready) return null;
    maxDist = maxDist > 0 ? maxDist : 60;
    x = +x || 0; z = +z || 0;
    const c0 = navIndexClamped(x, z);
    const cx0 = c0 % NAV, cz0 = (c0 / NAV) | 0;
    const rc = Math.ceil(maxDist / NCELL);
    const step = rc > 14 ? 2 : 1;
    const wl = waterY();
    let best = -1e9, bc = -1;
    for (let dz = -rc; dz <= rc; dz += step) {
      const nz = cz0 + dz;
      if (nz < 0 || nz >= NAV) continue;
      for (let dx = -rc; dx <= rc; dx += step) {
        const nx = cx0 + dx;
        if (nx < 0 || nx >= NAV) continue;
        const d = Math.sqrt(dx * dx + dz * dz) * NCELL;
        if (d > maxDist) continue;
        const c = nz * NAV + nx;
        if (!navWalk[c] || navH[c] < wl + 0.2) continue;
        const cov = navForest[c] > navCover[c] ? navForest[c] : navCover[c];
        if (cov < 0.45) continue;
        const dg = cellDanger(c);
        if (dg > 0.3) continue;
        const s = cov - (d / maxDist) * 0.4 - dg;
        if (s > best) { best = s; bc = c; }
      }
    }
    return bc >= 0 ? { x: cellX(bc), z: cellZ(bc) } : null;
  }

  function walkable(x, z) {
    if (!ready) return true;
    const c = navIndex(x, z);
    return c >= 0 && navWalk[c] === 1;
  }

  // ------------------------------------------------------------ pathfinding
  function heapPush(node, key) {
    let i = heapSize++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapKey[p] <= key) break;
      heapNode[i] = heapNode[p]; heapKey[i] = heapKey[p];
      i = p;
    }
    heapNode[i] = node; heapKey[i] = key;
  }
  function heapPop() {
    const top = heapNode[0];
    const n = --heapSize;
    if (n > 0) {
      const node = heapNode[n], key = heapKey[n];
      let i = 0;
      for (;;) {
        let l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        if (r < n && heapKey[r] < heapKey[l]) l = r;
        if (heapKey[l] >= key) break;
        heapNode[i] = heapNode[l]; heapKey[i] = heapKey[l];
        i = l;
      }
      heapNode[i] = node; heapKey[i] = key;
    }
    return top;
  }

  /** Nearest walkable nav cell to c within maxR rings (c itself first), -1 if none. */
  function nearestWalkableCell(c, maxR) {
    if (c >= 0 && navWalk[c]) return c;
    const cx = c % NAV, cz = (c / NAV) | 0;
    for (let r = 1; r <= maxR; r++) {
      let best = -1, bd = 1e9;
      for (let dz = -r; dz <= r; dz++) {
        const nz = cz + dz;
        if (nz < 0 || nz >= NAV) continue;
        const edgeZ = dz === -r || dz === r;
        for (let dx = -r; dx <= r; dx += edgeZ ? 1 : 2 * r) {
          const nx = cx + dx;
          if (nx < 0 || nx >= NAV) continue;
          const n = nz * NAV + nx;
          if (!navWalk[n]) continue;
          const d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = n; }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  function cellCost(c, wl) {
    let k = navCost[c];
    const depth = wl - navH[c];
    if (depth > 1.2) k *= 6;
    else if (depth > 0.1) k *= 1.7;
    return k;
  }

  /** Grid walk (DDA) from (x0,z0) to (x1,z1): every crossed cell must be passable. */
  function losClear(x0, z0, x1, z1, wl, allowWater, maxCost, avoidDanger, maxDanger) {
    const fx0 = (x0 + HALF) / NCELL, fz0 = (z0 + HALF) / NCELL;
    const fx1 = (x1 + HALF) / NCELL, fz1 = (z1 + HALF) / NCELL;
    let cx = Math.floor(fx0), cz = Math.floor(fz0);
    const ex = Math.floor(fx1), ez = Math.floor(fz1);
    const dx = fx1 - fx0, dz = fz1 - fz0;
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tmx = dx !== 0 ? (dx > 0 ? cx + 1 - fx0 : fx0 - cx) * tdx : Infinity;
    let tmz = dz !== 0 ? (dz > 0 ? cz + 1 - fz0 : fz0 - cz) * tdz : Infinity;
    let guard = 0;
    while ((cx !== ex || cz !== ez) && guard++ < 500) {
      if (tmx < tmz) { tmx += tdx; cx += sx; } else { tmz += tdz; cz += sz; }
      if (cx < 0 || cz < 0 || cx >= NAV || cz >= NAV) return false;
      const c = cz * NAV + cx;
      if (!navWalk[c]) return false;
      if (!allowWater && wl - navH[c] > 0.35) return false;
      if (navCost[c] > maxCost) return false;
      if (avoidDanger && cellDanger(c) > maxDanger) return false;
    }
    return true;
  }

  /**
   * A* on the nav grid (8 neighbours, binary heap, typed arrays), smoothed with
   * line of sight. Returns waypoints [{x, z}] (start excluded) or null.
   * opts {maxNodes=4000, avoidDanger=true}. Unreachable goal -> path to the closest cell reached.
   */
  function findPath(sx, sz, gx, gz, opts) {
    if (!ready) return null;
    sx = +sx; sz = +sz; gx = +gx; gz = +gz;
    if (!(sx === sx && sz === sz && gx === gx && gz === gz)) return null;
    opts = opts || {};
    const maxNodes = clamp(opts.maxNodes > 0 ? opts.maxNodes | 0 : 4000, 50, NN);
    const avoidDanger = opts.avoidDanger !== false;
    const wl = waterY();

    const s = nearestWalkableCell(navIndexClamped(sx, sz), 3);
    if (s < 0) return null;
    const gRaw = navIndexClamped(gx, gz);
    let g = nearestWalkableCell(gRaw, 5);
    const goalExact = g === gRaw && inArena(gx, gz, 0.5);
    if (g < 0) g = gRaw;
    if (s === g) return [{ x: goalExact ? gx : cellX(g), z: goalExact ? gz : cellZ(g) }];

    if (++searchId > 0xfffffff0) { openStamp.fill(0); closedStamp.fill(0); searchId = 1; }
    const sid = searchId;
    heapSize = 0;
    const gcx = g % NAV, gcz = (g / NAV) | 0;
    const hw = NCELL * HW;
    const heur = function (c) {
      const ddx = Math.abs((c % NAV) - gcx), ddz = Math.abs(((c / NAV) | 0) - gcz);
      return (ddx > ddz ? ddx + 0.41421356 * ddz : ddz + 0.41421356 * ddx) * hw;
    };
    gScore[s] = 0; parent[s] = -1; openStamp[s] = sid;
    heapPush(s, heur(s));
    let bestC = s, bestH = heur(s), expanded = 0, found = false;
    while (heapSize > 0) {
      const c = heapPop();
      if (closedStamp[c] === sid) continue;
      closedStamp[c] = sid;
      if (c === g) { found = true; break; }
      const hc = heur(c);
      if (hc < bestH) { bestH = hc; bestC = c; }
      if (++expanded > maxNodes) break;
      const cx = c % NAV, cz = (c / NAV) | 0;
      const gc = gScore[c];
      const costC = cellCost(c, wl);
      const hC = navH[c];
      for (let k = 0; k < 8; k++) {
        const nx = cx + NDX[k], nz = cz + NDZ[k];
        if (nx < 0 || nz < 0 || nx >= NAV || nz >= NAV) continue;
        const n = nz * NAV + nx;
        if (!navWalk[n] || closedStamp[n] === sid) continue;
        let step = 1;
        if (k >= 4) {
          if (!navWalk[cz * NAV + nx] || !navWalk[nz * NAV + cx]) continue;   // no corner cutting
          step = SQRT2;
        }
        let cost = step * NCELL * 0.5 * (costC + cellCost(n, wl));
        const climb = navH[n] - hC;
        if (climb > 0) cost += climb * 1.2;
        if (avoidDanger) {
          const dg = cellDanger(n);
          if (dg > 0.001) cost += step * NCELL * 30 * dg;
        }
        const ng = gc + cost;
        if (openStamp[n] !== sid || ng < gScore[n]) {
          openStamp[n] = sid;
          gScore[n] = ng;
          parent[n] = c;
          if (heapSize < HEAP_CAP) heapPush(n, ng + heur(n));
        }
      }
    }
    const end = found ? g : bestC;
    if (end === s) {
      return found ? [{ x: goalExact ? gx : cellX(g), z: goalExact ? gz : cellZ(g) }] : [{ x: cellX(s), z: cellZ(s) }];
    }
    // reconstruct (reverse into pathCells)
    let n = 0;
    for (let c = end; c >= 0 && n < NN; c = parent[c]) {
      pathCells[n++] = c;
      if (c === s) break;
    }
    for (let a = 0, b = n - 1; a < b; a++, b--) { const t = pathCells[a]; pathCells[a] = pathCells[b]; pathCells[b] = t; }

    // line-of-sight smoothing (greedy farthest visible cell)
    const out = [];
    let ax = sx, az = sz, ac = s;
    let i = 0;
    while (i < n - 1) {
      let j = i + 1;
      const aw = wl - navH[ac] > 0.35;
      const acost = navCost[ac];
      const adg = avoidDanger ? cellDanger(ac) : 0;
      for (let look = 0; j + 1 < n && look < 40; look++) {
        const c = pathCells[j + 1];
        const allowWater = aw || wl - navH[c] > 0.35;
        const maxCost = Math.max(acost, navCost[c]) * 1.6 + 0.6;
        const maxDanger = Math.max(adg, avoidDanger ? cellDanger(c) : 0) + 0.05;
        if (!losClear(ax, az, cellX(c), cellZ(c), wl, allowWater, maxCost, avoidDanger, maxDanger)) break;
        j++;
      }
      ac = pathCells[j];
      ax = cellX(ac); az = cellZ(ac);
      out.push({ x: ax, z: az });
      i = j;
    }
    if (found && goalExact && out.length) {
      const last = out[out.length - 1];
      last.x = gx; last.z = gz;
    }
    return out;
  }

  // --------------------------------------------------------------- raycast
  /** Ray march against the heightfield (and the water surface). -> THREE.Vector3 | null */
  function raycast(origin, dir, maxDist) {
    if (!ready || !origin || !dir) return null;
    maxDist = maxDist > 0 ? maxDist : 2000;
    const ox = +origin.x, oy = +origin.y, oz = +origin.z;
    let dx = +dir.x, dy = +dir.y, dz = +dir.z;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(l > 0) || !(ox === ox && oy === oy && oz === oz)) return null;
    dx /= l; dy /= l; dz /= l;
    const wl = waterY();
    const top = Math.max(maxHeight, wl) + 1, bottom = Math.min(minHeight, wl) - 1;
    let t0 = 0, t1 = maxDist;
    const clip = function (o, d, lo, hi) {
      if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
      let a = (lo - o) / d, b = (hi - o) / d;
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      return t0 <= t1;
    };
    if (!clip(ox, dx, -HALF, HALF) || !clip(oz, dz, -HALF, HALF) || !clip(oy, dy, bottom, top)) return null;
    const surf = function (x, z) { const h = heightAt(x, z); return h > wl ? h : wl; };
    const step = CELL * 0.5;
    let prev = t0;
    for (let t = t0; t <= t1 + step; t += step) {
      const tt = t > t1 ? t1 : t;
      const x = ox + dx * tt, y = oy + dy * tt, z = oz + dz * tt;
      if (y <= surf(x, z)) {
        let a = prev, b = tt;
        if (tt === t0) { a = b = t0; }
        for (let k = 0; k < 10 && b - a > 1e-3; k++) {
          const m = (a + b) * 0.5;
          if (oy + dy * m <= surf(ox + dx * m, oz + dz * m)) b = m; else a = m;
        }
        const px = ox + dx * b, pz = oz + dz * b;
        const py = surf(px, pz);
        return THREE ? new THREE.Vector3(px, py, pz) : { x: px, y: py, z: pz };
      }
      prev = tt;
      if (tt === t1) break;
    }
    return null;
  }

  // ---------------------------------------------------------- place names
  /** i18n key describing a place ('terrain.place.*'). */
  function placeKey(x, z) {
    if (!ready) return 'terrain.place.grass';
    for (const C of ctx.caves) if (U.dist2(C.x, C.z, x, z) < 4.5) return 'terrain.place.cave';
    const b = biomeAt(x, z);
    if (b === 'water') return 'terrain.place.water';
    if (b === 'plaza') return 'terrain.place.plaza';
    for (const th of thickets) if (U.dist2(th.x, th.z, x, z) < th.r && forestAt(x, z) > 0.5) return 'terrain.place.thicket';
    for (const L of ctx.lakes) if (U.dist2(L.x, L.z, x, z) < L.r * 1.6) return 'terrain.place.lake';
    for (const H of ctx.hills) if (U.dist2(H.x, H.z, x, z) < H.r * 0.8) return 'terrain.place.hill';
    return 'terrain.place.' + b;
  }
  /** i18n key of the compass direction from the centre ('terrain.dir.*'). North = -Z. */
  function dirKey(x, z) {
    if (x * x + z * z < 30 * 30) return 'terrain.dir.c';
    const a = Math.atan2(x, -z);                 // 0 = north, +PI/2 = east
    const k = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
    return 'terrain.dir.' + ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'][k];
  }
  function biomeKey(x, z) { return 'terrain.biome.' + biomeAt(x, z); }

  // ------------------------------------------------------------- public API
  const T = (GM.Terrain = {
    size: SIZE,
    res: RES,
    cellSize: CELL,
    half: HALF,
    heights,
    /** Per-vertex ground colours (0..255, RGB, no water) for the World mesh. */
    colors,
    forestData: forest,
    burntData: burnt,
    navRes: NAV,
    navCellSize: NCELL,
    landmarks,
    hideSpots,
    rocks,
    seed: 0,
    version: 0,
    forestVersion: 0,
    modified: false,

    generate,
    isReady() { return ready; },
    heightAt,
    normalAt,
    slopeAt,
    waterLevel: waterY,
    isWater,
    waterDepth,
    inArena,
    biomeAt,
    biomeKey,
    forestAt,
    coverAt,
    burnForest,
    colorAt,
    deform,
    randomLandPoint,
    nearestWater,
    findCover,
    findPath,
    walkable,
    raycast,
    placeKey,
    dirKey,
    /** Vertex index nearest to a point (for World). */
    vertexIndex: vIndex,
    minHeight() { return minHeight; },
    maxHeight() { return maxHeight; },
    /** Nav cell data for debugging / minimap overlays. */
    nav: { res: NAV, cell: NCELL, walk: navWalk, height: navH, cover: navCover, forest: navForest },
  });

  GM.on('water:changed', function () { shoreDirty = true; });

  GM.registerSystem({
    name: 'Terrain',
    order: 10,
    init() {},
    clear() { dangerEpoch++; dangerTimer = 0; },
    reset() { dangerEpoch++; dangerTimer = 0; shoreDirty = true; },
    update(dt) {
      dangerTimer += dt;
      if (dangerTimer >= 0.4) { dangerTimer = 0; dangerEpoch++; }
    },
  });
})();
