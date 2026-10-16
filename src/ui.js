import { CONFIG, ROUTES } from './config.js';
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
    this.open('help', '<h2 id="dialogTitle">Управление</h2><ol class="help-list"><li><strong>Обходи трафик.</strong> Удерживай A / D или ← →: руль поворачивается постепенно, положение между полосами свободное. На телефоне удерживай кнопки руля; свайп даёт короткий поворот.</li><li><strong>Газ и тормоз.</strong> W / ↑ — разгон, S / ↓ — торможение. Без газа машина катится и замедляется; в начале заезда она стоит. На телефоне удерживай педали справа.</li><li><strong>События на дороге.</strong> Обходи ограждения дорожных работ, проходи контрольные точки между флагами и реагируй на тормозящую колонну. Успех даёт очки и нитро.</li><li><strong>Собирай заряды.</strong> Золотистый баллон даёт +22% нитро и 50 очков.</li><li><strong>Добавь скорости.</strong> Удерживай газ вместе с пробелом или кнопкой НИТРО. Заряд заканчивается — ускорение тоже.</li><li><strong>Рискуй с умом.</strong> Близкий обгон даёт множитель до ×5. Следующий обгон за 5 секунд продлевает серию.</li><li><strong>Доберись до 1 500 м.</strong> За цель получишь 1 000 очков. Дальше — только твой рекорд.</li></ol><p class="dialog-note">Esc / P — пауза. Рекорды режимов «Поток» и «Час пик» сохраняются отдельно на этом устройстве.</p><p class="dialog-note">Модель Ferrari 458 Italia — <a href="https://sketchfab.com/models/57bf6cc56931426e87494f554df1dab6" target="_blank" rel="noopener">vicent091036</a>, CC BY 4.0. Материалы и деревья — Poly Haven, CC0. <a href="./public/assets/CREDITS.txt" target="_blank" rel="noopener">Источники и лицензии</a>.</p><button class="button primary" data-action="closeHelp">Всё понятно ' + arrow + '</button>');
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
