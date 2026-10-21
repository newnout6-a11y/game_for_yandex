# Device-local adaptive Auto graphics

## Scope

Auto now chooses a physical drawing-buffer budget using viewport size, DPR,
WebGL maximum renderbuffer edge, optional coarse memory/core hints and measured
active-play cadence. It does not identify phone models, benchmark the GPU,
fingerprint the renderer, send telemetry, or change simulation. Calibration is
session-local and never enters the saved/cloud player profile. High and Ultra
retain their prior fixed profiles. Existing geometry, materials, shadows,
texture filtering, mirror cadence and gameplay remain unchanged.

The former `renderDimensions` Auto constants remain a safe standalone fallback
and a separate parked-showcase policy. The live road renderer explicitly passes
its adaptive policy, so the old 0.8-million-pixel compact road limit is not a
hidden cap on the new system.

## Initial choice and bounds

- Missing capability hints do not mean a weak device. Unknown devices start near
  1.6 million compact / 2.7648 million desktop pixels; memory >=4 GB and >=4
  reported cores start near 2.0736 / 3.6864 million. A <=2 GB or <=2-core hint
  starts near 1.2 / 1.6 million. These hints set only the starting level.
- Actual buffer dimensions are bounded by viewport aspect, DPR (at most 3),
  hardware renderbuffer edge, and a maximum of 3.6864 million compact /
  8.2944 million desktop pixels. No upscaling beyond the DPR/viewport ceiling.
- Discrete levels avoid changing the surface every frame. An ordinary viewport
  keeps at least one physical sample per CSS pixel; excessive-sized viewports
  and hardware limits can require a bounded below-native fallback. The quality
  floor is never a claim that every device can run at 60 FPS.
- Compact layout determines a mobile-sized envelope, not a permanent GPU rank.
  The same coarse pointer or small window can move through all supported levels.

## Measurement and stability

Only consecutive active-play frames are eligible. Loading, menus, pause,
background, ads, portrait blocking, transitions and context loss suspend
calibration. Viewport/DPR changes reconfigure the same controller: learned pixel
budgets and applicable cooldown/no-benefit memory survive within new bounds;
only partial timing windows are discarded. Near-duplicate levels around a
retained native-size budget are removed so a trial can meaningfully exceed the
8% improvement threshold rather than falsely report a non-graphics limit.
The first resumed frame cannot borrow the previous screen's
cadence. Raw rAF intervals are used, not the clamped simulation delta. After
reset or a size change, two seconds of active warmup are discarded.

A measurement window is four active seconds with at least 30 frames. Sustained
slow frames (including 100 ms) remain evidence; invalid, sub-2-ms or >1-second
gaps reset continuity. These constants are engineering policy, not device
benchmark data or a browser standard.

- Upscale needs three consecutive windows below 17.8 ms mean, <6% intervals
  above 22 ms, and <13 ms measured main-loop work. A probe that deteriorates
  >10% and exceeds 18.5 ms is rolled back and its higher level is held off for
  120 active seconds. A 120-Hz display is not required to sustain 120 FPS.
- Downscale needs two overloaded windows (>23 ms mean and >25% slow intervals).
  If measured main-thread work already exceeds 70% of cadence, detail is kept.
  Otherwise one lower-resolution trial must improve mean cadence by at least
  8%; if it does not, the previous detail is restored. A resolution-insensitive
  cadence is remembered until it materially changes (>15%), avoiding repeated
  blurry probes on a 30-Hz browser cap. This evidence is tied to the measured
  viewport area/aspect, effective DPR, pixel bounds, edge limit and retained
  budget: a >=25% ratio change invalidates it and allows one new trial.
  Accepted upward or downward tier changes clear old no-benefit evidence;
  rejected or interrupted trials retain it at the restored stable tier. Small
  toolbar resizes retain the evidence; cumulative changes are compared with
  the original failed experiment, not the preceding resize. The 25% threshold
  is a conservative engineering heuristic, not a measured device rating.
- Successful lower levels and failed higher levels have cooldown/hysteresis.
  There is no frame-rate cap. Main-loop work is only a conservative CPU hint,
  never reported as GPU duration. Cadence can have causes outside graphics.
- Cadence averages omit at most one clearly isolated longest interval per
  window, only when it exceeds twice the mean of all remaining intervals.
  Raw elapsed duration, slow-frame fraction and CPU work are not trimmed.
  Sustained slow frames remain represented; this is not a blanket stall filter.
- Lifecycle events synchronously invalidate Auto continuity and pending trials,
  even if pause and explicit resume occur between animation callbacks.
- An interrupted trial restores its prior budget. A scheduled resize occurs
  before the next scene draw, not after it, because WebGL resizing clears the
  drawing buffer. Same-size notifications do not reallocate the canvas.

The existing Graphics UI reports actual buffer dimensions, Auto budget and
calibration status. Larger buffers can improve pixelation and distant edges,
but do not guarantee elimination of all temporal aliasing or texture shimmer.

## Verification and limitations

Deterministic policy tests cover capability absence/corruption, native and GPU
bounds, 60/120-Hz cadence, single stalls, 100-ms sustained overload, CPU limits,
30-Hz no-benefit rollback, improved/failed upscale, suspension, actual renderer
budget forwarding and resize-before-draw ordering. Production controller tests
exercise lifecycle eligibility. Previous manual profiles and shadow rules are
unchanged. Full project tests/check/build must accompany the release artifact.

The cloud browser currently cannot initialize WebGL, so this change is not
visually certified there or on the user's Galaxy S24 Ultra. Real-device FPS,
thermal behavior, browser cadence and screenshots remain necessary to validate
tuning. No external review or deployment is implied by local test completion.

## Primary documentation informing the design

- Three.js explicit drawing-buffer sizing: https://threejs.org/manual/pages/responsive.html
- Coarse optional memory hints: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory
- Reported cores may be limited: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/hardwareConcurrency
- Visibility and iframe caveats: https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
- Averaged hysteresis patterns: https://drei.docs.pmnd.rs/performances/performance-monitor

No GPU timer extension is used; adding one later would require asynchronous
availability/disjoint handling and its own validation, not synchronous timing.
