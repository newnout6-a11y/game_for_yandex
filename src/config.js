export const CONFIG = Object.freeze({
  lanes: 3, baseSpeed: 0, maxSpeed: 52, acceleration: 8,
  brakeDeceleration: 19, coastDeceleration: .8, steeringRate: 1.25,
  spawnDistance: 68, viewDistance: 230, collisionDepth: 3.3,
  collisionWidth: 0.65, goal: 1500, nitroDrain: 25,
  nitroPickup: 22, maxRevives: 1,
});

// Persisted keys retain compatibility with existing saves; every setting is daylight.
export const ROUTES = Object.freeze({
  ring: { name: 'Загородное шоссе', time: '14:20', index: '01', density: .64 },
  neon: { name: 'Сосновый бор', time: '14:20', index: '02', density: 1 },
  dawn: { name: 'Открытая дорога', time: '14:20', index: '03', density: .25 },
});
export const DIFFICULTIES = Object.freeze({
  flow: { name: 'Поток', speed: 1, spacing: 1, score: 1 },
  rush: { name: 'Час пик', speed: 1.16, spacing: 0.78, score: 1.5 },
});
