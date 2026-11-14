# Gloamward Keep

A browser tower defence on generated hex maps with terrain heights 0–4, forked from Gloamward. Towers on high ground reach further, enemies walk only on the level-0 road, and the player steers them by building on it; sealing the road makes them smash through. `docs/DESIGN.md` is the source of truth for game behaviour. If you change a mechanic or a value on purpose, update that document in the same commit.

## Current state

The game is playable from wave 1 to wave 30: 7 towers with forks, 5 heroes with skill trees, 3 map presets (meadow, highlands, canyon), profile XP, perks and unlocks, saves, audio and touch controls. Balance has only been checked with the bot in `src/sim/bot.ts` (see `tests/smoke.test.ts`). The map has received more visual work than the surrounding UI; menus, tooltips and other interface details are provisional until the 3D rework.

A camera comparison study lives at `camera-preview.html`. The main game has an opt-in Three.js renderer at `?renderer=3d`; Canvas 2D remains the default/fallback. The live renderer uses editable Blender exports of provisional parameterized tower/hero/keep/nature models, a simplified animated goblin and temporary enemy variants sharing its rig, instanced crowds/bars and bounded effects. Its art follows the first supplied voxel reference and remains reviewable working art, not final accepted proportions/palette. Crisp neutral daylight is the only lighting style. Camera defaults are southeast/35.3°; all four directions/four tilts have resilient preference infrastructure, with menu presentation deferred.

Seeded visual micro-elevation, supported small ledges and prop size/shape variation leave integer gameplay heights and RNG unchanged. The renderer preserves pooled UIDs, interpolation, aiming, opaque blue/green range tiles, tree/rock fading and tower-only mob silhouettes. Runtime switching/recovery and shared asset ownership have automated coverage. Desktop measurements are recorded separately; full target-device performance acceptance is still open. Menus, tooltips, HUD and all mobile UX/testing are deferred to the UI redesign. See `docs/3D-RENDERER.md` and `assets-src/README.md`.

## Next steps

The pack-character reduction experiment is paused and checkpointed, with unresolved visual artifacts. Start the revised art route with one custom Goblin matching the voxel reference; verify animation reuse and review it at gameplay size before expanding the roster. See `docs/3D-ART-REWORK.md` for the current decision and preserved history.

1. **Human playtesting.** Start with the early economy (waves 1–10), whether mazing with walls beats plain tower building, the stalker wave (8) without a detector, and Canyon with two gates.
2. **Balance tuning with the bot.** Tune values in `src/data/balance.ts`. Last check (3 map seeds per preset, Knight only): Meadow won / 24 / 14, Highlands 26 / 28 / 21, Canyon 22 / 23 / 13. Flyers follow the road but fly over walls, so mazes do not slow them. `tests/docs.test.ts` keeps the price tables in DESIGN.md in sync with balance.ts.
3. **3D and UI rework.** Continue the opt-in Three.js renderer, validate lifecycle and device behavior, complete art/effects coverage, and redesign menus, tooltips and other interface elements; see `docs/3D-RENDERER.md`. The current 2D interface remains the default and a functional baseline, not a finished visual design.

## Tech rules

- TypeScript in strict mode, built with Vite. Tests use Vitest.
- Canvas 2D is the default renderer; `?renderer=3d` opts into the initial live Three.js slice. Three.js and authored 3D assets are allowed. Keep the existing fixed-step simulation independent of rendering.
- Current 2D art is drawn in code and current sound uses the Web Audio API. Record the source and licence of any added assets. Keep `package.json` and its lockfile in sync when adding dependencies.
- The present menu, tooltip and HUD layouts are provisional. Redesign them during the 3D work while preserving the game's required information and controls; choose their final presentation after prototyping on desktop and phone.
- Everything is static and client-side. Saves go in `localStorage` under a versioned key, and reads must survive missing or corrupt data.
- The game has to work under the GitHub Pages path `/gloamward/`, so use a relative or configured Vite `base`.
- Keep the game original. Do not borrow names, characters, art, music or level designs from existing games.

## Architecture

- **Separate simulation from rendering.** The simulation runs on a fixed 60 Hz step and rendering interpolates. Code in `src/sim/` and `src/meta/` must not touch the DOM or canvas, so it can run in tests.
- **Determinism.** All gameplay randomness goes through one seeded RNG, never `Math.random`. The same seed, map seed and inputs give the same run.
- **Data-driven content.** Every number lives in `src/data/balance.ts` (towers, heroes, enemies, waves, map presets, perks, economy). Every name and description lives in `src/data/text.ts`. Do not scatter values through logic.
- **Map generator.** `src/sim/mapgen.ts` builds the terrain from a preset and a seed. Its rules are in DESIGN.md section 4.3 and are enforced by tests.
- **Performance target.** 60 fps at the enemy cap (600 enemies, 400 projectiles). Pool enemies, projectiles, pets and effects, and avoid per-frame allocation in hot paths. The flow field is rebuilt only when a level-0 tower changes.

Layout:

```
src/
  main.ts       startup and main loop
  sim/          hex, mapgen, path, state, stats, combat, actions, step, bot
  render/       Canvas 2D drawing and renderer selection
  render3d/     opt-in live Three.js renderer
  audio/        Web Audio synth
  input/        keyboard and touch
  data/         balance.ts and text.ts
  meta/         profile, perks, unlocks, saves
  ui/           menus, panels
tests/
docs/
```

## Debug options

URL parameters: `?debug` (FPS, entity counts, speed keys), `&bot`, `&wave=N` (jump to a wave), `&map=canyon&mapseed=5`, `&seed=N`. Use them for balance checks: start at any wave, speed up time, and let the bot play.

## Definition of done

For every change:

- `npm run lint`, `npm test` and `npm run build` all pass.
- Unit tests cover the pure logic touched: damage rules (armour, ward, shred, shields, stealth, flyers), pathing and smashing, upgrades and forks, the hero skill tree, wave payouts, the map generator rules, and profile migration.
- A headless simulation runs a full game on each map with the bot without errors (`tests/smoke.test.ts`), and the same seed gives the same result (`tests/determinism.test.ts`).
- For the current live-renderer slice, QA is desktop-only. Defer mobile layout, touch and browser acceptance to the UI redesign, then test at phone width as part of that acceptance.
- The README's status line and `docs/DESIGN.md` are up to date.

## Deployment

The workflow deploys `main` to GitHub Pages. If Pages can't be enabled from your environment, ask the owner to set **Settings → Pages → Source** to **GitHub Actions**.
