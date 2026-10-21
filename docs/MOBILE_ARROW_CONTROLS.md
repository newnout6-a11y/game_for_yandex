# Mobile arrows and nitro

The landscape phone driving layout uses held left/right arrows, independent gas/brake pedals, and retained flight, roll, horn and cockpit-glance controls. Normal steering/pedal targets are 52 CSS pixels; auxiliary and narrow-host targets are at least 44. Eligibility uses the real viewport, touch capability and coarse primary pointer, not desktop width alone. The portrait gate and desktop keyboard controls remain unchanged.

## Nitro cause and correction

Previously lifting the finger from the combined gas/steering pad removed throttle. The separate nitro button still registered boost, but the simulation correctly required throttle. This is a demonstrated interaction conflict, not proof of the exact gesture used on a particular phone.

A touch nitro press now stores one `touchBoost` owner in `DrivingInput`. That owner contributes throttle and boost together. It is not a persistent auto-throttle setting. Releasing/cancelling that pointer removes both contributions without clearing another gas, steering or keyboard owner. Mouse and keyboard Space retain their existing boost-only behavior.

The simulation still requires reserve, ground contact, speed above 5 m/s and no brake. Holding touch nitro from rest first accelerates normally, then boosts after the threshold. Brake always wins; airborne flight cannot gain ground boost. At the exact simulation substep that drains the shared boost/flight reserve to zero, a synchronous `boost-empty` event disarms only touch boost. The application supplies a live control sampler between 120 Hz substeps, so even a pickup later in the same displayed frame cannot reactivate that hold. Snapshot callers, physics tuning and independent keyboard owners retain their behavior. A fresh press is required. Independent gas remains held if another finger owns it.

The HUD reports actual boost state separately from pressed styling: active acceleration, initial acceleration, braking, airborne, empty and ready. Help text describes the distinction.

## Low-occlusion racing HUD artwork

The visual direction was selected after inspecting real gameplay HUD images from Asphalt Legends, CarX Highway Racing and Traffic Racer. Asphalt supplies the restrained circular, transparent control treatment; CarX corroborates a recognizable nitro-bottle symbol. Traffic Racer informs only the hollow steering-triangle and ribbed-pedal vocabulary, not its square button borders. The production SVGs are original drawings, not copied game assets.

Reference pages inspected:
- [Asphalt Legends gameplay review and screenshots](https://gamingonphone.com/reviews/asphalt-legends-unite-game-review/).
- [CarX Highway Racing official Google Play screenshots](https://play.google.com/store/apps/details?id=com.CarXTech.highWay).
- [Traffic Racer screenshot reference](https://rawg.io/games/traffic-racer/suggestions).

Still images establish appearance and composition, not pressed-state behavior. The held/active feedback below is this game's own design.

- The unchanged 52px steering/pedal hit areas show 48px circular artwork. Narrow hosts retain 44px targets. Secondary 44px targets show 36px circles; the nitro target remains 64px wide.
- Thin 1px white rings, white monochrome SVGs, and a 10%-opacity dark wash replace opaque rounded tiles, text arrows and pedal gradients. Each glyph is drawn in a common 32-unit canvas with 2-unit round strokes. No blur, group tray, heavy shadow or pressed-motion effect is added.
- Steering uses exactly mirrored hollow triangles. Brake and gas are distinct wide/long ribbed pedal silhouettes. Nitro uses a bottle and lightning mark; roll, lift, horn and mirror controls share the same vector family.
- An ordinary hold brightens the white ring and glyph with a restrained cyan wash. Actual boost, actual flight and rolling get cyan effect feedback. Nitro exhaust ticks appear only for `data-boost-state="active"` / `"boosting"`, not merely because a finger is down.
- Idle captions are visually hidden on mobile. Nitro's existing accessible description remains intact; a small caption is shown for actual acceleration, an empty reserve, or the reason a held boost cannot operate. Existing IDs, descriptions, held-pointer semantics and physics are untouched.
- All mobile SVG wrappers are hidden by default. Desktop arrows, labels and icons remain unchanged; mobile artwork is enabled only by the existing landscape/touch eligibility gate. Keyboard focus remains visible around the circular artwork.

Visual source assertions supplement, rather than replace, an actual rendered-game review. The native preview must be viewed before publication; source checks alone cannot approve appearance or prove device performance.

## Resize continuity

A browser toolbar or iframe resize that leaves mobile landscape eligibility unchanged retains the exact held pointer owners. It never synthesizes a new press. Real portrait/eligibility changes and the existing pause, blur, visibility and cancellation lifecycle still clear controls; returning to landscape does not restore a hold. Capability-change unit cases explicitly include a resize event; no independent media-query listener is claimed.

## Verification

- `node --test tests/mobile-control-visuals.test.mjs` guards original SVG markup, exact steering symmetry, pedal distinctions, desktop fallback, transparent circular surfaces, accessible state text and touch-target declarations.
- `node --test tests/mobile-arrow-controls.test.mjs tests/mobile-arrow-layout.test.mjs` exercises actual application pointer/keyboard/window handlers, lifecycle callback, `clearInput`, tick, HUD, `DrivingInput` and `Game`, including depletion followed by a real pickup.
- `node scripts/mobile-arrows-qa.mjs` uses trusted Chromium CDP touch events in a host-constrained iframe, the actual game pipeline and renderer, and an isolated empty-road fixture. It checks multitouch ownership, cancellation, brake priority, depletion, pause/orientation and visible hit targets at mobile sizes. Reports pin runtime source hashes.
- Existing garage-flow and driving-logic harnesses use arrows/pedals rather than the retired thumbpad. The obsolete thumbpad module, stylesheet, standalone tests, app selectors and garage test stub have been removed.
- `node --test tests/mobile-controls-cleanup.test.mjs` guards the removal and checks the current arrow/pedal samples in `node scripts/measure-player-handling.mjs`. The harness retains accepted/current physics and braking measurements, but uses the production `DrivingInput` for touch samples rather than a retired drag model.

Chromium's legacy `CreateWebTouchEvents` and newer synthetic-pointer backend differ in selective release semantics. The native driver first uses the legacy released-point `touchEnd`, with a fallback only after the newer backend's explicit validation rejection. See the [official Chromium implementation](https://raw.githubusercontent.com/chromium/chromium/main/content/browser/devtools/protocol/input_handler.cc). This is a test-driver compatibility detail, not production input logic.

Software-rendered screenshots and controlled simulation seconds are not Android FPS, latency, thermal or battery measurements. No real account, save, ad or purchase is used.
