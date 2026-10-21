import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createAds } from '../src/ads.js';
import { createLifecycle } from '../src/lifecycle.js';
import { createPlatformServices, CLOUD_PROFILE_KEY } from '../src/platform-services.js';
import { createProgressionStorage } from '../src/progression-storage.js';
import { createProfile } from '../src/progression.js';
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
/** Render the real settings save controls with only text/append DOM primitives and record its genuine UI actions. */
function saveControlActions(platform) {
  const actions = [];
  const doc = { createElement: () => ({ children: [], setAttribute() {}, append(...nodes) { this.children.push(...nodes); } }) };
  const presenter = {
    doc, view: normalizeGarageView({ platform }),
    button(label, action) { actions.push({ label, ...action }); return doc.createElement('button'); },
  };
  GarageUI.prototype.renderSaveControls.call(presenter);
  return actions;
}

test('a healthy guest cloud save still exposes explicit account login for cross-device progress', () => {
  for (const cloudStatus of ['durable', 'loaded']) {
    const actions = saveControlActions({ sdk: true, cloud: true, cloudConnected: true,
      authenticated: false, auth: 'guest', cloudStatus, local: { localSaved: true } });
    assert.ok(actions.some(action => action.type === 'cloudConnect'),
      `Guest ${cloudStatus} is not account authorization and must not hide the only login CTA`);
  }
});

test('an authorized player can retry a failed cloud read without reopening login', () => {
  const actions = saveControlActions({ sdk: true, cloud: true, cloudConnected: false,
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

test('continued run remains mutually exclusive with doubling across reloads', () => {
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
  assert.equal(claimed.ok, false); assert.equal(claimed.reason, 'run-finalized'); const completed = store.get();
  store = reopen();
  assert.equal(store.dispatch({ type: 'CLAIM_AD_BONUS', runId: run.id, runSequence: run.sequence }).reason, 'run-finalized');
  assert.equal(store.settleRun(run, metrics(1200, 1)).reason, 'run-finalized');
  assert.deepEqual(store.get(), completed);
});

test('a transient initial Player failure exposes a retry and recovers the same cloud profile without overwriting it',async()=>{
 const store=createProgressionStorage({provider:memory(),idFactory:()=> 'cloud_retry_fixture'}),lifecycle=createLifecycle();let calls=0,writes=0;
 const real={getPlayer:async()=>{if(++calls===1)throw new Error('temporary network outage');return {getUniqueID:()=> 'guest',isAuthorized:()=>false,getData:async()=>({[CLOUD_PROFILE_KEY]:{formatVersion:1,accountId:'guest',profile:store.get()}}),setData:async()=>{writes++;}};}};
 const platform=createPlatformServices({sdk:{init:async()=>real,get:()=>real},lifecycle,profileStore:store,minSaveIntervalMs:0});
 try{await platform.init();const failed=platform.getState();assert.equal(failed.cloud.status,'error');const actions=saveControlActions({...failed,sdk:true,cloud:false,cloudStatus:failed.cloud.status});assert.ok(actions.some(action=>action.type==='retryCloud'));await platform.retryCloud();assert.equal(platform.getState().cloud.status,'loaded');assert.equal(platform.getState().auth,'guest');assert.equal(writes,0);assert.equal(store.get().wallet.credits,300);}finally{platform.dispose();}
});


test('a validated cloud load with unavailable local storage reports the existing copy, not session-only or a new durable write', async () => {
  const remote = createProfile({ now: 1000, id: 'audit_existing_cloud' });
  remote.wallet.credits = 1234; remote.revision = 12;
  const store = createProgressionStorage({
    provider: () => { throw Object.assign(new Error('Local storage unavailable'), { name: 'SecurityError' }); },
    now: () => 1000, idFactory: () => 'audit_unavailable_local',
  });
  let writes = 0;
  const real = { getPlayer: async () => ({
    getUniqueID: () => 'guest', isAuthorized: () => false,
    getData: async () => ({ [CLOUD_PROFILE_KEY]: { formatVersion: 1, accountId: 'guest', profile: structuredClone(remote) } }),
    setData: async () => { writes++; },
  }) };
  const platform = createPlatformServices({ sdk: { init: async () => real, get: () => real }, lifecycle: createLifecycle(), profileStore: store, minSaveIntervalMs: 0 });
  try {
    await platform.init();
    const state = platform.getState();
    assert.equal(state.cloud.status, 'loaded');
    assert.equal(state.local.localSaved, false);
    assert.equal(store.get().wallet.credits, 1234);
    assert.equal(writes, 0, 'Loading a validated existing profile must not be reported as a new cloud write');
    const doc = { createElement: () => ({ children: [], textContent: '', setAttribute() {}, append(...nodes) { this.children.push(...nodes); } }) };
    const presenter = { doc, view: normalizeGarageView({ profile: store.get(), cloud: state.cloud, local: state.local, platform: { ...state, sdk: true, cloud: state.cloud.available } }), button() { return doc.createElement('button'); } };
    const text = node => node.textContent + node.children.map(text).join('');
    for (const alertsOnly of [false, true]) {
      const controls = GarageUI.prototype.renderSaveControls.call(presenter, { alertsOnly });
      assert.match(text(controls), /На устройстве не сохранено · загружена облачная копия/);
      assert.doesNotMatch(text(controls), /только в этой сессии|сохранено в облаке|облако не подтверждено/i);
    }
    assert.equal(writes, 0, 'Presentation never causes a save');
  } finally { platform.dispose(); }
});
