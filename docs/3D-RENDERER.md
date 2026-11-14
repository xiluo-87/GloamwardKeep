# 3D renderer and remaining UI rework

Status: the opt-in Three.js renderer has technical content coverage using provisional parameterized art, instanced animated crowds, combat effects, camera preference infrastructure and renderer switching/recovery. Canvas 2D remains the default and fallback. This is a reviewable implementation, not final art or target-device performance acceptance. The user delegated remaining non-UI work; menu, tooltip, HUD and mobile redesign/acceptance stay deferred.

## 3D documents

| Document | Status |
|---|---|
| This file | Current renderer architecture, confirmed choices and remaining work |
| [3D-CUSTOM-PROOF.md](3D-CUSTOM-PROOF.md) | Current art review candidate: custom Goblin and seasonal scenery |
| [3D-ART-REWORK.md](3D-ART-REWORK.md) | Approved rework scope (stages 1–2), seven archer designs, scene proportions |
| [3D-MODEL-REFINEMENT.md](3D-MODEL-REFINEMENT.md) | Paused pack-mesh reduction experiment, kept for comparison |
| [3D-BENCHMARK.md](3D-BENCHMARK.md) | Desktop measurements from 2026-11-13; 60 fps not yet verified |

## Confirmed choices and open decisions

- Three.js renders the existing fixed-step simulation. Runtime dependencies and authored assets are allowed.
- Orthographic isometric camera, **southeast / 35.3°** by default. Independent settings offer **SE/SW/NW/NE** and **25°/35.3°/45°/55°**, all 16 combinations. No free rotation or drag panning. Wheel/pinch zoom stays centered on the pointer/touch midpoint.
- **Crisp neutral daylight only.** Keep the roofless timber archer platform, with a separately aiming bowman.
- Clean voxel art follows the first supplied artwork. The purchased Blocky Characters pack is a licensed starting point; the models should move toward the artwork's palette, visible cubes and simple detail.
- Trees/rocks fade when they obstruct mobs. Trees anticipate an overlap by 0.35 seconds. Towers, walls, keep and gates remain opaque; only mob pixels behind a structure receive a smoothly appearing faint silhouette. Terrain stays opaque.
- Current range uses blue tiles whose centers are within the real range. Hover/focus on an upgrade adds only its additional tiles in green. These are opaque, unlit colors so terrain lighting does not mix into them. Gameplay still uses continuous distance checks.
- Sparse seeded small bushes/stones on empty raised tiles have no effects, cost or blocking. Building over them removes them for that run; a fresh run regenerates them.
- Add small visual elevation steps, intermediate edge ledges and size/shape variation among prop instances. Preserve logical terrain levels and simulation behavior.

New art and implementation tuning made under the delegated work are provisional choices for review. They do not become final user preferences automatically.

| Open decision | Next review |
|---|---|
| Camera tuning | Zoom limits, edge access, portrait/landscape fit/reset and any automatic focus; preset settings presentation and when changes apply |
| Art | Final voxel scale, proportions, palette, character/hero silhouettes, animation detail, terrain treatment and individual upgrade designs |
| UI | Menus, tooltips, HUD, build/upgrade, onboarding and desktop/touch flows; DOM/scene presentation and any supporting library |
| Acceptance | Target desktop/phone browsers, drawing resolution, quality settings, download/memory budgets and 60 fps thresholds |

## Implemented live renderer

Open `/?renderer=3d`. `src/render3d/renderer.ts` reads the real `RunState`; rendering does not change balance, targeting, pathing, event ownership or timing. `?renderer=2d` selects the baseline. Camera URL overrides use indices: `&direction=0..3&tilt=0..3`. Defaults are direction 0 / tilt 1. Corrupt stored values fall back independently. Preference persistence and application APIs exist; their menu controls belong to the UI redesign.

The renderer uses the shared generated terrain, Blender-authored keep/gates/nature/tower/hero prefabs and ten animated enemy models. Tower upgrades/forks change art; hero levels/skills reuse a small variant set. Keep upgrades refresh the structure art. Loaded prefabs have procedural fallbacks, and unavailable enemy assets use batched voxel stand-ins. No external CDN is needed at runtime.

Enemy instances follow stable UIDs through pool swap removal, reuse and restart. Positions interpolate; animation poses are sampled from the exported clips into float textures and interpolated on the GPU. Each species uses one body batch. Only hidden mobs enter the sparse silhouette batches. Health/shield bars and ground shadows are instanced. Bodies do not render into the expensive sun-shadow map every frame; environment/building changes invalidate the cached static shadow map.

Typed projectiles, UID-validated beams, flapping hawks, filled burn pools, enemy/tower statuses and all simulation event kinds have bounded render cues. The adapter preserves legacy -14/-16 projectile launch offsets and real hit timing. Event consumption never clears the simulation queue. Range/placement/path overlays and tall-model picking use the same coordinate contract.

## Terrain and natural variation

The generator still defines the map with integer heights 0–4, clearable feature IDs and an independent cosmetic decoration hash. Render-only surface sampling in `src/camera-preview/surface.ts` adds bounded center offsets and coherent small voxel steps. Roads stay nearly level, with offsets at most 0.003 scene units; raised land stays within 0.026 of its nominal level. Small supported earth/stone ledges break up large elevation boundaries. Tower/prop anchors, moving actors and range/projectile adapters account for the visual surface.

Forests/rocks choose among three Blender prefabs, with deterministic size, width/height and quarter-turn variation. Their geometry remains visibly voxel-shaped. Dressing is still instanced procedural geometry; its corresponding bush/stone parts and terrain cap/cliff/path/snow kit are retained in the Blender library for later art editing. Full-map terrain stays generated rather than exported as one fixed Blender scene. These changes consume no gameplay RNG and do not alter height bonuses, roads, movement, feature clearing or range membership.

## Editable art pipeline and coverage

See `assets-src/README.md` for native editing and reproducible Blender commands, and `assets-src/CREDITS.md` for provenance/licensing. No new runtime package beyond Three.js is needed. Blender 4.5.16 LTS and its bundled Python perform the build.

| Coverage | Working assets |
|---|---|
| Eight buildable types | 56 parameterized tier/fork states, including Palisade; distinct tier designs remain unfinished |
| Five heroes | 25 reusable base/level/skill variants |
| Keep and gates | Four levels each |
| Terrain/nature | Five terrain samples, three forest and three rock variants, plus ten modular/dressing parts |
| Enemy IDs | Ten IDs; eight replacement meshes sharing the pack goblin rig plus custom Bat/Wagon, not the pack's distinct character models |

The 110-root static library uses named prefab IDs and one matte vertex-color material, with a small bevel and separate archer aim component. GLTFLoader changes duplicate/invalid node names; runtime lookup uses stable `asset_id`/component metadata. Geometry has a single library owner; fade and ghost consumers copy materials. Removing a clone never disposes shared geometry.

The eight humanoids have coarse replacement voxel bodies and role-specific gear on the purchased goblin rig/animations. They are licensed derivatives, not eight separate purchased rigs or final accepted character designs. Goblin geometry is **1,540 triangles**, down from 2,846. All ten source clip names/durations are retained. Original animated Bat and Wagon complete the roster. Native `.blend` files are retained for deliberate model edits; `export_blend.py` exports those edits without regenerating the starting geometry. The original purchased pack/editor study remain unchanged.

Current runtime GLBs total **12,802,136 bytes** uncompressed. A local gzip estimate is **2,260,645 bytes**; actual transfer depends on hosting compression. The static library is 7,017,184 bytes. This is measured working content, not an agreed network budget. Geometry, expanded pose memory and transferred bytes must be assessed separately. Compression decoders/meshopt/Draco are not required by these exports.

## Ownership, fallback and recovery

`RendererHost` is the stable `GameRenderer`/camera facade. It owns backend replacement, creates a fresh canvas for each context, rebinds canvas input, preserves one simulation/frame driver and the current run/profile, and queues overlapping switches. Failed candidate preparation disposes the candidate and retains/restores a functional renderer. Debug builds expose `switchRenderer` and `configureCamera`; final controls remain UI work.

Startup construction failure falls back to 2D on a fresh canvas. Asset failures keep stand-ins; late successful loads after disposal are released. WebGL context loss prevents default destruction behavior, pauses the run and displays a restoration notice. Restoration refreshes graphics resources and static shadows; the run remains paused until resumed. Geometry, materials, textures, skeletons, instance buffers, shadows and listeners have explicit owners and idempotent disposal.

Automated coverage includes failed startup, failed candidate/fallback preparation, overlapping switches, disposal during pending construction, input rebinding without duplicate listeners, late asset completion and context-loss/restoration notification without state mutation. These tests supplement live desktop checks; real target-browser recovery remains part of acceptance.

## Desktop validation and benchmark

`render-benchmark.html` constructs a rendering-only fixture at the real caps: **600 enemies, 400 projectiles, 160 hawks, 80 pools and 80 legal tower placements**. It supports mixed or all-goblin crowds, all maps/presets, warmup, repeat dispose/recreate cycles and JSON/CSV export. It records preparation/first draw, frame distributions, CPU draw time, draw calls, triangles, resources and expanded pose texture bytes. It does not apply a hidden pass threshold or change player saves.

Detailed desktop measurements and environment are recorded in `3D-BENCHMARK.md`. A 60 fps target means approximately 16.7 ms per frame. Record actual frame cadence separately from CPU submission time; do not infer GPU cost or target-device acceptance from CPU time alone. First draw/shader warmup is also separate from steady state.

All 16 camera presets have automated framing and zoom/picking checks on Meadow, Highlands and Canyon, including tall-actor clearance and keep/gates. The tests also cover real GLB parsing, finite geometry/weights/animation, exact humanoid clip durations, prefab IDs/aim pivots, sparse silhouette batching, bounded effects, surface determinism and unchanged gameplay state. The headless bot and deterministic simulation checks remain required. Production assets must load under `/gloamward/`.

## Comparison study and reuse

`camera-preview.html` remains a development study with four direction/tilt comparisons, real generated maps/seeds, 0/12/40/80-tower density fixtures and a close archer/goblin art pair. Its enemies follow open routes without combat. The art pair now uses the same Blender goblin export as the live game; its conventional skinned copy is for inspection rather than crowd rendering. Terrain look compares the artwork treatment with the earlier blockout. The crisp-neutral light and visibility policy are shared.

Two study defects were fixed after review: skeleton bounds were measured before the hierarchy was initialized, which normalized the goblin about 100 times too small, and a separate legacy tower generator still drew old archer roofs. The study now uses the shared tower/hero builders, and a regression test measures skinned vertices across the walk clip.

Camera math, world mapping, terrain sampling, procedural source builders, palettes, lighting, voxel assembly and visibility easing are reused. The Blender files/GLBs are production-editable sources and exports, not screenshots that must be rebuilt for the game. The fixture's extra budget and scripted movement stay in test infrastructure.

## Remaining work

The earlier completion summary overstated art readiness. Small parameter differences and a passing state-coverage test do not establish readable tower upgrades. The pack's individual Orc/Troll/Lich/hero models have not been integrated. The intended character adaptation and tower design work remains unfinished.

1. Review the working art on the real map and refine models in Blender toward the reference. Keep final proportions, silhouettes and palette open for the user's decisions.
2. Redesign menus, tooltips, HUD and build/upgrade flows, then expose camera/backend preferences through the chosen UI. Preserve required game information and controls without carrying implementation details into the player flow.
3. During that redesign, validate phone framing, touch/pinch, edge access and browser behavior. The user explicitly deferred mobile checks to this stage.
4. Agree acceptance devices/quality/budgets and verify full-cap frame times, initial load and recovery there. Repeat with the final UI and accepted art. Keep 2D as the fallback until acceptance supports changing the default.
