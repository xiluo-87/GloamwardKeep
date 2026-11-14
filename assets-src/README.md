# Editable art sources

The first supplied voxel artwork is the shared style reference. Models and tuning added during the delegated implementation are working art for review. The confirmed roofless archer, crisp-neutral lighting and camera choices stay in place; menus/mobile work remains deferred.

## Current custom proof

`rework/custom/goblin/` contains an editable original block-form Goblin, its runtime GLB and a provenance report. Its 29 authored parts have 1,276 triangles; the purchased Goblin Shaman supplies the unchanged rig and ten animation clips. `rework/custom/nature/` contains 34 editable base/snow scenery prefabs, including two-tree variants. See [3D-CUSTOM-PROOF.md](../docs/3D-CUSTOM-PROOF.md) for the current review scope.

Use the installed Blender in Applications and export the saved sources:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --python-exit-code 1 --python assets-src/rework/pipeline/build_custom_goblin.py -- --export-existing
/Applications/Blender.app/Contents/MacOS/Blender -b --python-exit-code 1 --python assets-src/rework/pipeline/build_custom_nature.py -- --export-existing
```

The one-time Goblin `--build` and nature `--init` commands refuse existing files. Normal edits use `--export-existing`; do not regenerate over native edits. Custom models are enabled in the art-proof page only, pending review.

## Archived stages 1–2 rework

The pack-mesh adaptation/reduction route is paused. Its files are retained experiments with unresolved visual faceting, available in the proof page's archive. The current custom proof is described above.

The archived four character models are reduced and shape-refined actual pack meshes in `rework/refined/characters/`. Use the installed Blender in Applications. The [refinement record](../docs/3D-MODEL-REFINEMENT.md) documents measured reductions, source ancestry and preservation of all native animations. Edit those `.blend` files and export their current meshes with:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --python-exit-code 1 --python assets-src/rework/pipeline/refine_pack.py -- --asset goblin --export-existing
```

The one-time initializer refuses existing files. Original pack files, native rigs and the palette-only baseline are preserved. The remaining instructions in this section describe that earlier baseline and the unchanged archer structures.

Use `rework/proof/` for the new proof awaiting visual review: four actual pack character meshes with a palette-only adaptation, and seven individually authored roofless archer structures. The [bounded rework plan](../docs/3D-ART-REWORK.md) describes the review gate. The older builders and sources below remain historical working art; they are not the approved character/tier art pipeline.

Tower geometry is editable in `rework/proof/archers/archers.blend`. Export the edited source without regenerating it:

```sh
"$BLENDER" -b assets-src/rework/proof/archers/archers.blend --python assets-src/rework/pipeline/export_archer_proof.py
```

For `rework/proof/characters/*.blend`, edit the existing vertex color attribute, then export the current saved colors:

```sh
"$BLENDER" -b --python assets-src/rework/pipeline/adapt_pack.py -- --export-existing --asset goblin
```

Use `orc`, `troll`, `archer-crew` or `all` for the other proof characters. This character exporter supports color edits only and preserves original GLB geometry, weights, transforms and native clips. Geometry/rig edits require a verified Blender skin export workflow first: the ordinary Blender GLB roundtrip altered bind transforms during this proof. Do not run the older destructive character builder on these sources. The one-time initializer refuses existing files; `--force` intentionally discards those current native edits and is not the normal export command.

The review page and live-map proof load these same GLBs through `RuntimeModelRegistry`. Original purchased files are unchanged. No new runtime dependency is introduced by this rework.

`models/library/library.blend` is the editable static library of provisional parameter variants, not completed tier designs: 56 tower states, 25 hero variants, four keep and gate levels, terrain and nature samples, and small dressing/terrain kit parts. Each asset has its own root and asset-browser entry. Archer `base` and `aim-bowman` are separate so aiming never rotates the platform. Joined meshes retain vertex colors, a small bevel and source block metadata. They are local prefabs, not a whole-map export.

Each `models/<enemy>/<enemy>.blend` contains editable working character geometry and named clips. These sources were generated/exported with Blender scripts rather than a manual character art pass. The eight humanoid models use new coarse voxel bodies/gear on the purchased goblin rig/animations; they are derivatives, not eight different purchased characters. Goblin geometry dropped from 2,846 to 1,540 triangles. Bat and siege wagon are original animated models. Sources and license details are in `CREDITS.md`.

The seeded generator continues to assemble terrain and place props. Small surface steps, intermediate edge ledges, three nature variants and restrained instance scale/shape variation provide natural unevenness. Gameplay heights remain integers 0–4. The shared visual height sampler anchors objects and moving enemies without changing the map, pathing, range bonuses or gameplay RNG. Empty-tile dressing remains cosmetic and is removed when built over.

## Rebuild generated starting models

Use Blender 4.5 LTS. No Blender Python packages or new game runtime dependencies are needed. From the repository root, with `BLENDER` set to the executable:

```sh
"$BLENDER" -b --factory-startup --python assets-src/pipeline/build_content.py
"$BLENDER" -b --factory-startup --python assets-src/pipeline/build_characters.py -- all
"$BLENDER" -b --factory-startup --python assets-src/pipeline/build_misc.py
python3 tests/assets/test_gltf_tools.py
```

The content builder reads `content-manifest.json`; its TypeScript exporter and manifest are checked together. The ten extra modular/dressing assets are added by the Blender builder. Build reports include geometry/export metrics and provenance. Humanoid exports prune default animation tracks and preserve the source's ten clip names and durations. The original `blocky-pack/` and editor study are retained unchanged.

## Edit and export native sources

Edit a `.blend` directly for a deliberate model overhaul. Use this route afterwards so rebuilding the generated starting mesh does not overwrite the hand edits:

```sh
"$BLENDER" -b assets-src/models/goblin/goblin.blend --python assets-src/pipeline/export_blend.py -- assets-src/models/goblin/goblin.glb assets-src/studies/goblin-shaman/editor-preview.glb
"$BLENDER" -b assets-src/models/library/library.blend --python assets-src/pipeline/export_blend.py -- assets-src/models/library/library.glb
```

Keep root `asset_id` metadata, component names/pivots, vertex colors and clip names. Static roots use scene units, Y-up after glTF export, local origin at the footprint. Blender uses Z-up internally. Runtime characters normalize to 1.02 units before per-species scaling. Material roughness is high with no texture dependency. Run asset tests, build, and inspect on the real map after edits. A generated `.export.json` records the edited source and export hashes.

Three.js loads only the runtime GLBs through Vite-resolved URLs. Shared static geometry has a single library owner; mutable fade/ghost materials are copied. Enemies use sampled pose textures and instanced bodies with sparse tower silhouettes. Preview uses an owned conventional skinned copy for a close inspection; the live crowd uses the same exported model and animations.
