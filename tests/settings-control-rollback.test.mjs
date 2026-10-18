import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GarageUI } from '../src/garage-ui.js';
import { createProgressionStorage, PROGRESSION_STORAGE_KEY } from '../src/progression-storage.js';
import { deriveGarageView } from '../src/progression.js';
import { CATALOG } from '../src/progression-catalog.js';
import { createStorage } from '../src/storage.js';
import { normalizeRenderQuality } from '../src/render-settings.js';

/** Model native controls changing before their change event, including select option values. */
class NativeNode {
  constructor(doc, tag) {
    this.ownerDocument=doc;this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;
    this.dataset={};this.attributes={};this.style={setProperty(key,value){this[key]=value;}};
    this.className='';this.listeners={};this._text='';this._value=undefined;this.checked=false;this.disabled=false;
    this.classList={add:value=>{this.className+=` ${value}`;},remove:value=>{this.className=this.className.split(' ').filter(item=>item!==value).join(' ');}};
  }
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set value(value){this._value=String(value);}
  get value(){return this._value??(this.tagName==='SELECT'?(this.children.find(option=>option.selected)||this.children[0])?.value:'')??'';}
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
  prepend(...nodes){for(const node of nodes)node.parentElement=this;this.children.unshift(...nodes);}
  replaceChildren(...nodes){for(const child of this.children)child.parentElement=null;this.children=[];this._text='';this.append(...nodes);}
  setAttribute(key,value){this.attributes[key]=String(value);if(key==='id')this.id=String(value);}
  getAttribute(key){return this.attributes[key]??null;}
  addEventListener(key,handler){this.listeners[key]=handler;}
  removeEventListener(key){delete this.listeners[key];}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  focus(){this.ownerDocument.activeElement=this;}
  /** Support the presenter's scoped selectors and focus restoration without substituting its UI. */
  matches(selector){
    if(selector.includes(':not(:disabled)')&&this.disabled)return false;
    const segments=selector.replaceAll(':not(:disabled)','').trim().split(/\s+/),last=segments.pop();
    const tag=last.match(/^[\w-]+/)?.[0];if(tag&&this.tagName!==tag.toUpperCase())return false;
    const cls=last.match(/\.([\w-]+)/)?.[1];if(cls&&!this.className.split(' ').includes(cls))return false;
    const id=last.match(/#([\w-]+)/)?.[1];if(id&&this.id!==id)return false;
    const attr=last.match(/\[([^=\]]+)(?:="([^"]*)")?\]/);
    if(attr){const value=attr[1].startsWith('data-')?this.dataset[attr[1].slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]:this.attributes[attr[1]];if(value==null||attr[2]!==undefined&&value!==attr[2])return false;}
    if(segments.length){let parent=this.parentElement;while(parent&&!parent.matches(segments.join(' ')))parent=parent.parentElement;if(!parent)return false;}
    return true;
  }
  closest(selector){return this.matches(selector)?this:this.parentElement?.closest(selector)||null;}
  querySelectorAll(selector){const selectors=selector.split(','),result=[];for(const child of this.children){if(selectors.some(value=>child.matches(value)))result.push(child);result.push(...child.querySelectorAll(selector));}return result;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}

const controllerSource=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
/** Extract complete production functions; the test must fail if rejection handling is removed. */
function controllerFunction(name){
  const pattern=new RegExp(`(?:async )?function ${name}\\(`),start=controllerSource.search(pattern);
  assert.notEqual(start,-1,`Missing production controller function ${name}`);
  const end=controllerSource.indexOf('\n/**',start);
  assert.notEqual(end,-1,`Missing boundary after production controller function ${name}`);
  return controllerSource.slice(start,end);
}

/** Wire the real presenter and controller to a genuinely read-only future-version profile. */
function harness(){
  const future=JSON.stringify({schemaVersion:999,unknown:'preserve this newer save'}),values=new Map([[PROGRESSION_STORAGE_KEY,future]]),writes=[];
  const provider={getItem:key=>values.get(key)??null,setItem(key,value){writes.push({key,value});values.set(key,value);}};
  const profileStore=createProgressionStorage({provider}),storage=createStorage(()=>provider);
  assert.equal(profileStore.status().readOnly,true);
  const settings={...storage.get(),...profileStore.get().settings},cloudSaves=[];
  const doc={activeElement:null,createElement(tag){return new NativeNode(this,tag);},createElementNS(_ns,tag){return new NativeNode(this,tag);}};
  const root=new NativeNode(doc,'div'),legacyQuality=new NativeNode(doc,'select');legacyQuality.value=settings.renderQuality;
  let controller,pending;
  const garageUI=new GarageUI({root,onAction:action=>{pending=controller.handleGarageAction(action);}});
  const functions=['refreshGarage','changed','updateSettings','hydrateStoredSettings','handleGarageAction'].map(controllerFunction).join('\n');
  const qualityStart=controllerSource.indexOf("byId('renderQuality').addEventListener('change', event => {");
  assert.notEqual(qualityStart,-1,'Missing production legacy quality listener');
  const qualityEnd=controllerSource.indexOf('\n});',qualityStart);assert.notEqual(qualityEnd,-1);
  const qualityListener=controllerSource.slice(qualityStart,qualityEnd+4);
  controller=new Function('environment',`
    const {profileStore,storage,settings,garageUI,legacyQuality,cloudSaves,deriveGarageView,CATALOG,normalizeRenderQuality}=environment;
    const byId=id=>{if(id!=='renderQuality')throw new Error('Unexpected element '+id);return legacyQuality;};
    const platform={getState:()=>({}),queueSave:profile=>cloudSaves.push(structuredClone(profile))},sdk={get:()=>null},ads={available:false};
    const renderer={setQuality(){},setCameraMode(){},setRoute(){}},audio={enabled:settings.sound},ui={sound(){}};
    let orientationBlocked=false,busy=false,assetsReady=false,garageScene=null,screen='hub',tab='fleet',inspection='overview';
    let previewId=profileStore.get().selectedVehicleId,loading={},runResult=null,otherGames=[],garageDirty=false;
    let appliedSelectedId=previewId,appliedSettingsKey=JSON.stringify(profileStore.get().settings);
    ${functions}
    ${qualityListener}
    return {handleGarageAction,updateSettings,refreshGarage};
  `)({profileStore,storage,settings,garageUI,legacyQuality,cloudSaves,deriveGarageView,CATALOG,normalizeRenderQuality});
  garageUI.settingsOpen=true;controller.refreshGarage();
  const initial={profile:profileStore.get(),settings:structuredClone(settings),legacy:storage.get(),values:[...values]};
  return {root,doc,garageUI,profileStore,storage,settings,legacyQuality,writes,cloudSaves,values,initial,controller,
    async changeNative(key,attempted){
      const input=root.querySelector(`[data-gs-setting="${key}"]`);assert.ok(input);input.focus();
      if(input.type==='checkbox')input.checked=attempted;else input.value=attempted;
      garageUI.handleChange({target:input});await pending;return input;
    }};
}

/** Rejection must preserve every accepted store and never create a cloud write or downgrade. */
function assertNoMutation(h){
  assert.deepEqual(h.profileStore.get(),h.initial.profile);assert.deepEqual(h.settings,h.initial.settings);
  assert.deepEqual(h.storage.get(),h.initial.legacy);assert.deepEqual([...h.values],h.initial.values);
  assert.equal(h.writes.length,0);assert.equal(h.cloudSaves.length,0);
  assert.match(h.garageUI.noticeText,/более новой версией/);
}

for(const control of [
  {key:'sound',attempted:true,accepted:false},
  {key:'renderQuality',attempted:'ultra',accepted:'auto'},
  {key:'runMode',attempted:'tuned',accepted:'standard'},
])test(`a rejected garage ${control.key} change redraws its authoritative native control`,async()=>{
  const h=harness(),oldInput=await h.changeNative(control.key,control.attempted);
  const current=h.root.querySelector(`[data-gs-setting="${control.key}"]`);
  assert.ok(current);assert.equal(h.root.contains(oldInput),false,'rejected native state must not remain mounted');
  assert.equal(current.type==='checkbox'?current.checked:current.value,control.accepted);
  assert.equal(h.doc.activeElement,current,'redrawing the rejected setting must preserve keyboard focus');
  assertNoMutation(h);
});

test('a rejected legacy quality change resets the select after its native value already changed',()=>{
  const h=harness();h.legacyQuality.value='ultra';
  h.legacyQuality.listeners.change({target:h.legacyQuality});
  assert.equal(h.legacyQuality.value,'auto');assertNoMutation(h);
});
