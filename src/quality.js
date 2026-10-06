/** Quality budgets are targets, never a claim about the user's GPU. */
export const QUALITY_PROFILES=Object.freeze({
  performance:Object.freeze({label:'Rendimiento',pixelBudget:800_000,maxPixelRatio:1,shadowSize:1024,samples:0,bloom:false,ao:false,particles:22,targetMs:1000/60}),
  balanced:Object.freeze({label:'Equilibrada',pixelBudget:1_500_000,maxPixelRatio:1.35,shadowSize:2048,samples:2,bloom:true,ao:false,particles:40,targetMs:1000/60}),
  quality:Object.freeze({label:'Calidad',pixelBudget:2_600_000,maxPixelRatio:1.65,shadowSize:2048,samples:4,bloom:true,ao:true,particles:66,targetMs:1000/30}),
  ultra:Object.freeze({label:'Ultra',pixelBudget:3_700_000,maxPixelRatio:2,shadowSize:4096,samples:4,bloom:true,ao:true,particles:66,targetMs:1000/30}),
  cinematic:Object.freeze({label:'Cinemática / Foto',pixelBudget:6_000_000,maxPixelRatio:2.5,shadowSize:4096,samples:4,bloom:true,ao:true,particles:66,targetMs:1000/30}),
});

export function normalizeQuality(value) {
  if(value==='high') return 'quality';
  if(value==='low') return 'performance';
  return Object.hasOwn(QUALITY_PROFILES,value)?value:'auto';
}

export function initialQuality({softwareRendering=false,mobile=false,systemMemoryGB=null,deviceMemoryGB=systemMemoryGB}={}) {
  if(softwareRendering || (mobile && deviceMemoryGB && deviceMemoryGB<=4)) return 'performance';
  return 'balanced';
}

const finitePositive=(value,fallback)=>Number.isFinite(value)&&value>0?value:fallback;
export function renderPixelRatio(profile,{width=1,height=1,devicePixelRatio=1,maxTextureSize=4096,scale=1,softwareRendering=false}={}) {
  width=finitePositive(width,1);height=finitePositive(height,1);
  const ceiling=softwareRendering?Math.min(profile.maxPixelRatio,.78):profile.maxPixelRatio;
  return Math.max(.1,Math.min(finitePositive(devicePixelRatio,1),ceiling,
    Math.sqrt(profile.pixelBudget/(width*height)),finitePositive(maxTextureSize,4096)/Math.max(width,height))
    * Math.max(.45,Math.min(1,finitePositive(scale,1))));
}

/** Sustained-load hysteresis. Resolution changes first, then optional effects. */
export class AdaptiveQuality {
  constructor({profile='balanced',enabled=true}={}) { this.reset(profile,enabled); }
  reset(profile=this.profile,enabled=this.enabled) {
    this.profile=Object.hasOwn(QUALITY_PROFILES,profile)?profile:'balanced';
    this.enabled=enabled;this.scale=1;this.degradation=0;this.slow=0;this.fast=0;this.cooldown=0;
  }
  update(frameMs,dt,{active=true}={}) {
    if(!this.enabled || !active || this.profile==='cinematic' || !Number.isFinite(frameMs) || !Number.isFinite(dt) || frameMs<=0 || dt<=0) return false;
    dt=Math.min(.25,dt);
    this.cooldown=Math.max(0,this.cooldown-dt);
    if(this.cooldown>0)return false;
    const target=QUALITY_PROFILES[this.profile].targetMs;
    this.slow=frameMs>target*1.18?this.slow+dt:Math.max(0,this.slow-dt*2);
    // RAF is capped by display refresh: a healthy 60Hz screen reports ~16.7ms
    // even if GPU work takes 2ms. Recovery must remain reachable at that cap.
    this.fast=frameMs<=target*1.05?this.fast+dt:0;
    if(this.slow>=2.5) {
      this.slow=0;this.fast=0;this.cooldown=3;
      if(this.scale>.61) {this.scale=Math.max(.6,Math.round((this.scale-.08)*100)/100);return true;}
      if(this.degradation<2) {this.degradation++;return true;}
    }
    if(this.fast>=8) {
      this.fast=0;this.slow=0;this.cooldown=3;
      if(this.degradation>0) {this.degradation--;return true;}
      if(this.scale<1) {this.scale=Math.min(1,Math.round((this.scale+.04)*100)/100);return true;}
    }
    return false;
  }
  configuration() {
    const p=QUALITY_PROFILES[this.profile];
    return {...p,scale:this.scale,degradation:this.degradation,
      ao:p.ao&&this.degradation<1,bloom:p.bloom&&this.degradation<2,
      shadowSize:this.degradation<2?p.shadowSize:Math.min(1024,p.shadowSize),
      particles:this.degradation<2?p.particles:Math.min(22,p.particles)};
  }
}

function distribution(values) {
  if(!values.length)return null;
  values.sort((a,b)=>a-b);
  const percentile=p=>values[Math.max(0,Math.ceil(values.length*p)-1)];
  const mean=values.reduce((sum,n)=>sum+n,0)/values.length;
  return {mean,p50:percentile(.5),p95:percentile(.95),p99:percentile(.99),worst:values[values.length-1]};
}

/** Bounded rings: no growing allocations in the frame loop. Snapshot at <=1Hz. */
export class FrameMetrics {
  constructor(capacity=240) {
    this.capacity=Math.max(1,Math.floor(capacity));
    this.frame=new Float64Array(this.capacity);this.cpu=new Float64Array(this.capacity);this.gpu=new Float64Array(this.capacity);
    this.clear();
  }
  clear() {this.count=0;this.cursor=0;this.gpu.fill(NaN);}
  push(frameMs,cpuMs,gpuMs=null) {
    if(!Number.isFinite(frameMs)||frameMs<=0||!Number.isFinite(cpuMs)||cpuMs<0)return;
    this.frame[this.cursor]=frameMs;this.cpu[this.cursor]=cpuMs;
    this.gpu[this.cursor]=Number.isFinite(gpuMs)&&gpuMs>=0?gpuMs:NaN;
    this.cursor=(this.cursor+1)%this.capacity;this.count=Math.min(this.capacity,this.count+1);
  }
  snapshot() {
    const frame=distribution(Array.from(this.frame.subarray(0,this.count)));
    const cpu=distribution(Array.from(this.cpu.subarray(0,this.count)));
    const gpu=distribution(Array.from(this.gpu.subarray(0,this.count)).filter(Number.isFinite));
    return {samples:this.count,frame,cpu,gpu,fps:frame?1000/frame.mean:null};
  }
}
