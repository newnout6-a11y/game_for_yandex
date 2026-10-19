/**
 * Fit the HOME showcase into the measured clear area beside the route selector
 * and entry actions. Rectangles are CSS pixels in the game's own
 * viewport, not the parent iframe or physical device screen. Normal desktop
 * and portrait layouts retain their existing camera; garage/driving never use
 * this function. The room-aware camera still performs the actual vehicle fit.
 */
export function homeVehicleFraming({width,height,header,route,label,actions,footer}) {
  if (![width,height].every(value=>Number.isFinite(value)&&value>0)) return null;
  if (!(width>height && (height<=620 || width<=900))) return null;
  if (![header,route,label,actions,footer].every(rect=>rect && [rect.x,rect.y,rect.width,rect.height].every(Number.isFinite))) return null;
  const edge=14,gap=8;
  const x=Math.max(edge,route.x+route.width+gap);
  const y=Math.max(header.y+header.height+gap,label.y+label.height+gap);
  const right=width-edge,bottom=Math.min(height-edge,actions.y-gap);
  // Compact actions leave the lower-right stage usable too. Keep the complete
  // vehicle to their right instead of reserving an obsolete full-width row.
  const columnX=Math.max(x,actions.x+actions.width+gap);
  const column={x:columnX,y,width:right-columnX,height:Math.min(height-edge,footer.y-gap)-y};
  // A text-enlarged narrow layout may leave more usable space below the route.
  // Select that wholly unobstructed rectangle rather than cropping the vehicle.
  const belowY=Math.max(y,route.y+route.height+gap);
  const side={x,y,width:right-x,height:bottom-y};
  const below={x:edge,y:belowY,width:width-edge*2,height:bottom-belowY};
  const region=column.width>=width*.4 && column.height>=60?column:side.width>=width*.4 && side.height>=60?side:below;
  return region.width>=60 && region.height>=60?region:null;
}
