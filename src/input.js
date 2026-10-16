const actions = Object.freeze({ ArrowLeft:'left', KeyA:'left', ArrowRight:'right', KeyD:'right', ArrowUp:'gas', KeyW:'gas', ArrowDown:'brake', KeyS:'brake', Space:'boost' });
export class DrivingInput {
  constructor() { this.held = new Map(); }
  set(action, source, down) {
    if (!['left','right','gas','brake','boost'].includes(action)) return;
    if (down) this.held.set(source, action); else this.held.delete(source);
  }
  key(code, down) {
    if (!actions[code]) return false;
    this.set(actions[code], code, down); return true;
  }
  active(action) { return [...this.held.values()].includes(action); }
  read() { return { steer:Number(this.active('right'))-Number(this.active('left')), throttle:Number(this.active('gas')), brake:Number(this.active('brake')), boost:this.active('boost') }; }
  clear() { this.held.clear(); }
}
