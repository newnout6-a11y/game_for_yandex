# Settings and rewarded-result ownership, 18 October 2026

This correction addresses the two findings reported against PR4 head `4f2801d`. It does not change garage assets, physics, reward amounts, paid-product availability or ad cadence.

## One accepted settings path

The driving camera and sound controls committed local profile settings without queuing the corresponding cloud snapshot. The same omission was present in the retained route, difficulty and rendering-quality handlers. They also changed live/legacy preferences before checking whether the progression reducer accepted the change.

All six settings entry points, including the garage settings panel, now share a helper:

1. Dispatch the candidate setting to the validated profile reducer.
2. On rejection, restore native controls from the accepted profile; do not change the live renderer/audio, legacy storage or cloud queue.
3. Queue an accepted changed snapshot through the existing platform service.
4. Hydrate live preferences from the accepted profile and mirror those accepted values to legacy storage.

A native checkbox or select changes its DOM value before its handler runs. Rejected garage actions therefore re-render the authoritative settings, and the retained driving quality selector resets its attempted value. This also covers a future-schema read-only save without silently accepting a preference.

A failed local disk write is not confused with a rejected reducer action: accepted in-memory preferences remain consistent and may still be saved to cloud. Local/cloud status remains explicit. A queued write is not advertised as server-confirmed persistence; the existing adapter still requires a durable SDK acknowledgement.

## Rewarded callbacks retain their originating owner

An account or selected cloud snapshot can change while the SDK advert is outstanding. The previous callback retained a run ID but used the mutable current result after the await, allowing a null dereference or applying the previous result to a replaced profile.

Both bonus and revive requests now capture the exact result/run object, receipt identity, profile ID, session-local replacement epoch, platform identity generation and account ID. Before any settlement or continuation, the terminal callback checks that all owners still match, including the current active/finalized receipt. A stale callback shows an explanatory notice and neither finalizes nor rewards another profile or run.

Every accepted whole-profile replacement increments a runtime-only epoch, even if saved IDs and values happen to be identical. Normal preference changes, save emissions and failed replacements do not increment it. It is not a new persisted schema field and resets naturally on page reload, when old callbacks cannot survive.

The ad adapter still owns its pause until a terminal SDK callback. A local timeout remains pending, not cancelled. `finally` releases only controller busy state and refreshes the presenter; it does not clear orientation, account-selection or user pause reasons. Reward authority remains the SDK's confirmed rewarded callback, not merely an opened or closed advertisement.

## Verification scope

Regression coverage includes accepted/no-op/rejected settings, genuine future-schema read-only data, storage quota failure, current-profile reward idempotency, identical-ID replacement, changed account generation, replacement before revive, terminal SDK error, ordinary setting changes during an ad, and late rewarded callbacks after a timeout and profile replacement. Camera-only and sound-only sessions exercise the real controller and cloud adapter through mocked SDK `setData(payload, true)` calls, without a later race or explicit flush to conceal a missing queue. A rejected durable write preserves the local preference and exposes `cloud-write-failed` rather than claiming a successful cloud save. Native-control tests use the production garage presenter and a genuine future-schema store.

Tests use production controller/reducer/adapter code with isolated storage and deterministic SDK callbacks; they do not claim live platform account or advertisement validation.

Final local verification: `npm test` passes all **706 tests**, `npm run check` reports **0 errors**, and `npm run build` succeeds. SHA-256 comparison confirms all **106 existing art/ and public/assets/ files** are unchanged from the accepted PR4 baseline. The regression's negative controls reproduce the missing cloud queues, stale rewarded callback failures and all four native-control rollback failures against the pre-fix controller.
