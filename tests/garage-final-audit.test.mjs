import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createAds } from '../src/ads.js';
import { createLifecycle } from '../src/lifecycle.js';
import { createPlatformServices, CLOUD_PROFILE_KEY } from '../src/platform-services.js';
import { createProgressionStorage } from '../src/progression-storage.js';
import { GarageUI, normalizeGarageView } from '../src/garage-ui.js';

/** Isolated browser save storage; no real account, browser or advertising is involved. */
function memory() {
  const entries = new Map();
  return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
}
/** Manual SDK response, allowing an application timeout without physical completion. */
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
/** Render the real footer with only text/append DOM primitives and record its genuine UI actions. */
function footerActions(platform) {
  const actions = [];
  const doc = { createElement: () => ({ children: [], append(...nodes) { this.children.push(...nodes); } }) };
  const presenter = {
    doc, view: normalizeGarageView({ platform }),
    button(label, action) { actions.push({ label, ...action }); return doc.createElement('button'); },
  };
  GarageUI.prototype.renderFooter.call(presenter);
  return actions;
}

test('a healthy guest cloud save still exposes explicit account login for cross-device progress', () => {
  for (const cloudStatus of ['durable', 'loaded']) {
    const actions = footerActions({ sdk: true, cloud: true, cloudConnected: true,
      authenticated: false, auth: 'guest', cloudStatus, local: { localSaved: true } });
    assert.ok(actions.some(action => action.type === 'cloudConnect'),
      `Guest ${cloudStatus} is not account authorization and must not hide the only login CTA`);
  }
});

test('an authorized player can retry a failed cloud read without reopening login', () => {
  const actions = footerActions({ sdk: true, cloud: true, cloudConnected: false,
    authenticated: true, auth: 'authorized', cloudStatus: 'error', local: { localSaved: true } });
  assert.ok(actions.some(action => action.type === 'retryCloud'),
    'A frozen failed read needs a retryCloud action; local progression must not silently remain unsynced');
  assert.equal(actions.some(action => action.type === 'cloudConnect'), false);
});

test('the main controller does not start ads while a timed-out login dialog is still unresolved', async () => {
  const hold = deferred(), provider = memory(), callbacks = [];
  const store = createProgressionStorage({ provider, idFactory: () => 'audit_guest' });
  const lifecycle = createLifecycle();
  let remote = {};
  const real = {
    getPlayer: async () => ({ getUniqueID: () => 'guest', isAuthorized: () => false,
      getData: async () => structuredClone(remote), setData: async value => { remote = structuredClone(value); } }),
    auth: { openAuthDialog: () => hold.promise },
    adv: { showRewardedVideo: ({ callbacks: value }) => callbacks.push(value) },
  };
  const sdk = { init: async () => real, get: () => real };
  const platform = createPlatformServices({ sdk, lifecycle, profileStore: store, timeoutMs: 5, minSaveIntervalMs: 0 });
  await platform.init(); await platform.flush();
  try {
    const auth = await platform.authorize({ userInitiated: true });
    assert.equal(auth.reason, 'auth-timeout');
    assert.equal(platform.getState().auth, 'pending');
    assert.equal(lifecycle.has('authorization'), false, 'Free play may resume while login remains uncertain');
    const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
    const declaration = main.match(/^const ads=createAds\([^\n]+\);$/m)?.[0];
    assert.ok(declaration, 'Exercise the actual controller ad admission predicate');
    const context = vm.createContext({ createAds, sdk, lifecycle, platform, orientationBlocked:false, screen: 'results' });
    vm.runInContext(`${declaration}\nglobalThis.auditAds = ads;`, context);
    const pending = context.auditAds.rewarded();
    // Clean up the unexpected request before asserting, so this test never leaves an ad timer alive.
    for (const callback of callbacks) callback.onClose(false);
    const outcome = await pending;
    assert.equal(callbacks.length, 0, 'A still-live login must not overlap a second SDK modal');
    assert.equal(outcome.code, 'UNAVAILABLE');
  } finally {
    hold.resolve();
    await new Promise(resolve => setImmediate(resolve));
    platform.dispose();
  }
});

test('revive settlement and finalized ad receipt remain exactly once across reloads', () => {
  const provider = memory(); let id = 0;
  const reopen = () => createProgressionStorage({ provider, idFactory: () => `audit_${++id}` });
  const metrics = (distanceM, revives = 0) => ({ distanceM, groundDistanceM: distanceM,
    activeSeconds: distanceM / 20, rawScore: distanceM, revives });
  let store = reopen(); const run = store.beginRun().run;
  store.settleRun(run, metrics(600)); const first = store.get();
  store = reopen(); assert.equal(store.settleRun(run, metrics(600)).changed, false);
  assert.equal(store.get().wallet.credits, first.wallet.credits);
  const continued = store.settleRun(run, metrics(900, 1), { finalized: true });
  assert.equal(continued.rewardDelta.credits, 30); assert.equal(store.get().stats.runs, 1);
  const claimed = store.dispatch({ type: 'CLAIM_AD_BONUS', runId: run.id, runSequence: run.sequence });
  assert.equal(claimed.ok, true); const completed = store.get();
  store = reopen();
  assert.equal(store.dispatch({ type: 'CLAIM_AD_BONUS', runId: run.id, runSequence: run.sequence }).reason, 'already-claimed');
  assert.equal(store.settleRun(run, metrics(1200, 1)).reason, 'run-finalized');
  assert.deepEqual(store.get(), completed);
});

test('a transient initial Player failure exposes a retry and recovers the same cloud profile without overwriting it',async()=>{
 const store=createProgressionStorage({provider:memory(),idFactory:()=> 'cloud_retry_fixture'}),lifecycle=createLifecycle();let calls=0,writes=0;
 const real={getPlayer:async()=>{if(++calls===1)throw new Error('temporary network outage');return {getUniqueID:()=> 'guest',isAuthorized:()=>false,getData:async()=>({[CLOUD_PROFILE_KEY]:{formatVersion:1,accountId:'guest',profile:store.get()}}),setData:async()=>{writes++;}};}};
 const platform=createPlatformServices({sdk:{init:async()=>real,get:()=>real},lifecycle,profileStore:store,minSaveIntervalMs:0});
 try{await platform.init();const failed=platform.getState();assert.equal(failed.cloud.status,'error');const actions=footerActions({...failed,sdk:true,cloud:false,cloudStatus:failed.cloud.status});assert.ok(actions.some(action=>action.type==='retryCloud'));await platform.retryCloud();assert.equal(platform.getState().cloud.status,'loaded');assert.equal(platform.getState().auth,'guest');assert.equal(writes,0);assert.equal(store.get().wallet.credits,300);}finally{platform.dispose();}
});
