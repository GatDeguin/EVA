import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createEva } from './eva.js';
import { createHangar } from './hangar.js';
import { FaceTracker } from './tracker.js';
import { updateWindowCamera, damp, clamp } from './projection.js';
import { HangarSound } from './sound.js';
import { createExhibitLighting, createHangarEnvironment } from './exhibit-lighting.js';
import { createRenderRuntime } from './render-pipeline.js';
import { applySurfaceDetail } from './surface-detail.js';
import { createMotion } from './motion.js';
import { QUALITY_PROFILES, normalizeQuality, initialQuality, renderPixelRatio, FrameMetrics, AdaptiveQuality } from './quality.js';

const $ = id => document.getElementById(id);
let canvas = $('viewport');
const stage = $('stage');
$('reloadButton').addEventListener('click',()=>location.reload());
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = motionPreference.matches;
const defaults = {parallax:1,viewDistance:65,screenHeight:32,exposure:1,lighting:'night',shadows:true,bloom:true,ao:true,adaptiveResolution:true,grid:false,quality:'auto',mirror:true,preview:true,follow:true};
const preferences = {...defaults};
const storageKey='eva01.exhibition.v2';
let welcomeSeen=false;
try {
  const saved=JSON.parse(localStorage.getItem(storageKey)||'null');
  if(saved?.version===2) {
    const ranges={parallax:[.2,1.8],viewDistance:[35,100],screenHeight:[18,55],exposure:[.55,1.65]};
    const choices={lighting:['studio','night','alarm'],quality:['auto','high','low',...Object.keys(QUALITY_PROFILES)]};
    for(const [key,defaultValue] of Object.entries(defaults)) {
      const value=saved.preferences?.[key];
      if(typeof defaultValue==='boolean' && typeof value==='boolean') preferences[key]=value;
      else if(typeof defaultValue==='number' && typeof value==='number' && Number.isFinite(value)) preferences[key]=clamp(value,...ranges[key]);
      else if(choices[key]?.includes(value)) preferences[key]=key==='quality'?normalizeQuality(value):value;
    }
    welcomeSeen=saved.welcomeSeen===true;
  }
} catch { /* Restricted file origins still have a complete, usable experience. */ }
const state = {mode:'window',source:'mouse',paused:reducedMotion,time:0,frames:0,tracking:'idle',pose:{x:0,y:0,z:0},target:{x:0,y:0,z:0},manual:{x:0,y:0,z:0},face:{x:0,y:0,z:0},quality:'balanced',frustum:null,ready:false,activation:-1,confidence:0,contextLost:false,debugPose:false};
const modeNames = {window:'VENTANA 3D',inspect:'ÓRBITA LIBRE',demo:'RECORRIDO'};
let renderer,scene,camera,pipeline,runtime,orbit,eva,hangar,tracker,guide,surfaceDetail,environmentResource;
let lightRig;
let keyLight,fillLight,rimLight,hemisphere,frontLight;
let width=1,height=1,screenHeightWorld=10.8;
const screenCenterY=5.45;
let lastTime=0,telemetryTime=0,settleRemaining=0,activationPart=-1;
let softwareRendering=false;
let animationRequest=0,toastTimer=0,restoreFocus=null,immersive=false,screenshotPending=false;
let lightMode=preferences.lighting;
let cameraGuided=false,activePanel=null;
const inertElements=new Map();
const sound=new HangarSound();
const tempVector = new THREE.Vector3();
const motion=createMotion({reducedMotion});
const metrics=new FrameMetrics(240);
const adaptive=new AdaptiveQuality({profile:'balanced'});
let metricSnapshot=metrics.snapshot(),effectiveQuality=adaptive.configuration();
const framePose={x:0,y:0,z:0,activation:.75};
const hangarFrame={activation:0,mode:lightMode,paused:false,reducedMotion};
let photoReturnPaused=null,photoMode=false,disposed=false;

function requestRender(settleMs=0) {
  settleRemaining=Math.max(settleRemaining,settleMs/1000);
  if(state.ready&&!disposed&&!state.contextLost&&!document.hidden&&!animationRequest) animationRequest=requestAnimationFrame(frame);
}

function setText(id,value) {
  const element=$(id);
  if(element&&element.textContent!==value) motion.text(element,value);
}

function persistPreferences() {
  try {localStorage.setItem(storageKey,JSON.stringify({version:2,preferences,welcomeSeen}));} catch {}
}

function announce(message) { if($('srStatus')) $('srStatus').textContent=message; }

function dismissWelcome(remember=true) {
  if($('welcomePanel')) motion.reveal($('welcomePanel'),{kind:'panel',show:false});
  if(remember) {welcomeSeen=true;persistPreferences();}
}

function toast(message, duration=4200) {
  setText('toast',message);
  motion.reveal($('toast'),{kind:'status',show:true});
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{motion.reveal($('toast'),{kind:'status',show:false});},duration);
}

function fatal(message) {
  state.ready=false;
  if(window.__DIORAMA__)window.__DIORAMA__.ready=false;
  cancelAnimationFrame(animationRequest);animationRequest=0;
  tracker?.stop();sound.suspend();syncSoundUI();
  closePanels(false);
  motion.cancelAll('fatal');clearTimeout(toastTimer);
  for(const element of [...stage.children,$('appHeader')||document.querySelector('.masthead'),document.querySelector('.bottom-area')]) {
    if(element&&element!==$('fatal'))element.inert=true;
  }
  $('loading').classList.add('done');
  $('fatalMessage').textContent=message;
  $('fatal').inert=false;
  $('fatal').hidden=false;
  $('reloadButton').focus({preventScroll:true});
}

function loadProgress(value,message) {
  $('loadingProgress').style.width=value+'%';
  $('loadingStatus').textContent=message;
}

function updateModeUI() {
  document.querySelectorAll('[data-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===state.mode)));
  let label=modeNames[state.mode];
  if(state.mode==='window' && state.source==='face') label=state.tracking==='tracking'?'ROSTRO VINCULADO':state.tracking==='starting'?'ABRIENDO CÁMARA':'BUSCANDO ROSTRO';
  if(state.paused) label+=' / PAUSA';
  setText('modeStatus',label);
  $('statusDot').style.background=state.source==='face' && state.tracking!=='tracking'?'#e4b971':'#b7ee76';
  if(state.mode==='inspect') $('stageHint').textContent='Arrastrá para girar · Rueda para acercarte';
  else if(state.mode==='demo') $('stageHint').textContent='Un recorrido por la profundidad del hangar';
  else if(state.source==='face') $('stageHint').textContent=state.tracking==='tracking'?'Mové la cabeza suavemente. Asomate al hangar.':'Mirá de frente, con buena luz, para encontrar tu rostro.';
  else $('stageHint').textContent=matchMedia('(pointer:coarse)').matches?'Arrastrá con un dedo para explorar la profundidad.':'Mové el mouse. Mirá detrás del marco.';
  $('footerStatus').textContent=state.mode==='inspect'?'MAQUETA EN ÓRBITA':state.source==='face'?'TU ROSTRO CONTROLA EL PUNTO DE VISTA':'UN ESPACIO DETRÁS DE TU PANTALLA';
  if($('returnWindowButton')) $('returnWindowButton').hidden=!(tracker?.running && state.mode!=='window');
  if($('recenterQuickButton')) $('recenterQuickButton').hidden=!(tracker?.running);
  document.body.dataset.view=state.mode;
  document.body.dataset.tracking=state.tracking;
}

function setView(mode) {
  if(!state.ready || !['window','inspect','demo'].includes(mode)) return;
  const prior=state.mode;
  dismissWelcome();
  if(mode!=='window') {
    cameraGuided=false;
    if(tracker?.running) {
      tracker.stop();
      toast(mode==='demo'?'Recorrido iniciado. La cámara está apagada.':'Cámara apagada. Arrastrá para explorar la maqueta.');
    }
    updateCameraPanel();
  }
  state.mode=mode;
  state.debugPose=false;
  orbit.enabled=mode==='inspect';
  hangar.setMode?.(mode==='inspect'?'inspect':preferences.lighting);
  configureAmbientVisibility();
  if(mode==='inspect' && prior!=='inspect') {
    camera.fov=38;
    camera.aspect=width/height;
    camera.near=.1;
    camera.far=120;
    camera.position.set(12.7,9.1,21.5);
    orbit.target.set(0,5.0,-4.2);
    camera.lookAt(orbit.target);
    camera.updateProjectionMatrix();
    orbit.update();
  }
  if(mode!=='inspect') {
    state.pose.x=state.pose.y=state.pose.z=0;
    state.manual.x=state.manual.y=state.manual.z=0;
    updateProjection(0);
  }
  updateModeUI();
  requestRender(1100);
  announce(mode==='window'?'Vista ventana. Usá el mouse, las flechas o tu rostro.':mode==='inspect'?'Órbita libre. Arrastrá para girar la maqueta.':'Recorrido automático.');
}

function setPaused(value) {
  state.paused=Boolean(value);
  $('pauseButton').setAttribute('aria-pressed',String(state.paused));
  $('pauseButton').setAttribute('aria-label',state.paused?'Continuar animación':'Pausar animación');
  $('pauseButton').title=state.paused?'Continuar animación (Espacio)':'Pausar animación (Espacio)';
  $('pauseButton').querySelector('use').setAttribute('href',state.paused?'#i-play':'#i-pause');
  document.body.classList.toggle('scene-paused',state.paused);
  updateModeUI();
  lastTime=0;
  requestRender(600);
}

function resetView() {
  state.debugPose=false;
  state.manual={x:0,y:0,z:0};
  state.face={x:0,y:0,z:0};
  state.target={x:0,y:0,z:0};
  if(state.mode==='inspect') {
    camera.position.set(12.7,9.1,21.5);
    orbit.target.set(0,5,-4.2);
    orbit.update();
  }
  if(tracker?.running) {
    if(tracker.calibrate()) {
      cameraGuided=false;
      updateCameraPanel();
      toast('Listo. Asomate a los lados o acercate suavemente.');
      announce('Rostro centrado. El seguimiento está listo.');
      if(!activePanel) canvas.focus({preventScroll:true});
    }
    else toast('Esperá a que aparezca el contorno del rostro para centrarlo.');
  } else toast('Punto de vista centrado.');
  requestRender(1200);
}

function openPanel(id) {
  if(!state.ready)return;
  const panel=$(id);
  if(activePanel===id) {closePanels();return;}
  const trigger=document.activeElement;
  if(activePanel) closePanels(false);
  restoreFocus=trigger?.offsetParent!==null && !trigger?.closest('.drawer')?trigger:(id==='settingsPanel'?$('settingsButton'):$('helpButton'));
  dismissWelcome(false);
  activePanel=id;
  motion.reveal(panel,{kind:'drawer',show:true});
  const candidates=[...stage.children,$('appHeader')||document.querySelector('.masthead'),document.querySelector('.bottom-area')];
  for(const element of candidates) {
    if(!element || element===panel || element===$('panelBackdrop')) continue;
    inertElements.set(element,element.inert);
    element.inert=true;
  }
  if($('panelBackdrop')) $('panelBackdrop').hidden=false;
  document.body.classList.add('modal-open');
  (id==='settingsPanel'?$('settingsButton'):$('helpButton')).setAttribute('aria-expanded','true');
  panel.querySelector('button')?.focus({preventScroll:true});
}

function closePanels(returnFocus=true) {
  const any=Boolean(activePanel);
  motion.reveal($('settingsPanel'),{kind:'drawer',show:false});
  motion.reveal($('helpPanel'),{kind:'drawer',show:false});
  $('settingsButton').setAttribute('aria-expanded','false');
  $('helpButton').setAttribute('aria-expanded','false');
  for(const [element,previous] of inertElements) element.inert=previous;
  inertElements.clear();
  activePanel=null;
  // Preview may have been revealed while the modal was open. Its previous
  // hidden/inert value is not the new visible panel's accessibility state.
  if(any) updateCameraPanel();
  if($('panelBackdrop')) $('panelBackdrop').hidden=true;
  document.body.classList.remove('modal-open');
  if(any && returnFocus) (restoreFocus?.isConnected && restoreFocus.offsetParent!==null?restoreFocus:canvas).focus?.({preventScroll:true});
  return any;
}

function syncPreferencesUI() {
  for(const [key,value] of Object.entries(preferences)) {
    const element=$(key);
    if(!element) continue;
    if(element.type==='checkbox') element.checked=value;
    else element.value=value;
  }
  $('parallaxValue').textContent=preferences.parallax.toFixed(2)+'×';
  $('viewDistanceValue').textContent=preferences.viewDistance+' cm';
  $('screenHeightValue').textContent=preferences.screenHeight+' cm';
  $('exposureValue').textContent=preferences.exposure.toFixed(2)+'×';
  document.querySelectorAll('[data-light]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.light===preferences.lighting)));
  if($('presetName')) $('presetName').textContent={studio:'Estudio',night:'Cine',alarm:'Alerta'}[preferences.lighting];
  document.body.dataset.lighting=preferences.lighting;
}

function applyPreferences() {
  syncPreferencesUI();
  persistPreferences();
  if(!renderer) return;
  renderer.toneMappingExposure=preferences.exposure;
  if(renderer.shadowMap.enabled!==preferences.shadows) {
    renderer.shadowMap.enabled=preferences.shadows;
    const materials=new Set();
    scene.traverse(object=>{
      if(object.material) for(const material of Array.isArray(object.material)?object.material:[object.material]) materials.add(material);
    });
    // Three.js compiles shadow sampling into each material's shader program.
    // Changing the render flag alone would leave a frozen shadow in that shader.
    materials.forEach(material=>{material.needsUpdate=true;});
  }
  renderer.shadowMap.needsUpdate=true;
  if(guide) guide.visible=preferences.grid;
  tracker?.setMirror(preferences.mirror);
  updateCameraPanel();
  if(lightMode!==preferences.lighting) {
    lightMode=preferences.lighting;
    if(state.mode!=='inspect') hangar?.setMode?.(lightMode);
  }
  configureQuality();
  requestRender(reducedMotion?0:1500);
}

function configureQuality(force) {
  if(!renderer || !pipeline) return;
  const quality=force || (preferences.quality==='auto'?initialQuality(runtime.capabilities):normalizeQuality(preferences.quality));
  const changed=state.quality!==quality;
  state.quality=quality;
  if(changed || adaptive.profile!==quality) adaptive.reset(quality,preferences.adaptiveResolution);
  adaptive.enabled=preferences.adaptiveResolution;
  effectiveQuality=adaptive.configuration();
  const wantsPhoto=quality==='cinematic';
  if(wantsPhoto&&!photoMode) {photoReturnPaused=state.paused;photoMode=true;if(state.ready)setPaused(true);else state.paused=true;}
  if(!wantsPhoto&&photoMode) {photoMode=false;if(state.ready)setPaused(photoReturnPaused||reducedMotion);photoReturnPaused=null;}
  const dpr=renderPixelRatio(effectiveQuality,{width,height,devicePixelRatio:window.devicePixelRatio||1,maxTextureSize:runtime.capabilities.limits.maxTextureSize,scale:adaptive.scale,softwareRendering});
  if(Math.abs(renderer.getPixelRatio()-dpr)>.01) {
    pipeline.resize(width,height,dpr);
  }
  pipeline.setQuality({bloom:preferences.bloom&&effectiveQuality.bloom,ao:preferences.ao&&effectiveQuality.ao,samples:effectiveQuality.samples});
  keyLight.shadow.radius=quality==='performance'?2.1:3;
  const mapSize=Math.min(effectiveQuality.shadowSize,runtime.capabilities.limits.maxTextureSize);
  if(keyLight.shadow.mapSize.x!==mapSize) {
    keyLight.shadow.mapSize.set(mapSize,mapSize);
    keyLight.shadow.map?.dispose();
    keyLight.shadow.map=null;
    keyLight.shadow.needsUpdate=true;
    renderer.shadowMap.needsUpdate=true;
  }
  configureAmbientVisibility();
  if($('qualityStatus')) $('qualityStatus').textContent=photoMode?'Tiempo detenido para encuadrar. La captura guarda sólo la escena.':`${effectiveQuality.label} · resolución ${Math.round(adaptive.scale*100)}%${effectiveQuality.degradation?' · efectos ajustados':''}`;
}

function configureAmbientVisibility() {
  const dust=hangar?.group.getObjectByName('Airborne dust');
  if(dust) {dust.geometry.setDrawRange(0,effectiveQuality.particles);dust.visible=state.mode!=='inspect'&&!reducedMotion;}
}

function resize() {
  if(!renderer) return;
  const rect=stage.getBoundingClientRect();
  width=Math.max(1,Math.round(rect.width));
  height=Math.max(1,Math.round(rect.height));
  // Portrait crops the outer cage deliberately, keeping the sculpture present.
  // The fixed screen plane itself is still exact for every viewport aspect.
  screenHeightWorld=Math.max(10.8,9.6/(width/height));
  pipeline.resize(width,height,renderer.getPixelRatio());
  configureQuality();
  if(state.mode==='inspect') {
    camera.aspect=width/height;
    camera.fov=width/height<1?50:38;
    camera.updateProjectionMatrix();
  } else updateProjection(0);
  requestRender(600);
}

function updateProjection(dt) {
  if(!camera || state.mode==='inspect') return;
  let target;
  if(state.debugPose) target=state.target;
  else if(state.mode==='demo') target={x:Math.sin(state.time*.23)*.78,y:Math.sin(state.time*.17+.5)*.34,z:Math.cos(state.time*.145)*.4};
  else if(state.source==='face') target=state.face;
  else target=state.manual;
  state.target.x=target.x;state.target.y=target.y;state.target.z=target.z;
  const speed=state.source==='face'?9:5.5;
  if(dt>0) for(const key of ['x','y','z']) state.pose[key]=reducedMotion?clamp(target[key],-1,1):damp(state.pose[key],clamp(target[key],-1,1),speed,dt);
  const screenWidth=screenHeightWorld*width/height;
  const worldUnitsPerCm=screenHeightWorld/preferences.screenHeight;
  const baseDistance=clamp(preferences.viewDistance*worldUnitsPerCm,12,90);
  const gain=preferences.parallax;
  const eyeX=state.pose.x*10*worldUnitsPerCm*gain;
  const eyeY=screenCenterY+state.pose.y*6.5*worldUnitsPerCm*gain;
  const eyeZ=clamp(baseDistance-state.pose.z*12*worldUnitsPerCm*gain,9,100);
  state.frustum=updateWindowCamera(camera,{width:screenWidth,height:screenHeightWorld,centerY:screenCenterY,screenZ:0,eyeX,eyeY,eyeZ,near:.1,far:145});
}

function updateCameraPanel() {
  const running=tracker?.running || ['starting','searching','tracking','lost'].includes(state.tracking);
  const showError=state.tracking==='error' && cameraGuided;
  motion.reveal($('cameraPanel'),{kind:'panel',show:showError || (running && (preferences.preview || cameraGuided)),inert:Boolean(activePanel)});
  $('cameraPanel').classList.toggle('guided',cameraGuided);
  $('calibrateButton').textContent=cameraGuided?'Centrar y entrar':'Centrar rostro';
  $('calibrateButton').disabled=state.tracking!=='tracking';
  $('hideCameraButton').hidden=!running;
  if($('stopCameraButton')) $('stopCameraButton').textContent=running?'Apagar cámara':'Cerrar';
  const progress=state.tracking==='tracking'?2:['searching','lost'].includes(state.tracking)?1:0;
  document.querySelectorAll('[data-camera-step]').forEach((element,index)=>{
    element.classList.toggle('complete',index<progress);
    element.classList.toggle('current',index===progress);
    element.setAttribute('aria-current',index===progress?'step':'false');
  });
  if($('showCameraButton')) $('showCameraButton').hidden=!(running && !preferences.preview && !cameraGuided);
  setText('cameraStepTitle',state.tracking==='tracking'?'Encontramos tu rostro.':state.tracking==='starting'?'Permití el uso de la cámara.':state.tracking==='error'?'La cámara necesita tu atención.':'Mirá al frente, con buena luz.');
}

function onTrackerState({state:tracking,message}) {
  state.tracking=tracking;
  setText('cameraMessage',message);
  const running=['starting','searching','tracking','lost'].includes(tracking);
  $('cameraButton').classList.toggle('active',running);
  $('cameraButton').setAttribute('aria-pressed',String(running));
  $('cameraButton').querySelector('.button-label').textContent=running?(tracking==='starting'?'Cancelar cámara':'Apagar cámara'):'Activar cámara';
  if(running) state.source='face';
  else {
    state.source='mouse';
    state.face={x:0,y:0,z:0};
    state.confidence=0;
  }
  if(tracking==='error') toast(message,7500);
  updateCameraPanel();
  updateModeUI();
  requestRender(600);
  announce(tracking==='tracking'?'Rostro detectado. Podés centrar tu posición y explorar.':message);
}

async function toggleCamera() {
  if(!state.ready) return;
  if(tracker.running) {
    tracker.stop();
    cameraGuided=false;
    updateCameraPanel();
    state.source='mouse';
    state.manual={x:0,y:0,z:0};
    updateModeUI();
    toast('Cámara apagada. Podés explorar con el mouse.');
    return;
  }
  setView('window');
  closePanels();
  state.debugPose=false;
  state.manual={x:0,y:0,z:0};
  cameraGuided=true;
  dismissWelcome();
  await tracker.start();
}

function triggerActivation() {
  if(!state.ready) return;
  dismissWelcome();
  if(reducedMotion) {
    state.activation=-1;activationPart=-1;eva.setAwake?.(true);
    motion.reveal($('sequence'),{kind:'status',show:false});
    $('activateButton').setAttribute('aria-pressed','false');
    setText('activationLabel','Activar EVA');
    announce('EVA activada. Secuencia completada sin movimiento.');
    toast('EVA activada. Movimiento reducido.');
    closePanels();requestRender();return;
  }
  setPaused(false);
  state.activation=state.time;
  activationPart=-1;
  eva.trigger?.();
  eva.setAwake?.(true);
  motion.reveal($('sequence'),{kind:'status',show:true});
  $('activateButton').setAttribute('aria-pressed','true');
  setText('activationLabel','Enlazando…');
  sound.cue();
  announce('Secuencia de activación iniciada.');
  closePanels();
}

function updateActivation() {
  if(state.activation<0) return 0;
  const elapsed=state.time-state.activation;
  const stages=[['ENLACE NEURAL','Conectando sistemas de la unidad.'],['SINCRONIZACIÓN','Respuesta detectada. Manteniendo contención.'],['UNIDAD ACTIVA','EVA–01 está observando.'],['ESTADO ESTABLE','Restableciendo el ciclo de espera.']];
  const part=Math.min(3,Math.floor(elapsed/2));
  if(part!==activationPart) {
    activationPart=part;setText('seqPhase',stages[part][0]);setText('seqText',stages[part][1]);
  }
  // This is the elapsed time of this local scripted sequence, never a fake load.
  $('seqProgress').style.transform=`scaleX(${Math.min(1,elapsed/8)})`;
  if(elapsed>=8) {
    motion.reveal($('sequence'),{kind:'status',show:false});
    state.activation=-1;
    $('activateButton').setAttribute('aria-pressed','false');
    setText('activationLabel','Activar EVA');
    eva.setAwake?.(true);
    return 0;
  }
  return Math.sin(Math.min(1,elapsed/8)*Math.PI)**2;
}

function lightingFrame(t,activation,dt=1/60) {
  lightRig.update(t,activation,lightMode,dt,!reducedMotion);
  pipeline?.setBloomStrength((lightMode==='night'?.23:.14)+activation*.12);
  if(scene.fog) {
    // Changing the physical viewing-distance setting must not fog out the model.
    scene.fog.near=Math.max(18,camera.position.z+9);
    scene.fog.far=scene.fog.near+62;
  }
}

function syncSoundUI() {
  const button=$('soundButton');
  if(!button) return;
  button.setAttribute('aria-pressed',String(sound.enabled));
  button.setAttribute('aria-label',sound.enabled?'Silenciar ambiente sonoro':'Activar ambiente sonoro');
  button.title=sound.enabled?'Silenciar ambiente sonoro':'Activar ambiente sonoro';
  if($('soundState')) $('soundState').textContent=sound.enabled?'Sonido activo':'Sonido';
}

async function toggleSound() {
  try {
    await sound.setEnabled(!sound.requestedEnabled);
    syncSoundUI();
    announce(sound.enabled?'Ambiente sonoro activado.':'Ambiente sonoro silenciado.');
  } catch {
    toast('No se pudo iniciar el sonido. Podés seguir explorando la escena.');
  }
}

function buildGuide() {
  const root=new THREE.Group();
  const lineMaterial=new THREE.LineBasicMaterial({color:0xb7ee76,transparent:true,opacity:.22,depthTest:true});
  for(const z of [0,-2.8,-6.5,-10.2]) {
    const g=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-6.7,.25,z),new THREE.Vector3(6.7,.25,z),new THREE.Vector3(6.7,11.4,z),new THREE.Vector3(-6.7,11.4,z),new THREE.Vector3(-6.7,.25,z)]);
    root.add(new THREE.Line(g,lineMaterial));
  }
  for(const x of [-6.7,6.7]) for(const y of [.25,11.4]) {
    root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x,y,0),new THREE.Vector3(x,y,-10.2)]),lineMaterial));
  }
  root.visible=false;
  return root;
}

async function snapshot() {
  if(!state.ready || screenshotPending) return;
  screenshotPending=true;
  $('screenshotButton').disabled=true;
  const savedRatio=renderer.getPixelRatio();
  cancelAnimationFrame(animationRequest);animationRequest=0;
  try {
    if(photoMode) {
      const ratio=Math.max(savedRatio,Math.min(2,runtime.capabilities.limits.maxTextureSize/Math.max(width,height),Math.sqrt(4_000_000/(width*height))));
      pipeline.resize(width,height,ratio);
    }
    renderScene();
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob) throw new Error('El navegador no pudo generar la imagen.');
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;link.download='EVA01_'+new Date().toISOString().replace(/[:.]/g,'-')+'.png';
    link.click();
    setTimeout(()=>URL.revokeObjectURL(url),15000);
    toast(photoMode?'Captura con sobremuestreo guardada.':'Captura de la escena guardada.');
  } catch(error) {
    toast('No se pudo capturar esta vista. '+error.message);
  } finally {
    screenshotPending=false;
    $('screenshotButton').disabled=false;lastTime=0;
    // The user can resize or select a different profile while PNG encoding is
    // pending. Restore the CURRENT choice, not a stale pre-capture DPR.
    try {if(!state.contextLost)configureQuality();}
    catch(error) {state.contextLost=true;fatal('No se pudo recuperar el render tras la captura. Volvé a iniciar el diorama.');}
    requestRender();
  }
}

async function setImmersion(enabled) {
  immersive=enabled;
  document.body.classList.toggle('immersion',enabled);
  $('fullscreenButton').setAttribute('aria-pressed',String(enabled));
  closePanels();
  if(enabled) {
    try {if(!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();} catch { /* In-page immersion is still available in previews. */ }
  } else if(document.fullscreenElement) {
    try {await document.exitFullscreen();} catch { /* Browser may have already exited. */ }
  }
  requestAnimationFrame(resize);
}

function setupInput() {
  document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{setView(button.dataset.view);motion.feedback(button);}));
  $('cameraButton').addEventListener('click',toggleCamera);
  $('calibrateButton').addEventListener('click',resetView);
  $('recenterQuickButton')?.addEventListener('click',resetView);
  $('showCameraButton')?.addEventListener('click',()=>{preferences.preview=true;applyPreferences();});
  $('stopCameraButton')?.addEventListener('click',()=>{cameraGuided=false;tracker.stop();updateCameraPanel();updateModeUI();$('cameraButton').focus({preventScroll:true});});
  $('returnWindowButton')?.addEventListener('click',()=>setView('window'));
  $('welcomeCameraButton')?.addEventListener('click',()=>{dismissWelcome();$('cameraButton').focus({preventScroll:true});toggleCamera();});
  $('welcomeExploreButton')?.addEventListener('click',()=>{dismissWelcome();canvas.focus({preventScroll:true});announce('Usá el mouse, las flechas o arrastrá con un dedo para explorar.');});
  $('welcomeCloseButton')?.addEventListener('click',()=>{dismissWelcome();canvas.focus({preventScroll:true});});
  $('soundButton')?.addEventListener('click',toggleSound);
  $('pauseButton').addEventListener('click',()=>setPaused(!state.paused));
  $('resetButton').addEventListener('click',resetView);
  $('settingsButton').addEventListener('click',()=>openPanel('settingsPanel'));
  $('helpButton').addEventListener('click',()=>openPanel('helpPanel'));
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',closePanels));
  $('panelBackdrop')?.addEventListener('click',()=>closePanels());
  $('activateButton').addEventListener('click',triggerActivation);
  $('screenshotButton').addEventListener('click',snapshot);
  $('fullscreenButton').addEventListener('click',()=>setImmersion(!immersive));
  $('exitImmersion').addEventListener('click',()=>setImmersion(false));
  $('hideCameraButton').addEventListener('click',()=>{cameraGuided=false;preferences.preview=false;applyPreferences();if(tracker.running)toast('La cámara sigue activa. Usá Centrar cuando lo necesites.');$('resetButton').focus({preventScroll:true});});
  $('resetSettingsButton').addEventListener('click',()=>{Object.assign(preferences,defaults);adaptive.reset(initialQuality(runtime.capabilities));applyPreferences();resetView();});
  for(const [key,defaultValue] of Object.entries(defaults)) {
    const control=$(key);
    if(!control) continue;
    control.addEventListener(control.type==='range'?'input':'change',()=>{
      preferences[key]=typeof defaultValue==='boolean'?control.checked:typeof defaultValue==='number'?Number(control.value):control.value;
      if(key==='quality') {adaptive.reset(preferences.quality==='auto'?initialQuality(runtime.capabilities):preferences.quality,preferences.adaptiveResolution);metrics.clear();}
      if(key==='adaptiveResolution'&&!preferences.adaptiveResolution) adaptive.reset(state.quality,false);
      applyPreferences();
    });
  }
  document.querySelectorAll('[data-light]').forEach(button=>button.addEventListener('click',()=>{
    preferences.lighting=button.dataset.light;
    applyPreferences();
    motion.feedback(button);
    announce('Ambiente '+{studio:'Estudio',night:'Cine',alarm:'Alerta'}[preferences.lighting]+'.');
  }));
  let touching=false,touchOrigin=null;
  function pointerToPose(event) {
    if(activePanel || state.mode!=='window' || state.source==='face' || (event.pointerType==='touch' && !touching)) return;
    if(event.pointerType==='touch' && touchOrigin?.pointerId!==event.pointerId) return;
    const rect=canvas.getBoundingClientRect();
    state.debugPose=false;
    if(event.pointerType==='touch' && touchOrigin) {
      state.manual.x=clamp(touchOrigin.pose.x+(event.clientX-touchOrigin.x)/rect.width*2,-1,1);
      state.manual.y=clamp(touchOrigin.pose.y-(event.clientY-touchOrigin.y)/rect.height*2,-1,1);
    } else {
      state.manual.x=clamp((event.clientX-rect.left)/rect.width*2-1,-1,1);
      state.manual.y=clamp(1-(event.clientY-rect.top)/rect.height*2,-1,1);
    }
    requestRender();
  }
  canvas.addEventListener('pointerdown',event=>{
    dismissWelcome();
    if(event.pointerType==='touch') {
      if(touching) return;
      touching=true;
      touchOrigin={pointerId:event.pointerId,x:event.clientX,y:event.clientY,pose:{...state.manual}};
      if(state.mode==='window') canvas.setPointerCapture(event.pointerId);
    }
    pointerToPose(event);
  });
  canvas.addEventListener('pointermove',pointerToPose);
  const releaseTouch=event=>{if(touchOrigin?.pointerId===event.pointerId){touching=false;touchOrigin=null;}};
  canvas.addEventListener('pointerup',releaseTouch);
  canvas.addEventListener('pointercancel',releaseTouch);
  canvas.addEventListener('pointerleave',()=>{if(state.source==='mouse' && !touching && !state.debugPose){state.manual.x=0;state.manual.y=0;requestRender();}});
  canvas.addEventListener('wheel',event=>{
    if(state.mode==='window' && state.source!=='face') {
      event.preventDefault();
      state.manual.z=clamp(state.manual.z-event.deltaY*.001,-1,1);
      requestRender();
    }
  },{passive:false});
  canvas.addEventListener('dblclick',triggerActivation);
  document.addEventListener('keydown',event=>{
    if(!state.ready) {
      if(!$('fatal').hidden&&event.key==='Tab'){event.preventDefault();$('reloadButton').focus({preventScroll:true});}
      return;
    }
    const isInput=/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName);
    const nativeControl=event.target.closest('button,summary,a,input,select,textarea,[contenteditable="true"]');
    if(event.key==='Escape') {
      if(!closePanels()) {
        if(immersive) setImmersion(false);
        else if(!$('welcomePanel')?.hidden) {dismissWelcome();canvas.focus({preventScroll:true});}
      }
      return;
    }
    if(event.key==='Tab') {
      const panel=activePanel?$(activePanel):null;
      if(panel) {
        const nodes=[...panel.querySelectorAll('button, input, select, summary, a[href]')].filter(el=>el.offsetParent!==null);
        if(event.shiftKey && document.activeElement===nodes[0]){event.preventDefault();nodes[nodes.length-1]?.focus();}
        else if(!event.shiftKey && document.activeElement===nodes[nodes.length-1]){event.preventDefault();nodes[0]?.focus();}
      }
      return;
    }
    if(isInput || event.target.isContentEditable || event.ctrlKey || event.metaKey || event.altKey) return;
    const key=event.key.toLowerCase();
    if(activePanel) {
      if(key==='h' && activePanel==='helpPanel') {event.preventDefault();closePanels();}
      return;
    }
    const directions=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','PageUp','PageDown'];
    if(event.target===canvas && directions.includes(event.key)) {
      event.preventDefault();
      dismissWelcome();
      state.debugPose=false;
      if(state.mode==='demo') setView('window');
      if(state.mode==='inspect') {
        const offset=camera.position.clone().sub(orbit.target);
        const spherical=new THREE.Spherical().setFromVector3(offset);
        if(event.key==='ArrowLeft') spherical.theta-=.08;
        if(event.key==='ArrowRight') spherical.theta+=.08;
        if(event.key==='ArrowUp') spherical.phi-=.06;
        if(event.key==='ArrowDown') spherical.phi+=.06;
        if(['+','=','PageUp'].includes(event.key)) spherical.radius-=1;
        if(['-','PageDown'].includes(event.key)) spherical.radius+=1;
        spherical.theta=clamp(spherical.theta,orbit.minAzimuthAngle,orbit.maxAzimuthAngle);
        spherical.phi=clamp(spherical.phi,orbit.minPolarAngle,orbit.maxPolarAngle);
        spherical.radius=clamp(spherical.radius,orbit.minDistance,orbit.maxDistance);
        camera.position.copy(orbit.target).add(offset.setFromSpherical(spherical));
        orbit.update();
      } else if(state.source!=='face') {
        if(event.key==='ArrowLeft') state.manual.x=clamp(state.manual.x-.13,-1,1);
        if(event.key==='ArrowRight') state.manual.x=clamp(state.manual.x+.13,-1,1);
        if(event.key==='ArrowUp') state.manual.y=clamp(state.manual.y+.13,-1,1);
        if(event.key==='ArrowDown') state.manual.y=clamp(state.manual.y-.13,-1,1);
        if(['+','=','PageUp'].includes(event.key)) state.manual.z=clamp(state.manual.z+.13,-1,1);
        if(['-','PageDown'].includes(event.key)) state.manual.z=clamp(state.manual.z-.13,-1,1);
      } else announce('El rostro controla la vista. Apagá la cámara con C para usar las flechas.');
      requestRender(700);
      return;
    }
    if(event.repeat) return;
    if(key==='c'){event.preventDefault();toggleCamera();}
    else if(key==='r'){event.preventDefault();resetView();}
    else if(key==='a'){event.preventDefault();triggerActivation();}
    else if(key==='f'){event.preventDefault();setImmersion(!immersive);}
    else if(key==='h'){event.preventDefault();openPanel('helpPanel');}
    else if(event.code==='Space' && !nativeControl){event.preventDefault();setPaused(!state.paused);}
  });
  document.addEventListener('fullscreenchange',()=>{
    if(!document.fullscreenElement && immersive) {
      immersive=false;document.body.classList.remove('immersion');$('fullscreenButton').setAttribute('aria-pressed','false');resize();
    }
  });
  document.addEventListener('visibilitychange',()=>{
    lastTime=0;
    if(document.hidden) {
      if(tracker?.running) {tracker.stop();toast('La cámara se apagó al salir de la ventana.');}
      sound.suspend();syncSoundUI();
      motion.cancelAll('hidden-document');
      cancelAnimationFrame(animationRequest);animationRequest=0;
    } else requestRender(400);
  });
  window.addEventListener('pagehide',()=>{tracker?.stop();sound.suspend();motion.cancelAll('page-hidden');cancelAnimationFrame(animationRequest);animationRequest=0;lastTime=0;});
  window.addEventListener('pageshow',event=>{if(event.persisted)requestRender();});
  motionPreference.addEventListener?.('change',event=>{
    reducedMotion=event.matches;
    motion.setReduced(reducedMotion);
    document.body.dataset.motion=reducedMotion?'reduced':'full';
    if(reducedMotion) {
      setPaused(true);
      if(state.activation>=0) {state.activation=-1;eva.setAwake?.(true);motion.reveal($('sequence'),{kind:'status',show:false});$('activateButton').setAttribute('aria-pressed','false');setText('activationLabel','Activar EVA');}
      toast('Movimiento reducido activado. La escena está en pausa y podés explorar a mano.');
    }
    configureQuality();requestRender();
  });
  window.addEventListener('resize',resize);
  new ResizeObserver(resize).observe(stage);
  canvas.addEventListener('webglcontextlost',event=>{
    event.preventDefault();state.contextLost=true;cancelAnimationFrame(animationRequest);animationRequest=0;motion.cancelAll('context-lost');tracker?.stop();sound.suspend();syncSoundUI();
    toast('Se interrumpió la aceleración gráfica. Esperando que el navegador la recupere…',12000);
  });
  canvas.addEventListener('webglcontextrestored',()=>location.reload());
  if(runtime.backend==='webgpu') {
    const ownedRuntime=runtime;
    const engineDeviceLost=renderer.onDeviceLost?.bind(renderer);
    renderer.onDeviceLost=info=>{
      engineDeviceLost?.(info);
      if(runtime!==ownedRuntime||disposed)return;
      state.contextLost=true;
      fatal('El navegador perdió el dispositivo gráfico WebGPU. Volvé a iniciar el diorama para recuperar la escena.');
    };
  }
}

function renderScene() {
  pipeline.render();
}

function frame(now) {
  animationRequest=0;
  if(!state.ready || disposed || state.contextLost || document.hidden || screenshotPending) return;
  const cpuStart=performance.now();
  const rawDelta=lastTime?Math.max(.001,(now-lastTime)/1000):1/60;
  const dt=Math.min(rawDelta,.12);
  lastTime=now;
  if(!state.paused) state.time+=dt;
  const animationDelta=state.paused?0:dt;
  const activation=updateActivation();
  if(state.mode==='inspect') orbit.update();
  else updateProjection(dt);
  framePose.x=preferences.follow?state.pose.x:0;framePose.y=preferences.follow?state.pose.y:0;framePose.z=state.pose.z;
  framePose.activation=.75+.25*activation;
  if(!state.paused) {
    eva.update(state.time,animationDelta,framePose);
    // Explicit Resume is a user opt-in to scene motion; UI still honors the OS.
    hangarFrame.activation=activation;hangarFrame.mode=lightMode;hangarFrame.paused=false;hangarFrame.reducedMotion=false;
    hangar.update?.(state.time,animationDelta,hangarFrame);
  }
  lightingFrame(state.time,activation,dt);
  renderScene();
  state.frames++;
  metrics.push(rawDelta*1000,performance.now()-cpuStart,pipeline.gpuTimeMs);
  if(now-telemetryTime>900) {
    metricSnapshot=metrics.snapshot();telemetryTime=now;
    const signed=value=>(value>=0?'+':'')+value.toFixed(2);
    $('poseStatus').textContent=`X ${signed(state.pose.x)} · Y ${signed(state.pose.y)} · Z ${signed(state.pose.z)}`;
    const stats=pipeline.getStats();
    const format=value=>Number.isFinite(value)?value.toFixed(1)+' ms':'no disponible';
    $('fps').textContent=`${Math.round(metricSnapshot.fps||0)} FPS · ${effectiveQuality.label} · ${runtime.backend.toUpperCase()}`;
    if($('frameStatus')) $('frameStatus').textContent=`Frame p95 ${format(metricSnapshot.frame?.p95)} / p99 ${format(metricSnapshot.frame?.p99)} · ${metricSnapshot.samples} muestras`;
    if($('costStatus')) $('costStatus').textContent=`Trabajo JS p95 ${format(metricSnapshot.cpu?.p95)} · GPU ${format(pipeline.gpuTimeMs)}`;
    if($('renderStatus')) $('renderStatus').textContent=`${stats.drawCalls} llamadas · ${stats.triangles.toLocaleString('es-AR')} triángulos · ${renderer.domElement.width} × ${renderer.domElement.height} px`;
    if($('resourceStatus')) $('resourceStatus').textContent=`${stats.geometries} geometrías · ${stats.textures} texturas · ${pipeline.aaMethod} · ${pipeline.hdr?'HDR':'SDR'}`;
    $('faceConfidence').textContent=state.tracking==='tracking'?'ENLAZADO':'—';
  }
  const cost=Number.isFinite(pipeline.gpuTimeMs)?Math.max(pipeline.gpuTimeMs,rawDelta*1000):rawDelta*1000;
  if(state.frames>18 && adaptive.update(cost,rawDelta,{active:!state.paused&&!document.hidden}))configureQuality();
  settleRemaining=Math.max(0,settleRemaining-dt);
  const poseMoving=state.mode!=='inspect'&&(Math.abs(state.pose.x-state.target.x)+Math.abs(state.pose.y-state.target.y)+Math.abs(state.pose.z-state.target.z)>.0005);
  const lightMoving=lightRig.isSettled?!lightRig.isSettled(lightMode,activation):settleRemaining>0;
  if(!state.paused||poseMoving||lightMoving||settleRemaining>0)requestRender();
  else {lastTime=0;metricSnapshot=metrics.snapshot();}
}

async function init(forcedBackend=null) {
  syncPreferencesUI();
  await new Promise(requestAnimationFrame);
  try {
    const backendChoice=forcedBackend||new URLSearchParams(location.search).get('renderer')||'auto';
    runtime=await createRenderRuntime({canvas,onProgress:loadProgress,preferredBackend:backendChoice});
    canvas=runtime.canvas;renderer=runtime.renderer;
    softwareRendering=runtime.capabilities.softwareRendering;
    if($('backendStatus')) $('backendStatus').textContent=`${runtime.backend.toUpperCase()}${softwareRendering?' · renderizado por software':''} · ${runtime.capabilities.webgpu.initialized?'WebGPU inicializado':'respaldo compatible'}`;
    state.quality=preferences.quality==='auto'?initialQuality(runtime.capabilities):preferences.quality;
    adaptive.reset(state.quality,preferences.adaptiveResolution);
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1;
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFShadowMap;
    renderer.info.autoReset=false;
    scene=new THREE.Scene();
    scene.background=new THREE.Color(0x0b1215);
    scene.fog=new THREE.Fog(0x0b1215,34,96);
    camera=new THREE.PerspectiveCamera(38,1,.1,145);
    loadProgress(28,'Construyendo armadura y estructuras...');
    await new Promise(requestAnimationFrame);
    eva=createEva(THREE);
    eva.group.position.set(0,0,-5);
    scene.add(eva.group);
    hangar=createHangar(THREE);
    scene.add(hangar.group);
    surfaceDetail=applySurfaceDetail(THREE,scene,{maxAnisotropy:runtime.capabilities.limits.maxAnisotropy});
    guide=buildGuide();scene.add(guide);
    loadProgress(52,'Iluminando el hangar...');
    await new Promise(requestAnimationFrame);
    const environmentScene=createHangarEnvironment(THREE);
    environmentResource=await runtime.createEnvironment(environmentScene);
    scene.environment=environmentResource.texture;
    scene.environmentIntensity=.16;
    environmentScene.dispose();
    lightRig=createExhibitLighting(THREE,scene);
    ({key:keyLight,fill:fillLight,rim:rimLight,hemisphere,front:frontLight}=lightRig);
    orbit=new OrbitControls(camera,canvas);
    orbit.enabled=false;orbit.enableDamping=true;orbit.dampingFactor=.075;
    orbit.enablePan=false;orbit.minDistance=15;orbit.maxDistance=50;
    orbit.minPolarAngle=.45;orbit.maxPolarAngle=1.62;
    orbit.minAzimuthAngle=-1.1;orbit.maxAzimuthAngle=1.1;
    orbit.target.set(0,5,-4.2);
    orbit.addEventListener('change',()=>requestRender(180));
    pipeline=runtime.createPipeline(scene,camera);
    tracker=new FaceTracker({video:$('cameraVideo'),canvas:$('cameraCanvas'),onState:onTrackerState,onPose:pose=>{
      state.face.x=pose.x;state.face.y=pose.y;state.face.z=pose.z;state.confidence=pose.confidence;requestRender();
    }});
    applyPreferences();
    resize();
    eva.update(0,0,{x:0,y:0,activation:.75});
    hangar.update?.(0,0,{activation:0,mode:lightMode,paused:reducedMotion,reducedMotion});
    loadProgress(82,'Preparando materiales y sombras...');
    await renderer.compileAsync(scene,camera);
    await pipeline.warmup?.();
    renderScene();
    setupInput();
    state.ready=true;
    setPaused(reducedMotion||photoMode);
    syncSoundUI();
    document.body.classList.add('exhibit-ready');
    document.body.dataset.motion=reducedMotion?'reduced':'full';
    if($('welcomePanel')) motion.reveal($('welcomePanel'),{kind:'panel',show:!welcomeSeen});
    if(reducedMotion) toast('La escena inicia en pausa por tu preferencia de movimiento reducido. Podés explorar a mano.',6500);
    loadProgress(100,'Diorama listo.');
    $('loading').classList.add('done');
    $('loading').hidden=true;
    // Exposed diagnostics are entirely local. They support deterministic QA and
    // make the off-axis projection inspectable without requiring a real webcam.
    window.__DIORAMA__={
      ready:true,scene,camera,renderer,tracker,eva,hangar,lightRig,
      getState:()=>({ready:state.ready,mode:state.mode,source:state.mode==='demo'?'auto':state.mode==='inspect'?'orbit':state.source,paused:state.paused,time:state.time,frames:state.frames,tracking:state.tracking,cameraGuided,sound:sound.enabled,soundState:sound.context?.state||'not-created',activePanel,welcomeSeen,preferences:{...preferences},pose:{...state.pose},frustum:state.frustum?{...state.frustum}:null,quality:state.quality,effectiveQuality:{...effectiveQuality},backend:runtime.backend,capabilities:runtime.capabilities,shadows:preferences.shadows,bloom:preferences.bloom,bloomActive:pipeline.bloomActive,aoActive:pipeline.aoActive,...pipeline.getStats(),confidence:state.confidence,activation:state.activation,viewport:{width,height,dpr:renderer.getPixelRatio()},modelStats:eva.stats,hangarStats:hangar.stats,crewStats:hangar.crew?.stats,surfaceStats:surfaceDetail.stats,motion:motion.getStats(),performance:metricSnapshot,renderScheduled:Boolean(animationRequest),photoMode,screenshotPending,aaMethod:pipeline.aaMethod,hdr:pipeline.hdr}),
      setPose:(x=0,y=0,z=0)=>{if(state.mode==='inspect')setView('window');state.debugPose=true;state.target={x:clamp(x,-1,1),y:clamp(y,-1,1),z:clamp(z,-1,1)};state.pose={...state.target};updateProjection(0);renderScene();},
      setView,trigger:triggerActivation,pause:setPaused,reset:resetView,capture:()=>{renderScene();return canvas.toDataURL('image/png');},savePhoto:snapshot,
      setQuality:value=>{preferences.quality=normalizeQuality(value);adaptive.reset(preferences.quality==='auto'?initialQuality(runtime.capabilities):preferences.quality,preferences.adaptiveResolution);applyPreferences();},
      screenCorners:()=>{const f=state.frustum;if(!f)return[];return[[-f.width/2,f.centerY-f.height/2],[f.width/2,f.centerY-f.height/2],[f.width/2,f.centerY+f.height/2],[-f.width/2,f.centerY+f.height/2]].map(([x,y])=>{tempVector.set(x,y,f.screenZ).project(camera);return{x:tempVector.x,y:tempVector.y};});}
    };
    requestRender();
  } catch(error) {
    if(runtime?.backend==='webgpu'&&forcedBackend!=='webgl2'&&!state.ready) {
      // A driver can initialize successfully and fail only while compiling a
      // real material or post pass. Fall back before installing app listeners.
      const reason=error?.message||'el dispositivo no pudo preparar la escena';
      for(const resource of [orbit,pipeline,environmentResource,surfaceDetail,hangar?.crew,lightRig]) {
        try {resource?.dispose?.();} catch { /* Lost devices may reject cleanup. */ }
      }
      const geometries=new Set(),materials=new Set(),textures=new Set();
      scene?.traverse(object=>{
        if(object.geometry)geometries.add(object.geometry);
        for(const material of object.material?(Array.isArray(object.material)?object.material:[object.material]):[]) {
          materials.add(material);
          for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
        }
      });
      for(const resource of [...geometries,...materials,...textures]) {try{resource.dispose();}catch{}}
      try{renderer?.dispose();}catch{}
      const replacement=canvas.cloneNode(false);canvas.replaceWith(replacement);canvas=replacement;
      if(photoMode&&photoReturnPaused!==null)state.paused=photoReturnPaused;
      runtime=null;renderer=null;pipeline=null;photoMode=false;photoReturnPaused=null;
      loadProgress(12,'Preparando la ruta gráfica compatible...');
      await init('webgl2');
      if(state.ready) {runtime.warnings.push(`La preparación WebGPU falló: ${reason}`);if($('backendStatus'))$('backendStatus').textContent+=' · recuperación de WebGPU';}
      return;
    }
    console.error('Diorama initialization:',error);
    tracker?.stop();
    fatal(error?.message || 'No se pudo iniciar la escena. Probá abrir el archivo directamente en un navegador con aceleración gráfica.');
  }
}

init();
