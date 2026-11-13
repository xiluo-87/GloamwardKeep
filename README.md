# Gloamward Keep

*Hold the keep through thirty waves.*

Gloamward Keep is a classic-fantasy tower defence for the browser, forked from Gloamward. The map is generated on a hex grid with terrain heights 0 to 4. Enemies walk only on the low road, towers on the hills reach further, and you steer the enemy by building walls on the road. Seal the road completely and they smash their way through.

All art is drawn in code and all sound comes from the Web Audio API. There are no image or audio files, no engine and no runtime dependencies.

**Status:** playable tower defence on generated hex maps — 7 towers with forks, 5 heroes with skill trees, 3 map presets, profile XP and perks. Balance checked only with the bot so far.

## Run it

```bash
npm install
npm run dev
```

`npm test`, `npm run lint` and `npm run build` are the checks.

Debug options go in the URL:

- `?debug` shows FPS and entity counts and enables the speed keys
- `&bot` lets the balance bot play
- `&wave=N` jumps to wave N
- `&map=canyon&mapseed=5` picks the preset and the map seed
- `&seed=N` fixes gameplay randomness

## Layout

```
src/sim/    simulation: hex grid, map generator, pathing, towers, combat, waves, bot
src/data/   balance.ts (every number) and text.ts (every name and description)
src/meta/   profile XP, perks, unlocks and saves
src/render/ canvas drawing
src/ui/     menus and panels
src/audio/  Web Audio synth
src/input/  keyboard and touch
tests/      Vitest unit tests and headless runs
docs/       DESIGN.md (the source of truth for behaviour)
```

## Docs

- [Game design](docs/DESIGN.md): mechanics, content and every number
- [CLAUDE.md](CLAUDE.md): engineering rules and next steps
