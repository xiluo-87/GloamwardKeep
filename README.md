# Gloamward Keep

*Hold the keep through thirty waves.*

Gloamward Keep is a classic-fantasy tower defence for the browser, forked from Gloamward. The map is generated on a hex grid with terrain heights 0 to 4. Enemies walk only on the low road, towers on the hills reach further, and you steer the enemy by building walls on the road. Seal the road completely and they smash their way through.

The default game uses Canvas 2D. Add `?renderer=3d` for the live Three.js renderer with editable Blender voxel models, ten animated enemy kinds, temporary parameterized tower/hero/keep variants and bounded combat effects. Camera defaults are southeast/35.3°, with pointer-centered zoom and no drag pan/free rotation. Crisp neutral daylight is the only lighting style. The eight humanoid meshes share the pack's goblin rig, and tower states mostly vary dimensions/details; individual pack characters and properly designed tier progressions are still missing. Models remain provisional; menus, tooltips, HUD and mobile work are deferred to the UI redesign. See the [3D plan and status](docs/3D-RENDERER.md).

**Status:** playable tower defence on generated hex maps, with forked towers, five heroes, three map presets, profile XP and perks. Balance checked with the bot; final UI/art and target-device performance acceptance remain open.

Generated hills now include small one-level patches and distributed groves to break up broad empty plateaus. All three presets have more forest; clustered cosmetic bushes/stones fill remaining bare interiors. The 3D level steps are 50% taller. Roads and entrances retain their seeded layout, and dressing still disappears when built over.

Art direction is being replanned around a custom Goblin proof built directly from the voxel reference. The purchased-pack adaptations are preserved experiments with unresolved visual artifacts; they are not final accepted characters. Rig/animation reuse will be tested on that one custom model before expanding the roster.

## Run it

```sh
npm install
npm run dev
```

`npm run lint`, `npm test` and `npm run build` are the checks. Debug URL options include `?debug`, `&bot`, `&wave=N`, `&map=canyon&mapseed=5` and `&seed=N`. Select the backend with `renderer=2d|3d`; camera override indices are `direction=0..3` and `tilt=0..3` (defaults 0/1). Preference storage tolerates missing/corrupt values. Final settings controls belong to the UI work.

The 3D renderer reads the same combat simulation. It batches animation, health/shield bars, projectiles, hawks and effects. Tower/hero/keep upgrades change their working art. The roofless archer aims separately from its platform. Blue range tiles show current tile-center coverage; hovering/focusing an upgrade adds only its extra coverage in green. Opaque unlit fills retain their colors over terrain. Trees/rocks fade around obstructed mobs; towers stay opaque with faint hidden-mob silhouettes.

Terrain keeps gameplay heights 0–4 while adding seeded small surface steps, supported intermediate ledges and prop size/shape variation. Small bushes/stones on bare raised tiles are cosmetic and disappear when built over. No visual variation changes pathing, range bonuses or gameplay RNG.

The [voxel map study](camera-preview.html) compares real generated maps across four directions/four tilts, a legal 0/12/40/80-tower density fixture and a close archer/goblin art pair. Its scripted movement is not combat. The [desktop benchmark](render-benchmark.html) exercises every entity cap, records frame/resource/load results and repeats disposal/recreation. These development tools do not change player saves or establish final device acceptance.

The current [art rework proof](art-review.html) compares actual purchased Goblin, Orc, Hill Troll and Hood Archer models before/after conservative polygon cleanup and shape refinement, native/crowd animation, seven newly authored roofless archer designs and sparse/crowded real maps. All four retain their original rigs and all ten native animations. Larger reduction candidates were rejected after surface artifacts; current measured savings range from 0.73% for Troll to 10.96% for Orc. Barrel Knight, Pit Demon and Ghost are the selected pack replacement proposals. This stages 1–2 proof uses the live renderer through a shared asset registry; the main game's older art remains until review. See the [bounded rework plan](docs/3D-ART-REWORK.md) and [model refinement record](docs/3D-MODEL-REFINEMENT.md).

The [asset sources](assets-src/README.md) retain editable `.blend` files, reproducible builders and runtime GLBs. The purchased pack/license remain unchanged. Blender is an authoring tool; Three.js is the only new game runtime dependency. Assets resolve through Vite under `/gloamward/`.

Startup 3D failure falls back to 2D on a fresh canvas. Backend switching preserves the current run and rebinds input. Context loss pauses the run; after restoration the player resumes. Automated lifecycle checks supplement desktop QA. Phone layout, touch and mobile acceptance are deliberately deferred.

## Layout

```
src/sim/    simulation: hex grid, map generator, pathing, towers, combat, waves, bot
src/data/   balance.ts (every number) and text.ts (every name and description)
src/meta/   profile XP, perks, unlocks and saves
src/render/ Canvas 2D and renderer selection
src/render3d/ opt-in live Three.js renderer
src/ui/     menus and panels
src/audio/  Web Audio synth
src/input/  keyboard and touch
tests/      Vitest unit tests and headless runs
docs/       DESIGN.md (the source of truth for behaviour)
```

## Docs

- [Game design](docs/DESIGN.md): mechanics, content and every number
- [CLAUDE.md](CLAUDE.md): engineering rules and next steps
