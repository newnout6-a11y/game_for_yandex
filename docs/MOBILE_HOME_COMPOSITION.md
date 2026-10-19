# Mobile HOME composition

This revision changes only the compact landscape HOME presentation. It does not alter vehicle geometry, paint, driving/flight cameras, handling, garage inspection, economy, account ownership or saves.

## Layout and framing

- The route selector and the two entry actions fit their content rather than occupying a 260px selector and 480px action row.
- Each action and the route select retain a minimum 44×44 CSS-pixel hit target. Text can grow without a transform that shrinks the target.
- `homeVehicleFraming()` measures the actual header, route, vehicle label, action row and footer in the game's viewport. It first uses the clear right-hand column, then the space above the actions or below the route when enlarged text requires it.
- The existing room-aware `GarageScene` camera fits the complete authored car to that rectangle. Its eye, safe room bounds and vehicle transform are unchanged; the lens/view offset does the HOME-only composition work.
- Compact means landscape and either height≤620px or width≤900px, matching the existing HOME CSS. Normal desktop returns the original camera framing. Results, garage inspection and driving never call this helper.
- No additional renderer, model copy, texture, continuous animation or per-frame geometry pass is introduced. Browser regression measurement of vertices is test-only.

## Verified evidence

The original 560×315 frame used an 83.475px-high fit strip. The actual rendered Rocket occupied 114.57px of width. In the corrected frame it occupies 233.45px (2.04×), while the action row is 237.44px rather than 480px. The entire body is clear of the route, title, actions and footer.

At 667×375 the Rocket width is 320.62px rather than 136.39px. At 844×390 it is 356.59px rather than 393.17px: that wider previous view was not the tiny-car defect, and the new bounded composition leaves all five vehicles clear of the header and controls rather than blindly zooming everything. The 1440×900 desktop camera and native PNG match the baseline exactly.

Verification:

- 1,027 automated tests pass, source check reports 0 errors, static production build succeeds.
- 160 actual-GLB fit/safety poses cover five vehicles, four compact sizes, normal/150% text geometry and four orbit headings.
- 17 native production-renderer PNGs cover all five vehicles at 560×315, 667×375 and 844×390, desktop, and 150% text.
- 15 actual smaller-iframe DOM cases cover five sizes and 100/125/150% text. Both actions remain visible and clickable without scrolling; a taller guest footer and the portrait blocking gate are also checked.
- No browser page/WebGL/shader errors were observed in those captures. The isolated software-WebGL renderer used a controlled clock; this is not a physical-phone FPS or GPU benchmark.

## Reproduce

Run `npm test`, `npm run check`, and `npm run build`.

Run `node scripts/home-entry-layout-qa.mjs` for the actual iframe/presenter checks. Run `node scripts/home-composition-qa.mjs` for actual production-model views. `CHROME_BIN` selects an installed browser; otherwise the scripts use the Chrome channel. `SOFTWARE_WEBGL=1` selects the existing per-process software-rendering QA route. `HOME_BASELINE_ROOT` optionally points at a prior complete source tree for matched before views. Output remains under the ignored `output/` directory, not in the public build.

## Narrow iframe and complete-baseline review corrections

At 320px width, the old 49% dock cap could truncate the selected route even when a native select reported no horizontal overflow. The route now keeps its intrinsic text width up to the actual container width. Below 400px, the optional vehicle caption and decorative action icons yield to readable labels; below 220px height, decorative vertical spacing yields before the 44px controls. The car is fitted to a measured clear side rectangle rather than falling back to an overlapping default camera. Extremely small, text-enlarged iframes necessarily leave a smaller car area; no control or text is scaled down to disguise that constraint.

The native DOM matrix now covers all three selected routes at seven sizes, 100/125/150% text and both connected/guest footers: 90 cases. It measures the selected label using the actual computed font and subtracts both padding sides and borders, in addition to checking click targets, text boxes and overlap. Actual-model views separately cover all five vehicles at 320×240 and 320×180, with 150% text views for the Rocket.

`HOME_BASELINE_ROOT` now serves one complete immutable source tree. HTML, imported modules, vendor dependencies, models, styles and the synthetic profile factory all come from that root. Missing baseline files fail instead of borrowing current-checkout files. The inspection hook is appended only to that tree's entrypoint. Regressions use deliberately incompatible fixture revisions to verify this isolation.

The earlier comparison substituted only `main.js` and `garage.css`; those happened to be the only relevant changed runtime inputs for that revision, but the method was not generally reliable. Fresh complete-tree before captures reproduce all four original camera and vehicle measurements. Three PNGs are byte-identical; the 667px image differs at one pixel by five summed channel levels. The fresh complete-tree captures supersede the old mixed-server evidence. No cross-version compatibility or hardware-performance claim is inferred from the old method.

The review pass also checks a returning-player guest footer with the longer start label in four actual renderer captures (both320px sizes at normal/150% text). Twenty additional actual-GLB fits cover all five cars under those guest/footer constraints. The final default560/667/844/1440px measurements match the previous accepted composition, including an identical desktop PNG.
