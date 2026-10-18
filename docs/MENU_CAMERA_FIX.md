# Paused-race menu camera fix, 18 October 2026

## PR3: return from a paused race to the menu

Reproduction on the published PR3 source (`c4af128`): start a run, drive, pause, then choose **В главное меню**. The controller intentionally sends both `menu: true` and `paused: true`: gameplay must remain stopped while the menu presents the car. The renderer previously converted every paused frame to camera `dt = 0`, leaving the driving framing under the route cards.

The chase helper now distinguishes a paused race from menu presentation. A paused race retains zero camera time; a menu may use presentation time to return to its preset. Reduced-motion menus snap to the preset on the first frame, before the existing static-menu rendering optimization skips subsequent frames. No physics, lifecycle pause reasons, ad callbacks, controls, car geometry or camera presets changed.

### Regression checks

- Three new unit tests cover desktop/mobile menu presets, reduced-motion first-frame settling and unchanged paused-race pose/state.
- Actual Chromium runs exercise start → throttle → pause → main menu from both chase and cockpit, with and without reduced motion. The same four cases reproduced the pre-fix error, including the car hidden by the route cards.
- During the held pause, camera position and chase scalars, run distance and run elapsed time remain unchanged. After returning to the menu, elapsed gameplay time remains unchanged and the menu framing matches the initial menu.
- Captures use the real production controls and scene with a controlled clock. Intermediate GPU draws are omitted for deterministic software-renderer testing; each saved PNG is an actual rendered frame. This is not a real-time FPS benchmark.

The dependent garage branch uses its own GarageScene for its hub/menu, so the reported framing failure is specific to the older PR3 flow. The equivalent shared chase-helper correction is carried forward without replacing the garage renderer or controller.

Final validation: all **381** PR3 tests passed; source check reported **0 errors**; the production build completed successfully.
