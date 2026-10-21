import { CONFIG } from './config.js';

// Keep feedback timely instead of building an unbounded spoken history of a drive.
export const BONUS_ANNOUNCEMENT_LIMIT = 4;
export const BONUS_ANNOUNCEMENT_GAP_MS = 80;
export const BONUS_ANNOUNCEMENT_HOLD_MS = 2400;

/** Restore the original reward information without creating a visible text cue. */
export function bonusAnnouncement(event, value) {
  if (event === 'near' && Number.isInteger(value) && value >= 2 && value <= 5) return 'Близко! Комбо ×' + value + '.';
  if (event === 'charge') return 'Подобран заряд: +' + CONFIG.nitroPickup + '% энергии, запас не выше 100%.';
  if (event === 'goal') return CONFIG.goal.toLocaleString('ru-RU') + ' м. Цель пройдена.';
  if (event === 'event-clear' && value?.success === true && Number.isFinite(value.points) && value.points >= 0) {
    return 'Событие пройдено. +' + value.points + ' очков и +15% нитро, запас не выше 100%.';
  }
  return '';
}

/**
 * A bounded, event-driven polite live region. The blank interval makes two
 * identical rewards separate DOM updates; no frame polling or idle timer runs.
 * Lifecycle owners must sync activity, or suspend before hiding/inerting the HUD.
 */
export function createBonusAnnouncements(element, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let state = null, revives = 0, active = false, disposed = false, timer = null;
  let generation = 0;
  const queue = [];
  const write = text => { if (element && element.textContent !== text) element.textContent = text; };
  const clear = () => {
    generation++;
    if (timer !== null) clearTimer(timer);
    timer = null; queue.length = 0; write('');
  };
  const current = () => !disposed && active && state?.phase === 'playing' && state.revives === revives;
  const schedule = (callback, delay) => {
    const owner = generation;
    timer = setTimer(() => {
      if (owner !== generation || disposed) return;
      timer = null;
      if (!current()) { active = false; clear(); return; }
      callback();
    }, delay);
  };
  const next = () => {
    if (!current()) { clear(); return; }
    write('');
    if (!queue.length) return;
    schedule(() => {
      const message = queue.shift();
      write(message);
      schedule(next, Math.min(6000, Math.max(BONUS_ANNOUNCEMENT_HOLD_MS, message.length * 60)));
    }, BONUS_ANNOUNCEMENT_GAP_MS);
  };
  return {
    /** State replacement/reset, revive, crash, pause and menu never replay old rewards. */
    sync(nextState, enabled) {
      if (disposed) return;
      const nextActive = !!element && enabled === true && nextState?.phase === 'playing';
      const nextRevives = nextState?.revives;
      if (state !== nextState || revives !== nextRevives || active !== nextActive) clear();
      state = nextState; revives = nextRevives; active = nextActive;
    },
    /** Ordinary passes, failures and ability events deliberately produce no reward speech. */
    announce(event, value, nextState) {
      if (disposed) return false;
      this.sync(nextState, active);
      const message = bonusAnnouncement(event, value);
      if (!current() || !message) return false;
      if (queue.length >= BONUS_ANNOUNCEMENT_LIMIT) queue.shift();
      queue.push(message);
      if (timer === null) next();
      return true;
    },
    suspend() { active = false; clear(); },
    dispose() { if (disposed) return; active = false; disposed = true; clear(); state = null; },
    get pendingCount() { return queue.length; },
  };
}
