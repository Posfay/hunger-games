/* ==========================================================================
 * gfx.js — GM.Gfx: the shared rendering foundation.
 *
 *   - Colour management: linear working space, sRGB output (hex colours are
 *     authored in sRGB and converted automatically by THREE.Color).
 *   - Global atmosphere: THREE's fog chunks are replaced by an exponential
 *     height fog with sun in-scattering. Every material with fog: true gets it.
 *   - Shared uniforms (sun, sky, weather, time) that any shader can use via
 *     Gfx.share(shader) + '#include <gm_common>'.
 *   - A tileable RGBA noise texture (Gfx.noiseTex) for procedural detail.
 *   - Material helpers (Gfx.patch) to inject code into built-in materials.
 *
 * Load order: right after core.js / i18n.js, before any module creates
 * materials (the uniform libraries are patched at load time).
 * Owner: WORLD.
 * ========================================================================== */
(function () {
  'use strict';
  const GM = window.GM;
  const THREE = window.THREE;
  const Gfx = (GM.Gfx = { ready: false });
  if (!THREE) return;

  // ------------------------------------------------------ colour management
  // Hex colours (materials, uniforms) are converted sRGB -> linear by THREE.Color.
  // Raw numbers (setRGB, vertex colour arrays) are linear: convert authored
  // sRGB values with Gfx.lin() / Gfx.LIN8.
  THREE.ColorManagement.legacyMode = false;

  function srgbToLinear(c) {
    return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
  }
  const LIN8 = new Float32Array(256);
  for (let i = 0; i < 256; i++) LIN8[i] = srgbToLinear(i / 255);
  Gfx.LIN8 = LIN8;
  /** sRGB component (0..1) -> linear. */
  Gfx.lin = srgbToLinear;
  /** sRGB byte (0..255, may be fractional) -> linear. */
  Gfx.lin255 = function (v) {
    if (!(v > 0)) return 0;
    if (v >= 255) return 1;
    const i = v | 0, f = v - i;
    return LIN8[i] + (LIN8[i + 1 < 256 ? i + 1 : 255] - LIN8[i]) * f;
  };
  /** Treat a Color's current rgb as sRGB and convert it to linear (after setRGB/setHSL). */
  Gfx.toLinear = function (c) {
    c.r = srgbToLinear(c.r); c.g = srgbToLinear(c.g); c.b = srgbToLinear(c.b);
    return c;
  };

  // --------------------------------------------------------- shared uniforms
  // Values are typed arrays: UniformsUtils.clone() copies typed arrays by
  // reference, so every material that clones these keeps sharing them.
  function vec(n, init) { const a = new Float32Array(n); if (init) a.set(init); return { value: a }; }
  const SU = (Gfx.uniforms = {
    // fog: x density (1/m), y height falloff (1/m), z base height, w max opacity
    gmFogA: vec(4, [0.0022, 0.028, 0, 0.92]),
    // fog: x start distance, y sun glow power, z ambient scale, w unused
    gmFogB: vec(4, [6, 7, 1, 0]),
    // xyz sun (or moon) direction, w in-scatter strength
    gmFogSun: vec(4, [0.4, 0.8, 0.4, 0.6]),
    gmFogSunCol: vec(3, [1.0, 0.85, 0.6]),
    // light
    gmSunDir: vec(3, [0.45, 0.78, 0.38]),
    gmSunCol: vec(3, [3, 2.8, 2.5]),          // HDR, includes intensity
    gmSkyZen: vec(3, [0.08, 0.22, 0.6]),
    gmSkyHor: vec(3, [0.5, 0.65, 0.85]),
    gmSkyGnd: vec(3, [0.12, 0.13, 0.1]),
    // x time (real s), y wetness 0..1, z snow cover 0..1, w wind strength 0..1
    gmEnv: vec(4, [0, 0, 0, 0.2]),
    // x wind dir x, y wind dir z, z water level, w daylight 0..1
    gmEnv2: vec(4, [0.8, 0.6, 0, 1]),
    // shadow map coverage: x centre x, y centre z, z half extent, w lightning flash
    gmShadow: vec(4, [0, 0, 60, 0]),
    // x exposure, y emissive compensation (keeps fire/glows from blowing out when the exposure rises at night)
    gmPost: vec(4, [1, 1, 0, 0]),
    // cloud shadows: x cover 0..1, y strength, z/w offset (drifts with the wind)
    gmCloud: vec(4, [0.3, 0.5, 0, 0]),
    gmNoise: { value: null },
  });
  const FOG_SHARED = ['gmFogA', 'gmFogB', 'gmFogSun', 'gmFogSunCol'];

  /** Add every shared uniform to a shader (use in onBeforeCompile). */
  Gfx.share = function (shader) {
    for (const k in SU) shader.uniforms[k] = SU[k];
    return shader;
  };
  /** Shared uniforms merged with material-specific ones (for ShaderMaterials). */
  Gfx.uniformsWith = function (own, withFog) {
    const out = {};
    if (withFog) {
      const f = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
      for (const k in f) out[k] = f[k];
    }
    for (const k in SU) out[k] = SU[k];
    if (own) for (const k in own) out[k] = own[k];
    return out;
  };

  // Register the fog uniforms with every built-in shader that uses fog, so
  // built-in materials (and ShaderMaterials merging UniformsLib.fog) get them.
  for (const k of FOG_SHARED) THREE.UniformsLib.fog[k] = SU[k];
  for (const name in THREE.ShaderLib) {
    const u = THREE.ShaderLib[name] && THREE.ShaderLib[name].uniforms;
    if (u && u.fogColor) for (const k of FOG_SHARED) u[k] = SU[k];
  }

  // ------------------------------------------------------------ fog chunks
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = [
    '#ifdef USE_FOG',
    '  varying float vFogDepth;',
    '  varying vec3 vFogWorld;',
    '#endif',
  ].join('\n');
  // world position from the view-space position (works for instancing, skinning, sprites)
  C.fog_vertex = [
    '#ifdef USE_FOG',
    '  vFogDepth = - mvPosition.z;',
    '  {',
    '    vec3 gmFd = mvPosition.xyz - viewMatrix[3].xyz;',
    '    vFogWorld = vec3( dot( viewMatrix[0].xyz, gmFd ), dot( viewMatrix[1].xyz, gmFd ), dot( viewMatrix[2].xyz, gmFd ) );',
    '  }',
    '#endif',
  ].join('\n');
  const FOG_FUNCS = [
    'uniform vec4 gmFogA;',
    'uniform vec4 gmFogB;',
    'uniform vec4 gmFogSun;',
    'uniform vec3 gmFogSunCol;',
    // exponential height fog: analytic optical depth along the view ray
    'float gmFogAmountRay( vec3 ray ) {',
    '  float dist = length( ray );',
    '  float d = max( dist - gmFogB.x, 0.0 );',
    '  float b = gmFogA.y;',
    '  float yc = max( cameraPosition.y - gmFogA.z, -20.0 );',
    '  float k = b * ray.y * ( d / max( dist, 1e-3 ) );',
    '  float fall = abs( k ) > 1e-3 ? ( 1.0 - exp( - k ) ) / k : 1.0 - 0.5 * k;',
    '  float od = gmFogA.x * d * exp( - b * yc ) * fall;',
    '  return min( 1.0 - exp( - od ), gmFogA.w );',
    '}',
    'vec3 gmFogTint( vec3 dir, vec3 baseCol ) {',
    '  float s = max( dot( dir, gmFogSun.xyz ), 0.0 );',
    '  return baseCol + gmFogSunCol * ( pow( s, gmFogB.y ) * gmFogSun.w + pow( s, 64.0 ) * gmFogSun.w * 0.6 );',
    '}',
  ].join('\n');
  Gfx.FOG_FUNCS = FOG_FUNCS;
  C.fog_pars_fragment = [
    '#ifdef USE_FOG',
    '  uniform vec3 fogColor;',
    '  varying float vFogDepth;',
    '  varying vec3 vFogWorld;',
    '  #ifdef FOG_EXP2',
    '    uniform float fogDensity;',
    '  #else',
    '    uniform float fogNear;',
    '    uniform float fogFar;',
    '  #endif',
    FOG_FUNCS,
    '  float gmFogFactor() { return gmFogAmountRay( vFogWorld - cameraPosition ); }',
    '  float gmFogKeep() { return 1.0 - gmFogFactor(); }',
    '  vec3 gmFogColor() { return gmFogTint( normalize( vFogWorld - cameraPosition ), fogColor ); }',
    '#endif',
  ].join('\n');
  C.fog_fragment = [
    '#ifdef USE_FOG',
    '  gl_FragColor.rgb = mix( gl_FragColor.rgb, gmFogColor(), gmFogFactor() );',
    '#endif',
  ].join('\n');

  // Clamp lit output: sub-pixel GGX spikes at grazing angles can exceed the
  // half-float range (65504) and turn into Inf, which bloom spreads as NaN.
  // (min() also drops NaN on D3D, where isnan() may be compiled away.)
  C.output_fragment = C.output_fragment.replace(
    'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
    'gl_FragColor = vec4( clamp( outgoingLight, vec3( 0.0 ), vec3( 3000.0 ) ), diffuseColor.a );');

  // ------------------------------------------------------ shared GLSL library
  C.gm_common = [
    'uniform vec3 gmSunDir;',
    'uniform vec3 gmSunCol;',
    'uniform vec3 gmSkyZen;',
    'uniform vec3 gmSkyHor;',
    'uniform vec3 gmSkyGnd;',
    'uniform vec4 gmEnv;',
    'uniform vec4 gmEnv2;',
    'uniform vec4 gmShadow;',
    'uniform vec4 gmPost;',
    'uniform vec4 gmCloud;',
    'uniform sampler2D gmNoise;',
    '#ifndef GM_SAT',
    '#define GM_SAT',
    'float gmSat( float x ) { return clamp( x, 0.0, 1.0 ); }',
    '#endif',
    'float gmHash12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }',
    'vec4 gmTex( vec2 uv ) { return texture2D( gmNoise, uv ); }',
    // simple analytic sky (used for reflections)
    'vec3 gmSky( vec3 d ) {',
    '  float h = d.y;',
    '  vec3 c = mix( gmSkyHor, gmSkyZen, pow( gmSat( h ), 0.5 ) );',
    '  c = mix( c, gmSkyGnd, smoothstep( 0.02, -0.3, h ) );',
    '  float s = max( dot( d, gmSunDir ), 0.0 );',
    '  c += gmSunCol * ( pow( s, 10.0 ) * 0.05 + pow( s, 90.0 ) * 0.2 );',
    '  return c;',
    '}',
    // sun visibility under drifting clouds (1 = lit)
    'float gmCloudShadow( vec3 wp ) {',
    '  if ( gmCloud.y <= 0.001 ) return 1.0;',
    '  vec2 p = ( wp.xz + gmSunDir.xz / max( gmSunDir.y, 0.25 ) * 300.0 ) * 0.0022 + gmCloud.zw;',
    '  float n = texture2D( gmNoise, p * 0.43 ).r * 0.62 + texture2D( gmNoise, p * 1.13 + 0.37 ).g * 0.38;',
    '  float lo = 1.0 - gmCloud.x;',
    '  return 1.0 - smoothstep( lo, lo + 0.26, n ) * gmCloud.y;',
    '}',
    // animated caustics (0..1)
    'float gmCaustic( vec2 p, float t ) {',
    '  vec2 q = p * 0.55;',
    '  vec2 w = vec2( gmTex( q * 0.07 + t * 0.012 ).g, gmTex( q * 0.07 - t * 0.01 + 0.37 ).b ) * 2.0 - 1.0;',
    '  q += w * 1.4;',
    '  float a = abs( sin( q.x + t * 0.9 ) + sin( q.y * 1.13 - t * 0.7 ) + sin( ( q.x + q.y ) * 0.77 + t * 1.1 ) );',
    '  return pow( 1.0 - gmSat( a / 1.1 ), 4.0 );',
    '}',
  ].join('\n');
  // fragment-only helpers (derivatives)
  C.gm_common_frag = [
    '#include <gm_common>',
    // derivative bump mapping (view space), see three.js perturbNormalArb
    'vec3 gmBump( vec3 pos, vec3 n, float h, float scale ) {',
    '  vec3 dpx = dFdx( pos ), dpy = dFdy( pos );',
    '  float dhx = dFdx( h ) * scale, dhy = dFdy( h ) * scale;',
    '  vec3 r1 = cross( dpy, n ), r2 = cross( n, dpx );',
    '  float det = dot( dpx, r1 );',
    '  if ( abs( det ) < 1e-8 ) return n;',
    '  vec3 grad = sign( det ) * ( dhx * r1 + dhy * r2 );',
    '  return normalize( abs( det ) * n - grad );',
    '}',
  ].join('\n');

  // ------------------------------------------------------------- noise texture
  /**
   * 256x256 tileable RGBA noise. R: fbm (4 cells), G: fbm (8 cells),
   * B: fbm (32 cells), A: fine grain (64 cells). All channels tile.
   */
  function buildNoise() {
    const S = 256;
    const data = new Uint8Array(S * S * 4);
    const seed = 9127;
    function h(ix, iy, P, s) {
      ix = ((ix % P) + P) % P; iy = ((iy % P) + P) % P;
      let n = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(s + P, 1442695041);
      n = Math.imul(n ^ (n >>> 13), 1274126177);
      n ^= n >>> 16;
      return (n >>> 0) / 4294967296;
    }
    function vnoise(x, y, P, s) {
      const ix = Math.floor(x), iy = Math.floor(y);
      let fx = x - ix, fy = y - iy;
      fx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
      fy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
      const a = h(ix, iy, P, s), b = h(ix + 1, iy, P, s), c = h(ix, iy + 1, P, s), d = h(ix + 1, iy + 1, P, s);
      return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
    }
    function fbm(u, v, P, oct, s) {
      let sum = 0, amp = 0.5, norm = 0, p = P;
      for (let o = 0; o < oct; o++) {
        sum += amp * vnoise(u * p, v * p, p, s + o * 17);
        norm += amp; amp *= 0.5; p *= 2;
      }
      return sum / norm;
    }
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const o = (y * S + x) * 4;
        const r = fbm(u, v, 4, 5, seed);
        const g = fbm(u, v, 8, 4, seed + 101);
        const b = fbm(u, v, 32, 3, seed + 211);
        const a = fbm(u, v, 64, 2, seed + 307);
        // stretch contrast a little (fbm clusters around 0.5)
        data[o] = Math.max(0, Math.min(255, ((r - 0.5) * 1.7 + 0.5) * 255));
        data[o + 1] = Math.max(0, Math.min(255, ((g - 0.5) * 1.7 + 0.5) * 255));
        data[o + 2] = Math.max(0, Math.min(255, ((b - 0.5) * 1.6 + 0.5) * 255));
        data[o + 3] = Math.max(0, Math.min(255, ((a - 0.5) * 1.5 + 0.5) * 255));
      }
    }
    const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    tex.name = 'gmNoise';
    return tex;
  }
  Gfx.noiseTex = buildNoise();
  SU.gmNoise.value = Gfx.noiseTex;

  // --------------------------------------------------------- material helper
  /**
   * Inject GLSL into a built-in material.
   * spec: { key, uniforms, vertexPre, fragmentPre, vertex: {chunk: code}, fragment: {chunk: code} }
   * chunk code may contain '$' which is replaced by the original '#include <chunk>'.
   */
  Gfx.patch = function (mat, spec) {
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = function (shader, renderer) {
      if (typeof prev === 'function' && prev !== THREE.Material.prototype.onBeforeCompile) prev(shader, renderer);
      Gfx.share(shader);
      if (spec.uniforms) for (const k in spec.uniforms) shader.uniforms[k] = spec.uniforms[k];
      let vs = shader.vertexShader, fs = shader.fragmentShader;
      if (spec.vertexPre) vs = vs.replace('#include <common>', '#include <common>\n#include <gm_common>\n' + spec.vertexPre);
      if (spec.fragmentPre) fs = fs.replace('#include <common>', '#include <common>\n#include <gm_common_frag>\n' + spec.fragmentPre);
      const rep = function (src, map) {
        if (!map) return src;
        for (const chunk in map) {
          const inc = '#include <' + chunk + '>';
          if (src.indexOf(inc) < 0) { GM.reportError('Gfx.patch', new Error('missing chunk ' + chunk + ' in ' + (spec.key || '?'))); continue; }
          src = src.replace(inc, map[chunk].split('$').join(inc));
        }
        return src;
      };
      shader.vertexShader = rep(vs, spec.vertex);
      shader.fragmentShader = rep(fs, spec.fragment);
      if (spec.after) spec.after(shader);
    };
    const key = spec.key || 'gm';
    mat.customProgramCacheKey = function () { return 'gm-' + key; };
    return mat;
  };

  // world position / normal varyings for patched materials (instancing aware)
  Gfx.WORLD_VARY = 'varying vec3 vGmWorld;\nvarying vec3 vGmNrmW;\n';
  Gfx.WORLD_VERTEX = [
    '{',
    '  vec4 gmW = vec4( transformed, 1.0 );',
    '  vec3 gmN = objectNormal;',
    '  #ifdef USE_INSTANCING',
    '    gmW = instanceMatrix * gmW;',
    '    gmN = mat3( instanceMatrix ) * gmN;',
    '  #endif',
    '  gmW = modelMatrix * gmW;',
    '  vGmWorld = gmW.xyz;',
    '  vGmNrmW = normalize( mat3( modelMatrix ) * gmN );',
    '}',
  ].join('\n');

  // ----------------------------------------------------------- quality level
  /** 'high' | 'low' from the settings (default high). */
  Gfx.low = function () {
    const s = GM.state && GM.state.settings;
    return !!(s && s.quality === 'low');
  };

  /** Update the time uniform (called by Post every frame). */
  Gfx.tick = function (realDt) {
    SU.gmEnv.value[0] += Math.min(0.1, Math.max(0, realDt || 0));
    if (SU.gmEnv.value[0] > 3600) SU.gmEnv.value[0] -= 3600;
  };

  Gfx.ready = true;
})();
