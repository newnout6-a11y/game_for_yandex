import test from 'node:test';
import assert from 'node:assert/strict';
import {UI} from '../src/ui.js';
function withDocument(nodes,fn){const previous=globalThis.document;globalThis.document={getElementById:id=>nodes[id]||null};try{return fn();}finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}}
function button(){return{attributes:{},textContent:'',innerHTML:'',setAttribute(k,v){this.attributes[k]=v;}};}
test('only the mobile pause dialog renders real reachable sound/help action buttons',()=>{
 for(const mobile of [true,false])for(const enabled of [true,false]){
  const ui=Object.create(UI.prototype);ui.app={dataset:{mobileControls:String(mobile)}};ui.soundEnabled=enabled;ui.cameraMode='chase';ui.renderSettingsElement={};let html,appended;
  ui.open=(type,markup)=>{assert.equal(type,'pause');html=markup;};
  withDocument({pauseRenderSettings:{append(node){appended=node;}}},()=>ui.pause());
  assert.equal(appended,ui.renderSettingsElement);assert.match(html,/data-action="resume"/);assert.match(html,/data-action="camera"/);
  if(mobile){assert.match(html,/data-action="pauseHelp">Управление/);assert.match(html,new RegExp('id="pauseSoundBtn"[^>]*aria-pressed="'+enabled+'"'));assert.match(html,/aria-label="(?:Включить|Выключить) звук"/);}
  else assert.doesNotMatch(html,/pauseSound|pauseHelp|pause-mobile-utilities/);
 }
});
test('accepted sound state updates mounted pause button without rebuilding or losing its focus',()=>{
 const ui=Object.create(UI.prototype),sound=button(),pause=button();
 for(const enabled of [true,false])withDocument({soundBtn:sound,pauseSoundBtn:pause},()=>{
  ui.sound(enabled);assert.equal(ui.soundEnabled,enabled);
  assert.equal(pause.attributes['aria-pressed'],String(enabled));assert.equal(sound.attributes['aria-pressed'],String(enabled));
  assert.equal(pause.attributes['aria-label'],enabled?'Выключить звук':'Включить звук');
  assert.equal(pause.textContent,'Звук: '+(enabled?'включён':'выключен'));assert.match(sound.innerHTML,/<svg/);
 });
 withDocument({soundBtn:sound},()=>ui.sound(true));assert.equal(ui.soundEnabled,true);
});

test('one Escape returns Help to Pause and held repeats cannot resume the run',()=>{
 const listeners={},overlay={hidden:false,addEventListener(type,fn){listeners[type]=fn;}},dialog={addEventListener(){}},nodes={app:{},overlay,dialog,renderSettings:{parentElement:{}}};
 const actions=[];let ui;withDocument(nodes,()=>{ui=new UI(action=>{actions.push(action);ui.modalType=action==='closeHelp'?'pause':null;});});ui.modalType='help';
 const fire=repeat=>{let prevented=false,stopped=false;listeners.keydown({key:'Escape',repeat,preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});assert.ok(prevented);assert.ok(stopped);};
 fire(false);assert.deepEqual(actions,['closeHelp']);assert.equal(ui.modalType,'pause');
 for(let i=0;i<4;i++)fire(true);assert.deepEqual(actions,['closeHelp']);assert.equal(ui.modalType,'pause');
 fire(false);assert.deepEqual(actions,['closeHelp','resume']);
});
