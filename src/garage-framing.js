/**
 * Reserve the actual compact garage's uncovered stage in iframe CSS pixels.
 * The workbench and tab rail are already outside this rectangle. Measured
 * bottom controls include the dynamic car name and enlarged text, so neither
 * wheels nor cockpit inspection can slip behind them. Desktop uses its
 * established framing path instead; this helper does not change vehicle scale.
 * @param {{stage:object,controls:object}} bounds DOMRect-like finite pixel bounds.
 * @returns {{x:number,y:number,width:number,height:number}|null} Clear area, or null before layout.
 */
export function compactGarageFraming({stage,controls}) {
  if (![stage,controls].every(r=>r&&[r.x,r.y,r.width,r.height].every(Number.isFinite))) return null;
  const edge=stage.width<180?4:6,x=stage.x+edge,y=stage.y+edge;
  const width=stage.width-edge*2,height=Math.min(stage.y+stage.height-edge,controls.y-edge)-y;
  return width>0&&height>0?{x,y,width,height}:null;
}
