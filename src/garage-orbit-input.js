/** Own one captured pointer while inspecting the parked vehicle; never forward it to driving controls. */
export function bindGarageOrbitInput({element,window:win=globalThis.window,document:doc=globalThis.document,enabled,onOrbit}) {
  let pointer=null;
  /** Release only the owning gesture. Clearing state first makes lostcapture re-entry harmless. */
  function cancel(){const previous=pointer;pointer=null;if(previous&&element.hasPointerCapture?.(previous.id))element.releasePointerCapture(previous.id);}
  /** Accept primary-button drags only when the visible garage permits interaction. */
  function down(event){if(pointer||!enabled()||event.isPrimary===false||(event.button!=null&&event.button!==0))return;pointer={id:event.pointerId,x:event.clientX,y:event.clientY};element.setPointerCapture?.(event.pointerId);event.preventDefault();}
  /** Supply actual CSS-pixel deltas, preserving the same direction for mouse and touch. */
  function move(event){if(!pointer||event.pointerId!==pointer.id)return;if(!enabled()){cancel();return;}const dx=event.clientX-pointer.x,dy=event.clientY-pointer.y;pointer.x=event.clientX;pointer.y=event.clientY;if(Number.isFinite(dx)&&Number.isFinite(dy)&&(dx||dy))onOrbit(dx,dy);event.preventDefault();}
  /** An unrelated second finger must not release the first finger's inspection gesture. */
  function end(event){if(pointer&&event.pointerId===pointer.id)cancel();}
  /** Backgrounding cannot leave a stale grab that resumes on a later pointer move. */
  function visibility(){if(doc.hidden)cancel();}
  element.addEventListener('pointerdown',down);element.addEventListener('pointermove',move);element.addEventListener('lostpointercapture',end);
  win.addEventListener('pointerup',end);win.addEventListener('pointercancel',end);win.addEventListener('blur',cancel);doc.addEventListener('visibilitychange',visibility);
  return {cancel,get active(){return pointer!==null;},
    /** Remove every listener and release capture when the owning scene is destroyed. */
    dispose(){cancel();element.removeEventListener('pointerdown',down);element.removeEventListener('pointermove',move);element.removeEventListener('lostpointercapture',end);win.removeEventListener('pointerup',end);win.removeEventListener('pointercancel',end);win.removeEventListener('blur',cancel);doc.removeEventListener('visibilitychange',visibility);}};
}
