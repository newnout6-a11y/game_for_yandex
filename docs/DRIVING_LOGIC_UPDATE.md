# Driving and traffic logic revision

## Scope and reference

The reference is the interaction vocabulary of SKGames' [Traffic Racer](https://www.skgames.com/traffic-racer.html) and its [developer App Store listing](https://apps.apple.com/us/app/traffic-racer/id547101139?platform=ipad): continuous touch/keyboard steering, acceleration/braking and requesting slower traffic to make room. No proprietary implementation, assets or claimed factory vehicle dynamics are copied. This remains accessible arcade driving with geometric wheel/axle consistency, not a tyre-force or autonomous-driving simulator.

## Player response

See [measured response and reproducible probe](ARCADE_HANDLING_UPDATE.md). Full steering now requests a bounded 4.2 m/s lateral intent rather than an angle whose sideways speed grows indefinitely with forward speed. Wheel curvature, rear-axle path, visible steering and body response stay coupled. Release countersteers smoothly; there is no lane snap or lane-centre attraction. The one-thumb pad follows overflow beyond full lock, so returning the thumb immediately reduces steering instead of repaying invisible saturated travel. Brake, throttle and steering remain independent input owners. Flight/roll and the existing landing/wing/cockpit contracts are unchanged.

## Traffic awareness

- Stable per-ID driver traits vary preferred pace, reaction allowance, following time, minimum gap, patience and politeness. Thinking does not consume reward/spawn randomness.
- Longitudinal planning senses the closest leader, player and static hazards in all occupied/reserved lanes. It derives a stopping-distance ceiling and comfortable headway, then applies category acceleration/braking bounds.
- Lane choices weigh progress, obstacle avoidance and a horn request. Both source and destination are checked over the complete signalled, curved maneuver, including the player's reachable acceleration/braking envelope and the semi's longer footprint. Unsafe requests are refused rather than forcing an opening.
- Waves vary vehicle kinds with local repetition/heavy-count constraints and staggered placement. A moving, finite corridor replaces a globally forbidden lane. If the next corridor cannot be reached safely, a wave is deferred; traffic does not teleport aside.
- Roadworks are installed only where every existing approaching driver has room to react and brake. They also cannot overlap the finite passage already promised to the player. Convoys stage both braking-aware car insertions and a reachable open passage across their full actual span, using the planned 6 m/s braking target rather than initial cruise speed. A bounded set of layouts is tried; infeasible events defer atomically and retry after 0.5 simulation seconds, not every render frame.

The planner is deterministic and rule-based, not a claim that agents possess human understanding. The user can still crash by driving into traffic or ignoring a signalled closure. Conservative safety can decline an overtake or horn yield; no promise of a guaranteed escape from every player-created situation is made.

## Horn and light request

H or the visible touch horn button emits one short two-tone pulse and simultaneous player headlamp flash. Holding it does not spam; cooldown and simulation pause are shared. Sound goes through the existing lifecycle-muted master. Five owned vehicles use their authored front lens positions and isolated materials. Two non-shadowing player-only spotlights are added; no new model, shadow map, reflection camera or extra mesh draw is introduced. Their per-pixel shader cost is real and is not presented as an FPS improvement. Native-device GPU performance remains unmeasured.

Horn perception ranges from 90–230 m according to closing speed and the reaction/signalling/maneuver time needed. Drivers react only after a delay and only if a complete safe maneuver exists. A request is not traffic priority and cannot rescue an already late approach. The same safety rules apply on keyboard and touch.

## Results and persistence

See [reward policy](RESULT_CHOICES_REWARD_POLICY.md). Free finish and keeping the ordinary earned reward is the primary first action. Optional rewarded continuation and optional exact ×2 driving-credit settlement are separate mutually exclusive choices. Contract/onboarding/season grants and XP are not doubled. Real reward callbacks and the existing profile/run ownership checks are required. No SDK means no pretend rewarded payout. Automatic interstitial cadence remains a separate safe results transition; the free finish action itself does not demand an ad.

## Mobile entry

Short landscape layouts use the actual game iframe dimensions, not the physical phone display. The oversized slogan is visually hidden while its accessible heading remains; route selection and two ≥48 px entry actions have reserved non-scrolling space. This specifically fixes narrow Yandex wrapper viewports. Guest cloud status and the blocking portrait-rotation gate remain intact. The desktop 1440×900 layout is pixel-identical before/after this HOME-only CSS addition.

## Garage mural

The original pink art is no longer projected across the segmented gate. It is a single complete UV quad on the continuous concrete side wall in all four editable Blender rooms. Other room geometry, TV footage, materials and images are unchanged. `art/garage/mural-placement-audit.json` records backing rays and preservation checks. Existing columns may genuinely occlude a wall from some angles; they are not hidden to fake the result.

## Verification methods

- `node scripts/measure-player-handling.mjs`: deterministic response measurements, not human usability study or factory telemetry.
- `node --test tests/traffic-planning-scenarios.test.mjs`: six 150-second seeded production runs, every 1/120-second step tested with actual body/tractor/trailer oriented collision rectangles. Includes generated events, varied constant player-speed envelopes and traffic-density/corridor checks. These NPC safety probes deliberately disable only player crash removal so a fixed-lane test driver cannot terminate the observation; they do not prove a careless human player cannot collide.
- `node scripts/driving-logic-qa.mjs`: actual production renderer and input handlers in isolated browser profiles; explicit controlled-time simulation and identified horn-yield fixture. Native PNGs are not claims of real-time software-renderer FPS.
- `node scripts/result-choices-qa.mjs`: actual controller/UI and a clearly synthetic SDK transport. No real user data, advertisements, cloud account or payment is used.
- `node scripts/home-entry-layout-qa.mjs`: production HOME presenter inside a narrower iframe, 15 viewport/text-scale combinations, 44px minimum targets, actual action dispatch, guest footer and portrait recovery. `HOME_ENTRY_LEGACY=1` reproduces the old hidden-button failure.
- `QA_MODE=views node scripts/driving-logic-qa.mjs`: native production 3D HOME at 1280×720, 560×315 and 844×390 plus all four final mural rooms.
- Unit coverage includes wrong/stale profile, cloud replacement, repeated callbacks, continuation/double exclusivity, failed persistence, input ownership/cancellation, frame-rate response, safe spawn/event deferral and imported finite-state guards.

Final local verification: **964/964 automated tests**, source check: 0 errors and static build: 128 files. Browser snapshots and the 6s/144-frame 1280×720 demo use explicitly controlled simulation time, not a measured mobile frame rate. The demo starts with an identified safe traffic fixture and then uses only production simulation and real keyboard events; it is not a claim about average random traffic density. No native mobile hardware performance measurement was available.

Production publication and Yandex draft replacement remain separate steps, with clean latest-head review required before the draft is updated. No moderation submission, public launch, real-money configuration or new licensing claim is part of this revision.
