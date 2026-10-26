# Arena Showrunner — Architecture & Module Contract

This file is the **contract** between all modules. Every module is written by a
different engineer in parallel, so the APIs, field names, event names and
i18n rules below are binding. If you must deviate, keep the documented API
working (add an alias) and report it.

Read `js/core.js`, `js/i18n.js`, `js/main.js` and `index.html` first — they are
finished and define the runtime you build on.

---------------------------------------------------------------------------

## 1. Vision

A 3D reality-TV battle royale **simulation**. 2–48 (default 24)
autonomous contestants spawn on pedestals around a golden nexus, grab loot,
form and betray alliances, hide, hunt, starve, freeze and fight until one
remains. **The player is the Showrunner**, sitting in a control room:
watching live camera feeds, a minimap, a kill feed, and bending the arena in
real time (weather, fire, floods, earthquakes, beasts, supply drops, feasts,
closing force field...). An **audience rating** rewards dramatic shows and
funds the Showrunner's powers.

Creative pillars:
1. **Readable drama** — every contestant shows what it is thinking ("Hunting
   Mara", "Too scared — running away"). The player should understand *why*
   things happen.
2. **The arena is a weapon** — every Showrunner power changes contestant
   behaviour, not just HP (fire makes them flee and burns their cover, flood
   pushes them to high ground, fog makes ambushes, a feast lures everyone).
3. **Distinct minds** — 8 psychological archetypes plus random trait
   variation and dynamic emotions (fear, rage, confidence, sanity).
4. **A control room, not a HUD** — dark, dense, instrument-like interface;
   live feeds that cut to the action; REC indicators; clean data.
5. **Simple words, two languages** — all text in plain English and plain
   Hungarian, switchable instantly (even old log lines re-translate).

---------------------------------------------------------------------------

## 2. Technical rules (all modules)

- **No build step, no ES modules.** Plain classic `<script>` files, loaded in
  the order in `index.html`. Must work from `file://` and from a static server.
- **Wrap every file in an IIFE** with `'use strict'`. Top-level `const/let` in
  classic scripts share one global scope and would collide.
  ```js
  (function () { 'use strict'; const GM = window.GM; /* ... */ })();
  ```
- Everything public hangs off `window.GM` (e.g. `GM.Terrain`, `GM.Contestants`).
- **Three.js r149** (`THREE` global, from cdnjs 0.149.0). Notes for r149:
  - No `THREE.Geometry`; use `BufferGeometry` (all `XxxGeometry` classes are buffer geometries).
  - `CapsuleGeometry` exists. `BufferGeometryUtils`, `OrbitControls` etc. are
    **not** available (examples folder not loaded) — write what you need.
  - `InstancedMesh` with `setMatrixAt`, `setColorAt` (+ `instanceMatrix.needsUpdate`,
    `instanceColor.needsUpdate`).
  - **Colour pipeline (see `js/gfx.js`, `js/post.js`)**: linear working space,
    `THREE.ColorManagement.legacyMode = false`. Every view renders into an HDR
    target and `GM.Post` applies bloom, SSAO, sun shafts, depth of field, ACES
    tone mapping and the colour grade, then writes sRGB.
    - Hex colours (`new THREE.Color(0x...)`, material `color`, `.set(hex)`) are
      sRGB and are converted automatically: author them as before.
    - Raw numbers (`setRGB`, `setHSL`, vertex-colour arrays, `DataTexture`
      bytes) are **linear**. Convert authored sRGB values with
      `GM.Gfx.lin()` / `GM.Gfx.LIN8[byte]` / `GM.Gfx.toLinear(color)`.
    - Canvas textures that hold colours need `texture.encoding = THREE.sRGBEncoding`.
    - Use `MeshStandardMaterial` for lit objects: ambient light comes from the
      sky environment map (`scene.environment`), the sun is a
      `DirectionalLight` with HDR intensity (~3). Lambert/Phong look flat.
    - Glowing things are HDR: multiply emissive/basic colours above 1 (fire,
      beacons, eyes ~3-10x) so they bloom. Multiply by the shared
      `gmPost.y` uniform to stay balanced when the exposure rises at night.
    - Crisp overlays (name tags, selection ring, targeting reticle) go on
      layer `GM.Post.OVERLAY`: drawn after the composite, depth tested, no
      tone mapping or bloom (set `toneMapped: false`).
    - Custom shaders can share sun, sky, wind, wetness, snow, time and a noise
      texture: `GM.Gfx.patch(material, {...})` for built-in materials,
      `GM.Gfx.uniformsWith(own, withFog)` + `#include <gm_common>` for
      `ShaderMaterial`s. `fog: true` gets the height fog automatically.
- **Units:** 1 unit = 1 metre. Y is up. The arena is centred at (0,0).
- **Heading convention:** models face **+Z** at `rotation.y = 0`;
  `heading = Math.atan2(dx, dz)`; use `GM.U.headingTo(from, to)`.
- **Time:** `update(dt)` receives **sim seconds** (already scaled by game
  speed, split into ≤ 1/30 s sub-steps; never called while paused or on the
  setup screen). `frame(realDt)` receives real seconds and runs every frame.
  Gameplay timers use sim time (`GM.state.time`). Camera, UI and audio use
  real time.
- **Randomness:** gameplay uses `GM.R` (seeded). Cosmetic jitter may use `Math.random()`.
- **Defensive calls across modules.** Other modules may be missing or
  broken during development. Guard optional calls:
  `GM.Audio && GM.Audio.play('knell')`. Never let one module's failure stop
  another. (main.js already wraps every system method in try/catch.)
- **Performance budget** (mid-range laptop, 60 fps at 1x with 24 contestants,
  up to 48 contestants at 16x must stay playable):
  - Instanced meshes for trees, rocks, grass. Contestant = ≤ 10 meshes.
  - No per-frame allocations in hot loops (reuse `THREE.Vector3` temps).
  - AI thinking is throttled (each contestant decides every ~0.3–0.6 sim s, staggered).
  - Pathfinding is budgeted (few A* runs per update).
  - The scene is rendered up to 4 times per frame (main + 3 feeds). Keep draw calls low.
- `GM.state.settings.quality` is `'high'` or `'low'`. Low = no shadows,
  ~60 % props, fewer particles, feeds at lower resolution.
- **Syntax check** every file you write: `node --check js/yourfile.js`.
- No `alert/confirm/prompt`, no `window.print`, no downloads.
- Code style: 2-space indent, semicolons, JSDoc-ish comments on public
  functions, concise comments elsewhere. Match `core.js`.

---------------------------------------------------------------------------

## 3. File ownership

| File | Owner | Global(s) |
|---|---|---|
| `index.html` | core (UI may edit only between `FONTS:BEGIN/END`) | – |
| `js/core.js`, `js/i18n.js`, `js/main.js`, `SPEC.md` | core | `GM`, `GM.i18n`, `GM.Game` |
| `js/gfx.js`, `js/post.js` | **WORLD** | `GM.Gfx` (colour, shared uniforms, height fog, material patching), `GM.Post` (HDR pipeline) |
| `js/terrain.js` | **WORLD** | `GM.Terrain` |
| `js/world.js` | **WORLD** | `GM.World`, `GM.FX` |
| `js/env.js` | **WORLD** | `GM.Env` |
| `js/items.js` | **CONTESTANTS** | `GM.ItemDefs`, `GM.Items` |
| `js/contestants.js` | **CONTESTANTS** | `GM.Contestants` |
| `js/combat.js` | **CONTESTANTS** | `GM.Combat` |
| `js/ai.js` | **AI** | `GM.AI`, `GM.Archetypes`, `GM.ARCHETYPE_IDS` |
| `js/hazards.js` | **SHOWRUNNER** | `GM.Hazards` |
| `js/beasts.js` | **SHOWRUNNER** | `GM.Beasts` |
| `js/powers.js` | **SHOWRUNNER** | `GM.Powers`, `GM.Audience`, `GM.AutoGM` |
| `js/camera.js` | **CAMERA** | `GM.Cameras` |
| `js/audio.js` | **CAMERA** | `GM.Audio` |
| `js/minimap.js` | **UI** | `GM.Minimap` |
| `js/ui.js` | **UI** | `GM.UI` |
| `css/style.css` | **UI** | – |

Only edit files you own. If you need something from another module that the
spec does not give you, feature-detect it and list it in your report.

---------------------------------------------------------------------------

## 4. Lifecycle

`GM.registerSystem({ name, order, init, clear, reset, update, frame })`

| Method | When |
|---|---|
| `init()` | Once at boot. DOM + THREE ready. Terrain **not** generated yet. Create renderer/scene (World), DOM (UI), listeners. |
| `clear()` | Before every new game and when returning to setup. Remove all game entities (contestants, items, beasts, hazards, effects) from the scene and reset module state. |
| `reset(settings)` | New game, after terrain generation + `'arena:generated'`. Build the game entities. |
| `update(dt)` | Simulation step, phases `countdown`, `running`, `ended`. Not while paused. |
| `frame(realDt)` | Every animation frame, all phases. Visual interpolation, camera, UI refresh, audio. |

System order (ascending):

| order | system | file |
|---|---|---|
| 10 | Terrain | terrain.js |
| 20 | World (+FX) | world.js |
| 25 | Env | env.js |
| 30 | Hazards | hazards.js |
| 40 | Items | items.js |
| 50 | Contestants | contestants.js |
| 55 | Beasts | beasts.js |
| 60 | AI | ai.js |
| 70 | Combat | combat.js |
| 80 | Powers (+Audience, AutoGM) | powers.js |
| 90 | Cameras | camera.js |
| 95 | Audio | audio.js |
| 100 | UI | ui.js |
| 105 | Minimap | minimap.js |

Flow (main.js):
1. Boot: `i18n.init()`, all `init()`, `previewArena(randomSeed)` →
   `Terrain.generate(seed)` + emit `'arena:generated' {seed}` → `toSetup()`:
   all `clear()`, phase `'setup'`, emit `'game:setup'`.
2. Setup screen (UI). Camera mode `'showcase'` orbits the arena. Changing the
   seed calls `GM.Game.previewArena(seed)`.
3. Start: UI calls `GM.Game.newGame(settings)` → all `clear()` →
   `GM.resetState(settings)` → `Terrain.generate(seed)` → `'arena:generated'`
   → all `reset(settings)` → phase `'countdown'` (10 s on pedestals, emits
   `'countdown:tick' {n}` for 10..1) → phase `'running'`, emit `'game:start'`
   (the gong / "kickoff").
4. Running until ≤ 1 contestant alive → phase `'ended'`, `state.winner`, emit
   `'game:end' {winner}` (winner may be `null`). Simulation keeps running
   (winner idles; **damage is ignored in phase `ended`**).
5. UI's "New Show" button → `GM.Game.toSetup()`.

Speed/pause: `GM.Game.setSpeed(x)`, `GM.Game.stepSpeed(±1)`,
`GM.Game.togglePause()`. Speeds: `CFG.SPEEDS = [0.5, 1, 2, 4, 8, 16]`.

---------------------------------------------------------------------------

## 5. Core API (already implemented — see `core.js`)

- `GM.CFG` — constants (map size 360, arena radius 150, day length 300 s, ...).
- `GM.state` — the single mutable game state (see core.js for all fields).
  Always read `GM.state.x` at use time; never cache its arrays.
- `GM.R` — seeded RNG: `random() range(a,b) int(a,b) chance(p) pick(arr) shuffle(arr) gauss(m,sd) weighted(obj) angle()`.
- `GM.Noise.create(seed)` → `{ noise2, fbm, ridged }`.
- `GM.U` — `clamp clamp01 lerp invLerp remap smoothstep damp dist2 distXZ distSqXZ headingTo wrapAngle angleDiff lerpAngle lenXZ uid formatClock formatDuration toPos TAU`.
- `GM.teamColor(team)` → `'#rrggbb'`.
- Events: `GM.on(name, fn) → unsubscribe`, `GM.off`, `GM.once`, `GM.emit(name, data)`.
- `GM.reportError(where, err)`.
- `GM.log(type, key, params, {pos, contestantIds, important})` → log entry
  `{id, type, key, params, time, day, tod, pos, contestantIds, important}`; emits `'log'`.
  Types: `kill death combat alliance betrayal item gm hazard event mind system`.
- `GM.announce(key, params, {style: 'info'|'danger'|'gold'|'gm', duration})` → emits `'announce'`.
- `GM.addInterest({pos, score, duration, label:{key,params}, followId, kind, key})` —
  points of interest for the auto-director and feeds. Score guide: wandering 1–2,
  supply drop 3, fight 5–8, hazard 6–9, betrayal 9, death 10, finale 12.
- `GM.select(id|null)`, `GM.selected()` → contestant or null. Emits `'select' {id}`.
- `GM.t(key, params)` translation shortcut.
- `GM.isRunning()` → phase === 'running'.

---------------------------------------------------------------------------

## 6. Localisation rules (i18n)

- **Every user-visible string goes through `GM.t()`** or `data-i18n*`
  attributes. No hard-coded English in the DOM or in logs.
- Each module registers its own strings with `GM.i18n.add({en:{...}, hu:{...}})`
  at the top of its file. **Every key must exist in both languages.**
- Key namespaces:

  | namespace | owner |
  |---|---|
  | `app.* lang.* common.* tod.* weather.* cause.* ann.kickoff* ann.victor ann.noVictor log.gamesBegin log.victor log.noVictor` | core (i18n.js) |
  | `env.* terrain.* ann.env.* log.env.*` | WORLD |
  | `item.* contestant.* status.* log.death.* log.kill.* log.item.* log.combat.* ann.feast*` | CONTESTANTS |
  | `arch.* act.* thought.* mood.* trait.* log.alliance.* log.betray.* log.mind.*` | AI |
  | `power.* hazard.* beast.* audience.* autogm.* ann.gm.* log.gm.* log.hazard.*` | SHOWRUNNER |
  | `cam.* audio.*` | CAMERA |
  | `ui.* setup.* help.* victory.* recap.* minimap.* feed.*` | UI |

- Log entries and thoughts store `{key, params}` — never pre-translated text —
  so they re-translate instantly on `'lang:changed'`.
- Params: contestant names are plain strings (never translated). Pass
  translatable words as `'@key'` (e.g. `{weapon: '@item.spear'}`).
- **Simple language.** Short sentences, common words, no idioms, no rare
  or archaic vocabulary. Written for non-native speakers.
- **Hungarian:** natural, simple Hungarian. Use "versenyző" (contestant),
  "csapat" (team), "Nexus" (Nexus), "Showrunner" (Showrunner),
  "Műsor" (the Show), "fenevad" (beast), "gyilkosdarázs" (killer wasp).
  **Never glue a case suffix to a placeholder** (`{name}-t`, `{weapon}-val`
  break vowel harmony). Rephrase: `"{killer} megölte: {victim} ({weapon})"`,
  `"Vadászik rá: {target}"`, `"Célpont: {target}"`.
- English plurals: add `key_one` when `params.n === 1` needs a singular form.

---------------------------------------------------------------------------

## 7. Data model

### 7.1 Settings (`GM.state.settings`, built by the UI setup screen)

```js
{
  seed: 123456,            // uint32
  contestantCount: 24,        // 2..48 (== roster.length)
  mix: 'balanced',         // 'balanced' | 'bloodthirsty' | 'peaceful' | 'chaos'
  roster: [ { name, team, gender: 'f'|'m', archetype } ],  // editable in setup
  sandbox: false,          // unlimited GM energy, cooldowns x0.25
  autoGM: false,           // assistant AI triggers events when the audience is bored
  quality: 'high',         // 'high' | 'low'
  feeds: true,             // live camera feeds on/off
  nameTags: true,          // name tags above contestants
  startSpeed: 1,
}
```
`GM.Game.normalizeSettings()` fills defaults and generates a roster via
`GM.Contestants.generateRoster(count, mix, seed)` if none was given.

### 7.2 Contestant object (`GM.state.contestants[i]`, `t.id === i`)

Created by **CONTESTANTS** (`contestants.js`). Column "writer" says who updates it.

| field | type | writer | meaning |
|---|---|---|---|
| `kind` | `'contestant'` | T | entity kind (targets can be contestants or beasts) |
| `id` | int | T | index in `state.contestants` |
| `name` | string | T | display name (never translated) |
| `team` | int ≥ 1 | T | team number |
| `gender` | `'f'｜'m'` | T | cosmetic |
| `color` | `'#hex'` | T | team colour (`GM.teamColor`) |
| `archetype` | string | T (from roster) | archetype id (§9.1) |
| `traits` | `{aggression, bravery, greed, sociability, loyalty, cunning, patience, stability}` 0..1 | AI (`initMind`) | personality |
| `skills` | `{strength, speed, stealth, survival, aim}` 0..1 | T creates, AI adjusts in `initMind` | abilities |
| `alive` | bool | T | |
| `health`, `maxHealth` | 0..100 | T | |
| `stamina` | 0..100 | T | drains when running/swimming |
| `hunger` | 0..100 | T | **0 = full, 100 = starving** |
| `thirst` | 0..100 | T | 0 = fine, 100 = dying of thirst |
| `energy` | 0..100 | T | 100 = rested; sleep restores |
| `emotion` | `{fear, rage, confidence, sanity}` 0..1 | AI | sanity 1 = stable |
| `mood` | string | AI | `calm afraid angry confident desperate mad asleep hurt` |
| `pos` | `THREE.Vector3` | T | feet position (y = ground / water surface) |
| `vel` | `THREE.Vector3` | T | current velocity |
| `heading` | radians | T | facing (see heading convention) |
| `radius` | 0.45 | T | collision radius |
| `inv` | object | T (Items/Combat) | see 7.3 |
| `status` | object | T/AI/GM | timers in sim s: `{stun, poison, madness, panic, burning, stung, bleeding}` (0 = none) |
| `sleeping`, `hidden`, `sneaking`, `swimming`, `inWater` | bool | T (sleep via `Contestants.setSleeping`), AI sets `sneaking`/`hidden` intent | |
| `nav` | object | T | locomotion state (§8.4) |
| `action` | string | AI | current action id (§9.3) |
| `thought` | `{key, params}` | AI | current thought (shown in UI) |
| `targetId` | int｜null | AI | contestant being hunted/fled/followed |
| `allianceId` | int｜null | AI | |
| `mind` | object | AI | private AI data (memory, relations, timers) |
| `kills` | int | T | |
| `damageDealt` | number | T | |
| `killedBy` | id｜null, `deathCause` string, `deathWeapon` string｜null, `deathTime`, `deathDay` | T | set in `Contestants.kill` |
| `placement` | int｜null | T (main sets winner = 1) | final rank (24 = first to die) |
| `popularity` | 0..1 | SHOWRUNNER (Audience) | audience favour |
| `mesh` | `THREE.Group` | T | scene object at feet |
| `lastAttackedBy` | id｜null, `lastAttackedAt` sim time | T | for kill credit & AI |

### 7.3 Inventory `t.inv`

```js
{
  melee: null | 'knife'|'sickle'|'axe'|'sword'|'mace'|'spear'|'trident',
  ranged: null | 'bow'|'throwing_knives',
  ammo: 0,          // arrows for bow, knives for throwing_knives
  armor: false,     // armor vest
  food: 0, water: 0, medkit: 0, berries: 0,
  traps: 0,         // trap kits
  sleepingBag: false,
  goggles: false,   // night-vision goggles
}
```

### 7.4 Items (`GM.ItemDefs`, fixed ids)

| id | kind | key numbers |
|---|---|---|
| `knife` | melee | dmg 16, range 1.8, cd 0.7 |
| `sickle` | melee | dmg 18, range 1.9, cd 0.8 |
| `axe` | melee | dmg 26, range 2.0, cd 1.2 |
| `sword` | melee | dmg 24, range 2.2, cd 0.9 |
| `mace` | melee | dmg 28, range 2.0, cd 1.3, 20 % stun 1 s |
| `spear` | melee | dmg 22, range 3.0, cd 1.1 |
| `trident` | melee | dmg 32, range 3.0, cd 1.1 (feast / rare) |
| `bow` | ranged | dmg 30, range 45, cd 1.6, ammo arrows (+8 on pickup) |
| `throwing_knives` | ranged | dmg 18, range 20, cd 1.0, ammo = knives (+5) |
| `arrows` | ammo | +8 arrows (only useful with bow) |
| `armor` | armor | −30 % damage from weapons, beasts, explosions |
| `food` | consumable | hunger −45 |
| `water` | consumable | thirst −50 |
| `medkit` | consumable | +45 health over 5 s, stops bleeding/poison |
| `berries` | consumable | hunger −20; toxin chance `0.10 × (1 − survival)` → poison |
| `trap_kit` | tool | +1 trap (place a hidden snare/spike trap) |
| `sleeping_bag` | tool | no cold damage, faster sleep |
| `goggles` | tool | night sight almost like day |
| `backpack` | bundle | opens into 2–4 random supplies |
| `crate` | bundle | supply drop crate / sponsor parachute (contents list) |

Fists (no weapon): dmg 6, range 1.6, cd 0.9. Damage × strength factor
(`0.8 + 0.45 × skills.strength`). Armor −30 %.

### 7.5 Ground item (`GM.Items.list[]`)

```js
{ id, type /* ItemDefs id */, pos: THREE.Vector3, mesh, amount, contents: [types] | null,
  crate: bool, falling: bool, claimedBy: contestantId | null, spawnedAt }
```

### 7.6 Beast (`GM.state.beasts[]`, also `GM.Beasts.list`)

```js
{ kind: 'beast', type: 'wolf' | 'wasps', id, pos: THREE.Vector3, alive, health, maxHealth,
  radius, targetId, expires, mesh }
```

### 7.7 Targets

Combat/AI targets are either a contestant or a beast: both have
`kind, id, pos, alive, radius`. Use `target.kind` to branch.

---------------------------------------------------------------------------

## 8. Module APIs

Signatures are binding. "→" = return value. Positions accept any `{x, z}`
(and `y` where relevant) unless stated.

### 8.1 `GM.Terrain` (WORLD, terrain.js, order 10)

Pure data + queries (the mesh lives in World).

```
generate(seed)                 build heights, biomes, forest cover, nav grid, landmarks (deterministic)
size, res, cellSize, half      MAP_SIZE, TERRAIN_RES, spacing (2 m), MAP_SIZE/2
heights                        Float32Array res*res (row-major: index = iz*res + ix)
heightAt(x, z) → y             bilinear, clamped outside the map
normalAt(x, z, out?) → THREE.Vector3
slopeAt(x, z) → 0..1           0 flat, 1 vertical
waterLevel() → y               current water level (reads GM.Env.waterLevel, default CFG.BASE_WATER_LEVEL)
isWater(x, z) → bool           ground below water level
waterDepth(x, z) → metres      (0 on land)
inArena(x, z, margin=0) → bool inside ARENA_RADIUS - margin
biomeAt(x, z) → 'plaza'|'sand'|'grass'|'forest'|'rock'|'snow'|'water'|'swamp'
forestAt(x, z) → 0..1          live tree cover (burning reduces it)
burnForest(x, z, radius)       set cover to 0 in area, emit 'forest:burnt' {x, z, radius}
colorAt(x, z) → {r, g, b}      0..255, same palette as the 3D terrain (minimap)
deform(x, z, radius, amount, mode) mode 'raise'|'lower'|'crater'|'smooth'|'flatten'.
                               Updates heights + nav grid, emits 'terrain:changed' {x, z, radius}.
randomLandPoint(opts) → {x, z} opts {minR, maxR, biome, avoidWater=true, rng=GM.R}
nearestWater(x, z, maxDist=120) → {x, z} | null   a LAND point within ~2 m of water (to drink)
findCover(x, z, maxDist=60) → {x, z} | null       nearby point with high cover (forest/rocks)
findPath(sx, sz, gx, gz, opts) → [{x, z}, ...] | null
                               A* on the nav grid (CFG.NAV_RES²), 8-neighbour, costs: slope,
                               water (swimming ×6), outside arena = blocked, plus danger
                               cost from GM.Hazards.dangerAt(x, z) (×30). Smoothed with
                               line-of-sight. opts {maxNodes=4000, avoidDanger=true}. If the goal
                               is blocked/unreachable, returns a path to the closest reachable cell.
walkable(x, z) → bool
raycast(origin, dir, maxDist=2000) → THREE.Vector3 | null   heightfield ray march (mouse picking)
landmarks                      { nexus: {x:0, z:0}, lakes: [{x, z, r}], hills: [{x, z}],
                                 caves: [{x, z}], ... } (caves/rock shelters are hiding spots)
hideSpots                      [{x, z, quality 0..1}]  good hiding places (dense forest, rocks, caves)
```

Design: bowl-shaped arena. Flat plaza (radius 24, height ~2) with the
nexus at the centre; meadows around it; forests (noise-driven, dense
belts); 1–3 lakes (basins below water level) 45–120 m from centre, maybe a
stream; rocky hills; terrain rises steeply into mountains beyond ~135 m so the
force-field wall at 150 m sits on slopes. Water level 0; plaza ~2; typical
land 1–12 m; hills up to ~25 m; rim mountains 30–60 m.

### 8.2 `GM.World` + `GM.FX` (WORLD, world.js, order 20)

```
World.renderer, World.scene          created in init() on canvas#gl (antialias, shadows when quality high)
World.terrainMesh                    rebuilt on 'arena:generated'; vertex-coloured low-poly (flatShading)
World.water                          water mesh (y follows GM.Env.waterLevel)
World.sun, World.hemi                lights (Env animates them)
World.rebuild()                      rebuild terrain mesh, trees, rocks, water, nexus, dome
World.pedestals(n) → [{x, y, z, heading}]   n start positions on a ring (PEDESTAL_RADIUS), facing centre;
                                     also creates/updates n pedestal meshes
World.setShadowFocus(x, z)           centre the sun's shadow camera (Cameras call it every frame)
World.trees                          [{x, z, scale, type, burnt}] (instanced)
World.burnTreesInArea(x, z, r)       char/shrink trees (called on 'forest:burnt')
World.add(obj) / World.remove(obj)   scene helpers (dispose geometry/material on remove if asked)
```
Visuals: stylised but physically lit. Smooth terrain with procedural detail
(plaza stonework, layered cliffs, wet shores, lake-bed caustics, puddles and
snow cover driven by the weather), baked + screen-space ambient occlusion,
drifting cloud shadows. Polished hammered-gold nexus, brushed-metal
pedestals. Trees in culled spatial chunks with a near/far LOD, wind sway and
translucent leaves (`World.prepareView(camera)` picks the LOD per view). A GPU
grass field (instanced blade patches around each camera, pushed aside by
contestants). Depth-aware water (absorption, Fresnel sky reflection, sun glitter,
shore foam). Faint hexagon force-field dome at `ARENA_RADIUS`.

`GM.FX` — shared pooled effects (everyone uses these instead of writing their own):
```
FX.burst(pos, opts)     one-shot particles {count=16, color=0xffffff, color2, speed=4, spread=1,
                        up=2, gravity=-9.8, size=0.3, life=0.8, additive=false}
FX.emit(pos, opts)      same, meant for small per-frame emitters (smoke, sparks)
FX.flash(pos, color=0xffffff, intensity=2, radius=25, duration=0.25)   pooled PointLight flash
FX.ring(pos, color, radius, duration)    expanding ground shock-wave ring
FX.beam(from, to, color, width, duration)  glowing line (lightning, hovercraft tractor beam)
```
FX animate in `update(dt)` (freeze when paused) and are removed on `clear()`.

### 8.3 `GM.Env` (WORLD, env.js, order 25)

Sky, day/night, weather, wind, water level.

```
timeOfDay                       mirror of GM.state.timeOfDay (0..1); advances by dt / CFG.DAY_LENGTH while running
isNight() → bool                timeOfDay < DAWN or > DUSK
daylight() → 0..1               smooth light factor
phaseKey() → 'tod.dawn'|'tod.day'|'tod.dusk'|'tod.night'
setTimeOfDay(tod)               jump (used by the time-skip power); fires day/night events correctly
weather                         'clear'|'rain'|'storm'|'fog'|'snow'|'heat'
setWeather(type, duration=90)   change weather (sim s), then back to 'clear'; emits 'weather:changed'
visibility() → 0.15..1          sight multiplier for AI (night, fog, rain, storm, snow)
temperature() → 'cold'|'normal'|'hot'   (snow / night = cold-ish, heat = hot)
moveFactor() → 0.7..1           movement multiplier (snow, storm)
wind → {x, z}                   wind vector (m/s), slowly changes; storms are windy
waterLevel                      current water y (default CFG.BASE_WATER_LEVEL)
setWaterLevel(y, seconds)       smoothly move water level (flood power); emits 'water:changed'
```
Rules: `state.day` increments when time crosses `CFG.DAWN` → emit
`'day:start' {day}` + log; crossing `CFG.DUSK` → emit `'night:start' {day}`.
Natural weather changes occasionally (mostly clear, sometimes rain/fog).
During `'storm'`, call `GM.Hazards.lightning(point, {natural: true})` every
10–25 s at a random land point. Visuals: gradient sky dome (sun/moon, stars
at night), fog, rain streaks / snowflakes around the camera, lightning
flashes, warm haze for heat. Night must stay readable (moonlight).

### 8.4 `GM.Contestants` (CONTESTANTS, contestants.js, order 50)

```
generateRoster(count, mix, seed) → [{name, team, gender, archetype}]
                                  2 contestants per team (f, m); archetypes from GM.AI.pickArchetypes(count, mix, rng)
spawnAll(roster)                  create contestant objects + meshes on World.pedestals(n); calls GM.AI.initMind(t)
                                  (called from reset(settings) with settings.roster)
get(id) → t | null
alive() → [t]                     living contestants (new array)
aliveCount() → int
nearest(pos, maxDist, filter?) → t | null      living contestants only
inRadius(pos, r, filter?) → [t]
damage(t, amount, info) → actual damage
        info {cause, attacker (contestant|null), beast (beast|null), weapon (item id|null), pos}
        applies armor (weapon/beast/explosion causes), ignores damage in phase 'ended',
        sets lastAttackedBy, calls GM.AI.onDamaged(t, info), emits 'contestant:damaged',
        kills when health <= 0
kill(t, info)                     death: pose/ragdoll fall, drop inventory as ground items, killer.kills++,
                                  placement, log 'death'/'kill', emit 'contestant:died'
                                  {contestant, killer, cause, weapon, pos}, addInterest(score 10).
                                  Kill credit: if cause is environmental and someone hit t in the
                                  last 8 s, that contestant gets the kill.
                                  After ~25 s a hovercraft claw/beam lifts the body away.
heal(t, amount)
moveTo(t, x, z, mode)             mode 'walk'|'run'|'sprint'|'sneak'. Plans a path via Terrain.findPath
                                  (budgeted queue) when far, else steers directly. Cheap to call every tick
                                  (no re-plan if the goal moved < 2 m).
stop(t)
faceToward(t, x, z)
arrived(t, dist=1.5) → bool
consume(t, what) → bool           'food'|'water'|'medkit'|'berries'
drink(t) → bool                   drink from nearby water (must be within 3 m of water)
forage(t, dt) → item type | null  search for food in forest/grass; chance by survival skill + cover
setSleeping(t, bool)
stun(t, seconds)
knockback(t, dirX, dirZ, force)
setStatus(t, name, seconds)       stun|poison|madness|panic|burning|stung|bleeding (max of old/new)
```
Locomotion (in `update`): path following, steering, separation between
contestants, terrain slope & water slow-down, swimming when water depth > 1.2 m
(stamina drain; at 0 stamina take `'drown'` damage), clamp inside arena,
speed = base (walk 2.2, run 5, sprint 6.5, sneak 1.4 m/s) × `(0.85 + 0.3 × skills.speed)`
× stamina/injury/energy factors × `GM.Env.moveFactor()`. Stun = no movement.
Needs (in `update`, only while running): hunger +100 per 2.5 days, thirst +100 per 1.5 days
(×2 in heat), energy −100 per 1.2 days awake (sleep restores +100 per 0.3 day);
at 100 hunger/thirst lose health (causes `'starve'`/`'thirst'`); cold at night in
snow without sleeping bag hurts slowly (`'cold'`). Status timers tick down;
poison/bleeding/burning deal damage over time.

Mesh: low-poly humanoid ~1.8 m (torso, head, 2 arms, 2 legs, weapon in
hand), team-coloured clothes, simple procedural animation (walk/run cycle,
attack swing, sleep lying down, swim, death fall), name tag sprite (name +
team + health bar; hidden when `settings.nameTags` is false), selection
ring when `GM.state.selectedId === t.id`. Emotion hint: small icon above head
for asleep / afraid / mad.

### 8.5 `GM.Items` + `GM.ItemDefs` (CONTESTANTS, items.js, order 40)

```
ItemDefs[id]                      {id, kind, nameKey:'item.<id>', icon (emoji), color, value 0..1, ...stats}
list                              ground items
spawn(type, x, z, opts) → item    opts {amount, contents, crate, fromY (falls)}
remove(item)
nearest(pos, maxDist, filter?) → item | null
inRadius(pos, r, filter?) → [item]
value(t, type) → 0..1             how much contestant t wants this item now (better weapon, needs...)
pickup(t, item) → bool            must be within 1.6 m; applies to inventory (auto-equips better weapons),
                                  opens bundles, logs, emits 'item:pickup' {contestant, type, source}
spawnNexusLoot(count)        weapons at the horn mouth, supplies spread outward
spawnScatteredLoot(count)         backpacks/food/water across the map
supplyDrop(x, z, opts) → item     crate on a parachute falling from ~70 m (beeping light);
                                  opts {contents, tier 1..3}. addInterest(score 3).
sponsorGift(t, type) → item       silver parachute that lands next to contestant t; logs; emits 'gift:sent'
spawnFeast()                      rich loot crates at the nexus; sets GM.state.feast.ready = true
placeTrap(t) → bool               uses a trap kit at t.pos (hidden; owner immune)
traps                             [{id, pos, ownerId, armed, mesh}] — trigger: damage 35, stun 3 s,
                                  cause 'trap', kill credit to owner; emit 'trap:triggered'
dropAll(t)                        drop a dead contestant's items around the body
```
In `reset`: `spawnNexusLoot(~1.6 × contestants)` and `spawnScatteredLoot(~40)`.

### 8.6 `GM.Combat` (CONTESTANTS, combat.js, order 70)

```
weaponOf(t, ranged=false) → ItemDef (fists if none)
bestAttack(t, target) → {mode:'melee'|'ranged', range, def} | null   best option at the current distance
inRange(t, target) → bool
tryAttack(t, target) → 'hit'|'miss'|'cooldown'|'range'|'noammo'|false
        handles facing, cooldown, animation, hit chance, projectiles (arrows/knives fly visibly),
        damage via Contestants.damage / Beasts.damage, noise GM.AI.noise(pos, 40, 'fight', t.id),
        emits 'combat:attack' {attacker, target, weapon, hit, damage, ranged, pos},
        emits throttled 'combat:fight' {a, b, pos} and addInterest(score 6, key 'fight:<a>-<b>')
power(t) → number                 fighting strength estimate for AI threat checks
                                  (health × weapon damage × strength × armor ...)
projectiles                       active projectiles
```
Hit chance melee ≈ 0.85 (−0.2 if target is sprinting, +0.1 if target asleep/stunned).
Ranged ≈ `(0.95 − 0.55 × dist/range) × (0.6 + 0.5 × aim) × Env.visibility()^0.5`.
Sneak attack (attacker not seen by target or target asleep): ×1.8 damage.
Effects: small blood burst (`GM.FX.burst`, dark red, tasteful), weapon clash sparks, hit flash on mesh.

### 8.7 `GM.AI` + `GM.Archetypes` (AI, ai.js, order 60)

```
Archetypes[id]                    {id, icon, color, nameKey:'arch.<id>', descKey:'arch.<id>.desc',
                                   traits: {...base 0..1}, skillBias: {...}}
ARCHETYPE_IDS                     ['elite','survivor','scavenger','opportunist','strategist',
                                   'berserker','protector','lonewolf']
pickArchetypes(n, mix, rng=GM.R) → [ids]   mix: balanced | bloodthirsty | peaceful | chaos
initMind(t)                       set t.traits (archetype + gauss variation), adjust t.skills,
                                  t.emotion, t.mood, t.mind (memory, relations), t.action, t.thought
onDamaged(t, info)                fear/rage/grudge reactions (called by Contestants.damage)
noise(pos, radius, kind, sourceId)  something audible happened ('fight','explosion','lure','scream','knell')
applyStatus(t, status, seconds)   'madness' (attack anyone, erratic), 'panic' (run away), 'stung' (hallucinate)
alliances                         [{id, members:[ids], leaderId, formedAt}]
allianceOf(t) → alliance | null
ACTIONS                           {id: {icon, key:'act.<id>'}}
actionIcon(id) → string
moodIcon(mood) → string
```
Registers system `AI` (order 60): perception, emotions, decisions, action
execution for living contestants while phase is `'running'` (during `'countdown'`
contestants stand still on pedestals; stepping off early is not allowed).

### 8.8 `GM.Hazards` (SHOWRUNNER, hazards.js, order 30)

```
dangerAt(x, z) → 0..1             combined danger (fire, gas, zone outside, lava...) for AI & pathing
dangers(pos, r) → [{x, z, radius, type, level}]   nearby danger sources (AI flees from them)
fire                              grid fire simulation (cells ~4 m) using Terrain.forestAt as fuel,
                                  wind-driven spread, rain/snow extinguish, burnt cells call
                                  Terrain.burnForest. Damage 12/s inside + status 'burning'.
ignite(x, z, radius)
isBurning(x, z) → bool
lightning(pos, opts)              bolt from the sky: 70 dmg ≤3 m, 25 ≤8 m, may ignite forest,
                                  FX.beam + FX.flash, sound 'thunder', noise 120. opts {natural, damage}
explosion(pos, radius, damage, cause='explosion')
fireball(pos)                     one fireball falling from the sky (used in barrages)
gasCloud(pos, radius, duration, kind)   kind 'poison' (8 dmg/s, cause 'gas') | 'madness' (applyStatus madness)
                                  drifts with GM.Env.wind; visible green / purple fog volume
earthquake(pos, radius, strength) Terrain.deform + camera shake + stun + small damage (cause 'quake')
flood(height=4, duration=60)      Env.setWaterLevel up, then back down
zone                              { active, center:{x,z}, radius, targetRadius, damage 5/s outside }
shrinkZone(center, radius, seconds)   visible glowing wall (cylinder); damage cause 'forcefield'
isInsideZone(x, z) → bool
```
Sudden death rule: from dawn of **day 4**, if ≥ 2 contestants remain, the zone
automatically shrinks toward a random land point near the centre to radius 35
over ~1.5 days (announce + log). Guarantees the Show end.

### 8.9 `GM.Beasts` (SHOWRUNNER, beasts.js, order 55)

```
list                              same array as GM.state.beasts
spawn(type, x, z, count) → [beast] 'wolf' (hp 60, speed 7, bite 12 dmg / 1 s, lifetime 90 s, pack hunts
                                  nearest contestants, howls) | 'wasps' (swarm of killer wasps: speed 8,
                                  sting 4 dmg / 0.8 s + AI.applyStatus(t,'stung',15), lifetime 40 s,
                                  cannot be killed by weapons; lose interest in deep water)
damage(m, amount, attacker)       wolves can be killed by contestants (log + 'beast:died' {beast, killer})
nearest(pos, maxDist) → beast | null
inRadius(pos, r) → [beast]
```
Beast damage uses cause `'beast'` / `'wasps'`. Beasts emit `GM.addInterest`
(score 7) while attacking.

### 8.10 `GM.Powers`, `GM.Audience`, `GM.AutoGM` (SHOWRUNNER, powers.js, order 80)

```
Powers.defs → [{id, category:'gift'|'nature'|'hazard'|'rule', icon, cost, cooldown,
                target:'none'|'point'|'contestant', radius, options:[{id, icon, key}] | null,
                nameKey:'power.<id>', descKey:'power.<id>.desc'}]   (display order)
Powers.def(id) → def
Powers.energy, Powers.maxEnergy (100), Powers.cooldowns {id: seconds left}
Powers.canUse(id) → {ok, reason: null|'cooldown'|'energy'|'phase'}
Powers.use(id, target, optionId) → bool   target: {x,z} (point) | contestant (contestant) | null (none)
                                  deducts energy, starts cooldown, logs 'gm', emits 'power:used'
                                  {id, target, option}, announces big ones
Powers.setAim(id, point|null)     show/hide a 3D targeting reticle (ring with the power radius) at point
Audience.excitement 0..100, Audience.viewers (number), Audience.history [numbers, one per ~5 s]
Audience.add(amount, reasonKey)   Audience.grade() → 'S'|'A'|'B'|'C'|'D'
AutoGM.enabled, AutoGM.setEnabled(bool)
```
Energy: starts 60, max 100, regen per sim s = `0.6 + excitement / 45`.
Sandbox: energy always full, cooldowns × 0.25. Powers only in phase `'running'`.

Power list (id — target — cost — cooldown — effect):

| id | target | cost | cd | effect |
|---|---|---|---|---|
| `supply_drop` | point | 15 | 20 | crate with 3–5 good items; lures contestants |
| `sponsor_gift` | contestant | 10 | 8 | silver parachute with what that contestant needs most |
| `feast` | none | 35 | 150 | announce a feast at the nexus; crates appear after 20 s |
| `weather` | none, options clear/rain/storm/fog/snow/heat | 10 | 25 | change weather for 120 s |
| `time_skip` | none, options dawn/noon/dusk/midnight | 5 | 20 | jump the clock |
| `flood` | none | 30 | 90 | water rises ~4 m for 60 s |
| `quake` | point, r 22 | 25 | 40 | earthquake: crater/ridge, stun, shake |
| `terraform` | point, r 12, options raise/lower/flatten | 5 | 1.5 | sculpt the land |
| `fireball` | point, r 18 | 20 | 20 | barrage of 5 fireballs, sets forest on fire |
| `lightning` | point, r 8 | 10 | 6 | one lightning strike |
| `poison_fog` | point, r 20 | 25 | 60 | drifting poison cloud |
| `madness_gas` | point, r 16 | 25 | 60 | hallucination gas: victims go mad (attack anyone) |
| `beasts` | point, r 10 | 30 | 60 | pack of 4 wolf beasts |
| `wasps` | point, r 10 | 20 | 45 | killer wasp nest: swarm attacks nearby contestants |
| `lure` | point, r 30 | 8 | 15 | loud bait signal; contestants nearby come to look |
| `reveal` | none | 20 | 90 | for 30 s every contestant knows where all others are (`state.revealUntil`) |
| `shrink_zone` | point | 40 | 120 | force field closes to 55 % radius around the point over 60 s |
| `smite` | contestant | 60 | 180 | Studio strike: kills the contestant (audience may dislike it) |

Audience: listens to events. +25 kill (+15 more for betrayal/finale), +3 per
hit in a fight (capped), +8 per GM power (diminishing if spammed), +30
betrayal, +12 alliance formed, feast +15, boredom decay toward ~15 when
nothing happens. Viewers ≈ `(6M + 0.2M × excitement) × (1 + 0.15 × day)`.
Updates `t.popularity` (kills, survival, underdogs); `smite` on a popular
contestant costs excitement. Emits `'audience:changed'` ~1/s.
AutoGM (optional helper): when enabled and excitement < 30 for 20 s, it uses
a fitting power (supply drop near a lonely contestant, beasts near groups, feast
late, lightning on campers, zone when few remain). Logs as "Assistant".

### 8.11 `GM.Cameras` (CAMERA, camera.js, order 90)

```
main                              THREE.PerspectiveCamera (main view)
mode                              'showcase'|'free'|'follow'|'director'|'overhead'
setMode(mode)
follow(id)                        mode 'follow' on contestant id (also GM.select(id))
lookAt(x, z)                      move the free/overhead camera to look at a point
focus(pos)                        smooth fly-to
shake(intensity, seconds)
status() → {mode, camName:'CAM 01', label:{key,params}|null, followId}
feeds → [{camera, label:{key,params}|null, followId, interestId}]
takeFeed(i)                       main camera jumps to feed i's subject
render()                          main view into #viewport rect + feeds into .feed-slot rects
worldToScreen(pos) → {x, y, visible}   CSS pixels (for HTML overlays)
pickGround(clientX, clientY) → THREE.Vector3 | null
pickContestant(clientX, clientY) → contestant | null
```
Rendering: canvas `#gl` is fixed full-window. Read `#viewport` and
`.feed-slot[data-feed="0|1|2"]` rectangles each frame (`getBoundingClientRect`),
and draw each view with `GM.Post.renderView(scene, camera, x, y, w, h, slot,
isMain, refresh)` (bottom-left origin, CSS px). Feeds re-render their scene
round-robin (one per frame) and re-use the last image otherwise. Skip feeds when
`settings.feeds` is false or the slot is hidden/zero-size. Update the shadow
map once per frame (`shadowMap.autoUpdate=false`, set `needsUpdate` before the
main render). Call `GM.World.setShadowFocus` with the main camera focus. The
main camera sets `GM.Post.settings.dof*` for close shots (depth of field).

Modes:
- `showcase` (setup screen): slow cinematic orbit over the arena.
- `free`: WASD/arrows move, Q/E down/up, Shift ×3 speed, right-drag or left-drag look,
  wheel = move forward/back; stays above terrain.
- `follow`: orbit the selected contestant (drag to orbit, wheel zoom); smooth.
- `director` (default in game): auto-cuts to the best `GM.state.interests`
  (hold a shot ≥ 4 s real time, ≤ 14 s; cinematic angles; prefer new events;
  during countdown sweep across pedestals; on death, show the spot; at the
  end, orbit the victor).
- `overhead`: high top-down tactical view; WASD pans, wheel zooms.
Feeds pick the top interests not shown on the main camera, else cycle living
contestants (every ~12 s). Feed labels e.g. `{key:'cam.feedFight', params:{a, b}}`.

Input (listen on the canvas; ignore when typing in inputs):
- Mouse click (press + release < 6 px movement) on the canvas → emit
  `'canvas:click' {clientX, clientY, button, point, contestant}` (point = ground pick,
  contestant = picked contestant). Mouse move → `'canvas:hover' {clientX, clientY, point}` (throttled).
- Keys owned by camera: `W A S D`, arrows, `Q E`, `Shift`, `F` (follow selected),
  `1` free, `2` follow, `3` director, `4` overhead, `C` cycle mode.

### 8.12 `GM.Audio` (CAMERA, audio.js, order 95)

Procedural WebAudio (no files). Created on first user gesture (`GM.Audio.unlock()`
called by UI start button; also on first pointerdown).
```
play(name, {pos, volume=1, rate=1})   pos → distance attenuation from the main camera
setMuted(bool), muted, setVolume(0..1), volume
```
Sound names: `knell gong countdown thunder explosion fireball fire hit clash swing bow
arrowHit howl growl buzz alarm click hover drop parachute heal eat splash quake zap
anthem victory betray announce trap scream beep`.
Audio listens to events itself: `'contestant:died'` → `knell` (global, the famous
knell), `'game:start'` → `gong`, `'countdown:tick'` → `countdown`, weather ambience
(rain/wind/storm loops), fire crackle near burning areas, night crickets, day birds.

### 8.13 `GM.UI` + `GM.Minimap` (UI, ui.js + minimap.js + style.css, orders 100/105)

UI builds all DOM inside `#ui-root`. Required elements:
- `#viewport` — the main 3D view rectangle (**`pointer-events: none`**, transparent).
- `.feed-slot[data-feed="0"|"1"|"2"]` — transparent rectangles where feeds render
  (clickable → `GM.Cameras.takeFeed(i)`), each with a label + REC dot.

Screens and panels:
- **Setup screen** (phase `'setup'`): title, seed (number or word → `GM.hashString`) with
  "random" button (calls `GM.Game.previewArena`), contestant count slider 2–48, mix
  preset, **editable roster** (name + archetype per contestant, regenerate button),
  toggles: sandbox, assistant (AutoGM), quality, feeds, name tags; language switch;
  "Start the Show" (calls `GM.Audio.unlock()` then `GM.Game.newGame(settings)`).
  The arena preview is visible behind it.
- **Top bar**: title, day + clock + day/night icon, weather, alive count, viewers +
  excitement meter, GM energy bar, speed buttons (pause, 0.5–16×), language toggle
  EN/HU, mute, help.
- **Roster panel**: one card per contestant (team colour, name, archetype icon,
  health bar, action icon, dead = greyed + cause); sort options; click → select + follow.
- **Selected contestant panel**: name, team, archetype + description, mood, current
  thought (translated live), health/hunger/thirst/energy/stamina bars, fear/rage/
  confidence/sanity, inventory, kills, alliance, status effects.
- **Powers panel**: tabs by category, buttons with icon, name, cost, cooldown sweep,
  tooltip (desc). Targeting flow: click power → if `target:'none'` use it (show
  option chooser first if it has options) → else targeting mode: hint text, cursor,
  `'canvas:hover'` → `Powers.setAim(id, point)`, `'canvas:click'` → `Powers.use(...)`;
  minimap click also targets; right-click / Esc cancels. Contestant powers: click a
  contestant in 3D or in the roster.
- **Kill feed** overlay (top-right of viewport) + full **event log** with filters
  (all / kills / Showrunner / events). Entries re-translate on `'lang:changed'`.
  Clicking a log entry with `pos` → `GM.Cameras.focus(pos)`.
- **Announcements**: big centre text for `'announce'`; countdown numbers.
- **Night recap**: on `'recap:night' {day, fallen}` show the fallen contestants' faces/cards
  in the sky style ("The fallen of day N"), with `GM.Audio.play('anthem')`.
- **Victory screen** on `'game:end'` (after ~4 s): victor card, stats (kills, days,
  deaths list with causes, most kills, GM powers used, audience grade, peak viewers),
  "New Show" → `GM.Game.toSetup()`.
- **Help overlay**: controls and powers in simple words.
- Camera label overlay in the viewport: `CAM 01 · FREE` etc. from `GM.Cameras.status()`,
  REC dot, timestamp.
- Responsive: below ~900 px wide the side panels collapse into toggleable drawers;
  no horizontal page scroll.

Keys owned by UI: `Space` pause, `+`/`-` speed, `Tab`/`Shift+Tab` next/previous living
contestant, `Esc` cancel targeting/close dialogs, `L` language, `H` or `?` help, `N` name tags,
`M` mute, `P` powers panel focus (optional). Ignore keys while an input has focus.

`GM.Minimap` (canvas in the right panel): terrain image from `Terrain.colorAt`
(re-render on `'arena:generated'` / `'terrain:changed'` / `'forest:burnt'` /
`'water:changed'`, throttled), contestant dots in team colours (selected ring,
dead = small x), alliance lines, beasts (red), items/crates (small), fire cells
(orange), gas clouds, zone circle, camera view cone, interests pulse. Click →
target power if targeting, else `GM.Cameras.lookAt(x, z)`.

---------------------------------------------------------------------------

## 9. Game design details

### 9.1 Archetypes (psychological profiles)

| id | icon | idea | key traits |
|---|---|---|---|
| `elite` | ⚔️ | Trained killer. Rushes the nexus, forms a pack with other elites, hunts in groups, arrogant. Pack breaks late (betrayal). | aggression .85, bravery .8, sociability .6 (elites only), loyalty .45 |
| `survivor` | 🌿 | Resourceful and careful. Avoids the kickoff, forages, hides, fights only when cornered. | survival skill high, bravery .5, aggression .2, patience .8 |
| `scavenger` | 🎒 | Cowardly looter. Flees on sight, steals from bodies and sleeping contestants, loves supply drops. | greed .9, bravery .2, aggression .15 |
| `opportunist` | 🦊 | Waits for others to weaken each other; follows fights at a distance and finishes the wounded; betrays allies. | cunning .9, loyalty .2, patience .7 |
| `strategist` | ♟️ | Sets traps near water and paths, ambushes, uses terrain; calm. | cunning .85, patience .9, stability .85 |
| `berserker` | 💢 | Unstable. Rage builds fast, sanity drops; charges enemies, sometimes attacks allies. | aggression .95, stability .2, bravery .9 |
| `protector` | 🛡️ | Loyal. Forms alliances, defends allies, shares food, never betrays. | loyalty .95, sociability .85, bravery .7 |
| `lonewolf` | 🎯 | Hunter who works alone. Stalks isolated contestants, hunts at night, no alliances. | aggression .7, sociability .05, stealth skill high |

Mixes: `balanced` (all archetypes evenly, ~15 % elites), `bloodthirsty` (more
elites/berserkers/lone wolves), `peaceful` (more survivors/scavengers/protectors),
`chaos` (uniform random). Trait values get ±0.12 gaussian variation per contestant.

### 9.2 Emotions and needs drive behaviour

- **fear** rises when hurt, when seeing stronger enemies/beasts/fire/deaths, at night
  alone, hearing knells; falls when safe, with allies, with good weapons.
- **rage** rises when hurt by someone, when an ally dies; drives revenge (grudges).
- **confidence** rises with kills, good weapons, armor, health; falls with wounds.
- **sanity** falls with hunger/thirst/sleeplessness, stung/madness, loneliness, seeing
  kills; low sanity → erratic choices, talking to self, "madness" episodes.
- Needs (hunger, thirst, energy) raise the value of food/water/sleep actions and
  desperate contestants take more risks.

### 9.3 Actions (ids for `t.action`, with `act.<id>` keys and icons)

`idle wander loot flee hide hunt fight stalk drink eat forage rest sleep heal
ally follow guard trap ambush steal investigate feast avoid escape_zone panic mad
berserk kickoff scatter`

Thought examples (keys under `thought.*`, params in braces): "Running to the
Nexus", "Grabbing {item}", "Hunting {target}", "Too scared — running
from {target}", "Hiding in the forest", "Looking for water", "Eating", "Sleeping",
"Setting a trap", "Waiting in ambush", "Following {leader}", "Defending {ally}",
"Going to the feast", "Something is wrong… I see things", "Betraying {target}",
"Leaving the gas cloud", "Running from the fire", "Getting inside the force field".

### 9.4 Perception

Sight range: 60 m × `GM.Env.visibility()` (goggles ignore night), field of
view ~240°, reduced ×(1 − 0.6 × cover) when the target is in forest,
×0.55 if the target sneaks/hides, ×0.35 if the target sleeps in cover.
Hearing: `GM.AI.noise` events within their radius. `state.revealUntil` →
everyone knows everyone's position. Memory keeps last-seen positions of
contestants, known items, water spots, dangers.

### 9.5 Pacing

Target: 24 contestants → a winner in ~3–5 in-game days (15–25 min at 1×) without
Showrunner input; much faster with interventions. Kickoff kills ~20–35 %.
Tension rises each day (hunting urge increases; from day 3 or ≤ 4 alive,
contestants drift toward the centre / last known enemies). Alliances dissolve
when ≤ 6 alive (betrayal chance by loyalty/cunning); final 2 always fight.

---------------------------------------------------------------------------

## 10. Event catalogue

| event | payload | emitted by |
|---|---|---|
| `game:setup` | `{}` | main |
| `arena:generated` | `{seed}` | main |
| `game:new` | `{settings}` | main |
| `countdown:tick` | `{n}` | main |
| `game:start` | `{}` | main |
| `game:end` | `{winner}` | main |
| `game:pause` | `{paused}` | main |
| `game:speed` | `{speed}` | main |
| `select` | `{id}` | core |
| `lang:changed` | `{lang}` | i18n |
| `log` | log entry | core |
| `announce` | `{key, params, style, duration}` | core |
| `interest` | interest | core |
| `recap:night` | `{day, fallen:[ids]}` | main |
| `day:start` / `night:start` | `{day}` | Env |
| `weather:changed` | `{type, prev}` | Env |
| `water:changed` | `{level}` | Env |
| `terrain:changed` | `{x, z, radius}` | Terrain |
| `forest:burnt` | `{x, z, radius}` | Terrain |
| `contestant:damaged` | `{contestant, amount, cause, attacker, pos}` | Contestants |
| `contestant:died` | `{contestant, killer, cause, weapon, pos}` | Contestants |
| `contestant:healed` | `{contestant, amount}` | Contestants |
| `item:pickup` | `{contestant, type, source}` | Items |
| `item:used` | `{contestant, type}` | Contestants |
| `crate:landed` | `{item, pos}` | Items |
| `gift:sent` | `{contestant, type}` | Items |
| `trap:triggered` | `{contestant, ownerId, pos}` | Items |
| `combat:attack` | `{attacker, target, weapon, hit, damage, ranged, pos}` | Combat |
| `combat:fight` | `{a, b, pos}` (throttled) | Combat |
| `alliance:formed` | `{alliance}` | AI |
| `alliance:broken` | `{alliance, byId, betrayal}` | AI |
| `mind:snap` | `{contestant, kind}` | AI |
| `power:used` | `{id, target, option}` | Powers |
| `hazard:lightning` / `hazard:explosion` / `hazard:quake` / `hazard:gas` / `hazard:fire` | `{pos, radius}` | Hazards |
| `zone:shrink` | `{center, radius, targetRadius}` | Hazards |
| `beast:spawned` / `beast:died` | `{beast, killer?}` | Beasts |
| `feast:announced` / `feast:ready` | `{pos}` | Powers / Items |
| `audience:changed` | `{excitement, viewers}` | Audience |
| `canvas:click` | `{clientX, clientY, button, point, contestant}` | Cameras |
| `canvas:hover` | `{clientX, clientY, point}` | Cameras |

---------------------------------------------------------------------------

## 11. Definition of done (every module)

1. Implements every API in its section with the exact names; extra helpers are welcome.
2. All strings via i18n, both languages, simple words, Hungarian suffix rule respected.
3. Registers its system(s) with the right order and handles `clear()` properly
   (a second and third game must work without leaks or leftover meshes).
4. No errors when other modules are missing (feature detection).
5. `node --check` passes. No ES module syntax. File wrapped in an IIFE.
6. Report: public API implemented, deviations, what you need from others, known issues.
