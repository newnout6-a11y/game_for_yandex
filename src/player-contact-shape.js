// Conservative authored Rocket compound, metres, +X right / -Z nose.
// Exact exported mesh d71068fb…; separate wheel and mirror envelopes avoid
// extruding the widest mirror over the nose/tail. These are solid proxies,
// not a triangle-level CAD claim. See docs/handling-contact-physics.md.
export const ROCKET_CONTACT_SHAPE=Object.freeze([
  {
    "id": "nose",
    "role": "body",
    "centerX": 0.0,
    "centerY": 0.45,
    "centerZ": -2.125,
    "halfWidth": 0.98,
    "halfHeight": 0.34,
    "halfLength": 0.2450000000000001
  },
  {
    "id": "front_body",
    "role": "body",
    "centerX": 0.0,
    "centerY": 0.54,
    "centerZ": -1.45,
    "halfWidth": 1.07,
    "halfHeight": 0.43,
    "halfLength": 0.47
  },
  {
    "id": "cabin",
    "role": "body",
    "centerX": 0.0,
    "centerY": 0.675,
    "centerZ": -0.125,
    "halfWidth": 1.0,
    "halfHeight": 0.565,
    "halfLength": 0.895
  },
  {
    "id": "rear_body_wheels",
    "role": "body_and_rear_wheels",
    "centerX": 0.0,
    "centerY": 0.64,
    "centerZ": 1.3,
    "halfWidth": 1.09,
    "halfHeight": 0.64,
    "halfLength": 0.5700000000000001
  },
  {
    "id": "tail",
    "role": "body",
    "centerX": 0.0,
    "centerY": 0.665,
    "centerZ": 2.1,
    "halfWidth": 1.03,
    "halfHeight": 0.605,
    "halfLength": 0.27
  },
  {
    "id": "front_wheel_left",
    "role": "wheel",
    "centerX": -0.895,
    "centerY": 0.39,
    "centerZ": -1.455,
    "halfWidth": 0.26499999999999996,
    "halfHeight": 0.39,
    "halfLength": 0.405
  },
  {
    "id": "front_wheel_right",
    "role": "wheel",
    "centerX": 0.895,
    "centerY": 0.39,
    "centerZ": -1.455,
    "halfWidth": 0.26499999999999996,
    "halfHeight": 0.39,
    "halfLength": 0.405
  },
  {
    "id": "mirror_left",
    "role": "mirror",
    "centerX": -1.0,
    "centerY": 0.915,
    "centerZ": -0.675,
    "halfWidth": 0.18999999999999995,
    "halfHeight": 0.09500000000000003,
    "halfLength": 0.07500000000000001
  },
  {
    "id": "mirror_right",
    "role": "mirror",
    "centerX": 0.9550000000000001,
    "centerY": 0.8700000000000001,
    "centerZ": -0.6599999999999999,
    "halfWidth": 0.14500000000000002,
    "halfHeight": 0.06,
    "halfLength": 0.07
  }
].map(part=>Object.freeze(part)));
