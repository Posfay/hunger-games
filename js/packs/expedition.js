/* ==========================================================================
 * packs/expedition.js — the Expedition Pack: three more arenas.
 *
 *   dunes   Dune Sea       sand, red mesas, one oasis; frequent heat waves
 *   frost   Frostfall      permanent snow, dark pines; cold nights hurt without a sleeping bag
 *   mire    Drowned Mire   black water, thick forest, fog; cover everywhere
 *
 * This file is the paid content: leave it out of a build and the base game shows these
 * arenas as locked cards (their names live in arenas.js). Each theme only overrides what
 * differs from the classic arena; see GM.Arenas.DEFAULTS for every key and its meaning.
 * Colours: pal / backdrop / trees use 0..255 triples (HSL 0..1 for trees); env.sky and water use hex.
 * ========================================================================== */
(function () {
  'use strict';
  const GM = window.GM;
  if (!GM || !GM.Arenas) return;

  // ------------------------------------------------------------------- Dune Sea
  GM.Arenas.register({
    id: 'dunes', pack: 'expedition', icon: '🏜️',
    params: {
      terrain: {
        lakes: [1, 2], lakeR: 0.55, stream: 0,
        hills: [3, 5], hillH: 1.3, hillR: 1.1,
        base: 2.4, rise: 3.0, noise: 3.8, rim: 0.85,
        snowLine: 999, rockSlope: [0.26, 0.42], rockH: [20, 30],
        dryland: 0.5, swamp: [-9, 2],
        forest: 0.18, boulders: 1.4, moistNoise: 0.9, moistBias: -0.04,
      },
      pal: {
        bed: [196, 176, 124], bedDeep: [112, 100, 70],
        sand: [226, 192, 122, 18, 16, 12],
        rockLo: [150, 98, 70], rockHi: [182, 124, 88], rockVar: [26, 20, 14],
        grass: [[172, 150, 88], [186, 160, 92], [198, 172, 100]],
        dry: [204, 168, 100], alpine: [168, 112, 80],
        forestFloor: [132, 112, 66, 10, 10, 6],
      },
      trees: {
        density: 1, lone: 0.03, scale: 0.8, pine: -0.9, onSand: true,
        pineCol: [0.3, 0.3, 0.2], broadCol: [0.16, 0.42, 0.34], autumn: 0.1, autumnCol: [0.1, 0.5, 0.42], trunkCol: [0.09, 0.35, 0.3],
      },
      grass: { byBiome: { grass: 0.55, swamp: 0.5, forest: 0.3, rock: 0.04, sand: 0.1, snow: 0 }, tint: [1.12, 1.0, 0.8] },
      water: { shallow: 0x58b7b0, deep: 0x15525f },
      backdrop: { snowH: 9999, rockH: 30, lo: [182, 132, 88, 16, 12, 8], rock: [152, 98, 70, 20, 14, 10] },
      env: {
        sky: { dayZen: 0x3a78c8, dayHor: 0xe6d2ae, fogDay: 0xd8c39e, gndDay: 0x6e5a3a, overDay: 0xb09a7c, sunNoon: 0xfff0d0 },
        weather: { rain: 0.08, fog: 0.15, storm: 0.3, snow: 0, heat: 4.5 },
      },
    },
  });

  // ------------------------------------------------------------------- Frostfall
  GM.Arenas.register({
    id: 'frost', pack: 'expedition', icon: '❄️',
    params: {
      terrain: {
        lakes: [2, 3], lakeR: 1.1, stream: 0.5,
        hills: [3, 5], hillH: 1.1,
        base: 3.4, rise: 4.0, noise: 3.6, rim: 1.15,
        snowLine: 1.0, swamp: [-9, 2],
        forest: 1.9, treeLine: [38, 50], boulders: 1.1,
      },
      pal: {
        bed: [120, 150, 170], bedDeep: [40, 62, 84],
        sand: [200, 214, 226, 10, 10, 8],
        snow: [238, 243, 250, 10, 10, 8],
        rockLo: [96, 102, 112], rockHi: [150, 158, 170], rockVar: [20, 20, 20],
        grass: [[124, 138, 118], [138, 150, 128], [150, 160, 138]],
        dry: [150, 156, 150], alpine: [180, 188, 196],
        forestFloor: [60, 84, 74, 10, 10, 8],
      },
      trees: {
        density: 1, lone: 0.03, scale: 1.05, pine: 0.7, onSnow: true,
        pineCol: [0.43, 0.38, 0.17], broadCol: [0.14, 0.15, 0.55], autumn: 0, trunkCol: [0.08, 0.15, 0.3],
      },
      grass: { byBiome: { grass: 0.5, swamp: 0.5, forest: 0.3, rock: 0.08, sand: 0, snow: 0 }, tint: [0.95, 1.0, 1.0] },
      water: { shallow: 0xa7d8e8, deep: 0x1d4a6b },
      backdrop: { snowH: 50, rockH: 28, lo: [150, 160, 172, 10, 10, 8], rock: [120, 128, 140, 14, 14, 14], snow: [236, 240, 248, 0, 0, 0] },
      env: {
        sky: { dayZen: 0x5a8ccc, dayHor: 0xc6d8ea, fogDay: 0xc2ccd6, gndDay: 0x7d8794, overDay: 0xaab4c0, sunNoon: 0xeef4ff },
        weather: { rain: 0.2, fog: 1.3, storm: 0.5, snow: 7, heat: 0 },
        snowFloor: 0.85,
      },
    },
  });

  // --------------------------------------------------------------- Drowned Mire
  GM.Arenas.register({
    id: 'mire', pack: 'expedition', icon: '🐊',
    params: {
      terrain: {
        lakes: [4, 6], lakeR: 1.25, stream: 0.9,
        hills: [1, 2], hillH: 0.5, hillR: 1.2,
        base: 1.1, rise: 1.8, noise: 2.0, rim: 0.9,
        snowLine: 999, swamp: [4.5, 0.4],
        forest: 1.6, treeLine: [36, 48], boulders: 0.6, moistNoise: 0.55, moistBias: 0.22,
      },
      pal: {
        bed: [90, 84, 60], bedDeep: [40, 46, 34],
        sand: [140, 124, 86, 12, 10, 8],
        swamp: [64, 78, 44, 14, 12, 8],
        grass: [[70, 110, 50], [82, 122, 54], [96, 132, 58]],
        dry: [110, 120, 66], alpine: [100, 112, 88],
        forestFloor: [38, 62, 34, 10, 10, 6],
      },
      trees: {
        density: 1.2, lone: 0.02, scale: 1.1, pine: -0.4,
        pineCol: [0.35, 0.4, 0.16], broadCol: [0.27, 0.45, 0.24], autumn: 0.02, trunkCol: [0.1, 0.25, 0.16],
      },
      grass: { byBiome: { grass: 1, swamp: 1, forest: 0.6, rock: 0.1, sand: 0.1, snow: 0 }, tint: [0.9, 1.05, 0.85] },
      water: { shallow: 0x5f8a62, deep: 0x14261c },
      backdrop: { snowH: 9999, rockH: 40, lo: [48, 66, 48, 10, 10, 6], rock: [96, 100, 92, 12, 12, 10] },
      env: {
        sky: { dayZen: 0x5d86a8, dayHor: 0xb4c4b8, fogDay: 0x9fb0a6, gndDay: 0x2f3a28, overDay: 0x8f9c98 },
        weather: { rain: 2.2, fog: 3.2, storm: 1.0, snow: 0, heat: 0.2 },
        wetFloor: 0.35,
      },
    },
  });
})();
