# Roadster update QA

## Automated checks

- `npm test`: 95/95 tests pass, including new Roadster structure, traffic geometry/pooling, following gaps, hover fuel/readiness, smooth ascent/descent, altitude-gated collision checks, landing cooldown, revive reset and keyboard/touch state.
- `npm run check`: 20 JavaScript modules, imports/exports, HTML assets and CSS token checks; 0 errors.
- `npm run build`: succeeds and creates the Yandex ZIP with index.html at the archive root.
- New artwork is tracked by SHA-256 in public/assets/manifest.json; references and attribution are in CREDITS.txt.
- Scenery finite-transform and terrain-periodicity checks pass across all routes and long-run distances.

## Visual validation

A Chromium software-WebGL smoke run covers desktop and mobile layouts, the loaded car/landscape, traffic and held-F flight. Initial review caught inverted open-sheet car normals and overly pale water; both were corrected before the final capture. Final captures are scripted scenarios with a controlled browser clock and explicit snapshot rendering, not real-time frame-rate measurements. Both keyboard and touch runs reached 3.3 m, consumed the shared reserve, and landed at 0 m with a cooldown. Neither layout showed horizontal overflow or runtime errors. Final capture results are written to output/playwright/visual-smoke.json.

## Scope and limitations

The full pre-existing WebKit/advertising visual suite was not rerun during this update. Existing SDK/ads/lifecycle unit tests pass, but that is not a live Yandex platform test. Browser emulation/software WebGL captures validate appearance and behavior, not frame rate on a real phone. Physical-device performance and real Yandex SDK/ad moderation remain release checks.

The car is an original reference-inspired game model, not a manufacturer CAD model. The brief hover system is deliberately arcade-balanced. The detailed interior exists in the Blender/GLB asset, but the playable camera remains an external chase camera.

No GitHub push or Yandex publication was performed.

## Rendering optimization follow-up

Aspect-correct production buffers, texture/shader filtering, instanced lane markings and cached scenery updates were checked in a matched before/after scene. Detailed measured results and limitations are in `docs/RENDERING_OPTIMIZATION.md`. The final touch test also rotates between portrait and landscape without overflow.

## Lake refinement

The lake now uses depth-based color, filtered wave normals and lightweight view-dependent reflections. Four added tests check water/terrain depth alignment, world coordinates and no unnecessary stationary geometry uploads. See `docs/LAKE_UPDATE.md`.

## Background refinement

Three added tests check complete horizon coverage, finite and bounded distant geometry, filtered sky texture setup, and stable background buffers across route changes and long drives. Matched desktop and mobile captures have no JavaScript or WebGL shader errors. The accepted lake implementation remains byte-identical. See `docs/BACKGROUND_UPDATE.md` for geometry cost, visual references and limitations.

## Roll and landing follow-up

Actual Q/E and independent touch roll inputs, smooth full-turn recovery, powered soft landing, finite landing energy reserve, truthful throttle/speed behavior and particle lifecycle are verified. Updated scene geometry and leaf transparency preserve batching; costs and limits are recorded in `docs/FLIGHT_REALISM_UPDATE.md`. Latest detailed browser results are in `docs/realism-metrics/flight-inputs.json`.

## Daylight, underside and vapor artwork follow-up

Screen-wide gameplay darkening was removed in favor of compact translucent HUD backing. Original-sky reflections and balanced key/fill lighting are checked together with the modeled underside and Blender-rendered vapor atlas. The atlas must report decoded before browser snapshots. Actual-control ground/hover/roll/descent/flare/landing and narrow mobile layouts are rechecked; no game physics or control changes are included. Cost, sources and editable artwork details are in `docs/LIGHTING_UNDERBODY_UPDATE.md`.


## Blender fleet continuation (2026-10-17)

All114 automated tests pass; source validation passes26 modules with0 errors. Eight final GLBs and eight editable Blender projects are present. All16 front/rear inspection views were rendered in the game renderer; the final build also passed matched desktop/mobile captures and an eight-vehicle scene. Read docs/FLEET_UPDATE.md for costs, size-aware collision and remaining limitations. No new activities or public deployment.
