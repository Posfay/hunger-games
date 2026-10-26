/* ==========================================================================
 * camera.js — GM.Cameras: the broadcast.
 *
 * One main camera plus three live-feed cameras, all rendered into the one
 * full-window canvas with scissor rectangles taken from #viewport and the
 * .feed-slot[data-feed] elements built by the UI.
 *
 * Main camera modes:
 *   showcase  setup screen: slow cinematic orbit over the arena
 *   free      fly camera: WASD / arrows, Q/E down/up, Shift x3, drag to look,
 *             wheel moves forward / back; stays above ground, inside the map
 *   follow    orbit one contestant: drag to orbit, wheel zoom, drifts behind
 *   director  automatic TV director: interest-driven shots, hysteresis,
 *             shot variety, hard cuts or smooth moves, countdown sweep,
 *             kickoff wide, victor orbit
 *   overhead  top-down tactical view: WASD / drag pans, wheel zooms
 *
 * Owner: CAMERA. Contract: SPEC.md section 8.11.
 * ========================================================================== */
(function () {
  'use strict';
  const GM = window.GM;
  if (!GM) return;

  // ------------------------------------------------------------------ i18n
  if (GM.i18n) {
    GM.i18n.add({
      en: {
        'cam.camName': 'CAM {n}',
        'cam.feedName': 'FEED {n}',
        'cam.live': 'LIVE',
        'cam.cut': 'CUT',
        'cam.mode.showcase': 'Arena preview',
        'cam.mode.free': 'Free camera',
        'cam.mode.follow': 'Follow camera',
        'cam.mode.director': 'Director',
        'cam.mode.overhead': 'Map view',
        'cam.modeShort.showcase': 'PREVIEW',
        'cam.modeShort.free': 'FREE',
        'cam.modeShort.follow': 'FOLLOW',
        'cam.modeShort.director': 'DIRECTOR',
        'cam.modeShort.overhead': 'MAP',
        'cam.hint.showcase': 'Arena preview. Start the Show to take control.',
        'cam.hint.free': 'W A S D: move · Q / E: down / up · Shift: fast · Drag: look · Wheel: forward / back',
        'cam.hint.follow': 'Drag: turn around · Wheel: zoom · A / D: turn · W / S: zoom',
        'cam.hint.director': 'The camera finds the action by itself. Move or drag to take control.',
        'cam.hint.overhead': 'W A S D or drag: move the map · Wheel: zoom',
        'cam.keys': '1 Free · 2 Follow · 3 Director · 4 Map · C Next camera · F Follow selected',
        'cam.shot.establish': 'Wide',
        'cam.shot.wide': 'Wide',
        'cam.shot.top': 'From above',
        'cam.shot.low': 'Low angle',
        'cam.shot.shoulder': 'Over the shoulder',
        'cam.shot.orbit': 'Around',
        'cam.shot.track': 'Tracking',
        'cam.shot.crane': 'Crane',
        'cam.shot.portrait': 'Close-up',
        'cam.shot.sweep': 'Pedestals',
        'cam.shot.kickoff': 'Wide',
        'cam.shot.victor': 'Winner',
        'cam.overview': 'The arena',
        'cam.nexus': 'The Nexus',
        'cam.kickoff': 'The opening rush',
        'cam.countdown': 'The contestants wait on their pedestals',
        'cam.pedestal': '{name}, Team {team}',
        'cam.contestant': '{name} · Team {team}',
        'cam.feedContestant': '{name} · Team {team}',
        'cam.watch': 'Watching: {name}',
        'cam.following': 'Following: {name}',
        'cam.followDead': '{name} has fallen',
        'cam.fight': '{a} vs {b}',
        'cam.feedFight': 'Fight: {a} vs {b}',
        'cam.fightBeast': '{a} vs {beast}',
        'cam.beast.wolf': 'wolf beasts',
        'cam.beast.wasps': 'killer wasps',
        'cam.death': 'Fallen: {name}',
        'cam.deathBy': '{killer} killed {name}',
        'cam.betrayal': 'Betrayal: {name}',
        'cam.beasts': 'Beasts in the arena',
        'cam.hazard': 'Danger in the arena',
        'cam.drop': 'Supply drop',
        'cam.gift': 'A gift for {name}',
        'cam.feast': 'The feast',
        'cam.trap': 'A trap',
        'cam.alliance': 'Allies',
        'cam.power': 'The Showrunner steps in',
        'cam.powerUsed': 'Showrunner: {power}',
        'cam.lightning': 'Lightning strike',
        'cam.explosion': 'Explosion',
        'cam.quake': 'Earthquake',
        'cam.fire': 'Fire',
        'cam.gas': 'Gas cloud',
        'cam.zone': 'The force field closes',
        'cam.victor': 'Winner: {name}',
        'cam.noVictor': 'No winner',
        'cam.event': 'Live from the arena',
        'cam.noSignal': 'No signal',
        'cam.searching': 'Looking for action...',
      },
      hu: {
        'cam.camName': 'KAM {n}',
        'cam.feedName': 'ADÁS {n}',
        'cam.live': 'ÉLŐ',
        'cam.cut': 'VÁGÁS',
        'cam.mode.showcase': 'Aréna bemutató',
        'cam.mode.free': 'Szabad kamera',
        'cam.mode.follow': 'Követő kamera',
        'cam.mode.director': 'Rendező',
        'cam.mode.overhead': 'Térkép nézet',
        'cam.modeShort.showcase': 'ELŐNÉZET',
        'cam.modeShort.free': 'SZABAD',
        'cam.modeShort.follow': 'KÖVETÉS',
        'cam.modeShort.director': 'RENDEZŐ',
        'cam.modeShort.overhead': 'TÉRKÉP',
        'cam.hint.showcase': 'Aréna bemutató. Indítsd el a Műsort, és te irányítasz.',
        'cam.hint.free': 'W A S D: mozgás · Q / E: le / fel · Shift: gyors · Húzás: nézelődés · Görgő: előre / hátra',
        'cam.hint.follow': 'Húzás: körbeforgatás · Görgő: nagyítás · A / D: forgatás · W / S: nagyítás',
        'cam.hint.director': 'A kamera magától megkeresi az akciót. Mozgasd vagy húzd, és átveszed az irányítást.',
        'cam.hint.overhead': 'W A S D vagy húzás: térkép mozgatása · Görgő: nagyítás',
        'cam.keys': '1 Szabad · 2 Követés · 3 Rendező · 4 Térkép · C Következő kamera · F Versenyző követése',
        'cam.shot.establish': 'Távoli',
        'cam.shot.wide': 'Távoli',
        'cam.shot.top': 'Felülről',
        'cam.shot.low': 'Alulról',
        'cam.shot.shoulder': 'Váll mögül',
        'cam.shot.orbit': 'Körbe',
        'cam.shot.track': 'Követő',
        'cam.shot.crane': 'Daru',
        'cam.shot.portrait': 'Közeli',
        'cam.shot.sweep': 'Talapzatok',
        'cam.shot.kickoff': 'Távoli',
        'cam.shot.victor': 'Győztes',
        'cam.overview': 'Az aréna',
        'cam.nexus': 'A Nexus',
        'cam.kickoff': 'A nyitó roham',
        'cam.countdown': 'A versenyzők a talapzatukon várnak',
        'cam.pedestal': '{name}, {team}. csapat',
        'cam.contestant': '{name} · {team}. csapat',
        'cam.feedContestant': '{name} · {team}. csapat',
        'cam.watch': 'Figyeljük: {name}',
        'cam.following': 'Követjük: {name}',
        'cam.followDead': 'Elesett: {name}',
        'cam.fight': 'Harc: {a} – {b}',
        'cam.feedFight': 'Harc: {a} – {b}',
        'cam.fightBeast': 'Harc: {a} – {beast}',
        'cam.beast.wolf': 'farkasfenevadak',
        'cam.beast.wasps': 'gyilkosdarazsak',
        'cam.death': 'Elesett: {name}',
        'cam.deathBy': '{killer} megölte: {name}',
        'cam.betrayal': 'Árulás: {name}',
        'cam.beasts': 'Fenevadak az arénában',
        'cam.hazard': 'Veszély az arénában',
        'cam.drop': 'Utánpótlás érkezik',
        'cam.gift': 'Ajándék neki: {name}',
        'cam.feast': 'A lakoma',
        'cam.trap': 'Csapda',
        'cam.alliance': 'Szövetségesek',
        'cam.power': 'A Showrunner közbelép',
        'cam.powerUsed': 'Showrunner: {power}',
        'cam.lightning': 'Villámcsapás',
        'cam.explosion': 'Robbanás',
        'cam.quake': 'Földrengés',
        'cam.fire': 'Tűz',
        'cam.gas': 'Gázfelhő',
        'cam.zone': 'Szűkül az erőtér',
        'cam.victor': 'Győztes: {name}',
        'cam.noVictor': 'Nincs győztes',
        'cam.event': 'Élőben az arénából',
        'cam.noSignal': 'Nincs jel',
        'cam.searching': 'Akciót keresünk...',
      },
    });
  }

  const THREE = window.THREE;
  if (!THREE) return; // main.js shows the fatal message

  const CFG = GM.CFG;
  const U = GM.U;
  const V3 = THREE.Vector3;
  const TAU = Math.PI * 2;
  const HALF = CFG.MAP_SIZE / 2;
  const LIMIT = HALF - 4;           // cameras stay inside the terrain square
  const MAX_Y = 420;
  const MIN_HOLD = 4;               // director: real seconds a shot is held at least
  const MAX_HOLD = 14;              // ... and at most
  const FEED_COUNT = 3;
  const DRAG_PX = 6;
  const MODES = { showcase: 1, free: 1, follow: 1, director: 1, overhead: 1 };
  const CYCLE = ['free', 'follow', 'director', 'overhead'];

  // Scratch objects (never escape this file's functions).
  const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _e = new V3(), _f = new V3();
  const _g = new V3(), _h = new V3();
  const _ndc = new THREE.Vector2();
  const _size = new THREE.Vector2();
  const _ray = new THREE.Raycaster();
  const _hits = [];
  const _proj = new V3();

  let clock = 0; // real seconds (camera time)

  // --------------------------------------------------------------- helpers
  function groundY(x, z) {
    const T = GM.Terrain;
    if (!T || typeof T.heightAt !== 'function') return 0;
    let y = 0;
    try { y = T.heightAt(x, z); } catch (err) { return 0; }
    return y === y && y != null ? y : 0;
  }
  function waterY() {
    const E = GM.Env;
    if (E && typeof E.waterLevel === 'number' && E.waterLevel === E.waterLevel) return E.waterLevel;
    return CFG.BASE_WATER_LEVEL;
  }
  /** Ground or water surface, whichever is higher. */
  function surfaceY(x, z) {
    const g = groundY(x, z);
    const w = waterY();
    return g > w ? g : w;
  }
  function clampXZ(v, lim) {
    if (v.x > lim) v.x = lim; else if (v.x < -lim) v.x = -lim;
    if (v.z > lim) v.z = lim; else if (v.z < -lim) v.z = -lim;
    return v;
  }
  function finiteV(v) {
    return v.x === v.x && v.y === v.y && v.z === v.z &&
      Math.abs(v.x) < 1e6 && Math.abs(v.y) < 1e6 && Math.abs(v.z) < 1e6;
  }
  function kDamp(lambda, dt) { return 1 - Math.exp(-lambda * dt); }
  function contestantById(id) {
    const ts = GM.state.contestants;
    return id != null && ts && ts[id] ? ts[id] : null;
  }
  function phase() { return GM.state.phase; }
  function inGame() { const p = GM.state.phase; return p === 'countdown' || p === 'running' || p === 'ended'; }
  /** Entities that can still be filmed: living ones, and contestant bodies. */
  function filmable(e) {
    if (!e || !e.pos) return false;
    if (e.alive) return true;
    return e.kind === 'contestant' && !!(e.mesh && e.mesh.parent && e.mesh.visible !== false);
  }
  /** Visual feet position of a contestant or beast. */
  function entPos(e, out) {
    const m = e.mesh;
    if (e.kind === 'contestant' && m && m.parent && m.position && m.parent.type === 'Scene') {
      out.copy(m.position);
    } else if (e.pos) {
      out.set(+e.pos.x || 0, +e.pos.y || 0, +e.pos.z || 0);
    } else {
      out.set(0, 0, 0);
    }
    if (!finiteV(out)) out.set(0, 0, 0);
    return out;
  }
  function entHeading(e) {
    const h = e && e.heading;
    return typeof h === 'number' && h === h ? h : 0;
  }
  function entSpeed(e) {
    const v = e && e.vel;
    return v ? Math.sqrt((v.x || 0) * (v.x || 0) + (v.z || 0) * (v.z || 0)) : 0;
  }
  function label(key, params) { return { key, params: params || {} }; }
  function nameOf(e) {
    if (!e) return '?';
    if (e.kind === 'beast') return '@cam.beast.' + (e.type === 'wasps' ? 'wasps' : 'wolf');
    return e.name || '?';
  }
  function hasKey(key) { return !!(GM.i18n && GM.i18n.has && GM.i18n.has(key, 'en')); }
  /** Lift a camera position so the terrain does not hide the target (checks 3 points on the line). */
  function unocclude(target, pos, clear) {
    let lift = 0;
    for (let i = 1; i <= 3; i++) {
      const k = i / 3.2;
      const x = target.x + (pos.x - target.x) * k;
      const z = target.z + (pos.z - target.z) * k;
      const y = target.y + (pos.y - target.y) * k;
      const g = surfaceY(x, z) + clear;
      if (y < g) {
        const need = (g - y) / k;
        if (need > lift) lift = need;
      }
    }
    if (lift > 0) pos.y += Math.min(lift, 60);
    return pos;
  }
  /** Keep a camera position above the surface and inside the map. */
  function keepAbove(pos, clear) {
    clampXZ(pos, LIMIT);
    const s = surfaceY(pos.x, pos.z) + clear;
    if (pos.y < s) pos.y = s;
    if (pos.y > MAX_Y) pos.y = MAX_Y;
    return pos;
  }

  // --------------------------------------------------------- line of sight
  // Trees are simple solids here, sized like world.js builds them: pine crowns
  // are cones, broadleaf crowns ellipsoids (burnt crowns shrink). A bucket grid
  // over GM.World.trees keeps the checks cheap. Director shots, feeds and the
  // follow camera use this to stay out of tree crowns and not film hillsides.
  const TC = 6;                 // tree grid cell (m)
  const CANOPY = 11;            // no crown reaches higher above the ground (m)
  let tgCells = null, tgN = 1, tgList = null, tgLen = -1, tgStamp = null, tgNo = 0;
  function tCell(v) {
    const c = Math.floor((v + HALF) / TC);
    return c < 0 ? 0 : c >= tgN ? tgN - 1 : c;
  }
  function treeGrid() {
    const W = GM.World;
    const list = W && W.trees;
    if (!list || !list.length) return null;
    if (tgCells && tgList === list && tgLen === list.length) return tgCells;
    tgList = list;
    tgLen = list.length;
    tgN = Math.max(1, Math.ceil(CFG.MAP_SIZE / TC));
    tgCells = new Array(tgN * tgN).fill(null);
    for (let i = 0; i < list.length; i++) {
      const tr = list[i];
      if (!tr || !(+tr.x === +tr.x) || !(+tr.z === +tr.z)) continue;
      const k = tCell(+tr.z) * tgN + tCell(+tr.x);
      (tgCells[k] || (tgCells[k] = [])).push(i);
    }
    tgStamp = new Uint32Array(list.length);
    tgNo = 0;
    return tgCells;
  }
  function nextStamp() {
    tgNo = (tgNo + 1) >>> 0;
    if (tgNo === 0) { tgStamp.fill(0); tgNo = 1; }
    return tgNo;
  }
  const _cr = { pine: true, yb: 0, yt: 0, r: 0, yc: 0, hv: 1, base: 0, tr: 0.2, th: 2.6 };
  /** Crown (and trunk) shape of a tree, written into _cr. */
  function crownOf(tr) {
    const sc = +tr.scale || 1;
    const sh = sc * (+tr.h || 1), sw = sc * (+tr.w || 1);
    const by = +tr.y === +tr.y ? +tr.y : groundY(+tr.x, +tr.z);
    _cr.base = by;
    _cr.tr = 0.24 * sw;
    _cr.th = 2.6 * sh;
    if (tr.type === 'pine') {
      _cr.pine = true;
      _cr.yb = by + 1.2 * sh;
      _cr.yt = by + 6.7 * sh;
      _cr.r = 2.05 * sw;
      if (tr.burnt) { _cr.yt = _cr.yb + (_cr.yt - _cr.yb) * 0.55; _cr.r *= 0.55; }
    } else {
      _cr.pine = false;
      let yc = by + 3.8 * sh, hv = 1.6 * sh, r = 1.95 * sw;
      if (tr.burnt) { const pv = by + 2.1 * sh; yc = pv + (yc - pv) * 0.55; hv *= 0.55; r *= 0.55; }
      _cr.yc = yc; _cr.hv = hv; _cr.r = r;
      _cr.yb = yc - hv; _cr.yt = yc + hv;
    }
    return _cr;
  }
  /** Crown radius at height y (0 above or below the crown). */
  function crownR(c, y) {
    if (y <= c.yb || y >= c.yt) return 0;
    if (c.pine) return c.r * (1 - 0.85 * (y - c.yb) / (c.yt - c.yb));
    const q = (y - c.yc) / c.hv;
    return c.r * Math.sqrt(1 - q * q);
  }
  /** Is point P inside a crown or trunk, or closer than `pad` to one (near-plane clipping)? */
  function inTree(P, pad) {
    const cells = treeGrid();
    if (!cells) return false;
    const list = tgList;
    const cx0 = tCell(P.x - 3.5), cx1 = tCell(P.x + 3.5), cz0 = tCell(P.z - 3.5), cz1 = tCell(P.z + 3.5);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const b = cells[cz * tgN + cx];
        if (!b) continue;
        for (let i = 0; i < b.length; i++) {
          const tr = list[b[i]];
          if (!tr || tr.hidden) continue;
          const dx = tr.x - P.x, dz = tr.z - P.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > 16) continue;
          const c = crownOf(tr);
          if (P.y < c.base + c.th && d2 < (c.tr + pad) * (c.tr + pad)) return true;
          if (P.y < c.yb - pad || P.y > c.yt + pad) continue;
          const r = crownR(c, U.clamp(P.y, c.yb + 0.05, c.yt - 0.05)) + pad;
          if (d2 < r * r) return true;
        }
      }
    }
    return false;
  }
  /** Highest crown top within r metres of (x, z), or -Infinity. */
  function canopyTop(x, z, r) {
    const cells = treeGrid();
    if (!cells) return -Infinity;
    const list = tgList;
    let top = -Infinity;
    const cx0 = tCell(x - r), cx1 = tCell(x + r), cz0 = tCell(z - r), cz1 = tCell(z + r);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const b = cells[cz * tgN + cx];
        if (!b) continue;
        for (let i = 0; i < b.length; i++) {
          const tr = list[b[i]];
          if (!tr || tr.hidden) continue;
          const dx = tr.x - x, dz = tr.z - z;
          if (dx * dx + dz * dz > r * r) continue;
          const c = crownOf(tr);
          if (c.yt > top) top = c.yt;
        }
      }
    }
    return top;
  }
  /**
   * How blocked is the view from camera P to subject point T? 0 = clear.
   * Every crown in the way adds 1, a hill 2, a camera inside a tree 4.
   * Stops counting at `stop`.
   */
  function viewBlock(P, T, stop) {
    const dx = P.x - T.x, dy = P.y - T.y, dz = P.z - T.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(len > 0.6)) return 0;
    let score = 0;
    const u0 = Math.min(0.5, 0.9 / len);          // the subject's own spot
    const n = Math.min(36, Math.max(4, Math.ceil(len / 2.5)));
    let hi = -1;
    for (let i = 1; i <= n; i++) {
      const u = i / n;
      const x = T.x + dx * u, y = T.y + dy * u, z = T.z + dz * u;
      const g = groundY(x, z);
      if (i < n && u > u0 && y < g + 0.15) score = 2;
      if (y < g + CANOPY) hi = u;
    }
    if (score >= stop) return score;
    const cells = hi > u0 ? treeGrid() : null;
    if (cells) {
      hi = Math.min(1, hi + 1 / n);
      const list = tgList;
      const ax = T.x + dx * u0, az = T.z + dz * u0, bx = T.x + dx * hi, bz = T.z + dz * hi;
      const cx0 = tCell(Math.min(ax, bx) - 3.2), cx1 = tCell(Math.max(ax, bx) + 3.2);
      const cz0 = tCell(Math.min(az, bz) - 3.2), cz1 = tCell(Math.max(az, bz) + 3.2);
      const L2 = dx * dx + dz * dz;
      const st = nextStamp();
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const b = cells[cz * tgN + cx];
          if (!b) continue;
          for (let i = 0; i < b.length; i++) {
            const idx = b[i];
            if (tgStamp[idx] === st) continue;
            tgStamp[idx] = st;
            const tr = list[idx];
            if (!tr || tr.hidden) continue;
            const px = tr.x - T.x, pz = tr.z - T.z;
            const c = crownOf(tr);
            const rr = c.r * 0.8;                     // grazing a crown's edge is fine
            let ua, ub;
            if (L2 < 1e-6) {
              if (px * px + pz * pz >= rr * rr) continue;
              ua = u0; ub = hi;
            } else {
              const uc = (px * dx + pz * dz) / L2;
              const ex = px - dx * uc, ez = pz - dz * uc;
              const d2 = ex * ex + ez * ez;
              if (d2 >= rr * rr) continue;
              const w = Math.sqrt((rr * rr - d2) / L2);
              ua = Math.max(uc - w, u0);
              ub = Math.min(uc + w, hi);
              if (ua >= ub) continue;
            }
            const ya = T.y + dy * ua, yb = T.y + dy * ub;
            if (Math.max(ya, yb) <= c.yb || Math.min(ya, yb) >= c.yt) continue;
            for (let k = 0; k < 5; k++) {
              const u = ua + ((ub - ua) * (k + 0.5)) / 5;
              const qx = T.x + dx * u - tr.x, qz = T.z + dz * u - tr.z;
              const r = crownR(c, T.y + dy * u) * 0.8;
              if (r > 0 && qx * qx + qz * qz < r * r) { score += 1; break; }
            }
            if (score >= stop) return score;
          }
        }
      }
    }
    if (inTree(P, 0.6)) score += 4;
    return score;
  }

  function distSq3(a, b) { const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return dx * dx + dy * dy + dz * dz; }
  function lowQuality() { const s = GM.state.settings; return !!(s && s.quality === 'low'); }
  function feedsEnabled() { const s = GM.state.settings; return !s || s.feeds !== false; }

  // ------------------------------------------------------------ shot styles
  // fov: lens; lp / ll: position / look smoothing; clear: min height above ground;
  // cam: camera number shown as "CAM 0n"; hold: [min, max] real seconds.
  const STYLE = {
    shoulder:  { fov: 50, lp: 4.0, ll: 5.0, clear: 0.8, cam: 3, hold: [4.5, 7] },
    low:       { fov: 62, lp: 3.0, ll: 4.0, clear: 0.3, cam: 4, hold: [4.5, 7] },
    wide:      { fov: 42, lp: 2.5, ll: 3.0, clear: 3.0, cam: 1, hold: [5, 8] },
    top:       { fov: 45, lp: 2.5, ll: 3.0, clear: 5.0, cam: 7, hold: [5, 8] },
    orbit:     { fov: 52, lp: 5.0, ll: 6.0, clear: 1.0, cam: 2, hold: [6, 9] },
    track:     { fov: 55, lp: 4.0, ll: 5.0, clear: 1.0, cam: 5, hold: [7, 11] },
    crane:     { fov: 55, lp: 4.0, ll: 5.0, clear: 0.6, cam: 6, hold: [5.5, 7.5] },
    portrait:  { fov: 40, lp: 4.0, ll: 5.0, clear: 0.6, cam: 8, hold: [4.5, 6.5] },
    establish: { fov: 50, lp: 2.0, ll: 2.0, clear: 8.0, cam: 1, hold: [6, 9] },
    kickoff: { fov: 55, lp: 3.0, ll: 3.0, clear: 4.0, cam: 1, hold: [6, 6] },
    victor:    { fov: 48, lp: 3.0, ll: 4.0, clear: 0.6, cam: 2, hold: [1e9, 1e9] },
  };
  // Director shot weights per kind of happening.
  const STYLE_W = {
    fight:    { shoulder: 3, low: 2, orbit: 2, wide: 1, track: 1 },
    death:    { crane: 3, low: 2, top: 1, portrait: 1 },
    hazard:   { top: 3, wide: 3, crane: 1, low: 1 },
    beast:     { wide: 2, low: 2, track: 2, top: 1, shoulder: 1 },
    drop:     { wide: 2, crane: 2, orbit: 1, top: 1 },
    betrayal: { shoulder: 3, low: 2, portrait: 2 },
    alliance: { orbit: 2, wide: 2, portrait: 1 },
    trap:     { low: 2, crane: 2, portrait: 1 },
    power:    { top: 2, wide: 3, crane: 1 },
    victor:   { orbit: 1 },
    contestant:  { track: 3, orbit: 2, shoulder: 1, portrait: 1, wide: 1, low: 1 },
    event:    { wide: 3, orbit: 1, crane: 1, top: 1 },
  };
  // Live feeds use calmer, simpler framing.
  const FEED_W = {
    fight:    { shoulder: 2, orbit: 2, low: 1 },
    death:    { crane: 2, top: 1 },
    hazard:   { wide: 2, top: 2 },
    beast:     { wide: 1, orbit: 1, low: 1 },
    drop:     { wide: 1, orbit: 1 },
    betrayal: { shoulder: 1, portrait: 1 },
    alliance: { orbit: 1, wide: 1 },
    trap:     { low: 1, orbit: 1 },
    power:    { wide: 1, top: 1 },
    victor:   { orbit: 1 },
    contestant:  { track: 2, orbit: 1, portrait: 1 },
    event:    { wide: 1, orbit: 1 },
  };
  const NEEDS_SUBJECT = { shoulder: 1, track: 1, portrait: 1 };
  // Fallback director: what makes a contestant worth watching.
  const ACTIVE_ACTIONS = {
    fight: 1.6, berserk: 1.6, hunt: 1.4, stalk: 1.2, kickoff: 1.2, ambush: 1.1, mad: 1.3,
    flee: 1.0, steal: 1.0, panic: 1.0, feast: 1.0, escape_zone: 0.9, trap: 0.8,
    investigate: 0.6, ally: 0.6, loot: 0.5,
  };
  const CAM_NAMES = [];
  for (let i = 0; i < 40; i++) CAM_NAMES.push('CAM ' + (i < 10 ? '0' : '') + i);
  const FEED_MIN = 5;   // real seconds a feed keeps its subject at least
  const FEED_MAX = 12;  // ... and at most (contestant rotation)

  // ------------------------------------------------------------ public object
  const Cameras = (GM.Cameras = {});
  const main = new THREE.PerspectiveCamera(55, Math.max(0.2, (window.innerWidth || 16) / (window.innerHeight || 9)), 0.3, 2400);
  main.position.set(120, 70, 120);
  main.lookAt(0, 4, 0);
  Cameras.main = main;
  Cameras.mode = 'showcase';
  /** Ground point the main camera is looking at (shadows, audio listener, minimap cone). */
  const focusPoint = new V3();
  Cameras.focusPoint = focusPoint;

  // ----------------------------------------------------------------- state
  let mode = 'showcase';
  const cur = { pos: new V3(120, 70, 120), look: new V3(0, 4, 0), fov: 55 };  // smoothed, what we show
  const des = { pos: new V3(120, 70, 120), look: new V3(0, 4, 0), fov: 55 };  // wanted this frame
  let lamPos = 3, lamLook = 3;   // smoothing strengths for this frame
  let snapNext = true;           // hard cut on the next apply
  let modeBlend = 0;             // soft blend after a mode switch (real s)
  let cutT = 0;                  // 'cut' flag timer for the UI
  let camNo = 1;
  let curLabel = label('cam.mode.showcase');
  let curShot = 'showcase';

  const shk = { amp: 0, t: 0, dur: 1 };
  let reducedMotion = false;

  const keys = Object.create(null);
  let shiftDown = false;
  const ptr = { down: false, id: -1, button: 0, x0: 0, y0: 0, x: 0, y: 0, drag: false };
  const hover = { pending: false, x: 0, y: 0, last: -1 };
  let canvasEl = null;

  // Last known screen rectangle of the main view (client CSS px).
  const vp = { left: 0, top: 0, width: Math.max(1, window.innerWidth || 1), height: Math.max(1, window.innerHeight || 1), full: true };
  let vpEl = null, vpElCheck = -99;
  const slotEls = [null, null, null];
  let slotElCheck = -99;
  const slotVis = [false, false, false];
  const slotStyleOk = [true, true, true];
  let slotStyleCheck = -99;
  let lastRender = -99;

  const free = {
    pos: new V3(120, 70, 120), vel: new V3(), yaw: 0, pitch: -0.35, dolly: 0,
    fly: { on: false, t: 0, dur: 1, from: new V3(), to: new V3(), yaw0: 0, yaw1: 0, pitch0: 0, pitch1: 0, arc: 0 },
  };
  const fol = { id: null, yaw: 0, pitch: 0.38, dist: 11, tgt: new V3(), userT: -99, labelId: -1, labelAlive: true };
  const ovh = { c: new V3(), vel: new V3(), h: 180, hGoal: 180, gy: 0, goal: new V3(), goalOn: false };
  const show = { t: 0, a: 0.6, user: 0, zoom: 1, zoomGoal: 1 };

  // ------------------------------------------------- candidates ("the news")
  // A pooled list of things worth filming, built from GM.state.interests and
  // from events. Candidates linger a few REAL seconds after the simulation
  // drops them, so a death at 16x speed is still shown.
  const CAND_MAX = 48;
  const cands = [];
  let candSeq = 0;
  let candSync = -99;
  function newCand() {
    return {
      active: false, id: 0, iid: 0, key: '', kind: 'event', cls: 'event', pos: new V3(),
      followId: null, otherId: null, radius: 10, score: 1, synScore: 0, label: null,
      born: 0, seen: 0, linger: 3, live: false, shownAt: -99,
    };
  }
  for (let i = 0; i < CAND_MAX; i++) cands.push(newCand());

  function allocCand() {
    let worst = null, wv = Infinity;
    for (let i = 0; i < CAND_MAX; i++) {
      const c = cands[i];
      if (!c.active) { worst = c; break; }
      if (c === dir.shot.cand) continue;
      const v = c.score - (clock - c.seen) * 0.5;
      if (v < wv) { wv = v; worst = c; }
    }
    if (!worst) worst = cands[0];
    worst.active = true;
    worst.id = ++candSeq;
    worst.iid = 0; worst.key = ''; worst.kind = 'event'; worst.cls = 'event';
    worst.followId = null; worst.otherId = null; worst.radius = 10;
    worst.score = 1; worst.synScore = 0; worst.label = null;
    worst.born = clock; worst.seen = clock; worst.linger = 3; worst.live = false; worst.shownAt = -99;
    return worst;
  }

  function classify(kind, key, followId) {
    const k = String(kind || '').toLowerCase();
    if (k === 'death' || k === 'kill') return 'death';
    if (k === 'fight' || k === 'combat' || (key && String(key).indexOf('fight') === 0)) return 'fight';
    if (k === 'hazard' || k === 'fire' || k === 'gas' || k === 'quake' || k === 'lightning' ||
        k === 'explosion' || k === 'zone' || k === 'flood' || k === 'storm' || k === 'fireball') return 'hazard';
    if (k === 'beast' || k === 'beasts' || k === 'wolf' || k === 'wasps') return 'beast';
    if (k === 'drop' || k === 'supply' || k === 'crate' || k === 'gift' || k === 'item' || k === 'loot' || k === 'feast') return 'drop';
    if (k === 'betrayal' || k === 'betray') return 'betrayal';
    if (k === 'alliance') return 'alliance';
    if (k === 'trap') return 'trap';
    if (k === 'victor' || k === 'finale') return 'victor';
    if (k === 'power' || k === 'gm') return 'power';
    return followId != null ? 'contestant' : 'event';
  }

  const FIGHT_KEY = /^fight:(\d+)-(\d+)$/;
  function upsertInterest(it) {
    if (!it || !it.pos) return;
    const x = +it.pos.x, z = +it.pos.z;
    if (!(x === x && z === z)) return;
    let c = null;
    for (let i = 0; i < CAND_MAX; i++) {
      const q = cands[i];
      if (q.active && q.iid === it.id) { c = q; break; }
    }
    if (!c) {
      const cls = classify(it.kind, it.key, it.followId);
      // Merge with an event-made candidate for the same happening.
      for (let i = 0; i < CAND_MAX; i++) {
        const q = cands[i];
        if (!q.active || q.iid || clock - q.born > 3) continue;
        const sameWho = q.followId != null && q.followId === it.followId;
        if (q.cls !== cls && !sameWho) continue;
        const dx = q.pos.x - x, dz = q.pos.z - z;
        if (dx * dx + dz * dz > 144) continue;
        c = q;
        break;
      }
      if (!c) { c = allocCand(); c.cls = cls; }
      c.iid = it.id;
      c.key = it.key || '';
      c.kind = it.kind || c.kind;
      const m = c.key ? FIGHT_KEY.exec(c.key) : null;
      if (m) {
        const a = +m[1], b = +m[2];
        if (it.followId === b) { c.followId = b; c.otherId = a; } else { c.followId = a; c.otherId = b; }
      }
    }
    c.live = true;
    c.seen = clock;
    c.pos.set(x, it.pos.y == null ? groundY(x, z) : +it.pos.y || 0, z);
    c.score = Math.max(+it.score || 1, c.synScore);
    if (it.label && it.label.key) c.label = it.label;
    if (it.followId != null && c.followId == null) c.followId = it.followId;
    c.linger = c.score >= 9 ? 6 : c.score >= 6 ? 3.5 : 2;
  }

  /** Candidate made from an event (deaths, hazards...). Merges with a matching one. */
  function addEventCand(cls, pos, score, followId, otherId, lbl, radius, linger) {
    if (!pos) return null;
    const x = +pos.x, z = +pos.z;
    if (!(x === x && z === z)) return null;
    let c = null;
    for (let i = 0; i < CAND_MAX; i++) {
      const q = cands[i];
      if (!q.active || clock - q.born > 3) continue;
      const sameWho = followId != null && q.followId === followId;
      if (q.cls !== cls && !sameWho) continue;
      const dx = q.pos.x - x, dz = q.pos.z - z;
      if (dx * dx + dz * dz > 144) continue;
      c = q;
      break;
    }
    if (!c) {
      c = allocCand();
      c.cls = cls; c.kind = cls;
      c.pos.set(x, pos.y == null ? groundY(x, z) : +pos.y || 0, z);
    }
    c.synScore = Math.max(c.synScore, score);
    c.score = Math.max(c.score, score);
    if (followId != null) c.followId = followId;
    if (otherId != null) c.otherId = otherId;
    if (cls === 'death') c.cls = 'death';
    if (lbl && (!c.label || !c.iid || cls === 'death')) c.label = lbl;
    c.radius = Math.max(c.radius, radius || 10);
    c.linger = Math.max(c.linger, linger || 4);
    c.seen = clock;
    return c;
  }

  function candValid(c) { return !!c && c.active && (c.live || clock - c.seen < c.linger); }

  function syncCands() {
    for (let i = 0; i < CAND_MAX; i++) if (cands[i].active && cands[i].iid) cands[i].live = false;
    const list = GM.state.interests;
    if (list) for (let i = 0; i < list.length; i++) upsertInterest(list[i]);
    for (let i = 0; i < CAND_MAX; i++) {
      const c = cands[i];
      if (c.active && !c.live && clock - c.seen > c.linger) c.active = false;
    }
  }

  // Recently filmed contestants (variety).
  const recentIds = new Int32Array(12).fill(-1);
  const recentAt = new Float64Array(12);
  let recentI = 0;
  function markShown(id) {
    if (id == null) return;
    recentIds[recentI] = id; recentAt[recentI] = clock;
    recentI = (recentI + 1) % recentIds.length;
  }
  function recentlyShown(id, within) {
    for (let i = 0; i < recentIds.length; i++) if (recentIds[i] === id && clock - recentAt[i] < within) return true;
    return false;
  }

  function candValue(c) {
    let v = c.score;
    const age = clock - c.born;
    if (age < 6) v *= 1 + 0.45 * (1 - age / 6);      // fresh news first
    if (!c.live) v *= 0.85;
    if (clock - c.shownAt < 25) v *= 0.7;             // we just showed this
    if (c.followId != null) {
      const t = contestantById(c.followId);
      if (t) {
        if (!t.alive && c.cls !== 'death') v *= 0.5;
        if (GM.state.selectedId === t.id) v *= 1.25;   // the Showrunner cares about this one
        if (recentlyShown(t.id, 30)) v *= 0.85;
      }
    }
    return v;
  }

  // ----------------------------------------------------------------- shots
  function makeShot() {
    return {
      active: false, style: 'wide', cand: null, candId: 0, cls: 'event',
      subjectId: null, otherId: null, otherBeast: null, otherCheck: -99,
      anchor: new V3(), radius: 10, t0: 0, hold: 8, side: 1, yaw0: 0, rnd: 0.5, yawS: 0,
      heading: 0, speed: 0, label: null, camNo: 1, fov: 55, lp: 3.5, ll: 4, clear: 0.8,
      fallback: false, pos: new V3(), look: new V3(),
    };
  }

  /** Find someone the subject is dealing with (target, nearest enemy or beast). */
  function findOther(s, nearestToo) {
    const t = contestantById(s.subjectId);
    if (!t || !t.pos) return;
    if (t.targetId != null) {
      const o = contestantById(t.targetId);
      if (o && o !== t && o.alive && o.pos && U.distSqXZ(o.pos, t.pos) < 900) { s.otherId = o.id; s.otherBeast = null; return; }
    }
    if (!nearestToo) return;
    const ts = GM.state.contestants;
    let best = null, bd = 14 * 14;
    for (let i = 0; i < ts.length; i++) {
      const o = ts[i];
      if (!o || o === t || !o.alive || !o.pos) continue;
      const d = U.distSqXZ(o.pos, t.pos);
      if (d < bd) { bd = d; best = o; }
    }
    if (best) { s.otherId = best.id; s.otherBeast = null; return; }
    const ms = GM.state.beasts;
    let bm = null; bd = 16 * 16;
    if (ms) {
      for (let i = 0; i < ms.length; i++) {
        const m = ms[i];
        if (!m || !m.alive || !m.pos) continue;
        const d = U.distSqXZ(m.pos, t.pos);
        if (d < bd) { bd = d; bm = m; }
      }
    }
    if (bm) { s.otherBeast = bm; s.otherId = null; }
  }

  function pickStyle(table, cls, hasSubject, prev, avoid) {
    const w = table[cls] || table.event;
    let total = 0;
    for (const k in w) total += styleWeight(w, k, hasSubject, prev, avoid);
    if (total <= 0) return hasSubject ? 'orbit' : 'wide';
    let r = Math.random() * total;
    for (const k in w) {
      r -= styleWeight(w, k, hasSubject, prev, avoid);
      if (r <= 0) return k;
    }
    return hasSubject ? 'orbit' : 'wide';
  }
  function styleWeight(w, k, hasSubject, prev, avoid) {
    let x = w[k];
    if (!hasSubject && NEEDS_SUBJECT[k]) return 0;
    if (k === avoid) return 0;
    if (k === prev) x *= 0.12;
    else if (dir.lastStyles[0] === k || dir.lastStyles[1] === k || dir.lastStyles[2] === k) x *= 0.55;
    return x;
  }

  /** Choose the camera side with a clear view (little terrain in the way). */
  function pickYaw(s) {
    const S = s.anchor;
    let base;
    const o = contestantById(s.otherId);
    if (o && o.pos) {
      // 180-degree rule: film a fight from the side of the fighting line.
      base = Math.atan2(o.pos.x - S.x, o.pos.z - S.z) + s.side * Math.PI * 0.5;
    } else if (s.subjectId != null) {
      base = s.heading + s.side * 0.8;   // in front, three-quarter view
    } else {
      base = Math.atan2(-S.x, -S.z) + (s.rnd - 0.5) * 1.2;   // from the arena side, looking out
      if (S.x * S.x + S.z * S.z < 25) base = s.rnd * TAU;
    }
    let dist = 13, hgt = 6;
    switch (s.style) {
      case 'shoulder': return base;
      case 'low': dist = 7; hgt = 0.5; break;
      case 'wide': dist = U.clamp(34 + s.radius * 1.6, 34, 110); hgt = dist * 0.5; break;
      case 'crane': dist = 16; hgt = 10; break;
      case 'establish': dist = 105; hgt = 60; break;
      case 'victor': dist = 8; hgt = 3; break;
      case 'top': case 'track': case 'portrait': return base;
      default: break;
    }
    let bestYaw = base, bestLift = Infinity;
    for (let k = 0; k < 6; k++) {
      const yaw = base + (k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (TAU / 6));
      const px = S.x + Math.sin(yaw) * dist, pz = S.z + Math.cos(yaw) * dist;
      let lift = 0;
      for (let j = 1; j <= 3; j++) {
        const f = j / 3;
        const x = S.x + (px - S.x) * f, z = S.z + (pz - S.z) * f;
        const y = S.y + 1.2 + (hgt - 1.2) * f;
        const g = surfaceY(x, z) + 0.8;
        if (g > y) lift = Math.max(lift, g - y);
      }
      if (Math.abs(px) > LIMIT || Math.abs(pz) > LIMIT) lift += 20;
      lift += k * 0.35;   // prefer the natural angle
      if (lift < bestLift) { bestLift = lift; bestYaw = yaw; }
      if (lift < 0.5) break;
    }
    return bestYaw;
  }

  function labelFor(s, cand, forFeed) {
    if (cand && cand.label && cand.label.key) return cand.label;
    const t = contestantById(s.subjectId);
    const o = contestantById(s.otherId);
    switch (s.cls) {
      case 'fight':
        if (t && o) return label(forFeed ? 'cam.feedFight' : 'cam.fight', { a: t.name, b: o.name });
        if (t && s.otherBeast) return label('cam.fightBeast', { a: t.name, beast: nameOf(s.otherBeast) });
        break;
      case 'death':
        if (t) return o && o !== t ? label('cam.deathBy', { killer: o.name, name: t.name }) : label('cam.death', { name: t.name });
        break;
      case 'hazard': return label('cam.hazard');
      case 'beast': return label('cam.beasts');
      case 'drop': return t ? label('cam.gift', { name: t.name }) : label('cam.drop');
      case 'betrayal': if (t) return label('cam.betrayal', { name: t.name }); break;
      case 'alliance': return label('cam.alliance');
      case 'trap': return label('cam.trap');
      case 'power': return label('cam.power');
      case 'victor': return t ? label('cam.victor', { name: t.name }) : label('cam.noVictor');
      default: break;
    }
    if (t) {
      if (phase() === 'countdown') return label('cam.pedestal', { name: t.name, team: t.team });
      return label(forFeed ? 'cam.feedContestant' : 'cam.contestant', { name: t.name, team: t.team });
    }
    return label('cam.event');
  }

  /**
   * (Re)start a shot. cand may be null; subjectId may be null (point shot at opts.pos).
   * opts: {pos, cls, hold, forFeed}
   */
  function setupShot(s, cand, subjectId, style, opts) {
    const st = STYLE[style] || STYLE.wide;
    s.active = true;
    s.cand = cand || null;
    s.candId = cand ? cand.id : 0;
    s.cls = cand ? cand.cls : (opts && opts.cls) || (subjectId != null ? 'contestant' : 'event');
    s.subjectId = subjectId != null && contestantById(subjectId) ? subjectId : null;
    s.otherId = cand && cand.otherId != null && cand.otherId !== s.subjectId ? cand.otherId : null;
    s.otherBeast = null;
    s.otherCheck = clock;
    s.radius = cand ? cand.radius : 10;
    s.t0 = clock;
    s.side = Math.random() < 0.5 ? -1 : 1;
    s.rnd = Math.random();
    s.fallback = !cand;
    s.style = style;
    const t = contestantById(s.subjectId);
    if (t && filmable(t)) {
      entPos(t, s.anchor);
      s.heading = entHeading(t);
      s.speed = t.alive ? entSpeed(t) : 0;
    } else if (cand) {
      s.anchor.copy(cand.pos);
      s.heading = 0;
    } else if (opts && opts.pos) {
      const p = opts.pos;
      s.anchor.set(+p.x || 0, p.y == null ? surfaceY(+p.x || 0, +p.z || 0) : +p.y || 0, +p.z || 0);
      s.heading = 0;
    }
    if (opts && opts.radius) s.radius = opts.radius;
    if (s.subjectId != null && s.otherId == null && s.otherBeast == null &&
        (s.cls === 'fight' || s.cls === 'beast' || s.cls === 'betrayal' || s.cls === 'contestant')) {
      findOther(s, s.cls !== 'contestant');
    }
    s.yaw0 = pickYaw(s);
    s.yawS = s.style === 'track' ? s.heading + Math.PI + s.side * 0.6 : s.style === 'portrait' ? s.heading + s.side * 0.45 : s.yaw0;
    const h = opts && opts.hold ? opts.hold : st.hold[0] + Math.random() * (st.hold[1] - st.hold[0]);
    s.hold = h;
    s.fov = st.fov; s.lp = st.lp; s.ll = st.ll; s.clear = st.clear; s.camNo = st.cam;
    s.label = labelFor(s, cand, !!(opts && opts.forFeed));
  }

  const _S = new V3(), _O = new V3();
  /** Compute the wanted camera position (s.pos) and look target (s.look) for a shot. */
  function computeShot(s, dt) {
    const age = clock - s.t0;
    const t = contestantById(s.subjectId);
    if (t && filmable(t)) {
      entPos(t, s.anchor);
      s.heading = entHeading(t);
      s.speed = t.alive ? entSpeed(t) : 0;
    } else if (s.subjectId == null && s.cand && s.cand.active && s.cand.id === s.candId) {
      s.anchor.lerp(s.cand.pos, kDamp(2, dt));
    }
    const S = _S.copy(s.anchor);
    if (!finiteV(S)) S.set(0, 0, 0);

    let hasO = false;
    if (s.otherId != null) {
      const o = contestantById(s.otherId);
      if (o && filmable(o)) { entPos(o, _O); hasO = true; }
    } else if (s.otherBeast && s.otherBeast.alive && s.otherBeast.pos) {
      const mp = s.otherBeast.pos;
      _O.set(+mp.x || 0, +mp.y || 0, +mp.z || 0);
      hasO = finiteV(_O);
    }
    if (hasO) {
      const dx = _O.x - S.x, dz = _O.z - S.z;
      if (dx * dx + dz * dz > 900) hasO = false;
    }
    if ((s.cls === 'fight' || s.cls === 'beast') && s.subjectId != null && clock - s.otherCheck > 0.7) {
      s.otherCheck = clock;
      if (!hasO) { s.otherId = null; s.otherBeast = null; findOther(s, true); }
    }

    const P = s.pos, L = s.look, h = s.heading;
    switch (s.style) {
      case 'shoulder': {
        let fx, fz;
        if (hasO) { fx = _O.x - S.x; fz = _O.z - S.z; } else { fx = Math.sin(h); fz = Math.cos(h); }
        const l = Math.sqrt(fx * fx + fz * fz);
        if (l < 0.2) { fx = Math.sin(h); fz = Math.cos(h); } else { fx /= l; fz /= l; }
        const yaw = Math.atan2(fx, fz);
        s.yawS = age < 0.02 || dt === 0 ? yaw : U.lerpAngle(s.yawS, yaw, kDamp(2.5, dt));
        fx = Math.sin(s.yawS); fz = Math.cos(s.yawS);
        const d = 5 + s.rnd * 1.6, side = s.side * 1.35;
        // right of the view direction is (-fz, fx)
        P.set(S.x - fx * d - fz * side, S.y + 2.0 + s.rnd * 0.6, S.z - fz * d + fx * side);
        if (hasO) L.set(S.x + (_O.x - S.x) * 0.72, S.y + (_O.y - S.y) * 0.72 + 1.25, S.z + (_O.z - S.z) * 0.72);
        else L.set(S.x + fx * 8, S.y + 1.3, S.z + fz * 8);
        break;
      }
      case 'low': {
        const k = U.smoothstep(0, Math.max(1, s.hold), age);
        const d = 8.5 - 3 * k;
        const yaw = s.yaw0 + s.side * 0.03 * age;
        P.x = S.x + Math.sin(yaw) * d;
        P.z = S.z + Math.cos(yaw) * d;
        P.y = surfaceY(P.x, P.z) + 0.45;
        if (hasO) L.set((S.x + _O.x) * 0.5, Math.max(S.y, _O.y) + 1.5, (S.z + _O.z) * 0.5);
        else L.set(S.x, S.y + 1.55, S.z);
        break;
      }
      case 'wide': {
        const r = U.clamp(34 + s.radius * 1.6, 34, 110);
        const yaw = s.yaw0 + s.side * 0.035 * age;
        P.set(S.x + Math.sin(yaw) * r, S.y + r * 0.5, S.z + Math.cos(yaw) * r);
        L.set(S.x, S.y + 1, S.z);
        break;
      }
      case 'top': {
        const H = U.clamp(38 + s.radius * 2.2, 38, 130);
        const yaw = s.yaw0 + s.side * 0.06 * age;
        P.set(S.x + Math.sin(yaw) * H * 0.2, S.y + H, S.z + Math.cos(yaw) * H * 0.2);
        L.copy(S);
        break;
      }
      case 'orbit': {
        const d = 11 + s.rnd * 4 + Math.min(20, s.radius * 0.4);
        const yaw = s.yaw0 + s.side * 0.2 * age;
        P.set(S.x + Math.sin(yaw) * d, S.y + 4.5 + s.rnd * 3.5, S.z + Math.cos(yaw) * d);
        if (hasO) L.set((S.x + _O.x) * 0.5, (S.y + _O.y) * 0.5 + 1.1, (S.z + _O.z) * 0.5);
        else L.set(S.x, S.y + 1.2, S.z);
        break;
      }
      case 'track': {
        const want = h + Math.PI + s.side * 0.6;
        const moving = s.speed > 0.6;
        s.yawS = age < 0.02 || dt === 0 ? want : U.lerpAngle(s.yawS, want, kDamp(moving ? 1.1 : 0.15, dt));
        const d = 8.5 + s.rnd * 2;
        P.set(S.x + Math.sin(s.yawS) * d, S.y + 3 + s.rnd * 1.2, S.z + Math.cos(s.yawS) * d);
        const lead = moving ? 3.5 : 0.5;
        L.set(S.x + Math.sin(h) * lead, S.y + 1.3, S.z + Math.cos(h) * lead);
        break;
      }
      case 'crane': {
        const k = U.smoothstep(0, Math.max(2, s.hold * 0.95), age);
        const d = 4.5 + 24 * k;
        const yaw = s.yaw0 + s.side * 0.05 * age;
        P.set(S.x + Math.sin(yaw) * d, S.y + 1.1 + 22 * k, S.z + Math.cos(yaw) * d);
        L.set(S.x, S.y + 0.9 - 0.6 * k, S.z);
        break;
      }
      case 'portrait': {
        const want = h + s.side * 0.45;
        s.yawS = age < 0.02 || dt === 0 ? want : U.lerpAngle(s.yawS, want, kDamp(0.8, dt));
        const d = 3.4 + s.rnd * 0.8;
        P.set(S.x + Math.sin(s.yawS) * d, S.y + 1.7, S.z + Math.cos(s.yawS) * d);
        L.set(S.x, S.y + 1.5, S.z);
        break;
      }
      case 'establish': {
        const yaw = s.yaw0 + s.side * 0.03 * age;
        const r = 95 + s.rnd * 20;
        P.set(S.x + Math.sin(yaw) * r, S.y + 50 + s.rnd * 20, S.z + Math.cos(yaw) * r);
        L.set(S.x, S.y + 3, S.z);
        break;
      }
      case 'kickoff': {
        const k = U.smoothstep(0, 6, age);
        const yaw = s.yaw0 + 0.06 * age;
        const r = 34 + 8 * k;
        P.set(S.x + Math.sin(yaw) * r, S.y + 20 + 9 * k, S.z + Math.cos(yaw) * r);
        L.set(S.x, S.y + 1, S.z);
        break;
      }
      case 'victor': {
        const k = U.smoothstep(0, 14, age);
        const yaw = s.yaw0 + 0.14 * age;
        const d = 4 + 7 * k;
        P.set(S.x + Math.sin(yaw) * d, S.y + 1.3 + 4 * k, S.z + Math.cos(yaw) * d);
        L.set(S.x, S.y + 1.45 - 0.3 * k, S.z);
        break;
      }
      default: {
        P.set(S.x + 30, S.y + 18, S.z + 30);
        L.copy(S);
        break;
      }
    }
    if (!finiteV(P) || !finiteV(L)) { P.set(S.x + 20, S.y + 15, S.z + 20); L.copy(S); }
    unocclude(L, P, 1.0);
    keepAbove(P, s.clear);
  }

  // -------------------------------------------------------------- director
  const dir = {
    shot: makeShot(), pin: null, pinUntil: 0, think: -99, fallbackN: 0,
    lastStyles: ['', '', ''], sweepA: 0, pedId: -1, moveUntil: 0,
  };

  function pushStyle(st) {
    dir.lastStyles[2] = dir.lastStyles[1];
    dir.lastStyles[1] = dir.lastStyles[0];
    dir.lastStyles[0] = st;
  }

  function hardCut() { snapNext = true; cutT = 0.35; }

  function sameSubject(c, s) {
    if (!s.active) return false;
    if (s.candId && c.id === s.candId) return true;
    return c.followId != null && c.followId === s.subjectId && c.cls === s.cls;
  }

  function bestCand(exclude) {
    let best = null, bv = 0;
    for (let i = 0; i < CAND_MAX; i++) {
      const c = cands[i];
      if (!candValid(c)) continue;
      if (exclude && sameSubject(c, exclude)) continue;
      const v = candValue(c);
      if (v > bv) { bv = v; best = c; }
    }
    return best;
  }

  function pickFallbackContestant(ex) {
    const ts = GM.state.contestants;
    let best = null, bv = -1;
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      if (!t || !t.alive || !t.pos) continue;
      let v = 1 + Math.random() * 0.8 + (ACTIVE_ACTIONS[t.action] || 0) + Math.min(1.5, (t.kills || 0) * 0.35);
      if (t.maxHealth > 0) v += 0.6 * (1 - U.clamp01(t.health / t.maxHealth));
      if (GM.state.selectedId === t.id) v += 0.8;
      if (recentlyShown(t.id, 45)) v *= 0.35;
      if (t.id === ex) v *= 0.2;
      if (v > bv) { bv = v; best = t; }
    }
    return best;
  }

  const _g0 = new V3(), _g1 = new V3();
  /** Start a new director shot on a candidate (or a fallback when cand is null). */
  function startDirectorShot(cand, breaking) {
    const s = dir.shot;
    const prevStyle = s.active ? s.style : '';
    const prevSubject = s.active ? s.subjectId : null;
    const hadShot = s.active;
    _g0.copy(cur.look).sub(cur.pos);
    if (cand) {
      const subj = cand.followId != null && contestantById(cand.followId) ? cand.followId : null;
      const style = pickStyle(STYLE_W, cand.cls, subj != null, prevStyle, null);
      setupShot(s, cand, subj, style, null);
      cand.shownAt = clock;
    } else {
      dir.fallbackN++;
      const t = dir.fallbackN % 4 === 0 ? null : pickFallbackContestant(prevSubject);
      if (t) {
        const style = pickStyle(STYLE_W, 'contestant', true, prevStyle, null);
        setupShot(s, null, t.id, style, { cls: 'contestant', hold: 9 + Math.random() * 4 });
      } else {
        const gy = groundY(0, 0);
        _g1.set(0, gy, 0);
        setupShot(s, null, null, 'establish', { pos: _g1, cls: 'event', hold: 8 + Math.random() * 3, radius: 30 });
        s.label = label('cam.overview');
      }
    }
    markShown(s.subjectId);
    pushStyle(s.style);
    computeShot(s, 0);
    // Hard cut or smooth camera move?
    _g1.copy(s.look).sub(s.pos);
    const turn = _g0.lengthSq() > 1e-6 && _g1.lengthSq() > 1e-6 ? _g0.angleTo(_g1) : Math.PI;
    const far = cur.pos.distanceTo(s.pos) > 45 || turn > 1.0;
    if (!hadShot || breaking || far || s.cls === 'death' || s.style === 'top' || prevStyle === 'top' || Math.random() < 0.55) {
      hardCut();
      dir.moveUntil = 0;
    } else {
      dir.moveUntil = clock + 2.2;
    }
  }

  function restyleShot() {
    const s = dir.shot;
    const cand = s.cand && s.cand.id === s.candId ? s.cand : null;
    const subj = s.subjectId;
    const style = pickStyle(STYLE_W, s.cls, subj != null, s.style, s.style);
    const lbl = s.label;
    const opts = cand ? null : { cls: s.cls, pos: s.anchor, hold: 8 + Math.random() * 3 };
    setupShot(s, cand, subj, style, opts);
    if (!cand && lbl) s.label = lbl;
    if (cand) cand.shownAt = clock;
    pushStyle(s.style);
    computeShot(s, 0);
    hardCut();   // same subject, new angle: a classic multi-camera cut
  }

  function startCountdown() {
    dir.pin = 'countdown';
    dir.sweepA = Math.random() * TAU;
    dir.pedId = -1;
    dir.shot.active = false;
    curLabel = label('cam.countdown');
    camNo = 9;
    curShot = 'sweep';
    hardCut();
  }

  function startKickoff() {
    const s = dir.shot;
    dir.pin = 'kickoff';
    dir.pinUntil = clock + 6;
    _g1.set(0, groundY(0, 0), 0);
    setupShot(s, null, null, 'kickoff', { pos: _g1, cls: 'event', hold: 6, radius: 30 });
    s.yaw0 = main.position.x * main.position.x + main.position.z * main.position.z > 1
      ? Math.atan2(main.position.x, main.position.z) : Math.random() * TAU;
    s.label = label('cam.kickoff');
    pushStyle('kickoff');
    hardCut();
  }

  function startVictor() {
    const s = dir.shot;
    dir.pin = 'victor';
    const w = contestantById(GM.state.winner);
    if (w) {
      setupShot(s, null, w.id, 'victor', { cls: 'victor', hold: 1e9 });
      s.yaw0 = entHeading(w) + 0.5;
      s.label = label('cam.victor', { name: w.name });
    } else {
      _g1.set(0, groundY(0, 0), 0);
      setupShot(s, null, null, 'establish', { pos: _g1, cls: 'event', hold: 1e9, radius: 30 });
      s.label = label('cam.noVictor');
    }
    hardCut();
  }

  function directorThink() {
    const s = dir.shot;
    const ph = phase();
    if (ph === 'countdown') { if (dir.pin !== 'countdown') startCountdown(); return; }
    if (dir.pin === 'countdown') dir.pin = null;
    if (ph === 'ended') { if (dir.pin !== 'victor' || !s.active) startVictor(); return; }
    if (dir.pin === 'victor') dir.pin = null;
    if (dir.pin === 'kickoff') {
      if (clock < dir.pinUntil && s.active) return;
      dir.pin = null;
    }
    const held = clock - s.t0;
    const curValid = s.active && !!s.cand && s.cand.id === s.candId && candValid(s.cand);
    const curV = !s.active ? -1 : curValid ? candValue(s.cand) * 1.35 : s.fallback ? 1.6 : 0.5;
    const best = bestCand(s);
    const bestV = best ? candValue(best) : 0;
    if (!s.active) { startDirectorShot(best && bestV >= 1.5 ? best : null, false); return; }
    if (held < MIN_HOLD) {
      // Breaking news (a death, a betrayal) may cut in early.
      if (best && best.score >= 9 && best.born > s.t0 - 0.5 && held >= 1.6 && bestV > curV) startDirectorShot(best, true);
      return;
    }
    if (held >= s.hold || held >= MAX_HOLD) {
      if (best && bestV >= 2.5 && (bestV > curV * 0.7 || held >= MAX_HOLD)) startDirectorShot(best, false);
      else if (curValid || (s.fallback && s.subjectId != null && contestantById(s.subjectId) && contestantById(s.subjectId).alive && held < MAX_HOLD)) restyleShot();
      else startDirectorShot(best && bestV >= 1.5 ? best : null, false);
      return;
    }
    if (best && bestV > curV * 1.25 + 0.4) { startDirectorShot(best, false); return; }
    if (!curValid && !s.fallback && held >= MIN_HOLD + 1.5) startDirectorShot(best && bestV >= 1.5 ? best : null, false);
  }

  function countdownPose() {
    const cdLeft = +GM.state.countdown || 0;
    const k = 1 - U.clamp01(cdLeft / (CFG.COUNTDOWN || 10));
    const gy = groundY(0, 0);
    const PR = CFG.PEDESTAL_RADIUS || 18;
    if (k < 0.7) {
      // Slide along the inside of the ring: the contestants face the centre, so we see faces.
      const q = k / 0.7;
      const a = dir.sweepA + q * TAU * 0.5;
      const R = PR - 5.5;
      des.pos.set(Math.sin(a) * R, gy + 2.3 + q * 0.8, Math.cos(a) * R);
      const la = a + 0.2;
      des.look.set(Math.sin(la) * PR, gy + 1.9, Math.cos(la) * PR);
      // Who is on screen?
      const ts = GM.state.contestants;
      let best = null, bd = Infinity;
      for (let i = 0; i < ts.length; i++) {
        const t = ts[i];
        if (!t || !t.pos) continue;
        const dx = t.pos.x - des.look.x, dz = t.pos.z - des.look.z;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = t; }
      }
      if (best && best.id !== dir.pedId) {
        dir.pedId = best.id;
        curLabel = label('cam.pedestal', { name: best.name, team: best.team });
      }
    } else {
      const q = (k - 0.7) / 0.3;
      const e = q * q * (3 - 2 * q);
      const a = dir.sweepA + TAU * 0.5 + q * 0.4;
      const R = 22 + 30 * e;
      des.pos.set(Math.sin(a) * R, gy + 4 + 32 * e, Math.cos(a) * R);
      des.look.set(0, gy + 1.5, 0);
      if (dir.pedId !== -2) { dir.pedId = -2; curLabel = label('cam.countdown'); }
    }
    keepAbove(des.pos, 0.8);
    des.fov = 50;
    lamPos = 3.2; lamLook = 3.2;
    camNo = 9;
    curShot = 'sweep';
    focusPoint.set(des.look.x, gy, des.look.z);
  }

  function updateDirector(dt) {
    if (clock - dir.think > 0.2 || (!dir.shot.active && dir.pin !== 'countdown')) {
      dir.think = clock;
      directorThink();
    }
    if (dir.pin === 'countdown') { countdownPose(); return; }
    const s = dir.shot;
    if (!s.active) { startDirectorShot(null, false); }
    computeShot(s, dt);
    des.pos.copy(s.pos);
    des.look.copy(s.look);
    des.fov = s.fov;
    const moving = clock < dir.moveUntil;
    lamPos = moving ? 1.6 : s.lp;
    lamLook = moving ? 2.0 : s.ll;
    camNo = s.camNo;
    curLabel = s.label;
    curShot = s.style;
    focusPoint.copy(s.anchor);
  }

  // ----------------------------------------------------------------- feeds
  const feeds = [];
  for (let i = 0; i < FEED_COUNT; i++) {
    const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.3, 900);
    cam.position.set(40, 30, 40);
    cam.lookAt(0, 0, 0);
    feeds.push({
      camera: cam, label: null, followId: null, interestId: null,
      camName: CAM_NAMES[11 + i], cut: false,
      shot: makeShot(), cur: { pos: new V3(40, 30, 40), look: new V3(), fov: 50 },
      snap: true, cutT: 0, landmark: i,
    });
  }
  let feedRot = 0;
  let feedsThink = -99;
  let landmarks = null;

  /** Contestant id shown by the main camera right now (or null). */
  function mainSubject() {
    if (mode === 'follow') return fol.id;
    if (mode === 'director' && dir.shot.active && dir.pin !== 'countdown') return dir.shot.subjectId;
    return null;
  }
  function mainCandId() { return mode === 'director' && dir.shot.active ? dir.shot.candId : 0; }

  function feedUsesCand(c, except) {
    for (let j = 0; j < FEED_COUNT; j++) {
      if (j === except) continue;
      const s = feeds[j].shot;
      if (!s.active) continue;
      if (s.candId && s.candId === c.id) return true;
      if (c.followId != null && s.subjectId === c.followId) return true;
    }
    return false;
  }
  function feedUsesContestant(id, except) {
    for (let j = 0; j < FEED_COUNT; j++) {
      if (j === except) continue;
      const s = feeds[j].shot;
      if (s.active && s.subjectId === id) return true;
    }
    return false;
  }

  function feedShotValid(s) {
    if (!s.active) return false;
    if (s.candId) {
      if (s.cand && s.cand.id === s.candId && candValid(s.cand)) return true;
      return clock - s.t0 < FEED_MIN;
    }
    if (s.subjectId != null) {
      const t = contestantById(s.subjectId);
      if (!t || !filmable(t)) return false;
      if (!t.alive && clock - s.t0 > 3) return false;
      return true;
    }
    return true;
  }

  function landmarkList() {
    if (landmarks) return landmarks;
    const out = [];
    out.push({ x: 0, y: groundY(0, 0), z: 0, key: 'cam.nexus', r: 14 });
    const lm = GM.Terrain && GM.Terrain.landmarks;
    const addAll = (arr, key, r) => {
      if (!Array.isArray(arr)) return;
      for (let i = 0; i < arr.length && i < 4; i++) {
        const p = arr[i];
        if (!p || !(+p.x === +p.x) || !(+p.z === +p.z)) continue;
        out.push({ x: +p.x, y: surfaceY(+p.x, +p.z), z: +p.z, key, r: r || Math.min(40, +p.r || 20) });
      }
    };
    if (lm) {
      addAll(lm.lakes, 'cam.lake', 0);
      addAll(lm.hills, 'cam.hill', 18);
      addAll(lm.caves, 'cam.cave', 8);
    }
    landmarks = out;
    return out;
  }

  function startFeedShot(f, cand) {
    const subj = cand.followId != null && contestantById(cand.followId) ? cand.followId : null;
    const style = pickStyle(FEED_W, cand.cls, subj != null, f.shot.active ? f.shot.style : '', null);
    setupShot(f.shot, cand, subj, style, { forFeed: true, hold: FEED_MAX });
    f.snap = true;
  }

  function startFeedRotation(f, i, mSub) {
    const ts = GM.state.contestants;
    const n = ts ? ts.length : 0;
    const countdown = phase() === 'countdown';
    for (let k = 0; k < n; k++) {
      feedRot = (feedRot + 1) % n;
      const t = ts[feedRot];
      if (!t || !t.alive || !t.pos) continue;
      if (t.id === mSub || feedUsesContestant(t.id, i)) continue;
      const style = countdown ? 'portrait' : pickStyle(FEED_W, 'contestant', true, f.shot.active ? f.shot.style : '', null);
      setupShot(f.shot, null, t.id, style, { cls: 'contestant', forFeed: true, hold: countdown ? 3.2 : FEED_MAX });
      f.snap = true;
      return;
    }
    // Nobody left to show (setup screen, or everyone is taken): film the arena itself.
    const list = landmarkList();
    f.landmark = (f.landmark + 1) % list.length;
    const lm = list[(f.landmark + i) % list.length];
    _g1.set(lm.x, lm.y, lm.z);
    setupShot(f.shot, null, null, i === 1 ? 'wide' : 'orbit', { pos: _g1, cls: 'event', hold: FEED_MAX, radius: lm.r, forFeed: true });
    f.shot.label = label(lm.key);
    f.snap = true;
  }

  function feedThink(i) {
    const f = feeds[i], s = f.shot;
    const held = clock - s.t0;
    const mSub = mainSubject(), mCand = mainCandId();
    const dupMain = s.active && ((s.candId && s.candId === mCand) || (s.subjectId != null && s.subjectId === mSub));
    const valid = feedShotValid(s);
    if (valid && !dupMain && held < Math.min(FEED_MIN, s.hold)) return;
    let best = null, bv = 0;
    if (inGame()) {
      for (let k = 0; k < CAND_MAX; k++) {
        const c = cands[k];
        if (!candValid(c) || c.id === mCand) continue;
        if (c.followId != null && c.followId === mSub) continue;
        if (feedUsesCand(c, i)) continue;
        const v = candValue(c);
        if (v > bv) { bv = v; best = c; }
      }
    }
    const curV = valid && s.candId && s.cand ? candValue(s.cand) : valid ? 1.5 : 0;
    if (valid && !dupMain && held < s.hold && !(best && bv > curV * 1.6 + 0.5)) return;
    if (best && bv >= 2.5 && !(s.active && best.id === s.candId)) { startFeedShot(f, best); return; }
    if (valid && !dupMain && held < s.hold) return;
    startFeedRotation(f, i, mSub);
  }

  function updateFeeds(dt) {
    if (!feedsEnabled()) return;
    const think = clock - feedsThink > 0.4;
    if (think) feedsThink = clock;
    for (let i = 0; i < FEED_COUNT; i++) {
      const f = feeds[i];
      if (!slotVis[i] && f.shot.active) continue;   // hidden: no work (first shot is still prepared)
      if (think || !f.shot.active) feedThink(i);
      prepareFeed(f, dt);
    }
  }

  function prepareFeed(f, dt) {
    const s = f.shot;
    if (!s.active) return;
    computeShot(s, dt);
    const c = f.cur;
    if (f.snap || !finiteV(c.pos)) {
      c.pos.copy(s.pos); c.look.copy(s.look); c.fov = s.fov;
      f.snap = false;
      f.cutT = 0.3;
    } else {
      c.pos.lerp(s.pos, kDamp(s.lp, dt));
      c.look.lerp(s.look, kDamp(s.ll, dt));
      c.fov = U.damp(c.fov, s.fov, 3, dt);
    }
    keepAbove(c.pos, 0.25);
    const cam = f.camera;
    cam.position.copy(c.pos);
    _h.copy(c.look);
    if (Math.abs(_h.x - c.pos.x) < 1e-3 && Math.abs(_h.z - c.pos.z) < 1e-3) _h.z -= 0.01;
    cam.lookAt(_h);
    const far = lowQuality() ? 320 : 900;
    if (Math.abs(cam.fov - c.fov) > 0.01 || cam.far !== far) { cam.fov = c.fov; cam.far = far; cam.updateProjectionMatrix(); }
    f.label = s.label;
    f.followId = s.subjectId;
    f.interestId = s.cand && s.cand.id === s.candId && s.cand.iid ? s.cand.iid : null;
    if (f.cutT > 0) f.cutT -= dt;
    f.cut = f.cutT > 0;
  }

  // ------------------------------------------------------------ free camera
  function fwd3(out) {
    const cp = Math.cos(free.pitch);
    return out.set(Math.sin(free.yaw) * cp, Math.sin(free.pitch), Math.cos(free.yaw) * cp);
  }
  function initFreeFromCurrent() {
    free.pos.copy(cur.pos);
    free.vel.set(0, 0, 0);
    free.dolly = 0;
    free.fly.on = false;
    _a.copy(cur.look).sub(cur.pos);
    const l = _a.length();
    if (l > 1e-4) {
      free.yaw = Math.atan2(_a.x, _a.z);
      free.pitch = U.clamp(Math.asin(U.clamp(_a.y / l, -1, 1)), -1.5, 1.2);
    }
  }
  function anyMoveKey() {
    return !!(keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD || keys.KeyQ || keys.KeyE ||
      keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight);
  }
  function updateFree(dt) {
    const fl = free.fly;
    if (fl.on && anyMoveKey()) fl.on = false;
    if (fl.on) {
      fl.t += dt;
      const k = U.clamp01(fl.t / fl.dur);
      const e = k * k * (3 - 2 * k);
      free.pos.lerpVectors(fl.from, fl.to, e);
      free.pos.y += Math.sin(k * Math.PI) * fl.arc;
      free.yaw = fl.yaw0 + U.angleDiff(fl.yaw0, fl.yaw1) * e;
      free.pitch = fl.pitch0 + (fl.pitch1 - fl.pitch0) * e;
      free.vel.set(0, 0, 0);
      if (k >= 1) fl.on = false;
    } else {
      const g = surfaceY(free.pos.x, free.pos.z);
      const alt = Math.max(0, free.pos.y - g);
      let sp = U.clamp(12 + alt * 0.55, 10, 110);
      if (shiftDown) sp *= 3;
      const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
      const r = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
      const u = (keys.KeyE ? 1 : 0) - (keys.KeyQ ? 1 : 0);
      const sy = Math.sin(free.yaw), cy = Math.cos(free.yaw);
      // horizontal forward (sy, cy); screen right (-cy, sy)
      _a.set(sy * f - cy * r, 0, cy * f + sy * r);
      const len = _a.length();
      if (len > 1) _a.multiplyScalar(1 / len);
      _a.multiplyScalar(sp);
      _a.y = u * sp * 0.6;
      free.vel.lerp(_a, kDamp(f || r || u ? 5 : 7, dt));
      free.pos.addScaledVector(free.vel, dt);
      if (free.dolly !== 0) {
        const step = free.dolly * kDamp(7, dt);
        free.dolly -= step;
        if (Math.abs(free.dolly) < 0.01) free.dolly = 0;
        free.pos.addScaledVector(fwd3(_b), step);
      }
    }
    const before = free.pos.y;
    keepAbove(free.pos, 1.5);
    if (free.pos.y > before && free.vel.y < 0) free.vel.y = 0;
    des.pos.copy(free.pos);
    fwd3(_b);
    des.look.copy(free.pos).addScaledVector(_b, 10);
    des.fov = 55;
    lamPos = 50; lamLook = 50;
    // Focus: where the view meets the ground.
    let d = 40;
    if (_b.y < -0.05) d = U.clamp((free.pos.y - surfaceY(free.pos.x, free.pos.z)) / -_b.y, 4, 90);
    focusPoint.copy(free.pos).addScaledVector(_b, d);
    clampXZ(focusPoint, HALF);
    focusPoint.y = groundY(focusPoint.x, focusPoint.z);
    camNo = 1;
    curShot = 'free';
    curLabel = MODE_LABELS.free;
  }

  /** Smooth flight of the free camera to look at (x, z). */
  function flyTo(x, z, y, dur) {
    if (mode !== 'free') setMode('free');
    if (mode !== 'free') return;
    x = U.clamp(x, -LIMIT, LIMIT);
    z = U.clamp(z, -LIMIT, LIMIT);
    const ty = y != null && +y === +y ? +y : surfaceY(x, z);
    const fl = free.fly;
    fl.from.copy(free.pos);
    const dx = x - free.pos.x, dz = z - free.pos.z;
    const hd = Math.sqrt(dx * dx + dz * dz);
    const yaw = hd > 4 ? Math.atan2(dx, dz) : free.yaw;
    const back = 30, up = 22;
    fl.to.set(x - Math.sin(yaw) * back, ty + up, z - Math.cos(yaw) * back);
    keepAbove(fl.to, 3);
    _a.set(x, ty + 1, z);
    unocclude(_a, fl.to, 1.5);
    keepAbove(fl.to, 3);
    fl.yaw0 = free.yaw;
    fl.yaw1 = yaw;
    fl.pitch0 = free.pitch;
    const hx = fl.to.x - x, hz = fl.to.z - z;
    fl.pitch1 = U.clamp(-Math.atan2(fl.to.y - (ty + 1), Math.sqrt(hx * hx + hz * hz) || 1), -1.5, 1.2);
    const travel = fl.from.distanceTo(fl.to);
    fl.dur = dur || U.clamp(0.7 + travel / 220, 0.8, 2.2);
    fl.arc = Math.min(45, travel * 0.12);
    fl.t = 0;
    fl.on = travel > 0.5;
    free.vel.set(0, 0, 0);
    free.dolly = 0;
  }

  // ---------------------------------------------------------- follow camera
  function initFollowFromCurrent() {
    const t = contestantById(fol.id);
    if (!t) return;
    entPos(t, _a);
    fol.tgt.set(_a.x, _a.y + 1.2, _a.z);
    const dx = cur.pos.x - _a.x, dz = cur.pos.z - _a.z, dy = cur.pos.y - _a.y;
    const hd = Math.sqrt(dx * dx + dz * dz);
    const d3 = Math.sqrt(hd * hd + dy * dy);
    if (d3 > 40 || d3 < 1) {
      fol.yaw = entHeading(t) + Math.PI;
      fol.dist = 11;
      fol.pitch = 0.38;
    } else {
      fol.yaw = hd > 0.5 ? Math.atan2(dx, dz) : entHeading(t) + Math.PI;
      fol.dist = U.clamp(d3, 5, 26);
      fol.pitch = U.clamp(Math.atan2(dy, hd), 0.12, 1.1);
    }
    fol.userT = -99;
    fol.labelId = -1;
  }
  function updateFollow(dt) {
    const t = contestantById(fol.id);
    if (!t) { setMode(inGame() ? 'director' : 'showcase'); return; }
    const kr = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    const kf = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    const ku = (keys.KeyE ? 1 : 0) - (keys.KeyQ ? 1 : 0);
    if (kr || kf || ku) {
      fol.userT = clock;
      const m = shiftDown ? 2.5 : 1;
      fol.yaw -= kr * 1.6 * m * dt;
      fol.dist = U.clamp(fol.dist * Math.exp(-kf * 1.2 * m * dt), 2.5, 90);
      fol.pitch = U.clamp(fol.pitch + ku * 0.9 * dt, 0.02, 1.45);
    }
    entPos(t, _a);
    if (t.alive && entSpeed(t) > 0.7 && clock - fol.userT > 2.5) {
      fol.yaw = U.lerpAngle(fol.yaw, entHeading(t) + Math.PI, kDamp(0.55, dt));   // drift behind
    }
    _a.y += t.alive ? 1.2 : 0.4;
    const jump = distSq3(fol.tgt, _a);
    fol.tgt.lerp(_a, kDamp(jump > 400 ? 2.5 : 9, dt));
    if (!finiteV(fol.tgt)) fol.tgt.copy(_a);
    const cp = Math.cos(fol.pitch), sp = Math.sin(fol.pitch);
    des.pos.set(
      fol.tgt.x + Math.sin(fol.yaw) * cp * fol.dist,
      fol.tgt.y + sp * fol.dist,
      fol.tgt.z + Math.cos(fol.yaw) * cp * fol.dist
    );
    unocclude(fol.tgt, des.pos, 0.8);
    keepAbove(des.pos, 0.7);
    des.look.copy(fol.tgt);
    des.fov = 55;
    lamPos = 10; lamLook = 14;
    focusPoint.set(_a.x, _a.y - (t.alive ? 1.2 : 0.4), _a.z);
    camNo = 2;
    curShot = 'follow';
    if (fol.labelId !== t.id || fol.labelAlive !== !!t.alive) {
      fol.labelId = t.id;
      fol.labelAlive = !!t.alive;
      curLabel = t.alive ? label('cam.following', { name: t.name }) : label('cam.followDead', { name: t.name });
    }
  }

  // -------------------------------------------------------- overhead camera
  function worldPerPixel() {
    const h = Math.max(10, ovh.h);
    return (2 * h * Math.tan((main.fov * Math.PI) / 360)) / Math.max(1, vp.height);
  }
  function updateOverhead(dt) {
    const kx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    const kz = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
    const kh = (keys.KeyE ? 1 : 0) - (keys.KeyQ ? 1 : 0);
    if (kx || kz) ovh.goalOn = false;
    const sp = ovh.h * 0.9 * (shiftDown ? 2.5 : 1);
    _a.set(kx * sp, 0, kz * sp);
    ovh.vel.lerp(_a, kDamp(6, dt));
    ovh.c.addScaledVector(ovh.vel, dt);
    if (kh) ovh.hGoal = U.clamp(ovh.hGoal * Math.exp(kh * 1.2 * dt), 30, 330);
    if (ovh.goalOn) {
      ovh.c.x = U.damp(ovh.c.x, ovh.goal.x, 5, dt);
      ovh.c.z = U.damp(ovh.c.z, ovh.goal.z, 5, dt);
      if (Math.abs(ovh.c.x - ovh.goal.x) < 0.3 && Math.abs(ovh.c.z - ovh.goal.z) < 0.3) ovh.goalOn = false;
    }
    clampXZ(ovh.c, LIMIT - 10);
    ovh.h = U.damp(ovh.h, ovh.hGoal, 6, dt);
    ovh.gy = U.damp(ovh.gy, surfaceY(ovh.c.x, ovh.c.z), 3, dt);
    des.pos.set(ovh.c.x, ovh.gy + ovh.h, ovh.c.z + ovh.h * 0.14);
    des.look.set(ovh.c.x, ovh.gy, ovh.c.z);
    des.fov = 50;
    lamPos = 12; lamLook = 12;
    focusPoint.set(ovh.c.x, ovh.gy, ovh.c.z);
    camNo = 7;
    curShot = 'overhead';
    curLabel = MODE_LABELS.overhead;
  }

  // -------------------------------------------------------- showcase camera
  function updateShowcase(dt) {
    show.t += dt;
    show.zoom = U.damp(show.zoom, show.zoomGoal, 3, dt);
    const t = show.t;
    const a = show.a + t * 0.045 + show.user;
    const R = (116 + 26 * Math.sin(t * 0.051)) * show.zoom;
    const H = (52 + 30 * Math.sin(t * 0.083 + 1.1) + 10 * Math.sin(t * 0.029)) * (0.55 + 0.45 * show.zoom);
    const gy = groundY(0, 0);
    des.pos.set(Math.sin(a) * R, gy + H, Math.cos(a) * R);
    des.look.set(Math.sin(t * 0.037) * 20, gy + 3 + 4 * Math.sin(t * 0.05), Math.cos(t * 0.029) * 20);
    unocclude(des.look, des.pos, 4);
    keepAbove(des.pos, 10);
    des.fov = 55;
    lamPos = 1.4; lamLook = 1.4;
    focusPoint.set(des.look.x, groundY(des.look.x, des.look.z), des.look.z);
    camNo = 1;
    curShot = 'showcase';
    curLabel = MODE_LABELS.showcase;
  }

  // ----------------------------------------------------------- mode switch
  const MODE_LABELS = {}, MODE_SHORT = {}, HINTS = {};
  for (const m in MODES) {
    MODE_LABELS[m] = label('cam.mode.' + m);
    MODE_SHORT[m] = label('cam.modeShort.' + m);
    HINTS[m] = label('cam.hint.' + m);
  }

  function nearestContestantTo(p) {
    const ts = GM.state.contestants;
    let best = null, bd = Infinity;
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      if (!t || !t.alive || !t.pos) continue;
      const d = U.distSqXZ(t.pos, p);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  /** Best contestant to follow: selected, current follow, director subject, nearest to view. */
  function followCandidate() {
    let id = GM.state.selectedId;
    if (id == null || !contestantById(id)) id = null;
    if (id == null && fol.id != null && contestantById(fol.id)) id = fol.id;
    if (id == null && mode === 'director' && dir.shot.active && dir.shot.subjectId != null) id = dir.shot.subjectId;
    if (id == null) { const t = nearestContestantTo(focusPoint); if (t) id = t.id; }
    return id;
  }

  function setMode(m) {
    if (!MODES[m]) return false;
    const game = inGame();
    if (!game && (m === 'director' || m === 'follow')) m = 'showcase';
    if (game && m === 'showcase') m = 'director';
    if (m === 'follow') {
      if (fol.id == null || !contestantById(fol.id)) fol.id = followCandidate();
      if (fol.id == null) return false;
      initFollowFromCurrent();
    }
    if (m === mode) return true;
    const prev = mode;
    mode = m;
    Cameras.mode = m;
    switch (m) {
      case 'free':
        initFreeFromCurrent();
        break;
      case 'overhead':
        ovh.c.set(focusPoint.x, 0, focusPoint.z);
        clampXZ(ovh.c, LIMIT - 10);
        ovh.gy = surfaceY(ovh.c.x, ovh.c.z);
        ovh.h = ovh.hGoal = U.clamp(cur.pos.y - ovh.gy + 60, 110, 230);
        ovh.vel.set(0, 0, 0);
        ovh.goalOn = false;
        break;
      case 'director':
        dir.shot.active = false;
        dir.think = -99;
        if (phase() === 'countdown') startCountdown();
        else if (phase() === 'ended') startVictor();
        break;
      case 'showcase':
        show.a = Math.atan2(cur.pos.x, cur.pos.z) - show.t * 0.045 - show.user;
        break;
      default: break;
    }
    modeBlend = m === 'free' || m === 'director' ? 0 : 0.9;
    free.fly.on = m === 'free' ? free.fly.on : false;
    GM.emit('camera:mode', { mode: m, prev });
    return true;
  }

  function takeOver() {
    if (mode === 'director') setMode('free');
  }

  function runMode(dt) {
    switch (mode) {
      case 'free': updateFree(dt); break;
      case 'follow': updateFollow(dt); break;
      case 'director': updateDirector(dt); break;
      case 'overhead': updateOverhead(dt); break;
      default: updateShowcase(dt); break;
    }
  }

  // --------------------------------------------------------- apply to camera
  function applyMain(dt) {
    let lp = lamPos, ll = lamLook;
    if (modeBlend > 0) { modeBlend -= dt; lp = Math.min(lp, 3.2); ll = Math.min(ll, 4); }
    if (snapNext || !finiteV(cur.pos) || !finiteV(cur.look)) {
      cur.pos.copy(des.pos);
      cur.look.copy(des.look);
      cur.fov = des.fov;
      snapNext = false;
    } else {
      cur.pos.lerp(des.pos, kDamp(lp, dt));
      cur.look.lerp(des.look, kDamp(ll, dt));
      cur.fov = U.damp(cur.fov, des.fov, 3, dt);
    }
    if (!finiteV(cur.pos)) cur.pos.set(120, 70, 120);
    if (!finiteV(cur.look)) cur.look.set(0, 4, 0);
    if (!(cur.fov > 10 && cur.fov < 120)) cur.fov = 55;
    keepAbove(cur.pos, 0.25);
    main.position.copy(cur.pos);
    _c.copy(cur.look);
    if (shk.t > 0) {
      shk.t -= dt;
      const k = U.clamp01(shk.t / shk.dur);
      const a = shk.amp * Math.min(1, k * 2.2) * (reducedMotion ? 0.3 : 1);
      const n1 = Math.sin(clock * 37.3) * 0.6 + Math.sin(clock * 23.1 + 1.7) * 0.4;
      const n2 = Math.sin(clock * 41.9 + 0.4) * 0.6 + Math.sin(clock * 17.7 + 2.9) * 0.4;
      const n3 = Math.sin(clock * 29.1 + 5.1) * 0.6 + Math.sin(clock * 13.3 + 0.9) * 0.4;
      const dist = Math.min(80, cur.pos.distanceTo(cur.look));
      const ang = a * 0.03 * dist;
      main.position.x += n1 * a * 0.18;
      main.position.y += n2 * a * 0.12;
      main.position.z += n3 * a * 0.18;
      _c.x += n2 * ang;
      _c.y += n1 * ang * 0.8;
      _c.z += n3 * ang;
      if (shk.t <= 0) { shk.t = 0; shk.amp = 0; }
    }
    if (Math.abs(_c.x - main.position.x) < 1e-3 && Math.abs(_c.z - main.position.z) < 1e-3) _c.z -= 0.01;
    main.lookAt(_c);
    if (Math.abs(main.fov - cur.fov) > 0.01) { main.fov = cur.fov; main.updateProjectionMatrix(); }
    main.updateMatrixWorld();
  }

  // ------------------------------------------------------------------ input
  const MOVE_CODES = {
    KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, KeyQ: 1, KeyE: 1,
    ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1,
  };
  const KEY_FALLBACK = {
    w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD', q: 'KeyQ', e: 'KeyE', c: 'KeyC', f: 'KeyF',
    '1': 'Digit1', '2': 'Digit2', '3': 'Digit3', '4': 'Digit4',
    ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Shift: 'ShiftLeft',
  };
  function codeOf(e) {
    if (e.code) return e.code;
    const k = e.key || '';
    return KEY_FALLBACK[k] || KEY_FALLBACK[k.toLowerCase()] || '';
  }
  function isTyping() {
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
  }
  function clearKeys() {
    for (const k in keys) keys[k] = false;
    shiftDown = false;
  }

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping()) return;
    const code = codeOf(e);
    if (code === 'ShiftLeft' || code === 'ShiftRight') { shiftDown = true; return; }
    if (MOVE_CODES[code]) {
      shiftDown = !!e.shiftKey;
      if (code.indexOf('Arrow') === 0) e.preventDefault();
      if (mode === 'showcase') return;            // the preview is not steerable by keys
      keys[code] = true;
      if (mode === 'director') takeOver();
      if (mode === 'free') free.fly.on = false;
      return;
    }
    if (e.repeat) return;
    switch (code) {
      case 'Digit1': case 'Numpad1': setMode('free'); break;
      case 'Digit2': case 'Numpad2': followBest(); break;
      case 'Digit3': case 'Numpad3': setMode('director'); break;
      case 'Digit4': case 'Numpad4': setMode('overhead'); break;
      case 'KeyC': Cameras.cycleMode(); break;
      case 'KeyF': followBest(); break;
      default: return;
    }
  }
  function onKeyUp(e) {
    const code = codeOf(e);
    if (code === 'ShiftLeft' || code === 'ShiftRight') { shiftDown = false; return; }
    if (MOVE_CODES[code]) keys[code] = false;
    if (!e.shiftKey) shiftDown = false;
  }

  function followBest() {
    if (!inGame()) return false;
    const id = followCandidate();
    return id != null ? Cameras.follow(id) : false;
  }

  function onPointerDown(e) {
    if (ptr.down) return;
    ptr.down = true;
    ptr.id = e.pointerId;
    ptr.button = e.button;
    ptr.x0 = ptr.x = e.clientX;
    ptr.y0 = ptr.y = e.clientY;
    ptr.drag = false;
    try { if (canvasEl && canvasEl.setPointerCapture) canvasEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (e.button === 1) e.preventDefault();   // no middle-click auto scroll
  }
  function onPointerMove(e) {
    if (ptr.down && e.pointerId === ptr.id) {
      const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
      ptr.x = e.clientX;
      ptr.y = e.clientY;
      if (!ptr.drag) {
        const tx = e.clientX - ptr.x0, ty = e.clientY - ptr.y0;
        if (tx * tx + ty * ty < DRAG_PX * DRAG_PX) return;
        ptr.drag = true;
      }
      onDrag(dx, dy);
      return;
    }
    if (e.target === canvasEl) {
      hover.pending = true;
      hover.x = e.clientX;
      hover.y = e.clientY;
    }
  }
  function onPointerUp(e) {
    if (!ptr.down || e.pointerId !== ptr.id) return;
    ptr.down = false;
    try { if (canvasEl && canvasEl.releasePointerCapture) canvasEl.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (ptr.drag) { ptr.drag = false; return; }
    if (e.type === 'pointercancel') return;
    emitClick(e.clientX, e.clientY, ptr.button);
  }

  function onDrag(dx, dy) {
    switch (mode) {
      case 'director':
        takeOver();
        free.yaw -= dx * 0.0042;
        free.pitch = U.clamp(free.pitch - dy * 0.0042, -1.5, 1.2);
        break;
      case 'free':
        free.fly.on = false;
        free.yaw -= dx * 0.0042;
        free.pitch = U.clamp(free.pitch - dy * 0.0042, -1.5, 1.2);
        break;
      case 'follow':
        fol.yaw -= dx * 0.0065;
        fol.pitch = U.clamp(fol.pitch + dy * 0.005, 0.02, 1.45);
        fol.userT = clock;
        break;
      case 'overhead': {
        const wpp = worldPerPixel();
        ovh.c.x -= dx * wpp;
        ovh.c.z -= dy * wpp;
        ovh.goalOn = false;
        ovh.vel.set(0, 0, 0);
        clampXZ(ovh.c, LIMIT - 10);
        break;
      }
      default:
        show.user -= dx * 0.004;
        break;
    }
  }

  function onWheel(e) {
    e.preventDefault();
    let d = +e.deltaY || 0;
    if (e.deltaMode === 1) d *= 16;
    else if (e.deltaMode === 2) d *= 400;
    d = U.clamp(d, -400, 400);
    if (!d) return;
    switch (mode) {
      case 'director':
      case 'free': {
        takeOver();
        free.fly.on = false;
        const alt = Math.max(0, free.pos.y - surfaceY(free.pos.x, free.pos.z));
        free.dolly += -d * 0.05 * (1 + alt / 25);
        break;
      }
      case 'follow':
        fol.dist = U.clamp(fol.dist * Math.exp(d * 0.0012), 2.5, 90);
        fol.userT = clock;
        break;
      case 'overhead':
        ovh.hGoal = U.clamp(ovh.hGoal * Math.exp(d * 0.0012), 30, 330);
        break;
      default:
        show.zoomGoal = U.clamp(show.zoomGoal * Math.exp(d * 0.0008), 0.45, 1.35);
        break;
    }
  }

  function emitClick(cx, cy, button) {
    let point = null, trib = null;
    try { point = Cameras.pickGround(cx, cy); } catch (err) { GM.reportError('Cameras.pickGround', err); }
    try { trib = Cameras.pickContestant(cx, cy); } catch (err) { GM.reportError('Cameras.pickContestant', err); }
    GM.emit('canvas:click', { clientX: cx, clientY: cy, button, point, contestant: trib });
  }

  function processHover() {
    if (!hover.pending || ptr.drag || clock - hover.last < 0.045) return;
    hover.pending = false;
    hover.last = clock;
    let point = null;
    try { point = Cameras.pickGround(hover.x, hover.y); } catch (err) { GM.reportError('Cameras.hover', err); }
    GM.emit('canvas:hover', { clientX: hover.x, clientY: hover.y, point });
  }

  // ---------------------------------------------------------------- picking
  function rayFromClient(cx, cy) {
    const w = vp.width > 0 ? vp.width : window.innerWidth || 1;
    const h = vp.height > 0 ? vp.height : window.innerHeight || 1;
    _ndc.set(((cx - vp.left) / w) * 2 - 1, -((cy - vp.top) / h) * 2 + 1);
    main.updateMatrixWorld();
    _ray.setFromCamera(_ndc, main);
    return _ray.ray;
  }

  /** Ray vs vertical cylinder (x, z, yBottom..yTop, radius). Returns entry distance or -1. */
  function rayCyl(o, d, cx, cz, yb, yt, r) {
    const ax = o.x - cx, az = o.z - cz;
    const A = d.x * d.x + d.z * d.z;
    const B = 2 * (ax * d.x + az * d.z);
    const C = ax * ax + az * az - r * r;
    let t0, t1;
    if (A < 1e-9) {
      if (C > 0) return -1;
      t0 = 0; t1 = 1e9;
    } else {
      const disc = B * B - 4 * A * C;
      if (disc < 0) return -1;
      const sq = Math.sqrt(disc);
      t0 = (-B - sq) / (2 * A);
      t1 = (-B + sq) / (2 * A);
    }
    if (Math.abs(d.y) < 1e-9) {
      if (o.y < yb || o.y > yt) return -1;
    } else {
      let ta = (yb - o.y) / d.y, tb = (yt - o.y) / d.y;
      if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
    }
    if (t0 < 0) t0 = 0;
    return t1 < t0 ? -1 : t0;
  }

  /** Terrain point under a screen position (client CSS px) or null. */
  Cameras.pickGround = function (clientX, clientY) {
    const ray = rayFromClient(+clientX || 0, +clientY || 0);
    const T = GM.Terrain;
    if (T && typeof T.raycast === 'function') {
      let hit = null;
      try { hit = T.raycast(ray.origin, ray.direction, 2000); } catch (err) { GM.reportError('Cameras.raycast', err); hit = undefined; }
      if (hit && +hit.x === +hit.x && +hit.z === +hit.z) return new V3(+hit.x, +hit.y || 0, +hit.z);
      if (hit === null) return null;
    }
    const W = GM.World;
    if (W && W.terrainMesh) {
      _hits.length = 0;
      try { _ray.intersectObject(W.terrainMesh, false, _hits); } catch (err) { _hits.length = 0; }
      if (_hits.length) {
        const p = _hits[0].point;
        _hits.length = 0;
        return new V3(p.x, p.y, p.z);
      }
      return null;
    }
    // No terrain at all: the y = 0 plane.
    if (Math.abs(ray.direction.y) > 1e-6) {
      const t = -ray.origin.y / ray.direction.y;
      if (t > 0) {
        const p = new V3().copy(ray.origin).addScaledVector(ray.direction, t);
        if (Math.abs(p.x) <= HALF && Math.abs(p.z) <= HALF) return p;
      }
    }
    return null;
  };

  /** Contestant under a screen position (living first, then bodies) or null. */
  Cameras.pickContestant = function (clientX, clientY) {
    const ts = GM.state.contestants;
    if (!ts || !ts.length) return null;
    const ray = rayFromClient(+clientX || 0, +clientY || 0);
    const o = ray.origin, d = ray.direction;
    let groundT = Infinity;
    const T = GM.Terrain;
    if (T && typeof T.raycast === 'function') {
      try {
        const h = T.raycast(o, d, 2000);
        if (h && +h.x === +h.x) {
          const dx = h.x - o.x, dy = h.y - o.y, dz = h.z - o.z;
          groundT = Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
      } catch (err) { groundT = Infinity; }
    }
    let best = null, bestScore = Infinity;
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      if (!t || !t.pos) continue;
      if (!t.alive && !filmable(t)) continue;
      entPos(t, _e);
      const dx = _e.x - o.x, dy = _e.y - o.y, dz = _e.z - o.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const r = 0.85 + dist * 0.012;          // generous: far contestants stay clickable
      const ri = 0.45 + dist * 0.004;         // a direct hit on the body
      let hit, inner;
      if (t.alive) {
        hit = rayCyl(o, d, _e.x, _e.z, _e.y - 0.1, _e.y + 1.9 + r * 0.3, r);
        inner = hit >= 0 ? rayCyl(o, d, _e.x, _e.z, _e.y, _e.y + 1.85, ri) : -1;
      } else {
        hit = rayCyl(o, d, _e.x, _e.z, _e.y - 0.3, _e.y + 0.7, r * 1.1);
        inner = -1;
      }
      if (hit < 0) continue;
      if (hit > groundT + 2 + r) continue;    // behind a hill
      const score = (inner >= 0 ? inner : hit + 1e4) + (t.alive ? 0 : 5e4);
      if (score < bestScore) { bestScore = score; best = t; }
    }
    return best;
  };

  // ---------------------------------------------------------------- render
  function viewportEl() {
    if ((!vpEl || !vpEl.isConnected) && clock - vpElCheck > 0.5) {
      vpElCheck = clock;
      vpEl = document.getElementById('viewport');
    }
    return vpEl && vpEl.isConnected ? vpEl : null;
  }
  function slotEl(i) {
    if (clock - slotElCheck > 1) {
      slotElCheck = clock;
      for (let k = 0; k < FEED_COUNT; k++) {
        if (!slotEls[k] || !slotEls[k].isConnected) slotEls[k] = document.querySelector('.feed-slot[data-feed="' + k + '"]');
      }
    }
    const el = slotEls[i];
    return el && el.isConnected ? el : null;
  }
  function refreshSlotStyles() {
    if (clock - slotStyleCheck < 0.5) return;
    slotStyleCheck = clock;
    for (let i = 0; i < FEED_COUNT; i++) {
      const el = slotEls[i];
      if (!el || !el.isConnected) { slotStyleOk[i] = false; continue; }
      let ok = !el.hidden;
      if (ok) {
        try {
          const cs = window.getComputedStyle(el);
          ok = cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0;
        } catch (err) { ok = true; }
      }
      slotStyleOk[i] = ok;
    }
  }
  /** Update the cached main view rectangle from the DOM. */
  function readViewport(cw, ch) {
    const el = viewportEl();
    let r = null;
    if (el) {
      r = el.getBoundingClientRect();
      if (!(r.width >= 2 && r.height >= 2)) r = null;
    }
    if (r) {
      vp.left = r.left; vp.top = r.top; vp.width = r.width; vp.height = r.height;
      vp.full = r.left <= 0.5 && r.top <= 0.5 && r.width >= cw - 1 && r.height >= ch - 1;
    } else {
      vp.left = 0; vp.top = 0; vp.width = cw; vp.height = ch; vp.full = true;
    }
  }
  function setAspect(cam, a) {
    if (!(a > 0.05 && a < 50)) a = 1.6;
    if (Math.abs(cam.aspect - a) > 1e-4) { cam.aspect = a; cam.updateProjectionMatrix(); }
  }

  let renderNo = 0;
  const _dofP = new V3();
  /** Cinematic depth of field: close shots of a contestant soften the background (post.js). */
  function updateDof(S) {
    let want = 0, focus = S.dofFocus || 10;
    const sid = mode === 'follow' || mode === 'director' ? mainSubject() : null;
    const t = sid != null ? contestantById(sid) : null;
    if (t && t.pos) {
      entPos(t, _dofP);
      _dofP.y += t.alive ? 1.2 : 0.3;
      focus = main.position.distanceTo(_dofP);
      want = (1 - U.smoothstep(4, 15, focus)) * 0.8;
    }
    S.dof += (want - S.dof) * 0.08;
    S.dofFocus += (focus - S.dofFocus) * 0.2;
    S.dofRange = Math.max(5, S.dofFocus * 1.5);
  }
  /** Render the main view into #viewport and the live feeds into .feed-slot rectangles. */
  Cameras.render = function () {
    const W = GM.World;
    if (!W || !W.renderer || !W.scene) return;
    renderNo = (renderNo + 1) % 3000;
    const r = W.renderer, scene = W.scene;
    const canvas = r.domElement;
    const cw = Math.max(1, window.innerWidth || 1), ch = Math.max(1, window.innerHeight || 1);
    r.getSize(_size);
    if (Math.abs(_size.x - cw) > 0.5 || Math.abs(_size.y - ch) > 0.5) r.setSize(cw, ch, false);
    let ox = 0, oy = 0;
    if (canvas && canvas.getBoundingClientRect) {
      const cr = canvas.getBoundingClientRect();
      ox = cr.left; oy = cr.top;
    }
    readViewport(cw, ch);
    const sm = r.shadowMap;
    if (sm) { sm.autoUpdate = false; sm.needsUpdate = !!sm.enabled; }
    r.setRenderTarget(null);
    if (!vp.full) {
      r.setScissorTest(false);
      r.setViewport(0, 0, cw, ch);
      r.clear();
    }
    // Main view (bottom-left origin in CSS px; three.js applies the pixel ratio).
    // GM.Post renders through the HDR pipeline (tone mapping, bloom, AO ...).
    const P = GM.Post && typeof GM.Post.renderView === 'function' ? GM.Post : null;
    const mx = vp.left - ox, my = ch - (vp.top - oy) - vp.height;
    setAspect(main, vp.width / vp.height);
    if (P && P.settings) updateDof(P.settings);
    if (P) {
      P.renderView(scene, main, mx, my, vp.width, vp.height, 0, true);
    } else {
      r.setScissorTest(true);
      r.setViewport(mx, my, vp.width, vp.height);
      r.setScissor(mx, my, vp.width, vp.height);
      r.render(scene, main);
    }
    // Live feeds.
    if (feedsEnabled()) {
      refreshSlotStyles();
      for (let i = 0; i < FEED_COUNT; i++) {
        const el = slotEl(i);
        let vis = false;
        let rc = null;
        if (el && slotStyleOk[i]) {
          rc = el.getBoundingClientRect();
          vis = rc.width >= 8 && rc.height >= 8 && rc.right > ox && rc.left < ox + cw && rc.bottom > oy && rc.top < oy + ch;
        }
        const wasHidden = !slotVis[i];
        slotVis[i] = vis;
        if (!vis) continue;
        const f = feeds[i];
        let fresh = false;
        if (!f.shot.active || wasHidden) { feedThink(i); f.snap = true; prepareFeed(f, 0); fresh = true; }
        if (!f.shot.active) continue;
        const fx = rc.left - ox, fy = ch - (rc.top - oy) - rc.height;
        setAspect(f.camera, rc.width / rc.height);
        if (P) {
          // feeds re-render their scene round-robin (one per frame); the others re-use their last image
          const refresh = fresh || renderNo % FEED_COUNT === i || f.shot !== f.lastShotRef || f.shot.t0 !== f.lastShotT0;
          f.lastShotRef = f.shot;
          f.lastShotT0 = f.shot.t0;
          P.renderView(scene, f.camera, fx, fy, rc.width, rc.height, 1 + i, false, refresh);
        } else {
          r.setViewport(fx, fy, rc.width, rc.height);
          r.setScissor(fx, fy, rc.width, rc.height);
          r.render(scene, f.camera);
        }
      }
    } else {
      slotVis[0] = slotVis[1] = slotVis[2] = false;
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, cw, ch);
    lastRender = clock;
  };

  // ----------------------------------------------------------- public API
  Cameras.feeds = feeds;

  /** Switch the main camera mode: 'showcase'|'free'|'follow'|'director'|'overhead'. */
  Cameras.setMode = function (m) { return setMode(m); };

  /** Follow contestant id (mode 'follow') and select it. */
  Cameras.follow = function (id) {
    const t = contestantById(id);
    if (!t || !inGame()) return false;
    fol.id = t.id;
    if (mode !== 'follow') setMode('follow');
    else { fol.userT = -99; fol.labelId = -1; }
    if (GM.state.selectedId !== t.id) GM.select(t.id);
    return mode === 'follow';
  };

  /** Next camera mode (C key). */
  Cameras.cycleMode = function () {
    if (!inGame()) {
      setMode(mode === 'showcase' ? 'free' : mode === 'free' ? 'overhead' : 'showcase');
      return mode;
    }
    const i = CYCLE.indexOf(mode);
    for (let k = 1; k <= CYCLE.length; k++) {
      const m = CYCLE[(i + k + CYCLE.length) % CYCLE.length];
      if (m === 'follow') { if (followBest()) return mode; continue; }
      if (setMode(m)) return mode;
    }
    return mode;
  };

  /** Move the free / overhead camera to look at a point. */
  Cameras.lookAt = function (x, z) {
    x = +x; z = +z;
    if (!(x === x && z === z)) return;
    if (mode === 'overhead') {
      ovh.goal.set(U.clamp(x, -LIMIT, LIMIT), 0, U.clamp(z, -LIMIT, LIMIT));
      ovh.goalOn = true;
      return;
    }
    flyTo(x, z, null, 0.75);
  };

  /** Smooth fly-to a position ({x, z} or {x, y, z}). */
  Cameras.focus = function (pos) {
    if (!pos) return;
    const x = +pos.x, z = +pos.z;
    if (!(x === x && z === z)) return;
    if (mode === 'overhead') { Cameras.lookAt(x, z); return; }
    flyTo(x, z, pos.y, 0);
  };

  /** Camera shake. intensity ~0.2 (small) .. 1 (big) .. 3 (max); seconds of shaking. */
  Cameras.shake = function (intensity, seconds) {
    let i = +intensity, s = +seconds;
    if (!(i > 0)) return;
    if (!(s > 0)) s = 0.4;
    i = Math.min(i, 3);
    s = Math.min(s, 8);
    const now = shk.t > 0 ? shk.amp * Math.min(1, (shk.t / shk.dur) * 2.2) : 0;
    shk.amp = Math.max(now, i);
    shk.t = Math.max(shk.t, s);
    shk.dur = shk.t;
  };

  /** Overlay info for the UI: {mode, camName, label, followId, cut, shot, modeLabel, modeShort, hint}. */
  Cameras.status = function () {
    return {
      mode,
      camName: CAM_NAMES[camNo] || 'CAM 01',
      label: curLabel,
      followId: mode === 'follow' ? fol.id : mainSubject(),
      cut: cutT > 0,
      shot: curShot,
      modeLabel: MODE_LABELS[mode],
      modeShort: MODE_SHORT[mode],
      hint: HINTS[mode],
    };
  };

  /** Main camera jumps to feed i's subject (hard cut to the same picture). */
  Cameras.takeFeed = function (i) {
    const f = feeds[i | 0];
    if (!f || !f.shot.active) return false;
    const t = contestantById(f.shot.subjectId);
    cur.pos.copy(f.cur.pos);
    cur.look.copy(f.cur.look);
    cur.fov = f.cur.fov;
    if (t && inGame()) {
      fol.id = t.id;
      if (mode !== 'follow') setMode('follow');
      initFollowFromCurrent();
      if (GM.state.selectedId !== t.id) GM.select(t.id);
    } else {
      if (mode !== 'free') setMode('free');
      initFreeFromCurrent();
    }
    modeBlend = 0;
    snapNext = true;
    cutT = 0.35;
    f.shot.t0 = -99;   // the feed moves on to something else
    return true;
  };

  const _wts = new V3(), _wtsV = new V3();
  /**
   * World position -> client CSS pixels of the main view. Pass `out` to avoid
   * allocation: {x, y, visible}. visible is false behind the camera or off-view.
   */
  Cameras.worldToScreen = function (pos, out) {
    out = out || { x: 0, y: 0, visible: false };
    if (!pos) { out.visible = false; return out; }
    _wts.set(+pos.x || 0, pos.y == null ? 0 : +pos.y || 0, +pos.z || 0);
    _wtsV.copy(_wts).applyMatrix4(main.matrixWorldInverse);
    if (_wtsV.z > -main.near) { out.x = -9999; out.y = -9999; out.visible = false; return out; }
    _wts.project(main);
    out.x = vp.left + (_wts.x + 1) * 0.5 * vp.width;
    out.y = vp.top + (1 - _wts.y) * 0.5 * vp.height;
    out.visible = _wts.x >= -1.02 && _wts.x <= 1.02 && _wts.y >= -1.02 && _wts.y <= 1.02;
    return out;
  };

  /** Contestant id on the main camera (follow target or director subject) or null. */
  Cameras.subjectId = function () { return mainSubject(); };

  // ----------------------------------------------------------------- events
  function onSetup() {
    setMode('showcase');
    show.user = 0;
    show.zoomGoal = 1;
    hardCut();
  }
  function onNew() {
    fol.id = null;
    for (let i = 0; i < FEED_COUNT; i++) { feeds[i].shot.active = false; feeds[i].snap = true; }
    if (mode === 'director') { dir.shot.active = false; startCountdown(); }
    else setMode('director');
  }
  function onStart() {
    if (mode === 'director') startKickoff();
  }
  function onEnd() {
    if (mode !== 'director') setMode('director');
    else startVictor();
  }
  function onSelect(e) {
    const id = e ? e.id : null;
    if (id == null || mode !== 'follow' || id === fol.id || !contestantById(id)) return;
    fol.id = id;
    fol.userT = -99;
    fol.labelId = -1;
  }
  function onDied(e) {
    const t = e && e.contestant;
    if (!t) return;
    const k = e.killer && e.killer.kind !== 'beast' ? e.killer : null;
    const lbl = k && k !== t ? label('cam.deathBy', { killer: k.name, name: t.name }) : label('cam.death', { name: t.name });
    addEventCand('death', e.pos || t.pos, 10.5, t.id, k && k !== t ? k.id : null, lbl, 8, 7);
    if (mode === 'follow' && fol.id === t.id) fol.labelId = -1;
  }
  function onHazard(key, cls, score, radius) {
    return function (e) {
      if (!e || !e.pos) return;
      addEventCand(cls, e.pos, score, null, null, label(key), Math.max(radius, +e.radius || 0), 4);
    };
  }

  function subscribe() {
    GM.on('game:setup', onSetup);
    GM.on('game:new', onNew);
    GM.on('game:start', onStart);
    GM.on('game:end', onEnd);
    GM.on('select', onSelect);
    GM.on('interest', function (it) { if (it && inGame()) upsertInterest(it); });
    GM.on('contestant:died', onDied);
    GM.on('arena:generated', function () {
      landmarks = null;
      clampXZ(free.pos, LIMIT);
    });
    GM.on('alliance:broken', function (e) {
      if (!e || !e.betrayal || e.byId == null) return;
      const t = contestantById(e.byId);
      if (!t || !t.pos) return;
      addEventCand('betrayal', t.pos, 9, t.id, null, label('cam.betrayal', { name: t.name }), 10, 6);
    });
    GM.on('hazard:lightning', onHazard('cam.lightning', 'hazard', 7, 10));
    GM.on('hazard:explosion', onHazard('cam.explosion', 'hazard', 7.5, 12));
    GM.on('hazard:quake', onHazard('cam.quake', 'hazard', 7.5, 25));
    GM.on('hazard:gas', onHazard('cam.gas', 'hazard', 6.5, 18));
    GM.on('hazard:fire', onHazard('cam.fire', 'hazard', 6, 14));
    GM.on('hazard:flood', onHazard('cam.flood', 'hazard', 6, 40));
    GM.on('zone:shrink', function (e) {
      if (!e || !e.center) return;
      const c = e.center;
      const rr = +e.radius || 60;
      // Film the glowing wall: a point on the zone edge on the camera's side.
      const ang = Math.atan2(cur.pos.x - (+c.x || 0), cur.pos.z - (+c.z || 0));
      _g1.set((+c.x || 0) + Math.sin(ang) * rr * 0.9, 0, (+c.z || 0) + Math.cos(ang) * rr * 0.9);
      clampXZ(_g1, LIMIT);
      _g1.y = surfaceY(_g1.x, _g1.z);
      addEventCand('hazard', _g1, 6, null, null, label('cam.zone'), 40, 5);
    });
    GM.on('beast:spawned', function (e) {
      const m = e && e.beast;
      if (!m || !m.pos) return;
      addEventCand('beast', m.pos, 7, null, null, label('cam.beasts'), 14, 5);
    });
    GM.on('crate:landed', function (e) {
      if (!e) return;
      addEventCand('drop', e.pos || (e.item && e.item.pos), 3.5, null, null, label('cam.drop'), 10, 3);
    });
    GM.on('gift:sent', function (e) {
      const t = e && e.contestant;
      if (!t || !t.pos) return;
      addEventCand('drop', t.pos, 4, t.id, null, label('cam.gift', { name: t.name }), 8, 4);
    });
    GM.on('feast:ready', function (e) {
      addEventCand('drop', (e && e.pos) || { x: 0, z: 0 }, 8, null, null, label('cam.feast'), 20, 8);
    });
    GM.on('trap:triggered', function (e) {
      const t = e && e.contestant;
      const p = (e && e.pos) || (t && t.pos);
      if (!p) return;
      addEventCand('trap', p, 7, t ? t.id : null, e && e.ownerId != null ? e.ownerId : null, label('cam.trap'), 8, 4);
    });
    GM.on('power:used', function (e) {
      if (!e) return;
      const tgt = e.target;
      const nameKey = 'power.' + e.id;
      const lbl = hasKey(nameKey) ? label('cam.powerUsed', { power: '@' + nameKey }) : label('cam.power');
      if (tgt && tgt.kind === 'contestant' && tgt.pos) addEventCand('power', tgt.pos, 6.5, tgt.id, null, lbl, 10, 4);
      else if (tgt && +tgt.x === +tgt.x && +tgt.z === +tgt.z) {
        const def = GM.Powers && typeof GM.Powers.def === 'function' ? GM.Powers.def(e.id) : null;
        addEventCand('power', tgt, 6.5, null, null, lbl, def && def.radius ? +def.radius : 14, 4);
      }
    });
  }

  // ------------------------------------------------------------------ system
  GM.registerSystem({
    name: 'Cameras',
    order: 90,

    init() {
      canvasEl = document.getElementById('gl') || (GM.World && GM.World.renderer && GM.World.renderer.domElement) || null;
      if (canvasEl) {
        canvasEl.addEventListener('pointerdown', onPointerDown);
        canvasEl.addEventListener('wheel', onWheel, { passive: false });
        canvasEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        try { canvasEl.style.touchAction = 'none'; } catch (err) { /* ignore */ }
      }
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', clearKeys);
      try {
        const mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
        if (mq) {
          reducedMotion = !!mq.matches;
          const onMq = function (e) { reducedMotion = !!e.matches; };
          if (mq.addEventListener) mq.addEventListener('change', onMq);
          else if (mq.addListener) mq.addListener(onMq);
        }
      } catch (err) { /* ignore */ }
      readViewport(Math.max(1, window.innerWidth || 1), Math.max(1, window.innerHeight || 1));
      setAspect(main, vp.width / vp.height);
      subscribe();
    },

    clear() {
      for (let i = 0; i < CAND_MAX; i++) { cands[i].active = false; cands[i].iid = 0; }
      dir.shot.active = false;
      dir.shot.cand = null;
      dir.pin = null;
      dir.fallbackN = 0;
      dir.moveUntil = 0;
      dir.lastStyles[0] = dir.lastStyles[1] = dir.lastStyles[2] = '';
      recentIds.fill(-1);
      for (let i = 0; i < FEED_COUNT; i++) {
        const f = feeds[i];
        f.shot.active = false;
        f.shot.cand = null;
        f.label = null; f.followId = null; f.interestId = null;
        f.snap = true; f.cut = false; f.cutT = 0;
      }
      feedRot = 0;
      fol.id = null;
      fol.labelId = -1;
      shk.t = 0; shk.amp = 0;
      free.fly.on = false;
      free.dolly = 0;
      cutT = 0;
      ptr.drag = false;
      hover.pending = false;
    },

    reset() {
      landmarks = null;
    },

    frame(realDt) {
      let dt = +realDt;
      if (!(dt > 0)) dt = 0;
      if (dt > 0.1) dt = 0.1;
      clock += dt;
      if (cutT > 0) cutT -= dt;
      if (clock - candSync > 0.15) { candSync = clock; syncCands(); }
      // Keep the mode legal for the phase.
      const game = inGame();
      if (!game && (mode === 'director' || mode === 'follow')) setMode('showcase');
      else if (game && mode === 'showcase') setMode('director');
      const m0 = mode;
      runMode(dt);
      if (mode !== m0) runMode(dt);   // the mode changed inside (e.g. followed contestant gone)
      applyMain(dt);
      clampXZ(focusPoint, HALF);
      if (!finiteV(focusPoint)) focusPoint.set(0, 0, 0);
      const W = GM.World;
      if (W && typeof W.setShadowFocus === 'function') {
        try { W.setShadowFocus(focusPoint.x, focusPoint.z); } catch (err) { GM.reportError('Cameras.shadowFocus', err); }
      }
      // Without render() (e.g. headless tests), still track the view rectangle.
      if (clock - lastRender > 0.5) {
        readViewport(Math.max(1, window.innerWidth || 1), Math.max(1, window.innerHeight || 1));
        setAspect(main, vp.width / vp.height);
      }
      processHover();
      updateFeeds(dt);
    },
  });
})();
