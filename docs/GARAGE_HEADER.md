# Open garage header and stage-corner car title

The garage/customization header has no continuous backdrop or divider. Roadster
and the wallet/settings controls retain their original edge positions. A small
text shadow supports those labels without covering the center of the 3D garage.
The hub and results keep their existing header backdrop.

## Selected-car title

The annotated user placement supersedes the earlier title lift and rejected
under-panel position. The single dynamic selected-car h1 now sits at the
bottom-right of the open 3D stage, LEFT of the workbench and opposite the
inspection toolbar. The right panel retains its original full-height column.
The italic typeface is unchanged. The title is part of the stage's normal-flow
bottom layout, not a fixed label over catalog items or the save-status footer.

The toolbar and title wrap according to their actual available width, so narrow
desktop windows and landscape phones get separate rows rather than overlapping
controls. At 600–700px short landscape widths the same italic type uses 20px to
keep the longest car name readable within the narrow stage. Inspection buttons
remain at least 44px. The complete bottom layout is excluded from car framing.

A hidden, aria-hidden text-sized reservation preserves the original upper
car-fit boundary, including wrapped names on narrow screens. It is neither a
second heading nor a focus target. The actual h1 retains tabindex=-1 and the
presenter focus marker, stays before the panel h2 in reading order, and uses
selected.name for all five cars. The title is independent of catalog scrolling.

The game wordmark, wallet, settings, equipped-season badge, header dimensions
and responsive behavior are unchanged. No inventory, currency, progression,
vehicle, SDK or race-physics change is made by this presentation adjustment.
The mobile portrait gate remains blocking.

## Verification

- `tests/garage-header.test.mjs`: transparent garage header, real controls and
  wrapped stage docking without a font replacement or control overlay.
- `tests/garage-ui.test.mjs`: one dynamic accessible h1 for all five selected
  vehicles; hidden reservation and independent panel/title ownership.
- `node scripts/garage-header-qa.mjs`: actual production screenshots and measured
  bounds at 1440×900, 1101×700, 844×390 and 667×375, settings, catalog scrolling,
  dynamic selection, tab changes and the blocking 390×844 portrait gate.

The native harness asserts the title lies inside the stage, left of the panel,
above the footer and separate from all controls, with 44-pixel touch targets
and no horizontal overflow. Optionally set HEADER_COMPARE_REPORT to a previous
`garage-orbit-qa.mjs` report to compare the rear camera and upper car-fit bounds.
Stacked mobile controls legitimately reserve more vertical space. The harness
uses isolated local inventory and controlled scene time, not an online account.
Output defaults to `output/garage-header/`; override with HEADER_QA_OUT.

The default browser is the installed Chrome channel. CHROME_BIN selects another
installed Chromium; SOFTWARE_WEBGL=1 enables the established software-rendering
QA route. These captures are not hardware FPS measurements. Current complete
suite/check/build totals are recorded in the immutable release manifest.
