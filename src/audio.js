export class GameAudio {
  /**
   * Create a silent, lazy audio controller; no AudioContext is allocated before a user gesture.
   * @param {boolean} enabled - Persisted sound preference.
   */
  constructor(enabled = false) { this.enabled = enabled; this.context = null; }
  /**
   * Lazily construct the engine graph and resume it after a user action.
   * Unsupported or blocked browser audio is optional and never interrupts gameplay.
   * @returns {Promise<void>} Resolves after the resume attempt, including unsupported browsers.
   */
  async unlock() {
    try {
      if (!this.enabled) return;
      if (!this.context) {
        this.context = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
        this.master = this.context.createGain();
        this.master.gain.value = 0;
        this.master.connect(this.context.destination);
        this.engine = this.context.createOscillator();
        this.engine.type = 'sawtooth';
        this.engineGain = this.context.createGain();
        this.engineGain.gain.value = .018;
        this.filter = this.context.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.frequency.value = 240;
        this.engine.connect(this.filter).connect(this.engineGain).connect(this.master);
        this.engine.start();
      }
      await this.context.resume();
    } catch { /* Sound is optional on unsupported browsers. */ }
  }
  /**
   * Smooth engine pitch/filter from the current run and mute when sound or gameplay is inactive.
   * @param {Object} state - Run state with speed in metres/second and a boosting flag.
   * @param {boolean} active - Whether gameplay is currently audible; no context means a no-op.
   */
  update(state, active) {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(this.enabled && active ? .65 : 0, now, .06);
    this.engine.frequency.setTargetAtTime(35 + state.speed * 1.25, now, .1);
    this.filter.frequency.setTargetAtTime(state.boosting ? 650 : 230, now, .1);
  }
  /**
   * Play a short self-terminating feedback oscillator without affecting the engine graph.
   * @param {string} kind - Crash uses a falling low tone; goal and other events use rising cues.
   */
  tone(kind) {
    if (!this.enabled || !this.context) return;
    try {
      const now = this.context.currentTime;
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      osc.type = kind === 'crash' ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(kind === 'crash' ? 110 : kind === 'goal' ? 660 : 520, now);
      osc.frequency.exponentialRampToValueAtTime(kind === 'crash' ? 35 : 1040, now + .16);
      gain.gain.setValueAtTime(.075, now);
      gain.gain.exponentialRampToValueAtTime(.0001, now + .25);
      osc.connect(gain).connect(this.context.destination);
      osc.start(now); osc.stop(now + .26);
    } catch { /* Effects cannot interrupt a run. */ }
  }
}
