/* ==========================================================================
 * world.js — GM.World (renderer, scene, terrain mesh, water, props,
 * cornucopia, pedestals, force-field dome) and GM.FX (pooled effects).
 *
 *   World.renderer / scene / terrainMesh / water / sun / hemi
 *   World.rebuild()                 rebuild everything from GM.Terrain
 *   World.pedestals(n) -> [{x, y, z, heading}]
 *   World.setShadowFocus(x, z)      centre the sun's shadow camera
 *   World.trees                     [{x, z, scale, type, burnt, ...}] (instanced)
 *   World.burnTreesInArea(x, z, r)
 *   World.add(obj) / World.remove(obj, dispose)
 *
 *   FX.burst / FX.emit (pooled GPU points, normal + additive), FX.flash
 *   (pooled point lights), FX.ring (ground shock-wave), FX.beam (glow line).
 *
 * Style: stylised low-poly, flat shading, vertex / instance colours.
 * Env (env.js) animates the lights, fog and sky; World only creates them.
 * Owner: WORLD.
 * ========================================================================== */
(function () {
  'use strict';
  const GM = window.GM;
  const CFG = GM.CFG;
  const U = GM.U;
  const THREE = window.THREE;
  const TAU = Math.PI * 2;

  const World = (GM.World = {
    renderer: null,
    scene: null,
    terrainMesh: null,
    water: null,
    sun: null,
    hemi: null,
    trees: [],
    cornucopia: null,
    cornucopiaHeading: 0,     // the horn mouth faces +Z
    dome: null,
    sunDir: null,             // unit vector ground -> light (Env sets it)
    skyColor: null,           // colour reflected by the water (Env sets it)
  });
  const FX = (GM.FX = {});

  if (!THREE) {
    // main.js shows the fatal screen; keep every API callable.
    const noop = function () {};
    World.rebuild = World.setShadowFocus = World.burnTreesInArea = World.updateSun = noop;
    World.add = function (o) { return o; };
    World.remove = noop;
    World.pedestals = function (n) {
      const out = [];
      for (let i = 0; i < n; i++) {
        const a = (i / Math.max(1, n)) * TAU + Math.PI / Math.max(1, n);
        const x = Math.sin(a) * CFG.PEDESTAL_RADIUS, z = Math.cos(a) * CFG.PEDESTAL_RADIUS;
        out.push({ x, y: 2, z, heading: Math.atan2(-x, -z) });
      }
      return out;
    };
    FX.burst = FX.emit = FX.flash = FX.ring = FX.beam = FX.clear = FX.update = noop;
    return;
  }

  // ------------------------------------------------------------- constants
  const ARENA_R = CFG.ARENA_RADIUS;
  const PED_R = CFG.PEDESTAL_RADIUS;
  const PED_MAX = CFG.MAX_TRIBUTES;
  const PED_H = 0.32;                 // pedestal top above the plaza
  const SHADOW_EXT = 58;              // half size of the shadow camera (m)
  const SHADOW_MAP = 2048;
  const FLASH_LIGHTS = 4;

  // ----------------------------------------------------------------- temps
  const _v1 = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const _v3 = new THREE.Vector3();
  const _lx = new THREE.Vector3();
  const _ly = new THREE.Vector3();
  const _lz = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _q2 = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _m = new THREE.Matrix4();
  const _s = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const _c = new THREE.Color();
  const _c2 = new THREE.Color();
  const _vp4 = new THREE.Vector4();
  const UP = new THREE.Vector3(0, 1, 0);
  const ZAXIS = new THREE.Vector3(0, 0, 1);
  const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);

  // --------------------------------------------------------------- helpers
  function Tr() {
    const T = GM.Terrain;
    return T && T.heights && (typeof T.isReady !== 'function' || T.isReady()) ? T : null;
  }
  function groundY(x, z) {
    const T = GM.Terrain;
    if (!T || typeof T.heightAt !== 'function') return 0;
    const y = T.heightAt(x, z);
    return y === y ? y : 0;
  }
  function waterY() {
    const E = GM.Env;
    return E && typeof E.waterLevel === 'number' && E.waterLevel === E.waterLevel ? E.waterLevel : CFG.BASE_WATER_LEVEL;
  }
  function isLow() {
    const s = GM.state.settings;
    return !!(s && s.quality === 'low');
  }
  /** Deterministic hash -> [0, 1). */
  function hash(a, b, c) {
    let h = Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function disposeObject(obj) {
    if (!obj) return;
    obj.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      const m = o.material;
      if (Array.isArray(m)) { for (const x of m) if (x) x.dispose(); } else if (m) m.dispose();
      if (o.isInstancedMesh && typeof o.dispose === 'function') o.dispose();
    });
  }
  function removeMesh(mesh, disposeGeo) {
    if (!mesh) return null;
    if (mesh.parent) mesh.parent.remove(mesh);
    if (disposeGeo && mesh.geometry) mesh.geometry.dispose();
    if (mesh.isInstancedMesh && typeof mesh.dispose === 'function') mesh.dispose();
    return null;
  }
  function shadowsOn() { return !!(World.renderer && World.renderer.shadowMap.enabled); }

  /** Merge geometries (each [geometry, matrix, rgbHex|null]) into one flat-shaded non-indexed geometry. */
  function mergeGeometries(parts, withColor) {
    const list = [];
    let total = 0;
    for (const part of parts) {
      let g = part[0].index ? part[0].toNonIndexed() : part[0].clone();
      if (part[1]) g.applyMatrix4(part[1]);
      list.push([g, part[2]]);
      total += g.attributes.position.count;
    }
    const pos = new Float32Array(total * 3);
    const col = withColor ? new Float32Array(total * 3) : null;
    let o = 0;
    for (const item of list) {
      const a = item[0].attributes.position.array;
      pos.set(a, o * 3);
      if (col) {
        _c.set(item[1] != null ? item[1] : 0xffffff);
        const n = a.length / 3;
        for (let k = 0; k < n; k++) { col[(o + k) * 3] = _c.r; col[(o + k) * 3 + 1] = _c.g; col[(o + k) * 3 + 2] = _c.b; }
      }
      o += a.length / 3;
      item[0].dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    return geo;
  }

  /** Displace the vertices of a non-indexed geometry by a position hash (keeps faces closed). */
  function roughen(geo, seed, amount, flatBottom) {
    const a = geo.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) {
      const kx = Math.round(a[i] * 1000), ky = Math.round(a[i + 1] * 1000), kz = Math.round(a[i + 2] * 1000);
      const f = 1 + (hash(kx + seed, ky, kz) - 0.5) * 2 * amount;
      a[i] *= f * (1 + (hash(kz, kx, ky + seed) - 0.5) * amount * 0.6);
      a[i + 1] *= f;
      a[i + 2] *= f;
      if (flatBottom && a[i + 1] < -0.25) a[i + 1] = -0.25 + (a[i + 1] + 0.25) * 0.35;
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }

  /** Inject a gentle wind sway into a Lambert material used by an InstancedMesh. */
  const sway = { uSwayTime: { value: 0 }, uSwayAmp: { value: 0.03 } };
  function addSway(mat, name, scale, pivot) {
    const uScale = { value: scale };
    const uPivot = { value: pivot };
    mat.onBeforeCompile = function (shader) {
      shader.uniforms.uSwayTime = sway.uSwayTime;
      shader.uniforms.uSwayAmp = sway.uSwayAmp;
      shader.uniforms.uSwayScale = uScale;
      shader.uniforms.uSwayPivot = uPivot;
      shader.vertexShader = 'uniform float uSwayTime;\nuniform float uSwayAmp;\nuniform float uSwayScale;\nuniform float uSwayPivot;\n' +
        shader.vertexShader.replace('#include <begin_vertex>', [
          '#include <begin_vertex>',
          '#ifdef USE_INSTANCING',
          '  float swH = max(position.y - uSwayPivot, 0.0);',
          '  float swP = uSwayTime * 1.7 + instanceMatrix[3][0] * 0.37 + instanceMatrix[3][2] * 0.23;',
          '  transformed.x += sin(swP) * swH * uSwayAmp * uSwayScale;',
          '  transformed.z += cos(swP * 0.83 + 1.3) * swH * uSwayAmp * uSwayScale * 0.7;',
          '#endif',
        ].join('\n'));
    };
    mat.customProgramCacheKey = function () { return 'gm-sway-' + name; };
    return mat;
  }

  // ======================================================= renderer & scene
  let renderer = null, scene = null;
  let sun = null, hemi = null;
  let resizeBound = false;
  let appliedLow = null;

  function createRenderer() {
    let canvas = document.getElementById('gl');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'gl';
      canvas.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;display:block';
      document.body.insertBefore(canvas, document.body.firstChild);
    }
    if (!canvas.style.width) { canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.display = 'block'; }
    let r = null;
    try {
      r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      GM.reportError('World.renderer', e);
      try { r = new THREE.WebGLRenderer({ canvas, antialias: false }); } catch (e2) { GM.reportError('World.renderer.fallback', e2); return null; }
    }
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setSize(Math.max(1, window.innerWidth || 1), Math.max(1, window.innerHeight || 1), false);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setClearColor(0x0b1020, 1);
    return r;
  }

  function onResize() {
    if (!renderer) return;
    renderer.setSize(Math.max(1, window.innerWidth || 1), Math.max(1, window.innerHeight || 1), false);
  }

  /** Apply the quality setting (pixel ratio + shadows). Recompiles materials when shadows toggle. */
  function applyQuality() {
    const low = isLow();
    if (renderer) renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    if (appliedLow === low) return;
    appliedLow = low;
    if (renderer) {
      renderer.shadowMap.enabled = !low;
      renderer.shadowMap.needsUpdate = true;
    }
    if (sun) sun.castShadow = !low;
    if (scene) {
      scene.traverse(function (o) {
        const m = o.material;
        if (Array.isArray(m)) { for (const x of m) if (x) x.needsUpdate = true; } else if (m) m.needsUpdate = true;
      });
    }
  }

  function createScene() {
    scene = new THREE.Scene();
    scene.name = 'arena';
    scene.background = new THREE.Color(0xb8d4ea);
    scene.fog = new THREE.Fog(0xb8d4ea, 140, 900);
    World.scene = scene;

    hemi = new THREE.HemisphereLight(0xcfe6ff, 0x6f7a52, 0.62);
    hemi.name = 'hemi';
    scene.add(hemi);

    sun = new THREE.DirectionalLight(0xfff4e0, 1.0);
    sun.name = 'sun';
    sun.castShadow = true;
    sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    const sc = sun.shadow.camera;
    sc.left = -SHADOW_EXT; sc.right = SHADOW_EXT; sc.top = SHADOW_EXT; sc.bottom = -SHADOW_EXT;
    sc.near = 1; sc.far = 440;
    sc.updateProjectionMatrix();
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.045;
    scene.add(sun);
    scene.add(sun.target);
    World.sun = sun;
    World.hemi = hemi;
    World.sunDir = new THREE.Vector3(0.45, 0.78, 0.38).normalize();
    World.skyColor = new THREE.Color(0xa9cdf0);
    placeSun();
  }

  // --------------------------------------------------------- shadow focus
  const focus = new THREE.Vector3();
  /** Position the sun + shadow camera around the focus (snapped to shadow texels: no shimmer). */
  function placeSun() {
    if (!sun) return;
    const d = World.sunDir || _v1.set(0.45, 0.78, 0.38).normalize();
    _lz.copy(d).normalize();
    _lx.crossVectors(UP, _lz);
    if (_lx.lengthSq() < 1e-8) _lx.set(1, 0, 0);
    _lx.normalize();
    _ly.crossVectors(_lz, _lx);
    const texel = (2 * SHADOW_EXT) / SHADOW_MAP;
    const a = Math.round(focus.dot(_lx) / texel) * texel;
    const b = Math.round(focus.dot(_ly) / texel) * texel;
    const c = focus.dot(_lz);
    _v2.copy(_lx).multiplyScalar(a).addScaledVector(_ly, b).addScaledVector(_lz, c);
    sun.target.position.copy(_v2);
    sun.position.copy(_v2).addScaledVector(_lz, 220);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  }
  World.updateSun = placeSun;
  /** Centre the sun's shadow camera on a ground point (Cameras call this every frame). */
  World.setShadowFocus = function (x, z) {
    x = +x || 0; z = +z || 0;
    focus.set(x, groundY(x, z), z);
    placeSun();
  };

  // ============================================================ terrain mesh
  const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  let tGeo = null, tPos = null, tNor = null, tCol = null;
  let tRes = 0, tCell = 2, tHalf = 180;

  function buildTerrain() {
    World.terrainMesh = removeMesh(World.terrainMesh, true);
    tGeo = null;
    const T = Tr();
    if (!T) {
      // no terrain module: a flat meadow so the scene still works
      const g = new THREE.PlaneGeometry(CFG.MAP_SIZE, CFG.MAP_SIZE, 1, 1);
      g.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x6f9a48 }));
      mesh.receiveShadow = true;
      mesh.name = 'terrain';
      scene.add(mesh);
      World.terrainMesh = mesh;
      return;
    }
    tRes = T.res; tCell = T.cellSize; tHalf = T.half;
    const nq = (tRes - 1) * (tRes - 1);
    tPos = new Float32Array(nq * 18);
    tNor = new Float32Array(nq * 18);
    tCol = new Float32Array(nq * 18);
    writeQuads(T, 0, 0, tRes - 2, tRes - 2, true);
    tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage));
    tGeo.setAttribute('normal', new THREE.BufferAttribute(tNor, 3).setUsage(THREE.DynamicDrawUsage));
    tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3).setUsage(THREE.DynamicDrawUsage));
    tGeo.computeBoundingSphere();
    const mesh = new THREE.Mesh(tGeo, terrainMat);
    mesh.name = 'terrain';
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    scene.add(mesh);
    World.terrainMesh = mesh;
  }

  /** (Re)write the triangles of quads [qx0..qx1] x [qz0..qz1]. geo=false: colours only. */
  function writeQuads(T, qx0, qz0, qx1, qz1, geo) {
    const H = T.heights, C = T.colors, R = tRes;
    for (let qz = qz0; qz <= qz1; qz++) {
      for (let qx = qx0; qx <= qx1; qx++) {
        const i00 = qz * R + qx, i01 = i00 + R, i11 = i00 + R + 1, i10 = i00 + 1;
        const o = (qz * (R - 1) + qx) * 18;
        if (geo) {
          const x0 = -tHalf + qx * tCell, x1 = x0 + tCell, z0 = -tHalf + qz * tCell, z1 = z0 + tCell;
          writeTri(o, x0, H[i00], z0, x0, H[i01], z1, x1, H[i11], z1);
          writeTri(o + 9, x0, H[i00], z0, x1, H[i11], z1, x1, H[i10], z0);
        }
        if (C) {
          faceColor(o, C, i00, i01, i11, hash(qx, qz, 11));
          faceColor(o + 9, C, i00, i11, i10, hash(qx, qz, 29));
        }
      }
    }
  }
  function writeTri(o, ax, ay, az, bx, by, bz, cx, cy, cz) {
    tPos[o] = ax; tPos[o + 1] = ay; tPos[o + 2] = az;
    tPos[o + 3] = bx; tPos[o + 4] = by; tPos[o + 5] = bz;
    tPos[o + 6] = cx; tPos[o + 7] = cy; tPos[o + 8] = cz;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= l; ny /= l; nz /= l;
    tNor[o] = tNor[o + 3] = tNor[o + 6] = nx;
    tNor[o + 1] = tNor[o + 4] = tNor[o + 7] = ny;
    tNor[o + 2] = tNor[o + 5] = tNor[o + 8] = nz;
  }
  function faceColor(o, C, a, b, c, h) {
    const j = (1 + (h - 0.5) * 0.08) / (255 * 3);
    const r = (C[a * 3] + C[b * 3] + C[c * 3]) * j;
    const g = (C[a * 3 + 1] + C[b * 3 + 1] + C[c * 3 + 1]) * j;
    const bl = (C[a * 3 + 2] + C[b * 3 + 2] + C[c * 3 + 2]) * j;
    tCol[o] = tCol[o + 3] = tCol[o + 6] = r;
    tCol[o + 1] = tCol[o + 4] = tCol[o + 7] = g;
    tCol[o + 2] = tCol[o + 5] = tCol[o + 8] = bl;
  }

  /**
   * Refresh a world-space rectangle of the terrain mesh. The CPU arrays are written now;
   * the GPU upload is merged into one partial upload per frame (flushTerrainUpload).
   */
  let upCol0 = Infinity, upCol1 = -1, upGeo0 = Infinity, upGeo1 = -1;
  function refreshTerrainRect(x0, z0, x1, z1, geo) {
    const T = Tr();
    if (!T || !tGeo) return;
    const qx0 = U.clamp(Math.floor((x0 + tHalf) / tCell) - 1, 0, tRes - 2), qx1 = U.clamp(Math.ceil((x1 + tHalf) / tCell) + 1, 0, tRes - 2);
    const qz0 = U.clamp(Math.floor((z0 + tHalf) / tCell) - 1, 0, tRes - 2), qz1 = U.clamp(Math.ceil((z1 + tHalf) / tCell) + 1, 0, tRes - 2);
    if (qx1 < qx0 || qz1 < qz0) return;
    writeQuads(T, qx0, qz0, qx1, qz1, geo);
    const off = (qz0 * (tRes - 1) + qx0) * 18;
    const end = (qz1 * (tRes - 1) + qx1 + 1) * 18;
    if (off < upCol0) upCol0 = off;
    if (end > upCol1) upCol1 = end;
    if (geo) {
      if (off < upGeo0) upGeo0 = off;
      if (end > upGeo1) upGeo1 = end;
    }
  }
  function flushTerrainUpload() {
    if (tGeo) {
      if (upCol1 > upCol0) setRange(tGeo.attributes.color, upCol0, upCol1);
      if (upGeo1 > upGeo0) { setRange(tGeo.attributes.position, upGeo0, upGeo1); setRange(tGeo.attributes.normal, upGeo0, upGeo1); }
    }
    upCol0 = upGeo0 = Infinity;
    upCol1 = upGeo1 = -1;
  }
  function setRange(at, a, b) {
    at.updateRange.offset = a;
    at.updateRange.count = b - a;
    at.needsUpdate = true;
  }

  // ====================================================== backdrop mountains
  let backdrop = null;
  const backdropMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

  /** A ring of far mountains beyond the map edge, so the horizon is never empty. */
  function buildBackdrop(seed) {
    backdrop = removeMesh(backdrop, true);
    const noise = GM.Noise.create((seed ^ 0x51ed27) >>> 0);
    const A = 132;
    const RADII = [150, 186, 232, 292, 362, 452, 560, 690];
    const PROF = [-12, 22, 58, 104, 122, 96, 58, 12];
    const pts = [];
    for (let ri = 0; ri < RADII.length; ri++) {
      const row = [];
      for (let ai = 0; ai < A; ai++) {
        const a = (ai / A) * TAU;
        const r = RADII[ri] * (1 + (hash(ai, ri, 5) - 0.5) * 0.06);
        const x = Math.sin(a) * r, z = Math.cos(a) * r;
        const n = noise.ridged(x / 110 + 3, z / 110 - 7, 3);
        const n2 = noise.noise2(x / 40, z / 40);
        const h = PROF[ri] * (0.45 + 0.75 * n) + (ri > 1 && ri < 7 ? n2 * 9 : 0);
        row.push([x, h, z]);
      }
      pts.push(row);
    }
    const tris = (RADII.length - 1) * A * 2;
    const pos = new Float32Array(tris * 9), col = new Float32Array(tris * 9);
    let o = 0;
    const put = function (p, q, r) {
      pos.set(p, o); pos.set(q, o + 3); pos.set(r, o + 6);
      const h = (p[1] + q[1] + r[1]) / 3;
      const k = hash(o, 3, 7);
      if (h > 92 + k * 14) _c.setRGB(0.9, 0.92, 0.95);
      else if (h > 40) _c.setRGB(0.42 + k * 0.06, 0.41 + k * 0.05, 0.4 + k * 0.05);
      else _c.setRGB(0.22 + k * 0.05, 0.3 + k * 0.05, 0.2 + k * 0.03);
      for (let v = 0; v < 3; v++) { col[o + v * 3] = _c.r; col[o + v * 3 + 1] = _c.g; col[o + v * 3 + 2] = _c.b; }
      o += 9;
    };
    for (let ri = 0; ri < RADII.length - 1; ri++) {
      for (let ai = 0; ai < A; ai++) {
        const a0 = pts[ri][ai], a1 = pts[ri][(ai + 1) % A], b0 = pts[ri + 1][ai], b1 = pts[ri + 1][(ai + 1) % A];
        put(a0, b0, b1);
        put(a0, b1, a1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    // make sure faces point up (winding depends on the ring direction)
    const nrm = g.attributes.normal.array;
    for (let i = 0; i < nrm.length; i += 9) {
      if (nrm[i + 1] < 0) {
        for (let v = 0; v < 3; v++) { nrm[i + v * 3] *= -1; nrm[i + v * 3 + 1] *= -1; nrm[i + v * 3 + 2] *= -1; }
        // swap two vertices so the front face matches the normal
        for (let k = 0; k < 3; k++) { const t = pos[i + 3 + k]; pos[i + 3 + k] = pos[i + 6 + k]; pos[i + 6 + k] = t; }
      }
    }
    backdrop = new THREE.Mesh(g, backdropMat);
    backdrop.name = 'backdrop';
    backdrop.matrixAutoUpdate = false;
    backdrop.updateMatrix();
    scene.add(backdrop);
  }

  // =================================================================== water
  const WATER_VS = [
    'uniform float uLevel;',
    'uniform float uTime;',
    'attribute float aGround;',
    'varying float vDepth;',
    'varying vec3 vWorld;',
    '#include <fog_pars_vertex>',
    'void main() {',
    '  vec3 p = position;',
    '  float w = sin(p.x * 0.31 + uTime * 1.25) * 0.05 + sin(p.z * 0.27 - uTime * 1.05) * 0.045 + sin((p.x - p.z) * 0.53 + uTime * 1.9) * 0.02;',
    '  p.y = uLevel + w;',
    '  vDepth = uLevel - aGround;',
    '  vec4 wp = modelMatrix * vec4(p, 1.0);',
    '  vWorld = wp.xyz;',
    '  vec4 mvPosition = viewMatrix * wp;',
    '  gl_Position = projectionMatrix * mvPosition;',
    '  #include <fog_vertex>',
    '}',
  ].join('\n');
  const WATER_FS = [
    'uniform float uTime;',
    'uniform float uOpacity;',
    'uniform vec3 uShallow;',
    'uniform vec3 uDeep;',
    'uniform vec3 uSky;',
    'uniform vec3 uSunDir;',
    'uniform vec3 uSunColor;',
    'uniform vec3 uAmbient;',
    'varying float vDepth;',
    'varying vec3 vWorld;',
    '#include <fog_pars_fragment>',
    'vec2 waveGrad(vec2 p, float t) {',
    '  vec2 g = vec2(0.0);',
    '  vec2 d1 = vec2(0.8, 0.6);    g += d1 * cos(dot(d1, p) * 0.9 + t * 1.6) * 0.072;',
    '  vec2 d2 = vec2(-0.5, 0.866); g += d2 * cos(dot(d2, p) * 1.7 + t * 2.1) * 0.068;',
    '  vec2 d3 = vec2(0.95, -0.31); g += d3 * cos(dot(d3, p) * 3.1 + t * 2.9) * 0.056;',
    '  vec2 d4 = vec2(-0.2, -0.98); g += d4 * cos(dot(d4, p) * 5.3 + t * 3.7) * 0.042;',
    '  vec2 d5 = vec2(0.6, -0.8);   g += d5 * cos(dot(d5, p) * 8.9 + t * 4.3) * 0.03;',
    '  return g;',
    '}',
    'void main() {',
    '  if (vDepth < 0.0) discard;',
    '  vec2 g = waveGrad(vWorld.xz, uTime);',
    '  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));',
    '  vec3 V = normalize(cameraPosition - vWorld);',
    '  float ndv = max(dot(N, V), 0.0);',
    '  float fres = pow(1.0 - ndv, 4.0);',
    '  float depthK = smoothstep(0.0, 3.0, vDepth);',
    '  vec3 base = mix(uShallow, uDeep, depthK);',
    '  float diff = max(dot(N, uSunDir), 0.0);',
    '  vec3 col = base * (uAmbient + uSunColor * (0.35 + 0.45 * diff));',
    '  col = mix(col, uSky, clamp(fres * 0.85 + 0.08, 0.0, 0.85));',
    '  vec3 Hh = normalize(uSunDir + V);',
    '  float nh = max(dot(N, Hh), 0.0);',
    '  col += uSunColor * (pow(nh, 180.0) * 1.6 + pow(nh, 24.0) * 0.08);',
    '  float foamLine = 1.0 - smoothstep(0.0, 0.3, vDepth);',
    '  float ripple = 0.5 + 0.5 * sin(vDepth * 18.0 - uTime * 2.6 + sin(vWorld.x * 0.7 + vWorld.z * 0.5) * 1.5);',
    '  float foam = foamLine * (0.45 + 0.55 * ripple);',
    '  col = mix(col, (uAmbient + uSunColor * 0.7) * 0.95, foam * 0.75);',
    '  float alpha = clamp(0.42 + depthK * 0.46 + fres * 0.25 + foam * 0.4, 0.0, 0.96) * uOpacity;',
    '  gl_FragColor = vec4(col, alpha);',
    '  #include <fog_fragment>',
    '}',
  ].join('\n');

  let waterMat = null;
  let wGeo = null, wGround = null, wIndex = null, wThreshold = -Infinity;

  function makeWaterMaterial() {
    waterMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uLevel: { value: CFG.BASE_WATER_LEVEL },
        uTime: { value: 0 },
        uOpacity: { value: 1 },
        uShallow: { value: new THREE.Color(0x4fb6c4) },
        uDeep: { value: new THREE.Color(0x1b5d78) },
        uSky: { value: new THREE.Color(0xa9cdf0) },
        uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.4).normalize() },
        uSunColor: { value: new THREE.Color(0xfff4e0) },
        uAmbient: { value: new THREE.Color(0x7f8fa0) },
      }]),
      vertexShader: WATER_VS,
      fragmentShader: WATER_FS,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
  }

  function buildWater() {
    World.water = removeMesh(World.water, true);
    wGeo = null;
    const T = Tr();
    const R = T ? T.res : 2;
    const cell = T ? T.cellSize : CFG.MAP_SIZE;
    const half = T ? T.half : CFG.MAP_SIZE / 2;
    const pos = new Float32Array(R * R * 3);
    wGround = new Float32Array(R * R);
    for (let iz = 0; iz < R; iz++) {
      for (let ix = 0; ix < R; ix++) {
        const i = iz * R + ix;
        pos[i * 3] = -half + ix * cell;
        pos[i * 3 + 1] = 0;
        pos[i * 3 + 2] = -half + iz * cell;
        wGround[i] = T ? T.heights[i] : -2;
      }
    }
    wGeo = new THREE.BufferGeometry();
    wGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    wGeo.setAttribute('aGround', new THREE.BufferAttribute(wGround, 1).setUsage(THREE.DynamicDrawUsage));
    const IndexArr = R * R > 65535 ? Uint32Array : Uint16Array;
    wIndex = new THREE.BufferAttribute(new IndexArr((R - 1) * (R - 1) * 6), 1).setUsage(THREE.DynamicDrawUsage);
    wGeo.setIndex(wIndex);
    wThreshold = -Infinity;
    rebuildWaterIndex(Math.max(CFG.BASE_WATER_LEVEL, waterY()) + 6);
    const mesh = new THREE.Mesh(wGeo, waterMat);
    mesh.name = 'water';
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    scene.add(mesh);
    World.water = mesh;
  }

  /** Only cells that can hold water (min corner below threshold) get triangles. */
  function rebuildWaterIndex(threshold) {
    if (!wGeo) return;
    const T = Tr();
    const R = T ? T.res : 2;
    const H = wGround;
    const idx = wIndex.array;
    let n = 0;
    for (let qz = 0; qz < R - 1; qz++) {
      for (let qx = 0; qx < R - 1; qx++) {
        const i00 = qz * R + qx, i01 = i00 + R, i11 = i00 + R + 1, i10 = i00 + 1;
        let mn = H[i00];
        if (H[i01] < mn) mn = H[i01];
        if (H[i11] < mn) mn = H[i11];
        if (H[i10] < mn) mn = H[i10];
        if (mn >= threshold) continue;
        idx[n++] = i00; idx[n++] = i01; idx[n++] = i11;
        idx[n++] = i00; idx[n++] = i11; idx[n++] = i10;
      }
    }
    wIndex.needsUpdate = true;
    wGeo.setDrawRange(0, n);
    wThreshold = threshold;
  }

  function refreshWaterGround() {
    const T = Tr();
    if (!T || !wGeo) return;
    wGround.set(T.heights);
    wGeo.attributes.aGround.needsUpdate = true;
    rebuildWaterIndex(Math.max(CFG.BASE_WATER_LEVEL, waterY()) + 6);
  }

  // ===================================================== force-field dome
  const DOME_VS = [
    'varying vec3 vLocal;',
    'varying vec3 vWorld;',
    'varying vec3 vNrm;',
    '#include <fog_pars_vertex>',
    'void main() {',
    '  vLocal = position;',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  vWorld = wp.xyz;',
    '  vNrm = normalize(mat3(modelMatrix) * normal);',
    '  vec4 mvPosition = viewMatrix * wp;',
    '  gl_Position = projectionMatrix * mvPosition;',
    '  #include <fog_vertex>',
    '}',
  ].join('\n');
  const DOME_FS = [
    'uniform float uTime;',
    'uniform float uStrength;',
    'uniform vec3 uColor;',
    'varying vec3 vLocal;',
    'varying vec3 vWorld;',
    'varying vec3 vNrm;',
    '#include <fog_pars_fragment>',
    'float hexDist(vec2 p) { p = abs(p); return max(dot(p, vec2(0.5, 0.8660254)), p.x); }',
    'void main() {',
    '  vec3 p = normalize(vLocal);',
    '  float az = atan(p.x, p.z);',
    '  float el = asin(clamp(p.y, -1.0, 1.0));',
    '  vec2 uv = vec2(az * 15.2788, el * 15.2788);',          // 48 hexes around the ring
    '  vec2 r = vec2(1.0, 1.7320508);',
    '  vec2 h = r * 0.5;',
    '  vec2 a = mod(uv, r) - h;',
    '  vec2 b = mod(uv - h, r) - h;',
    '  vec2 gv = dot(a, a) < dot(b, b) ? a : b;',
    '  vec2 id = uv - gv;',
    '  float edge = 0.5 - hexDist(gv);',
    '  float line = 1.0 - smoothstep(0.0, 0.045, edge);',
    '  float rnd = fract(sin(dot(id, vec2(12.9898, 78.233))) * 43758.5453);',
    '  float pulse = 0.5 + 0.5 * sin(uTime * (0.5 + rnd * 1.2) + rnd * 6.2831);',
    '  float band = 1.0 - abs(fract(el * 0.9 - uTime * 0.06) - 0.5) * 2.0;',
    '  band = pow(band, 6.0);',
    '  vec3 V = normalize(cameraPosition - vWorld);',
    '  float fres = pow(1.0 - abs(dot(normalize(vNrm), V)), 2.5);',
    '  float base = 1.0 - smoothstep(0.0, 0.3, el);',
    '  float cellGlow = step(0.955, rnd) * pulse * 0.35;',
    '  float a2 = line * (0.22 + 0.3 * pulse) + fres * 0.3 + base * 0.35 + band * (0.12 + line * 0.5) + cellGlow;',
    '  a2 *= 1.0 - smoothstep(1.05, 1.45, el) * 0.85;',
    '  a2 *= uStrength;',
    '  #ifdef USE_FOG',
    '    #ifdef FOG_EXP2',
    '      a2 *= 1.0 - (1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth)) * 0.6;',
    '    #else',
    '      a2 *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth) * 0.6;',
    '    #endif',
    '  #endif',
    '  gl_FragColor = vec4(uColor, clamp(a2, 0.0, 1.0));',
    '}',
  ].join('\n');
  let domeMat = null;

  function buildDome() {
    domeMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 },
        uStrength: { value: 0.4 },
        uColor: { value: new THREE.Color(0x6fd0ff) },
      }]),
      vertexShader: DOME_VS,
      fragmentShader: DOME_FS,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: true,
    });
    const g = new THREE.SphereGeometry(ARENA_R, 96, 30, 0, TAU, 0, Math.PI / 2);
    const dome = new THREE.Mesh(g, domeMat);
    dome.name = 'forcefield';
    dome.renderOrder = 6;
    dome.frustumCulled = false;
    dome.matrixAutoUpdate = false;
    dome.updateMatrix();
    scene.add(dome);
    World.dome = dome;
  }

  // ============================================================= cornucopia
  const HORN_PTS = [
    [0, 2.4, 3.0], [0.2, 1.9, -0.6], [0.5, 1.4, -4.2], [0.8, 1.05, -7.1], [1.05, 1.9, -9.4],
    [1.15, 3.5, -10.5], [1.0, 4.8, -9.8], [0.75, 5.2, -8.4], [0.5, 4.7, -7.4],
  ];
  function hornRadius(u) { return 0.09 + 2.31 * Math.pow(1 - u, 1.35); }

  function buildCornucopia() {
    const group = new THREE.Group();
    group.name = 'cornucopia';
    const curve = new THREE.CatmullRomCurve3(HORN_PTS.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); }), false, 'centripetal');
    const segs = 96, radial = 24;
    const frames = curve.computeFrenetFrames(segs, false);
    const pos = [], idx = [];
    for (let k = 0; k <= segs; k++) {
      const u = k / segs;
      const P = curve.getPointAt(u);
      const N = frames.normals[k], B = frames.binormals[k];
      const r0 = hornRadius(u);
      for (let j = 0; j <= radial; j++) {
        const v = (j / radial) * TAU;
        const flute = 1 + 0.055 * Math.cos(v * 6 + u * 9) * (1 - u * 0.5);
        const r = r0 * flute;
        const cx = Math.cos(v), sx = Math.sin(v);
        pos.push(P.x + (cx * N.x + sx * B.x) * r, P.y + (cx * N.y + sx * B.y) * r, P.z + (cx * N.z + sx * B.z) * r);
      }
    }
    for (let k = 0; k < segs; k++) {
      for (let j = 0; j < radial; j++) {
        const a = k * (radial + 1) + j, b = a + radial + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const gold = new THREE.MeshPhongMaterial({
      color: 0xd6a23a, specular: 0xffe9a8, shininess: 80, emissive: 0x2e1c02,
      flatShading: true, side: THREE.DoubleSide,
    });
    const horn = new THREE.Mesh(g, gold);
    horn.castShadow = true;
    horn.receiveShadow = true;
    group.add(horn);

    const bright = new THREE.MeshPhongMaterial({ color: 0xf2c455, specular: 0xfff2c0, shininess: 100, emissive: 0x3a2604, flatShading: true });
    const dark = new THREE.MeshPhongMaterial({ color: 0xa8741e, specular: 0xffd88a, shininess: 60, emissive: 0x1e1202, flatShading: true });
    const addRing = function (u, tube, mat, extra) {
      const P = curve.getPointAt(u);
      const tan = curve.getTangentAt(u);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(hornRadius(u) * 1.03 + extra, tube, 8, 40), mat);
      ring.position.copy(P);
      ring.quaternion.setFromUnitVectors(ZAXIS, tan);
      ring.castShadow = true;
      group.add(ring);
    };
    addRing(0, 0.2, bright, 0.08);
    addRing(0.24, 0.11, dark, 0.02);
    addRing(0.48, 0.09, dark, 0.02);
    addRing(0.7, 0.06, bright, 0.01);
    // dark interior so the mouth reads as deep
    const du = 0.1;
    const inner = new THREE.Mesh(new THREE.CircleGeometry(hornRadius(du) * 1.05, 28), new THREE.MeshBasicMaterial({ color: 0x160f06 }));
    inner.position.copy(curve.getPointAt(du));
    inner.quaternion.setFromUnitVectors(ZAXIS, curve.getTangentAt(du).negate());
    group.add(inner);
    // golden finial at the tip
    const tip = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), bright);
    tip.position.copy(curve.getPointAt(1));
    group.add(tip);

    group.userData.mouthHeading = 0;
    group.userData.mouth = { x: 0, z: 3 };
    scene.add(group);
    World.cornucopia = group;
    World.cornucopiaHeading = 0;
  }
  function placeCornucopia() {
    if (!World.cornucopia) return;
    World.cornucopia.position.set(0, groundY(0, 0) - 0.04, 0);
    World.cornucopia.updateMatrixWorld(true);
  }

  // ============================================================== pedestals
  let pedBody = null, pedGlow = null, pedCount = 0;
  const pedList = [];

  function buildPedestalMeshes() {
    const m1 = new THREE.Matrix4().makeTranslation(0, 0.11, 0);
    const m2 = new THREE.Matrix4().makeTranslation(0, 0.27, 0);
    const geo = mergeGeometries([
      [new THREE.CylinderGeometry(1.0, 1.14, 0.22, 16), m1, 0x4a5058],
      [new THREE.CylinderGeometry(0.86, 0.96, 0.1, 16), m2, 0xa3acb6],
    ], true);
    const mat = new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0x9aa4b0, shininess: 70, flatShading: true });
    pedBody = new THREE.InstancedMesh(geo, mat, PED_MAX);
    pedBody.name = 'pedestals';
    pedBody.castShadow = true;
    pedBody.receiveShadow = true;
    pedBody.frustumCulled = false;
    const rg = new THREE.RingGeometry(0.64, 0.72, 28);
    rg.rotateX(-Math.PI / 2);
    rg.translate(0, PED_H + 0.012, 0);
    pedGlow = new THREE.InstancedMesh(rg, new THREE.MeshBasicMaterial({ color: 0x86dcff }), PED_MAX);
    pedGlow.name = 'pedestalGlow';
    pedGlow.frustumCulled = false;
    for (let i = 0; i < PED_MAX; i++) { pedBody.setMatrixAt(i, ZERO_M); pedGlow.setMatrixAt(i, ZERO_M); }
    pedBody.count = 0;
    pedGlow.count = 0;
    scene.add(pedBody);
    scene.add(pedGlow);
  }

  /**
   * n start positions on the pedestal ring, facing the centre; also shows n pedestal meshes.
   * -> [{x, y (top of the pedestal), z, heading}]
   */
  World.pedestals = function (n) {
    n = U.clamp(n | 0, 0, PED_MAX);
    const out = [];
    pedList.length = 0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + Math.PI / n;       // no pedestal right in front of the horn mouth
      const x = Math.sin(a) * PED_R, z = Math.cos(a) * PED_R;
      const gy = groundY(x, z);
      const heading = Math.atan2(-x, -z);
      out.push({ x, y: gy + PED_H, z, heading });
      pedList.push({ x, z, heading });
    }
    pedCount = n;
    snapPedestals();
    return out;
  };
  function snapPedestals() {
    if (!pedBody) return;
    for (let i = 0; i < pedList.length; i++) {
      const p = pedList[i];
      _p.set(p.x, groundY(p.x, p.z), p.z);
      _q.setFromAxisAngle(UP, p.heading);
      _s.set(1, 1, 1);
      _m.compose(_p, _q, _s);
      pedBody.setMatrixAt(i, _m);
      pedGlow.setMatrixAt(i, _m);
    }
    pedBody.count = pedList.length;
    pedGlow.count = pedList.length;
    pedBody.instanceMatrix.needsUpdate = true;
    pedGlow.instanceMatrix.needsUpdate = true;
  }

  // ================================================================== props
  const TREE_STEP = 3.2;              // tree candidate grid spacing (m)
  const TB = 16;                      // tree bucket size (m) for area queries
  const PINE_PIVOT = 1.2;             // crown base height (local units)
  const BROAD_PIVOT = 2.1;
  const BURNT_K = 0.55;               // burnt crowns shrink to this size
  const GRASS_MAX = 3200;
  const GRASS_R0 = 24.5, GRASS_R1 = 96;
  const BURNT_TRUNK = 0x1b1714;

  let trunkGeo = null, pineGeo = null, broadGeo = null, rockGeoA = null, rockGeoB = null, tuftGeo = null;
  let trunkMat = null, pineMat = null, broadMat = null, rockMat = null, grassMat = null;
  let trunkMesh = null, pineMesh = null, broadMesh = null, rockMeshA = null, rockMeshB = null, grassMesh = null;
  let treeBuckets = [], tbN = 1, tbHalf = CFG.MAP_SIZE / 2;
  let treesDirty = false, rocksDirty = false, grassDirty = false;
  const rockData = [];                // {x, z, lift, b, idx, rot, tx, tz, sx, sy, sz, col}
  let grassN = 0;
  const grassX = new Float32Array(GRASS_MAX), grassZ = new Float32Array(GRASS_MAX);
  const grassRot = new Float32Array(GRASS_MAX), grassS = new Float32Array(GRASS_MAX), grassSY = new Float32Array(GRASS_MAX);
  const grassCol = new Float32Array(GRASS_MAX * 3);
  const grassBurnt = new Uint8Array(GRASS_MAX);
  const _rgb = { r: 0, g: 0, b: 0 };

  function pack(c) {
    return (((U.clamp01(c.r) * 255) | 0) << 16) | (((U.clamp01(c.g) * 255) | 0) << 8) | ((U.clamp01(c.b) * 255) | 0);
  }
  function unpack(h, c) { return c.setRGB(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255); }
  function mtx(x, y, z, sx, sy, sz, ry) {
    _q2.setFromAxisAngle(UP, ry || 0);
    return new THREE.Matrix4().compose(_v3.set(x, y, z), _q2, _s.set(sx, sy, sz));
  }

  /** Shared low-poly geometries and materials for trees, rocks and grass (built once). */
  function buildPropGeometries() {
    const tg = new THREE.CylinderGeometry(0.15, 0.24, 2.6, 6, 1, true);
    trunkGeo = mergeGeometries([[tg, mtx(0, 1.3, 0, 1, 1, 1, 0), null]], false);
    tg.dispose();

    const c1 = new THREE.ConeGeometry(1.75, 2.7, 7), c2 = new THREE.ConeGeometry(1.38, 2.4, 7), c3 = new THREE.ConeGeometry(0.98, 2.1, 7);
    pineGeo = mergeGeometries([
      [c1, mtx(0, PINE_PIVOT + 1.35, 0, 1, 1, 1, 0), 0xb4c0b4],
      [c2, mtx(0, 2.75 + 1.2, 0, 1, 1, 1, 0.45), 0xd4dcd2],
      [c3, mtx(0, 4.2 + 1.05, 0, 1, 1, 1, 0.9), 0xf0f4ee],
    ], true);
    c1.dispose(); c2.dispose(); c3.dispose();

    const b1 = roughen(new THREE.IcosahedronGeometry(1.55, 0), 3, 0.22, false);
    const b2 = roughen(new THREE.IcosahedronGeometry(1.05, 0), 5, 0.25, false);
    const b3 = roughen(new THREE.IcosahedronGeometry(0.95, 0), 7, 0.25, false);
    broadGeo = mergeGeometries([
      [b1, mtx(0, 3.6, 0, 1, 0.85, 1, 0), 0xd2dacb],
      [b2, mtx(0.75, 4.35, 0.35, 1, 0.9, 1, 0.7), 0xeef2e8],
      [b3, mtx(-0.7, 3.25, -0.45, 1, 0.9, 1, 1.9), 0xc2ccbc],
    ], true);
    b1.dispose(); b2.dispose(); b3.dispose();

    rockGeoA = roughen(new THREE.IcosahedronGeometry(1, 1), 11, 0.2, true);
    rockGeoB = roughen(new THREE.DodecahedronGeometry(1, 0), 13, 0.16, true);
    tuftGeo = makeTuftGeometry();

    trunkMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    pineMat = addSway(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 'pine', 1, PINE_PIVOT);
    broadMat = addSway(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 'broad', 1, BROAD_PIVOT);
    rockMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    grassMat = addSway(new THREE.MeshLambertMaterial({ vertexColors: true }), 'grass', 3.5, 0);
  }

  /** A tuft of 6 thin blades; every blade has both windings and upward normals (evenly lit). */
  function makeTuftGeometry() {
    const pos = [], col = [], nrm = [];
    const B = 6;
    for (let b = 0; b < B; b++) {
      const a = (b / B) * TAU + hash(b, 3, 9) * 0.9;
      const sa = Math.sin(a), ca = Math.cos(a);
      const lean = 0.07 + hash(b, 5, 1) * 0.16;
      const h = 0.3 + hash(b, 7, 2) * 0.32;
      const w = 0.045 + hash(b, 8, 4) * 0.035;
      const ox = sa * 0.06, oz = ca * 0.06;
      const px = ca * w, pz = -sa * w;
      const tx = ox + sa * lean, tz = oz + ca * lean;
      pos.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, tx, h, tz);
      pos.push(ox + px, 0, oz + pz, ox - px, 0, oz - pz, tx, h, tz);
      for (let k = 0; k < 2; k++) col.push(0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 1.22, 1.22, 1.12);
    }
    for (let k = 0; k < pos.length / 3; k++) nrm.push(0, 1, 0);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  }

  function makeInst(geo, mat, count, name, castShadow) {
    if (!geo || count <= 0) return null;
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.name = name;
    m.frustumCulled = false;          // r149 culls instanced meshes by the base geometry only
    m.castShadow = !!castShadow;
    m.receiveShadow = true;
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3);
    scene.add(m);
    return m;
  }
  function markInst(m) {
    if (!m) return;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------------------ trees
  function placeTrees(T) {
    const trees = World.trees;
    trees.length = 0;
    const keep = isLow() ? 0.6 : 1;
    const sd = (T.seed | 0) & 0xfffff;
    const half = T.half - 3;
    const n = Math.floor((2 * half) / TREE_STEP);
    const wl = CFG.BASE_WATER_LEVEL;
    let pines = 0, broads = 0;
    for (let gz = 0; gz < n; gz++) {
      for (let gx = 0; gx < n; gx++) {
        const x = -half + (gx + 0.15 + 0.7 * hash(gx, gz + sd, 102)) * TREE_STEP;
        const z = -half + (gz + 0.15 + 0.7 * hash(gx + sd, gz, 103)) * TREE_STEP;
        const cover = T.forestAt(x, z);
        const r = Math.sqrt(x * x + z * z);
        const lone = cover <= 0.04;
        const p = lone ? (r > 40 && r < ARENA_R - 4 ? 0.01 : 0) : U.smoothstep(0.04, 0.6, cover) * 0.9;
        if (hash(gx + sd, gz, 101) >= p * keep) continue;
        const biome = T.biomeAt(x, z);
        if (biome === 'water' || biome === 'plaza' || biome === 'sand' || biome === 'snow') continue;
        if (lone && biome !== 'grass') continue;
        const y = groundY(x, z);
        if (y < wl + 0.35) continue;
        const slope = T.slopeAt(x, z);
        if (slope > 0.55) continue;
        const patch = hash((gx >> 3) + sd, gz >> 3, 104);
        const pine = patch * 0.7 + U.clamp01((y - 5) / 18) * 0.8 + (biome === 'rock' ? 0.4 : 0) - (biome === 'swamp' ? 0.5 : 0) > 0.55;
        const h1 = hash(gx, gz, 105 + sd), h2 = hash(gx, gz, 106), h3 = hash(gx, gz, 107), h4 = hash(gx, gz, 109);
        const tr = {
          x, z, y: 0,
          scale: (0.72 + h1 * 0.5) * (0.85 + 0.3 * cover) * (r > ARENA_R ? 1.15 : 1),
          type: pine ? 'pine' : 'broad',
          burnt: false,
          hidden: false,
          sink: 0.12 + slope * 1.1,
          w: pine ? 0.82 + h2 * 0.3 : 0.9 + h2 * 0.35,
          h: pine ? 1.0 + h3 * 0.35 : 0.85 + h3 * 0.3,
          rot: hash(gx, gz, 108) * TAU,
          ti: trees.length,
          ci: pine ? pines++ : broads++,
          col: 0,
          tcol: 0,
        };
        tr.y = y - tr.sink;
        if (pine) _c.setHSL(0.36 + (h4 - 0.5) * 0.06, 0.4 + h2 * 0.15, 0.19 + h3 * 0.07);
        else if (h4 < 0.04) _c.setHSL(0.07 + h1 * 0.05, 0.62, 0.38);             // a few autumn trees
        else _c.setHSL(0.25 + (h4 - 0.5) * 0.08, 0.48 + h2 * 0.15, 0.26 + h3 * 0.08);
        tr.col = pack(_c);
        _c.setHSL(0.07 + h1 * 0.03, 0.35, 0.19 + h2 * 0.06);
        tr.tcol = pack(_c);
        trees.push(tr);
      }
    }
    trunkMesh = makeInst(trunkGeo, trunkMat, trees.length, 'treeTrunks', true);
    pineMesh = makeInst(pineGeo, pineMat, pines, 'pines', true);
    broadMesh = makeInst(broadGeo, broadMat, broads, 'broadleaves', true);
    tbHalf = T.half;
    tbN = Math.max(1, Math.ceil(T.size / TB));
    treeBuckets = new Array(tbN * tbN);
    for (let i = 0; i < treeBuckets.length; i++) treeBuckets[i] = [];
    for (const tr of trees) {
      writeTree(tr);
      const bx = U.clamp(Math.floor((tr.x + tbHalf) / TB), 0, tbN - 1), bz = U.clamp(Math.floor((tr.z + tbHalf) / TB), 0, tbN - 1);
      treeBuckets[bz * tbN + bx].push(tr.ti);
    }
  }

  function writeTree(tr) {
    const crown = tr.type === 'pine' ? pineMesh : broadMesh;
    if (!trunkMesh || !crown) return;
    if (tr.hidden) {
      trunkMesh.setMatrixAt(tr.ti, ZERO_M);
      crown.setMatrixAt(tr.ci, ZERO_M);
      return;
    }
    const s = tr.scale;
    _q.setFromAxisAngle(UP, tr.rot);
    _p.set(tr.x, tr.y, tr.z);
    _s.set(s * tr.w, s * tr.h, s * tr.w);
    _m.compose(_p, _q, _s);
    trunkMesh.setMatrixAt(tr.ti, _m);
    if (tr.burnt) {
      // shrink the crown around its base so the charred trunk shows
      _p.y += s * tr.h * (tr.type === 'pine' ? PINE_PIVOT : BROAD_PIVOT) * (1 - BURNT_K);
      _s.multiplyScalar(BURNT_K);
      _m.compose(_p, _q, _s);
    }
    crown.setMatrixAt(tr.ci, _m);
    trunkMesh.setColorAt(tr.ti, unpack(tr.burnt ? BURNT_TRUNK : tr.tcol, _c));
    crown.setColorAt(tr.ci, unpack(tr.burnt ? ((tr.ti & 3) === 0 ? 0x3a2a21 : 0x27231f) : tr.col, _c));
  }

  // ------------------------------------------------------------------ rocks
  function placeRocks(T) {
    rockData.length = 0;
    const list = T.rocks || [];
    const low = isLow();
    const sd = T.seed | 0;
    let na = 0, nb = 0;
    for (let i = 0; i < list.length; i++) {
      const rk = list[i];
      if (!rk || !Number.isFinite(rk.x) || !Number.isFinite(rk.z)) continue;
      if (low && !rk.block && rk.kind === 'stone' && hash(i, 3, sd) > 0.6) continue;
      const useB = rk.kind === 'slab' || hash(i, 5, sd) < 0.45;
      const s = rk.s || 1;
      const tilt = rk.kind !== 'slab' && !rk.block;
      const d = {
        x: rk.x, z: rk.z, lift: rk.lift || 0, b: useB, idx: useB ? nb++ : na++, rot: rk.rot || 0,
        tx: tilt ? (hash(i, 7, sd) - 0.5) * 0.3 : 0, tz: tilt ? (hash(i, 8, sd) - 0.5) * 0.3 : 0,
        sx: s * (rk.sx || 1), sy: s * (rk.sy || 1), sz: s * (rk.sz || 1), col: 0,
      };
      const k = hash(i, 9, sd);
      if (groundY(rk.x, rk.z) > 42) _c.setRGB(0.8 + k * 0.08, 0.82 + k * 0.08, 0.86 + k * 0.06);
      else {
        _c.setRGB(0.5 + k * 0.14, 0.48 + k * 0.12, 0.45 + k * 0.1);
        if (rk.kind === 'stone') _c.multiplyScalar(1.08);
        if (T.forestAt(rk.x, rk.z) > 0.2 || T.biomeAt(rk.x, rk.z) === 'swamp') _c.lerp(_c2.setRGB(0.36, 0.45, 0.3), 0.3);
      }
      if (rk.kind === 'slab') _c.multiplyScalar(0.92);
      d.col = pack(_c);
      rockData.push(d);
    }
    rockMeshA = makeInst(rockGeoA, rockMat, na, 'rocksA', true);
    rockMeshB = makeInst(rockGeoB, rockMat, nb, 'rocksB', true);
    for (const d of rockData) writeRock(d);
  }
  function writeRock(d) {
    const mesh = d.b ? rockMeshB : rockMeshA;
    if (!mesh) return;
    _e.set(d.tx, d.rot, d.tz, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(d.x, groundY(d.x, d.z) + d.lift, d.z);
    _s.set(d.sx, d.sy, d.sz);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(d.idx, _m);
    mesh.setColorAt(d.idx, unpack(d.col, _c));
  }

  // ------------------------------------------------------------------ grass
  function placeGrass(T) {
    grassN = 0;
    const low = isLow();
    const sd = T.seed | 0;
    const step = 1.5;
    const n = Math.ceil((GRASS_R1 * 2) / step);
    const wl = CFG.BASE_WATER_LEVEL;
    for (let gz = 0; gz < n && grassN < GRASS_MAX; gz++) {
      for (let gx = 0; gx < n && grassN < GRASS_MAX; gx++) {
        const x = -GRASS_R1 + (gx + hash(gx, gz, 201 + sd)) * step;
        const z = -GRASS_R1 + (gz + hash(gx + sd, gz, 202)) * step;
        const r = Math.sqrt(x * x + z * z);
        if (r < GRASS_R0 || r > GRASS_R1) continue;
        const p = (0.62 * (1 - U.smoothstep(GRASS_R0 + 4, GRASS_R1, r)) + 0.05) * (low ? 0.5 : 1);
        if (hash(gx, gz, 203 + sd) >= p) continue;
        const biome = T.biomeAt(x, z);
        if (biome !== 'grass' && biome !== 'swamp' && biome !== 'forest') continue;
        if (groundY(x, z) < wl + 0.25 || T.slopeAt(x, z) > 0.45) continue;
        const i = grassN++;
        grassX[i] = x;
        grassZ[i] = z;
        grassRot[i] = hash(gx, gz, 204) * TAU;
        grassS[i] = 0.75 + hash(gx, gz, 205) * 0.6;
        grassSY[i] = 0.7 + hash(gx, gz, 206) * 0.7;
        grassBurnt[i] = 0;
        const c = T.colorAt(x, z, _rgb);
        const k = 1.05 + hash(gx, gz, 207) * 0.2;
        grassCol[i * 3] = (c.r / 255) * k;
        grassCol[i * 3 + 1] = (c.g / 255) * k * 1.12;
        grassCol[i * 3 + 2] = (c.b / 255) * k * 0.95;
      }
    }
    grassMesh = makeInst(tuftGeo, grassMat, grassN, 'grass', false);
    for (let i = 0; i < grassN; i++) writeGrass(i);
  }
  function writeGrass(i) {
    if (!grassMesh) return;
    const x = grassX[i], z = grassZ[i];
    const gy = groundY(x, z);
    if (gy < CFG.BASE_WATER_LEVEL - 0.1) { grassMesh.setMatrixAt(i, ZERO_M); return; }
    const burnt = grassBurnt[i] === 1;
    _q.setFromAxisAngle(UP, grassRot[i]);
    _p.set(x, gy - 0.03, z);
    _s.set(grassS[i], grassSY[i] * (burnt ? 0.4 : 1), grassS[i]);
    _m.compose(_p, _q, _s);
    grassMesh.setMatrixAt(i, _m);
    if (burnt) _c.setRGB(0.13, 0.11, 0.1);
    else _c.setRGB(grassCol[i * 3], grassCol[i * 3 + 1], grassCol[i * 3 + 2]);
    grassMesh.setColorAt(i, _c);
  }

  function buildProps(T) {
    trunkMesh = removeMesh(trunkMesh, false);
    pineMesh = removeMesh(pineMesh, false);
    broadMesh = removeMesh(broadMesh, false);
    rockMeshA = removeMesh(rockMeshA, false);
    rockMeshB = removeMesh(rockMeshB, false);
    grassMesh = removeMesh(grassMesh, false);
    World.trees.length = 0;
    rockData.length = 0;
    grassN = 0;
    treeBuckets = [];
    treesDirty = rocksDirty = grassDirty = false;
    if (!T || !trunkGeo) return;
    placeTrees(T);
    placeRocks(T);
    placeGrass(T);
  }

  function flushInstances() {
    if (treesDirty) { treesDirty = false; markInst(trunkMesh); markInst(pineMesh); markInst(broadMesh); }
    if (rocksDirty) { rocksDirty = false; markInst(rockMeshA); markInst(rockMeshB); }
    if (grassDirty) { grassDirty = false; markInst(grassMesh); }
  }

  // ------------------------------------------------------------ fire damage
  /** Char and shrink trees (and grass) within r of (x, z); also refreshes the ground colours. -> trees burnt */
  World.burnTreesInArea = function (x, z, r) {
    x = +x; z = +z; r = +r || 0;
    if (!Number.isFinite(x) || !Number.isFinite(z) || !(r >= 0)) return 0;
    const rr = r + 0.6, rr2 = rr * rr;
    let n = 0;
    if (trunkMesh && treeBuckets.length) {
      const trees = World.trees;
      const bx0 = U.clamp(Math.floor((x - rr + tbHalf) / TB), 0, tbN - 1), bx1 = U.clamp(Math.floor((x + rr + tbHalf) / TB), 0, tbN - 1);
      const bz0 = U.clamp(Math.floor((z - rr + tbHalf) / TB), 0, tbN - 1), bz1 = U.clamp(Math.floor((z + rr + tbHalf) / TB), 0, tbN - 1);
      for (let bz = bz0; bz <= bz1; bz++) {
        for (let bx = bx0; bx <= bx1; bx++) {
          const list = treeBuckets[bz * tbN + bx];
          for (let k = 0; k < list.length; k++) {
            const tr = trees[list[k]];
            if (!tr || tr.burnt) continue;
            const dx = tr.x - x, dz = tr.z - z;
            if (dx * dx + dz * dz > rr2) continue;
            tr.burnt = true;
            writeTree(tr);
            n++;
          }
        }
      }
      if (n) treesDirty = true;
    }
    if (grassMesh && Math.sqrt(x * x + z * z) - rr < GRASS_R1 + 1) {
      for (let i = 0; i < grassN; i++) {
        if (grassBurnt[i]) continue;
        const dx = grassX[i] - x, dz = grassZ[i] - z;
        if (dx * dx + dz * dz > rr2) continue;
        grassBurnt[i] = 1;
        writeGrass(i);
        grassDirty = true;
      }
    }
    refreshTerrainRect(x - rr - 2, z - rr - 2, x + rr + 2, z + rr + 2, false);
    return n;
  };

  // ------------------------------------------------------- terrain changes
  let dfX0 = Infinity, dfZ0 = Infinity, dfX1 = -Infinity, dfZ1 = -Infinity;
  /** Remember a deformed area; the mesh + props are refreshed once per frame. */
  function markDeform(x, z, r) {
    x = +x; z = +z;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    r = Math.max(0, +r || 0) + tCell * 2 + 1;
    if (x - r < dfX0) dfX0 = x - r;
    if (z - r < dfZ0) dfZ0 = z - r;
    if (x + r > dfX1) dfX1 = x + r;
    if (z + r > dfZ1) dfZ1 = z + r;
  }
  function flushDeform() {
    if (dfX1 < dfX0) return;
    const x0 = dfX0, z0 = dfZ0, x1 = dfX1, z1 = dfZ1;
    dfX0 = dfZ0 = Infinity;
    dfX1 = dfZ1 = -Infinity;
    refreshTerrainRect(x0, z0, x1, z1, true);
    refreshWaterGround();
    resnapProps(x0, z0, x1, z1);
    snapPedestals();
    if (x0 < 14 && x1 > -14 && z0 < 14 && z1 > -14) placeCornucopia();
    if (shadowsOn()) renderer.shadowMap.needsUpdate = true;
  }
  /** Put trees, rocks and grass inside a rectangle back on the ground. */
  function resnapProps(x0, z0, x1, z1) {
    const wl = CFG.BASE_WATER_LEVEL;
    if (trunkMesh && treeBuckets.length) {
      const trees = World.trees;
      const bx0 = U.clamp(Math.floor((x0 + tbHalf) / TB), 0, tbN - 1), bx1 = U.clamp(Math.floor((x1 + tbHalf) / TB), 0, tbN - 1);
      const bz0 = U.clamp(Math.floor((z0 + tbHalf) / TB), 0, tbN - 1), bz1 = U.clamp(Math.floor((z1 + tbHalf) / TB), 0, tbN - 1);
      for (let bz = bz0; bz <= bz1; bz++) {
        for (let bx = bx0; bx <= bx1; bx++) {
          const list = treeBuckets[bz * tbN + bx];
          for (let k = 0; k < list.length; k++) {
            const tr = trees[list[k]];
            if (!tr || tr.x < x0 || tr.x > x1 || tr.z < z0 || tr.z > z1) continue;
            const gy = groundY(tr.x, tr.z);
            if (gy < wl - 0.2) tr.hidden = true;      // the ground sank under the lake
            tr.y = gy - tr.sink;
            writeTree(tr);
            treesDirty = true;
          }
        }
      }
    }
    for (let i = 0; i < rockData.length; i++) {
      const d = rockData[i];
      if (d.x < x0 || d.x > x1 || d.z < z0 || d.z > z1) continue;
      writeRock(d);
      rocksDirty = true;
    }
    for (let i = 0; i < grassN; i++) {
      const x = grassX[i], z = grassZ[i];
      if (x < x0 || x > x1 || z < z0 || z > z1) continue;
      writeGrass(i);
      grassDirty = true;
    }
  }

  // ---------------------------------------------------------------- rebuild
  /** Rebuild terrain mesh, backdrop, water, trees, rocks, grass; re-seat cornucopia + pedestals. */
  World.rebuild = function () {
    if (!scene) return;
    applyQuality();
    const T = Tr();
    buildTerrain();
    buildBackdrop(T ? (T.seed >>> 0) : 1);
    buildWater();
    buildProps(T);
    placeCornucopia();
    snapPedestals();
    upCol0 = upGeo0 = Infinity;
    upCol1 = upGeo1 = -1;
    dfX0 = dfZ0 = Infinity;
    dfX1 = dfZ1 = -Infinity;
    if (shadowsOn()) renderer.shadowMap.needsUpdate = true;
  };

  /** Add an object to the scene (or to a parent). */
  World.add = function (obj, parent) {
    if (!obj) return obj;
    const p = parent || scene;
    if (p) p.add(obj);
    return obj;
  };
  /** Remove an object from its parent; dispose its geometries/materials when asked. */
  World.remove = function (obj, dispose) {
    if (!obj) return;
    if (obj.parent) obj.parent.remove(obj);
    if (dispose) disposeObject(obj);
  };

  // ====================================================================== FX
  const PART_CAP = 2600;              // particles per pool (normal / additive)
  const RING_POOL = 10;
  const BEAM_POOL = 6;
  const EMPTY = {};

  // fog factor (0 = fogged) that works with THREE.Fog and THREE.FogExp2
  const FOG_FACTOR = [
    'float fogKeep() {',
    '  #ifdef USE_FOG',
    '    #ifdef FOG_EXP2',
    '      return exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);',
    '    #else',
    '      return 1.0 - smoothstep(fogNear, fogFar, vFogDepth);',
    '    #endif',
    '  #else',
    '    return 1.0;',
    '  #endif',
    '}',
  ].join('\n');

  const PART_VS = [
    'attribute vec3 aColor;',
    'attribute float aAlpha;',
    'attribute float aSize;',
    'uniform float uViewH;',
    'varying vec3 vColor;',
    'varying float vAlpha;',
    '#include <fog_pars_vertex>',
    'void main() {',
    '  vColor = aColor;',
    '  vAlpha = aAlpha;',
    '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
    '  float k = projectionMatrix[2][3] != 0.0 ? 1.0 / max(-mvPosition.z, 0.1) : 1.0;',
    '  gl_PointSize = aAlpha > 0.003 ? clamp(aSize * uViewH * 0.5 * projectionMatrix[1][1] * k, 1.0, 400.0) : 0.0;',
    '  gl_Position = projectionMatrix * mvPosition;',
    '  #include <fog_vertex>',
    '}',
  ].join('\n');
  const PART_FS_NORMAL = [
    'uniform vec3 uTint;',
    'varying vec3 vColor;',
    'varying float vAlpha;',
    '#include <fog_pars_fragment>',
    'void main() {',
    '  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;',
    '  if (d > 1.0) discard;',
    '  float a = 1.0 - smoothstep(0.35, 1.0, d);',
    '  gl_FragColor = vec4(vColor * uTint * (1.0 - 0.18 * d), a * vAlpha);',
    '  #include <fog_fragment>',
    '}',
  ].join('\n');
  const PART_FS_ADD = [
    'varying vec3 vColor;',
    'varying float vAlpha;',
    '#include <fog_pars_fragment>',
    FOG_FACTOR,
    'void main() {',
    '  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;',
    '  if (d > 1.0) discard;',
    '  float a = pow(1.0 - d, 1.7);',
    '  float core = pow(1.0 - d, 6.0);',
    '  gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.55), a * vAlpha * fogKeep());',
    '}',
  ].join('\n');

  const RING_VS = [
    'attribute vec3 aKind;',
    'varying vec3 vP;',
    'varying float vBand;',
    '#include <fog_pars_vertex>',
    'void main() {',
    '  vP = position;',
    '  vBand = aKind.x;',
    '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
    '  gl_Position = projectionMatrix * mvPosition;',
    '  #include <fog_vertex>',
    '}',
  ].join('\n');
  const RING_FS = [
    'uniform vec3 uColor;',
    'uniform float uAlpha;',
    'varying vec3 vP;',
    'varying float vBand;',
    '#include <fog_pars_fragment>',
    FOG_FACTOR,
    'void main() {',
    '  float a;',
    '  if (vBand > 0.5) {',
    '    a = (1.0 - smoothstep(0.0, 1.0, vP.y)) * smoothstep(-0.3, 0.0, vP.y) * 0.75;',
    '  } else {',
    '    float d = length(vP.xz);',
    '    a = smoothstep(0.5, 0.96, d) * (1.0 - smoothstep(0.96, 1.0, d));',
    '  }',
    '  gl_FragColor = vec4(uColor, a * uAlpha * fogKeep());',
    '}',
  ].join('\n');

  const BEAM_VS = [
    'varying vec3 vN;',
    'varying vec3 vV;',
    'varying float vY;',
    '#include <fog_pars_vertex>',
    'void main() {',
    '  vY = position.y;',
    '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
    '  vN = normalize(normalMatrix * normal);',
    '  vV = -mvPosition.xyz;',
    '  gl_Position = projectionMatrix * mvPosition;',
    '  #include <fog_vertex>',
    '}',
  ].join('\n');
  const BEAM_FS = [
    'uniform vec3 uColor;',
    'uniform float uAlpha;',
    'uniform float uTime;',
    'uniform float uLen;',
    'varying vec3 vN;',
    'varying vec3 vV;',
    'varying float vY;',
    '#include <fog_pars_fragment>',
    FOG_FACTOR,
    'void main() {',
    '  float ndv = abs(dot(normalize(vN), normalize(vV)));',
    '  float glow = pow(ndv, 1.4);',
    '  float core = pow(ndv, 7.0);',
    '  float flick = 0.82 + 0.18 * sin(uTime * 41.0 + vY * uLen * 0.35);',
    '  gl_FragColor = vec4(mix(uColor, vec3(1.0), core * 0.75), glow * uAlpha * flick * fogKeep());',
    '}',
  ].join('\n');

  let pNorm = null, pAdd = null;
  const flashes = [], rings = [], beams = [];
  let fxTime = 0;

  function num(v, d) {
    if (v == null) return d;
    v = +v;
    return Number.isFinite(v) ? v : d;
  }
  function validPos(p) { return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z); }
  function setColor(c, v, fb) {
    if (typeof v === 'number' || (typeof v === 'string' && v) || (v && v.isColor)) c.set(v);
    else c.set(fb);
    return c;
  }

  function makePool(additive) {
    const cap = PART_CAP;
    const P = {
      additive, cap, n: 0, dirty: false,
      pos: new Float32Array(cap * 3), col: new Float32Array(cap * 3), alp: new Float32Array(cap), siz: new Float32Array(cap),
      vel: new Float32Array(cap * 3), c0: new Float32Array(cap * 3), c1: new Float32Array(cap * 3),
      age: new Float32Array(cap), life: new Float32Array(cap), grav: new Float32Array(cap), drag: new Float32Array(cap),
      s0: new Float32Array(cap), grow: new Float32Array(cap), floor: new Float32Array(cap), base: new Float32Array(cap),
      geo: null, mat: null, points: null,
    };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(P.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(P.alp, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(P.siz, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uViewH: { value: 800 },
        uTint: { value: new THREE.Color(1, 1, 1) },
      }]),
      vertexShader: PART_VS,
      fragmentShader: additive ? PART_FS_ADD : PART_FS_NORMAL,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
    });
    const pts = new THREE.Points(geo, mat);
    pts.name = additive ? 'fxAdditive' : 'fxParticles';
    pts.frustumCulled = false;
    pts.matrixAutoUpdate = false;
    pts.renderOrder = additive ? 5 : 4;
    // point sizes are in world metres: read the viewport of each render (main view + feeds)
    pts.onBeforeRender = function (r) {
      r.getCurrentViewport(_vp4);
      mat.uniforms.uViewH.value = Math.max(1, _vp4.w);
      mat.uniformsNeedUpdate = true;
    };
    scene.add(pts);
    P.geo = geo; P.mat = mat; P.points = pts;
    return P;
  }

  function initFX() {
    pNorm = makePool(false);
    pAdd = makePool(true);
    // flash lights stay in the scene at intensity 0: a changing light count would recompile every material
    for (let i = 0; i < FLASH_LIGHTS; i++) {
      const L = new THREE.PointLight(0xffffff, 0, 25, 1.6);
      L.name = 'fxFlash' + i;
      L.castShadow = false;
      scene.add(L);
      flashes.push({ light: L, t: 1, dur: 1, i0: 0 });
    }
    const disc = new THREE.CircleGeometry(1, 64);
    disc.rotateX(-Math.PI / 2);
    const band = new THREE.CylinderGeometry(1, 1, 1.3, 64, 1, true);
    const ringGeo = mergeGeometries([[disc, null, 0x000000], [band, mtx(0, 0.35, 0, 1, 1, 1, 0), 0xffffff]], true);
    disc.dispose(); band.dispose();
    ringGeo.setAttribute('aKind', ringGeo.getAttribute('color'));
    ringGeo.deleteAttribute('color');
    for (let i = 0; i < RING_POOL; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 } }]),
        vertexShader: RING_VS,
        fragmentShader: RING_FS,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: true,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.name = 'fxRing';
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      scene.add(mesh);
      rings.push({ mesh, mat, t: 0, dur: 1, r: 1, bandH: 1, active: false });
    }
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
    beamGeo.translate(0, 0.5, 0);
    for (let i = 0; i < BEAM_POOL; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
          uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uTime: { value: 0 }, uLen: { value: 1 },
        }]),
        vertexShader: BEAM_VS,
        fragmentShader: BEAM_FS,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: true,
      });
      const mesh = new THREE.Mesh(beamGeo, mat);
      mesh.name = 'fxBeam';
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      scene.add(mesh);
      beams.push({ mesh, mat, t: 0, dur: 1, active: false });
    }
  }

  // ------------------------------------------------------------- particles
  function spawnParticles(pos, o, isEmit) {
    if (!pNorm || !validPos(pos)) return;
    o = o || EMPTY;
    const P = o.additive ? pAdd : pNorm;
    let count = num(o.count, 16);
    if (!(count > 0)) return;
    if (isLow()) count *= 0.55;
    count = Math.floor(count) + (Math.random() < count % 1 ? 1 : 0);
    const limit = isEmit ? Math.floor(P.cap * 0.85) : P.cap;
    count = Math.min(count, limit - P.n, 400);
    if (count <= 0) return;
    const speed = num(o.speed, 4), spread = num(o.spread, 1), up = num(o.up, 2), grav = num(o.gravity, -9.8);
    const size = Math.max(0.01, num(o.size, 0.3)), life = Math.max(0.05, num(o.life, 0.8));
    setColor(_c, o.color, 0xffffff);
    if (o.color2 == null) _c2.copy(_c); else setColor(_c2, o.color2, 0xffffff);
    const heavy = grav < -2;
    const smoky = !o.additive && !heavy && size >= 0.7;
    const baseA = o.alpha != null ? U.clamp01(num(o.alpha, 1)) : (smoky ? 0.62 : 1);
    const drag = num(o.drag, smoky ? 1.1 : (o.additive ? 0.6 : 0.2));
    const grow = o.additive ? 0.35 : (smoky ? 2.1 : 1);
    const px = pos.x, py = pos.y, pz = pos.z;
    const floorY = Math.max(groundY(px, pz), waterY()) + 0.03;
    for (let k = 0; k < count; k++) {
      const i = P.n++;
      const o3 = i * 3;
      let dx, dy, dz, l;
      do { dx = Math.random() * 2 - 1; dy = Math.random() * 2 - 1; dz = Math.random() * 2 - 1; l = dx * dx + dy * dy + dz * dz; } while (l > 1);
      const y0 = py + dy * spread * 0.5;
      P.pos[o3] = px + dx * spread;
      P.pos[o3 + 1] = y0;
      P.pos[o3 + 2] = pz + dz * spread;
      do { dx = Math.random() * 2 - 1; dy = Math.random() * 2 - 1; dz = Math.random() * 2 - 1; l = dx * dx + dy * dy + dz * dz; } while (l > 1 || l < 1e-4);
      l = Math.sqrt(l);
      const sp = speed * (0.35 + 0.65 * Math.random()) / l;
      P.vel[o3] = dx * sp;
      P.vel[o3 + 1] = dy * sp * 0.6 + up * (0.65 + 0.7 * Math.random());
      P.vel[o3 + 2] = dz * sp;
      P.age[i] = 0;
      P.life[i] = life * (0.7 + 0.6 * Math.random());
      P.grav[i] = grav;
      P.drag[i] = drag;
      P.s0[i] = size * (0.7 + 0.6 * Math.random());
      P.grow[i] = grow;
      P.floor[i] = Math.min(floorY, y0 - 0.02);
      P.base[i] = baseA;
      const m = Math.random();
      const a0 = m * 0.45, a1 = 0.55 + m * 0.45;
      P.c0[o3] = _c.r + (_c2.r - _c.r) * a0; P.c0[o3 + 1] = _c.g + (_c2.g - _c.g) * a0; P.c0[o3 + 2] = _c.b + (_c2.b - _c.b) * a0;
      P.c1[o3] = _c.r + (_c2.r - _c.r) * a1; P.c1[o3 + 1] = _c.g + (_c2.g - _c.g) * a1; P.c1[o3 + 2] = _c.b + (_c2.b - _c.b) * a1;
    }
    P.dirty = true;
  }

  function killParticle(P, i) {
    const j = --P.n;
    if (i === j) return;
    const a = i * 3, b = j * 3;
    for (let k = 0; k < 3; k++) {
      P.pos[a + k] = P.pos[b + k];
      P.vel[a + k] = P.vel[b + k];
      P.c0[a + k] = P.c0[b + k];
      P.c1[a + k] = P.c1[b + k];
    }
    P.age[i] = P.age[j]; P.life[i] = P.life[j]; P.grav[i] = P.grav[j]; P.drag[i] = P.drag[j];
    P.s0[i] = P.s0[j]; P.grow[i] = P.grow[j]; P.floor[i] = P.floor[j]; P.base[i] = P.base[j];
  }

  function stepPool(P, dt) {
    if (!P || P.n === 0) return;
    const pos = P.pos, vel = P.vel;
    for (let i = 0; i < P.n; i++) {
      const a = P.age[i] + dt;
      if (a >= P.life[i]) { killParticle(P, i); i--; continue; }
      P.age[i] = a;
      const o = i * 3;
      const damp = Math.max(0, 1 - P.drag[i] * dt);
      let vx = vel[o] * damp, vy = (vel[o + 1] + P.grav[i] * dt) * damp, vz = vel[o + 2] * damp;
      const x = pos[o] + vx * dt, z = pos[o + 2] + vz * dt;
      let y = pos[o + 1] + vy * dt;
      if (y < P.floor[i]) {
        y = P.floor[i];
        if (vy < 0) vy = -vy * 0.28;
        vx *= 0.6; vz *= 0.6;
      }
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
      vel[o] = vx; vel[o + 1] = vy; vel[o + 2] = vz;
    }
    P.dirty = true;
  }

  /** Write alpha / size / colour for the live particles and upload only that range. */
  function syncPool(P) {
    if (!P || !P.dirty) return;
    P.dirty = false;
    const n = P.n;
    for (let i = 0; i < n; i++) {
      const t = P.age[i] / P.life[i];
      let a;
      if (P.additive) a = Math.min(1, t * 20) * Math.pow(1 - t, 1.3);
      else {
        const f = t < 0.45 ? 0 : (t - 0.45) / 0.55;
        a = Math.min(1, t * 9) * (1 - f * f * (3 - 2 * f));
      }
      P.alp[i] = a * P.base[i];
      P.siz[i] = P.s0[i] * (1 + (P.grow[i] - 1) * t);
      const o = i * 3;
      P.col[o] = P.c0[o] + (P.c1[o] - P.c0[o]) * t;
      P.col[o + 1] = P.c0[o + 1] + (P.c1[o + 1] - P.c0[o + 1]) * t;
      P.col[o + 2] = P.c0[o + 2] + (P.c1[o + 2] - P.c0[o + 2]) * t;
    }
    const at = P.geo.attributes;
    if (n > 0) {
      setRange(at.position, 0, n * 3);
      setRange(at.aColor, 0, n * 3);
      setRange(at.aAlpha, 0, n);
      setRange(at.aSize, 0, n);
    }
    P.geo.setDrawRange(0, n);
  }

  /** One-shot particles. opts {count=16, color, color2, speed=4, spread=1, up=2, gravity=-9.8, size=0.3, life=0.8, additive} */
  FX.burst = function (pos, opts) { spawnParticles(pos, opts, false); };
  /** Same as burst, for small per-frame emitters (smoke, sparks); yields to bursts when the pool is nearly full. */
  FX.emit = function (pos, opts) { spawnParticles(pos, opts, true); };

  /** Pooled point-light flash (max FLASH_LIGHTS at once; the weakest one is reused). */
  FX.flash = function (pos, color, intensity, radius, duration) {
    if (!flashes.length || !validPos(pos)) return;
    let best = flashes[0], bestScore = Infinity;
    for (const f of flashes) {
      const rem = f.t >= f.dur ? 0 : f.i0 * (1 - f.t / f.dur);
      if (rem < bestScore) { bestScore = rem; best = f; }
    }
    const L = best.light;
    L.position.set(pos.x, pos.y, pos.z);
    setColor(L.color, color, 0xffffff);
    best.i0 = Math.max(0, num(intensity, 2));
    L.distance = Math.max(1, num(radius, 25));
    best.dur = Math.max(0.03, num(duration, 0.25));
    best.t = 0;
    L.intensity = best.i0;
  };

  /** Expanding ground shock-wave ring (flat glow + a short wall that shows on slopes). */
  FX.ring = function (pos, color, radius, duration) {
    if (!rings.length || !validPos(pos)) return;
    let R = null, oldest = -1;
    for (const q of rings) {
      if (!q.active) { R = q; break; }
      const k = q.t / q.dur;
      if (k > oldest) { oldest = k; R = q; }
    }
    const c = setColor(R.mat.uniforms.uColor.value, color, 0xffffff);
    R.mat.blending = c.r * 0.3 + c.g * 0.59 + c.b * 0.11 > 0.35 ? THREE.AdditiveBlending : THREE.NormalBlending;
    R.r = Math.max(0.2, num(radius, 5));
    R.dur = Math.max(0.08, num(duration, 0.6));
    R.t = 0;
    R.bandH = U.clamp(0.7 + R.r * 0.08, 0.7, 3);
    R.active = true;
    R.mesh.position.set(pos.x, pos.y, pos.z);
    R.mesh.scale.set(R.r * 0.08, R.bandH, R.r * 0.08);
    R.mat.uniforms.uAlpha.value = 1;
    R.mesh.visible = true;
  };

  /** Glowing line between two points (lightning, tractor beam). width = diameter in metres. */
  FX.beam = function (from, to, color, width, duration) {
    if (!beams.length || !validPos(from) || !validPos(to)) return;
    _v1.set(from.x, from.y, from.z);
    _v2.set(to.x - from.x, to.y - from.y, to.z - from.z);
    const len = _v2.length();
    if (len < 0.01) return;
    _v2.multiplyScalar(1 / len);
    let B = null, oldest = -1;
    for (const q of beams) {
      if (!q.active) { B = q; break; }
      const k = q.t / q.dur;
      if (k > oldest) { oldest = k; B = q; }
    }
    const w = Math.max(0.02, num(width, 0.6)) * 0.5;
    B.mesh.position.copy(_v1);
    B.mesh.quaternion.setFromUnitVectors(UP, _v2);
    B.mesh.scale.set(w, len, w);
    setColor(B.mat.uniforms.uColor.value, color, 0xffffff);
    B.mat.uniforms.uLen.value = len;
    B.mat.uniforms.uAlpha.value = 0;
    B.t = 0;
    B.dur = Math.max(0.05, num(duration, 0.3));
    B.active = true;
    B.mesh.visible = true;
  };

  /** Advance every effect by sim seconds (not called while paused). */
  FX.update = function (dt) {
    if (!(dt > 0)) return;
    fxTime += dt;
    stepPool(pNorm, dt);
    stepPool(pAdd, dt);
    for (const f of flashes) {
      if (f.t >= f.dur) continue;
      f.t += dt;
      const k = f.t / f.dur;
      f.light.intensity = k >= 1 ? 0 : f.i0 * (1 - k) * (1 - k);
    }
    for (const R of rings) {
      if (!R.active) continue;
      R.t += dt;
      const k = R.t / R.dur;
      if (k >= 1) { R.active = false; R.mesh.visible = false; continue; }
      const e = 1 - (1 - k) * (1 - k) * (1 - k);
      const s = R.r * (0.08 + 0.92 * e);
      R.mesh.scale.set(s, R.bandH, s);
      R.mat.uniforms.uAlpha.value = Math.pow(1 - k, 1.4);
    }
    for (const B of beams) {
      if (!B.active) continue;
      B.t += dt;
      const k = B.t / B.dur;
      if (k >= 1) { B.active = false; B.mesh.visible = false; continue; }
      const f = k < 0.6 ? 0 : (k - 0.6) / 0.4;
      B.mat.uniforms.uAlpha.value = Math.min(1, B.t / 0.06) * (1 - f * f * (3 - 2 * f));
      B.mat.uniforms.uTime.value = fxTime;
    }
  };

  /** Remove every live effect. */
  FX.clear = function () {
    for (const P of [pNorm, pAdd]) {
      if (!P) continue;
      P.n = 0;
      P.dirty = true;
      syncPool(P);
    }
    for (const f of flashes) { f.t = f.dur; f.light.intensity = 0; }
    for (const R of rings) { R.active = false; R.mesh.visible = false; }
    for (const B of beams) { B.active = false; B.mesh.visible = false; }
  };

  /** Upload particle data and light-match the smoke (once per frame). */
  function syncFX() {
    syncPool(pNorm);
    syncPool(pAdd);
    if (pNorm && hemi && sun) {
      const t = pNorm.mat.uniforms.uTint.value;
      const hi = hemi.intensity * 0.9, si = Math.max(0, sun.intensity) * 0.45;
      t.setRGB(
        U.clamp(hemi.color.r * hi + sun.color.r * si, 0.18, 1.2),
        U.clamp(hemi.color.g * hi + sun.color.g * si, 0.18, 1.2),
        U.clamp(hemi.color.b * hi + sun.color.b * si, 0.2, 1.2));
    }
  }

  // ================================================================= system
  let envTime = 0, swayAmp = 0.03, domePulse = 0;

  function frame(realDt) {
    if (!scene) return;
    const dt = Math.min(0.1, Math.max(0, +realDt || 0));
    envTime += dt;
    flushDeform();
    flushTerrainUpload();
    flushInstances();
    placeSun();                          // follow Env's sun direction even without camera calls

    // wind sway for trees and grass
    const E = GM.Env;
    let target = 0.03;
    if (E && E.wind && Number.isFinite(E.wind.x) && Number.isFinite(E.wind.z)) {
      target = 0.018 + Math.min(14, Math.sqrt(E.wind.x * E.wind.x + E.wind.z * E.wind.z)) * 0.004;
    } else if (E && E.weather === 'storm') target = 0.07;
    else if (E && E.weather === 'rain') target = 0.045;
    swayAmp += (target - swayAmp) * (1 - Math.exp(-dt * 1.5));
    sway.uSwayTime.value = envTime;
    sway.uSwayAmp.value = swayAmp;

    // water: level, waves, sky reflection, light
    if (waterMat) {
      const u = waterMat.uniforms;
      const lvl = waterY();
      u.uLevel.value = lvl;
      u.uTime.value = envTime;
      if (wGeo && (lvl + 1.5 > wThreshold || lvl + 14 < wThreshold)) rebuildWaterIndex(lvl + 6);
      if (World.skyColor && World.skyColor.isColor) u.uSky.value.copy(World.skyColor);
      if (World.sunDir && World.sunDir.isVector3) u.uSunDir.value.copy(World.sunDir).normalize();
      if (sun) u.uSunColor.value.copy(sun.color).multiplyScalar(U.clamp(sun.intensity, 0, 1.6));
      if (hemi) u.uAmbient.value.copy(hemi.color).multiplyScalar(Math.max(0, hemi.intensity) * 0.85);
    }

    // force-field shimmer (flares up when the zone starts to shrink)
    if (domeMat) {
      domePulse = Math.max(0, domePulse - dt * 0.6);
      domeMat.uniforms.uTime.value = envTime;
      domeMat.uniforms.uStrength.value = 0.4 + domePulse * 0.7;
    }

    // pedestal rings: steady in setup, pulsing in the countdown, dim once the Games run
    if (pedGlow && pedCount > 0) {
      const ph = GM.state.phase;
      const col = pedGlow.material.color;
      if (ph === 'countdown') {
        const k = 0.55 + 0.45 * Math.sin(envTime * 6);
        col.setRGB(0.45 + 0.5 * k, 0.75 + 0.25 * k, 1);
      } else if (ph === 'running' || ph === 'ended') col.setRGB(0.22, 0.3, 0.36);
      else col.setRGB(0.53, 0.86, 1);
    }

    syncFX();
  }

  function init() {
    if (scene) return;
    renderer = createRenderer();
    World.renderer = renderer;
    createScene();
    makeWaterMaterial();
    buildDome();
    buildCornucopia();
    buildPedestalMeshes();
    buildPropGeometries();
    initFX();
    applyQuality();
    if (!resizeBound) {
      window.addEventListener('resize', onResize);
      resizeBound = true;
    }
    if (Tr()) World.rebuild();
  }

  function tributeCount(settings) {
    const s = settings || GM.state.settings;
    if (s && Array.isArray(s.roster) && s.roster.length) return s.roster.length;
    if (s && s.tributeCount > 0) return s.tributeCount | 0;
    return 24;
  }

  GM.on('arena:generated', function () {
    try { World.rebuild(); } catch (e) { GM.reportError('World.rebuild', e); }
  });
  GM.on('forest:burnt', function (d) {
    if (!d) return;
    try { World.burnTreesInArea(d.x, d.z, d.radius); } catch (e) { GM.reportError('World.burn', e); }
  });
  GM.on('terrain:changed', function (d) { if (d) markDeform(d.x, d.z, d.radius); });
  GM.on('zone:shrink', function () { domePulse = 1; });
  GM.on('settings:changed', function (d) { if (d && d.key === 'quality') applyQuality(); });

  GM.registerSystem({
    name: 'World',
    order: 20,
    init,
    clear() {
      FX.clear();
      domePulse = 0;
      World.pedestals(tributeCount());      // pedestals for the setup showcase
    },
    reset(settings) {
      applyQuality();
      FX.clear();
      World.pedestals(tributeCount(settings));
    },
    update(dt) { FX.update(dt); },
    frame,
  });
})();
