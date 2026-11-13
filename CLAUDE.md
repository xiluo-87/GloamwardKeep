# Gloamward Keep

A browser tower defence on generated hex maps with terrain heights 0–4, forked from Gloamward. Towers on high ground reach further, enemies walk only on the level-0 road, and the player steers them by building on it; sealing the road makes them smash through. `docs/DESIGN.md` is the source of truth for game behaviour. If you change a mechanic or a value on purpose, update that document in the same commit.

## Current state

The game is playable from wave 1 to wave 30: 7 towers with forks, 5 heroes with skill trees, 3 map presets (meadow, highlands, canyon), profile XP, perks and unlocks, saves, audio and touch controls. Balance has only been checked with the bot in `src/sim/bot.ts` (see `tests/smoke.test.ts`).

## Next steps

1. **Human playtesting.** Start with the early economy (waves 1–10), whether mazing with walls beats plain tower building, the stalker wave (8) without a detector, and Canyon with two gates.
2. **Balance tuning with the bot.** Tune values in `src/data/balance.ts`. Last check (3 map seeds per preset, Knight only): Meadow won / 24 / 14, Highlands 26 / 28 / 21, Canyon 22 / 23 / 13. Flyers follow the road but fly over walls, so mazes do not slow them. `tests/docs.test.ts` keeps the price tables in DESIGN.md in sync with balance.ts.
3. **Future work.** A 3D renderer with Three.js is planned; see `docs/3D-RENDERER.md`. The tech rules below stay Canvas 2D until that work starts.

## Tech rules

- TypeScript in strict mode, built with Vite. Tests use Vitest.
- Canvas 2D only. No game engine and no runtime dependencies.
- All art is drawn in code and all sound uses the Web Audio API. Do not add image or audio files.
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
  render/       drawing
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
- Where a browser is available, play the new feature, check the console for errors and test at phone width too.
- The README's status line and `docs/DESIGN.md` are up to date.

## Deployment

The workflow deploys `main` to GitHub Pages. If Pages can't be enabled from your environment, ask the owner to set **Settings → Pages → Source** to **GitHub Actions**.
