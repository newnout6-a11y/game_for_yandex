# Functional player rear views

This adds live rear views to the player Rocket only. Traffic vehicles retain their existing environment-based mirror materials. These are original game features and reconstructed mirror details, not a claim about undocumented factory Rocket mirror electronics.

## What is actually rendered

The cabin pane and exterior right pane use their authored Blender planes. The current driver eye, forward and up are reflected geometrically; an off-axis projection fits the real pane, with an oblique near clip plane. Projective sampling supplies mirror handedness without an arbitrary image flip. The cabin pane was lifted by 25 mm and aimed 1.18° downward to a level rear sightline, with matching backing/brackets rather than hidden occluders.

The first left pane was only 53 × 14 mm and genuinely updated, but its planar field of view and visible area were too small to show a useful vehicle silhouette. A screenshot review exposed that usability defect; active-render counters alone had not tested it. The intermediate 75 × 28 mm inset was also rejected as too small. The user explicitly requested a properly sized whole mirror, so the final Blender assembly replaces that left camera-sized pod with an approximately 205 × 120 mm housing and 180 × 95 mm convex glass on a coherent support. This intentionally changes the left exterior silhouette for usability; it is not claimed to match factory Rocket dimensions. The other exterior, cabin, right assembly, tablet and wing are unchanged.

The glass is genuinely spherical, with an authored radius of 0.65 m. Its actual curved normals and the current eye determine the reflected ray for every fragment. Its physical mounting angle aims at the rear-left lane; there is no shader-only aiming offset. One local scene capture replaces the previous left planar pass. This is a bounded shared-origin approximation: outgoing directions follow reflection geometry, but very close parallax and self-occlusion are not exact non-central ray tracing. It is not a fixed rear video pasted on a flat pane. The casing, stalk and player body remain opaque and present.

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
node scripts/verify-left-mirror.mjs
# Optional real WebGL context-loss/restoration check:
MIRROR_CONTEXT=1 node scripts/verify-player-mirrors.mjs
node scripts/verify-cockpit-view.mjs
```

Use `CHROME_BIN` for an explicit browser executable, otherwise scripts use the installed Chrome channel. `SOFTWARE_WEBGL=1` is the controlled QA backend. Geometry tests distinguish a shader being active from useful visible glass, validate the curved surface against its sphere metadata, and ray-test actual rear-vehicle mesh triangles rather than only bounding boxes. Matched native desktop/mobile views compare the original slit with the revised reflected traffic; a deliberate left glance remains necessary on narrow portrait screens.

Implementation references: [Three.js Reflector r183](https://github.com/mrdoob/three.js/blob/r183/examples/jsm/objects/Reflector.js), [Three.js responsive rendering](https://threejs.org/manual/pages/responsive.html). No third-party mirror asset was copied.

In the preceding planar-mirror release, one fixed desktop scene at 1600 × 900 the complete refresh submitted 547 draws / 1,581,142 triangles versus 256 draws / 667,777 triangles for the cached main frame. This includes the extra views and shadow submissions; it is not an average cost, an FPS number or a guarantee for other traffic counts. Portrait phone targets and refresh rates use the lower compact budget.

The final full-size mirror release passes all 372 automated tests. Source checks report zero errors; release build, Python compilation and whitespace checks pass. Both rejected small-aperture candidates are superseded, not published as the accepted fix. The native-browser checks are additional visual/interaction evidence, not counted as hundreds of extra unit tests.


## Left-mirror usability correction, October 18

The full assembly is authored at 205 × 120 × 58 mm with 180 × 95 mm glass. The existing uniform 4.7 m vehicle normalization makes the in-game glass approximately 177.6 × 93.7 mm; native pixel measurements below already include that scale. Its physical reflected field is approximately 40° × 20°. The actual center ray from the seated eye reaches the rear-left lane at (-3.5, 0.8, 12) metres. This is a true authored mount adjustment, not a shader camera offset.

The final glass projects to about 177 × 86 pixels in the native 1920 × 1080 forward view. In a 390 × 844 CSS-pixel portrait left glance it occupies 68 × 40 CSS pixels (about 136 × 80 physical pixels at DPR 2). The rejected 75 × 28 mm candidate occupied only 72 × 26 / 29 × 13.5 pixels respectively. The final pane therefore has roughly eight times the projected desktop area. A deliberate glance is still needed in portrait: a physical left mirror is outside the narrow forward field of view, rather than overlaid as a floating HUD.

Dense tests use the actual exported triangles, not just a render counter: 1,024 direct samples, outgoing pod clearance, physical convex normals, actual rear sedan silhouette, and visible backing/rim. Native matched captures use the same seated eye, lighting, quality and real traffic models at 9 and 14 m behind. These are controlled scene comparisons, not simulated driving or an FPS measurement. Negative controls reject both the original flat slit and the intermediate small pane.

Only three editable left-mirror objects change: housing, mount and glass. The other 802 native objects retain their geometry and transforms. Runtime X normalization now follows the actual axle midpoints, preventing a one-sided accessory from recentering the driver or wheel contact patches. A regression adds an asymmetric mirror and confirms those transforms remain unchanged. The shared collision and lane-reservation envelope grows from 2.30 to 2.36 m wide to include the actual new leftmost extent (about −1.170 m); steering and flight mechanics are otherwise unchanged.

Player geometry changes from 241,624 to 242,552 triangles (+928, +0.38%); the 69 mesh/material primitives are unchanged. The convex pass replaces its old planar pass, keeping the same target buckets and maximum three extra views per refresh. The wider reflected field may submit more visible scene geometry, and the larger pane shades more fragments. Unchanged pass counts are not a claim of unchanged GPU time. Actual hardware FPS and battery cost remain unmeasured.
