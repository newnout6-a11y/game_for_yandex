# Continuous arcade handling and historical one-thumb response

The continuous handling changes below remain current. The combined thumbpad interaction is historical and has been replaced by held arrows and separate pedals; its module, stylesheet and standalone tests have been removed. See [Mobile arrows and nitro](MOBILE_ARROW_CONTROLS.md) for the current touch controls and verification.

## Reference and intent

The developer's [Traffic Racer App Store listing](https://apps.apple.com/us/app/traffic-racer/id547101139?platform=ipad) describes touch/tilt steering with separate acceleration and brake controls. Its version 1.8 notes also identify an analog slider. Those are interaction references, not access to its physics implementation. No reverse engineering, copied source, claimed factory vehicle specification, or claim of identical handling is involved. The linked SKGames product page did not load during this research, so it is not used as evidence.

This project retains its own measured axle geometry, continuous rear-axle bicycle path, visible Ackermann wheel angles, flight, barrel roll, cockpit and bounded simulation-owned body response. The new tuning is explicitly an arcade aid. Tilt permissions were not added: keyboard and touch remain available without motion-sensor access.

## Why the accepted controller was difficult to correct

The accepted `cffae42` controller requested a heading rather than a bounded lateral intent. Holding full steering at a constant speed produced approximately 3.59 m/s sideways at 18 m/s, 5.59 m/s at 28 m/s, 8.23 m/s at 52 m/s, and 9.17 m/s at 65 m/s. Thus the same held input became much more aggressive as the car accelerated.

The 5/s heading response then took a long time to align after release. At 28 m/s, a 0.4-second full-right correction continued another 1.146 m after release and needed 0.808 s to fall below 0.005 radians. A full opposite input needed 0.442 s before lateral movement reversed. This was controller delay and the bounded turn's real correction tail, not a rendering-only wheel problem.

On touch, continuing a 46.08-pixel full-lock drag to 140 pixels retained a fixed origin. The player then had to drag back 93.92 pixels before the axis left saturation. This invisible dead travel made a large evasive drag particularly difficult to recover.

## New behaviour

- Full continuous input requests at most 4.2 m/s lateral travel. Fractional input remains proportional at normal driving speeds. Heading is also capped at 0.26 radians, so low-speed motion remains feasible rather than sliding the body across the road.
- Heading response is 9/s while steering and 12/s when released. Recovery is actual countersteering through the front wheels. There is no independent lateral damping, centre-position interpolation, lane snapping, lane-centre attraction, or normal-play yaw reset.
- The steering rack is limited to 2.2 rad/s, with additional speed-dependent lock timing of 0.035 s. Existing vehicle and engineering slew multipliers still apply. Configured lateral/yaw acceleration budgets, axle geometry, maximum speed, acceleration and braking remain unchanged.
- Outward input eases as the remaining shoulder distance closes. This only changes the requested heading, not position. All five configured vehicles reach the shoulder aligned without hitting the hard-clamp fallback in the test envelope. Inward corrections are unrestricted.
- The path API now uses the same at-most-1/120-second steps as the game loop. It rejects invalid/nonpositive time and shares the game's 0.1-second frame cap.
- The body springs, landing compression, flight/roll state and cockpit fields are unchanged. There is still no periodic road bob.

The acceleration bound here is the existing arcade yaw/curvature budget (`speed × yawRate`), not a full transient tyre-force simulation. Front/rear wheel trajectories remain no-slip geometric paths; this does not claim real-world force fidelity.

## Reproducible measurements

Run `node scripts/measure-player-handling.mjs`. The harness retains the accepted controller as a test-only reference, isolates response from traffic and road edges, and runs at 30, 60 and 120 Hz. It now samples held arrows and independent gas/brake ownership through the production `DrivingInput`; simultaneously held pedals remain independently owned, with brake priority applied by the game. `docs/handling-metrics/response.json` is the historical measurement snapshot, including the retired thumbpad samples, rather than the current report schema.

The following table uses 120 Hz. Release and reversal follow a 0.4 s full-right input. Settle time means the final time at or above an absolute 0.005-radian heading. Lane time is continuous 3.5 m travel from straight ahead, not a lane-selection command.

| Forward speed | Lane time old → new | Release tail old → new | Settle old → new | Reverse old → new |
| --- | --- | --- | --- | --- |
| 8 m/s | 2.342 → 1.758 s | 0.316 → 0.144 m | 0.900 → 0.500 s | 0.325 → 0.217 s |
| 18 m/s | 1.183 → 1.000 s | 0.696 → 0.567 m | 0.800 → 0.500 s | 0.325 → 0.342 s |
| 28 m/s | 0.917 → 1.025 s | 1.146 → 0.643 m | 0.808 → 0.458 s | 0.442 → 0.358 s |
| 40 m/s | 0.850 → 1.042 s | 1.059 → 0.698 m | 0.700 → 0.425 s | 0.425 → 0.375 s |
| 52 m/s | 0.833 → 1.050 s | 1.024 → 0.728 m | 0.633 → 0.408 s | 0.417 → 0.383 s |
| 65 m/s | 0.825 → 1.050 s | 1.005 → 0.748 m | 0.575 → 0.392 s | 0.408 → 0.383 s |

The tradeoff is deliberate: at 18 m/s, the car reaches a stronger lateral motion during the same short input, so its reversal is 0.017 s slower, while its lane traversal and release settle improve. At highway speed, maximum lateral motion is lower and more predictable. This is not a claim that every metric improves everywhere.

The first 0.1 m of a full correction occurs in 0.100–0.142 s across 18–65 m/s at 120 Hz. Display-frame sampling can quantize reported threshold times by one frame; the actual trajectory fields agree across 30/60/120 Hz to 1e-9 in the control-sequence regression.

Real unchanged game braking from 18, 28 and 52 m/s stops in approximately 8.03, 19.22 and 62.99 metres respectively, within 0.91, 1.40 and 2.50 seconds. The brake uses the selected vehicle and engineering configuration, not a second test-only physics formula.

## Historical touchpad details (retired)

The former default 144 × 78-pixel pad behaved as follows. These details do not describe the current arrow controls:

- The ±2.76-pixel centre deadzone absorbs jitter.
- A smooth odd response curve provides 0.122 steering at 10 pixels, 0.304 at 20, 0.522 at 30, and full steering at 46.08 pixels. It is a spatial precision curve, not a temporal input filter.
- Gas stays fully applied for the first 7.86 downward pixels, so a slightly diagonal steering drag does not immediately lift the accelerator. It fades to zero at 17.04 pixels.
- A real coast band separates gas and brake until 19.00 downward pixels; full brake is reached at 32.76 pixels. Pedals never overlap, and steering remains available while braking.
- After saturation, a bounded floating origin follows only the overflow. Returning 10 pixels from a far-outside horizontal drag reduces steering immediately. Downward brake and upward gas overflow are similarly bounded. The virtual neutral therefore follows a large overflow gesture; a new pointer hold always starts a fresh origin.
- Release, cancellation, lost capture, blur, resize/orientation change, document hiding and disabling still clear every axis. There is no latched throttle. Secondary flight touches cannot steal the owning thumb.

## Regression coverage

`node --test tests/player-handling-response.test.mjs tests/player-motion.test.mjs tests/player-configuration.test.mjs tests/mobile-controls-cleanup.test.mjs`

This focused command covers:

- Exact arc endpoints, no-slip Ackermann wheel directions and step-by-step path/steer congruence.
- Continuous proportional input, no lane magnet, rate/acceleration bounds, standstill behaviour, highway correction tail, low-speed response and numerical 30/60/120 Hz parity.
- Smooth shoulder approach for five vehicle profiles, both sides, and 8–65 m/s, plus no material release ringing across additional speed samples.
- Vehicle geometry and engineering multiplier preservation, braking distances, pause/reset/revive-adjacent state, flight restrictions and body spring/landing quietness.
- Current held arrow/pedal ownership, removal of obsolete touchpad files and selectors, and a runnable measurement report without retired controller imports. Full application pointer cancellation and nitro coverage is listed in [Mobile arrows and nitro](MOBILE_ARROW_CONTROLS.md).

Browser playability is a separate check. Numerical response tests verify mechanisms and repeatability, not a subjective claim that every player will prefer this tuning.
