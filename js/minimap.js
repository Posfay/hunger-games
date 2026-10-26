/* ==========================================================================
 * minimap.js — GM.Minimap: the tactical arena map in the monitors panel.
 *
 * Two layers:
 *   1. Terrain image (offscreen canvas): Terrain.colorAt + hillshade from
 *      Terrain.heightAt, contour lines, water by depth, burnt ground, darkened
 *      mountains outside the force field. Re-rendered (throttled, dirty
 *      rectangles when possible) on 'arena:generated', 'terrain:changed',
 *      'forest:burnt' and 'water:changed'.
 *   2. Live layer (~10 Hz, only while visible): fire cells, gas clouds, force
 *      field zone, feast, items / crates, traps, points of interest, alliance
 *      lines, beasts, contestants (team colours, selected / hovered rings,
 *      dead = small x), the main camera's view cone and the power aim radius.
 *
 * Input: click -> use the armed power (GM.UI.targetPoint) or pick a contestant
 * (GM.UI.pickContestant) or move the camera (GM.Cameras.lookAt); drag -> camera
 * follows the pointer; hover while targeting -> GM.UI.aimPoint; right-click
 * cancels targeting.
 *
 * Public API (GM.Minimap):
 *   canvas                      the <canvas id="minimap"> (created by GM.UI)
 *   viewHalf                    half size of the shown square in metres
 *   version                     increases after every terrain image render
 *   terrainImage() -> canvas    offscreen terrain image (setup screen thumbnail)
 *   worldToMap(x, z, out?) -> {x, y}   CSS pixels inside the canvas
 *   mapToWorld(px, py, out?) -> {x, z}
 *   redraw(full = true)         force a terrain re-render
 *
 * Owner: UI. Contract: SPEC.md section 8.13. System order 105.
 * ========================================================================== */
(function () {
  'use strict';
  const GM = window.GM;
  if (!GM) return;
  const CFG = GM.CFG;
  const U = GM.U;
  const TAU = Math.PI * 2;

  // ------------------------------------------------------------------ i18n
  if (GM.i18n) {
    GM.i18n.add({
      en: {
        'minimap.title': 'Arena map',
        'minimap.scale': '{n} m',
        'minimap.coords': 'X {x} · Z {z}',
        'minimap.tipLook': 'Click: the camera looks there. Drag: move the camera. Click a dot: watch that contestant.',
        'minimap.tipTarget': 'Click: use the power here. Right-click: cancel.',
      },
      hu: {
        'minimap.title': 'Az aréna térképe',
        'minimap.scale': '{n} m',
        'minimap.coords': 'X {x} · Z {z}',
        'minimap.tipLook': 'Kattintás: a kamera odanéz. Húzás: a kamera mozog. Kattints egy pontra: kövesd azt a versenyzőt.',
        'minimap.tipTarget': 'Kattintás: itt használod a képességet. Jobb klikk: mégse.',
      },
    });
  }

  // ------------------------------------------------------------- constants
  const VIEW = Math.min(CFG.MAP_SIZE / 2, CFG.ARENA_RADIUS + 14);  // half extent (m)
  const IMG = 200;                 // terrain image resolution (px per side)
  const MPP = (VIEW * 2) / IMG;    // metres per terrain image pixel
  const LIVE_DT = 0.1;             // live layer refresh (s real time)
  const FULL_MIN_GAP = 0.6;        // min seconds between full terrain renders (floods)
  const RECT_MIN_GAP = 0.3;        // min seconds between partial renders
  const CONTOUR = 4;               // contour line step (m)
  const LIGHT = (function () {     // sun from the north-west, high
    const x = -0.55, y = 0.72, z = -0.42;
    const l = Math.sqrt(x * x + y * y + z * z);
    return { x: x / l, y: y / l, z: z / l };
  })();
  const WATER_SHALLOW = [74, 142, 168];
  const WATER_DEEP = [16, 52, 84];
  const BURNT = [46, 38, 34];

  // ----------------------------------------------------------------- state
  const M = (GM.Minimap = {
    canvas: null,
    viewHalf: VIEW,
    version: 0,
  });
  let ctx = null;
  let img = null, imgCtx = null, imgData = null;
  let hb = null;                   // height buffer (IMG + 2)^2
  let S = 0;                       // backing pixels per side
  let cssS = 0;                    // CSS pixels per side
  let dpr = 1;
  let scale = 1;                   // backing px per metre
  let clock = 0;
  let liveAcc = 99;
  let lookCheck = 0;
  let coordsEl = null;
  let errorShown = false;
  const dirty = { full: true, rect: false, x0: 0, y0: 0, x1: 0, y1: 0, lastFull: -99, lastRect: -99, urgent: true };
  const hover = { on: false, px: 0, py: 0, x: 0, z: 0, contestant: null, lastAim: 0 };
  const press = { on: false, id: -1, x: 0, y: 0, button: 0, drag: false, lastLook: 0 };
  const _col = { r: 0, g: 0, b: 0 };
  const _dir = window.THREE ? new window.THREE.Vector3() : null;

  // -------------------------------------------------------------- mapping
  /** World (x, z) -> CSS pixels inside the canvas. */
  M.worldToMap = function (x, z, out) {
    out = out || { x: 0, y: 0 };
    const k = cssS / (VIEW * 2);
    out.x = (x + VIEW) * k;
    out.y = (z + VIEW) * k;
    return out;
  };
  /** CSS pixels inside the canvas -> world (x, z). */
  M.mapToWorld = function (px, py, out) {
    out = out || { x: 0, z: 0 };
    const k = cssS > 0 ? (VIEW * 2) / cssS : 1;
    out.x = px * k - VIEW;
    out.z = py * k - VIEW;
    return out;
  };
  M.terrainImage = function () {
    if (!img || dirty.full) renderNow();
    return img;
  };
  /** Force a terrain re-render (full by default). */
  M.redraw = function (full) {
    if (full === false) { markRect(0, 0, VIEW * 2); return; }
    dirty.full = true;
    dirty.urgent = true;
  };

  // ------------------------------------------------------------ helpers
  function terrain() {
    const T = GM.Terrain;
    return T && typeof T.heightAt === 'function' ? T : null;
  }
  function waterLevel() {
    const T = GM.Terrain;
    if (T && typeof T.waterLevel === 'function') {
      try { const w = +T.waterLevel(); if (w === w) return w; } catch (e) { /* fall back */ }
    }
    const E = GM.Env;
    if (E && typeof E.waterLevel === 'number' && isFinite(E.waterLevel)) return E.waterLevel;
    return CFG.BASE_WATER_LEVEL;
  }
  function fallbackColor(h, out) {
    // simple height ramp when Terrain.colorAt is missing
    if (h < 1.2) { out.r = 196; out.g = 184; out.b = 136; }
    else if (h < 10) { out.r = 92; out.g = 138; out.b = 70; }
    else if (h < 24) { out.r = 118; out.g = 124; out.b = 96; }
    else if (h < 42) { out.r = 128; out.g = 122; out.b = 116; }
    else { out.r = 226; out.g = 230; out.b = 236; }
    return out;
  }
  function markRect(x, z, radius) {
    const r = (+radius || 10) + MPP * 3;
    const x0 = Math.floor((x - r + VIEW) / MPP), x1 = Math.ceil((x + r + VIEW) / MPP);
    const y0 = Math.floor((z - r + VIEW) / MPP), y1 = Math.ceil((z + r + VIEW) / MPP);
    if (x1 < 0 || y1 < 0 || x0 >= IMG || y0 >= IMG) return;
    if (!dirty.rect) {
      dirty.rect = true;
      dirty.x0 = x0; dirty.y0 = y0; dirty.x1 = x1; dirty.y1 = y1;
    } else {
      dirty.x0 = Math.min(dirty.x0, x0); dirty.y0 = Math.min(dirty.y0, y0);
      dirty.x1 = Math.max(dirty.x1, x1); dirty.y1 = Math.max(dirty.y1, y1);
    }
  }

  // ------------------------------------------------------ terrain image
  function ensureImage() {
    if (img) return true;
    try {
      img = document.createElement('canvas');
      img.width = IMG;
      img.height = IMG;
      imgCtx = img.getContext('2d');
      imgData = imgCtx.createImageData(IMG, IMG);
      hb = new Float32Array((IMG + 2) * (IMG + 2));
      return true;
    } catch (e) {
      GM.reportError('Minimap.image', e);
      img = null;
      return false;
    }
  }

  /** Render terrain pixels [px0, px1) x [py0, py1) into the image. */
  function renderTerrain(px0, py0, px1, py1) {
    if (!ensureImage()) return;
    px0 = U.clamp(px0, 0, IMG); px1 = U.clamp(px1, 0, IMG);
    py0 = U.clamp(py0, 0, IMG); py1 = U.clamp(py1, 0, IMG);
    if (px1 <= px0 || py1 <= py0) return;
    const T = terrain();
    const colorAt = T && typeof T.colorAt === 'function' ? T.colorAt : null;
    const H = GM.Hazards;
    const fire = H && H.fire && typeof H.fire.isBurnt === 'function' ? H.fire : null;
    const wl = waterLevel();
    const W2 = IMG + 2;
    // heights with a 1 px border (for shading and contours)
    for (let py = py0 - 1; py <= py1; py++) {
      const z = -VIEW + (py + 0.5) * MPP;
      const row = (py + 1) * W2;
      for (let px = px0 - 1; px <= px1; px++) {
        const x = -VIEW + (px + 0.5) * MPP;
        let hgt = 0;
        if (T) { hgt = +T.heightAt(x, z); if (!(hgt === hgt)) hgt = 0; }
        hb[row + px + 1] = hgt;
      }
    }
    const d = imgData.data;
    const R2 = CFG.ARENA_RADIUS * CFG.ARENA_RADIUS;
    const inv2 = 1 / (2 * MPP);
    for (let py = py0; py < py1; py++) {
      const z = -VIEW + (py + 0.5) * MPP;
      const row = (py + 1) * W2;
      for (let px = px0; px < px1; px++) {
        const x = -VIEW + (px + 0.5) * MPP;
        const i = row + px + 1;
        const hgt = hb[i];
        const hl = hb[i - 1], hr = hb[i + 1], hu = hb[i - W2], hd = hb[i + W2];
        // normal = (-dh/dx, 1, -dh/dz)
        const nx = -(hr - hl) * inv2, nz = -(hd - hu) * inv2;
        const nl = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
        let shade = (nx * LIGHT.x + LIGHT.y + nz * LIGHT.z) * nl;
        shade = shade < 0 ? 0 : shade;
        let r, g, b;
        if (hgt < wl) {
          const depth = U.clamp01((wl - hgt) / 6);
          r = WATER_SHALLOW[0] + (WATER_DEEP[0] - WATER_SHALLOW[0]) * depth;
          g = WATER_SHALLOW[1] + (WATER_DEEP[1] - WATER_SHALLOW[1]) * depth;
          b = WATER_SHALLOW[2] + (WATER_DEEP[2] - WATER_SHALLOW[2]) * depth;
          const f = 0.9 + 0.2 * shade;
          r *= f; g *= f; b *= f;
          // bright shore line
          if (hl >= wl || hr >= wl || hu >= wl || hd >= wl) { r = r * 0.5 + 90; g = g * 0.5 + 120; b = b * 0.5 + 125; }
        } else {
          let c = null;
          if (colorAt) {
            try { c = colorAt(x, z, _col); } catch (e) { c = null; }
          }
          if (!c || c.r == null) c = fallbackColor(hgt, _col);
          r = +c.r || 0; g = +c.g || 0; b = +c.b || 0;
          if (r <= 1 && g <= 1 && b <= 1) { r *= 255; g *= 255; b *= 255; }
          if (fire && fire.isBurnt(x, z)) {
            r = r * 0.35 + BURNT[0] * 0.65; g = g * 0.35 + BURNT[1] * 0.65; b = b * 0.35 + BURNT[2] * 0.65;
          }
          const f = 0.5 + 0.72 * shade;
          r *= f; g *= f; b *= f;
          // contour lines
          const band = Math.floor(hgt / CONTOUR);
          if (Math.floor(hl / CONTOUR) !== band || Math.floor(hu / CONTOUR) !== band) {
            r *= 0.8; g *= 0.82; b *= 0.86;
          }
        }
        // cool "holographic" grade: slight desaturation toward blue-grey
        const lum = r * 0.3 + g * 0.55 + b * 0.15;
        r = r * 0.8 + lum * 0.12 + 4;
        g = g * 0.82 + lum * 0.12 + 8;
        b = b * 0.8 + lum * 0.14 + 16;
        // outside the force field: dim mountains
        const dsq = x * x + z * z;
        if (dsq > R2) {
          const k = 0.42;
          r = r * k + 6; g = g * k + 10; b = b * k + 18;
        }
        const o = (py * IMG + px) * 4;
        d[o] = r > 255 ? 255 : r;
        d[o + 1] = g > 255 ? 255 : g;
        d[o + 2] = b > 255 ? 255 : b;
        d[o + 3] = 255;
      }
    }
    imgCtx.putImageData(imgData, 0, 0, px0, py0, px1 - px0, py1 - py0);
    M.version++;
  }

  function renderNow() {
    if (!ensureImage()) return;
    try {
      renderTerrain(0, 0, IMG, IMG);
    } catch (e) {
      if (!errorShown) { errorShown = true; GM.reportError('Minimap.terrain', e); }
    }
    dirty.full = false;
    dirty.rect = false;
    dirty.urgent = false;
    dirty.lastFull = clock;
    liveAcc = 99;
  }

  function processDirty() {
    if (dirty.full) {
      if (dirty.urgent || clock - dirty.lastFull >= FULL_MIN_GAP) renderNow();
      return;
    }
    if (dirty.rect && clock - dirty.lastRect >= RECT_MIN_GAP) {
      dirty.rect = false;
      dirty.lastRect = clock;
      try {
        renderTerrain(dirty.x0, dirty.y0, dirty.x1, dirty.y1);
      } catch (e) {
        if (!errorShown) { errorShown = true; GM.reportError('Minimap.terrain', e); }
      }
      liveAcc = 99;
    }
  }

  // -------------------------------------------------------- live layer
  function px(x) { return (x + VIEW) * scale; }
  function py(z) { return (z + VIEW) * scale; }

  function ensureCanvas() {
    if (M.canvas && M.canvas.isConnected) return true;
    if (clock - lookCheck < 1 && M.canvas === null && lookCheck > 0) return false;
    lookCheck = clock || 0.001;
    const cv = document.getElementById('minimap');
    if (!cv || !cv.getContext) { M.canvas = null; ctx = null; return false; }
    M.canvas = cv;
    ctx = cv.getContext('2d');
    bindInput(cv);
    const mod = cv.closest ? cv.closest('.mod-map') : null;
    coordsEl = mod ? mod.querySelector('.mm-coords') : null;
    cv.setAttribute('data-tip', 'minimap.tipLook');
    return !!ctx;
  }
  /** Keep the backing store matched to the CSS size. Returns false when invisible. */
  function fitCanvas() {
    const cv = M.canvas;
    const w = cv.clientWidth, hh = cv.clientHeight;
    if (!(w > 8 && hh > 8)) return false;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cssS = Math.min(w, hh);
    const want = Math.round(cssS * dpr);
    if (cv.width !== want || cv.height !== want) { cv.width = want; cv.height = want; }
    S = want;
    scale = S / (VIEW * 2);
    return true;
  }

  let fctx = null, fcell = 0;
  function drawFireCell(x, z, inten) {
    const a = 0.35 + 0.6 * U.clamp01(+inten || 0);
    fctx.globalAlpha = a;
    fctx.fillRect(px(x) - fcell * 0.5, py(z) - fcell * 0.5, fcell, fcell);
  }

  function drawGrid(g) {
    g.strokeStyle = 'rgba(120, 210, 255, 0.07)';
    g.lineWidth = 1;
    g.beginPath();
    for (let m = -150; m <= 150; m += 50) {
      const a = Math.round(px(m)) + 0.5;
      g.moveTo(a, 0); g.lineTo(a, S);
      g.moveTo(0, a); g.lineTo(S, a);
    }
    g.stroke();
    // force field wall
    g.strokeStyle = 'rgba(120, 220, 255, 0.35)';
    g.lineWidth = 1 * dpr;
    g.beginPath();
    g.arc(px(0), py(0), CFG.ARENA_RADIUS * scale, 0, TAU);
    g.stroke();
  }

  function drawHazards(g) {
    const H = GM.Hazards;
    if (!H) return;
    // fire
    const fire = H.fire;
    if (fire && typeof fire.forEachBurning === 'function' && (fire.count == null || fire.count > 0)) {
      fctx = g;
      fcell = Math.max(2, (fire.CELL || 4) * scale * 1.05);
      g.fillStyle = '#ff7a1f';
      try { fire.forEachBurning(drawFireCell); } catch (e) { /* fire grid busy */ }
      g.globalAlpha = 1;
      fctx = null;
    }
    // gas clouds
    const clouds = Array.isArray(H.clouds) ? H.clouds : Array.isArray(H.gas) ? H.gas : null;
    if (clouds) {
      for (let i = 0; i < clouds.length; i++) {
        const c = clouds[i];
        if (!c) continue;
        const cx = c.x != null ? c.x : c.pos ? c.pos.x : 0;
        const cz = c.z != null ? c.z : c.pos ? c.pos.z : 0;
        const rad = (+c.radius || 10) * scale;
        let a = c.alpha != null ? +c.alpha : c.duration ? 1 - U.clamp01((+c.age || 0) / c.duration) : 1;
        a = U.clamp01(a);
        if (a <= 0.02) continue;
        const mad = c.kind === 'madness';
        g.globalAlpha = 0.28 * a;
        g.fillStyle = mad ? '#b46cff' : '#6dff5a';
        g.beginPath();
        g.arc(px(cx), py(cz), rad, 0, TAU);
        g.fill();
        g.globalAlpha = 0.75 * a;
        g.strokeStyle = mad ? '#d6a8ff' : '#a8ff9a';
        g.lineWidth = 1 * dpr;
        g.setLineDash([3 * dpr, 3 * dpr]);
        g.stroke();
        g.setLineDash([]);
      }
      g.globalAlpha = 1;
    }
    // force field zone
    const z = H.zone;
    if (z && z.center && (z.active || +z.radius < CFG.ARENA_RADIUS - 0.5)) {
      const cx = px(z.center.x), cz = py(z.center.z), r = Math.max(0, +z.radius || 0) * scale;
      g.save();
      g.beginPath();
      g.rect(0, 0, S, S);
      g.arc(cx, cz, r, 0, TAU, true);
      g.fillStyle = 'rgba(40, 110, 255, 0.22)';
      g.fill('evenodd');
      g.restore();
      g.strokeStyle = 'rgba(110, 190, 255, 0.95)';
      g.lineWidth = 1.6 * dpr;
      g.beginPath();
      g.arc(cx, cz, r, 0, TAU);
      g.stroke();
      const tr = +z.targetRadius;
      if (tr === tr && tr < +z.radius - 0.5) {
        const tc = z.targetCenter || z.center;
        g.strokeStyle = 'rgba(110, 190, 255, 0.6)';
        g.lineWidth = 1 * dpr;
        g.setLineDash([4 * dpr, 4 * dpr]);
        g.beginPath();
        g.arc(px(tc.x), py(tc.z), tr * scale, 0, TAU);
        g.stroke();
        g.setLineDash([]);
      }
    }
  }

  function drawItems(g) {
    const I = GM.Items;
    const list = I && Array.isArray(I.list) ? I.list : null;
    const pulse = (clock * 1.6) % 1;
    if (list) {
      const dot = Math.max(1, 1.1 * dpr);
      g.fillStyle = 'rgba(232, 222, 190, 0.55)';
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        if (!it || !it.pos || it.crate) continue;
        g.fillRect(px(it.pos.x) - dot / 2, py(it.pos.z) - dot / 2, dot, dot);
      }
      const cs = 3.4 * dpr;
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        if (!it || !it.pos || !it.crate) continue;
        const x = px(it.pos.x), y = py(it.pos.z);
        g.fillStyle = '#f2c14e';
        g.strokeStyle = 'rgba(20, 14, 0, 0.9)';
        g.lineWidth = 1 * dpr;
        g.fillRect(x - cs / 2, y - cs / 2, cs, cs);
        g.strokeRect(x - cs / 2, y - cs / 2, cs, cs);
        if (it.falling) {
          g.globalAlpha = 1 - pulse;
          g.strokeStyle = '#f2c14e';
          g.beginPath();
          g.arc(x, y, cs + pulse * 8 * dpr, 0, TAU);
          g.stroke();
          g.globalAlpha = 1;
        }
      }
    }
    // traps (the Showrunner sees them)
    const traps = I && Array.isArray(I.traps) ? I.traps : null;
    if (traps && traps.length) {
      const s = 2 * dpr;
      g.strokeStyle = 'rgba(255, 96, 96, 0.8)';
      g.lineWidth = 1 * dpr;
      g.beginPath();
      for (let i = 0; i < traps.length; i++) {
        const tp = traps[i];
        if (!tp || !tp.pos || tp.armed === false) continue;
        const x = px(tp.pos.x), y = py(tp.pos.z);
        g.moveTo(x - s, y - s); g.lineTo(x + s, y + s);
        g.moveTo(x + s, y - s); g.lineTo(x - s, y + s);
      }
      g.stroke();
    }
    // feast
    const f = GM.state.feast;
    if (f && f.x != null) {
      const x = px(f.x), y = py(f.z), r = 6 * dpr;
      g.strokeStyle = '#ffd36b';
      g.lineWidth = 1.5 * dpr;
      g.beginPath();
      g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath();
      g.stroke();
      g.globalAlpha = 0.6 * (1 - pulse);
      g.beginPath();
      g.arc(x, y, r + pulse * 10 * dpr, 0, TAU);
      g.stroke();
      g.globalAlpha = 1;
    }
  }

  function drawInterests(g) {
    const list = GM.state.interests;
    if (!list || !list.length) return;
    g.lineWidth = 1.2 * dpr;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (!it || !it.pos || it.score < 5) continue;
      const ph = (clock * 0.9 + (it.id % 7) * 0.13) % 1;
      const hot = it.score >= 9;
      g.globalAlpha = (1 - ph) * (hot ? 0.9 : 0.6);
      g.strokeStyle = hot ? '#ff5a4f' : it.kind === 'fight' ? '#ff9f43' : '#5eeaff';
      g.beginPath();
      g.arc(px(it.pos.x), py(it.pos.z), (4 + ph * (hot ? 14 : 10)) * dpr, 0, TAU);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  function drawAlliances(g, trs) {
    const AI = GM.AI;
    const als = AI && Array.isArray(AI.alliances) ? AI.alliances : null;
    if (!als || !als.length) return;
    g.strokeStyle = 'rgba(140, 230, 255, 0.45)';
    g.lineWidth = 1 * dpr;
    g.setLineDash([2 * dpr, 2 * dpr]);
    g.beginPath();
    for (let a = 0; a < als.length; a++) {
      const al = als[a];
      const mem = al && al.members;
      if (!Array.isArray(mem) || mem.length < 2) continue;
      let hub = al.leaderId != null ? trs[al.leaderId] : null;
      if (!hub || !hub.alive) {
        hub = null;
        for (let k = 0; k < mem.length; k++) { const m = trs[mem[k]]; if (m && m.alive) { hub = m; break; } }
      }
      if (!hub || !hub.pos) continue;
      const hx = px(hub.pos.x), hy = py(hub.pos.z);
      for (let k = 0; k < mem.length; k++) {
        const m = trs[mem[k]];
        if (!m || m === hub || !m.alive || !m.pos) continue;
        g.moveTo(hx, hy);
        g.lineTo(px(m.pos.x), py(m.pos.z));
      }
    }
    g.stroke();
    g.setLineDash([]);
  }

  function drawBeasts(g) {
    const list = GM.state.beasts;
    if (!list || !list.length) return;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m || !m.alive || !m.pos) continue;
      const x = px(m.pos.x), y = py(m.pos.z);
      if (m.type === 'wasps') {
        g.fillStyle = '#ffd23f';
        const j = 2.2 * dpr;
        for (let k = 0; k < 4; k++) {
          const a = clock * 9 + k * 1.7 + i;
          g.fillRect(x + Math.cos(a) * j - dpr * 0.6, y + Math.sin(a * 1.3) * j - dpr * 0.6, 1.2 * dpr, 1.2 * dpr);
        }
      } else {
        const s = 3 * dpr;
        g.fillStyle = '#ff3b3b';
        g.strokeStyle = 'rgba(30, 0, 0, 0.9)';
        g.lineWidth = 1 * dpr;
        g.beginPath();
        g.moveTo(x, y - s); g.lineTo(x + s, y + s * 0.8); g.lineTo(x - s, y + s * 0.8); g.closePath();
        g.fill();
        g.stroke();
      }
    }
  }

  function drawContestants(g, trs) {
    const selId = GM.state.selectedId;
    const hovId = GM.UI ? GM.UI.hoverId : null;
    const r = 3.3 * dpr;
    // dead first (under the living)
    g.strokeStyle = 'rgba(200, 200, 210, 0.55)';
    g.lineWidth = 1 * dpr;
    g.beginPath();
    const s = 2 * dpr;
    for (let i = 0; i < trs.length; i++) {
      const tr = trs[i];
      if (!tr || tr.alive || !tr.pos) continue;
      const x = px(tr.pos.x), y = py(tr.pos.z);
      g.moveTo(x - s, y - s); g.lineTo(x + s, y + s);
      g.moveTo(x + s, y - s); g.lineTo(x - s, y + s);
    }
    g.stroke();
    let sel = null;
    for (let i = 0; i < trs.length; i++) {
      const tr = trs[i];
      if (!tr || !tr.alive || !tr.pos) continue;
      const x = px(tr.pos.x), y = py(tr.pos.z);
      if (tr.id === selId) sel = tr;
      // heading tick
      const hd = +tr.heading || 0;
      g.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      g.lineWidth = 1 * dpr;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.sin(hd) * r * 2.1, y + Math.cos(hd) * r * 2.1);
      g.stroke();
      g.fillStyle = tr.color || GM.teamColor(tr.team || 1);
      g.strokeStyle = tr.sleeping ? 'rgba(160, 170, 255, 0.95)' : 'rgba(4, 8, 14, 0.95)';
      g.lineWidth = 1.2 * dpr;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
      g.stroke();
      if (tr.id === hovId && tr.id !== selId) {
        g.strokeStyle = 'rgba(94, 234, 255, 0.95)';
        g.lineWidth = 1.2 * dpr;
        g.beginPath();
        g.arc(x, y, r + 3 * dpr, 0, TAU);
        g.stroke();
      }
    }
    if (sel) {
      const x = px(sel.pos.x), y = py(sel.pos.z);
      const ph = (clock * 1.2) % 1;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1.5 * dpr;
      g.beginPath();
      g.arc(x, y, r + 2.5 * dpr, 0, TAU);
      g.stroke();
      g.strokeStyle = '#f2c14e';
      g.globalAlpha = 1 - ph;
      g.beginPath();
      g.arc(x, y, r + (3 + ph * 9) * dpr, 0, TAU);
      g.stroke();
      g.globalAlpha = 1;
    }
  }

  function drawCamera(g) {
    const C = GM.Cameras;
    const cam = C && C.main;
    if (!cam || !cam.position || !_dir) return;
    try { cam.getWorldDirection(_dir); } catch (e) { return; }
    const x = px(cam.position.x), y = py(cam.position.z);
    const vfov = ((+cam.fov || 50) * Math.PI) / 180;
    const aspect = +cam.aspect || 1.6;
    const hl = Math.sqrt(_dir.x * _dir.x + _dir.z * _dir.z);
    g.fillStyle = 'rgba(94, 234, 255, 0.10)';
    g.strokeStyle = 'rgba(94, 234, 255, 0.6)';
    g.lineWidth = 1 * dpr;
    if (hl < 0.3) {
      // looking down: draw the ground footprint
      const hgt = Math.max(10, cam.position.y);
      const hh = hgt * Math.tan(vfov / 2) * scale, hw = hh * aspect;
      g.beginPath();
      g.rect(x - hw, y - hh, hw * 2, hh * 2);
      g.fill();
      g.stroke();
    } else {
      const a = Math.atan2(_dir.x, _dir.z);
      const half = Math.atan(Math.tan(vfov / 2) * aspect);
      const len = U.clamp(Math.max(0, cam.position.y) * 2.4 + 30, 30, 140) * scale;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.sin(a - half) * len, y + Math.cos(a - half) * len);
      g.lineTo(x + Math.sin(a + half) * len, y + Math.cos(a + half) * len);
      g.closePath();
      g.fill();
      g.stroke();
    }
    g.fillStyle = '#5eeaff';
    g.beginPath();
    g.arc(x, y, 2.2 * dpr, 0, TAU);
    g.fill();
  }

  function drawAim(g) {
    const UIm = GM.UI;
    if (!UIm || typeof UIm.isTargeting !== 'function' || !UIm.isTargeting()) return;
    const tg = typeof UIm.targeting === 'function' ? UIm.targeting() : null;
    let x, z;
    if (hover.on) { x = hover.x; z = hover.z; }
    else if (tg && tg.hasPoint) { x = tg.x; z = tg.z; }
    else return;
    const cx = px(x), cy = py(z);
    const rad = Math.max(3, tg && tg.radius ? tg.radius : 0) * scale;
    g.strokeStyle = '#f2c14e';
    g.fillStyle = 'rgba(242, 193, 78, 0.16)';
    g.lineWidth = 1.4 * dpr;
    g.setLineDash([3 * dpr, 2 * dpr]);
    g.beginPath();
    g.arc(cx, cy, rad, 0, TAU);
    g.fill();
    g.stroke();
    g.setLineDash([]);
    const c = 5 * dpr;
    g.beginPath();
    g.moveTo(cx - c, cy); g.lineTo(cx + c, cy);
    g.moveTo(cx, cy - c); g.lineTo(cx, cy + c);
    g.stroke();
  }

  function drawScale(g) {
    const m = 50;
    const len = m * scale;
    const x0 = 8 * dpr, y0 = S - 9 * dpr;
    g.strokeStyle = 'rgba(210, 240, 255, 0.8)';
    g.lineWidth = 1 * dpr;
    g.beginPath();
    g.moveTo(x0, y0 - 3 * dpr); g.lineTo(x0, y0); g.lineTo(x0 + len, y0); g.lineTo(x0 + len, y0 - 3 * dpr);
    g.stroke();
    g.fillStyle = 'rgba(210, 240, 255, 0.85)';
    g.font = Math.round(9 * dpr) + 'px "JetBrains Mono", ui-monospace, monospace';
    g.textBaseline = 'bottom';
    g.fillText(GM.t('minimap.scale', { n: m }), x0 + len + 4 * dpr, y0 + 2 * dpr);
  }

  function drawHoverLabel(g) {
    const tr = hover.on ? hover.contestant : null;
    if (!tr || !tr.pos) return;
    const x = px(tr.pos.x), y = py(tr.pos.z);
    const label = tr.name + (tr.alive ? '' : ' ✝');
    g.font = '600 ' + Math.round(11 * dpr) + 'px "Barlow Semi Condensed", system-ui, sans-serif';
    const w = g.measureText(label).width + 10 * dpr;
    const hh = 16 * dpr;
    let lx = x + 8 * dpr, ly = y - hh - 4 * dpr;
    if (lx + w > S - 2) lx = x - w - 8 * dpr;
    if (ly < 2) ly = y + 8 * dpr;
    g.fillStyle = 'rgba(6, 12, 22, 0.92)';
    g.fillRect(lx, ly, w, hh);
    g.fillStyle = tr.color || '#fff';
    g.fillRect(lx, ly, 2 * dpr, hh);
    g.fillStyle = '#e8f4ff';
    g.textBaseline = 'middle';
    g.fillText(label, lx + 6 * dpr, ly + hh / 2 + 0.5);
  }

  function drawLive() {
    const g = ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = '#050a12';
    g.fillRect(0, 0, S, S);
    if (img) {
      g.imageSmoothingEnabled = true;
      g.drawImage(img, 0, 0, S, S);
    }
    drawGrid(g);
    const phase = GM.state.phase;
    const game = phase === 'countdown' || phase === 'running' || phase === 'ended';
    if (game) {
      drawHazards(g);
      drawItems(g);
      drawInterests(g);
      const trs = GM.state.contestants || [];
      drawAlliances(g, trs);
      drawBeasts(g);
      drawContestants(g, trs);
    }
    drawCamera(g);
    drawAim(g);
    drawScale(g);
    if (game) drawHoverLabel(g);
  }

  // --------------------------------------------------------------- input
  function localPos(e) {
    const r = M.canvas.getBoundingClientRect();
    const k = r.width > 0 ? cssS / r.width : 1;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
  }
  /** Contestant within `maxPx` CSS pixels of a canvas point (living first). */
  function contestantAtPx(lx, ly, maxPx) {
    const trs = GM.state.contestants;
    if (!trs || !trs.length || !(cssS > 0)) return null;
    const k = cssS / (VIEW * 2);
    let best = null, bd = maxPx * maxPx;
    for (let pass = 0; pass < 2 && !best; pass++) {
      for (let i = 0; i < trs.length; i++) {
        const tr = trs[i];
        if (!tr || !tr.pos || (pass === 0) !== !!tr.alive) continue;
        const dx = (tr.pos.x + VIEW) * k - lx, dy = (tr.pos.z + VIEW) * k - ly;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = tr; }
      }
    }
    return best;
  }
  function isGame() {
    const p = GM.state.phase;
    return p === 'countdown' || p === 'running' || p === 'ended';
  }
  function targeting() {
    const UIm = GM.UI;
    return !!(UIm && typeof UIm.isTargeting === 'function' && UIm.isTargeting());
  }
  function lookAt(x, z) {
    const C = GM.Cameras;
    if (C && typeof C.lookAt === 'function') {
      try { C.lookAt(x, z); } catch (e) { GM.reportError('Minimap.lookAt', e); }
    }
  }
  const _w = { x: 0, z: 0 };
  function bindInput(cv) {
    if (cv.__mmBound) return;
    cv.__mmBound = true;
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', function (e) {
      if (!isGame()) return;
      const p = localPos(e);
      press.on = true;
      press.id = e.pointerId;
      press.x = p.x; press.y = p.y;
      press.button = e.button;
      press.drag = false;
      press.lastLook = 0;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      e.preventDefault();
    });
    cv.addEventListener('pointermove', function (e) {
      const p = localPos(e);
      M.mapToWorld(p.x, p.y, _w);
      hover.on = true;
      hover.px = p.x; hover.py = p.y;
      hover.x = _w.x; hover.z = _w.z;
      hover.contestant = isGame() ? contestantAtPx(p.x, p.y, 8) : null;
      if (coordsEl) {
        const s = GM.t('minimap.coords', { x: Math.round(_w.x), z: Math.round(_w.z) });
        if (coordsEl.__t !== s) { coordsEl.__t = s; coordsEl.textContent = s; }
      }
      const tgt = targeting();
      if (tgt && clock - hover.lastAim > 0.03) {
        hover.lastAim = clock;
        try { GM.UI.aimPoint(_w.x, _w.z); } catch (err) { /* ignore */ }
      }
      if (press.on && press.button === 0 && !tgt) {
        const dx = p.x - press.x, dy = p.y - press.y;
        if (!press.drag && dx * dx + dy * dy > 36) press.drag = true;
        if (press.drag && clock - press.lastLook > 0.08) {
          press.lastLook = clock;
          lookAt(_w.x, _w.z);
        }
      }
      liveAcc = Math.max(liveAcc, LIVE_DT * 0.6);
    });
    const end = function (e) {
      if (!press.on || (press.id !== -1 && e.pointerId !== press.id)) return;
      press.on = false;
      try { cv.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (e.type === 'pointercancel' || press.drag) { press.drag = false; return; }
      const p = localPos(e);
      M.mapToWorld(p.x, p.y, _w);
      const UIm = GM.UI;
      if (press.button === 2) {
        if (targeting() && UIm.cancelTargeting) UIm.cancelTargeting();
        return;
      }
      if (press.button !== 0) return;
      if (targeting() && UIm.targetPoint) { UIm.targetPoint(_w.x, _w.z); return; }
      const tr = contestantAtPx(p.x, p.y, 7);
      if (tr && UIm && UIm.pickContestant) { UIm.pickContestant(tr.id); return; }
      lookAt(_w.x, _w.z);
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', function () {
      hover.on = false;
      hover.contestant = null;
      if (coordsEl) { coordsEl.__t = ''; coordsEl.textContent = ''; }
      liveAcc = LIVE_DT;
    });
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    cv.addEventListener('wheel', function (e) { e.preventDefault(); }, { passive: false });
  }

  // -------------------------------------------------------------- events
  GM.on('arena:generated', function () { dirty.full = true; dirty.urgent = true; dirty.rect = false; });
  GM.on('terrain:changed', function (e) {
    if (e && e.x != null) markRect(+e.x, +e.z, +e.radius || 20);
    else dirty.full = true;
  });
  GM.on('forest:burnt', function (e) {
    if (e && e.x != null) markRect(+e.x, +e.z, +e.radius || 8);
  });
  GM.on('water:changed', function () { dirty.full = true; });

  // -------------------------------------------------------------- system
  GM.registerSystem({
    name: 'Minimap',
    order: 105,
    init() {
      ensureImage();
      ensureCanvas();
    },
    clear() {
      hover.on = false;
      hover.contestant = null;
      press.on = false;
      press.drag = false;
      liveAcc = 99;
    },
    reset() {
      dirty.full = true;
      dirty.urgent = true;
    },
    frame(realDt) {
      const dt = realDt > 0 ? Math.min(realDt, 0.1) : 0;
      clock += dt;
      processDirty();
      if (!ensureCanvas()) return;
      liveAcc += dt;
      if (liveAcc < LIVE_DT) return;
      liveAcc = 0;
      if (!fitCanvas()) return;
      const tgt = targeting();
      const tipKey = tgt ? 'minimap.tipTarget' : 'minimap.tipLook';
      if (M.canvas.__tipKey !== tipKey) { M.canvas.__tipKey = tipKey; M.canvas.setAttribute('data-tip', tipKey); }
      M.canvas.style.cursor = tgt ? 'crosshair' : hover.contestant ? 'pointer' : 'default';
      try {
        drawLive();
      } catch (e) {
        GM.reportError('Minimap.draw', e);
      }
    },
  });
})();
