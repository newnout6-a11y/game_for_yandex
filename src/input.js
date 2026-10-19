const actions = Object.freeze({ ArrowLeft:'left', KeyA:'left', ArrowRight:'right', KeyD:'right', ArrowUp:'gas', KeyW:'gas', ArrowDown:'brake', KeyS:'brake', Space:'boost', KeyF:'flight', KeyQ:'rollLeft', KeyE:'rollRight', KeyH:'horn' });
export class DrivingInput {
  /**
   * Create independent input-source ownership so one finger/key release cannot cancel another.
   */
  constructor() { this.held = new Map(); this.analog = new Map(); }
  /**
   * Add or release one physical input source; unknown actions are ignored.
   * @param {string} action - Logical steering, pedal, boost, flight or roll action.
   * @param {string} source - Stable key code or pointer/button source identifier.
   * @param {boolean} down - True to hold; false removes only this source.
   */
  set(action, source, down) {
    if (!['left','right','gas','brake','boost','touchBoost','flight','rollLeft','rollRight','horn'].includes(action)) return;
    if (down) this.held.set(source, action); else this.held.delete(source);
  }
  /** A held touch nitro button owns gas and boost together, never two competing map entries. */
  setTouch(action, source, down) { this.set(action === 'boost' ? 'touchBoost' : action, source, down); }
  /** Empty reserve disarms only touch nitro; refilling cannot revive a disabled held button. */
  releaseEmptyTouchBoost(reserve) { if (reserve <= 0) for (const [source, action] of this.held) if (action === 'touchBoost') this.held.delete(source); }
  /** Store finite bounded analog axes for one independent touch source; zero releases that source. */
  setAnalog(source, controls = {}) {
    const clamp=(value,min,max)=>Number.isFinite(value)?Math.min(max,Math.max(min,value)):0;
    const sample={steer:clamp(controls.steer,-1,1),throttle:clamp(controls.throttle,0,1),brake:clamp(controls.brake,0,1)};
    if(sample.steer||sample.throttle||sample.brake)this.analog.set(source,sample);else this.analog.delete(source);
  }
  /**
   * Translate KeyboardEvent.code into a logical action without consuming unrelated keys.
   * @param {string} code - Physical keyboard code such as KeyW.
   * @param {boolean} down - Press/release state.
   * @returns {boolean} Whether the code belongs to a driving control.
   */
  key(code, down) {
    if (!actions[code]) return false;
    this.set(actions[code], code, down); return true;
  }
  /**
   * Release one source after pointer cancellation or capture loss.
   * @param {string} source - The exact identifier previously passed to set.
   */
  release(source) { this.held.delete(source); this.analog.delete(source); }
  /**
   * Check whether any source still holds the requested action.
   * @param {string} action - Logical control name.
   * @returns {boolean} True even if another source for the same action was released.
   */
  active(action) { for (const held of this.held.values()) if (held === action || (held === 'touchBoost' && (action === 'boost' || action === 'gas'))) return true; return false; }
  /**
   * Return a fresh simulation control sample without mutating held inputs.
   * @returns {Object} Signed steer/roll axes (-1, 0, +1), binary pedals and boolean boost/flight.
   */
  read() { const samples=[...this.analog.values()],last=samples.at(-1)||{},left=this.active('left'),right=this.active('right'); return { steer:left||right?Number(right)-Number(left):(last.steer||0), throttle:Math.max(Number(this.active('gas')),...samples.map(s=>s.throttle)), brake:Math.max(Number(this.active('brake')),...samples.map(s=>s.brake)), boost:this.active('boost'), flight:this.active('flight'), horn:this.active('horn'), roll:Number(this.active('rollRight'))-Number(this.active('rollLeft')) }; }
  /**
   * Release every key and pointer source when pausing, crashing, blurring or starting a run.
   */
  clear() { this.held.clear(); this.analog.clear(); }
}
