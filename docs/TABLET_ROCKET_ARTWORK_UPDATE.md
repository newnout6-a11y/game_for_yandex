# Rocket artwork on the central tablet

The previous car drawing was a hand-rasterized generic side profile, not the
current Rocket geometry. It has been replaced by an offline Blender rendering
of this project's current editable Roadster model. The exterior itself, physical
mirror assembly, cabin geometry, steering, flight and traffic are not changed.

## Source and reproduction

- Editable vehicle: `art/roadster.blend`.
- Offline rendering/composition: `scripts/render_tablet_rocket.py`.
- Transparent vehicle artwork: `art/textures/roadster-tablet-rocket.png`.
- Tablet layout/composition: `scripts/roadster_cabin.py`.
- Final 1024 × 640 UI: `art/textures/roadster-cabin-original-ui.png`, packed in the
  Blender source and embedded in `public/assets/roadster.glb`.

Rebuild from the repository root with `blender --background --python-exit-code 1 --python scripts/render_tablet_rocket.py`. Add `-- --reuse-render` to recompose and pack the checked-in image without rerendering, or `-- --render-only` for an artwork-only preview. The companion `art/textures/roadster-tablet-rocket.json` records model fingerprints, camera, lighting, pose, alpha composition and output hashes.

The illustration uses a parked/stowed-wing presentation. It is a static vehicle
status image, not a live animated model, a photograph, manufacturer software or
factory telemetry. It depicts our reference reconstruction, including its
user-requested enlarged left mirror; it does not imply factory CAD accuracy.

## Runtime and layout

The existing live instrument canvas copies the authored image and refreshes only
speed, game energy, route distance and status. The car image remains outside
those regions. The central tablet has no rear-camera feed. The accepted separate
right-hand cabin screen and the real-time mirrors retain their existing behavior.

This change adds no per-frame render pass, extra runtime texture or material
batch. The existing 1024 × 640 UI texture dimensions and instrument update cadence
are unchanged. More detailed PNG content can increase compressed asset size;
unchanged rendering structure is not a measured FPS claim.

## Verification

`node scripts/verify-tablet-rocket.mjs` captures actual production driver views
on desktop and portrait mobile, plus a clearly identified close inspection
camera. `TABLET_ASSET` can pin a prior GLB for matched before/after images;
`TABLET_OUT` selects the output directory. Use installed Chrome by default or set
`CHROME_BIN` to a local browser executable. `SOFTWARE_WEBGL=1` is an optional
software-rendering QA path, not a claim about hardware performance.

The car is composited into pixels (300,247) through (980,448). The old outline
brush reached two pixels above that nominal region; those 46 obsolete roof-edge
pixels are cleared too. Every pixel outside (300,245) through (980,448), including
all live-instrument areas, is preserved exactly. Alpha is composited in linear
light with explicit sRGB decoding/encoding, not a dark rectangular backdrop.

The automated artwork regression checks the embedded source image, unchanged
geometry and non-tablet textures, and the artwork's provenance/pixel layout.
Existing cockpit tests continue to check live readouts, paused updates, source
isolation and disposal. Captures use controlled scene states, not FPS benchmarks.

## Validated revision

- 378 automated tests passed; source check reported 0 errors and the build passed.
- Blender and GLB preservation checks retain all 805 editable objects, 242,552
  player triangles and 69 player material primitives. Only the existing tablet
  image and its descriptive `ui_artwork` metadata changed.
- Matched native desktop captures use 1920 × 1080. The portrait profile uses
  390 × 844 CSS pixels at DPR 2. The tablet is naturally offscreen looking straight
  ahead in portrait; the existing held right-glance control reveals it without
  changing the seated eye, lens or tablet placement.
- The actual desktop scene retains 222 geometry resources and 30 textures;
  portrait forward retains 222 and 29. The desktop inspection's main draw remains
  219 calls / 626,737 submitted triangles, exactly matching the prior image. These
  are fixture/resource counts, not timings or hardware FPS.
- GLB file size grows from 7,011,160 to 7,150,000 bytes (+138,840 bytes) for the more
  detailed compressed UI image. The image stays embedded, with no new network
  asset request or GPU render target.
