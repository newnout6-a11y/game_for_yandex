import test from 'node:test';
import assert from 'node:assert/strict';
import { DrivingInput } from '../src/input.js';
import { updateChase } from '../src/motion.js';
test('keyboard aliases, opposite steering and simultaneous pedals remain independent',()=>{
  const input=new DrivingInput();input.key('KeyW',true);input.key('ArrowUp',true);input.key('KeyW',false);assert.equal(input.read().throttle,1);
  input.key('KeyA',true);input.key('KeyD',true);assert.equal(input.read().steer,0);input.key('KeyD',false);assert.equal(input.read().steer,-1);
  input.key('KeyS',true);assert.equal(input.read().brake,1);assert.equal(input.key('Escape',true),false);
});
test('multitouch releases only its own input; cancellation clears every held control',()=>{
  const input=new DrivingInput();input.set('gas','pointer-1',true);input.set('left','pointer-2',true);input.set('boost','pointer-3',true);
  input.set('left','pointer-2',false);assert.equal(input.read().throttle,1);assert.equal(input.read().boost,true);assert.equal(input.read().steer,0);
  input.clear();assert.deepEqual(input.read(),{steer:0,throttle:0,brake:0,boost:false,flight:false,roll:0});
});
test('chase camera is independent of steering, lane and lateral position',()=>{
  const left={},right={};for(let i=0;i<60;i++){updateChase(left,{speed:30,x:0,heading:-.2,steerAngle:-.3},{dt:1/60});updateChase(right,{speed:30,x:2,heading:.2,steerAngle:.3},{dt:1/60});}assert.deepEqual(left,right);assert.equal(left.x,0);assert.equal(left.lookX,0);
});
test('camera transitions are smooth and consistent at 30, 60 and 120 Hz',()=>{
  const views=[30,60,120].map(hz=>{const v={};updateChase(v,{speed:0},{menu:true});const x=v.x;updateChase(v,{speed:30},{dt:1/hz});assert.ok(Math.abs(v.x-x)<1);for(let i=1;i<hz;i++)updateChase(v,{speed:30},{dt:1/hz});return v;});
  for(const key of Object.keys(views[0]))assert.ok(Math.abs(views[0][key]-views[2][key])<1e-8,key);
  const v={};updateChase(v,{speed:30});const before=v.fov;updateChase(v,{speed:30,boosting:true},{dt:1/60});assert.ok(v.fov>before&&v.fov-before<.1);
});
