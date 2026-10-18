/**
 * Session-only interstitial pacing. These are our UX guards, not Yandex rate limits.
 * All seconds below mean validated active driving from RunTelemetry, never wall time.
 */
export const DEFAULT_AD_CADENCE = Object.freeze({
  minimumCompletedRuns: 3,
  minimumRunSeconds: 45,
  minimumRunMetres: 500,
  minimumSessionSeconds: 180,
  minimumSecondsBetweenRequests: 180,
  skipAfterRewardedSeconds: 180,
  failureBackoffSeconds: 30,
});

/** Copy recognized finite configuration fields; invalid values retain safe defaults. */
export function normalizeAdCadenceRules(options = {}) {
  const rules = { ...DEFAULT_AD_CADENCE };
  for (const key of Object.keys(rules)) {
    const value = options?.[key];
    if (Number.isFinite(value) && value >= 0 && (key !== 'minimumCompletedRuns' || Number.isSafeInteger(value) && value >= 1)) rules[key] = value;
  }
  return Object.freeze(rules);
}

/** A reload starts a fresh session. No profile totals, browser time or SDK calls belong here. */
export function createAdCadenceState() {
  return {
    activeSeconds: 0,
    qualifiedRuns: 0,
    latestSequence: 0,
    runActiveSeconds: 0,
    runDistanceM: 0,
    runQualified: false,
    runTutorial: false,
    runEndedNaturally: false,
    lastInterstitialAt: null,
    lastRewardedAt: null,
    failedAt: null,
    attemptedSequence: 0,
    inFlightSequence: null,
  };
}

/** Only a real natural end qualifies; starting/retrying/quitting a run never does. */
export function qualifiesForAdCadence(metrics, { reason, tutorial = false } = {}, options = DEFAULT_AD_CADENCE) {
  const rules = normalizeAdCadenceRules(options);
  return tutorial !== true && (reason === 'crash' || reason === 'finish') &&
    Number.isFinite(metrics?.activeSeconds) && metrics.activeSeconds >= rules.minimumRunSeconds &&
    Number.isFinite(metrics?.distanceM) && metrics.distanceM >= rules.minimumRunMetres;
}

/**
 * Pure eligibility check for an explicit results-screen Continue/Menu action.
 * SDK availability must reflect a real initialized showFullscreenAdv method.
 */
export function getAdEligibility(state, context = {}, options = DEFAULT_AD_CADENCE) {
  const rules = normalizeAdCadenceRules(options);
  const reject = reason => ({ eligible: false, reason });
  if (context.screen !== 'results' || !['continue', 'menu'].includes(context.action)) return reject('NOT_RESULTS_TRANSITION');
  if (context.sdkAvailable !== true) return reject('SDK_UNAVAILABLE');
  if (!Number.isSafeInteger(context.sequence) || context.sequence <= 0 || context.sequence !== state.latestSequence) return reject('INVALID_RUN');
  if (state.inFlightSequence !== null) return reject('IN_FLIGHT');
  if (context.sequence <= state.attemptedSequence) return reject('ALREADY_ATTEMPTED');
  if (!state.runEndedNaturally || state.runTutorial) return reject('NOT_NATURAL_END');
  if (!state.runQualified) return reject('RUN_NOT_QUALIFIED');
  if (state.qualifiedRuns < rules.minimumCompletedRuns) return reject('RUN_QUOTA');
  if (state.activeSeconds < rules.minimumSessionSeconds) return reject('SESSION_ACTIVE_TIME');
  if (state.lastInterstitialAt !== null && state.activeSeconds - state.lastInterstitialAt < rules.minimumSecondsBetweenRequests) return reject('EXPOSURE_COOLDOWN');
  if (state.lastRewardedAt !== null && state.activeSeconds - state.lastRewardedAt < rules.skipAfterRewardedSeconds) return reject('REWARDED_COOLDOWN');
  if (state.failedAt !== null && state.activeSeconds - state.failedAt < rules.failureBackoffSeconds) return reject('FAILURE_BACKOFF');
  return { eligible: true, reason: 'ELIGIBLE' };
}

/**
 * Merge one cumulative telemetry receipt without replaying samples or old runs.
 * A legitimate revive retains the same sequence and cumulative telemetry instance.
 */
function observeRun(state, event) {
  const sequence = event.sequence;
  if (!Number.isSafeInteger(sequence) || sequence <= 0 || sequence < state.latestSequence) return state;
  let next = sequence > state.latestSequence ? {
    ...state, latestSequence: sequence, runActiveSeconds: 0, runDistanceM: 0,
    runQualified: false, runTutorial: false, runEndedNaturally: false,
  } : { ...state };
  const seconds = event.metrics?.activeSeconds;
  const distance = event.metrics?.distanceM;
  if (Number.isFinite(seconds) && seconds >= 0 && seconds > next.runActiveSeconds) {
    next.activeSeconds = Math.min(Number.MAX_SAFE_INTEGER, next.activeSeconds + seconds - next.runActiveSeconds);
    next.runActiveSeconds = seconds;
    next.runEndedNaturally = false;
  }
  if (Number.isFinite(distance) && distance >= 0) next.runDistanceM = Math.max(next.runDistanceM, distance);
  next.runTutorial ||= event.tutorial === true;
  return next;
}

/**
 * Pure reducer. Ad outcomes are exposure receipts, not a promise that an ad was served.
 * A failed/no-fill attempt retains its earned run quota and cannot repeat this transition.
 */
export function reduceAdCadence(state, event, options = DEFAULT_AD_CADENCE) {
  const rules = normalizeAdCadenceRules(options);
  if (!event || typeof event !== 'object') return state;
  if (event.type === 'OBSERVE_RUN') return observeRun(state, event);
  if (event.type === 'COMPLETE_RUN') {
    const next = observeRun(state, event);
    if (next === state) return state;
    next.runEndedNaturally = event.reason === 'crash' || event.reason === 'finish';
    if (!next.runQualified && qualifiesForAdCadence({ activeSeconds: next.runActiveSeconds, distanceM: next.runDistanceM }, { reason: event.reason, tutorial: next.runTutorial }, rules)) {
      next.runQualified = true;
      next.qualifiedRuns++;
    }
    return next;
  }
  if (event.type === 'BEGIN_TRANSITION') {
    if (!getAdEligibility(state, event.context, rules).eligible) return state;
    return { ...state, attemptedSequence: event.context.sequence, inFlightSequence: event.context.sequence };
  }
  if (event.type === 'SETTLE_INTERSTITIAL') {
    if (state.inFlightSequence === null || event.outcome?.pending === true || event.sequence !== undefined && event.sequence !== state.inFlightSequence) return state;
    if (event.outcome?.shown === true) {
      return { ...state, inFlightSequence: null, qualifiedRuns: 0, lastInterstitialAt: state.activeSeconds, failedAt: null };
    }
    return { ...state, inFlightSequence: null, failedAt: state.activeSeconds };
  }
  if (event.type === 'REWARDED_EXPOSURE' && event.outcome?.shown === true) return { ...state, lastRewardedAt: state.activeSeconds };
  return state;
}

/**
 * Thin stateful facade over the pure policy; never calls the SDK, sleeps or blocks gameplay.
 * Observe before requesting rewarded/interstitial ads so their active-time baseline is current.
 */
export function createAdCadence(options = {}) {
  const rules = normalizeAdCadenceRules(options);
  let state = createAdCadenceState();
  const apply = event => { state = reduceAdCadence(state, event, rules); return { ...state }; };
  return {
    rules,
    /** Merge cumulative active driving. Manual quits may accrue time but never qualified runs. */
    observeRun: (sequence, metrics, { tutorial = false } = {}) => apply({ type: 'OBSERVE_RUN', sequence, metrics, tutorial }),
    /** Count a qualifying naturally ended run at most once, including across revive callbacks. */
    completeRun: (sequence, metrics, { reason, tutorial = false } = {}) => apply({ type: 'COMPLETE_RUN', sequence, metrics, reason, tutorial }),
    /** Inspect eligibility without reserving or consuming an advertising opportunity. */
    eligibility: context => getAdEligibility(state, context, rules),
    /** Reserve the only SDK attempt allowed for this run's results transition. */
    beginTransition: context => {
      const decision = getAdEligibility(state, context, rules);
      if (decision.eligible) apply({ type: 'BEGIN_TRANSITION', context });
      return { ...decision, sequence: context?.sequence };
    },
    /** Only shown:true consumes quota, even if a shown ad later reports an error. */
    settleInterstitial: (outcome, sequence) => apply({ type: 'SETTLE_INTERSTITIAL', outcome, sequence }),
    /** Any actually shown rewarded ad suppresses interstitials, even without a reward grant. */
    recordRewarded: outcome => apply({ type: 'REWARDED_EXPOSURE', outcome }),
    /** Return a detached snapshot for diagnostics/tests, never a live mutable state reference. */
    snapshot: () => ({ ...state }),
  };
}
