# Rendering clarity and performance update

## What changed

- The framebuffer now matches the viewport aspect. Desktop uses up to 1.6 million render pixels; compact/touch uses up to 0.8 million, with DPR capped at 1.5. It reallocates only when dimensions change. This removes the old square-to-wide/portrait resampling without an expensive fullscreen sharpen/blur pass.
- MSAA remains enabled. Masked pine edges use alpha-to-coverage only when the actual context provides MSAA. Trilinear mipmaps remain enabled; anisotropy is explicitly bounded by device support and capped at 8 desktop / 4 compact.
- Lake ripples now have derivative-based minification filtering, lower frequency/contrast and no sparkling highlight. Road normal strength is reduced; noisy shoulder/terrain normal maps and unnecessary roughness maps are not loaded or sampled. Large asphalt cracks and road texture remain deliberately visible; this is not a claim that all temporal shimmer is eliminated.
- All 118 lane markings share one instanced batch. Conservative road bounds and bend coefficients are cached. Landscape uses cached periodic height coefficients and smooth normals, cached instance heights/rotations and direct matrix updates rather than repeated geometry-normal rebuilds.
- The drawing buffer no longer requests preservation. Settled paused scenes stop issuing duplicate scene draws; resize/route changes still redraw. The detailed car, traffic, shadows, roads and scenery population are retained.

## Reproducible matched-scene comparison

Chromium with SwiftShader, distance 125 m, same camera, three traffic cars, lighting and viewport. These are scripted scenes with the actual production render size, not an artificially reduced screenshot buffer. Full draw counters include shadow submissions: `renderer.info.autoReset=false`, reset immediately before the complete render.

| Metric | Before | After |
|---|---:|---:|
| Desktop viewport / DPR | 1440×900 / 1 | unchanged |
| Desktop framebuffer | 1280×1280 | 1440×900 |
| Desktop render pixels | 1,638,400 | 1,296,000 (−20.9%) |
| Touch viewport / DPR | 390×844 / 2 | unchanged |
| Touch framebuffer | 929×929 | 585×1266 |
| Touch render pixels | 863,041 | 740,610 (−14.2%) |
| Full submitted draws, including shadows | 313 | 204 (−34.8%) |
| Full submitted triangles, including shadows | 201,090 | 201,106 |
| Resident renderer texture objects | 21 | 17 |
| Desktop CPU scene-update median | 0.703 ms | 0.225 ms |
| Emulated-touch CPU scene-update median | 0.795 ms | 0.163 ms |

The 16 extra submitted triangles are out-of-view lane dashes in the single batch, not additional visible scenery. Four omitted 1024² texture requests remove 2,616,192 source bytes (about 2.50 MiB) from runtime loading; original files remain in the source/build archive for provenance.

CPU samples are five batches of 60 scene updates, excluding WebGL rendering. They are a local diagnostic, not a guarantee on another device. Raw arrays and context flags are in `docs/optimization-metrics/`. Render-submission timing includes a `gl.finish()` call but is not a GPU timer query. It was noisy; the emulated-mobile submission sample did not improve. Therefore this report makes no hardware FPS/GPU throughput claim.

## Verification

- 67/67 unit tests pass; 18 JavaScript modules/imports/assets/styles check clean; production build succeeds.
- Real keyboard and touch handlers still support 3.3 m flight, shared-energy consumption, descent to 0 m and cooldown.
- Portrait touch framebuffer 585×1266 rotates to 1266×585. No horizontal overflow or runtime errors in the tested Chromium scenes.
- A 24-frame controlled-time movement sequence is available in the QA output. It is not real-time gameplay/frame-rate footage. Still images alone cannot establish absence of temporal shimmer.
- The landscape has the same geometry/population and has finite/periodic transforms, normalized normals and equivalent cached positions checked separately.

Run `npm test`, `npm run check`, `npm run build`, `npm run test:roadster`, and `npm run test:render`. For an older revision, set `BENCHMARK_ROOT=/path/to/old/game` and run `node scripts/render-benchmark.mjs before`. `CHROME_BIN` selects Chromium and `SOFTWARE_WEBGL=1` selects SwiftShader; a normal GPU-capable browser is preferable for real performance work. `CAPTURE_MOTION=1 node scripts/render-benchmark.mjs motion` captures the controlled sequence.

Real phone GPUs, Safari/WebKit and live Yandex SDK/advertising remain release checks. No GitHub push or Yandex publication was performed.

## Technical references

- Three.js responsive drawing buffers and bounded pixel budgets: https://threejs.org/manual/pages/responsive.html
- Three.js MSAA alpha-to-coverage: https://threejs.org/docs/pages/Material.html#alphaToCoverage

## Later lake refinement

The comparison above records the optimization revision. The subsequent lake update retains its pixel budgets, 204 submitted draws, adding 2,080 water triangles, one small procedural normal texture (18 total) and a richer single-pass shader. Current lake measurements and visual method are in `docs/LAKE_UPDATE.md`; the current full suite has 71 tests.
