/**
 * Fit the HOME showcase into the measured clear area beside the route selector
 * and entry actions. Rectangles are CSS pixels in the game's own
 * viewport, not the parent iframe or physical device screen. Normal desktop
 * and portrait layouts retain their existing camera; garage/driving never use
 * this function. An intentionally absent vehicle label releases its top inset;
 * an absent footer releases the viewport bottom. Supplied but invalid rectangles
 * still fail closed. The room-aware camera performs the actual vehicle fit.
 */
export function homeVehicleFraming({width,height,header,route,label,actions,footer}) {
  if (![width,height].every(value=>Number.isFinite(value)&&value>0)) return null;
  if (!(width>height && (height<=620 || width<=900))) return null;
  const validRect=rect=>rect && [rect.x,rect.y,rect.width,rect.height].every(Number.isFinite);
  if (![header,route,actions].every(validRect) || [label,footer].some(rect=>rect!=null&&!validRect(rect))) return null;
  const footerTop=footer?.y??height;
  const edge=width<=400?8:14,gap=width<=400&&height<=220?2:8;
  const x=Math.max(edge,route.x+route.width+gap);
  const headerBottom=header.y+header.height,labelBottom=label==null?headerBottom:label.y+label.height;
  const y=Math.max(headerBottom,labelBottom)+gap;
  const right=width-edge,bottom=Math.min(height-edge,actions.y-gap);
  // Compact actions leave the lower-right stage usable too. Keep the complete
  // vehicle to their right instead of reserving an obsolete full-width row.
  const columnX=Math.max(x,actions.x+actions.width+gap);
  const column={x:columnX,y,width:right-columnX,height:Math.min(height-edge,footerTop-gap)-y};
  // A text-enlarged narrow layout may leave more usable space below the route.
  // Select that wholly unobstructed rectangle rather than cropping the vehicle.
  const belowY=Math.max(y,route.y+route.height+gap);
  const side={x,y,width:right-x,height:bottom-y};
  const below={x:edge,y:belowY,width:width-edge*2,height:bottom-belowY};
  // With the HOME copy removed, use the freed middle rather than pinning the
  // car to the narrow right-hand column. Its slightly right-of-center stage
  // stays wholly below the route and above entry controls. A 2px clear margin
  // reclaims vertical room without overlapping either control. Tiny/short
  // layouts retain the guarded side/column choices instead of squeezing the car.
  const centeredGap=2,centeredX=Math.max(edge,width*.15);
  const centeredY=Math.max(headerBottom,route.y+route.height)+centeredGap;
  const centered={x:centeredX,y:centeredY,width:right-centeredX,height:Math.min(height-edge,actions.y-centeredGap,footerTop-centeredGap)-centeredY};
  if(label==null&&width>400&&centered.width>=60&&centered.height>=60)return centered;
  const region=column.width>=width*.4 && column.height>=60?column:side.width>=width*.4 && side.height>=60?side:below;
  if(region.width>=60 && region.height>=60)return region;
  // A side-panel-constrained 320px iframe still needs full route text and real
  // 44px controls. A smaller clear rectangle is safer than falling back to an
  // unbounded hero camera behind them. Larger layouts retain the fit above.
  if(width<=400)return [column,side,below].filter(r=>r.width>40&&r.height>40)
    .sort((a,b)=>Math.min(b.width,b.height*2)-Math.min(a.width,a.height*2))[0]||null;
  return null;
}
