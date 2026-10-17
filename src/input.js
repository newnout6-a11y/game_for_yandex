const actions = Object.freeze({ ArrowLeft:'left', KeyA:'left', ArrowRight:'right', KeyD:'right', ArrowUp:'gas', KeyW:'gas', ArrowDown:'brake', KeyS:'brake', Space:'boost', KeyF:'flight', KeyQ:'rollLeft', KeyE:'rollRight' });
export class DrivingInput {
  constructor() { this.held = new Map(); }
  set(action, source, down) {
    if (!['left','right','gas','brake','boost','flight','rollLeft','rollRight'].includes(action)) return;
    if (down) this.held.set(source, action); else this.held.delete(source);
  }
  key(code, down) {
    if (!actions[code]) return false;
    this.set(actions[code], code, down); return true;
  }
  release(source) { this.held.delete(source); }
  active(action) { for (const held of this.held.values()) if (held === action) return true; return false; }
  read() { return { steer:Number(this.active('right'))-Number(this.active('left')), throttle:Number(this.active('gas')), brake:Number(this.active('brake')), boost:this.active('boost'), flight:this.active('flight'), roll:Number(this.active('rollRight'))-Number(this.active('rollLeft')) }; }
  clear() { this.held.clear(); }
}
