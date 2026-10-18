import test from 'node:test';
import assert from 'node:assert/strict';
import {DrivingInput} from '../src/input.js';

test('one-thumb analog source is bounded, independent from keys and cleared on lifecycle release',()=>{
 const input=new DrivingInput();input.setAnalog('thumb',{steer:.4,throttle:1,brake:0});assert.equal(input.read().steer,.4);assert.equal(input.read().throttle,1);
 input.key('KeyA',true);assert.equal(input.read().steer,-1);input.key('KeyA',false);assert.equal(input.read().steer,.4);
 input.setAnalog('thumb',{steer:Infinity,throttle:-1,brake:4});assert.equal(input.read().steer,0);assert.equal(input.read().brake,1);input.clear();assert.equal(input.read().brake,0);assert.equal(input.read().throttle,0);
});
