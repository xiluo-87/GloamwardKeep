# Source-model reduction and shape refinement

**Checkpoint status:** this pack-mesh experiment is paused. Measured triangle savings and exact animation retention do not establish visual acceptance: the current candidates still show unwanted faceting and do not match the reference style. The next direction is a custom Goblin proof; see [3D-ART-REWORK.md](3D-ART-REWORK.md). Preserve these files for comparison, not as finished art.

On 2026-11-14 the user authorized polygon reduction and shape refinement of the four current pack characters, with their original animations intact and the first voxel artwork as the reference. The user installed Blender in Applications; use `/Applications/Blender.app/Contents/MacOS/Blender` (verified 5.3.0), not the portable copy.

## Actual geometry changes

| Actual pack model | Original triangles | Refined triangles | Reduction |
| --- | ---: | ---: | ---: |
| Selected Goblin editor export | 2,846 | 2,679 | 5.87% |
| Orc | 3,586 | 3,193 | 10.96% |
| Hill Troll | 3,548 | 3,522 | 0.73% |
| Hood Archer crew | 1,316 | 1,184 | 10.03% |

These are edits to the purchased meshes, not generic replacement characters. The original files and the earlier palette-only proof are preserved.

The refinement broadens the heads and torsos, thickens limb cross-sections and compresses the Goblin/Orc headgear and particularly the archer's tall hood. Skeleton joint positions and limb lengths are retained. The reference's restrained palette remains. These art choices are review candidates, not final user decisions. The Troll's polygon savings are negligible; this is a safe surface-cleanup candidate, not evidence of a substantial optimization for that model.

The rejected grid-snapping pass flattened separate layers onto the same planes, causing overlapping triangles and flicker. More aggressive collapse also damaged block corners. Neither is used in the current candidate. Proportions now change without snapping surface layers together. Coincident vertices are welded only within identical skin influences, and existing T-junctions are reconnected before constrained simplification. Boundary vertices, limb ends, eyes and equipment receive hard locks. Voxel corners receive extra protection on Goblin, Orc and Troll; Troll's head and the archer's thin hood/chest/gloves remain protected surfaces.

Reduction interpolated corner colors into artificial dark triangle patches. The pipeline now samples paint from the original shaped source surface instead, retaining its corner-color gradients with barycentric interpolation; flattening those gradients to a single color per triangle also caused visible patchwork. Hard normals remain explicit. Every exported vertex carries a source vertex index as its skin-influence representative and inherits that vertex's exact original joint/weight values; this does not claim the reduced vertex is at the original position. Degenerate triangles are omitted at export.

## Editable source and safe geometry export

Canonical native files: `assets-src/rework/refined/characters/{goblin,orc,troll,archer-crew}.blend`. Each has its own `.glb` and measured `.json` report. The shared registry now loads these refined GLBs for the comparison page and live-map proof, including actual tower crew.

Initialize once from the preserved palette/native sources:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --python-exit-code 1 --python assets-src/rework/pipeline/refine_pack.py -- --asset all
```

Initialization refuses an existing native file. After editing a saved native mesh, export its current geometry without rebuilding it:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --python-exit-code 1 --python assets-src/rework/pipeline/refine_pack.py -- --asset goblin --export-existing
```

Use `orc`, `troll`, `archer-crew` or `all` as appropriate. Preserve the `source_vertex` point attribute and skin assignments. This route supports editing the retained mesh points/surfaces; arbitrary new topology must retain valid source ancestry and matching skin assignments. Rig/animation/object-transform edits are rejected instead of being silently discarded.

Blender's full character GLB export previously altered bind transforms. The new exporter avoids that route: it verifies the entire source vertex mapping, converts mesh-local Blender coordinates back to the original GLB basis `(x,z,-y)/100`, and replaces only mesh accessors. It retains the original nodes, joint hierarchy, bind matrices and all ten animation channels/samplers. Unreferenced old geometry is pruned without optimizing or rebaking animation data.

Per-asset source/motion hashes are recorded before and after packing. Original native clip names, targets, interpolation, times and values are unchanged, including eye and bow/arrow scale animation.

## Acceptance

Automated validation checks source hashes, measured reductions, finite geometry, unit normals, positive-area triangles, source skin ancestry, exact skeleton/bind data, and exact native animation tracks. Animated bounds are compared to the corresponding source pose across all ten clips, including raised weapons and lying-down death poses. Native and crowd positions are also compared at actual Idle/Walk samples.

Run `npm test`, `npm run test:assets`, `npm run lint` and `npm run build`. The Python asset checks compare actual coplanar triangle intersections with the immutable source, globally and per bone, and reject newly introduced duplicate triangles. They catch the rejected grid-snapped candidates; smaller source overlaps are measured rather than concealed. Source animation hashes remain identical after export for all four models (40 native clips in total).

Visual acceptance remains separate: compare all four characters at southeast/35.3°, inspect eyes and joint seams in motion, the archer's bow/arrow and its fit on all seven tower structures, and sparse/crowded generated maps. Character models are ready only after these checks; final visual preference still belongs to the user.
