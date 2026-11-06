# Gloamward

A browser survivor game built around a lantern whose light is the player's sight, damage and clock. `docs/DESIGN.md` is the source of truth for game behaviour. If you change a mechanic or a starting value on purpose, update that document in the same commit.

## Current state

Design only. There is no code yet. Start at Milestone 0.

## Tech rules

- TypeScript in strict mode, built with Vite. Tests use Vitest.
- Canvas 2D only. No game engine and no runtime dependencies.
- All art is drawn in code and all sound uses the Web Audio API. Do not add image or audio files.
- Everything is static and client-side. Saves go in `localStorage` under a versioned key, and reads must survive missing or corrupt data.
- The game has to work under the GitHub Pages path `/gloamward/`, so use a relative or configured Vite `base`.
- Keep the game original. Do not borrow names, characters, art, music or level designs from existing games.

## Architecture

- **Separate simulation from rendering.** The simulation runs on a fixed 60 Hz step with an accumulator, and rendering interpolates. Simulation code must not touch the DOM or canvas, so it can run in tests.
- **Determinism.** All gameplay randomness goes through one seeded RNG, never `Math.random`. The same seed and inputs should give the same run.
- **Data-driven content.** Weapons, enemies, passives, waves and balance values live in plain data files under `src/data/`, not scattered through logic.
- **Performance target.** 60 fps with 1,000 enemies, 500 projectiles and 1,000 pickups on a mid-range laptop.
  - Pool enemies, projectiles, pickups and particles, and avoid per-frame allocation in hot paths.
  - Use a uniform spatial grid for collisions and targeting.
  - Render the darkness layer at half resolution.

Suggested layout:

```
src/
  main.ts       startup and main loop
  sim/          player, enemies, weapons, lantern, spawning, collisions
  render/       world, lighting, HUD, effects
  audio/        Web Audio synth
  input/        keyboard and touch
  data/         balance and content tables
  ui/           menus, level-up, shop
  save/         versioned persistence
tests/
```

## Build order

Finish each milestone and leave the game playable before starting the next. Commit in small steps.

1. **Milestone 0, scaffold.** Vite, TypeScript, Vitest, lint and a GitHub Actions workflow that tests, builds and deploys to Pages. Fixed-step loop and a resizable canvas.
2. **Milestone 1, playable core.** Player movement, camera, cobble background, Soot Mites, Wick Lash, embers, level-up with 3 choices, death and restart. Debug overlay with FPS and entity counts behind a key.
3. **Milestone 2, the lantern.** Oil, burning, dimming, guttering, the darkness layer, dark damage penalty, eyes in the dark, oil drops and Turn Up the Wick. **Stop and playtest here, because this is the point of the game.**
4. **Milestone 3, lampposts and clock.** Lampposts, the no-oil rule, the 15:00 clock, the wave table, crates and elites.
5. **Milestone 4, content.** All weapons, combinations, passives and enemies.
6. **Milestone 5, the boss.** All three phases of The Long Night, including the Inversion, and the dawn ending. Do not spoil the Inversion in any UI text or the README.
7. **Milestone 6, between runs.** Wax, shop, characters, New Moon mode and saves.
8. **Milestone 7, audio and mobile.** Web Audio synth, touch controls and a responsive HUD.
9. **Milestone 8, polish.** Screen shake with a reduce-motion setting, hit flashes, title screen, balance pass.

## Definition of done

For every milestone:

- `npm run lint`, `npm test` and `npm run build` all pass.
- Unit tests cover the pure logic touched: oil burn, damage rules for light and dark, wick scaling, ember curve, wave selection and save migration.
- You have actually run the game in a browser and played the new feature. Where a browser is available, check the console for errors and test at phone width too.
- A headless simulation test runs a full 15-minute run at high speed without errors, once enough exists for this to mean something.
- The README's status line is up to date.

## Balance checks

Add a debug option to start at any minute, and to speed up or slow down time. In the first few minutes, a player who simply moves around and fights should hold about 40–70% oil. If oil never runs low, the core tension is missing; if players routinely gutter before minute 3, it is too harsh. These are the first things to tune.

## Deployment

The workflow deploys `main` to GitHub Pages. If Pages can't be enabled from your environment, ask the owner to set **Settings → Pages → Source** to **GitHub Actions**.
