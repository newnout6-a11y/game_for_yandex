import { performance } from 'node:perf_hooks';
import { createAutoRenderController } from '../src/adaptive-render.js';
// CPU-only controller microbenchmark, not GPU or real-device performance.
const samples=[];
for(let run=0;run<6;run++){
 const c=createAutoRenderController({width:915,height:412,dpr:2.625,compact:true,deviceMemory:8,hardwareConcurrency:8});
 for(let i=0;i<10000;i++)c.observe(16.667,3);
 const start=performance.now();for(let i=0;i<1000000;i++)c.observe(16.667,3);
 samples.push((performance.now()-start)/1000000);
}
console.log(JSON.stringify({description:'Node CPU-only Auto controller, not device or GPU FPS',iterationsPerRun:1000000,msPerObservation:samples},null,2));
