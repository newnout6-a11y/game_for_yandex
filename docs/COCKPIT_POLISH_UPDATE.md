# Rocket surface, driving and cockpit refinement

Base: merged main `092963cd480b8ef53b4551603d76ca3148d66026` (the same tree as the accepted landing-wing/dashboard revision).

The unpublished October 17 workspace was lost before upload. This revision reconstructs the accepted feature contract from that base and repeats validation. Its source and asset hashes are new; it is not represented as a byte-for-byte recovery of the lost snapshot. The accepted angular Rocket design, straight tablet, grounded wing stow, traffic fleet, scenery and cold-gas effects remain in scope for regression protection.

## Surface and image clarity

The Blender refinement corrects exterior winding and mismatched normals at real panel joins. Designed sharp character lines remain sharp; it does not apply global subdivision or turn Rocket into a rounded generic car. The editable Blender project and exported GLB are regenerated together. Hidden or unpublished hardware is still a reconstruction, not factory CAD.

The graphics selector is available in the menu and pause dialog, and shows the actual drawing-buffer dimensions. It persists independently of camera preference:

| Profile | Desktop pixel budget | Compact pixel budget | Maximum DPR |
| --- | ---: | ---: | ---: |
| Auto | 1.6 million | 0.8 million | 1.5 |
| High | 3.6864 million | 1.6 million | 2 |
| Ultra | 8.2944 million | 2.0736 million | 2 |

Ultra can render actual 3840 × 2160 at a matching desktop viewport. It does not promise 4K on a phone or turn low-resolution media into 4K. Auto remains the default. High/Ultra use a 2048² desktop sun shadow target; compact devices retain 1024². Targets are not reallocated when their selected bucket is unchanged. MSAA, trilinear mipmaps and bounded anisotropy remain; no blur, sharpening or bloom pass was added. More pixels and mirrors cost GPU time and battery. Software-browser captures are not real-device FPS measurements.

## Player movement

The player follows an integrated rear-axle bicycle arc rather than separately sliding sideways while displaying a steering angle. The centre path, yaw, lateral acceleration, traffic-relative scrolling and four wheel travel distances derive from that same arc. Front wheels use Ackermann angles, with measured wheelbase and radii. Steering rate and lateral acceleration are bounded. The road-edge constraint remains an explicit arcade boundary, not a tyre-force simulation.

Only sprung body/cabin hardware responds to longitudinal acceleration, cornering and touchdown. Wheel carriers remain unsprung on the road. Simulation-owned damped springs replace idle sine-wave bobbing; repeated rendering does not advance them. A conservative combined 18 mm envelope prevents the body from consuming wheel-arch clearance. Chase-camera translation is small, acceleration-driven and disabled by reduced-motion preference. These are coherent game dynamics, not measured Tesla suspension or flight telemetry.

## First-person view

Press C, use the 44-pixel camera button, or choose the pause-dialog camera control. The selected view survives reload. The driver eye comes from the authored cabin metadata, not a hood-mounted camera. A 96° horizontal field of view is capped at 85° vertically on portrait screens; the near plane is 3 cm. Camera and cabin share the sprung frame without artificial lag.

The real tablet receives a private 1024 × 640 live texture with simulation speed, distance, energy and flight status. It updates changed telemetry at no more than 10 Hz, freezes while paused and preserves the source artwork/material. It adds no mesh draw. Inside glazing uses a restrained instance-only opacity/reflection preset and restores exact exterior values outside; this is a visibility approximation, not physical refraction.

During a barrel roll, the camera temporarily returns outside and only returns to the selected cockpit view after upright recovery. Ground driving, takeoff, hover and normal landing retain the requested cockpit view. Repeated C, text-input focus, open dialogs, pointer cancellation and pause do not leak controls into gameplay.

## Reproduction

```sh
npm ci
npm test
npm run check
npm run build
node scripts/verify-render-quality.mjs
node scripts/verify-cockpit-view.mjs
```

Browser scripts use `CHROME_BIN` when supplied, otherwise the installed Chrome channel. `SOFTWARE_WEBGL=1` selects the software QA backend. Controlled-time scripts exercise actual production controls and state; their output is visual/regression evidence, not a hardware frame-rate benchmark.

Live rear views, the user-selected separate right camera screen, their limits and rendering cost are documented in `PLAYER_MIRRORS_UPDATE.md`.

## Native-resolution evidence

A matched 3840 × 2160 panel capture uses the same camera and lighting before/after. The old drawing buffer was 1687 × 949 stretched to that viewport; the new Ultra capture really renders 3840 × 2160. This comparison therefore separates render sampling from the selective Blender normal/join repair. The original cockpit-and-polish snapshot, including the separate right camera screen and initial mirror adjustments, contained 241,624 triangles in 69 mesh primitives. The subsequent user-requested full-size left mirror raises this to 242,552 triangles, still 69 primitives; see PLAYER_MIRRORS_UPDATE.md. The previous merged asset had 243,185 triangles in 66 primitives. These counts are asset geometry, not whole-frame GPU work.
