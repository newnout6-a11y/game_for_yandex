import { PROFILE_VERSION, LIMITS, createProfile, sanitizeProfile } from './progression.js';

export const CLOUD_PROFILE_KEY = 'aerokraiGarageV2';
const WINDOW_MS = 300000;
const MAX_ENVELOPE_BYTES = 195000;
/** Return a detached snapshot without exposing live references to profiles or service state. */
const copy = value => structuredClone(value);
/** Compare normalized profiles as complete snapshots, never by taking maximum wallet balances. */
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Count UTF-8 bytes so non-ASCII text cannot circumvent the SDK payload limit. */
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
/** Build a public, non-sensitive error code without returning SDK receipts or server diagnostics. */
const fault = code => Object.assign(new Error(code), { code });
/** Accept bounded opaque identifiers without interpreting them as credentials or account proof. */
const shortString = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
/** Validate the money/schema boundary before applying the existing bounded progression sanitizer. */
function validProfile(raw) {
  try {
    if (!raw || raw.schemaVersion !== PROFILE_VERSION || !Number.isSafeInteger(raw.revision) || raw.revision < 0 ||
        !Number.isSafeInteger(raw.wallet?.credits) || raw.wallet.credits < 0 || raw.wallet.credits > LIMITS.credits ||
        bytes(raw) > LIMITS.profileBytes) return null;
    return sanitizeProfile(raw);
  } catch { return null; }
}
/** Bound an SDK/backend wait; timing out does not claim cancellation of its underlying side effect. */
function bounded(promise, milliseconds) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(fault('timeout')), milliseconds); });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

/**
 * Add guest cloud saves, explicit account switching and fail-closed payment orchestration.
 * The injected backend must verify signed identity, intents and receipts and atomically persist
 * its own ledger. This client neither verifies HMAC nor grants a client-computed paid reward.
 * @param {Object} options - SDK facade, independent lifecycle and createProgressionStorage instance.
 * @param {Object} [options.commerceConfig] - Explicit enabled/appId/products configuration; disabled by default.
 * @param {Object} [options.trustedBackend] - Authenticated durable commerce contract documented in docs.
 * @param {Function} [options.onState] - Called with detached, credential-free public state changes.
 * @param {Function} [options.now] - Millisecond clock used only for scheduling, not entitlement expiry.
 * @returns {Object} Bounded initialization, cloud queue/conflict and signed commerce methods.
 */
export function createPlatformServices({ sdk, lifecycle, profileStore, commerceConfig = {}, trustedBackend = null,
  onState = () => {}, now = () => Date.now(), timeoutMs = 6000, minSaveIntervalMs = 3500 } = {}) {
  if (!profileStore?.get || !profileStore?.replaceFromCloud || !profileStore?.status) throw new TypeError('profileStore-required');
  const timeout = Number.isFinite(timeoutMs) ? Math.max(1, timeoutMs) : 6000;
  const saveInterval = Number.isFinite(minSaveIntervalMs) ? Math.max(0, minSaveIntervalMs) : 3500;
  let real = null, player = null, disposed = false, generation = 0, initialized = null;
  let frozen = true, dialogOpen = false, authDialogPending = false, authOperation = null, refreshOperation = null;
  let pending = null, writer = null, saveTimer = null, lastWriteAt = -Infinity, durableFingerprint = null;
  let payments = null, backendSession = null, backendRevision = -1, backendFingerprint = null, catalogGeneration = -1;
  let catalogAt = -Infinity, catalogOperation = null, commerceOperation = null, sdkPurchaseInFlight = null;
  const calls = { player: [], data: [] }, subscriptions = [], pendingSubjects = new Set(), inFlightWrites = new Map(), inFlightConsumes = new Map();
  const state = {
    mode: 'local-preview', ready: false, lang: 'ru', identity: null, auth: 'unavailable', generation,
    local: profileStore.status(),
    cloud: { available: false, status: 'unavailable', durableRevision: null, queuedRevision: null, error: null },
    conflict: null,
    commerce: { available: false, status: 'unavailable', reason: 'not-configured', products: [], busy: false, pending: false },
  };
  /** Read a safe scheduling clock; a backwards system clock conservatively postpones writes. */
  function clock() { try { const stamp = now(); return Number.isFinite(stamp) && stamp >= 0 ? stamp : 0; } catch { return 0; } }
  /** Publish detached UI state while ensuring a broken renderer cannot break persistence. */
  function emit() { if (disposed) return; state.local = profileStore.status(); state.generation = generation; try { onState(copy(state)); } catch { /* UI failures are not storage failures. */ } }
  /** Check an operation's identity generation after every asynchronous boundary. */
  function current(epoch) { return !disposed && generation === epoch; }
  /** Abort side effects immediately before invocation if a dialog invalidated their owner. */
  function assertCurrent(epoch) { if (!current(epoch) || frozen || dialogOpen) throw fault('identity-changed'); }
  /** Reserve a conservative rolling-window SDK request allowance, returning the required wait. */
  function reserve(kind) {
    const stamp = clock(), limit = kind === 'player' ? 18 : 90, entries = calls[kind];
    while (entries.length && entries[0] <= stamp - WINDOW_MS) entries.shift();
    if (entries.length >= limit) return Math.max(1, entries[0] + WINDOW_MS - stamp);
    entries.push(stamp); return 0;
  }
  /** Clear only our scheduled write, leaving other lifecycle owners and platform timers alone. */
  function clearSaveTimer() { if (saveTimer !== null) clearTimeout(saveTimer); saveTimer = null; }
  /** Invalidate all identity-bound work before a dialog or player refresh can select another account. */
  function invalidate() {
    generation++; frozen = true; player = null; pending = null; writer = null; durableFingerprint = null; clearSaveTimer();
    payments = null; backendSession = null; backendRevision = -1; backendFingerprint = null; catalogGeneration = -1; catalogOperation = null;
    state.cloud = { available: false, status: 'frozen', durableRevision: null, queuedRevision: null, error: null };
    state.commerce = { available: false, status: 'unavailable', reason: 'identity-changing', products: [], busy: Boolean(commerceOperation || sdkPurchaseInFlight), pending: false };
    state.conflict = null; emit();
  }
  /** Keep both divergent snapshots visible until an explicit whole-profile choice is made. */
  function conflict(reason, cloud, source = 'sdk') {
    pending = null; clearSaveTimer();
    state.conflict = { reason, source, accountId: state.identity?.id || null, local: profileStore.get(), cloud: copy(cloud) };
    state.cloud.status = 'conflict'; state.cloud.queuedRevision = null;
    state.commerce.available = false; state.commerce.reason = 'cloud-conflict'; emit();
  }
  /** Recognize an untouched starter, which carries no earned progress to lose on a cloud restore. */
  function pristine(profile) { return equal(profile, sanitizeProfile(createProfile({ now: profile.createdAt, id: profile.profileId }))); }
  /** Unwrap our namespaced SDK save, rejecting future formats and malformed progress without overwriting them. */
  function decodeCloud(data) {
    const envelope = data?.[CLOUD_PROFILE_KEY];
    if (envelope === undefined || envelope === null) return null;
    if (envelope.formatVersion !== 1) throw fault('unsupported-cloud-version');
    const profile = validProfile(envelope.profile);
    if (!profile || bytes(envelope) > MAX_ENVELOPE_BYTES) throw fault('invalid-cloud-profile');
    return profile;
  }
  /** Return the common non-secret save outcome, including honest local storage availability. */
  function saveResult(status = state.cloud.status, reason = state.cloud.error) {
    return { status, reason: reason || null, localSaved: profileStore.status().localSaved === true,
      durableRevision: state.cloud.durableRevision, queuedRevision: state.cloud.queuedRevision };
  }
  /** Schedule a coalesced write without retaining a browser/game process solely for a retry timer. */
  function scheduleWrite(delay = 0) {
    if (disposed || frozen || state.conflict || writer || !pending || !player) return;
    clearSaveTimer();
    if (delay > 0) { saveTimer = setTimeout(() => { saveTimer = null; void drain(); }, delay); saveTimer.unref?.(); }
    else queueMicrotask(() => { if (!disposed) void drain(); });
  }
  /**
   * Write one coalesced snapshot. An SDK timeout is uncertain, not cancelled: the same identity's
   * writer stays reserved until its actual Promise settles, preventing a late older write racing a new one.
   */
  async function drain() {
    if (disposed || frozen || state.conflict || !player || !pending) return saveResult();
    if (writer) return writer.reply;
    if (inFlightWrites.get(state.identity.id)?.size) {
      state.cloud.status = 'uncertain'; state.cloud.error = 'previous-account-write-pending'; emit(); return saveResult();
    }
    const spacing = Math.max(0, lastWriteAt + saveInterval - clock());
    if (spacing) { scheduleWrite(spacing); return saveResult('queued', 'write-throttled'); }
    const wait = reserve('data');
    if (wait) { state.cloud.status = 'rate-limited'; state.cloud.error = 'sdk-rate-limit'; emit(); scheduleWrite(wait); return saveResult(); }
    const entry = pending, handle = player, epoch = generation;
    pending = null; clearSaveTimer(); lastWriteAt = clock();
    const envelope = { formatVersion: 1, accountId: state.identity.id, profile: entry.profile };
    if (bytes({ [CLOUD_PROFILE_KEY]: envelope }) > MAX_ENVELOPE_BYTES) {
      state.cloud.status = 'error'; state.cloud.error = 'profile-too-large'; emit(); return saveResult();
    }
    const owner = state.identity.id, job = { epoch, entry, reply: null }; writer = job;
    if (!inFlightWrites.has(owner)) inFlightWrites.set(owner, new Set());
    inFlightWrites.get(owner).add(job);
    state.cloud.status = 'saving'; state.cloud.error = null; emit();
    const operation = Promise.resolve().then(() => {
      if (!current(epoch) || frozen) throw fault('identity-changed');
      return handle.setData({ [CLOUD_PROFILE_KEY]: envelope }, entry.durable);
    }).then(() => {
      if (!current(epoch) || writer !== job) return saveResult('stale', 'identity-changed');
      if (entry.durable) { state.cloud.durableRevision = entry.profile.revision; durableFingerprint = JSON.stringify(entry.profile); }
      state.cloud.error = null;
      state.cloud.queuedRevision = pending?.profile.revision ?? (entry.durable ? null : entry.profile.revision);
      state.cloud.status = pending || !entry.durable ? 'queued' : 'durable'; emit(); return saveResult();
    }, error => {
      if (!current(epoch) || writer !== job) return saveResult('stale', 'identity-changed');
      if (!pending) pending = entry;
      state.cloud.status = 'error'; state.cloud.error = error?.code === 'identity-changed' ? 'identity-changed' : 'cloud-write-failed';
      state.cloud.queuedRevision = pending.profile.revision; emit(); return saveResult();
    }).finally(() => {
      const outstanding = inFlightWrites.get(owner); outstanding?.delete(job);
      if (!outstanding?.size) inFlightWrites.delete(owner);
      if (writer === job) writer = null;
      if (state.identity?.id === owner && state.cloud.status !== 'error') scheduleWrite();
    });
    job.reply = bounded(operation, timeout).catch(() => {
      if (current(epoch) && writer === job) { state.cloud.status = 'uncertain'; state.cloud.error = 'cloud-write-timeout'; emit(); }
      return saveResult(current(epoch) ? 'uncertain' : 'stale', current(epoch) ? 'cloud-write-timeout' : 'identity-changed');
    });
    return job.reply;
  }
  /**
   * Queue only the store's current validated snapshot; stale callers cannot overwrite newer local work.
   * The reducer/storage owns local commits. A queue acknowledgement is never a cloud-durability claim.
   */
  function queueSave(snapshot = profileStore.get(), { durable = true } = {}) {
    if (disposed) return saveResult('unavailable', 'disposed');
    const profile = validProfile(snapshot);
    if (!profile || !equal(profile, validProfile(profileStore.get()))) return saveResult('error', 'invalid-or-stale-profile');
    state.local = profileStore.status();
    if (state.local.readOnly) return saveResult('unavailable', 'local-read-only');
    if (state.conflict) { state.conflict.local = copy(profile); emit(); return saveResult('conflict', 'choice-required'); }
    if (frozen) { emit(); return saveResult(state.cloud.status, 'identity-not-ready'); }
    if (!player?.setData) { state.cloud.status = 'unavailable'; emit(); return saveResult('local', 'cloud-unavailable'); }
    if (!pending && durableFingerprint === JSON.stringify(profile) && !writer) return saveResult('durable');
    if (!pending && writer && equal(writer.entry.profile, profile) && (writer.entry.durable || durable !== true)) return saveResult('saving');
    pending = { profile, durable: durable === true || pending?.durable === true };
    state.cloud.queuedRevision = profile.revision; state.cloud.status = 'queued'; state.cloud.error = null; emit(); scheduleWrite();
    return saveResult('queued');
  }
  /** Retry local persistence and request a server-acknowledged save; rate limits still take precedence. */
  async function flush() {
    if (disposed) return saveResult('unavailable', 'disposed');
    profileStore.flush?.();
    if (state.conflict || frozen) { emit(); return saveResult(); }
    queueSave(profileStore.get(), { durable: true });
    if (writer) { await writer.reply; if (writer) return saveResult(); }
    if (!pending && durableFingerprint === JSON.stringify(validProfile(profileStore.get()))) return saveResult('durable');
    return drain();
  }
  /** Restore the SDK-selected account, never replaying a previous account's queued snapshot. */
  async function refreshIdentity(reason) {
    invalidate(); const epoch = generation;
    state.cloud.status = 'loading'; emit();
    const operation = (async () => {
      try {
        if (!real?.getPlayer) throw fault('player-unavailable');
        if (reserve('player')) throw fault('sdk-rate-limit');
        const candidate = await bounded(Promise.resolve().then(() => real.getPlayer()), timeout);
        if (!current(epoch) || dialogOpen) return getState();
        const id = candidate?.getUniqueID?.();
        if (!shortString(id) || typeof candidate.getData !== 'function' || typeof candidate.setData !== 'function') throw fault('invalid-player');
        player = candidate;
        state.identity = { id, authorized: candidate.isAuthorized?.() === true };
        state.auth = state.identity.authorized ? 'authorized' : 'guest';
        state.cloud.available = true; state.commerce.pending = pendingSubjects.has(id); emit();
        if (reserve('data')) throw fault('sdk-rate-limit');
        const data = await bounded(Promise.resolve().then(() => candidate.getData([CLOUD_PROFILE_KEY])), timeout);
        if (!current(epoch) || dialogOpen) return getState();
        const cloud = decodeCloud(data), local = validProfile(profileStore.get());
        if (!local || profileStore.status().readOnly) throw fault('local-read-only');
        frozen = false;
        if (cloud && equal(local, cloud)) {
          state.cloud.status = 'loaded'; state.cloud.error = null;
        } else if (cloud && pristine(local) && reason === 'initial') {
          const applied = profileStore.replaceFromCloud(cloud);
          if (!applied.ok) throw fault('cloud-replacement-failed');
          state.cloud.status = 'loaded'; state.cloud.error = null;
        } else if (!cloud && pristine(local) && reason === 'initial') {
          queueSave(local, { durable: true });
        } else {
          conflict(cloud ? 'different-progress' : 'local-unlinked', cloud);
        }
        emit(); return getState();
      } catch (error) {
        if (!current(epoch)) return getState();
        // A failed read must never be followed by an overwrite of an unknown remote save.
        frozen = true; state.cloud.status = 'error'; state.cloud.error = error?.code || 'cloud-load-failed';
        state.commerce.available = false; state.commerce.reason = 'cloud-unavailable'; emit(); return getState();
      } finally {
        if (current(epoch) && !dialogOpen) lifecycle?.resume?.('account-selection');
      }
    })();
    refreshOperation = operation;
    return operation;
  }
  /** Freeze all writers before the SDK's account-choice UI can change the current Player. */
  function accountOpened() {
    if (disposed || dialogOpen) return;
    dialogOpen = true; lifecycle?.pause?.('account-selection'); invalidate();
  }
  /** Reacquire the chosen identity on close; authorization handles its own close to avoid duplicate reads. */
  function accountClosed() {
    if (disposed) return;
    dialogOpen = false;
    if (!authDialogPending) void refreshIdentity('account-change').then(() => { if (!disposed && !state.conflict) void prepareCommerce(); });
  }
  /** Attach account events to the real SDK and retain teardown callbacks where the SDK supports them. */
  function subscribe() {
    if (!real?.on) return;
    for (const [key, handler] of [['ACCOUNT_SELECTION_DIALOG_OPENED', accountOpened], ['ACCOUNT_SELECTION_DIALOG_CLOSED', accountClosed]]) {
      const event = real.EVENTS?.[key] || key;
      try { const unsubscribe = real.on(event, handler); subscriptions.push({ event, handler, unsubscribe }); } catch { /* Local play remains available. */ }
    }
  }
  /** Initialize once without opening login or a purchase dialog, including for unauthenticated guests. */
  function init() {
    if (initialized) return initialized;
    initialized = (async () => {
      try { real = await bounded(Promise.resolve().then(() => sdk?.init?.() ?? sdk?.get?.() ?? null), timeout); } catch { real = null; }
      if (disposed) return getState();
      if (real) {
        state.mode = 'yandex';
        const lang = real.environment?.i18n?.lang;
        if (typeof lang === 'string' && lang.length <= 32) state.lang = lang;
        subscribe(); await refreshIdentity('initial');
        if (!disposed && !state.conflict && !frozen) await prepareCommerce();
      } else { frozen = false; state.cloud.status = 'unavailable'; }
      if (!disposed) { state.ready = true; emit(); }
      return getState();
    })();
    return initialized;
  }
  /** Return detached public state, excluding signatures, receipts, tokens and authenticated sessions. */
  function getState() { return copy({ ...state, local: profileStore.status(), generation }); }
  /**
   * Open login only for an explicit benefit-labelled CTA. A timeout keeps saves frozen until the
   * actual dialog settles; local free play can resume, but a second login cannot be stacked.
   */
  async function authorize({ userInitiated = false } = {}) {
    if (userInitiated !== true) return { status: 'unavailable', reason: 'explicit-user-action-required' };
    await init();
    if (disposed || !real?.auth?.openAuthDialog) return { status: 'unavailable', reason: 'auth-unavailable' };
    if (!frozen && state.identity?.authorized) return { status: 'authorized' };
    if (authOperation || commerceOperation || sdkPurchaseInFlight || dialogOpen || lifecycle?.has?.('ad')) return { status: 'unavailable', reason: 'busy' };
    invalidate(); state.auth = 'pending'; lifecycle?.pause?.('authorization'); emit();
    let rejected = false; authDialogPending = true;
    const operation = Promise.resolve().then(() => real.auth.openAuthDialog()).catch(() => { rejected = true; }).then(async () => {
      authDialogPending = false;
      if (disposed) return { status: 'unavailable', reason: 'disposed' };
      if (dialogOpen) return { status: 'pending', reason: 'account-selection' };
      await refreshIdentity('authorization');
      if (frozen && refreshOperation && !dialogOpen) await refreshOperation;
      if (!rejected && frozen) return { status: 'pending', reason: 'identity-unconfirmed' };
      if (!disposed && !state.conflict && !frozen) await prepareCommerce();
      return { status: state.identity?.authorized ? 'authorized' : rejected ? 'cancelled' : 'guest' };
    }).finally(() => { authOperation = null; authDialogPending = false; lifecycle?.resume?.('authorization'); });
    authOperation = operation;
    try { return await bounded(operation, timeout); }
    catch { if (!disposed) { state.auth = 'pending'; emit(); } lifecycle?.resume?.('authorization'); return { status: 'pending', reason: 'auth-timeout' }; }
  }
  /**
   * Resolve divergent saves by whole-profile selection. Selecting local explicitly authorizes replacing
   * the remote snapshot; selecting cloud keeps the existing local storage backup. No currency merging occurs.
   */
  async function resolveCloudConflict(choice) {
    if (disposed || frozen || !state.conflict || !['local', 'cloud'].includes(choice)) return { status: 'unavailable', reason: 'no-resolvable-conflict' };
    if (state.conflict.source === 'backend' && choice !== 'cloud') return { status: 'unavailable', reason: 'server-canonical-required' };
    const source = state.conflict.source;
    if (choice === 'cloud') {
      const selected = state.conflict.cloud || createProfile({ now: clock(), id: profileStore.get().profileId });
      const result = profileStore.replaceFromCloud(selected);
      if (!result.ok) return { status: 'error', reason: result.reason };
    }
    state.conflict = null; state.cloud.status = source === 'backend' ? 'server-durable' : 'loaded'; state.cloud.error = null; emit();
    const result = source === 'backend' ? saveResult('server-durable') : await flush();
    if (!disposed) await prepareCommerce();
    return result;
  }
  /** Enforce an explicitly deployed backend contract, not a client-side enable switch or mock purchase. */
  function configured() {
    return commerceConfig.enabled === true && shortString(commerceConfig.appId) &&
      commerceConfig.products && Object.keys(commerceConfig.products).length > 0 &&
      trustedBackend?.capabilities?.verifiedIdentity === true && trustedBackend.capabilities.durableLedger === true &&
      trustedBackend.capabilities.receiptIntentBinding === true &&
      ['authenticate', 'createPurchaseIntent', 'fulfillPurchase', 'reconcilePurchases'].every(key => typeof trustedBackend[key] === 'function');
  }
  /** Set a fail-closed commerce reason without ever presenting missing configuration as a free purchase. */
  function unavailable(reason) {
    state.commerce.available = false; state.commerce.status = 'unavailable'; state.commerce.reason = reason;
    state.commerce.products = []; emit(); return { status: 'unavailable', reason, products: [] };
  }
  /** Read the immutable server-configured product kind; retired configured IDs remain recoverable. */
  function productKind(id) {
    if (!Object.hasOwn(commerceConfig.products || {}, id)) return null;
    const kind = commerceConfig.products[id]?.kind;
    return ['consumable', 'permanent'].includes(kind) ? kind : null;
  }
  /** Authenticate signed Player proof server-side and fetch real SDK pricing without parsing signed receipts. */
  async function catalog() {
    if (disposed) return { status: 'unavailable', reason: 'disposed', products: [] };
    if (!configured()) return unavailable('not-configured');
    if (!real?.getPayments || frozen || dialogOpen || state.conflict || !state.identity) return unavailable(state.conflict ? 'cloud-conflict' : 'platform-unavailable');
    if (String(real.environment?.app?.id || '') !== commerceConfig.appId) return unavailable('app-id-mismatch');
    if (catalogOperation) return catalogOperation;
    const epoch = generation;
    const operation = Promise.resolve().then(async () => {
      try {
        state.commerce.status = 'loading'; emit();
        if (!backendSession) {
          if (reserve('player')) throw fault('sdk-rate-limit');
          const signedPlayer = await bounded(Promise.resolve().then(() => real.getPlayer({ signed: true })), timeout);
          if (!current(epoch)) return { status: 'unavailable', reason: 'identity-changed', products: [] };
          if (signedPlayer?.getUniqueID?.() !== state.identity.id || typeof signedPlayer?.signature !== 'string') throw fault('signed-identity-unavailable');
          if (!signedPlayer.signature || signedPlayer.signature.length > 65536) throw fault('signed-identity-unavailable');
          const session = await bounded(Promise.resolve().then(() => trustedBackend.authenticate({ signature: signedPlayer.signature, appId: commerceConfig.appId })), timeout);
          if (!current(epoch)) return { status: 'unavailable', reason: 'identity-changed', products: [] };
          if (session?.verified !== true || session.subjectId !== state.identity.id || session.appId !== commerceConfig.appId) throw fault('unverified-backend-identity');
          backendSession = session;
        }
        const gateway = await bounded(Promise.resolve().then(() => real.getPayments({ signed: true })), timeout);
        if (!current(epoch)) return { status: 'unavailable', reason: 'identity-changed', products: [] };
        if (!gateway?.getCatalog || !gateway.purchase || !gateway.getPurchases || !gateway.consumePurchase) throw fault('payments-unavailable');
        const raw = await bounded(Promise.resolve().then(() => gateway.getCatalog()), timeout);
        if (!current(epoch)) return { status: 'unavailable', reason: 'identity-changed', products: [] };
        if (!Array.isArray(raw) || raw.length > 500) throw fault('invalid-catalog');
        const seen = new Set(), products = [];
        for (const item of raw) {
          if (!shortString(item?.id) || seen.has(item.id) || !productKind(item.id)) continue;
          if (![item.title, item.description, item.price, item.priceValue, item.priceCurrencyCode].every(value => typeof value === 'string') || !item.price || !item.priceCurrencyCode) continue;
          seen.add(item.id);
          let currencyImage = null; try { currencyImage = item.getPriceCurrencyImage?.('small') || null; } catch { /* Price text remains SDK-authoritative. */ }
          products.push({ id: item.id, title: item.title, description: item.description, imageURI: item.imageURI || null,
            price: item.price, priceValue: item.priceValue, priceCurrencyCode: item.priceCurrencyCode, currencyImage, kind: productKind(item.id) });
        }
        if (!products.length) throw fault('empty-catalog');
        payments = gateway; catalogGeneration = epoch; catalogAt = clock();
        state.commerce = { ...state.commerce, available: true, status: 'ready', reason: null, products, pending: pendingSubjects.has(state.identity.id) }; emit();
        return { status: 'available', products: copy(products) };
      } catch (error) { return current(epoch) ? unavailable(error?.code || 'catalog-unavailable') : { status: 'unavailable', reason: 'identity-changed', products: [] }; }
      finally { if (catalogOperation === operation) catalogOperation = null; }
    });
    catalogOperation = operation; return operation;
  }
  /** Initialize configured commerce and check unfinished receipts on each established identity. */
  async function prepareCommerce() {
    if (!configured()) return unavailable('not-configured');
    const result = await catalog();
    if (result.status === 'available') await recoverPurchases();
    return result;
  }
  /** Verify a server acknowledgement's identity, schema and monotonic revision before any local replacement. */
  function validatedSettlement(response, epoch) {
    if (!current(epoch) || !backendSession) throw fault('identity-changed');
    if (response?.verified !== true || response.durable !== true || response.subjectId !== state.identity.id || response.appId !== commerceConfig.appId ||
        !Number.isSafeInteger(response.stateRevision) || response.stateRevision < 0) throw fault('unverified-fulfillment');
    const profile = validProfile(response.canonicalState);
    if (!profile) throw fault('invalid-canonical-state');
    if (response.stateRevision < backendRevision) throw fault('stale-server-state');
    if (response.stateRevision === backendRevision && backendFingerprint !== JSON.stringify(profile)) throw fault('inconsistent-server-revision');
    const transactions = response.transactions;
    if (!Array.isArray(transactions) || transactions.length > 500) throw fault('invalid-transactions');
    const seen = new Set(), tokens = new Set();
    for (const entry of transactions) {
      if (!shortString(entry?.transactionId) || seen.has(entry.transactionId) || !productKind(entry.productId) || entry.kind !== productKind(entry.productId) ||
          !['applied', 'already-applied'].includes(entry.status) || !['required', 'not-required', 'already-consumed'].includes(entry.consume)) throw fault('invalid-transaction');
      if (entry.kind === 'permanent' && entry.consume !== 'not-required') throw fault('permanent-consume-forbidden');
      if (entry.consume === 'required' && (!shortString(entry.purchaseToken) || entry.kind !== 'consumable')) throw fault('invalid-consume-token');
      if (entry.consume === 'required' && tokens.has(entry.purchaseToken)) throw fault('duplicate-consume-token');
      if (entry.consume === 'required') tokens.add(entry.purchaseToken);
      seen.add(entry.transactionId);
    }
    return { profile, transactions };
  }
  /** Apply the complete durable server state once, then consume only server-verified consumables. */
  async function applySettlement(response, epoch, before, gateway) {
    const { profile, transactions } = validatedSettlement(response, epoch);
    if (backendRevision < 0 && !equal(profile, before)) {
      conflict('different-server-progress', profile, 'backend');
      return { status: 'pending', reason: 'cloud-conflict' };
    }
    if (response.stateRevision > backendRevision) {
      if (backendFingerprint !== null && JSON.stringify(before) !== backendFingerprint && !equal(profile, validProfile(profileStore.get()))) {
        conflict('server-progress-reconciliation-required', profile, 'backend');
        return { status: 'pending', reason: 'cloud-conflict' };
      }
      // A free progression action during a backend round trip must not be silently lost.
      if (!equal(validProfile(profileStore.get()), before) && !equal(validProfile(profileStore.get()), profile)) {
        conflict('progress-changed-during-purchase', profile, 'backend');
        return { status: 'pending', reason: 'cloud-conflict' };
      }
      const result = profileStore.replaceFromCloud(profile);
      if (!result.ok) return { status: 'pending', reason: result.reason };
      backendRevision = response.stateRevision; backendFingerprint = JSON.stringify(profile);
      pending = null; clearSaveTimer(); state.cloud.status = 'server-durable'; state.cloud.error = null; state.cloud.queuedRevision = null; emit();
    }
    for (const entry of transactions) {
      if (!current(epoch)) return { status: 'pending', reason: 'identity-changed' };
      if (entry.consume !== 'required') continue;
      if (inFlightConsumes.has(entry.purchaseToken)) return { status: 'pending', reason: 'consume-unconfirmed' };
      const physicalConsume = Promise.resolve().then(() => { assertCurrent(epoch); return gateway.consumePurchase(entry.purchaseToken); })
        .finally(() => inFlightConsumes.delete(entry.purchaseToken));
      inFlightConsumes.set(entry.purchaseToken, physicalConsume);
      try { await bounded(physicalConsume, timeout); }
      catch { return { status: 'pending', reason: 'consume-unconfirmed' }; }
      if (!current(epoch)) return { status: 'pending', reason: 'identity-changed' };
    }
    return { status: 'fulfilled', transactionIds: transactions.map(entry => entry.transactionId) };
  }
  /** Record an uncertain paid operation against its original owner, without retaining receipt credentials in UI state. */
  function markPending(subject, reason) {
    if (subject) pendingSubjects.add(subject);
    if (state.identity?.id === subject) { state.commerce.pending = true; state.commerce.reason = reason; emit(); }
    return { status: 'pending', reason };
  }
  /** Execute one purchase/recovery operation and release only its own lifecycle pause. */
  async function commerceRun(run) {
    if (commerceOperation || authOperation || dialogOpen || lifecycle?.has?.('ad')) return { status: 'unavailable', reason: 'busy' };
    const marker = {}; commerceOperation = marker; state.commerce.busy = true; lifecycle?.pause?.('payment'); emit();
    try { return await run(); }
    finally { if (commerceOperation === marker) commerceOperation = null; state.commerce.busy = Boolean(sdkPurchaseInFlight); lifecycle?.resume?.('payment'); emit(); }
  }
  /**
   * Purchase only a fresh catalog ID after the backend durably creates a bound intent. SDK errors
   * after requesting payment are pending, never fabricated success or an assumed cancellation.
   */
  async function purchase(productId) {
    if (disposed || !configured() || !state.commerce.available || !payments || !backendSession || frozen || state.conflict) return { status: 'unavailable', reason: state.commerce.reason || 'not-ready' };
    if (catalogGeneration !== generation || clock() < catalogAt || clock() - catalogAt > Math.min(300000, Math.max(1000, commerceConfig.catalogMaxAgeMs || 300000))) return { status: 'unavailable', reason: 'catalog-stale' };
    if (!state.commerce.products.some(product => product.id === productId)) return { status: 'unavailable', reason: 'unknown-product' };
    if (sdkPurchaseInFlight) return { status: 'pending', reason: 'payment-result-pending' };
    if (pendingSubjects.has(state.identity.id)) return { status: 'pending', reason: 'recovery-required' };
    return commerceRun(async () => {
      const epoch = generation, subject = state.identity.id, session = backendSession, gateway = payments;
      let requested = false;
      try {
        const saved = await flush();
        if (!current(epoch)) return { status: 'unavailable', reason: 'identity-changed' };
        if (!['durable', 'server-durable'].includes(saved.status)) return { status: 'unavailable', reason: 'cloud-save-required' };
        const before = validProfile(profileStore.get());
        if (backendFingerprint === null || backendFingerprint !== JSON.stringify(before)) return { status: 'unavailable', reason: 'server-progress-reconciliation-required' };
        const intent = await bounded(Promise.resolve().then(() => { assertCurrent(epoch); return trustedBackend.createPurchaseIntent({ session, productId, appId: commerceConfig.appId }); }), timeout);
        if (!current(epoch)) return { status: 'unavailable', reason: 'identity-changed' };
        if (intent?.verified !== true || intent.durable !== true || intent.subjectId !== subject || intent.productId !== productId || !shortString(intent.intentId) ||
            typeof intent.developerPayload !== 'string' || !intent.developerPayload || intent.developerPayload.length > 2048) throw fault('invalid-purchase-intent');
        requested = true;
        const marker = { subject }; sdkPurchaseInFlight = marker;
        const physicalPurchase = Promise.resolve().then(() => {
          assertCurrent(epoch); return gateway.purchase({ id: productId, developerPayload: intent.developerPayload });
        }).finally(() => {
          if (sdkPurchaseInFlight === marker) sdkPurchaseInFlight = null;
          state.commerce.busy = Boolean(commerceOperation || sdkPurchaseInFlight); emit();
        });
        const receipt = await bounded(physicalPurchase, timeout);
        if (!current(epoch)) return markPending(subject, 'identity-changed');
        if (typeof receipt?.signature !== 'string' || !receipt.signature || receipt.signature.length > 1000000) return markPending(subject, 'unsigned-receipt');
        const response = await bounded(Promise.resolve().then(() => { assertCurrent(epoch); return trustedBackend.fulfillPurchase({ session, intentId: intent.intentId, signature: receipt.signature }); }), timeout);
        if (!current(epoch)) return markPending(subject, 'identity-changed');
        if (response?.status === 'pending') return markPending(subject, 'fulfillment-pending');
        // The backend must identify the requested intent/product, not attach an unrelated valid purchase.
        if (response.intentId !== intent.intentId || !response.transactions?.some(entry => entry.productId === productId)) return markPending(subject, 'intent-mismatch');
        const result = await applySettlement(response, epoch, before, gateway);
        if (result.status === 'pending') return markPending(subject, result.reason);
        if (!current(epoch)) return markPending(subject, 'identity-changed');
        state.commerce.pending = false; emit(); return result;
      } catch (error) { return requested ? markPending(subject, error?.code || 'purchase-unconfirmed') : { status: 'unavailable', reason: error?.code || 'intent-unavailable' }; }
    });
  }
  /**
   * Submit the signed recovery batch unchanged to the backend. Unknown receipts must be rejected or
   * deferred there; they are never assigned to a client-supplied account or locally awarded twice.
   */
  async function recoverPurchases() {
    if (sdkPurchaseInFlight) return { status: 'pending', reason: 'payment-result-pending' };
    if (disposed || !configured() || !state.commerce.available || !payments || !backendSession || frozen || state.conflict) return { status: 'unavailable', reason: state.commerce.reason || 'not-ready' };
    return commerceRun(async () => {
      const epoch = generation, subject = state.identity.id, session = backendSession, gateway = payments, before = validProfile(profileStore.get());
      try {
        const saved = await flush();
        if (!current(epoch)) return markPending(subject, 'identity-changed');
        if (!['durable', 'server-durable'].includes(saved.status)) return markPending(subject, 'cloud-save-required');
        const receipt = await bounded(Promise.resolve().then(() => gateway.getPurchases()), timeout);
        if (!current(epoch)) return markPending(subject, 'identity-changed');
        if (typeof receipt?.signature !== 'string' || !receipt.signature || receipt.signature.length > 1000000) return markPending(subject, 'unsigned-recovery');
        const response = await bounded(Promise.resolve().then(() => { assertCurrent(epoch); return trustedBackend.reconcilePurchases({ session, signature: receipt.signature }); }), timeout);
        if (!current(epoch)) return markPending(subject, 'identity-changed');
        if (response?.status === 'pending') return markPending(subject, 'reconciliation-pending');
        const result = await applySettlement(response, epoch, before, gateway);
        if (result.status === 'pending') return markPending(subject, result.reason);
        if (!current(epoch)) return markPending(subject, 'identity-changed');
        pendingSubjects.delete(subject); state.commerce.pending = false; state.commerce.reason = null; emit(); return result;
      } catch (error) { return markPending(subject, error?.code || 'reconciliation-unconfirmed'); }
    });
  }
  /** Retry a failed cloud read without trusting or writing over unknown remote state. */
  async function retryCloud() {
    if (disposed || !real || dialogOpen || authOperation || commerceOperation) return { status: 'unavailable', reason: 'busy-or-unavailable' };
    await refreshIdentity('retry');
    if (!disposed && !frozen && !state.conflict) await prepareCommerce();
    return getState();
  }
  /** Invalidate pending results, cancel our timers and detach event handlers without deleting progress. */
  function dispose() {
    if (disposed) return;
    disposed = true; generation++; clearSaveTimer(); pending = null; player = null; backendSession = null; payments = null;
    for (const { event, handler, unsubscribe } of subscriptions) {
      try { if (typeof unsubscribe === 'function') unsubscribe(); else real?.off?.(event, handler); } catch { /* Teardown cannot prevent local free play. */ }
    }
    subscriptions.length = 0;
    lifecycle?.resume?.('account-selection'); lifecycle?.resume?.('authorization'); lifecycle?.resume?.('payment');
  }
  return { init, getState, authorize, queueSave, flush, resolveCloudConflict, catalog, purchase, recoverPurchases, retryCloud, dispose };
}
