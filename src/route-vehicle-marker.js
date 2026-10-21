import * as T from '../public/vendor/three.js';
import { FleetMiniatures } from './garage-fleet-miniatures.js';
import { vehicleDefinition, cosmeticDefinition } from './progression-catalog.js';

// All prepared game vehicles have their nose at -Z. With this camera at -Z,
// positive yaw projects that nose to screen-right, slightly toward the viewer.
export const ROUTE_VEHICLE_YAW = Math.PI / 2 - .16;
const PITCH = .14;

/** A close, fixed three-quarter side fit, without changing any authored geometry. */
export function fitRouteVehicleCamera(camera, bounds, aspect, yaw = ROUTE_VEHICLE_YAW) {
  const half = bounds.getSize(new T.Vector3()).multiplyScalar(.5);
  const width = Math.abs(Math.cos(yaw)) * half.x + Math.abs(Math.sin(yaw)) * half.z;
  const depth = Math.abs(Math.sin(yaw)) * half.x + Math.abs(Math.cos(yaw)) * half.z;
  const height = half.y * Math.cos(PITCH) + depth * Math.sin(PITCH);
  const top = Math.max(height, width / aspect, .01) * 1.06;
  const distance = Math.max(8, bounds.getSize(new T.Vector3()).length() * 2);
  Object.assign(camera, { left: -top * aspect, right: top * aspect, top, bottom: -top, near: .05, far: distance * 2 });
  camera.position.set(0, Math.sin(PITCH) * distance, -Math.cos(PITCH) * distance);
  camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  return camera;
}

const identity = selection => selection ? JSON.stringify([selection.scopeKey, selection.id,
  Object.entries(selection.appearance || {}).sort(([a], [b]) => a.localeCompare(b))]) : '';

/**
 * One real selected-run clone, one bounded pixel cache, and the shared game GL
 * renderer. No road capture, animation loop, synthetic car or extra GL context.
 * FleetMiniatures owns its tiny HDR/readback pair and all async/lifecycle guards.
 */
export class RouteVehicleMarker {
  constructor({ renderer, makeVehicle, environment = null, canvas, element, label, status }) {
    this.canvas = canvas; this.element = element; this.label = label; this.status = status;
    this.selection = null; this.key = ''; this.disposed = false;
    this.miniature = new FleetMiniatures({ renderer, makeVehicle, environment,
      maxWidth: 160, maxHeight: 80, idleYaw: ROUTE_VEHICLE_YAW, fitCamera: fitRouteVehicleCamera,
      onChange: ({ id, canvas: target, status: state }) => {
        if (this.disposed || !this.selection || id !== this.selection.id || target !== this.canvas) return;
        this.showState(state);
      },
    });
    this.showState('loading');
  }

  showState(state) {
    this.element.dataset.state = state;
    // Never leave an old car/old paint visible while its replacement is pending.
    this.canvas.hidden = state !== 'ready';
    this.status.textContent = state === 'error' ? '!' : state === 'ready' ? '' : '…';
    this.status.hidden = state === 'ready';
    const car = vehicleDefinition(this.selection?.id), paint = cosmeticDefinition(this.selection?.appearance?.['body.paint']);
    const detail = car ? `Автомобиль заезда: ${car.nameRu}. Краска: ${paint?.nameRu || 'заводская'}. Направлен вправо, к флагу.` : 'Модель автомобиля заезда ещё не выбрана.';
    const suffix = state === 'error' ? ' Превью модели недоступно.' : state === 'loading' ? ' Модель загружается.' : '';
    this.label.textContent = detail + suffix;
    this.element.title = detail + suffix;
  }

  /** Only the accepted run vehicle and its equipped-at-start cosmetics belong here. */
  sync(selection) {
    if (this.disposed) return;
    const key = identity(selection);
    if (key === this.key) return;
    this.key = key;
    this.selection = selection ? { ...selection, appearance: { ...selection.appearance } } : null;
    this.element.dataset.vehicleId = selection?.id || '';
    this.element.dataset.paint = selection?.appearance?.['body.paint'] || 'stock';
    this.showState('loading');
    this.miniature.sync(selection ? [{ id: selection.id, appearance: this.selection.appearance, canvas: this.canvas }] : [],
      { scopeKey: selection?.scopeKey });
  }

  /** Activity can change between animation frames; late readbacks must see it immediately. */
  setActivity({ visible = false, paused = false } = {}) {
    this.miniature.visible = visible; this.miniature.paused = paused;
  }

  update(dt, { visible = false, paused = false } = {}) {
    return this.miniature.update(dt, { visible: visible && !!this.selection, paused, reducedMotion: true });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.miniature.dispose(); this.selection = null;
    this.canvas.hidden = true; this.status.hidden = true;
  }
}
