#!/usr/bin/env node
/* ==========================================================================
 * tools/career-test.js — unit tests for js/save.js and js/career.js (no browser).
 *
 *   node tools/career-test.js
 *
 * Loads the real source files into a sandbox with a fake window / localStorage
 * and a stubbed Show (GM.state, GM.Audience), then plays whole seasons.
 * Exit code 0 = all passed.
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

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

/** A fresh page: window + core.js + save.js + career.js. */
function boot(storage) {
  const listeners = {};
  const win = {
    localStorage: storage,
    addEventListener: (n, f) => { (listeners[n] = listeners[n] || []).push(f); },
    _listeners: listeners,
  };
  const ctx = vm.createContext({ window: win, console, TextEncoder, TextDecoder, atob, btoa, setTimeout });
  for (const f of ['js/core.js', 'js/save.js', 'js/career.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  }
  // what main.js does at boot: every system's init() runs (this registers Career's listeners)
  for (const sys of win.GM.systems) if (typeof sys.init === 'function') sys.init();
  return win.GM;
}

/** Pretend a Show was played: set the stub state and fire the events main.js fires. */
function playShow(GM, o) {
  o = o || {};
  const st = GM.state;
  GM.Audience = { grade: () => o.grade || 'B', score: () => o.score == null ? 45 : o.score, peakViewers: o.viewers || 20e6 };
  const brief = GM.Career.brief();
  GM.Career.startEpisode = GM.Career.startEpisode;   // (real one needs GM.Game)
  st.settings = { career: { season: brief.season, episode: brief.episode, id: brief.id } };
  st.phase = 'countdown';
  st.contestants = [
    { id: 0, name: 'Ava', kills: o.topKills == null ? 3 : o.topKills, archetype: o.winnerArch || 'survivor', team: 1, popularity: o.pop == null ? 0.5 : o.pop },
    { id: 1, name: 'Bo', kills: 1, archetype: 'elite', team: 1, popularity: 0.3 },
  ];
  st.stats = { peakViewers: o.viewers || 20e6, kills: 5, powersUsed: 0 };
  st.deaths = [{}, {}, {}];
  st.day = o.day || 3;
  st.time = 400;
  st.endTime = 400;
  GM.emit('game:new', {});
  st.phase = 'running';
  for (let i = 0; i < (o.betrayals || 0); i++) GM.emit('log', { type: 'betrayal' });
  for (let i = 0; i < (o.beastDeaths || 0); i++) GM.emit('contestant:died', { cause: 'beast' });
  for (const id of (o.powers || [])) GM.emit('power:used', { id: id });
  st.winner = o.noWinner ? null : 0;
  st.phase = 'ended';
  GM.emit('game:end', {});
  return GM.Career.results();
}

/** Objects made inside the vm have another Object.prototype: compare as plain JSON. */
function same(a, b, msg) { assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg); }

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e)); process.exitCode = 1; }
}

// ================================================================== save.js
console.log('save.js');
test('defaults fill, commit and reload', () => {
  const store = makeStorage();
  let GM = boot(store);
  const a = GM.Save.section('x', { n: 1, nested: { a: 1, b: 2 }, list: [] });
  assert.strictEqual(a.n, 1);
  a.n = 7; a.nested.a = 9;
  GM.Save.commit();
  GM = boot(store);
  const b = GM.Save.section('x', { n: 1, nested: { a: 1, b: 2, c: 3 }, list: [], added: 'new' });
  assert.strictEqual(b.n, 7);
  assert.strictEqual(b.nested.a, 9);
  assert.strictEqual(b.nested.c, 3, 'new nested default added to an old save');
  assert.strictEqual(b.added, 'new');
});
test('corrupt data starts fresh and keeps a backup', () => {
  const store = makeStorage([['arena-showrunner-save-v1', '{not json']]);
  const GM = boot(store);
  const s = GM.Save.section('x', { n: 5 });
  assert.strictEqual(s.n, 5);
  assert.strictEqual(store.getItem('arena-showrunner-save-v1.corrupt'), '{not json');
});
test('export / import round trip (unicode safe)', () => {
  const GM = boot(makeStorage());
  const s = GM.Save.section('x', { name: '', n: 0 });
  s.name = 'Árvíztűrő tükörfúrógép ✨'; s.n = 42;
  GM.Save.commit();
  const code = GM.Save.exportCode();
  assert.ok(code.startsWith('ARS1.'));
  const GM2 = boot(makeStorage());
  const s2 = GM2.Save.section('x', { name: '', n: 0 });
  const r = GM2.Save.importCode('  ' + code.slice(0, 30) + '\n' + code.slice(30) + ' ');
  same(r, { ok: true });
  assert.strictEqual(s2.name, 'Árvíztűrő tükörfúrógép ✨');
  assert.strictEqual(s2.n, 42);
});
test('import rejects bad input and leaves the save alone', () => {
  const GM = boot(makeStorage());
  const s = GM.Save.section('x', { n: 1 });
  s.n = 2;
  const good = GM.Save.exportCode();
  assert.strictEqual(GM.Save.importCode('').error, 'empty');
  assert.strictEqual(GM.Save.importCode('hello').error, 'format');
  assert.strictEqual(GM.Save.importCode(good.replace(/.$/, good.endsWith('A') ? 'B' : 'A')).ok, false);
  const tampered = good.slice(0, 5) + (good[5] === '0' ? '1' : '0') + good.slice(6);
  assert.strictEqual(GM.Save.importCode(tampered).error, 'checksum');
  assert.strictEqual(s.n, 2);
});
test('reset restores defaults in place', () => {
  const GM = boot(makeStorage());
  const s = GM.Save.section('x', { n: 1, o: { a: 1 } });
  s.n = 99; s.o.a = 5;
  GM.Save.reset();
  assert.strictEqual(s.n, 1);
  assert.strictEqual(s.o.a, 1);
});
test('works when storage throws (private mode)', () => {
  const bad = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } };
  const GM = boot(bad);
  const s = GM.Save.section('x', { n: 1 });
  s.n = 3;
  assert.strictEqual(GM.Save.commit(), false);
  assert.strictEqual(GM.Save.persistent(), false);
  assert.strictEqual(s.n, 3);
});

// ================================================================ career.js
console.log('career.js');
test('levels, unlocks and cast caps', () => {
  const GM = boot(makeStorage());
  const C = GM.Career;
  assert.strictEqual(C.level(), 1);
  C.data.rep = 99; assert.strictEqual(C.level(), 1);
  C.data.rep = 100; assert.strictEqual(C.level(), 2);
  C.data.rep = 3060; assert.strictEqual(C.level(), 10);
  C.data.rep = 99999; assert.strictEqual(C.level(), 10);
  C.data.rep = 0;
  assert.ok(C.isUnlocked('supply_drop'));
  assert.ok(!C.isUnlocked('smite'));
  assert.strictEqual(C.unlockLevel('smite'), 7);
  assert.strictEqual(C.castCap(), 12);
  C.data.rep = 1100; assert.strictEqual(C.castCap(), 28);
  assert.strictEqual(Object.keys(C.POWERS).length, 18);
});
test('every game power has an unlock entry', () => {
  const GM = boot(makeStorage());
  const src = fs.readFileSync(path.join(root, 'js/powers.js'), 'utf8');
  const ids = [...src.matchAll(/\{ id: '([a-z_]+)', category: '([a-z]+)'/g)].concat([...src.matchAll(/\n      id: '([a-z_]+)', category: '([a-z]+)'/g)]);
  assert.ok(ids.length >= 18, 'found ' + ids.length + ' power definitions');
  for (const m of ids) {
    assert.ok(GM.Career.POWERS[m[1]], 'career.js misses power ' + m[1]);
    assert.strictEqual(GM.Career.POWERS[m[1]].cat, m[2], 'category mismatch for ' + m[1]);
  }
});
test('briefs are deterministic, valid and scale with progress', () => {
  const GM = boot(makeStorage());
  const C = GM.Career;
  C.begin();
  for (let season = 1; season <= 3; season++) {
    for (let ep = 1; ep <= 6; ep++) {
      const a = C.makeBrief(season, ep, 10), b = C.makeBrief(season, ep, 10);
      same(a, b, 'same inputs, same brief');
      assert.strictEqual(a.objectives.length, 3, 'primary + 2 bonus (s' + season + 'e' + ep + ')');
      assert.ok(a.objectives[0].primary && a.objectives[0].type === 'grade');
      const types = a.objectives.map((o) => o.type);
      assert.strictEqual(new Set(types).size, 3, 'no duplicate objective types');
      assert.ok(!(types.includes('long') && types.includes('quick')), 'long and quick never together');
      assert.ok(a.count >= 6 && a.count <= 48 && a.count % 2 === 0);
      assert.ok(a.seed >= 100000 && a.seed <= 999999);
    }
  }
  const e1 = C.makeBrief(1, 1, 1), e6 = C.makeBrief(1, 6, 1), s3 = C.makeBrief(3, 6, 10);
  assert.ok(C.GRADES.indexOf(e6.objectives[0].params.g) > C.GRADES.indexOf(e1.objectives[0].params.g));
  assert.strictEqual(s3.objectives[0].params.g, 'S', 'late seasons ask for S');
  assert.ok(e1.count <= 12, 'level 1 cast is small');
  C.data.seed = 12345;
  const x = C.makeBrief(1, 2, 1);
  C.data.seed = 54321;
  assert.notStrictEqual(JSON.stringify(x), JSON.stringify(C.makeBrief(1, 2, 1)), 'different career seed, different brief');
});
test('early briefs only use objectives the player can reach', () => {
  const GM = boot(makeStorage());
  const C = GM.Career;
  C.begin();
  for (let i = 0; i < 200; i++) {
    C.data.seed = i * 7919 + 1;
    const b = C.makeBrief(1, 1 + (i % 6), 1);
    for (const o of b.objectives) {
      assert.ok(!['beasts', 'minimal'].includes(o.type), 'level-3 objective at level 1: ' + o.type);
      if (o.type === 'category') assert.ok(['gift', 'nature'].includes(o.params.c), 'category with <2 unlocked powers: ' + o.params.c);
      if (o.type === 'variety') assert.ok(o.params.n <= 5);
    }
  }
});
test('finishing an episode pays out and advances', () => {
  const GM = boot(makeStorage());
  const C = GM.Career;
  C.begin();
  const b = C.brief();
  assert.strictEqual(b.id, 's1e1');
  const need = b.objectives[0].params.g;
  const res = playShow(GM, { grade: need, powers: ['supply_drop', 'sponsor_gift', 'weather'], betrayals: 3, viewers: 40e6, topKills: 9, day: 5, pop: 0.9 });
  assert.ok(res, 'results produced');
  assert.strictEqual(res.grade, need);
  assert.ok(res.objectives[0].done, 'primary met');
  assert.ok(res.credits > 0 && res.rep > 0);
  assert.strictEqual(C.data.episode, 2);
  assert.strictEqual(C.data.rep, res.rep);
  assert.ok(C.data.credits >= res.credits, 'credits include trophies');
  assert.ok(C.data.trophies.debut, 'debut trophy');
  assert.strictEqual(C.data.stats.shows, 1);
  assert.strictEqual(C.data.history.length, 1);
  assert.strictEqual(C.data.brief, null, 'brief cleared for the next episode');
  assert.strictEqual(C.brief().id, 's1e2', 'next brief generated on demand');
});
test('a flop still earns something, never goes negative', () => {
  const GM = boot(makeStorage());
  const C = GM.Career;
  C.begin();
  const res = playShow(GM, { grade: 'D', score: 5, viewers: 9e6, topKills: 0, day: 1, noWinner: true });
  assert.ok(!res.objectives[0].done, 'the rating target is missed');
  assert.ok(res.credits >= 20 && res.rep >= 15);
});
test('abandoning a Show earns nothing and keeps the brief', () => {
  const GM = boot(makeStorage());
  const C = GM.Career;
  C.begin();
  const before = JSON.stringify(C.brief());
  const st = GM.state;
  st.settings = { career: { season: 1, episode: 1, id: 's1e1' } };
  st.phase = 'countdown';
  GM.emit('game:new', {});
  st.phase = 'setup';
  GM.emit('game:setup', {});
  st.phase = 'ended';
  GM.emit('game:end', {});
  assert.strictEqual(C.data.rep, 0);
  assert.strictEqual(C.data.stats.shows, 0);
  assert.strictEqual(JSON.stringify(C.brief()), before);
});
test('free play Shows do not touch career rewards', () => {
  const GM = boot(makeStorage());
  const C = GM.Career;
  C.begin();
  GM.state.settings = { sandbox: true };
  GM.state.phase = 'ended';
  GM.emit('game:end', {});
  assert.strictEqual(C.data.rep, 0);
  assert.strictEqual(C.data.credits, 0);
  assert.strictEqual(C.data.stats.freeShows, 1);
});
test('a full season: finale bonus, stars, next season', () => {
  const GM = boot(makeStorage());
  const C = GM.Career;
  C.begin();
  let last = null;
  for (let ep = 1; ep <= 6; ep++) {
    const b = C.brief();
    assert.strictEqual(b.episode, ep);
    last = playShow(GM, { grade: 'S', score: 70, viewers: 45e6, betrayals: 6, day: 5, topKills: 9, pop: 0.95, winnerArch: b.objectives.some((o) => o.type === 'crown') ? b.objectives.find((o) => o.type === 'crown').params.a : 'survivor',
      beastDeaths: 5, powers: ['supply_drop', 'sponsor_gift', 'feast', 'weather', 'time_skip', 'terraform', 'lightning', 'fireball', 'lure', 'poison_fog', 'wasps'] });
  }
  assert.ok(last.season && last.season.done, 'finale flagged');
  assert.ok(last.season.bonus > 0);
  assert.strictEqual(C.data.seasonDone, true);
  assert.strictEqual(C.brief(), null, 'no brief while the season is closed');
  assert.ok(C.data.trophies.season_done);
  assert.ok(C.data.trophies.rating_s);
  assert.ok(C.data.trophies.three_stars);
  assert.ok(C.level() >= 4, 'a perfect season gets well into the levels (level ' + C.level() + ')');
  assert.ok(C.nextSeason());
  assert.strictEqual(C.data.season, 2);
  assert.strictEqual(C.brief().id, 's2e1');
  assert.ok(!C.nextSeason(), 'cannot skip an unfinished season');
});
test('levelling up unlocks powers and raises the cast cap', () => {
  const GM = boot(makeStorage());
  const C = GM.Career;
  C.begin();
  C.data.rep = 90;
  const res = playShow(GM, { grade: 'A', score: 55, viewers: 25e6 });
  assert.ok(res.levelAfter > res.levelBefore);
  assert.ok(res.unlocked.includes('fireball'), 'level 2 unlocks fireball');
  assert.ok(C.isUnlocked('fireball'));
});
test('upgrade shop: costs, limits, level gate, modifiers', () => {
  const GM = boot(makeStorage());
  const C = GM.Career;
  C.begin();
  assert.strictEqual(C.canBuy('power').reason, 'credits');
  C.data.credits = 1000;
  assert.ok(C.buy('power'));
  assert.strictEqual(C.data.credits, 920);
  assert.strictEqual(C.upgradeLevel('power'), 1);
  assert.strictEqual(C.canBuy('writers').reason, 'level');
  assert.strictEqual(C.canBuy('nope').reason, 'missing');
  for (let i = 0; i < 4; i++) { C.data.credits = 5000; assert.ok(C.buy('power')); }
  assert.strictEqual(C.canBuy('power').reason, 'max');
  assert.ok(C.data.trophies.upgrade_max, 'maxing an upgrade earns a trophy');
  const neutral = C.modsFor(null);
  same(neutral, { maxEnergy: 100, startEnergy: 60, regen: 1, cooldown: 1, hype: 1 });
  const m = C.modsFor({ career: {} });
  assert.strictEqual(m.maxEnergy, 150);
  assert.ok(m.startEnergy <= m.maxEnergy);
  assert.strictEqual(C.mods().maxEnergy, 100, 'mods() is neutral outside a career Show');
  C.data.upgrades.rigging = 5; C.data.upgrades.regen = 5; C.data.upgrades.hype = 5; C.data.upgrades.sponsors = 4;
  const best = C.modsFor({ career: {} });
  assert.ok(best.cooldown >= 0.7 && best.cooldown < 1);
  assert.ok(best.regen > 1.4 && best.hype > 1.25);
  assert.strictEqual(best.startEnergy, 100);
});
test('progress is saved between sessions', () => {
  const store = makeStorage();
  let GM = boot(store);
  GM.Career.begin();
  const need = GM.Career.brief().objectives[0].params.g;
  playShow(GM, { grade: need });
  const rep = GM.Career.data.rep, seed = GM.Career.data.seed;
  GM = boot(store);
  assert.strictEqual(GM.Career.data.started, true);
  assert.strictEqual(GM.Career.data.rep, rep);
  assert.strictEqual(GM.Career.data.seed, seed);
  assert.strictEqual(GM.Career.brief().id, 's1e2');
});
test('live progress reports objective states', () => {
  const GM = boot(makeStorage());
  const C = GM.Career;
  C.begin();
  const b = C.brief();
  const st = GM.state;
  GM.Audience = { grade: () => 'C', score: () => 30, peakViewers: 1e7 };
  st.settings = { career: { season: 1, episode: 1 } };
  st.phase = 'running';
  st.contestants = [];
  st.stats = { peakViewers: 1e7 };
  st.deaths = [];
  GM.emit('game:new', {});
  const p = C.progress();
  assert.strictEqual(p.length, b.objectives.length);
  assert.ok(p.every((o) => typeof o.done === 'boolean' && typeof o.locked === 'boolean'));
  assert.strictEqual(p[0].now, 'C');
});
test('after the Show the HUD progress shows the final verdicts', () => {
  const GM = boot(makeStorage());
  const C = GM.Career;
  C.begin();
  const res = playShow(GM, { grade: 'D', score: 10, viewers: 5e6, noWinner: true, day: 1 });
  assert.strictEqual(C.data.brief, null, 'the stored brief is cleared when the episode is settled');
  const p = C.progress();
  assert.strictEqual(p.length, res.objectives.length, 'still reports every objective');
  assert.ok(p.every((o) => o.locked), 'every objective is decided');
  p.forEach((o, i) => assert.strictEqual(o.done, res.objectives[i].done, 'verdict matches the report'));
});
test('career strings: EN and HU match and cover everything the logic can show', () => {
  // load careerui.js with a recording i18n, a fake document and the real career.js
  const dict = { en: {}, hu: {} };
  const win = { localStorage: makeStorage(), addEventListener() {} };
  const ctx = vm.createContext({ window: win, console, TextEncoder, TextDecoder, atob, btoa, setTimeout, document: {} });
  for (const f of ['js/core.js', 'js/save.js', 'js/career.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  win.GM.i18n = { add(d) { for (const l of ['en', 'hu']) Object.assign(dict[l], d[l]); }, lang: 'en' };
  vm.runInContext(fs.readFileSync(path.join(root, 'js/careerui.js'), 'utf8'), ctx, { filename: 'js/careerui.js' });
  const en = Object.keys(dict.en).sort(), hu = Object.keys(dict.hu).sort();
  assert.strictEqual(JSON.stringify(en.filter((k) => !hu.includes(k))), '[]', 'keys missing in HU');
  assert.strictEqual(JSON.stringify(hu.filter((k) => !en.includes(k))), '[]', 'keys missing in EN');
  const C = win.GM.Career;
  const need = [];
  Object.keys(C.OBJECTIVES).forEach((k) => need.push('career.obj.' + k));
  C.UPGRADES.forEach((u) => need.push('career.up.' + u.id, 'career.up.' + u.id + '.desc'));
  C.TROPHIES.forEach((tr) => need.push('career.tr.' + tr.id, 'career.tr.' + tr.id + '.desc'));
  for (let i = 0; i < C.TITLE_WORDS; i++) need.push('career.adj.' + i, 'career.noun.' + i);
  for (const k of need) assert.ok(dict.en[k] && dict.hu[k], 'missing string ' + k);
  for (const k of en) assert.ok(!/[{][^}]*[^\w}][^}]*[}]/.test(dict.en[k]), 'odd placeholder in ' + k);
  // placeholders must be the same in both languages
  for (const k of en) {
    const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
    if (!k.endsWith('_one')) assert.strictEqual(ph(dict.en[k]), ph(dict.hu[k]), 'placeholder mismatch in ' + k);
  }
});
test('reset wipes the career', () => {
  const GM = boot(makeStorage());
  GM.Career.begin();
  GM.Career.data.credits = 500;
  GM.Career.reset();
  assert.strictEqual(GM.Career.data.started, false);
  assert.strictEqual(GM.Career.data.credits, 0);
});

console.log('\n' + passed + ' tests passed' + (process.exitCode ? ' (with failures)' : ''));
