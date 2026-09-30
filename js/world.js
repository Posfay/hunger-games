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
 * Look: physically based materials (linear light, HDR, see gfx.js/post.js).
 * Smooth terrain with procedural detail (plaza stonework, rock strata, wet
 * shores, caustics, puddles, snow), wind-blown trees with translucent
 * leaves, a GPU grass field around the camera, a depth-aware water shader
 * and a polished gold Cornucopia. Env (env.js) animates light, sky and fog.
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
  const Gfx = GM.Gfx;
  const SU = Gfx.uniforms;

  // ------------------------------------------------------------- constants
  const ARENA_R = CFG.ARENA_RADIUS;
  const PED_R = CFG.PEDESTAL_RADIUS;
  const PED_MAX = CFG.MAX_TRIBUTES;
  const PED_H = 0.32;                 // pedestal top above the plaza
  const SHADOW_MIN = 42, SHADOW_MAX = 175;   // half size range of the shadow camera (m)
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
  /** sRGB hex -> linear rgb written into c. */
  function linHex(hex, c) { return c.set(hex); }

  /** Merge geometries (each [geometry, matrix, rgbHex|null]) into one non-indexed geometry (smooth normals per part). */
  function mergeGeometries(parts, withColor) {
    const list = [];
    let total = 0;
    for (const part of parts) {
      let g = part[0].index ? part[0].toNonIndexed() : part[0].clone();
      if (!g.attributes.normal) g.computeVertexNormals();
      if (part[1]) g.applyMatrix4(part[1]);
      list.push([g, part[2]]);
      total += g.attributes.position.count;
    }
    const pos = new Float32Array(total * 3);
    const nrm = new Float32Array(total * 3);
    const col = withColor ? new Float32Array(total * 3) : null;
    let o = 0;
    for (const item of list) {
      const a = item[0].attributes.position.array;
      pos.set(a, o * 3);
      nrm.set(item[0].attributes.normal.array, o * 3);
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
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  }

  /** Weld vertices of a (non-indexed) geometry by position -> indexed, smooth normals. */
  function weld(geo, tol) {
    const src = geo.index ? geo.toNonIndexed() : geo;
    const a = src.attributes.position.array;
    const n = a.length / 3;
    const k = 1 / (tol || 1e-4);
    const map = new Map();
    const pos = [];
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const key = Math.round(a[i * 3] * k) + '_' + Math.round(a[i * 3 + 1] * k) + '_' + Math.round(a[i * 3 + 2] * k);
      let j = map.get(key);
      if (j === undefined) {
        j = pos.length / 3;
        map.set(key, j);
        pos.push(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
      }
      idx[i] = j;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    return g;
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
    // The HDR scene renders into multisampled targets (post.js): the canvas itself needs no MSAA.
    try {
      r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    } catch (e) {
      GM.reportError('World.renderer', e);
      try { r = new THREE.WebGLRenderer({ canvas, antialias: false }); } catch (e2) { GM.reportError('World.renderer.fallback', e2); return null; }
    }
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setSize(Math.max(1, window.innerWidth || 1), Math.max(1, window.innerHeight || 1), false);
    r.outputEncoding = THREE.sRGBEncoding;
    r.toneMapping = THREE.NoToneMapping;       // tone mapping happens in post.js
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setClearColor(0x05070b, 1);
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
    if (sun) {
      sun.castShadow = !low;
      const size = low ? 1024 : 4096;
      if (sun.shadow.mapSize.x !== size) {
        sun.shadow.mapSize.set(size, size);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      }
    }
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
    // No scene.background: a Color background force-clears every render() call,
    // which would wipe the composited image before the overlay pass. The sky dome covers it.
    scene.background = null;
    // Fog parameters live in the shared gmFog* uniforms (gfx.js); THREE.Fog just enables USE_FOG.
    scene.fog = new THREE.Fog(0xb8d4ea, 140, 900);
    World.scene = scene;

    // ambient comes from the sky environment map (Env); the hemisphere light is fill + lightning flashes
    hemi = new THREE.HemisphereLight(0xcfe6ff, 0x6f7a52, 0.0);
    hemi.name = 'hemi';
    scene.add(hemi);

    sun = new THREE.DirectionalLight(0xfff4e0, 3.0);
    sun.name = 'sun';
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const sc = sun.shadow.camera;
    sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60;
    sc.near = 1; sc.far = 520;
    sc.updateProjectionMatrix();
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.04;
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
  let shadowExt = 60, shadowExtGoal = 60;
  /** Position the sun + shadow camera around the focus (snapped to shadow texels: no shimmer). */
  function placeSun() {
    if (!sun) return;
    const d = World.sunDir || _v1.set(0.45, 0.78, 0.38).normalize();
    // shadow coverage follows the camera distance (close-ups: sharp, wide shots: far reaching)
    const cam = GM.Cameras && GM.Cameras.main;
    if (cam) {
      const dist = cam.position.distanceTo(focus);
      shadowExtGoal = U.clamp(dist * 0.95 + 18, SHADOW_MIN, SHADOW_MAX);
    }
    // quantise the extent so it does not swim every frame
    const q = Math.pow(1.18, Math.round(Math.log(shadowExtGoal) / Math.log(1.18)));
    if (Math.abs(q - shadowExt) > 0.5) {
      shadowExt = q;
      const sc = sun.shadow.camera;
      sc.left = -q; sc.right = q; sc.top = q; sc.bottom = -q;
      sc.updateProjectionMatrix();
    }
    const mapSize = sun.shadow.mapSize.x || 2048;
    const texel = (2 * shadowExt) / mapSize;
    sun.shadow.normalBias = U.clamp(texel * 1.6, 0.02, 0.2);
    _lz.copy(d).normalize();
    _lx.crossVectors(UP, _lz);
    if (_lx.lengthSq() < 1e-8) _lx.set(1, 0, 0);
    _lx.normalize();
    _ly.crossVectors(_lz, _lx);
    const a = Math.round(focus.dot(_lx) / texel) * texel;
    const b = Math.round(focus.dot(_ly) / texel) * texel;
    const c = focus.dot(_lz);
    _v2.copy(_lx).multiplyScalar(a).addScaledVector(_ly, b).addScaledVector(_lz, c);
    sun.target.position.copy(_v2);
    sun.position.copy(_v2).addScaledVector(_lz, 260);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
    const sh = SU.gmShadow.value;
    sh[0] = focus.x; sh[1] = focus.z; sh[2] = shadowExt;
  }
  World.updateSun = placeSun;
  /** Centre the sun's shadow camera on a ground point (Cameras call this every frame). */
  World.setShadowFocus = function (x, z) {
    x = +x || 0; z = +z || 0;
    focus.set(x, groundY(x, z), z);
    placeSun();
  };

  // ============================================================ terrain mesh
  // Smooth indexed height grid. The triangle diagonal (i00 -> i11) matches
  // Terrain.heightAt, so feet stay exactly on the surface.
  const TERRAIN_FRAG_PRE = [
    'varying float vAO;',
    Gfx.WORLD_VARY,
    // Cornucopia plaza stonework: rings of slabs, gold seal + inlay, steel pedestal ring
    'void gmPlaza( vec2 p, float n3, float n4, inout vec3 alb, inout float rough, inout float metal, inout float bh ) {',
    '  float r = length( p );',
    '  float fa = atan( p.x, p.y ) * 0.15915494 + 0.5;',
    '  vec3 stone = vec3( 0.3, 0.28, 0.235 );',
    '  vec3 gold = vec3( 0.93, 0.64, 0.25 );',
    '  float ringW = r < 6.4 ? 1.07 : ( r > 22.3 ? 2.3 : 1.72 );',
    '  float segL = r < 6.4 ? 1.25 : ( r > 22.3 ? 2.8 : 2.35 );',
    '  float rr = r / ringW;',
    '  float ri = floor( rr );',
    '  float segN = max( 6.0, floor( 6.2831853 * ( ri + 0.5 ) * ringW / segL ) );',
    '  float sf = fa * segN + mod( ri, 2.0 ) * 0.5;',
    '  float si = floor( sf );',
    '  float er = min( fract( rr ), 1.0 - fract( rr ) ) * ringW;',
    '  float es = min( fract( sf ), 1.0 - fract( sf ) ) * 6.2831853 * r / segN;',
    '  float e = min( er, es );',
    '  float aa = max( fwidth( e ), 0.002 );',
    '  float grout = 1.0 - smoothstep( 0.016, 0.016 + aa * 1.5, e );',
    '  float bevel = 1.0 - smoothstep( 0.0, 0.07 + aa, e );',
    '  float id = gmHash12( vec2( ri, si ) + 7.13 );',
    '  vec3 col = stone * ( 0.82 + 0.34 * id ) * ( 0.86 + 0.26 * n3 ) * ( 0.93 + 0.14 * n4 );',
    '  col = mix( col, col * vec3( 1.04, 1.0, 0.93 ), step( 0.8, id ) );',
    '  col = mix( col, stone * 0.28, grout );',
    '  float h = 0.35 + 0.3 * id - bevel * 0.35 - grout * 0.7 + n4 * 0.15;',
    '  float rgh = 0.72 + 0.2 * n3 + grout * 0.2;',
    '  float mtl = 0.0;',
    '  if ( r < 2.75 ) {',
    // gold seal: concentric rings and 12 engraved rays
    '    float ray = abs( fract( fa * 12.0 ) - 0.5 ) * 6.2831853 * r / 12.0;',
    '    float engr = ( 1.0 - smoothstep( 0.018, 0.018 + aa * 2.0, ray ) ) * step( 0.55, r ) * step( r, 2.25 );',
    '    engr = max( engr, 1.0 - smoothstep( 0.03, 0.03 + aa * 2.0, abs( r - 2.45 ) ) );',
    '    engr = max( engr, 1.0 - smoothstep( 0.025, 0.025 + aa * 2.0, abs( r - 0.5 ) ) );',
    '    col = gold * ( 0.92 + 0.08 * n4 ) * ( 1.0 - engr * 0.6 );',
    '    mtl = 1.0 - engr * 0.5;',
    '    rgh = 0.24 + 0.12 * n4 + engr * 0.35;',
    '    h = 0.6 - engr * 0.6;',
    '  } else if ( r > 6.4 && r < 7.6 ) {',
    '    float edge = min( r - 6.4, 7.6 - r );',
    '    float lip = 1.0 - smoothstep( 0.03, 0.03 + aa * 2.0, edge );',
    '    col = gold * ( 0.9 + 0.1 * n4 ) * ( 1.0 - lip * 0.5 );',
    '    mtl = 1.0; rgh = 0.3 + 0.1 * n3;',
    '    h = 0.55 - lip * 0.4;',
    '  } else if ( abs( r - 18.0 ) < 1.15 ) {',
    // steel pedestal ring with radial ribs
    '    float rib = abs( fract( fa * 96.0 ) - 0.5 ) * 6.2831853 * r / 96.0;',
    '    float ribs = 1.0 - smoothstep( 0.02, 0.02 + aa * 2.0, rib );',
    '    float edge = 1.15 - abs( r - 18.0 );',
    '    float lip = 1.0 - smoothstep( 0.04, 0.04 + aa * 2.0, edge );',
    '    col = vec3( 0.2, 0.21, 0.23 ) * ( 0.85 + 0.3 * n4 ) * ( 1.0 - ribs * 0.35 - lip * 0.5 );',
    '    mtl = 0.85; rgh = 0.38 + 0.15 * n3 + ribs * 0.2;',
    '    h = 0.5 - ribs * 0.3 - lip * 0.5;',
    '  } else if ( r > 22.3 ) {',
    '    col *= 0.78;',
    '  }',
    '  alb = col; rough = rgh; metal = mtl; bh = h;',
    '}',
  ].join('\n');

  const TERRAIN_ALBEDO = [
    '$',
    'vec3 gmW = vGmWorld;',
    'vec3 gmNw = normalize( vGmNrmW );',
    'float gmDist = length( gmW - cameraPosition );',
    'vec2 gmP = gmW.xz;',
    'vec4 gmN1 = gmTex( gmP * 0.0047 );',
    'vec4 gmN2 = gmTex( gmP * 0.029 + 0.31 );',
    'vec4 gmN3 = gmTex( gmP * 0.17 + 0.57 );',
    'vec4 gmN4 = gmTex( gmP * 0.37 + 0.13 );',
    'float gmNear = 1.0 - smoothstep( 10.0, 48.0, gmDist );',
    'vec3 gmAlb = diffuseColor.rgb;',
    'float gmRough = 0.93, gmMetal = 0.0, gmBumpH = 0.0, gmBumpS = 0.9, gmCanopy = 1.0;',
    'float gmGreen = gmSat( ( gmAlb.g - max( gmAlb.r, gmAlb.b ) ) * 9.0 );',
    // large scale colour breakup
    'gmAlb *= 0.84 + 0.32 * gmN1.r;',
    'gmAlb = mix( gmAlb, gmAlb * vec3( 1.22, 1.06, 0.62 ), gmGreen * smoothstep( 0.58, 0.82, gmN2.g ) * 0.6 );',
    'gmAlb = mix( gmAlb, gmAlb * vec3( 0.72, 0.9, 0.78 ), gmGreen * smoothstep( 0.55, 0.85, gmN1.g ) * 0.55 );',
    'gmAlb *= 0.88 + 0.24 * gmN3.b;',
    'gmAlb *= mix( 1.0, 0.8 + 0.4 * gmN4.a, gmNear );',
    'gmBumpH = gmN3.b * 0.5 * ( 0.4 + 0.6 * gmNear ) + gmN4.a * 0.3 * gmNear + gmN2.g * 0.4;',
    // steep ground turns into layered rock
    'float gmSlope = 1.0 - gmNw.y;',
    'float gmRock = smoothstep( 0.2, 0.4, gmSlope + ( gmN3.g - 0.5 ) * 0.18 );',
    'vec3 gmTri = abs( gmNw ); gmTri = pow( gmTri, vec3( 4.0 ) ); gmTri /= ( gmTri.x + gmTri.y + gmTri.z );',
    // layered strata: broad bands (low frequency) + finer detail that fades with distance
    'vec2 gmPx = vec2( gmW.z, gmW.y ), gmPz = vec2( gmW.x, gmW.y );',
    'float gmStrB = gmTex( gmPz * vec2( 0.008, 0.045 ) ).r * gmTri.z + gmTex( gmPx * vec2( 0.008, 0.045 ) + 0.5 ).r * gmTri.x + gmN2.r * gmTri.y;',
    'float gmStrF = gmTex( gmPz * vec2( 0.03, 0.12 ) + 0.2 ).g * gmTri.z + gmTex( gmPx * vec2( 0.03, 0.12 ) + 0.7 ).g * gmTri.x + gmN3.g * gmTri.y;',
    // vertical weathering streaks (rain run-off) on cliffs
    'float gmStk = gmTex( gmPz * vec2( 0.05, 0.006 ) + 0.3 ).b * gmTri.z + gmTex( gmPx * vec2( 0.05, 0.006 ) + 0.6 ).b * gmTri.x + 0.5 * gmTri.y;',
    'float gmFarR = smoothstep( 40.0, 160.0, gmDist );',
    'float gmStr = gmStrB * 0.55 + mix( gmStrF, 0.5, gmFarR ) * 0.3 + gmStk * 0.15;',
    'float gmCrack = 0.0;',
    'vec3 gmRockTint = mix( vec3( 0.16, 0.158, 0.152 ), vec3( 0.235, 0.205, 0.168 ), smoothstep( 0.3, 0.7, gmN1.g ) );',
    'vec3 gmRockCol = mix( gmRockTint, gmAlb * ( 1.0 - gmGreen * 0.5 ), 0.3 ) * ( 0.62 + 0.72 * gmStr ) * ( 1.0 - gmCrack * 0.4 ) * ( 1.0 - 0.28 * smoothstep( 0.55, 0.8, gmStk ) );',
    'gmAlb = mix( gmAlb, gmRockCol, gmRock );',
    'gmBumpH = mix( gmBumpH, gmStr * 1.4 - gmCrack * 0.8, gmRock );',
    'gmRough = mix( gmRough, 0.82, gmRock );',
    // plaza
    'float gmR = length( gmP );',
    'if ( gmR < 25.5 ) {',
    '  vec3 pA = gmAlb; float pR = gmRough, pM = 0.0, pB = gmBumpH;',
    '  gmPlaza( gmP, gmN3.b, gmN4.a, pA, pR, pM, pB );',
    '  float pm = 1.0 - smoothstep( 23.4, 24.6, gmR + ( gmN3.g - 0.5 ) * 1.6 );',
    '  gmAlb = mix( gmAlb, pA, pm ); gmRough = mix( gmRough, pR, pm ); gmMetal = pM * pm; gmBumpH = mix( gmBumpH, pB, pm );',
    '  gmBumpS = mix( gmBumpS, 0.55, pm );',
    '}',
    // shore line and water
    'float gmWl = gmEnv2.z;',
    'float gmAbove = gmW.y - gmWl;',
    'float gmShore = 1.0 - smoothstep( -0.05, 0.9, gmAbove );',
    'gmAlb *= mix( 1.0, 0.62, gmShore );',
    'gmRough = mix( gmRough, 0.45, gmShore );',
    'float gmUnder = smoothstep( 0.0, -0.3, gmAbove );',
    'float gmDepth = max( -gmAbove, 0.0 );',
    'gmAlb *= mix( vec3( 1.0 ), vec3( 0.52, 0.72, 0.76 ), gmUnder * smoothstep( 0.0, 3.0, gmDepth ) );',
    // rain: wet darkening, glossy puddles on flat ground
    'float gmWet = gmEnv.y;',
    'float gmPud = smoothstep( 0.64, 0.74, gmN2.r + ( gmNw.y - 1.0 ) * 5.0 - gmRock ) * gmWet * ( 1.0 - gmUnder );',
    'gmAlb *= mix( 1.0, 0.64, gmWet * ( 1.0 - gmUnder ) );',
    'gmRough = mix( gmRough, 0.32, gmWet * 0.75 );',
    'gmRough = mix( gmRough, 0.03, gmPud );',
    'gmAlb *= 1.0 - gmPud * 0.45;',
    'gmBumpS *= 1.0 - gmPud * 0.9;',
    // snow cover on upward faces
    'float gmSnow = gmEnv.z * smoothstep( 0.52, 0.82, gmNw.y + ( gmN3.b - 0.5 ) * 0.35 ) * step( 0.1, gmAbove );',
    'gmAlb = mix( gmAlb, vec3( 0.8, 0.84, 0.9 ) * ( 0.94 + 0.06 * gmN4.a ), gmSnow );',
    'gmRough = mix( gmRough, 0.72, gmSnow );',
    'gmMetal *= 1.0 - gmSnow;',
    'gmBumpS *= 1.0 - gmSnow * 0.7;',
    'diffuseColor.rgb = gmAlb;',
  ].join('\n');

  const TERRAIN_LIGHT = [
    '$',
    '{',
    '  float gmAo = vAO;',
    '  reflectedLight.indirectDiffuse *= gmAo;',
    '  reflectedLight.indirectSpecular *= mix( 1.0, gmAo, 0.8 );',
    // beyond the shadow map, forests darken the direct light (canopy shadow)
    '  float gmFar = smoothstep( gmShadow.z * 0.7, gmShadow.z * 0.95, length( gmW.xz - gmShadow.xy ) );',
    '  float gmCs = gmCloudShadow( gmW );',
    '  reflectedLight.directDiffuse *= mix( 1.0, gmAo * gmAo, 0.3 + gmFar * 0.5 ) * gmCs;',
    '  reflectedLight.directSpecular *= mix( 1.0, gmAo, 0.5 ) * gmCs;',
    // caustics on the lake bed
    '  if ( gmUnder > 0.0 ) {',
    '    float gmC = gmCaustic( gmW.xz, gmEnv.x ) * gmUnder * exp( -gmDepth * 0.35 );',
    '    reflectedLight.directDiffuse += diffuseColor.rgb * gmSunCol * gmC * 0.9 * max( gmSunDir.y, 0.0 );',
    '  }',
    '}',
  ].join('\n');

  const terrainMat = Gfx.patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 }), {
    key: 'terrain',
    vertexPre: 'attribute float aAO;\nvarying float vAO;\n' + Gfx.WORLD_VARY,
    fragmentPre: TERRAIN_FRAG_PRE,
    vertex: {
      begin_vertex: '$\nvAO = aAO;',
      project_vertex: '$\n' + Gfx.WORLD_VERTEX,
    },
    fragment: {
      color_fragment: TERRAIN_ALBEDO,
      roughnessmap_fragment: '$\nroughnessFactor = gmRough;',
      metalnessmap_fragment: '$\nmetalnessFactor = gmMetal;',
      normal_fragment_maps: '$\nnormal = gmBump( -vViewPosition, normal, gmBumpH, gmBumpS * 0.16 );',
      aomap_fragment: TERRAIN_LIGHT,
    },
  });

  // Shadow caster for the terrain without the rim mountains: at a low sun they would
  // shadow the whole arena (the game is played inside the force field).
  const terrainDepthMat = Gfx.patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), {
    key: 'terrain-depth',
    vertex: { begin_vertex: '$\ntransformed.y -= smoothstep( ' + (ARENA_R - 8).toFixed(1) + ', ' + (ARENA_R + 6).toFixed(1) + ', length( transformed.xz ) ) * 500.0;' },
  });

  let tGeo = null, tPos = null, tNor = null, tCol = null, tAO = null;
  let tRes = 0, tCell = 2, tHalf = 180;

  function buildTerrain() {
    World.terrainMesh = removeMesh(World.terrainMesh, true);
    tGeo = null;
    const T = Tr();
    if (!T) {
      // no terrain module: a flat meadow so the scene still works
      const g = new THREE.PlaneGeometry(CFG.MAP_SIZE, CFG.MAP_SIZE, 1, 1);
      g.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x6f9a48, roughness: 1 }));
      mesh.receiveShadow = true;
      mesh.name = 'terrain';
      scene.add(mesh);
      World.terrainMesh = mesh;
      return;
    }
    tRes = T.res; tCell = T.cellSize; tHalf = T.half;
    const R = tRes, N = R * R;
    tPos = new Float32Array(N * 3);
    tNor = new Float32Array(N * 3);
    tCol = new Float32Array(N * 3);
    tAO = new Float32Array(N);
    const idx = new Uint32Array((R - 1) * (R - 1) * 6);
    let k = 0;
    for (let qz = 0; qz < R - 1; qz++) {
      for (let qx = 0; qx < R - 1; qx++) {
        const i00 = qz * R + qx, i01 = i00 + R, i11 = i00 + R + 1, i10 = i00 + 1;
        idx[k++] = i00; idx[k++] = i01; idx[k++] = i11;
        idx[k++] = i00; idx[k++] = i11; idx[k++] = i10;
      }
    }
    writeTerrain(T, 0, 0, R - 1, R - 1, true);
    tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage));
    tGeo.setAttribute('normal', new THREE.BufferAttribute(tNor, 3).setUsage(THREE.DynamicDrawUsage));
    tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3).setUsage(THREE.DynamicDrawUsage));
    tGeo.setAttribute('aAO', new THREE.BufferAttribute(tAO, 1).setUsage(THREE.DynamicDrawUsage));
    tGeo.setIndex(new THREE.BufferAttribute(idx, 1));
    tGeo.computeBoundingSphere();
    const mesh = new THREE.Mesh(tGeo, terrainMat);
    mesh.customDepthMaterial = terrainDepthMat;
    mesh.name = 'terrain';
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    scene.add(mesh);
    World.terrainMesh = mesh;
  }

  /** Write vertices [ix0..ix1] x [iz0..iz1]. geo=false: colours + AO only. */
  function writeTerrain(T, ix0, iz0, ix1, iz1, geo) {
    const H = T.heights, C = T.colors, F = T.forestData, R = tRes, L = Gfx.LIN8;
    const cl = function (v) { return v < 0 ? 0 : v > R - 1 ? R - 1 : v; };
    const inv2c = 1 / (2 * tCell);
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const i = iz * R + ix, o = i * 3;
        const h = H[i];
        if (geo) {
          tPos[o] = -tHalf + ix * tCell;
          tPos[o + 1] = h;
          tPos[o + 2] = -tHalf + iz * tCell;
          const hl = H[iz * R + cl(ix - 1)], hr = H[iz * R + cl(ix + 1)];
          const hd = H[cl(iz - 1) * R + ix], hu = H[cl(iz + 1) * R + ix];
          let nx = (hl - hr) * inv2c, ny = 1, nz = (hd - hu) * inv2c;
          const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
          tNor[o] = nx * l; tNor[o + 1] = ny * l; tNor[o + 2] = nz * l;
        }
        if (C) {
          tCol[o] = L[C[o]]; tCol[o + 1] = L[C[o + 1]]; tCol[o + 2] = L[C[o + 2]];
        } else { tCol[o] = 0.2; tCol[o + 1] = 0.35; tCol[o + 2] = 0.1; }
        // baked ambient occlusion: concavity + forest canopy
        let s1 = 0, s2 = 0;
        for (let d = 0; d < 8; d++) {
          const dx = DIR8X[d], dz = DIR8Z[d];
          s1 += H[cl(iz + dz * 2) * R + cl(ix + dx * 2)];
          s2 += H[cl(iz + dz * 6) * R + cl(ix + dx * 6)];
        }
        const conc = (s1 / 8 - h) * 0.55 + (s2 / 8 - h) * 0.25;
        let ao = 1 - U.clamp(conc * 0.075, -0.06, 0.32);
        const f = F ? F[i] : 0;
        ao *= 1 - 0.42 * f;
        tAO[i] = U.clamp(ao, 0.42, 1.06);
      }
    }
  }
  const DIR8X = [1, 1, 0, -1, -1, -1, 0, 1], DIR8Z = [0, 1, 1, 1, 0, -1, -1, -1];

  /**
   * Refresh a world-space rectangle of the terrain mesh. The CPU arrays are written now;
   * the GPU upload is merged into one partial upload per frame (flushTerrainUpload).
   */
  let up0 = Infinity, up1 = -1, upGeo = false;
  function refreshTerrainRect(x0, z0, x1, z1, geo) {
    const T = Tr();
    if (!T || !tGeo) return;
    const m = geo ? 7 : 1;
    const ix0 = U.clamp(Math.floor((x0 + tHalf) / tCell) - m, 0, tRes - 1), ix1 = U.clamp(Math.ceil((x1 + tHalf) / tCell) + m, 0, tRes - 1);
    const iz0 = U.clamp(Math.floor((z0 + tHalf) / tCell) - m, 0, tRes - 1), iz1 = U.clamp(Math.ceil((z1 + tHalf) / tCell) + m, 0, tRes - 1);
    if (ix1 < ix0 || iz1 < iz0) return;
    writeTerrain(T, ix0, iz0, ix1, iz1, geo);
    const a = iz0 * tRes, b = (iz1 + 1) * tRes;
    if (a < up0) up0 = a;
    if (b > up1) up1 = b;
    if (geo) upGeo = true;
  }
  function flushTerrainUpload() {
    if (tGeo && up1 > up0) {
      setRange(tGeo.attributes.color, up0 * 3, up1 * 3);
      setRange(tGeo.attributes.aAO, up0, up1);
      if (upGeo) { setRange(tGeo.attributes.position, up0 * 3, up1 * 3); setRange(tGeo.attributes.normal, up0 * 3, up1 * 3); }
    }
    up0 = Infinity; up1 = -1; upGeo = false;
  }
  function setRange(at, a, b) {
    at.updateRange.offset = a;
    at.updateRange.count = b - a;
    at.needsUpdate = true;
  }

  // ====================================================== backdrop mountains
  let backdrop = null;

  /** A ring of far mountains beyond the map edge, so the horizon is never empty. */
  function buildBackdrop(seed) {
    backdrop = removeMesh(backdrop, true);
    const noise = GM.Noise.create((seed ^ 0x51ed27) >>> 0);
    const A = 160;
    const RADII = [150, 172, 200, 236, 282, 340, 412, 500, 610, 740];
    const PROF = [-12, 10, 36, 70, 104, 124, 110, 80, 44, 8];
    const nr = RADII.length;
    const pos = new Float32Array(nr * A * 3), col = new Float32Array(nr * A * 3);
    for (let ri = 0; ri < nr; ri++) {
      for (let ai = 0; ai < A; ai++) {
        const a = (ai / A) * TAU;
        const r = RADII[ri] * (1 + (hash(ai, ri, 5) - 0.5) * 0.05);
        const x = Math.sin(a) * r, z = Math.cos(a) * r;
        const n = noise.ridged(x / 120 + 3, z / 120 - 7, 4);
        const n2 = noise.noise2(x / 36, z / 36);
        const h = PROF[ri] * (0.42 + 0.8 * n) + (ri > 1 && ri < nr - 1 ? n2 * 8 : 0);
        const o = (ri * A + ai) * 3;
        pos[o] = x; pos[o + 1] = h; pos[o + 2] = z;
        const k = hash(ai, ri, 7);
        let cr, cg, cb;
        if (h > 88 + k * 16) { cr = 228; cg = 232; cb = 238; }
        else if (h > 34 + k * 10) { cr = 118 + k * 16; cg = 114 + k * 14; cb = 108 + k * 12; }
        else { cr = 62 + k * 14; cg = 84 + k * 14; cb = 52 + k * 8; }
        col[o] = Gfx.lin255(cr); col[o + 1] = Gfx.lin255(cg); col[o + 2] = Gfx.lin255(cb);
      }
    }
    const idx = [];
    for (let ri = 0; ri < nr - 1; ri++) {
      for (let ai = 0; ai < A; ai++) {
        const a0 = ri * A + ai, a1 = ri * A + (ai + 1) % A, b0 = (ri + 1) * A + ai, b1 = (ri + 1) * A + (ai + 1) % A;
        idx.push(a0, a1, b1, a0, b1, b0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aAO', new THREE.BufferAttribute(new Float32Array(nr * A).fill(1), 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    // faces must point up (winding follows the ring direction)
    const nrm = g.attributes.normal.array;
    let flip = 0;
    for (let i = 1; i < nrm.length; i += 3) flip += nrm[i];
    if (flip < 0) {
      for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      g.setIndex(idx);
      g.computeVertexNormals();
    }
    backdrop = new THREE.Mesh(g, terrainMat);
    backdrop.name = 'backdrop';
    backdrop.receiveShadow = false;
    backdrop.matrixAutoUpdate = false;
    backdrop.frustumCulled = false;
    backdrop.updateMatrix();
    scene.add(backdrop);
  }

  // =================================================================== water
  const WATER_VS = [
    '#include <common>',
    '#include <gm_common>',
    'uniform float uLevel;',
    'attribute float aGround;',
    'varying float vDepth;',
    'varying vec3 vWorld;',
    '#include <fog_pars_vertex>',
    'void main() {',
    '  vec3 p = position;',
    '  float t = gmEnv.x;',
    '  float w = sin( p.x * 0.31 + t * 1.25 ) * 0.045 + sin( p.z * 0.27 - t * 1.05 ) * 0.04 + sin( ( p.x - p.z ) * 0.53 + t * 1.9 ) * 0.02;',
    '  p.y = uLevel + w * smoothstep( 0.0, 1.2, uLevel - aGround );',
    '  vDepth = uLevel - aGround;',
    '  vec4 wp = modelMatrix * vec4( p, 1.0 );',
    '  vWorld = wp.xyz;',
    '  vec4 mvPosition = viewMatrix * wp;',
    '  gl_Position = projectionMatrix * mvPosition;',
    '  #include <fog_vertex>',
    '}',
  ].join('\n');
  const WATER_FS = [
    '#include <common>',
    '#include <gm_common>',
    'uniform float uOpacity;',
    'uniform vec3 uShallow;',
    'uniform vec3 uDeep;',
    'uniform vec3 uAmbient;',
    'varying float vDepth;',
    'varying vec3 vWorld;',
    '#include <fog_pars_fragment>',
    'float wh( vec2 p, float fine ) {',
    '  float t = gmEnv.x;',
    '  vec2 wd = gmEnv2.xy;',
    '  float a = gmTex( p * 0.045 + wd * t * 0.012 ).g;',
    '  float b = gmTex( p * 0.11 - wd.yx * t * 0.021 + 0.37 ).b;',
    '  float c = gmTex( p * 0.3 + vec2( t * 0.03, -t * 0.024 ) ).a;',
    '  return a * 0.62 + b * 0.3 + c * 0.08 * fine;',
    '}',
    'void main() {',
    '  if ( vDepth < -0.05 ) discard;',
    '  float depth = max( vDepth, 0.0 );',
    '  vec3 V = normalize( cameraPosition - vWorld );',
    '  float dist = length( cameraPosition - vWorld );',
    '  float foot = length( fwidth( vWorld.xz ) );',
    '  float fine = 1.0 - smoothstep( 0.08, 0.35, foot );',
    '  float e = max( 0.2, foot * 0.8 );',
    '  float h0 = wh( vWorld.xz, fine );',
    '  float hx = wh( vWorld.xz + vec2( e, 0.0 ), fine );',
    '  float hz = wh( vWorld.xz + vec2( 0.0, e ), fine );',
    '  float amp = ( 0.9 + 2.0 * gmEnv.w ) * ( 1.0 - smoothstep( 30.0, 200.0, dist ) * 0.75 );',
    '  vec3 N = normalize( vec3( ( h0 - hx ) / e * amp * 0.1, 1.0, ( h0 - hz ) / e * amp * 0.1 ) );',
    '  float ndv = max( dot( N, V ), 0.0 );',
    '  float F = 0.02 + 0.98 * pow( 1.0 - ndv, 5.0 );',
    '  vec3 R = reflect( -V, N );',
    '  R.y = abs( R.y );',
    '  vec3 refl = gmSky( R );',
    // sun glitter (HDR, blooms)
    '  vec3 Hh = normalize( gmSunDir + V );',
    '  float nh = max( dot( N, Hh ), 0.0 );',
    '  float rough = 0.06 + 0.1 * gmEnv.w;',
    '  float a2 = rough * rough;',
    '  float dd = nh * nh * ( a2 - 1.0 ) + 1.0;',
    '  float D = a2 / ( 3.14159 * dd * dd );',
    '  vec3 spec = gmSunCol * D * F * 0.25 * step( 0.0, gmSunDir.y );',
    // body colour: absorption by depth
    '  vec3 absorb = exp( -depth * vec3( 0.52, 0.16, 0.1 ) );',
    '  float T = exp( -depth * 0.85 );',
    '  vec3 body = mix( uDeep, uShallow, exp( -depth * 0.4 ) ) * uAmbient;',
    '  body *= 1.0 - T;',
    // shore foam
    '  float foamN = gmTex( vWorld.xz * 0.35 + vec2( gmEnv.x * 0.04, 0.0 ) ).b;',
    '  float foamN2 = gmTex( vWorld.xz * 1.3 - vec2( 0.0, gmEnv.x * 0.05 ) ).a;',
    '  float lap = 0.5 + 0.5 * sin( depth * 22.0 - gmEnv.x * 2.2 + foamN * 6.0 );',
    '  float band = 1.0 - smoothstep( 0.0, 0.12 + foamN * 0.16, depth );',
    '  float foam = band * smoothstep( 0.5, 0.85, foamN2 * 0.6 + lap * 0.45 + band * 0.25 );',
    '  vec3 foamCol = uAmbient * 0.9 + gmSunCol * max( gmSunDir.y, 0.0 ) * 0.3;',
    // premultiplied output: dst * (1 - a) + src
    '  float cover = 1.0 - T * ( 1.0 - F );',
    '  vec3 col = body * ( 1.0 - F ) + refl * F + spec;',
    '  col = mix( col, foamCol, foam * 0.7 );',
    '  cover = max( cover, foam * 0.7 );',
    '  float edge = smoothstep( -0.05, 0.12, vDepth );',
    '  cover *= edge * uOpacity;',
    '  col *= edge * uOpacity;',
    '  gl_FragColor = vec4( col, cover );',
    '  #ifdef USE_FOG',
    '    float fgf = gmFogFactor();',
    '    gl_FragColor.rgb = mix( gl_FragColor.rgb, gmFogColor() * gl_FragColor.a, fgf );',
    '  #endif',
    '}',
  ].join('\n');

  let waterMat = null;
  let wGeo = null, wGround = null, wIndex = null, wThreshold = -Infinity;

  function makeWaterMaterial() {
    waterMat = new THREE.ShaderMaterial({
      uniforms: Gfx.uniformsWith({
        uLevel: { value: CFG.BASE_WATER_LEVEL },
        uOpacity: { value: 1 },
        uShallow: { value: new THREE.Color(0x3fa5a8) },
        uDeep: { value: new THREE.Color(0x0e3f52) },
        uAmbient: { value: new THREE.Color(1, 1, 1) },
      }, true),
      vertexShader: WATER_VS,
      fragmentShader: WATER_FS,
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      fog: true,
    });
    waterMat.extensions = { derivatives: true };
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
  // Mostly invisible: a faint hexagon lattice at grazing angles, a soft glow
  // where it meets the ground, and cells that ripple when the zone moves.
  const DOME_VS = [
    'varying vec3 vLocal;',
    'varying vec3 vWorld;',
    'varying vec3 vNrm;',
    '#include <fog_pars_vertex>',
    'void main() {',
    '  vLocal = position;',
    '  vec4 wp = modelMatrix * vec4( position, 1.0 );',
    '  vWorld = wp.xyz;',
    '  vNrm = normalize( mat3( modelMatrix ) * normal );',
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
    'float hexDist( vec2 p ) { p = abs( p ); return max( dot( p, vec2( 0.5, 0.8660254 ) ), p.x ); }',
    'void main() {',
    '  vec3 p = normalize( vLocal );',
    '  float az = atan( p.x, p.z );',
    '  float el = asin( clamp( p.y, -1.0, 1.0 ) );',
    '  vec2 uv = vec2( az * 15.2788, el * 15.2788 );',
    '  vec2 r = vec2( 1.0, 1.7320508 );',
    '  vec2 h = r * 0.5;',
    '  vec2 a = mod( uv, r ) - h;',
    '  vec2 b = mod( uv - h, r ) - h;',
    '  vec2 gv = dot( a, a ) < dot( b, b ) ? a : b;',
    '  vec2 id = uv - gv;',
    '  float edge = 0.5 - hexDist( gv );',
    '  float aa = fwidth( edge ) * 1.5 + 0.004;',
    '  float line = 1.0 - smoothstep( 0.0, 0.03 + aa, edge );',
    '  float rnd = fract( sin( dot( id, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );',
    '  float pulse = 0.5 + 0.5 * sin( uTime * ( 0.5 + rnd * 1.2 ) + rnd * 6.2831 );',
    '  float band = pow( 1.0 - abs( fract( el * 0.9 - uTime * 0.05 ) - 0.5 ) * 2.0, 10.0 );',
    '  vec3 V = normalize( cameraPosition - vWorld );',
    '  float ndv = abs( dot( normalize( vNrm ), V ) );',
    '  float fres = pow( 1.0 - ndv, 3.0 );',
    '  float dist = length( cameraPosition - vWorld );',
    '  float nearK = 1.0 - smoothstep( 12.0, 70.0, dist );',
    // seen edge-on up close the lattice collapses into streaks: fade it there
    '  float edgeOn = smoothstep( 0.55, 0.95, fres ) * ( 1.0 - smoothstep( 30.0, 90.0, dist ) );',
    '  float base = exp( -max( el, 0.0 ) * 30.0 );',
    '  float cellGlow = step( 0.975, rnd ) * pulse;',
    '  float vis = line * ( 0.012 + 0.12 * fres + 0.6 * nearK * ( 1.0 - fres ) ) * ( 0.6 + 0.4 * pulse ) * ( 1.0 - edgeOn ) + band * line * 0.35 + fres * 0.03 * ( 1.0 - edgeOn ) + base * 0.3 + cellGlow * 0.04 * ( 0.3 + fres );',
    '  vis *= uStrength;',
    '  vis *= mix( 1.0, 0.45, smoothstep( 0.15, 0.7, el ) * ( 1.0 - band ) );',
    '  vis *= 1.0 - smoothstep( 1.0, 1.45, el ) * 0.85;',
    '  #ifdef USE_FOG',
    '    vis *= 1.0 - gmFogFactor() * 0.9;',
    '  #endif',
    '  gl_FragColor = vec4( uColor * vis, 1.0 );',
    '}',
  ].join('\n');
  let domeMat = null;

  function buildDome() {
    domeMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 },
        uStrength: { value: 1 },
        uColor: { value: new THREE.Color(0.35, 0.85, 1.6) },
      }]),
      vertexShader: DOME_VS,
      fragmentShader: DOME_FS,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: true,
    });
    domeMat.extensions = { derivatives: true };
    const g = new THREE.SphereGeometry(ARENA_R, 128, 40, 0, TAU, 0, Math.PI / 2);
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
    const segs = 160, radial = 48;
    const frames = curve.computeFrenetFrames(segs, false);
    const pos = [], idx = [], uvs = [];
    for (let k = 0; k <= segs; k++) {
      const u = k / segs;
      const P = curve.getPointAt(u);
      const N = frames.normals[k], B = frames.binormals[k];
      const r0 = hornRadius(u);
      for (let j = 0; j <= radial; j++) {
        const v = (j / radial) * TAU;
        const flute = 1 + 0.06 * Math.pow(Math.abs(Math.cos(v * 6 + u * 9)), 0.6) * (1 - u * 0.5);
        const r = r0 * flute;
        const cx = Math.cos(v), sx = Math.sin(v);
        pos.push(P.x + (cx * N.x + sx * B.x) * r, P.y + (cx * N.y + sx * B.y) * r, P.z + (cx * N.z + sx * B.z) * r);
        uvs.push(u, j / radial);
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
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // hammered gold: fine bump + roughness breakup, darker tarnish in the flutes
    const goldPatch = {
      key: 'gold',
      vertexPre: Gfx.WORLD_VARY,
      fragmentPre: Gfx.WORLD_VARY,
      vertex: { project_vertex: '$\n' + Gfx.WORLD_VERTEX },
      fragment: {
        color_fragment: '$\nvec4 gmG = gmTex( vGmWorld.xz * 0.28 + vGmWorld.y * 0.21 );\nvec4 gmG2 = gmTex( vGmWorld.xy * 0.13 + 0.5 );\ndiffuseColor.rgb *= 0.88 + 0.2 * gmG2.g;',
        roughnessmap_fragment: '$\nroughnessFactor = clamp( roughnessFactor + ( gmG.a - 0.5 ) * 0.16 + ( gmG2.r - 0.5 ) * 0.2, 0.08, 1.0 );',
        normal_fragment_maps: '$\nnormal = gmBump( -vViewPosition, normal, gmG.b, 0.008 );',
      },
    };
    const gold = Gfx.patch(new THREE.MeshStandardMaterial({ color: 0xe8b04a, metalness: 1, roughness: 0.3, side: THREE.DoubleSide }), goldPatch);
    const horn = new THREE.Mesh(g, gold);
    horn.castShadow = true;
    horn.receiveShadow = true;
    group.add(horn);

    const bright = Gfx.patch(new THREE.MeshStandardMaterial({ color: 0xffcf6a, metalness: 1, roughness: 0.18 }), goldPatch);
    const dark = Gfx.patch(new THREE.MeshStandardMaterial({ color: 0xc08a33, metalness: 1, roughness: 0.34 }), goldPatch);
    const addRing = function (u, tube, mat, extra) {
      const P = curve.getPointAt(u);
      const tan = curve.getTangentAt(u);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(hornRadius(u) * 1.04 + extra, tube, 14, 72), mat);
      ring.position.copy(P);
      ring.quaternion.setFromUnitVectors(ZAXIS, tan);
      ring.castShadow = true;
      group.add(ring);
    };
    addRing(0, 0.2, bright, 0.08);
    addRing(0.012, 0.07, dark, 0.2);
    addRing(0.24, 0.11, dark, 0.02);
    addRing(0.48, 0.09, dark, 0.02);
    addRing(0.7, 0.06, bright, 0.01);
    // dark interior so the mouth reads as deep
    const du = 0.1;
    const inner = new THREE.Mesh(new THREE.CircleGeometry(hornRadius(du) * 1.06, 40), new THREE.MeshStandardMaterial({ color: 0x0b0804, roughness: 1, metalness: 0 }));
    inner.position.copy(curve.getPointAt(du));
    inner.quaternion.setFromUnitVectors(ZAXIS, curve.getTangentAt(du).negate());
    group.add(inner);
    // golden finial at the tip
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), bright);
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
    const m3 = new THREE.Matrix4().makeTranslation(0, 0.225, 0);
    const geo = mergeGeometries([
      [new THREE.CylinderGeometry(1.0, 1.16, 0.22, 40), m1, 0x3a3f46],
      [new THREE.CylinderGeometry(1.02, 1.02, 0.03, 40), m3, 0x8d949c],
      [new THREE.CylinderGeometry(0.86, 0.97, 0.1, 40), m2, 0xb9c0c8],
    ], true);
    const mat = Gfx.patch(new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.9, roughness: 0.32 }), {
      key: 'pedestal',
      vertexPre: Gfx.WORLD_VARY,
      fragmentPre: Gfx.WORLD_VARY,
      vertex: { project_vertex: '$\n' + Gfx.WORLD_VERTEX },
      fragment: {
        // brushed metal: streaky roughness
        roughnessmap_fragment: '$\nroughnessFactor = clamp( roughnessFactor + ( gmTex( vec2( length( vGmWorld.xz ) * 3.0, 0.3 ) ).a - 0.5 ) * 0.25, 0.1, 1.0 );',
      },
    });
    pedBody = new THREE.InstancedMesh(geo, mat, PED_MAX);
    pedBody.name = 'pedestals';
    pedBody.castShadow = true;
    pedBody.receiveShadow = true;
    pedBody.frustumCulled = false;
    const rg = new THREE.RingGeometry(0.64, 0.72, 48);
    rg.rotateX(-Math.PI / 2);
    rg.translate(0, PED_H + 0.012, 0);
    pedGlow = new THREE.InstancedMesh(rg, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.8, 3.2), toneMapped: false }), PED_MAX);
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
  const BURNT_TRUNK = 0x1b1714;

  let pineTrunkGeo = null, broadTrunkGeo = null, pineGeo = null, broadGeo = null, pineFarGeo = null, broadFarGeo = null, rockGeoA = null, rockGeoB = null;
  let barkMat = null, pineMat = null, broadMat = null, rockMat = null, pineDepth = null, broadDepth = null;
  let rockMeshA = null, rockMeshB = null;
  let treeBuckets = [], tbN = 1, tbHalf = CFG.MAP_SIZE / 2;
  let rocksDirty = false;
  // Trees live in CH x CH spatial chunks so every view (and the shadow pass) can
  // frustum-cull them; each chunk has a detailed near set and a cheap far set.
  const CH = 5;
  const LOD_NEAR = 95;                // metres from the camera to a chunk centre
  const chunks = [];
  let treesReady = false;
  const rockData = [];                // {x, z, lift, b, idx, rot, tx, tz, sx, sy, sz, col}

  function unpackLin(h, c) {
    c.r = Gfx.LIN8[(h >> 16) & 255]; c.g = Gfx.LIN8[(h >> 8) & 255]; c.b = Gfx.LIN8[h & 255];
    return c;
  }
  function pack(c) {
    return (((U.clamp01(c.r) * 255) | 0) << 16) | (((U.clamp01(c.g) * 255) | 0) << 8) | ((U.clamp01(c.b) * 255) | 0);
  }

  // ------------------------------------------------------ tree geometries
  /** Growable triangle soup with per-vertex normal and colour. */
  function Soup() { this.p = []; this.n = []; this.c = []; }
  Soup.prototype.v = function (p, n, c) {
    this.p.push(p[0], p[1], p[2]);
    this.n.push(n[0], n[1], n[2]);
    this.c.push(c, c, c);
  };
  Soup.prototype.geo = function () {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  };
  function nrm3(x, y, z) { const l = Math.sqrt(x * x + y * y + z * z) || 1; return [x / l, y / l, z / l]; }

  /** Tapered open cylinder (trunk / branch) between two points. */
  function branch(S, a, b, r0, r1, segs, c0, c1) {
    const ax = b[0] - a[0], ay = b[1] - a[1], az = b[2] - a[2];
    const len = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
    const d = [ax / len, ay / len, az / len];
    const t1 = Math.abs(d[1]) < 0.9 ? nrm3(d[2], 0, -d[0]) : [1, 0, 0];
    const t2 = [d[1] * t1[2] - d[2] * t1[1], d[2] * t1[0] - d[0] * t1[2], d[0] * t1[1] - d[1] * t1[0]];
    const ring = function (p, r, k) {
      const a2 = (k / segs) * TAU;
      const ca = Math.cos(a2), sa = Math.sin(a2);
      const nx = t1[0] * ca + t2[0] * sa, ny = t1[1] * ca + t2[1] * sa, nz = t1[2] * ca + t2[2] * sa;
      return { p: [p[0] + nx * r, p[1] + ny * r, p[2] + nz * r], n: [nx, ny, nz] };
    };
    for (let k = 0; k < segs; k++) {
      const p00 = ring(a, r0, k), p01 = ring(a, r0, k + 1), p10 = ring(b, r1, k), p11 = ring(b, r1, k + 1);
      S.v(p00.p, p00.n, c0); S.v(p11.p, p11.n, c1); S.v(p10.p, p10.n, c1);
      S.v(p00.p, p00.n, c0); S.v(p01.p, p01.n, c0); S.v(p11.p, p11.n, c1);
    }
  }

  /** Conifer: drooping, jagged tiers with soft (crown-rounded) normals and baked AO. */
  function buildPineGeo() {
    const S = new Soup();
    const tiers = 6;
    for (let k = 0; k < tiers; k++) {
      const f = k / (tiers - 1);
      const y0 = 1.25 + k * 0.84;
      const h = 1.75 - k * 0.1;
      const r = 1.98 * (1 - f * 0.78) + 0.12;
      const N = 12;
      const rot = k * 0.61;
      const apex = [0, y0 + h, 0];
      const under = [0, y0 + h * 0.22, 0];
      const rim = [];
      for (let i = 0; i < N; i++) {
        const a = rot + (i / N) * TAU;
        const tipI = i % 2 === 0;
        const rr = r * (tipI ? 1.08 : 0.74) * (0.9 + 0.2 * hash(i, k, 31));
        const droop = tipI ? 0.2 + 0.18 * r * 0.5 : 0.02;
        rim.push({ p: [Math.sin(a) * rr, y0 - droop, Math.cos(a) * rr], tip: tipI });
      }
      const topAO = 0.72 + 0.28 * f;
      for (let i = 0; i < N; i++) {
        const A = rim[i], B = rim[(i + 1) % N];
        const na = nrm3(A.p[0], r * 0.62, A.p[2]), nb = nrm3(B.p[0], r * 0.62, B.p[2]);
        const ca = (A.tip ? 0.78 : 0.5) * topAO, cb = (B.tip ? 0.78 : 0.5) * topAO;
        // outer skin
        S.v(apex, [0, 1, 0], 1.0 * topAO + 0.1);
        S.v(A.p, na, ca);
        S.v(B.p, nb, cb);
        // shaded underside
        const ua = nrm3(A.p[0], -r * 0.9, A.p[2]), ub = nrm3(B.p[0], -r * 0.9, B.p[2]);
        S.v(under, [0, -1, 0], 0.18);
        S.v(B.p, ub, cb * 0.5);
        S.v(A.p, ua, ca * 0.5);
      }
    }
    return S.geo();
  }
  function buildPineTrunk() {
    const S = new Soup();
    branch(S, [0, -0.35, 0], [0, 2.3, 0], 0.22, 0.13, 7, 0.55, 0.85);
    branch(S, [0, 2.3, 0], [0, 6.2, 0], 0.13, 0.03, 6, 0.6, 0.6);
    return S.geo();
  }

  /** Broadleaf: clustered, displaced blobs; normals rounded around the crown centre. */
  function buildBroadGeo() {
    const S = new Soup();
    const C = [0, 3.8, 0];
    const blobs = [
      [0, 3.72, 0, 1.42], [0.95, 3.45, 0.3, 1.06], [-0.9, 3.52, -0.36, 1.08], [0.3, 4.52, -0.5, 1.0],
      [-0.4, 4.38, 0.6, 0.98], [0.5, 3.1, -0.9, 0.9], [-0.45, 3.05, 0.92, 0.88],
    ];
    const noise = GM.Noise.create(4242);
    for (let bi = 0; bi < blobs.length; bi++) {
      const b = blobs[bi];
      const ico = new THREE.IcosahedronGeometry(1, 1);
      const pa = ico.attributes.position;
      for (let t = 0; t < pa.count; t += 3) {
        const tri = [];
        for (let v = 0; v < 3; v++) {
          const x = pa.getX(t + v), y = pa.getY(t + v), z = pa.getZ(t + v);
          const d = 1 + 0.2 * noise.noise2(x * 1.7 + bi * 3.1, z * 1.7 + y * 1.3) + 0.08 * noise.noise2(x * 4 + bi, y * 4 - z * 3);
          const px = b[0] + x * b[3] * d, py = b[1] + y * b[3] * d * 0.86, pz = b[2] + z * b[3] * d;
          const cx = px - C[0], cy = (py - C[1]) * 1.2, cz = pz - C[2];
          const cn = nrm3(cx, cy, cz);
          const n = nrm3(cn[0] * 0.7 + x * 0.3, cn[1] * 0.7 + y * 0.3, cn[2] * 0.7 + z * 0.3);
          const rad = Math.sqrt(cx * cx + cz * cz + (py - C[1]) * (py - C[1]));
          const ao = U.clamp(0.4 + 0.6 * U.smoothstep(-1.4, 1.3, py - C[1]), 0.3, 1) * (0.62 + 0.38 * U.clamp01(rad / 2.1));
          tri.push({ p: [px, py, pz], n, c: ao });
        }
        for (const q of tri) S.v(q.p, q.n, q.c);
      }
      ico.dispose();
    }
    return S.geo();
  }
  function buildBroadTrunk() {
    const S = new Soup();
    branch(S, [0, -0.35, 0], [0.05, 2.5, 0.02], 0.25, 0.16, 8, 0.5, 0.8);
    branch(S, [0.05, 2.5, 0.02], [0.1, 3.9, -0.05], 0.16, 0.07, 7, 0.8, 0.7);
    branch(S, [0.05, 2.35, 0.02], [0.9, 3.35, 0.35], 0.1, 0.04, 6, 0.75, 0.7);
    branch(S, [0.05, 2.45, 0.02], [-0.75, 3.5, -0.4], 0.1, 0.04, 6, 0.75, 0.7);
    branch(S, [0.08, 3.1, 0.0], [0.4, 4.2, 0.7], 0.07, 0.03, 5, 0.7, 0.7);
    return S.geo();
  }

  /** Far LOD conifer: four tiers, no underside, trunk stub baked in (dark vertex colour). */
  function buildPineFarGeo() {
    const S = new Soup();
    branch(S, [0, -0.3, 0], [0, 1.6, 0], 0.2, 0.14, 4, 0.3, 0.35);
    const tiers = 4;
    for (let k = 0; k < tiers; k++) {
      const f = k / (tiers - 1);
      const y0 = 1.25 + k * 1.2;
      const h = 2.1 - k * 0.12;
      const r = 2.0 * (1 - f * 0.75) + 0.12;
      const N = 8;
      const apex = [0, y0 + h, 0];
      const topAO = 0.72 + 0.28 * f;
      for (let i = 0; i < N; i++) {
        const a0 = k * 0.7 + (i / N) * TAU, a1 = k * 0.7 + ((i + 1) / N) * TAU;
        const p0 = [Math.sin(a0) * r, y0 - 0.15, Math.cos(a0) * r], p1 = [Math.sin(a1) * r, y0 - 0.15, Math.cos(a1) * r];
        S.v(apex, [0, 1, 0], topAO + 0.1);
        S.v(p0, nrm3(p0[0], r * 0.62, p0[2]), 0.62 * topAO);
        S.v(p1, nrm3(p1[0], r * 0.62, p1[2]), 0.62 * topAO);
      }
    }
    return S.geo();
  }
  /** Far LOD broadleaf: five coarse blobs with crown-rounded normals + trunk stub. */
  function buildBroadFarGeo() {
    const S = new Soup();
    branch(S, [0, -0.3, 0], [0, 2.8, 0], 0.24, 0.16, 4, 0.3, 0.35);
    const C = [0, 3.8, 0];
    const blobs = [[0, 3.75, 0, 1.55], [0.95, 3.45, 0.3, 1.1], [-0.92, 3.5, -0.35, 1.1], [0.25, 4.55, -0.45, 1.05], [-0.3, 3.3, 0.9, 0.95]];
    for (const b of blobs) {
      const ico = new THREE.IcosahedronGeometry(1, 0);
      const pa = ico.attributes.position;
      for (let t = 0; t < pa.count; t++) {
        const x = pa.getX(t), y = pa.getY(t), z = pa.getZ(t);
        const px = b[0] + x * b[3], py = b[1] + y * b[3] * 0.86, pz = b[2] + z * b[3];
        const cn = nrm3(px - C[0], (py - C[1]) * 1.2, pz - C[2]);
        const ao = U.clamp(0.42 + 0.58 * U.smoothstep(-1.4, 1.3, py - C[1]), 0.3, 1);
        S.v([px, py, pz], cn, ao);
      }
      ico.dispose();
    }
    return S.geo();
  }

  /** Lumpy boulder: welded icosphere with layered noise and a flattened base. */
  function buildRock(seed, detail, flat) {
    const base = new THREE.IcosahedronGeometry(1, detail);
    const g = weld(base, 1e-3);
    base.dispose();
    const noise = GM.Noise.create(seed);
    const pa = g.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      let x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      const d = 1 + 0.2 * noise.noise2(x * 1.3 + 7, z * 1.3 + y) + 0.08 * noise.noise2(x * 3.7, y * 3.7 + z) + 0.035 * noise.noise2(x * 9, z * 9 - y * 4);
      x *= d; y *= d; z *= d;
      if (flat && y < -0.25) y = -0.25 + (y + 0.25) * 0.3;
      // chiselled facets: quantise a little along the normal direction
      pa.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    return g;
  }

  // ------------------------------------------------------ tree materials
  const TREE_WIND = [
    '#ifdef USE_INSTANCING',
    '{',
    '  vec3 gmIp = vec3( instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2] );',
    '  float gmSy = length( instanceMatrix[1].xyz );',
    '  float gmH = max( position.y - uTreeWind.x, 0.0 ) * uTreeWind.y;',
    '  float gmBend = gmH * gmH;',
    '  float gmT = gmEnv.x;',
    '  float gmWs = gmEnv.w;',
    '  vec2 gmWd = gmEnv2.xy;',
    '  float gmGust = gmTex( gmIp.xz * 0.006 - gmWd * gmT * 0.035 ).r;',
    '  float gmSw = sin( gmT * ( 1.05 + gmWs * 1.2 ) + gmIp.x * 0.37 + gmIp.z * 0.29 );',
    '  float gmAmp = ( 0.07 + 0.95 * gmWs ) * ( 0.3 + 1.0 * gmGust ) * uTreeWind.z;',
    '  vec3 gmWw = vec3( gmWd.x, 0.0, gmWd.y ) * ( gmAmp * ( 0.62 + 0.38 * gmSw ) ) + vec3( -gmWd.y, 0.0, gmWd.x ) * ( gmSw * 0.14 * gmAmp );',
    '  vec3 gmWl = ( gmWw * mat3( instanceMatrix ) ) / max( gmSy * gmSy, 1e-4 );',
    '  transformed += gmWl * gmBend;',
    '  float gmFl = sin( gmT * ( 7.0 + gmWs * 6.0 ) + dot( position, vec3( 3.1, 2.3, 2.9 ) ) + gmIp.x ) * ( 0.02 + 0.05 * gmWs ) * uTreeWind.w;',
    '  transformed += normal * gmFl * gmH;',
    '}',
    '#endif',
  ].join('\n');

  function leafMaterial(key, pivot, top) {
    const u = { uTreeWind: { value: new THREE.Vector4(pivot, 1 / (top - pivot), 1, 1) } };
    const mat = Gfx.patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 }), {
      key: 'leaves',
      uniforms: u,
      vertexPre: 'uniform vec4 uTreeWind;\n' + Gfx.WORLD_VARY,
      fragmentPre: Gfx.WORLD_VARY,
      vertex: {
        begin_vertex: '$\n' + TREE_WIND,
        project_vertex: '$\n' + Gfx.WORLD_VERTEX,
      },
      fragment: {
        color_fragment: [
          '$',
          'vec3 gmNw = normalize( vGmNrmW );',
          'float gmLv = gmTex( vGmWorld.xz * 0.043 + vGmWorld.y * 0.02 ).g;',
          'diffuseColor.rgb *= 0.86 + 0.28 * gmLv;',
          // leaf clusters: triplanar speckle + bump breaks up the smooth crown
          'vec3 gmLt = abs( gmNw ); gmLt /= gmLt.x + gmLt.y + gmLt.z;',
          'float gmLeaf = gmTex( vGmWorld.zy * 0.5 ).g * gmLt.x + gmTex( vGmWorld.xz * 0.5 + 0.4 ).g * gmLt.y + gmTex( vGmWorld.xy * 0.5 + 0.7 ).g * gmLt.z;',
          'float gmLeaf2 = gmTex( vGmWorld.zy * 0.11 ).g * gmLt.x + gmTex( vGmWorld.xz * 0.11 + 0.4 ).g * gmLt.y + gmTex( vGmWorld.xy * 0.11 + 0.7 ).g * gmLt.z;',
          'float gmLDist = length( vGmWorld - cameraPosition );',
          'float gmLNear = 1.0 - smoothstep( 8.0, 45.0, gmLDist );',
          'float gmLH = mix( 0.5, gmLeaf, gmLNear ) * 0.6 + gmLeaf2 * 0.4;',
          'diffuseColor.rgb *= 0.66 + 0.56 * smoothstep( 0.2, 0.78, gmLH );',
          'float gmSnow = gmEnv.z * smoothstep( 0.3, 0.75, gmNw.y + ( gmLv - 0.5 ) * 0.4 );',
          'diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.78, 0.82, 0.88 ), gmSnow );',
          'diffuseColor.rgb *= 1.0 - gmEnv.y * 0.25;',
        ].join('\n'),
        roughnessmap_fragment: '$\nroughnessFactor = mix( roughnessFactor, 0.58, gmEnv.y );',
        normal_fragment_maps: '$\nnormal = gmBump( -vViewPosition, normal, gmLH, 0.14 * gmLNear + 0.02 );',
        lights_fragment_end: [
          '$',
          '{',
          '  float gmCs = gmCloudShadow( vGmWorld );',
          '  reflectedLight.directDiffuse *= gmCs;',
          '  reflectedLight.directSpecular *= gmCs;',
          '  vec3 gmL = normalize( ( viewMatrix * vec4( gmSunDir, 0.0 ) ).xyz );',
          '  vec3 gmV = normalize( vViewPosition );',
          '  float gmBack = pow( gmSat( dot( -gmV, gmL ) ), 3.0 );',
          '  float gmWrap = gmSat( -dot( normal, gmL ) * 0.5 + 0.35 );',
          '  reflectedLight.directDiffuse += diffuseColor.rgb * gmSunCol * ( gmBack * 0.32 + gmWrap * 0.05 ) * ( 1.0 - gmSnow ) * gmCs;',
          '}',
        ].join('\n'),
      },
    });
    const depth = Gfx.patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), {
      key: 'leaves-depth',
      uniforms: u,
      vertexPre: 'uniform vec4 uTreeWind;\n',
      vertex: { begin_vertex: '$\n' + TREE_WIND },
    });
    mat.userData.windU = u;
    return { mat, depth };
  }

  /** Shared geometries and materials for trees and rocks (built once). */
  function buildPropGeometries() {
    pineGeo = buildPineGeo();
    broadGeo = buildBroadGeo();
    pineTrunkGeo = buildPineTrunk();
    broadTrunkGeo = buildBroadTrunk();
    pineFarGeo = buildPineFarGeo();
    broadFarGeo = buildBroadFarGeo();
    rockGeoA = buildRock(11, 3, true);
    rockGeoB = buildRock(13, 2, true);

    barkMat = Gfx.patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }), {
      key: 'bark',
      vertexPre: Gfx.WORLD_VARY,
      fragmentPre: Gfx.WORLD_VARY,
      vertex: { project_vertex: '$\n' + Gfx.WORLD_VERTEX },
      fragment: {
        color_fragment: [
          '$',
          'float gmBk = gmTex( vec2( atan( vGmNrmW.x, vGmNrmW.z ) * 0.8, vGmWorld.y * 0.18 ) ).b;',
          'diffuseColor.rgb *= 0.7 + 0.55 * gmBk;',
          'diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.75, 0.78, 0.84 ), gmEnv.z * smoothstep( 0.4, 0.9, vGmNrmW.y ) );',
          'diffuseColor.rgb *= 1.0 - gmEnv.y * 0.3;',
        ].join('\n'),
        normal_fragment_maps: '$\nnormal = gmBump( -vViewPosition, normal, gmBk, 0.05 );',
        lights_fragment_end: '$\n{ float gmCs = gmCloudShadow( vGmWorld ); reflectedLight.directDiffuse *= gmCs; reflectedLight.directSpecular *= gmCs; }',
      },
    });
    const lp = leafMaterial('pine', PINE_PIVOT, 6.7);
    pineMat = lp.mat; pineDepth = lp.depth;
    const lb = leafMaterial('broad', BROAD_PIVOT, 5.8);
    broadMat = lb.mat; broadDepth = lb.depth;

    rockMat = Gfx.patch(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0 }), {
      key: 'rock',
      vertexPre: Gfx.WORLD_VARY,
      fragmentPre: Gfx.WORLD_VARY,
      vertex: { project_vertex: '$\n' + Gfx.WORLD_VERTEX },
      fragment: {
        color_fragment: [
          '$',
          'vec3 gmNw = normalize( vGmNrmW );',
          'vec3 gmTr = abs( gmNw ); gmTr /= gmTr.x + gmTr.y + gmTr.z;',
          'vec4 gmA = gmTex( vGmWorld.zy * 0.21 ) * gmTr.x + gmTex( vGmWorld.xz * 0.21 + 0.3 ) * gmTr.y + gmTex( vGmWorld.xy * 0.21 + 0.6 ) * gmTr.z;',
          'vec4 gmB = gmTex( vGmWorld.zy * 0.45 ) * gmTr.x + gmTex( vGmWorld.xz * 0.45 + 0.3 ) * gmTr.y + gmTex( vGmWorld.xy * 0.45 + 0.6 ) * gmTr.z;',
          'float gmRh = gmA.b * 0.65 + gmB.a * 0.35;',
          'diffuseColor.rgb *= 0.68 + 0.6 * gmRh;',
          'float gmMoss = smoothstep( 0.45, 0.85, gmNw.y + ( gmA.g - 0.5 ) * 0.7 ) * 0.75;',
          'diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.07, 0.12, 0.035 ) * ( 0.8 + 0.4 * gmB.a ), gmMoss * smoothstep( 0.35, 0.65, gmA.r ) );',
          'float gmSnow = gmEnv.z * smoothstep( 0.5, 0.8, gmNw.y + ( gmB.a - 0.5 ) * 0.3 );',
          'diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.8, 0.84, 0.9 ), gmSnow );',
          'diffuseColor.rgb *= 1.0 - gmEnv.y * 0.32;',
        ].join('\n'),
        roughnessmap_fragment: '$\nroughnessFactor = mix( roughnessFactor - gmRh * 0.1, 0.35, gmEnv.y * 0.8 );',
        normal_fragment_maps: '$\nnormal = gmBump( -vViewPosition, normal, gmRh, 0.06 );',
        lights_fragment_end: '$\n{ float gmCs = gmCloudShadow( vGmWorld ); reflectedLight.directDiffuse *= gmCs; reflectedLight.directSpecular *= gmCs; }',
      },
    });
  }

  function makeInst(geo, mat, count, name, castShadow, depthMat) {
    if (!geo || count <= 0) return null;
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.name = name;
    m.frustumCulled = false;          // r149 culls instanced meshes by the base geometry only
    m.castShadow = !!castShadow;
    m.receiveShadow = true;
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3);
    if (depthMat) m.customDepthMaterial = depthMat;
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
          ci: 0,
          chunk: 0,
          col: 0,
          tcol: 0,
        };
        tr.y = y - tr.sink;
        if (pine) _c.setHSL(0.37 + (h4 - 0.5) * 0.06, 0.42 + h2 * 0.16, 0.2 + h3 * 0.07);
        else if (h4 < 0.05) _c.setHSL(0.07 + h1 * 0.05, 0.66, 0.42);            // a few autumn trees
        else _c.setHSL(0.24 + (h4 - 0.5) * 0.09, 0.5 + h2 * 0.16, 0.28 + h3 * 0.08);
        tr.col = pack(_c);
        _c.setHSL(0.07 + h1 * 0.03, 0.3, 0.2 + h2 * 0.07);
        tr.tcol = pack(_c);
        trees.push(tr);
      }
    }
    buildTreeChunks(T, trees);
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
    const pine = tr.type === 'pine';
    const ch = chunks[tr.chunk];
    const set = ch && (pine ? ch.pine : ch.broad);
    if (!set) return;
    const trunk = set.trunk, crown = set.crown, far = set.far;
    ch.dirty = true;
    if (tr.hidden) {
      trunk.setMatrixAt(tr.ci, ZERO_M);
      crown.setMatrixAt(tr.ci, ZERO_M);
      far.setMatrixAt(tr.ci, ZERO_M);
      return;
    }
    const s = tr.scale;
    _q.setFromAxisAngle(UP, tr.rot);
    _p.set(tr.x, tr.y, tr.z);
    _s.set(s * tr.w, s * tr.h, s * tr.w);
    _m.compose(_p, _q, _s);
    trunk.setMatrixAt(tr.ci, _m);
    if (tr.burnt) {
      // shrink the crown around its base so the charred trunk shows
      _p.y += s * tr.h * (pine ? PINE_PIVOT : BROAD_PIVOT) * (1 - BURNT_K);
      _s.multiplyScalar(BURNT_K);
      _m.compose(_p, _q, _s);
    }
    crown.setMatrixAt(tr.ci, _m);
    far.setMatrixAt(tr.ci, _m);
    trunk.setColorAt(tr.ci, unpackLin(tr.burnt ? BURNT_TRUNK : tr.tcol, _c));
    unpackLin(tr.burnt ? ((tr.ti & 3) === 0 ? 0x2a1e18 : 0x1c1a17) : tr.col, _c);
    crown.setColorAt(tr.ci, _c);
    far.setColorAt(tr.ci, _c);
  }

  /** A geometry that shares another's buffers but has its own bounding sphere (per-chunk culling). */
  function shareGeo(base) {
    const g = new THREE.BufferGeometry();
    for (const k in base.attributes) g.setAttribute(k, base.attributes[k]);
    if (base.index) g.setIndex(base.index);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    return g;
  }
  /** Chunk shells (persistent: the wrapper geometries are reused by every arena). */
  function ensureChunks() {
    if (chunks.length) return;
    const size = CFG.MAP_SIZE / CH;
    for (let cz = 0; cz < CH; cz++) {
      for (let cx = 0; cx < CH; cx++) {
        chunks.push({
          x: -CFG.MAP_SIZE / 2 + (cx + 0.5) * size, z: -CFG.MAP_SIZE / 2 + (cz + 0.5) * size, y: 0, size,
          geo: {
            pt: shareGeo(pineTrunkGeo), bt: shareGeo(broadTrunkGeo), pc: shareGeo(pineGeo), bc: shareGeo(broadGeo),
            pf: shareGeo(pineFarGeo), bf: shareGeo(broadFarGeo),
          },
          pine: null, broad: null, dirty: false, near: true,
        });
      }
    }
  }
  function chunkOf(x, z) {
    const size = CFG.MAP_SIZE / CH;
    const cx = U.clamp(Math.floor((x + CFG.MAP_SIZE / 2) / size), 0, CH - 1), cz = U.clamp(Math.floor((z + CFG.MAP_SIZE / 2) / size), 0, CH - 1);
    return cz * CH + cx;
  }
  function removeChunkMeshes() {
    for (const ch of chunks) {
      for (const k of ['pine', 'broad']) {
        const set = ch[k];
        if (!set) continue;
        removeMesh(set.trunk, false); removeMesh(set.crown, false); removeMesh(set.far, false);
        ch[k] = null;
      }
      ch.dirty = false;
      ch.near = true;
    }
    treesReady = false;
  }
  function buildTreeChunks(T, trees) {
    ensureChunks();
    removeChunkMeshes();
    const counts = new Array(chunks.length * 2).fill(0);
    const top = new Array(chunks.length).fill(-1e9), bot = new Array(chunks.length).fill(1e9);
    for (const tr of trees) {
      const c = chunkOf(tr.x, tr.z);
      tr.chunk = c;
      const k = c * 2 + (tr.type === 'pine' ? 0 : 1);
      tr.ci = counts[k]++;
      const h = tr.y + 8 * tr.scale * tr.h;
      if (h > top[c]) top[c] = h;
      if (tr.y < bot[c]) bot[c] = tr.y;
    }
    for (let c = 0; c < chunks.length; c++) {
      const ch = chunks[c];
      if (top[c] < bot[c]) continue;
      ch.y = (top[c] + bot[c]) / 2;
      const half = ch.size / 2 + 3;
      const hh = (top[c] - bot[c]) / 2;
      const r = Math.sqrt(half * half * 2 + hh * hh);
      for (const k in ch.geo) { ch.geo[k].boundingSphere.center.set(ch.x, ch.y, ch.z); ch.geo[k].boundingSphere.radius = r; }
      const np = counts[c * 2], nb = counts[c * 2 + 1];
      if (np) ch.pine = { trunk: makeInst(ch.geo.pt, barkMat, np, 'pineTrunks', true), crown: makeInst(ch.geo.pc, pineMat, np, 'pines', true, pineDepth), far: makeInst(ch.geo.pf, pineMat, np, 'pinesFar', true, pineDepth) };
      if (nb) ch.broad = { trunk: makeInst(ch.geo.bt, barkMat, nb, 'broadTrunks', true), crown: makeInst(ch.geo.bc, broadMat, nb, 'broadleaves', true, broadDepth), far: makeInst(ch.geo.bf, broadMat, nb, 'broadFar', true, broadDepth) };
      for (const k of ['pine', 'broad']) {
        const set = ch[k];
        if (!set) continue;
        set.trunk.frustumCulled = set.crown.frustumCulled = set.far.frustumCulled = true;
        set.far.visible = false;
      }
    }
    treesReady = true;
  }
  /**
   * Per view (called by post.js before rendering a camera): detailed trees near
   * the camera, the cheap set further away. The shadow pass uses the main view's choice.
   */
  World.prepareView = function (camera) {
    if (!treesReady || !camera) return;
    const cp = camera.position;
    const lim = (isLow() ? 0.7 : 1) * LOD_NEAR;
    for (const ch of chunks) {
      const dx = ch.x - cp.x, dy = ch.y - cp.y, dz = ch.z - cp.z;
      const near = Math.sqrt(dx * dx + dy * dy + dz * dz) < lim + ch.size * 0.5;
      if (near === ch.near) continue;
      ch.near = near;
      for (const k of ['pine', 'broad']) {
        const set = ch[k];
        if (!set) continue;
        set.trunk.visible = set.crown.visible = near;
        set.far.visible = !near;
      }
    }
  };

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
        _c.setRGB(0.52 + k * 0.14, 0.5 + k * 0.12, 0.47 + k * 0.1);
        if (rk.kind === 'stone') _c.multiplyScalar(1.06);
        if (T.forestAt(rk.x, rk.z) > 0.2 || T.biomeAt(rk.x, rk.z) === 'swamp') _c.lerp(_c2.setRGB(0.4, 0.46, 0.34), 0.25);
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
    // on steep ground the downhill side would hang in the air: sink the rock into the slope
    const T = GM.Terrain;
    const sl = T && T.slopeAt ? U.clamp01(T.slopeAt(d.x, d.z)) : 0;
    _p.set(d.x, groundY(d.x, d.z) + d.lift - sl * sl * Math.max(d.sx, d.sz) * 1.1, d.z);
    _s.set(d.sx, d.sy, d.sz);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(d.idx, _m);
    mesh.setColorAt(d.idx, unpackLin(d.col, _c));
  }

  // ================================================================== grass
  // Instanced blade patches tiled around each camera. Heights come from a
  // float height texture (same triangulation as Terrain.heightAt); density
  // and tint from a grass map built from the biomes. Wind gusts roll across
  // the field; tributes push the blades aside.
  const GRASS_TILE = 7;               // metres per patch
  const GRASS_GRID = 13;              // patches per side (main view)
  const GRASS_BLADES = 900;           // blades per patch
  const GRASS_FAR = 0.3;              // share of blades drawn by the far layer (rank < 0.3)
  const GRASS_PUSH = 12;
  let grassNear = null, grassFar = null, grassGeoN = null, grassGeoF = null, grassMat = null, heightTex = null, grassTex = null;
  let grassData = null, heightData = null;
  let grassDirty = false, heightDirty = false;
  const grassPush = [];
  for (let i = 0; i < GRASS_PUSH; i++) grassPush.push(new THREE.Vector4(0, 0, 0, 0));
  const grassU = {
    uGrassCam: { value: new THREE.Vector4(0, 0, 40, GRASS_TILE) },
    uGrassLod: { value: new THREE.Vector4(16, 0, 0, 0) },   // near radius
    uMap: { value: new THREE.Vector4(180, 2, 181, 0) },     // half, cell, res
    uHeight: { value: null },
    uGrassMap: { value: null },
    uPush: { value: grassPush },
  };

  const GRASS_VERTEX_PRE = [
    'attribute vec4 aBlade;',
    'attribute vec2 aTile;',
    'uniform vec4 uGrassCam;',
    'uniform vec4 uGrassLod;',
    'uniform vec4 uMap;',
    'uniform sampler2D uHeight;',
    'uniform sampler2D uGrassMap;',
    'uniform vec4 uPush[' + GRASS_PUSH + '];',
    'varying float vGmTip;',
    Gfx.WORLD_VARY,
    'float gmHAt( vec2 p ) {',
    '  vec2 f = clamp( ( p + uMap.x ) / uMap.y, vec2( 0.0 ), vec2( uMap.z - 1.001 ) );',
    '  vec2 i = floor( f );',
    '  vec2 t = f - i;',
    '  float inv = 1.0 / uMap.z;',
    '  vec2 b = ( i + 0.5 ) * inv;',
    '  float ha = texture2D( uHeight, b ).r;',
    '  float hc = texture2D( uHeight, b + vec2( inv, inv ) ).r;',
    '  bool upper = t.y >= t.x;',
    '  float hm = texture2D( uHeight, b + ( upper ? vec2( 0.0, inv ) : vec2( inv, 0.0 ) ) ).r;',
    '  return upper ? ha + ( hc - hm ) * t.x + ( hm - ha ) * t.y : ha + ( hm - ha ) * t.x + ( hc - hm ) * t.y;',
    '}',
  ].join('\n');

  // Runs before color_vertex: declares `transformed` (begin_vertex is removed),
  // the blade colour and the blade normal (applied after beginnormal_vertex).
  const GRASS_BEGIN = [
    'float gmCull = 0.0;',
    'vec3 transformed;',
    'vec3 gmBladeCol = vec3( 0.0 );',
    'vec3 gmBladeN = vec3( 0.0, 1.0, 0.0 );',
    '{',
    '  vec2 gmTileO = ( floor( uGrassCam.xy / uGrassCam.w ) + aTile ) * uGrassCam.w;',
    '  vec2 wp = gmTileO + aBlade.xy * uGrassCam.w;',
    '  vec2 muv = ( wp + uMap.x ) / ( uMap.y * uMap.z ) + 0.5 / uMap.z;',
    '  vec4 gm = texture2D( uGrassMap, muv );',
    '  float d = distance( wp, uGrassCam.xy );',
    '  float fade = 1.0 - smoothstep( uGrassCam.z * 0.6, uGrassCam.z, d );',
    // near: every blade; beyond the near radius only the far layer (rank < GRASS_FAR) remains
    '  float lod = mix( ' + GRASS_FAR.toFixed(2) + ', 1.0, 1.0 - smoothstep( uGrassLod.x * 0.55, uGrassLod.x, d ) );',
    '  float dens = gm.a * lod * mix( 0.45, 1.0, fade );',
    '  float h0 = gmHAt( wp );',
    '  if ( aBlade.z > dens || fade <= 0.0 || h0 < gmEnv2.z + 0.06 ) gmCull = 1.0;',
    '  float r1 = fract( aBlade.z * 7.31 ), r2 = fract( aBlade.z * 13.7 + 0.3 );',
    '  float hgt = ( 0.3 + 0.42 * r1 ) * ( 0.72 + 0.28 * gm.a ) * ( 0.45 + 0.55 * fade ) * ( 1.0 - gmEnv.z * 0.55 );',
    '  float far = smoothstep( uGrassLod.x * 0.5, uGrassCam.z, d );',
    '  float wid = ( 0.035 + 0.03 * r2 ) * mix( 1.0, 2.6, far );',
    '  float rot = aBlade.w * 6.2831853;',
    '  vec2 side = vec2( cos( rot ), sin( rot ) );',
    '  vec2 face = vec2( -side.y, side.x );',
    // wind: rolling gusts + flutter
    '  float t = gmEnv.x;',
    '  vec2 wd = gmEnv2.xy;',
    '  float gust = gmTex( wp * 0.012 - wd * t * 0.06 ).r;',
    '  float gust2 = gmTex( wp * 0.05 - wd * t * 0.16 + 0.3 ).g;',
    '  float ws = gmEnv.w;',
    '  float sway = ( 0.18 + 0.9 * ws ) * ( gust * 1.2 + gust2 * 0.4 ) + 0.08 * sin( t * 3.1 + aBlade.z * 40.0 );',
    '  vec2 bend = wd * sway + face * ( 0.25 + 0.2 * r2 ) * ( 0.6 - 0.4 * ws );',
    // tributes push blades aside
    '  for ( int k = 0; k < ' + GRASS_PUSH + '; k++ ) {',
    '    vec4 pp = uPush[k];',
    '    vec2 dv = wp - pp.xy;',
    '    float dl = length( dv );',
    '    float pk = pp.w * ( 1.0 - smoothstep( pp.z * 0.4, pp.z, dl ) );',
    '    bend += dv / max( dl, 0.05 ) * pk * 1.6;',
    '  }',
    '  float bl = length( bend );',
    '  if ( bl > 1.6 ) bend *= 1.6 / bl;',
    '  float y = position.y;',
    '  float curve = y * y;',
    '  vec2 off = side * position.x * wid * ( 1.0 - y * 0.85 ) + bend * curve * hgt;',
    '  float drop = 1.0 - 0.35 * dot( bend, bend ) * curve * 0.5;',
    '  transformed = vec3( wp.x + off.x, h0 + y * hgt * drop, wp.y + off.y );',
    '  if ( gmCull > 0.5 ) transformed = vec3( 0.0 );',
    '  vGmTip = y;',
    '  float var = 0.82 + 0.36 * r2;',
    '  float var2 = mix( var, 1.0, far );',
    '  gmBladeCol = gm.rgb * var2 * mix( mix( 0.3, 0.72, far ), mix( 1.12, 0.98, far ), y ) * mix( vec3( 1.0 ), vec3( 1.25, 1.1, 0.55 ), step( 0.93, r1 ) * y * ( 1.0 - far ) );',
    '  gmBladeN = normalize( vec3( face.x, 0.0, face.y ) * 0.3 + vec3( bend.x, 0.0, bend.y ) * 0.3 + vec3( 0.0, 1.0, 0.0 ) );',
    '}',
  ].join('\n');

  function buildGrassGeometry() {
    // blade: 7 vertices (3 quads tapering to a tip), position.x = -0.5..0.5, position.y = 0..1
    const bp = [], bi = [];
    const rows = [0, 0.3, 0.62, 1];
    for (let r = 0; r < 3; r++) { bp.push(-0.5, rows[r], 0, 0.5, rows[r], 0); }
    bp.push(0, 1, 0);
    for (let r = 0; r < 2; r++) {
      const a = r * 2;
      bi.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    bi.push(4, 5, 6);
    const nv = bp.length / 3;
    const B = GRASS_BLADES;
    const pos = new Float32Array(B * nv * 3), blade = new Float32Array(B * nv * 4);
    const idx = new Uint32Array(B * bi.length);
    let s = 0x2468ace;
    const rnd = function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    for (let b = 0; b < B; b++) {
      const bx = rnd(), bz = rnd();
      const rank = (b + rnd()) / B;          // any prefix of blades is spread evenly
      const rot = rnd();
      for (let v = 0; v < nv; v++) {
        const o = b * nv + v;
        pos[o * 3] = bp[v * 3]; pos[o * 3 + 1] = bp[v * 3 + 1]; pos[o * 3 + 2] = 0;
        blade[o * 4] = bx; blade[o * 4 + 1] = bz; blade[o * 4 + 2] = rank; blade[o * 4 + 3] = rot;
      }
      for (let k = 0; k < bi.length; k++) idx[b * bi.length + k] = b * nv + bi[k];
    }
    const aPos = new THREE.BufferAttribute(pos, 3);
    const aNrm = new THREE.BufferAttribute(new Float32Array(pos.length), 3);
    const aBl = new THREE.BufferAttribute(blade, 4);
    const aIdx = new THREE.BufferAttribute(idx, 1);
    // tiles sorted by distance from the centre: drawing a prefix covers the nearest ground
    const G = GRASS_GRID, h = (G - 1) / 2;
    const tiles = [];
    for (let z = 0; z < G; z++) for (let x = 0; x < G; x++) tiles.push([x - h, z - h]);
    tiles.sort(function (a, b) { return a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]); });
    const tarr = new Float32Array(tiles.length * 2);
    for (let i = 0; i < tiles.length; i++) { tarr[i * 2] = tiles[i][0]; tarr[i * 2 + 1] = tiles[i][1]; }
    const aTile = new THREE.InstancedBufferAttribute(tarr, 2);
    // two views of the same buffers: the far layer draws the low-rank blades, the near layer the rest
    const split = Math.round(B * GRASS_FAR) * bi.length;
    const make = function (start, count) {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', aPos);
      g.setAttribute('normal', aNrm);
      g.setAttribute('aBlade', aBl);
      g.setAttribute('aTile', aTile);
      g.setIndex(aIdx);
      g.setDrawRange(start, count);
      g.instanceCount = tiles.length;
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      return g;
    };
    grassGeoF = make(0, split);
    grassGeoN = make(split, B * bi.length - split);
  }

  function buildGrassMaterial() {
    grassMat = Gfx.patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }), {
      key: 'grass',
      uniforms: grassU,
      vertexPre: GRASS_VERTEX_PRE,
      fragmentPre: 'varying float vGmTip;\n' + Gfx.WORLD_VARY,
      after: function (shader) {
        // the blade is built before color_vertex; begin_vertex is removed (transformed is ours)
        shader.vertexShader = shader.vertexShader
          .replace('#include <color_vertex>', GRASS_BEGIN + '\n#include <color_vertex>\n#ifdef USE_COLOR\nvColor.rgb = gmBladeCol;\n#endif')
          .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = gmBladeN;')
          .replace('#include <begin_vertex>', '')
          .replace('#include <project_vertex>', '#include <project_vertex>\nif ( gmCull > 0.5 ) gl_Position = vec4( 0.0, 0.0, -2.0, 1.0 );\n' + Gfx.WORLD_VERTEX);
      },
      fragment: {
        normal_fragment_begin: '$\nnormal = normalize( vNormal );\ngeometryNormal = normal;',
        color_fragment: [
          '$',
          'float gmGv = gmTex( vGmWorld.xz * 0.07 ).g;',
          'diffuseColor.rgb *= 0.85 + 0.3 * gmGv;',
          'diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.78, 0.82, 0.88 ), gmEnv.z * vGmTip * 0.8 );',
          'diffuseColor.rgb *= 1.0 - gmEnv.y * 0.2;',
        ].join('\n'),
        roughnessmap_fragment: '$\nroughnessFactor = mix( roughnessFactor, 0.4, gmEnv.y );',
        lights_fragment_end: [
          '$',
          '{',
          '  vec3 gmL = normalize( ( viewMatrix * vec4( gmSunDir, 0.0 ) ).xyz );',
          '  vec3 gmV = normalize( vViewPosition );',
          '  float gmBack = pow( gmSat( dot( -gmV, gmL ) ), 4.0 );',
          '  float gmCs = gmCloudShadow( vGmWorld );',
          '  reflectedLight.directDiffuse *= gmCs;',
          '  reflectedLight.directSpecular *= gmCs;',
          '  reflectedLight.directDiffuse += diffuseColor.rgb * gmSunCol * gmBack * 0.4 * vGmTip * gmCs;',
          '  reflectedLight.indirectDiffuse *= mix( 0.45, 1.0, vGmTip );',
          '}',
        ].join('\n'),
      },
    });
  }

  function buildGrassTextures(T) {
    const R = T.res;
    if (!heightData || heightData.length !== R * R) {
      heightData = new Float32Array(R * R);
      grassData = new Uint8Array(R * R * 4);
      if (heightTex) heightTex.dispose();
      if (grassTex) grassTex.dispose();
      heightTex = new THREE.DataTexture(heightData, R, R, THREE.RedFormat, THREE.FloatType);
      heightTex.magFilter = heightTex.minFilter = THREE.NearestFilter;
      heightTex.generateMipmaps = false;
      grassTex = new THREE.DataTexture(grassData, R, R, THREE.RGBAFormat, THREE.UnsignedByteType);
      grassTex.magFilter = grassTex.minFilter = THREE.LinearFilter;
      grassTex.generateMipmaps = false;
      grassTex.encoding = THREE.sRGBEncoding;
      grassU.uHeight.value = heightTex;
      grassU.uGrassMap.value = grassTex;
    }
    grassU.uMap.value.set(T.half, T.cellSize, R, 0);
    heightData.set(T.heights);
    heightTex.needsUpdate = true;
    writeGrassMap(T, 0, 0, R - 1, R - 1);
    grassTex.needsUpdate = true;
  }

  /** Grass density + tint per terrain vertex. */
  function writeGrassMap(T, ix0, iz0, ix1, iz1) {
    const R = T.res, C = T.colors, F = T.forestData, B = T.burntData, H = T.heights;
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const i = iz * R + ix;
        const x = -T.half + ix * T.cellSize, z = -T.half + iz * T.cellSize;
        const biome = T.biomeAt(x, z);
        let d = 0;
        if (biome === 'grass') d = 1;
        else if (biome === 'swamp') d = 0.85;
        else if (biome === 'forest') d = 0.55;
        else if (biome === 'rock') d = 0.12;
        const f = F ? F[i] : 0;
        d *= 1 - f * 0.55;
        const sl = T.slopeAt(x, z);
        d *= 1 - U.smoothstep(0.32, 0.5, sl);
        const r = Math.sqrt(x * x + z * z);
        if (r < CFG.CORNUCOPIA_RADIUS + 0.5) d = 0;
        else d *= U.smoothstep(CFG.CORNUCOPIA_RADIUS + 0.5, CFG.CORNUCOPIA_RADIUS + 3, r);
        if (r > ARENA_R + 6) d *= 0.5;
        if (H[i] < CFG.BASE_WATER_LEVEL + 0.2) d = 0;
        let cr = C ? C[i * 3] : 90, cg = C ? C[i * 3 + 1] : 140, cb = C ? C[i * 3 + 2] : 60;
        if (B && B[i]) { d *= 0.25; }
        else { cr *= 1.02; cg *= 1.12; cb *= 0.9; }
        const o = i * 4;
        grassData[o] = U.clamp(cr, 0, 255); grassData[o + 1] = U.clamp(cg, 0, 255); grassData[o + 2] = U.clamp(cb, 0, 255);
        grassData[o + 3] = U.clamp(d * 255, 0, 255);
      }
    }
  }

  function buildGrass(T) {
    grassNear = removeMesh(grassNear, false);
    grassFar = removeMesh(grassFar, false);
    if (!T) return;
    if (!grassGeoN) buildGrassGeometry();
    if (!grassMat) buildGrassMaterial();
    buildGrassTextures(T);
    const mk = function (geo, name, near) {
      const m = new THREE.Mesh(geo, grassMat);
      m.name = name;
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      m.userData.near = near;
      m.onBeforeRender = grassBeforeRender;
      scene.add(m);
      return m;
    };
    grassFar = mk(grassGeoF, 'grassFar', false);
    grassNear = mk(grassGeoN, 'grassNear', true);
  }

  function tilesFor(radius) {
    const G = GRASS_GRID;
    if (!(radius > 0)) return 0;
    const k = radius / GRASS_TILE + 0.75;
    return Math.min(G * G, Math.ceil(Math.PI * k * k) + 4);
  }

  /** Per view: centre the patches on the camera, pick the pushers, and trim for small views. */
  function grassBeforeRender(r, sc, camera) {
    const cp = camera.position;
    const main = !GM.Post || GM.Post.currentMain !== false;
    const low = isLow();
    // distance from the camera down to the ground limits the useful radius
    const gy = groundY(cp.x, cp.z);
    const above = Math.max(0, cp.y - gy);
    let radius = main ? (low ? 24 : 44) : 22;
    radius = Math.min(radius, Math.max(8, 80 - above * 0.6));
    if (above > 125) radius = 0;
    let nearR = main ? (low ? 10 : 17) : 9;
    nearR = Math.min(nearR, radius);
    grassU.uGrassCam.value.set(cp.x, cp.z, radius, GRASS_TILE);
    grassU.uGrassLod.value.set(nearR, 0, 0, 0);
    grassGeoF.instanceCount = tilesFor(radius);
    grassGeoN.instanceCount = tilesFor(nearR);
    // nearest tributes push the grass
    const ts = GM.state.tributes;
    let n = 0;
    if (ts && ts.length) {
      for (let i = 0; i < ts.length && n < GRASS_PUSH; i++) {
        const t = ts[i];
        if (!t || !t.pos || t.bodyGone) continue;
        const dx = t.pos.x - cp.x, dz = t.pos.z - cp.z;
        if (dx * dx + dz * dz > (radius + 2) * (radius + 2)) continue;
        grassPush[n++].set(t.pos.x, t.pos.z, t.alive ? 1.1 : 1.3, t.alive ? (t.sleeping ? 0.8 : 0.9) : 1.0);
      }
    }
    for (let i = n; i < GRASS_PUSH; i++) grassPush[i].set(1e5, 1e5, 0, 0);
  }

  function flushGrassTextures() {
    if (heightDirty && heightTex) { heightTex.needsUpdate = true; heightDirty = false; }
    if (grassDirty && grassTex) { grassTex.needsUpdate = true; grassDirty = false; }
  }
  function refreshGrassRect(x0, z0, x1, z1, heights) {
    const T = Tr();
    if (!T || !grassData) return;
    const ix0 = U.clamp(Math.floor((x0 + T.half) / T.cellSize) - 1, 0, T.res - 1), ix1 = U.clamp(Math.ceil((x1 + T.half) / T.cellSize) + 1, 0, T.res - 1);
    const iz0 = U.clamp(Math.floor((z0 + T.half) / T.cellSize) - 1, 0, T.res - 1), iz1 = U.clamp(Math.ceil((z1 + T.half) / T.cellSize) + 1, 0, T.res - 1);
    writeGrassMap(T, ix0, iz0, ix1, iz1);
    grassDirty = true;
    if (heights) {
      heightData.set(T.heights);
      heightDirty = true;
    }
  }

  function buildProps(T) {
    removeChunkMeshes();
    rockMeshA = removeMesh(rockMeshA, false);
    rockMeshB = removeMesh(rockMeshB, false);
    World.trees.length = 0;
    rockData.length = 0;
    treeBuckets = [];
    rocksDirty = false;
    if (!T || !pineGeo) return;
    placeTrees(T);
    placeRocks(T);
    buildGrass(T);
  }

  function flushInstances() {
    for (const ch of chunks) {
      if (!ch.dirty) continue;
      ch.dirty = false;
      for (const k of ['pine', 'broad']) {
        const set = ch[k];
        if (set) { markInst(set.trunk); markInst(set.crown); markInst(set.far); }
      }
    }
    if (rocksDirty) { rocksDirty = false; markInst(rockMeshA); markInst(rockMeshB); }
  }

  // ------------------------------------------------------------ fire damage
  /** Char and shrink trees (and grass) within r of (x, z); also refreshes the ground colours. -> trees burnt */
  World.burnTreesInArea = function (x, z, r) {
    x = +x; z = +z; r = +r || 0;
    if (!Number.isFinite(x) || !Number.isFinite(z) || !(r >= 0)) return 0;
    const rr = r + 0.6, rr2 = rr * rr;
    let n = 0;
    if (treesReady && treeBuckets.length) {
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
    }
    refreshTerrainRect(x - rr - 2, z - rr - 2, x + rr + 2, z + rr + 2, false);
    refreshGrassRect(x - rr - 2, z - rr - 2, x + rr + 2, z + rr + 2, false);
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
    refreshGrassRect(x0, z0, x1, z1, true);
    resnapProps(x0, z0, x1, z1);
    snapPedestals();
    if (x0 < 14 && x1 > -14 && z0 < 14 && z1 > -14) placeCornucopia();
    if (shadowsOn()) renderer.shadowMap.needsUpdate = true;
  }
  /** Put trees and rocks inside a rectangle back on the ground. */
  function resnapProps(x0, z0, x1, z1) {
    const wl = CFG.BASE_WATER_LEVEL;
    if (treesReady && treeBuckets.length) {
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
    up0 = Infinity; up1 = -1; upGeo = false;
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

  const PART_VS = [
    'attribute vec3 aColor;',
    'attribute float aAlpha;',
    'attribute float aSize;',
    'uniform float uViewH;',
    'varying vec3 vColor;',
    'varying float vAlpha;',
    'varying float vSeed;',
    '#include <fog_pars_vertex>',
    'void main() {',
    '  vColor = aColor;',
    '  vAlpha = aAlpha;',
    '  vSeed = fract( position.x * 3.17 + position.z * 1.37 );',
    '  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );',
    '  float k = projectionMatrix[2][3] != 0.0 ? 1.0 / max( -mvPosition.z, 0.1 ) : 1.0;',
    '  gl_PointSize = aAlpha > 0.003 ? clamp( aSize * uViewH * 0.5 * projectionMatrix[1][1] * k, 1.0, 400.0 ) : 0.0;',
    '  gl_Position = projectionMatrix * mvPosition;',
    '  #include <fog_vertex>',
    '}',
  ].join('\n');
  const PART_FS_NORMAL = [
    '#include <gm_common>',
    'uniform vec3 uTint;',
    'varying vec3 vColor;',
    'varying float vAlpha;',
    'varying float vSeed;',
    '#include <fog_pars_fragment>',
    'void main() {',
    '  vec2 pc = gl_PointCoord - vec2( 0.5 );',
    '  float d = length( pc ) * 2.0;',
    '  if ( d > 1.0 ) discard;',
    // soft, lumpy puffs lit from above
    '  float n = texture2D( gmNoise, pc * 0.45 + vSeed ).g;',
    '  float a = ( 1.0 - smoothstep( 0.25, 1.0, d + ( n - 0.5 ) * 0.5 ) );',
    '  float lit = 0.8 + 0.4 * ( 0.5 - pc.y ) + ( n - 0.5 ) * 0.3;',
    // particle colours are authored for display: lift them to a plausible albedo (dark smoke is ~15%, not 2%)
    '  vec3 alb = pow( max( vColor, vec3( 0.0 ) ), vec3( 0.55 ) ) * 0.8;',
    '  gl_FragColor = vec4( alb * uTint * lit, a * vAlpha * 0.9 );',
    '  #include <fog_fragment>',
    '}',
  ].join('\n');
  const PART_FS_ADD = [
    'uniform float uBoost;',
    'uniform vec4 gmPost;',
    'varying vec3 vColor;',
    'varying float vAlpha;',
    'varying float vSeed;',
    '#include <fog_pars_fragment>',
    'void main() {',
    '  float d = length( gl_PointCoord - vec2( 0.5 ) ) * 2.0;',
    '  if ( d > 1.0 ) discard;',
    '  float a = pow( 1.0 - d, 1.7 );',
    '  float core = pow( 1.0 - d, 6.0 );',
    '  vec3 c = mix( vColor, vec3( 1.0 ), core * 0.55 ) * uBoost * gmPost.y;',
    '  #ifdef USE_FOG',
    '    a *= gmFogKeep();',
    '  #endif',
    '  gl_FragColor = vec4( c, a * vAlpha );',
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
    '  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );',
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
    'void main() {',
    '  float a;',
    '  if ( vBand > 0.5 ) {',
    '    a = ( 1.0 - smoothstep( 0.0, 1.0, vP.y ) ) * smoothstep( -0.3, 0.0, vP.y ) * 0.75;',
    '  } else {',
    '    float d = length( vP.xz );',
    '    a = smoothstep( 0.5, 0.96, d ) * ( 1.0 - smoothstep( 0.96, 1.0, d ) );',
    '  }',
    '  #ifdef USE_FOG',
    '    a *= gmFogKeep();',
    '  #endif',
    '  gl_FragColor = vec4( uColor * 2.2, a * uAlpha );',
    '}',
  ].join('\n');

  const BEAM_VS = [
    'varying vec3 vN;',
    'varying vec3 vV;',
    'varying float vY;',
    '#include <fog_pars_vertex>',
    'void main() {',
    '  vY = position.y;',
    '  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );',
    '  vN = normalize( normalMatrix * normal );',
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
    'void main() {',
    '  float ndv = abs( dot( normalize( vN ), normalize( vV ) ) );',
    '  float glow = pow( ndv, 1.4 );',
    '  float core = pow( ndv, 7.0 );',
    '  float flick = 0.82 + 0.18 * sin( uTime * 41.0 + vY * uLen * 0.35 );',
    '  float a = glow * uAlpha * flick;',
    '  #ifdef USE_FOG',
    '    a *= gmFogKeep();',
    '  #endif',
    '  gl_FragColor = vec4( mix( uColor, vec3( 1.0 ), core * 0.75 ) * ( 1.5 + core * 5.0 ), a );',
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
      uniforms: Gfx.uniformsWith({
        uViewH: { value: 800 },
        uTint: { value: new THREE.Color(1, 1, 1) },
        uBoost: { value: 2.6 },
      }, true),
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
    const ringGeo = mergeGeometries([[disc, null, 0x000000], [band, new THREE.Matrix4().makeTranslation(0, 0.35, 0), 0xffffff]], true);
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
    best.i0 = Math.max(0, num(intensity, 2)) * 2.2;     // HDR: flashes light up the scene
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
    R.mat.blending = c.r * 0.3 + c.g * 0.59 + c.b * 0.11 > 0.12 ? THREE.AdditiveBlending : THREE.NormalBlending;
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
    if (pNorm) {
      // smoke is lit by the sky (ambient) plus part of the sun
      const t = pNorm.mat.uniforms.uTint.value;
      const z = SU.gmSkyZen.value, h = SU.gmSkyHor.value, s = SU.gmSunCol.value;
      const sy = Math.max(0, SU.gmSunDir.value[1]);
      const ar = (z[0] + h[0]) * 0.5, ag = (z[1] + h[1]) * 0.5, ab = (z[2] + h[2]) * 0.5;
      const al = ar * 0.2126 + ag * 0.7152 + ab * 0.0722;       // neutralised sky ambient
      t.setRGB(
        U.clamp((ar + al) * 0.9 + s[0] * 0.4 * sy + 0.02, 0.04, 4),
        U.clamp((ag + al) * 0.9 + s[1] * 0.4 * sy + 0.02, 0.04, 4),
        U.clamp((ab + al) * 0.9 + s[2] * 0.4 * sy + 0.025, 0.05, 4));
    }
  }

  // ================================================================= system
  let domePulse = 0;

  function frame(realDt) {
    if (!scene) return;
    const dt = Math.min(0.1, Math.max(0, +realDt || 0));
    Gfx.tick(dt);
    flushDeform();
    flushTerrainUpload();
    flushInstances();
    flushGrassTextures();
    placeSun();                          // follow Env's sun direction even without camera calls

    // wind strength for trees, grass and water (shared uniform gmEnv.w, direction gmEnv2.xy)
    const E = GM.Env;
    const env = SU.gmEnv.value, env2 = SU.gmEnv2.value;
    let ws = 0.15, wx = 0.8, wz = 0.6;
    if (E && E.wind && Number.isFinite(E.wind.x) && Number.isFinite(E.wind.z)) {
      const sp = Math.sqrt(E.wind.x * E.wind.x + E.wind.z * E.wind.z);
      ws = U.clamp(sp / 16, 0.04, 1);
      if (sp > 0.01) { wx = E.wind.x / sp; wz = E.wind.z / sp; }
    }
    env[3] += (ws - env[3]) * (1 - Math.exp(-dt * 1.2));
    const k = 1 - Math.exp(-dt * 0.8);
    env2[0] += (wx - env2[0]) * k;
    env2[1] += (wz - env2[1]) * k;
    const wl = Math.hypot(env2[0], env2[1]) || 1;
    env2[0] /= wl; env2[1] /= wl;
    env2[2] = waterY();

    // water level + index culling
    if (waterMat) {
      const u = waterMat.uniforms;
      const lvl = waterY();
      u.uLevel.value = lvl;
      if (wGeo && (lvl + 1.5 > wThreshold || lvl + 14 < wThreshold)) rebuildWaterIndex(lvl + 6);
      // body colour follows the ambient light (sky)
      const z = SU.gmSkyZen.value, h = SU.gmSkyHor.value;
      u.uAmbient.value.setRGB(z[0] * 0.6 + h[0] * 0.6 + 0.01, z[1] * 0.6 + h[1] * 0.6 + 0.01, z[2] * 0.6 + h[2] * 0.6 + 0.012);
    }

    // force-field shimmer (flares up when the zone starts to shrink)
    if (domeMat) {
      domePulse = Math.max(0, domePulse - dt * 0.6);
      domeMat.uniforms.uTime.value = SU.gmEnv.value[0];
      // follows the exposure (no glowing grid at night) and fades under heavy cloud / rain
      const night = 1 - env2[3];
      const overcast = U.smoothstep(0.4, 0.85, SU.gmCloud.value[0]);
      domeMat.uniforms.uStrength.value = (0.55 - 0.2 * night) * (1 - 0.6 * overcast) * SU.gmPost.value[1] * (1 + domePulse * 4);
    }

    // pedestal rings: steady in setup, pulsing in the countdown, dim once the Games run
    if (pedGlow && pedCount > 0) {
      const ph = GM.state.phase;
      const col = pedGlow.material.color;
      const t = SU.gmEnv.value[0];
      if (ph === 'countdown') {
        const kk = 0.55 + 0.45 * Math.sin(t * 6);
        col.setRGB(0.4 + 1.6 * kk, 1.2 + 1.6 * kk, 2.6 + 1.4 * kk);
      } else if (ph === 'running' || ph === 'ended') col.setRGB(0.05, 0.12, 0.2);
      else col.setRGB(0.5, 1.5, 2.8);
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
