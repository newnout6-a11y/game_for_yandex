# Roadster Rocket: reference-driven reconstruction

This revision targets the **single-seat flying Rocket** selected by the user. It
is not manufacturer CAD and does not claim dimensional or flight-controller
identity. The source evidence, known gaps and acceptance checklist are in
[ROADSTER_ROCKET_PLAN.md](ROADSTER_ROCKET_PLAN.md).

## What is actually built

- Editable Blender body panels, shallow canopy, inset optical headlamp covers,
  continuous rear lamp, recessed four-fan assembly, nozzle lips/throats and
  reference-led underfloor/suspension components. They are real meshes, not
  photographs placed over the previous car.
- One sculpted bucket seat, closed cabin floor/firewall, door trim, rectangular
  yoke, console, pedals and roof liner. Original leather, perforation, suede,
  carbon, indirect-red-light and screen maps are embedded in the GLB.
- Separate tire/disc spin carriers, fixed calipers and a steering yoke. Wheel
  rotation uses the exported measured radius and accumulated travel; it no longer
  uses the old hard-coded radius or tilts the steering axis with wheel spin.
- A reconstructed telescopic rear wing with blade pitch and folding end panels.
  Its pieces physically move into the deck pocket; there is no scale-to-zero or
  visibility trick. The fan blades rotate independently of their shrouds.
- Pooled, world-space cold-gas effects aligned to the actual exported nozzle
  positions, directions and aperture sizes. Lift, roll correction, descent and
  rear boost use distinct emission conditions. The accepted Blender smoke atlas
  is retained; the effect still uses one capped instanced batch.
- Authored paint, glazing, carbon and upholstery survive loading. Opaque console
  glass is not converted into a transparent window. Embedded textures use the
  existing bounded anisotropy settings, not a global resolution increase.
- One-time player normalization uses actual transformed vertices. Rotated merged
  wing hardware cannot inflate an approximate bounding box and inadvertently
  shrink or lift the whole car. A synthetic rotated-hardware regression covers
  that failure independently of the current asset.

The source is `art/roadster.blend`; reproducible authoring is
`scripts/create_roadster.py`, `scripts/roadster_geometry.py` and
`scripts/roadster_cabin.py`. Original cabin PNGs are in `art/textures/`.
All eight accepted traffic models, their drivers, the landscape and smoke atlas
are preserved. Only the player's necessary geometry envelope is shared with
collision and lane-reservation code.

## Animation versus engineering evidence

Tesla's public page identifies Rocket as a one-seat, air-ready configuration and
states that it is not approved for public-road use. The same page's published
performance specification footnote applies to Thrust, not automatically Rocket.
Public stills establish the visible shapes and raised/stowed wing endpoints;
the event discusses variable-pitch aero, suction hardware and compressed-air
propulsion. No factory model or complete Rocket packaging drawing was available.

Hagerty's own verified-channel interview description separately identifies a
200-L reservoir behind the Thrust seats and an additional 400-L vessel in the
Rocket passenger-seat space. This is direct publisher-description evidence,
not an available spoken transcript. The new passenger-space vessel is an
approximate visual reconstruction of that packaging, not verified factory shape,
orientation, pressure-vessel construction or mounting design.
Its measured outer mesh volume is recorded separately from the nominal source
capacity; the model is not a validated pressure-vessel or packaging design.

The model currently represents eight visible lift/rear outlets. Tesla's event
describes ten in total; the additional side-associated pair is not positioned
from guessed coordinates. The visible outlet reconstruction is explicitly
partial, not a claim that all factory thruster hardware has been reproduced.

The working 4.7 m length is a game scale. The shared 4.7 × 2.3 × 1.35 m collision
allowance encloses the measured model through tested steering/wing poses; it is
not a claim about Tesla's dimensions. Seat placement, hidden structure, wing
linkage and omitted-seat packaging remain reconstruction decisions. The screen
art is illustrative, not an exact factory interface or live speed telemetry.

The existing 3.3 m hover, paid roll, landing reserve and cooldown remain arcade
mechanics. Fan speed, wing thresholds and deployment timing are visual game
rules, not measured Tesla RPM or control software. No orange combustion flame
or unlimited flight capability is implied.

## Cost and bounded detail

The earlier player had 41,744 triangles, 27 mesh groups and a 1,365,540-byte GLB.
The fidelity revision deliberately spends more on the single nearby player.
Regression ceilings are 300,000 source triangles, 80 mesh groups, 8 MB transferred
GLB and 12 embedded source images. These replace the previous simplified-car
budget; they are not an FPS guarantee or a claim that the extra detail is free.

The cabin currently contains eight original PNG images and nine glTF texture
entries, including two references to the same screen image. Actual renderer
inspection finds eight unique Three.js texture objects after loader reuse.
Their pixels are approximately 5.01 MiB as RGBA8 plus full mip chains; this is
a format-based estimate, not measured GPU memory. Driver allocation, alignment
and compression are implementation-dependent. The
unchanged smoke atlas and scenery textures are additional existing resources.

A matched pre-revision gameplay fixture contains three traffic vehicles. Its
complete frame submits 253 draws and 358,814 triangles including shadows on both
desktop and mobile. Final matched revision measurements belong in the release
verification section below, not in a hardware-FPS estimate.

## Reproducible checks

- `npm test` and `npm run check` cover runtime contracts and regressions.
- `node --test tests/roadster-geometry.test.mjs tests/player-envelope.test.mjs`
  inspects the actual exported buffers and runtime transforms. It checks finite
  unit normals, nondegenerate triangles, painted-face duplicates, outward visible
  surfaces, real cabin closures, nozzle apertures and sampled wheel/wing clearance.
- Wheel tests cover 112 actual tire/rim poses against opaque chassis batches.
  Wing checks sample staged deployment, pocket/sleeve clearance and end-panel
  self-clearance. Ray probes include 108 occupant-to-wheel sightlines, real floor
  and wall probes, nose closure, lamp visibility and each nozzle's core/lip/throat.
- Narrow-phase intersection checks use actual indexed triangles, not overlapping
  bounding boxes as a verdict. Negative controls check that distinction. These
  finite samples are **not** a continuous swept-volume certification; coplanar,
  endpoint-only and fully-contained-solid cases have explicit limitations.
- `node scripts/roadster-fidelity-gallery.mjs after` captures fixed actual Three.js
  views. Set `ROADSTER_AUTHORED_PAINT=1` to retain the authored white finish.
  The `driver` view is a separate cockpit inspection camera; the old passenger
  camera is not a suitable viewpoint once that space contains the Rocket vessel.
- `npm run test:flight` checks real keyboard/touch hover, roll and landing.
  `CAPTURE_ROCKET_BOOST=1` also checks rear boost emission from real input.
- `node scripts/record-rocket-showcase.mjs` records a 12-second, 30-sample/s
  controlled-time sequence; `ROCKET_VIDEO_PROBE=1` saves only key frames first.
  A safe initial traffic/fuel fixture is disclosed. Subsequent W/F/E/Space events
  drive the real simulation. Inspection cameras are labelled in the frames.

Browser scripts use the installed Chrome channel, or an explicit `CHROME_BIN`.
`SOFTWARE_WEBGL=1` opts into software rendering for reproducibility. A nominal
30 fps file encodes sample timing, not measured desktop or mobile throughput.

To regenerate in Blender, run:

```sh
blender --background --threads 4 --python-exit-code 1 --python scripts/create_roadster.py
```

The generator saves the editable source and exports the GLB before optional
studio previews. `ROADSTER_VIEWS` selects preview names; preview cutaways are
explicit inspection images, never substitutes for the complete runtime model.

## Primary reference links

- [Tesla Roadster](https://www.tesla.com/roadster)
- [Tesla: Roadster Event](https://www.youtube.com/watch?v=qt5p-_tE8d0)
- [Tesla: The Kickflip](https://www.youtube.com/watch?v=r5vsHHPVhJg)
- [Hagerty: the engineering interview](https://www.youtube.com/watch?v=22rvpUecLts)

Official images are inspection evidence only and are not redistributed as game
artwork. Unknown details are not promoted to factory facts simply because they
were modeled with more polygons.

## Release verification

Accepted asset SHA-256:
`9c710df7a868ce6729ffac6696a05dd3361e99a193d3a2130189b46168665d4e`.
The exported player has **242,993 source triangles, 66 mesh groups and
6,505,056 bytes**. Its editable Blender source is 14,007,172 bytes, SHA-256
`09259de2b6d3423311a9915db10e52d674b7aa1d5752a42e814824be56c664d0`.
The 2,009 sampled wing/steering/spin combinations enclose a
4.700 × 2.2707 × 1.2521 m model within the conservative shared player bounds.

Final checks on 2026-10-17:

- **216/216 tests passed**, with no skipped tests. This includes 25 dedicated
  geometry, animation and player-envelope tests.
- Source check: **30 JavaScript files, 0 errors**. Nine Python source/test files
  parse successfully; all three new/revised Roadster authoring modules are
  documented. `git diff --check` is clean.
- Build: **65 files**, with the local Three.js renderer bundle. No remote CDN is
  needed for the new player model or its material maps.
- Actual desktop keyboard and mobile touch sequences passed lift to 3.3 m,
  lateral roll, powered descent/flare, landing and rear boost. The final desktop
  1280 × 720 and mobile 390 × 844 captures use the accepted GLB bytes, not an
  intermediate export. Additional 844 × 390, 480 × 320 and 280 × 640 layouts have
  no horizontal overflow. No captured page or renderer errors were reported.
- Matched gameplay fixture, including shadow submissions: **329 draws and
  742,002 triangles** on both viewport profiles, versus 253 and 358,814 before.
  This is **30.0% more draws and 106.8% more submitted triangles**, not a
  performance improvement. The buffer budgets remain 1,296,000 desktop pixels
  and 740,610 mobile pixels. Real-device frame rate and thermal behavior remain
  unmeasured; the increased near-player fidelity has a real GPU cost.
- Independent actual-render review checked front proportions, rear fascia,
  wing/stow geometry, wheel junctions and the single-seat cabin. The noticeably
  over-deep candidate nose and dark rear pocket protrusion were physically
  corrected. Remaining small silhouette/material differences and unpublished
  parts prevent an exact-CAD or complete ten-outlet claim.

The capture tools lock the requested player GLB to its recorded bytes, so an
export changing on disk cannot silently mix model revisions in a comparison.
Inspection cameras are not advertised as selectable gameplay cameras. The
controlled-time showcase uses real controls and physics after its disclosed
initial fixture; neither screenshots nor its nominal 30 fps file certify
real-time mobile performance.
