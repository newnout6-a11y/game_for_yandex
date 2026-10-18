import { COSMETICS } from './progression-catalog.js';
import { PROFILE_VERSION, LIMITS, createProfile, sanitizeProfile, migrateLegacyProfile, reduceProgression } from './progression.js';

export const PROGRESSION_STORAGE_KEY = 'aerokrai.profile.v2';
export const PROGRESSION_BACKUP_KEY = 'aerokrai.profile.v2.backup';
export const LEGACY_STORAGE_KEY = 'potok.v1';
/** Return the actual UTF-8 payload size, not its potentially smaller JavaScript character count. */
const byteLength = text => new TextEncoder().encode(text).byteLength;
/** Parse bounded local JSON, distinguishing corrupt data from a future schema that must remain untouched. */
function decode(text,options) {
  if(typeof text!=='string'||!text)return {kind:'missing'};
  let raw;try{raw=JSON.parse(text);}catch{return {kind:'corrupt',reason:'invalid-json'};}
  if(Number.isInteger(raw?.schemaVersion)&&raw.schemaVersion>PROFILE_VERSION)return {kind:'future',version:raw.schemaVersion};
  if(byteLength(text)>LIMITS.profileBytes)return {kind:'corrupt',reason:'profile-too-large'};
  const p=raw?.schemaVersion===1?(raw.wallet?sanitizeProfile({...raw,schemaVersion:PROFILE_VERSION}):migrateLegacyProfile(raw,options)):sanitizeProfile(raw);
  return p?{kind:'valid',profile:p,migrated:raw.schemaVersion!==PROFILE_VERSION}:{kind:'corrupt',reason:'invalid-schema'};
}
/**
 * Own a local profile with explicit persistence status. This adapter makes no server-durability,
 * cross-device atomicity or identity-merging promise; platform/cloud policy belongs to its caller.
 * `provider` may be a Storage object or a lazy function returning one. No SDK calls occur here.
 */
export function createProgressionStorage({provider=()=>globalThis.localStorage,now=()=>Date.now(),idFactory=()=>globalThis.crypto?.randomUUID?.()||`local_${Date.now()}_${Math.random().toString(36).slice(2)}`,capabilities={}}={}) {
  let source=null,previousValid=null,data;
  const state={localSaved:false,readOnly:false,recovered:false,migrated:false,source:'new',error:null,backupError:null,cloud:'not-managed',futureVersion:null};
  /** Obtain a finite timestamp even when an injected environment clock is unavailable. */
  function timestamp(){try{const value=now();return Number.isFinite(value)&&value>=0?Math.floor(value):0;}catch{return 0;}}
  /** Obtain a safe local ID; external identity is never inferred from this identifier. */
  function newId(){try{const value=idFactory();if(typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value)&&!['constructor','prototype','__proto__'].includes(value))return value;}catch{/* Fall through to a non-secret local identifier. */}return `local_${timestamp()}`;}
  const options={now:timestamp(),id:newId()};data=createProfile(options);
  try{source=typeof provider==='function'?provider():provider;if(!source||typeof source.getItem!=='function'||typeof source.setItem!=='function')throw new Error('storage-unavailable');const current=decode(source.getItem(PROGRESSION_STORAGE_KEY),options);
    if(current.kind==='future'){state.readOnly=true;state.source='future';state.futureVersion=current.version;state.error='future-version';}
    else if(current.kind==='valid'){data=current.profile;previousValid=JSON.stringify(data);state.localSaved=true;state.source='local';state.migrated=current.migrated;}
    else {const backup=decode(source.getItem(PROGRESSION_BACKUP_KEY),options);if(backup.kind==='future'){state.readOnly=true;state.source='future-backup';state.futureVersion=backup.version;state.error='future-version';}
      else if(backup.kind==='valid'){data=backup.profile;previousValid=JSON.stringify(data);state.recovered=true;state.source='backup';state.error=current.reason||null;}
      else {const legacy=source.getItem(LEGACY_STORAGE_KEY);if(legacy){try{const raw=JSON.parse(legacy);if(raw&&typeof raw==='object'&&!Array.isArray(raw)){data=migrateLegacyProfile(raw,options);state.migrated=true;state.source='legacy';}}catch{/* Keep a fresh profile; legacy content is left untouched. */}}
        if(current.kind==='corrupt'||backup.kind==='corrupt'){state.recovered=true;state.error=current.reason||backup.reason;}}
    }
  }catch(error){state.error=error?.name==='SecurityError'?'storage-denied':'storage-unavailable';}
  /** Write a previous-valid backup before the current snapshot, exposing quota/private-mode failures. */
  function persist(){if(state.readOnly)return false;const payload=JSON.stringify(data);if(byteLength(payload)>LIMITS.profileBytes){state.localSaved=false;state.error='profile-too-large';return false;}if(!source){state.localSaved=false;state.error='storage-unavailable';return false;}state.backupError=null;
    if(previousValid&&previousValid!==payload){try{source.setItem(PROGRESSION_BACKUP_KEY,previousValid);}catch(error){state.backupError=error?.name||'backup-write-failed';}}
    try{source.setItem(PROGRESSION_STORAGE_KEY,payload);previousValid=payload;state.localSaved=true;state.error=null;return true;}catch(error){state.localSaved=false;state.error=error?.name==='QuotaExceededError'?'storage-quota':'storage-write-failed';return false;}
  }
  /** Apply an economy action atomically in memory, then report whether its snapshot actually persisted. */
  function dispatch(action){if(state.readOnly)return {ok:false,changed:false,reason:'future-version-read-only',profile:structuredClone(data),persistence:status()};const result=reduceProgression(data,action,{now:timestamp(),capabilities});if(result.ok&&result.changed){data=result.profile;persist();}return {...result,profile:structuredClone(data),persistence:status()};}
  /** Return a detached status record without overstating local saves as cloud acknowledgements. */
  function status(){return structuredClone(state);}
  // Materialize a new or migrated local profile once, while never overwriting a future schema.
  if(!state.readOnly&&(!state.localSaved||state.migrated))persist();
  return {
    /** Return a detached profile; changes made by UI code cannot alter the stored wallet. */
    get:()=>structuredClone(data),dispatch,status,
    /** Enable only named authored capabilities after the renderer verifies its assets; ownership is unchanged. */
    setCapabilities(next){if(!next||typeof next!=='object'||Array.isArray(next)||![Object.prototype,null].includes(Object.getPrototypeOf(next)))return {ok:false,reason:'invalid-capabilities'};const supported=new Set(COSMETICS.map(item=>item.requiredCapability).filter(Boolean));capabilities=Object.fromEntries(Object.entries(next).filter(([key,value])=>supported.has(key)&&value===true));return {ok:true,capabilities:{...capabilities}};},
    /** Return current authored capability gates as an independent view for the garage presenter. */
    getCapabilities:()=>({...capabilities}),
    /** Allocate and persist a monotonic sequence before a simulation begins, finalizing any prior run. */
    beginRun(options={}){return dispatch({...options,type:'BEGIN_RUN',runId:newId()});},
    /** Commit only positive cumulative reward/stat differences for the currently active run receipt. */
    settleRun(run,telemetry,{finalized=false}={}){return dispatch({type:'SETTLE_RUN',run,telemetry,finalized});},
    /** Finalize without awarding unobserved metrics; repeat settlement of this sequence is thereafter rejected. */
    finalizeRun(run){return dispatch({type:'FINALIZE_RUN',runId:run?.id,runSequence:run?.sequence});},
    /**
     * Replace, never merge, an explicitly selected cloud snapshot after the caller resolves identity/conflict.
     * Raw unknown versions and malformed wallet values are rejected, preserving the existing local profile.
     */
    replaceFromCloud(raw){if(state.readOnly)return {ok:false,changed:false,reason:'future-version-read-only',profile:structuredClone(data),persistence:status()};if(raw?.schemaVersion!==PROFILE_VERSION||!Number.isSafeInteger(raw?.wallet?.credits)||raw.wallet.credits<0||raw.wallet.credits>LIMITS.credits)return {ok:false,changed:false,reason:'invalid-cloud-profile',profile:structuredClone(data),persistence:status()};const replacement=sanitizeProfile(raw);if(!replacement||byteLength(JSON.stringify(replacement))>LIMITS.profileBytes)return {ok:false,changed:false,reason:'invalid-cloud-profile',profile:structuredClone(data),persistence:status()};data=replacement;state.source='cloud-replacement';persist();return {ok:true,changed:true,profile:structuredClone(data),persistence:status()};},
    /** Retry a failed local write without repeating a purchase, claim, settlement or revision increment. */
    flush(){persist();return status();},
  };
}
