/** One bounded horn/headlamp request; holding a key never spams other drivers. */
export const HORN = Object.freeze({duration:.48,cooldown:1.15});

/**
 * Advance the shared audible/visible request in simulation seconds. A rising
 * press outside cooldown emits once; presses during cooldown are not queued.
 * @param {Object} state - Mutable run, with phase and optional signal fields.
 * @param {boolean} pressed - Current key/touch hold, already lifecycle-gated.
 * @param {number} dt - Finite nonnegative simulation seconds.
 * @param {Function} [emit] - Receives 'horn' and the monotonic request serial.
 * @returns {boolean} Whether this step accepted a new request.
 */
export function updatePlayerHorn(state,pressed,dt,emit=()=>{}) {
  if(state.phase!=='playing'||!Number.isFinite(dt)||dt<0)return false;
  state.hornTime=Math.max(0,(state.hornTime||0)-dt);
  state.hornCooldown=Math.max(0,(state.hornCooldown||0)-dt);
  const rising=Boolean(pressed)&&!state.hornHeld;state.hornHeld=Boolean(pressed);
  if(!rising||state.hornCooldown>1e-8)return false;
  state.hornTime=HORN.duration;state.hornCooldown=HORN.cooldown;
  state.hornSerial=(state.hornSerial||0)+1;emit('horn',state.hornSerial);return true;
}

/**
 * Return the headlamp flash envelope from the same pulse as the horn, not a
 * separate wall clock. Paused rendering therefore retains an identical frame.
 * @param {Object} state - Run carrying hornTime in seconds and current phase.
 * @returns {number} Bounded lamp intensity multiplier between zero and one.
 */
export function playerHighBeam(state) {
  if(state.phase!=='playing')return 0;
  const remaining=Math.max(0,Math.min(HORN.duration,Number(state.hornTime)||0));
  return Math.min(1,remaining/.09);
}
