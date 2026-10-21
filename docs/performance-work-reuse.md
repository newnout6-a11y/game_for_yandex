# Redundant-work repair (2026-10-20)

This patch targets avoidable work after the handling/contact update. It is not a
lower-quality graphics profile and it is not a thermal measurement of the
reported Samsung Galaxy S24 Ultra. Browser, refresh mode and the hot screen on
that handset were not established during the automated measurements.

## What changed

- The contact resolver computes each previous compound once, instead of
  rebuilding all nine Rocket parts inside each part's mapping operation.
  Temporary shapes, roll projections and vertical-interval records are reused
  within the same state-owned solver workspace. Escaping contact records remain
  owned copies.
- A full compound sphere about the actual 0.58 m roll pivot proves that distant
  guardrails cannot intersect the current linear root path. The proof covers all
  yaw/roll angles, is recomputed after impulses, and only rejects those rails.
  Remaining narrow-phase samples, roll slices, fail-closed uncertainty, contact
  ordering, odometry and final bookkeeping are unchanged.
- The Rocket mirror controller does no transforms or reflection passes when its
  retained model is not a descendant of the rendered scene. It invalidates and
  refreshes immediately when reattached. Visible Rocket mirrors keep their
  original shaders, dimensions, optics and update budgets, including chase view.
- HUD text, style, attributes and state properties are written only when their
  exact requested value changes. Fractional gauge values are not quantized;
  DOM replacement and external changes are observed. Bonus live announcements
  and input ownership are not changed.

## Measured simulation CPU work

Node v24 reference environment; wall CPU milliseconds per simulated second,
excluding fixture construction. Each cell is the median of seven alternating
baseline/candidate blocks after eight warmup trajectories for each scenario and
cadence. Each block runs twelve one-second trajectories. This is not whole-app
CPU, GPU frame time, browser FPS, battery use or a phone-temperature claim.

At 60 Hz caller cadence:

| Scenario | Baseline ms/s | Repaired ms/s | Reduction |
| --- | ---: | ---: | ---: |
| Empty road | 2.824 | 0.399 | 85.9% |
| Twelve traffic actors | 7.337 | 4.245 | 42.1% |
| Nearby sedan | 4.274 | 1.191 | 72.1% |
| Airborne barrel roll | 3.668 | 0.470 | 87.2% |
| Sustained side contact | 8.901 | 2.846 | 68.0% |
| Articulated traffic | 7.325 | 2.230 | 69.6% |

The same harness covers 30/60/90/120 Hz. It intentionally preserves the current
at-most-1/120-second subdivision, including fractional trailing steps at 90 Hz.
No accumulator, simulation rate or frame-rate cap was introduced.

Deterministic work counters per simulated second:

- Empty road: 19,440 -> 2,160 compound projections; 2,160 -> 0 distant rail
  sweeps.
- Nearby sedan: all 1,080 required traffic sweeps are retained.
- Sustained contact: the same 89 confirmed and 5 unresolved sweep outcomes.
- Barrel roll: all 686 solver slices remain; 12,348 redundant rail vertical
  checks disappear.

## Rendering and equivalence gates

With the exact authored Rocket GLB and chase camera, switching it out of the
scene used to make 60 compact or 90 desktop offscreen reflection passes over two
seconds. The repaired branch makes zero; reattachment refreshes all three panes
at dt=0. These counts are render invocations, not measured GPU milliseconds.

Independent physics comparisons against the published source cover 2,688 full
Game state/event trajectory pairs, 10,000 seeded resolver proposals across all
five owned vehicles and eight traffic kinds, and 1,512 adversarial rail-boundary
cases: zero mismatches. They include fatal contacts, unresolved sweeps, solver
budget stops, rails, articulated traffic, trim contacts and crash wheel clocks.

Regression tests also execute the real resolver with only its rail broadphase
disabled and compare the complete result/state, not just collision flags. The
low-level SAT/CCD and impulse module is byte-identical to the published version.

There are no changes to models, textures, framebuffer size, pixel ratio, visual
effects, shadow quality, mirror cadence for the active car, input behavior,
rewards, save format or SDK flow. A real handset session is still required to
measure its thermal and battery effect; sustained high-quality 3D rendering may
continue to warm the device.
