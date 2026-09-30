/* ==========================================================================
 * post.js — GM.Post: HDR rendering and post-processing.
 *
 * Every view (main camera + live feeds) renders into its own HDR target
 * (half float, MSAA, depth texture). The main view then gets:
 *   SSAO (half res, bilateral blur) -> bloom (mip chain) -> sun shafts ->
 *   composite: AO, bloom, shafts, exposure, ACES filmic tone mapping,
 *   colour grading, chromatic aberration, vignette, grain, dithering.
 * Feeds get a lighter composite (tone mapping, grading, vignette, grain).
 * The composite writes the scene depth, so a final overlay pass (layer 1:
 * name tags, selection ring, targeting reticle) is depth tested but stays
 * crisp: no tone mapping, bloom or grain.
 *
 *   Post.renderView(scene, camera, x, y, w, h, slot, isMain)
 *       x, y, w, h in CSS px, bottom-left origin (like renderer.setViewport)
 *   Post.settings  live grading parameters (Env animates them)
 *   Post.OVERLAY   layer number for overlay objects
 *
 * Owner: WORLD.
 * ========================================================================== */
(function () {
  'use strict';
  const GM = window.GM;
  const THREE = window.THREE;
  const Post = (GM.Post = { OVERLAY: 1, ok: false });
  if (!THREE) return;

  const S = (Post.settings = {
    exposure: 1.0,
    bloom: 0.55,            // bloom strength
    bloomThreshold: 1.1,    // HDR luminance where bloom starts
    bloomKnee: 0.6,
    bloomRadius: 0.75,      // how much the wide mips contribute
    ao: 0.85,               // SSAO strength
    aoRadius: 1.6,          // metres
    vignette: 0.32,
    grain: 0.022,
    ca: 0.9,                // chromatic aberration (px at the corners)
    saturation: 1.06,
    contrast: 0.18,         // S-curve amount
    shadowTint: [0.97, 1.0, 1.05],
    highTint: [1.03, 1.0, 0.95],
    rays: 0,                // sun shaft strength (Env sets it)
    raysColor: [1, 0.85, 0.6],
    sunDir: new THREE.Vector3(0.4, 0.8, 0.4),
    feedGrain: 0.06,
    renderScale: 1,         // resolution multiplier for every view
    dof: 0,                 // depth of field amount 0..1 (Cameras set it for close-ups)
    dofFocus: 10,           // metres
    dofRange: 18,           // metres behind the focus until full blur
  });

  // --------------------------------------------------------------- shaders
  const FS_VS = [
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = vec4( position.xy, 0.0, 1.0 );',
    '}',
  ].join('\n');

  const DOWN_FS = [
    'uniform sampler2D tSrc;',
    'uniform vec2 uTexel;',
    'uniform vec4 uThresh;',      // x threshold, y knee, z prefilter flag
    'varying vec2 vUv;',
    // sanitise: a single NaN/Inf/negative pixel would otherwise spread over the whole bloom chain
    'vec3 clean( vec3 c ) {',
    '  return clamp( c, vec3( 0.0 ), vec3( 256.0 ) );',
    '}',
    'vec3 s( vec2 o ) { return clean( texture2D( tSrc, vUv + o * uTexel ).rgb ); }',
    'float luma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }',
    'vec3 karis( vec3 a, vec3 b, vec3 c, vec3 d ) {',
    '  float wa = 1.0 / ( 1.0 + luma( a ) ), wb = 1.0 / ( 1.0 + luma( b ) ), wc = 1.0 / ( 1.0 + luma( c ) ), wd = 1.0 / ( 1.0 + luma( d ) );',
    '  return ( a * wa + b * wb + c * wc + d * wd ) / ( wa + wb + wc + wd );',
    '}',
    'void main() {',
    '  vec3 a = s( vec2( -2.0, 2.0 ) ), b = s( vec2( 0.0, 2.0 ) ), c = s( vec2( 2.0, 2.0 ) );',
    '  vec3 d = s( vec2( -2.0, 0.0 ) ), e = s( vec2( 0.0, 0.0 ) ), f = s( vec2( 2.0, 0.0 ) );',
    '  vec3 g = s( vec2( -2.0, -2.0 ) ), h = s( vec2( 0.0, -2.0 ) ), i = s( vec2( 2.0, -2.0 ) );',
    '  vec3 j = s( vec2( -1.0, 1.0 ) ), k = s( vec2( 1.0, 1.0 ) ), l = s( vec2( -1.0, -1.0 ) ), m = s( vec2( 1.0, -1.0 ) );',
    '  vec3 col;',
    '  if ( uThresh.z > 0.5 ) {',
    '    col = karis( j, k, l, m ) * 0.5 + karis( a, b, d, e ) * 0.125 + karis( b, c, e, f ) * 0.125 + karis( d, e, g, h ) * 0.125 + karis( e, f, h, i ) * 0.125;',
    '    col = min( col, vec3( 64.0 ) );',
    '    float br = max( col.r, max( col.g, col.b ) );',
    '    float soft = clamp( br - uThresh.x + uThresh.y, 0.0, 2.0 * uThresh.y );',
    '    soft = soft * soft / ( 4.0 * uThresh.y + 1e-4 );',
    '    float contrib = max( soft, br - uThresh.x ) / max( br, 1e-4 );',
    '    col *= contrib;',
    '  } else {',
    '    col = e * 0.125 + ( a + c + g + i ) * 0.03125 + ( b + d + f + h ) * 0.0625 + ( j + k + l + m ) * 0.125;',
    '  }',
    '  gl_FragColor = vec4( col, 1.0 );',
    '}',
  ].join('\n');

  const UP_FS = [
    'uniform sampler2D tSrc;',
    'uniform vec2 uTexel;',
    'uniform float uWeight;',
    'varying vec2 vUv;',
    'void main() {',
    '  vec2 t = uTexel;',
    '  vec3 c = texture2D( tSrc, vUv ).rgb * 4.0;',
    '  c += ( texture2D( tSrc, vUv + vec2( -t.x, 0.0 ) ).rgb + texture2D( tSrc, vUv + vec2( t.x, 0.0 ) ).rgb +',
    '         texture2D( tSrc, vUv + vec2( 0.0, -t.y ) ).rgb + texture2D( tSrc, vUv + vec2( 0.0, t.y ) ).rgb ) * 2.0;',
    '  c += texture2D( tSrc, vUv + vec2( -t.x, -t.y ) ).rgb + texture2D( tSrc, vUv + vec2( t.x, -t.y ) ).rgb +',
    '       texture2D( tSrc, vUv + vec2( -t.x, t.y ) ).rgb + texture2D( tSrc, vUv + vec2( t.x, t.y ) ).rgb;',
    '  gl_FragColor = vec4( c * ( uWeight / 16.0 ), 1.0 );',
    '}',
  ].join('\n');

  // SSAO: normal-oriented hemisphere, spiral samples, view-space reconstruction
  const AO_FS = [
    'uniform sampler2D tDepth;',
    'uniform mat4 uProj;',
    'uniform mat4 uInvProj;',
    'uniform vec2 uTexel;',        // full-res depth texel
    'uniform vec4 uP;',            // x radius (m), y bias, z intensity, w frame
    'varying vec2 vUv;',
    '#define SAMPLES 14',
    'vec3 vpos( vec2 uv, float d ) {',
    '  vec4 p = uInvProj * vec4( uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 );',
    '  return p.xyz / p.w;',
    '}',
    'vec3 vposAt( vec2 uv ) { return vpos( uv, texture2DLodEXT( tDepth, uv, 0.0 ).r ); }',
    'void main() {',
    '  float d = texture2D( tDepth, vUv ).r;',
    '  if ( d >= 0.99999 ) { gl_FragColor = vec4( 1.0 ); return; }',
    '  vec3 P = vpos( vUv, d );',
    '  vec3 pr = vposAt( vUv + vec2( uTexel.x, 0.0 ) ), pl = vposAt( vUv - vec2( uTexel.x, 0.0 ) );',
    '  vec3 pu = vposAt( vUv + vec2( 0.0, uTexel.y ) ), pd = vposAt( vUv - vec2( 0.0, uTexel.y ) );',
    '  vec3 dx = abs( pr.z - P.z ) < abs( P.z - pl.z ) ? pr - P : P - pl;',
    '  vec3 dy = abs( pu.z - P.z ) < abs( P.z - pd.z ) ? pu - P : P - pd;',
    '  vec3 N = normalize( cross( dx, dy ) );',
    '  float R = uP.x;',
    '  float rad = R * uProj[1][1] * 0.5 / max( -P.z, 0.1 );',   // uv units (y)
    '  rad = min( rad, 0.12 );',
    '  float aspect = uTexel.y / uTexel.x;',
    '  float noise = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );',
    '  float ang = noise * 6.2831853 + uP.w;',
    '  float occ = 0.0;',
    '  for ( int i = 0; i < SAMPLES; i++ ) {',
    '    float fi = ( float( i ) + 0.5 ) / float( SAMPLES );',
    '    float a = ang + float( i ) * 2.39996323;',
    '    vec2 off = vec2( cos( a ) / aspect, sin( a ) ) * rad * sqrt( fi );',
    '    vec3 Q = vposAt( vUv + off );',
    '    vec3 v = Q - P;',
    '    float vv = dot( v, v );',
    '    float nd = dot( v, N ) - uP.y * ( -P.z ) * 0.02;',
    '    float fall = 1.0 - smoothstep( R * 0.5, R * 1.6, sqrt( vv ) );',
    '    occ += max( nd, 0.0 ) / ( vv + 0.02 ) * fall;',
    '  }',
    '  occ = occ * R / float( SAMPLES );',
    '  float ao = clamp( 1.0 - occ * uP.z, 0.0, 1.0 );',
    // distant geometry gets less AO (sub-pixel noise)
    '  ao = mix( ao, 1.0, smoothstep( 90.0, 260.0, -P.z ) );',
    '  gl_FragColor = vec4( ao, ao, ao, 1.0 );',
    '}',
  ].join('\n');

  // depth-aware blur of the AO buffer
  const BLUR_FS = [
    'uniform sampler2D tSrc;',
    'uniform sampler2D tDepth;',
    'uniform vec2 uDir;',          // texel step of the AO buffer
    'uniform vec2 uCam;',          // near, far
    'varying vec2 vUv;',
    'float lin( float d ) { float z = d * 2.0 - 1.0; return 2.0 * uCam.x * uCam.y / ( uCam.y + uCam.x - z * ( uCam.y - uCam.x ) ); }',
    'void main() {',
    '  float d0 = lin( texture2D( tDepth, vUv ).r );',
    '  float sum = 0.0, wsum = 0.0;',
    '  for ( int i = -3; i <= 3; i++ ) {',
    '    vec2 uv = vUv + uDir * float( i );',
    '    float di = lin( texture2DLodEXT( tDepth, uv, 0.0 ).r );',
    '    float w = exp( -float( i * i ) * 0.18 ) * exp( -abs( di - d0 ) / ( 0.06 * d0 + 0.05 ) * 2.0 );',
    '    sum += texture2DLodEXT( tSrc, uv, 0.0 ).r * w;',
    '    wsum += w;',
    '  }',
    '  float ao = sum / max( wsum, 1e-4 );',
    '  gl_FragColor = vec4( ao, ao, ao, 1.0 );',
    '}',
  ].join('\n');

  // sun shafts: bright, unoccluded sky near the sun, blurred radially
  const RAYMASK_FS = [
    'uniform sampler2D tColor;',
    'uniform sampler2D tDepth;',
    'uniform vec2 uSun;',          // sun position in uv
    'uniform float uAspect;',
    'varying vec2 vUv;',
    'void main() {',
    '  float d = texture2D( tDepth, vUv ).r;',
    '  float sky = step( 0.99999, d );',
    '  vec2 dv = ( vUv - uSun ) * vec2( uAspect, 1.0 );',
    '  float glow = pow( max( 1.0 - length( dv ) * 1.6, 0.0 ), 2.2 );',
    '  vec3 c = texture2D( tColor, vUv ).rgb;',
    '  float l = clamp( dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.0, 6.0 );',
    '  gl_FragColor = vec4( vec3( sky * glow * l ), 1.0 );',
    '}',
  ].join('\n');
  const RAYBLUR_FS = [
    'uniform sampler2D tSrc;',
    'uniform vec2 uSun;',
    'uniform float uStep;',
    'varying vec2 vUv;',
    '#define N 24',
    'void main() {',
    '  vec2 dir = ( uSun - vUv ) * uStep / float( N );',
    '  vec2 uv = vUv;',
    '  float noise = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );',
    '  uv += dir * noise;',
    '  vec3 acc = vec3( 0.0 );',
    '  float w = 1.0, wsum = 0.0;',
    '  for ( int i = 0; i < N; i++ ) {',
    '    acc += texture2DLodEXT( tSrc, uv, 0.0 ).rgb * w;',
    '    wsum += w;',
    '    w *= 0.955;',
    '    uv += dir;',
    '  }',
    '  gl_FragColor = vec4( acc / wsum, 1.0 );',
    '}',
  ].join('\n');

  // depth of field (background only): half-res disc gather weighted by circle of confusion
  const DOF_FS = [
    'uniform sampler2D tColor;',
    'uniform sampler2D tDepth;',
    'uniform vec2 uCam;',          // near, far
    'uniform vec4 uDof;',          // x focus distance, y range, z max radius (uv, y axis), w aspect
    'varying vec2 vUv;',
    'float lin( float d ) { float z = d * 2.0 - 1.0; return 2.0 * uCam.x * uCam.y / ( uCam.y + uCam.x - z * ( uCam.y - uCam.x ) ); }',
    'float coc( vec2 uv ) { float d = texture2DLodEXT( tDepth, uv, 0.0 ).r; float z = d >= 0.99999 ? 1e5 : lin( d ); return clamp( ( z - uDof.x ) / uDof.y, 0.0, 1.0 ); }',
    'void main() {',
    '  float c0 = coc( vUv );',
    '  vec3 acc = texture2DLodEXT( tColor, vUv, 0.0 ).rgb;',
    '  float wsum = 1.0;',
    '  float r = uDof.z * c0;',
    '  if ( r > 0.0005 ) {',
    '    for ( int i = 0; i < 22; i++ ) {',
    '      float fi = ( float( i ) + 0.5 ) / 22.0;',
    '      float a = float( i ) * 2.39996323;',
    '      vec2 off = vec2( cos( a ) / uDof.w, sin( a ) ) * r * sqrt( fi );',
    '      vec2 uv = vUv + off;',
    '      float cs = coc( uv );',
    '      float w = smoothstep( c0 * 0.35, c0 * 0.8 + 0.001, cs );',     // in-focus pixels do not bleed into the blur
    '      acc += clamp( texture2DLodEXT( tColor, uv, 0.0 ).rgb, vec3( 0.0 ), vec3( 64.0 ) ) * w;',
    '      wsum += w;',
    '    }',
    '  }',
    '  gl_FragColor = vec4( acc / wsum, c0 );',
    '}',
  ].join('\n');

  const COMP_FS = [
    'uniform sampler2D tColor;',
    'uniform sampler2D tDepth;',
    '#ifdef USE_DOF',
    'uniform sampler2D tDof;',
    'uniform vec2 uDofCam;',
    'uniform vec4 uDofP;',
    '#endif',
    '#ifdef USE_BLOOM',
    'uniform sampler2D tBloom;',
    '#endif',
    '#ifdef USE_AO',
    'uniform sampler2D tAO;',
    '#endif',
    '#ifdef USE_RAYS',
    'uniform sampler2D tRays;',
    'uniform vec3 uRaysCol;',
    '#endif',
    'uniform vec4 uP1;',           // exposure, bloom, ao, vignette
    'uniform vec4 uP2;',           // grain, ca (px), saturation, contrast
    'uniform vec3 uShadowTint;',
    'uniform vec3 uHighTint;',
    'uniform vec2 uTexel;',
    'uniform float uTime;',
    'varying vec2 vUv;',
    'vec3 RRTAndODTFit( vec3 v ) {',
    '  vec3 a = v * ( v + 0.0245786 ) - 0.000090537;',
    '  vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;',
    '  return a / b;',
    '}',
    'vec3 aces( vec3 color ) {',
    '  const mat3 IN = mat3( vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 ) );',
    '  const mat3 OUT = mat3( vec3( 1.60475, -0.10208, -0.00327 ), vec3( -0.53108, 1.10813, -0.07276 ), vec3( -0.07367, -0.00605, 1.07602 ) );',
    '  color = IN * ( color / 0.6 );',
    '  color = RRTAndODTFit( color );',
    '  return clamp( OUT * color, 0.0, 1.0 );',
    '}',
    'vec3 toSRGB( vec3 c ) {',
    '  return mix( c * 12.92, pow( max( c, 0.0 ), vec3( 0.41666 ) ) * 1.055 - 0.055, step( 0.0031308, c ) );',
    '}',
    'float hash( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }',
    'void main() {',
    '  vec2 uv = vUv;',
    '  vec2 cd = uv - 0.5;',
    '  float r2 = dot( cd, cd );',
    '  vec3 col;',
    '  if ( uP2.y > 0.01 ) {',
    '    vec2 off = cd * r2 * 4.0 * uP2.y * uTexel;',
    '    col.r = texture2D( tColor, uv + off ).r;',
    '    col.g = texture2D( tColor, uv ).g;',
    '    col.b = texture2D( tColor, uv - off ).b;',
    '  } else {',
    '    col = texture2D( tColor, uv ).rgb;',
    '  }',
    '  col = clamp( col, vec3( 0.0 ), vec3( 4000.0 ) );',
    '  #ifdef USE_AO',
    '    float ao = texture2D( tAO, uv ).r;',
    '    col *= mix( 1.0, ao, uP1.z );',
    '  #endif',
    '  #ifdef USE_DOF',
    '  if ( uDofP.w > 0.001 ) {',
    '    float dz = texture2D( tDepth, uv ).r;',
    '    float zl = dz >= 0.99999 ? 1e5 : 2.0 * uDofCam.x * uDofCam.y / ( uDofCam.y + uDofCam.x - ( dz * 2.0 - 1.0 ) * ( uDofCam.y - uDofCam.x ) );',
    '    float cf = clamp( ( zl - uDofP.x ) / uDofP.y, 0.0, 1.0 ) * uDofP.w;',
    '    vec3 bl = texture2D( tDof, uv ).rgb;',
    '    #ifdef USE_AO',
    '      bl *= mix( 1.0, ao, uP1.z );',
    '    #endif',
    '    col = mix( col, bl, smoothstep( 0.0, 0.6, cf ) );',
    '  }',
    '  #endif',
    '  #ifdef USE_BLOOM',
    '    col += texture2D( tBloom, uv ).rgb * uP1.y;',
    '  #endif',
    '  #ifdef USE_RAYS',
    '    col += texture2D( tRays, uv ).rgb * uRaysCol;',
    '  #endif',
    '  col *= uP1.x;',
    '  col = aces( col );',
    // saturation + split toning in linear display space
    '  float l = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );',
    '  col = max( mix( vec3( l ), col, uP2.z ), 0.0 );',
    '  col *= mix( uShadowTint, uHighTint, smoothstep( 0.05, 0.6, l ) );',
    '  vec3 s = toSRGB( clamp( col, 0.0, 1.0 ) );',
    '  s = mix( s, s * s * ( 3.0 - 2.0 * s ), uP2.w );',
    // vignette
    '  float vig = 1.0 - uP1.w * smoothstep( 0.12, 0.62, r2 * 1.6 );',
    '  s *= vig;',
    // film grain (luma weighted) + dithering against banding
    '  float n = hash( gl_FragCoord.xy + fract( uTime * 7.31 ) * 311.0 ) - 0.5;',
    '  float n2 = hash( gl_FragCoord.xy * 1.37 + 17.0 + fract( uTime * 3.7 ) * 97.0 ) - 0.5;',
    '  s += n * uP2.x * ( 1.0 - 0.6 * dot( s, vec3( 0.333 ) ) ) + ( n + n2 ) / 255.0;',
    '  gl_FragColor = vec4( s, 1.0 );',
    '  gl_FragDepthEXT = texture2D( tDepth, uv ).r;',
    '}',
  ].join('\n');

  // ------------------------------------------------------------- resources
  let renderer = null, caps = null;
  let quadScene = null, quadCam = null, quad = null;
  let mDown = null, mUp = null, mAO = null, mBlur = null, mRayMask = null, mRayBlur = null, mDof = null;
  let mCompMain = null, mCompFeed = null;
  const slots = [];
  let frameNo = 0;

  function makeMat(fs, uniforms, defines) {
    return new THREE.ShaderMaterial({
      vertexShader: FS_VS,
      fragmentShader: fs,
      uniforms: uniforms,
      defines: defines || {},
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: false,
      fog: false,
      extensions: { shaderTextureLOD: true },
    });
  }

  function makeCompMat(main) {
    const defines = {};
    if (main) { defines.USE_BLOOM = ''; defines.USE_AO = ''; defines.USE_RAYS = ''; defines.USE_DOF = ''; }
    const m = makeMat(COMP_FS, {
      tColor: { value: null }, tDepth: { value: null }, tBloom: { value: null }, tAO: { value: null }, tRays: { value: null },
      tDof: { value: null }, uDofCam: { value: new THREE.Vector2(0.3, 1000) }, uDofP: { value: new THREE.Vector4() },
      uRaysCol: { value: new THREE.Vector3() },
      uP1: { value: new THREE.Vector4() }, uP2: { value: new THREE.Vector4() },
      uShadowTint: { value: new THREE.Vector3(1, 1, 1) }, uHighTint: { value: new THREE.Vector3(1, 1, 1) },
      uTexel: { value: new THREE.Vector2() }, uTime: { value: 0 },
    }, defines);
    // write the scene depth for the overlay pass
    m.depthTest = true;
    m.depthWrite = true;
    m.depthFunc = THREE.AlwaysDepth;
    m.extensions = { fragDepth: true };
    return m;
  }

  function init() {
    if (renderer) return true;
    const W = GM.World;
    if (!W || !W.renderer) return false;
    renderer = W.renderer;
    const gl = renderer.getContext();
    const webgl2 = !!renderer.capabilities.isWebGL2;
    const ext = renderer.extensions;
    const floatRT = webgl2 ? ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float') : ext.has('OES_texture_half_float') && ext.has('EXT_color_buffer_half_float');
    const depthTex = webgl2 || ext.has('WEBGL_depth_texture');
    caps = {
      webgl2,
      type: floatRT ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthTex,
      maxSamples: webgl2 ? Math.min(4, renderer.capabilities.maxSamples || 4) : 0,
      fragDepth: webgl2 || ext.has('EXT_frag_depth'),
    };
    if (!depthTex || !caps.fragDepth) { Post.ok = false; return false; }

    quadScene = new THREE.Scene();
    quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    quad = new THREE.Mesh(g, null);
    quad.frustumCulled = false;
    quadScene.add(quad);

    mDown = makeMat(DOWN_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThresh: { value: new THREE.Vector4() } });
    mUp = makeMat(UP_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } });
    mUp.blending = THREE.AdditiveBlending;
    mUp.transparent = true;
    mAO = makeMat(AO_FS, {
      tDepth: { value: null }, uProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() },
      uTexel: { value: new THREE.Vector2() }, uP: { value: new THREE.Vector4() },
    });
    mBlur = makeMat(BLUR_FS, { tSrc: { value: null }, tDepth: { value: null }, uDir: { value: new THREE.Vector2() }, uCam: { value: new THREE.Vector2() } });
    mRayMask = makeMat(RAYMASK_FS, { tColor: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 } });
    mRayBlur = makeMat(RAYBLUR_FS, { tSrc: { value: null }, uSun: { value: new THREE.Vector2() }, uStep: { value: 1 } });
    mDof = makeMat(DOF_FS, { tColor: { value: null }, tDepth: { value: null }, uCam: { value: new THREE.Vector2() }, uDof: { value: new THREE.Vector4() } });
    mCompMain = makeCompMat(true);
    mCompFeed = makeCompMat(false);
    Post.ok = true;
    return true;
  }

  function rt(w, h, opts) {
    opts = opts || {};
    const t = new THREE.WebGLRenderTarget(w, h, {
      type: opts.type || caps.type,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: !!opts.depth,
      stencilBuffer: false,
      generateMipmaps: false,
      samples: opts.samples || 0,
    });
    if (opts.depth) {
      const dt = new THREE.DepthTexture(w, h, caps.webgl2 ? THREE.UnsignedIntType : THREE.UnsignedShortType);
      dt.minFilter = THREE.NearestFilter;
      dt.magFilter = THREE.NearestFilter;
      t.depthTexture = dt;
    }
    t.texture.generateMipmaps = false;
    return t;
  }
  function disposeSlot(s) {
    if (!s) return;
    const all = [s.scene, s.aoA, s.aoB, s.rayA, s.rayB, s.dofT].concat(s.bloom || []);
    for (const t of all) {
      if (!t) continue;
      if (t.depthTexture) t.depthTexture.dispose();
      t.dispose();
    }
  }
  /** (Re)allocate the targets of a slot for a pixel size. */
  function ensureSlot(i, w, h, main, samples) {
    let s = slots[i];
    if (s && s.w === w && s.h === h && s.main === main && s.samples === samples) return s;
    disposeSlot(s);
    s = { w, h, main, samples, scene: rt(w, h, { depth: true, samples }), bloom: null, aoA: null, aoB: null, rayA: null, rayB: null, dofT: null };
    if (main) {
      s.bloom = [];
      let bw = w >> 1, bh = h >> 1;
      for (let k = 0; k < 6 && bw >= 8 && bh >= 8; k++) {
        s.bloom.push(rt(bw, bh));
        bw >>= 1; bh >>= 1;
      }
      const aw = Math.max(1, w >> 1), ah = Math.max(1, h >> 1);
      s.aoA = rt(aw, ah, { type: THREE.UnsignedByteType });
      s.aoB = rt(aw, ah, { type: THREE.UnsignedByteType });
      const rw = Math.max(1, w >> 2), rh = Math.max(1, h >> 2);
      s.rayA = rt(rw, rh);
      s.rayB = rt(rw, rh);
      s.dofT = rt(aw, ah);
    }
    slots[i] = s;
    return s;
  }

  function pass(mat, target) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCam);
  }

  // --------------------------------------------------------- dynamic scale
  let dyn = 1, dynT = 0, emaDt = 1 / 60, lastNow = 0;
  function adapt() {
    const now = performance.now();
    const dt = lastNow ? Math.min(0.25, (now - lastNow) / 1000) : 1 / 60;
    lastNow = now;
    emaDt += (dt - emaDt) * 0.05;
    dynT += dt;
    if (dynT < 0.5) return;
    dynT = 0;
    if (emaDt > 1 / 45) dyn = Math.max(0.7, dyn - 0.05);
    else if (emaDt < 1 / 57) dyn = Math.min(1, dyn + 0.025);
  }
  let lastFrameMark = -1;

  // -------------------------------------------------------------- per view
  const _sun = new THREE.Vector3();
  const _ndc = new THREE.Vector3();

  /**
   * Render a view through the HDR pipeline into the canvas rectangle
   * (x, y, w, h in CSS px, bottom-left origin). refresh = false re-uses the
   * last scene image of this slot (live feeds refresh round-robin).
   */
  Post.renderView = function (scene, camera, x, y, w, h, slot, isMain, refresh) {
    if (!init() || !Post.ok) {
      direct(scene, camera, x, y, w, h);
      return;
    }
    const st = GM.state;
    if (st.realTime !== lastFrameMark) {
      lastFrameMark = st.realTime;
      frameNo++;
      adapt();
    }
    const low = GM.Gfx && GM.Gfx.low();
    const dpr = window.devicePixelRatio || 1;
    let pr = (low ? Math.min(dpr, 1) * 0.85 : Math.min(dpr, 1.5)) * S.renderScale;
    if (isMain) pr *= dyn;
    else pr *= low ? 0.75 : 0.9;
    const pw = Math.max(2, Math.round(w * pr)), ph = Math.max(2, Math.round(h * pr));
    const samples = low ? 0 : caps.maxSamples;
    const prev = slots[slot];
    const s = ensureSlot(slot, pw, ph, !!isMain, samples);
    const reuse = refresh === false && prev === s && s.drawn;

    const prevAuto = renderer.autoClear;
    const prevScissor = renderer.getScissorTest();
    renderer.autoClear = true;
    Post.currentMain = !!isMain;     // lets onBeforeRender hooks (grass) pick their level of detail

    // 1. scene -> HDR target (layer 0); level of detail follows this camera
    camera.layers.set(0);
    if (!reuse) {
      if (GM.World && typeof GM.World.prepareView === 'function') GM.World.prepareView(camera);
      renderer.setRenderTarget(s.scene);
      renderer.render(scene, camera);
      s.drawn = true;
    }

    const full = isMain && !low;
    if (full) {
      // 2. SSAO
      if (S.ao > 0.01) {
        const u = mAO.uniforms;
        u.tDepth.value = s.scene.depthTexture;
        u.uProj.value.copy(camera.projectionMatrix);
        u.uInvProj.value.copy(camera.projectionMatrixInverse);
        u.uTexel.value.set(1 / pw, 1 / ph);
        u.uP.value.set(S.aoRadius, 0.6, 1.25, (frameNo % 8) * 0.785);
        pass(mAO, s.aoA);
        const b = mBlur.uniforms;
        b.tDepth.value = s.scene.depthTexture;
        b.uCam.value.set(camera.near, camera.far);
        b.tSrc.value = s.aoA.texture;
        b.uDir.value.set(1 / s.aoA.width, 0);
        pass(mBlur, s.aoB);
        b.tSrc.value = s.aoB.texture;
        b.uDir.value.set(0, 1 / s.aoA.height);
        pass(mBlur, s.aoA);
      }
      // 2b. depth of field (close-ups)
      if (S.dof > 0.01) {
        const d = mDof.uniforms;
        d.tColor.value = s.scene.texture;
        d.tDepth.value = s.scene.depthTexture;
        d.uCam.value.set(camera.near, camera.far);
        d.uDof.value.set(S.dofFocus, Math.max(1, S.dofRange), 0.016 * S.dof, pw / ph);
        pass(mDof, s.dofT);
      }
      // 3. bloom
      const chain = s.bloom;
      if (chain.length && S.bloom > 0.001) {
        const d = mDown.uniforms;
        let src = s.scene.texture, sw = pw, sh = ph;
        for (let k = 0; k < chain.length; k++) {
          d.tSrc.value = src;
          d.uTexel.value.set(1 / sw, 1 / sh);
          d.uThresh.value.set(S.bloomThreshold, S.bloomKnee, k === 0 ? 1 : 0, 0);
          pass(mDown, chain[k]);
          src = chain[k].texture; sw = chain[k].width; sh = chain[k].height;
        }
        renderer.autoClear = false;
        const u = mUp.uniforms;
        for (let k = chain.length - 1; k > 0; k--) {
          u.tSrc.value = chain[k].texture;
          u.uTexel.value.set(1 / chain[k].width, 1 / chain[k].height);
          u.uWeight.value = S.bloomRadius;
          pass(mUp, chain[k - 1]);
        }
        renderer.autoClear = true;
      }
      // 4. sun shafts
      let raysOn = false;
      if (S.rays > 0.01) {
        _sun.copy(S.sunDir).normalize().multiplyScalar(1000).add(camera.position);
        _ndc.copy(_sun).project(camera);
        const cz = _ndc.z;
        const sx = _ndc.x * 0.5 + 0.5, sy = _ndc.y * 0.5 + 0.5;
        const edge = Math.max(Math.abs(_ndc.x), Math.abs(_ndc.y));
        const vis = cz < 1 && cz > -1 ? 1 - smooth(1.0, 1.6, edge) : 0;
        if (vis > 0.01) {
          raysOn = true;
          const m = mRayMask.uniforms;
          m.tColor.value = s.scene.texture;
          m.tDepth.value = s.scene.depthTexture;
          m.uSun.value.set(sx, sy);
          m.uAspect.value = pw / ph;
          pass(mRayMask, s.rayA);
          const rb = mRayBlur.uniforms;
          rb.uSun.value.set(sx, sy);
          rb.tSrc.value = s.rayA.texture;
          rb.uStep.value = 0.9;
          pass(mRayBlur, s.rayB);
          rb.tSrc.value = s.rayB.texture;
          rb.uStep.value = 0.3;
          pass(mRayBlur, s.rayA);
          const k = S.rays * vis;
          mCompMain.uniforms.uRaysCol.value.set(S.raysColor[0] * k, S.raysColor[1] * k, S.raysColor[2] * k);
        }
      }
      if (!raysOn) mCompMain.uniforms.uRaysCol.value.set(0, 0, 0);
    }

    // 5. composite into the canvas rectangle (also writes depth)
    const comp = full ? mCompMain : mCompFeed;
    const cu = comp.uniforms;
    cu.tColor.value = s.scene.texture;
    cu.tDepth.value = s.scene.depthTexture;
    if (full) {
      cu.tBloom.value = s.bloom.length ? s.bloom[0].texture : s.scene.texture;
      cu.tAO.value = s.aoA ? s.aoA.texture : null;
      cu.tRays.value = s.rayA ? s.rayA.texture : null;
      cu.tDof.value = s.dofT ? s.dofT.texture : null;
      cu.uDofCam.value.set(camera.near, camera.far);
      cu.uDofP.value.set(S.dofFocus, Math.max(1, S.dofRange), 0, S.dof > 0.01 ? S.dof : 0);
    }
    const aoK = full && S.ao > 0.01 ? S.ao : 0;
    cu.uP1.value.set(S.exposure, full && s.bloom.length ? S.bloom : 0, aoK, isMain ? S.vignette : S.vignette * 1.3);
    cu.uP2.value.set(isMain ? S.grain : S.feedGrain, isMain && !low ? S.ca : 0, S.saturation, S.contrast);
    cu.uShadowTint.value.fromArray(S.shadowTint);
    cu.uHighTint.value.fromArray(S.highTint);
    cu.uTexel.value.set(1 / pw, 1 / ph);
    cu.uTime.value = st.realTime || 0;
    renderer.setRenderTarget(null);
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    renderer.setScissorTest(true);
    quad.material = comp;
    renderer.render(quadScene, quadCam);

    // 6. overlay (layer 1): crisp, depth tested against the scene
    camera.layers.set(Post.OVERLAY);
    renderer.autoClear = false;
    renderer.render(scene, camera);
    camera.layers.set(0);
    renderer.autoClear = prevAuto;
    renderer.setScissorTest(prevScissor);
  };

  function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

  /** Fallback: plain render into the rectangle (no post). */
  function direct(scene, camera, x, y, w, h) {
    const r = renderer || (GM.World && GM.World.renderer);
    if (!r) return;
    camera.layers.enableAll();
    if (GM.World && typeof GM.World.prepareView === 'function') GM.World.prepareView(camera);
    r.setRenderTarget(null);
    r.setViewport(x, y, w, h);
    r.setScissor(x, y, w, h);
    r.setScissorTest(true);
    r.render(scene, camera);
    camera.layers.set(0);
  }

  /** Put an object (and its children) on the overlay layer. */
  Post.toOverlay = function (obj) {
    if (!obj) return obj;
    obj.traverse(function (o) { o.layers.set(Post.OVERLAY); });
    return obj;
  };

  /** Current dynamic resolution factor of the main view (debug). */
  Post.stats = function () {
    const s = slots[0];
    return { dyn, frameMs: emaDt * 1000, main: s ? [s.w, s.h, s.samples] : null, caps };
  };
})();
