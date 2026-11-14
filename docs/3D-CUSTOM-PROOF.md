# Custom Goblin and scenery proof

This is the current review candidate at `art-review.html`. The user's supplied voxel artwork remains the reference. Review this one character before expanding the roster; the older pack adaptation studies remain archived on the same page.

## Goblin

The new mesh is built from 29 authored block parts: a green head with stepped ears, simple brown clothing and boots, block limbs and a short sword. It has 1,276 triangles and 2,784 exported vertices. The mesh is original geometry; the purchased Goblin Shaman supplies the 72-joint rig and ten animation clips. Those motions are reused, not newly authored.

`assets-src/rework/custom/goblin/goblin.blend` is editable. Its companion JSON records parts, palette, bounds, triangle counts, source hashes and matching source/output rig and animation hashes. The exporter replaces geometry in the donor GLB's basis while retaining its hierarchy, inverse bind matrices and animation data. It does not depend on Blender re-exporting the rig correctly.

The proof compares conventional skinned playback with the same mesh's baked crowd rendering. Six motions are available in both paths: Idle, Walk, Run, Attack1, Hit and Death. All ten donor clips remain in the file. One-shot native playback now clamps at its terminal pose and can seek back to zero for restart. Animated map feet use the existing locomotion-floor correction.

## Scenery

There are 17 distinct base prefabs and a snow version of each, for 34 prefabs total:

| Family | Shapes |
| --- | --- |
| Trees | Broad pine, slender pine, tiered pine, twin pines, twin saplings |
| Rocks | Boulders, low slab, stepped pile, split boulder, scattered rocks |
| Bushes | Low, round, wide and tall clumps |
| Small stones | Pebbles, flat stones, twin stones |

Each prefab has one joined vertex-colored mesh, a ground-level origin, subtle bevels and named component groups in the native source. The block surface builder removes internal faces. Shapes use restrained green/bark/stone palettes. Tile/seed hashes select the shape, quarter-turn, small offset and modest width/height variation without consuming gameplay RNG. Snow variants are selected on height-4 tiles and their immediate hex neighbours.

Each snow-dusted tree keeps its tip cap plus one additional supported snow ring on the next exposed foliage tier, including both trees in paired prefabs. The other 29 scenery prefabs were unchanged by that correction. A geometry check verifies visible white snow below every tree's tip, so a tip-only export cannot pass unnoticed.

Large trees and rocks retain independent fade materials for mob visibility. Small bushes and stones are instanced by variant and disappear without effects when their tile is built over. The runtime can still fall back to the older assets when the custom library is absent.

## Inspection

The page separates studies, playback, card inspection, camera and map settings. Static scenery hides playback; the map offers pause/restart without an irrelevant motion selector. The roomier-layout explanation is closed by default behind **About this proof**.

On the real map, scroll zooms at the pointer. While zoomed, primary-pointer dragging pans without changing direction or tilt; **Fit map** restores the full view. This inspection control is limited to the proof page. The main game's player camera and deferred UI/mobile redesign are unchanged.

The real-map fixture uses the custom Goblin, seasonal scenery and existing seven roofless archer structures through the shared Three.js renderer. It is a scripted inspection fixture, not a combat simulation. Roomier scene proportions remain review values, not final art decisions.

## Edit and verify

Use the installed Blender in Applications. Export the saved native files without regenerating their starting geometry:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --python-exit-code 1 --python assets-src/rework/pipeline/build_custom_goblin.py -- --export-existing
/Applications/Blender.app/Contents/MacOS/Blender -b --python-exit-code 1 --python assets-src/rework/pipeline/build_custom_nature.py -- --export-existing
```

The Goblin's one-time `--build` and scenery's `--init` refuse existing output. Preserve native edits and use `--export-existing` for normal work.

Automated checks compare donor/output hierarchy, inverse binds and every animation track/time/value, test native/crowd pose agreement including Death's terminal frame and restart, check road grounding, load all 34 scenery assets, and verify snow selection, removable instancing and shared resource ownership. Browser review checks the actual custom character, scenery, contextual controls, zoom/pan and Fit. These checks establish a working review candidate; art acceptance and the remaining character/tower families still require review. No mobile acceptance is claimed.
