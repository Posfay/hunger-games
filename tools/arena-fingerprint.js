#!/usr/bin/env node
/* ==========================================================================
 * tools/arena-fingerprint.js — fingerprint of generated arenas (no browser).
 *
 *   node tools/arena-fingerprint.js              print fingerprints of the classic arena
 *   node tools/arena-fingerprint.js --write      store them as tools/fixtures/classic-arenas.json
 *
 * Loads core.js, i18n.js (+ arenas.js when present) and terrain.js into a sandbox, generates
 * arenas for fixed seeds and hashes every array that defines them. tools/arena-test.js
 * compares against the stored fixture: the classic arena must never change, because an
 * arena code (and every daily challenge) promises the same arena forever.
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const SEEDS = [1, 12345, 100000, 552704, 777777, 999999, 424242, 31337];

/** A page with the terrain modules loaded. `files` defaults to what the terrain needs. */
function loadTerrain(files) {
  const win = { localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }, addEventListener() {} };
  const ctx = vm.createContext({ window: win, console, TextEncoder, TextDecoder, atob, btoa, setTimeout, clearTimeout });
  for (const f of files || ['js/core.js', 'js/i18n.js', 'js/arenas.js', 'js/terrain.js']) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) continue;
    vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });
  }
  return win.GM;
}

function hashArr(a) {
  return crypto.createHash('sha1').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 16);
}

/** Fingerprint of the generated arena for a seed. */
function fingerprint(GM, seed) {
  GM.Terrain.generate(seed);
  const T = GM.Terrain;
  const rocks = JSON.stringify(T.rocks.map((r) => [r.x, r.z, r.s, r.kind, r.sx, r.sy, r.sz, r.rot, r.lift, r.block]));
  const lm = JSON.stringify(T.landmarks);
  const hide = JSON.stringify(T.hideSpots);
  return {
    heights: hashArr(T.heights), colors: hashArr(T.colors), forest: hashArr(T.forestData),
    nav: hashArr(T.nav.walk) + hashArr(T.nav.height) + hashArr(T.nav.cover),
    rocks: crypto.createHash('sha1').update(rocks).digest('hex').slice(0, 16),
    landmarks: crypto.createHash('sha1').update(lm).digest('hex').slice(0, 16),
    hide: crypto.createHash('sha1').update(hide).digest('hex').slice(0, 16),
  };
}

function all(GM) {
  const out = {};
  for (const s of SEEDS) out[s] = fingerprint(GM, s);
  return out;
}

module.exports = { loadTerrain, fingerprint, all, SEEDS };

if (require.main === module) {
  const out = all(loadTerrain());
  if (process.argv.includes('--write')) {
    fs.mkdirSync(path.join(root, 'tools/fixtures'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tools/fixtures/classic-arenas.json'), JSON.stringify(out, null, 1) + '\n');
    console.log('wrote tools/fixtures/classic-arenas.json (' + SEEDS.length + ' seeds)');
  } else {
    console.log(JSON.stringify(out, null, 1));
  }
}
