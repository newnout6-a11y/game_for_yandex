// Independent reasons cannot accidentally cancel another source of pause.
/**
 * Track independent pause owners so resuming one source cannot clear another pause.
 * @param {Function} onChange - Called with the aggregate paused flag when membership changes.
 * @returns {Object} Pause/resume operations and read-only snapshots of current reasons.
 */
export function createLifecycle(onChange = () => {}) {
  const reasons = new Set();
  return {
    /**
     * Add a pause reason once and notify only when the reason set changes.
     * @param {string} reason - Owner such as user, hidden, platform or ad.
     */
    pause(reason) { const size = reasons.size; reasons.add(reason); if (size !== reasons.size) onChange(reasons.size > 0); },
    /**
     * Release only this owner's pause; other reasons remain in force.
     * @param {string} reason - Previously registered pause owner.
     */
    resume(reason) { if (reasons.delete(reason)) onChange(reasons.size > 0); },
    /**
     * Return whether at least one independent pause reason is still active.
     */
    get paused() { return reasons.size > 0; },
    /**
     * Test a single pause owner without exposing the mutable reason set.
     */
    has: reason => reasons.has(reason),
    /**
     * Return a detached array for displaying blockers or filtering the user pause.
     */
    reasons: () => [...reasons],
  };
}
