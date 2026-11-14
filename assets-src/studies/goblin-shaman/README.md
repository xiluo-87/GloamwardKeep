> Historical editor source. Current preview/live rendering uses `models/goblin/goblin.glb`, built with Blender; see `assets-src/README.md`. The original source below is retained unchanged.

# Goblin shaman editor study

Temporary visual sample for the real-map camera preview, not approved final production art. The user approved this simplified goblin as a starting point for the sample beside the custom archer tower.

- Source: purchased Blocky Characters 1.0.1 by 3D Asset.
- Editor: https://3d-asset.com/editor/?pack=blocky-characters
- Model: Blocky Goblin Shaman.
- Changes from defaults: Bone fan off, Chest skulls off, Pouch off. All colours, proportions and the staff remain at their defaults.
- The editor was displaying Walk when exported. The GLB still contains the skin and all ten animation clips; their track counts and durations match the original DCC model.
- Export: one material, 2,846 triangles and 72 skin joints. This is an uncompressed editor export, not a production size/performance result. The user wants later Blender simplification of the goblin's visual detail and geometry; the exact edits and complexity budget are not selected.
- The original purchased files in blocky-pack/ are unchanged. See this study's `LICENSE.txt` and `blocky-pack/LICENSE.txt` for the asset licence; credits are also recorded in `assets-src/CREDITS.md`.
- The preview loads `editor-preview.glb` directly through a Vite-resolved URL, so the configured deployment base path is respected. It imports only this study asset, not the full pack or its React demo.
- The preview uses the GLB's Walk animation and an imported skinned silhouette behind opaque towers. This is a visual starting point, not live-game integration or a crowd-performance result.

The custom archer sample follows the first concept artwork with timber cross-braces, a roofless open platform and an original bowman. The user chose the roofless platform so the archer can later turn independently toward its firing target; target-facing animation is not implemented in the preview. The goblin is an approved starting point that still needs later simplification, not final art. Final proportions, palette, complexity budget, lighting, UI and other production art decisions remain open.
