/** Fit only compact Results into its real, transparent stage. The presenter
 * reserves this region between stats and retry, beside the decision panel.
 * Desktop, HOME, driving and unavailable/malformed layout keep their cameras.
 * Coordinates are CSS pixels in the game iframe, never physical screen pixels. */
export function resultsVehicleFraming({width,height,stage}) {
  if(![width,height].every(n=>Number.isFinite(n)&&n>0)||width<=height||width>1100||height>620)return null;
  if(!stage||![stage.x,stage.y,stage.width,stage.height].every(Number.isFinite)||stage.width<=0||stage.height<=0)return null;
  const inset=2,x=Math.max(inset,stage.x+inset),y=Math.max(inset,stage.y+inset);
  const right=Math.min(width-inset,stage.x+stage.width-inset),bottom=Math.min(height-inset,stage.y+stage.height-inset);
  if(right-x<40||bottom-y<40)return null;
  return{x,y,width:right-x,height:bottom-y};
}
