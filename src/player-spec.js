// Conservative gameplay envelope for the reference-built Rocket, in metres.
// These are collision allowances around the exported model, not Tesla dimensions.
// The asset regression checks the wing travel and steered wheels against them.
export const PLAYER_BOUNDS = Object.freeze({ length: 4.7, width: 2.3, height: 1.35 });
