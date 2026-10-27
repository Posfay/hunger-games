/* ==========================================================================
 * arenas.js — arena themes: the registry, the parameter set, the player's choice.
 *
 * An arena theme is a set of numbers and colours that Terrain (shape, biomes, ground
 * colours), World (trees, grass, water, far mountains) and Env (sky, fog, weather,
 * snow and wet ground) read while they build an arena. The classic arena ("verdant") is
 * the defaults below; they reproduce the original hard-coded values exactly, so every
 * arena code keeps making the same arena (tools/arena-test.js checks this).
 *
 *   GM.Arenas.register({ id, pack, icon, params })   add a theme (js/packs/*.js do this)
 *   GM.Arenas.use(id)                                make a theme the active one (unknown -> verdant)
 *   GM.Arenas.active() / params()                    active id / its complete parameter set
 *   GM.Arenas.has(id) / owned(id)                    a theme is installed
 *   GM.Arenas.list()                                 [{ id, icon, pack, owned }] in display order
 *   GM.Arenas.selected() / select(id)                the player's pick on the setup screen (saved)
 *   GM.Arenas.PACKS                                  packs the base game knows by name (id -> { icon, arenas })
 *
 * The base game knows the NAMES of the pack arenas (so locked cards can be shown) but not
 * their parameters: those arrive with the pack file. Events: 'arenas:changed'. Owner: core.
 * ========================================================================== */
(function () {
  'use strict';
  const GM = window.GM;

  // ================================================================== defaults
  /**
   * Every key a theme may override. Colours are 0..255 triples (+ per-channel variation where
   * noted), hex numbers where THREE.Color takes them.
   */
  const DEFAULTS = {
    terrain: {
      lakes: null,                // [min, max] lakes, or null = the classic 1..3 distribution
      lakeR: 1,                   // lake radius multiplier
      hills: null,                // [min, max] rocky hills, or null = classic 2..4
      hillH: 1,                   // hill height multiplier
      hillR: 1,                   // hill radius multiplier
      stream: 0.7,                // chance of a stream
      base: 3.0,                  // base ground height (m)
      rise: 3.6,                  // gentle rise towards the rim (m)
      noise: 3.4,                 // large-scale roughness (m)
      rim: 1,                     // rim mountain height multiplier
      snowLine: 44,               // ground above this height (+ variation) is snow
      rockSlope: [0.3, 0.48],     // slope range (0..1) where ground turns to rock
      rockH: [24, 34],            // height range where ground turns to rock
      sandMoist: 0.25,            // near-water sand needs more moisture than this
      dryland: 0,                 // > 0: land drier than this becomes sand (deserts)
      swamp: [2.6, 0.58],         // swamp: below this height, above this moisture
      forest: 1,                  // tree cover multiplier
      treeLine: [30, 42],         // tree cover fades out between these heights
      boulders: 1,                // boulder count multiplier
      moistNoise: 0.45,           // weight of the large-scale moisture noise
      moistBias: 0,               // added to the moisture map (wetter > 0 > drier)
    },
    pal: {
      bed: [166, 150, 104], bedDeep: [76, 86, 66],                    // lake bed: shallow -> deep
      sand: [214, 196, 142, 16, 14, 10],                              // base rgb + variation rgb
      rockLo: [112, 106, 98], rockHi: [138, 134, 132], rockVar: [22, 20, 18],
      snow: [232, 236, 242, 12, 12, 10],
      swamp: [78, 92, 50, 16, 14, 8],
      grass: [[88, 138, 54], [106, 152, 60], [124, 162, 66]],        // three meadow greens
      dry: [150, 150, 78],                                            // dry-ground tint (higher up, low moisture)
      alpine: [118, 122, 96],                                         // near the rim
      forestFloor: [50, 80, 38, 14, 12, 6],                           // ground under trees
    },
    trees: {
      density: 1, lone: 0.01, scale: 1,
      pine: 0,                                                        // added to the conifer score (+ = more conifers)
      onSand: false, onSnow: false,                                   // may lone trees stand on sand / snow
      pineCol: [0.37, 0.42, 0.2],                                     // hue, saturation, lightness
      broadCol: [0.24, 0.5, 0.28],
      autumn: 0.05, autumnCol: [0.07, 0.66, 0.42],                    // a few off-colour broadleaves
      trunkCol: [0.07, 0.3, 0.2],
    },
    grass: {
      byBiome: { grass: 1, swamp: 0.85, forest: 0.55, rock: 0.12, sand: 0, snow: 0 },
      tint: [1.02, 1.12, 0.9],
    },
    water: { shallow: 0x3fa5a8, deep: 0x0e3f52 },
    backdrop: {
      snowH: 88, rockH: 34,
      lo: [62, 84, 52, 14, 14, 8], rock: [118, 114, 108, 16, 14, 12], snow: [228, 232, 238, 0, 0, 0],
    },
    env: {
      sky: {},                                                        // palette overrides, e.g. { dayZen: 0x3f7fd6 } (see env.js)
      weather: { rain: 1, fog: 1, storm: 1, snow: 1, heat: 1 },      // multipliers of the natural weather odds
      snowFloor: 0,                                                   // ground / trees never have less snow cover than this
      wetFloor: 0,                                                    // ... or less wetness than this
    },
  };

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  /** Deep merge: objects merge, arrays and scalars replace. Never touches the inputs. */
  function merge(base, over) {
    const out = clone(base);
    (function walk(dst, src) {
      for (const k in src) {
        if (isObj(src[k]) && isObj(dst[k])) walk(dst[k], src[k]);
        else dst[k] = clone(src[k]);
      }
    })(out, over || {});
    return out;
  }

  // ================================================================== registry
  const DEFAULT_ID = 'verdant';
  const reg = Object.create(null);   // id -> { id, pack, icon, params }
  const order = [];
  let activeId = DEFAULT_ID;

  const Arenas = (GM.Arenas = {
    DEFAULT_ID: DEFAULT_ID,
    DEFAULTS: DEFAULTS,
    /** Packs the base game knows by name. Their arenas come with the pack file. */
    PACKS: {
      expedition: { id: 'expedition', icon: '🧭', arenas: ['dunes', 'frost', 'mire'] },
    },
  });

  /** Names and one-line pitches live here so locked cards can show them; keep in step with the pack. */
  GM.i18n.add({
    en: {
      'arena.verdant': 'Verdant Basin', 'arena.verdant.desc': 'The classic arena: meadows, forests, lakes and rocky hills.',
      'arena.dunes': 'Dune Sea', 'arena.dunes.desc': 'Burning sand and red mesas. Water is rare and heat waves are common, so every drink counts.',
      'arena.frost': 'Frostfall', 'arena.frost.desc': 'A valley under permanent snow. Cold nights wear contestants down, and a sleeping bag is worth fighting for.',
      'arena.mire': 'Drowned Mire', 'arena.mire.desc': 'Black water, thick forest and fog. Cover is everywhere, so every ambush is a surprise.',
      'pack.expedition': 'Expedition Pack',
      'pack.expedition.desc': 'Three new arenas: Dune Sea, Frostfall and Drowned Mire.',
    },
    hu: {
      'arena.verdant': 'Zöld medence', 'arena.verdant.desc': 'A klasszikus aréna: rétek, erdők, tavak és sziklás dombok.',
      'arena.dunes': 'Dűnetenger', 'arena.dunes.desc': 'Perzselő homok és vörös fennsíkok. A víz ritka, a hőség gyakori, ezért minden korty számít.',
      'arena.frost': 'Fagyvölgy', 'arena.frost.desc': 'Egy völgy örök hóban. A hideg éjszakák felőrlik a versenyzőket, és egy hálózsákért érdemes harcolni.',
      'arena.mire': 'Elsüllyedt láp', 'arena.mire.desc': 'Fekete víz, sűrű erdő és köd. Mindenhol van fedezék, ezért minden lesből támadás meglepetés.',
      'pack.expedition': 'Expedíció csomag',
      'pack.expedition.desc': 'Három új aréna: Dűnetenger, Fagyvölgy és Elsüllyedt láp.',
    },
  });

  Arenas.register = function (def) {
    if (!def || !def.id) throw new Error('Arenas.register: an arena needs an id');
    const first = !reg[def.id];
    reg[def.id] = { id: def.id, pack: def.pack || null, icon: def.icon || '🗺️', params: merge(DEFAULTS, def.params) };
    if (first) order.push(def.id);
    GM.emit('arenas:changed', { id: def.id });
    return reg[def.id];
  };
  Arenas.has = function (id) { return !!reg[id]; };
  Arenas.owned = Arenas.has;
  Arenas.active = function () { return activeId; };
  Arenas.params = function () { return (reg[activeId] || reg[DEFAULT_ID]).params; };
  /** Make `id` the active arena (unknown ids fall back to the classic one). -> the id in use */
  Arenas.use = function (id) {
    activeId = reg[id] ? id : DEFAULT_ID;
    return activeId;
  };
  Arenas.icon = function (id) { return reg[id] ? reg[id].icon : '🗺️'; };

  /** Display order: classic first, then every pack arena the base game knows (owned or not). */
  Arenas.list = function () {
    const out = [{ id: DEFAULT_ID, icon: reg[DEFAULT_ID].icon, pack: null, owned: true }];
    for (const pid in Arenas.PACKS) {
      const p = Arenas.PACKS[pid];
      p.arenas.forEach(function (id) { out.push({ id: id, icon: reg[id] ? reg[id].icon : '🔒', pack: pid, owned: !!reg[id] }); });
    }
    for (const id of order) if (!out.some(function (o) { return o.id === id; })) out.push({ id: id, icon: reg[id].icon, pack: reg[id].pack, owned: true });
    return out;
  };
  /** Pack ids with at least one missing arena. */
  Arenas.lockedPacks = function () {
    return Object.keys(Arenas.PACKS).filter(function (pid) { return Arenas.PACKS[pid].arenas.some(function (id) { return !reg[id]; }); });
  };

  // ============================================================ the player's pick
  const data = GM.Save ? GM.Save.section('arenas', { selected: DEFAULT_ID }) : { selected: DEFAULT_ID };
  /** The arena chosen on the setup screen (falls back to the classic one when its pack is gone). */
  Arenas.selected = function () { return reg[data.selected] ? data.selected : DEFAULT_ID; };
  Arenas.select = function (id) {
    if (!reg[id] || data.selected === id) return false;
    data.selected = id;
    if (GM.Save) GM.Save.commit();
    GM.emit('arenas:changed', { selected: id });
    return true;
  };

  // The classic arena: nothing overridden.
  Arenas.register({ id: DEFAULT_ID, pack: null, icon: '🌲', params: {} });
})();
