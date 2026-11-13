# Later: a 3D renderer with Three.js

Status: planned, not started. Finish and play-test the 2D game first, so rules and balance are settled before the art changes.

## Decision

Use **Three.js** as the 3D renderer. It is a rendering library, not a full engine, so the game keeps its own fixed-step loop, simulation and input. Babylon.js and PlayCanvas were considered and rejected: they bring their own game loop, physics and editor workflow that this project doesn't need, and a much larger download.

## Why it fits

- The simulation never touches the DOM or canvas. The renderer only reads `RunState` and its events. A 3D renderer is a drop-in replacement for `src/render/` behind the same interface; sim, UI, input, audio and tests stay unchanged.
- The hex terrain with heights 0–4 maps directly to extruded hex prisms, one step per level. Use `InstancedMesh` for tiles, trees and rocks, so the whole board is a handful of draw calls.
- WebGL runs on all current phones. Three.js adds roughly 150 KB gzipped.

## Renderer contract to keep

The 3D renderer implements the same API as the 2D one (see `src/render/renderer.ts` and `src/render/view.ts`):

- `resize()`, `setInsets(top, bottom, left, right)`
- `screenToWorld(x, y)` and `screenToTile(x, y)`: use a raycast against the terrain (or a ground plane per height) instead of `pixelToTile`
- `resetFx()`, `consumeEvents(s)` (never resets `s.eventCount`)
- `draw(s, alpha, frameDt, wallTime, view)`, `drawTitle(time, terrain?)`, `drawPreview(ctx, terrain, w, h)`
- Rebuild terrain meshes when `s.terrain` or `s.terrainVersion` changes (clearing forest/rocks)

Keep the 2D renderer as a fallback. Choose the renderer with a setting, and fall back to 2D if WebGL isn't available.

## Choices to make before starting

1. **Project rules.** `CLAUDE.md` says "Canvas 2D only, no game engine, no runtime dependencies" and forbids asset files. Amend it to allow Three.js as the single runtime dependency, pinned to an exact version, and `.glb` model files built through the pipeline below.
2. **Art.** See Assets below.
3. **Camera.** Use a tilted orthographic camera as the default: it keeps the board readable and tile picking reliable. A perspective camera that can rotate is an option, but needs controls and a reset to a clear view.
4. **UI.** Keep the DOM HUD and panels over the WebGL canvas. Don't move the UI into Three.js.

## Assets

Recommendation: Blender for models, free CC0 packs as a base for characters, and AI generation for concepts only.

| What | How |
|---|---|
| Terrain, trees, rocks, effects | Procedural in code (instanced meshes, particles) |
| Towers with all tiers and forks | Blender Python scripts kept in the repo |
| Heroes and enemies | CC0 packs as the base, restyled and recombined in Blender |
| AI 3D generation | Concepts only; nothing ships without cleanup in Blender |

**Blender.** It is free and runs headless from Python (`bpy`), so models can be built by scripts in the repo and rebuilt reproducibly. Tower variants share a base (for example a wooden archer tower that becomes stone, then a slim Longbow or a wide Volley), so one parametrised script can make all 35 tower variants in one consistent style. It exports compressed glTF (`.glb`, Draco or meshopt) that Three.js loads directly, and it handles rigging and simple animation: walk cycles, catapult swings, bat wings.

**CC0 asset packs** (Kenney, Quaternius, KayKit). These are low-poly fantasy sets (castles, towers, knights, orcs, skeletons, hex tiles), CC0 so free for any use, already glTF, often rigged and animated, and consistent in style. Other games use them too, so recolour, combine and modify them in Blender to keep the game's own look. This also matters for the "keep the game original" rule.

**AI 3D generation APIs** (Meshy, Tripo, Rodin and similar). These are useful for quick concepts or a one-off prop, but not as the main pipeline:
- Style drifts between models, which is a problem for about 50 models that must match.
- Topology is messy: high poly counts, uneven meshes and baked textures, so every model needs cleanup and decimation in Blender anyway.
- Auto-rigging handles humanoids, but not bats, wagons or catapults.
- Each model costs credits, results are not reproducible, and commercial-use terms differ by service and plan. Check them before using anything.

**Pipeline**
- Blender sources and build scripts go in `assets-src/`. The exported `.glb` files are produced by one command, and output goes to `public/models/`.
- Record each asset's source and licence in `assets-src/CREDITS.md` (CC0 packs included).
- Size budget: about 5 MB total of models for mobile. Prefer shared materials and texture atlases or vertex colours.
- This requires relaxing the "no image or audio files" rule in `CLAUDE.md` to allow model files, together with the Canvas 2D rule.

## Rough plan

1. Add Three.js and a `src/render3d/` module that implements the renderer contract.
2. Terrain: instanced hex prisms per height, road material on level 0, instanced trees and rocks, gates and keep.
3. Towers and heroes: low-poly procedural meshes per type, tier and fork, with recoil and status effects.
4. Enemies: instanced meshes per kind, with health bars as sprites or in a DOM/canvas overlay.
5. Projectiles, hawks, beams, pools and event effects (particles via `Points` or instanced quads).
6. Picking via raycast, placement ghost, range rings.
7. Renderer switch in settings with WebGL detection, then check performance on a phone.
