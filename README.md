# Arena Showrunner

A 3D reality-TV battle royale **simulation** in the browser. 2–48
autonomous contestants loot, form alliances, betray each other and fight until one
remains. You are not a fighter: you are the **Showrunner** in the control room.
You watch live camera feeds and bend the arena in real time.

English and Hungarian — switch any time with the EN/HU button (or `L`).

## Run it

- **Easiest:** open `dist/arena.html` (one self-contained file) in Chrome, Edge or Firefox.
  `dist/arena-demo.html` is the same game without the Expedition Pack (its arenas show as locked).
- **From source:** open `index.html`, or serve the folder:
  `python -m http.server 8765` → http://127.0.0.1:8765
- Needs an internet connection for three.js (cdnjs) and the fonts.

Rebuild the single-file versions after changing the source: `node tools/build.js` (full edition, demo edition,
artifact page).

## How to play

1. **Setup:** pick an arena code (same code = same arena), the number of contestants,
   the personality mix, and edit names/personalities if you like. Options:
   *Sandbox* (unlimited energy), *Assistant* (an AI Showrunner helps when the
   audience is bored), quality, live feeds, name tags.
2. **The Show:** 10 seconds on the pedestals, then the gong. Watch the opening rush.
3. **Use your powers.** They cost energy. Energy comes from the audience: exciting
   shows (fights, betrayals, big events) earn more energy. Keep the viewers watching.
4. The last contestant alive wins. The victory screen grades your show (S to D).

## Career mode

You run a TV network. A **season** is six **episodes** (Shows). Before each one the
Studio gives you a **brief**: a ratings target (a grade to reach) plus two bonus goals,
such as reaching a viewer count, witnessing betrayals or making a certain type of
contestant win. Every goal you hit is a star.

- **Credits** (grade, goals, trophies) buy **studio upgrades**: more energy, faster
  recharge, shorter cooldowns, stronger hype, a head start, and the assistant Showrunner.
- **Reputation** raises your level (1 to 10). Levels unlock Showrunner powers one by one
  and allow bigger casts. Free play always has everything unlocked.
- Finish a season for a bonus, then start a harder one. Trophies give extra credits.
- Progress is saved in the browser (`localStorage`) after every episode and purchase.
  The **Profile** tab has a backup code you can copy to move or restore a save.
- Leaving an episode early earns nothing; the same brief is waiting for another try.

Switch between **Career mode** and **Free play** with the button in the setup screen's
top corner, or in the career header. Free play is the original sandbox, unchanged.

### Powers

| Gifts | Nature | Danger | Rules |
|---|---|---|---|
| Supply drop, Sponsor gift, Feast | Weather, Time skip, Flood, Earthquake, Shape the land | Fireballs, Lightning, Poison fog, Madness gas, Wolf beasts, Wasp nest | Lure, Reveal, Close arena, Smite |

Click a power, then click the arena, the minimap or a contestant. `Esc` or right-click cancels.

### Contestant personalities

Elite ⚔️ · Survivor 🌿 · Scavenger 🎒 · Opportunist 🦊 · Strategist ♟️ ·
Berserker 💢 · Protector 🛡️ · Lone wolf 🎯 — plus random variation and live
emotions (fear, rage, confidence, sanity). Every contestant shows what it is thinking.

### Controls

| Key | Action |
|---|---|
| `1` `2` `3` `4` / `C` | Free camera / Follow / Auto director / Overhead / cycle |
| `W A S D`, arrows, `Q` `E`, `Shift` | Move the free camera (drag to look, wheel to move) |
| `F` | Follow the selected contestant |
| `Tab` / `Shift+Tab` | Next / previous contestant |
| `Space` | Pause |
| `+` / `-` | Game speed (0.5× – 16×) |
| `L` | Language EN / HU |
| `N` | Name tags |
| `M` | Mute |
| `H` or `?` | Help |

## Daily challenge

Every UTC day has one Show that is the same for everybody: same arena, same cast, same personality mix, plus a
**twist** (a leaner battery, faster cooldowns, bigger ratings swings, a packed arena, or none). Open it with the
**Daily** button (setup screen and career header).

- No studio upgrades and no sandbox, every power open; retry as often as you like, your best score of the day counts.
- A **streak** counts the days in a row you finished the daily Show.
- The result card shows your score, new records and, when an online leaderboard is connected, a **Submit** button.
  Nothing is sent unless you press it. The **Leaderboard** tab shows today's top scores and the all-time best per
  player; the **Records** tab holds your personal bests and totals (sandbox Shows never count).
- The online leaderboard is optional: see [server/README.md](server/README.md) (free Cloudflare plan). Without it the
  daily challenge, streak and records all work offline.

## Arena types and the Expedition Pack

The arena code still decides the layout; the **arena type** (free-play setup screen) decides the land, sky and weather.

| Type | Character |
|---|---|
| Verdant Basin | The classic arena (always available; career and daily Shows use it) |
| Dune Sea | Golden sand, red mesas, one small oasis. Heat waves are common and water is rare, so every drink counts |
| Frostfall | A valley under permanent snow with dark pine groves and frozen lakes. Cold nights wear contestants down; a sleeping bag helps |
| Drowned Mire | Black water, swamp, thick forest and fog. Cover is everywhere |

The last three are the **Expedition Pack** (`js/packs/expedition.js`). A build without that file (the demo edition)
shows them as locked cards. Adding another pack means adding a file that calls `GM.Arenas.register`; see
`GM.Arenas.DEFAULTS` in `js/arenas.js` for every knob and `node tools/arena-stats.js` to measure the result.

## Project layout

| Path | What |
|---|---|
| `SPEC.md` | Architecture and module contract |
| `js/core.js`, `js/i18n.js`, `js/main.js` | Runtime, localisation, game loop |
| `js/save.js` | Versioned save in `localStorage` (sections, backup code, memory fallback) |
| `js/config.js` | Deployment settings: leaderboard URL, pack store URL |
| `js/daily.js`, `js/dailyui.js`, `css/daily.css` | Daily challenge, streak, personal records / the Daily screen and result card |
| `js/leaderboard.js`, `server/` | Online leaderboard client / the free Cloudflare Worker + database behind it |
| `js/arenas.js`, `js/arenaui.js`, `css/arenas.css` | Arena themes (parameter set, registry, picker) |
| `js/packs/expedition.js` | The Expedition Pack: Dune Sea, Frostfall, Drowned Mire |
| `js/career.js`, `js/careerui.js`, `css/career.css` | Career mode: rules, briefs, rewards, upgrades / hub, objective HUD, results |
| `js/gfx.js`, `js/post.js` | Rendering foundation (linear colour, height fog, shared shader uniforms) and the HDR post-processing pipeline (bloom, SSAO, sun shafts, depth of field, ACES tone mapping, colour grade) |
| `js/terrain.js`, `js/world.js`, `js/env.js` | Terrain + pathfinding, 3D world + effects, sky/day/night/weather/lighting |
| `js/contestants.js`, `js/items.js`, `js/combat.js` | Contestants, loot, fighting |
| `js/ai.js` | Psychology and decisions |
| `js/hazards.js`, `js/beasts.js`, `js/powers.js` | Fire, gas, zone, beasts, Showrunner powers, audience |
| `js/camera.js`, `js/audio.js` | Cameras, director, live feeds, procedural sound |
| `js/ui.js`, `js/minimap.js`, `css/style.css` | Control-room interface |
| `tools/smoke.js` | Headless end-to-end test (runs a whole Show in headless Chrome) |
| `tools/build.js` | Bundles everything into `dist/arena.html` |
| `tools/serve.js` | Static dev server with caching disabled (`node tools/serve.js . 8766`) |

Tests:

- `node tools/career-test.js`: unit tests for the save and career logic (no browser needed).
- `node tools/daily-test.js`: daily challenge, streak, records, leaderboard client, and the leaderboard worker on a real
  SQLite database (Node 22.5+).
- `node tools/arena-test.js`: the classic arena is byte-identical to its fixture; every pack arena is valid, deterministic,
  reachable and true to its theme. `node tools/arena-stats.js` prints a theme's composition.
- `node tools/smoke.js --norender`: a whole free-play Show in headless Chrome
  (add `--powers`, `--lang hu`, `--shots <dir>`).
- `node tools/smoke.js --norender --career 6 --bot random --buy`: plays a career season
  with a bot and prints grade, goals and rewards per episode (use it to tune difficulty).
- `node tools/smoke.js --norender --daily` plays today's daily Show; `--arena dunes|frost|mire` plays a free-play Show on a pack arena.
- `node server/dev-server.js` runs the leaderboard locally (no account needed).
