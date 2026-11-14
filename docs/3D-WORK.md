# Non-UI 3D implementation status

The current bounded rework is documented in [3D-ART-REWORK.md](3D-ART-REWORK.md). Only stages 1–2 are approved: source-preserving pack adaptations, a shared asset path and seven distinct roofless archer designs for visual review. The older technical coverage below is historical implementation evidence, not acceptance of its art.

Correction after user review on 2026-11-13: the earlier completion summary overstated the art work. The 56 tower states are parameterized variants, not finished tier designs. The eight humanoid enemy meshes share the purchased goblin rig; the pack's distinct character models were not integrated.

The user delegated the remaining non-UI work on 2026-11-13. Accepted choices remain southeast/35.3-degree orthographic camera, zoom-only interaction, crisp-neutral light, roofless archer and visibility behavior. New model designs and tuning are working choices for review, not final user preferences. UI redesign and mobile acceptance remain deferred.

- [x] Opaque, unlit blue/green range tiles; current and hover/focus upgrade coverage use real stats.
- [x] Reproducible Blender builders, editable native sources, edited-source export path and license/provenance records.
- [x] Coarse goblin replacement geometry (2,846 → 1,540 triangles), retained rig and ten clip names/durations.
- [x] Technical ID coverage: ten enemy IDs, 56 parameterized tower states, hero/keep/gate variants, nature and terrain sources. This does not establish finished or meaningfully distinct art.
- [x] Seeded visual surface unevenness, supported intermediate ledges and restrained prop size/shape variation; integer gameplay heights and RNG unchanged.
- [x] GPU pose-baked enemy batches, sparse structure silhouettes, batched health/shields/shadows and bounded typed combat effects. Removed unused legacy effect proxy objects.
- [x] Persisted camera preset infrastructure and all-16-preset framing/zoom/picking tests on all maps; settings presentation deferred.
- [x] Explicit shared resource ownership, fresh-canvas backend switching, fallback, input rebinding, pending-load disposal and recovery tests without run/profile mutation.
- [x] Repeat production desktop benchmarks at every entity cap, with CPU/frame/resource/prepare/first-draw results, raw exports and RAF-only control; see `3D-BENCHMARK.md`.
- [x] Final lint, 297 tests/42 files, seven Python tests, TypeScript/build, real GLB bounds/animation checks, live desktop checks, 2D baseline and `/gloamward/` asset loading.

## Still open

- Use and individually adapt the appropriate purchased character meshes; eight goblin-rig reskins do not fulfill that art plan.
- Design readable tower tier/fork progression with meaningful model changes rather than small parameter/badge variations.

- Final user art review and deliberate Blender refinements toward the supplied reference.
- Menus, tooltips, HUD, onboarding and build/upgrade redesign; visible camera/backend settings.
- Mobile layout/touch/browser acceptance during that UI work.
- Agreed target-device quality/download/memory budgets, real-browser recovery and 60 fps acceptance. This in-app browser paced even a no-draw RAF control at about 30 fps; measured CPU work does not certify GPU or total frame time. Initial shader/scene warmup also needs a suitable UI flow.

No balance, targeting, pathing or simulation timing changes were made for rendering. Original purchased assets and the default 2D fallback remain. No deployment or commit was requested or performed.

## Preview corrections after review

The comparison study had a skeleton-initialization bug that normalized the goblin from bounds about 100 times too small. Bounds are now refreshed after initializing the complete skeleton hierarchy; the regression test measures actual skinned vertices across the walk clip. The study also had a separate legacy tower generator, including old archer roofs; it now uses the current shared tower/hero builders for every state. These are rendering/consistency fixes, not completion of the missing art pass.
