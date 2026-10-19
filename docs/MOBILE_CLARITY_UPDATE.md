# Mobile showroom clarity and rounded glass surfaces

This change preserves the accepted compact HOME/garage layout, vehicle geometry,
traffic, driving controls, progression and cloud-save ownership rules.

## Two different rendering faults

The Android screenshots showed both a large triangular dark region and coarse
3D edges behind full-resolution HTML. These were separate causes:

1. The workshop's old directional shadow camera clipped the newly enclosed roof
   and walls. Its finite orthographic map ended across a wall, while the infinite
   directional light continued beyond that boundary. This produced an artificial
   hard wedge. The room is now lit by one local ceiling spotlight, below the roof,
   with distance falloff and a broad soft cone. Its shadow projection follows the
   same cone. Walls, roof, furniture and cars remain visible and shadow-capable.
2. Auto used the road's DPR1.5 limit even for a parked menu. In the reconstructed
   551×360 CSS iframe at DPR2.625, the old 826×540 drawing buffer was enlarged to
   approximately 1446×945 physical display pixels. Four-sample MSAA was already
   working in the test browser, so simply enabling AA again would not solve that
   upscaling. The compact showroom now has a separate bounded pixel budget.

The iframe dimensions/DPR are a matching reconstruction of the supplied image,
not a claim that the user's browser telemetry was accessible.

## Bounded cost, not a universal 4K claim

- Compact Auto showroom: at most 1.6 million pixels, DPR3, 2560-pixel longest edge.
- Compact High/Ultra showroom: at most 2.0736 million pixels, DPR3, same edge cap.
- Road and paused-road budgets remain unchanged: Auto at most 0.8 million pixels
  and DPR1.5 on compact devices. Non-compact desktop budgets are unchanged.
- Quality settings are not silently rewritten. The actual buffer dimensions and
  the separate showroom/road cost are reported in graphics information.
- The local light still uses one cached 1024×1024 shadow map. No six-face point-light
  shadow, additional per-frame reflection camera or full-scene blur was added.
- Scene redraws remain demand-driven. Painting, orbit, miniatures and the visible
  TV retain their existing lifecycle and update limits.

At the reconstructed iframe size the showroom buffer has about 3.06 times the
old pixel area. This is an intentional clarity/cost tradeoff, not free rendering.
The maximum Auto showroom pixel cap is twice the road cap. Software-renderer
capture timings are diagnostic only and do not establish real Android FPS or
battery life.

The authored narrow panel seams and trim remain real subpixel geometry at some
views; this is not a promise of perfectly smooth detail or universal 4K. A matched
vehicle shadow-receiver-off capture retained the tiny front seam dots, so the
production shadow bias and all car meshes were deliberately left unchanged.

## UI scope

The Fleet no longer labels Rocket as “Стартовая машина”; ownership still reads
“В твоём гараже” and every purchase/selection action remains unchanged. Panels,
popups, cards and controls use rounded rose/plum glass gradients and restrained
edge highlights rather than double outlined pills. Direct small catalog labels
are checked at a minimum 4.5:1 contrast over both dark and white scene extremes,
including selected and unowned item states. Blur is limited to the workbench or active dialog, not applied
to the whole 3D scene. Reduced-transparency and forced-colors fallbacks preserve
complete readable surfaces. No font, spacing, navigation or panel-layout redesign
is part of this change.

## Reproduction and verification

- `node --test --test-concurrency=2 tests/*.test.mjs`
- `npm run check`
- `npm run build`
- `CHROME_BIN=/path/to/chromium SOFTWARE_WEBGL=1 node scripts/garage-clarity-qa.mjs`

The native harness serves one complete source tree, uses a disposable local
profile and captures an actual iframe at native DPR. The QA-only entrypoint
steps the existing renderer manually at a fixed reduced-motion pose while leaving
browser timers live for genuine asynchronous miniature GPU readback. No production
render scheduler is changed. Visible Fleet cards must finish their real GLB renders
before a screenshot is accepted. `CLARITY_BASELINE_ROOT`
selects a complete trusted baseline; `CLARITY_OUT` selects the output directory.
`CLARITY_DESKTOP=1` captures a real desktop DPR1 context. `CLARITY_FINAL=1` adds one shadow-receiver diagnostic and checks the actual
showroom-to-road buffer boundary. `CLARITY_FULL=1` also checks all five garage sections, an open settings sheet,
the compact panel and the portrait gate. `CLARITY_DIAGNOSE=1` isolates the local
light replacement without changing the baseline's pixel budget or UI.

Regressions cover the exact showroom/road resolution boundary, no repeated
allocation on unchanged screens, finite budgets across viewport/DPR extremes,
all four authored room shells and spotlight coverage, and copy/state/material-only
UI changes. The paired captures do not access a real account, invoke advertising,
change cloud saves or claim Yandex-hosted device performance.
