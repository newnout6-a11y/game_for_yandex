# Roadster — product design and implementation boundaries

Status: original product/economy proposal, reconciled with the implementation on 18 October 2026. This document preserves design rationale; it is not a release acceptance report. The original design-only task preceded integration. Current runtime facts are identified below; future proposals are not functioning features. See [ROADSTER_GARAGE_UPDATE](ROADSTER_GARAGE_UPDATE.md) for the implementation inventory and pending final acceptance. Runtime catalog exports in `src/progression-catalog.js` take precedence over old draft JSON or simulation assumptions. Existing flight, cockpit, model quality and accepted car artwork must not regress.

**Superseded decisions:** the user selected the exact title **Roadster**. The original six-destination navigation and standalone «Телеметрия» section are also superseded. Current navigation is `fleet / style / engineering / contracts / season`; existing records and totals live in a collapsed results detail, while game-parameter comparison lives in Engineering. Earlier auto-throttle and five-display-space proposals are not the accepted implementation.

## 1. The game's own identity

**Promise:** master the seam between road and sky. Drive a convincing car through a mountain traffic route, choose a short powered escape, then return precisely to the road. A clean transition is more meaningful than remaining airborne. Build a real workshop that records how you drive, not a shop that sells permission to continue.

**Selected name:** Roadster, exactly as requested by the user, for both language contexts. Proposed taglines from the design phase were «Держи трассу. Забирай небо.» and “Hold the road. Take the sky.” Current local identity files are `public/brand/roadster-emblem.svg`, `roadster-wordmark.svg` and `road-wing-grid.svg`. Original artwork does not establish exclusive rights to the name. No reliable name-collision or trademark clearance is established here; naming and commercial rights remain unresolved release checks. Rejected candidate names and their old search notes are not evidence about Roadster.

**Vehicle rights gate:** keep the requested existing Rocket/Roadster model during development. Do not state that a disclaimer clears a manufacturer's design, photos, name or trademarks. No Tesla logo in game title, logo, product icon, store hero or new promotional copy. A render of our current model is not automatically commercially cleared. Before public release, resolve original-fictional adaptation versus licensed use with the owner. Do not silently replace their accepted car. No claim of affiliation, manufacturer-endorsed flight or real specifications.

**Original environment proposal (UI palette superseded):** a believable mountain test workshop, not a floating dashboard. Warm high windows, plaster and concrete, worn orange tool cabinets, green-grey machine enamel, a yellow-white floor approach line, authored steel lift, cables, tyre rack, exhaust extraction duct, service markings and bench instruments. Palette: graphite #20282B, chalk #EEE6D7, orange #F17740, glacier #9DCAD1. The accepted workshop architecture retains its original physical materials. The current interface instead uses cool ink, plum, lilac and rose with contrasting functional type, and the workshop walls carry the original pink-toned Rose Velocity mural. The earlier orange/chalk UI palette is not the current panel design.

## 2. Mastery loop and modes

1. Select a route and an optional contract, not an energy payment.
2. Drive, read brake lights, keep a usable return corridor, collect existing charge pickups and clear road events.
3. Rocket flight is a short tactical manoeuvre using the existing shared energy supply; duration depends on the actual charge and flight configuration, not a promised fixed range. Land and drive to set up the next flight. Ground-only cars solve the same space by braking and steering.
4. Finish or crash. Preserve earned progress, show what actually happened, optionally collect an explicit ad bonus, choose next run or garage.
5. Convert credits into a distinct car, visual part, modest calibration or a physical workshop expansion.
6. Compare a new run against your own same-class baseline. A clearer line and better timing should remain the greatest improvement.

**Original mode proposal, not three shipped modes:**
- «Маршрут»: existing endless road, safe immediate restart, current roadworks/checkpoint/convoy events.
- «Эталон»: same input/traffic family, stock physics, no continued run record. This provides comparable personal records. Do not advertise an online leaderboard until there is a real authenticated backend.
- «Полигон»: optional short low-density teaching/test-drive session. It gives no repeatable economy rewards and never consumes purchased resources.

Current play uses route/difficulty selection and standard/tuned record classes; «Полигон» and the proposed three-choice mode selector are not shipped features. Do not present an unimplemented mode as a functioning button. The new-car collection offers different challenges and silhouettes rather than buying an objectively superior replacement. Cars are record classes, not five points on a pay-to-win ladder.

## 3. Full-screen product flow

This remains one browser application, but not one long website page. Each state owns the canvas camera, navigation, input and pause lifecycle. No body-level page scrolling or buried play button.

- **BOOT:** logo, brief honest asset-loading status, accessible retry. Do not fabricate a percentage for unmeasured download bytes. Existing request-count progress can be described as «Готовность ресурсов». No own launch-ad request and no forced account creation. The platform may still show its own startup ad, so this is not a promise of no ads before the first race.
- **ENTRY:** selected 3D car in the garage scene; direct «На трассу» and «В гараж» actions. Route, difficulty, sound, render quality and camera preferences are persisted; a language selector is not claimed. No mandatory animation, carousel or shop visit before first play.
- **FIRST PLAY, original proposal:** contextual steering/braking/flight prompts and a special safe low-density first 500 m were onboarding targets, not verified implemented features. The implemented first-500-m grant is 200 credits once per profile.
- **GARAGE:** five navigation destinations and a real 3D room, with a working details panel and explicit inspection controls. Navigation/right-panel type is upright system sans; only the selected car title keeps italic Georgia. Illustrated mini-scenes animate finitely on hover/focus/selection, without an infinite idle carousel. Landscape mobile layout must preserve the car and actionable controls; portrait is blocked rather than presented as an alternative garage layout.
- **SETUP:** route/difficulty, selected car, standard/tuned («Заводской / Настроенный») record rules, one large start button. Standard disables upgrade effects but preserves purchased ownership. Selecting a ground car hides flight controls with a clear capability label.
- **PLAYING:** restrained HUD: speed, distance, charge/flight status, one contract hint, pause. Input begins only after the canvas and controls are ready. Camera modes retain existing mirror and roll-comfort behavior on compatible cars.
- **PAUSED:** explicit resume, controls/settings, return to garage. Losing focus or platform pause never resumes the car automatically.
- **RESULTS:** first line is actual run outcome; distance and clean result, then actual credits/XP and contract progress. The closed-by-default «Рекорды и статистика» detail contains existing records and profile totals, not a new diagnostics section. «Ещё заезд» and «В гараж» are equally legible. Ad CTA is secondary and spells out exact bonus. Any menu exit saves progress once.
- **SAVE DEGRADED:** non-blocking «Прогресс сохранён только в этой сессии» if durable storage failed. Do not show a cloud checkmark unless cloud write succeeded. No destructive reset as an error-recovery default.
- **AD REQUEST/OPEN/CLOSE:** input/game/audio stopped; only one outstanding request. No reward on close/error/offline/timeout without an authoritative reward callback. Continue buttons become usable after terminal outcome; a delayed ad must not surprise the next live race.
- **PURCHASE CONFIRM:** preview, full soft-credit price, current balance, compatibility and final «Купить за N». A separate cancel action; no purchase on merely selecting a model or swiping a list. Paid catalog/SDK states are distinct from soft-credit purchases.

## 4. Five garage destinations and implemented actions

1. **Автопарк / fleet:** inspect available/owned cars, capability labels, buy for earned credits and select an owned car for driving. Display parking slots are not inventory capacity. A no-cost test-drive mode was proposed but is not claimed as implemented.
2. **Ателье / style:** body/wheels/cockpit categories, reversible compatible previews, purchase and free equip/reset of owned cosmetics, plus per-car appearance presets. The 19 functional cosmetic variants include real compatible Blender parts; unsupported or unloaded parts cannot be purchased. Actual body paint uses a front-to-rear 0.95-second, single-pass paint-only shader wipe. It preserves glass, metal, tyres and PBR maps. Rapid changes finish the visible transition then apply only the latest pending colour; hidden/reduced-motion state resolves immediately.
3. **Инженерия / engineering:** four five-stage account-wide research branches and per-car equipped stages. The «База / Установлено» comparison is calculated from `playerConfiguration()` for stock and equipped research: acceleration limit, braking deceleration, steering slew relative to stock, speed cap and Rocket-only flight drain. These are configured simulation parameters, not a measured 0–100 test or manufacturer bench data. Standard mode ignores equipped modifiers in play; the comparison still describes the installed configuration.
4. **Контракты / contracts:** eight permanent milestones and three automatically tracked repeatable jobs using actual run/economy events. Progress persists; flight jobs are Rocket-specific. No compulsory daily streak or expiry.
5. **Сезон / season:** permanent free volume «Высота ноль», 20 reward stages. Premium and real-money purchase UI remain disabled. Profile badges/banners/trophy rewards do not imply a separate working 3D trophy display.

**No Telemetry navigation destination:** the previous sixth section and speedometer-led navigation concept were rejected. Existing best-score records and corresponding run distances, separated by car/difficulty/class, and profile totals are now in the collapsed results detail. Missing record fields use «—». No online leaderboard, measurement charts or newly invented data are implied.

Four authored Blender rooms are implemented: Бокс → Мастерская → Испытательный цех → Аэрогараж. Incremental prices are 0 / 900 / 2,700 / 6,000, with cumulative expansion cost 9,600. Preset limits are 1/3/6/10; physical display-car spots are **1/2/3/3**, superseding the proposed five-spot final room. Room equipment graphics are authored decoration, not live measurement instruments. All ownership and research remain accessible from level 1 subject to their normal credits/capability rules; some decorative parts require a later room. There is no paid speed/flight/repair gate.

## 5. Implementable economy

Current data: `src/progression-catalog.js` exports, interpreted by `src/progression.js`. The former `economy.config.json` proposal is not a runtime file in this tree. Currency label «кредиты», starting wallet 300. Credits cannot be purchased for cash in this launch design. No premium currency, loot boxes, repair bills, entry fees, paid fuel or login-energy cap.

Run credits = floor(distance metres / 10) + 20 × successful road events + 10 × valid precision landings + 40 once the 1,500 m goal was reached. First run that reaches 500 m grants 200 once per profile. It is the same first_500m contract, not a second grant. No reward for idle time, raw menu visits or ad-close events. Near misses can retain game score but are not required for economy progression.

The current precision-landing rule is implemented in `src/run-telemetry.js`, not the draft's proposed 1-second post-touchdown stability window. It requires a genuine flight cycle (at least 0.35 s and peak altitude 0.8 m), clean assisted touchdown within road bounds, bounded vertical speed/roll and no active roll. At least 120 grounded metres must precede a rewarded landing, with at most three rewarded landings in the rolling last 1,000 m. Duplicate observations do not award twice. These are arcade reward criteria, not real-world safety metrics.

Implemented fleet: free Rocket; hatch 1,400; sedan 2,600; SUV 4,200; van 6,000. The four earned vehicles use existing original traffic GLBs with their own movement configuration, dimensions and measured axle offsets. They have no implemented cockpit or flight; the UI must not sell those capabilities. Rocket keeps its accepted model, cockpit and flight. Game balancing inputs are not manufacturer facts.

Engineering account-wide next-stage costs: 120 / 240 / 420 / 700 / 1,100 (2,580 per completed branch; 10,320 all four). Stage effects: drive acceleration +2/+4/+6/+8/+10%; braking +3/+6/+9/+12/+15%; steering slew +2/+4/+6/+8/+10%; Rocket flight drain -2/-4/-6/-8/-10%. Stock, tuned and continued records remain separate. No cash purchase or premium-pass reward unlocks these modifiers. Top speed, collision envelopes, lift ceiling and landing reserve stay unchanged. The integrated movement path consumes `steeringSlewMultiplier`; changing a label alone would not constitute an upgrade.

The 19 implemented cosmetic variants include two owned starter paints and earned-credit/free-season unlocks. Supported geometric additions are six retained exterior Rocket-compatible GLBs plus two authored steering-wheel GLBs; see [GARAGE_COSMETIC_ASSETS](GARAGE_COSMETIC_ASSETS.md). A part has a slot, compatible car IDs, asset support and no gameplay modifier. Purchasing an unsupported part is not allowed. Preview collision/aero deployment and full steering/suspension clearance; custom wheel meshes preserve authored radius and pivot orientation. Credits spend and ownership grant are one transaction.

## 6. Contracts, season and accounting correctness

Contracts are defined in the runtime catalog with explicit ID, metric, target and reward. Eight permanent milestones and three repeatable jobs are implemented. First_500m uses a per-run maximum; distance/event/precision totals use lifetime cumulative deltas. Current clean-ground distance resets on flight, crash or cone contact and preserves the highest achieved segment. Airborne overtakes use positive deltas of the Game overtake counter observed above its clearance threshold, not a fabricated per-frame total. The original proposal for a richer off-road/individual-traffic trace is not claimed as implemented. Unsupported metrics must not show invented progress.

Repeatable jobs award each full group of 6,000 m / 12 events / 8 landings. Carry excess. A run can satisfy multiple groups, but a second render or reload cannot grant them twice. The profile stores a claim count per contract ID: repeatable rewards increment that count, while a milestone can be claimed only once. Purchase/equip events must not advance engineering-buy tasks twice.

Free launch volume: 20 × 450 XP = 9,000 XP. Run XP = min(450, floor(distanceM/50) + 10 × successful events + 20 if goal reached). This cap applies to base run XP, not separate contract XP; there is no daily cap and no paid way around it. Repeat receipt updates apply only the positive difference of the cumulative run formula, never re-award a goal or a full run. Ads award no season XP. Tier rewards include exactly 2,500 credits total, cosmetic pieces and profile identity/banners/trophy rewards. A reward named trophy does not imply a separate implemented 3D trophy shelf. If a tier rewards an exact cosmetic already bought, refund that cosmetic's recorded soft-credit purchase price once; freebies do not create cash refunds.

«Высота ноль» is a permanent first volume, so show «Без срока окончания», never a fake countdown. Later seasons should also remain claimable/progressable in an archive or clearly state authentic known dates before purchase. Premium, if later connected, is one non-recurring entitlement for one volume, cosmetic only, retroactively granting eligible premium cosmetics; no power, credits, XP boost, daily pressure or ambiguous auto-renewal. Until real SDK catalog exists, it is unavailable.

**Durable settlement:** use a monotonic run sequence, cumulative credited reward amounts and a finalized high-water mark, not an evictable list of last 20 transaction IDs. No run can be reopened for rewards after finalizing a later run. Separate bonusClaimed, contract completion ordinal and tier reward IDs. Save ownership/wallet/receipt in one canonical snapshot. The result-credit ad starts only after finalizing base run settlement and uses its fixed receipt bonus; that bonus is not granted while the run can still accrue income. The separate revive flow retains the run identity and marks the continued record class; it must not be confused with final result-credit settlement.

Current storage attempts recovery from a previous valid backup or legacy data and reports persistence failures. Unknown future schema versions are read-only. A raw corrupt-save quarantine was proposed but is not implemented; do not promise it. localStorage security cannot make a competitive economy cheat-proof; do not claim anti-cheat or cloud protection. Migrate old potok.v1 settings/bests/distance without inventing past new-currency earnings, then use a distinct versioned product key. Importing an old best cannot manufacture a stock Rocket best unless the rule/version is compatible.

## 7. Gameplay metrics, not a standalone diagnostics product

`RunTelemetry` accumulates actual active simulation time, distance split into ground/air, road events, precision landings, airborne overtakes, longest clean-ground segment, peak speed, air time, score and revives. Pauses, menus, ads, background time and repeat observations do not create earned progress. A legitimate revive retains the same run identity and cumulative metrics.

Profile version 2 stores totals, records and the last **24** finalized run receipts. Current personal-record keys are car + difficulty within `standard / tuned / continued`; a route/rules-version record partition from the original proposal is not implemented. The distance alongside the best score belongs to that score's run, not an independently stored longest-distance record. Per-class run counts not present in a record remain «—».

The results detail reuses these existing data. The original proposal for a 10 Hz trace, ten-run plotted history, measured 0–100/braking intervals, separate energy-consumption/efficiency charts and a richer comparison dashboard is **not implemented** and does not justify a Telemetry tab. No unseen measurements should be synthesized to fill the interface.

Engineering comparison is limited to actual configured parameters. If a future deterministic no-traffic bench is added, it must run the actual movement function and clearly label modelled rather than real-world figures; the game's drag makes a simple constant-acceleration estimate unsuitable. No manufacturer horsepower, battery capacity, flight range or factory-exact claims are established.

## 8. Ads, payments and mobile fit

Optional result ad: «Реклама · получить ещё N кредитов», where N=min(100,floor(baseRunCredits×0.25)) for a finalized run ≥500 m. One per result; exact amount fixed before playback. Base claim and next-run button remain available without ad. No season XP or score multiplication. Ad-unavailable/error states are ordinary, not a guilt message. Grant solely from authoritative onRewarded and once. No fake local ad rewards when SDK is absent.

Own interstitial request: only on an explicit results→next or results→garage transition. Default guards require three naturally ended qualified runs, each with at least 45 active driving seconds **and** 500 m, plus 180 active driving seconds in the session. After an actual interstitial or rewarded exposure, require another 180 active seconds; after error/no-fill, use a 30-active-second backoff. Pauses/menus/wall-clock time do not count, and three 45-second runs alone total only 135 seconds. Tutorial, manual exit, quick restart and repeated result attempts do not qualify. These are **our UX settings**, not official Yandex numeric limits.

There is no own startup-ad request, but the platform may show startup advertising; no “no ads before the first race” guarantee is made. A started SDK request remains outstanding after timeout until a terminal callback or reload. Do not start the next race underneath potentially late advertising or pretend a timeout cancelled it. No-fill and terminal errors do not produce rewards. See [ROADSTER_AD_POLICY](ROADSTER_AD_POLICY.md) for the runtime contract.

Real payments are disabled: runtime injects neither a commerce configuration nor a trusted backend, and the UI reports `payments: false`. The signed-payment adapter is only a guarded integration scaffold. Future real payments require real SDK catalog items and actual prices/currency from the SDK, verified identity/receipts and a durable server ledger. No “pay” button that just deducts fake premium coins. Product packages, if later used, should be direct known cosmetic bundles and a cosmetic-only permanent-volume pass. Plain preview → explicit item/price confirmation → platform purchase → verified entitlement → durable save. Handle restored purchases, cancellation, double-clicks and offline uncertainty. No probabilistic purchases, crossed-out invented prices, fake sale expiry or accidental purchase via car-selection input.

Current mobile play is **landscape only**. Portrait displays a black blocking rotate screen with an animated device cue and no bypass; simulation/audio stop and new ad requests are gated. A narrow desktop window is not treated as a phone. Returning to landscape must not clear other pause reasons.

The accepted one-thumb control is hold for throttle, move sideways to steer, move downward to release throttle/brake, and release to neutral/coast. Steering remains available while braking; pointer cancellation, pause and focus loss clear the touch source. Nitro and Rocket flight controls sit nearby. This replaces the earlier automatic-throttle/manual-pedal proposal. Keyboard controls remain independent. Actual-device reach and sustained use still require testing; an emulated touch viewport is not physical-phone certification. Targets of at least 44 CSS px are a project accessibility target, not a quoted platform numeric rule.

## 9. Simulated balance and acceptance gates

Retained design-phase outputs are [economy-simulation.json](economy-simulation.json) and [ECONOMY_SIMULATION](ECONOMY_SIMULATION.md). The old `simulate-economy.mjs` command is not available in this repository, so these are archived sensitivity outputs, not a newly reproduced acceptance run. 1,000 seeded synthetic players per skill/ad cell, declared run distributions, event success assumptions, balanced spending order and 20 s between-run overhead. These are sensitivity checks, not measured user retention, conversion, revenue or predicted player completion time. Optional ad case includes 30 s per ad after random half of qualifying runs.

No-ad simulation medians: first hatch ≈3.8–8.3 minutes; box 4 ≈36.7–109.5 minutes; whole fleet after chosen cosmetics/garage ≈49.5–147.8 minutes; free volume ≈56.7–188.6 minutes. Exact refreshed results are authoritative in the JSON. New drivers take longer; launch volume does not expire. All numerical choices must be tuned from real device playtests later. Ad bonuses reduce the number of driving runs, but can increase wall-clock time, so don't promise a time-saving shortcut.

**Must pass before saying implemented:**
- Five real selectable vehicles, including free Rocket and four purchasable cars, use their correct player/collision dimensions; unsupported cockpit/flight is clear.
- Four authored workshop states visibly change; tier benefits and prices match actual reducer effects.
- Every buyable cosmetic changes exactly the advertised compatible surface/mesh and survives reload.
- Five stages per branch alter actual simulation parameters; stock ignores them and records remain separate.
- Every contract metric is sourced from gameplay or an idempotent economic transaction, not displayed random progress.
- Results/revive/reload cannot duplicate wallet, milestone, tier or ad grant; purchases cannot double-debit.
- Save failure is visible and never falsely reported as cloud saved; old progress is safely migrated.
- Season can reach tier 20 by play without ads/purchases; no backend means no active paid product.
- Own ads never start mid-control or grant on close-only; terminal errors/no-fill release the transition, while unresolved SDK requests remain safely blocked with an honest reload path.
- Five-tab navigation, collapsed results records and configured Engineering comparison match the accepted UI. One-thumb controls and landscape/portrait gating are tested, with physical-phone testing kept separate from viewport emulation; desktop/cockpit/mirror inputs and render performance remain intact.
- Logo/name and each public promotional vehicle image pass the separate branding/rights release gate.

## 10. Source boundaries

Primary-source references retained from the design phase; these links are not a fresh certification of platform compliance or a substitute for the release checklist:
- Yandex one-hand controls requirement: https://yandex.ru/dev/games/doc/ru/requirements/1/10
- Yandex ad transitions/timing: https://yandex.ru/dev/games/doc/ru/requirements/4/4
- Yandex rewarded callbacks: https://yandex.ru/dev/games/doc/ru/sdk/sdk-adv
- Yandex ad-removal scope: https://yandex.ru/dev/games/doc/ru/requirements/1/13

Consumer-protection rationale, not a claim about Yandex-specific law: the FTC's official Epic case describes harms from unintended purchases and confusing purchase interfaces. We therefore use explicit item/price confirmation, distinct preview and buy actions, no false urgency, and no fake paid currency. https://www.ftc.gov/business-guidance/blog/2022/12/245-million-ftc-settlement-alleges-fortnite-owner-epic-games-used-digital-dark-patterns-charge

All brand, price, garage, season and control-layout recommendations not expressly attributed above are our creative/tuning choices. No forecast of ad revenue or conversion is offered without actual traffic, fill, geography and observed data.

### Historical bench boundary

The original proposal referred to `telemetry-bench.mjs` and `telemetry-bench.json`; neither is present in this repository. Unverified historical acceleration/braking numbers have therefore been removed rather than described as current measurements. The shipped Engineering comparison reads configured game parameters, and no factory bench is claimed. Final test totals, build metrics and platform acceptance are recorded separately by the release integrator.
