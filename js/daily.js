/* ==========================================================================
 * daily.js — the daily challenge and the player's records.
 *
 * Every UTC day has one fixed Show: the same arena, cast and personality mix for
 * everybody, plus a "twist" (a different energy / cooldown / hype setup). Players
 * compete on the Show score; the best try of the day counts. Daily Shows are
 * neutral: no studio upgrades, no sandbox, every power unlocked.
 *
 *   GM.Daily.today()               { date, seed, count, mix, twist, mods } for the current UTC day
 *   GM.Daily.challengeFor(date)    the same for any 'YYYY-MM-DD' (deterministic)
 *   GM.Daily.start()               launch today's Show (setup screen only)
 *   GM.Daily.active()              a daily Show is on (countdown, running, or just ended)
 *   GM.Daily.result()              the last finished daily Show (null after a reload)
 *   GM.Daily.best(date) / streak() / history(n) / msToReset()
 *   GM.Daily.name() / setName(s) / pid()   leaderboard identity (anonymous id + chosen name)
 *   GM.Daily.payload(result)       what the leaderboard receives
 *
 *   GM.Records.list()              personal records [{ id, icon, value, ts, mode, seed }]
 *   GM.Records.data                saved totals (shows, wins by type, grade counts)
 *
 * Events: 'daily:result' {result, improved}, 'records:broken' {ids, info}.
 * Records and the Show tracker cover every kind of Show (free play, career, daily);
 * sandbox Shows never set records. Owner: core.
 * ========================================================================== */
(function () {
  'use strict';
  const GM = window.GM;
  const U = GM.U;
  const CFG = GM.CFG;

  const SALT = 'arena-showrunner-daily-v1';
  const KEEP_DAYS = 60;
  const DAY_MS = 86400000;
  const NAME_MAX = 16;

  const MIXES = ['balanced', 'balanced', 'bloodthirsty', 'chaos', 'peaceful'];
  /**
   * The day's twist. `mods` replace the neutral power numbers (maxEnergy 100, startEnergy 60,
   * regen / cooldown / hype 1); `cast` adds contestants. Weights decide how often it comes up.
   */
  const TWISTS = [
    { id: 'classic', w: 3, mods: {}, cast: 0 },
    { id: 'lean', w: 2, mods: { maxEnergy: 75, startEnergy: 45, regen: 1.2 }, cast: 0 },
    { id: 'quickdraw', w: 2, mods: { cooldown: 0.65, regen: 0.8 }, cast: 0 },
    { id: 'showtime', w: 2, mods: { maxEnergy: 85, startEnergy: 50, hype: 1.25 }, cast: 0 },
    { id: 'crowd', w: 2, mods: {}, cast: 8 },
  ];
  const TWIST_BY_ID = Object.create(null);
  TWISTS.forEach(function (t) { TWIST_BY_ID[t.id] = t; });

  // ================================================================ save data
  const data = GM.Save.section('daily', {
    pid: '',                  // anonymous player id (random, never shown)
    name: '',                 // leaderboard name
    played: 0,                // daily Shows finished
    best: {},                 // 'YYYY-MM-DD' -> { score, grade, viewers, day, winner, cast, ts, sent }
    streak: { cur: 0, max: 0, last: '' },
  });
  const recData = GM.Save.section('records', {
    shows: 0,                 // finished non-sandbox Shows of any kind
    grades: { S: 0, A: 0, B: 0, C: 0, D: 0 },
    wins: {},                 // winner type -> count
    best: {},                 // record id -> { v, ts, mode, seed }
  });
  function commit() { GM.Save.commit(); }

  // ================================================================== helpers
  function round1(v) { return Math.round((+v || 0) * 10) / 10; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  const Daily = (GM.Daily = {
    TWISTS: TWISTS, NAME_MAX: NAME_MAX, data: data,
    /** Replaceable clock (tests). */
    now() { return Date.now(); },
  });
  let lastResult = null;

  /** 'YYYY-MM-DD' of a timestamp in UTC. */
  Daily.dateKey = function (ms) {
    const d = new Date(ms == null ? Daily.now() : ms);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  };
  /** Timestamp (UTC midnight) of a 'YYYY-MM-DD' key, NaN when malformed. */
  Daily.dateMs = function (key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  };
  Daily.shiftDate = function (key, days) { return Daily.dateKey(Daily.dateMs(key) + days * DAY_MS); };
  /** Milliseconds until the next UTC midnight (the next challenge). */
  Daily.msToReset = function () {
    const n = Daily.now();
    return Math.max(0, Math.floor(n / DAY_MS) * DAY_MS + DAY_MS - n);
  };

  // =============================================================== the challenge
  function weighted(rng, list) {
    let total = 0;
    for (let i = 0; i < list.length; i++) total += list[i].w;
    let r = rng() * total;
    for (let i = 0; i < list.length; i++) {
      r -= list[i].w;
      if (r <= 0) return list[i];
    }
    return list[list.length - 1];
  }

  /** The Show everybody plays on `date` ('YYYY-MM-DD'). Pure function of the date. */
  Daily.challengeFor = function (date) {
    const rng = GM.makeRng(GM.hashString(SALT + ':' + date));
    const seed = 100000 + Math.floor(rng() * 900000);
    const twist = weighted(rng, TWISTS);
    const mix = MIXES[Math.floor(rng() * MIXES.length)];
    let count = 14 + 2 * Math.floor(rng() * 8);                       // 14 .. 28
    count = Math.min(CFG.MAX_CONTESTANTS, count + twist.cast);
    return { date: date, seed: seed, count: count, mix: mix, twist: twist.id, mods: Object.assign({}, twist.mods) };
  };
  Daily.today = function () { return Daily.challengeFor(Daily.dateKey()); };

  /** True while a daily Show is on (countdown, running, or just ended). */
  Daily.active = function () {
    const st = GM.state;
    const s = st && st.settings;
    return !!(s && s.daily) && st.phase !== 'setup' && st.phase !== 'boot';
  };

  /** Launch today's Show. Only from the setup screen. */
  Daily.start = function () {
    if (!GM.Game || GM.state.phase !== 'setup') return false;
    const c = Daily.today();
    const opts = (GM.UI && typeof GM.UI.getOptions === 'function' && GM.UI.getOptions()) || {};
    const s = {
      seed: c.seed, contestantCount: c.count, mix: c.mix, roster: null,
      sandbox: false, autoGM: false,
      quality: opts.quality === 'low' ? 'low' : 'high',
      feeds: opts.feeds !== false, nameTags: opts.nameTags !== false, startSpeed: 1,
      daily: { date: c.date, twist: c.twist, mods: c.mods },
    };
    if (GM.Audio && typeof GM.Audio.unlock === 'function') { try { GM.Audio.unlock(); } catch (e) { /* optional */ } }
    GM.Game.newGame(s);
    if (GM.AutoGM && typeof GM.AutoGM.setEnabled === 'function') { try { GM.AutoGM.setEnabled(false); } catch (e) { /* optional */ } }
    return true;
  };

  // ============================================================ player identity
  function randomId() {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    let bytes = null;
    try {
      if (window.crypto && window.crypto.getRandomValues) bytes = window.crypto.getRandomValues(new Uint8Array(20));
    } catch (e) { bytes = null; }
    for (let i = 0; i < 20; i++) out += alphabet[(bytes ? bytes[i] : Math.floor(Math.random() * 256)) % alphabet.length];
    return out;
  }
  Daily.pid = function () {
    if (!data.pid) { data.pid = randomId(); commit(); }
    return data.pid;
  };
  /** Trim, collapse whitespace, drop control characters and angle brackets, cap the length. */
  Daily.cleanName = function (s) {
    return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
  };
  Daily.name = function () { return data.name || ''; };
  Daily.setName = function (s) {
    data.name = Daily.cleanName(s);
    commit();
    return data.name;
  };

  // ================================================================ saved bests
  Daily.best = function (date) { return data.best[date || Daily.dateKey()] || null; };
  /** Current and longest streak of days with a finished daily Show. cur is 0 once a day was missed. */
  Daily.streak = function () {
    const today = Daily.dateKey();
    const last = data.streak.last;
    const alive = last === today || last === Daily.shiftDate(today, -1);
    return { cur: alive ? data.streak.cur : 0, max: data.streak.max, last: last, playedToday: last === today };
  };
  /** The last n days (newest first) with a finished daily Show: [{ date, ...best }]. */
  Daily.history = function (n) {
    return Object.keys(data.best).sort().reverse().slice(0, n || 14).map(function (d) { return Object.assign({ date: d }, data.best[d]); });
  };
  Daily.result = function () { return lastResult; };

  /** The record a leaderboard receives for one finished Show. */
  Daily.payload = function (res) {
    return {
      pid: Daily.pid(), name: data.name, score: res.score, grade: res.grade, viewers: res.viewers,
      day: res.day, cast: res.cast, winner: res.winner || '', twist: res.twist,
    };
  };
  Daily.markSent = function (date) {
    if (data.best[date]) { data.best[date].sent = true; commit(); }
  };

  function pruneOld() {
    const keys = Object.keys(data.best).sort();
    while (keys.length > KEEP_DAYS) delete data.best[keys.shift()];
  }

  // ======================================================= Show tracker (all Shows)
  const live = { betrayals: 0, powers: 0, done: false };
  function resetLive() { live.betrayals = 0; live.powers = 0; live.done = false; }

  // ===================================================================== records
  /** Personal records. dir: 1 = higher is better, -1 = lower is better. */
  const RECORDS = [
    { id: 'score', icon: '🎯', dir: 1, get(i) { return i.score; } },
    { id: 'viewers', icon: '👥', dir: 1, get(i) { return i.viewers; } },
    { id: 'longest', icon: '🌙', dir: 1, get(i) { return i.day; } },
    { id: 'quickest', icon: '⚡', dir: -1, get(i) { return i.winner && i.cast >= 12 ? i.time : 0; } },
    { id: 'topKills', icon: '☠️', dir: 1, get(i) { return i.topKills; } },
    { id: 'betrayals', icon: '🗡️', dir: 1, get(i) { return i.betrayals; } },
    { id: 'cast', icon: '🎭', dir: 1, get(i) { return i.cast; } },
  ];
  const Records = (GM.Records = { DEFS: RECORDS, data: recData });

  /** All record slots, in display order. value is null until set. */
  Records.list = function () {
    return RECORDS.map(function (d) {
      const b = recData.best[d.id];
      return { id: d.id, icon: d.icon, dir: d.dir, value: b ? b.v : null, ts: b ? b.ts : 0, mode: b ? b.mode : '', seed: b ? b.seed : 0 };
    });
  };

  /** Fold one finished Show into the records. -> ids of the records it broke. */
  function updateRecords(info) {
    const broken = [];
    recData.shows++;
    recData.grades[info.grade] = (recData.grades[info.grade] || 0) + 1;
    if (info.winner) recData.wins[info.winner] = (recData.wins[info.winner] || 0) + 1;
    for (let i = 0; i < RECORDS.length; i++) {
      const d = RECORDS[i];
      const v = d.get(info);
      if (!(v > 0)) continue;
      const cur = recData.best[d.id];
      if (cur && (d.dir > 0 ? v <= cur.v : v >= cur.v)) continue;
      recData.best[d.id] = { v: v, ts: info.ts, mode: info.mode, seed: info.seed };
      if (cur) broken.push(d.id);            // the first value is not a "new record"
    }
    return broken;
  }

  // ============================================================== a Show ends
  function finish() {
    if (live.done) return;
    live.done = true;
    const st = GM.state;
    const s = st.settings || {};
    if (!GM.Career || typeof GM.Career.snapshot !== 'function') return;
    const snap = GM.Career.snapshot();
    const info = {
      mode: s.daily ? 'daily' : s.career ? 'career' : 'free',
      seed: s.seed >>> 0,
      score: round1(snap.score), grade: snap.grade, viewers: Math.round(snap.viewers),
      day: snap.day, time: Math.round(snap.time), cast: st.contestants.length,
      winner: snap.winner ? snap.winner.archetype : '',
      topKills: snap.topKills, betrayals: live.betrayals, powers: live.powers,
      ts: Date.now(),
    };
    let broken = [];
    if (!s.sandbox) broken = updateRecords(info);

    if (s.daily && s.daily.date) {
      const date = s.daily.date;
      const prev = data.best[date] || null;
      const improved = !prev || info.score > prev.score;
      data.played++;
      if (improved) {
        data.best[date] = { score: info.score, grade: info.grade, viewers: info.viewers, day: info.day, winner: info.winner, cast: info.cast, ts: info.ts, sent: false };
        pruneOld();
      }
      const sk = data.streak;
      if (sk.last !== date) {
        sk.cur = sk.last === Daily.shiftDate(date, -1) ? sk.cur + 1 : 1;
        sk.last = date;
        sk.max = Math.max(sk.max, sk.cur);
      }
      lastResult = Object.assign({}, info, { date: date, twist: s.daily.twist, improved: improved, previous: prev ? prev.score : null, broken: broken, streak: sk.cur });
      commit();
      GM.emit('daily:result', { result: lastResult, improved: improved });
    } else {
      commit();
    }
    if (broken.length) GM.emit('records:broken', { ids: broken, info: info });
  }

  GM.registerSystem({
    name: 'Daily',
    order: 112,       // after Powers (80), which adds the winner bonus the score must include, and Career (110)
    init() {
      GM.on('game:new', resetLive);
      GM.on('log', function (e) { if (e && e.type === 'betrayal' && GM.state.phase === 'running') live.betrayals++; });
      GM.on('power:used', function () { live.powers++; });
      GM.on('game:end', finish);
    },
  });
})();
