# PR7: saved result recovery and horn reset

This correction follows the review of `a0ab5f7c85095a27d7084a008309e0f76064cde1`. It changes no vehicle, room, traffic-policy, steering, shader or media assets.

## Findings and changes

- Reviving resets the horn pulse, held state and cooldown together. The next fresh press can signal immediately; ordinary cooldown, phase/lifecycle guards and monotonic horn serial still apply.
- A displayed crash result marks its existing receipt `resultPending`. Startup restores that receipt as a result panel instead of silently hiding it behind the hub. No settlement, run count, new sequence, record or credit is replayed.
- Known pending results keep free finish and the existing exact-base ×2 quote when eligible. Interrupted/legacy saves show earned totals and free finish only. Continuing clears the marker; finished/doubled receipts stay closed.
- The road/physical vehicle state is not persisted. Recovery therefore states that continuing after reload is unavailable. It does not fabricate a driving scene or offer an unsafe revive.
- Whole-profile/account replacement restores only the accepted receipt. Late rewarded and interstitial/navigation/start continuations are scoped to profile, replacement epoch, platform generation and exact result identity. Even the no-ad promise yield is guarded. Cadence completion remains attached to the original cadence instance.
- Sanitization can preserve bounded earned progress but cannot repair an invalid pending marker into a new crash-result ad offer. The result's car label/model follows its receipt rather than a different current selection.

## Reproduction and verification

`node scripts/pending-result-reload-qa.mjs` uses isolated browser storage, real page reloads and the actual app/controller/renderer at 1440×900 and 667×375. Only the SDK advertisement transport is a test fixture; it never contacts a real account or advert. `CHROME_BIN` selects a browser executable; otherwise Playwright uses the Chrome channel. `SOFTWARE_WEBGL=1` selects the established software rendering route when needed. This is functional QA, not a native-device FPS measurement.

Automated regressions cover exact restored totals, no settlement/recount, free finish, exact ×2 once, continued and legacy interruptions, malformed saves, an unchanged-metrics pending-marker write, failed local persistence, unconfirmed ads, accepted account replacement, and stale rewarded/interstitial/no-ad transitions with both identical and different IDs. The horn regression exercises both an active pulse and its cooldown tail.

An unconfirmed ad is never converted into a grant on reload. A failed local write cannot promise durability; only the last successfully stored snapshot can return. This remains the existing client-side earned progression with SDK callback validation, not a server-authoritative purchase/ad ledger. No real user saves, Yandex draft or repository branches are changed by the QA script.
