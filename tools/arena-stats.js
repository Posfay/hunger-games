#!/usr/bin/env node
/* ==========================================================================
 * tools/arena-stats.js — what does an arena theme actually produce? (no browser)
 *
 *   node tools/arena-stats.js [arena ...] [--seeds N]
 *
 * For each arena and seed: share of the playable disc covered by each biome, water,
 * tree cover, walkable share, how much of the walkable area can be reached on foot from
 * the Nexus, and landmark counts. Use it to tune js/packs/*.js.
 * ========================================================================== */
'use strict';
const { loadTerrain } = require('./arena-fingerprint.js');

const FILES = ['js/core.js', 'js/i18n.js', 'js/arenas.js', 'js/packs/expedition.js', 'js/terrain.js'];
const DEFAULT_SEEDS = [1, 12345, 424242, 552704, 777777, 31337];

/** Numbers describing the generated arena of `seed` for the active theme. */
function stats(GM, seed) {
  const T = GM.Terrain, CFG = GM.CFG;
  T.generate(seed);
  const R = CFG.ARENA_RADIUS;
  const counts = {};
  let n = 0, forest = 0, hmin = 1e9, hmax = -1e9;
  for (let x = -R; x <= R; x += 4) {
    for (let z = -R; z <= R; z += 4) {
      if (x * x + z * z > R * R) continue;
      const b = T.biomeAt(x, z);
      counts[b] = (counts[b] || 0) + 1;
      forest += T.forestAt(x, z);
      const h = T.heightAt(x, z);
      if (h < hmin) hmin = h;
      if (h > hmax) hmax = h;
      n++;
    }
  }
  const share = {};
  for (const k in counts) share[k] = Math.round((counts[k] / n) * 100);
  // reachability: flood fill over walkable nav cells from the cell at the Nexus
  const N = T.nav.res, walk = T.nav.walk;
  let walkable = 0;
  for (let i = 0; i < walk.length; i++) walkable += walk[i];
  const seen = new Uint8Array(walk.length);
  const start = (N >> 1) * N + (N >> 1);
  const stack = [start];
  seen[start] = 1;
  let reach = 0;
  while (stack.length) {
    const c = stack.pop();
    if (!walk[c]) continue;
    reach++;
    const cx = c % N, cz = (c / N) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const k = nz * N + nx;
      if (!seen[k]) { seen[k] = 1; stack.push(k); }
    }
  }
  const lm = T.landmarks;
  return {
    biome: share, tree: Math.round((forest / n) * 100),
    reach: Math.round((reach / Math.max(1, walkable)) * 100),
    lakes: lm.lakes.length, hills: lm.hills.length, caves: lm.caves.length, thickets: lm.thickets.length,
    hide: T.hideSpots.length, rocks: T.rocks.length, h: [Math.round(hmin * 10) / 10, Math.round(hmax * 10) / 10],
  };
}

module.exports = { stats, FILES, DEFAULT_SEEDS };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const si = argv.indexOf('--seeds');
  const seeds = si >= 0 ? DEFAULT_SEEDS.slice(0, +argv[si + 1] || DEFAULT_SEEDS.length) : DEFAULT_SEEDS;
  const names = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--seeds');
  const GM = loadTerrain(FILES);
  const ids = names.length ? names : GM.Arenas.list().filter((a) => a.owned).map((a) => a.id);
  for (const id of ids) {
    GM.Arenas.use(id);
    console.log('== ' + id);
    for (const s of seeds) {
      const r = stats(GM, s);
      console.log('  seed ' + String(s).padEnd(7) + ' biome%=' + JSON.stringify(r.biome) + ' trees=' + r.tree + '% reach=' + r.reach + '% lakes=' + r.lakes + ' hills=' + r.hills + ' caves=' + r.caves + ' thickets=' + r.thickets + ' hide=' + r.hide + ' rocks=' + r.rocks + ' h=' + r.h.join('..'));
    }
  }
}
