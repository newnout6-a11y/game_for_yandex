# Single-flight run startup fix, 18 October 2026

The no-ad branch of `transitionAd()` still returns a promise. Two start intents in one JavaScript turn could both pass the `busy` check before that promise resumed. The first opened a run; the second finalized that newly opened empty run and replaced its monotonic identity. This was reproduced from the hub and from results. It is not evidence of duplicated rewards or of every ordinary physical double-click reproducing the race.

A dedicated `startingRun` flag is now acquired synchronously before the first await and released in `finally`. It is independent of the ad's `busy` flag, so an ad callback cannot prematurely release the start operation. Existing advertisement ownership, persistence and reward calculations are unchanged.

Five controller regressions cover duplicate no-ad hub starts, duplicate no-ad result retries, release after an orientation abort, release after an injected configuration exception, and duplicate starts blocked through a real adapter's timeout-pending ad recovery. The first two failed before the fix. The eligible-ad test keeps the production controller and ad adapter, supplying only deterministic SDK callbacks; it is not a live platform advertisement test.

Final validation: all **675** garage-branch tests passed, including the three shared camera regressions and five new startup regressions; source check reported **0 errors**; the production build completed successfully.
