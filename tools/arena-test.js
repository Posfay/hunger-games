#!/usr/bin/env node
/* ==========================================================================
 * tools/arena-test.js — tests for the arena themes (no browser).
 *
 *   node tools/arena-test.js
 *
 *   - the classic arena is byte-identical to the stored fixture (arena codes and daily
 *     challenges promise the same arena forever)
 *   - every pack theme only uses keys the engine knows (a typo would silently do nothing)
 *   - every pack arena generates for many seeds, deterministically, with the character it
 *     promises (sand, snow, water), a playable shape (reachable from the Nexus), enough cover
 *   - a build without the pack file shows its arenas as locked and falls back to the classic one
 * Exit code 0 = all passed.
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadTerrain, fingerprint, all, SEEDS } = require('./arena-fingerprint.js');
const { stats, FILES } = require('./arena-stats.js');

const root = path.resolve(__dirname, '..');
const NO_PACK = FILES.filter((f) => f.indexOf('packs/') < 0);

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e)); process.exitCode = 1; }
}
function same(a, b, msg) { assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg); }

/** Every key of `over` must exist in `base` with a compatible shape. -> list of problems */
function badKeys(base, over, where) {
  const out = [];
  for (const k in over) {
    const p = where + '.' + k;
    if (!(k in base)) { out.push(p + ' is not a known key'); continue; }
    const b = base[k], o = over[k];
    if (b === null) { if (!(o === null || Array.isArray(o))) out.push(p + ' must be null or an array'); continue; }
    if (Array.isArray(b)) {
      if (!Array.isArray(o)) { out.push(p + ' must be an array'); continue; }
      if (Array.isArray(b[0])) { o.forEach((t, i) => { if (!Array.isArray(t) || t.length !== b[0].length) out.push(p + '[' + i + '] must have ' + b[0].length + ' numbers'); }); if (o.length !== b.length) out.push(p + ' must have ' + b.length + ' entries'); }
      else if (o.length !== b.length) out.push(p + ' must have ' + b.length + ' numbers');
      else if (!o.every((v) => typeof v === 'number' && isFinite(v))) out.push(p + ' must be numbers');
    } else if (typeof b === 'object') {
      if (!o || typeof o !== 'object' || Array.isArray(o)) out.push(p + ' must be an object');
      else if (k === 'sky') { for (const c in o) if (typeof o[c] !== 'number') out.push(p + '.' + c + ' must be a hex number'); }
      else out.push(...badKeys(b, o, p));
    } else if (typeof o !== typeof b) out.push(p + ' must be a ' + typeof b);
  }
  return out;
}

// ============================================================ the classic arena
console.log('classic arena');
test('classic arena is identical to the stored fixture', () => {
  const fix = JSON.parse(fs.readFileSync(path.join(root, 'tools/fixtures/classic-arenas.json'), 'utf8'));
  const GM = loadTerrain(FILES);
  GM.Arenas.use('verdant');
  const now = all(GM);
  for (const s of SEEDS) for (const k of Object.keys(fix[s])) assert.strictEqual(now[s][k], fix[s][k], 'seed ' + s + ' ' + k + ' changed');
});
test('the classic arena does not change when the pack is not installed', () => {
  const fix = JSON.parse(fs.readFileSync(path.join(root, 'tools/fixtures/classic-arenas.json'), 'utf8'));
  const now = all(loadTerrain(NO_PACK));
  for (const s of SEEDS) for (const k of Object.keys(fix[s])) assert.strictEqual(now[s][k], fix[s][k], 'seed ' + s + ' ' + k);
});
test('switching arenas back and forth leaves no trace in the classic one', () => {
  const GM = loadTerrain(FILES);
  GM.Arenas.use('verdant');
  const a = fingerprint(GM, 12345);
  for (const id of ['dunes', 'frost', 'mire']) { GM.Arenas.use(id); fingerprint(GM, 12345); }
  GM.Arenas.use('verdant');
  same(fingerprint(GM, 12345), a);
});

// ================================================================== the registry
console.log('\nregistry');
test('pack themes only use known keys and sane shapes', () => {
  const GM = loadTerrain(FILES);
  const src = fs.readFileSync(path.join(root, 'js/packs/expedition.js'), 'utf8');
  const probe = { register: (d) => probe.defs.push(d), defs: [] };
  // evaluate the pack against a recording registry
  const vm = require('vm');
  vm.runInNewContext(src, { window: { GM: { Arenas: probe } } });
  assert.strictEqual(probe.defs.length, 3);
  for (const d of probe.defs) {
    const bad = badKeys(GM.Arenas.DEFAULTS, d.params, d.id);
    assert.deepStrictEqual(bad, [], bad.join('\n'));
    assert.ok(d.pack === 'expedition' && d.icon, d.id + ' needs a pack and an icon');
  }
  same(probe.defs.map((d) => d.id), GM.Arenas.PACKS.expedition.arenas);
});
test('use() falls back to the classic arena for unknown ids; params never leak between themes', () => {
  const GM = loadTerrain(FILES);
  assert.strictEqual(GM.Arenas.use('nope'), 'verdant');
  assert.strictEqual(GM.Arenas.use('dunes'), 'dunes');
  assert.strictEqual(GM.Arenas.params().terrain.dryland, 0.5);
  GM.Arenas.use('verdant');
  assert.strictEqual(GM.Arenas.params().terrain.dryland, 0, 'classic keeps its default');
  assert.strictEqual(GM.Arenas.DEFAULTS.terrain.dryland, 0, 'defaults are never mutated');
  assert.strictEqual(GM.Arenas.params().terrain.lakes, null);
});
test('without the pack file the pack arenas are locked and cannot be selected', () => {
  const GM = loadTerrain(NO_PACK);
  const list = GM.Arenas.list();
  same(list.map((a) => a.id + ':' + a.owned), ['verdant:true', 'dunes:false', 'frost:false', 'mire:false']);
  assert.strictEqual(GM.Arenas.use('frost'), 'verdant');
  assert.strictEqual(GM.Arenas.select('frost'), false);
  assert.strictEqual(GM.Arenas.selected(), 'verdant');
  same(GM.Arenas.lockedPacks(), ['expedition']);
});
test('with the pack file all four are owned and a pick sticks', () => {
  const GM = loadTerrain(FILES);
  assert.ok(GM.Arenas.list().every((a) => a.owned));
  assert.strictEqual(GM.Arenas.lockedPacks().length, 0);
  assert.strictEqual(GM.Arenas.select('mire'), true);
  assert.strictEqual(GM.Arenas.selected(), 'mire');
});
test('names and pitches exist in both languages', () => {
  const GM = loadTerrain(FILES);
  const miss = GM.i18n.missing();
  const gaps = miss.hu.concat(miss.en).filter((k) => /^(arena|pack)\./.test(k));
  same(gaps, [], 'missing translations: ' + gaps.join(', '));
  for (const a of GM.Arenas.list()) for (const lang of ['en', 'hu']) {
    assert.ok(GM.i18n.has('arena.' + a.id, lang) && GM.i18n.has('arena.' + a.id + '.desc', lang), a.id + ' ' + lang);
  }
  assert.ok(GM.i18n.has('pack.expedition', 'hu') && GM.i18n.has('pack.expedition.desc', 'hu'));
});

// ======================================================================== themes
console.log('\npack arenas');
const GM = loadTerrain(FILES);
const SEED_SET = [];
for (let i = 0; i < 24; i++) SEED_SET.push(1000 + i * 37391);

for (const id of ['dunes', 'frost', 'mire']) {
  test(id + ': generates for ' + SEED_SET.length + ' seeds, deterministically, and stays playable', () => {
    GM.Arenas.use(id);
    for (const seed of SEED_SET) {
      const a = fingerprint(GM, seed);
      const b = fingerprint(GM, seed);
      same(a, b, 'not deterministic for ' + seed);
      const s = stats(GM, seed);
      assert.ok(s.reach >= 95, id + ' ' + seed + ': only ' + s.reach + '% of the walkable land is reachable from the Nexus');
      assert.ok(s.hide >= 12, id + ' ' + seed + ': only ' + s.hide + ' hiding places');
      assert.ok(s.biome.plaza >= 2, 'the plaza exists');
    }
  });
  test(id + ': differs from the classic arena', () => {
    GM.Arenas.use('verdant');
    const c = fingerprint(GM, 12345);
    GM.Arenas.use(id);
    const t = fingerprint(GM, 12345);
    assert.notStrictEqual(t.colors, c.colors);
    assert.notStrictEqual(t.heights, c.heights);
  });
}

const avg = (id, f) => {
  GM.Arenas.use(id);
  let sum = 0;
  for (const seed of SEED_SET.slice(0, 10)) sum += f(stats(GM, seed));
  return sum / 10;
};
test('Dune Sea is mostly sand, almost dry and nearly treeless', () => {
  assert.ok(avg('dunes', (s) => s.biome.sand || 0) >= 40, 'sand share');
  assert.ok(avg('dunes', (s) => (s.biome.water || 0)) <= 2.5, 'water share');
  assert.ok(avg('dunes', (s) => s.tree) <= 5, 'tree cover');
  assert.ok(avg('verdant', (s) => s.biome.water || 0) > avg('dunes', (s) => s.biome.water || 0), 'drier than the classic arena');
});
test('Frostfall is mostly snow with pine groves', () => {
  assert.ok(avg('frost', (s) => s.biome.snow || 0) >= 45, 'snow share');
  assert.ok(avg('frost', (s) => s.tree) >= 3, 'some forest');
  assert.ok(avg('frost', (s) => s.biome.snow || 0) > 10 * avg('verdant', (s) => s.biome.snow || 0.1), 'far more snow than the classic arena');
});
test('Drowned Mire has swamp, deep forest and lots of water', () => {
  assert.ok(avg('mire', (s) => s.biome.swamp || 0) >= 20, 'swamp share');
  assert.ok(avg('mire', (s) => s.biome.water || 0) >= 6, 'water share');
  assert.ok(avg('mire', (s) => s.tree) >= 15, 'tree cover');
  assert.ok(avg('mire', (s) => s.thickets) >= 6, 'thickets to hide in');
});
test('weather odds stay sane (no negative weights, at least one natural weather)', () => {
  for (const a of GM.Arenas.list()) {
    GM.Arenas.use(a.id);
    const w = GM.Arenas.params().env.weather;
    const total = Object.keys(w).reduce((n, k) => { assert.ok(w[k] >= 0, a.id + '.' + k); return n + w[k]; }, 0);
    assert.ok(total > 0, a.id);
    const e = GM.Arenas.params().env;
    assert.ok(e.snowFloor >= 0 && e.snowFloor <= 1 && e.wetFloor >= 0 && e.wetFloor <= 1, a.id);
  }
});

console.log('\n' + passed + ' tests passed' + (process.exitCode ? ' (with failures)' : ''));
