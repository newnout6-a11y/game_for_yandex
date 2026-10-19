import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { CONFIG } from '../src/config.js';
import { seededRandom } from '../src/util.js';
import { trafficCollisionParts, rectanglesOverlap, roadCurve, roadYaw } from '../src/traffic-physics.js';

/**
 * Build a conservative physical road-object rectangle in the traffic scene's
 * coordinate system, including road bend and orientation. Metres, not lanes.
 * @param {Object} obstacle - Authored cone/barrier at a lane coordinate and z.
 * @param {number} distance - Current player travel distance in metres.
 * @returns {Object} SAT descriptor compatible with rectanglesOverlap.
 */
function obstacleRectangle(obstacle, distance) {
  const yaw = roadYaw(-obstacle.z, distance);
  return { x: (obstacle.x - 1) * 3.5 + roadCurve(-obstacle.z, distance), z: -obstacle.z,
    halfWidth: obstacle.kind === 'barrier' ? 1.35 : .3,
    halfLength: obstacle.kind === 'barrier' ? .5 : .3,
    right: [Math.cos(yaw), -Math.sin(yaw)], forward: [Math.sin(yaw), Math.cos(yaw)] };
}

// These are production Game runs, not a second test-only traffic model. Keep
// the player on a fixed lane and cruise, and disable only player crash removal:
// the assertion is about NPC-to-NPC/obstacle safety, not immunity when a player
// deliberately stays on a collision course. Every 120 Hz tick checks actual
// tractor/trailer OBBs, including yaw and the independently lagging trailer.
for (const events of [false, true]) for (const [seed, cruise] of [[3, 22], [7, 35], [11, 45]]) {
  test(`seed ${seed}, ${cruise} m/s, events ${events}: 150 s of full-body traffic safety and changing corridors`, () => {
    const game = new Game({ random: seededRandom(seed) }); game.start();
    Object.assign(game.state, { invincible: 1e9, speed: cruise, x: 1, lane: 1,
      ...(!events ? { nextEvent: Infinity } : {}) });
    const throttle = (CONFIG.coastDeceleration + cruise ** 2 * .0012) / game.playerConfig.acceleration;
    let count = 0, hazardsObserved = 0, maximum = 0;
    const frames = 120 * 150;
    for (let step = 0; step < frames; step++) {
      game.update(1 / 120, { throttle });
      const state = game.state, traffic = state.traffic;
      const parts = traffic.map(car => trafficCollisionParts(car, state.distance));
      count += traffic.length; maximum = Math.max(maximum, traffic.length);
      hazardsObserved += state.obstacles.length;
      for (let i = 0; i < traffic.length; i++) {
        const car = traffic[i];
        for (let j = i + 1; j < traffic.length; j++) {
          if (Math.abs(car.z - traffic[j].z) > 25) continue;
          assert.ok(!parts[i].some(a => parts[j].some(b => rectanglesOverlap(a, b))),
            `NPC OBB overlap at ${step / 120}s: ${car.id}/${car.kind}, ${traffic[j].id}/${traffic[j].kind}`);
        }
        for (const obstacle of state.obstacles) {
          if (obstacle.hit || Math.abs(obstacle.z - car.z) > 20) continue;
          const rectangle = obstacleRectangle(obstacle, state.distance);
          assert.ok(!parts[i].some(part => rectanglesOverlap(part, rectangle)),
            `NPC/object overlap at ${step / 120}s: ${car.id}/${car.kind}, ${obstacle.id}/${obstacle.kind}`);
        }
      }
    }
    assert.equal(game.state.trafficDiagnostics.interventions, 0, 'normal generated runs must not need position/speed snap guards');
    assert.ok(game.state.trafficDiagnostics.corridorChanges >= 2, 'no permanently empty preferred lane');
    assert.ok(count / frames >= 2 && count / frames <= 18, 'bounded but nonempty playable demand');
    assert.ok(maximum <= 24, 'bounded visible simulation population');
    if (events) assert.ok(hazardsObserved > 0, 'hazard safety must exercise actual generated roadworks');
  });
}
