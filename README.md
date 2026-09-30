# The Game Master's Arena

A 3D Hunger-Games-style battle royale **simulation** in the browser. 2–48
autonomous tributes loot, form alliances, betray each other and fight until one
remains. You are not a fighter: you are the **Game Master** in the control room.
You watch live camera feeds and bend the arena in real time.

English and Hungarian — switch any time with the EN/HU button (or `L`).

## Run it

- **Easiest:** open `dist/arena.html` (one self-contained file) in Chrome, Edge or Firefox.
- **From source:** open `index.html`, or serve the folder:
  `python -m http.server 8765` → http://127.0.0.1:8765
- Needs an internet connection for three.js (cdnjs) and the fonts.

Rebuild the single-file version after changing the source: `node tools/build.js`.

## How to play

1. **Setup:** pick an arena code (same code = same arena), the number of tributes,
   the personality mix, and edit names/personalities if you like. Options:
   *Sandbox* (unlimited energy), *Assistant* (an AI Game Master helps when the
   audience is bored), quality, live feeds, name tags.
2. **The Games:** 10 seconds on the pedestals, then the gong. Watch the bloodbath.
3. **Use your powers.** They cost energy. Energy comes from the audience: exciting
   Games (fights, betrayals, big events) earn more energy. Keep the viewers watching.
4. The last tribute alive wins. The victory screen grades your show (S to D).

### Powers

| Gifts | Nature | Danger | Rules |
|---|---|---|---|
| Supply drop, Sponsor gift, Feast | Weather, Time skip, Flood, Earthquake, Shape the land | Fireballs, Lightning, Poison fog, Madness gas, Wolf mutts, Wasp nest | Lure, Reveal, Close arena, Smite |

Click a power, then click the arena, the minimap or a tribute. `Esc` or right-click cancels.

### Tribute personalities

Career ⚔️ · Survivor 🌿 · Scavenger 🎒 · Opportunist 🦊 · Strategist ♟️ ·
Berserker 💢 · Protector 🛡️ · Lone wolf 🎯 — plus random variation and live
emotions (fear, rage, confidence, sanity). Every tribute shows what it is thinking.

### Controls

| Key | Action |
|---|---|
| `1` `2` `3` `4` / `C` | Free camera / Follow / Auto director / Overhead / cycle |
| `W A S D`, arrows, `Q` `E`, `Shift` | Move the free camera (drag to look, wheel to move) |
| `F` | Follow the selected tribute |
| `Tab` / `Shift+Tab` | Next / previous tribute |
| `Space` | Pause |
| `+` / `-` | Game speed (0.5× – 16×) |
| `L` | Language EN / HU |
| `N` | Name tags |
| `M` | Mute |
| `H` or `?` | Help |

## Project layout

| Path | What |
|---|---|
| `SPEC.md` | Architecture and module contract |
| `js/core.js`, `js/i18n.js`, `js/main.js` | Runtime, localisation, game loop |
| `js/gfx.js`, `js/post.js` | Rendering foundation (linear colour, height fog, shared shader uniforms) and the HDR post-processing pipeline (bloom, SSAO, sun shafts, depth of field, ACES tone mapping, colour grade) |
| `js/terrain.js`, `js/world.js`, `js/env.js` | Terrain + pathfinding, 3D world + effects, sky/day/night/weather/lighting |
| `js/tributes.js`, `js/items.js`, `js/combat.js` | Tributes, loot, fighting |
| `js/ai.js` | Psychology and decisions |
| `js/hazards.js`, `js/mutts.js`, `js/powers.js` | Fire, gas, zone, mutts, Game Master powers, audience |
| `js/camera.js`, `js/audio.js` | Cameras, director, live feeds, procedural sound |
| `js/ui.js`, `js/minimap.js`, `css/style.css` | Control-room interface |
| `tools/smoke.js` | Headless end-to-end test (runs a whole Games in headless Chrome) |
| `tools/build.js` | Bundles everything into `dist/arena.html` |
| `tools/serve.js` | Static dev server with caching disabled (`node tools/serve.js . 8766`) |

Test: `node tools/smoke.js --norender` (add `--powers`, `--lang hu`, `--shots <dir>`).
