# Result choices and exact reward doubling

The results screen previously did have free «Ещё заезд» and «В гараж» actions. The issue was hierarchy: they appeared after the two video offers. The revised screen puts the explicit free finish first, outside the scrolling reward panel, including 844×390 and 667×375 landscape viewports.

## Three exclusive choices

1. **«Завершить и забрать»**: retain the ordinary credits and season XP already earned; finalize the receipt without requesting a rewarded or interstitial ad. The screen then offers the usual garage/new-run transitions.
2. **«Видео → продолжить заезд»**: only after the SDK confirms `onRewarded`; persist `finishChoice: "continue"` before resuming the same run identity and telemetry. At most one continuation. Later driving receives only new cumulative reward deltas. Its record is in the existing continued category. This run can no longer select doubling, including at the later crash or after restoring its receipt.
3. **«Видео → ×2 и завершить · +N ₵»**: only after confirmed `onRewarded`; grant exactly N extra driving credits and finalize the receipt in the same reducer revision. This cannot be followed by continuing, settling more metrics, or another bonus.

The ordinary reward is earned by driving, not by clicking either video button. Starting another run remains available without choosing a rewarded offer. The existing product-owned interstitial cadence is unchanged: a later results-to-garage or results-to-next transition can show an interstitial only under the established minimum-three-qualified-runs, 180-active-second and cooldown rules. The explicit free-finalize action itself does not request one.

## Exact ×2 basis

N is `activeRun.creditsGranted`: the cumulative base driving credits actually credited to the wallet for this run, not an estimate or total wallet balance. The authored driving formula remains:

- one credit per 10 complete metres;
- 20 credits per completed road event;
- 10 credits per eligible precision landing, subject to existing telemetry guards;
- 40 credits for reaching the 1,500 m goal.

No raw-score multiplier. Onboarding/first-500-m credits, contract rewards, season reward claims, starting balance and XP are excluded. Example: 714 m + two road events + one eligible precision landing earns 121 base credits. With a separate 200-credit first-run grant, the normal displayed credit receipt is 321. Doubling adds **121**, for **242 driving credits + 200 onboarding = 442 total**, not 642. The offer displays both `121 → 242 ₵ за вождение` and `+121 ₵` before the ad.

The existing 500 m minimum stays. Zero actual base earnings never produce an ad offer. The former 25%/100-credit ceiling is removed: a genuine 1,090-credit base offers another 1,090, not 100. If the entire additional N cannot fit below the wallet cap, the offer is unavailable with an explanation; it never promises ×2 and silently grants a fraction. Original earnings truncated by the cap remain actual earnings, not retroactively recoverable theoretical rewards after spending.

## Transaction and persistence boundaries

- `CONTINUE_RUN` validates the exact active run identity and rejects any prior choice. `finishChoice` survives ordinary settlements and JSON restore.
- `CLAIM_AD_BONUS` now accepts the eligible active receipt and atomically writes the exact bonus, `adClaimed`, `adCreditsGranted`, `finishChoice: "double"`, recent finalized receipt and monotonic finalized-through barrier. It no longer requires a separate finalize-before-claim write.
- `creditsGranted` always remains the base amount; bonus credits are stored separately and cannot become their own future basis. `onboardingGranted` preserves the separately displayed cumulative one-off grant through continuation.
- These are additive v2 receipt fields. Old receipts with recorded revives infer `continue`; old already-claimed receipts remain claimed and never receive an upgrade grant. An absent historical onboarding detail is not invented from the wallet.
- The reducer never trusts an amount supplied by a UI action. The controller dispatches a reward action only after the SDK adapter returns strict `rewarded === true` for this request.
- The existing result object/run reference, profile ID, profile replacement epoch, platform generation and account ID are captured before awaiting ads and checked before mutation. Same-ID cloud replacement still invalidates the request. Stale callbacks never grant into another profile or run.
- Double taps and competing finish/continue/new-run actions are blocked during an ad. Navigation now also reserves the existing start-operation lock before its no-ad asynchronous boundary.
- Local write failure does not roll back or replay an accepted in-memory grant. The receipt stays claimed; the UI explicitly says the result is only held in this session. Retrying storage flush or cloud sync must persist that snapshot, not dispatch the reward again. A permanent storage failure is not represented as durability.
- Missing SDK never becomes successful rewarded completion. Local continuation is explicitly labelled **«Тренировочное продолжение»**, without advertising, and still consumes the one continuation choice. Doubling is not offered. No-fill, offline, error or close without `onRewarded` leaves ordinary earnings and the free finish available. A confirmed `onRewarded` remains the SDK’s reward authority even if the later terminal close/error status differs, preserving existing adapter semantics.

## Verification

- `tests/result-choices.test.mjs`: exact basis, large rewards, onboarding/contracts/season exclusion, minimum and zero earnings, exact-cap boundary, actual cap-truncated basis, mutually exclusive choices, legacy and recent-ledger restore/eviction, forged/stale identities, local write failure and safe flush.
- `tests/garage-integration.test.mjs`: production controller + game/storage/ad adapter; account generation/replacement races, async duplicate clicks, no-fill/error/offline paths, training fallback, continued run identity, free finish, interstitial cadence, fresh-run transition, local-save failure.
- `tests/garage-ui.test.mjs`: free-action hierarchy and separate scroll region, actual ×2 copy, exclusions, no-SDK/no-reward states, finalized state, disabled controls while pending.
- `scripts/result-choices-qa.mjs`: real Chromium layout/click verification at 1440×900, 844×390 and 667×375; screenshots and JSON report under `output/result-choices-qa/`. Uses an isolated local profile and explicit mock SDK transport, not live ads, purchases or account state.
