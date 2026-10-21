import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UI, boostPresentation, flightPresentation, rollPresentation } from '../src/ui.js';
import { CONFIG } from '../src/config.js';
import { hudGaugePresentation } from '../src/hud-gauges.js';
import { formatNumber, clamp } from '../src/util.js';
import { Game } from '../src/game.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const byId = id => document.getElementById(id);

/** Record every HUD mutation, including same-value setters, with no browser or timers. */
function recorder({ serializeStyles = false } = {}) {
  const nodes = new Map(), writes = [];
  const record = (id, kind, name, value, previous) => writes.push({ id, kind, name, value, same: value === previous });
  function create(id, initial = {}) {
    const attributes = { ...initial }, styles = {}, data = {};
    const properties = { textContent: '', hidden: Object.hasOwn(initial, 'hidden'), disabled: Object.hasOwn(initial, 'disabled') };
    const customName = name => 'data-' + name.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
    for (const [name, value] of Object.entries(initial)) {
      if (name.startsWith('data-')) data[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    }
    function assignStyle(name, value) {
      value = String(value);
      record(id, 'style', name, value, styles[name] ?? '');
      // Model CSSOM's numeric serialization. Inputs still reach the setter at full precision.
      const numeric = /^(-?\d+(?:\.\d+)?)(%)?$/.exec(value);
      styles[name] = serializeStyles && !name.startsWith('--') && numeric
        ? String(Number(Number(numeric[1]).toPrecision(6))) + (numeric[2] || '') : value;
    }
    const style = new Proxy({
      setProperty: assignStyle,
      getPropertyValue: name => styles[name] ?? '',
    }, {
      get(target, name) { return name in target ? target[name] : styles[name] ?? ''; },
      set(_target, name, value) { assignStyle(name, value); return true; },
    });
    const dataset = new Proxy(data, {
      set(target, name, value) {
        value = String(value);
        record(id, 'dataset', name, value, target[name]);
        target[name] = value; attributes[customName(name)] = value; return true;
      },
    });
    const target = {
      style, dataset,
      getAttribute: name => attributes[name] ?? null,
      setAttribute(name, value) {
        value = String(value);
        record(id, 'attribute', name, value, attributes[name]); attributes[name] = value;
      },
    };
    const node = new Proxy(target, {
      get(target, name) { return name in properties ? properties[name] : target[name]; },
      set(target, name, value) {
        if (!(name in properties)) throw new Error('Unexpected HUD property: ' + name);
        value = name === 'textContent' ? String(value) : Boolean(value);
        record(id, 'property', name, value, properties[name]); properties[name] = value;
        if (name !== 'textContent') { if (value) attributes[name] = ''; else delete attributes[name]; }
        return true;
      },
    });
    const snapshot = () => ({ properties: { ...properties }, attributes: { ...attributes }, styles: { ...styles }, dataset: { ...data } });
    nodes.set(id, { node, snapshot });
    return node;
  }
  // Preserve the shell's labels, roles, ARIA relationships and other attributes in comparisons.
  for (const [, tag] of html.matchAll(/<([a-z][^<>]*\bid="[^"]+"[^<>]*)>/gi)) {
    const attributes = Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]));
    for (const name of ['hidden', 'disabled']) if (new RegExp('\\s' + name + '(?:\\s|$)').test(tag)) attributes[name] = '';
    create(attributes.id, attributes);
  }
  return {
    writes,
    document: { getElementById(id) { assert.ok(nodes.has(id), 'HUD element exists in the shell: ' + id); return nodes.get(id).node; } },
    snapshot: () => Object.fromEntries([...nodes].map(([id, value]) => [id, value.snapshot()])),
    node: id => nodes.get(id).node,
    replace(id) { return create(id, nodes.get(id).snapshot().attributes); },
    reset() { writes.length = 0; },
  };
}

function render(view, ui, state, hud = UI.prototype.hud) {
  const previous = globalThis.document;
  globalThis.document = view.document;
  try { hud.call(ui, state); }
  finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
}
function state(values = {}) {
  return Object.assign(new Game().state, { phase: 'playing', speed: 30, distance: 500, elapsed: 20 }, values);
}
function traces() {
  const base = state();
  return [
    ['playing', base],
    ['paused', { ...base, phase: 'paused' }],
    ['new run', state({ elapsed: 0, speed: 0, distance: 0, score: 0 })],
    ['start moving', state({ speed: 5.01, distance: 15.01, elapsed: 10.01, combo: 2, score: 9.9 })],
    ['boost', state({ boosting: true, nitro: 59.987654321, combo: 5, score: 12345.99 })],
    ['braking', state({ boosting: true, braking: true })],
    ['no energy', state({ nitro: 0 })],
    ['low energy', state({ nitro: 1 })],
    ['flight ready', state({ flightReady: true })],
    ['takeoff', state({ flying: true, altitude: .051, verticalSpeed: .051, thrusterPower: .76543 })],
    ['flying', state({ flying: true, altitude: 3.456, throttle: 1, verticalSpeed: 1.567, rollReady: true })],
    ['roll', state({ flying: true, altitude: 4.5, rolling: true, rollAngle: Math.PI / 7, rollReady: true })],
    ['paused roll', state({ phase: 'paused', flying: true, altitude: 4.5, rolling: true, rollAngle: -Math.PI })],
    ['roll completion', state({ flying: true, altitude: 4.5, rolling: true, rollAngle: Math.PI * 2 })],
    ['roll cooldown', state({ flying: true, altitude: 4.5, rollCooldown: 1.01 })],
    ['roll energy', state({ flying: true, altitude: 4.5, nitro: 1 })],
    ['landing', state({ landing: true, altitude: .1, verticalSpeed: -1.234, thrusterPower: 1 })],
    ['residual descent', state({ altitude: .051, verticalSpeed: -.049, thrusterPower: .0049 })],
    ['touchdown', state({ flightCooldown: 1.01, verticalSpeed: 0 })],
    ['cooled down', state({ flightCooldown: 0, flightReady: true })],
    ['checkpoint', state({ roadEvent: { type: 'checkpoint', title: 'Контрольная точка', hint: 'Между флагами', seconds: 2.01, remaining: 25.01 } })],
    ['checkpoint final second', state({ roadEvent: { type: 'checkpoint', title: 'Контрольная точка', hint: 'Между флагами', seconds: .001, remaining: -.01 } })],
    ['convoy', state({ roadEvent: { type: 'convoy', title: 'Колонна', hint: 'Обойди машины', carsLeft: 3 } })],
    ['roadworks', state({ roadEvent: { type: 'roadworks', title: 'Ремонт', hint: 'Обойди ограждения', remaining: 10.5 } })],
    ['event failure', state({ lastEvent: { title: 'Контрольная точка', success: false, until: 21 } })],
    ['expired failure', state({ lastEvent: { title: 'Контрольная точка', success: false, until: 20 } })],
    ['successful event', state({ lastEvent: { title: 'Контрольная точка', success: true, until: 21 } })],
    ['goal approach', state({ distance: 1499.99999 })],
    ['goal reached', state({ distance: 1500, goalReached: true, score: 98765 })],
    ['endless run', state({ distance: 2555.5, goalReached: true })],
    ['non-flight vehicle', state({ flightAllowed: false })],
    ['new run after modes', state({ elapsed: 0, speed: 0, distance: 0, nitro: 60 })],
  ];
}

test('HUD preserves all recorded DOM values and accessibility attributes across gameplay transitions', () => {
  for (const serializeStyles of [false, true]) {
    const current = recorder({ serializeStyles }), original = recorder({ serializeStyles });
    const ui = Object.create(UI.prototype), baseline = {};
    for (const [label, snapshot] of traces()) {
      const unchanged = structuredClone(snapshot);
      render(original, baseline, snapshot, baselineHud);
      render(current, ui, snapshot);
      assert.deepEqual(current.snapshot(), original.snapshot(), label + ': complete recorded DOM parity');
      assert.deepEqual(snapshot, unchanged, label + ': no simulation mutation');
      current.reset(); render(current, ui, snapshot);
      assert.equal(current.writes.length, 0, label + ': warmed snapshot has zero writes');
    }
  }
});

test('120 identical playing or paused frames eliminate all 4560 baseline writes', () => {
  for (const phase of ['playing', 'paused']) {
    const snapshot = state({ phase }), current = recorder(), original = recorder();
    const ui = Object.create(UI.prototype), baseline = {};
    render(current, ui, snapshot); render(original, baseline, snapshot, baselineHud);
    current.reset(); original.reset();
    for (let frame = 0; frame < 120; frame++) {
      render(current, ui, snapshot); render(original, baseline, snapshot, baselineHud);
    }
    assert.equal(original.writes.length, 4560, phase + ': measured original setters');
    assert.ok(original.writes.every(write => write.same), phase + ': all original writes were redundant');
    assert.equal(original.writes.filter(write => write.name === 'textContent').length, 1920);
    assert.equal(current.writes.length, 0, phase + ': no DOM setters after warmup');
    assert.deepEqual(current.snapshot(), original.snapshot());
  }
});

test('fractional gauges and SVG needle retain exact input precision on every changed frame', () => {
  const current = recorder(), original = recorder(), ui = Object.create(UI.prototype), baseline = {};
  for (let frame = 0; frame < 120; frame++) {
    const snapshot = state({ speed: 30 + frame * 1e-7, distance: 500 + frame * 1e-7, nitro: 60 - frame * 1e-7 });
    render(current, ui, snapshot); render(original, baseline, snapshot, baselineHud);
    assert.deepEqual(current.snapshot(), original.snapshot(), 'sub-display frame ' + frame);
    assert.equal(current.node('challengeProgress').style.width, clamp(snapshot.distance / CONFIG.goal * 100, 0, 100) + '%');
    assert.equal(current.node('nitroFill').style.width, snapshot.nitro + '%');
    assert.equal(current.node('mobileGoalRail').style.getPropertyValue('--goal-progress'), String(snapshot.distance / CONFIG.goal));
    if (frame) {
      assert.ok(current.writes.some(write => write.id === 'speedNeedle'), 'needle changes immediately');
      assert.ok(current.writes.some(write => write.id === 'nitroFill'), 'reserve changes immediately');
      assert.ok(current.writes.some(write => write.id === 'challengeProgress'), 'progress changes immediately');
    }
    current.reset();
  }
});

test('CSS serialization does not cause repeated writes or hide subsequent style changes', () => {
  const current = recorder({ serializeStyles: true }), original = recorder({ serializeStyles: true });
  const ui = Object.create(UI.prototype), baseline = {}, snapshot = state({ nitro: 59.987654321, distance: 501.23456789 });
  render(current, ui, snapshot); render(original, baseline, snapshot, baselineHud);
  assert.notEqual(current.node('nitroFill').style.width, snapshot.nitro + '%', 'fixture normalizes CSS values');
  current.reset();
  for (let frame = 0; frame < 120; frame++) render(current, ui, snapshot);
  assert.equal(current.writes.length, 0);
  for (const view of [current, original]) {
    view.node('nitroFill').style.width = '1%';
    view.node('challengeProgress').style.width = '2%';
    view.node('mobileGoalRail').style.setProperty('--goal-progress', '0');
  }
  render(current, ui, snapshot); render(original, baseline, snapshot, baselineHud);
  assert.deepEqual(current.snapshot(), original.snapshot(), 'modified style values are restored');
  current.reset();
  snapshot.nitro -= 1e-7;
  render(current, ui, snapshot); render(original, baseline, snapshot, baselineHud);
  assert.ok(current.writes.some(write => write.id === 'nitroFill' && write.value === snapshot.nitro + '%'), 'changed input still reaches CSSOM without quantization');
  assert.deepEqual(current.snapshot(), original.snapshot());
});

test('guards read actual elements rather than skipping changed labels, ARIA, flags or replacements', () => {
  const current = recorder(), original = recorder(), ui = Object.create(UI.prototype), baseline = {}, snapshot = state();
  render(current, ui, snapshot); render(original, baseline, snapshot, baselineHud);
  for (const view of [current, original]) {
    view.node('score').textContent = 'stale';
    view.node('mobileGoalRail').setAttribute('aria-valuenow', '-1');
    view.node('boostBtn').dataset.boostState = 'stale';
    view.node('boostBtn').disabled = true;
    view.node('combo').hidden = false;
    view.replace('nitroFill');
  }
  render(current, ui, snapshot); render(original, baseline, snapshot, baselineHud);
  assert.deepEqual(current.snapshot(), original.snapshot());
  current.reset(); render(current, ui, snapshot);
  assert.equal(current.writes.length, 0);
});

// Verbatim pre-optimization HUD from the accepted PR8 source (ui.js SHA-256
// 1b3042d49f0a6f36854bdc5033260cb5345408419c87d1ed750c876240421f7f).
// Only its method wrapper is renamed; this independent oracle freezes all value expressions.
function baselineHud(s) {
    byId('score').textContent = String(Math.floor(s.score)).padStart(5, '0');
    byId('speed').textContent = String(Math.round(s.speed * 3.6));
    byId('distance').textContent = formatNumber(s.distance) + ' м';
    byId('challengeProgress').style.width = clamp(s.distance / CONFIG.goal * 100, 0, 100) + '%';
    byId('challengeTitle').textContent = s.goalReached ? 'Цель выполнена' : 'Цель: проехать 1 500 м';
    byId('combo').hidden = s.combo <= 1;
    byId('combo').textContent = '×' + s.combo;
    const dialSpeed=clamp(s.speed*3.6/300,0,1);
    byId('speedNeedle').setAttribute('transform','rotate('+(-90+dialSpeed*180)+' 110 120)');
    byId('speedArc').style.strokeDashoffset=String(100-dialSpeed*100);
    const gauges = hudGaugePresentation(s);
    if (this.reserveLevel !== gauges.reserveLevel) {
      for (const id of ['boostBtn', 'flightBtn']) byId(id).style.setProperty('--reserve-level', String(gauges.reserveLevel));
      this.reserveLevel = gauges.reserveLevel;
    }
    byId('sharedEnergyStatus').textContent = gauges.reserveText;
    const rail = byId('mobileGoalRail');
    rail.style.setProperty('--goal-progress', String(gauges.progress));
    rail.dataset.complete = String(gauges.complete);
    rail.setAttribute('aria-valuemax', String(CONFIG.goal));
    rail.setAttribute('aria-valuenow', String(gauges.value));
    rail.setAttribute('aria-valuetext', gauges.goalText);
    byId('nitroValue').textContent = Math.round(s.nitro) + '%';
    byId('nitroFill').style.width = s.nitro + '%';
    byId('boostBtn').disabled = s.nitro <= 0;
    const boost = boostPresentation(s);
    byId('boostBtn').dataset.boostState = boost.mode;
    byId('boostStatus').textContent = boost.label;
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
    // Keep live instructions and failures, not a second text reward banner.
    const e=s.roadEvent, last=s.lastEvent?.until>s.elapsed&&!s.lastEvent.success?s.lastEvent:null;
    byId('eventBanner').hidden=!e&&!last;
    const title=e?.title||(last?'Не пройдено: '+last.title:'');
    if(byId('eventTitle').textContent!==title)byId('eventTitle').textContent=title;
    byId('eventHint').textContent=e?.hint||'Следующее событие впереди.';
    byId('eventMeter').textContent=e?(e.type==='convoy'?e.carsLeft+' авто':(e.type==='checkpoint'?Math.ceil(e.seconds)+' с · ':'')+Math.max(0,Math.ceil(e.remaining))+' м'):'';
  }
