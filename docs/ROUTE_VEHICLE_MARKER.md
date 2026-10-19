# Selected vehicle on the mobile route rail

## Source identity and appearance

`src/main.js` calls `RouteVehicleMarker.sync(routeVehicleSelection)` immediately after the real `renderer.selectOwnedVehicle` call in `startRun`. The selection contains the resulting `renderer.playerVehicleId`, a copy of the exact equipped `profile.loadouts[id].cosmetics` passed to the run renderer, and the profile ID plus replacement epoch. It never reads `previewId` or a browsed, unowned Fleet card. Each new run refreshes this identity; profile-lineage replacement clears it. A continuing run keeps its original appearance, just as the physical run vehicle does.

The marker's factory delegates to `RoadRenderer.createShowcaseVehicle`, which delegates to the same `createOwnedVehicle` factory used by the selected gameplay fleet. Real prepared GLB geometry, body paint, finishes and equipped parts are used without modifying geometry or scale. Every authored vehicle faces local -Z. Fixed positive yaw (`Math.PI / 2 - .16`) viewed from -Z projects the nose right, toward the flag. The route-only low-pitch camera fits complete visible model bounds. Existing Fleet idle yaw and full-rotation camera defaults remain unchanged.

## Bounded presentation and lifecycle

- One selected clone and one 160 × 80 RGBA pixel cache, presented at 40 × 20 CSS pixels.
- Existing game WebGL renderer only. One lazy HDR render target plus one tone-mapped byte/readback target at 160 × 80; no new WebGL context or independent requestAnimationFrame loop.
- A dirty image requires one actual-model scene render, one tone-map triangle pass and one readback. The existing main tick advances this work. An accepted settled identity issues no additional renders or readbacks.
- A sorted saved-appearance key makes property insertion order irrelevant. A changed model, paint, other equipped part or profile lineage hides the old canvas immediately until matching new pixels are ready. No generated substitute vehicle appears on failure: a small `!` and an accessible explanation remain instead.
- Rendering is gated to eligible mobile landscape playing/paused rail visibility, and suppressed while paused, hidden, orientation-blocked or busy. A cached image can remain displayed during pause. Activity changes between ticks update readback acceptance immediately. Desktop and garage screens do not render the route image.
- FleetMiniatures rejects stale canvas/version/record/profile-epoch readbacks, guards context loss/restoration, restores the shared renderer state synchronously and limits failed reads to its established bounded fallback. Restoration invalidates GPU snapshots and reuses the same authored clone.
- Disposal on non-BFCache page exit releases marker-owned targets/materials/listeners. Shared model geometry, textures and borrowed environment are not disposed. BFCache-preserved pages retain their resources.

The existing `--goal-progress` moves the marker in CSS; distance progress never triggers a new 3D capture. Track margins reserve 20 CSS pixels left and 38 right. The 40-pixel marker stays inside the rail at either endpoint, and its right edge remains one pixel before the 17-pixel flag when the distance goal is complete. The original top safe-area position, rail height, progress semantics, driving controls and ability reserve are unchanged. The progressbar references a hidden description containing the actual vehicle name and saved paint label.

## Validation and native inspection hooks

Focused Node tests cover all five actual GLB factories, paint equality, projected front/rear orientation, fit, stable cache behavior, selection changes, copied cosmetics, old-pixel suppression, late asynchronous readback rejection, hidden/paused behavior, context restoration, disposal and main-loop integration. Existing Fleet tests retain their original defaults and renderer-state assertions. Layout source tests now expect the selected-model canvas rather than the removed generic vector car.

For controlled native inspection after the actual `startRun`, `routeVehicleMarker`, `routeVehicleSelection` and `syncRouteVehicleActivity` are module-local names. The existing tick normally handles all work. An instrumented harness can call `routeVehicleMarker.update(dt, { visible: true, paused: false })` while it waits for the genuine readback, inspect `routeVehicleMarker.miniature.records`, and read `#mobileGoalVehicle` data-state/vehicle-id/paint. `#mobileGoalVehicleCanvas` is hidden until current pixels are accepted. No production debug global or preview shortcut was added.

Native visual evidence is separate from these source tests; see the corresponding QA outputs generated from the same runtime source.
