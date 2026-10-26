/* ==========================================================================
 * beasts.js — Studio creatures released by the Showrunner.
 *
 *   GM.Beasts.list                          same array as GM.state.beasts
 *   GM.Beasts.spawn(type, x, z, count) -> [beast]    'wolf' | 'wasps'
 *   GM.Beasts.damage(m, amount, attacker) -> damage done
 *   GM.Beasts.nearest(pos, maxDist) -> beast | null  (living)
 *   GM.Beasts.inRadius(pos, r) -> [beast]            (living)
 *
 * Wolves: low-poly quadrupeds with glowing eyes. They rise out of the ground,
 *   hunt as a pack (shared target, surround from different sides, bite with a
 *   lunge), cannot swim (they wait at the shore), avoid fire, sink back into
 *   the ground after 90 s. Killable by contestants.
 * Wasps (killer wasps): a nest breaks open and swarms of tiny instanced
 *   wasps chase contestants, sting (4 dmg + 'stung' hallucinations) and lose the
 *   trail when the victim dives into deep water. Weapons cannot hurt them;
 *   fire, poison gas, lightning and explosions can.
 *
 * Owner: SHOWRUNNER.
 * ========================================================================== */
(function () {
  'use strict';
  const GM = window.GM;
  const CFG = GM.CFG;
  const U = GM.U;
  const TAU = Math.PI * 2;

  GM.i18n.add({
    en: {
      'beast.wolf': 'Wolf beast',
      'beast.wolves': 'Wolf beasts',
      'beast.wasps': 'Killer wasps',
      'beast.swarm': 'Killer wasp swarm',
      'beast.nest': 'Killer wasp nest',
      'beast.interest.wolves': 'Beasts hunt {name}',
      'beast.interest.pack': 'Beast pack',
      'beast.interest.wasps': 'Killer wasps chase {name}',
      'beast.interest.swarm': 'Killer wasp swarm',
      'beast.interest.killed': '{name} killed a beast',
      'beast.interest.spawn': 'Beasts come out of the ground',
      'log.hazard.beastAttack': 'Beasts attack {name}!',
      'log.hazard.beastKilled': '{name} killed a wolf beast.',
      'log.hazard.beastsGone': 'The beasts went back into the ground.',
      'log.hazard.beastsWaiting': 'The beasts wait at the water for {name}.',
      'log.hazard.stung': 'Killer wasps stung {name}.',
      'log.hazard.waspsLost': '{name} escaped the killer wasps in the water.',
      'log.hazard.waspsGone': 'The killer wasps flew away.',
      'log.hazard.waspsBurned': 'The fire killed a killer wasp swarm.',
    },
    hu: {
      'beast.wolf': 'Farkasfenevad',
      'beast.wolves': 'Farkasfenevadak',
      'beast.wasps': 'Gyilkosdarazsak',
      'beast.swarm': 'Gyilkosdarázsraj',
      'beast.nest': 'Gyilkosdarázsfészek',
      'beast.interest.wolves': 'Fenevadak vadásznak rá: {name}',
      'beast.interest.pack': 'Fenevadfalka',
      'beast.interest.wasps': 'Gyilkosdarazsak üldözik: {name}',
      'beast.interest.swarm': 'Gyilkosdarázsraj',
      'beast.interest.killed': 'Fenevadat ölt: {name}',
      'beast.interest.spawn': 'Fenevadak bújnak elő a földből',
      'log.hazard.beastAttack': 'Fenevadak támadnak! Célpont: {name}.',
      'log.hazard.beastKilled': 'Megölt egy farkasfenevadat: {name}.',
      'log.hazard.beastsGone': 'A fenevadak visszabújtak a földbe.',
      'log.hazard.beastsWaiting': 'A fenevadak a parton várnak rá: {name}.',
      'log.hazard.stung': 'Gyilkosdarazsak csípték meg: {name}.',
      'log.hazard.waspsLost': 'A vízben menekült el a gyilkosdarazsak elől: {name}.',
      'log.hazard.waspsGone': 'A gyilkosdarazsak elrepültek.',
      'log.hazard.waspsBurned': 'A tűz megölt egy gyilkosdarázsrajt.',
    },
  });

  const THREE = window.THREE;
  if (!THREE) return;

  const Beasts = (GM.Beasts = {});
  Object.defineProperty(Beasts, 'list', {
    enumerable: true,
    get: function () { return GM.state.beasts; },
  });

  // ------------------------------------------------------------- constants
  const WOLF_HP = 60;
  const WOLF_SPEED = 7;
  const WOLF_BITE = 12;
  const WOLF_BITE_CD = 1;
  const WOLF_LIFE = 90;
  const WOLF_RADIUS = 0.6;
  const WOLF_SCALE = 1.2;
  const WASP_SPEED = 8;
  const WASP_STING = 4;
  const WASP_STING_CD = 0.8;
  const WASP_LIFE = 40;
  const WASP_HP = 45;
  const MAX_SWARMS = 12;
  const WASPS_HIGH = 36;
  const WASPS_LOW = 18;
  const WASP_CAP = MAX_SWARMS * WASPS_HIGH;
  const NEST_MAX = 4;
  const NOOP = function () {};

  // ------------------------------------------------------------------ state
  let beastUid = 1000;
  let packUid = 0;
  const packs = [];                  // wolf packs {id, members, targetId, ...}
  const nests = [];                  // decorative nests
  let visualTime = 0;
  let built = false;

  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _m = new THREE.Matrix4();
  const UP = new THREE.Vector3(0, 1, 0);

  // -------------------------------------------------------- module helpers
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
  function isBurning(x, z) {
    const H = GM.Hazards;
    return !!(H && typeof H.isBurning === 'function' && H.isBurning(x, z));
  }
  function isNight() {
    const E = GM.Env;
    try { return !!(E && E.isNight && E.isNight()); } catch (e) { return false; }
  }
  function moveFactor() {
    const E = GM.Env;
    if (E && E.moveFactor) {
      const f = E.moveFactor();
      if (f === f && f > 0) return f;
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
    try { F[method](a, b, c, d, e); } catch (err) { GM.reportError('Beasts.FX.' + method, err); }
  }
  function sfx(name, pos, volume, rate) {
    const A = GM.Audio;
    if (!A || typeof A.play !== 'function') return;
    try { A.play(name, { pos: pos, volume: volume == null ? 1 : volume, rate: rate || 1 }); } catch (err) { GM.reportError('Beasts.audio', err); }
  }
  function aiNoise(pos, radius, kind) {
    const AI = GM.AI;
    if (!AI || typeof AI.noise !== 'function') return;
    try { AI.noise(pos, radius, kind, null); } catch (err) { GM.reportError('Beasts.noise', err); }
  }
  function interest(o) {
    try { GM.addInterest(o); } catch (err) { GM.reportError('Beasts.interest', err); }
  }
  function tribCall(method, a, b, c, d) {
    const Tr = GM.Contestants;
    if (!Tr || typeof Tr[method] !== 'function') return;
    try { Tr[method](a, b, c, d); } catch (err) { GM.reportError('Beasts.Contestants.' + method, err); }
  }
  function hurtContestant(t, amount, cause, m) {
    const Tr = GM.Contestants;
    if (!Tr || typeof Tr.damage !== 'function' || !t || !t.alive) return 0;
    try {
      return Tr.damage(t, amount, { cause: cause, attacker: null, beast: m, weapon: null, pos: m.pos }) || 0;
    } catch (err) {
      GM.reportError('Beasts.damageContestant', err);
      return 0;
    }
  }
  function sting(t) {
    const AI = GM.AI;
    try {
      if (AI && typeof AI.applyStatus === 'function') AI.applyStatus(t, 'stung', 15);
      else tribCall('setStatus', t, 'stung', 15);
    } catch (err) { GM.reportError('Beasts.sting', err); }
  }
  function scene() { return GM.World && GM.World.scene ? GM.World.scene : null; }
  function noPick(obj) {
    obj.traverse(function (o) { o.raycast = NOOP; });
    return obj;
  }
  function P3(x, y, z) { return { x: x, y: y, z: z }; }
  function contestantInDeepWater(t) {
    if (t.swimming) return true;
    return waterDepthAt(t.pos.x, t.pos.z) > 1.0;
  }

  // =============================================================== MESHES
  /** Merge simple geometries (with transforms) into one non-indexed geometry. */
  function mergeParts(parts) {
    const e = new THREE.Euler();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const m = new THREE.Matrix4();
    const geos = [];
    let total = 0;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const g = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone();
      e.set(part.rx || 0, part.ry || 0, part.rz || 0);
      q.setFromEuler(e);
      p.set(part.x || 0, part.y || 0, part.z || 0);
      s.set(part.sx || 1, part.sy || 1, part.sz || 1);
      m.compose(p, q, s);
      g.applyMatrix4(m);
      geos.push(g);
      total += g.getAttribute('position').count;
      part.geo.dispose();
    }
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    let o = 0;
    for (let i = 0; i < geos.length; i++) {
      const g = geos[i];
      const pa = g.getAttribute('position');
      const na = g.getAttribute('normal');
      pos.set(pa.array.subarray(0, pa.count * 3), o * 3);
      if (na) nor.set(na.array.subarray(0, na.count * 3), o * 3);
      o += pa.count;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.computeBoundingSphere();
    return out;
  }

  let wolfBodyGeo, wolfHeadGeo, wolfEyesGeo, wolfLegGeo;
  let furMats = [], hitMat, eyeMat;
  let waspMesh = null, hazeMat = null, glowTex = null;
  let nestGeo = null, nestMat = null;
  const wolfPool = [];
  const hazeSprites = [];
  const swarmSlots = new Array(MAX_SWARMS).fill(null);
  // per-wasp orbit parameters (static)
  const wPhase = new Float32Array(WASP_CAP), wSpeed = new Float32Array(WASP_CAP), wRad = new Float32Array(WASP_CAP);
  const wVf = new Float32Array(WASP_CAP), wYo = new Float32Array(WASP_CAP);

  function makeGlowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.5)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  function buildVisuals() {
    const sc = scene();
    if (built || !sc) return;
    built = true;
    glowTex = makeGlowTexture();

    // --- wolf parts (model faces +Z, feet at y = 0)
    wolfBodyGeo = mergeParts([
      { geo: new THREE.CylinderGeometry(0.26, 0.22, 1.0, 6), x: 0, y: 0.86, z: -0.02, rx: Math.PI / 2 },
      { geo: new THREE.SphereGeometry(0.31, 7, 5), x: 0, y: 0.9, z: 0.42, sy: 1.1, sz: 1.1 },
      { geo: new THREE.SphereGeometry(0.26, 7, 5), x: 0, y: 0.86, z: -0.46 },
      { geo: new THREE.CylinderGeometry(0.15, 0.2, 0.44, 6), x: 0, y: 1.06, z: 0.62, rx: 0.9 },
      { geo: new THREE.DodecahedronGeometry(0.25, 0), x: 0, y: 1.08, z: 0.3, sx: 1, sy: 0.75, sz: 1.5 },
      { geo: new THREE.ConeGeometry(0.1, 0.78, 5), x: 0, y: 0.92, z: -0.86, rx: -2.2 },
    ]);
    wolfHeadGeo = mergeParts([
      { geo: new THREE.BoxGeometry(0.32, 0.28, 0.34), x: 0, y: 0.02, z: 0.08 },
      { geo: new THREE.BoxGeometry(0.17, 0.15, 0.34), x: 0, y: -0.05, z: 0.38 },
      { geo: new THREE.BoxGeometry(0.14, 0.06, 0.28), x: 0, y: -0.15, z: 0.33 },
      { geo: new THREE.ConeGeometry(0.075, 0.2, 4), x: 0.1, y: 0.22, z: 0.0, rz: -0.2 },
      { geo: new THREE.ConeGeometry(0.075, 0.2, 4), x: -0.1, y: 0.22, z: 0.0, rz: 0.2 },
    ]);
    wolfEyesGeo = mergeParts([
      { geo: new THREE.SphereGeometry(0.042, 6, 4), x: 0.095, y: 0.06, z: 0.255 },
      { geo: new THREE.SphereGeometry(0.042, 6, 4), x: -0.095, y: 0.06, z: 0.255 },
    ]);
    wolfLegGeo = mergeParts([
      { geo: new THREE.CylinderGeometry(0.075, 0.06, 0.46, 5), x: 0, y: -0.22, z: 0 },
      { geo: new THREE.CylinderGeometry(0.055, 0.045, 0.4, 5), x: 0, y: -0.6, z: 0.03 },
      { geo: new THREE.BoxGeometry(0.11, 0.07, 0.17), x: 0, y: -0.8, z: 0.06 },
    ]);
    const furColors = [0x2d2a2c, 0x3a3230, 0x23262a];
    furMats = furColors.map(function (c) {
      return new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, metalness: 0, flatShading: true });
    });
    hitMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff3322, emissiveIntensity: 0.7, roughness: 0.8, flatShading: true });
    eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2a10, fog: false });
    eyeMat.color.multiplyScalar(6);           // HDR: glowing eyes bloom

    // --- wasps: one instanced mesh for every swarm
    const waspGeo = mergeParts([
      { geo: new THREE.OctahedronGeometry(0.06, 0), sz: 1.8 },
      { geo: new THREE.OctahedronGeometry(0.035, 0), z: 0.1 },
    ]);
    const waspMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    waspMesh = new THREE.InstancedMesh(waspGeo, waspMat, WASP_CAP);
    waspMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const yellow = new THREE.Color(0xffc814), black = new THREE.Color(0x161410);
    for (let i = 0; i < WASP_CAP; i++) {
      waspMesh.setColorAt(i, (i % 5) < 3 ? yellow : black);
      wPhase[i] = Math.random() * TAU;
      wSpeed[i] = (Math.random() < 0.5 ? -1 : 1) * (2.5 + Math.random() * 4);
      wRad[i] = 0.4 + Math.random() * 1.4;
      wVf[i] = 2 + Math.random() * 5;
      wYo[i] = (Math.random() - 0.5) * 1.2;
    }
    if (waspMesh.instanceColor) waspMesh.instanceColor.needsUpdate = true;
    waspMesh.count = 0;
    waspMesh.frustumCulled = false;
    waspMesh.name = 'beasts-wasps';
    sc.add(noPick(waspMesh));

    hazeMat = new THREE.SpriteMaterial({ map: glowTex, color: 0x3a2f0c, transparent: true, opacity: 0.28, depthWrite: false });
    for (let i = 0; i < MAX_SWARMS; i++) {
      const sp = new THREE.Sprite(hazeMat);
      sp.scale.set(5, 4, 1);
      sp.visible = false;
      noPick(sp);
      sc.add(sp);
      hazeSprites.push(sp);
    }

    // --- killer wasp nests (lumpy paper ball, cracks open)
    const ico = new THREE.IcosahedronGeometry(0.8, 1);
    const pa = ico.getAttribute('position');
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      const k = 1 + 0.22 * Math.sin(x * 9.1 + y * 5.3) * Math.cos(z * 7.7 - y * 3.1);
      pa.setXYZ(i, x * k, y * k * 1.35, z * k);
    }
    ico.computeVertexNormals();
    nestGeo = ico;
    nestMat = new THREE.MeshStandardMaterial({ color: 0x9c8e70, roughness: 1, metalness: 0, flatShading: true });
    for (let i = 0; i < NEST_MAX; i++) {
      const mesh = new THREE.Mesh(nestGeo, nestMat);
      mesh.visible = false;
      mesh.castShadow = true;
      noPick(mesh);
      sc.add(mesh);
      nests.push({ mesh: mesh, active: false, x: 0, z: 0, y: 0, t: 0, life: 0, burst: false });
    }
  }

  function makeWolfVisual() {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const bodyMesh = new THREE.Mesh(wolfBodyGeo, furMats[0]);
    body.add(bodyMesh);
    const headPivot = new THREE.Group();
    headPivot.position.set(0, 1.18, 0.78);
    const head = new THREE.Mesh(wolfHeadGeo, furMats[0]);
    const eyes = new THREE.Mesh(wolfEyesGeo, eyeMat);
    headPivot.add(head, eyes);
    body.add(headPivot);
    const legs = [];
    const LEG_POS = [[0.15, 0.82, 0.42], [-0.15, 0.82, 0.42], [0.15, 0.82, -0.44], [-0.15, 0.82, -0.44]];
    for (let i = 0; i < 4; i++) {
      const leg = new THREE.Mesh(wolfLegGeo, furMats[0]);
      leg.position.set(LEG_POS[i][0], LEG_POS[i][1], LEG_POS[i][2]);
      body.add(leg);
      legs.push(leg);
    }
    noPick(root);
    return { root: root, body: body, bodyMesh: bodyMesh, head: head, headPivot: headPivot, eyes: eyes, legs: legs, fur: furMats[0] };
  }

  function acquireWolfVisual(furIndex, scale) {
    const sc = scene();
    if (!built || !sc) return null;
    const v = wolfPool.length ? wolfPool.pop() : makeWolfVisual();
    const fur = furMats[furIndex % furMats.length];
    v.fur = fur;
    setWolfMaterial(v, fur);
    v.root.scale.setScalar(scale);
    v.root.rotation.set(0, 0, 0);
    v.body.position.set(0, 0, 0);
    v.body.rotation.set(0, 0, 0);
    v.headPivot.rotation.set(0, 0, 0);
    const shadows = !isLow();
    v.bodyMesh.castShadow = shadows;
    v.head.castShadow = shadows;
    for (let i = 0; i < 4; i++) { v.legs[i].castShadow = shadows; v.legs[i].rotation.set(0, 0, 0); }
    v.root.visible = true;
    sc.add(v.root);
    return v;
  }
  function setWolfMaterial(v, mat) {
    v.bodyMesh.material = mat;
    v.head.material = mat;
    for (let i = 0; i < 4; i++) v.legs[i].material = mat;
  }
  function releaseWolfVisual(v) {
    if (!v) return;
    if (v.root.parent) v.root.parent.remove(v.root);
    v.root.visible = false;
    wolfPool.push(v);
  }

  // ================================================================ SPAWN
  /**
   * Spawn beasts around (x, z).
   *   'wolf'  -> `count` wolves forming one pack (default 4)
   *   'wasps' -> `count` swarms from one nest (default 2)
   * Returns the new beast objects.
   */
  function spawn(type, x, z, count) {
    buildVisuals();
    x = +x || 0; z = +z || 0;
    const d = Math.sqrt(x * x + z * z);
    const maxR = CFG.ARENA_RADIUS - 6;
    if (d > maxR) { x *= maxR / d; z *= maxR / d; }
    if (type === 'wasps' || type === 'wasp') return spawnWasps(x, z, count == null ? 2 : Math.max(1, count | 0));
    return spawnWolves(x, z, count == null ? 4 : Math.max(1, count | 0));
  }

  function spawnWolves(x, z, count) {
    const st = GM.state;
    const now = st.time;
    const pack = {
      id: ++packUid,
      type: 'wolf',
      members: [],
      targetId: null,
      retarget: 0,
      howl: 4 + GM.R.random() * 4,
      cx: x, cz: z,
      hx: x, hz: z,
      attacked: new Set(),
      waitLogged: new Set(),
      alive: count,
      gone: false,
    };
    packs.push(pack);
    const out = [];
    const base = GM.R.angle();
    for (let i = 0; i < count; i++) {
      const a = base + (i / count) * TAU;
      let px = x + Math.sin(a) * (2.5 + GM.R.random() * 2);
      let pz = z + Math.cos(a) * (2.5 + GM.R.random() * 2);
      if (waterDepthAt(px, pz) > 0.7 || !inArena(px, pz, 3)) { px = x; pz = z; }
      const scale = WOLF_SCALE * (0.9 + GM.R.random() * 0.25);
      const m = {
        kind: 'beast',
        type: 'wolf',
        id: ++beastUid,
        pos: new THREE.Vector3(px, groundY(px, pz), pz),
        vel: new THREE.Vector3(),
        heading: a + Math.PI,
        alive: true,
        health: WOLF_HP,
        maxHealth: WOLF_HP,
        radius: WOLF_RADIUS,
        targetId: null,
        expires: now + WOLF_LIFE + GM.R.random() * 4,
        mesh: null,
        packId: pack.id,
        slot: i,
        state: 'rise',
        stateT: -i * 0.18,
        speed: 0,
        biteCd: 0.5,
        lunge: 0,
        runPhase: GM.R.random() * TAU,
        hitFlash: 0,
        growlCd: 0,
        aggroId: null,
        aggroUntil: 0,
        scale: scale,
        side: GM.R.chance(0.5) ? 1 : -1,
        visual: null,
      };
      const v = acquireWolfVisual(i, scale);
      if (v) {
        m.visual = v;
        m.mesh = v.root;
        v.root.position.set(px, m.pos.y - 1.6, pz);
        v.root.rotation.y = m.heading;
      }
      pack.members.push(m);
      st.beasts.push(m);
      out.push(m);
      GM.emit('beast:spawned', { beast: m });
    }
    const y = groundY(x, z);
    const P = P3(x, y, z);
    fx('burst', P3(x, y + 0.4, z), { count: isLow() ? 16 : 34, color: 0x3a2c20, color2: 0x1a1410, speed: 5, spread: 3, up: 4, gravity: -6, size: 0.5, life: 1.6, additive: false });
    fx('burst', P3(x, y + 0.6, z), { count: 14, color: 0x1a1212, color2: 0x442222, speed: 1.5, spread: 3, up: 2.5, gravity: 0.6, size: 2.4, life: 2.6, additive: false });
    fx('flash', P3(x, y + 2, z), 0xff2a10, 3, 30, 0.5);
    fx('ring', P3(x, y + 0.3, z), 0x8a1a10, 9, 0.9);
    sfx('howl', P, 1);
    aiNoise(P, 90, 'scream');
    interest({ pos: P, score: 8, duration: 6, kind: 'beast', key: 'pack:' + pack.id, label: { key: 'beast.interest.spawn' } });
    retargetPack(pack);
    return out;
  }

  function spawnWasps(x, z, count) {
    const st = GM.state;
    const now = st.time;
    const out = [];
    const y = groundY(x, z);
    // nest visual
    let nest = null;
    for (let i = 0; i < nests.length; i++) if (!nests[i].active) { nest = nests[i]; break; }
    if (nest) {
      nest.active = true;
      nest.x = x; nest.z = z; nest.y = Math.max(y, waterY()) + 0.8;
      nest.t = 0;
      nest.life = WASP_LIFE + 4;
      nest.burst = false;
      nest.mesh.visible = true;
      nest.mesh.position.set(x, nest.y, z);
      nest.mesh.scale.setScalar(0.01);
      nest.mesh.rotation.set(0, GM.R.angle(), 0);
    }
    for (let i = 0; i < count; i++) {
      let slot = -1;
      for (let s = 0; s < MAX_SWARMS; s++) if (!swarmSlots[s]) { slot = s; break; }
      if (slot < 0) break;
      const a = GM.R.angle();
      const m = {
        kind: 'beast',
        type: 'wasps',
        id: ++beastUid,
        pos: new THREE.Vector3(x + Math.sin(a) * 0.5, Math.max(y, waterY()) + 1.2, z + Math.cos(a) * 0.5),
        vel: new THREE.Vector3(),
        heading: a,
        alive: true,
        health: WASP_HP,
        maxHealth: WASP_HP,
        radius: 1.4,
        targetId: null,
        expires: now + WASP_LIFE + GM.R.random() * 3,
        mesh: null,
        state: 'emerge',
        stateT: -i * 0.25,
        stingCd: 0.4,
        lostT: 0,
        ignoreId: null,
        ignoreUntil: 0,
        homeX: x, homeZ: z,
        stung: new Set(),
        lostLogged: new Set(),
        spread: 1.6,
        fade: 1,
        vslot: slot,
        buzzT: GM.R.random() * 1.2,
        retarget: 0,
        burned: false,
      };
      swarmSlots[slot] = m;
      if (hazeSprites[slot]) {
        m.mesh = hazeSprites[slot];
        hazeSprites[slot].visible = true;
      }
      st.beasts.push(m);
      out.push(m);
      GM.emit('beast:spawned', { beast: m });
    }
    const P = P3(x, y, z);
    sfx('buzz', P, 1);
    aiNoise(P, 40, 'scream');
    interest({ pos: P, score: 7, duration: 5, kind: 'beast', key: 'nest:' + x.toFixed(0) + ':' + z.toFixed(0), label: { key: 'beast.interest.swarm' } });
    return out;
  }

  // ================================================================ WOLVES
  function packById(id) {
    for (let i = 0; i < packs.length; i++) if (packs[i].id === id) return packs[i];
    return null;
  }

  function retargetPack(pack) {
    const st = GM.state;
    let cx = 0, cz = 0, n = 0;
    for (let i = 0; i < pack.members.length; i++) {
      const m = pack.members[i];
      if (!m.alive) continue;
      cx += m.pos.x; cz += m.pos.z; n++;
    }
    pack.alive = n;
    if (!n) return;
    cx /= n; cz /= n;
    pack.cx = cx; pack.cz = cz;
    const trs = st.contestants;
    let best = null, bestScore = Infinity;
    for (let k = 0; k < trs.length; k++) {
      const t = trs[k];
      if (!t || !t.alive || !t.pos) continue;
      const dx = t.pos.x - cx, dz = t.pos.z - cz;
      const d = Math.sqrt(dx * dx + dz * dz);
      let s = d;
      if (contestantInDeepWater(t)) s += 60;
      if (t.hidden && d > 14) s += 20;
      if ((t.health || 0) < 40) s -= 8;
      if (t.id === pack.targetId) s -= 6;
      for (let p = 0; p < packs.length; p++) {
        const o = packs[p];
        if (o !== pack && o.alive > 0 && o.targetId === t.id) s += 10;
      }
      if (s < bestScore) { bestScore = s; best = t; }
    }
    pack.targetId = best ? best.id : null;
  }

  function passable(x, z) {
    if (!inArena(x, z, 2)) return false;
    if (waterDepthAt(x, z) > 0.75) return false;
    if (isBurning(x, z)) return false;
    return true;
  }

  const TRY_ANGLES = [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, 2.6, -2.6];
  function steer(m, gx, gz, spd, dt) {
    const dx = gx - m.pos.x, dz = gz - m.pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.3) spd = 0;
    const want = dist > 0.01 ? Math.atan2(dx, dz) : m.heading;
    const diff = U.angleDiff(m.heading, want);
    const maxTurn = 7 * dt;
    m.heading = U.wrapAngle(m.heading + U.clamp(diff, -maxTurn, maxTurn));
    const target = spd * moveFactor() * (Math.abs(diff) > 1.6 ? 0.4 : 1);
    m.speed = U.damp(m.speed, target, 6, dt);
    if (m.speed < 0.02) { m.vel.set(0, 0, 0); return false; }
    const step = m.speed * dt;
    for (let k = 0; k < TRY_ANGLES.length; k++) {
      const h = m.heading + TRY_ANGLES[k];
      const nx = m.pos.x + Math.sin(h) * step, nz = m.pos.z + Math.cos(h) * step;
      if (passable(nx, nz)) {
        m.vel.set((nx - m.pos.x) / dt, 0, (nz - m.pos.z) / dt);
        m.pos.x = nx; m.pos.z = nz;
        if (k) m.heading = U.wrapAngle(m.heading + TRY_ANGLES[k] * 0.35);
        return true;
      }
    }
    m.speed *= 0.5;
    m.vel.set(0, 0, 0);
    return false;
  }

  function separate(m, list) {
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o === m || !o.alive || o.type !== 'wolf') continue;
      const dx = m.pos.x - o.pos.x, dz = m.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 1.44 && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (1.2 - d) * 0.5;
        const nx = m.pos.x + (dx / d) * push, nz = m.pos.z + (dz / d) * push;
        if (passable(nx, nz)) { m.pos.x = nx; m.pos.z = nz; }
      }
    }
  }

  function updatePack(pack, dt) {
    pack.retarget -= dt;
    if (pack.retarget <= 0) {
      pack.retarget = 0.6;
      retargetPack(pack);
    }
    if (pack.alive <= 0) return;
    const st = GM.state;
    pack.howl -= dt;
    if (pack.howl <= 0) {
      pack.howl = 18 + GM.R.random() * 10;
      sfx('howl', P3(pack.cx, groundY(pack.cx, pack.cz), pack.cz), 0.9);
    }
    const t = pack.targetId != null ? st.contestants[pack.targetId] : null;
    if (t && t.alive) {
      const dx = t.pos.x - pack.cx, dz = t.pos.z - pack.cz;
      if (dx * dx + dz * dz < 900) {
        interest({ pos: t.pos, score: 7, duration: 3, kind: 'beast', key: 'pack:' + pack.id, followId: t.id, label: { key: 'beast.interest.wolves', params: { name: t.name } } });
      }
    }
  }

  function updateWolf(m, dt) {
    const st = GM.state;
    const now = st.time;
    if (m.hitFlash > 0) m.hitFlash -= dt;
    if (m.lunge > 0) m.lunge -= dt;
    if (m.biteCd > 0) m.biteCd -= dt;
    if (m.growlCd > 0) m.growlCd -= dt;
    m.stateT += dt;

    if (m.state === 'rise') {
      if (m.stateT >= 1.1) { m.state = 'hunt'; m.stateT = 0; }
      m.pos.y = groundY(m.pos.x, m.pos.z);
      return;
    }
    if (m.state === 'dead') {
      if (m.stateT >= 6) m._remove = true;
      return;
    }
    if (m.state === 'leave') {
      if (m.stateT >= 1.8) m._remove = true;
      return;
    }
    // lifetime over (or the Show ended): sink back into the ground
    if (now >= m.expires || st.phase === 'ended') {
      beginLeave(m);
      return;
    }

    const pack = packById(m.packId);
    let tgt = null;
    if (m.aggroId != null && m.aggroUntil > now) {
      const a = st.contestants[m.aggroId];
      if (a && a.alive) tgt = a;
    }
    if (!tgt && pack && pack.targetId != null) {
      const a = st.contestants[pack.targetId];
      if (a && a.alive) tgt = a;
    }
    // opportunistic bite: someone right next to the wolf
    if (tgt) {
      const dx = tgt.pos.x - m.pos.x, dz = tgt.pos.z - m.pos.z;
      if (dx * dx + dz * dz > 36) {
        const trs = st.contestants;
        for (let k = 0; k < trs.length; k++) {
          const o = trs[k];
          if (!o || !o.alive || o === tgt) continue;
          const ox = o.pos.x - m.pos.x, oz = o.pos.z - m.pos.z;
          if (ox * ox + oz * oz < 9 && !contestantInDeepWater(o)) { tgt = o; break; }
        }
      }
    }
    m.targetId = tgt ? tgt.id : null;

    let gx, gz, spd;
    if (tgt) {
      const dx = tgt.pos.x - m.pos.x, dz = tgt.pos.z - m.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const inWater = contestantInDeepWater(tgt);
      if (d > 9 && pack) {
        // fan out and come from different sides
        const base = Math.atan2(pack.cx - tgt.pos.x, pack.cz - tgt.pos.z);
        const n = Math.max(1, pack.alive);
        const off = n > 1 ? (m.slot % n - (n - 1) / 2) * Math.min(1.3, 4.4 / n) : 0;
        const a = base + off;
        gx = tgt.pos.x + Math.sin(a) * 5.5;
        gz = tgt.pos.z + Math.cos(a) * 5.5;
        spd = WOLF_SPEED;
      } else {
        gx = tgt.pos.x;
        gz = tgt.pos.z;
        spd = d > 2.6 ? WOLF_SPEED : 3.2;
      }
      const reach = 1.3 + (tgt.radius || 0.45);
      if (d <= reach) {
        spd = 0;
        m.heading = U.lerpAngle(m.heading, Math.atan2(dx, dz), Math.min(1, dt * 12));
        if (m.biteCd <= 0 && !inWater) bite(m, tgt, dx, dz, d, pack);
      } else if (d < 1.2) spd = 0;
      if (inWater && pack && !pack.waitLogged.has(tgt.id) && d < 14) {
        pack.waitLogged.add(tgt.id);
        GM.log('hazard', 'log.hazard.beastsWaiting', { name: tgt.name }, { pos: tgt.pos, contestantIds: [tgt.id] });
        if (m.growlCd <= 0) { m.growlCd = 3; sfx('growl', m.pos, 0.8); }
      }
    } else if (pack) {
      // nobody to hunt: circle the pack's home
      const a = now * 0.25 + m.slot * 1.7;
      gx = pack.hx + Math.sin(a) * 8;
      gz = pack.hz + Math.cos(a) * 8;
      spd = 2.5;
    } else {
      gx = m.pos.x; gz = m.pos.z; spd = 0;
    }
    steer(m, gx, gz, spd, dt);
    separate(m, st.beasts);
    const gy = groundY(m.pos.x, m.pos.z);
    const wl = waterY();
    m.pos.y = gy < wl - 0.55 ? wl - 0.55 : gy;
    m.runPhase += dt * (1.2 + m.speed * 1.55);
  }

  function bite(m, t, dx, dz, d, pack) {
    m.biteCd = WOLF_BITE_CD + GM.R.random() * 0.3;
    m.lunge = 0.32;
    const dmg = WOLF_BITE * (isNight() ? 1.15 : 1);
    hurtContestant(t, dmg, 'beast', m);
    const y = t.pos.y + 1;
    fx('burst', P3(t.pos.x, y, t.pos.z), { count: 8, color: 0x7a0a0a, color2: 0x3a0404, speed: 3, spread: 0.3, up: 1.5, gravity: -9.8, size: 0.14, life: 0.6, additive: false });
    if (m.growlCd <= 0) {
      m.growlCd = 1.5 + GM.R.random();
      sfx('growl', m.pos, 1, 0.9 + GM.R.random() * 0.2);
    }
    if (t.alive && d > 0.05) tribCall('knockback', t, dx / d, dz / d, 1.2);
    interest({ pos: t.pos, score: 7, duration: 4, kind: 'beast', key: 'pack:' + (pack ? pack.id : m.id), followId: t.id, label: { key: 'beast.interest.wolves', params: { name: t.name } } });
    if (pack && !pack.attacked.has(t.id)) {
      pack.attacked.add(t.id);
      GM.log('hazard', 'log.hazard.beastAttack', { name: t.name }, { pos: t.pos, contestantIds: [t.id], important: true });
    }
  }

  function beginLeave(m) {
    if (m.state === 'leave' || m.state === 'dead') return;
    const wasAlive = m.alive;
    m.alive = false;
    m.state = 'leave';
    m.stateT = 0;
    m.speed = 0;
    if (m.type === 'wolf') {
      const y = groundY(m.pos.x, m.pos.z);
      fx('burst', P3(m.pos.x, y + 0.5, m.pos.z), { count: isLow() ? 6 : 12, color: 0x1a1414, color2: 0x3a2a2a, speed: 1.2, spread: 1, up: 1.8, gravity: 0.5, size: 1.6, life: 2, additive: false });
      const pack = packById(m.packId);
      if (pack) {
        let any = false;
        for (let i = 0; i < pack.members.length; i++) if (pack.members[i].alive) { any = true; break; }
        if (!any && !pack.gone) {
          pack.gone = true;
          pack.alive = 0;
          if (GM.state.phase === 'running') GM.log('hazard', 'log.hazard.beastsGone', {}, { pos: m.pos });
        }
      }
    } else if (wasAlive && !m.burned) {
      let any = false;
      const list = GM.state.beasts;
      for (let i = 0; i < list.length; i++) if (list[i].type === 'wasps' && list[i].alive) { any = true; break; }
      if (!any && GM.state.phase === 'running') GM.log('hazard', 'log.hazard.waspsGone', {}, { pos: m.pos });
    }
    if (wasAlive) GM.emit('beast:expired', { beast: m });
  }

  // ================================================================= WASPS
  function pickSwarmTarget(m) {
    const st = GM.state;
    const trs = st.contestants;
    const now = st.time;
    let best = null, bestScore = Infinity;
    for (let k = 0; k < trs.length; k++) {
      const t = trs[k];
      if (!t || !t.alive || !t.pos) continue;
      if (m.ignoreId === t.id && m.ignoreUntil > now) continue;
      if (contestantInDeepWater(t)) continue;
      const dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > 45) continue;
      let s = d;
      const list = st.beasts;
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (o !== m && o.alive && o.type === 'wasps' && o.targetId === t.id) s += 15;
      }
      if (t.id === m.targetId) s -= 5;
      if (s < bestScore) { bestScore = s; best = t; }
    }
    return best;
  }

  function updateSwarm(m, dt) {
    const st = GM.state;
    const now = st.time;
    m.stateT += dt;
    if (m.stingCd > 0) m.stingCd -= dt;
    if (m.state === 'leave') {
      m.fade = Math.max(0, 1 - m.stateT / 1.8);
      m.spread += dt * 3;
      m.pos.y += dt * 1.5;
      if (m.stateT >= 1.8) m._remove = true;
      return;
    }
    if (now >= m.expires || st.phase === 'ended') {
      beginLeave(m);
      return;
    }
    const wl = waterY();
    if (m.state === 'emerge') {
      m.spread = 0.5 + Math.max(0, m.stateT) * 1.5;
      m.pos.y += dt * 1.2;
      if (m.stateT >= 0.8) { m.state = 'seek'; m.stateT = 0; }
      return;
    }
    const rain = GM.Env && (GM.Env.weather === 'rain' || GM.Env.weather === 'storm') ? 0.75 : 1;
    const speed = WASP_SPEED * rain;
    let tgt = m.targetId != null ? st.contestants[m.targetId] : null;
    if (tgt && !tgt.alive) tgt = null;

    if (m.state === 'lost') {
      m.lostT -= dt;
      m.spread = U.damp(m.spread, 2.2, 2, dt);
      const a = now * 1.5 + m.id;
      moveSwarm(m, m.pos.x + Math.sin(a) * 2, m.pos.z + Math.cos(a) * 2, 2.5, dt, wl);
      if (m.lostT <= 0) { m.state = 'seek'; m.stateT = 0; m.targetId = null; }
      return;
    }

    m.retarget -= dt;
    if (m.state === 'seek' || !tgt || m.retarget <= 0) {
      m.retarget = 1;
      const nt = pickSwarmTarget(m);
      if (nt) {
        if (m.targetId !== nt.id) m.targetId = nt.id;
        tgt = nt;
        m.state = 'chase';
      } else if (!tgt) {
        m.state = 'seek';
        m.targetId = null;
      }
    }

    if (m.state === 'chase' && tgt) {
      if (contestantInDeepWater(tgt)) {
        // the victim dived: the swarm loses the trail
        m.state = 'lost';
        m.lostT = 3.5;
        m.ignoreId = tgt.id;
        m.ignoreUntil = now + 10;
        if (!m.lostLogged.has(tgt.id)) {
          m.lostLogged.add(tgt.id);
          GM.log('hazard', 'log.hazard.waspsLost', { name: tgt.name }, { pos: tgt.pos, contestantIds: [tgt.id] });
        }
        m.targetId = null;
        return;
      }
      const tx = tgt.pos.x, tz = tgt.pos.z;
      const dx = tx - m.pos.x, dz = tz - m.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      m.spread = U.damp(m.spread, d < 3 ? 0.95 : 1.5, 3, dt);
      moveSwarm(m, tx, tz, d > 1 ? speed : 3, dt, wl, tgt.pos.y + 1.3);
      if (d <= 2.4 && m.stingCd <= 0) {
        m.stingCd = WASP_STING_CD + GM.R.random() * 0.15;
        hurtContestant(tgt, WASP_STING, 'wasps', m);
        if (tgt.alive) sting(tgt);
        fx('burst', P3(tgt.pos.x, tgt.pos.y + 1.4, tgt.pos.z), { count: 4, color: 0xffd23a, color2: 0x7a0a0a, speed: 2, spread: 0.4, up: 0.5, gravity: -3, size: 0.1, life: 0.4, additive: false });
        if (!m.stung.has(tgt.id)) {
          m.stung.add(tgt.id);
          GM.log('hazard', 'log.hazard.stung', { name: tgt.name }, { pos: tgt.pos, contestantIds: [tgt.id], important: true });
          sfx('scream', tgt.pos, 0.7);
        }
      }
      if (d < 20) {
        interest({ pos: tgt.pos, score: 7, duration: 3, kind: 'beast', key: 'swarm:' + m.id, followId: tgt.id, label: { key: 'beast.interest.wasps', params: { name: tgt.name } } });
      }
    } else {
      // hover around the nest
      m.spread = U.damp(m.spread, 1.8, 2, dt);
      const a = now * 0.8 + m.id * 1.3;
      moveSwarm(m, m.homeX + Math.sin(a) * 4, m.homeZ + Math.cos(a) * 4, 3, dt, wl);
    }
  }

  function moveSwarm(m, gx, gz, speed, dt, wl, gyOverride) {
    const dx = gx - m.pos.x, dz = gz - m.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 0.05) {
      const step = Math.min(d, speed * dt);
      const wob = Math.sin(m.stateT * 3 + m.id) * 0.4;
      m.heading = Math.atan2(dx, dz);
      const nx = m.pos.x + (dx / d) * step + Math.cos(m.heading) * wob * dt;
      const nz = m.pos.z + (dz / d) * step - Math.sin(m.heading) * wob * dt;
      m.vel.set((nx - m.pos.x) / dt, 0, (nz - m.pos.z) / dt);
      m.pos.x = nx; m.pos.z = nz;
    } else m.vel.set(0, 0, 0);
    let gy = groundY(m.pos.x, m.pos.z);
    if (gy < wl) gy = wl;
    const ty = gyOverride != null ? Math.max(gyOverride, gy + 0.8) : gy + 1.5 + Math.sin(m.stateT * 1.7 + m.id) * 0.3;
    m.pos.y = U.damp(m.pos.y, ty, 5, dt);
  }

  // ================================================================ DAMAGE
  /** Damage a beast. Killer wasps ignore weapons (attacker set); hazards hurt everything. */
  function damage(m, amount, attacker) {
    if (!m || !m.alive || !(amount > 0)) return 0;
    if (m.type === 'wasps' && attacker) {
      fx('burst', P3(m.pos.x, m.pos.y, m.pos.z), { count: 3, color: 0xffc814, color2: 0x161410, speed: 3, spread: 0.6, up: 0.5, gravity: -2, size: 0.08, life: 0.3, additive: false });
      return 0;
    }
    const dealt = Math.min(m.health, amount);
    m.health -= amount;
    m.hitFlash = 0.14;
    if (m.type === 'wolf') {
      fx('burst', P3(m.pos.x, m.pos.y + 0.9, m.pos.z), { count: 6, color: 0x4a0808, color2: 0x220202, speed: 2.5, spread: 0.3, up: 1.2, gravity: -9.8, size: 0.13, life: 0.5, additive: false });
      if (attacker && attacker.kind === 'contestant' && attacker.alive) {
        m.aggroId = attacker.id;
        m.aggroUntil = GM.state.time + 6;
        if (m.growlCd <= 0) { m.growlCd = 1.2; sfx('growl', m.pos, 0.9, 1.1); }
      }
    }
    if (m.health <= 0) killBeast(m, attacker || null);
    return dealt;
  }

  function killBeast(m, attacker) {
    if (!m.alive) return;
    m.alive = false;
    m.health = 0;
    const killer = attacker && attacker.kind === 'contestant' ? attacker : null;
    if (m.type === 'wolf') {
      m.state = 'dead';
      m.stateT = 0;
      m.speed = 0;
      m.hitFlash = 0;
      sfx('growl', m.pos, 0.8, 0.6);
      fx('burst', P3(m.pos.x, m.pos.y + 0.6, m.pos.z), { count: 12, color: 0x4a0808, color2: 0x1a0202, speed: 3, spread: 0.6, up: 2, gravity: -9.8, size: 0.16, life: 0.8, additive: false });
      if (killer) {
        GM.log('combat', 'log.hazard.beastKilled', { name: killer.name }, { pos: m.pos, contestantIds: [killer.id], important: true });
        interest({ pos: m.pos, score: 6, duration: 5, kind: 'beast', key: 'beastkill:' + m.id, followId: killer.id, label: { key: 'beast.interest.killed', params: { name: killer.name } } });
      }
      const pack = packById(m.packId);
      if (pack) {
        let any = false;
        for (let i = 0; i < pack.members.length; i++) if (pack.members[i].alive) { any = true; break; }
        if (!any) { pack.gone = true; pack.alive = 0; }
      }
    } else {
      m.burned = true;
      m.state = 'leave';
      m.stateT = 0;
      fx('burst', P3(m.pos.x, m.pos.y, m.pos.z), { count: 20, color: 0x2a2208, color2: 0xffc814, speed: 2, spread: 1.2, up: 0.5, gravity: -6, size: 0.1, life: 1, additive: false });
      if (GM.state.phase === 'running') GM.log('hazard', 'log.hazard.waspsBurned', {}, { pos: m.pos });
    }
    GM.emit('beast:died', { beast: m, killer: killer });
  }

  function nearest(pos, maxDist) {
    if (!pos) return null;
    const list = GM.state.beasts;
    const md = maxDist == null ? Infinity : maxDist;
    let best = null, bd = md * md;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m.alive) continue;
      const dx = m.pos.x - pos.x, dz = m.pos.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d <= bd) { bd = d; best = m; }
    }
    return best;
  }

  function inRadius(pos, r) {
    const out = [];
    if (!pos) return out;
    const list = GM.state.beasts;
    const rr = r * r;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m.alive) continue;
      const dx = m.pos.x - pos.x, dz = m.pos.z - pos.z;
      if (dx * dx + dz * dz <= rr) out.push(m);
    }
    return out;
  }

  // ============================================================= VISUALS
  function drawWolf(m) {
    const v = m.visual;
    if (!v) return;
    const root = v.root;
    let y = m.pos.y;
    root.rotation.y = m.heading;
    const amp = U.clamp01(m.speed / WOLF_SPEED);
    const ph = m.runPhase;
    let roll = 0;
    if (m.state === 'rise') {
      const k = U.clamp01(m.stateT / 1.1);
      y -= (1 - k * k * (3 - 2 * k)) * 1.6 * m.scale;
    } else if (m.state === 'leave') {
      const k = U.clamp01(m.stateT / 1.8);
      y -= k * k * 1.8 * m.scale;
    } else if (m.state === 'dead') {
      roll = Math.min(1, m.stateT / 0.45) * (Math.PI / 2) * m.side;
      if (m.stateT > 3) y -= (m.stateT - 3) / 3 * 1.2 * m.scale;
    }
    root.position.set(m.pos.x, y, m.pos.z);
    root.rotation.z = roll;
    // gallop: front and back pairs in opposite phase
    const s1 = Math.sin(ph), s2 = Math.sin(ph + 0.4);
    const legAmp = m.state === 'dead' ? 0.15 : 0.15 + 0.85 * amp;
    v.legs[0].rotation.x = s1 * 0.9 * legAmp;
    v.legs[1].rotation.x = s2 * 0.9 * legAmp;
    v.legs[2].rotation.x = -s1 * 0.8 * legAmp;
    v.legs[3].rotation.x = -s2 * 0.8 * legAmp;
    const lungeK = m.lunge > 0 ? Math.sin((1 - m.lunge / 0.32) * Math.PI) : 0;
    v.body.position.y = Math.abs(Math.sin(ph)) * 0.09 * amp;
    v.body.position.z = lungeK * 0.35;
    v.body.rotation.x = Math.sin(ph * 2) * 0.05 * amp - lungeK * 0.12;
    const idle = m.state === 'hunt' && amp < 0.2 ? Math.sin(visualTime * 2 + m.id) * 0.08 : 0;
    v.headPivot.rotation.x = -0.12 + lungeK * 0.55 + idle + (m.state === 'dead' ? 0.4 : 0);
    const flash = m.hitFlash > 0 && m.state !== 'dead';
    const mat = flash ? hitMat : v.fur;
    if (v.bodyMesh.material !== mat) setWolfMaterial(v, mat);
    v.eyes.visible = m.state !== 'dead' || m.stateT < 0.5;
  }

  function drawWasps() {
    if (!waspMesh) return;
    const per = isLow() ? WASPS_LOW : WASPS_HIGH;
    let n = 0;
    for (let s = 0; s < MAX_SWARMS; s++) {
      const m = swarmSlots[s];
      const haze = hazeSprites[s];
      if (!m) { if (haze) haze.visible = false; continue; }
      const cx = m.pos.x, cy = m.pos.y, cz = m.pos.z;
      const spread = m.spread;
      const fade = m.fade;
      const scale = fade * (m.state === 'emerge' ? 0.6 + 0.4 * U.clamp01(m.stateT / 0.8) : 1);
      for (let k = 0; k < per; k++) {
        const i = s * WASPS_HIGH + k;
        const a = wPhase[i] + visualTime * wSpeed[i];
        const r = wRad[i] * spread;
        _p.set(
          cx + Math.sin(a) * r + Math.sin(visualTime * 23 + i) * 0.05,
          cy + wYo[i] * spread * 0.6 + Math.sin(visualTime * wVf[i] + wPhase[i]) * 0.35 * spread,
          cz + Math.cos(a) * r + Math.cos(visualTime * 19 + i) * 0.05
        );
        _q.setFromAxisAngle(UP, a + (wSpeed[i] > 0 ? Math.PI / 2 : -Math.PI / 2));
        _s.set(scale, scale, scale);
        _m.compose(_p, _q, _s);
        waspMesh.setMatrixAt(n++, _m);
      }
      if (haze) {
        haze.visible = true;
        haze.position.set(cx, cy, cz);
        const hs = (2.5 + spread * 2.2) * Math.max(0.2, fade);
        haze.scale.set(hs, hs * 0.8, 1);
      }
    }
    waspMesh.count = n;
    if (n > 0) waspMesh.instanceMatrix.needsUpdate = true;
  }

  function updateNests(dt) {
    for (let i = 0; i < nests.length; i++) {
      const n = nests[i];
      if (!n.active) continue;
      n.t += dt;
      if (!n.burst && n.t >= 0.6) {
        n.burst = true;
        fx('burst', P3(n.x, n.y + 0.4, n.z), { count: isLow() ? 14 : 30, color: 0xb8a882, color2: 0x6a5c40, speed: 5, spread: 0.6, up: 4, gravity: -9.8, size: 0.2, life: 1.2, additive: false });
        fx('burst', P3(n.x, n.y + 0.6, n.z), { count: 18, color: 0xffc814, color2: 0x161410, speed: 4, spread: 0.8, up: 2, gravity: -1, size: 0.09, life: 0.9, additive: false });
        sfx('buzz', P3(n.x, n.y, n.z), 1, 1.2);
      }
      if (n.t >= n.life) {
        n.active = false;
        n.mesh.visible = false;
      }
    }
  }

  function drawNests() {
    for (let i = 0; i < nests.length; i++) {
      const n = nests[i];
      if (!n.active) continue;
      let s;
      if (n.t < 0.6) {
        // pop in and shake
        s = Math.min(1, n.t / 0.25);
        n.mesh.rotation.z = Math.sin(visualTime * 40) * 0.12 * (n.t / 0.6);
      } else {
        s = 0.72; // broken shell
        n.mesh.rotation.z = 0.35;
      }
      let y = n.y;
      const left = n.life - n.t;
      if (left < 2) y -= (2 - left) * 0.6;
      n.mesh.position.set(n.x, y, n.z);
      n.mesh.scale.set(s, s * (n.t < 0.6 ? 1 : 0.7), s);
    }
  }

  // ============================================================ LIFECYCLE
  function removeBeast(m) {
    if (m.type === 'wolf') {
      releaseWolfVisual(m.visual);
      m.visual = null;
      m.mesh = null;
    } else {
      if (m.vslot >= 0 && swarmSlots[m.vslot] === m) swarmSlots[m.vslot] = null;
      if (hazeSprites[m.vslot]) hazeSprites[m.vslot].visible = false;
      m.mesh = null;
    }
  }

  function clearAll() {
    const list = GM.state.beasts;
    for (let i = 0; i < list.length; i++) removeBeast(list[i]);
    list.length = 0;
    packs.length = 0;
    for (let s = 0; s < MAX_SWARMS; s++) swarmSlots[s] = null;
    for (let i = 0; i < hazeSprites.length; i++) hazeSprites[i].visible = false;
    for (let i = 0; i < nests.length; i++) { nests[i].active = false; nests[i].mesh.visible = false; }
    if (waspMesh) waspMesh.count = 0;
  }

  GM.registerSystem({
    name: 'Beasts',
    order: 55,
    init() {
      buildVisuals();
      GM.on('game:end', function () {
        const list = GM.state.beasts;
        for (let i = 0; i < list.length; i++) if (list[i].alive) beginLeave(list[i]);
      });
    },
    clear() {
      clearAll();
    },
    reset() {
      buildVisuals();
      clearAll();
    },
    update(dt) {
      const st = GM.state;
      if (st.phase !== 'running' && st.phase !== 'ended') return;
      for (let i = 0; i < packs.length; i++) updatePack(packs[i], dt);
      const list = st.beasts;
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        if (m.type === 'wolf') updateWolf(m, dt);
        else updateSwarm(m, dt);
      }
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        if (m._remove) {
          removeBeast(m);
          list.splice(i, 1);
        }
      }
      // drop finished packs
      for (let i = packs.length - 1; i >= 0; i--) {
        const p = packs[i];
        let any = false;
        for (let k = 0; k < p.members.length; k++) {
          if (list.indexOf(p.members[k]) >= 0) { any = true; break; }
        }
        if (!any) packs.splice(i, 1);
      }
      updateNests(dt);
      // buzzing (sim-timed so it follows game speed but is throttled)
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        if (m.type !== 'wasps' || !m.alive) continue;
        m.buzzT -= dt;
        if (m.buzzT <= 0) {
          m.buzzT = 1.3 + GM.R.random() * 0.6;
          sfx('buzz', m.pos, 0.6);
        }
      }
    },
    frame(realDt) {
      if (!built) return;
      visualTime += realDt;
      const list = GM.state.beasts;
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        if (m.type === 'wolf') drawWolf(m);
      }
      drawWasps();
      drawNests();
    },
  });

  // ============================================================ PUBLIC API
  Beasts.spawn = spawn;
  Beasts.damage = damage;
  Beasts.nearest = nearest;
  Beasts.inRadius = inRadius;
  Beasts.packs = packs;
  /** Living beasts of a type ('wolf' | 'wasps' | undefined for all). */
  Beasts.count = function (type) {
    const list = GM.state.beasts;
    let n = 0;
    for (let i = 0; i < list.length; i++) if (list[i].alive && (!type || list[i].type === type)) n++;
    return n;
  };
  /** Is contestant t currently hunted by any beast? */
  Beasts.isHunted = function (t) {
    if (!t) return false;
    const list = GM.state.beasts;
    for (let i = 0; i < list.length; i++) if (list[i].alive && list[i].targetId === t.id) return true;
    return false;
  };
})();
