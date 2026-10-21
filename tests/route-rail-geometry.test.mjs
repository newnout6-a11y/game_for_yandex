import test from 'node:test';
import assert from 'node:assert/strict';
import {assertRouteRailGeometry, assertRouteRailSequence} from './helpers/route-rail-geometry.mjs';

const box = (x, y, w, h) => ({x, y, w, h, right: x + w, bottom: y + h});
function fixture(width, height, progress) {
  const left = Math.max(width <= 360 ? 12 : width <= 480 ? 64 : 132, width / 2 - 140);
  const right = width - Math.max(108, width / 2 - 140);
  const track = box(left + 20, 3, right - left - 58, 20);
  return {size: [width, height], progress, overflow: 0, status: 'ready', canvasHidden: false,
    actualVehicle: 'sedan', selectedVehicle: 'sedan', canvasInk: 128, canvasBuffer: [160, 80],
    rail: box(left, 3, right - left, 20), track, marker: box(track.x + progress * track.w - 20, 0, 40, 20),
    flag: box(right - 17, 3, 17, 19), fillWidth: progress * track.w,
    brand: {...box(12, 0, 44, 44), visible: width > 360, hits: [true, true, true, true, true]},
    utilities: ['cameraBtn', 'pauseBtn'].map((id, i) => ({id, ...box(width - 100 + i * 44, 0, 44, 44), visible: true, hits: [true, true, true, true, true]}))};
}

test('native geometry validator requires real 0/half/full travel at every narrow iframe size', () => {
  for (const [width, height, travel] of [[280, 180, 102], [320, 200, 134], [400, 240, 170], [551, 360, 222]]) {
    assert.equal(assertRouteRailSequence([0, .5, 1].map(progress => fixture(width, height, progress))), travel);
  }
});

test('native geometry validator rejects the old six-pixel track even inside a 64px rail', () => {
  const state = fixture(280, 180, .5);
  state.rail = box(108, 3, 64, 20);
  state.track = box(128, 3, 6, 20);
  state.marker = box(111, 0, 40, 20);
  state.fillWidth = 3;
  assert.throws(() => assertRouteRailGeometry(state, .5), /true travel/);
});

test('native geometry validator rejects false progress, obscured targets and missing model pixels', () => {
  const wrongPosition = fixture(280, 180, .5);
  wrongPosition.marker = fixture(280, 180, 0).marker;
  assert.throws(() => assertRouteRailGeometry(wrongPosition, .5), /actual car position/);
  const obscured = fixture(320, 200, 1);
  obscured.utilities[0].hits[1] = false;
  assert.throws(() => assertRouteRailGeometry(obscured, 1), /receive hits/);
  const empty = fixture(400, 240, 0);
  empty.canvasInk = 0;
  assert.throws(() => assertRouteRailGeometry(empty, 0), /visible pixels/);
  const collision = fixture(280, 180, 1);
  collision.utilities[0] = {...collision.utilities[0], ...box(140, 0, 44, 44)};
  assert.throws(() => assertRouteRailGeometry(collision, 1), /collide/);
});
