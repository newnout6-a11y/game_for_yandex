# Responsive arcade handling and contact response

Base: PR8 `41c1473d4b9cc6856bd5a71beb1e2004673b58f5`. This is a lightweight arcade model, not manufacturer data or a reproduction of another game's source. Garage, HUD controls, authored assets, save schema and reward tables are unchanged.

## Handling

The previous controller derived heading from a desired 4.2 m/s lateral speed and integrated an exact no-slip arc. It had no independent lateral momentum for an impact to change. Its lane-coordinate hard clamp could also align the car before the visible rail.

The new fixed substeps (at most 1/120 s, existing 0.1 s frame cap retained) carry road-forward/lateral velocity, heading and yaw rate. Front/rear tire contact velocities include yaw about the actual axle offsets. Bounded lateral grip and steering drag turn velocity after the body/rack, rather than directly assigning a lane or lateral position. A restrained road-heading assistance supplies steering intent and stabilizes release; it is deliberate arcade assistance, not lane snapping. The finite grip allowance is 1.4 times each vehicle's catalog value, preserving relative setup differences. Low-speed parking steering, airborne control and existing boost/brake rules remain distinct.

The body and wheels read the same simulation heading/rack/acceleration. The old exact-arc helper remains only as a tested utility, not the live player controller. High-speed response improves without removing momentum: at initial 52/65 m/s the 0.4 s pulse reverses in approximately .333/.325 s (previous .383/.383 s), with 3.5 m traversal .942/.933 s (previous 1.05 s). These are deterministic isolated controller measurements, not phone touch latency or FPS. At 28 m/s initial 0.1 m response is slightly slower; no claim that every metric improves.

## Contact geometry and timing

- Cheap nearby-entity filtering precedes continuous oriented-rectangle queries.
- Fixed-orientation translating SAT computes a common time of overlap, fixing the previous union of lateral and longitudinal overlap from different times.
- Rotating queries use bounded adaptive interval refinement. They report `unresolved`, never turn an expanded broad-phase box into a confirmed hit. The caller clips to the last proven time if its budget is exhausted.
- Rocket uses nine measured body/wheel/mirror primitives instead of extruding its widest mirror along the entire nose. The exact unchanged GLB and measured bounds are recorded in `handling-contact-metrics/rocket-compound.json`. Wheel steering/spin envelopes are analytic; body/aero measurements include listed poses. These filled boxes are conservative proxies, not exact correlated triangle silhouettes or a formal proof over every cosmetic/suspension pose.
- Other selected cars retain their configured dimensions. Traffic uses its actual authored catalog sizes and separate articulated tractor/trailer rectangles.
- Player roll uses the render pivot at 0.58 m and per-part vertical bounds. It samples at most .01 rad per rolling interval; the local projected-bound chord error at this asset scale is below .03 mm. This is an explicit bounded approximation, not exact nonlinear 3-D CCD. The upright ±2π→0 reset is unwrapped.
- The initial pose is captured before flight integration, preserving vertical contact timing. Exact touching is not penetration; positive grazing gaps are not collisions.

## Response and lifecycle

At the earliest contact, normal impulse, low restitution (.12), clamped friction (.22), angular leverage and mass-weighted overlap correction are applied; remaining substep time is resolved, up to six solid contacts. Traffic momentum survives normal steering updates. A three-millimetre contact-patch allowance is used only after a confirmed hit to stabilize nearly parallel bumper impulses; it does not enlarge the collision test.

A mirror-only contact is compliant trim: one nonterminal scrape cue and hazard accounting, no rigid chassis impulse or time-blocking constraint. Body/wheel geometry of that same vehicle remains active. No cosmetic break-off system was added.

Only normal closing speed ≥10 m/s AND player normal impulse equivalent ≥7 m/s cause the existing terminal crash. Mild impacts remain playable. This is an arcade severity policy, not an injury model. Presentation cooldown throttles sound/sparks only, never contact geometry or dirty-event accounting. Existing revive invincibility remains the explicit ghost interval.

Terminal impacts coast/rotate during the existing .65 s results delay without reading held input or earning time, distance, score, pickups or passes. Signed scene travel keeps scenery coherent; all positional depenetration, including positive corrections, is excluded from paid progress. Reset/revive clear momentum as before. Reward settlement/ad/save entry points are unchanged and separately tested through the real controller lifecycle.

A contacted traffic entity cannot later earn a near-miss bonus. Physical `contact` is separate from audiovisual `impact`; clean-road and clean-flight accounting does not depend on feedback thresholds. Touchdown notification is deferred until contacts in that same substep are accounted for. Low-altitude takeoff contacts remain dirty through landing. This closes new contact-related reward loopholes without changing reward values.

## Research used

- Fixed small simulation steps: https://gafferongames.com/post/fix_your_timestep/
- Speed/command-dependent steering response: https://nvidia-omniverse.github.io/PhysX/physx/5.1.1/_build/physx/latest/struct_px_vehicle_steer_command_response_params.html
- Collision shape casts, TOI and rotational limitations: https://box2d.org/documentation/md_collision.html
- Contact impulse and Coulomb friction: https://gafferongames.com/post/collision_response_and_coulomb_friction/
- WebGL/mobile resource constraints: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices

No additional physics engine, render context, shadow pass or asset was introduced. CPU measurements are environmental checks, not claims of Android performance. Native gameplay rendering/touch-feel acceptance remains a separate gate; deterministic tests alone do not certify it. The standalone preview fixture is QA-only and excluded from the production archive.
