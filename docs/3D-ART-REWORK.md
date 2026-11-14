# Approved art rework: stages 1–2

## Current direction: custom character proof

The pack-mesh adaptation experiment is paused and retained as a checkpoint. Its detailed equipment, proportions and reduction artifacts have not reached the reference artwork's clean block shapes. The retained assets are experiments, not accepted final art.

The agreed next direction is one custom Goblin authored from simple block forms in Blender, reviewed at gameplay size beside an existing roofless archer tower. Prove whether the purchased rig/animations can drive that model before expanding the roster; their reuse remains a technical question. Review the complete static and animated example before producing other characters. Use a shared block/material kit for towers and scenery, while terrain layout remains generated. Camera, lighting and the reusable renderer stay in place; UI/mobile work remains deferred.

The sections below preserve the previous stages and findings for reference.

The user approved stages 1 and 2 only. The attached first voxel artwork remains the reference. These models are a visual proof awaiting review, not accepted final art. Do not expand the roster or other tower families until that review.

The user subsequently approved polygon reduction and shape refinement for the four proof characters. See [3D-MODEL-REFINEMENT.md](3D-MODEL-REFINEMENT.md) for actual triangle counts, native sources and the geometry export route. The current registry uses those refined models; the palette-only baseline below is preserved history.

The user then chose larger tiles with resized buildings and vegetation, keeping mob model sizes intact, after observing terrain clipping. The first map-review profile uses tile size 2.4, buildings 1.4 and vegetation 1.5 relative to the prior model units. Rendering remains in tile coordinates: unchanged mob model sizes are divided by tile size, while static props use their own scale divided by tile size. Ground elevation also divides by tile size, so horizontal expansion does not make cliffs taller relative to the mobs. This is a scene-proportion change; no character animation or model file is scaled for it. The shared renderer accepts this profile, currently enabled in the art-review map. The legacy game keeps its base profile pending art review. These numerical proportions are the first review pass, not a recorded final user preference. A diagnostic sampled 48 moving poses per species on each of Highlands, Meadow and Canyon (seed 5): the 2.4 tile profile removed sampled body intersections with raised ground. The Troll's long held club still enters terrain on some turns; it needs a separate carry-pose/weapon decision. This is not a claim that all animated weapon intersections are solved. A source-derived Idle/Walk floor correction keeps feet seated without altering animation clips.

## Fixed choices

- Southeast, 35.3° orthographic default; zoom at the pointer/touch, no pan or orbit. Existing direction and tilt alternatives remain available.
- Crisp neutral daylight only.
- Roofless archer platforms, so their real character crew can aim freely.
- Chunky visible blocks, subtly softened edges, warm timber, cool stone, restrained greens and orange accents. Terrain should eventually keep the reference's irregular ledges and small variations.
- Trees and rocks fade ahead of mobs; towers remain opaque, with faint hidden-mob silhouettes. Existing behavior is retained.
- Menus, tooltips, HUD and mobile acceptance belong to the later UI redesign.

## Stage 1: shared asset contract

`src/render3d/proof-catalog.ts` records original/adapted URLs, provenance, the character's own ten required native clips, +Y up / -Z forward, feet origin and provisional presentation height. It also names the actual head, weapon-hand and chest-effects anchors, plus the crew arrow bone. The registry validates those nodes. These sizes are review values, not final preferences.

`RuntimeModelRegistry` owns and deduplicates templates. Native animation comparisons and GPU pose-baked crowds use those same templates and normalization. Static archer roots override only their matching IDs in the existing library. The review map injects this registry into the actual `Renderer3D`, `LiveActors` and `LiveTowers`; it does not use a second tower generator.

Characters retain the actual purchased meshes:

| Review ID | Exact original | Scope of adaptation |
| --- | --- | --- |
| goblin | `assets-src/studies/goblin-shaman/editor-preview.glb` | User-selected editor export, palette pass |
| orc | `blocky-pack/dcc/tiny-characters-blocky-orc.glb` | Palette pass on its own mesh and rig |
| troll | `blocky-pack/dcc/tiny-characters-blocky-hill-troll.glb` | Palette pass on its own mesh and rig |
| archer-crew | `blocky-pack/dcc/tiny-characters-blocky-hood-archer.glb` | Actual bow, arrow, quiver and native animation retained |

Original purchased files remain unchanged. Proof characters live in `assets-src/rework/proof/characters/`; custom towers live in `assets-src/rework/proof/archers/`.

### Original character export limitation and its replacement

The Blender character roundtrip altered the original skin/bind transforms. Equal triangle counts and clip names did not establish fidelity. That export was rejected.

The first proof therefore supported only colors. The approved refinement now uses `refine_pack.py`: current native geometry is mapped into the original GLB mesh basis, while its source rig and animation data are preserved exactly. This supports the current shape/reduction work without relying on Blender's skin re-export. The old color-only sources/exporter remain available as a baseline. Do not use the older destructive cuboid character builder for these assets.

The tower `.blend` is canonical editable geometry. `build_archer_proof.py` is a one-time initializer that refuses to overwrite it. Run `export_archer_proof.py` on the edited native file to export the current blocks, bevels, materials and sockets without rebuilding the designs.

## Stage 2: seven distinct archer designs

All are roofless. Their construction and crew layout differ independently of scale:

| State | Structure | Crew |
| --- | --- | --- |
| I | Four timber stilts, exposed X braces, open plank platform | 1 |
| II | Coursed stone plinth, cantilever braces, timber upper frame and ladder | 1 |
| III | Masonry shaft, stepped corner buttresses, stone merlons and fighting platform | 1 |
| Longbow I | Narrow tall trestles and one unobstructed marksman perch | 1 |
| Longbow II | Offset stone pier, cantilevered upper perch, split-level access and signal mast | 1 |
| Volley I | Separate twin firing bays and a Y-braced trestle | 2 |
| Volley II | Three staggered firing platforms, raised rear bay and stone-and-timber gantry | 3 |

The exported structure includes explicit feet, aim, muzzle and crew sockets. Real Hood Archer instances attach to those sockets. These visual crew counts do not alter gameplay attack count or balance.

## Review surface

Open `art-review.html` through the development server:

1. **Pack / adaptation / crowd:** original, adapted native animation and adapted crowd rendering beside each other, including Idle, Walk and Attack1.
2. **Seven archer designs:** consistent framing, optional silhouettes and larger cards. Check tier identity, bow clearance, feet placement and crew overlap.
3. **Real map:** actual generator and production renderer with sparse/crowded archer-only layouts, three actual enemy meshes and pointer-centered zoom. The budget and movement are a display fixture, not simulated combat. Terrain, gate and keep are existing working art.
4. **Replacement choices:** untouched pack models proposed for the missing roles: Barrel Knight for the wagon's heavy-ground role, Pit Demon for the bat's flying-enemy role, Ghost for the hawk's familiar role. No custom wagon/bat/hawk is produced. The flying replacements still need appropriate later animation and integration; native clips do not contain flight loops.
5. **Reference artwork:** the user's attached reference, beside the proof for comparison.

## Acceptance and stop boundary

Automated checks compare each character to its own pinned source: geometry, joints, weights, clips/durations, provenance and actual world-space animated vertex clouds. Tower checks cover real exported geometry, distinct structures, scale and socket preservation. These checks do not establish attractive or approved artwork.

Desktop visual review must inspect native/crowd agreement, no exploded skeletons, all seven structures with real crew, and sparse/crowded generated maps. Record evidence and any remaining limitations before presenting the proof.

Stop for the user's visual decision here. The remaining character roster, remaining tower families, replacement-role gameplay integration, terrain refinement, UI/mobile redesign and release acceptance remain outside this approval.

## Verification on 2026-11-14

- Full suite: 310 tests across 45 files passed. The 17 affected asset/registry/lifecycle checks passed again after the final proof exports. Lint, TypeScript, production build and whitespace checks passed.
- Every proof character retains its own source triangle count, skin and clip durations. Source/adapted animated vertex-cloud comparisons pass; the color exporter preserves all non-color binary data.
- Temporary paint edits propagated from all four native files into temporary GLBs, with zero sampled pose-bound error. Temporary geometry and weight edits were rejected for all four. Official proof files were not changed by those smoke checks.
- Desktop inspection covered original/adapted/crowd animation, actual Hood Archer crew and all seven tower structures, silhouette comparison, all three generated maps, 7/40/80-tower layouts, pointer-centered zoom, and the production `/gloamward/` asset path. Final browser error logs were empty. The moving-map fixture does not establish combat animation timing or final performance acceptance.
- Review captures are in the task's `outputs/`: `archer-proof-upper.png`, `archer-proof-forks.png`, `real-map-crowded.png` and `pack-replacement-choices.png`.

Historical status of the palette-only proof: it was ready for review with geometry refinement pending. The subsequently authorized reduction and shape pass is tracked in [3D-MODEL-REFINEMENT.md](3D-MODEL-REFINEMENT.md). All later art families and UI/mobile work remain pending.
