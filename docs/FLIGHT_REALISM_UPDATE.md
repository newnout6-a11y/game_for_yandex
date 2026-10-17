# Flight control, landing vapor and smoother scene geometry

## Why the earlier video slowed down

The earlier capture released the accelerator at 3.0 seconds and held only F during the later flight. The production speedometer was reporting the actual coasting speed. A faster vehicle can still overtake slower traffic while decelerating. NPC following/braking code changes NPC speed, not player speed.

Horizontal acceleration and drag remain truthful: F supplies vertical flight support, not automatic horizontal acceleration. The new test explicitly checks equal horizontal behavior in air and on the ground with the same throttle input. The next showcase keeps W held. The HUD now reminds an airborne, coasting driver to maintain throttle.

## Flight and roll

- F / touch Flight still lifts the car to a maximum 3.3 m.
- Vertical speed now accelerates and decelerates rather than instantly switching between fixed ascent/descent rates. Landing approaches at up to 2.2 m/s and slows near the ground to a gentle contact.
- Takeoff allocates a finite 3.2-second landing-assistance reserve at a cost of 2.5% of the shared charge. That reserve is descent-only: it cannot start flight, maintain an empty-fuel hover, or trigger another roll. Normal flight still consumes 14% per second.
- Q / E, or the corresponding touch buttons, trigger one left/right longitudinal 360° barrel roll. It requires active flight, at least 2.6 m altitude, 8% energy and no roll cooldown.
- The 1.15-second maneuver eases angular acceleration and deceleration; camera roll stays level. Holding a key does not repeat the maneuver. Release and press again after the 2-second cooldown.
- Releasing F mid-roll completes the paid maneuver upright, then descends. Fuel exhaustion cannot leave the car upside down indefinitely or create an infinite-hover exploit.
- Collision clearance includes the rolling body's lower swept extent. Traffic collisions remain active during low takeoff/landing.

These are deliberately bounded arcade controls, not Tesla engineering specifications, a physically exact thrust simulator, or a claim of real-world safety.

## Graphics

The opaque geometric cones were removed. One bounded instanced particle batch emits original soft, irregular, pale vapor from the actual transformed nozzle sockets. Existing particles remain in world space as the vehicle rolls; main downward support plumes are reduced when inverted, with brief corrective puffs. Landing output persists during descent, rises near touchdown and then fades instead of switching off as soon as F is released. Ground wash is deflected above the asphalt, with no separate reflection/depth pass.

Traffic retains four distinct types and shared geometry/material templates, but now has curved body/cabin sections, shaped wheel arches, rounded glazing and profiled tires. Broadleaf trees replace faceted ball crowns with original alpha-filtered leaf clusters; rocks use smooth weathered normals. The accepted lake and mountain/sky background are unchanged.

This is an incremental step toward more natural graphics, not a replacement of the engine or a promise of photorealism. Particle transparency and the additional foliage texture have a real GPU cost; physical-device FPS remains unmeasured.

## Matched rendering cost

At the same 125 m position, camera, lighting, three traffic vehicles and production pixel budgets, full submitted draw calls including shadows remain 204. Submitted triangles change from 237,026 to 235,782 (about 0.5% fewer), not a doubling. Grounded texture objects increase from 18 to 19 for the 512×512 leaf texture (approximately 1.33 MiB RGBA including mipmaps). Active vapor loads one additional 96×96 texture and uses one instanced batch capped at 160 desktop / 112 compact particles. The leaf cards trade geometry for alpha overdraw; rounded traffic increases per-car geometry. These are explicit costs, not a claim that this revision raises hardware FPS.

Raw matched metrics and input-scenario results are in `docs/realism-metrics/`. Counters are reset immediately before each complete rendered snapshot, including shadows.

## Verification and sources

- `npm test`: 92/92 tests pass.
- `npm run check`: 20 JavaScript modules, 0 errors.
- `npm run build`: succeeds.
- Desktop keyboard and mobile touch checks pass for actual roll, upright recovery, descent thrust and landing. Layouts 390×844, 844×390, 480×320 and 280×640 show no horizontal overflow or offscreen controls. Mobile portrait flight status is compact so it does not obscure the car.
- Browser runs report no JavaScript or WebGL shader errors.


Unit tests cover roll gating/directions/no-repeat, upright recovery, touchdown deceleration, finite landing reserve, fuel exhaustion, revive reset, honest speed behavior, input independence and bounded particle lifecycle. Browser checks use real keyboard/touch handlers with a controlled clock and an initial safe traffic fixture. They inspect actual roll orientation, powered descent, landing and desktop/mobile layouts, and collect JavaScript/shader errors. Controlled-time captures are not real-time FPS measurements.

- Official Tesla clip, “The Kickflip | Roadster”: https://www.youtube.com/watch?v=r5vsHHPVhJg
- Official Roadster presentation: https://www.youtube.com/watch?v=qt5p-_tE8d0

Used to understand the type of maneuver and visual direction. No video frames, manufacturer model, smoke image or third-party vehicle mesh is copied into these new effects.

No GitHub push or Yandex publication was performed. Real-device performance, Safari/WebKit and live Yandex SDK/ad behavior remain release checks.
