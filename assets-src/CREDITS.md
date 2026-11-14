# Art sources

## Current custom proof

`rework/custom/goblin/` contains original Gloamward block-form mesh geometry following the user's voxel reference: 29 parts, 1,276 triangles and a short sword. Its 72-joint rig and ten animations are reused unchanged from the purchased Blocky Characters Goblin Shaman study below. It is not an independently authored rig or animation library. Original purchased files and supplied license remain unchanged.

`rework/custom/nature/` contains 34 original Gloamward tree, rock, bush and small-stone prefabs, including snow and paired-tree variants, with editable Blender sources. No third-party nature geometry or textures are used. The custom proof was authored with the installed Blender 5.3; source/export instructions and review status are recorded in [3D-CUSTOM-PROOF.md](../docs/3D-CUSTOM-PROOF.md).

## Simplified goblin shaman study

- Creator: 3D Asset, [Blocky Characters](https://3d-asset.com/packs/blocky-characters/), purchased version 1.0.1.
- Source model: `tiny-characters-blocky-goblin-shaman`.
- Study export: `studies/goblin-shaman/editor-preview.glb`, with bone fan, chest skulls and pouch disabled in the publisher's browser editor. The rig and all ten animation clips are retained.
- Licence: 3D Asset Royalty-Free License; the supplied licence text is retained beside the study. Commercial game use and modification are permitted. The pack cannot be redistributed as an asset product.
- The original editor export is preserved as a source reference. The preview and live Three.js renderer now use the Blender adaptation in `models/goblin/`; the pack's optional React components and demo code are not runtime dependencies.
- The user approved this goblin as the sample's starting point. The preserved editor source has 2,846 triangles; the working Blender adaptation has 1,540 triangles. Final art approval remains open.

## Archer tower study

Original procedural model in `src/camera-preview/archer-tower.ts`, following the first concept artwork approved as the project's visual reference. The user selected the roofless, cross-braced timber platform to leave room for the archer to turn independently toward its firing target. The comparison preview stays scripted; the opt-in live slice turns the separate bowman toward simulation targets and renders actual shots. No castle-pack models are used. Its scale, colours and detail remain an art sample for review.

## Terrain and nature study

The terrain surface treatment and forest/rock voxel models are original procedural work in `src/camera-preview/terrain-look.ts`, `src/camera-preview/nature-models.ts` and `src/camera-preview/solid-voxels.ts`. Small cosmetic bushes and stones are original procedural models in `src/camera-preview/decorations.ts`, placed by the independent seed hash in `src/sim/decorations.ts`; no third-party terrain or vegetation assets are used. The palette, visible cube definition and varied bushes/rocks are approved as a prototype for review, not as a final art preference. The user separately selected Crisp neutral daylight as the only lighting style. Decoration does not change terrain heights, blocking features, routes or gameplay RNG.

## Blender working library and character adaptations

`models/library/` contains original Gloamward tower/hero/keep/gate/nature/terrain working models derived from the project's procedural designs, following the supplied artwork. `models/bat/` and `models/wagon/` are original voxel geometry and animation. No castle-pack assets are used.

The goblin, hexer, orc, stalker, troll, shaman, ogreking and lich in `models/` use newly authored coarse voxel replacement bodies/gear on the purchased Blocky Characters goblin rig and ten animations. They remain licensed derivatives under the supplied royalty-free license, including its restriction on redistribution as an asset product. The original pack and its license are unchanged. The adaptation is a working roster for review; it is not presented as an independently authored rig or animation library.

Blender 4.5.16 LTS produced the editable `.blend` sources and runtime `.glb` exports. Rebuild/edit instructions are in `README.md`; per-model `build.json` reports record geometry and export provenance. Terrain is still assembled procedurally, with independent seeded visual unevenness and prop variation.
