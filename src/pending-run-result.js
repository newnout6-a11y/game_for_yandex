import { getRunDoubleOffer, LIMITS, sanitizeProfile } from './progression.js';

/** A saved receipt is data, never a physical Game or a resumable telemetry observer. */
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/**
 * Project an unfinished saved receipt into the result panel without replaying settlement.
 * Only a persisted crash-result marker restores its optional double choice. An autosave
 * or legacy receipt can expose already-earned progress, but must not invent a crash.
 * No profile, wallet, record, simulation, advertisement or persistence state is changed.
 */
export function recoverPendingRunResult(profile, { localSaved = true } = {}) {
  const ledger = profile?.ledger;
  const source = ledger?.activeRun;
  if (!record(ledger) || !record(source)) return null;

  // Check provenance before sanitation: repairing counters must not revive an old,
  // foreign or already-consumed receipt as the latest active result.
  if (!Number.isSafeInteger(ledger.nextSequence) || ledger.nextSequence < 2 ||
      !Number.isSafeInteger(ledger.finalizedThrough) || ledger.finalizedThrough < 0 ||
      !Number.isSafeInteger(source.sequence) || source.sequence !== ledger.nextSequence - 1 ||
      source.sequence <= ledger.finalizedThrough || source.finalized === true ||
      source.adClaimed === true || source.finishChoice === 'finish' || source.finishChoice === 'double' ||
      !Array.isArray(profile.ownedVehicles) || !profile.ownedVehicles.includes(source.vehicleId)) return null;

  // A corrupt wallet must not become an apparent empty wallet with room for an ad reward.
  if (!Number.isSafeInteger(profile.wallet?.credits) || profile.wallet.credits < 0 || profile.wallet.credits > LIMITS.credits) return null;
  const snapshot = sanitizeProfile(profile);
  const run = snapshot?.ledger.activeRun;
  if (!run) return null;
  const metrics = structuredClone(run.telemetry);
  if (!(metrics.distanceM > 0 || metrics.activeSeconds > 0)) return null;

  const recoveryKind = run.resultPending === true ? 'result' : 'interrupted';
  const offer = getRunDoubleOffer(snapshot, run);
  const pendingResult = recoveryKind === 'result';
  return {
    run,
    result: {
      recovered: true,
      recoveryKind,
      vehicleId: run.vehicleId,
      mode: run.mode,
      runIdentity: { id: run.id, sequence: run.sequence },
      score: metrics.rawScore,
      distance: metrics.distanceM,
      flightTime: metrics.airSeconds,
      metrics,
      modified: run.mode === 'tuned',
      continued: run.finishChoice === 'continue' || metrics.revives > 0,
      settled: true,
      receipt: {
        credits: run.creditsGranted + run.onboardingGranted,
        baseCredits: run.creditsGranted,
        xp: run.xpGranted,
      },
      onboarding: run.onboardingGranted,
      canRevive: false,
      bonusEligible: pendingResult && offer.eligible,
      bonusCredits: pendingResult ? offer.credits : 0,
      bonusReason: pendingResult ? offer.reason : 'interrupted-run',
      bonusClaimed: false,
      finalized: false,
      newRecord: false,
      saveMessage: localSaved === true
        ? 'Восстановлено из сохранения на этом устройстве. Награда уже учтена.'
        : 'Награда учтена в этой сессии. Локальное сохранение недоступно.',
    },
  };
}
