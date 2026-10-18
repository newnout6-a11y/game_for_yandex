/**
 * Roadster garage presenter. It never awards currency, buys products, persists
 * data, calls a platform SDK or changes driving physics. The controller owns
 * those decisions and supplies a fresh view after every dispatched action.
 *
 * Public API: new GarageUI({root, onAction}); render(view); setVisible(boolean);
 * setBusy(boolean, message); notice(text); dispose(). createGarageUI is an alias.
 * A view is {screen, tab, profile, catalog, selectedVehicle, balances, garage,
 * platform, settings, loading, runResult, inspection, otherGames}. otherGames contains only
 * verified SDK metadata [{appID, title}]; the presenter never reads target URLs.
 */
import { PROFILE_VERSION, LIMITS, sanitizeProfile } from './progression.js';

export const GARAGE_TABS = Object.freeze([
  { id: 'fleet', number: '01', name: 'Автопарк', caption: 'Выбери свою линию', icon: 'car' },
  { id: 'style', number: '02', name: 'Ателье', caption: 'Характер в деталях', icon: 'style' },
  { id: 'engineering', number: '03', name: 'Инженерия', caption: 'Точность под нагрузкой', icon: 'engine' },
  { id: 'contracts', number: '04', name: 'Контракты', caption: 'Маршрут к следующей цели', icon: 'contract' },
  { id: 'season', number: '05', name: 'Сезон', caption: 'Опыт становится наградой', icon: 'season' },
]);
const DEFAULT_VEHICLES = [
  { id: 'rocket', name: 'Аэро Родстер', label: 'Родстер', role: 'ДОРОГА / НЕБО', price: 0, owned: true, description: 'Твоя отправная точка. Лёгкий кузов, реактивная тяга и дорога без верхней границы.' },
  { id: 'hatch', name: 'Хэтчбек', role: 'ГОРОД / МАНЁВР', description: 'Компактная линия для плотного трафика.' },
  { id: 'sedan', name: 'Седан', role: 'БАЛАНС / ДАЛЬНОСТЬ', description: 'Ровный характер для длинных маршрутов.' },
  { id: 'suv', name: 'Внедорожник', role: 'ОПОРА / КОНТРОЛЬ', description: 'Уверенная посадка и собранный силуэт.' },
  { id: 'van', name: 'Фургон', role: 'ОБЪЁМ / ХАРАКТЕР', description: 'Неожиданный выбор. Узнаваемый результат.' },
];
const DEFAULT_TIERS = [
  { level: 1, name: 'Стартовый бокс', displayCarSlots: 1, cosmeticPresetSlots: 1 },
  { level: 2, name: 'Мастерская', displayCarSlots: 2, cosmeticPresetSlots: 3 },
  { level: 3, name: 'Аэролаборатория', displayCarSlots: 3, cosmeticPresetSlots: 6 },
  { level: 4, name: 'Флагманский ангар', displayCarSlots: 3, cosmeticPresetSlots: 10 },
];
const SVG_NS = 'http://www.w3.org/2000/svg';
const ASSET_BASE = new URL('../public/brand/', import.meta.url).href;
const INSPECTION_VIEWS = Object.freeze([
  { id: 'overview', name: 'Общий', description: 'Общий вид автомобиля' },
  { id: 'rear', name: 'Сзади', description: 'Вид сзади: кузов и детали' },
  { id: 'wheels', name: 'Диски', description: 'Осмотр дисков крупным планом' },
  { id: 'cockpit', name: 'Салон', description: 'Осмотр салона и кокпита' },
]);
const canInspect = (view, vehicleId) => INSPECTION_VIEWS.some(item => item.id === view) && (view !== 'cockpit' || vehicleId === 'rocket');
const ACTIONS = new Set(['navigate', 'startDrive', 'selectVehicle', 'purchaseVehicle', 'buyCosmetic', 'equipCosmetic', 'resetCosmetic', 'upgradeEngineering', 'equipEngineering', 'equipBadge', 'savePreset', 'applyPreset', 'upgradeGarage', 'acceptContract', 'claimContract', 'claimSeason', 'settings', 'cloudConnect', 'retryCloud', 'rewardedBonus', 'revive', 'resolveCloudConflict', 'purchaseProduct', 'retryLoad', 'openOtherGame']);
/** Clamp untrusted display values without making economy decisions. */
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : fallback;
/** Text display is local, deterministic and never interpreted as HTML. */
const label = (value, fallback = '') => typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
/** Accept keyed catalogs and arrays without mutating either. */
const items = value => Array.isArray(value) ? value.filter(Boolean) : value && typeof value === 'object' ? Object.entries(value).map(([id, item]) => typeof item === 'object' && item !== null ? { id, ...item } : { id, name: label(item, id) }) : [];
/** Number formatting is exported for lightweight non-DOM regression tests. */
export function garageNumber(value) { return Math.floor(number(value)).toLocaleString('ru-RU'); }
/** Price must exist in the authoritative catalog to display a purchase button. */
export function garagePrice(value) {
  if (value == null) return null;
  const raw = typeof value === 'object' ? value.credits ?? value.amount ?? value.value : value;
  return Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Number(raw) : null;
}
/** Own-key checks prevent prototype names becoming owned catalog entries. */
const owns = (collection, id) => Array.isArray(collection) ? collection.some(value => value === id || value?.id === id) : !!collection && Object.hasOwn(collection, id) && collection[id] !== false;
/** Display summaries alone cannot authorize a whole-profile replacement. */
function conflictSnapshot(conflict, choice) {
  const raw = Object.hasOwn(conflict, choice) ? conflict[choice] : conflict[`${choice}Profile`];
  const profile = raw?.profile ?? raw;
  let valid = false;
  try {
    valid = profile?.schemaVersion === PROFILE_VERSION && Number.isSafeInteger(profile.revision) && profile.revision >= 0 &&
      Number.isSafeInteger(profile.wallet?.credits) && profile.wallet.credits >= 0 && profile.wallet.credits <= LIMITS.credits &&
      new TextEncoder().encode(JSON.stringify(profile)).byteLength <= LIMITS.profileBytes && !!sanitizeProfile(profile);
  } catch { /* A malformed display snapshot is never an actionable save. */ }
  return { raw, profile, valid };
}
/** Normalize common controller shapes into one read-only presenter snapshot. */
export function normalizeGarageView(input = {}) {
  const profile = input.profile || {};
  const catalog = input.catalog || {};
  const rawVehicles = items(input.vehicles || input.fleet || catalog.vehicles || catalog.fleet);
  const vehicles = (rawVehicles.length ? rawVehicles : DEFAULT_VEHICLES).map(raw => ({
    ...raw, id: label(raw.id || raw.kind), name: label(raw.name || raw.nameRu || raw.label, 'Автомобиль'),
    description: label(raw.description || raw.descriptionRu || raw.roleRu), role: label(raw.role || (raw.flight ? 'ДОРОГА / НЕБО' : 'НАЗЕМНЫЙ КЛАСС')),
    stats: raw.stats || (raw.maxSpeedMps != null ? { topSpeed: Math.round(raw.maxSpeedMps * 3.6), acceleration: raw.accelerationMps2, accelerationUnit: 'м/с²' } : {}),
    price: garagePrice(raw.price ?? raw.cost),
    owned: raw.owned === true || owns(profile.ownedVehicles || profile.vehicles || profile.fleet, raw.id) || raw.id === 'rocket',
  }));
  const requested = typeof input.selectedVehicle === 'object' ? input.selectedVehicle?.id : input.selectedVehicle;
  const selectedId = requested || profile.selectedVehicleId || profile.selectedVehicle || profile.selectedCar || profile.vehicleId || 'rocket';
  const selected = { ...(vehicles.find(item => item.id === selectedId) || vehicles[0] || DEFAULT_VEHICLES[0]), ...(typeof input.selectedVehicle === 'object' ? input.selectedVehicle : {}) };
  const garage = input.garage || profile.garage || {};
  const level = Math.min(4, Math.max(1, Math.floor(number(garage.level ?? profile.garageLevel ?? profile.garageTier, 1))));
  const rawTiers = items(garage.tiers || input.garageLevels || catalog.garageTiers || catalog.garageLevels || catalog.garages);
  const tiers = DEFAULT_TIERS.map((tier, index) => {
    const raw = rawTiers[index] || {};
    const displayCarSlots = number(raw.displayCarSlots ?? tier.displayCarSlots, tier.displayCarSlots);
    const cosmeticPresetSlots = number(raw.cosmeticPresetSlots ?? tier.cosmeticPresetSlots, tier.cosmeticPresetSlots);
    return { ...tier, ...raw, displayCarSlots, cosmeticPresetSlots, name: raw.name || raw.nameRu || tier.name, price: garagePrice(raw.price ?? raw.incrementalPrice), detail: raw.detail || `Мест для машин: ${displayCarSlots} · Пресетов: ${cosmeticPresetSlots}` };
  });
  const seenGames = new Set();
  const otherGames = (Array.isArray(input.otherGames) ? input.otherGames : []).flatMap(game => {
    const appID = typeof game?.appID === 'string' ? game.appID.trim() : Number.isSafeInteger(game?.appID) && game.appID > 0 ? String(game.appID) : '';
    const title = typeof game?.title === 'string' ? game.title.trim() : '';
    if (!appID || !title || seenGames.has(appID)) return [];
    seenGames.add(appID); return [{ appID, title }];
  });
  const rawPlatform = input.platform || {};
  return {
    ...input, profile, catalog, vehicles, selected, otherGames, garage: { ...garage, level, tiers, nextPrice: garage.nextPrice ?? tiers[level]?.price },
    screen: ['loading', 'hub', 'garage', 'results'].includes(input.screen) ? input.screen : 'hub',
    tab: GARAGE_TABS.some(tab => tab.id === input.tab) ? input.tab : 'fleet',
    inspection: canInspect(input.inspection, selected.id) ? input.inspection : 'overview',
    balances: { credits: number(input.balances?.credits ?? input.balance ?? profile.credits ?? profile.wallet?.credits) },
    platform: { ...rawPlatform, sdk: rawPlatform.sdk === true || rawPlatform.available === true, cloud: rawPlatform.cloud === true || rawPlatform.cloudAvailable === true, rewarded: rawPlatform.rewarded === true || rawPlatform.rewardedAvailable === true, payments: rawPlatform.payments === true || rawPlatform.paymentsAvailable === true },
    cloud: input.cloud || { status: rawPlatform.cloudStatus },
    local: input.local || rawPlatform.local || {},
    settings: { ...(input.settings || profile.settings || {}), runMode: input.settings?.runMode || profile.mode || 'standard' },
    season: { ...(catalog.season || {}), ...(input.season || {}), ...(input.seasonRewards ? { tiers: input.seasonRewards } : {}) },
  };
}
/** Describe authoritative target metrics without altering completion rules. */
function contractDescription(item) {
  const goals = { maxRunDistanceM: 'Проедь за один заезд', distanceM: 'Пройди суммарно', maxCleanGroundSegmentM: 'Пройди чистый наземный отрезок', roadEventsCompleted: 'Заверши дорожные события', precisionLandings: 'Выполни точные посадки', airborneOvertakes: 'Обгони автомобили в воздухе', engineeringPurchases: 'Открой инженерное исследование', ownedCarCount: 'Собери автомобили в гараже' };
  return `${goals[item.metric] || 'Выполни цель'}: ${garageNumber(item.target)}${item.metric?.endsWith('M') ? ' м' : ''}.${item.kind === 'repeatable' ? ' Повторяемый контракт.' : ''}`;
}
/** Create a text-only DOM node. */
function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = label(text);
  return node;
}
/** Draw a consistent original line-icon family without inserting markup. */
function icon(doc, name) {
  const paths = {
    arrow: 'M4 12h15m-6-6 6 6-6 6', back: 'M20 12H5m6-6-6 6 6 6', close: 'm6 6 12 12M18 6 6 18',
    car: 'M3 16v-5l3-5h12l3 5v5M3 11h18M5 16v3m14-3v3M6 14h2m8 0h2',
    style: 'm4 18 2-6L16 2l6 6-10 10-6 2-2-2Zm3-7 6 6m0-12 6 6M2 22h20',
    engine: 'M8 4h8M12 4v4M4 10h4l3-2h7v4h3v7H8l-4-4v-5ZM1 10v7',
    contract: 'M7 4H4v18h16V4h-3M8 2h8v5H8V2Zm0 10h8m-8 5h5',
    season: 'M8 3h8v9l-4 3-4-3V3ZM8 5H4v4l4 3m8-7h4v4l-4 3m-4 3v6m-5 0h10',
    telemetry: 'M3 3v18h19M6 15l4-5 4 3 6-8',
    settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
    cloud: 'M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5.5 5.5 0 0 1 0 11H6Zm6-8v9m-3-6 3-3 3 3',
    bolt: 'm14 2-9 12h6l-1 8 9-12h-6l1-8Z',
    play: 'm9 5 11 7-11 7V5Z',
    check: 'm5 12 4 4L20 5', lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5V10Zm7 4v3',
    garage: 'm2 9 10-7 10 7M4 8v14h16V8M8 22V11h8v11M8 15h8m-8 4h8',
  };
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS(SVG_NS, 'path'); path.setAttribute('d', paths[name] || paths.arrow); svg.append(path);
  return svg;
}
/** Small original workshop scenes. Decorative only: actions stay on the parent tab. */
function navigationScene(doc, name) {
  const wrapper = element(doc, 'span', `gs-nav-scene gs-scene-${name}`);
  wrapper.setAttribute('aria-hidden', 'true');
  const svg = doc.createElementNS(SVG_NS, 'svg'); svg.setAttribute('viewBox', '0 0 96 64');
  svg.setAttribute('focusable', 'false');
  const shape = (parent, tag, attrs = {}) => {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    parent.append(node); return node;
  };
  const path = (parent, d, cls = '') => shape(parent, 'path', { d, class: cls });
  shape(svg, 'ellipse', { cx: 49, cy: 53, rx: 37, ry: 5, class: 'gs-scene-shadow' });
  const car = (parent, cls = '') => {
    const group = shape(parent, 'g', { class: `gs-scene-car ${cls}` });
    path(group, 'M18 40 25 32 47 31 60 39 74 42 77 48H15L13 44Z', 'gs-scene-body');
    if (cls === 'gs-scene-custom-car') path(group, 'M18 40 25 32 47 31 60 39 74 42 77 48H15L13 44Z', 'gs-scene-paint-wipe');
    path(group, 'm29 34-5 6h31l-10-6Z', 'gs-scene-glass');
    path(group, 'M58 42h12M17 43h4', 'gs-scene-highlight');
    for (const cx of [27, 64]) {
      shape(group, 'circle', { cx, cy: 48, r: 7, class: 'gs-scene-tyre' });
      shape(group, 'circle', { cx, cy: 48, r: 3, class: 'gs-scene-hub' });
    }
    return group;
  };
  if (name === 'fleet') {
    path(svg, 'M9 45V15L32 5l29 10v30M10 16h50', 'gs-scene-structure');
    path(svg, 'M15 43V20h37v23', 'gs-scene-opening');
    path(svg, 'M16 21h35v18H16Z M16 26h35M16 31h35M16 36h35', 'gs-scene-door');
    car(svg);
  } else if (name === 'style') {
    car(svg, 'gs-scene-custom-car');
    const painter = shape(svg, 'g', { class: 'gs-scene-painter' });
    path(painter, 'M55 12h18v9H55Zm5-9h10v9H60Zm3 18h7v10h-7ZM50 15h5v4h-5Z', 'gs-scene-tool');
    path(painter, 'm48 20-14 9m16-6-8 8m12-7-4 7', 'gs-scene-spray');
  } else if (name === 'engineering') {
    shape(svg, 'circle', { cx: 34, cy: 35, r: 21, class: 'gs-scene-tyre' });
    const rotor = shape(svg, 'g', { class: 'gs-scene-rotor' });
    shape(rotor, 'circle', { cx: 34, cy: 35, r: 14, class: 'gs-scene-machined' });
    path(rotor, 'M34 23v24M22 35h24m-20-8 16 16m0-16-16 16', 'gs-scene-spokes');
    shape(rotor, 'circle', { cx: 34, cy: 35, r: 4, class: 'gs-scene-hub' });
    path(svg, 'M75 8 68 15 73 21 81 15C83 23 77 30 69 28L55 44a5 5 0 1 1-7-7l15-16C60 13 67 6 75 8Z', 'gs-scene-wrench');
  } else if (name === 'contracts') {
    path(svg, 'M14 47 29 24l20 12 22-24 13 12', 'gs-scene-route');
    for (const [cx, cy] of [[14,47],[29,24],[49,36],[71,12]]) shape(svg, 'circle', { cx, cy, r: 4, class: 'gs-scene-waypoint' });
    path(svg, 'M71 12V5l14 3-14 5', 'gs-scene-flag');
    shape(svg, 'circle', { cx: 29, cy: 24, r: 6, class: 'gs-scene-route-marker' });
    path(svg, 'm25 24 3 3 5-6', 'gs-scene-route-check');
  } else if (name === 'season') {
    path(svg, 'M15 52V42h19V32h27v10h19v10Z', 'gs-scene-podium');
    const prize = shape(svg, 'g', { class: 'gs-scene-prize' });
    path(prize, 'M39 8h18v12l-9 8-9-8Z M39 11H31v7l10 5m16-12h8v7l-10 5M48 28v7m-8 0h16', 'gs-scene-trophy');
    path(svg, 'm20 14 3-5m51 10 5-1M67 5l3 3', 'gs-scene-confetti');
  } else {
    path(svg, 'M13 44a35 35 0 0 1 70 0', 'gs-scene-gauge');
    path(svg, 'M20 40h5m1-17 4 4m18-17v6m23 7-4 4m8 13h-5', 'gs-scene-ticks');
    path(svg, 'M48 44 65 22', 'gs-scene-needle');
    shape(svg, 'circle', { cx: 48, cy: 44, r: 4, class: 'gs-scene-hub' });
    path(svg, 'M21 52h8m5 0h8m5 0h8m5 0h8', 'gs-scene-readout');
  }
  wrapper.append(svg); return wrapper;
}
/** Tactile samples use catalog colors only; no hover can mutate or buy a cosmetic. */
function cosmeticSample(doc, item, slot) {
  const kind = slot === 'body.tint' ? 'glass' : slot === 'cockpit.steering' ? 'steering' : slot.includes('wheel') || slot === 'rims' ? 'wheel' : slot.includes('finish') ? 'finish' : slot.includes('paint') || item.color ? 'paint' : 'detail';
  const sample = element(doc, 'span', `gs-material-sample gs-sample-${kind}`);
  sample.setAttribute('aria-hidden', 'true');
  if (kind === 'steering') sample.dataset.variant = /yoke|formula/i.test(item.variant || item.visual?.variant || item.visual?.geometry || item.id || '') ? 'yoke' : /sport|flat/i.test(item.variant || item.visual?.variant || item.visual?.geometry || item.id || '') ? 'sport' : 'round';
  if (kind === 'glass' && Number.isFinite(Number(item.opacity ?? item.visual?.opacity))) sample.style.setProperty('--gs-glass-opacity', Math.min(1, Math.max(.1, Number(item.opacity ?? item.visual?.opacity))));
  const sampleColor = item.color || item.tintColor || item.visual?.color;
  if (/^#[\da-f]{3,8}$/i.test(sampleColor || '')) sample.style.setProperty('--gs-sample-color', sampleColor);
  sample.append(element(doc, 'span', 'gs-sample-surface'));
  return sample;
}
/** Make a labeled stat with a stable unit. */
function stat(doc, name, value, unit = '') {
  const node = element(doc, 'div', 'gs-stat');
  node.append(element(doc, 'span', 'gs-stat-label', name));
  const result = element(doc, 'strong', 'gs-stat-value', value);
  if (unit) result.append(element(doc, 'small', '', unit));
  node.append(result); return node;
}
/** Pure UI controller. The owner is responsible for mounting outside legacy HUD. */
export class GarageUI {
  constructor({ root, onAction = () => {}, onMiniatures = () => {}, onMiniatureInteraction = () => {} } = {}) {
    if (!root?.ownerDocument) throw new TypeError('GarageUI requires a DOM root element.');
    this.root = root; this.doc = root.ownerDocument; this.onAction = onAction;
    this.onMiniatures = onMiniatures; this.onMiniatureInteraction = onMiniatureInteraction; this.miniatureHoverId = null; this.miniatureFocusId = null;
    this.visible = true; this.busy = false; this.settingsOpen = false; this.mobileOpen = false; this.atelierSection = 'body'; this.atelierBodySection = 'surface';
    this.view = normalizeGarageView(); this.noticeText = ''; this.disposed = false;
    root.classList.add('garage-shell'); root.setAttribute('aria-label', 'Roadster — гараж и меню');
    this.clickHandler = event => this.handleClick(event);
    this.changeHandler = event => this.handleChange(event);
    this.keyHandler = event => this.handleKey(event);
    root.addEventListener('click', this.clickHandler);
    root.addEventListener('change', this.changeHandler);
    root.addEventListener('keydown', this.keyHandler);
    this.miniatureHandlers = Object.fromEntries(['pointerover','pointerout','pointerdown','focusin','focusout'].map(type => [type, event => this.handleMiniatureInteraction(event)]));
    for (const [type, handler] of Object.entries(this.miniatureHandlers)) root.addEventListener(type, handler);
  }
  /** Reflect the latest authoritative snapshot while preserving keyboard focus. */
  render(input = {}) {
    if (this.disposed) return;
    const oldScreen = this.view.screen;
    const oldTab = this.view.tab;
    const scroll = this.root.querySelector('.gs-workbench')?.scrollTop;
    const hubScroll = this.root.querySelector('.gs-hub')?.scrollTop;
    const focus = this.doc.activeElement?.dataset?.gsFocus;
    this.view = normalizeGarageView(input);
    this.root.dataset.screen = this.view.screen; this.root.dataset.tab = this.view.tab;
    this.root.dataset.drawer = this.mobileOpen ? 'open' : 'closed';
    this.root.replaceChildren();
    const main = element(this.doc, 'div', 'gs-layout');
    if (this.view.screen === 'loading') main.append(this.renderLoading());
    else {
      main.append(this.renderHeader());
      if (this.view.loading?.error) main.append(this.renderLoadError());
      if (this.view.screen === 'hub') main.append(this.renderHub());
      if (this.view.screen === 'garage') main.append(this.renderGarage());
      if (this.view.screen === 'results') main.append(this.renderResults());
      main.append(this.renderFooter());
    }
    const live = element(this.doc, 'div', 'gs-notice', this.noticeText);
    live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true');
    live.hidden = !this.noticeText; main.append(live); this.root.append(main);
    const conflict = this.view.platform.conflict;
    main.inert = !!conflict || this.settingsOpen;
    if (conflict) this.root.append(this.renderCloudConflict(conflict));
    else if (this.settingsOpen) this.root.append(this.renderSettings());
    this.applyBusy();
    this.setVisible(this.visible);
    if (oldScreen === this.view.screen && oldTab === this.view.tab && Number.isFinite(scroll)) {
      const panel = this.root.querySelector('.gs-workbench'); if (panel) panel.scrollTop = scroll;
    }
    if (oldScreen === this.view.screen && Number.isFinite(hubScroll)) {
      const hub = this.root.querySelector('.gs-hub'); if (hub) hub.scrollTop = hubScroll;
    }
    if (conflict) {
      const dialog = this.root.querySelector('.gs-cloud-dialog');
      const buttons = Array.from(dialog.querySelectorAll('button:not(:disabled)'));
      (buttons.find(node => node.dataset.gsFocus === focus) || buttons[0] || dialog).focus({ preventScroll: true });
    }
    else if (focus) Array.from(this.root.querySelectorAll('[data-gs-focus]')).find(node => node.dataset.gsFocus === focus)?.focus({ preventScroll: true });
    else if (oldScreen !== this.view.screen && this.visible) this.root.querySelector('[data-gs-heading]')?.focus({ preventScroll: true });
    if (this.view.screen !== 'garage' || this.view.tab !== 'fleet') { this.miniatureHoverId = null; this.miniatureFocusId = null; this.onMiniatureInteraction(null); }
    this.onMiniatures(this.getFleetMiniatureTargets());
  }
  /** Hide the entire presentation during gameplay, including its keyboard targets. */
  setVisible(visible) {
    this.visible = !!visible; this.root.hidden = !this.visible;
    this.root.setAttribute('aria-hidden', String(!this.visible));
    this.root.inert = !this.visible;
    if (!this.visible) { this.miniatureHoverId = null; this.miniatureFocusId = null; this.onMiniatureInteraction(null); }
  }
  /** Disable mutations while the controller waits for a real asynchronous outcome. */
  setBusy(busy, message = 'Подождём подтверждения…') {
    this.busy = !!busy; this.busyMessage = label(message); this.applyBusy();
  }
  /** Announce a result supplied by the controller; never invent success. */
  notice(text) {
    this.noticeText = label(text);
    const node = this.root.querySelector('.gs-notice');
    if (node) { node.textContent = this.noticeText; node.hidden = !this.noticeText; }
  }
  /** Remove only this presenter's listeners and nodes. */
  dispose() {
    this.root.removeEventListener('click', this.clickHandler); this.root.removeEventListener('change', this.changeHandler); this.root.removeEventListener('keydown', this.keyHandler);
    for (const [type, handler] of Object.entries(this.miniatureHandlers)) this.root.removeEventListener(type, handler);
    this.onMiniatureInteraction(null); this.onMiniatures([]);
    this.root.replaceChildren(); this.root.classList.remove('garage-shell'); this.disposed = true;
  }
  /** Exact authored-model targets; unowned catalog entries always use their stock appearance. */
  getFleetMiniatureTargets() {
    if (this.view.screen !== 'garage' || this.view.tab !== 'fleet') return [];
    return Array.from(this.root.querySelectorAll('[data-fleet-model]')).map(canvas => {
      const id=canvas.dataset.fleetModel,car=this.view.vehicles.find(item=>item.id===id);
      return {id,canvas,appearance:car?.owned?{...(this.view.profile.loadouts?.[id]?.cosmetics||{})}:{}};
    });
  }
  /** Hover/focus drive only visual model rotation; touch selection remains a normal catalog action. */
  handleMiniatureInteraction(event) {
    if (!this.visible || this.busy || this.root.inert || this.settingsOpen || this.view.platform.conflict || this.view.loading?.adPending || this.view.screen !== 'garage' || this.view.tab !== 'fleet') return;
    const row=event.target.closest?.('[data-fleet-id]');if(!row||!this.root.contains(row))return;
    const id=row.dataset.fleetId;if(!this.view.vehicles.some(car=>car.id===id))return;
    if(event.type==='pointerdown'&&event.pointerType==='touch'){this.onMiniatureInteraction(id,'touch');return;}
    if(event.pointerType==='touch')return;
    if(event.relatedTarget&&row.contains(event.relatedTarget))return;
    if(event.type==='pointerover')this.miniatureHoverId=id;
    if(event.type==='pointerout'&&this.miniatureHoverId===id)this.miniatureHoverId=null;
    if(event.type==='focusin')this.miniatureFocusId=id;
    if(event.type==='focusout'&&this.miniatureFocusId===id)this.miniatureFocusId=null;
    this.onMiniatureInteraction(this.miniatureHoverId||this.miniatureFocusId||null,event.type.startsWith('focus')?'focus':'hover');
  }
  /** Create one controller action button with a safe serialized payload. */
  button(text, action, { primary = false, iconName, disabled = false, className = '', title } = {}) {
    const button = element(this.doc, 'button', `gs-button ${primary ? 'gs-primary' : 'gs-secondary'} ${className}`, text);
    button.type = 'button'; button.dataset.gsAction = JSON.stringify(action);
    button.dataset.gsFocus = [action.type, action.screen, action.tab, action.id, action.slot, action.branch, action.level, action.tier, action.track, action.key, action.choice, action.kind, action.view].filter(value => value != null).join(':');
    button.disabled = disabled; button.dataset.gsDisabled = String(disabled);
    if (title) button.title = title;
    if (iconName) button.append(icon(this.doc, iconName));
    return button;
  }
  /** Create an internal-only button that cannot escape into economy dispatch. */
  localButton(text, kind, iconName, className = '') { return this.button(text, { type: '_local', kind }, { iconName, className }); }
  /** Dispatch known actions only. SDK and wallet outcomes are never predicted. */
  handleClick(event) {
    const target = event.target.closest?.('[data-gs-action]');
    if (!target || !this.root.contains(target) || target.disabled) return;
    let action; try { action = JSON.parse(target.dataset.gsAction); } catch { return; }
    if(this.busy&&!(action.type==='retryLoad'&&this.view.loading?.adPending))return;
    if (action.type === 'inspectVehicle') {
      if (this.visible && !this.root.inert && !this.settingsOpen && !this.view.platform.conflict && !this.view.loading?.adPending && this.view.screen === 'garage' && canInspect(action.view, this.view.selected.id)) {
        this.notice(''); this.onAction({ type: 'inspectVehicle', view: action.view });
      }
      return;
    }
    if (action.type === '_local') {
      if (action.kind === 'openSettings') { this.settingsOpen = true; this.render(this.view); this.root.querySelector('.gs-settings-dialog button')?.focus(); }
      if (action.kind === 'closeSettings') { this.settingsOpen = false; this.render(this.view); this.root.querySelector('[data-gs-settings-open]')?.focus(); }
      if (action.kind === 'toggleDrawer') this.setDrawerOpen(!this.mobileOpen);
      if (['atelierCategory', 'atelierBodySection'].includes(action.kind)) {
        if (!this.visible || this.root.inert || this.settingsOpen || this.view.platform.conflict || this.view.loading?.adPending || this.view.screen !== 'garage' || this.view.tab !== 'style') return;
        if (action.kind === 'atelierCategory' && ['body', 'wheels', 'cockpit'].includes(action.id)) this.atelierSection = action.id;
        else if (action.kind === 'atelierBodySection' && ['surface', 'glass'].includes(action.id)) this.atelierBodySection = action.id;
        else return;
        const inspection = this.atelierSection === 'body' ? 'overview' : this.atelierSection;
        this.notice('');
        this.render(this.view);
        const workbench = this.root.querySelector('.gs-workbench'); if (workbench) workbench.scrollTop = 0;
        if (canInspect(inspection, this.view.selected.id)) this.onAction({ type: 'inspectVehicle', view: inspection });
      }
      return;
    }
    if (action.type === 'openOtherGame') {
      const game = this.view.otherGames.find(item => item.appID === action.id);
      if (game) { this.notice(''); this.onAction({ type: 'openOtherGame', id: game.appID }); }
      return;
    }
    if (ACTIONS.has(action.type)) { this.notice(''); this.onAction(action); }
  }
  /** Settings are controller actions too; no browser storage writes occur here. */
  handleChange(event) {
    const input = event.target.closest?.('[data-gs-setting]');
    if (!input || this.busy) return;
    this.onAction({ type: 'settings', key: input.dataset.gsSetting, value: input.type === 'checkbox' ? input.checked : input.value });
  }
  /** Notify the renderer when the mobile panel changes the visible stage area. */
  setDrawerOpen(open) {
    this.mobileOpen = !!open; this.root.dataset.drawer = this.mobileOpen ? 'open' : 'closed';
    this.root.querySelector('.gs-drawer-toggle')?.setAttribute('aria-expanded', String(this.mobileOpen));
    const CustomEventClass = this.doc.defaultView?.CustomEvent || globalThis.CustomEvent;
    if (CustomEventClass && this.root.dispatchEvent) this.root.dispatchEvent(new CustomEventClass('garage-layout-change', { bubbles: true, detail: { drawerOpen: this.mobileOpen } }));
  }
  /** Arrow-key tabs, Escape-to-hub and a focus-contained settings dialog. */
  handleKey(event) {
    if (!this.visible || this.busy) return;
    if (event.key === 'Escape') {
      if (this.view.platform.conflict) { event.preventDefault(); event.stopPropagation(); return; }
      if (this.settingsOpen) { this.settingsOpen = false; this.render(this.view); this.root.querySelector('[data-gs-settings-open]')?.focus(); }
      else if (this.mobileOpen) this.setDrawerOpen(false);
      else if (this.view.screen === 'garage') this.onAction({ type: 'navigate', screen: 'hub' });
      event.stopPropagation(); return;
    }
    const tab = event.target.closest?.('[role="tab"]');
    if (tab && ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const index = GARAGE_TABS.findIndex(item => item.id === tab.dataset.gsTab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? GARAGE_TABS.length - 1 : (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + GARAGE_TABS.length) % GARAGE_TABS.length;
      this.onAction({ type: 'navigate', screen: 'garage', tab: GARAGE_TABS[next].id });
      this.root.querySelector(`[data-gs-tab="${GARAGE_TABS[next].id}"]`)?.focus();
    }
    if (event.key === 'Tab' && (this.settingsOpen || this.view.platform.conflict)) {
      const nodes = Array.from(this.root.querySelectorAll('[role="dialog"] button:not(:disabled), [role="dialog"] select:not(:disabled), [role="dialog"] input:not(:disabled)'));
      const first = nodes[0], last = nodes.at(-1);
      if (!first) { event.preventDefault(); this.root.querySelector('[role="dialog"]')?.focus(); }
      if (event.shiftKey && this.doc.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && this.doc.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }
  /** Reflect in-flight state without losing pre-existing disabled reasons. */
  applyBusy() {
    this.root.setAttribute('aria-busy', String(this.busy));
    for (const node of this.root.querySelectorAll('button')) node.disabled = (this.busy&&!(this.view.loading?.adPending&&node.dataset.gsFocus==='retryLoad')) || node.dataset.gsDisabled === 'true';
    for (const node of this.root.querySelectorAll('select, input')) node.disabled = this.busy;
    let status = this.root.querySelector('.gs-busy');
    if (this.busy && !status) { status = element(this.doc, 'div', 'gs-busy'); status.setAttribute('role', 'status'); this.root.append(status); }
    if (status) { status.textContent = this.busyMessage || 'Подождём подтверждения…'; status.hidden = !this.busy; }
  }
  /** Original road-to-wing emblem and readable Cyrillic wordmark. */
  brand(compact = false) {
    const node = element(this.doc, 'div', `gs-brand${compact ? ' gs-brand-compact' : ''}`);
    node.setAttribute('aria-label', 'Roadster');
    const emblem = element(this.doc, 'img', 'gs-emblem'); emblem.src = `${ASSET_BASE}roadster-emblem.svg`; emblem.alt = ''; emblem.width = 46; emblem.height = 46;
    const name = element(this.doc, 'div', 'gs-brand-type');
    name.append(element(this.doc, 'strong', '', 'Roadster'), element(this.doc, 'span', '', 'ROAD / AIR / YOUR LINE'));
    node.append(emblem, name); return node;
  }
  /** Display only the badge the authoritative snapshot marks both owned and equipped. */
  renderEquippedBadge() {
    const badge = items(this.view.badges).find(item => item.owned === true && item.selected === true);
    if (!badge) return null;
    const name = label(badge.name || badge.nameRu || badge.id, 'Знак сезона');
    const node = element(this.doc, 'div', 'gs-equipped-badge');
    node.setAttribute('aria-label', `Выбранный знак сезона: ${name}`);
    node.append(icon(this.doc, 'season'), element(this.doc, 'span', '', name));
    node.title = `Выбранный знак сезона: ${name}`;
    return node;
  }
  /** Persistent chrome stays low profile so the 3D bay remains the hero. */
  renderHeader() {
    const head = element(this.doc, 'header', 'gs-header');
    if (this.view.screen !== 'hub') { const back = this.button('', { type: 'navigate', screen: 'hub' }, { iconName: 'back', className: 'gs-mobile-home gs-icon-button' }); back.setAttribute('aria-label', 'На главную'); head.append(back); }
    head.append(this.brand());
    const context = element(this.doc, 'div', 'gs-header-context');
    context.append(element(this.doc, 'span', 'gs-status-dot'), element(this.doc, 'span', '', this.view.screen === 'garage' ? 'ЛИЧНЫЙ ГАРАЖ' : this.view.screen === 'results' ? 'ЗАЕЗД ЗАВЕРШЁН' : 'ДОРОГА НАЧИНАЕТСЯ ЗДЕСЬ'));
    const badge = this.renderEquippedBadge(); if (badge) context.append(badge);
    head.append(context);
    const account = element(this.doc, 'div', 'gs-account');
    const balance = element(this.doc, 'div', 'gs-balance'); balance.setAttribute('aria-label', `Баланс: ${garageNumber(this.view.balances.credits)} кредитов`);
    balance.append(element(this.doc, 'span', 'gs-currency-mark', '₵'), element(this.doc, 'strong', '', garageNumber(this.view.balances.credits)));
    account.append(balance);
    const settings = this.localButton('', 'openSettings', 'settings', 'gs-icon-button'); settings.setAttribute('aria-label', 'Настройки'); settings.dataset.gsSettingsOpen = 'true'; settings.dataset.gsFocus = 'openSettings'; account.append(settings); head.append(account);
    return head;
  }
  /** A playable-first welcome: no account wall, no automatic advertisement. */
  renderHub() {
    const hub = element(this.doc, 'main', `gs-hub${this.view.otherGames.length ? ' gs-has-other-games' : ''}`);
    const introduction = element(this.doc, 'section', 'gs-hub-intro');
    introduction.append(element(this.doc, 'p', 'gs-kicker', 'НЕБО БЛИЖЕ, ЧЕМ КАЖЕТСЯ'));
    const title = element(this.doc, 'h1', 'gs-hub-title'); title.dataset.gsHeading = 'true'; title.tabIndex = -1;
    title.append(element(this.doc, 'span', '', 'ДЕРЖИ ТРАССУ.'), element(this.doc, 'span', 'gs-title-accent', 'ЗАБИРАЙ НЕБО.')); introduction.append(title);
    introduction.append(element(this.doc, 'p', 'gs-hub-copy', 'Твой родстер. Твоя мастерская. Свобода выбирать линию, даже когда дорога заканчивается.'));
    const actions = element(this.doc, 'div', 'gs-hub-actions');
    actions.append(this.button(number(this.view.profile.stats?.runs ?? this.view.profile.runs) ? 'Снова на трассу' : 'На трассу', { type: 'startDrive' }, { primary: true, iconName: 'arrow', className: 'gs-drive-button' }));
    actions.append(this.button('Войти в гараж', { type: 'navigate', screen: 'garage', tab: 'fleet' }, { iconName: 'garage' })); introduction.append(actions);
    introduction.append(element(this.doc, 'p', 'gs-small-note', 'Можно играть сразу. Вход в аккаунт необязателен.'));
    hub.append(introduction);
    const carLabel = element(this.doc, 'div', 'gs-hero-vehicle');
    carLabel.append(element(this.doc, 'span', 'gs-kicker', 'В ТВОЁМ БОКСЕ'), element(this.doc, 'strong', '', this.view.selected.name), element(this.doc, 'span', 'gs-small-note', this.view.selected.role || 'ДОРОГА / НЕБО')); hub.append(carLabel);
    const bottom = element(this.doc, 'section', 'gs-hub-dock');
    const workshop = element(this.doc, 'div', 'gs-dock-cell'); workshop.append(element(this.doc, 'span', 'gs-kicker', `БОКС ${String(this.view.garage.level).padStart(2, '0')} / 04`), element(this.doc, 'strong', '', this.view.garage.tiers[this.view.garage.level - 1]?.name || 'Личный гараж'), element(this.doc, 'span', 'gs-small-note', 'От первой машины до собственного ангара'));
    const badge = this.renderEquippedBadge(); if (badge) workshop.append(badge);
    const contract = this.button('Контракты', { type: 'navigate', screen: 'garage', tab: 'contracts' }, { iconName: 'arrow', className: 'gs-dock-link' }); contract.prepend(element(this.doc, 'span', 'gs-kicker', 'СЛЕДУЮЩАЯ ЦЕЛЬ'));
    const route = element(this.doc, 'div', 'gs-dock-cell gs-route-cell'); route.append(element(this.doc, 'span', 'gs-kicker', 'МАРШРУТ'), this.settingSelect('route', 'Маршрут', [['ring', 'Горное озеро'], ['neon', 'Хвойный перевал'], ['dawn', 'Прибрежное шоссе']], this.view.settings.route || 'ring'));
    bottom.append(workshop, contract, route);
    if (this.view.otherGames.length) bottom.append(this.renderOtherGames());
    hub.append(bottom); return hub;
  }
  /** Optional first-party SDK catalog, never placeholders or in-drive popups. */
  renderOtherGames() {
    const section = element(this.doc, 'section', 'gs-other-games'); section.setAttribute('aria-labelledby', 'gs-other-games-title');
    const heading = element(this.doc, 'h2', 'gs-kicker', 'ДРУГИЕ НАШИ ИГРЫ'); heading.id = 'gs-other-games-title';
    const list = element(this.doc, 'div', 'gs-other-games-list');
    for (const game of this.view.otherGames) {
      const button = this.button('', { type: 'openOtherGame', id: game.appID }, { iconName: 'arrow', className: 'gs-other-game' });
      const copy = element(this.doc, 'span', 'gs-product-copy');
      copy.append(element(this.doc, 'strong', '', game.title), element(this.doc, 'span', '', 'Открыть в Яндекс Играх'));
      button.prepend(copy); list.append(button);
    }
    section.append(heading, list); return section;
  }
  /** Five purposeful sections surround a clear center reserved for the rendered car. */
  renderGarage() {
    const garage = element(this.doc, 'main', 'gs-garage');
    const rail = element(this.doc, 'aside', 'gs-rail');
    rail.append(this.button('На главную', { type: 'navigate', screen: 'hub' }, { iconName: 'back', className: 'gs-back' }));
    const nav = element(this.doc, 'nav', 'gs-tabs'); nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', 'Разделы гаража');
    for (const tab of GARAGE_TABS) {
      const selected = this.view.tab === tab.id;
      const button = this.button('', { type: 'navigate', screen: 'garage', tab: tab.id }, { className: 'gs-tab' });
      button.id = `gs-tab-${tab.id}`; button.dataset.gsTab = tab.id;
      button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(selected)); button.setAttribute('aria-controls', 'gs-workbench'); button.tabIndex = selected ? 0 : -1;
      const copy = element(this.doc, 'span', 'gs-tab-copy');
      copy.append(element(this.doc, 'strong', 'gs-tab-name', tab.name));
      button.append(navigationScene(this.doc, tab.id), copy); nav.append(button);
    }
    rail.append(nav, this.renderTierCompact()); garage.append(rail);
    const stage = element(this.doc, 'section', 'gs-stage'); stage.setAttribute('aria-label', `Машина в боксе: ${this.view.selected.name}`);
    const title = element(this.doc, 'div', 'gs-stage-heading');
    const heading = element(this.doc, 'h1', 'gs-vehicle-title gs-car-type', this.view.selected.name); heading.tabIndex = -1; heading.dataset.gsHeading = 'true';
    // Keep the established camera-fit reservation, but expose only the lower-right heading.
    const reservation = element(this.doc, 'div', 'gs-car-type gs-title-reservation', this.view.selected.name); reservation.setAttribute('aria-hidden', 'true'); title.append(reservation);
    stage.append(title);
    const stageBottom = element(this.doc, 'div', 'gs-stage-bottom');
    const titleDock = element(this.doc, 'div', 'gs-vehicle-title-dock'); titleDock.append(heading);
    const stageActions = element(this.doc, 'div', 'gs-stage-actions');
    stageBottom.append(titleDock, stageActions);
    const inspection = element(this.doc, 'div', 'gs-inspection'); inspection.setAttribute('role', 'group'); inspection.setAttribute('aria-label', 'Осмотр автомобиля');
    for (const view of INSPECTION_VIEWS) {
      const available = canInspect(view.id, this.view.selected.id);
      const button = this.button(view.name, { type: 'inspectVehicle', view: view.id }, { className: 'gs-inspection-button', disabled: !available || !!this.view.loading?.adPending, title: available ? view.description : 'Салон доступен только у родстера' });
      button.setAttribute('aria-pressed', String(this.view.inspection === view.id));
      button.setAttribute('aria-label', available ? view.description : 'Салон: доступен только у родстера');
      inspection.append(button);
    }
    stageActions.append(inspection);
    const status = element(this.doc, 'div', 'gs-build-status'); status.append(element(this.doc, 'span', 'gs-status-dot'), element(this.doc, 'span', '', this.view.settings.runMode === 'tuned' ? 'Настроенный класс · отдельный рекорд' : 'Заводской класс · без улучшений'));
    stageActions.append(status);
    const drawer = this.localButton('', 'toggleDrawer', 'settings', 'gs-drawer-toggle'); drawer.setAttribute('aria-label', 'Параметры и каталог'); drawer.title = 'Параметры и каталог'; drawer.setAttribute('aria-expanded', String(this.mobileOpen)); drawer.setAttribute('aria-controls', 'gs-workbench'); stageBottom.append(drawer);
    stage.append(stageBottom); garage.append(stage);
    const panel = element(this.doc, 'section', 'gs-workbench'); panel.id = 'gs-workbench'; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `gs-tab-${this.view.tab}`); panel.tabIndex = 0; panel.dataset.gsFocus = 'workbench';
    const tab = GARAGE_TABS.find(item => item.id === this.view.tab);
    const panelHead = element(this.doc, 'div', 'gs-panel-heading'); panelHead.append(element(this.doc, 'h2', '', tab.name)); panel.append(panelHead);
    const renderer = { fleet: 'renderFleet', style: 'renderStyle', engineering: 'renderEngineering', contracts: 'renderContracts', season: 'renderSeason' }[this.view.tab];
    panel.append(this[renderer]());
    garage.append(panel); return garage;
  }
  /** A visible four-step upgrade path, not a hidden store destination. */
  renderTierCompact() {
    const node = element(this.doc, 'section', 'gs-tier-compact');
    const tiers = element(this.doc, 'div', 'gs-tier-track'); tiers.setAttribute('aria-label', `Уровень гаража ${this.view.garage.level} из 4`);
    for (let level = 1; level <= 4; level++) { const cell = element(this.doc, 'span', level <= this.view.garage.level ? 'gs-tier-reached' : '', String(level).padStart(2, '0')); cell.title = this.view.garage.tiers[level - 1].name; tiers.append(cell); }
    node.append(tiers, element(this.doc, 'strong', '', this.view.garage.tiers[this.view.garage.level - 1]?.name));
    const nextPrice = garagePrice(this.view.garage.nextPrice ?? this.view.garage.tiers[this.view.garage.level]?.price);
    if (this.view.garage.level < 4) node.append(this.button(nextPrice == null ? 'План развития' : `Расширить · ${garageNumber(nextPrice)} ₵`, { type: 'navigate', screen: 'garage', tab: 'engineering' }, { iconName: 'arrow', className: 'gs-tier-link' }));
    else node.append(element(this.doc, 'p', 'gs-small-note', 'Максимальный уровень пространства'));
    return node;
  }
  /** Catalog purchase and selection are separate explicit actions. */
  renderFleet() {
    const content = element(this.doc, 'div', 'gs-panel-body');
    const detail = element(this.doc, 'div', 'gs-vehicle-detail'); detail.append(element(this.doc, 'p', 'gs-description', this.view.selected.description || 'Выбери машину и проверь её характер на трассе.'));
    const stats = this.view.selected.stats || this.view.selected.specs || {};
    if (Object.keys(stats).length) {
      const row = element(this.doc, 'div', 'gs-spec-row');
      if (stats.topSpeed != null || stats.maxSpeed != null) row.append(stat(this.doc, 'СКОРОСТЬ', garageNumber(stats.topSpeed ?? stats.maxSpeed), 'км/ч'));
      if (stats.acceleration != null) row.append(stat(this.doc, 'РАЗГОН', label(stats.acceleration), stats.accelerationUnit || ''));
      if (stats.handling != null) row.append(stat(this.doc, 'КОНТРОЛЬ', label(stats.handling), ''));
      detail.append(row);
    }
    if (this.view.selected.owned) detail.append(this.button('Выехать на этой машине', { type: 'startDrive' }, { primary: true, iconName: 'arrow', className: 'gs-full' }));
    else {
      const price = garagePrice(this.view.selected.price); const locked = this.view.selected.locked || this.view.selected.available === false;
      detail.append(this.button(price == null ? 'Покупка пока недоступна' : `Купить за ${garageNumber(price)} ₵`, { type: 'purchaseVehicle', id: this.view.selected.id }, { primary: true, disabled: price == null || locked || this.view.selected.canBuy === false || this.view.balances.credits < price, className: 'gs-full' }));
      if (locked || price != null && this.view.balances.credits < price) detail.append(element(this.doc, 'p', 'gs-small-note', this.view.selected.lockReason || this.view.selected.reason || (locked ? 'Пока недоступно' : `Не хватает ${garageNumber(price - this.view.balances.credits)} ₵. Кредиты выдаются за заезды и контракты.`)));
    }
    detail.append(this.settingSelect('runMode', 'Класс заезда', [['standard', 'Заводской · без улучшений'], ['tuned', 'Настроенный · отдельный рекорд']], this.view.settings.runMode));
    content.append(detail);
    const caption = element(this.doc, 'div', 'gs-section-label'); caption.append(element(this.doc, 'span', '', 'ЛИНИЯ АВТОМОБИЛЕЙ'), element(this.doc, 'span', '', `${this.view.vehicles.filter(item => item.owned).length} / ${this.view.vehicles.length}`)); content.append(caption);
    const list = element(this.doc, 'div', 'gs-vehicle-list');
    for (const [index, car] of this.view.vehicles.entries()) {
      const selected = car.id === this.view.selected.id;
      const button = this.button('', { type: 'selectVehicle', id: car.id }, { className: 'gs-vehicle-row' }); button.setAttribute('aria-pressed', String(selected)); button.dataset.fleetId=car.id;
      const thumb = element(this.doc, 'div', 'gs-car-thumb'); thumb.setAttribute('aria-hidden', 'true'); thumb.dataset.state='pending';
      const canvas=element(this.doc,'canvas','gs-car-miniature');canvas.width=320;canvas.height=180;canvas.dataset.fleetModel=car.id;
      thumb.append(canvas,element(this.doc,'span','gs-miniature-status','3D'));
      const copy = element(this.doc, 'div', 'gs-vehicle-row-copy'); copy.append(element(this.doc, 'strong', '', car.name), element(this.doc, 'span', '', car.owned ? car.id === 'rocket' ? 'Стартовая машина · в гараже' : 'В твоём гараже' : car.price == null ? 'Скоро в каталоге' : `${garageNumber(car.price)} ₵`));
      button.append(element(this.doc, 'span', 'gs-list-index', String(index + 1).padStart(2, '0')), thumb, copy, icon(this.doc, selected ? 'check' : 'arrow')); list.append(button);
    }
    content.append(list, element(this.doc, 'p', 'gs-small-note', 'Выбор открывает осмотр. Кредиты списываются только после нажатия «Купить».')); return content;
  }
  /** Appearance items are grouped by real attachment slot, not random loot. */
  renderStyle() {
    const content = element(this.doc, 'div', 'gs-panel-body gs-atelier-body');
    const catalog = this.view.cosmetics || this.view.catalog.cosmetics || {};
    const all = Array.isArray(catalog) ? catalog : Object.entries(catalog).flatMap(([slot, list]) => items(list).map(item => ({ slot, ...item })));
    const slotTitles = { 'body.paint': 'Покрытие кузова', 'body.finish': 'Фактура кузова', 'body.addon': 'Детали кузова', 'body.tint': 'Тонировка стёкол', 'wheels.finish': 'Отделка дисков', 'wheels.geometry': 'Форма дисков', 'cockpit.steering': 'Рулевое колесо', 'cockpit.lighting': 'Приборный свет', 'cockpit.theme': 'Оформление кокпита', 'cockpit.stitch': 'Обивка и прострочка', 'cockpit.trim': 'Отделка кокпита', body: 'Кузов', paint: 'Покрытие кузова', wheels: 'Диски', rims: 'Диски', cockpit: 'Кокпит', livery: 'Ливрея' };
    const slots = [...new Set(all.map(item => item.slot || 'body'))].sort((a, b) => (a === 'cockpit.steering' ? -1 : b === 'cockpit.steering' ? 1 : 0));
    const categoryOf = slot => slot.startsWith('wheel') || slot === 'rims' ? 'wheels' : slot.startsWith('cockpit') ? 'cockpit' : 'body';
    const categories = [['body', 'Кузов'], ['wheels', 'Диски'], ['cockpit', 'Салон']].filter(([id]) => slots.some(slot => categoryOf(slot) === id));
    if (!categories.some(([id]) => id === this.atelierSection)) this.atelierSection = categories[0]?.[0] || 'body';
    const categoryNav = element(this.doc, 'div', 'gs-atelier-categories'); categoryNav.setAttribute('role', 'group'); categoryNav.setAttribute('aria-label', 'Часть автомобиля');
    for (const [id, name] of categories) {
      const button = this.button(name, { type: '_local', kind: 'atelierCategory', id }, { className: 'gs-atelier-category' });
      button.setAttribute('aria-pressed', String(this.atelierSection === id)); categoryNav.append(button);
    }
    if (categories.length) content.append(categoryNav);
    if (slots.includes('body.tint') && this.atelierSection === 'body') {
      const bodyNav = element(this.doc, 'div', 'gs-body-sections'); bodyNav.setAttribute('role', 'group'); bodyNav.setAttribute('aria-label', 'Кузов: покрытие или стёкла');
      for (const [id, name] of [['surface', 'Покрытие и детали'], ['glass', 'Стёкла']]) {
        const button = this.button(name, { type: '_local', kind: 'atelierBodySection', id }, { className: 'gs-body-section' });
        button.setAttribute('aria-pressed', String(this.atelierBodySection === id)); bodyNav.append(button);
      }
      content.append(bodyNav);
    } else if (!slots.includes('body.tint')) this.atelierBodySection = 'surface';
    const record = this.view.selected.cosmetics || this.view.profile.cosmetics || {};
    const loadout = this.view.loadout || this.view.profile.loadouts?.[this.view.selected.id] || {};
    if (!all.length) content.append(this.emptyState('Ателье готовится к работе', 'Детали появятся здесь, когда каталог будет подключён. Никаких случайных контейнеров.'));
    let featured = false;
    for (const slot of slots) {
      const paletteSlot = ['body.paint', 'paint', 'body.finish', 'body.tint', 'wheels.finish', 'wheels.geometry', 'cockpit.theme', 'cockpit.steering'].includes(slot);
      const group = element(this.doc, 'section', `gs-item-group${paletteSlot ? ' gs-sample-group' : ''}`); group.dataset.gsSlot = slot; group.hidden = categoryOf(slot) !== this.atelierSection || categoryOf(slot) === 'body' && (this.atelierBodySection === 'glass' ? slot !== 'body.tint' : slot === 'body.tint');
      const slotItems = all.filter(value => (value.slot || 'body') === slot);
      const currentId = loadout.cosmetics?.[slot] ?? record.equipped?.[slot] ?? this.view.profile.equipped?.[slot] ?? slotItems.find(item => item.equipped === true || item.selected === true)?.id;
      const factorySelected = !currentId || slot === 'body.paint' && currentId === 'paint_chalk';
      if (!featured && !group.hidden && paletteSlot) {
        const selected = slotItems.find(item => item.id === currentId);
        const feature = element(this.doc, 'div', 'gs-material-feature');
        feature.dataset.gsSlot = slot;
        const featureCopy = element(this.doc, 'div', 'gs-feature-copy');
        const factoryName = slot === 'body.tint' ? 'Серийное стекло' : slot === 'cockpit.steering' ? 'Серийный руль' : slot.startsWith('wheels') ? 'Серийные диски' : 'Серийная отделка';
        featureCopy.append(element(this.doc, 'span', 'gs-feature-label', 'На машине'), element(this.doc, 'strong', '', selected?.name || selected?.nameRu || selected?.label || factoryName));
        feature.append(cosmeticSample(this.doc, selected || {}, slot), featureCopy);
        content.append(feature); featured = true;
      }
      const groupHeading = element(this.doc, 'div', 'gs-material-heading');
      groupHeading.append(element(this.doc, 'h3', 'gs-section-label', slotTitles[slot] || slot), element(this.doc, 'span', 'gs-material-count', String(slotItems.length).padStart(2, '0')));
      group.append(groupHeading);
      const reset = element(this.doc, 'div', 'gs-cosmetic-reset');
      const resetButton = this.button('Серийный вариант', { type: 'resetCosmetic', slot }, { disabled: !this.view.selected.owned || factorySelected, className: 'gs-small-button' });
      resetButton.setAttribute('aria-label', `${slotTitles[slot] || slot}: серийный вариант`);
      reset.append(resetButton, element(this.doc, 'span', 'gs-small-note', slot === 'body.paint' ? 'Стартовый цвет «Мел»' : factorySelected ? 'Заводские детали установлены' : 'Вернуть заводские материалы и детали'));
      const isPaint = ['body.paint', 'paint'].includes(slot);
      const samples = element(this.doc, 'div', paletteSlot ? `gs-sample-grid ${isPaint ? 'gs-color-palette' : 'gs-material-list'}` : 'gs-detail-list');
      for (const item of slotItems) {
        const equipped = item.equipped === true || item.selected === true || loadout.cosmetics?.[slot] === item.id || record.equipped?.[slot] === item.id || this.view.profile.equipped?.[slot] === item.id;
        const owned = item.owned === true || owns(record.owned, item.id) || owns(this.view.profile.ownedCosmetics, item.id) || garagePrice(item.price ?? item.cost) === 0;
        const price = garagePrice(item.price ?? item.cost);
        const disabled = equipped || item.locked === true || item.available === false || !this.view.selected.owned || (owned ? item.canEquip === false : item.canBuy === false || price == null || price > this.view.balances.credits);
        const action = owned ? { type: 'equipCosmetic', slot, id: item.id } : { type: 'buyCosmetic', slot, id: item.id };
        const name = item.name || item.nameRu || item.label || item.id;
        const actionLabel = equipped ? 'Установлено' : item.available === false || item.locked === true ? 'Недоступно' : owned ? 'Установить' : price == null ? 'Недоступно' : `Купить · ${garageNumber(price)} ₵`;
        if (paletteSlot) {
          const card = this.button('', action, { disabled, className: `gs-sample-card${isPaint ? ' gs-color-choice' : ' gs-material-choice'}`, title: item.reason || item.description || item.descriptionRu });
          card.setAttribute('aria-label', `${name}: ${actionLabel}`); card.setAttribute('aria-pressed', String(equipped));
          card.dataset.owned = String(owned); card.dataset.unavailable = String(item.available === false || item.locked === true);
          const caption = element(this.doc, 'span', 'gs-sample-caption');
          caption.append(element(this.doc, 'strong', '', name), element(this.doc, 'span', 'gs-sample-action', actionLabel));
          card.append(cosmeticSample(this.doc, item, slot), caption);
          const reason = item.reason || (!this.view.selected.owned ? 'Сначала приобрети автомобиль' : !owned && price != null && price > this.view.balances.credits ? `Не хватает ${garageNumber(price - this.view.balances.credits)} ₵` : !equipped && owned && item.canEquip === false ? 'Пока нельзя установить' : !owned && item.canBuy === false ? 'Покупка пока недоступна' : '');
          if (reason) card.append(element(this.doc, 'span', 'gs-sample-reason', reason));
          samples.append(card);
        } else {
          const row = element(this.doc, 'div', 'gs-product-row');
          const copy = element(this.doc, 'div', 'gs-product-copy'); copy.append(element(this.doc, 'strong', '', name), element(this.doc, 'span', '', item.reason || item.description || item.descriptionRu || (equipped ? 'Установлено' : owned ? 'В коллекции' : 'Только внешний вид')));
          row.append(cosmeticSample(this.doc, item, slot), copy, this.button(actionLabel, action, { disabled, className: 'gs-small-button' })); samples.append(row);
        }
      }
      group.append(samples, reset); content.append(group);
    }
    content.append(this.renderPresets());
    return content;
  }
  /** Cosmetic presets reuse owned parts and never imply an extra purchase. */
  renderPresets() {
    const section = element(this.doc, 'section', 'gs-preset-section');
    const all = items(this.view.profile.cosmetics?.presets);
    const selected = all.filter(item => item.vehicleId === this.view.selected.id);
    const slots = number(this.view.presetSlots ?? this.view.garage.tiers[this.view.garage.level - 1]?.cosmeticPresetSlots, 1);
    section.append(element(this.doc, 'h3', 'gs-section-label', `ПРЕСЕТЫ ОБЛИКА / ${all.length} ИЗ ${slots}`));
    for (const preset of selected) {
      const row = element(this.doc, 'div', 'gs-product-row'); row.append(element(this.doc, 'strong', 'gs-product-copy', preset.name || 'Настройка'), this.button('Применить', { type: 'applyPreset', id: preset.id }, { className: 'gs-small-button' })); section.append(row);
    }
    section.append(this.button('Сохранить текущий облик', { type: 'savePreset', name: `${this.view.selected.name} · ${selected.length + 1}` }, { disabled: !this.view.selected.owned || all.length >= slots, className: 'gs-full gs-small-button' }));
    section.append(element(this.doc, 'p', 'gs-small-note', all.length >= slots ? 'Все слоты заняты. Следующий уровень бокса откроет больше места.' : 'Пресет сохраняет только внешний вид. Инженерные настройки остаются отдельно.'));
    return section;
  }
  /** Authoritative game-simulation values only, never inferred real-world bench results. */
  renderEngineeringComparison() {
    const metrics = items(this.view.engineeringComparison);
    if (!metrics.length) return null;
    const section = element(this.doc, 'section', 'gs-engineering-comparison');
    section.append(element(this.doc, 'h3', '', 'Параметры машины'));
    const headings = element(this.doc, 'div', 'gs-comparison-row gs-comparison-head');
    headings.append(element(this.doc, 'span', '', 'Параметр'), element(this.doc, 'span', '', 'База'), element(this.doc, 'span', '', 'Установлено'));
    section.append(headings);
    for (const metric of metrics) {
      const row = element(this.doc, 'div', 'gs-comparison-row'); row.dataset.metric = label(metric.id);
      row.append(element(this.doc, 'span', 'gs-comparison-label', metric.label || metric.id));
      for (const key of ['stock', 'tuned']) {
        const value = metric[key];
        const text = Number.isFinite(value) ? value.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) : '—';
        const cell = element(this.doc, 'strong', `gs-comparison-${key}`, text);
        if (Number.isFinite(value) && metric.unit) cell.append(element(this.doc, 'small', '', ` ${metric.unit}`));
        row.append(cell);
      }
      section.append(row);
    }
    section.append(element(this.doc, 'p', 'gs-small-note', 'Параметры игровой модели. В заводском классе улучшения не действуют.'));
    return section;
  }
  /** Five-step branches and the full four-tier workshop progression. */
  renderEngineering() {
    const content = element(this.doc, 'div', 'gs-panel-body');
    content.append(this.settingSelect('runMode', 'Класс заезда', [['standard', 'Заводской · улучшения выключены'], ['tuned', 'Настроенный · твоя конфигурация']], this.view.settings.runMode));
    const comparison = this.renderEngineeringComparison(); if (comparison) content.append(comparison);
    content.append(element(this.doc, 'p', 'gs-small-note', 'Исследование открывается для всего автопарка. Купленную ступень нужно установить на выбранную машину. Заводской класс всегда игнорирует улучшения.'));
    const branches = items(this.view.engineering || this.view.catalog.engineering?.branches || this.view.catalog.engineering || this.view.catalog.upgrades);
    if (!branches.length) content.append(this.emptyState('Инженерия без сюрпризов', 'Пять ступеней в каждой ветке. Цена и эффект показываются до покупки.'));
    for (const branch of branches) {
      const current = Math.min(5, number(branch.level ?? this.view.selected.engineering?.[branch.id] ?? this.view.profile.research?.[branch.id] ?? this.view.profile.engineering?.[this.view.selected.id]?.[branch.id]));
      const next = branch.levels?.[current] || {};
      const price = garagePrice(branch.nextPrice ?? branch.nextCost ?? next.price ?? branch.price);
      const node = element(this.doc, 'section', 'gs-upgrade-branch');
      const head = element(this.doc, 'div', 'gs-branch-heading'); head.append(element(this.doc, 'h3', '', branch.name || branch.nameRu || branch.label || branch.id), element(this.doc, 'span', 'gs-mono', `${current} / 5`));
      const steps = element(this.doc, 'div', 'gs-upgrade-steps'); steps.setAttribute('aria-label', `Уровень ${current} из 5`);
      for (let step = 1; step <= 5; step++) steps.append(element(this.doc, 'span', step <= current ? 'gs-step-done' : '', String(step)));
      node.append(head, element(this.doc, 'p', 'gs-small-note', branch.description || next.description || ''), steps);
      if (branch.effect || next.effect) node.append(element(this.doc, 'p', 'gs-effect', branch.effect || next.effect));
      const locked = branch.locked === true || branch.available === false || !this.view.selected.owned;
      const effectValue = branch.values?.[current + 1];
      if (effectValue != null) node.append(element(this.doc, 'p', 'gs-effect', `${branch.parameter === 'flightDrainMultiplier' ? 'Расход энергии' : 'Следующая ступень'}: ${Math.round((effectValue - 1) * 100) > 0 ? '+' : ''}${Math.round((effectValue - 1) * 100)}% к базе`));
      node.append(this.button(current >= 5 ? 'Ветка завершена' : price == null ? 'Нет доступного улучшения' : `Открыть ступень ${current + 1} · ${garageNumber(price)} ₵`, { type: 'upgradeEngineering', branch: branch.id, expectedLevel: current + 1 }, { disabled: current >= 5 || price == null || locked || branch.canBuy === false || this.view.balances.credits < price, className: 'gs-full gs-small-button' }));
      if (locked) node.append(element(this.doc, 'p', 'gs-small-note', branch.lockReason || branch.reason || (branch.available === false ? 'Эта ветка не поддерживается выбранной машиной.' : 'Сначала приобрети выбранную машину.')));
      const levels = items(branch.levels);
      if (levels.length && this.view.selected.owned) {
        node.append(element(this.doc, 'p', 'gs-equipped-label', `Установлено на машине: ${number(branch.equipped)} / 5`));
        const controls = element(this.doc, 'div', 'gs-level-controls'); controls.setAttribute('aria-label', `Установить ступень: ${branch.name || branch.nameRu || branch.id}`);
        for (const entry of levels) {
          const button = this.button(String(entry.level), { type: 'equipEngineering', branch: branch.id, level: entry.level }, { disabled: entry.canEquip === false || !entry.owned || locked, className: 'gs-level-button' });
          button.setAttribute('aria-pressed', String(entry.selected === true)); button.setAttribute('aria-label', `Установить ступень ${entry.level}`); controls.append(button);
        }
        node.append(controls);
      }
      content.append(node);
    }
    const workshop = element(this.doc, 'section', 'gs-workshop-plan'); workshop.append(element(this.doc, 'h3', 'gs-section-label', 'ЧЕТЫРЕ УРОВНЯ ПРОСТРАНСТВА'));
    for (const [index, tier] of this.view.garage.tiers.entries()) {
      const level = index + 1; const node = element(this.doc, 'div', `gs-tier-row ${level === this.view.garage.level ? 'gs-tier-current' : ''}`);
      node.append(element(this.doc, 'span', 'gs-tier-number', String(level).padStart(2, '0')));
      const copy = element(this.doc, 'div', 'gs-product-copy'); copy.append(element(this.doc, 'strong', '', tier.name || tier.label), element(this.doc, 'span', '', tier.description || tier.detail || '')); node.append(copy);
      if (level <= this.view.garage.level) node.append(icon(this.doc, 'check')); workshop.append(node);
    }
    if (this.view.garage.level < 4) {
      const price = garagePrice(this.view.garage.nextPrice ?? this.view.garage.tiers[this.view.garage.level]?.price);
      workshop.append(this.button(price == null ? 'Расширение пока недоступно' : `Расширить бокс · ${garageNumber(price)} ₵`, { type: 'upgradeGarage', expectedLevel: this.view.garage.level + 1 }, { primary: true, disabled: price == null || price > this.view.balances.credits || this.view.garage.locked === true, className: 'gs-full' }));
      if (this.view.garage.lockReason) workshop.append(element(this.doc, 'p', 'gs-small-note', this.view.garage.lockReason));
    }
    content.append(workshop, element(this.doc, 'p', 'gs-small-note', 'Рекорды заводских и модифицированных машин учитываются отдельно.')); return content;
  }
  /** Contracts clearly separate accepting work from claiming an earned reward. */
  renderContracts() {
    const content = element(this.doc, 'div', 'gs-panel-body');
    const contracts = items(this.view.contracts || this.view.catalog.contracts);
    if (!contracts.length) content.append(this.emptyState('Чистый маршрут', 'Доступные задания появятся здесь. Заезд можно начать без контракта.'));
    for (const item of contracts) {
      const saved = this.view.profile.contracts?.[item.id] || {};
      const state = item.state || item.status || saved.state || saved.status || (Object.hasOwn(item, 'canClaim') ? 'active' : 'available');
      const target = number(item.target ?? item.goal, 1) || 1; const progress = Math.min(target, number(item.progress ?? saved.progress));
      const complete = item.canClaim === true || item.complete === true || ['complete', 'completed', 'ready'].includes(state) || progress >= target;
      const claimed = item.claimed === true || state === 'claimed'; const active = item.active === true || ['active', 'accepted'].includes(state);
      const card = element(this.doc, 'article', 'gs-contract');
      const head = element(this.doc, 'div', 'gs-section-label'); head.append(element(this.doc, 'span', '', item.category || 'ДОРОЖНЫЙ КОНТРАКТ'), element(this.doc, 'span', 'gs-contract-state', claimed ? 'ЗАКРЫТ' : complete ? 'ГОТОВ' : active ? 'В РАБОТЕ' : 'ДОСТУПЕН')); card.append(head);
      card.append(element(this.doc, 'h3', '', item.name || item.nameRu || item.title || 'Контракт'), element(this.doc, 'p', 'gs-description', item.description || item.descriptionRu || contractDescription(item)));
      const reward = item.reward || item.rewards || {};
      card.append(element(this.doc, 'p', 'gs-contract-reward', `${garageNumber(reward.credits ?? item.rewardCredits ?? item.credits)} ₵${(reward.xp ?? item.xp) ? ` + ${garageNumber(reward.xp ?? item.xp)} XP` : ''}`));
      if (active || complete || claimed) card.append(this.progress(progress, target, `${garageNumber(progress)} / ${garageNumber(target)} ${item.unit || (item.metric?.endsWith('M') ? 'м' : '')}`));
      card.append(this.button(claimed ? 'Награда получена' : complete ? 'Забрать награду' : active ? 'Контракт активен' : 'Принять контракт', { type: complete && !claimed ? 'claimContract' : 'acceptContract', id: item.id }, { primary: complete && !claimed, disabled: claimed || active && !complete || item.locked === true || item.available === false || item.canClaim === false && complete, className: 'gs-full gs-small-button' })); content.append(card);
    }
    content.append(element(this.doc, 'p', 'gs-small-note', 'Без таймера давления. Только понятная цель и известная награда.')); return content;
  }
  /** Earned free rewards remain available without a purchase or advertisement. */
  renderSeason() {
    const content = element(this.doc, 'div', 'gs-panel-body');
    const season = this.view.season || this.view.catalog.season || {}; const saved = this.view.profile.season || {};
    content.append(element(this.doc, 'p', 'gs-season-name', season.name || season.nameRu || 'Высота ноль'), element(this.doc, 'p', 'gs-description', season.description || 'Выезжай, набирай опыт и открывай награды. Твой прогресс не требует покупки.'));
    const xp = number(typeof season.xp === 'number' ? season.xp : saved.xp ?? this.view.profile.xp);
    const stepXP = number(season.xpPerTier ?? season.xpPerLevel, 450) || 450;
    const seasonLevel = Math.min(number(season.levels, 20), Math.floor(xp / stepXP));
    const nextXP = number(season.nextXP, Math.min(number(season.totalXp, 9000), (seasonLevel + 1) * stepXP));
    content.append(this.progress(xp, Math.max(xp, nextXP, 1), `${garageNumber(xp)} / ${garageNumber(nextXP)} XP · уровень ${seasonLevel} / ${number(season.levels, 20)}`));
    const tiers = items(season.tiers || this.view.catalog.seasonTiers);
    for (const [index, tier] of tiers.entries()) {
      const level = tier.tier ?? tier.level ?? index + 1; const required = number(tier.requiredXP ?? tier.xp ?? level * stepXP);
      const row = element(this.doc, 'article', 'gs-season-tier');
      row.append(element(this.doc, 'span', 'gs-tier-number', String(level).padStart(2, '0')));
      const rewards = element(this.doc, 'div', 'gs-season-rewards');
      const tracks = tier.free || tier.premium ? ['free', 'premium'] : ['free'];
      for (const track of tracks) {
        const reward = tier[track] || (track === 'free' ? tier.reward || tier : null); if (!reward) continue;
        const claimed = reward.claimed === true || owns(saved.claims, reward.id) || owns(saved.claimed?.[track], level) || owns(season.claimed?.[track], level);
        const premiumOwned = season.premiumOwned === true || saved.premium === true;
        const unlocked = reward.unlocked === true || tier.unlocked === true || xp >= required;
        const copy = element(this.doc, 'div', 'gs-season-track');
        copy.append(element(this.doc, 'span', 'gs-kicker', track === 'free' ? 'БЕСПЛАТНО' : 'ПРЕМИУМ'), element(this.doc, 'strong', '', reward.name || reward.nameRu || reward.label || (reward.type === 'credits' ? `${garageNumber(reward.amount ?? reward.credits)} ₵` : this.view.badges?.find(item => item.id === reward.cosmeticId)?.nameRu || this.view.cosmetics?.find(item => item.id === reward.cosmeticId)?.nameRu || 'Предмет коллекции')));
        copy.append(this.button(claimed ? 'Получено' : !unlocked ? `${garageNumber(required)} XP` : track === 'premium' && !premiumOwned ? 'Нужен пропуск' : 'Забрать', { type: 'claimSeason', tier: level, track, id: reward.id }, { disabled: claimed || !unlocked || reward.available === false || reward.canClaim === false || track === 'premium' && !premiumOwned, className: 'gs-small-button' }));
        if (reward.reason) copy.append(element(this.doc, 'p', 'gs-small-note', reward.reason));
        rewards.append(copy);
      }
      row.append(rewards); content.append(row);
    }
    if (!tiers.length) content.append(this.emptyState('Сезонная линия', 'Награды появятся после подключения каталога сезона. Текущий опыт сохраняется.'));
    const products = items(this.view.products || this.view.catalog.products);
    const product = products.find(item => item.type === 'season' || item.id === season.productId || /pass/i.test(item.id));
    const purchase = element(this.doc, 'section', 'gs-commerce-note');
    purchase.append(element(this.doc, 'h3', '', 'Больше стиля, не преимуществ'), element(this.doc, 'p', 'gs-small-note', 'Платная линия дополняет коллекцию. Бесплатные награды и заезды остаются доступными всем.'));
    if (product && this.view.platform.payments && this.view.premium?.enabled === true && product.available !== false) purchase.append(this.button(product.priceLabel ? `Пропуск · ${product.priceLabel}` : 'Посмотреть пропуск', { type: 'purchaseProduct', id: product.id }, { className: 'gs-full' }));
    else purchase.append(element(this.doc, 'p', 'gs-platform-note', this.view.premium?.reason || 'Покупки за реальные деньги сейчас недоступны.'));
    content.append(purchase);
    const badges = items(this.view.badges).filter(item => item.owned);
    if (badges.length) {
      const collection = element(this.doc, 'section', 'gs-badge-collection'); collection.append(element(this.doc, 'h3', 'gs-section-label', 'ТВОИ ЗНАКИ ОТЛИЧИЯ'));
      for (const badge of badges) { const row = element(this.doc, 'div', 'gs-product-row'); row.append(icon(this.doc, 'season'), element(this.doc, 'strong', 'gs-product-copy', badge.name || badge.nameRu || badge.id), this.button(badge.selected ? 'Выбран' : 'Выбрать', { type: 'equipBadge', id: badge.id }, { disabled: badge.selected, className: 'gs-small-button' })); collection.append(row); }
      content.append(collection);
    }
    return content;
  }
  /** Never synthesize telemetry: absent records are shown as an em dash. */
  renderTelemetry() {
    const content = element(this.doc, 'div', 'gs-records-content');
    const telemetry = this.view.telemetry || this.view.profile.telemetry || this.view.profile.stats || {};
    const vehicleRecords = telemetry.vehicles?.[this.view.selected.id] || this.view.selected.records || this.view.profile.records?.[this.view.selected.id] || telemetry;
    content.append(element(this.doc, 'p', 'gs-small-note', `Режим рекорда: ${this.view.settings.difficulty === 'rush' ? 'Час пик' : 'Спокойный поток'}.`));
    const records = element(this.doc, 'div', 'gs-records');
    for (const [key, name] of [['stock', 'Заводская'], ['modified', 'Настроенная'], ['continued', 'С продолжением']]) {
      const mode = key === 'stock' ? 'standard' : key === 'modified' ? 'tuned' : 'continued';
      const record = vehicleRecords[key] || this.view.profile.records?.[mode]?.[`${this.view.selected.id}:${this.view.settings.difficulty || 'flow'}`] || {};
      const node = element(this.doc, 'section', 'gs-record-sheet');
      node.append(element(this.doc, 'h3', '', name));
      node.append(stat(this.doc, 'ЛУЧШИЙ СЧЁТ', record.bestScore == null && record.score == null ? '—' : garageNumber(record.bestScore ?? record.score)));
      const more = element(this.doc, 'div', 'gs-spec-row');
      more.append(stat(this.doc, 'ДИСТАНЦИЯ', record.bestDistance == null && record.distance == null && record.distanceM == null ? '—' : garageNumber(record.bestDistance ?? record.distance ?? record.distanceM), 'м'));
      more.append(stat(this.doc, 'ЗАЕЗДЫ', record.runs == null ? '—' : garageNumber(record.runs)));
      node.append(more); records.append(node);
    }
    content.append(records);
    const total = element(this.doc, 'div', 'gs-total-telemetry'); total.append(element(this.doc, 'h3', 'gs-section-label', 'За всё время'));
    total.append(stat(this.doc, 'ЗАЕЗДОВ', garageNumber(telemetry.runs ?? this.view.profile.runs)), stat(this.doc, 'ПРОЙДЕНО', garageNumber(telemetry.totalDistance ?? telemetry.distanceM ?? this.view.profile.totalDistance), 'м'));
    if (telemetry.flightTime != null || telemetry.airSeconds != null) total.append(stat(this.doc, 'В НЕБЕ', garageNumber(telemetry.flightTime ?? telemetry.airSeconds), 'с'));
    if (telemetry.peakSpeedMps != null) total.append(stat(this.doc, 'МАКС. СКОРОСТЬ', garageNumber(telemetry.peakSpeedMps * 3.6), 'км/ч'));
    content.append(total, element(this.doc, 'p', 'gs-small-note', 'Заводские и улучшенные сборки не смешиваются. Рекорд обновляется только после завершённого заезда.')); return content;
  }
  /** Run settlement is displayed from the controller receipt, not recomputed. */
  renderResults() {
    const result = this.view.runResult || {}; const receipt = result.receipt || result.settlement || result;
    const main = element(this.doc, 'main', 'gs-results');
    const intro = element(this.doc, 'section', 'gs-result-intro'); intro.tabIndex = 0; intro.setAttribute('aria-label', 'Результат текущего заезда');
    const title = element(this.doc, 'h1', '', result.newRecord ? 'Новый рекорд' : 'Результат заезда'); title.dataset.gsHeading = 'true'; title.tabIndex = -1; intro.append(title);
    intro.append(element(this.doc, 'p', 'gs-result-vehicle', `${this.view.selected.name} / ${result.mode === 'continued' || result.continued ? 'С продолжением' : result.mode === 'tuned' || result.modified ? 'Настроенная' : 'Заводская'} сборка`));
    const stats = element(this.doc, 'div', 'gs-result-stats'); stats.append(stat(this.doc, 'СЧЁТ', garageNumber(result.score)), stat(this.doc, 'ДИСТАНЦИЯ', garageNumber(result.distance), 'м'));
    const metrics = result.metrics || {};
    const airSeconds = result.flightTime ?? metrics.airSeconds;
    if (Number.isFinite(airSeconds) && airSeconds > 0) stats.append(stat(this.doc, 'В НЕБЕ', garageNumber(airSeconds), 'с'));
    intro.append(stats);
    const highlights = element(this.doc, 'div', 'gs-run-highlights');
    if (Number.isFinite(metrics.peakSpeedMps) && metrics.peakSpeedMps > 0) highlights.append(stat(this.doc, 'МАКС. СКОРОСТЬ', garageNumber(metrics.peakSpeedMps * 3.6), 'км/ч'));
    for (const [id, name] of [['roadEventsCompleted', 'ДОРОЖНЫЕ СОБЫТИЯ'], ['airborneOvertakes', 'ОБГОНЫ В ВОЗДУХЕ']]) {
      if (Number.isFinite(metrics[id]) && metrics[id] > 0) highlights.append(stat(this.doc, name, garageNumber(metrics[id])));
    }
    if (Number.isFinite(metrics.landings) && metrics.landings > 0) {
      const precise = Number.isFinite(metrics.precisionLandings) ? `${garageNumber(metrics.precisionLandings)} / ` : '';
      highlights.append(stat(this.doc, precise ? 'ТОЧНЫЕ ПОСАДКИ / ВСЕ' : 'ПОСАДКИ', `${precise}${garageNumber(metrics.landings)}`));
    } else if (Number.isFinite(metrics.precisionLandings) && metrics.precisionLandings > 0) highlights.append(stat(this.doc, 'ТОЧНЫЕ ПОСАДКИ', garageNumber(metrics.precisionLandings)));
    if (highlights.children.length) intro.append(highlights);
    main.append(intro);
    const settlement = element(this.doc, 'section', 'gs-settlement'); settlement.append(element(this.doc, 'h2', '', 'Награды'));
    const rewards = element(this.doc, 'div', 'gs-settlement-rewards'); rewards.append(stat(this.doc, 'КРЕДИТЫ', `+${garageNumber(receipt.credits ?? receipt.creditsEarned)}`, '₵'), stat(this.doc, 'ОПЫТ СЕЗОНА', `+${garageNumber(receipt.xp ?? receipt.xpEarned)}`, 'XP')); settlement.append(rewards);
    if (number(result.onboarding) > 0) settlement.append(element(this.doc, 'p', 'gs-result-contract', `Первый рубеж · +${garageNumber(result.onboarding)} ₵`));
    const contracts = items(receipt.contracts || result.contracts);
    for (const contract of contracts) settlement.append(element(this.doc, 'p', 'gs-result-contract', `${contract.complete ? '✓ ' : ''}${contract.name || contract.title || contract.id}${contract.progressLabel ? ` · ${contract.progressLabel}` : ''}`));
    const claimable = items(this.view.contracts).filter(item => item.canClaim === true);
    if (claimable.length) settlement.append(this.button(`Готовые контракты · ${claimable.length}`, { type: 'navigate', screen: 'garage', tab: 'contracts' }, { iconName: 'arrow', className: 'gs-full gs-small-button' }));
    if (result.settled !== true && receipt.finalized !== true || receipt.pending === true) settlement.append(element(this.doc, 'p', 'gs-small-note', 'Результат ещё не подтверждён. Награды появятся после сохранения.'));
    else settlement.append(element(this.doc, 'p', 'gs-small-note', result.saveMessage || 'Результат заезда учтён.'));
    if (result.canRevive === true && !result.bonusClaimed) {
      settlement.append(this.button(result.reviveLabel || 'Продолжить заезд', { type: 'revive' }, { iconName: 'arrow', className: 'gs-full' }));
      settlement.append(element(this.doc, 'p', 'gs-small-note', 'Продолжение учитывается в отдельном классе рекордов. Бонус за результат завершит этот заезд.'));
    }
    if (this.view.platform.rewarded && !result.bonusClaimed && result.bonusEligible === true) {
      settlement.append(element(this.doc, 'p', 'gs-bonus-warning', 'Полученный бонус завершает заезд; продолжение после него недоступно.'));
      settlement.append(this.button(result.bonusCredits != null ? `Видео → +${garageNumber(result.bonusCredits)} ₵` : 'Бонус за добровольное видео', { type: 'rewardedBonus' }, { iconName: 'play', className: 'gs-full' }));
      settlement.append(element(this.doc, 'p', 'gs-small-note', 'По желанию. Награда выдаётся только после подтверждения просмотра.'));
    } else if (!this.view.platform.rewarded) settlement.append(element(this.doc, 'p', 'gs-platform-note', 'Рекламный бонус сейчас недоступен. Можно продолжать без него.'));
    const records = element(this.doc, 'details', 'gs-results-records');
    records.append(element(this.doc, 'summary', '', 'Рекорды и статистика'), this.renderTelemetry()); settlement.append(records);
    const actions = element(this.doc, 'div', 'gs-result-actions'); actions.append(this.button('Ещё заезд', { type: 'startDrive' }, { primary: true, iconName: 'arrow' }), this.button('В гараж', { type: 'navigate', screen: 'garage', tab: 'fleet' }, { iconName: 'garage' }));
    const scroll = element(this.doc, 'div', 'gs-settlement-scroll'); scroll.tabIndex = 0; scroll.setAttribute('aria-label', 'Награды и возможности после заезда');
    scroll.append(...Array.from(settlement.children)); settlement.replaceChildren(scroll, actions);
    main.append(settlement); return main;
  }
  /** Loading has a real controller progress value and an explicit failure path. */
  renderLoading() {
    const loading = this.view.loading || {}; const node = element(this.doc, 'main', 'gs-loading');
    node.append(this.brand(), element(this.doc, 'p', 'gs-loading-tagline', 'Держи трассу. Забирай небо.'));
    const title = element(this.doc, 'h1', '', loading.error ? 'Не удалось открыть бокс' : 'Подготавливаем выезд'); title.dataset.gsHeading = 'true'; title.tabIndex = -1; node.append(title);
    node.append(element(this.doc, 'p', 'gs-description', loading.error || loading.message || 'Собираем сцену и проверяем сохранение.'));
    const progress = loading.progressFraction != null ? loading.progressFraction * 100 : loading.progressPercent ?? loading.progress;
    const hasProgress = Number.isFinite(progress);
    if (hasProgress) { const percent = Math.min(100, Math.max(0, progress)); node.append(this.progress(percent, 100, `${Math.round(percent)}%`)); }
    else { const progress = element(this.doc, 'div', 'gs-indeterminate'); progress.setAttribute('role', 'progressbar'); progress.setAttribute('aria-label', 'Загрузка'); node.append(progress); }
    if (loading.error) node.append(this.button('Попробовать снова', { type: 'retryLoad' }, { primary: true, iconName: 'arrow' }));
    node.append(element(this.doc, 'p', 'gs-small-note', 'Вход в аккаунт не обязателен. Прогресс сохраняется автоматически.')); return node;
  }
  /** Honest platform state: capability is not confused with a signed-in account. */
  renderFooter() {
    const foot = element(this.doc, 'footer', 'gs-footer');
    foot.append(element(this.doc, 'span', 'gs-footer-brand', 'Roadster / PERFORMANCE WORKSHOP'));
    const save = element(this.doc, 'span', 'gs-save-status');
    const cloudStatus = this.view.cloud?.status;
    const localSaved = (this.view.local?.saved ?? this.view.local?.localSaved) !== false && this.view.platform.storageAvailable !== false;
    const localLabel = localSaved ? 'Локальное сохранение' : 'Прогресс только в этой сессии';
    const saveLabel = this.view.platform.saveStatus || (['synced', 'saved'].includes(cloudStatus) ? 'Сохранено в облаке' : cloudStatus === 'saving' ? 'Сохраняем в облако…' : cloudStatus === 'queued' ? `${localLabel} · облако в очереди` : ['error', 'uncertain', 'rate-limited', 'frozen'].includes(cloudStatus) ? `${localLabel} · облако не подтверждено` : this.view.platform.cloudConnected === true ? 'Облачное сохранение подключено' : localLabel);
    save.append(element(this.doc, 'span', 'gs-status-dot'), element(this.doc, 'span', '', saveLabel));
    foot.append(save);
    const authPending = this.view.platform.auth === 'pending';
    const authenticated = this.view.platform.authenticated === true || this.view.platform.auth === 'authorized';
    const guest = !authenticated && (this.view.platform.auth === 'guest' || this.view.platform.cloud || authPending);
    const cloudReadFailed = cloudStatus === 'error' && (this.view.cloud?.error == null || ['cloud-load-failed', 'invalid-cloud-response', 'invalid-cloud-profile', 'timeout', 'sdk-rate-limit', 'player-unavailable', 'invalid-player', 'cloud-replacement-failed'].includes(this.view.cloud.error));
    if (this.view.platform.sdk && cloudReadFailed && !authPending && !this.view.platform.conflict) foot.append(this.button('Повторить загрузку из облака', { type: 'retryCloud' }, { iconName: 'cloud', className: 'gs-footer-connect' }));
    else if (guest && !this.view.platform.conflict) foot.append(this.button(authPending ? 'Яндекс ID · ждём подтверждения…' : 'Яндекс ID · прогресс на всех устройствах', { type: 'cloudConnect' }, { disabled: authPending, iconName: 'cloud', className: 'gs-footer-connect' }));
    else foot.append(element(this.doc, 'span', 'gs-footer-build', this.view.platform.sdk ? 'ЯНДЕКС ИГРЫ' : 'ЛОКАЛЬНЫЙ РЕЖИМ'));
    return foot;
  }
  /** Cloud divergence is an explicit choice between snapshots, never a max merge. */
  renderCloudConflict(conflict) {
    const snapshots = { local: conflictSnapshot(conflict, 'local'), cloud: conflictSnapshot(conflict, 'cloud') };
    const emptyCloud = conflict.source === 'sdk' && conflict.reason === 'local-unlinked' && snapshots.cloud.raw === null;
    const backend = conflict.source === 'backend';
    const backdrop = element(this.doc, 'div', 'gs-settings-backdrop');
    const dialog = element(this.doc, 'section', 'gs-settings-dialog gs-cloud-dialog');
    dialog.tabIndex = -1;
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'gs-cloud-title');
    const title = element(this.doc, 'h2', '', emptyCloud ? 'В облаке пока нет сохранения' : !snapshots.cloud.valid ? 'Облачное сохранение недоступно' : 'Два разных маршрута'); title.id = 'gs-cloud-title';
    const description = emptyCloud ? 'Текущий прогресс с этого устройства можно сохранить в облаке Яндекс Игр.' : !snapshots.cloud.valid ? 'Не удалось прочитать облачное сохранение. Прогресс на устройстве не изменён.' : backend ? 'Для этого аккаунта нужно загрузить подтверждённый облачный прогресс. Балансы и покупки не складываются.' : 'На устройстве и в облаке разный прогресс. Выбери один вариант: балансы и покупки не складываются.';
    dialog.append(element(this.doc, 'p', 'gs-kicker', emptyCloud ? 'ОБЛАЧНОЕ СОХРАНЕНИЕ' : 'ВЫБОР СОХРАНЕНИЯ'), title, element(this.doc, 'p', 'gs-description', description));
    for (const [choice, name] of [['local', 'На этом устройстве'], ['cloud', 'В облаке']]) {
      if (choice === 'cloud' && emptyCloud) continue;
      const { raw: supplied, profile: suppliedProfile, valid } = snapshots[choice];
      const raw = supplied || {}, profile = suppliedProfile || {};
      const row = element(this.doc, 'section', 'gs-cloud-option');
      row.append(element(this.doc, 'h3', '', name));
      const stats = element(this.doc, 'div', 'gs-spec-row');
      const credits = raw.credits ?? profile.wallet?.credits; const runs = raw.runs ?? profile.stats?.runs;
      stats.append(stat(this.doc, 'БАЛАНС', credits == null ? '—' : garageNumber(credits), '₵'), stat(this.doc, 'ЗАЕЗДЫ', runs == null ? '—' : garageNumber(runs)));
      row.append(stats);
      const count = raw.vehicles ?? profile.ownedVehicles?.length;
      if (typeof count === 'number') row.append(element(this.doc, 'p', 'gs-small-note', `Автомобилей: ${garageNumber(count)}`));
      const selectable = valid && (choice === 'cloud' || !backend && (emptyCloud || snapshots.cloud.valid));
      if (selectable) row.append(this.button(choice === 'local' ? emptyCloud ? 'Создать облачное сохранение' : 'Оставить этот прогресс' : 'Загрузить облачный прогресс', { type: 'resolveCloudConflict', choice }, { primary: choice === 'local' || backend, className: 'gs-full' }));
      dialog.append(row);
    }
    dialog.append(element(this.doc, 'p', 'gs-small-note', conflict.message || (emptyCloud ? 'В облако будет перенесён весь прогресс с этого устройства.' : snapshots.cloud.valid ? 'Будет использован выбранный вариант. Ничего не объединяем автоматически.' : 'Загрузка и замена сохранений недоступны.')));
    backdrop.append(dialog); return backdrop;
  }
  /** A focus-contained, reversible settings sheet with labeled native controls. */
  renderSettings() {
    const backdrop = element(this.doc, 'div', 'gs-settings-backdrop'); const dialog = element(this.doc, 'section', 'gs-settings-dialog');
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'gs-settings-title');
    const head = element(this.doc, 'div', 'gs-dialog-header'); const title = element(this.doc, 'h2', '', 'Настрой свой выезд'); title.id = 'gs-settings-title';
    const close = this.localButton('', 'closeSettings', 'close', 'gs-icon-button'); close.setAttribute('aria-label', 'Закрыть настройки'); close.dataset.gsFocus = 'closeSettings'; head.append(title, close); dialog.append(head);
    dialog.append(element(this.doc, 'p', 'gs-small-note', 'Управление и графика. Настройки не влияют на стоимость машин.'));
    dialog.append(this.settingSelect('runMode', 'Класс заезда', [['standard', 'Заводской · честный базовый рекорд'], ['tuned', 'Настроенный · отдельный рекорд']], this.view.settings.runMode));
    dialog.append(this.settingSelect('difficulty', 'Плотность трафика', [['flow', 'Спокойный поток'], ['rush', 'Час пик']], this.view.settings.difficulty || 'flow'));
    dialog.append(this.settingSelect('cameraMode', 'Камера', [['chase', 'Внешняя'], ['cockpit', 'Из кабины']], this.view.settings.cameraMode || 'chase'));
    dialog.append(this.settingSelect('renderQuality', 'Качество графики', [['auto', 'Авто · плавность прежде всего'], ['high', 'Высокое'], ['ultra', 'Ультра · высокая нагрузка']], this.view.settings.renderQuality || 'auto'));
    const sound = element(this.doc, 'label', 'gs-toggle');
    const input = element(this.doc, 'input', ''); input.type = 'checkbox'; input.checked = this.view.settings.sound === true; input.dataset.gsSetting = 'sound'; input.dataset.gsFocus = 'settings:sound';
    sound.append(element(this.doc, 'span', '', 'Звук двигателя и мира'), input); dialog.append(sound);
    const controls = element(this.doc, 'div', 'gs-control-guide'); controls.append(element(this.doc, 'h3', '', 'За рулём'), element(this.doc, 'p', '', 'W / ↑ — газ · S / ↓ — тормоз'), element(this.doc, 'p', '', 'A / D или ← / → — управление'), element(this.doc, 'p', '', 'На телефоне используй кнопки на экране.'));
    dialog.append(controls, this.button('Готово', { type: '_local', kind: 'closeSettings' }, { primary: true, className: 'gs-full' })); backdrop.append(dialog); return backdrop;
  }
  /** Native selects provide keyboard and touch support without hidden popovers. */
  settingSelect(key, name, options, value) {
    const wrapper = element(this.doc, 'label', 'gs-setting'); wrapper.append(element(this.doc, 'span', '', name));
    const select = element(this.doc, 'select', ''); select.dataset.gsSetting = key; select.dataset.gsFocus = `settings:${key}`; select.setAttribute('aria-label', name);
    for (const [id, text] of options) { const option = element(this.doc, 'option', '', text); option.value = id; option.selected = id === value; select.append(option); }
    wrapper.append(select); return wrapper;
  }
  /** A failed replacement bay leaves the current room usable and retry explicit. */
  renderLoadError() {
    const node = element(this.doc, 'section', 'gs-load-error'); node.setAttribute('aria-label', 'Не удалось загрузить бокс');
    const copy = element(this.doc, 'p', 'gs-small-note', this.view.loading.error); copy.setAttribute('role', 'alert');
    node.append(copy, this.button(this.view.loading?.adPending?'Перезагрузить игру':'Повторить загрузку бокса', { type: 'retryLoad' }, { className: 'gs-small-button', iconName: 'arrow' }));
    return node;
  }
  /** Accessible progress uses real numbers and never acts as a countdown. */
  progress(value, maximum, text) {
    const wrapper = element(this.doc, 'div', 'gs-progress-wrap');
    const track = element(this.doc, 'div', 'gs-progress'); track.setAttribute('role', 'progressbar'); track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', String(maximum)); track.setAttribute('aria-valuenow', String(Math.min(maximum, value))); track.setAttribute('aria-label', text);
    const fill = element(this.doc, 'span', ''); fill.style.width = `${Math.min(100, Math.max(0, value / Math.max(1, maximum) * 100))}%`; track.append(fill); wrapper.append(track, element(this.doc, 'span', 'gs-progress-label', text)); return wrapper;
  }
  /** Explain missing catalog data instead of inventing products or records. */
  emptyState(title, description) { const node = element(this.doc, 'div', 'gs-empty'); node.append(icon(this.doc, 'garage'), element(this.doc, 'h3', '', title), element(this.doc, 'p', 'gs-description', description)); return node; }
}
/** Functional-constructor convenience for controllers that do not use classes. */
export function createGarageUI(options) { return new GarageUI(options); }
