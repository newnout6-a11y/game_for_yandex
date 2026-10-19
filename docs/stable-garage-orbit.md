# Stable exterior showroom orbit

The HOME and garage overview/rear camera now chooses its projection from the actual selected vehicle's full-turn envelope, rather than fitting a world-axis bounding box again for each drag angle. A cached convex radial/height envelope is built when geometry changes. Paint-only changes reuse it.

For a fixed model, viewport, usable stage and deliberate zoom setting, normal exterior dragging keeps the true eye-to-target distance, target, FOV, near plane and projection offset constant. Yaw and elevation change; the visible silhouette naturally changes with perspective. The default true distance is 6.16717856 m, preserving the previously accepted opening position. The elevation range is 0.128915–0.432606 radians. The fixed projection leaves a modest full-turn margin instead of dynamically shrinking the car.

This contract does not erase intentional mode changes: Wheels and Cockpit have dedicated inspection views, and explicit preset transitions retain their finite animation and collision-safe takeover. In particular, interrupting a Wheels → Overview transition may finish its existing 350 ms recovery. Results uses its separate non-orbiting measured-stage fit. Driving cameras are unchanged.

## Authored room clearance

No wall or ceiling is hidden or enlarged to disguise clipping. Parked owned cars use clear side bays at X = ±7.8 m, Z = −1.6 m. In tier 2, both complete lift sides move from X = ±3.8 m to ±6.7 m; the cable bridge spans 13.85 m at Y = 4.4 m. In tier 4, complete left/right islands move outward by 1.3 m to X = ±7.4 m. Editable Blender sources, generator, exported geometry, collision metadata and provenance are updated together. Tiers 1 and 3 remain byte-identical.

The tier-2 relocation changes foreground occlusion of the otherwise unchanged wall mural. The historical overview probe now sees 77/91 points instead of its former ≥95% threshold; other inspected angles retain the mural. This is a real composition trade-off, not an assertion of identical appearance. The paired native capture uses the same final camera and changes only the room asset so that trade-off can be inspected directly.

## Verification

- Actual GLB vertex projection through full yaw and supported elevations, all five vehicles; geometry-affecting customization and first material-only edit cache checks.
- Continuous eye/near-plane clearance for all four rooms, selected vehicle heights, owned parking variants and the toy prop. The formerly blocked tier-2 rear-quarter sight ray is checked against actual triangles.
- Native touch drag plus a controlled full-circle frame sequence from the production scene. A generated clip is a visual inspection aid, not an Android frame-rate benchmark.
- HOME cleanup and compact mobile Results preserve their independently tested actions, reward/ad/save semantics and accessible focus behavior.

Run `node --test tests/garage-stable-orbit.test.mjs tests/garage-stable-orbit-assets.test.mjs` for focused checks. `node scripts/stable-orbit-qa.mjs` captures the native scene with isolated test inventory. The optional `STABLE_ORBIT_MURAL_COMPARE` path selects an explicitly supplied historical tier-2 GLB for a two-frame same-camera asset comparison; it never changes shipping assets. `CHROME_BIN` and `SOFTWARE_WEBGL` select the test browser/rendering backend. No real player profile is read or modified.
