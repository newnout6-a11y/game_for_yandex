import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformServices, CLOUD_PROFILE_KEY } from '../src/platform-services.js';
import { createProfile } from '../src/progression.js';
import { createProgressionStorage, PROGRESSION_STORAGE_KEY } from '../src/progression-storage.js';
import { createLifecycle } from '../src/lifecycle.js';

/** Create a manually controlled async boundary for timeout, account-change and ordering tests. */
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
/** Let promise callbacks and SDK event handlers advance without introducing long real waits. */
const tick = () => new Promise(resolve => setImmediate(resolve));
/** Create isolated browser storage with inspectable values, never real user data. */
function memory(profile) {
  const values = new Map(profile ? [[PROGRESSION_STORAGE_KEY, JSON.stringify(profile)]] : []);
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
}
/** Make a complete valid profile with a deliberate persisted revision/wallet difference. */
function profile({ id = 'fixture', credits = 300, revision = 0 } = {}) {
  const result = createProfile({ now: 1000, id }); result.revision = revision; result.wallet.credits = credits; return result;
}
/** Wrap a profile as the exact namespaced SDK payload used by this adapter. */
const envelope = value => value ? { [CLOUD_PROFILE_KEY]: { formatVersion: 1, accountId: 'guest', profile: structuredClone(value) } } : {};
/** Create an isolated SDK, lifecycle and actual local-profile store around inspectable async doubles. */
function harness(options = {}) {
  let selectedId = 'guest', authorized = false, stamp = 1000;
  const provider = options.provider ?? memory(options.local);
  const store = createProgressionStorage({ provider, now: () => stamp, idFactory: () => 'fixture' });
  const remote = new Map([['guest', envelope(options.cloud)]]), writes = [], reads = [], playerCalls = [], events = new Map(), stateChanges = [];
  let writeImplementation = options.write, readImplementation = options.read;
  /** Construct an immutable-owner Player so tests expose any queue mistakenly replayed across accounts. */
  function getPlayer({ signed = false } = {}) {
    const owner = selectedId, isAuthorized = authorized;
    playerCalls.push({ signed, owner });
    return {
      signature: signed ? `identity:${owner}` : undefined,
      getUniqueID: () => owner, isAuthorized: () => isAuthorized,
      getData: keys => { reads.push({ owner, keys }); return readImplementation ? readImplementation(owner, keys) : Promise.resolve(structuredClone(remote.get(owner) || {})); },
      setData: (value, durable) => {
        writes.push({ owner, durable, value: structuredClone(value) });
        if (writeImplementation) return writeImplementation(owner, value, durable);
        remote.set(owner, structuredClone(value)); return Promise.resolve();
      },
    };
  }
  const real = {
    environment: { app: { id: 'test-app' }, i18n: { lang: 'en' } }, getPlayer,
    on: (event, callback) => { events.set(event, callback); }, off: (event, callback) => { if (events.get(event) === callback) events.delete(event); },
    auth: { openAuthDialog: async () => { selectedId = 'account'; authorized = true; } },
  };
  const lifecycle = createLifecycle();
  const services = createPlatformServices({ sdk: { init: async () => options.noSdk ? null : real, get: () => options.noSdk ? null : real }, lifecycle, profileStore: store,
    now: () => stamp, timeoutMs: options.timeoutMs ?? 200, minSaveIntervalMs: options.minSaveIntervalMs ?? 0,
    commerceConfig: options.commerceConfig, trustedBackend: options.trustedBackend, onState: next => stateChanges.push(next) });
  return { services, real, store, provider, lifecycle, remote, writes, reads, playerCalls, events, stateChanges,
    setIdentity: (id, auth = true) => { selectedId = id; authorized = auth; },
    setWrite: fn => { writeImplementation = fn; }, setRead: fn => { readImplementation = fn; },
    advance: value => { stamp += value; },
    emit: event => events.get(event)?.(),
    update: settings => store.dispatch({ type: 'UPDATE_SETTINGS', settings }),
  };
}

/** Configure an explicitly injected fake durable server for contract tests, never for shipped gameplay. */
function commerceHarness(options = {}) {
  const config = { enabled: true, appId: 'test-app', products: { credits: { kind: 'consumable' }, noads: { kind: 'permanent' } } };
  let h, canonical = profile(), revision = 1, sequence = 0, grants = 0;
  const ledger = new Map(), intents = new Map(), consumed = new Set(), calls = [], purchases = [], consumeCalls = [];
  /** Return the server-owned durable state and unconsumed/permanent receipt ledger. */
  function response(extra = {}) {
    return { verified: true, durable: true, subjectId: 'guest', appId: 'test-app', stateRevision: revision, canonicalState: structuredClone(canonical),
      transactions: [...ledger.values()].filter(entry => !consumed.has(entry.purchaseToken)).map(entry => ({ ...entry, status: 'already-applied' })), ...extra };
  }
  const backend = {
    capabilities: { verifiedIdentity: true, durableLedger: true, receiptIntentBinding: true },
    authenticate: async request => { calls.push(['authenticate', request]); return { verified: true, subjectId: 'guest', appId: 'test-app', sessionId: 'private-test-session' }; },
    createPurchaseIntent: async request => {
      calls.push(['intent', request]); const intentId = `intent-${++sequence}`;
      const intent = { verified: true, durable: true, subjectId: 'guest', productId: request.productId, intentId, developerPayload: `opaque:${intentId}` };
      intents.set(intentId, intent); return intent;
    },
    fulfillPurchase: async request => {
      calls.push(['fulfill', request]); const intent = intents.get(request.intentId), token = `token:${request.signature}`;
      if (!ledger.has(token)) {
        grants++; canonical.wallet.credits += intent.productId === 'credits' ? 100 : 0; canonical.revision++; revision++;
        ledger.set(token, { transactionId: `transaction:${token}`, productId: intent.productId, kind: config.products[intent.productId].kind,
          status: 'applied', consume: intent.productId === 'credits' ? 'required' : 'not-required', purchaseToken: token });
      }
      return response({ intentId: intent.intentId });
    },
    reconcilePurchases: async request => { calls.push(['reconcile', request]); return response(); },
  };
  h = harness({ ...options, commerceConfig: config, trustedBackend: backend });
  const gateway = {
    getCatalog: async () => [
      { id: 'credits', title: 'Credits', description: '100 credits', price: '49 TEST', priceValue: '49', priceCurrencyCode: 'TEST', getPriceCurrencyImage: () => 'https://example.test/currency.svg' },
      { id: 'noads', title: 'No ads', description: 'Permanent', price: '99 TEST', priceValue: '99', priceCurrencyCode: 'TEST', getPriceCurrencyImage: () => 'https://example.test/currency.svg' },
    ],
    purchase: async request => { purchases.push(request); return { signature: `receipt-${purchases.length}` }; },
    getPurchases: async () => ({ signature: 'signed-recovery-batch' }),
    consumePurchase: async token => { consumeCalls.push(token); consumed.add(token); },
  };
  h.real.getPayments = async options => { calls.push(['payments', options]); return gateway; };
  return { ...h, config, backend, gateway, calls, purchases, consumeCalls, ledger, consumed, response,
    grants: () => grants, setCanonical: value => { canonical = structuredClone(value); revision++; } };
}

test('local preview keeps free progression and never mocks auth, cloud or payment success', async () => {
  const h = harness({ noSdk: true });
  const first = h.services.init(); assert.equal(h.services.init(), first); await first;
  assert.equal(h.services.getState().mode, 'local-preview');
  h.update({ sound: true }); assert.equal(h.services.queueSave().status, 'local');
  assert.equal((await h.services.authorize({ userInitiated: true })).status, 'unavailable');
  assert.equal((await h.services.catalog()).reason, 'not-configured');
  assert.equal((await h.services.purchase('credits')).status, 'unavailable');
  assert.equal(h.store.get().settings.sound, true); h.services.dispose();
});

test('guest Player uses cloud without login and reads SDK language', async () => {
  const h = harness(); let dialogs = 0; h.real.auth.openAuthDialog = async () => { dialogs++; };
  await h.services.init(); await h.services.flush();
  const state = h.services.getState();
  assert.equal(state.lang, 'en'); assert.deepEqual(state.identity, { id: 'guest', authorized: false });
  assert.equal(state.cloud.status, 'durable'); assert.equal(dialogs, 0);
  assert.equal(h.writes.length, 1); assert.equal(h.writes[0].durable, true);
  assert.equal(h.writes[0].value[CLOUD_PROFILE_KEY].accountId, 'guest'); h.services.dispose();
});

test('unequal existing profiles require explicit whole-profile choice, never max currency', async () => {
  const h = harness({ local: profile({ credits: 800, revision: 2 }), cloud: profile({ id: 'other', credits: 50, revision: 9 }) });
  await h.services.init(); const conflict = h.services.getState().conflict;
  assert.equal(conflict.local.wallet.credits, 800); assert.equal(conflict.cloud.wallet.credits, 50);
  h.services.queueSave(); await h.services.flush(); assert.equal(h.writes.length, 0);
  assert.equal(h.store.get().wallet.credits, 800);
  await h.services.resolveCloudConflict('cloud');
  assert.equal(h.store.get().wallet.credits, 50); assert.equal(h.writes.at(-1).value[CLOUD_PROFILE_KEY].profile.wallet.credits, 50);
  h.services.dispose();
});

test('local choice replaces complete cloud state and missing cloud needs consent for prior local progress', async () => {
  for (const cloud of [profile({ credits: 500, revision: 9 }), null]) {
    const h = harness({ local: profile({ credits: 10, revision: 2 }), cloud }); await h.services.init();
    assert.ok(h.services.getState().conflict); assert.equal(h.writes.length, 0);
    await h.services.resolveCloudConflict('local'); assert.equal(h.writes.at(-1).value[CLOUD_PROFILE_KEY].profile.wallet.credits, 10); h.services.dispose();
  }
});

test('untouched starter restores a cloud profile without discarding any earned local progress', async () => {
  const h = harness({ cloud: profile({ id: 'remote', credits: 1250, revision: 12 }) }); await h.services.init();
  assert.equal(h.services.getState().conflict, null); assert.equal(h.store.get().wallet.credits, 1250);
  assert.equal(h.services.getState().cloud.status, 'loaded'); assert.equal(h.writes.length, 0); h.services.dispose();
});

test('coalesced writes serialize changes and reject stale caller snapshots', async () => {
  const h = harness(); await h.services.init(); await h.services.flush();
  const hold = deferred(); h.setWrite(() => hold.promise);
  h.update({ sound: true }); const old = h.store.get(); h.services.queueSave(); await tick();
  h.update({ sound: false }); h.services.queueSave(); h.update({ cameraMode: 'cockpit' }); h.services.queueSave();
  assert.equal(h.services.queueSave(old).reason, 'invalid-or-stale-profile');
  assert.equal(h.writes.length, 2);
  h.setWrite(null); hold.resolve(); await tick(); await h.services.flush();
  assert.equal(h.writes.length, 3); assert.equal(h.writes[2].value[CLOUD_PROFILE_KEY].profile.revision, 3); h.services.dispose();
});

test('setData(false) is queued, never durable until a true flush completes', async () => {
  const h = harness(); await h.services.init(); await h.services.flush();
  h.update({ sound: true }); h.services.queueSave(undefined, { durable: false }); await tick();
  assert.equal(h.writes.at(-1).durable, false); assert.equal(h.services.getState().cloud.status, 'queued');
  assert.equal(h.services.getState().cloud.durableRevision, 0);
  await h.services.flush(); assert.equal(h.writes.at(-1).durable, true); assert.equal(h.services.getState().cloud.durableRevision, 1); h.services.dispose();
});

test('a write timeout is uncertain and does not permit a newer write to race its late settlement', async () => {
  const h = harness({ timeoutMs: 10 }); await h.services.init(); await h.services.flush();
  const hold = deferred(); h.setWrite(() => hold.promise); h.update({ sound: true });
  assert.equal((await h.services.flush()).status, 'uncertain');
  h.update({ sound: false }); h.services.queueSave(); await h.services.flush(); assert.equal(h.writes.length, 2);
  h.setWrite(null); hold.resolve(); await tick(); await h.services.flush();
  assert.equal(h.writes.length, 3); assert.equal(h.services.getState().cloud.durableRevision, 2); h.services.dispose();
});

test('account selection freezes and invalidates old queued/in-flight writes', async () => {
  const h = harness(); await h.services.init(); await h.services.flush();
  const hold = deferred(); h.setWrite(() => hold.promise); h.update({ sound: true }); h.services.queueSave(); await tick();
  h.emit('ACCOUNT_SELECTION_DIALOG_OPENED'); assert.equal(h.lifecycle.has('account-selection'), true);
  h.update({ cameraMode: 'cockpit' }); h.services.queueSave();
  h.setIdentity('other'); h.remote.set('other', envelope(profile({ id: 'other', credits: 17, revision: 8 })));
  h.setWrite(null); h.emit('ACCOUNT_SELECTION_DIALOG_CLOSED'); await tick();
  assert.equal(h.services.getState().identity.id, 'other'); assert.ok(h.services.getState().conflict);
  hold.resolve(); await tick();
  assert.ok(h.services.getState().conflict); assert.equal(h.writes.some(write => write.owner === 'other'), false);
  await h.services.resolveCloudConflict('cloud'); assert.equal(h.store.get().wallet.credits, 17);
  assert.equal(h.writes.at(-1).owner, 'other'); assert.equal(h.lifecycle.has('account-selection'), false); h.services.dispose();
});

test('a late old getData result cannot overwrite the newly selected account', async () => {
  const hold = deferred(); const h = harness({ read: owner => owner === 'guest' ? hold.promise : Promise.resolve(envelope(profile({ credits: 700, revision: 3 }))) });
  const init = h.services.init(); await tick(); h.emit('ACCOUNT_SELECTION_DIALOG_OPENED'); h.setIdentity('other'); h.emit('ACCOUNT_SELECTION_DIALOG_CLOSED');
  await tick(); hold.resolve(envelope(profile({ credits: 999, revision: 4 }))); await init; await tick();
  assert.equal(h.services.getState().identity.id, 'other'); assert.equal(h.services.getState().conflict.cloud.wallet.credits, 700);
  assert.equal(h.store.get().wallet.credits, 300); h.services.dispose();
});

test('explicit authorization reacquires Player, and declining login never blocks free play', async () => {
  const h = harness(); await h.services.init(); await h.services.flush(); let opened = 0;
  h.real.auth.openAuthDialog = async () => { opened++; throw Error('closed'); };
  assert.equal((await h.services.authorize()).reason, 'explicit-user-action-required'); assert.equal(opened, 0);
  assert.equal((await h.services.authorize({ userInitiated: true })).status, 'cancelled');
  assert.equal(opened, 1); assert.equal(h.services.getState().identity.authorized, false);
  assert.equal(h.lifecycle.paused, false); assert.equal(h.services.getState().conflict, null); h.services.dispose();
});

test('authorization timeout remains pending, releases its pause, and rejects a stacked dialog', async () => {
  const h = harness({ timeoutMs: 10 }); await h.services.init(); await h.services.flush();
  const hold = deferred(); h.real.auth.openAuthDialog = () => hold.promise;
  assert.equal((await h.services.authorize({ userInitiated: true })).status, 'pending');
  assert.equal(h.lifecycle.has('authorization'), false); assert.equal((await h.services.authorize({ userInitiated: true })).reason, 'busy');
  assert.equal(h.services.queueSave().reason, 'identity-not-ready'); hold.resolve(); await tick();
  assert.equal(h.services.getState().identity.id, 'guest'); h.services.dispose();
});

test('failed or malformed cloud read never becomes permission to overwrite remote data', async () => {
  for (const read of [() => new Promise(() => {}), () => Promise.reject(Error('offline')), () => Promise.resolve({ [CLOUD_PROFILE_KEY]: { formatVersion: 99 } }),
    () => Promise.resolve(envelope({ ...profile(), wallet: { credits: Infinity } }))]) {
    const h = harness({ read, timeoutMs: 5 }); await h.services.init(); h.services.queueSave(); await h.services.flush();
    assert.equal(h.services.getState().cloud.status, 'error'); assert.equal(h.writes.length, 0); h.services.dispose();
  }
});

test('explicit cloud retry rereads before writing after a network failure', async () => {
  const h = harness({ read: () => Promise.reject(Error('offline')) }); await h.services.init();
  h.setRead(null); await h.services.retryCloud(); assert.ok(h.services.getState().conflict);
  await h.services.resolveCloudConflict('local'); assert.equal(h.services.getState().cloud.status, 'durable'); h.services.dispose();
});

test('unavailable local storage is reported honestly while guest cloud saving still works', async () => {
  const h = harness({ provider: () => { throw Object.assign(Error('denied'), { name: 'SecurityError' }); } });
  await h.services.init(); const result = await h.services.flush();
  assert.equal(result.localSaved, false); assert.equal(result.status, 'durable');
  assert.equal(h.services.getState().local.localSaved, false); h.services.dispose();
});

test('cloud writes enforce UTF-8 payload bounds and a conservative rolling SDK rate budget', async () => {
  const h = harness(); await h.services.init(); await h.services.flush();
  const oversized = h.store.get(); oversized.extra = 'я'.repeat(100000);
  assert.equal(h.services.queueSave(oversized).status, 'error');
  for (let index = 0; index < 105; index++) { h.update({ sound: index % 2 === 0 }); h.services.queueSave(); await h.services.flush(); }
  assert.ok(h.writes.length + h.reads.length <= 90); assert.equal(h.services.getState().cloud.status, 'rate-limited');
  h.advance(300001); await h.services.flush(); assert.equal(h.services.getState().cloud.status, 'durable'); h.services.dispose();
});

test('disposing removes subscriptions, cancels future saves and rejects late async state changes', async () => {
  const h = harness(); await h.services.init(); await h.services.flush();
  const hold = deferred(); h.setWrite(() => hold.promise); h.update({ sound: true }); h.services.queueSave(); await tick();
  const updates = h.stateChanges.length; h.lifecycle.pause('user'); h.services.dispose(); hold.resolve(); await tick();
  assert.equal(h.events.size, 0); assert.equal(h.stateChanges.length, updates); assert.equal(h.lifecycle.has('user'), true);
  assert.equal(h.services.queueSave().reason, 'disposed'); assert.equal((await h.services.purchase('credits')).status, 'unavailable');
});

test('commerce stays disabled without a real SDK app, explicit products and trusted backend contract', async () => {
  const h = harness({ commerceConfig: { enabled: true, appId: 'test-app', products: { credits: { kind: 'consumable' } } }, trustedBackend: {} });
  let payments = 0; h.real.getPayments = async () => { payments++; return {}; }; await h.services.init();
  assert.equal((await h.services.catalog()).status, 'unavailable'); assert.equal(payments, 0); assert.equal((await h.services.purchase('credits')).status, 'unavailable'); h.services.dispose();
  const configured = commerceHarness(); configured.real.environment.app.id = 'wrong-app'; await configured.services.init();
  assert.equal(configured.services.getState().commerce.reason, 'app-id-mismatch'); assert.equal(configured.purchases.length, 0); configured.services.dispose();
});

test('real catalog preserves SDK currency and authenticates signed player, never exposing credentials in state', async () => {
  const h = commerceHarness(); await h.services.init();
  const state = h.services.getState(); assert.equal(state.commerce.available, true);
  assert.equal(state.commerce.products[0].price, '49 TEST'); assert.equal(state.commerce.products[0].priceCurrencyCode, 'TEST');
  assert.ok(h.calls.some(([key, value]) => key === 'payments' && value.signed === true));
  assert.deepEqual(h.calls.find(([key]) => key === 'authenticate')[1], { signature: 'identity:guest', appId: 'test-app' });
  assert.equal(JSON.stringify(state).includes('private-test-session'), false); assert.equal(JSON.stringify(state).includes('identity:guest'), false);
  assert.ok(h.calls.some(([key]) => key === 'reconcile')); h.services.dispose();
});

test('consumable payment verifies intent and signed receipt, applies durable canonical state before consume', async () => {
  const h = commerceHarness(); await h.services.init();
  h.gateway.consumePurchase = async token => { assert.equal(h.store.get().wallet.credits, 400); h.consumeCalls.push(token); h.consumed.add(token); };
  const result = await h.services.purchase('credits');
  assert.equal(result.status, 'fulfilled'); assert.equal(h.grants(), 1); assert.equal(h.store.get().wallet.credits, 400);
  assert.equal(h.consumeCalls.length, 1); assert.deepEqual(Object.keys(h.calls.find(([key]) => key === 'fulfill')[1]).sort(), ['intentId', 'session', 'signature']);
  assert.deepEqual(h.purchases[0], { id: 'credits', developerPayload: 'opaque:intent-1' });
  assert.equal(h.lifecycle.has('payment'), false); h.services.dispose();
});

test('consume failure stays pending; repeated recovery never increments an already granted wallet', async () => {
  const h = commerceHarness(); await h.services.init(); h.gateway.consumePurchase = async () => { throw Error('offline'); };
  assert.equal((await h.services.purchase('credits')).status, 'pending'); assert.equal(h.store.get().wallet.credits, 400);
  assert.equal((await h.services.purchase('credits')).reason, 'recovery-required');
  h.gateway.consumePurchase = async token => { h.consumeCalls.push(token); h.consumed.add(token); };
  assert.equal((await h.services.recoverPurchases()).status, 'fulfilled');
  assert.equal((await h.services.recoverPurchases()).status, 'fulfilled');
  assert.equal(h.grants(), 1); assert.equal(h.store.get().wallet.credits, 400); assert.equal(h.consumeCalls.length, 1); h.services.dispose();
});

test('permanent entitlement recovery never consumes its purchase', async () => {
  const h = commerceHarness(); await h.services.init();
  assert.equal((await h.services.purchase('noads')).status, 'fulfilled');
  assert.equal((await h.services.recoverPurchases()).status, 'fulfilled');
  assert.equal(h.consumeCalls.length, 0); assert.equal(h.grants(), 1); h.services.dispose();
});

test('unsigned, unverified or non-durable receipts never grant or consume on the client', async () => {
  for (const mode of ['unsigned', 'not-durable', 'wrong-owner', 'permanent-consume']) {
    const h = commerceHarness(); await h.services.init();
    if (mode === 'unsigned') h.gateway.purchase = async () => ({ productID: 'credits', purchaseToken: 'unverified' });
    else {
      const original = h.backend.fulfillPurchase;
      h.backend.fulfillPurchase = async request => {
        const result = await original(request);
        if (mode === 'not-durable') result.durable = false;
        if (mode === 'wrong-owner') result.subjectId = 'attacker';
        if (mode === 'permanent-consume') result.transactions[0].consume = 'required';
        return result;
      };
    }
    const result = await h.services.purchase(mode === 'permanent-consume' ? 'noads' : 'credits');
    assert.equal(result.status, 'pending'); assert.equal(h.store.get().wallet.credits, 300); assert.equal(h.consumeCalls.length, 0); h.services.dispose();
  }
});

test('double click, ad pause and stale catalog prevent duplicate or overlapping payment dialogs', async () => {
  const h = commerceHarness(); await h.services.init(); const hold = deferred(); h.gateway.purchase = () => hold.promise;
  h.lifecycle.pause('ad'); assert.equal((await h.services.purchase('credits')).reason, 'busy'); h.lifecycle.resume('ad');
  const first = h.services.purchase('credits'); await tick(); assert.equal((await h.services.purchase('credits')).reason, 'payment-result-pending');
  hold.resolve({ signature: 'one-receipt' }); assert.equal((await first).status, 'fulfilled'); assert.equal(h.grants(), 1);
  h.advance(300001); assert.equal((await h.services.purchase('credits')).reason, 'catalog-stale'); h.services.dispose();
});

test('timed-out payment remains recoverable and a late receipt cannot trigger an unverified grant', async () => {
  const h = commerceHarness({ timeoutMs: 10 }); await h.services.init(); const hold = deferred(); h.gateway.purchase = () => hold.promise;
  assert.equal((await h.services.purchase('credits')).status, 'pending'); assert.equal(h.lifecycle.has('payment'), false);
  hold.resolve({ signature: 'late-receipt' }); await tick(); assert.equal(h.grants(), 0); assert.equal(h.store.get().wallet.credits, 300);
  assert.equal(h.services.getState().commerce.pending, true); h.services.dispose();
});

test('identity change during a paid result cannot grant or consume for the new account', async () => {
  const h = commerceHarness(); await h.services.init(); const hold = deferred(); h.gateway.purchase = () => hold.promise;
  const purchase = h.services.purchase('credits'); await tick();
  h.emit('ACCOUNT_SELECTION_DIALOG_OPENED'); h.setIdentity('other'); h.remote.set('other', envelope(profile({ credits: 20, revision: 4 })));
  h.emit('ACCOUNT_SELECTION_DIALOG_CLOSED'); await tick(); hold.resolve({ signature: 'previous-owner-receipt' });
  assert.equal((await purchase).status, 'pending'); assert.equal(h.grants(), 0); assert.equal(h.consumeCalls.length, 0);
  assert.equal(h.services.getState().identity.id, 'other'); assert.ok(h.services.getState().conflict); h.services.dispose();
});

test('progress changed during fulfillment is retained as an explicit conflict rather than silently lost', async () => {
  const h = commerceHarness(); await h.services.init(); const hold = deferred(), original = h.backend.fulfillPurchase;
  h.backend.fulfillPurchase = async request => { await hold.promise; return original(request); };
  const purchase = h.services.purchase('credits'); await tick(); h.update({ sound: true }); hold.resolve();
  assert.equal((await purchase).reason, 'cloud-conflict'); assert.equal(h.store.get().settings.sound, true);
  assert.equal(h.services.getState().conflict.cloud.wallet.credits, 400); assert.equal(h.consumeCalls.length, 0);
  assert.equal((await h.services.resolveCloudConflict('local')).reason, 'server-canonical-required'); h.services.dispose();
});

test('same-account selection cannot race an older timed-out write against the chosen replacement', async () => {
  const h = harness(); await h.services.init(); await h.services.flush();
  const hold = deferred(); let oldPayload;
  h.setWrite((owner, value) => { oldPayload = { owner, value }; return hold.promise.then(() => h.remote.set(owner, value)); });
  h.update({ sound: true }); h.services.queueSave(); await tick();
  h.emit('ACCOUNT_SELECTION_DIALOG_OPENED'); h.update({ cameraMode: 'cockpit' });
  h.setWrite(null); h.emit('ACCOUNT_SELECTION_DIALOG_CLOSED'); await tick();
  assert.equal(h.services.getState().identity.id, 'guest'); assert.ok(h.services.getState().conflict);
  const resolution = await h.services.resolveCloudConflict('local');
  assert.equal(resolution.status, 'uncertain'); assert.equal(h.writes.length, 2);
  hold.resolve(); await tick(); await h.services.flush();
  assert.equal(h.writes.length, 3); assert.equal(h.remote.get('guest')[CLOUD_PROFILE_KEY].profile.settings.cameraMode, 'cockpit');
  assert.equal(oldPayload.value[CLOUD_PROFILE_KEY].profile.settings.cameraMode, 'chase'); h.services.dispose();
});

test('first divergent server recovery is an explicit conflict, not a silent wallet replacement', async () => {
  const h = commerceHarness(); h.setCanonical(profile({ credits: 50, revision: 7 })); await h.services.init();
  assert.equal(h.store.get().wallet.credits, 300); assert.equal(h.services.getState().conflict.source, 'backend');
  assert.equal(h.services.getState().conflict.cloud.wallet.credits, 50); assert.equal(h.consumeCalls.length, 0); h.services.dispose();
});

test('same server revision with different canonical money is rejected before consume', async () => {
  const h = commerceHarness(); await h.services.init();
  const original = h.backend.reconcilePurchases;
  h.backend.reconcilePurchases = async request => { const result = await original(request); result.canonicalState.wallet.credits = 999; return result; };
  assert.equal((await h.services.recoverPurchases()).reason, 'inconsistent-server-revision');
  assert.equal(h.store.get().wallet.credits, 300); assert.equal(h.consumeCalls.length, 0); h.services.dispose();
});

test('timed-out physical payment remains locked even if recovery would report an empty receipt list', async () => {
  const h = commerceHarness({ timeoutMs: 10 }); await h.services.init();
  const hold = deferred(); let calls = 0; h.gateway.purchase = () => { calls++; return hold.promise; };
  assert.equal((await h.services.purchase('credits')).status, 'pending');
  assert.equal((await h.services.recoverPurchases()).reason, 'payment-result-pending');
  assert.equal((await h.services.purchase('credits')).reason, 'payment-result-pending');
  assert.equal(h.services.getState().commerce.busy, true); assert.equal(calls, 1);
  hold.resolve({ signature: 'late-physical-result' }); await tick();
  assert.equal(h.services.getState().commerce.busy, false); assert.equal(h.services.getState().commerce.pending, true); h.services.dispose();
});

test('existing free progress must be server-reconciled before taking a payment, never overwritten afterward', async () => {
  const h = commerceHarness(); await h.services.init(); h.update({ sound: true }); await h.services.flush();
  assert.equal((await h.services.purchase('credits')).reason, 'server-progress-reconciliation-required');
  assert.equal(h.purchases.length, 0); assert.equal(h.store.get().settings.sound, true);
  h.setCanonical(profile({ credits: 400, revision: 4 }));
  assert.equal((await h.services.recoverPurchases()).reason, 'cloud-conflict');
  assert.equal(h.store.get().settings.sound, true); assert.equal(h.services.getState().conflict.local.settings.sound, true); h.services.dispose();
});

test('account change during consume cannot report success or clear the newly selected account state', async () => {
  const h = commerceHarness(); await h.services.init(); const hold = deferred(); h.gateway.consumePurchase = () => hold.promise;
  const purchase = h.services.purchase('credits'); await tick();
  h.emit('ACCOUNT_SELECTION_DIALOG_OPENED'); h.setIdentity('other'); h.remote.set('other', envelope(profile({ credits: 20, revision: 4 })));
  h.emit('ACCOUNT_SELECTION_DIALOG_CLOSED'); await tick(); hold.resolve();
  const result = await purchase; assert.equal(result.status, 'pending'); assert.equal(result.reason, 'identity-changed');
  assert.equal(h.services.getState().identity.id, 'other'); assert.equal(h.services.getState().commerce.reason, 'cloud-conflict'); h.services.dispose();
});

test('an uncertain consume cannot be duplicated while its original SDK request is unresolved', async () => {
  const h = commerceHarness({ timeoutMs: 10 }); await h.services.init(); const hold = deferred(); let calls = 0;
  h.gateway.consumePurchase = () => { calls++; return hold.promise; };
  assert.equal((await h.services.purchase('credits')).reason, 'consume-unconfirmed');
  assert.equal((await h.services.recoverPurchases()).reason, 'consume-unconfirmed'); assert.equal(calls, 1);
  hold.resolve(); await tick(); h.services.dispose();
});

test('successful auth is explicit and a second click does not reopen login for an authorized player', async () => {
  const h = harness(); await h.services.init(); await h.services.flush(); let opened = 0;
  h.real.auth.openAuthDialog = async () => { opened++; h.setIdentity('account'); h.remote.set('account', envelope(h.store.get())); };
  assert.equal((await h.services.authorize({ userInitiated: true })).status, 'authorized');
  assert.equal((await h.services.authorize({ userInitiated: true })).status, 'authorized');
  assert.equal(opened, 1); assert.equal(h.services.getState().identity.id, 'account'); h.services.dispose();
});

test('auth resolution with a failed identity refresh is pending, never falsely reported as guest or authorized', async () => {
  const h = harness(); await h.services.init(); await h.services.flush();
  h.real.auth.openAuthDialog = async () => { h.real.getPlayer = async () => { throw Error('offline'); }; };
  const result = await h.services.authorize({ userInitiated: true });
  assert.equal(result.status, 'pending'); assert.equal(result.reason, 'identity-unconfirmed'); h.services.dispose();
});

test('account dialog closing during the post-auth read still refreshes the final selected identity', async () => {
  const h = harness(); await h.services.init(); await h.services.flush(); const hold = deferred();
  h.real.auth.openAuthDialog = async () => { h.setIdentity('account'); };
  h.setRead(owner => owner === 'account' ? hold.promise : Promise.resolve(envelope(h.store.get())));
  const authorization = h.services.authorize({ userInitiated: true }); await tick();
  h.emit('ACCOUNT_SELECTION_DIALOG_OPENED'); h.setIdentity('final-account'); h.emit('ACCOUNT_SELECTION_DIALOG_CLOSED'); await tick();
  hold.resolve(envelope(profile({ credits: 999, revision: 3 }))); await authorization;
  assert.equal(h.services.getState().identity.id, 'final-account'); assert.equal(h.services.getState().cloud.status, 'loaded');
  assert.equal(h.services.getState().conflict, null); assert.equal(h.lifecycle.has('account-selection'), false); h.services.dispose();
});
