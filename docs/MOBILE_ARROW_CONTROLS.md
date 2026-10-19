# Mobile arrows and nitro

The landscape phone driving layout uses held left/right arrows, independent gas/brake pedals, and retained flight, roll, horn and cockpit-glance controls. Normal steering/pedal targets are 52 CSS pixels; auxiliary and narrow-host targets are at least 44. Eligibility uses the real viewport, touch capability and coarse primary pointer, not desktop width alone. The portrait gate and desktop keyboard controls remain unchanged.

## Nitro cause and correction

Previously lifting the finger from the combined gas/steering pad removed throttle. The separate nitro button still registered boost, but the simulation correctly required throttle. This is a demonstrated interaction conflict, not proof of the exact gesture used on a particular phone.

A touch nitro press now stores one `touchBoost` owner in `DrivingInput`. That owner contributes throttle and boost together. It is not a persistent auto-throttle setting. Releasing/cancelling that pointer removes both contributions without clearing another gas, steering or keyboard owner. Mouse and keyboard Space retain their existing boost-only behavior.

The simulation still requires reserve, ground contact, speed above 5 m/s and no brake. Holding touch nitro from rest first accelerates normally, then boosts after the threshold. Brake always wins; airborne flight cannot gain ground boost. At the exact simulation substep that drains the shared boost/flight reserve to zero, a synchronous `boost-empty` event disarms only touch boost. The application supplies a live control sampler between 120 Hz substeps, so even a pickup later in the same displayed frame cannot reactivate that hold. Snapshot callers, physics tuning and independent keyboard owners retain their behavior. A fresh press is required. Independent gas remains held if another finger owns it.

The HUD reports actual boost state separately from pressed styling: active acceleration, initial acceleration, braking, airborne, empty and ready. Help text describes the distinction.

## Verification

- `node --test tests/mobile-arrow-controls.test.mjs tests/mobile-arrow-layout.test.mjs` exercises actual application pointer/keyboard/window handlers, lifecycle callback, `clearInput`, tick, HUD, `DrivingInput` and `Game`, including depletion followed by a real pickup.
- `node scripts/mobile-arrows-qa.mjs` uses trusted Chromium CDP touch events in a host-constrained iframe, the actual game pipeline and renderer, and an isolated empty-road fixture. It checks multitouch ownership, cancellation, brake priority, depletion, pause/orientation and visible hit targets at mobile sizes. Reports pin runtime source hashes.
- Existing garage-flow and driving-logic harnesses now use arrows/pedals rather than the retired thumbpad. The old standalone thumb module/tests remain historical, but are no longer mounted or loaded by the production shell.

Chromium's legacy `CreateWebTouchEvents` and newer synthetic-pointer backend differ in selective release semantics. The native driver first uses the legacy released-point `touchEnd`, with a fallback only after the newer backend's explicit validation rejection. See the [official Chromium implementation](https://raw.githubusercontent.com/chromium/chromium/main/content/browser/devtools/protocol/input_handler.cc). This is a test-driver compatibility detail, not production input logic.

Software-rendered screenshots and controlled simulation seconds are not Android FPS, latency, thermal or battery measurements. No real account, save, ad or purchase is used.
