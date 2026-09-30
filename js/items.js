/* ==========================================================================
 * items.js — GM.ItemDefs + GM.Items: item table, ground loot, bundles
 * (backpacks, supply crates, sponsor gifts, feast crates) and hidden traps.
 *
 *   GM.ItemDefs[id]                 {id, kind, nameKey, icon, color, value, ...stats}
 *   GM.Items.list                   ground items (SPEC 7.5)
 *   GM.Items.spawn / remove / nearest / inRadius / value / pickup
 *   GM.Items.spawnCornucopiaLoot / spawnScatteredLoot / supplyDrop / sponsorGift
 *   GM.Items.spawnFeast / placeTrap / traps / dropAll
 *   extras: weaponScore, isBetterWeapon, neededGift, steal, give, carriedCount,
 *           geometryOf, material, contentsLabel
 *
 * Visuals: ordinary loot is drawn with one InstancedMesh per item type (few
 * draw calls, gentle hover + spin) plus one additive Points object for the
 * glints. Crates, gifts, traps and the feast table are individual meshes
 * built from shared geometries/materials.
 *
 * Owner: TRIBUTES.
 * ========================================================================== */
(function () {
  'use strict';
  const GM = window.GM;
  const U = GM.U;
  const CFG = GM.CFG;

  // ================================================================ strings
  GM.i18n.add({
    en: {
      'item.knife': 'Knife',
      'item.sickle': 'Sickle',
      'item.axe': 'Axe',
      'item.sword': 'Sword',
      'item.mace': 'Mace',
      'item.spear': 'Spear',
      'item.trident': 'Trident',
      'item.bow': 'Bow',
      'item.throwing_knives': 'Throwing knives',
      'item.arrows': 'Arrows',
      'item.armor': 'Armor vest',
      'item.food': 'Food',
      'item.water': 'Water',
      'item.medkit': 'Medical kit',
      'item.berries': 'Berries',
      'item.trap_kit': 'Trap kit',
      'item.sleeping_bag': 'Sleeping bag',
      'item.goggles': 'Night-vision goggles',
      'item.backpack': 'Backpack',
      'item.crate': 'Supply crate',
      'item.fists': 'Bare hands',
      'item.gift': 'Sponsor gift',
      'item.feastCrate': 'Feast crate',
      'item.trap': 'Trap',

      'item.knife.a': 'a knife',
      'item.sickle.a': 'a sickle',
      'item.axe.a': 'an axe',
      'item.sword.a': 'a sword',
      'item.mace.a': 'a mace',
      'item.spear.a': 'a spear',
      'item.trident.a': 'a trident',
      'item.bow.a': 'a bow',
      'item.throwing_knives.a': 'throwing knives',
      'item.arrows.a': 'arrows',
      'item.armor.a': 'an armor vest',
      'item.food.a': 'food',
      'item.water.a': 'water',
      'item.medkit.a': 'a medical kit',
      'item.berries.a': 'berries',
      'item.trap_kit.a': 'a trap kit',
      'item.sleeping_bag.a': 'a sleeping bag',
      'item.goggles.a': 'night-vision goggles',
      'item.backpack.a': 'a backpack',
      'item.crate.a': 'a supply crate',
      'item.fists.a': 'bare hands',

      'item.knife.desc': 'Small and fast. Weak hits.',
      'item.sickle.desc': 'A curved farm blade. Fast.',
      'item.axe.desc': 'Strong hits, but slow.',
      'item.sword.desc': 'Strong and fast. A great weapon.',
      'item.mace.desc': 'Very strong hits. It can stun.',
      'item.spear.desc': 'Long reach. It keeps enemies away.',
      'item.trident.desc': 'The best close weapon. Very rare.',
      'item.bow.desc': 'Shoots arrows from far away.',
      'item.throwing_knives.desc': 'Knives to throw at enemies.',
      'item.arrows.desc': 'Arrows for a bow.',
      'item.armor.desc': 'Stops 30% of the damage.',
      'item.food.desc': 'Stops hunger.',
      'item.water.desc': 'Stops thirst.',
      'item.medkit.desc': 'Heals wounds. Stops bleeding and poison.',
      'item.berries.desc': 'A little food. Some berries are poison!',
      'item.trap_kit.desc': 'Makes one hidden trap.',
      'item.sleeping_bag.desc': 'Warm sleep. No cold at night.',
      'item.goggles.desc': 'See in the dark.',
      'item.backpack.desc': 'A bag with random supplies.',
      'item.crate.desc': 'A crate full of good things.',
      'item.fists.desc': 'No weapon. Very weak.',

      'item.count': '{item} ×{n}',
      'item.list.1': '{a}',
      'item.list.2': '{a} and {b}',
      'item.list.3': '{a}, {b} and {c}',
      'item.list.4': '{a}, {b}, {c} and {d}',
      'item.list.5': '{a}, {b}, {c}, {d} and {e}',
      'item.list.many': '{a}, {b}, {c}, {d} and {n} more things',
      'item.list.empty': 'nothing',

      'item.interest.drop': 'Supply drop',
      'item.interest.crate': 'Supply crate',
      'item.interest.feast': 'The feast',
      'item.interest.gift': 'Gift for {name}',
      'item.interest.trap': 'Trap!',

      'log.item.weapon': '{name} took {item}.',
      'log.item.weaponSwap': '{name} dropped {old} and took {item}.',
      'log.item.armor': '{name} put on an armor vest.',
      'log.item.goggles': '{name} found night-vision goggles.',
      'log.item.backpack': '{name} opened a backpack: {items}.',
      'log.item.crate': '{name} opened a supply crate: {items}.',
      'log.item.feastCrate': '{name} took a feast crate: {items}.',
      'log.item.gift': '{name} opened a sponsor gift: {items}.',
      'log.item.giftStolen': '{name} took a gift that was for {owner}: {items}.',
      'log.item.giftSent': 'A sponsor sends a silver parachute to {name}.',
      'log.item.supplyDrop': 'A supply crate is falling from the sky.',
      'log.item.supplyDropRich': 'A big supply crate is falling from the sky!',
      'log.item.feast': 'The feast table is ready at the Cornucopia.',
      'log.item.trapSet': '{name} set a hidden trap.',
      'log.item.trapHit': '{victim} stepped into a hidden trap!',
      'log.item.trapHitBy': '{victim} stepped into a trap set by {owner}!',
      'log.item.trapMutt': 'A mutt stepped into a trap set by {owner}.',
      'log.item.nightlock': '{name} ate poison berries!',
      'log.item.steal': '{thief} stole {item} from {victim}.',
      'log.item.share': '{giver} gave {item} to {receiver}.',

      'ann.feastReady': 'The feast is ready at the Cornucopia!',
    },
    hu: {
      'item.knife': 'Kés',
      'item.sickle': 'Sarló',
      'item.axe': 'Balta',
      'item.sword': 'Kard',
      'item.mace': 'Buzogány',
      'item.spear': 'Lándzsa',
      'item.trident': 'Háromágú szigony',
      'item.bow': 'Íj',
      'item.throwing_knives': 'Dobókések',
      'item.arrows': 'Nyílvesszők',
      'item.armor': 'Páncélmellény',
      'item.food': 'Élelem',
      'item.water': 'Víz',
      'item.medkit': 'Elsősegélycsomag',
      'item.berries': 'Bogyók',
      'item.trap_kit': 'Csapdakészlet',
      'item.sleeping_bag': 'Hálózsák',
      'item.goggles': 'Éjjellátó szemüveg',
      'item.backpack': 'Hátizsák',
      'item.crate': 'Ellátmányláda',
      'item.fists': 'Puszta kéz',
      'item.gift': 'Szponzori ajándék',
      'item.feastCrate': 'Lakomaláda',
      'item.trap': 'Csapda',

      'item.knife.a': 'kés',
      'item.sickle.a': 'sarló',
      'item.axe.a': 'balta',
      'item.sword.a': 'kard',
      'item.mace.a': 'buzogány',
      'item.spear.a': 'lándzsa',
      'item.trident.a': 'háromágú szigony',
      'item.bow.a': 'íj',
      'item.throwing_knives.a': 'dobókések',
      'item.arrows.a': 'nyílvesszők',
      'item.armor.a': 'páncélmellény',
      'item.food.a': 'élelem',
      'item.water.a': 'víz',
      'item.medkit.a': 'elsősegélycsomag',
      'item.berries.a': 'bogyók',
      'item.trap_kit.a': 'csapdakészlet',
      'item.sleeping_bag.a': 'hálózsák',
      'item.goggles.a': 'éjjellátó szemüveg',
      'item.backpack.a': 'hátizsák',
      'item.crate.a': 'ellátmányláda',
      'item.fists.a': 'puszta kéz',

      'item.knife.desc': 'Kicsi és gyors. Gyenge ütések.',
      'item.sickle.desc': 'Ívelt paraszti penge. Gyors.',
      'item.axe.desc': 'Erős ütések, de lassú.',
      'item.sword.desc': 'Erős és gyors. Nagyszerű fegyver.',
      'item.mace.desc': 'Nagyon erős ütések. El is kábíthat.',
      'item.spear.desc': 'Messzire ér. Távol tartja az ellenséget.',
      'item.trident.desc': 'A legjobb közelharci fegyver. Nagyon ritka.',
      'item.bow.desc': 'Messziről lő nyilakat.',
      'item.throwing_knives.desc': 'Kések, amiket az ellenségre lehet dobni.',
      'item.arrows.desc': 'Nyilak az íjhoz.',
      'item.armor.desc': 'A sebzés 30%-át felfogja.',
      'item.food.desc': 'Elmúlik tőle az éhség.',
      'item.water.desc': 'Elmúlik tőle a szomjúság.',
      'item.medkit.desc': 'Gyógyítja a sebeket. Megállítja a vérzést és a mérgezést.',
      'item.berries.desc': 'Egy kis élelem. Néhány bogyó mérges!',
      'item.trap_kit.desc': 'Egy rejtett csapda készíthető belőle.',
      'item.sleeping_bag.desc': 'Meleg alvás. Éjjel nem fázol.',
      'item.goggles.desc': 'Látsz vele a sötétben.',
      'item.backpack.desc': 'Táska, benne véletlen készletek.',
      'item.crate.desc': 'Láda, tele jó dolgokkal.',
      'item.fists.desc': 'Nincs fegyver. Nagyon gyenge.',

      'item.count': '{item} ×{n}',
      'item.list.1': '{a}',
      'item.list.2': '{a} és {b}',
      'item.list.3': '{a}, {b} és {c}',
      'item.list.4': '{a}, {b}, {c} és {d}',
      'item.list.5': '{a}, {b}, {c}, {d} és {e}',
      'item.list.many': '{a}, {b}, {c}, {d} és még {n} dolog',
      'item.list.empty': 'semmi',

      'item.interest.drop': 'Ellátmány érkezik',
      'item.interest.crate': 'Ellátmányláda',
      'item.interest.feast': 'A lakoma',
      'item.interest.gift': 'Ajándék. Címzett: {name}',
      'item.interest.trap': 'Csapda!',

      'log.item.weapon': '{name} fegyvert szerzett: {item}.',
      'log.item.weaponSwap': '{name} eldobta ezt: {old}. Az új fegyvere: {item}.',
      'log.item.armor': '{name} felvett egy páncélmellényt.',
      'log.item.goggles': '{name} éjjellátó szemüveget talált.',
      'log.item.backpack': '{name} kinyitott egy hátizsákot. Benne: {items}.',
      'log.item.crate': '{name} kinyitott egy ellátmányládát. Benne: {items}.',
      'log.item.feastCrate': '{name} elvitt egy lakomaládát. Benne: {items}.',
      'log.item.gift': '{name} kinyitotta a szponzori ajándékot. Benne: {items}.',
      'log.item.giftStolen': '{name} elvett egy ajándékot, ami nem neki szólt (címzett: {owner}). Benne: {items}.',
      'log.item.giftSent': 'Egy szponzor ezüst ejtőernyőt küld. Címzett: {name}.',
      'log.item.supplyDrop': 'Ellátmányláda zuhan az égből.',
      'log.item.supplyDropRich': 'Egy nagy ellátmányláda zuhan az égből!',
      'log.item.feast': 'A lakoma asztala kész a Bőségszarunál.',
      'log.item.trapSet': '{name} rejtett csapdát állított.',
      'log.item.trapHit': 'Rejtett csapdába lépett: {victim}!',
      'log.item.trapHitBy': 'Csapdába lépett: {victim}! A csapdát {owner} állította.',
      'log.item.trapMutt': 'Egy mutáns csapdába lépett. A csapdát {owner} állította.',
      'log.item.nightlock': '{name} mérges bogyót evett!',
      'log.item.steal': '{thief} ellopta ezt: {item}. Kitől: {victim}.',
      'log.item.share': '{giver} odaadta ezt: {item}. Kapta: {receiver}.',

      'ann.feastReady': 'Kész a lakoma a Bőségszarunál!',
    },
  });

  // ============================================================= item table
  /**
   * GM.ItemDefs — fixed item ids (SPEC 7.4). Extra fields:
   *   score   weapon strength used for upgrade decisions
   *   anim    attack animation ('stab'|'slash'|'chop'|'thrust'|'draw'|'throw'|'punch')
   *   bleed   chance that a hit makes the target bleed
   *   cap     max carried amount (consumables / ammo)
   */
  const DEFS = {
    knife: { kind: 'melee', icon: '🔪', color: '#c9d3dc', value: 0.35, dmg: 16, range: 1.8, cd: 0.7, score: 22, anim: 'stab', bleed: 0.3, tier: 1 },
    sickle: { kind: 'melee', icon: '🌙', color: '#b9c6cc', value: 0.4, dmg: 18, range: 1.9, cd: 0.8, score: 24, anim: 'slash', bleed: 0.3, tier: 1 },
    axe: { kind: 'melee', icon: '🪓', color: '#a0714a', value: 0.6, dmg: 26, range: 2.0, cd: 1.2, score: 28, anim: 'chop', bleed: 0.25, knockback: 2.6, tier: 2 },
    sword: { kind: 'melee', icon: '⚔️', color: '#dfe6ee', value: 0.7, dmg: 24, range: 2.2, cd: 0.9, score: 30, anim: 'slash', bleed: 0.3, tier: 2 },
    mace: { kind: 'melee', icon: '🔨', color: '#7d7f86', value: 0.65, dmg: 28, range: 2.0, cd: 1.3, score: 30, anim: 'chop', stunChance: 0.2, stunTime: 1, knockback: 3.2, tier: 2 },
    spear: { kind: 'melee', icon: '🗡️', color: '#b08a5a', value: 0.65, dmg: 22, range: 3.0, cd: 1.1, score: 29, anim: 'thrust', bleed: 0.25, tier: 2 },
    trident: { kind: 'melee', icon: '🔱', color: '#e7c14b', value: 0.95, dmg: 32, range: 3.0, cd: 1.1, score: 38, anim: 'thrust', bleed: 0.35, knockback: 2.2, tier: 3 },
    bow: { kind: 'ranged', icon: '🏹', color: '#9a6b3f', value: 0.8, dmg: 30, range: 45, cd: 1.6, score: 40, ammoGain: 8, ammoCap: 30, projectile: 'arrow', speed: 42, anim: 'draw', tier: 3 },
    throwing_knives: { kind: 'ranged', icon: '🎯', color: '#cfd8e0', value: 0.55, dmg: 18, range: 20, cd: 1.0, score: 22, ammoGain: 5, ammoCap: 12, projectile: 'knife', speed: 24, anim: 'throw', bleed: 0.25, tier: 2 },
    arrows: { kind: 'ammo', icon: '🪶', color: '#c0392b', value: 0.3, amount: 8, forWeapon: 'bow' },
    armor: { kind: 'armor', icon: '🦺', color: '#5d6b3a', value: 0.7, reduce: 0.3 },
    food: { kind: 'consumable', icon: '🍖', color: '#c8864a', value: 0.45, hunger: 45, cap: 6 },
    water: { kind: 'consumable', icon: '💧', color: '#4aa3df', value: 0.5, thirst: 50, cap: 6 },
    medkit: { kind: 'consumable', icon: '🩹', color: '#eeeeee', value: 0.6, heal: 45, healTime: 5, cap: 3 },
    berries: { kind: 'consumable', icon: '🫐', color: '#5b4bb0', value: 0.2, hunger: 20, nightlock: 0.10, cap: 10 },
    trap_kit: { kind: 'tool', icon: '🪤', color: '#8c8c8c', value: 0.3, cap: 4 },
    sleeping_bag: { kind: 'tool', icon: '🛌', color: '#3d6b4a', value: 0.3 },
    goggles: { kind: 'tool', icon: '🥽', color: '#2ecc71', value: 0.35 },
    backpack: { kind: 'bundle', icon: '🎒', color: '#e67e22', value: 0.55 },
    crate: { kind: 'bundle', icon: '📦', color: '#b08850', value: 0.85 },
  };
  const ItemDefs = (GM.ItemDefs = {});
  for (const id in DEFS) {
    const d = DEFS[id];
    d.id = id;
    d.nameKey = 'item.' + id;
    d.descKey = 'item.' + id + '.desc';
    d.aKey = 'item.' + id + '.a';
    ItemDefs[id] = d;
  }
  /** Fists: not a real item (non-enumerable so item lists skip it). */
  const FISTS = {
    id: 'fists', kind: 'melee', icon: '✊', color: '#e0b89a', value: 0, dmg: 6, range: 1.6, cd: 0.9, score: 10,
    anim: 'punch', nameKey: 'item.fists', descKey: 'item.fists.desc', aKey: 'item.fists.a', tier: 0,
  };
  Object.defineProperty(ItemDefs, 'fists', { value: FISTS, enumerable: false, writable: false });

  const WEAPON_IDS = ['knife', 'sickle', 'axe', 'sword', 'mace', 'spear', 'trident'];
  const RANGED_IDS = ['bow', 'throwing_knives'];

  // =========================================================== module state
  const Items = (GM.Items = {
    list: [],
    traps: [],
    FISTS: FISTS,
    WEAPON_IDS: WEAPON_IDS,
    RANGED_IDS: RANGED_IDS,
  });

  const PICKUP_DIST = 1.6;
  const CRATE_PICKUP_DIST = 2.2;      // crates are big: measured to their edge
  const DROP_HEIGHT = 70;
  const DROP_SPEED = 4.2;              // m/s under the parachute
  const GIFT_HEIGHT = 38;
  const GIFT_SPEED = 6.5;
  const TRAP_RADIUS = 0.85;
  const TRAP_DAMAGE = 35;
  const TRAP_STUN = 3;
  const POOL_CAP = 160;
  const GLINT_MAX = 600;

  let nextId = 1;
  let scene = null;
  let pools = null;             // type -> {mesh, items}
  let glint = null;             // {points, pos, col}
  let crateMat = null;
  let itemMat = null;
  let trapMat = null;
  let lineMat = null;
  let beaconMat = null;
  let beamMat = null;
  let silverMat = null;
  let animClock = 0;
  let trapTimer = 0;
  let feastTable = null;        // THREE.Group
  let feastEmptyAt = 0;
  let listenersOn = false;
  const geoCache = Object.create(null);

  // temps (no allocations in hot loops)
  let _m4, _q, _e, _p, _s, _c;
  function initTemps() {
    if (_m4) return;
    _m4 = new THREE.Matrix4();
    _q = new THREE.Quaternion();
    _e = new THREE.Euler();
    _p = new THREE.Vector3();
    _s = new THREE.Vector3();
    _c = new THREE.Color();
  }

  // ================================================================ helpers
  function hasThree() { return typeof THREE !== 'undefined'; }
  function T() { return GM.Terrain; }
  function groundY(x, z) {
    const t = T();
    if (t && typeof t.heightAt === 'function') {
      const y = t.heightAt(x, z);
      if (y === y) return y;
    }
    return 0;
  }
  function waterY() {
    const t = T();
    if (t && typeof t.waterLevel === 'function') {
      const y = t.waterLevel();
      if (y === y) return y;
    }
    return GM.Env && typeof GM.Env.waterLevel === 'number' ? GM.Env.waterLevel : CFG.BASE_WATER_LEVEL;
  }
  function isWater(x, z) {
    const t = T();
    if (t && typeof t.isWater === 'function') return !!t.isWater(x, z);
    return groundY(x, z) < waterY();
  }
  function inArena(x, z, margin) {
    const t = T();
    if (t && typeof t.inArena === 'function') return !!t.inArena(x, z, margin || 0);
    return Math.sqrt(x * x + z * z) < CFG.ARENA_RADIUS - (margin || 0);
  }
  function surfaceY(x, z) { return Math.max(groundY(x, z), waterY() - 0.08); }
  function sfx(name, pos, volume) {
    const A = GM.Audio;
    if (!A || typeof A.play !== 'function') return;
    try { A.play(name, { pos: pos, volume: volume == null ? 1 : volume }); } catch (err) { GM.reportError('Items.audio', err); }
  }
  function fx(method, a, b, c, d, e) {
    const F = GM.FX;
    if (!F || typeof F[method] !== 'function') return;
    try { F[method](a, b, c, d, e); } catch (err) { GM.reportError('Items.FX.' + method, err); }
  }
  function aiNoise(pos, radius, kind, src) {
    const AI = GM.AI;
    if (!AI || typeof AI.noise !== 'function') return;
    try { AI.noise(pos, radius, kind, src == null ? null : src); } catch (err) { GM.reportError('Items.noise', err); }
  }
  function interest(o) {
    try { GM.addInterest(o); } catch (err) { GM.reportError('Items.interest', err); }
  }
  function tribute(id) {
    const ts = GM.state.tributes;
    return id != null && ts[id] ? ts[id] : null;
  }
  function noPick(obj) {
    obj.traverse(function (o) { o.raycast = function () {}; });
    return obj;
  }
  function addToScene(obj) {
    if (!scene && GM.World && GM.World.scene) scene = GM.World.scene;
    if (scene && obj) scene.add(obj);
  }
  function removeFromScene(obj) {
    if (obj && obj.parent) obj.parent.remove(obj);
  }
  function running() { return GM.state.phase === 'running'; }
  function numOr(v, d) { return typeof v === 'number' && v === v ? v : d; }

  /** Cornucopia centre + mouth direction (feature-detected from WORLD/Terrain). */
  function cornucopia() {
    const Tr = T();
    const W = GM.World;
    let x = 0, z = 0, heading = null;
    const lm = Tr && Tr.landmarks && Tr.landmarks.cornucopia;
    if (lm) {
      x = numOr(lm.x, 0); z = numOr(lm.z, 0);
      if (typeof lm.heading === 'number') heading = lm.heading;
      else if (typeof lm.mouthHeading === 'number') heading = lm.mouthHeading;
      else if (lm.mouth && typeof lm.mouth.x === 'number') heading = Math.atan2(lm.mouth.x - x, lm.mouth.z - z);
    }
    if (heading === null && W) {
      const c = W.cornucopia;
      if (c && c.userData && typeof c.userData.mouthHeading === 'number') heading = c.userData.mouthHeading;
      else if (typeof W.cornucopiaHeading === 'number') heading = W.cornucopiaHeading;
    }
    return { x: x, z: z, heading: heading === null ? 0 : heading };
  }

  // ====================================================== geometry building
  /**
   * Merge primitive parts into one non-indexed geometry with vertex colours.
   * parts: [{g, c: 0xrrggbb, p: [x,y,z], r: [x,y,z], s: number|[x,y,z]}]
   */
  function mergeParts(parts) {
    initTemps();
    const list = [];
    let total = 0;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const g = part.g.index ? part.g.toNonIndexed() : part.g.clone();
      part.g.dispose();
      const r = part.r || [0, 0, 0];
      const p = part.p || [0, 0, 0];
      const s = part.s == null ? 1 : part.s;
      _e.set(r[0], r[1], r[2]);
      _q.setFromEuler(_e);
      _p.set(p[0], p[1], p[2]);
      if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
      _m4.compose(_p, _q, _s);
      g.applyMatrix4(_m4);
      list.push({ g: g, c: part.c });
      total += g.attributes.position.count;
    }
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    let o = 0;
    for (let i = 0; i < list.length; i++) {
      const g = list[i].g;
      const pa = g.attributes.position;
      const na = g.attributes.normal;
      _c.set(list[i].c);
      for (let v = 0; v < pa.count; v++, o++) {
        pos[o * 3] = pa.getX(v); pos[o * 3 + 1] = pa.getY(v); pos[o * 3 + 2] = pa.getZ(v);
        if (na) { nor[o * 3] = na.getX(v); nor[o * 3 + 1] = na.getY(v); nor[o * 3 + 2] = na.getZ(v); }
        col[o * 3] = _c.r; col[o * 3 + 1] = _c.g; col[o * 3 + 2] = _c.b;
      }
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.computeBoundingSphere();
    return out;
  }
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt, rb, h, seg) => new THREE.CylinderGeometry(rt, rb, h, seg || 6);
  const sph = (r, ws, hs) => new THREE.SphereGeometry(r, ws || 6, hs || 4);
  const cone = (r, h, seg) => new THREE.ConeGeometry(r, h, seg || 6);
  const ico = (r, d) => new THREE.IcosahedronGeometry(r, d || 0);
  const HP = Math.PI / 2;

  const C = {
    steel: 0xcfd8e0, dsteel: 0x6c737c, iron: 0x4a4f57, wood: 0x8a5a33, dwood: 0x5b3a22,
    leather: 0x6b4226, gold: 0xe2b33c, dgold: 0xb8912c, red: 0xc0392b, white: 0xf2f2f2,
    olive: 0x55623a, dolive: 0x3b4528, tan: 0xd9a05b, brown: 0x7a5230, blue: 0x3f9ae0,
    green: 0x2f6b43, dgreen: 0x1f4a2d, black: 0x1c1d20, orange: 0xe07b1f, dorange: 0xb35d12,
    lens: 0x46ff9a, silver: 0xdfe4ea, berry: 0x3b2f7a, berry2: 0x5b4bb0, berryR: 0x8e1b3b, leaf: 0x3f8f3a,
  };

  /**
   * Geometry for an item type. Weapons are built with the grip at the origin
   * and the blade/tip along +X (flat side up) so tributes can reuse them in hand.
   */
  function buildGeometry(type) {
    switch (type) {
      case 'knife': return mergeParts([
        { g: box(0.13, 0.035, 0.04), c: C.leather, p: [0, 0, 0] },
        { g: box(0.02, 0.045, 0.09), c: C.dsteel, p: [0.075, 0, 0] },
        { g: box(0.2, 0.014, 0.045), c: C.steel, p: [0.185, 0, 0] },
        { g: cone(0.024, 0.07, 4), c: C.steel, p: [0.32, 0, 0], r: [0, 0, -HP], s: [1, 1, 0.5] },
      ]);
      case 'sickle': return mergeParts([
        { g: box(0.16, 0.04, 0.045), c: C.wood, p: [0, 0, 0] },
        { g: new THREE.TorusGeometry(0.14, 0.014, 3, 12, Math.PI * 1.15), c: C.steel, p: [0.2, 0, -0.02], r: [HP, 0, -0.3] },
      ]);
      case 'axe': return mergeParts([
        { g: cyl(0.022, 0.026, 0.74, 6), c: C.wood, p: [0.26, 0, 0], r: [0, 0, HP] },
        { g: box(0.14, 0.035, 0.16), c: C.iron, p: [0.56, 0, 0.07] },
        { g: box(0.05, 0.03, 0.26), c: C.steel, p: [0.56, 0, 0.16] },
        { g: box(0.08, 0.035, 0.06), c: C.iron, p: [0.56, 0, -0.04] },
      ]);
      case 'sword': return mergeParts([
        { g: cyl(0.02, 0.022, 0.17, 6), c: C.leather, p: [0, 0, 0], r: [0, 0, HP] },
        { g: sph(0.032, 6, 4), c: C.gold, p: [-0.1, 0, 0] },
        { g: box(0.04, 0.035, 0.24), c: C.gold, p: [0.095, 0, 0] },
        { g: box(0.66, 0.016, 0.062), c: C.steel, p: [0.44, 0, 0] },
        { g: cone(0.031, 0.1, 4), c: C.steel, p: [0.82, 0, 0], r: [0, 0, -HP], s: [1, 1, 0.5] },
      ]);
      case 'mace': return mergeParts([
        { g: cyl(0.022, 0.026, 0.56, 6), c: C.dwood, p: [0.18, 0, 0], r: [0, 0, HP] },
        { g: cyl(0.034, 0.034, 0.05, 6), c: C.gold, p: [0.42, 0, 0], r: [0, 0, HP] },
        { g: ico(0.11, 0), c: C.iron, p: [0.52, 0, 0] },
        { g: cone(0.03, 0.09, 4), c: C.dsteel, p: [0.52, 0.11, 0] },
        { g: cone(0.03, 0.09, 4), c: C.dsteel, p: [0.52, -0.11, 0], r: [Math.PI, 0, 0] },
        { g: cone(0.03, 0.09, 4), c: C.dsteel, p: [0.52, 0, 0.11], r: [HP, 0, 0] },
        { g: cone(0.03, 0.09, 4), c: C.dsteel, p: [0.52, 0, -0.11], r: [-HP, 0, 0] },
        { g: cone(0.03, 0.09, 4), c: C.dsteel, p: [0.63, 0, 0], r: [0, 0, -HP] },
      ]);
      case 'spear': return mergeParts([
        { g: cyl(0.019, 0.019, 1.75, 5), c: C.wood, p: [0.27, 0, 0], r: [0, 0, HP] },
        { g: cyl(0.026, 0.026, 0.08, 5), c: C.leather, p: [1.12, 0, 0], r: [0, 0, HP] },
        { g: cone(0.045, 0.26, 4), c: C.steel, p: [1.28, 0, 0], r: [0, 0, -HP] },
        { g: cyl(0.024, 0.024, 0.08, 5), c: C.leather, p: [0, 0, 0], r: [0, 0, HP] },
      ]);
      case 'trident': return mergeParts([
        { g: cyl(0.02, 0.02, 1.6, 6), c: C.dgold, p: [0.2, 0, 0], r: [0, 0, HP] },
        { g: box(0.035, 0.035, 0.28), c: C.gold, p: [1.0, 0, 0] },
        { g: box(0.24, 0.022, 0.022), c: C.gold, p: [1.12, 0, -0.125] },
        { g: box(0.3, 0.024, 0.024), c: C.gold, p: [1.15, 0, 0] },
        { g: box(0.24, 0.022, 0.022), c: C.gold, p: [1.12, 0, 0.125] },
        { g: cone(0.028, 0.09, 4), c: C.gold, p: [1.28, 0, -0.125], r: [0, 0, -HP] },
        { g: cone(0.032, 0.11, 4), c: C.gold, p: [1.35, 0, 0], r: [0, 0, -HP] },
        { g: cone(0.028, 0.09, 4), c: C.gold, p: [1.28, 0, 0.125], r: [0, 0, -HP] },
        { g: sph(0.04, 6, 4), c: C.gold, p: [-0.6, 0, 0] },
      ]);
      case 'bow': {
        const R = 0.7, arc = 1.5;
        const limb = new THREE.TorusGeometry(R, 0.02, 3, 16, arc);
        const tipX = -R + R * Math.cos(arc / 2);
        return mergeParts([
          { g: limb, c: C.wood, p: [-R, 0, 0], r: [HP, 0, 0], s: 1 },
          { g: box(0.006, 0.006, 2 * R * Math.sin(arc / 2)), c: C.white, p: [tipX, 0, 0] },
          { g: box(0.05, 0.036, 0.1), c: C.leather, p: [0, 0, 0] },
        ]);
      }
      case 'throwing_knives': return mergeParts([
        { g: box(0.3, 0.025, 0.2), c: C.leather, p: [0, 0, 0] },
        { g: box(0.16, 0.014, 0.035), c: C.steel, p: [0.1, 0.02, -0.06], r: [0, 0.15, 0] },
        { g: box(0.16, 0.014, 0.035), c: C.steel, p: [0.11, 0.02, 0], r: [0, 0, 0] },
        { g: box(0.16, 0.014, 0.035), c: C.steel, p: [0.1, 0.02, 0.06], r: [0, -0.15, 0] },
        { g: box(0.08, 0.03, 0.03), c: C.black, p: [-0.03, 0.02, -0.06] },
        { g: box(0.08, 0.03, 0.03), c: C.black, p: [-0.03, 0.02, 0] },
        { g: box(0.08, 0.03, 0.03), c: C.black, p: [-0.03, 0.02, 0.06] },
      ]);
      case 'arrows': {
        const parts = [];
        for (let i = 0; i < 4; i++) {
          const z = (i - 1.5) * 0.045;
          parts.push({ g: cyl(0.007, 0.007, 0.72, 4), c: C.wood, p: [0, 0.01, z], r: [0, 0, HP] });
          parts.push({ g: cone(0.018, 0.06, 4), c: C.dsteel, p: [0.39, 0.01, z], r: [0, 0, -HP] });
          parts.push({ g: box(0.1, 0.03, 0.004), c: C.red, p: [-0.3, 0.02, z] });
        }
        parts.push({ g: box(0.05, 0.04, 0.2), c: C.leather, p: [0, 0.01, 0] });
        return mergeParts(parts);
      }
      case 'armor': return mergeParts([
        { g: box(0.44, 0.1, 0.46), c: C.olive, p: [0, 0.05, 0] },
        { g: box(0.17, 0.04, 0.2), c: C.dolive, p: [-0.1, 0.11, 0.02] },
        { g: box(0.17, 0.04, 0.2), c: C.dolive, p: [0.1, 0.11, 0.02] },
        { g: box(0.08, 0.06, 0.12), c: C.dolive, p: [-0.15, 0.08, -0.25] },
        { g: box(0.08, 0.06, 0.12), c: C.dolive, p: [0.15, 0.08, -0.25] },
      ]);
      case 'food': return mergeParts([
        { g: sph(0.13, 7, 5), c: C.tan, p: [0, 0.08, 0], s: [1.5, 0.75, 1] },
        { g: box(0.17, 0.1, 0.13), c: C.brown, p: [0.12, 0.05, 0.14], r: [0, 0.4, 0] },
        { g: cyl(0.03, 0.05, 0.16, 6), c: 0x9c4a2a, p: [-0.14, 0.05, 0.12], r: [0, 0, HP * 0.9] },
      ]);
      case 'water': return mergeParts([
        { g: cyl(0.075, 0.075, 0.3, 8), c: C.blue, p: [0, 0.15, 0] },
        { g: cyl(0.032, 0.07, 0.07, 8), c: C.blue, p: [0, 0.335, 0] },
        { g: cyl(0.034, 0.034, 0.035, 8), c: C.white, p: [0, 0.385, 0] },
        { g: cyl(0.078, 0.078, 0.09, 8), c: C.white, p: [0, 0.16, 0] },
      ]);
      case 'medkit': return mergeParts([
        { g: box(0.34, 0.18, 0.25), c: C.white, p: [0, 0.09, 0] },
        { g: box(0.17, 0.012, 0.05), c: C.red, p: [0, 0.186, 0] },
        { g: box(0.05, 0.012, 0.17), c: C.red, p: [0, 0.186, 0] },
        { g: box(0.12, 0.035, 0.03), c: 0x9aa0a6, p: [0, 0.2, -0.08] },
      ]);
      case 'berries': {
        const parts = [
          { g: box(0.2, 0.01, 0.1), c: C.leaf, p: [0, 0.01, 0], r: [0, 0.5, 0] },
          { g: box(0.16, 0.01, 0.08), c: C.leaf, p: [0.02, 0.012, 0.04], r: [0, -0.7, 0] },
        ];
        const cols = [C.berry, C.berry2, C.berry, C.berryR, C.berry2, C.berry];
        for (let i = 0; i < 6; i++) {
          const a = i * 1.1;
          parts.push({ g: sph(0.045, 5, 4), c: cols[i], p: [Math.cos(a) * 0.07, 0.05 + (i % 2) * 0.03, Math.sin(a) * 0.07] });
        }
        return mergeParts(parts);
      }
      case 'trap_kit': return mergeParts([
        { g: new THREE.TorusGeometry(0.12, 0.018, 4, 10), c: 0x9a9fa6, p: [0, 0.02, 0], r: [HP, 0, 0] },
        { g: new THREE.TorusGeometry(0.09, 0.014, 4, 10), c: 0x9a9fa6, p: [0, 0.05, 0], r: [HP, 0, 0] },
        { g: cone(0.02, 0.16, 4), c: C.dwood, p: [0.2, 0.02, 0.02], r: [0, 0, -HP] },
        { g: cone(0.02, 0.16, 4), c: C.dwood, p: [0.2, 0.02, -0.04], r: [0, 0.3, -HP] },
        { g: box(0.1, 0.06, 0.08), c: C.leather, p: [-0.02, 0.03, 0.16] },
      ]);
      case 'sleeping_bag': return mergeParts([
        { g: cyl(0.13, 0.13, 0.55, 8), c: C.green, p: [0, 0.13, 0], r: [0, 0, HP] },
        { g: cyl(0.135, 0.135, 0.04, 8), c: C.black, p: [-0.15, 0.13, 0], r: [0, 0, HP] },
        { g: cyl(0.135, 0.135, 0.04, 8), c: C.black, p: [0.15, 0.13, 0], r: [0, 0, HP] },
        { g: cyl(0.09, 0.09, 0.01, 8), c: C.dgreen, p: [0.28, 0.13, 0], r: [0, 0, HP] },
      ]);
      case 'goggles': return mergeParts([
        { g: box(0.3, 0.03, 0.035), c: C.black, p: [0, 0.03, -0.03] },
        { g: cyl(0.05, 0.05, 0.06, 8), c: C.black, p: [-0.07, 0.04, 0.02] },
        { g: cyl(0.05, 0.05, 0.06, 8), c: C.black, p: [0.07, 0.04, 0.02] },
        { g: cyl(0.04, 0.04, 0.012, 8), c: C.lens, p: [-0.07, 0.075, 0.02] },
        { g: cyl(0.04, 0.04, 0.012, 8), c: C.lens, p: [0.07, 0.075, 0.02] },
      ]);
      case 'backpack': return mergeParts([
        { g: box(0.36, 0.44, 0.22), c: C.orange, p: [0, 0.22, 0] },
        { g: box(0.27, 0.17, 0.07), c: C.dorange, p: [0, 0.15, 0.14] },
        { g: box(0.37, 0.09, 0.24), c: C.dorange, p: [0, 0.42, 0.005] },
        { g: box(0.05, 0.38, 0.03), c: C.black, p: [-0.1, 0.24, -0.125] },
        { g: box(0.05, 0.38, 0.03), c: C.black, p: [0.1, 0.24, -0.125] },
        { g: cyl(0.06, 0.06, 0.36, 6), c: C.green, p: [0, 0.5, 0], r: [0, 0, HP] },
      ]);
      case 'crate': return mergeParts([
        { g: box(0.9, 0.72, 0.9), c: 0xa87a45, p: [0, 0.36, 0] },
        { g: box(0.94, 0.08, 0.94), c: C.dwood, p: [0, 0.08, 0] },
        { g: box(0.94, 0.08, 0.94), c: C.dwood, p: [0, 0.64, 0] },
        { g: box(0.08, 0.74, 0.94), c: C.dwood, p: [0, 0.36, 0] },
        { g: box(0.3, 0.2, 0.02), c: C.gold, p: [0, 0.36, 0.475] },
        { g: box(0.02, 0.2, 0.3), c: C.gold, p: [0.475, 0.36, 0] },
      ]);
      case 'feastCrate': return mergeParts([
        { g: box(0.8, 0.6, 0.6), c: 0x7a1f24, p: [0, 0.3, 0] },
        { g: box(0.84, 0.07, 0.64), c: C.gold, p: [0, 0.06, 0] },
        { g: box(0.84, 0.07, 0.64), c: C.gold, p: [0, 0.56, 0] },
        { g: box(0.07, 0.62, 0.64), c: C.gold, p: [0, 0.3, 0] },
        { g: ico(0.09, 0), c: C.gold, p: [0, 0.67, 0] },
        { g: box(0.24, 0.16, 0.02), c: C.white, p: [0.22, 0.3, 0.31] },
      ]);
      case 'giftPod': return mergeParts([
        { g: new THREE.CapsuleGeometry(0.15, 0.22, 3, 8), c: C.silver, p: [0, 0.27, 0] },
        { g: cyl(0.158, 0.158, 0.06, 8), c: C.gold, p: [0, 0.27, 0] },
        { g: sph(0.05, 6, 4), c: 0x8fd3ff, p: [0, 0.53, 0] },
      ]);
      case 'trap': return mergeParts([
        { g: new THREE.RingGeometry(0.5, 0.62, 16), c: 0x7a1d1d, p: [0, 0.03, 0], r: [-HP, 0, 0] },
        { g: cyl(0.45, 0.5, 0.05, 10), c: 0x4e5a2c, p: [0, 0.025, 0] },
        { g: box(0.3, 0.012, 0.08), c: 0x6d7f3a, p: [0.1, 0.055, 0.1], r: [0, 0.6, 0] },
        { g: box(0.26, 0.012, 0.07), c: 0x5f7033, p: [-0.12, 0.055, -0.05], r: [0, -0.4, 0] },
        { g: box(0.22, 0.012, 0.06), c: 0x7a6a3a, p: [0.02, 0.058, -0.15], r: [0, 1.2, 0] },
      ]);
      case 'trapSprung': {
        const parts = [
          { g: cyl(0.5, 0.55, 0.06, 10), c: 0x3a2f22, p: [0, 0.03, 0] },
        ];
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          parts.push({ g: cone(0.04, 0.42, 4), c: 0x8a8f96, p: [Math.cos(a) * 0.32, 0.2, Math.sin(a) * 0.32], r: [Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35] });
        }
        parts.push({ g: cone(0.05, 0.5, 4), c: 0x8a8f96, p: [0, 0.25, 0] });
        return mergeParts(parts);
      }
      case 'table': return mergeParts([
        { g: box(6.4, 0.1, 1.7), c: 0x6b4226, p: [0, 0.86, 0] },
        { g: box(6.5, 0.02, 1.8), c: 0xf3ead2, p: [0, 0.92, 0] },
        { g: box(6.52, 0.3, 0.02), c: 0xf3ead2, p: [0, 0.78, 0.9] },
        { g: box(6.52, 0.3, 0.02), c: 0xf3ead2, p: [0, 0.78, -0.9] },
        { g: box(6.52, 0.06, 0.03), c: C.gold, p: [0, 0.64, 0.91] },
        { g: box(6.52, 0.06, 0.03), c: C.gold, p: [0, 0.64, -0.91] },
        { g: box(0.12, 0.84, 0.12), c: C.dwood, p: [-3.0, 0.42, 0.7] },
        { g: box(0.12, 0.84, 0.12), c: C.dwood, p: [3.0, 0.42, 0.7] },
        { g: box(0.12, 0.84, 0.12), c: C.dwood, p: [-3.0, 0.42, -0.7] },
        { g: box(0.12, 0.84, 0.12), c: C.dwood, p: [3.0, 0.42, -0.7] },
        { g: cyl(0.05, 0.08, 0.5, 6), c: C.gold, p: [-2.6, 1.18, 0] },
        { g: cone(0.06, 0.12, 5), c: 0xffd070, p: [-2.6, 1.5, 0] },
        { g: cyl(0.05, 0.08, 0.5, 6), c: C.gold, p: [2.6, 1.18, 0] },
        { g: cone(0.06, 0.12, 5), c: 0xffd070, p: [2.6, 1.5, 0] },
      ]);
      default: return mergeParts([{ g: box(0.25, 0.25, 0.25), c: 0xff00ff, p: [0, 0.125, 0] }]);
    }
  }

  /** Canopy of a parachute: dome with alternating coloured panels. */
  function buildCanopy(radius, colA, colB) {
    initTemps();
    const g = new THREE.SphereGeometry(radius, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2.3).toNonIndexed();
    const pa = g.attributes.position;
    const col = new Float32Array(pa.count * 3);
    const ca = new THREE.Color(colA), cb = new THREE.Color(colB);
    for (let i = 0; i < pa.count; i += 3) {
      const cx = (pa.getX(i) + pa.getX(i + 1) + pa.getX(i + 2)) / 3;
      const cz = (pa.getZ(i) + pa.getZ(i + 1) + pa.getZ(i + 2)) / 3;
      const seg = Math.floor(((Math.atan2(cz, cx) + Math.PI) / (Math.PI * 2)) * 12);
      const c = seg % 2 ? ca : cb;
      for (let k = 0; k < 3; k++) { col[(i + k) * 3] = c.r; col[(i + k) * 3 + 1] = c.g; col[(i + k) * 3 + 2] = c.b; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // the dome's rim sits at y = radius*cos(PI/2.3); lift so the rim is at y = 0
    g.translate(0, -radius * Math.cos(Math.PI / 2.3), 0);
    g.computeBoundingSphere();
    return g;
  }
  /** Suspension lines from the canopy rim (y = 0) down to the load (y = -drop). */
  function buildLines(radius, drop) {
    const n = 8;
    const arr = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = radius * Math.sin(Math.PI / 2.3);
      arr[i * 6] = Math.cos(a) * rr; arr[i * 6 + 1] = 0; arr[i * 6 + 2] = Math.sin(a) * rr;
      arr[i * 6 + 3] = Math.cos(a) * 0.12; arr[i * 6 + 4] = -drop; arr[i * 6 + 5] = Math.sin(a) * 0.12;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    g.computeBoundingSphere();
    return g;
  }

  function geo(type) {
    if (!geoCache[type]) {
      if (type === 'canopyDrop') geoCache[type] = buildCanopy(2.6, 0xd8322b, 0xf4f1ea);
      else if (type === 'canopyGift') geoCache[type] = buildCanopy(1.35, 0xc8d0d8, 0xf7f9fb);
      else if (type === 'linesDrop') geoCache[type] = buildLines(2.6, 4.0);
      else if (type === 'linesGift') geoCache[type] = buildLines(1.35, 2.2);
      else if (type === 'beacon') geoCache[type] = new THREE.SphereGeometry(0.09, 8, 6);
      else if (type === 'beam') {
        const g = new THREE.CylinderGeometry(0.22, 0.45, 60, 8, 1, true);
        g.translate(0, 30, 0);
        geoCache[type] = g;
      } else geoCache[type] = buildGeometry(type);
    }
    return geoCache[type];
  }
  /** Shared geometry of an item type (weapons: grip at origin, blade along +X). */
  Items.geometryOf = function (type) { return hasThree() ? geo(type) : null; };
  /** Shared vertex-coloured material used by item geometries. */
  Items.material = function () { ensureMaterials(); return itemMat; };

  function ensureMaterials() {
    if (itemMat || !hasThree()) return;
    itemMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.62, metalness: 0.15 });
    crateMat = itemMat;
    trapMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.8, roughness: 0.9, metalness: 0 });
    lineMat = new THREE.LineBasicMaterial({ color: 0xd6d6d6, transparent: true, opacity: 0.85 });
    beaconMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
    beaconMat.color.multiplyScalar(6);         // HDR: blinking beacons bloom
    beamMat = new THREE.MeshBasicMaterial({
      color: 0xffc36b, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    });
    silverMat = new THREE.MeshBasicMaterial({ color: 0x8fd3ff });
    silverMat.color.multiplyScalar(4);
  }

  // =========================================================== instancing
  function ensurePool(type) {
    if (!pools) pools = Object.create(null);
    let p = pools[type];
    if (p) return p;
    ensureMaterials();
    const mesh = new THREE.InstancedMesh(geo(type), itemMat, POOL_CAP);
    mesh.count = 0;
    mesh.frustumCulled = false;       // instances are spread over the whole map
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = 'items:' + type;
    mesh.raycast = function () {};
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    p = pools[type] = { mesh: mesh, items: [] };
    addToScene(mesh);
    return p;
  }
  function poolAdd(item) {
    if (!hasThree()) return false;
    const p = ensurePool(item.type);
    if (p.items.length >= POOL_CAP) return false;
    item._slot = p.items.length;
    p.items.push(item);
    p.mesh.count = p.items.length;
    if (!p.mesh.parent) addToScene(p.mesh);
    return true;
  }
  function poolRemove(item) {
    const p = pools && pools[item.type];
    if (!p || item._slot == null) return;
    const last = p.items.pop();
    if (last !== item && last) {
      p.items[item._slot] = last;
      last._slot = item._slot;
    }
    item._slot = null;
    p.mesh.count = p.items.length;
  }

  function ensureGlint() {
    if (glint || !hasThree() || typeof document === 'undefined') return;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    if (!g) return;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.18, 'rgba(255,255,255,0.8)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.12)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillRect(31, 2, 2, 60);
    g.fillRect(2, 31, 60, 2);
    const tex = new THREE.CanvasTexture(cv);
    const pos = new Float32Array(GLINT_MAX * 3);
    const col = new Float32Array(GLINT_MAX * 3);
    const bg = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(pos, 3);
    const ca = new THREE.BufferAttribute(col, 3);
    pa.setUsage(THREE.DynamicDrawUsage);
    ca.setUsage(THREE.DynamicDrawUsage);
    bg.setAttribute('position', pa);
    bg.setAttribute('color', ca);
    bg.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      size: 1.1, map: tex, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    const points = new THREE.Points(bg, mat);
    points.frustumCulled = false;
    points.raycast = function () {};
    points.renderOrder = 5;
    glint = { points: points, pos: pos, col: col, pa: pa, ca: ca };
    addToScene(points);
  }

  // ================================================================ spawning
  /**
   * Spawn a ground item.
   * opts {amount, contents, crate, fromY, feast, gift, forId, tier, silent, noGlint}
   * fromY: start height above the ground (crates use a parachute; others pop).
   */
  Items.spawn = function (type, x, z, opts) {
    opts = opts || {};
    if (!ItemDefs[type]) type = 'food';
    const def = ItemDefs[type];
    x = numOr(x, 0); z = numOr(z, 0);
    // keep inside the arena
    const r = Math.sqrt(x * x + z * z);
    const maxR = CFG.ARENA_RADIUS - 3;
    if (r > maxR) { x *= maxR / r; z *= maxR / r; }
    const gy = groundY(x, z);
    const item = {
      id: nextId++,
      kind: 'item',
      type: type,
      pos: hasThree() ? new THREE.Vector3(x, gy, z) : { x: x, y: gy, z: z },
      mesh: null,
      amount: opts.amount != null ? Math.max(type === 'bow' ? 0 : 1, opts.amount | 0) : defaultAmount(type),
      contents: opts.contents ? opts.contents.slice() : null,
      crate: !!opts.crate || type === 'crate',
      falling: false,
      claimedBy: opts.claimedBy != null ? opts.claimedBy : null,
      spawnedAt: GM.state.time,
      tier: opts.tier || 1,
      feast: !!opts.feast,
      gift: !!opts.gift,
      forId: opts.forId != null ? opts.forId : null,
      groundY: gy,
      fallY: 0,          // height above ground while falling
      vy: 0,
      landedAt: null,
      yaw: Math.random() * Math.PI * 2,
      phase: Math.random() * 10,
      _slot: null,
      _vis: null,        // crate visuals
    };
    if (type === 'crate') item.crate = true;
    if (opts.fromY != null && opts.fromY > 0.05) {
      item.falling = true;
      item.fallY = opts.fromY;
      item.vy = item.crate ? -(item.gift ? GIFT_SPEED : DROP_SPEED) : 2.2;
    } else {
      item.landedAt = GM.state.time;
    }
    Items.list.push(item);
    buildVisual(item, def);
    return item;
  };

  function defaultAmount(type) {
    const d = ItemDefs[type];
    if (!d) return 1;
    if (type === 'bow') return 8;
    if (type === 'throwing_knives') return 5;
    if (type === 'arrows') return d.amount || 8;
    return 1;
  }

  function buildVisual(item) {
    if (!hasThree()) return;
    ensureMaterials();
    if (item.crate) {
      const grp = new THREE.Group();
      grp.name = 'crate:' + item.id;
      const body = new THREE.Mesh(geo(item.gift ? 'giftPod' : item.feast ? 'feastCrate' : 'crate'), crateMat);
      body.castShadow = GM.state.settings ? GM.state.settings.quality !== 'low' : true;
      grp.add(body);
      const vis = { group: grp, body: body, chute: null, beacon: null, beam: null, collapse: 0 };
      if (!item.feast) {
        const chute = new THREE.Group();
        const drop = item.gift ? 2.2 : 4.0;
        const canopy = new THREE.Mesh(geo(item.gift ? 'canopyGift' : 'canopyDrop'), itemMat);
        const lines = new THREE.LineSegments(geo(item.gift ? 'linesGift' : 'linesDrop'), lineMat);
        chute.add(canopy);
        chute.add(lines);
        chute.position.y = drop + (item.gift ? 0.55 : 0.72);
        chute.visible = item.falling;
        grp.add(chute);
        vis.chute = chute;
      }
      const beacon = new THREE.Mesh(geo('beacon'), item.gift ? silverMat : beaconMat);
      beacon.position.y = item.gift ? 0.62 : item.feast ? 0.8 : 0.8;
      grp.add(beacon);
      vis.beacon = beacon;
      if (!item.gift && !item.feast) {
        const beam = new THREE.Mesh(geo('beam'), beamMat);
        beam.position.y = 0.8;
        beam.visible = false;
        grp.add(beam);
        vis.beam = beam;
      }
      grp.rotation.y = item.yaw;
      noPick(grp);
      item._vis = vis;
      item.mesh = grp;
      placeCrate(item);
      addToScene(grp);
    } else if (!poolAdd(item)) {
      // pool full (very rare): individual mesh
      const m = new THREE.Mesh(geo(item.type), itemMat);
      m.raycast = function () {};
      item.mesh = m;
      addToScene(m);
    }
    ensureGlint();
  }

  function placeCrate(item) {
    const v = item._vis;
    if (!v) return;
    const sway = item.falling && item.fallY > 1 ? Math.sin(animClock * 0.9 + item.phase) : 0;
    const x = item.pos.x + sway * (item.gift ? 0.35 : 0.8);
    const z = item.pos.z + Math.cos(animClock * 0.7 + item.phase) * (item.falling && item.fallY > 1 ? (item.gift ? 0.3 : 0.6) : 0);
    const base = item.feast ? item.groundY + (item.tableY || 0) : Math.max(item.groundY, waterY() - 0.25);
    v.group.position.set(x, base + (item.falling ? item.fallY : 0), z);
    v.group.rotation.z = sway * 0.08;
  }

  /** Remove a ground item (and its visuals). */
  Items.remove = function (item) {
    if (!item) return;
    const i = Items.list.indexOf(item);
    if (i >= 0) Items.list.splice(i, 1);
    if (item._slot != null) poolRemove(item);
    if (item.mesh) {
      removeFromScene(item.mesh);
      item.mesh = null;
    }
    item._vis = null;
    item.removed = true;
  };

  // ================================================================ queries
  /** Nearest ground item within maxDist (XZ), optional filter(item) → bool. */
  Items.nearest = function (pos, maxDist, filter) {
    if (!pos) return null;
    const md = maxDist == null ? Infinity : maxDist;
    let best = null, bestD = md * md;
    const list = Items.list;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const dx = it.pos.x - pos.x, dz = it.pos.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d <= bestD && (!filter || filter(it))) { best = it; bestD = d; }
    }
    return best;
  };
  /** Ground items within r (XZ). New array. */
  Items.inRadius = function (pos, r, filter) {
    const out = [];
    if (!pos) return out;
    const r2 = r * r;
    const list = Items.list;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const dx = it.pos.x - pos.x, dz = it.pos.z - pos.z;
      if (dx * dx + dz * dz <= r2 && (!filter || filter(it))) out.push(it);
    }
    return out;
  };
  /** Ground item by id. */
  Items.get = function (id) {
    const list = Items.list;
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };

  // ============================================================ evaluation
  /** Weapon strength (fists = 10). */
  Items.weaponScore = function (type) {
    const d = type ? ItemDefs[type] : null;
    return d && d.score ? d.score : FISTS.score;
  };
  /** True when `type` is a melee weapon clearly better than t's current one. */
  Items.isBetterWeapon = function (t, type) {
    const d = ItemDefs[type];
    if (!d || d.kind !== 'melee' || !t || !t.inv) return false;
    return d.score > Items.weaponScore(t.inv.melee) + 1.5;
  };
  function trait(t, name, def) {
    const tr = t && t.traits;
    return tr && typeof tr[name] === 'number' ? tr[name] : def;
  }
  function skill(t, name, def) {
    const s = t && t.skills;
    return s && typeof s[name] === 'number' ? s[name] : def;
  }
  function isNight() {
    const E = GM.Env;
    try { return !!(E && typeof E.isNight === 'function' && E.isNight()); } catch (e) { return false; }
  }

  /**
   * How much tribute t wants an item type right now (0..1).
   * Also accepts a ground item (crates use tier / feast / gift owner).
   */
  Items.value = function (t, type) {
    if (!t || !t.inv) return 0;
    let item = null;
    if (type && typeof type === 'object') { item = type; type = item.type; }
    const d = ItemDefs[type];
    if (!d) return 0;
    const inv = t.inv;
    const greed = trait(t, 'greed', 0.5);
    const hpFrac = t.maxHealth > 0 ? t.health / t.maxHealth : 1;
    let v = 0;
    switch (d.kind) {
      case 'melee': {
        const cur = Items.weaponScore(inv.melee);
        const gain = d.score - cur;
        if (gain <= 1.5) return 0;
        v = 0.35 + Math.min(0.6, gain / 30);
        v *= 0.8 + 0.4 * trait(t, 'aggression', 0.5);
        break;
      }
      case 'ranged': {
        const aim = skill(t, 'aim', 0.5);
        if (type === 'bow') {
          if (!inv.ranged) v = 0.62 + 0.3 * aim;
          else if (inv.ranged === 'throwing_knives') v = 0.45 + 0.35 * aim;
          else v = inv.ammo < 6 ? 0.55 : inv.ammo < 16 ? 0.3 : 0.08;   // extra arrows
        } else {
          if (!inv.ranged) v = 0.45 + 0.25 * aim;
          else if (inv.ranged === 'throwing_knives') v = inv.ammo < 4 ? 0.45 : inv.ammo < 9 ? 0.2 : 0.05;
          else v = inv.ammo <= 0 ? 0.3 : 0;
        }
        break;
      }
      case 'ammo': {
        const cap = ItemDefs.bow.ammoCap || 30;
        if (inv.ranged !== 'bow' || inv.ammo >= cap) return 0;
        v = inv.ammo < 4 ? 0.7 : inv.ammo < 12 ? 0.4 : 0.12;
        break;
      }
      case 'armor':
        if (inv.armor) return 0;
        v = 0.6 + 0.25 * (1 - trait(t, 'bravery', 0.5) * 0.5);
        break;
      case 'consumable': {
        const have = inv[type] || 0;
        if (have >= (d.cap || 6)) return 0;
        if (type === 'food') v = 0.2 + 0.7 * (t.hunger || 0) / 100 - 0.08 * have;
        else if (type === 'water') v = 0.22 + 0.72 * (t.thirst || 0) / 100 - 0.08 * have;
        else if (type === 'medkit') {
          v = 0.25 + 0.65 * (1 - hpFrac) - 0.12 * have;
          if (t.status && (t.status.bleeding > 0 || t.status.poison > 0)) v += 0.3;
        } else if (type === 'berries') v = 0.08 + 0.45 * (t.hunger || 0) / 100 - 0.03 * have;
        break;
      }
      case 'tool':
        if (type === 'trap_kit') {
          if ((inv.traps || 0) >= (d.cap || 4)) return 0;
          v = 0.15 + 0.4 * trait(t, 'cunning', 0.5) - 0.06 * (inv.traps || 0);
        } else if (type === 'sleeping_bag') {
          if (inv.sleepingBag) return 0;
          v = 0.28 + (isNight() ? 0.2 : 0) + (GM.Env && GM.Env.weather === 'snow' ? 0.3 : 0);
        } else if (type === 'goggles') {
          if (inv.goggles) return 0;
          v = 0.3 + 0.25 * trait(t, 'aggression', 0.5) + (isNight() ? 0.1 : 0);
        }
        break;
      case 'bundle':
        if (type === 'backpack') v = 0.5 + 0.2 * (1 - Items.carriedCount(t) / 12);
        else if (item && item.gift) v = item.forId === t.id ? 1 : 0.55 + 0.3 * greed;
        else if (item && item.feast) v = 0.95;
        else v = 0.7 + 0.08 * ((item && item.tier) || 1);
        break;
      default:
        v = d.value || 0.2;
    }
    v *= 0.85 + 0.3 * greed;
    return U.clamp01(v);
  };

  /** Number of supply units a tribute carries (for backpack visuals / AI). */
  Items.carriedCount = function (t) {
    const inv = t && t.inv;
    if (!inv) return 0;
    return (inv.food || 0) + (inv.water || 0) + (inv.medkit || 0) + (inv.berries || 0) + (inv.traps || 0) +
      (inv.sleepingBag ? 1 : 0) + (inv.goggles ? 1 : 0);
  };

  /** The single most useful gift for a tribute right now (sponsor logic). */
  Items.neededGift = function (t) {
    if (!t || !t.inv) return 'food';
    const inv = t.inv;
    const hp = t.maxHealth > 0 ? t.health / t.maxHealth : 1;
    const bleeding = t.status && (t.status.bleeding > 0 || t.status.poison > 0);
    const cands = [
      ['medkit', (1 - hp) * 1.3 + (bleeding ? 0.6 : 0) - (inv.medkit || 0) * 0.5],
      ['water', (t.thirst || 0) / 100 * 1.2 - (inv.water || 0) * 0.35],
      ['food', (t.hunger || 0) / 100 * 1.1 - (inv.food || 0) * 0.3],
      ['armor', inv.armor ? -1 : 0.45],
      ['sword', Items.weaponScore(inv.melee) < 26 ? 0.62 - Items.weaponScore(inv.melee) / 60 : -1],
      ['bow', !inv.ranged ? 0.25 + skill(t, 'aim', 0.5) * 0.4 : -1],
      ['arrows', inv.ranged === 'bow' && inv.ammo < 5 ? 0.7 : -1],
      ['sleeping_bag', !inv.sleepingBag && (isNight() || (GM.Env && GM.Env.weather === 'snow')) ? 0.4 : -1],
      ['goggles', !inv.goggles && isNight() ? 0.3 : -1],
    ];
    let best = 'food', bestV = -Infinity;
    for (let i = 0; i < cands.length; i++) {
      if (cands[i][1] > bestV) { bestV = cands[i][1]; best = cands[i][0]; }
    }
    // a well-fed, armed, healthy tribute gets a trident as a sponsor showpiece
    if (bestV < 0.2 && Items.weaponScore(inv.melee) < ItemDefs.trident.score) best = 'trident';
    return best;
  };

  // ============================================================== inventory
  function emptyInv() {
    return { melee: null, ranged: null, ammo: 0, armor: false, food: 0, water: 0, medkit: 0, berries: 0, traps: 0, sleepingBag: false, goggles: false };
  }
  Items.emptyInventory = emptyInv;

  /** Drop point near a position (on land when possible). */
  function dropPoint(pos, minR, maxR, rngFn) {
    const rnd = rngFn || Math.random;
    for (let k = 0; k < 6; k++) {
      const a = rnd() * Math.PI * 2;
      const r = minR + (maxR - minR) * rnd();
      const x = pos.x + Math.cos(a) * r, z = pos.z + Math.sin(a) * r;
      if (inArena(x, z, 3) && (!isWater(x, z) || k === 5)) return { x: x, z: z };
    }
    return { x: pos.x, z: pos.z };
  }

  /**
   * Apply one item type to the inventory. Returns the amount taken (0 = not taken).
   * `drops` collects replaced weapons that must go back to the ground.
   */
  function applyOne(t, type, amount, drops) {
    const inv = t.inv;
    const d = ItemDefs[type];
    if (!d) return 0;
    amount = Math.max(type === 'bow' ? 0 : 1, amount | 0);
    switch (d.kind) {
      case 'melee':
        if (!Items.isBetterWeapon(t, type)) return 0;
        if (inv.melee) drops.push({ type: inv.melee, amount: 1 });
        inv.melee = type;
        return 1;
      case 'ranged': {
        const cap = d.ammoCap || 20;
        if (!inv.ranged) {
          inv.ranged = type; inv.ammo = Math.min(cap, amount);
          return 1;
        }
        if (inv.ranged === type) {
          if (inv.ammo >= cap || amount <= 0) return 0;
          inv.ammo = Math.min(cap, inv.ammo + amount);
          return 1;
        }
        // switching kind: a bow beats knives; knives only replace an empty bow
        if ((type === 'bow' && amount > 0) || inv.ammo <= 0) {
          if (inv.ranged === 'bow') drops.push({ type: 'bow', amount: Math.max(0, inv.ammo) });
          else if (inv.ammo > 0) drops.push({ type: inv.ranged, amount: inv.ammo });
          inv.ranged = type; inv.ammo = Math.min(cap, amount);
          return 1;
        }
        return 0;
      }
      case 'ammo': {
        if (inv.ranged !== 'bow') return 0;
        const cap = ItemDefs.bow.ammoCap;
        if (inv.ammo >= cap) return 0;
        const take = Math.min(amount, cap - inv.ammo);
        inv.ammo += take;
        return take;
      }
      case 'armor':
        if (inv.armor) return 0;
        inv.armor = true;
        return 1;
      case 'consumable': {
        const cap = d.cap || 6;
        const have = inv[type] || 0;
        if (have >= cap) return 0;
        const take = Math.min(amount, cap - have);
        inv[type] = have + take;
        return take;
      }
      case 'tool':
        if (type === 'trap_kit') {
          const cap = d.cap || 4;
          if ((inv.traps || 0) >= cap) return 0;
          const take = Math.min(amount, cap - (inv.traps || 0));
          inv.traps = (inv.traps || 0) + take;
          return take;
        }
        if (type === 'sleeping_bag') { if (inv.sleepingBag) return 0; inv.sleepingBag = true; return 1; }
        if (type === 'goggles') { if (inv.goggles) return 0; inv.goggles = true; return 1; }
        return 0;
      default:
        return 0;
    }
  }

  /** Random contents for a backpack (2-4 supplies). */
  function backpackContents(rng) {
    const R = rng || GM.R;
    const n = R.int(2, 4);
    const out = [];
    const table = { food: 3, water: 3, medkit: 1.2, berries: 1.1, trap_kit: 0.8, sleeping_bag: 0.7, goggles: 0.35, knife: 0.9, arrows: 0.4, throwing_knives: 0.3, sickle: 0.35 };
    for (let i = 0; i < n; i++) out.push(R.weighted(table));
    return out;
  }
  /** Contents of a supply crate by tier (1..3). */
  function crateContents(tier) {
    const R = GM.R;
    tier = U.clamp(tier | 0 || 2, 1, 3);
    const out = [];
    if (tier === 1) {
      out.push('food', 'water');
      out.push(R.weighted({ medkit: 2, food: 1, water: 1, berries: 1 }));
      if (R.chance(0.5)) out.push(R.weighted({ knife: 2, sickle: 1, trap_kit: 1 }));
    } else if (tier === 2) {
      out.push(R.weighted({ sword: 2, spear: 2, axe: 1.5, mace: 1.2, throwing_knives: 1.3 }));
      out.push('food', 'water', 'medkit');
      if (R.chance(0.45)) out.push('armor');
      else out.push(R.weighted({ sleeping_bag: 1, goggles: 0.8, trap_kit: 1, arrows: 0.6 }));
    } else {
      if (R.chance(0.5)) out.push('bow', 'arrows'); else out.push(R.chance(0.5) ? 'trident' : 'sword');
      out.push('armor', 'medkit', 'medkit', 'food', 'water');
      out.push(R.weighted({ goggles: 1, sleeping_bag: 1, trap_kit: 0.7 }));
    }
    return out;
  }
  Items.backpackContents = backpackContents;
  Items.crateContents = crateContents;

  /** Build an i18n param object listing item types (merges duplicates). */
  Items.contentsLabel = function (types) {
    if (!types || !types.length) return { key: 'item.list.empty', params: {} };
    const counts = [];
    const idx = Object.create(null);
    for (let i = 0; i < types.length; i++) {
      const ty = types[i];
      if (!ItemDefs[ty]) continue;
      if (idx[ty] == null) { idx[ty] = counts.length; counts.push([ty, 0]); }
      counts[idx[ty]][1]++;
    }
    if (!counts.length) return { key: 'item.list.empty', params: {} };
    const names = counts.map(function (c) {
      return c[1] > 1 ? { key: 'item.count', params: { item: '@item.' + c[0] + '.a', n: c[1] } } : '@item.' + c[0] + '.a';
    });
    const L = ['a', 'b', 'c', 'd', 'e'];
    const params = {};
    if (names.length <= 5) {
      for (let i = 0; i < names.length; i++) params[L[i]] = names[i];
      return { key: 'item.list.' + names.length, params: params };
    }
    for (let i = 0; i < 4; i++) params[L[i]] = names[i];
    params.n = names.length - 4;
    return { key: 'item.list.many', params: params };
  };

  function logItem(key, params, t, item, important) {
    try {
      GM.log('item', key, params, { pos: t ? t.pos : item && item.pos, tributeIds: t ? [t.id] : [], important: !!important });
    } catch (err) { GM.reportError('Items.log', err); }
  }
  function emitPickup(t, type, source) {
    GM.emit('item:pickup', { tribute: t, type: type, source: source });
  }
  function touchTribute(t) {
    const Tr = GM.Tributes;
    if (Tr && typeof Tr.refreshGear === 'function') {
      try { Tr.refreshGear(t); } catch (err) { GM.reportError('Items.refreshGear', err); }
    }
  }
  function pickupGesture(t) {
    const Tr = GM.Tributes;
    if (Tr && typeof Tr.gesture === 'function') {
      try { Tr.gesture(t, 'pickup', 0.6); } catch (err) { GM.reportError('Items.gesture', err); }
    }
  }
  function spawnDrops(t, drops, source) {
    for (let i = 0; i < drops.length; i++) {
      const p = dropPoint(t.pos, 0.6, 1.4);
      const it = Items.spawn(drops[i].type, p.x, p.z, { amount: drops[i].amount, fromY: 0.9 });
      it.droppedBy = t.id;
      it.source = source || 'drop';
    }
  }

  /**
   * Tribute t picks up a ground item (must be within 1.6 m; crates 2.2 m).
   * Auto-equips better weapons (the old one is dropped), opens bundles.
   * Returns true when anything was taken.
   */
  Items.pickup = function (t, item) {
    if (!t || !t.alive || !t.inv || !item || item.removed || item.falling) return false;
    if (Items.list.indexOf(item) < 0) return false;
    const dx = item.pos.x - t.pos.x, dz = item.pos.z - t.pos.z;
    const reach = item.crate ? CRATE_PICKUP_DIST : PICKUP_DIST;
    if (dx * dx + dz * dz > reach * reach) return false;
    const def = ItemDefs[item.type];
    const drops = [];
    const source = item.gift ? 'gift' : item.feast ? 'feast' : item.crate ? 'crate' : item.type === 'backpack' ? 'backpack' : (item.source || 'ground');

    if (def.kind === 'bundle') {
      let contents = item.contents;
      if (!contents || !contents.length) contents = item.type === 'backpack' ? backpackContents(GM.R) : crateContents(item.tier);
      const taken = [];
      const leftovers = [];
      for (let i = 0; i < contents.length; i++) {
        const ty = contents[i];
        const got = applyOne(t, ty, defaultAmount(ty), drops);
        if (got > 0) { taken.push(ty); emitPickup(t, ty, source); }
        else leftovers.push(ty);
      }
      Items.remove(item);
      // things the tribute cannot use stay on the ground for others
      for (let i = 0; i < leftovers.length; i++) drops.push({ type: leftovers[i], amount: defaultAmount(leftovers[i]) });
      spawnDrops(t, drops, source);
      emitPickup(t, item.type, source);
      const label = Items.contentsLabel(taken.length ? taken : contents);
      if (item.gift) {
        const owner = tribute(item.forId);
        if (owner && owner !== t) logItem('log.item.giftStolen', { name: t.name, owner: owner.name, items: label }, t, item, true);
        else logItem('log.item.gift', { name: t.name, items: label }, t, item, true);
        sfx('heal', t.pos, 0.6);
      } else if (item.feast) {
        logItem('log.item.feastCrate', { name: t.name, items: label }, t, item, true);
      } else if (item.crate) {
        logItem('log.item.crate', { name: t.name, items: label }, t, item, true);
      } else {
        logItem('log.item.backpack', { name: t.name, items: label }, t, item, false);
      }
      if (item.crate) {
        fx('burst', { x: item.pos.x, y: item.pos.y + 0.5, z: item.pos.z }, { count: 14, color: 0xc49a5a, color2: 0xe2b33c, speed: 3, up: 3, size: 0.18, life: 0.9 });
        sfx('drop', item.pos, 0.7);
      } else sfx('click', item.pos, 0.5);
      pickupGesture(t);
      touchTribute(t);
      return true;
    }

    const oldMelee = t.inv.melee;
    const got = applyOne(t, item.type, item.amount, drops);
    if (got <= 0) return false;
    if (def.kind === 'ammo' || def.kind === 'consumable' || item.type === 'trap_kit') {
      if (got < item.amount) item.amount -= got;
      else Items.remove(item);
    } else {
      Items.remove(item);
    }
    spawnDrops(t, drops, 'swap');
    emitPickup(t, item.type, source);
    if (def.kind === 'melee' || def.kind === 'ranged') {
      if (def.kind === 'melee' && oldMelee) logItem('log.item.weaponSwap', { name: t.name, old: '@item.' + oldMelee + '.a', item: '@item.' + item.type + '.a' }, t, item, def.tier >= 3);
      else logItem('log.item.weapon', { name: t.name, item: '@item.' + item.type + '.a' }, t, item, def.tier >= 3);
      sfx('clash', item.pos, 0.25);
    } else if (item.type === 'armor') {
      logItem('log.item.armor', { name: t.name }, t, item, false);
      sfx('click', item.pos, 0.5);
    } else if (item.type === 'goggles') {
      logItem('log.item.goggles', { name: t.name }, t, item, false);
      sfx('click', item.pos, 0.5);
    } else {
      sfx('click', item.pos, 0.35);
    }
    pickupGesture(t);
    touchTribute(t);
    return true;
  };

  /**
   * Thief takes the most valuable thing from victim (sleeping / careless tributes).
   * Returns the item type or null. Must be within 2 m.
   */
  Items.steal = function (thief, victim) {
    if (!thief || !victim || !thief.alive || !thief.inv || !victim.inv || thief === victim) return null;
    if (U.distXZ(thief.pos, victim.pos) > 2.2) return null;
    const vinv = victim.inv;
    const order = [];
    if (vinv.medkit > 0) order.push('medkit');
    if (vinv.ranged && vinv.ranged === 'bow' && !thief.inv.ranged) order.push('bow');
    if (vinv.melee && Items.isBetterWeapon(thief, vinv.melee)) order.push(vinv.melee);
    if (vinv.food > 0) order.push('food');
    if (vinv.water > 0) order.push('water');
    if (vinv.goggles && !thief.inv.goggles) order.push('goggles');
    if (vinv.sleepingBag && !thief.inv.sleepingBag) order.push('sleeping_bag');
    if (vinv.berries > 0) order.push('berries');
    if (vinv.traps > 0) order.push('trap_kit');
    for (let i = 0; i < order.length; i++) {
      const ty = order[i];
      const drops = [];
      let amount = 1;
      if (ty === 'bow') amount = Math.max(1, vinv.ammo);
      const got = applyOne(thief, ty, amount, drops);
      if (got <= 0) continue;
      // take it away from the victim
      if (ty === 'bow') { vinv.ranged = null; vinv.ammo = 0; }
      else if (ItemDefs[ty].kind === 'melee') vinv.melee = null;
      else if (ty === 'goggles') vinv.goggles = false;
      else if (ty === 'sleeping_bag') vinv.sleepingBag = false;
      else if (ty === 'trap_kit') vinv.traps = Math.max(0, vinv.traps - got);
      else vinv[ty] = Math.max(0, (vinv[ty] || 0) - got);
      spawnDrops(thief, drops, 'swap');
      emitPickup(thief, ty, 'steal');
      logItem('log.item.steal', { thief: thief.name, victim: victim.name, item: '@item.' + ty + '.a' }, thief, null, false);
      pickupGesture(thief);
      touchTribute(thief);
      touchTribute(victim);
      return ty;
    }
    return null;
  };

  /** Give one unit of a supply (food/water/medkit/berries) to another tribute. */
  Items.give = function (from, to, type) {
    if (!from || !to || !from.inv || !to.inv || from === to || !from.alive || !to.alive) return false;
    const d = ItemDefs[type];
    if (!d || d.kind !== 'consumable') return false;
    if ((from.inv[type] || 0) <= 0) return false;
    if (U.distXZ(from.pos, to.pos) > 4) return false;
    const drops = [];
    if (applyOne(to, type, 1, drops) <= 0) return false;
    from.inv[type]--;
    emitPickup(to, type, 'share');
    logItem('log.item.share', { giver: from.name, receiver: to.name, item: '@item.' + type + '.a' }, from, null, false);
    touchTribute(from);
    touchTribute(to);
    return true;
  };

  /** Drop all of a (dead) tribute's items around the body. */
  Items.dropAll = function (t) {
    if (!t || !t.inv) return [];
    const inv = t.inv;
    const out = [];
    const add = function (type, amount) {
      if (!ItemDefs[type] || !(amount > 0 || (type === 'bow' && amount === 0))) return;
      const p = dropPoint(t.pos, 0.7, 2.3);
      const it = Items.spawn(type, p.x, p.z, { amount: amount, fromY: 1.1 });
      it.source = 'body';
      it.fromBody = t.id;
      out.push(it);
    };
    if (inv.melee) add(inv.melee, 1);
    if (inv.ranged === 'bow') add('bow', Math.max(0, inv.ammo | 0));
    else if (inv.ranged && inv.ammo > 0) add(inv.ranged, inv.ammo | 0);
    if (inv.armor) add('armor', 1);
    if (inv.food > 0) add('food', inv.food);
    if (inv.water > 0) add('water', inv.water);
    if (inv.medkit > 0) add('medkit', inv.medkit);
    if (inv.berries > 0) add('berries', inv.berries);
    if (inv.traps > 0) add('trap_kit', inv.traps);
    if (inv.sleepingBag) add('sleeping_bag', 1);
    if (inv.goggles) add('goggles', 1);
    const fresh = emptyInv();
    for (const k in fresh) inv[k] = fresh[k];
    touchTribute(t);
    return out;
  };

  // ============================================================ loot layout
  function farEnough(x, z, placed, minD) {
    const m2 = minD * minD;
    for (let i = 0; i < placed.length; i++) {
      const dx = placed[i].x - x, dz = placed[i].z - z;
      if (dx * dx + dz * dz < m2) return false;
    }
    return true;
  }
  function polar(cx, cz, ang, dist) { return { x: cx + Math.sin(ang) * dist, z: cz + Math.cos(ang) * dist }; }

  /**
   * Cornucopia loot: the best weapons at the horn mouth, other weapons and
   * supplies further out, orange backpacks on a ring near the pedestals.
   */
  Items.spawnCornucopiaLoot = function (count) {
    count = Math.max(6, (count | 0) || 38);
    const R = GM.R;
    const c = cornucopia();
    const nt = Math.max(2, Math.round(count / 1.6));
    const placed = [];
    const out = [];
    const put = function (type, x, z, amount) {
      const it = Items.spawn(type, x, z, amount != null ? { amount: amount } : null);
      it.source = 'cornucopia';
      placed.push({ x: x, z: z });
      out.push(it);
      return it;
    };
    const nW = Math.max(3, Math.round(count * 0.4));
    const nB = Math.max(2, Math.round(count * 0.22));
    const nS = Math.max(2, count - nW - nB);

    // --- weapons: sorted best first, the best right in the horn mouth
    const weapons = ['sword'];
    if (nt >= 4) weapons.push('bow');
    if (nt >= 26 && R.chance(0.6)) weapons.push('bow');
    if (R.chance(0.3) || nt >= 34) weapons.push('trident');
    const wTable = { sword: 2.2, spear: 3, axe: 2.4, mace: 1.8, knife: 3, sickle: 2, throwing_knives: 2 };
    while (weapons.length < nW) weapons.push(R.weighted(wTable));
    weapons.sort(function (a, b) { return ItemDefs[b].score - ItemDefs[a].score; });
    for (let i = 0; i < weapons.length; i++) {
      const f = i / Math.max(1, weapons.length - 1);
      let p = null;
      for (let k = 0; k < 8; k++) {
        const ang = c.heading + R.range(-1, 1) * (0.35 + 0.55 * f);
        const dist = 4.4 + f * 5.2 + R.range(-0.5, 0.5);
        const q = polar(c.x, c.z, ang, dist);
        if (farEnough(q.x, q.z, placed, 0.9)) { p = q; break; }
        p = q;
      }
      put(weapons[i], p.x, p.z);
    }

    // --- supplies: all around the horn, a bit further out
    const supplies = [];
    const armors = 1 + Math.floor(nt / 12);
    for (let i = 0; i < armors && supplies.length < nS; i++) supplies.push('armor');
    const sTable = { food: 3, water: 3, medkit: 1.5, arrows: 0.9, trap_kit: 1, sleeping_bag: 0.9, goggles: 0.5, berries: 0.5 };
    while (supplies.length < nS) supplies.push(R.weighted(sTable));
    for (let i = 0; i < supplies.length; i++) {
      let p = null;
      for (let k = 0; k < 10; k++) {
        const ang = R.angle();
        const behind = Math.abs(U.angleDiff(ang, c.heading + Math.PI)) < 0.7;
        const dist = R.range(behind ? 8.5 : 6.5, 12.5);
        const q = polar(c.x, c.z, ang, dist);
        if (farEnough(q.x, q.z, placed, 1.0)) { p = q; break; }
        p = q;
      }
      put(supplies[i], p.x, p.z);
    }

    // --- backpacks: a ring between the supplies and the pedestals
    const ringR = Math.min(CFG.PEDESTAL_RADIUS - 3.5, 15);
    const off = R.angle();
    for (let i = 0; i < nB; i++) {
      const ang = off + (i / nB) * Math.PI * 2 + R.range(-0.12, 0.12);
      const q = polar(c.x, c.z, ang, ringR + R.range(-1.6, 1.0));
      const it = put('backpack', q.x, q.z);
      it.contents = backpackContents(R);
    }
    return out;
  };

  /** Loot across the map: backpacks, food, water, a few weapons and tools. */
  Items.spawnScatteredLoot = function (count) {
    count = (count | 0) || 40;
    const R = GM.R;
    const Tr = T();
    const out = [];
    const table = { backpack: 3, food: 2, water: 1.8, berries: 1.4, knife: 0.6, sickle: 0.4, trap_kit: 0.4, medkit: 0.45, arrows: 0.25, sleeping_bag: 0.35, spear: 0.2, throwing_knives: 0.2, goggles: 0.12 };
    const pointFor = function (type) {
      let p = null;
      if (Tr && typeof Tr.randomLandPoint === 'function') {
        try {
          p = Tr.randomLandPoint(type === 'berries' ? { minR: 34, maxR: 132, biome: 'forest', rng: R } : { minR: 32, maxR: 134, rng: R });
          if (!p && type === 'berries') p = Tr.randomLandPoint({ minR: 34, maxR: 132, rng: R });
        } catch (err) { GM.reportError('Items.randomLandPoint', err); p = null; }
      }
      if (!p) {
        for (let k = 0; k < 12; k++) {
          const ang = R.angle(), d = R.range(32, 132);
          const q = { x: Math.sin(ang) * d, z: Math.cos(ang) * d };
          if (!isWater(q.x, q.z)) { p = q; break; }
          p = q;
        }
      }
      return p;
    };
    for (let i = 0; i < count; i++) {
      const type = R.weighted(table);
      const p = pointFor(type);
      if (!p) continue;
      const it = Items.spawn(type, p.x, p.z, type === 'berries' ? { amount: R.int(1, 3) } : null);
      if (type === 'backpack') it.contents = backpackContents(R);
      it.source = 'scatter';
      out.push(it);
    }
    // caves and rock shelters hide a reward
    const caves = Tr && Tr.landmarks && Tr.landmarks.caves;
    if (caves && caves.length) {
      for (let i = 0; i < caves.length && i < 4; i++) {
        const cv = caves[i];
        if (!cv || typeof cv.x !== 'number') continue;
        const type = R.weighted({ backpack: 3, medkit: 1, sleeping_bag: 1, trap_kit: 0.6 });
        const it = Items.spawn(type, cv.x + R.range(-1, 1), cv.z + R.range(-1, 1));
        if (type === 'backpack') it.contents = backpackContents(R);
        it.source = 'scatter';
        out.push(it);
      }
    }
    return out;
  };

  // =================================================== drops, gifts, feast
  /**
   * A supply crate on a parachute falls from ~70 m. opts {contents, tier 1..3}.
   */
  Items.supplyDrop = function (x, z, opts) {
    opts = opts || {};
    const tier = U.clamp((opts.tier | 0) || 2, 1, 3);
    const contents = opts.contents && opts.contents.length ? opts.contents.slice() : crateContents(tier);
    const item = Items.spawn('crate', x, z, { crate: true, contents: contents, fromY: DROP_HEIGHT, tier: tier });
    item.source = 'drop';
    logItem(tier >= 3 ? 'log.item.supplyDropRich' : 'log.item.supplyDrop', {}, null, item, tier >= 3);
    interest({
      pos: item.pos, score: 3, duration: DROP_HEIGHT / DROP_SPEED + 12,
      label: { key: 'item.interest.drop', params: {} }, kind: 'drop', key: 'drop:' + item.id,
    });
    sfx('parachute', item.pos, 0.8);
    return item;
  };

  /** A silver parachute with one gift lands next to tribute t. */
  Items.sponsorGift = function (t, type) {
    if (!t || !t.alive) return null;
    if (!type || !ItemDefs[type] || ItemDefs[type].kind === 'bundle') type = Items.neededGift(t);
    const p = dropPoint(t.pos, 1.3, 2.4, GM.R.random);
    const contents = [type];
    if (type === 'bow' || (type === 'arrows' && t.inv && t.inv.ranged === 'bow')) contents.push('arrows');
    if (type === 'food' || type === 'water') contents.push(type);
    const item = Items.spawn('crate', p.x, p.z, {
      crate: true, gift: true, forId: t.id, claimedBy: t.id, contents: contents, fromY: GIFT_HEIGHT, tier: 1,
    });
    item.source = 'gift';
    logItem('log.item.giftSent', { name: t.name }, t, item, true);
    GM.emit('gift:sent', { tribute: t, type: type });
    interest({
      pos: t.pos, score: 4, duration: GIFT_HEIGHT / GIFT_SPEED + 6,
      label: { key: 'item.interest.gift', params: { name: t.name } }, followId: t.id, kind: 'gift', key: 'gift:' + item.id,
    });
    sfx('parachute', t.pos, 0.9);
    return item;
  };

  function removeFeastTable() {
    if (feastTable) {
      removeFromScene(feastTable);
      feastTable = null;
    }
    feastEmptyAt = 0;
  }

  /** Rich loot crates on a banquet table at the Cornucopia. Sets state.feast.ready. */
  Items.spawnFeast = function () {
    const st = GM.state;
    const R = GM.R;
    const c = cornucopia();
    let fx0, fz0;
    if (st.feast && typeof st.feast.x === 'number' && typeof st.feast.z === 'number') { fx0 = st.feast.x; fz0 = st.feast.z; }
    else { fx0 = c.x + Math.sin(c.heading) * 9; fz0 = c.z + Math.cos(c.heading) * 9; }
    // an older feast table goes; its crates drop to the ground
    removeFeastTable();
    for (let i = 0; i < Items.list.length; i++) if (Items.list[i].feast) Items.list[i].tableY = 0;

    const gy = groundY(fx0, fz0);
    const rot = Math.atan2(fx0 - c.x, fz0 - c.z);
    if (hasThree()) {
      ensureMaterials();
      feastTable = new THREE.Group();
      const top = new THREE.Mesh(geo('table'), itemMat);
      top.castShadow = true;
      top.receiveShadow = true;
      feastTable.add(top);
      feastTable.position.set(fx0, gy, fz0);
      feastTable.rotation.y = rot;
      noPick(feastTable);
      addToScene(feastTable);
    }
    const n = R.int(3, 5);
    const specials = R.shuffle([['trident', 'armor'], ['bow', 'arrows', 'arrows'], ['armor', 'medkit', 'goggles'], ['sword', 'armor'], ['sleeping_bag', 'medkit', 'throwing_knives']]);
    const crates = [];
    for (let i = 0; i < n; i++) {
      const off = n === 1 ? 0 : -2.4 + (4.8 * i) / (n - 1);
      const x = fx0 + Math.cos(rot) * off;
      const z = fz0 - Math.sin(rot) * off;
      const contents = ['food', 'food', 'water', 'water', 'medkit'].concat(specials[i % specials.length]);
      const it = Items.spawn('crate', x, z, { crate: true, feast: true, contents: contents, tier: 3 });
      it.tableY = 0.93;
      it.groundY = gy;
      it.source = 'feast';
      it.yaw = rot;
      if (it.mesh) it.mesh.rotation.y = rot;
      placeCrate(it);
      crates.push(it);
    }
    const pos = { x: fx0, y: gy, z: fz0 };
    if (!st.feast) st.feast = { x: fx0, z: fz0, at: st.time, ready: true };
    st.feast.x = fx0;
    st.feast.z = fz0;
    st.feast.ready = true;
    st.feast.over = false;
    GM.emit('feast:ready', { pos: pos });
    try { GM.announce('ann.feastReady', {}, { style: 'gold', duration: 5 }); } catch (err) { GM.reportError('Items.announce', err); }
    logItem('log.item.feast', {}, null, { pos: pos }, true);
    interest({ pos: pos, score: 8, duration: 45, label: { key: 'item.interest.feast', params: {} }, kind: 'feast', key: 'feast' });
    aiNoise(pos, 120, 'lure', null);
    fx('burst', { x: fx0, y: gy + 1.2, z: fz0 }, { count: 30, color: 0xffd36b, color2: 0xffffff, speed: 5, up: 5, size: 0.2, life: 1.4, additive: true });
    fx('flash', { x: fx0, y: gy + 3, z: fz0 }, 0xffd36b, 2.5, 30, 0.5);
    sfx('drop', pos, 1);
    return crates;
  };

  // ================================================================= traps
  /** Tribute t hides a trap at its feet (uses one trap kit). Owner is immune. */
  Items.placeTrap = function (t) {
    if (!t || !t.alive || !t.inv || (t.inv.traps || 0) <= 0) return false;
    const x = t.pos.x, z = t.pos.z;
    if (isWater(x, z)) return false;
    for (let i = 0; i < Items.traps.length; i++) {
      const tr = Items.traps[i];
      if (tr.armed && (tr.pos.x - x) * (tr.pos.x - x) + (tr.pos.z - z) * (tr.pos.z - z) < 2.5 * 2.5) return false;
    }
    t.inv.traps--;
    const gy = groundY(x, z);
    const trap = {
      id: nextId++, pos: hasThree() ? new THREE.Vector3(x, gy, z) : { x: x, y: gy, z: z },
      ownerId: t.id, armed: true, mesh: null, placedAt: GM.state.time, sprungAt: null, victimId: null,
    };
    if (hasThree()) {
      ensureMaterials();
      const m = new THREE.Mesh(geo('trap'), trapMat);
      m.position.set(x, gy, z);
      m.rotation.y = Math.random() * Math.PI * 2;
      m.scale.setScalar(0.9);
      m.receiveShadow = true;
      m.raycast = function () {};
      trap.mesh = m;
      addToScene(m);
    }
    Items.traps.push(trap);
    logItem('log.item.trapSet', { name: t.name }, t, null, false);
    GM.emit('item:used', { tribute: t, type: 'trap_kit' });
    const Tr = GM.Tributes;
    if (Tr && typeof Tr.gesture === 'function') {
      try { Tr.gesture(t, 'trap', 1.4); } catch (err) { GM.reportError('Items.gesture', err); }
    }
    touchTribute(t);
    return true;
  };

  /** Armed trap near a point (for AI: own traps / suspicious ground). */
  Items.trapAt = function (pos, r, filter) {
    const r2 = (r || 1) * (r || 1);
    for (let i = 0; i < Items.traps.length; i++) {
      const tr = Items.traps[i];
      if (!tr.armed) continue;
      const dx = tr.pos.x - pos.x, dz = tr.pos.z - pos.z;
      if (dx * dx + dz * dz <= r2 && (!filter || filter(tr))) return tr;
    }
    return null;
  };

  function triggerTrap(trap, t, m) {
    const st = GM.state;
    trap.armed = false;
    trap.sprungAt = st.time;
    if (trap.mesh) {
      trap.mesh.geometry = geo('trapSprung');
      trap.mesh.material = itemMat;
      trap.mesh.scale.setScalar(1);
      trap.mesh.castShadow = true;
    }
    const owner = tribute(trap.ownerId);
    const p = { x: trap.pos.x, y: trap.pos.y + 0.3, z: trap.pos.z };
    fx('burst', p, { count: 14, color: 0x5a4630, color2: 0x7a0f12, speed: 3.5, up: 3, size: 0.16, life: 0.8 });
    fx('ring', trap.pos, 0xb03030, 2.5, 0.5);
    sfx('trap', trap.pos, 1);
    if (t) {
      trap.victimId = t.id;
      if (owner) logItem('log.item.trapHitBy', { victim: t.name, owner: owner.name }, t, null, true);
      else logItem('log.item.trapHit', { victim: t.name }, t, null, true);
      GM.emit('trap:triggered', { tribute: t, ownerId: trap.ownerId, pos: trap.pos });
      const Tr = GM.Tributes;
      if (Tr && typeof Tr.damage === 'function') {
        try {
          Tr.damage(t, TRAP_DAMAGE, { cause: 'trap', attacker: null, mutt: null, weapon: null, pos: trap.pos, trapOwnerId: trap.ownerId });
          if (t.alive && typeof Tr.stun === 'function') Tr.stun(t, TRAP_STUN);
        } catch (err) { GM.reportError('Items.trapDamage', err); }
      }
      aiNoise(trap.pos, 30, 'scream', t.id);
      interest({
        pos: trap.pos, score: 6, duration: 8, label: { key: 'item.interest.trap', params: {} },
        followId: t.id, kind: 'trap', key: 'trap:' + trap.id,
      });
    } else if (m) {
      if (owner) logItem('log.item.trapMutt', { owner: owner.name }, owner, null, false);
      const M = GM.Mutts;
      if (M && typeof M.damage === 'function') {
        try { M.damage(m, TRAP_DAMAGE, owner || null); } catch (err) { GM.reportError('Items.trapMutt', err); }
      }
    }
  }

  function checkTraps() {
    const traps = Items.traps;
    if (!traps.length) return;
    const ts = GM.state.tributes;
    const mutts = GM.state.mutts || [];
    const r2 = TRAP_RADIUS * TRAP_RADIUS;
    for (let i = 0; i < traps.length; i++) {
      const trap = traps[i];
      if (!trap.armed) continue;
      for (let k = 0; k < ts.length; k++) {
        const t = ts[k];
        if (!t.alive || t.id === trap.ownerId || t.swimming) continue;
        const dx = t.pos.x - trap.pos.x, dz = t.pos.z - trap.pos.z;
        if (dx * dx + dz * dz < r2) { triggerTrap(trap, t, null); break; }
      }
      if (!trap.armed) continue;
      for (let k = 0; k < mutts.length; k++) {
        const m = mutts[k];
        if (!m || !m.alive || m.type !== 'wolf' || !m.pos) continue;
        const dx = m.pos.x - trap.pos.x, dz = m.pos.z - trap.pos.z;
        if (dx * dx + dz * dz < r2) { triggerTrap(trap, null, m); break; }
      }
    }
  }

  // ============================================================ simulation
  function land(item) {
    item.falling = false;
    item.fallY = 0;
    item.vy = 0;
    item.landedAt = GM.state.time;
    item.groundY = groundY(item.pos.x, item.pos.z);
    item.pos.y = Math.max(item.groundY, waterY() - 0.1);
    if (!item.crate) return;
    const p = item.pos;
    fx('burst', { x: p.x, y: p.y + 0.2, z: p.z }, { count: item.gift ? 10 : 22, color: 0xcbb48a, color2: 0x9c8a66, speed: 3, up: 1.5, size: 0.3, life: 1.1, gravity: -3 });
    fx('ring', p, item.gift ? 0xdfe8f2 : 0xffc36b, item.gift ? 2.5 : 5, 0.7);
    sfx('drop', p, item.gift ? 0.6 : 1);
    if (item._vis && item._vis.beam) item._vis.beam.visible = true;
    if (!item.gift) {
      aiNoise(p, 55, 'lure', null);
      interest({
        pos: p, score: 3, duration: 20, label: { key: 'item.interest.crate', params: {} },
        kind: 'drop', key: 'drop:' + item.id,
      });
    }
    GM.emit('crate:landed', { item: item, pos: item.pos });
  }

  function updateFeast() {
    const st = GM.state;
    if (!feastTable) return;
    let any = false;
    for (let i = 0; i < Items.list.length; i++) if (Items.list[i].feast) { any = true; break; }
    if (any) { feastEmptyAt = 0; return; }
    if (!feastEmptyAt) {
      feastEmptyAt = st.time;
      if (st.feast) { st.feast.ready = false; st.feast.over = true; }
      return;
    }
    if (st.time - feastEmptyAt > 30) {
      const f = st.feast;
      removeFeastTable();
      if (f && f.over && GM.state.feast === f) GM.state.feast = null;
    }
  }

  function updateSprungTraps() {
    const st = GM.state;
    const traps = Items.traps;
    for (let i = traps.length - 1; i >= 0; i--) {
      const tr = traps[i];
      if (tr.armed || tr.sprungAt == null) continue;
      if (st.time - tr.sprungAt > 25) {
        if (tr.mesh) removeFromScene(tr.mesh);
        tr.mesh = null;
        traps.splice(i, 1);
      }
    }
  }

  function update(dt) {
    const list = Items.list;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (!it.falling) continue;
      if (it.crate) {
        // parachute: slow, gets a little slower near the ground
        const v = it.fallY < 6 ? it.vy * 0.8 : it.vy;
        it.fallY += v * dt;
      } else {
        it.vy -= 14 * dt;
        it.fallY += it.vy * dt;
      }
      if (it.fallY <= 0) land(it);
    }
    if (GM.state.phase === 'running') {
      trapTimer -= dt;
      if (trapTimer <= 0) {
        trapTimer = 0.1;
        checkTraps();
      }
    }
    updateSprungTraps();
    updateFeast();
  }

  // ================================================================ visuals
  const TYPE_SCALE = { spear: 1.0, trident: 1.0, bow: 1.05, sword: 1.15, axe: 1.2, mace: 1.25, backpack: 1.15, armor: 1.2 };
  function rgbOf(def) {
    if (!def._rgb) {
      initTemps();
      _c.set(def.color || '#ffffff');
      def._rgb = [_c.r, _c.g, _c.b];
    }
    return def._rgb;
  }

  function frame(realDt) {
    if (!GM.state.paused) animClock += realDt;
    if (!hasThree() || (!pools && !glint)) return;
    initTemps();
    const wy = waterY();
    const st = GM.state;
    let gi = 0;
    const list = Items.list;
    const gpos = glint ? glint.pos : null;
    const gcol = glint ? glint.col : null;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const def = ItemDefs[it.type];
      if (it.crate) {
        placeCrate(it);
        const v = it._vis;
        if (v) {
          if (v.chute) {
            if (it.falling) {
              v.chute.visible = true;
              v.chute.scale.set(1, 1, 1);
            } else if (v.chute.visible) {
              const k = U.clamp01((st.time - (it.landedAt || st.time)) / 1.6);
              v.chute.scale.set(1 + 0.35 * k, Math.max(0.05, 1 - 0.95 * k), 1 + 0.35 * k);
              v.chute.position.x = k * 1.2;
              if (k >= 1) v.chute.visible = false;
            }
          }
          if (v.beacon) v.beacon.visible = ((animClock + it.phase) % 1) < 0.5;
          if (v.beam && v.beam.visible) v.beam.scale.set(1, 0.85 + 0.15 * Math.sin(animClock * 2 + it.phase), 1);
        }
        if (gpos && gi < GLINT_MAX) {
          const y = it.pos.y + (it.falling ? it.fallY : 0) + (it.feast ? (it.tableY || 0) : 0) + 1.2;
          gpos[gi * 3] = it.pos.x; gpos[gi * 3 + 1] = y; gpos[gi * 3 + 2] = it.pos.z;
          const s = Math.sin(animClock * 2.4 + it.phase * 3);
          const k = 0.2 + 0.8 * Math.pow(Math.max(0, s), 12);
          gcol[gi * 3] = 1.0 * k; gcol[gi * 3 + 1] = 0.85 * k; gcol[gi * 3 + 2] = 0.45 * k;
          gi++;
        }
        continue;
      }
      const base = Math.max(it.groundY, wy - 0.05);
      const bob = 0.14 + 0.05 * Math.sin(animClock * 2 + it.phase);
      const y = base + bob + (it.falling ? it.fallY : 0);
      const scl = (TYPE_SCALE[it.type] || 1.35);
      const yaw = it.yaw + animClock * 0.45;
      if (it._slot != null) {
        const p = pools[it.type];
        _p.set(it.pos.x, y, it.pos.z);
        _e.set(0, yaw, 0);
        _q.setFromEuler(_e);
        _s.set(scl, scl, scl);
        _m4.compose(_p, _q, _s);
        p.mesh.setMatrixAt(it._slot, _m4);
      } else if (it.mesh) {
        it.mesh.position.set(it.pos.x, y, it.pos.z);
        it.mesh.rotation.y = yaw;
        it.mesh.scale.setScalar(scl);
      }
      it.pos.y = base;
      if (gpos && gi < GLINT_MAX) {
        gpos[gi * 3] = it.pos.x; gpos[gi * 3 + 1] = y + 0.3; gpos[gi * 3 + 2] = it.pos.z;
        const s = Math.sin(animClock * 1.7 + it.phase * 3);
        const k = 0.13 + 0.87 * Math.pow(Math.max(0, s), 16);
        const c = rgbOf(def);
        const w = def.kind === 'melee' || def.kind === 'ranged' ? 1 : 0.75;
        gcol[gi * 3] = (0.55 + 0.45 * c[0]) * k * w;
        gcol[gi * 3 + 1] = (0.55 + 0.45 * c[1]) * k * w;
        gcol[gi * 3 + 2] = (0.55 + 0.45 * c[2]) * k * w;
        gi++;
      }
    }
    if (pools) {
      for (const type in pools) {
        const p = pools[type];
        if (p.items.length) p.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    if (glint) {
      glint.points.geometry.setDrawRange(0, gi);
      glint.pa.needsUpdate = true;
      glint.ca.needsUpdate = true;
    }
  }

  // ============================================================ lifecycle
  function clearAll() {
    const list = Items.list;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (it.mesh) removeFromScene(it.mesh);
      it.mesh = null;
      it._vis = null;
      it._slot = null;
      it.removed = true;
    }
    list.length = 0;
    if (pools) {
      for (const type in pools) {
        pools[type].items.length = 0;
        pools[type].mesh.count = 0;
      }
    }
    for (let i = 0; i < Items.traps.length; i++) {
      if (Items.traps[i].mesh) removeFromScene(Items.traps[i].mesh);
    }
    Items.traps.length = 0;
    removeFeastTable();
    if (glint) glint.points.geometry.setDrawRange(0, 0);
    trapTimer = 0;
  }

  function reattach() {
    scene = GM.World && GM.World.scene ? GM.World.scene : scene;
    if (!scene) return;
    if (pools) for (const type in pools) if (pools[type].mesh.parent !== scene) scene.add(pools[type].mesh);
    if (glint && glint.points.parent !== scene) scene.add(glint.points);
  }

  function onTerrainChanged(e) {
    if (!e) return;
    const r = (e.radius || 10) + 2;
    const r2 = r * r;
    const list = Items.list;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const dx = it.pos.x - e.x, dz = it.pos.z - e.z;
      if (dx * dx + dz * dz <= r2) it.groundY = groundY(it.pos.x, it.pos.z);
    }
    for (let i = 0; i < Items.traps.length; i++) {
      const tr = Items.traps[i];
      const dx = tr.pos.x - e.x, dz = tr.pos.z - e.z;
      if (dx * dx + dz * dz <= r2) {
        tr.pos.y = groundY(tr.pos.x, tr.pos.z);
        if (tr.mesh) tr.mesh.position.y = tr.pos.y;
      }
    }
    if (feastTable) {
      const dx = feastTable.position.x - e.x, dz = feastTable.position.z - e.z;
      if (dx * dx + dz * dz <= r2) feastTable.position.y = groundY(feastTable.position.x, feastTable.position.z);
    }
  }

  GM.registerSystem({
    name: 'Items',
    order: 40,
    init: function () {
      if (!hasThree()) return;
      initTemps();
      ensureMaterials();
      scene = GM.World && GM.World.scene ? GM.World.scene : null;
      if (!listenersOn) {
        listenersOn = true;
        GM.on('terrain:changed', onTerrainChanged);
      }
    },
    clear: clearAll,
    reset: function (settings) {
      clearAll();
      reattach();
      const n = settings && settings.roster && settings.roster.length ? settings.roster.length
        : (GM.state.tributes.length || CFG.DEFAULT_TRIBUTES);
      try { Items.spawnCornucopiaLoot(Math.round(1.6 * n)); } catch (err) { GM.reportError('Items.cornucopiaLoot', err); }
      try { Items.spawnScatteredLoot(40); } catch (err) { GM.reportError('Items.scatteredLoot', err); }
    },
    update: update,
    frame: frame,
  });
})();
