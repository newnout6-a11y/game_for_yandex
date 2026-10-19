# Workshop camera and complete interior

This change fixes the garage inspection camera, not vehicle motion or race physics. It preserves the accepted UI, catalogue, saved inventory, pink mural, parked vehicles and player/traffic assets.

## Reproduced defect

On the PR5 baseline (`1f92349d`), a rear inspection drag placed the desktop eye at Z=8.058 m and the short-landscape phone eye at Z=12.008 m. The rear wall's inner face is Z=7.57 m. The vehicle transform stayed fixed: the camera, not the car, crossed the wall. Fitting the available UI rectangle had increased the camera radius without any room constraint.

## Correction

- Fit the actual focus bounds into the unobstructed UI region by adjusting projection at a safe eye position. Authored interior bounds, equipment and occupied parking bays constrain the eye and near plane.
- Exterior inspection supports a complete orbit. Rightward mouse or touch drag moves the visible vehicle surface rightward. Cockpit look uses its own correct sign rather than blindly reusing the exterior orbit sign.
- Exterior view changes follow a finite vehicle-centred arc, checked against the room on every displayed frame. Entering or leaving the authored seated eye is an explicit compartment cut with a short optical settle, not a flight through glass or body panels.
- Pointer capture belongs to one mouse/finger only. Release, cancellation, lost capture, blur, backgrounding, orientation and screen changes clear it. A second finger cannot cancel or steal the first gesture.
- All four editable Blender rooms now include the opposite entrance, service access, side returns, ceiling and appropriate shallow workshop detail. Existing rear architecture and artwork are retained. Runtime key lighting sits inside the physical ceiling rather than above an opaque roof.

## Physical wall and floor finish

The first wall reused the floor map: 3- and 11-cycle noise over a 2 m tile produced visible 18–67 cm cloudy patches. A flat, low-contrast wall-only replacement was also rejected during review. The final materials instead use six original 512 × 512 base-colour, tangent-normal and roughness maps. Wall aggregate is mapped at a 0.75 m tile and honed floor aggregate at a 1 m tile using the existing metre-scaled UVs. The small, coherent mineral features supply actual shallow normal relief and matte roughness variation, not broad baked lighting, sharpening or salt-and-pepper noise. The average concrete colour and original pink mural are preserved.

The native desktop capture has a 1440 × 900 CSS viewport and the same drawing buffer; these comparisons do not disguise a reduced-resolution render by enlarging it. Garage map sampling now follows the existing renderer policy: up to 8× anisotropy on desktop, 4× on compact devices, capped by hardware support. Existing colour spaces, trilinear mip filters and shared-texture identity are preserved. Render targets are excluded.

The six current surface images total 1,150,397 embedded bytes per room, replacing 1,517,297 old surface-image bytes. Their estimated RGBA8 storage including mipmaps is 8,388,600 bytes, approximately 1.92 MiB more than the preceding wall/floor maps per separately cached room. Four cached rooms can therefore retain about 7.67 MiB additional surface texture memory. This excludes the unchanged mural, vehicles and other runtime resources. Anisotropic filtering also has a sampling cost; no hardware FPS improvement is claimed.

## Distinct arrival zone

The reverse view is an entrance and charging area, not a duplicate of the accepted repair workshop. It contains a slim charging pedestal and tethered connector, protection hoop, louvered extraction intake and connected duct, gate drive and manual chain, isolation switch, entrance lane marks and a flush drainage track. Higher tiers develop the same purpose with additional charging and integrated utilities. The original front repair furniture, equipment and pink mural remain untouched. New equipment is kept along the perimeter, outside the display and parked-car envelopes, with authored collision bounds included in the camera contract.

## Physical television and bounded media playback

Each room has a 4.20 × 2.3625 m, 16:9 screen in a real bezel, with brackets,
power cable and restrained rear diffuser. It adds one screen material batch;
the frame uses existing room materials. The screen is normal-mapped neither
as a wall nor as a fake reflection: it is a dedicated image/video surface.
The shared decoder is created only when the actual screen projects into the
visible central world area. Transparent title space is included, so the TV
above a short-landscape phone's car-fit area still works. Opaque side panels
remain outside that visibility area.

Playback is local, muted and inline, with at most 12 scene-refresh requests per
second and no refresh when the decoded frame has not advanced. Background,
orientation, platform/ad pause, account/payment pause, settings and offscreen
views stop decoding. Reduced motion uses the embedded static poster; media
failure also retains that poster without retry spam or blocking the garage.
All cached tiers share one decoder/material. The existing embedded poster is
borrowed rather than downloaded/uploaded to the GPU twice. No remote ad feed,
YouTube iframe, account, autoplay sound or new WebGL context is used.

TV-only frames reuse the unchanged directional shadow map. Vehicle selection,
cosmetic geometry, parked cars, cabin visibility, room rebuilding and GPU-context
restoration explicitly invalidate it. This avoids regenerating static shadows
for a changing screen image; it is not a claim about real-device frame rate.

The user-supplied **The Kickflip | Roadster** film, credited to Tesla, is now
used in full: 1,052 frames, 640×360, 24000/1001 fps and 43.877167 seconds. The
1,707,750-byte MP4 is a lossless video stream copy with audio removed and
fast-start metadata; every decoded frame matches the original. There is no
crop, retiming, excerpt or synthetic replacement. The 20,303-byte embedded
poster is the original stunt frame at 14.2 seconds. Its 16:9 proportions fill
the authored screen without distortion. The longer 43.932154-second input
container duration is an audio-tail difference, not a truncated video ending.

The source video's frame rate is unchanged; garage redraw requests remain
bounded at 12 Hz, so not every decoded frame must be presented. A shared
640×360 RGBA video texture is approximately 0.88 MiB before decoder overhead.
Actual mobile hardware decoding/power usage is not benchmarked here. Film
copyright, provenance and the absence of a claimed redistribution license are
explicit in `CREDITS.md` and `art/garage/screen/supplied-video-provenance.json`.
The cancelled original neon-film candidate is not the selected runtime media.

## Verification

The browser harness `scripts/garage-orbit-qa.mjs` serves either the immutable baseline (`ORBIT_QA_ROOT`) or current source, uses actual UI buttons and pointer gestures, and records native PNGs with camera coordinates, CSS/drawing-buffer dimensions and draw/triangle counters. Mobile gestures use touch events and the portrait rotation gate remains blocking. The controlled render clock is for repeatable inspection, not a real-device FPS benchmark.

The final source verification count is recorded with the immutable release evidence; the source passes its complete test suite, the JavaScript source check and production build. The Blender generator and preview script also compile. Geometry coverage includes 9,600 model/tier/framing poses and 3,605 fine-angle continuity probes, plus independent 4,200-pose and 200-interruption audits. These are sampled geometry/behavior regressions, not a claim of a general-purpose camera physics solver.

Exact final room costs are recorded in `art/garage/tierN-report.json` and `reverse-workshop-audit.json`. Runtime rooms remain consolidated by material rather than giving each authored detail its own draw. The selected car, traffic, smoke and cosmetics are unchanged. Real hardware frame rates have not been measured.

Native browser captures cover desktop and touch landscape, the original rear-wall failure, interrupted exterior travel, all four tiers with owned parked cars, rims, authored cockpit and the largest owned van. The portrait rotation gate is still blocking. Capture instrumentation uses an isolated local inventory, not an online account or paid purchase. No Yandex draft replacement, public launch, payment activation or merge is performed by this source change.

## Actual-model fleet list

The accepted lower-right selected-car heading remains in the open central stage,
left of the workbench. The five fleet rows now contain live miniature versions of
the actual authored game vehicles, with saved owned appearance and finite
hover/focus/touch rotation. They share the existing renderer instead of creating
five WebGL contexts. See [GARAGE_FLEET_MINIATURES.md](GARAGE_FLEET_MINIATURES.md)
for cache ownership, motion/accessibility controls, bounded rendering cost and
native verification.
