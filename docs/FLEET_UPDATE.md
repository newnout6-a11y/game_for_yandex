# Blender traffic fleet and landscape clarity

## Delivered scope

Eight independently proportioned original traffic vehicles are loaded from Blender-exported GLBs. The previous sedan, hatchback, SUV and van have all been replaced; rigid freight, an articulated semi, recovery and fire apparatus are new. All eight editable Blender projects and their reproducible authoring scripts are included in the source distribution.

| ID | Category | Nominal collision envelope, L × W × H (m) | Axles |
|---|---|---:|---:|
| sedan | Passenger | 4.65 × 1.94 × 1.46 | 2 |
| hatch | Passenger | 4.08 × 1.86 × 1.52 | 2 |
| suv | Passenger | 4.82 × 2.04 × 1.88 | 2 |
| van | Light commercial | 5.62 × 2.18 × 2.58 | 2 |
| boxtruck | Freight | 8.20 × 2.48 × 3.48 | 2 |
| semi | Freight | 16.40 × 2.50 × 3.98 | 5 |
| towtruck | Special equipment | 7.25 × 2.40 × 2.82 | 2 |
| firetruck | Special equipment | 8.60 × 2.50 × 3.32 | 3 |

The dimensions are conservative gameplay envelopes, not specifications of real manufacturers. Small trim tolerances and a vertical collision margin remain deliberate. Models are original game art, not licensed CAD or exact replicas.

## Architecture and future activities

- `src/traffic-catalog.js` is immutable, rendering-independent data: stable ID, category, tags, dimensions, axle count, cruising range and spawn weighting. It is the extension point for future activities.
- `src/traffic-physics.js` implements physical-size headway and oriented XZ collision boxes, plus separate tractor/trailer parts. Roll changes the player's projected width and lowest point.
- `src/traffic.js` clones loaded GLB templates with shared geometry and isolated paint/brake materials. All wheel pivots are discovered, including ten on the semi. The trailer rotates at its real hitch node.
- `src/assets.js` loads all eight `public/assets/traffic/{id}.glb` files before enabling play. A missing asset gives the existing loading error; it does not silently substitute a procedural model.
- `art/traffic/{id}.blend` and `scripts/create_traffic_{passenger,heavy,special}.py` contain editable meshes, Blender-authored refinements, materials and export operations. The JavaScript builders supply initial authored surfaces only and are not runtime visual generation.

No new missions, emergency rules, towing actions, cargo tasks or rewards were added. Existing roadworks/checkpoint/convoy behavior remains; the catalog and equipment anchors prepare for later design.

## Collision and traffic behavior

Spacing is bumper-to-bumper using each vehicle's full length. Spawns reject overlapping envelopes and reserve an actually clear lane through the wave, including existing long vehicles. Following drivers slow behind their leader and stop behind the player. An overtake completes only after the whole vehicle is behind.

At 3.3m hover, the player can clear low passenger vehicles and the van when level, but not the tall box truck, semi or fire apparatus. A barrel roll lowers a corner of the player body, so clearance is checked again using its rolled envelope. This initial fleet release used bounded road-following trailer rotation. The subsequent kingpin/rear-bogie kinematic implementation is described in DRIVERS_TRAILER_UPDATE.md. Collision remains conservative and arcade-oriented, not full rigid-body or tire-force simulation.

## Clarity and rendering

The previous native-resolution screenshots had crisp road lines and no global blur filter. The visible softness primarily came from overly pale baked mountain colors and foliage. This pass restores near/middle ridge definition and leaf contrast while retaining distant atmosphere. A shared original 256×256 mip-filtered grayscale stone tile adds restrained surface definition to ridges and rocks, with weaker detail under snow and haze. It adds one texture (about 341 KiB RGBA including mipmaps), one color sample on those surfaces, and no extra scene pass or geometry. The accepted lake, sky shape, player model, daylight setup, smoke atlas, flight controls and landing mechanics are preserved.

Aspect-correct rendering, MSAA, alpha-to-coverage foliage, trilinear mipmaps, anisotropy and existing pixel budgets remain. Large screens can still be downsampled by the protective pixel budget; this update does not claim native 4K or removal of all temporal shimmer. Browser screenshots and controlled-time captures are not measurements of real-device FPS.

## Reproduce

1. `npm ci`, `npm test`, `npm run check`, `npm run build`.
2. `npm run dev` for normal play.
3. `blender --background --python scripts/create_traffic_passenger.py`, then the corresponding heavy/special scripts, to regenerate editable projects and GLBs. Blender 4.3.2 and Node were used for these exports.
4. `node scripts/fleet-gallery.mjs after` captures individually fitted GLB inspection views. These cameras are QA views, not a new selectable gameplay mode.
5. `node scripts/render-benchmark.mjs fleet-after` captures the matched three-vehicle scene; `FLEET_SHOWCASE=1` captures the eight-vehicle composition separately.

This section records the original local fleet release. The later cumulative source is available in PR #1 (https://github.com/newnout6-a11y/game_for_yandex/pull/1), on a separate branch; main has not been merged. Real mobile GPU performance, Yandex moderation and production hosting are not certified by these tests.

## Validation result

- All 114 automated tests passed after integration, including the actual decoded GLBs, editable Blender source headers, finite normals, wheel pivots, shared instance geometry, articulated trailer, size-dependent collision and safe spawning.
- Source/import/HTML/CSS validation passed: 26 JavaScript modules, zero errors.
- Matched desktop and mobile captures use real production drawing-buffer sizes and reset Three.js counters before the complete render, including shadows. Controlled-clock timing fields are intentionally null; no hardware FPS claim is made.
- The eight-vehicle showcase is a separate composition and must not be compared to the three-vehicle baseline as an optimization measurement.

Final matched three-vehicle render counters (desktop and mobile): 208 submitted draws before and after; 249,782→264,150 submitted triangles (+5.75% from the refined Blender vehicles), 18→19 allocated textures. The new shared stone tile accounts for one small texture; terrain/background geometry and instance placements are unchanged. Desktop buffer remains 1440×900; mobile 390×844 at DPR 2 renders 585×1266, as before. Counters include shadow submissions, not frame rate.

The final built dist directory was loaded and captured in Chromium for both profiles without page/shader errors or horizontal overflow. The scene was scripted at 125 m for repeatability, not recorded as an uncontrolled live drive. Full before/after and fleet counters are in docs/fleet-metrics/.
