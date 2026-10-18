# PR6 lifecycle and interrupted-camera corrections

The two findings reported against `ea19e5d1f906ef1ea2f57bbe413284d9811d8d9a`
were independently reproduced before editing production code.

## Late workshop load after teardown

`GarageScene.setTier()` rejects requests after disposal and checks both disposal
and its selection generation immediately after the room promise resolves, before
calling the TV owner. The existing check after asynchronous poster preparation
is retained. Superseded rooms remain cache-owned and cannot select or attach a TV.

`GarageScreenPlayer.attach()` now rejects a disposed owner before traversal,
room retention, material mutation or media allocation. Late fallback poster
textures are still disposed by their existing ownership guard. Tests also prove
that a late room geometry is released once by the scene cache cleanup.

## Pointer takeover during an inspection transition

The temporary displayed distance no longer becomes a permanent camera override.
A 350 ms finite recovery restores the current inspection's distance, including
vehicle length, zoom, viewport aspect and authored room clearance. Pointer yaw
remains directly controlled. Replacing the vehicle clears the recovery; hidden
or reduced-motion views settle immediately, with no idle animation tail.

The same takeover preserves the displayed pitch, constrained wheel-view yaw,
look target, focus bounds, field of view and near plane. These converge to the
requested mode instead of snapping when grabbing a rear-to-wheel transition.
Every intermediate exterior frame still passes the existing room/equipment,
selected-car and near-plane collision policy.

## Reproduction and verification

- `npm test` includes direct disposed attachment, delayed/stale scene loads,
  length/aspect/zoom recovery, reduced motion and complete optical-continuity
  tests for every exterior inspection-mode pair.
- The actual-GLB clearance suite covers every car in every occupied workshop tier,
  including 960 new recovery poses in addition to the existing orbit sweeps.
- `node scripts/garage-review-qa.mjs` uses the actual garage buttons and mouse/touch
  gestures on desktop and landscape phone, then switches to the van and resizes.
  It records native images, source hashes, framing bounds and browser errors.
  `CHROME_BIN` is optional; without it the script uses the installed Chrome channel.
- The capture controls animation time and may use software WebGL in the QA
  environment. It does not measure or promise native-device frame rates.

No model, film, room material, economy, driving-physics or platform configuration
was changed. The subsequent Yandex draft upload remains conditional on a clean
review of the newly published commit; no moderation submission is implied.
