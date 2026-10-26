/* ==========================================================================
 * career.js — career mode: seasons, episodes, objectives, rewards, upgrades.
 *
 * You run a TV network. A season is 6 episodes (Shows). Every episode has a
 * brief from the Studio: a ratings target plus bonus objectives. Grades,
 * objectives and stars earn Credits (spent on upgrades) and Reputation
 * (levels unlock Showrunner powers and bigger casts). Progress is saved by
 * GM.Save after every episode and purchase.
 *
 *   GM.Career.active()            a career Show is running (settings.career set)
 *   GM.Career.mods()              upgrade modifiers for GM.Powers (neutral outside career)
 *   GM.Career.isUnlocked(powerId) / unlockLevel(powerId)
 *   GM.Career.brief()             the current episode brief (generated on demand)
 *   GM.Career.startEpisode()      launch the current brief
 *   GM.Career.progress()          live objective states for the HUD
 *   GM.Career.buy(id) / canBuy(id)
 *   GM.Career.results()           last finished episode (null after a restart)
 *
 * Events: 'career:changed', 'career:results' {results}, 'career:levelup' {level},
 * 'career:trophy' {id}.
 * Pure logic: no DOM here (see careerui.js). Owner: core.
 * ========================================================================== */
(function () {
  'use strict';
  const GM = window.GM;
  const U = GM.U;

  // ============================================================ tuning tables
  const EPISODES = 6;
  /** Total reputation needed for level 1..10. */
  const LEVEL_XP = [0, 100, 260, 480, 760, 1100, 1500, 1960, 2480, 3060];
  const MAX_LEVEL = LEVEL_XP.length;
  /** Biggest cast per level. */
  const CAST_CAP = [12, 14, 16, 20, 24, 28, 32, 38, 44, 48];
  /** Power id -> { lv: level that unlocks it, cat: category }. */
  const POWERS = {
    supply_drop: { lv: 1, cat: 'gift' }, sponsor_gift: { lv: 1, cat: 'gift' }, feast: { lv: 2, cat: 'gift' },
    weather: { lv: 1, cat: 'nature' }, time_skip: { lv: 1, cat: 'nature' }, terraform: { lv: 1, cat: 'nature' },
    flood: { lv: 4, cat: 'nature' }, quake: { lv: 4, cat: 'nature' },
    lightning: { lv: 1, cat: 'hazard' }, fireball: { lv: 2, cat: 'hazard' }, poison_fog: { lv: 3, cat: 'hazard' },
    wasps: { lv: 3, cat: 'hazard' }, beasts: { lv: 5, cat: 'hazard' }, madness_gas: { lv: 5, cat: 'hazard' },
    lure: { lv: 1, cat: 'rule' }, reveal: { lv: 4, cat: 'rule' }, shrink_zone: { lv: 6, cat: 'rule' }, smite: { lv: 7, cat: 'rule' },
  };
  const CATEGORIES = ['gift', 'nature', 'hazard', 'rule'];
  const GRADES = ['D', 'C', 'B', 'A', 'S'];
  /**
   * Show score needed for S, A, B, C in career Shows (free play uses 62 / 50 / 38 / 27).
   * Measured with tools/smoke.js: a Show where the player does nothing scores ~52, a
   * player using powers at random ~76-87. So: C = passive, B = some effort, A = good, S = excellent.
   */
  const GRADE_CUTS = Object.freeze([80, 68, 56, 44]);
  const GRADE_CREDITS = { S: 150, A: 110, B: 75, C: 45, D: 20 };
  const GRADE_REP = { S: 120, A: 90, B: 60, C: 35, D: 15 };
  const PRIMARY_REWARD = { credits: 40, rep: 25 };
  const BONUS_REWARD = { credits: 35, rep: 20 };
  const SEASON_STAR_CREDITS = 20;         // season bonus per star earned
  const SEASON_SCALE = 0.12;              // rewards grow per season
  /** Rating target (grade rank) by episode of season 1; +1 rank per later season. */
  const PRIMARY_RANK = [1, 1, 2, 2, 3, 3];

  /** Studio upgrades: cost of each level, effect per level is in mods(). */
  const UPGRADES = [
    { id: 'power', icon: '🔋', max: 5, costs: [80, 140, 220, 330, 480] },
    { id: 'regen', icon: '📡', max: 5, costs: [90, 150, 230, 340, 490] },
    { id: 'rigging', icon: '⚙️', max: 5, costs: [100, 170, 260, 380, 540] },
    { id: 'hype', icon: '🎆', max: 5, costs: [110, 180, 280, 400, 560] },
    { id: 'sponsors', icon: '🤝', max: 4, costs: [70, 130, 210, 320] },
    { id: 'writers', icon: '✍️', max: 1, costs: [250], minLevel: 4 },
  ];
  const UPGRADE_BY_ID = Object.create(null);
  UPGRADES.forEach(function (u) { UPGRADE_BY_ID[u.id] = u; });

  const BASE_MODS = Object.freeze({ maxEnergy: 100, startEnergy: 60, regen: 1, cooldown: 1, hype: 1 });
  const ARCHETYPES = ['survivor', 'scavenger', 'opportunist', 'strategist', 'protector', 'lonewolf'];   // crown targets
  const TITLE_WORDS = 12;

  // ================================================================ save data
  const data = GM.Save ? GM.Save.section('career', {
    mode: 'career',          // last screen the player used: 'career' | 'freeplay'
    started: false,
    seed: 0,                 // career seed: every season / episode is derived from it
    rep: 0,
    credits: 0,
    season: 1,
    episode: 1,
    brief: null,             // the current episode's brief (kept so a retry is the same Show)
    seasonDone: false,       // all episodes played; waiting for "next season"
    seasons: {},             // season -> { eps: { n: record }, stars }
    upgrades: {},            // id -> level
    trophies: {},            // id -> timestamp
    stats: { shows: 0, freeShows: 0, kills: 0, deaths: 0, days: 0, powers: 0, bestViewers: 0, bestScore: 0, stars: 0, grades: { S: 0, A: 0, B: 0, C: 0, D: 0 }, wins: {} },
    history: [],             // last finished episodes, newest last
  }) : null;

  function commit() { if (GM.Save) GM.Save.commit(); }

  // ================================================================= helpers
  function rankOf(g) { return Math.max(0, GRADES.indexOf(g)); }
  function levelOf(rep) {
    let lv = 1;
    for (let i = 1; i < MAX_LEVEL; i++) if (rep >= LEVEL_XP[i]) lv = i + 1;
    return lv;
  }
  function upgradeLevel(id) { return (data.upgrades[id] | 0); }
  function seasonScale(season) { return 1 + SEASON_SCALE * (Math.max(1, season) - 1); }
  function difficulty(season, episode) { return (season - 1) * 0.8 + (episode - 1) * 0.25; }

  const Career = (GM.Career = {
    EPISODES: EPISODES, MAX_LEVEL: MAX_LEVEL, LEVEL_XP: LEVEL_XP, POWERS: POWERS, CATEGORIES: CATEGORIES,
    GRADES: GRADES, GRADE_CUTS: GRADE_CUTS, UPGRADES: UPGRADES, ARCHETYPES: ARCHETYPES, TITLE_WORDS: TITLE_WORDS, data: data,
  });

  // ================================================================== profile
  Career.level = function () { return levelOf(data.rep); };
  Career.rep = function () { return data.rep; };
  Career.credits = function () { return data.credits; };
  /** { level, cur, next, frac, max } — progress bar numbers inside the current level. */
  Career.levelProgress = function () {
    const lv = levelOf(data.rep);
    if (lv >= MAX_LEVEL) return { level: lv, cur: data.rep - LEVEL_XP[MAX_LEVEL - 1], next: 0, frac: 1, max: true };
    const lo = LEVEL_XP[lv - 1], hi = LEVEL_XP[lv];
    return { level: lv, cur: data.rep - lo, next: hi - lo, frac: U.clamp01((data.rep - lo) / (hi - lo)), max: false };
  };
  Career.castCap = function (level) { return CAST_CAP[U.clamp((level || levelOf(data.rep)) - 1, 0, CAST_CAP.length - 1)]; };
  Career.isUnlocked = function (id) { const p = POWERS[id]; return !p || levelOf(data.rep) >= p.lv; };
  Career.unlockLevel = function (id) { const p = POWERS[id]; return p ? p.lv : 1; };
  Career.powerCategory = function (id) { const p = POWERS[id]; return p ? p.cat : null; };
  Career.upgradeLevel = upgradeLevel;

  Career.mode = function () { return data.mode === 'freeplay' ? 'freeplay' : 'career'; };
  Career.setMode = function (m) {
    m = m === 'freeplay' ? 'freeplay' : 'career';
    if (data.mode === m) return;
    data.mode = m;
    commit();
    GM.emit('career:changed', { mode: m });
  };

  /** True while a career Show is on (countdown, running, or just ended). */
  Career.active = function () {
    const st = GM.state;
    const s = st && st.settings;
    return !!(s && s.career) && st.phase !== 'setup' && st.phase !== 'boot';
  };

  /**
   * Upgrade modifiers for a Show started with these settings (GM.Powers asks in its
   * reset(), before the phase changes). Neutral for free play.
   */
  Career.modsFor = function (settings) {
    const m = Object.assign({}, BASE_MODS);
    if (!settings || !settings.career) return m;
    m.maxEnergy += 10 * upgradeLevel('power');
    m.startEnergy += 10 * upgradeLevel('sponsors');
    m.regen += 0.1 * upgradeLevel('regen');
    m.cooldown -= 0.05 * upgradeLevel('rigging');
    m.hype += 0.06 * upgradeLevel('hype');
    m.startEnergy = Math.min(m.startEnergy, m.maxEnergy);
    return m;
  };
  Career.mods = function () { return Career.modsFor(Career.active() ? GM.state.settings : null); };
  Career.hasAssistant = function () { return upgradeLevel('writers') > 0; };

  // ============================================================== objectives
  // Every objective: make(rng, ctx) -> params | null (not eligible),
  //   check(params, s) -> bool at the end, progress(params, s) -> {done, locked, now, goal}.
  // s = snapshot() of the Show; ctx = { level, count, season, episode, d, archetypes }.
  function unlockedIn(cat, level) {
    let n = 0;
    for (const id in POWERS) if (POWERS[id].cat === cat && POWERS[id].lv <= level) n++;
    return n;
  }
  function unlockedCount(level) {
    let n = 0;
    for (const id in POWERS) if (POWERS[id].lv <= level) n++;
    return n;
  }

  const OBJ = {
    grade: {
      check(p, s) { return rankOf(s.grade) >= rankOf(p.g); },
      progress(p, s) { return { done: rankOf(s.grade) >= rankOf(p.g), locked: false, now: s.grade, goal: p.g }; },
    },
    viewers: {
      weight: 1.2,
      // peak viewers = (6M + 0.2M x excitement) x (1 + 0.15 x day): ~28M passive, 34M+ needs hype AND a longer Show
      make(rng, c) { return { n: Math.min(42, Math.round(30 + 3 * c.d)) }; },
      check(p, s) { return s.viewers >= p.n * 1e6; },
      progress(p, s) { const done = s.viewers >= p.n * 1e6; return { done: done, locked: done, now: Math.round(s.viewers / 1e5) / 10, goal: p.n }; },
    },
    betrayals: {
      weight: 1,
      // alliances (and so betrayals) are rare in small casts
      make(rng, c) { return c.count >= 14 ? { n: 1 + (c.count >= 20 ? 1 : 0) + Math.min(1, Math.floor(c.d / 2)) } : null; },
      check(p, s) { return s.betrayals >= p.n; },
      progress(p, s) { const done = s.betrayals >= p.n; return { done: done, locked: done, now: s.betrayals, goal: p.n }; },
    },
    crown: {
      weight: 0.8, mult: 1.5,
      make(rng, c) {
        const pool = (c.archetypes && c.archetypes.length ? c.archetypes : ARCHETYPES).filter(function (a) { return ARCHETYPES.indexOf(a) >= 0; });
        return pool.length ? { a: pool[Math.floor(rng() * pool.length)] } : null;
      },
      check(p, s) { return !!(s.winner && s.winner.archetype === p.a); },
      progress(p, s) { return { done: !!(s.winner && s.winner.archetype === p.a), locked: s.ended, now: null, goal: p.a }; },
    },
    long: {
      weight: 0.8, group: 'length',
      make(rng, c) { return { n: c.count >= 20 ? 4 : c.count >= 14 ? 3 : 2 }; },
      check(p, s) { return s.day >= p.n; },
      progress(p, s) { const done = s.day >= p.n; return { done: done, locked: done, now: s.day, goal: p.n }; },
    },
    quick: {
      weight: 0.8, group: 'length',
      make(rng, c) { return { n: c.count >= 20 ? 3 : 2 }; },
      check(p, s) { return s.ended && s.day <= p.n; },
      progress(p, s) { const fail = s.day > p.n; return { done: s.ended && !fail, locked: fail || s.ended, now: s.day, goal: p.n }; },
    },
    variety: {
      weight: 1,
      make(rng, c) { const n = Math.min(3 + Math.floor(c.d), unlockedCount(c.level) - 2); return n >= 3 ? { n: n } : null; },
      check(p, s) { return s.powerKinds >= p.n; },
      progress(p, s) { const done = s.powerKinds >= p.n; return { done: done, locked: done, now: s.powerKinds, goal: p.n }; },
    },
    category: {
      weight: 1,
      make(rng, c) {
        const cats = CATEGORIES.filter(function (k) { return unlockedIn(k, c.level) >= 2; });
        if (!cats.length) return null;
        const cat = cats[Math.floor(rng() * cats.length)];
        return { c: cat, n: Math.min(unlockedIn(cat, c.level), 2 + (c.d > 1.6 ? 1 : 0)) };
      },
      check(p, s) { return (s.byCategory[p.c] || 0) >= p.n; },
      progress(p, s) { const v = s.byCategory[p.c] || 0; const done = v >= p.n; return { done: done, locked: done, now: v, goal: p.n }; },
    },
    beasts: {
      weight: 0.9, minLevel: 3,
      make(rng, c) { return { n: 1 + Math.floor(c.d / 1.5) }; },
      check(p, s) { return s.beastDeaths >= p.n; },
      progress(p, s) { const done = s.beastDeaths >= p.n; return { done: done, locked: done, now: s.beastDeaths, goal: p.n }; },
    },
    minimal: {
      weight: 0.5, minLevel: 3, mult: 1.3,
      make(rng, c) { return { n: Math.round(5 + c.count / 4) }; },
      check(p, s) { return s.ended && s.powersUsed <= p.n; },
      progress(p, s) { const fail = s.powersUsed > p.n; return { done: s.ended && !fail, locked: fail || s.ended, now: s.powersUsed, goal: p.n }; },
    },
    favorite: {
      weight: 0.8,
      make(rng, c) { return { n: Math.round((0.55 + 0.03 * Math.min(c.d, 2)) * 100) }; },
      check(p, s) { return !!(s.winner && s.winner.popularity * 100 >= p.n); },
      progress(p, s) { return { done: !!(s.winner && s.winner.popularity * 100 >= p.n), locked: s.ended, now: s.winner ? Math.round(s.winner.popularity * 100) : null, goal: p.n }; },
    },
    topkill: {
      weight: 0.9,
      make(rng, c) { return { n: Math.min(9, 3 + Math.floor(c.count / 8) + Math.floor(c.d)) }; },
      check(p, s) { return s.topKills >= p.n; },
      progress(p, s) { const done = s.topKills >= p.n; return { done: done, locked: done, now: s.topKills, goal: p.n }; },
    },
  };
  Career.OBJECTIVES = OBJ;

  function objReward(o) { return o.primary ? PRIMARY_REWARD : BONUS_REWARD; }

  // ============================================================ brief builder
  function pickWeighted(rng, list, weightOf) {
    let total = 0;
    for (let i = 0; i < list.length; i++) total += weightOf(list[i]);
    let r = rng() * total;
    for (let i = 0; i < list.length; i++) {
      r -= weightOf(list[i]);
      if (r <= 0) return list[i];
    }
    return list[list.length - 1];
  }

  function rosterArchetypes(count, mix, seed) {
    try {
      const C = GM.Contestants;
      if (C && typeof C.generateRoster === 'function') return C.generateRoster(count, mix, seed).map(function (r) { return r.archetype; });
    } catch (e) { GM.reportError('Career.roster', e); }
    return null;
  }

  /** Episode title words (indices into the word lists). Independent of level, so old episodes keep their names. */
  Career.titleFor = function (season, episode) {
    const r = GM.makeRng(GM.hashString(data.seed + ':t:' + season + ':' + episode));
    return { a: Math.floor(r() * TITLE_WORDS), n: Math.floor(r() * TITLE_WORDS) };
  };

  /** Deterministic brief for (season, episode) given the career seed and level. */
  Career.makeBrief = function (season, episode, level) {
    level = level || levelOf(data.rep);
    const rng = GM.makeRng(GM.hashString(data.seed + ':' + season + ':' + episode));
    const d = difficulty(season, episode);
    let count = 8 + 2 * (episode - 1) + 3 * (season - 1);
    count = U.clamp(count, 6, Career.castCap(level));
    count -= count % 2;
    const mix = episode === 1 ? 'balanced'
      : episode === EPISODES ? pickWeighted(rng, ['chaos', 'bloodthirsty', 'balanced'], function (m) { return m === 'balanced' ? 1 : 1.6; })
        : pickWeighted(rng, ['balanced', 'bloodthirsty', 'peaceful', 'chaos'], function (m) { return m === 'balanced' ? 3 : m === 'bloodthirsty' ? 1.5 : 1; });
    const seed = 100000 + Math.floor(rng() * 900000);
    const arch = rosterArchetypes(count, mix, seed);
    const ctx = { level: level, count: count, season: season, episode: episode, d: d, archetypes: arch };

    const objectives = [{
      id: 'o0', type: 'grade', primary: true,
      params: { g: GRADES[Math.min(GRADES.length - 1, PRIMARY_RANK[episode - 1] + (season - 1))] },
      reward: { credits: PRIMARY_REWARD.credits, rep: PRIMARY_REWARD.rep },
    }];
    const types = Object.keys(OBJ).filter(function (k) { return k !== 'grade' && (OBJ[k].minLevel || 1) <= level; });
    const usedGroups = {};
    for (let slot = 1; slot <= 2; slot++) {
      let guard = 0;
      while (guard++ < 24 && types.length) {
        const k = pickWeighted(rng, types, function (x) { return OBJ[x].weight || 1; });
        const def = OBJ[k];
        if (objectives.some(function (o) { return o.type === k; })) continue;
        if (def.group && usedGroups[def.group]) continue;
        const params = def.make(rng, ctx);
        if (!params) continue;
        if (def.group) usedGroups[def.group] = true;
        const m = def.mult || 1;
        objectives.push({
          id: 'o' + slot, type: k, primary: false, params: params,
          reward: { credits: Math.round(BONUS_REWARD.credits * m), rep: Math.round(BONUS_REWARD.rep * m) },
        });
        break;
      }
    }
    return {
      id: 's' + season + 'e' + episode, season: season, episode: episode, seed: seed, count: count, mix: mix,
      title: Career.titleFor(season, episode),
      objectives: objectives,
    };
  };

  /** The current episode brief (generated and kept in the save on first use). */
  Career.brief = function () {
    if (!data.started) return null;
    if (!data.brief || data.brief.season !== data.season || data.brief.episode !== data.episode) {
      if (data.seasonDone) return null;
      data.brief = Career.makeBrief(data.season, data.episode);
      commit();
    }
    return data.brief;
  };

  // ============================================================ career control
  /** Start a new career (or the first one). */
  Career.begin = function () {
    data.started = true;
    data.seed = (GM.randomSeed() * 7919 + Date.now()) >>> 0;
    data.rep = 0;
    data.credits = 0;
    data.season = 1;
    data.episode = 1;
    data.brief = null;
    data.seasonDone = false;
    data.seasons = {};
    data.upgrades = {};
    data.history = [];
    data.mode = 'career';
    commit();
    GM.emit('career:changed', { began: true });
  };

  /** Wipe the whole career and all lifetime stats (back to the first-run state). */
  Career.reset = function () {
    if (GM.Save) GM.Save.reset();
    GM.emit('career:changed', { reset: true });
  };

  Career.nextSeason = function () {
    if (!data.started || !data.seasonDone) return false;
    data.season += 1;
    data.episode = 1;
    data.seasonDone = false;
    data.brief = null;
    commit();
    GM.emit('career:changed', { season: data.season });
    return true;
  };

  /** Launch the current brief as a new Show. */
  Career.startEpisode = function () {
    const b = Career.brief();
    if (!b || !GM.Game || GM.state.phase !== 'setup') return false;
    const opts = (GM.UI && typeof GM.UI.getOptions === 'function' && GM.UI.getOptions()) || {};
    const s = {
      seed: b.seed, contestantCount: b.count, mix: b.mix, roster: null,
      sandbox: false, autoGM: Career.hasAssistant() && !!opts.autoGM,
      quality: opts.quality === 'low' ? 'low' : 'high',
      feeds: opts.feeds !== false, nameTags: opts.nameTags !== false, startSpeed: 1,
      career: { season: b.season, episode: b.episode, id: b.id },
    };
    if (GM.Audio && typeof GM.Audio.unlock === 'function') { try { GM.Audio.unlock(); } catch (e) { /* optional */ } }
    GM.Game.newGame(s);
    if (GM.AutoGM && typeof GM.AutoGM.setEnabled === 'function') { try { GM.AutoGM.setEnabled(!!s.autoGM); } catch (e) { /* optional */ } }
    return true;
  };

  // ============================================================= upgrades shop
  /** -> { ok, reason: null|'max'|'level'|'credits'|'missing', cost, level } */
  Career.canBuy = function (id) {
    const u = UPGRADE_BY_ID[id];
    if (!u) return { ok: false, reason: 'missing', cost: 0, level: 0 };
    const lv = upgradeLevel(id);
    if (lv >= u.max) return { ok: false, reason: 'max', cost: 0, level: lv };
    const cost = u.costs[lv];
    if (u.minLevel && levelOf(data.rep) < u.minLevel) return { ok: false, reason: 'level', cost: cost, level: lv };
    if (data.credits < cost) return { ok: false, reason: 'credits', cost: cost, level: lv };
    return { ok: true, reason: null, cost: cost, level: lv };
  };
  Career.buy = function (id) {
    const c = Career.canBuy(id);
    if (!c.ok) return false;
    data.credits -= c.cost;
    data.upgrades[id] = c.level + 1;
    awardTrophies(null);
    commit();
    GM.emit('career:changed', { bought: id });
    return true;
  };

  // ======================================================== Show live tracking
  const live = {
    running: false,       // a career Show started and is not finalized
    finalized: false,
    betrayals: 0,
    beastDeaths: 0,
    powerCount: 0,
    used: Object.create(null),
    results: null,
  };
  function resetLive() {
    live.running = false;
    live.finalized = false;
    live.betrayals = 0;
    live.beastDeaths = 0;
    live.powerCount = 0;
    live.used = Object.create(null);
  }

  /** Numbers the objectives are judged on (works mid-Show and at the end). */
  function snapshot() {
    const st = GM.state;
    const A = GM.Audience;
    const winner = st.winner != null ? st.contestants[st.winner] : null;
    let top = 0;
    for (let i = 0; i < st.contestants.length; i++) top = Math.max(top, (st.contestants[i] && st.contestants[i].kills) || 0);
    const byCategory = {};
    let kinds = 0;
    for (const id in live.used) {
      kinds++;
      const cat = POWERS[id] ? POWERS[id].cat : null;
      if (cat) byCategory[cat] = (byCategory[cat] || 0) + 1;
    }
    return {
      grade: A && typeof A.grade === 'function' ? A.grade() : 'D',
      score: A && typeof A.score === 'function' ? A.score() : 0,
      viewers: Math.max((st.stats && st.stats.peakViewers) || 0, (A && A.peakViewers) || 0),
      day: st.day || 1,
      time: st.endTime || st.time || 0,
      ended: st.phase === 'ended',
      winner: winner ? { name: winner.name, archetype: winner.archetype, team: winner.team, kills: winner.kills || 0, popularity: typeof winner.popularity === 'number' ? winner.popularity : 0.3 } : null,
      betrayals: live.betrayals,
      beastDeaths: live.beastDeaths,
      powersUsed: live.powerCount,
      powerKinds: kinds,
      byCategory: byCategory,
      topKills: top,
      deaths: st.deaths ? st.deaths.length : 0,
      kills: (st.stats && st.stats.kills) || 0,
    };
  }
  Career.snapshot = snapshot;

  /** Live objective states for the HUD: [{ id, type, primary, params, done, locked, now, goal }]. */
  Career.progress = function () {
    if (!Career.active()) return [];
    const res = live.results;                       // set once the Show is settled
    const b = data.brief || (res && res.brief);
    if (!b) return [];
    const s = snapshot();
    return b.objectives.map(function (o, i) {
      const p = OBJ[o.type].progress(o.params, s);
      const fin = res ? res.objectives[i] : null;   // the final verdict wins over the live estimate
      return {
        id: o.id, type: o.type, primary: o.primary, params: o.params, now: p.now, goal: p.goal, reward: o.reward,
        done: fin ? fin.done : !!p.done, locked: fin ? true : !!p.locked,
      };
    });
  };
  Career.results = function () { return live.results; };

  // ================================================================== trophies
  const TROPHIES = [
    { id: 'debut', icon: '🎬', reward: 25, test(c, r) { return !!r; } },
    { id: 'rating_a', icon: '📈', reward: 40, test(c, r) { return !!r && rankOf(r.grade) >= 3; } },
    { id: 'rating_s', icon: '🌟', reward: 80, test(c, r) { return !!r && r.grade === 'S'; } },
    { id: 'three_stars', icon: '⭐', reward: 50, test(c, r) { return !!r && r.stars >= 3; } },
    { id: 'season_done', icon: '📺', reward: 100, test(c, r) { return !!r && !!r.season && r.season.done; } },
    { id: 'viewers_30', icon: '👥', reward: 60, test(c) { return c.stats.bestViewers >= 30e6; } },
    { id: 'betrayal_5', icon: '🗡️', reward: 40, test(c, r) { return !!r && r.betrayals >= 5; } },
    { id: 'kills_100', icon: '☠️', reward: 60, test(c) { return c.stats.kills >= 100; } },
    { id: 'underdog', icon: '🌿', reward: 50, test(c, r) { return !!r && r.objectives.some(function (o) { return o.type === 'crown' && o.done; }); } },
    { id: 'upgrade_max', icon: '🔧', reward: 70, test(c) { return UPGRADES.some(function (u) { return u.id !== 'writers' && upgradeLevel(u.id) >= u.max; }); } },
    { id: 'level_5', icon: '🏅', reward: 60, test(c) { return levelOf(c.rep) >= 5; } },
    { id: 'level_10', icon: '👑', reward: 200, test(c) { return levelOf(c.rep) >= MAX_LEVEL; } },
  ];
  Career.TROPHIES = TROPHIES;

  /** Grant every newly reached trophy (and its credits). -> [ids] */
  function awardTrophies(res) {
    const got = [];
    for (let i = 0; i < TROPHIES.length; i++) {
      const t = TROPHIES[i];
      if (data.trophies[t.id]) continue;
      let ok = false;
      try { ok = !!t.test(data, res); } catch (e) { GM.reportError('Career.trophy.' + t.id, e); }
      if (!ok) continue;
      data.trophies[t.id] = Date.now();
      data.credits += t.reward;
      got.push(t.id);
      GM.emit('career:trophy', { id: t.id });
    }
    return got;
  }

  // ============================================================ episode result
  function finalize() {
    if (live.finalized || !live.running) return null;
    live.finalized = true;
    live.running = false;
    const b = data.brief;
    const sc = GM.state.settings && GM.state.settings.career;
    if (!b || !sc || b.season !== sc.season || b.episode !== sc.episode) return null;
    const s = snapshot();
    const scale = seasonScale(b.season);
    const levelBefore = levelOf(data.rep);

    const objectives = b.objectives.map(function (o) {
      return { id: o.id, type: o.type, primary: o.primary, params: o.params, reward: o.reward, done: !!OBJ[o.type].check(o.params, s) };
    });
    let credits = GRADE_CREDITS[s.grade] || 0;
    let rep = GRADE_REP[s.grade] || 0;
    let stars = 0;
    for (let i = 0; i < objectives.length; i++) {
      if (!objectives[i].done) continue;
      credits += objectives[i].reward.credits;
      rep += objectives[i].reward.rep;
      stars++;
    }
    credits = Math.round(credits * scale);
    rep = Math.round(rep * scale);
    stars = Math.min(3, stars);

    const rec = {
      grade: s.grade, score: Math.round(s.score * 10) / 10, viewers: s.viewers, stars: stars, credits: credits, rep: rep,
      winner: s.winner ? s.winner.name : null, day: s.day, ts: Date.now(),
      objectives: objectives.map(function (o) { return { id: o.id, done: o.done }; }),
    };
    const sea = data.seasons[b.season] || (data.seasons[b.season] = { eps: {}, stars: 0 });
    sea.eps[b.episode] = rec;
    sea.stars += stars;

    // lifetime stats
    const st = data.stats;
    st.shows++;
    st.kills += s.kills;
    st.deaths += s.deaths;
    st.days += s.day;
    st.powers += s.powersUsed;
    st.stars += stars;
    st.bestViewers = Math.max(st.bestViewers, s.viewers);
    st.bestScore = Math.max(st.bestScore, rec.score);
    st.grades[s.grade] = (st.grades[s.grade] || 0) + 1;
    if (s.winner) st.wins[s.winner.archetype] = (st.wins[s.winner.archetype] || 0) + 1;

    // season finale
    let seasonInfo = null;
    if (b.episode >= EPISODES) {
      const bonus = SEASON_STAR_CREDITS * sea.stars;
      credits += bonus;
      data.seasonDone = true;
      seasonInfo = { done: true, season: b.season, stars: sea.stars, maxStars: EPISODES * 3, bonus: bonus };
    } else {
      data.episode = b.episode + 1;
    }
    data.rep += rep;
    data.credits += credits;
    data.brief = null;

    data.history.push({ season: b.season, episode: b.episode, grade: s.grade, score: rec.score, viewers: s.viewers, winner: rec.winner, ts: rec.ts });
    if (data.history.length > 30) data.history.splice(0, data.history.length - 30);

    const results = {
      season: seasonInfo, brief: b, grade: s.grade, score: rec.score, viewers: s.viewers, day: s.day, winner: s.winner,
      betrayals: s.betrayals, objectives: objectives, stars: stars, credits: credits, rep: rep, scale: scale,
      levelBefore: levelBefore, levelAfter: levelOf(data.rep), unlocked: [], castCap: Career.castCap(), trophies: [],
    };
    for (const id in POWERS) if (POWERS[id].lv > levelBefore && POWERS[id].lv <= results.levelAfter) results.unlocked.push(id);
    results.trophies = awardTrophies(results);
    results.creditsTotal = data.credits;
    live.results = results;
    commit();
    if (results.levelAfter > levelBefore) GM.emit('career:levelup', { level: results.levelAfter });
    GM.emit('career:results', { results: results });
    GM.emit('career:changed', { finished: true });
    return results;
  }
  Career.finalize = finalize;

  // ================================================================ event wiring
  // Registered in init() (order 110), after GM.Powers (order 80) has added the
  // winner bonus and the last audience sample: the grade must include them.
  GM.registerSystem({
    name: 'Career',
    order: 110,
    init() {
      GM.on('game:new', function () {
        resetLive();
        live.results = null;
        live.running = Career.active();
      });
      GM.on('log', function (e) {
        if (live.running && e && e.type === 'betrayal') live.betrayals++;
      });
      GM.on('contestant:died', function (e) {
        if (!live.running || !e) return;
        if (e.cause === 'beast' || e.cause === 'wasps') live.beastDeaths++;
      });
      GM.on('power:used', function (e) {
        if (!live.running || !e) return;
        live.powerCount++;
        if (e.id) live.used[e.id] = (live.used[e.id] || 0) + 1;
      });
      GM.on('game:end', function () {
        if (Career.active()) {
          finalize();
        } else if (data.stats) {
          // free play: only count that a Show was finished
          data.stats.freeShows++;
          commit();
        }
      });
      GM.on('game:setup', function () {
        // leaving a career Show early: nothing is earned, the brief stays for another try
        live.running = false;
      });
    },
  });
})();
