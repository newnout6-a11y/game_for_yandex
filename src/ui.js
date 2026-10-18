import { CONFIG, ROUTES } from './config.js';
import { FLIGHT } from './flight.js';
import { formatNumber, clamp } from './util.js';
import { normalizeRenderQuality } from './render-settings.js';
import { normalizeCameraMode } from './camera-view.js';
/**
 * Resolve a known game DOM element from the static HTML shell.
 * @param {string} id - Element identifier.
 * @returns {HTMLElement|null} Matching element; callers rely on validated HTML assets.
 */
const byId = id => document.getElementById(id);
const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>';
export class UI {
  /**
   * Bind modal action delegation and keyboard focus containment without starting a run.
   * @param {Function} onAction - Receives validated action names from dialog buttons or escape keys.
   */
  constructor(onAction) {
    this.onAction = onAction;
    this.app = byId('app');
    this.overlay = byId('overlay');
    this.dialog = byId('dialog');
    this.renderSettingsElement = byId('renderSettings');
    this.renderSettingsHome = this.renderSettingsElement.parentElement;
    this.modalType = null;
    this.dialog.addEventListener('click', event => {
      const button = event.target.closest('[data-action]');
      if (button && !button.disabled) this.onAction(button.dataset.action);
    });
    this.overlay.addEventListener('keydown', event => {
      if (this.overlay.hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (this.modalType === 'help') this.onAction('closeHelp');
        else if (this.modalType === 'pause') this.onAction('resume');
      }
      if (event.key !== 'Tab') return;
      const items = [...this.dialog.querySelectorAll('button:not(:disabled), a[href], select:not(:disabled), details > summary, [tabindex="0"]')].filter(el => el.getClientRects().length);
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === this.dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }
  /**
   * Select menu/HUD/topbar visibility using the application screen state.
   * @param {string} screen - menu, playing, paused or results.
   */
  setScreen(screen) {
    this.app.dataset.screen = screen;
    byId('menu').hidden = screen !== 'menu';
    byId('hud').hidden = screen === 'menu';
    byId('pauseBtn').hidden = !['playing', 'paused'].includes(screen);
    byId('cameraBtn').hidden = !['playing', 'paused'].includes(screen);
    byId('helpBtn').hidden = screen === 'results';
  }
  /**
   * Reflect sanitized route/difficulty, record, sound and camera settings in labels and ARIA states.
   * @param {Object} settings - Detached storage snapshot with valid route/difficulty identifiers.
   */
  menu(settings) {
    for (const button of document.querySelectorAll('[data-route]')) button.setAttribute('aria-pressed', String(button.dataset.route === settings.route));
    for (const button of document.querySelectorAll('[data-difficulty]')) button.setAttribute('aria-pressed', String(button.dataset.difficulty === settings.difficulty));
    byId('menuBest').textContent = formatNumber(settings.best[settings.difficulty]);
    const route = ROUTES[settings.route];
    byId('routeLabel').textContent = route.name.toUpperCase();
    this.sound(settings.sound);
    this.camera(settings.cameraMode);
  }
  /**
   * Reflect the requested persistent view, not the renderer's temporary roll-comfort fallback.
   * The stable accessible name makes the native buttons predictable pressed-state toggles.
   * @param {'chase'|'cockpit'} mode - Requested camera preference; unknown values use chase.
   */
  camera(mode) {
    this.cameraMode = normalizeCameraMode(mode);
    const cockpit = this.cameraMode === 'cockpit';
    const title = (cockpit ? 'Внешняя камера' : 'Вид из кабины') + ' (C)';
    const toolbarButton = byId('cameraBtn');
    toolbarButton.setAttribute('aria-pressed', String(cockpit));
    toolbarButton.setAttribute('title', title);
    const pauseButton = byId('pauseCameraBtn');
    if (pauseButton) {
      pauseButton.setAttribute('aria-pressed', String(cockpit));
      pauseButton.textContent = 'Вид из кабины: ' + (cockpit ? 'включён' : 'выключен');
    }
  }
  /**
   * Keep deliberate mirror glances separate from steering and the saved camera preference.
   * @param {boolean} visible - Cockpit is selected during a live or paused run.
   * @param {boolean} enabled - Active cockpit gameplay, outside a roll or modal.
   * @param {number} direction - Current signed held glance; opposing holds recenter.
   */
  glance(visible, enabled, direction = 0) {
    byId('glanceControls').hidden = !visible;
    for (const [id, value] of [['lookLeftBtn', -1], ['lookRightBtn', 1]]) {
      const button = byId(id);
      button.disabled = !enabled;
      const held = String(enabled && direction === value);
      if (button.dataset.held !== held) button.dataset.held = held;
      if (button.getAttribute('aria-pressed') !== held) button.setAttribute('aria-pressed', held);
    }
  }
  /**
   * Report actual buffer pixels, never viewport dimensions or a promised output resolution.
   * Called at renderer settings boundaries, not by the animation loop.
   * @param {Object} info - Active quality, actual integer width/height and compact-device budget flag.
   */
  renderSettings(info) {
    const quality = normalizeRenderQuality(info.quality);
    byId('renderQuality').value = quality;
    byId('renderResolution').textContent = info.width + ' × ' + info.height;
    const compact = info.compact;
    byId('renderQualityHint').textContent = quality === 'auto'
      ? 'Авто ограничивает разрешение ради плавности. Лимит: ' + (compact ? '0,8' : '1,6') + ' млн пикселей.'
      : (quality === 'high'
        ? 'Высокое: ' + (compact ? 'до 1,6 млн пикселей на телефоне и в небольшом окне.' : 'до 2560 × 1440 при формате 16:9.')
        : 'Ультра: ' + (compact ? 'до 2,1 млн пикселей на телефоне и в небольшом окне, не 4K.' : 'до 3840 × 2160 (4K) при формате 16:9.'))
        + ' Выше нагрузка на графику и расход батареи. Если игра тормозит, выбери «Авто».';
  }
  /**
   * Update the sound button icon, pressed state and action label.
   * @param {boolean} enabled - Persisted sound preference, not AudioContext readiness.
   */
  sound(enabled) {
    byId('soundBtn').setAttribute('aria-pressed', String(enabled));
    byId('soundBtn').setAttribute('aria-label', enabled ? 'Выключить звук' : 'Включить звук');
    byId('soundBtn').innerHTML = enabled
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m11 5-6 5H2v4h3l6 5V5Zm5 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m11 5-6 5H2v4h3l6 5V5Zm5 4 5 6m0-6-5 6"/></svg>';
  }
  /**
   * Render a run snapshot without mutating the simulation.
   * Converts metres/second to km/h, displays metres and percent energy, and announces ability mode changes only.
   * @param {Object} s - Current Game state, including flight/roll telemetry and optional road event.
   */
  hud(s) {
    byId('score').textContent = String(Math.floor(s.score)).padStart(5, '0');
    byId('speed').textContent = String(Math.round(s.speed * 3.6));
    byId('distance').textContent = formatNumber(s.distance) + ' м';
    byId('challengeProgress').style.width = clamp(s.distance / CONFIG.goal * 100, 0, 100) + '%';
    byId('challengeTitle').textContent = s.goalReached ? 'Цель выполнена · +1 000 очков' : 'Цель: проехать 1 500 м';
    byId('combo').hidden = s.combo <= 1;
    byId('combo').textContent = '×' + s.combo;
    const dialSpeed=clamp(s.speed*3.6/300,0,1);
    byId('speedNeedle').setAttribute('transform','rotate('+(-90+dialSpeed*180)+' 110 120)');
    byId('speedArc').style.strokeDashoffset=String(100-dialSpeed*100);
    byId('nitroValue').textContent = Math.round(s.nitro) + '%';
    byId('nitroFill').style.width = s.nitro + '%';
    byId('boostBtn').disabled = s.nitro <= 0;
    const flight = flightPresentation(s);
    byId('flightStatus').dataset.mode = flight.mode;
    byId('flightValue').textContent = flight.value;
    byId('flightHint').textContent = flight.hint;
    byId('flightBtn').dataset.mode = flight.mode;
    if (this.flightMode !== flight.mode) {
      byId('flightAnnouncement').textContent = flight.announcement;
      this.flightMode = flight.mode;
    }
    const airborne = s.altitude > .05 || s.flying || s.rolling;
    byId('flightTelemetry').hidden = !airborne;
    const climb = Number.isFinite(s.verticalSpeed) ? s.verticalSpeed : 0;
    const power = Math.round(clamp(Number(s.thrusterPower) || 0, 0, 1) * 100);
    byId('verticalSpeed').textContent = (climb > .05 ? '+' : '') + (Math.abs(climb) < .05 ? '0,0' : climb.toFixed(1).replace('.', ',')) + ' м/с';
    byId('thrusterPower').textContent = 'ТЯГА ' + power + '%';
    const roll = rollPresentation(s);
    byId('rollStatus').dataset.mode = roll.mode;
    byId('rollValue').textContent = roll.value;
    byId('rollHint').textContent = roll.hint;
    for (const id of ['rollLeftBtn', 'rollRightBtn']) {
      const button = byId(id);
      button.setAttribute('aria-disabled', String(!s.rollReady || Boolean(s.rolling)));
      button.dataset.mode = roll.mode;
    }
    if (this.rollMode !== roll.mode) {
      byId('rollAnnouncement').textContent = roll.announcement;
      this.rollMode = roll.mode;
    }
    byId('runHint').hidden = (s.elapsed > 10 && s.distance > 15) || Boolean(s.roadEvent);
    const e=s.roadEvent, last=s.lastEvent?.until>s.elapsed?s.lastEvent:null;
    byId('eventBanner').hidden=!e&&!last;
    const title=e?.title||(last?(last.success?'Пройдено: ':'Не пройдено: ')+last.title:'');
    if(byId('eventTitle').textContent!==title)byId('eventTitle').textContent=title;
    byId('eventHint').textContent=e?.hint||(last?.success?'Бонус +'+last.points+' очков и +15% нитро.':'Следующее событие впереди.');
    byId('eventMeter').textContent=e?(e.type==='convoy'?e.carsLeft+' авто':(e.type==='checkpoint'?Math.ceil(e.seconds)+' с · ':'')+Math.max(0,Math.ceil(e.remaining))+' м'):'';
  }
  /**
   * Open a trusted application-authored modal, preserve return focus and make background controls inert.
   * @param {string} type - Modal identity used for escape-key behavior.
   * @param {string} html - Internal dialog markup; not arbitrary user-supplied HTML.
   */
  open(type, html) {
    if (this.overlay.hidden) this.returnFocus = document.activeElement;
    // Reuse one settings control in the menu and pause dialog; never discard its listeners.
    this.renderSettingsHome.append(this.renderSettingsElement);
    this.modalType = type;
    this.dialog.innerHTML = html;
    this.overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    for (const el of [document.querySelector('.topbar'), byId('menu'), byId('hud')]) el.inert = true;
    this.dialog.scrollTop = 0;
    (this.dialog.querySelector('button:not(:disabled)') || this.dialog).focus({ preventScroll: true });
  }
  /**
   * Hide the modal, restore background interaction and return focus when the original control remains visible.
   */
  close() {
    if (this.dialog.contains(document.activeElement)) document.activeElement.blur();
    this.overlay.hidden = true;
    document.body.style.overflow = '';
    this.modalType = null;
    this.renderSettingsHome.append(this.renderSettingsElement);
    for (const el of [document.querySelector('.topbar'), byId('menu'), byId('hud')]) el.inert = false;
    if (this.returnFocus?.isConnected && !this.returnFocus.closest('[hidden]')) this.returnFocus.focus({ preventScroll: true });
  }
  /**
   * Open the pause dialog with explicit resume/menu actions; does not itself change simulation lifecycle.
   */
  pause() {
    const cockpit = this.cameraMode === 'cockpit';
    this.open('pause', '<h2 id="dialogTitle">Пауза</h2><p>Заезд остановлен.</p><div id="pauseRenderSettings"></div><button class="button primary" data-action="resume">Продолжить заезд ' + arrow + '</button><button class="button secondary pause-camera-button" id="pauseCameraBtn" data-action="camera" aria-label="Вид из кабины" aria-pressed="' + cockpit + '">Вид из кабины: ' + (cockpit ? 'включён' : 'выключен') + '</button><button class="button secondary" data-action="menu">В главное меню</button><p class="dialog-note">Esc — продолжить</p>');
    byId('pauseRenderSettings').append(this.renderSettingsElement);
  }
  /**
   * Open control, ability-cost and asset-attribution help derived from shared flight constants.
   */
  help() {
    const rollRules = FLIGHT.rollMinAltitude.toFixed(1).replace('.', ',') + ' м высоты и ' + FLIGHT.rollCost + '% энергии';
    this.open('help', '<h2 id="dialogTitle">Управление</h2><ol class="help-list"><li><strong>Обходи трафик.</strong> Удерживай A / D или ← →: руль поворачивается постепенно, положение между полосами свободное. На телефоне играй в альбомной ориентации: удерживай «Газ + руль» и веди палец вбок для поворота.</li><li><strong>Газ и тормоз.</strong> W / ↑ — разгон, S / ↓ — торможение. Без газа машина катится и замедляется; в начале заезда она стоит. На телефоне удержание блока «Газ + руль» даёт газ, движение пальца вниз включает тормоз; отпускание сбрасывает оба.</li><li><strong>Сигнал и дальний.</strong> H или кнопка «Сигнал» одновременно подаёт короткий гудок и вспышку фар. Водитель впереди уступает только при свободном безопасном промежутке. Сигнал не даёт приоритета и не гарантирует перестроение.</li><li><strong>События на дороге.</strong> Обходи ограждения дорожных работ, проходи контрольные точки между флагами и реагируй на тормозящую колонну. Успех даёт очки и нитро.</li><li><strong>Собирай заряды.</strong> Золотистый баллон даёт +22% нитро и 50 очков.</li><li><strong>Добавь скорости.</strong> Удерживай газ вместе с пробелом или кнопкой НИТРО. Заряд заканчивается — ускорение тоже.</li><li><strong>Поднимись над дорогой, только Rocket.</strong> Разгонись минимум до 44 км/ч и удерживай F или кнопку ПОЛЁТ. Родстер плавно поднимется над трафиком. Полёт и нитро расходуют один запас энергии; нитро в воздухе не действует. Отпусти кнопку для посадки. При взлёте часть заряда резервируется для мягкой посадки на тормозных соплах. После касания земли — 2 секунды перезарядки. При взлёте и посадке по-прежнему избегай машин.</li><li><strong>Сделай боковой кувырок.</strong> В полёте дождись надписи «ГОТОВ» и нажми Q / E для вращения влево / вправо или кнопку ↶ / ↷ на телефоне. Нужны ' + rollRules + '. Удерживай газ, чтобы не терять скорость. Одно нажатие — один полный оборот; для следующего отпусти кнопку. Если отпустить полёт во время кувырка, машина сначала выровняется, затем начнёт посадку.</li><li><strong>Смени ракурс.</strong> Нажми C или кнопку с камерой вверху экрана, чтобы переключиться между внешним видом и видом из кабины от первого лица. На телефоне используй ту же кнопку. Выбор сохраняется на этом устройстве; на паузе его можно изменить кнопкой «Вид из кабины». В кабине удерживай Z / X или кнопки «Взгляд» внизу экрана, чтобы посмотреть в левое / правое зеркало. Отпусти — взгляд вернётся вперёд; руль и газ не меняются. Во время бокового кувырка камера временно переходит на внешний вид для комфорта и возвращается в кабину после выравнивания машины.</li><li><strong>Рискуй с умом.</strong> Близкий обгон даёт множитель до ×5. Следующий обгон за 5 секунд продлевает серию.</li><li><strong>Доберись до 1 500 м.</strong> За цель получишь 1 000 очков. Дальше — только твой рекорд.</li></ol><p class="dialog-note">Esc / P — пауза. Рекорды спокойного потока и часа пик сохраняются отдельно по автомобилю и классу «заводской / настроенный / продолжение».</p><p class="dialog-note">Родстер и режим полёта — игровая стилизация, а не симулятор реального автомобиля. Восемь моделей трафика созданы для проекта в Blender. Прежняя Ferrari 458 Italia сохранена в исходниках, но в игре не используется: <a href="https://sketchfab.com/models/57bf6cc56931426e87494f554df1dab6" target="_blank" rel="noopener">vicent091036</a>, CC BY 4.0. Материалы и деревья — Poly Haven, CC0. <a href="./public/assets/CREDITS.txt" target="_blank" rel="noopener">Источники и лицензии</a>.</p><button class="button primary" data-action="closeHelp">Всё понятно ' + arrow + '</button>');
  }
  /**
   * Build the end-of-run summary and expose at most the allowed revive action.
   * @param {Object} s - Completed run snapshot; elapsed is seconds and distance is metres.
   * @param {Object} options - Record/best-score display and rewarded-ad capability.
   */
  results(s, { record = false, best = 0, adAvailable = false } = {}) {
    const canRevive = s.revives < CONFIG.maxRevives;
    const time = Math.floor(s.elapsed / 60) + ':' + String(Math.floor(s.elapsed % 60)).padStart(2, '0');
    this.open('results', '<div class="eyebrow">' + (record ? 'НОВЫЙ РЕКОРД' : 'ЗАЕЗД ЗАВЕРШЁН') + '</div><h2 id="dialogTitle">' + (s.goalReached ? 'Цель выполнена' : 'Столкновение') + '</h2><span class="result-score">' + formatNumber(s.score) + '</span><p class="dialog-note">очков · лучший результат ' + formatNumber(best) + '</p><div class="result-stats"><div>Дистанция<strong>' + formatNumber(s.distance) + ' м</strong></div><div>Время<strong>' + time + '</strong></div><div>Близкие обгоны<strong>' + s.nearMisses + '</strong></div><div>Собрано зарядов<strong>' + s.charges + '</strong></div><div>Обгоны<strong>' + s.overtakes + '</strong></div><div>События<strong>' + s.eventsCompleted + '</strong></div></div><button class="button primary" data-action="retry">Новый заезд ' + arrow + '</button>' + (canRevive ? '<button class="button secondary" data-action="revive">' + (adAvailable ? 'Второй шанс · за рекламу' : 'Второй шанс · бесплатно') + '</button>' : '') + '<button class="button secondary" data-action="menu">В главное меню</button><p id="adStatus" class="dialog-note" role="status">' + (canRevive ? 'Одно продолжение на заезд. После него — 2,5 секунды защиты.' : 'Второй шанс использован.') + '</p>');
  }
  /**
   * Disable dialog actions during an outstanding ad request and expose aria-busy feedback.
   * @param {boolean} value - Whether an asynchronous modal action is pending.
   */
  busy(value) {
    this.dialog.setAttribute('aria-busy', String(value));
    this.dialog.querySelectorAll('button').forEach(button => { button.disabled = value; });
    const status = byId('adStatus');
    if (status && value) status.textContent = 'Открываем рекламу…';
  }
  /**
   * Replace the general notification and restart its 3.5-second visibility timer.
   * @param {string} message - Plain text assigned via textContent.
   */
  notice(message) {
    const el = byId('notification');
    clearTimeout(this.noticeTimer);
    el.textContent = message; el.classList.add('visible');
    this.noticeTimer = setTimeout(() => el.classList.remove('visible'), 3500);
  }
  /**
   * Replace the short scoring/event toast and restart its 1.8-second visibility timer.
   * @param {string} message - Plain text assigned via textContent.
   */
  toast(message) {
    const el = byId('toast');
    clearTimeout(this.toastTimer);
    el.textContent = message; el.classList.add('visible');
    this.toastTimer = setTimeout(() => el.classList.remove('visible'), 1800);
  }
}

/**
 * Decide whether a key event is an intentional camera shortcut rather than text entry or a modal action.
 * Keeping this separate from DrivingInput prevents changing held pedals, steering or flight controls.
 * @param {KeyboardEvent|Object} event - Browser keyboard event; KeyC uses the physical key in any layout.
 * @param {string} screen - Current application screen.
 * @param {boolean} modalOpen - Whether the focus-trapping dialog is currently open.
 * @returns {boolean} True once per C press without command modifiers, a modal or an editable target.
 */
export function cameraShortcutAllowed(event, screen, modalOpen) {
  return event.code === 'KeyC' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey
    && ['playing', 'paused'].includes(screen) && !modalOpen
    && !event.target?.isContentEditable
    && !event.target?.closest?.('input, textarea, select, [role="textbox"]');
}

/**
 * Accept only deliberate physical Z/X presses outside text entry, menus and dialogs.
 * @param {KeyboardEvent|Object} event - Candidate physical-key press.
 * @param {string} screen - Current application screen.
 * @param {boolean} modalOpen - Whether a focus-trapping dialog is open.
 * @returns {boolean} Whether this fresh key press may begin a held glance.
 */
export function glanceShortcutAllowed(event, screen, modalOpen) {
  return ['KeyZ', 'KeyX'].includes(event.code) && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey
    && screen === 'playing' && !modalOpen
    && !event.target?.isContentEditable
    && !event.target?.closest?.('input, textarea, select, [role="textbox"]');
}

/** Independent camera-only holds; no access to driving input or simulation state. */
export class CockpitGlanceControls {
  /** @param {Function} onChange - Receives -1 (left), 0 (forward) or 1 (right). */
  constructor(onChange) {
    this.onChange = onChange;
    this.sources = new Map();
    this.enabled = false;
    this.direction = 0;
  }
  /** @param {boolean} enabled - Disabling discards holds, so resuming never revives an old glance. */
  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.clear();
  }
  /**
   * Add or release exactly one keyboard/pointer source. Opposing holds cancel, not overwrite.
   * @param {number} direction - Requested side, -1 or 1.
   * @param {string} source - Unique key, button-key or pointer identity.
   * @param {boolean} held - True to hold; false to release regardless of current eligibility.
   */
  set(direction, source, held) {
    if (held && this.enabled && (direction === -1 || direction === 1)) this.sources.set(source, direction);
    else this.sources.delete(source);
    this.update();
  }
  /** @param {string} source - Release only this source, even after a mode or focus change. */
  release(source) { this.sources.delete(source); this.update(); }
  /** Recenter and forget all holds at blur, pause, menu, crash, camera or roll boundaries. */
  clear() { this.sources.clear(); this.update(); }
  /** Notify the renderer only when the independently held left/right result changes. */
  update() {
    const values = [...this.sources.values()];
    const direction = Number(values.includes(1)) - Number(values.includes(-1));
    if (direction === this.direction) return;
    this.direction = direction;
    this.onChange(direction);
  }
}

// Keep rapidly changing altitude out of the live region; announce only mode changes.
/**
 * Derive localized flight text and a stable accessibility mode from a run snapshot.
 * Mode priority is roll, powered landing, flight, residual descent, cooldown, energy, ready, then ground.
 * @param {Object} s - Flight state; altitude is metres, cooldown is seconds and energy is percent.
 * @returns {Object} mode, value, hint and announcement strings without changing the state.
 */
export function flightPresentation(s) {
  const altitude = Math.max(0, Number(s.altitude) || 0);
  const cooldown = Math.max(0, Number(s.flightCooldown) || 0);
  if (s.rolling) return { mode: 'rolling', value: altitude.toFixed(1).replace('.', ',') + ' М', hint: s.throttle === 0 ? 'Кувырок · держи газ для скорости' : 'Полный оборот и выравнивание', announcement: 'Выполняется боковой кувырок' };
  if (s.landing) return { mode: 'landing', value: altitude.toFixed(1).replace('.', ',') + ' М', hint: 'Посадка · тормозные сопла', announcement: 'Посадка' };
  if (s.flying) return { mode: 'flying', value: altitude.toFixed(1).replace('.', ',') + ' М', hint: s.throttle === 0 ? 'W / ГАЗ — сохраняй скорость' : 'Отпусти кнопку для посадки', announcement: 'Полёт включён' };
  if (altitude > .05) return { mode: 'landing', value: altitude.toFixed(1).replace('.', ',') + ' М', hint: 'Посадка · избегай трафика', announcement: 'Посадка' };
  if (cooldown > 0) return { mode: 'cooldown', value: Math.ceil(cooldown) + ' С', hint: 'Восстановление после посадки', announcement: 'Полёт восстанавливается' };
  if (s.nitro <= 0) return { mode: 'empty', value: 'НЕТ ЗАРЯДА', hint: 'Собирай энергию на дороге', announcement: 'Для полёта нужна энергия' };
  if (s.nitro < FLIGHT.landingReserveCost && altitude <= .05) return { mode: 'empty', value: 'МАЛО ЗАРЯДА', hint: 'Нужен заряд для взлёта и безопасной посадки', announcement: 'Для взлёта недостаточно энергии' };
  if (s.flightReady) return { mode: 'ready', value: 'ГОТОВ К ВЗЛЁТУ', hint: 'Удерживай F или ПОЛЁТ', announcement: 'Полёт готов. Удерживай F или кнопку Полёт' };
  return { mode: 'ground', value: 'НА ЗЕМЛЕ', hint: 'Разгонись до 44 км/ч', announcement: 'Для взлёта разгонись до 44 километров в час' };
}


/**
 * Derive localized roll progress/readiness independently from DOM updates.
 * Uses actual roll angle when finite, with normalized progress only as a fixture fallback.
 * @param {Object} s - Run state; angles are radians, cooldown seconds and energy percent.
 * @returns {Object} mode, value, hint and announcement strings for HUD and assistive output.
 */
export function rollPresentation(s) {
  const angle = Number.isFinite(s.rollAngle) ? clamp(Math.abs(s.rollAngle) * 180 / Math.PI, 0, 360) : clamp(Number(s.rollProgress) || 0, 0, 1) * 360;
  if (s.rolling) return { mode: 'rolling', value: Math.round(angle) + '° / 360°', hint: 'Выполняется полный оборот. Перед посадкой машина выровняется.', announcement: 'Боковой кувырок начат' };
  const cooldown = Math.max(0, Number(s.rollCooldown) || 0);
  if (cooldown > 0) return { mode: 'cooldown', value: Math.ceil(cooldown) + ' С', hint: 'Кувырок восстанавливается. Отпусти кнопку перед следующим нажатием.', announcement: 'Кувырок восстанавливается' };
  if (s.rollReady) return { mode: 'ready', value: 'ГОТОВ', hint: 'Нажми Q или E для бокового кувырка. Одно нажатие — один оборот.', announcement: 'Боковой кувырок готов. Нажми Q или E' };
  if (s.flying && s.nitro < FLIGHT.rollCost) return { mode: 'energy', value: 'НУЖНО ' + FLIGHT.rollCost + '%', hint: 'Для кувырка нужно минимум ' + FLIGHT.rollCost + '% энергии. Собирай заряды.', announcement: 'Для кувырка недостаточно энергии' };
  if (s.flying) return { mode: 'unavailable', value: 'ВЫСОТА ≥ ' + FLIGHT.rollMinAltitude.toFixed(1).replace('.', ',') + ' М', hint: 'Для кувырка набери минимум ' + FLIGHT.rollMinAltitude.toFixed(1).replace('.', ',') + ' метра высоты и удерживай полёт.', announcement: 'Для кувырка набери высоту' };
  return { mode: 'ground', value: 'НУЖЕН ПОЛЁТ', hint: 'Взлети и набери высоту для кувырка.', announcement: '' };
}
