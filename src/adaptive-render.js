// Resolution-only, session-local Auto controller. Capability hints choose a
// starting point, never a permanent device rank. No UA/GPU names or telemetry.
const PIXELS = [800000, 1000000, 1200000, 1600000, 2073600, 2764800, 3686400, 5529600, 8294400];
const WINDOW_MS = 4000, WARMUP_MS = 2000, COOLDOWN_MS = 12000;
/** Sanitize an optional positive capability without treating absence as weakness. */
function positive(value, fallback) { return Number.isFinite(value) && value > 0 ? value : fallback; }
/** Build bounded device-local levels; a small CSS window alone is not a GPU rating. */
export function autoRenderPlan({width=1,height=1,dpr=1,compact=false,deviceMemory,hardwareConcurrency,maxEdge=4096}={}) {
  const w=positive(width,1),h=positive(height,1),ratio=Math.max(1,Math.min(positive(dpr,1),3));
  const edge=Math.max(1,Math.min(positive(maxEdge,4096),compact?3840:4096));
  const scale=Math.min(ratio,edge/Math.max(w,h));
  const nativePixels=Math.max(1,Math.min((w*scale)*(h*scale),compact?3686400:8294400));
  // At ordinary sizes never undersample a CSS pixel. Huge displays still need
  // a bounded fallback; native 4K is not a compulsory performance floor.
  const floor=Math.min(nativePixels,Math.max(compact?800000:1600000,Math.min(w*h,compact?1600000:2073600)));
  const levels=[floor];
  for(const pixels of PIXELS)if(pixels>floor*1.12&&pixels<nativePixels/1.12)levels.push(pixels);
  if(nativePixels>levels.at(-1)*1.12)levels.push(nativePixels);
  const weak=(Number.isFinite(deviceMemory)&&deviceMemory>0&&deviceMemory<=2)||(Number.isFinite(hardwareConcurrency)&&hardwareConcurrency>0&&hardwareConcurrency<=2);
  const capable=Number.isFinite(deviceMemory)&&deviceMemory>=4&&Number.isFinite(hardwareConcurrency)&&hardwareConcurrency>=4;
  const start=weak?(compact?1200000:1600000):capable?(compact?2073600:3686400):(compact?1600000:2764800);
  let index=0;for(let i=0;i<levels.length;i++)if(levels[i]<=start*1.05)index=i;
  return {levels,index,maxEdge:edge,maxDpr:3};
}
/**
 * Observe real active-frame cadence, not clamped simulation dt or rAF refresh
 * promises. Multi-window decisions plus reversible down-probes distinguish a
 * resolution-sensitive bottleneck from CPU/browser/30-Hz limits. No per-frame
 * allocation, storage, sync, query, sorting or resolution change is performed.
 */
export function createAutoRenderController(options={}) {
  let plan=autoRenderPlan(options),currentOptions=options,blockedContext=null;
  let index=plan.index,elapsed=0,count=0,total=0,slow=0,work=0,longest=0,warmup=WARMUP_MS,cooldown=0;
  let overload=0,headroom=0,status='calibrating',probe=null,upLimit=plan.levels.length-1,limitRemaining=0,blockedMean=null;
  /** Measurement-bound evidence; small toolbar changes do not mean a new workload. */
  function context(settings,renderPlan,pixels){
    const width=positive(settings.width,1),height=positive(settings.height,1);
    return [width*height,width/height,Math.max(1,Math.min(positive(settings.dpr,1),3)),renderPlan.levels[0],renderPlan.levels.at(-1),renderPlan.maxEdge,pixels];
  }
  /** Compare against the actual failed experiment, not the previous tiny resize. */
  function materiallyChanged(next){return blockedContext&&next.some((value,i)=>Math.max(value,blockedContext[i])/Math.min(value,blockedContext[i])>=1.25);}
  /** Discard a partial window when visibility/activity or render context changes. */
  function resetSamples(){elapsed=0;count=0;total=0;slow=0;work=0;longest=0;overload=0;headroom=0;warmup=WARMUP_MS;}
  /** Forget lifecycle gaps without poisoning the last measured budget. */
  function suspend(){const changed=!!probe;if(probe){index=probe.index;probe=null;cooldown=12000;status='calibrating';}if(count||warmup<WARMUP_MS)resetSamples();return changed;}
  /**
   * Viewport/DPR changes are not a new device. Keep learned cost and backoff,
   * clamp to the new physical limits, and discard incomplete timing. Failed
   * down-probe evidence expires after a material (25%) workload/bounds change.
   * An interrupted experiment first restores its last stable resolution.
   */
  function reconfigure(nextOptions={}) {
    suspend();
    const pixels=plan.levels[index],limitPixels=plan.levels[upLimit];
    const next=autoRenderPlan(nextOptions);
    const retained=Math.max(next.levels[0],Math.min(pixels,next.levels.at(-1)));
    if(materiallyChanged(context(nextOptions,next,retained))){blockedMean=null;blockedContext=null;status='calibrating';}
    currentOptions=nextOptions;
    // Preserve an in-bounds learned native-size level exactly instead of
    // rounding it up to a new viewport's faster, unmeasured startup tier.
    next.levels=next.levels.filter(pixels=>pixels===retained||Math.max(pixels,retained)/Math.min(pixels,retained)>=1.12);
    if(!next.levels.includes(retained))next.levels.push(retained);
    // A preserved native-size tier must not create a tiny trial whose possible
    // improvement cannot meet the controller's 8% benefit requirement.
    next.levels.sort((a,b)=>a-b);plan=next;index=plan.levels.indexOf(retained);
    upLimit=plan.levels.length-1;
    if(limitRemaining>0){upLimit=0;for(let i=0;i<plan.levels.length;i++)if(plan.levels[i]<=limitPixels)upLimit=i;}
    resetSamples();if(status!=='cadence-limited')status='calibrating';
  }
  /** Snapshot only at settings/decision boundaries, never on each frame. */
  function info(){return {pixels:plan.levels[index],status,maxPixels:plan.levels.at(-1),maxEdge:plan.maxEdge,maxDpr:plan.maxDpr};}
  /** Return true only when the drawing budget changes. */
  function observe(frameMs,workMs=0){
    if(!Number.isFinite(frameMs)||frameMs<2||frameMs>1000||!Number.isFinite(workMs)||workMs<0){return suspend();}
    cooldown=Math.max(0,cooldown-frameMs);limitRemaining=Math.max(0,limitRemaining-frameMs);
    if(!limitRemaining)upLimit=plan.levels.length-1;
    if(warmup>0){warmup=Math.max(0,warmup-frameMs);return false;}
    elapsed+=frameMs;count++;total+=frameMs;longest=Math.max(longest,frameMs);slow+=frameMs>22?1:0;work+=workMs;
    if(elapsed<WINDOW_MS||count<30)return false;
    // At most one clearly isolated hitch may be excluded from cadence mean.
    // Raw elapsed time, slow-frame fraction and CPU work remain untrimmed;
    // sustained slow frames (including 100ms) therefore retain their full cost.
    const withoutLongest=(total-longest)/(count-1);
    const mean=longest>withoutLongest*2?withoutLongest:total/count,slowRatio=slow/count,meanWork=work/count;
    elapsed=0;count=0;total=0;slow=0;work=0;longest=0;
    if(probe){
      const prior=probe;probe=null;
      if(prior.direction==='up'){
        if(mean>18.5&&mean>prior.mean*1.1){index=prior.index;upLimit=index;limitRemaining=120000;cooldown=COOLDOWN_MS;status='balanced';resetSamples();return true;}
        // A newly accepted stable tier has a different downward trial pair.
        blockedMean=null;blockedContext=null;status='balanced';cooldown=COOLDOWN_MS;return false;
      }
      if(mean>prior.mean*.92){
        // Lower resolution did not improve delivery. Restore detail instead of
        // walking to the floor for CPU limits, browser throttling or a 30Hz cap.
        index=prior.index;blockedMean=prior.mean;blockedContext=context(currentOptions,plan,plan.levels[index]);cooldown=COOLDOWN_MS;status='cadence-limited';resetSamples();return true;
      }
      // Keep failed-trial evidence only while its original stable tier survives.
      blockedMean=null;blockedContext=null;upLimit=index;status='balanced';cooldown=COOLDOWN_MS;return false;
    }
    status=blockedMean!==null&&Math.abs(mean-blockedMean)<blockedMean*.15?'cadence-limited':'balanced';
    if(cooldown)return false;
    const overloaded=mean>23&&slowRatio>.25;
    const spare=mean<17.8&&slowRatio<.06&&meanWork<13;
    overload=overloaded?overload+1:0;headroom=spare?headroom+1:0;
    if(overload>=2&&index>0){
      if(blockedMean!==null&&Math.abs(mean-blockedMean)<blockedMean*.15){status='cadence-limited';overload=0;return false;}
      // If CPU work already consumes most of the interval, a pixel reduction
      // has no supported justification. Keep image quality and report honestly.
      if(meanWork>mean*.7){status='cadence-limited';overload=0;cooldown=30000;return false;}
      probe={index,mean,direction:'down'};upLimit=index;limitRemaining=120000;index--;status='measuring';resetSamples();return true;
    }
    if(headroom>=3&&index<upLimit){probe={index,mean,direction:'up'};index++;cooldown=COOLDOWN_MS;status='measuring';resetSamples();return true;}
    return false;
  }
  return {observe,suspend,reconfigure,info,get status(){return status;}};
}
