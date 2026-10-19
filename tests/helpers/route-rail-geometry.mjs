import assert from 'node:assert/strict';

const epsilon = .5;
const center = box => box.x + box.w / 2;
const overlaps = (a, b) => a.x < b.right - epsilon && a.right > b.x + epsilon && a.y < b.bottom - epsilon && a.bottom > b.y + epsilon;
const minimumTravel = width => width <= 280 ? 80 : width <= 320 ? 110 : width <= 400 ? 145 : 200;

/** Validate measured native DOM rectangles, never CSS text or a declared fraction alone. */
export function assertRouteRailGeometry(state, progress) {
  const {size: [width, height], rail, track, marker, flag, brand, utilities} = state;
  assert.equal(state.progress, progress);
  assert.equal(state.overflow, 0, 'viewport must not be expanded to disguise the narrow rail');
  assert.equal(state.status, 'ready');
  assert.equal(state.canvasHidden, false);
  assert.equal(state.actualVehicle, state.selectedVehicle, 'snapshot identity must match the running vehicle');
  assert.ok(state.canvasInk > 0, 'the actual-model canvas must contain visible pixels');
  assert.deepEqual(state.canvasBuffer, [160, 80]);
  assert.equal(marker.w, 40, 'do not shrink the selected model to disguise lost travel');
  assert.equal(marker.h, 20);
  assert.ok(track.w >= minimumTravel(width), `${width}px: ${track.w}px of true travel is below ${minimumTravel(width)}px`);
  assert.ok(rail.y >= 0 && rail.y <= 12 && rail.bottom <= 44, 'rail remains at the top edge');
  assert.ok(marker.x >= rail.x - epsilon && marker.right <= rail.right + epsilon, 'whole car fits at either endpoint');
  assert.ok(flag.x >= rail.x - epsilon && flag.right <= rail.right + epsilon);
  assert.ok(marker.right <= flag.x + epsilon, 'car must stop before the flag, not underneath it');
  assert.ok(Math.abs(center(marker) - (track.x + progress * track.w)) <= epsilon, 'actual car position must encode true distance');
  assert.ok(Math.abs(state.fillWidth - progress * track.w) <= epsilon, 'painted route agrees with the car position');
  for (const control of utilities) {
    assert.ok(control.visible, `${control.id} remains visible`);
    assert.ok(control.w >= 44 && control.h >= 44, `${control.id} retains a 44px target`);
    assert.ok(control.x >= 0 && control.y >= 0 && control.right <= width && control.bottom <= height);
    assert.ok(control.hits.every(Boolean), `${control.id} target must receive hits at center and corners`);
    assert.ok(!overlaps(marker, control) && !overlaps(rail, control), `${control.id} must not collide with the route or model`);
  }
  assert.ok(!overlaps(utilities[0], utilities[1]), 'camera and pause remain independent');
  if (brand.visible) {
    assert.ok(!overlaps(brand, rail) && !overlaps(brand, marker), 'visible logo must not collide with the route');
    assert.ok(brand.hits.every(Boolean), 'visible home logo remains reachable');
    if (width <= 480) assert.ok(brand.w >= 44 && brand.h >= 44, 'narrow logo retains a genuine 44px target');
  }
  assert.equal(brand.visible, width > 360, 'only the extra-narrow race HUD hides the optional home logo');
}

export function assertRouteRailSequence(states) {
  assert.deepEqual(states.map(state => state.progress), [0, .5, 1]);
  states.forEach(state => assertRouteRailGeometry(state, state.progress));
  const [start, midpoint, end] = states;
  const travel = center(end.marker) - center(start.marker);
  assert.ok(travel >= minimumTravel(start.size[0]), 'measured endpoint travel must remain useful');
  assert.ok(Math.abs(travel - start.track.w) <= epsilon, 'car traverses the full measured track');
  assert.ok(Math.abs(center(midpoint.marker) - (center(start.marker) + travel / 2)) <= epsilon, 'half distance is halfway between the actual endpoints');
  return travel;
}
