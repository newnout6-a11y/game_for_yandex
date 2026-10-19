# Open garage header and car-title spacing

This narrowly scoped presentation update removes the continuous top backdrop and
divider from the garage/customization screen. Roadster remains on the left and
the wallet/settings controls remain on the right. A small text shadow supports
the edge labels without covering the center of the 3D garage.

The selected car name is lifted by 20 CSS pixels on desktop, or 8 pixels on short
landscape screens, as a separate requested adjustment. Its original typeface,
size and horizontal position are preserved. This is a title-only transform: the
3D stage, camera framing, navigation and customization panel do not move.

The override is restricted to `.garage-shell[data-screen='garage']`. Header
height, padding, responsive rules, hit targets, focus behavior and DOM order are
unchanged. The hub and results retain their existing backdrop. An equipped
season badge still appears; this is not an inventory or equip operation.

No vehicle, garage asset, save schema, currency, progression, SDK integration,
simulation or camera behavior changed.

## Verification

- `npm test`: 725 passing tests, including five header/title regressions and 14 pinned-baseline/parity tests.
- `npm run check`: 52 source modules checked, zero errors.
- `npm run build`: 111 build files.
- `node scripts/garage-header-qa.mjs`: actual production garage rendering and
  controls at desktop and touch-landscape sizes, plus the portrait rotation gate.

Native verification passed at 1440×900 and 844×390 with matching drawing buffers,
plus a 667×375 landscape layout and the blocking 390×844 portrait gate. Settings
open/close correctly and do not alter the profile. Header controls remain at least
44×44 CSS pixels, with no horizontal overflow or changed element bounds. Pixel
comparison of the initial backdrop-only step found no changes below the original
82 px desktop / 54 px phone header. The final requested title lift is also checked
against the previous title bounds and font; it leaves at least 20 px of vertical
space beneath the game wordmark.
The phone retains its existing centered wordmark and left back button; this
update does not rearrange the responsive layout. No browser errors were reported.

The default command always runs the matched before/after comparison. It loads
`tests/fixtures/garage-header-baseline.css`, pinned by SHA-256 to the accepted
pre-PR5 stylesheet at commit `28955fa9c838efe8537c88334ca23e09f7cf65aa`.
Missing or modified baseline bytes stop the command before browser launch;
`HEADER_BASELINE_CSS` may relocate only those exact bytes. It cannot disable
comparison or accept the changed stylesheet as its own reference.

This historical PR5 test intentionally isolates a CSS-only edit: the same DOM,
modules, assets, scene and viewport are captured with the pinned stylesheet,
then the current stylesheet. Both frames are mandatory. Header/control geometry
and title typography must match; the only allowed title movement is the approved
20/8 px lift. Negative tests verify that changes to control positions, title
width or font cannot pass. These historical title positions must not overwrite
later intentionally changed layouts when descendant branches are synchronized.

It uses an isolated local tier-four inspection save and a paused browser clock;
it does not modify cloud progress or production code. Native PNGs, the baseline
commit/hash, and computed bounds are written to `output/garage-header/`.

The default browser is the installed Chrome channel. Set `CHROME_BIN` to another
installed Chromium executable when needed. `SOFTWARE_WEBGL=1` enables the
software-rendering QA route; these captures are not hardware FPS measurements.
