import test from 'node:test';
import assert from 'node:assert/strict';
import { updateChase } from '../src/motion.js';

const driving={speed:28,boosting:false,lateralAcceleration:2.5,acceleration:1.8};
/** Return an independent chase pose already settled into the active driving preset. */
const drivingView=()=>updateChase({},driving);

test('menu presentation returns from a paused run without advancing gameplay state',()=>{
  for(const phone of [false,true]){
    const state={...driving,distance:125,elapsed:6.2,phase:'playing'},before=structuredClone(state),view=drivingView();
    const target=updateChase({},state,{menu:true,phone});
    for(let frame=0;frame<240;frame++)updateChase(view,state,{phone,menu:true,paused:true,dt:1/60});
    for(const key of Object.keys(target))assert.ok(Math.abs(view[key]-target[key])<.005,`${key}: return to menu target`);
    assert.deepEqual(state,before,'Presentation never mutates the run or its elapsed distance/time');
  }
});

test('reduced-motion menu snaps into the correct pose before its static-frame optimization',()=>{
  const view=drivingView(),target=updateChase({},driving,{menu:true});
  updateChase(view,driving,{menu:true,paused:true,reducedMotion:true,dt:0});
  assert.deepEqual(view,target,'The single reduced-motion menu frame has the complete target pose');
});

test('the shared paused-gameplay flag retains all camera pose fields',()=>{
  for(const reducedMotion of [false,true]){
    const view=drivingView(),before={...view};
    for(let frame=0;frame<120;frame++)updateChase(view,{speed:50,boosting:true,lateralAcceleration:-4,acceleration:-6},{menu:false,paused:true,reducedMotion,dt:.1});
    assert.deepEqual(view,before,'An external pause is not mistaken for a menu presentation');
  }
});
