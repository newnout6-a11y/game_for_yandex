# Functional player rear views

This adds live rear views to the player Rocket only. Traffic vehicles retain their existing environment-based mirror materials. These are original game features and reconstructed mirror details, not a claim about undocumented factory Rocket mirror electronics.

## What is actually rendered

The left and cabin panes use their authored Blender planes. The current driver eye, forward and up are reflected geometrically; an off-axis projection fits the real pane, with an oblique near clip plane. Projective sampling supplies mirror handedness without an arbitrary image flip. The left pane was physically re-aimed by 3.89° and the cabin pane lifted by 25 mm and aimed 1.18° downward to a level rear sightline, with matching backing/brackets, rather than hiding their occluders. Their sampled direct visibility is 100/100 and 100/100 points respectively. The narrow 53 × 14 mm side aperture gives a narrow slice of adjacent traffic, not a panoramic full-car view.

The passenger-space pressure vessel genuinely blocks the right pod from the driver. After an explicit user choice, its exterior location and the vessel remain unchanged. A separate camera near that existing pod supplies a labelled, separate right-hand cabin screen. This is a digital camera view, not a physically reflected right mirror. Its 36° vertical lens and 2:1 aspect cover the rear-right lane; one horizontal reversal presents intuitive mirror-like movement. Real body edges can occlude its inward edge. The deployed rear wing can genuinely obstruct the cabin mirror during flight; the renderer does not erase the wing to invent an unobstructed reflection. The central tablet, its original illustration and live speed, energy, gear, distance and flight readouts are unchanged.

No photograph, environment-only substitute, hidden player body or readback-to-canvas is used for the live image. The right screen samples the render target directly in its own display material. Scene-linear pixels receive the main pass's tone mapping and output encoding once. Missing/context-lost targets restore authored fallback artwork, not a stale image claimed to be live.

## Controls and comfort

C or the camera button selects the cockpit. Hold Z/X to look left/right; touch has two independent 44-pixel look controls. Releasing, cancelling, losing focus, pausing or leaving the cockpit clears the look. Looking does not steer or roll the vehicle. The seated eye stays in the authored cabin; it is not teleported around the vessel. Barrel rolls temporarily use the outside comfort view, then return upright to the selected cockpit.

## Bounded rendering cost

- Auto desktop targets: 384 × 192; High/Ultra: 512 × 256; compact: 256 × 128.
- Refresh: at most 15 Hz desktop, 10 Hz compact or reduced motion, with an immediate refresh after relevant invalidation.
- Only visible, front-facing physical panes refresh. The right camera screen refreshes only in effective cockpit mode while that screen is visible.
- Render targets have no extra MSAA or mip chain. Resolution follows a fixed bucket, not device DPR.
- Extra views reuse existing shadow maps and never recursively render mirrors/screens. Renderer target, viewport, scissor, XR, shadow and fog state are restored even after a failed pass. If a quality change or context restoration leaves a shadow map unallocated, only that light’s shadow sampling is omitted in the extra view until the normal main pass rebuilds it. Light illumination remains; no extra warm-up render is added. This avoids the pinned Three r183 null-shadow sampler defect that previously omitted traffic on the first capture.
- Rear scenery is finite. Extra views use a matched 42–78 m atmospheric fade; road/markings extend to 80 m and passed traffic remains until its nearest bumper clears the rear range. This prevents the old 18 m recycling pop without an unbounded rear scene.

These passes are not free. Retaining more passed vehicles and rendering additional views costs draw submissions, vertices, fill rate and battery. The default Auto profile stays bounded. Controlled-time software-WebGL captures validate content and transitions, not real mobile or desktop FPS.

## Validation and chosen layout

The user compared both layouts and selected **A, the separate right-hand screen**, on October 18. Production never imports the optional `tablet-camera-preview.js` comparison helper. The central tablet remains the original live instrument display; there is no duplicate default camera feed.

Desktop and portrait/landscape touch captures verify actual rear-traffic images, glance release, roll comfort and return. A real `WEBGL_lose_context` browser exercise also verified immediate fallback while paused, invalidation on restoration, a newly allocated target and renewed live output. This is a recovery check, not a hardware stress benchmark.

## Reproduction

```sh
npm test
npm run check
npm run build
node scripts/verify-player-mirrors.mjs
# Optional real WebGL context-loss/restoration check:
MIRROR_CONTEXT=1 node scripts/verify-player-mirrors.mjs
node scripts/verify-cockpit-view.mjs
```

Use `CHROME_BIN` for an explicit browser executable, otherwise scripts use the installed Chrome channel. `SOFTWARE_WEBGL=1` is the controlled QA backend. Geometry tests distinguish a shader being active from the driver genuinely seeing a pane, and ray-test actual rear-vehicle mesh triangles rather than only bounding boxes.

Implementation references: [Three.js Reflector r183](https://github.com/mrdoob/three.js/blob/r183/examples/jsm/objects/Reflector.js), [Three.js responsive rendering](https://threejs.org/manual/pages/responsive.html). No third-party mirror asset was copied.

In one fixed desktop scene at 1600 × 900, the complete refresh submitted 547 draws / 1,581,142 triangles versus 256 draws / 667,777 triangles for the cached main frame. This includes the extra views and shadow submissions; it is not an average cost, an FPS number or a guarantee for other traffic counts. Portrait phone targets and refresh rates use the lower compact budget.

The final automated suite passes 359 tests, source checks report zero errors, and the release build completes. The native-browser checks are additional visual/interaction evidence, not counted as hundreds of extra unit tests.
