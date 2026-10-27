#!/usr/bin/env node
/* ==========================================================================
 * tools/daily-test.js — unit tests for the daily challenge, the records and the
 * leaderboard service (no browser, no network).
 *
 *   node tools/daily-test.js
 *
 * Part 1 loads the real js/ files into a sandbox with a fake window / localStorage
 * and plays stubbed Shows. Part 2 runs server/worker.js against a real SQLite
 * database (node:sqlite) behind a small D1-compatible shim, and checks that the
 * worker's copy of the game rules has not drifted from the game's.
 * Exit code 0 = all passed.
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { pathToFileURL } = require('url');

const root = path.resolve(__dirname, '..');

function makeStorage(initial) {
  const m = new Map(initial || []);
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m,
  };
}

/** A fresh page: window + core, save, career, daily (+ leaderboard when asked). */
function boot(storage, extra) {
  const listeners = {};
  const win = {
    localStorage: storage || makeStorage(),
    addEventListener: (n, f) => { (listeners[n] = listeners[n] || []).push(f); },
    ARENA_CONFIG: (extra && extra.config) || { leaderboardUrl: '' },
  };
  const ctx = vm.createContext(Object.assign({ window: win, console, TextEncoder, TextDecoder, atob, btoa, setTimeout, clearTimeout }, (extra && extra.globals) || {}));
  for (const f of ['js/core.js', 'js/save.js', 'js/career.js', 'js/daily.js', 'js/leaderboard.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  }
  for (const sys of win.GM.systems) if (typeof sys.init === 'function') sys.init();
  return win.GM;
}

/** Pretend a Show was played and fire the events main.js fires. */
function playShow(GM, o) {
  o = o || {};
  const st = GM.state;
  const score = o.score == null ? 60 : o.score;
  const grade = score >= 80 ? 'S' : score >= 68 ? 'A' : score >= 56 ? 'B' : score >= 44 ? 'C' : 'D';
  GM.Audience = { grade: () => o.grade || grade, score: () => score, peakViewers: o.viewers || 30e6 };
  const cast = o.cast || 20;
  st.settings = Object.assign({ seed: o.seed || 123456, sandbox: !!o.sandbox }, o.settings || {});
  st.phase = 'countdown';
  st.contestants = [];
  for (let i = 0; i < cast; i++) st.contestants.push({ id: i, name: 'C' + i, kills: i === 0 ? (o.topKills == null ? 3 : o.topKills) : 0, archetype: i === 0 ? (o.winnerArch || 'survivor') : 'elite', team: i + 1, popularity: 0.4 });
  st.stats = { peakViewers: o.viewers || 30e6, kills: 5, powersUsed: 0 };
  st.deaths = [{}, {}, {}];
  st.day = o.day || 3;
  st.time = o.time == null ? 400 : o.time;
  st.endTime = st.time;
  GM.emit('game:new', {});
  st.phase = 'running';
  for (let i = 0; i < (o.betrayals || 0); i++) GM.emit('log', { type: 'betrayal' });
  for (let i = 0; i < (o.powers || 0); i++) GM.emit('power:used', { id: 'weather' });
  st.winner = o.noWinner ? null : 0;
  st.phase = 'ended';
  GM.emit('game:end', {});
}
function playDaily(GM, date, o) {
  const c = GM.Daily.challengeFor(date);
  playShow(GM, Object.assign({ cast: c.count, seed: c.seed, settings: { daily: { date, twist: c.twist, mods: c.mods } } }, o || {}));
  return GM.Daily.result();
}

/** Objects made inside the vm have another Object.prototype: compare as plain JSON. */
function same(a, b, msg) { assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg); }

let passed = 0;
const queue = [];
function test(name, fn) { queue.push({ name, fn }); }
async function runAll() {
  for (const { name, fn } of queue) {
    try { await fn(); passed++; console.log('  ok   ' + name); }
    catch (e) { console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e)); process.exitCode = 1; }
  }
}

// ============================================================== challenge rules
test('challenge is a pure function of the date and stays inside its limits', () => {
  const GM = boot();
  const twists = new Set();
  const mixes = new Set();
  let d = '2026-01-01';
  for (let i = 0; i < 400; i++) {
    const c = GM.Daily.challengeFor(d);
    same(c, GM.Daily.challengeFor(d), 'deterministic');
    assert.ok(c.seed >= 100000 && c.seed <= 999999, 'seed range');
    assert.ok(c.count >= 14 && c.count <= 36 && c.count % 2 === 0, 'cast ' + c.count);
    assert.ok(['balanced', 'bloodthirsty', 'chaos', 'peaceful'].includes(c.mix));
    twists.add(c.twist); mixes.add(c.mix);
    if (c.twist === 'crowd') assert.ok(c.count >= 22, 'crowd twist adds cast');
    d = GM.Daily.shiftDate(d, 1);
  }
  assert.strictEqual(twists.size, 5, 'every twist comes up');
  assert.strictEqual(mixes.size, 4, 'every mix comes up');
  assert.notStrictEqual(GM.Daily.challengeFor('2026-03-01').seed, GM.Daily.challengeFor('2026-03-02').seed);
});
test('twist mods only change known keys and stay playable', () => {
  const GM = boot();
  for (const t of GM.Daily.TWISTS) {
    const m = GM.Career.modsFor({ daily: { mods: t.mods } });
    assert.ok(m.maxEnergy >= 60 && m.maxEnergy <= 100, t.id + ' maxEnergy');
    assert.ok(m.startEnergy <= m.maxEnergy);
    assert.ok(m.cooldown > 0.4 && m.regen > 0.5 && m.hype >= 1 && m.hype < 1.5, t.id);
  }
  const hostile = GM.Career.modsFor({ daily: { mods: { maxEnergy: 'x', evil: 1e9, regen: NaN } } });
  assert.strictEqual(hostile.maxEnergy, 100);
  assert.strictEqual(hostile.evil, undefined);
  assert.strictEqual(hostile.regen, 1);
});
test('daily Shows never get studio upgrades', () => {
  const GM = boot();
  GM.Career.begin();
  GM.Career.data.upgrades.power = 5;
  assert.strictEqual(GM.Career.modsFor({ daily: { mods: {} } }).maxEnergy, 100);
  assert.strictEqual(GM.Career.modsFor({ career: { season: 1, episode: 1 } }).maxEnergy, 150);
});

// ===================================================================== dates
test('date helpers use UTC', () => {
  const GM = boot();
  GM.Daily.now = () => Date.UTC(2026, 9, 27, 23, 59, 30);
  assert.strictEqual(GM.Daily.dateKey(), '2026-10-27');
  assert.strictEqual(GM.Daily.msToReset(), 30000);
  assert.strictEqual(GM.Daily.shiftDate('2026-03-01', -1), '2026-02-28');
  assert.strictEqual(GM.Daily.shiftDate('2026-12-31', 1), '2027-01-01');
  assert.ok(isNaN(GM.Daily.dateMs('nope')));
});

// ============================================================ results and streaks
test('a finished daily Show saves the best score, grade and streak', () => {
  const GM = boot();
  GM.Daily.now = () => Date.UTC(2026, 9, 27, 12);
  const r1 = playDaily(GM, '2026-10-27', { score: 61.24, betrayals: 2, powers: 5 });
  assert.strictEqual(r1.improved, true);
  assert.strictEqual(r1.score, 61.2);
  assert.strictEqual(r1.grade, 'B');
  assert.strictEqual(r1.betrayals, 2);
  assert.strictEqual(r1.powers, 5);
  assert.strictEqual(r1.winner, 'survivor');
  assert.strictEqual(GM.Daily.best('2026-10-27').score, 61.2);
  assert.strictEqual(GM.Daily.streak().cur, 1);

  const r2 = playDaily(GM, '2026-10-27', { score: 55 });
  assert.strictEqual(r2.improved, false, 'a worse try is not an improvement');
  assert.strictEqual(r2.previous, 61.2);
  assert.strictEqual(GM.Daily.best('2026-10-27').score, 61.2);
  assert.strictEqual(GM.Daily.streak().cur, 1, 'same day does not extend the streak');

  const r3 = playDaily(GM, '2026-10-27', { score: 70 });
  assert.strictEqual(r3.improved, true);
  assert.strictEqual(GM.Daily.best('2026-10-27').grade, 'A');
  assert.strictEqual(GM.Daily.data.played, 3);
});
test('streak grows day by day, breaks after a gap and shows 0 once stale', () => {
  const GM = boot();
  for (const d of ['2026-10-25', '2026-10-26', '2026-10-27']) { GM.Daily.now = () => GM.Daily.dateMs(d) + 3600e3; playDaily(GM, d); }
  assert.strictEqual(GM.Daily.streak().cur, 3);
  assert.strictEqual(GM.Daily.streak().max, 3);
  GM.Daily.now = () => Date.UTC(2026, 9, 28, 9);
  assert.strictEqual(GM.Daily.streak().cur, 3, 'yesterday still counts: today can extend it');
  assert.strictEqual(GM.Daily.streak().playedToday, false);
  GM.Daily.now = () => Date.UTC(2026, 9, 30, 9);
  assert.strictEqual(GM.Daily.streak().cur, 0, 'two missed days end the streak');
  assert.strictEqual(GM.Daily.streak().max, 3, 'the longest streak is kept');
  GM.Daily.now = () => Date.UTC(2026, 9, 30, 10);
  playDaily(GM, '2026-10-30');
  assert.strictEqual(GM.Daily.streak().cur, 1);
  assert.strictEqual(GM.Daily.streak().max, 3);
});
test('history is newest first and old days are pruned', () => {
  const GM = boot();
  let d = '2026-01-01';
  for (let i = 0; i < 70; i++) { playDaily(GM, d, { score: 50 + (i % 20) }); d = GM.Daily.shiftDate(d, 1); }
  assert.strictEqual(Object.keys(GM.Daily.data.best).length, 60);
  const h = GM.Daily.history(3);
  assert.strictEqual(h.length, 3);
  assert.ok(h[0].date > h[1].date && h[1].date > h[2].date);
});
test('daily data survives a reload', () => {
  const store = makeStorage();
  let GM = boot(store);
  GM.Daily.now = () => Date.UTC(2026, 9, 27, 12);
  GM.Daily.setName('  Árpád   <b>Kiss</b> the second  ');
  playDaily(GM, '2026-10-27', { score: 66 });
  const pid = GM.Daily.pid();
  GM = boot(store);
  GM.Daily.now = () => Date.UTC(2026, 9, 27, 13);
  assert.strictEqual(GM.Daily.pid(), pid);
  assert.strictEqual(GM.Daily.best('2026-10-27').score, 66);
  assert.strictEqual(GM.Daily.name(), 'Árpád bKiss/b th');
});
test('names are cleaned and capped', () => {
  const GM = boot();
  assert.strictEqual(GM.Daily.cleanName('  a\tb\u0000c  '), 'abc', 'control characters (tabs too) are dropped');
  assert.strictEqual(GM.Daily.cleanName('  Ann   Lee  '), 'Ann Lee', 'runs of spaces collapse');
  assert.strictEqual(GM.Daily.cleanName('x'.repeat(40)).length, 16);
  assert.strictEqual(GM.Daily.cleanName('<>'), '');
  assert.strictEqual(GM.Daily.cleanName(null), '');
});
test('player id is random, stable and server-acceptable', () => {
  const a = boot(), b = boot();
  assert.ok(/^[a-z0-9]{20}$/.test(a.Daily.pid()));
  assert.notStrictEqual(a.Daily.pid(), b.Daily.pid());
  assert.strictEqual(a.Daily.pid(), a.Daily.pid());
});
test('reset career keeps daily scores and records', () => {
  const GM = boot();
  GM.Career.begin();
  playDaily(GM, '2026-10-27', { score: 66 });
  GM.Daily.setName('Keep');
  GM.Career.reset();
  assert.strictEqual(GM.Career.data.started, false);
  assert.strictEqual(GM.Daily.best('2026-10-27').score, 66);
  assert.strictEqual(GM.Daily.name(), 'Keep');
  assert.strictEqual(GM.Records.data.shows, 1);
  GM.Save.reset();
  assert.strictEqual(GM.Records.data.shows, 0, 'a full reset still wipes everything');
});
test('payload carries exactly what the server checks', () => {
  const GM = boot();
  GM.Daily.setName('Pat');
  const r = playDaily(GM, '2026-10-27', { score: 72.4, day: 5 });
  const p = GM.Daily.payload(r);
  same(Object.keys(p).sort(), ['cast', 'day', 'grade', 'name', 'pid', 'score', 'twist', 'viewers', 'winner']);
  assert.strictEqual(p.name, 'Pat');
  assert.strictEqual(p.grade, 'A');
});

// =================================================================== records
test('records: first value is not "broken", later better ones are', () => {
  const GM = boot();
  const broken = [];
  GM.on('records:broken', (e) => broken.push(...e.ids));
  playShow(GM, { score: 50, viewers: 30e6, day: 3, betrayals: 1, topKills: 3, cast: 16, time: 500 });
  assert.strictEqual(broken.length, 0);
  const L = Object.fromEntries(GM.Records.list().map((r) => [r.id, r.value]));
  assert.strictEqual(L.score, 50);
  assert.strictEqual(L.quickest, 500);
  playShow(GM, { score: 60, viewers: 25e6, day: 6, betrayals: 0, topKills: 3, cast: 16, time: 700 });
  same(broken.sort(), ['longest', 'score']);
  playShow(GM, { score: 40, viewers: 40e6, day: 2, betrayals: 4, topKills: 8, cast: 24, time: 300 });
  assert.ok(broken.includes('quickest') && broken.includes('viewers') && broken.includes('topKills') && broken.includes('betrayals') && broken.includes('cast'));
  const after = Object.fromEntries(GM.Records.list().map((r) => [r.id, r.value]));
  assert.strictEqual(after.score, 60, 'a worse score does not replace the record');
  assert.strictEqual(after.quickest, 300, 'quickest: lower is better');
  assert.strictEqual(GM.Records.data.shows, 3);
});
test('records: sandbox Shows set none, tiny casts cannot set the speed record', () => {
  const GM = boot();
  playShow(GM, { score: 99, sandbox: true });
  assert.strictEqual(GM.Records.data.shows, 0);
  assert.ok(GM.Records.list().every((r) => r.value === null));
  playShow(GM, { score: 50, cast: 6, time: 20 });
  assert.strictEqual(GM.Records.list().find((r) => r.id === 'quickest').value, null);
  playShow(GM, { score: 50, cast: 12, time: 200, noWinner: true });
  assert.strictEqual(GM.Records.list().find((r) => r.id === 'quickest').value, null, 'no winner, no speed record');
});
test('records count wins by type and grades', () => {
  const GM = boot();
  playShow(GM, { score: 85, winnerArch: 'lonewolf' });
  playShow(GM, { score: 85, winnerArch: 'lonewolf' });
  playShow(GM, { score: 30, winnerArch: 'elite' });
  assert.strictEqual(GM.Records.data.wins.lonewolf, 2);
  assert.strictEqual(GM.Records.data.grades.S, 2);
  assert.strictEqual(GM.Records.data.grades.D, 1);
});
test('free-play and career Shows feed records but not the daily board', () => {
  const GM = boot();
  playShow(GM, { score: 70 });
  assert.strictEqual(GM.Records.data.shows, 1);
  assert.strictEqual(GM.Daily.result(), null);
  assert.strictEqual(GM.Daily.data.played, 0);
});

// ============================================================== leaderboard client
test('leaderboard client is off without a URL and never calls fetch', async () => {
  let calls = 0;
  const GM = boot(null, { globals: { fetch: () => { calls++; return Promise.reject(new Error('no')); } } });
  assert.strictEqual(GM.Leaderboard.enabled(), false);
  const r = await GM.Leaderboard.daily('2026-10-27');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'disabled');
  assert.strictEqual((await GM.Leaderboard.submit('2026-10-27', {})).error, 'disabled');
  assert.strictEqual(calls, 0);
});
test('leaderboard client rejects non-http URLs', () => {
  assert.strictEqual(boot(null, { config: { leaderboardUrl: 'javascript:alert(1)' } }).Leaderboard.enabled(), false);
  assert.strictEqual(boot(null, { config: { leaderboardUrl: 'https://x.example/' } }).Leaderboard.enabled(), true);
});
test('leaderboard client parses rows, marks mine, caches and reports errors', async () => {
  const seen = [];
  let GMref = null;
  const fakeFetch = (url, init) => {
    seen.push({ url, init });
    if (/fail/.test(url)) return Promise.reject(new Error('net'));
    const mineTag = GMref.hashString(GMref.Daily.pid()).toString(16).padStart(8, '0');
    const body = /alltime/.test(url)
      ? { entries: [{ rank: 1, name: 'A', score: 90, date: '2026-10-01', pidh: 'deadbeef' }], stats: { players: 3, runs: 9 } }
      : { date: '2026-10-27', total: 2, entries: [{ rank: 1, name: '<b>X</b>', score: 80.5, grade: 'S', viewers: 4e7, day: 4, cast: 20, pidh: 'deadbeef' }, { rank: 2, name: 'Me', score: 70, grade: 'A', pidh: mineTag }, 'junk', null] };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
  const GM = boot(null, { config: { leaderboardUrl: 'https://lb.example/' }, globals: { fetch: fakeFetch, AbortController } });
  GMref = GM;
  const r = await GM.Leaderboard.daily('2026-10-27', 20);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.entries.length, 2, 'junk rows are dropped');
  assert.strictEqual(r.entries[0].mine, false);
  assert.strictEqual(r.entries[1].mine, true);
  assert.strictEqual(r.entries[0].name, '<b>X</b>', 'kept verbatim: the UI uses textContent');
  assert.strictEqual(seen[0].url, 'https://lb.example/v1/daily/2026-10-27?limit=20');
  assert.strictEqual(seen[0].init.credentials, 'omit');
  await GM.Leaderboard.daily('2026-10-27', 20);
  assert.strictEqual(seen.length, 1, 'second call is served from the cache');
  const a = await GM.Leaderboard.allTime(10);
  assert.strictEqual(a.stats.players, 3);
  assert.strictEqual(a.entries[0].date, '2026-10-01');
});
test('leaderboard client maps network and HTTP failures', async () => {
  const mk = (impl) => boot(null, { config: { leaderboardUrl: 'https://lb.example' }, globals: { fetch: impl, AbortController } });
  assert.strictEqual((await mk(() => Promise.reject(new Error('down'))).Leaderboard.daily('2026-10-27')).error, 'offline');
  assert.strictEqual((await mk(() => Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: 'bad_score' }) })).Leaderboard.submit('2026-10-27', {})).message, 'bad_score');
  assert.strictEqual((await mk(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ nope: 1 }) })).Leaderboard.daily('2026-10-27')).error, 'bad');
  assert.strictEqual((await mk(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('x')) })).Leaderboard.daily('2026-10-27')).error, 'bad');
});

// ================================================================ the worker
const { makeD1 } = require('../server/d1-node.js');

let W = null;
let GMref = null;
const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);
const TODAY = '2026-10-27';

async function freshWorker() {
  const { DatabaseSync } = require('node:sqlite');
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync(path.join(root, 'server/schema.sql'), 'utf8'));
  return { env: { DB: makeD1(sqlite) }, sqlite };
}
const call = async (env, method, url, body, now) => {
  const init = { method };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  const res = await W.handle(new Request('https://lb.example' + url, init), env, null, now == null ? NOW : now);
  let json = null;
  try { json = await res.json(); } catch (e) { /* no body (204) */ }
  return { status: res.status, json, headers: res.headers };
};
function goodBody(over, date) {
  const c = W.challengeFor(date || TODAY);
  return Object.assign({ pid: 'abcdefghij0123456789', name: 'Pat', score: 72.4, grade: 'A', viewers: 31e6, day: 4, cast: c.count, winner: 'elite', twist: c.twist }, over || {});
}

test('worker: rules match the game (challenge, grade cuts, archetypes)', async () => {
  W = await import(pathToFileURL(path.join(root, 'server/worker.js')).href);
  const GM = boot();
  GMref = GM;
  let d = '2026-01-01';
  for (let i = 0; i < 800; i++) {
    const a = GM.Daily.challengeFor(d), b = W.challengeFor(d);
    assert.deepStrictEqual({ seed: b.seed, count: b.count, mix: b.mix, twist: b.twist }, { seed: a.seed, count: a.count, mix: a.mix, twist: a.twist }, 'drift on ' + d);
    d = GM.Daily.shiftDate(d, 1);
  }
  same(Array.from(GM.Career.GRADE_CUTS), [80, 68, 56, 44]);
  for (const s of [100, 80, 79.9, 68, 56, 44, 43.9, 0]) {
    const g = s >= 80 ? 'S' : s >= 68 ? 'A' : s >= 56 ? 'B' : s >= 44 ? 'C' : 'D';
    assert.strictEqual(W.gradeFor(s), g);
  }
  const src = fs.readFileSync(path.join(root, 'js/contestants.js'), 'utf8');
  const ids = JSON.parse(src.match(/const ARCH_IDS = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  const wsrc = fs.readFileSync(path.join(root, 'server/worker.js'), 'utf8');
  const wids = JSON.parse(wsrc.match(/const ARCHETYPES = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  same(wids, ids);
  const twistsGame = GM.Daily.TWISTS.map((t) => t.id + ':' + t.w + ':' + t.cast).join();
  const twistsWorker = wsrc.match(/const TWISTS = \[([\s\S]*?)\];/)[1].match(/\{[^}]*\}/g)
    .map((o) => { const m = /id: '(\w+)', w: (\d+), cast: (\d+)/.exec(o); return m[1] + ':' + m[2] + ':' + m[3]; }).join();
  assert.strictEqual(twistsWorker, twistsGame);
  assert.strictEqual(W.pidTag('abcdefghij0123456789'), GM.hashString('abcdefghij0123456789').toString(16).padStart(8, '0'));
  assert.strictEqual(W.cleanName('  a\tb\u0000c  '), GM.Daily.cleanName('  a\tb\u0000c  '));
});
test('worker: accepts a good submission and ranks it', async () => {
  const { env } = await freshWorker();
  const r = await call(env, 'POST', '/v1/daily/' + TODAY, goodBody());
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.ok, true);
  assert.strictEqual(r.json.improved, true);
  assert.strictEqual(r.json.rank, 1);
  assert.strictEqual(r.json.total, 1);
  assert.strictEqual(r.headers.get('access-control-allow-origin'), '*');
});
test('worker: keeps only the best score per player and day', async () => {
  const { env } = await freshWorker();
  await call(env, 'POST', '/v1/daily/' + TODAY, goodBody({ score: 70, grade: 'A' }));
  const worse = await call(env, 'POST', '/v1/daily/' + TODAY, goodBody({ score: 60, grade: 'B' }));
  assert.strictEqual(worse.json.improved, false);
  assert.strictEqual(worse.json.best, 70);
  const better = await call(env, 'POST', '/v1/daily/' + TODAY, goodBody({ score: 81, grade: 'S' }));
  assert.strictEqual(better.json.improved, true);
  const list = await call(env, 'GET', '/v1/daily/' + TODAY);
  assert.strictEqual(list.json.total, 1);
  assert.strictEqual(list.json.entries[0].score, 81);
});
test('worker: orders by score, ties by who got there first, exposes no player id', async () => {
  const { env } = await freshWorker();
  const post = (n, pid, score, grade, t) => call(env, 'POST', '/v1/daily/' + TODAY, goodBody({ name: n, pid, score, grade }), NOW + t);
  await post('Low', 'aaaaaaaaaaaa0001', 50, 'C', 1);
  await post('Top', 'aaaaaaaaaaaa0002', 90, 'S', 2);
  await post('TieB', 'aaaaaaaaaaaa0003', 70, 'A', 3);
  await post('TieA', 'aaaaaaaaaaaa0004', 70, 'A', 2);
  const late = await post('Late', 'aaaaaaaaaaaa0005', 70, 'A', 9);
  assert.strictEqual(late.json.rank, 4, 'behind the earlier 70s');
  const list = await call(env, 'GET', '/v1/daily/' + TODAY + '?limit=3');
  same(list.json.entries.map((e) => e.name), ['Top', 'TieA', 'TieB']);
  same(list.json.entries.map((e) => e.rank), [1, 2, 3]);
  assert.strictEqual(list.json.total, 5);
  assert.ok(list.json.entries.every((e) => e.pid === undefined && /^[0-9a-f]{8}$/.test(e.pidh)));
  assert.ok(list.json.entries.every((e) => e.date === undefined), 'daily rows do not repeat the date');
});
test('worker: all-time board has one row per player and counts players and runs', async () => {
  const { env } = await freshWorker();
  const dayBefore = '2026-10-26';
  await call(env, 'POST', '/v1/daily/' + dayBefore, goodBody({ pid: 'aaaaaaaaaaaa0001', name: 'Ann', score: 88, grade: 'S' }, dayBefore));
  await call(env, 'POST', '/v1/daily/' + TODAY, goodBody({ pid: 'aaaaaaaaaaaa0001', name: 'Ann', score: 75, grade: 'A' }));
  await call(env, 'POST', '/v1/daily/' + TODAY, goodBody({ pid: 'aaaaaaaaaaaa0002', name: 'Bob', score: 80, grade: 'S' }));
  const r = await call(env, 'GET', '/v1/alltime');
  same(r.json.entries.map((e) => e.name + ':' + e.score), ['Ann:88', 'Bob:80']);
  assert.strictEqual(r.json.entries[0].date, dayBefore);
  same(r.json.stats, { players: 2, runs: 3 });
});
test('worker: a new display name applies to all of that player\'s rows', async () => {
  const { env } = await freshWorker();
  await call(env, 'POST', '/v1/daily/2026-10-26', goodBody({ name: 'Old', score: 88, grade: 'S' }, '2026-10-26'));
  await call(env, 'POST', '/v1/daily/' + TODAY, goodBody({ name: 'New', score: 50, grade: 'C' }));
  const y = await call(env, 'GET', '/v1/daily/2026-10-26');
  assert.strictEqual(y.json.entries[0].name, 'New');
});
test('worker: rejects bad dates, shapes and implausible results', async () => {
  const { env } = await freshWorker();
  const bad = async (over, code, date) => {
    const r = await call(env, 'POST', '/v1/daily/' + (date || TODAY), goodBody(over, date || TODAY));
    assert.strictEqual(r.status, 400, JSON.stringify(over));
    assert.strictEqual(r.json.error, code, JSON.stringify(over));
  };
  await bad({}, 'date_out_of_range', '2026-10-20');
  await bad({}, 'date_out_of_range', '2026-10-28');
  await bad({}, 'bad_date', '2026-13-40');
  await bad({}, 'bad_date', 'today');
  await bad({ pid: 'short' }, 'bad_pid');
  await bad({ pid: 'ABCDEFGHIJ0123456789' }, 'bad_pid');
  await bad({ name: '  <> ' }, 'bad_name');
  await bad({ score: 100.5, grade: 'S' }, 'bad_score');
  await bad({ score: -1, grade: 'D' }, 'bad_score');
  await bad({ score: 'high' }, 'bad_score');
  await bad({ grade: 'S' }, 'grade_mismatch');
  await bad({ viewers: 5 }, 'bad_viewers');
  await bad({ viewers: 5e9 }, 'bad_viewers');
  await bad({ day: 0 }, 'bad_day');
  await bad({ cast: 99 }, 'cast_mismatch');
  await bad({ twist: 'lean' + 'x' }, 'twist_mismatch');
  await bad({ winner: 'dragon' }, 'bad_winner');
  const yesterdayOk = await call(env, 'POST', '/v1/daily/2026-10-26', goodBody({}, '2026-10-26'));
  assert.strictEqual(yesterdayOk.status, 200, 'yesterday is still accepted');
  const empty = await call(env, 'GET', '/v1/daily/' + TODAY);
  assert.strictEqual(empty.json.total, 0);
});
test('worker: rejects junk bodies and oversize payloads, answers CORS preflight', async () => {
  const { env } = await freshWorker();
  assert.strictEqual((await call(env, 'POST', '/v1/daily/' + TODAY, '{not json')).json.error, 'bad_body');
  assert.strictEqual((await call(env, 'POST', '/v1/daily/' + TODAY, 'null')).json.error, 'bad_body');
  assert.strictEqual((await call(env, 'POST', '/v1/daily/' + TODAY, JSON.stringify({ pad: 'x'.repeat(3000) }))).status, 413);
  const pre = await call(env, 'OPTIONS', '/v1/daily/' + TODAY);
  assert.strictEqual(pre.status, 204);
  assert.ok(/POST/.test(pre.headers.get('access-control-allow-methods')));
  assert.strictEqual((await call(env, 'DELETE', '/v1/daily/' + TODAY)).status, 405);
  assert.strictEqual((await call(env, 'GET', '/v1/nope')).status, 404);
  assert.strictEqual((await call(env, 'GET', '/v1/health')).json.ok, true);
});
test('worker: SQL injection attempts are inert (bound parameters)', async () => {
  const { env, sqlite } = await freshWorker();
  await call(env, 'POST', '/v1/daily/' + TODAY, goodBody({ name: "x'); DROP TABLE scores;--" }));
  assert.strictEqual(sqlite.prepare('select count(*) n from scores').get().n, 1);
  const r = await call(env, 'GET', "/v1/daily/2026-10-27'%20OR%201=1--");
  assert.strictEqual(r.json.error, 'bad_date');
});

runAll().then(() => {
  console.log('\n' + passed + ' tests passed' + (process.exitCode ? ' (with failures)' : ''));
});
