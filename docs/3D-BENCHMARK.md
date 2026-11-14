# Desktop 3D measurements — 2026-11-13

Follow-up correction after user review: these measurements establish technical coverage only. The eight humanoids share one purchased goblin rig with replacement meshes; the distinct pack characters were not integrated. Tower state variants are parameterized blocks/details, not finished upgrade designs. A scale-normalization defect in the separate camera study was subsequently found and fixed, along with its duplicate legacy tower generator. The earlier completion summary overstated art readiness.

These are measurements of the working non-UI implementation, not final device or art acceptance. The production build was served locally under `/gloamward/`. All assets reported ready; browser logs contained no warnings or errors during the final benchmark and live-map checks.

## Conditions

- In-app Chromium 157, ANGLE Metal on Apple M4 Pro; 14 reported hardware threads.
- 1280 × 720 CSS viewport, pixel ratio 2 (2560 × 1440 drawing buffer), crisp-neutral lighting with cached 2048² static shadows.
- Three.js 0.187.0, production bundle `renderer-ENBYTihp.js`; 3-second warmup followed by 10-second samples. Local warm-cache preparation includes GLB parsing and pose baking; it is not an internet download measurement.
- Full scenes use 600 animated enemies, 400 projectiles, 160 hawks, 80 burn pools and 80 legal tower placements. Movement is scripted test infrastructure; no player profile or real combat simulation is advanced by the harness.
- Two dispose/recreate cycles per full scene. The empty-map control still includes terrain/nature. The RAF-only control skips all steady-state drawing after the first frame.

## Results

| Scene / cycle | CPU draw mean / p95 / p99 ms | RAF mean ms | Calls | Triangles | Geometry / textures / programs | Prepare / first draw ms |
|---|---:|---:|---:|---:|---:|---:|
| Meadow 0, mixed, SE / 35.3° / 1 | 9.77 / 10.10 / 10.40 | 33.33 | 237 | 2,189,574 | 103 / 23 / 15 | 752 / 188 |
| Meadow 0, mixed, SE / 35.3° / 2 | 9.78 / 10.20 / 10.70 | 33.33 | 237 | 2,189,574 | 103 / 23 / 15 | 1018 / 152 |
| Canyon 5, goblins, NE / 55° / 1 | 10.70 / 15.10 / 16.60 | 33.33 | 282 | 2,077,150 | 104 / 23 / 15 | 701 / 157 |
| Canyon 5, goblins, NE / 55° / 2 | 10.32 / 10.60 / 10.80 | 33.33 | 282 | 2,077,150 | 104 / 23 / 15 | 964 / 146 |
| Empty Meadow 0 / 1 | 5.07 / 6.10 / 6.80 | 33.33 | 115 | 812,622 | 55 / 23 / 15 | 721 / 139 |
| RAF-only control / 1 | 0.00 / 0.00 / 0.00 | 33.34 | 172 | 854,596 | 55 / 23 / 15 | 736 / 138 |

RAF-only diagnostic call/triangle counts describe its initial frame; they are not repeated work during its skipped-draw sample.

The full scenes averaged about 10 ms of CPU draw work. The RAF-only control also ran near 33.3 ms per frame with zero measured drawing work, establishing a roughly 30 Hz pacing limit in this browser session. The measurements therefore do **not** certify the 60 fps target. CPU submission time alone does not measure GPU execution. The Canyon first cycle had a 15.1 ms CPU p95 and 16.6 ms p99; retain those outliers when evaluating headroom.

First draw cost was roughly 146–188 ms for the full scenes, separate from steady state. Shader/static-shadow preparation and scene construction need a suitable loading/warmup flow during the UI pass. No GPU timer, global GPU memory or JS heap trace was captured.

Within each scene, reported geometry/texture/program counts were identical after recreation. This checks renderer resource stability in those cycles; it is not a process-wide memory-leak proof. Logical pose texture payload is 74,711,040 bytes per renderer; upload arrays also remain on the CPU. This excludes other geometry, framebuffers, shadow maps, source GLBs and browser overhead.

## Asset and functional checks

- Runtime GLBs: 12,802,136 bytes total; local gzip estimate 2,260,645 bytes. Actual transfer depends on hosting. Static library: 7,017,184 bytes. No external CDN/decoder requests are required.
- Ten enemy models have finite geometry, normalized skin weights where applicable and required named clips. Humanoid names/durations match the retained original ten clips. Goblin is 1,540 triangles, compared with 2,846 in the preserved editor source.
- Real GLTFLoader checks cover all 110 static IDs and source bounds for the 100 canonical assets, including upright archer aim/base components. Native goblin and static-library edited-source exports were also exercised through Blender.
- Automated framing/picking covers all 16 direction/tilt combinations on all three maps. Live desktop checks cover upright models, aiming, raised-tower picking, opaque current/upgrade colors, combat and loaded assets under `/gloamward/`. The 2D title path also loads cleanly.
- Renderer switching/startup failure, failed scene preparation, overlapping transitions, pending-load disposal, input rebinding and context-loss/restoration notifications are covered by automated lifecycle tests without run/profile mutation.
- Final checks: ESLint passes; 296 Vitest tests in 42 files pass, including deterministic/headless full runs on all maps; TypeScript and Vite production build pass. Seven Python GLB-processing tests pass.
- Phone layout, touch and mobile browser checks were deliberately deferred by the user to the UI redesign. Real target-browser recovery and 60 fps acceptance remain open.

## Reproduce

Run `npm run build`, serve the output under `/gloamward/`, and open `render-benchmark.html?duration=10&cycles=2`. Select the map/camera and crowd type, then Run sample. The control URL adds `rafOnly=1&enemies=0&projectiles=0&pets=0&pools=0&towers=0&cycles=1`. Record the actual browser/device and drawing resolution. Use the JSON exports for exact per-cycle distributions and conditions.

## Raw results

- [mixed](benchmarks/render-benchmark-mixed.json)
- [canyon](benchmarks/render-benchmark-canyon.json)
- [empty](benchmarks/render-benchmark-empty.json)
- [raf-control](benchmarks/render-benchmark-raf-control.json)
