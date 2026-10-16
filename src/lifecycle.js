// Independent reasons cannot accidentally cancel another source of pause.
export function createLifecycle(onChange = () => {}) {
  const reasons = new Set();
  return {
    pause(reason) { const size = reasons.size; reasons.add(reason); if (size !== reasons.size) onChange(reasons.size > 0); },
    resume(reason) { if (reasons.delete(reason)) onChange(reasons.size > 0); },
    get paused() { return reasons.size > 0; },
    has: reason => reasons.has(reason),
    reasons: () => [...reasons],
  };
}
