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

1. **Project rules.** `CLAUDE.md` says "Canvas 2D only, no game engine, no runtime dependencies". Amend it to allow Three.js as the single runtime dependency, pinned to an exact version.
2. **Art.** Keep everything procedural (low-poly meshes built in code, matching the current flat storybook style), or allow `.glb` model files. Procedural keeps the "no asset files" rule. Model files look better, but they add a modelling workflow and file size.
3. **Camera.** Use a tilted orthographic camera as the default: it keeps the board readable and tile picking reliable. A perspective camera that can rotate is an option, but needs controls and a reset to a clear view.
4. **UI.** Keep the DOM HUD and panels over the WebGL canvas. Don't move the UI into Three.js.

## Rough plan

1. Add Three.js and a `src/render3d/` module that implements the renderer contract.
2. Terrain: instanced hex prisms per height, road material on level 0, instanced trees and rocks, gates and keep.
3. Towers and heroes: low-poly procedural meshes per type, tier and fork, with recoil and status effects.
4. Enemies: instanced meshes per kind, with health bars as sprites or in a DOM/canvas overlay.
5. Projectiles, hawks, beams, pools and event effects (particles via `Points` or instanced quads).
6. Picking via raycast, placement ghost, range rings.
7. Renderer switch in settings with WebGL detection, then check performance on a phone.
