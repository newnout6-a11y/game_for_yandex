# Compact landscape garage

The Android/Yandex screenshots exposed a real layout conflict: the old narrow-screen rules combined a header, a tall navigation strip, a minimum 225px car stage and a second panel row. At 560×315 the catalogue began at y358, below the footer at y279. Making that row scrollable did not make its controls visible.

This revision is limited to the garage presentation. HOME, driving, vehicle geometry/materials, progression, cloud ownership and advertisements retain their accepted behavior.

## Composition and density

- The actual game iframe decides the layout, not the phone's screen width. Landscape garage viewports up to 1100px wide and 620px high use the compact presentation.
- One measured top band holds navigation, Home, balance and settings. Mini-scene icons remain real animated UI elements; they are not replaced by different menu actions.
- The car stage and workbench stay side by side. The workbench has its own bounded scroll area, but its first screen is also deliberately denser, rather than hiding the desktop's initial choices below that scroll.
- Paint samples become compact material chips. The fleet retains actual shared-renderer 3D miniatures. Contracts, rewards and engineering values are reflowed without changing prices, eligibility, progression or claims.
- Compact navigation, inspection, class selectors and the Fleet Drive/Purchase action use at least 32px targets; paint chips and contract actions retain at least 44px targets. No whole-page transform or browser zoom disguises the layout problem. Text can grow and longer content remains reachable.
- The selected car's existing typeface and lower-right stage placement are preserved. Room-aware camera fitting uses the real clear stage above the inspection strip and title, including enlarged text and guest/footer height.
- A small positive clear area never falls back to the old fabricated 60px camera rectangle underneath the controls.
- Horizontal navigation/inspection/category offsets and the independent Fleet-list vertical offset survive a same-context presenter update. Changing screens or vehicles resets vehicle-specific strips; keyboard focus restoration remains independent.
- Miniature visibility intersects the nested Fleet scrollport as well as the outer panel, so clipped cards do not keep rendering.
- The landscape-only blocking gate is unchanged. Safe-area insets are respected inside the compact layout.

## Verification method

The native QA uses the production modules and actual authored models inside a smaller iframe, with an isolated synthetic profile. It exercises real selection/equip/research/claim controls; it never reads or edits a real account. Fullscreen and browser-wrapper dimensions are not confused with the iframe's CSS-pixel budget.

The desktop reference is 1440×900. Its first workbench screen contains four full fleet entries, four paint choices and Reset, five engineering parameter rows, two contracts, and five complete season rewards (the sixth action is also visible). Normal mobile layouts are checked against those initial quantities, with six whole season tiles in the smallest standard case. Mobile comparisons count these semantic items, not decorative pixels. Rims, cockpit and glass are checked separately against their desktop first-screen actions, not inferred from the paint tab. The whole catalogue is not claimed to fit: it also scrolls on desktop.

The font test clears all previous inline font overrides before applying 100/125/150% to each case. It cannot accumulate inherited font scaling between iterations. Actual camera-region containment, selected offscreen-control reachability, panel bounds and authored-model bounds are checked separately.

Captures use controlled time and software WebGL. They establish geometry, content and interaction behavior, not physical-phone FPS, browser-vendor certification or an advertising/account integration result. Enlarged text and exceptionally small iframes necessarily require more scrolling than normal text.

## Header paint regression

The inherited desktop workbench shadow extended 45px beyond the narrow panel. In the native Chromium/software-WebGL check it caused part of the top navigation to disappear even with a normally running animation clock, while DOM hit tests remained correct. A fresh-context test with only that compact shadow removed restored the initial paint. The mobile panel retains its border/background; desktop shadow styling is unchanged. `GARAGE_PAINT=1` retains each initial full screenshot before a forced navigation-element repaint and compares the pixels, so a repaired later screenshot cannot conceal the regression. This is a verified browser paint interaction, not a claim that every Android GPU has the same defect.

## Accepted checks

The final source passed 1,067 tests, the 64-module source check and the 131-file static build. Evidence contains 63 native main-view frames, 12 matched subcategory cases, 90 font-layout cases plus 90 final-layout confirmations, 60 ownership/footer density cases and 125 authored-geometry framing poses. The unchanged desktop Atelier reference is byte-identical to the complete baseline capture. All five live navigation pixel checks passed: at most 1 changed pixel out of 23,920, versus 11,015 changed pixels in the retained pre-fix negative control. No real-device performance result is inferred from these checks.

## Reproduce

Run `npm test`, `npm run check` and `npm run build`.

Run `node scripts/mobile-garage-qa.mjs` for the native iframe checks. `GARAGE_GUEST=1` includes the taller guest footer; `GARAGE_STARTER=1 GARAGE_QUICK=1` captures the real starter prices without granting an unlocked test catalogue. `GARAGE_FINISHING=1` checks matched Rims/Cockpit/Glass action visibility and narrow season-label wrapping; `GARAGE_DENSITY=1` records matched first-screen contents across desktop and standard phone sizes. `CHROME_BIN` selects an installed browser; otherwise the Chrome channel is used. `SOFTWARE_WEBGL=1` selects the established per-process software-rendering route. `GARAGE_BASELINE_ROOT` optionally points to a complete prior source tree for before captures: HTML, modules, vendor files, models, styles and the profile fixture factory all come from that tree. `GARAGE_DESKTOP=1` captures a fresh desktop-only view for pixel comparison. QA output remains in ignored `output/`, never in the public production ZIP.
