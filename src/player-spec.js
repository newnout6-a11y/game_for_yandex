// Conservative gameplay envelope for the reference-built Rocket, in metres.
// These are collision allowances around the exported model, not Tesla dimensions.
// The asset regression checks wing travel, steered wheels and the requested
// full-size left mirror. Axles stay centred; the asymmetric mirror reaches
// X=-1.170m, so both collision and lane reservations retain 1.18m half-width.
export const PLAYER_BOUNDS = Object.freeze({ length: 4.7, width: 2.36, height: 1.35 });
