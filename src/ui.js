import { CONFIG, ROUTES } from './config.js';
import { FLIGHT } from './flight.js';
import { formatNumber, clamp } from './util.js';
const byId = id => document.getElementById(id);
const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>';
export class UI {
  constructor(onAction) {
    this.onAction = onAction;
    this.app = byId('app');
    this.overlay = byId('overlay');
    this.dialog = byId('dialog');
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
      const items = [...this.dialog.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')];
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === this.dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }
  setScreen(screen) {
    this.app.dataset.screen = screen;
    byId('menu').hidden = screen !== 'menu';
    byId('hud').hidden = screen === 'menu';
    byId('pauseBtn').hidden = !['playing', 'paused'].includes(screen);
    byId('helpBtn').hidden = screen === 'results';
  }
  menu(settings) {
    for (const button of document.querySelectorAll('[data-route]')) button.setAttribute('aria-pressed', String(button.dataset.route === settings.route));
    for (const button of document.querySelectorAll('[data-difficulty]')) button.setAttribute('aria-pressed', String(button.dataset.difficulty === settings.difficulty));
    byId('menuBest').textContent = formatNumber(settings.best[settings.difficulty]);
    const route = ROUTES[settings.route];
    byId('routeLabel').textContent = route.name.toUpperCase();
    this.sound(settings.sound);
  }
  sound(enabled) {
    byId('soundBtn').setAttribute('aria-pressed', String(enabled));
    byId('soundBtn').setAttribute('aria-label', enabled ? 'Выключить звук' : 'Включить звук');
    byId('soundBtn').innerHTML = enabled
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m11 5-6 5H2v4h3l6 5V5Zm5 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m11 5-6 5H2v4h3l6 5V5Zm5 4 5 6m0-6-5 6"/></svg>';
  }
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
  open(type, html) {
    if (this.overlay.hidden) this.returnFocus = document.activeElement;
    this.modalType = type;
    this.dialog.innerHTML = html;
    this.overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    for (const el of [document.querySelector('.topbar'), byId('menu'), byId('hud')]) el.inert = true;
    this.dialog.scrollTop = 0;
    (this.dialog.querySelector('button:not(:disabled)') || this.dialog).focus({ preventScroll: true });
  }
  close() {
    if (this.dialog.contains(document.activeElement)) document.activeElement.blur();
    this.overlay.hidden = true;
    document.body.style.overflow = '';
    this.modalType = null;
    for (const el of [document.querySelector('.topbar'), byId('menu'), byId('hud')]) el.inert = false;
    if (this.returnFocus?.isConnected && !this.returnFocus.closest('[hidden]')) this.returnFocus.focus({ preventScroll: true });
  }
  pause() {
    this.open('pause', '<h2 id="dialogTitle">Пауза</h2><p>Заезд остановлен.</p><button class="button primary" data-action="resume">Продолжить заезд ' + arrow + '</button><button class="button secondary" data-action="menu">В главное меню</button><p class="dialog-note">Esc — продолжить</p>');
  }
  help() {
    const rollRules = FLIGHT.rollMinAltitude.toFixed(1).replace('.', ',') + ' м высоты и ' + FLIGHT.rollCost + '% энергии';
    this.open('help', '<h2 id="dialogTitle">Управление</h2><ol class="help-list"><li><strong>Обходи трафик.</strong> Удерживай A / D или ← →: руль поворачивается постепенно, положение между полосами свободное. На телефоне удерживай кнопки руля; свайп даёт короткий поворот.</li><li><strong>Газ и тормоз.</strong> W / ↑ — разгон, S / ↓ — торможение. Без газа машина катится и замедляется; в начале заезда она стоит. На телефоне удерживай педали справа.</li><li><strong>События на дороге.</strong> Обходи ограждения дорожных работ, проходи контрольные точки между флагами и реагируй на тормозящую колонну. Успех даёт очки и нитро.</li><li><strong>Собирай заряды.</strong> Золотистый баллон даёт +22% нитро и 50 очков.</li><li><strong>Добавь скорости.</strong> Удерживай газ вместе с пробелом или кнопкой НИТРО. Заряд заканчивается — ускорение тоже.</li><li><strong>Поднимись над дорогой.</strong> Разгонись минимум до 44 км/ч и удерживай F или кнопку ПОЛЁТ. Родстер плавно поднимется над трафиком. Полёт и нитро расходуют один запас энергии; нитро в воздухе не действует. Отпусти кнопку для посадки. При взлёте часть заряда резервируется для мягкой посадки на тормозных соплах. После касания земли — 2 секунды перезарядки. При взлёте и посадке по-прежнему избегай машин.</li><li><strong>Сделай боковой кувырок.</strong> В полёте дождись надписи «ГОТОВ» и нажми Q / E для вращения влево / вправо или кнопку ↶ / ↷ на телефоне. Нужны ' + rollRules + '. Удерживай газ, чтобы не терять скорость. Одно нажатие — один полный оборот; для следующего отпусти кнопку. Если отпустить полёт во время кувырка, машина сначала выровняется, затем начнёт посадку.</li><li><strong>Рискуй с умом.</strong> Близкий обгон даёт множитель до ×5. Следующий обгон за 5 секунд продлевает серию.</li><li><strong>Доберись до 1 500 м.</strong> За цель получишь 1 000 очков. Дальше — только твой рекорд.</li></ol><p class="dialog-note">Esc / P — пауза. Рекорды режимов «Поток» и «Час пик» сохраняются отдельно на этом устройстве.</p><p class="dialog-note">Родстер и режим полёта — игровая стилизация, а не симулятор реального автомобиля. Исходная модель трафика Ferrari 458 Italia — <a href="https://sketchfab.com/models/57bf6cc56931426e87494f554df1dab6" target="_blank" rel="noopener">vicent091036</a>, CC BY 4.0. Материалы и деревья — Poly Haven, CC0. <a href="./public/assets/CREDITS.txt" target="_blank" rel="noopener">Источники и лицензии</a>.</p><button class="button primary" data-action="closeHelp">Всё понятно ' + arrow + '</button>');
  }
  results(s, { record = false, best = 0, adAvailable = false } = {}) {
    const canRevive = s.revives < CONFIG.maxRevives;
    const time = Math.floor(s.elapsed / 60) + ':' + String(Math.floor(s.elapsed % 60)).padStart(2, '0');
    this.open('results', '<div class="eyebrow">' + (record ? 'НОВЫЙ РЕКОРД' : 'ЗАЕЗД ЗАВЕРШЁН') + '</div><h2 id="dialogTitle">' + (s.goalReached ? 'Цель выполнена' : 'Столкновение') + '</h2><span class="result-score">' + formatNumber(s.score) + '</span><p class="dialog-note">очков · лучший результат ' + formatNumber(best) + '</p><div class="result-stats"><div>Дистанция<strong>' + formatNumber(s.distance) + ' м</strong></div><div>Время<strong>' + time + '</strong></div><div>Близкие обгоны<strong>' + s.nearMisses + '</strong></div><div>Собрано зарядов<strong>' + s.charges + '</strong></div><div>Обгоны<strong>' + s.overtakes + '</strong></div><div>События<strong>' + s.eventsCompleted + '</strong></div></div><button class="button primary" data-action="retry">Новый заезд ' + arrow + '</button>' + (canRevive ? '<button class="button secondary" data-action="revive">' + (adAvailable ? 'Второй шанс · за рекламу' : 'Второй шанс · бесплатно') + '</button>' : '') + '<button class="button secondary" data-action="menu">В главное меню</button><p id="adStatus" class="dialog-note" role="status">' + (canRevive ? 'Одно продолжение на заезд. После него — 2,5 секунды защиты.' : 'Второй шанс использован.') + '</p>');
  }
  busy(value) {
    this.dialog.setAttribute('aria-busy', String(value));
    this.dialog.querySelectorAll('button').forEach(button => { button.disabled = value; });
    const status = byId('adStatus');
    if (status && value) status.textContent = 'Открываем рекламу…';
  }
  notice(message) {
    const el = byId('notification');
    clearTimeout(this.noticeTimer);
    el.textContent = message; el.classList.add('visible');
    this.noticeTimer = setTimeout(() => el.classList.remove('visible'), 3500);
  }
  toast(message) {
    const el = byId('toast');
    clearTimeout(this.toastTimer);
    el.textContent = message; el.classList.add('visible');
    this.toastTimer = setTimeout(() => el.classList.remove('visible'), 1800);
  }
}

// Keep rapidly changing altitude out of the live region; announce only mode changes.
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
