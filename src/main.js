import { Game } from './game.js';
import { RoadRenderer } from './world.js';
import { createStorage } from './storage.js';
import { createSdk } from './sdk.js';
import { createLifecycle } from './lifecycle.js';
import { createAds } from './ads.js';
import { GameAudio } from './audio.js';
import { UI, cameraShortcutAllowed, glanceShortcutAllowed, CockpitGlanceControls } from './ui.js';
import { DrivingInput } from './input.js';
import { normalizeRenderQuality, observeRenderPixelRatio } from './render-settings.js';

/**
 * Resolve a known game DOM element from the static HTML shell.
 * @param {string} id - Element identifier.
 * @returns {HTMLElement|null} Matching element; callers rely on validated HTML assets.
 */
const byId = id => document.getElementById(id);
const storage = createStorage();
const settings = storage.get();
const sdk = createSdk();
const audio = new GameAudio(settings.sound);
const input = new DrivingInput();
const ui = new UI(action => void handleAction(action));
const playButton = byId('playBtn');
playButton.disabled = true;
playButton.textContent = 'Загрузка трассы…';
const renderer = new RoadRenderer(byId('scene'), percent => { byId('loadStatus').textContent = 'Загрузка моделей и материалов · ' + percent + '%'; }, {
  quality: settings.renderQuality,
  cameraMode: settings.cameraMode,
  /** Reflect the actual drawing buffer only after initialization, resize or a quality change. */
  onRenderSettings: info => ui.renderSettings(info),
});
const glance = new CockpitGlanceControls(direction => renderer.setLookDirection(direction));
let assetsReady = false, assetsFailed = false;
const assetsLoaded = renderer.ready.then(() => {
  assetsReady = true; playButton.disabled = false;
  playButton.textContent = 'Выехать →'; byId('loadStatus').hidden = true;
}).catch(error => {
  console.error('Asset loading failed:', error);
  assetsFailed = true; playButton.disabled = false; playButton.textContent = 'Повторить загрузку';
  byId('loadStatus').textContent = 'Не удалось загрузить трассу. Проверь соединение и повтори загрузку.';
});
const game = new Game({ /** Translate simulation events into sound, particles and localized score feedback; no simulation mutation. */ onEvent: (event, value) => {
  audio.tone(event);
  renderer.effect(event);
  if (event === 'near') ui.toast('БЛИЗКО!  ×' + value);
  if (event === 'charge') ui.toast('+22% НИТРО');
  if (event === 'goal') ui.toast('1 500 М · +1 000 ОЧКОВ');
  if (event === 'cone') ui.toast('КОНУС · −50 ОЧКОВ');
  if (event === 'event-clear') ui.toast(value.success ? '+' + value.points + ' · СОБЫТИЕ ПРОЙДЕНО' : 'СОБЫТИЕ НЕ ПРОЙДЕНО');
} });
let screen = 'menu';
let busy = false;
let runBest = 0;
let savedDistance = 0;
let runCounted = false;
let lastAdAt = -Infinity;
let helpFromGame = false;
let crashElapsed = 0;

const lifecycle = createLifecycle(() => {
  clearInput();
  if (screen === 'playing' && lifecycle.paused) {
    screen = 'paused';
    ui.setScreen(screen);
    lifecycle.pause('user');
    ui.pause();
  }
  syncGameplay();
});
/**
 * Release both held controls and the transient swipe steering pulse at lifecycle boundaries.
 */
function clearInput() { input.clear(); game.releaseControls(); glance.clear(); }
const ads = createAds({ sdk, lifecycle, /** Ads are eligible only on the results screen, never during a live run. */ canShow: () => screen === 'results' });

/**
 * Synchronize platform gameplay reporting and engine audibility with screen, lifecycle and simulation phase.
 */
function syncGameplay() {
  const active = screen === 'playing' && !lifecycle.paused && game.state.phase === 'playing';
  sdk.gameplay(active);
  audio.update(game.state, active);
}
/** Reconcile mirror-glance eligibility without modifying pedals, steering or camera preference. */
function syncGlanceControls() {
  const visible = renderer.cameraMode === 'cockpit' && ['playing', 'paused'].includes(screen);
  const enabled = visible && screen === 'playing' && !lifecycle.paused && !busy && ui.overlay.hidden
    && game.state.phase === 'playing' && !game.state.rolling && renderer.effectiveCameraMode === 'cockpit';
  glance.setEnabled(enabled);
  ui.glance(visible, enabled, glance.direction);
}
/**
 * Refresh local settings from the save snapshot, update menu state and apply the selected scenic route.
 */
function refreshMenu() {
  Object.assign(settings, storage.get());
  ui.menu(settings);
  renderer.setRoute(settings.route);
}
/**
 * Start a fresh run only after assets are ready and no ad action is pending.
 * Resets controls and per-run accounting, but preserves external lifecycle pause owners.
 */
function startRun() {
  if (assetsFailed) { location.reload(); return; }
  if (!assetsReady) return;
  if (busy) return;
  ui.close();
  lifecycle.resume('user');
  game.reset(settings.difficulty);
  game.start();
  runBest = storage.get().best[settings.difficulty];
  savedDistance = 0;
  runCounted = false;
  clearInput();
  crashElapsed = 0;
  screen = 'playing';
  ui.setScreen(screen);
  ui.hud(game.state);
  void audio.unlock();
  // A platform pause may precede the first user action.
  if (lifecycle.paused) {
    screen = 'paused'; ui.setScreen(screen); lifecycle.pause('user'); ui.pause();
  }
  syncGameplay();
  renderer.resize();
}
/**
 * Persist only unsaved distance and count this run once, including repeated saves across a revive.
 * Empty runs are ignored; savedDistance advances only after the storage call.
 */
function saveRun() {
  if (game.state.elapsed <= 0) return;
  storage.finish(game.state.score, game.state.distance - savedDistance, game.difficulty, !runCounted);
  savedDistance = game.state.distance;
  runCounted = true;
}
/**
 * Save the current run, stop gameplay/audio and open result actions with platform reward availability.
 */
function showResults() {
  saveRun();
  screen = 'results'; clearInput();
  ui.setScreen(screen); syncGameplay();
  ui.results(game.state, { record: Math.floor(game.state.score) > runBest, best: storage.get().best[game.difficulty], adAvailable: ads.available });
}
/**
 * Pause active play until explicit user resume and retain any independent platform/visibility blocker.
 * @param {string} reason - Additional pause owner; user is always retained for safe resumption.
 */
function pauseRun(reason = 'user') {
  if (screen === 'playing') lifecycle.pause('user');
  if (reason !== 'user') lifecycle.pause(reason);
}
/**
 * Persist the requested view without changing driving, flight or lifecycle state.
 * The renderer may briefly use its external comfort view during a roll; that is not a preference change.
 */
function toggleCamera() {
  if (busy || !['playing', 'paused'].includes(screen)) return;
  if (!ui.overlay.hidden && ui.modalType !== 'pause') return;
  settings.cameraMode = settings.cameraMode === 'cockpit' ? 'chase' : 'cockpit';
  storage.settings({ cameraMode: settings.cameraMode });
  renderer.setCameraMode(settings.cameraMode);
  ui.camera(settings.cameraMode);
  ui.notice(settings.cameraMode === 'cockpit' ? 'Выбран вид из кабины' : 'Выбрана внешняя камера');
}
/**
 * Dispatch guarded modal actions and await ad completion before retry/revive transitions.
 * Busy ad operations exclude concurrent actions; a reward callback, not ad close, authorizes revival.
 * @param {string} action - retry, revive, resume, menu, camera or closeHelp from a validated UI action.
 * @returns {Promise<void>} Resolves after the requested transition or guarded no-op.
 */
async function handleAction(action) {
  if (busy) return;
  if (action === 'retry') {
    if (screen !== 'results') return;
    if (sdk.get() && game.state.elapsed >= 30 && performance.now() - lastAdAt > 60000) {
      busy = true; ui.busy(true);
      try { await ads.interstitial(); lastAdAt = performance.now(); }
      finally { busy = false; ui.busy(false); }
    }
    startRun();
  } else if (action === 'revive') {
    if (screen !== 'results' || game.state.revives >= 1) return;
    if (ads.available) {
      busy = true; ui.busy(true);
      let result;
      try { result = await ads.rewarded(); }
      finally { busy = false; ui.busy(false); }
      if (!result?.rewarded) {
        byId('adStatus').textContent = 'Бонус не получен. Можно попробовать ещё или начать новый заезд.';
        return;
      }
    }
    if (game.revive()) {
      clearInput();
      ui.close(); screen = 'playing'; ui.setScreen(screen);
      if (lifecycle.paused) { lifecycle.pause('user'); screen = 'paused'; ui.setScreen(screen); ui.pause(); }
      syncGameplay();
    }
  } else if (action === 'resume') {
    if (screen !== 'paused') return;
    const blockers = lifecycle.reasons().filter(reason => reason !== 'user');
    if (blockers.length) { ui.notice('Дождись закрытия окна платформы и вернись в игру.'); return; }
    clearInput(); ui.close(); screen = 'playing'; lifecycle.resume('user'); ui.setScreen(screen); syncGameplay(); void audio.unlock();
  } else if (action === 'menu') {
    if (screen === 'playing' || screen === 'paused') saveRun();
    ui.close(); screen = 'menu'; clearInput();
    lifecycle.resume('user'); ui.setScreen(screen); syncGameplay(); refreshMenu(); renderer.resize();
    byId('playBtn').focus({ preventScroll: true });
  } else if (action === 'camera') {
    if (ui.modalType === 'pause') toggleCamera();
  } else if (action === 'closeHelp') {
    ui.close();
    if (helpFromGame) ui.pause();
    helpFromGame = false;
  }
}
byId('playBtn').addEventListener('click', startRun);
byId('pauseBtn').addEventListener('click', () => pauseRun());
byId('cameraBtn').addEventListener('click', toggleCamera);
byId('cameraBtn').addEventListener('keydown', event => {
  // Keep native button activation: Space must click the focused camera toggle, not hold nitro.
  if (['Enter', 'Space'].includes(event.code)) event.stopPropagation();
});
byId('helpBtn').addEventListener('click', () => {
  helpFromGame = screen === 'playing' || screen === 'paused';
  if (screen === 'playing') pauseRun();
  ui.help();
});
byId('soundBtn').addEventListener('click', async () => {
  settings.sound = !settings.sound;
  audio.enabled = settings.sound;
  storage.settings({ sound: settings.sound });
  ui.sound(settings.sound);
  await audio.unlock(); syncGameplay();
  ui.notice(settings.sound ? 'Звук включён' : 'Звук выключен');
});
byId('fullscreenBtn').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else ui.notice('Полный экран недоступен в этом браузере.');
  } catch { ui.notice('Браузер не разрешил полный экран.'); }
});
document.addEventListener('fullscreenchange', () => {
  const active = Boolean(document.fullscreenElement);
  byId('fullscreenBtn').setAttribute('aria-label', active ? 'Выйти из полного экрана' : 'На весь экран');
  renderer.resize();
});
document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); void handleAction('menu'); });
for (const button of document.querySelectorAll('[data-route]')) button.addEventListener('click', () => {
  settings.route = button.dataset.route; storage.settings({ route: settings.route }); refreshMenu();
});
for (const button of document.querySelectorAll('[data-difficulty]')) button.addEventListener('click', () => {
  settings.difficulty = button.dataset.difficulty; storage.settings({ difficulty: settings.difficulty }); refreshMenu();
});
byId('renderQuality').addEventListener('change', event => {
  settings.renderQuality = normalizeRenderQuality(event.target.value);
  storage.settings({ renderQuality: settings.renderQuality });
  renderer.setQuality(settings.renderQuality);
});
/**
 * Apply a short swipe-derived steering pulse only while simulation is actively playing.
 * @param {number} direction - Signed horizontal swipe direction.
 */
function steer(direction) { if (screen === 'playing' && !lifecycle.paused) game.steer(direction); }
document.addEventListener('keydown', event => {
  if (cameraShortcutAllowed(event, screen, !ui.overlay.hidden)) { event.preventDefault(); toggleCamera(); return; }
  if (['KeyZ', 'KeyX'].includes(event.code)) {
    syncGlanceControls();
    if (glance.enabled && glanceShortcutAllowed(event, screen, !ui.overlay.hidden)) {
      event.preventDefault();
      glance.set(event.code === 'KeyZ' ? -1 : 1, 'key-' + event.code, true);
      syncGlanceControls();
    }
    return;
  }
  if (!ui.overlay.hidden) return;
  if (screen === 'menu' && event.code === 'Enter' && !event.target.closest('button, a, select, summary, input, textarea')) { event.preventDefault(); startRun(); return; }
  if (screen !== 'playing') return;
  if (input.key(event.code,true)) event.preventDefault();
  if (!event.repeat && ['Escape', 'KeyP'].includes(event.code)) { event.preventDefault(); pauseRun(); }
});
document.addEventListener('keyup', event => { input.key(event.code,false); glance.release('key-' + event.code); });
const controlBindings = [['leftBtn','left'],['rightBtn','right'],['gasBtn','gas'],['brakeBtn','brake'],['boostBtn','boost'],['flightBtn','flight'],['rollLeftBtn','rollLeft'],['rollRightBtn','rollRight']];
for (const [id,action] of controlBindings) {
  const button=byId(id);
  button.addEventListener('pointerdown',event=>{
    event.preventDefault();if(screen!=='playing'||lifecycle.paused||event.button>0||button.disabled||button.getAttribute('aria-disabled')==='true')return;
    input.set(action,'pointer-'+event.pointerId,true);
    try { button.setPointerCapture(event.pointerId); } catch { /* Synthetic pointer events have no active capture. */ }
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,event=>input.set(action,'pointer-'+event.pointerId,false));
  button.addEventListener('keydown',event=>{
    if(!['Enter','Space'].includes(event.code)||screen!=='playing'||lifecycle.paused)return;
    event.preventDefault();event.stopPropagation();
    if(button.disabled||button.getAttribute('aria-disabled')==='true')return;
    input.set(action,id+'-'+event.code,true);
  });
  button.addEventListener('keyup',event=>{ if(['Enter','Space'].includes(event.code)){event.preventDefault();event.stopPropagation();input.set(action,id+'-'+event.code,false);} });
  button.addEventListener('blur',()=>{input.set(action,id+'-Enter',false);input.set(action,id+'-Space',false);});
}
// Dedicated held glances never enter DrivingInput and never turn scene swipes into drag-look.
for (const [id, direction] of [['lookLeftBtn', -1], ['lookRightBtn', 1]]) {
  const button = byId(id);
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    syncGlanceControls();
    if (!glance.enabled || event.button > 0 || button.disabled) return;
    glance.set(direction, 'pointer-' + event.pointerId, true);
    try { button.setPointerCapture(event.pointerId); } catch { /* Synthetic events have no active capture. */ }
    syncGlanceControls();
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, event => {
    glance.release('pointer-' + event.pointerId);
    syncGlanceControls();
  });
  button.addEventListener('keydown', event => {
    if (!['Enter', 'Space'].includes(event.code)) return;
    event.preventDefault(); event.stopPropagation();
    syncGlanceControls();
    if (event.repeat || !glance.enabled || button.disabled) return;
    glance.set(direction, id + '-' + event.code, true);
    syncGlanceControls();
  });
  button.addEventListener('keyup', event => {
    if (!['Enter', 'Space'].includes(event.code)) return;
    event.preventDefault(); event.stopPropagation();
    glance.release(id + '-' + event.code);
    syncGlanceControls();
  });
  button.addEventListener('blur', () => {
    glance.release(id + '-Enter'); glance.release(id + '-Space');
    syncGlanceControls();
  });
}
for (const name of ['pointerup', 'pointercancel']) window.addEventListener(name, event => {
  // Each pointer owns one source; releasing it must not cancel other fingers.
  input.release('pointer-' + event.pointerId);
  glance.release('pointer-' + event.pointerId);
});
let gesture = null;
byId('scene').addEventListener('pointerdown', event => {
  if (screen !== 'playing') return;
  gesture = { x: event.clientX, y: event.clientY };
  byId('scene').setPointerCapture(event.pointerId);
});
byId('scene').addEventListener('pointerup', event => {
  if (!gesture) return;
  const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
  if (Math.abs(dx) > 24 && Math.abs(dx) > Math.abs(dy)) steer(Math.sign(dx));
  gesture = null;
});
byId('scene').addEventListener('pointercancel', () => { gesture = null; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearInput(); gesture = null; pauseRun('hidden'); }
  else lifecycle.resume('hidden');
});
window.addEventListener('blur', () => { clearInput(); gesture = null; pauseRun('blur'); });
window.addEventListener('focus', () => lifecycle.resume('blur'));
sdk.on('game_api_pause', () => pauseRun('platform'));
sdk.on('game_api_resume', () => lifecycle.resume('platform'));
window.addEventListener('resize', () => renderer.resize());
observeRenderPixelRatio(() => renderer.resize());
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => { renderer.reducedMotion = event.matches; renderer.needsRender = true; });
refreshMenu(); ui.setScreen('menu');
renderer.render(game.state, { menu: true, dt: 0 });
void Promise.all([sdk.init(), assetsLoaded]).then(() => { if (assetsReady) sdk.ready(); syncGameplay(); });
let previous = performance.now();
/**
 * Advance one animation frame, limiting elapsed simulation time to 0.1 seconds.
 * Updates controls/HUD/render/audio and delays results briefly for crash feedback; always schedules the next frame.
 * @param {number} time - requestAnimationFrame timestamp in milliseconds.
 */
function tick(time) {
  const dt = Math.min((time - previous) / 1000, .1);
  previous = time;
  if (screen === 'playing' && !lifecycle.paused) {
    game.update(dt, input.read());
    if (game.state.phase === 'crashed') {
      clearInput();
      syncGameplay();
      crashElapsed += dt;
      if (crashElapsed >= .65) { crashElapsed = 0; showResults(); }
    }
  }
  if (screen !== 'menu') ui.hud(game.state);
  for (const [id, action] of controlBindings) {
    const held = String(input.active(action));
    const button = byId(id);
    if (button.dataset.held !== held) button.dataset.held = held;
    if (button.getAttribute('aria-pressed') !== held) button.setAttribute('aria-pressed', held);
  }
  syncGlanceControls();
  renderer.render(game.state, { menu: screen === 'menu', dt, paused: screen !== 'playing' });
  audio.update(game.state, screen === 'playing' && !lifecycle.paused);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
