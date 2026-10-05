import test from 'node:test';
import assert from 'node:assert/strict';
import { QUALITY_PROFILES, normalizeQuality, initialQuality, renderPixelRatio, FrameMetrics, AdaptiveQuality } from '../src/quality.js';

test('five usable profiles and old preferences survive migration',()=>{
  assert.deepEqual(Object.keys(QUALITY_PROFILES),['performance','balanced','quality','ultra','cinematic']);
  assert.equal(normalizeQuality('high'),'quality');
  assert.equal(normalizeQuality('low'),'performance');
  assert.equal(normalizeQuality('corrupt'),'auto');
  assert.equal(initialQuality({softwareRendering:true}),'performance');
  assert.equal(initialQuality({mobile:true,systemMemoryGB:4}),'performance');
});

test('DPR respects pixel budget and maximum texture dimension on large displays',()=>{
  const p=QUALITY_PROFILES.ultra;
  const ratio=renderPixelRatio(p,{width:8000,height:6000,devicePixelRatio:3,maxTextureSize:4096,scale:1});
  assert.ok(ratio*8000<=4096);
  assert.ok(8000*6000*ratio*ratio<=p.pixelBudget+1);
  assert.ok(Number.isFinite(renderPixelRatio(p,{width:0,height:0,devicePixelRatio:Infinity,maxTextureSize:4096,scale:1})));
});

test('adaptation needs sustained load and recovers slowly without oscillating',()=>{
  const adaptive=new AdaptiveQuality({profile:'balanced'});
  const original=adaptive.scale;
  adaptive.update(90,.1);
  assert.equal(adaptive.scale,original);
  for(let i=0;i<35;i++) adaptive.update(50,.1);
  assert.ok(adaptive.scale<original);
  const lower=adaptive.scale;
  for(let i=0;i<20;i++) adaptive.update(8,.1);
  assert.equal(adaptive.scale,lower);
  for(let i=0;i<110;i++) adaptive.update(8,.1);
  assert.ok(adaptive.scale>lower);
  assert.ok(adaptive.scale<=1);
});

test('photo profile and suspended sampling cannot silently degrade quality',()=>{
  const photo=new AdaptiveQuality({profile:'cinematic'});
  for(let i=0;i<100;i++)photo.update(300,.1);
  assert.equal(photo.scale,1);
  const a=new AdaptiveQuality({profile:'quality'});
  for(let i=0;i<100;i++)a.update(300,.1,{active:false});
  assert.equal(a.scale,1);
});

test('a healthy display capped at 60 Hz can recover after a transient slow period',()=>{
  const a=new AdaptiveQuality({profile:'balanced'});
  for(let i=0;i<35;i++)a.update(50,.1);
  const lower=a.scale;
  assert.ok(lower<1);
  for(let i=0;i<900;i++)a.update(1000/60,1/60);
  assert.ok(a.scale>lower,'vsync must not make recovery impossible');
});

test('bounded metrics distinguish frame interval, CPU work and unavailable GPU time',()=>{
  const metrics=new FrameMetrics(4);
  for(const n of [10,20,30,40,50])metrics.push(n,2,null);
  const s=metrics.snapshot();
  assert.equal(s.samples,4);
  assert.equal(s.frame.p50,30);
  assert.equal(s.frame.p95,50);
  assert.equal(s.cpu.p99,2);
  assert.equal(s.gpu,null);
  metrics.push(NaN,Infinity,null);
  assert.equal(metrics.snapshot().samples,4);
  metrics.clear();
  assert.equal(metrics.snapshot().samples,0);
});
