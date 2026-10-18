# Roadster progression and telemetry

This implementation is a local, earned-only progression system, not a payment backend. The authored numeric catalog is compiled into `src/progression-catalog.js` from the approved design. Runtime code does not fetch that proposal or contain SDK calls, receipts, keys, payment mocks or external endpoints.

## Modules and public API

- `progression-catalog.js`: immutable `CATALOG`, `BRAND`, `SECTIONS`, `FLEET`, `GARAGE_LEVELS`, `ENGINEERING`, `COSMETICS`, `CONTRACTS`, `SEASON`, `RUN_REWARDS`, `ADS`, `BADGES`; `vehicleDefinition(id)`, `cosmeticDefinition(id)`, `cosmeticAvailability(itemOrId, capabilities)`.
- `progression.js`: `createProfile({now, id})`, `sanitizeProfile(raw)`, `migrateLegacyProfile(raw, options)`, `sanitizeTelemetry(raw)`, `calculateRunRewards(telemetry)`, `getEngineeringModifiers(profile, vehicleId, mode='standard')`, `reduceProgression(profile, action, {now, capabilities})`, `deriveGarageView(profile, {capabilities, trustedEntitlement})`.
- `progression-storage.js`: `createProgressionStorage({provider, now, idFactory, capabilities})`. The provider is either a browser Storage object or a lazy function returning one; the clock and ID factory are injectable for deterministic tests.
- `run-telemetry.js`: `new RunTelemetry()`, `.observe(game.state, dt)`, `.event(name, payload, game.state)`, `.snapshot()`, `.finalize(game.state?)`.

Store methods:

```js
const store = createProgressionStorage();
const started = store.beginRun({vehicleId:'rocket', mode:'standard', difficulty:'flow', route:'ring'});
const run = started.run;
const telemetry = new RunTelemetry();
// Observe after simulation updates; forward existing Game events too.
telemetry.observe(game.state, dt);
store.settleRun(run, telemetry.snapshot()); // result screen, still eligible for revive
// Keep the same run and telemetry instance across a revive.
store.settleRun(run, telemetry.snapshot(), {finalized:true}); // leaving results permanently
// Or store.finalizeRun(run) when already settled.
```

`get()` and reducer outputs are detached snapshots. `dispatch(action)` returns `{ok, changed, reason?, profile, rewardDelta?, receipt?, run?, persistence}`. `settleRun` also returns `baseReward`. `status()` returns `{localSaved, readOnly, recovered, migrated, source, error, backupError, cloud, futureVersion}`. `flush()` retries a failed local write without repeating the action. Every caller must honor `ok` and present unsaved/read-only status rather than claiming success in the cloud.

## Profile v2

The new primary key is `aerokrai.profile.v2`; the backup is `aerokrai.profile.v2.backup`. The original `potok.v1` key is never changed or deleted.

- Identity/version: `schemaVersion:2`, `profileId`, `revision`, `createdAt`, `updatedAt`.
- Economy: `wallet:{credits,totalEarned,totalSpent}`. Starter credits: 300. The rocket is owned. Wallet cap: 9,999,999. There is no real-money currency.
- Fleet: `ownedVehicles`, `selectedVehicleId`, `mode:'standard'|'tuned'`.
- Garage: `garage.level` 1–4, incremental prices 0/900/2700/6000, cosmetic preset slots 1/3/6/10.
- Research: `research.{drive,brakes,chassis,flight}` 0–5, shared across the profile. Incremental costs: 120/240/420/700/1100.
- Setups: `loadouts[vehicleId].engineering[branchId]`, `loadouts[vehicleId].cosmetics[slotId]`. A newly owned car has stock engineering even when shared research exists. Equipping an owned stage is instant and free. Standard play returns all modifier values 1 without deleting research or setups.
- Cosmetics: `cosmetics.owned`, `paidPrices`, `presets`. Presets are cosmetic only, finite, and capacity constrained. Saved names are capped at 48 characters; the renderer must render them as text, not HTML.
- Contracts: `contracts.claims[contractId]` counts. One-time claims max at one; repeatable thresholds subtract prior claimed cycles and retain excess distance/events.
- Season: `season.id`, `xp` capped at 9,000, `claims`, `badges`, `equippedBadge`. The 20 permanent levels each require 450 XP. Badges, banners and trophy have real catalog IDs, Russian names and display symbols. There is no expiry clock or artificial daily XP cap.
- Telemetry totals: `stats` uses metres, seconds, m/s, counts and actual raw simulation score. `maxRunDistanceM`, `maxCleanGroundSegmentM`, `engineeringPurchases`, `runs` support contracts.
- Records: `records.standard`, `records.tuned`, `records.continued`, each keyed by `vehicleId:difficulty`. Legacy records remain separately attributable at `legacy.best`; old non-specific records are not mislabeled as a new car class.
- Settlement: `ledger.nextSequence`, `finalizedThrough`, `activeRun`, `recent` (last 24 finalized receipts).
- Settings: original route keys `ring/neon/dawn`, difficulty `flow/rush`, sound, render quality `auto/high/ultra`, and chase/cockpit camera mode.

Caps, fixed catalog allowlists and bounded 24-run history keep the JSON payload comfortably below the 190,000-byte write ceiling, leaving margin under the platform's documented 200 KB cloud limit. Tests check actual UTF-8 bytes. Unknown maps, catalog IDs and prototype keys are not copied. Invalid/nonfinite wallet values do not become free currency.

## Reducer actions

All purchases use immutable catalog prices. Submitted `price`, `cost`, `credits`, `amount`, `xp` or `grant` fields are rejected. Purchase and ownership update are one cloned-state operation; failed transactions leave the balance unchanged.

```text
BUY_VEHICLE {vehicleId}
SELECT_VEHICLE {vehicleId}
SET_MODE {mode}
UPGRADE_GARAGE
BUY_RESEARCH {branchId}
EQUIP_RESEARCH {vehicleId?, branchId, level}
BUY_COSMETIC {cosmeticId, vehicleId?}
EQUIP_COSMETIC {cosmeticId, vehicleId?}
SAVE_PRESET {vehicleId?, presetId?, name?}
APPLY_PRESET {presetId}
CLAIM_CONTRACT {contractId}
CLAIM_SEASON {rewardId}
EQUIP_BADGE {badgeId} // null clears the display
UPDATE_SETTINGS {settings}
```

Internal integration actions are `BEGIN_RUN`, `SETTLE_RUN`, `FINALIZE_RUN`, `CLAIM_AD_BONUS {runSequence,runId}`. Use the store's run helpers rather than constructing receipt identities. Reward-ad dispatch must occur only after the platform adapter's verified rewarded callback. The reducer does not pretend that a JavaScript action is an independently verified ad receipt.

## Run settlement and replay protection

`beginRun()` allocates a monotonically increasing sequence, persists it and closes any older active run. An initial result screen must settle with `finalized:false` if revive remains available. Continuing uses the same identity and cumulative telemetry. Every receipt stores cumulative already-accounted credits/XP and telemetry totals; only a positive difference is awarded, so duplicate results, reloads, or a revive cannot count the same distance or reward again. Run count increments once.

Finalization advances `finalizedThrough`. A settlement at or below that barrier is permanently rejected even if its individual receipt has fallen out of the bounded recent history. Sequence plus ID and run configuration must match the active receipt. A new run cannot reopen an old one. This guarantee is within a valid local save lineage, not across simultaneous devices, a manually reverted browser store, or lost writes.

Base credits: floor(metres/10) + 20 × successful road events + 10 × eligible precision landings + 40 for reaching 1,500 m. Base XP: floor(metres/50) + 10 × successful events + 20 for the goal, capped at 450 for the entire run including revives.

The first 500 m grant is automatically claimed as the **same** `first_500m` contract, once per profile. It awards 200 credits and zero XP. It is never a second onboarding wallet transaction.

Result-ad bonus: min(100, floor(base earned credits × 0.25)), only on a finalized run of at least 500 m, once. It excludes onboarding/contracts, grants no XP and never multiplies score or records. Recent-history eviction can remove an old unclaimed ad opportunity; it cannot permit replay. When the results UI offers this ad, finalization means revive is no longer available for that run.

## Authentic telemetry and precision landing

Telemetry reads the production simulation's distance, elapsed time, phase, altitude, vertical speed, roll, position, event/overtake counters and synchronous events. It never modifies the simulation. Repeated observations, pauses, backwards time/distance jitter, impossible teleports and NaN do not create travel. Active time uses simulation elapsed time, not wall-clock time; observed step gaps above 0.25 seconds are not counted as gameplay.

A precision landing needs a genuine airborne cycle (at least 0.8 m peak altitude and 0.35 seconds airborne), assisted safe touchdown, upright angle within 0.22 radians, measured descent speed no more than 2.5 m/s, valid road position and no collision in the cycle. It additionally needs 120 m of **ground travel since the previous rewarded landing**, and no more than three rewarded touchdowns in a rolling 1,000 m window. Grounded jitter, duplicate callbacks or stationary repeat hovering cannot farm rewards. A crash/revive altitude reset is not a landing. The game resets descent/roll on touchdown, so the telemetry retains the actual preceding sample and accepts an optional production pre-touchdown payload when available.

Successful road events come from the simulation's incremented counter, not the presence of a banner. Airborne overtakes need actual overtake increments while airborne at meaningful clearance. Clean-ground progress is broken by flight, cones, crashes and revive. Raw score follows the simulation, including penalties; it is not ad-generated.

## Availability, season and monetization boundaries

Paint, satin, compatible graphite rim finish and cockpit palettes are implemented visual capability classes. Turbine wheel fitting is currently restricted to the rocket; other cars have no authored fit. Authored turbine wheels, louver, splitter, upholstery stitch and copper rim accent remain marked `requires-authored` with a real reason. No purchase or equip is allowed unless a deliberately supplied catalog capability enables that exact authored part. Capability keys are `wheels.turbine`, `body.louver`, `body.splitter`, `cockpit.stitch`, `rims.copperAccent`. The integrator must only enable one after its real renderer/asset implementation and compatibility validation. `store.setCapabilities({...})` updates these gates after late asset loading without recreating the profile; `getCapabilities()` gives a detached set for `deriveGarageView` (ownership and wallet never change on capability updates).

Season reward cosmetics use the same availability gate. If an exact unlocked reward was previously bought, its recorded catalog-price soft-credit payment is refunded once when that reward is claimed. A duplicate already earned free is not converted into credits. A locked authored reward remains claimable later when its asset becomes available; it does not become fake ownership.

Premium sales and rewards are disabled. There is no product ID, payment SDK call, mock entitlement or client purchase switch. `deriveGarageView` may display a future adapter-supplied verified season entitlement, but it never enables sales or manufactures a premium reward catalog. Actual paid entitlements require a separate server-authenticated fulfillment design and an intentionally expanded implementation.

## Persistence, recovery, migration and cloud boundary

A previous valid normalized snapshot is backed up before the next primary write. Corrupt JSON/schema recover from a valid backup; without one the game can start a fresh local profile, leaving `potok.v1` untouched. Legacy records, settings and statistics migrate without converting historical scores or distance into newly earned credits. A supported version-1 same-shape profile retains its existing wallet, rather than receiving another starter grant.

Unknown future versions are read-only and never overwritten, including on startup, failed dispatch, flush or cloud replacement. Quota, denied access and backup failures are explicit status fields. An action may succeed in memory while `persistence.localSaved` is false; the user must be told it is unsaved. Retry `flush()`, not the purchase or reward callback.

`replaceFromCloud(raw)` only performs an explicit validated complete replacement. It never sums wallets, takes the maximum wallet, merges receipts or infers account ownership. Account conflict selection, identity-generation barriers, cloud serialization, SDK rate limits and durable `setData(..., true)` acknowledgements are responsibilities of a future platform adapter. A local `localSaved:true` is never a claim of cloud/server durability. Client-only local progression is not a security boundary against a player editing browser storage.

## Test command

```sh
node --test tests/progression*.test.mjs tests/run-telemetry.test.mjs
```

Tests include prices/caps, atomic purchases, stage ownership, per-car selection, standard/tuned/continued records, authored locks, real season identifiers, duplicate claims, precision anti-farming, production Game flight, pauses/jitter/revive, NaN/prototype payloads, legacy/v1 migration, previous-valid backup recovery, unknown future versions, quota failure/retry, cumulative receipts after reopen, bounded history replay barriers, cloud replacement and the 200 KB margin.
