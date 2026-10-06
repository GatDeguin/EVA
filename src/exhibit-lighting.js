// One shadow-casting exhibition key preserves contact and the head's recesses.
// The remaining lights are restrained approximations of the visible fixtures;
// they do not allocate shadow maps or wash out the green enclosure.
export function createExhibitLighting(THREE, scene) {
  const key = new THREE.SpotLight(0xffe5cf, 510, 54, .65, .72, 2);
  key.position.set(-5.6, 13.2, 7.4);
  key.target.position.set(0, 5.6, -4.4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048,2048);
  key.shadow.camera.near = 2;
  key.shadow.camera.far = 45;
  // Preserve the baseline margin and shadow placement at the 1024px tier.
  // Fine-detail antialiasing belongs to the renderer, not a larger light bias.
  key.shadow.normalBias = .023;
  key.shadow.bias = -.00012;
  key.shadow.radius = 3;
  key.shadow.intensity = .92;
  const fill = new THREE.DirectionalLight(0xb1c5db, .48);
  fill.position.set(6.88,7.39,.85);
  fill.target.position.set(0,5,-4);
  const rim = new THREE.DirectionalLight(0xb4bfdc, 1.8);
  rim.position.set(-5.29,11.66,-10.09);
  rim.target.position.set(0,5,-3);
  const hemisphere = new THREE.HemisphereLight(0xb5c0c2,0x251b23,.27);
  const front = new THREE.PointLight(0xffb46b,18,15,2);
  front.position.set(-6.80,7.39,.85);
  const back = new THREE.PointLight(0xa5bd92,36,13,2);
  back.position.set(5.29,11.57,-9.98);
  key.name = 'Exhibition key • only shadow caster';
  fill.name = 'East wall fixture fill';
  rim.name = 'Upper west fixture rim';
  front.name = 'West access fixture bounce';
  back.name = 'Upper east fixture bounce';
  hemisphere.name = 'Restrained enclosure bounce';
  scene.add(key,key.target,fill,fill.target,rim,rim.target,hemisphere,front,back);
  const targetColor = new THREE.Color();
  const presets = {
    studio: { key:650, keyColor:0xffeedb, fill:.59, fillColor:0xc3cfd4, rim:1.40, rimColor:0xc5ced1, ambient:.33, front:21, frontColor:0xffdbc0, back:31, background:0x111718, env:.23 },
    night: { key:540, keyColor:0xffe5cc, fill:.34, fillColor:0x9eb8ce, rim:1.72, rimColor:0xb8bbdf, ambient:.20, front:12, frontColor:0xffd6a8, back:40, background:0x0b1215, env:.17 },
    alarm: { key:450, keyColor:0xffc8b2, fill:.30, fillColor:0xa6adc4, rim:1.80, rimColor:0xd59091, ambient:.22, front:46, frontColor:0xff624b, back:23, background:0x1c0e13, env:.16 },
  };
  let first = true;
  const clampActivation = value => THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 1);
  const targetLights = (mode, activation) => {
    const p = presets[mode] || presets.night, a = clampActivation(activation);
    return { p, values: [[key,p.key+a*80,p.keyColor],[fill,p.fill,p.fillColor],[rim,p.rim+a*.38,p.rimColor],[hemisphere,p.ambient],[front,p.front+a*5,p.frontColor],[back,p.back+a*10]] };
  };
  function update(time, activation, mode, dt, motionAllowed = true) {
    const {p,values} = targetLights(mode,activation);
    const delta = Math.max(0,Math.min(Number.isFinite(dt)?dt:1/60,.15));
    const blend = first || !motionAllowed ? 1 : 1-Math.exp(-5.5*delta);
    first = false;
    // Alarm is a steady preset. Reduced motion jumps to the final values;
    // rendering on demand can therefore stop once the transition has settled.
    for (const [light,value,color] of values) {
      light.intensity += (value-light.intensity)*blend;
      if (color !== undefined) light.color.lerp(targetColor.set(color),blend);
    }
    if (!Number.isFinite(scene.environmentIntensity)) scene.environmentIntensity = p.env;
    scene.environmentIntensity += (p.env-scene.environmentIntensity)*blend;
    if (scene.background?.isColor) scene.background.lerp(targetColor.set(p.background),blend);
    if (scene.fog && scene.background?.isColor) scene.fog.color.copy(scene.background);
  }
  function isSettled(mode, activation) {
    if (first) return false;
    const {p,values} = targetLights(mode,activation);
    for (const [light,value,color] of values) {
      if (Math.abs(light.intensity-value)>Math.max(.00015,Math.abs(value)*.0005)) return false;
      if (color !== undefined) {
        targetColor.set(color);
        if (Math.max(Math.abs(light.color.r-targetColor.r),Math.abs(light.color.g-targetColor.g),Math.abs(light.color.b-targetColor.b))>.0003) return false;
      }
    }
    if (Math.abs(scene.environmentIntensity-p.env)>.0001) return false;
    if (scene.background?.isColor) {
      targetColor.set(p.background);
      if (Math.max(Math.abs(scene.background.r-targetColor.r),Math.abs(scene.background.g-targetColor.g),Math.abs(scene.background.b-targetColor.b))>.0001) return false;
    }
    return true;
  }
  function dispose() {
    for (const object of [key,key.target,fill,fill.target,rim,rim.target,hemisphere,front,back]) scene.remove(object);
    for (const light of [key,fill,rim,hemisphere,front,back]) light.dispose?.();
  }
  return {key,fill,rim,hemisphere,front,back,update,isSettled,dispose};
}

/**
 * A small lighting proxy for PMREM, centered on the sculpture's upper torso.
 * Green enclosure bounce, a dark red floor and elongated fixture reflections
 * replace the unrelated white showroom. This scene is baked once and disposed;
 * none of its panels are added to the exhibition's draw list.
 */
export function createHangarEnvironment(THREE) {
  const source = new THREE.Scene();
  source.name = 'Containment hangar • reflection source';
  source.background = new THREE.Color().setRGB(.013,.019,.017);
  const room = new THREE.Group();
  room.position.set(0,-5.5,5);
  source.add(room);
  const geometry = new THREE.PlaneGeometry(1,1);
  const materials = new Set();
  function panel(name, position, size, linearColor, rotation = [0,0,0]) {
    const material = new THREE.MeshBasicMaterial({side:THREE.DoubleSide, toneMapped:false});
    material.color.setRGB(...linearColor);
    materials.add(material);
    const mesh = new THREE.Mesh(geometry,material);
    mesh.name = name; mesh.position.set(...position); mesh.scale.set(size[0],size[1],1); mesh.rotation.set(...rotation);
    room.add(mesh);
    return mesh;
  }
  panel('Rear green enclosure',[0,6.25,-10.43],[15.1,12.5],[.078,.098,.071]);
  panel('West green enclosure',[-7.36,6.25,-4.50],[12,12.5],[.083,.108,.078],[0,Math.PI/2,0]);
  panel('East green enclosure',[7.36,6.25,-4.50],[12,12.5],[.092,.116,.087],[0,-Math.PI/2,0]);
  panel('Muted crimson floor',[0,0,-4.50],[15.1,12],[.105,.018,.032],[-Math.PI/2,0,0]);
  panel('Overhead enclosure',[0,12.39,-4.50],[15.1,12],[.112,.133,.101],[Math.PI/2,0,0]);
  // The proxy cards include the illuminated diffuser around each small lamp.
  // Their size remains legible after the lower-resolution mobile PMREM bake.
  for (const side of [-1,1]) {
    for (const z of [-8.7,-3.15,.85]) {
      panel('Wall fixture diffuser',[side*6.87,7.39,z],[.34,1.8],[16.3,18.1,16.1],[0,-side*Math.PI/2,0]);
    }
    panel('Upper rear fixture',[side*5.29,11.66,-10.06],[2.45,.27],[18.8,20.8,18.2]);
    panel('Ceiling strip diffuser',[side*4.75,12.31,-2.85],[2.85,.68],[26.0,28.0,23.8],[Math.PI/2,0,0]);
  }
  const key = panel('Exhibition key reflection',[-5.6,13.2,7.4],[3.8,3.4],[29.0,26.6,23.0]);
  key.lookAt(0,.1,.6);
  // A broad, dim reflected front aperture avoids empty black metal at grazing
  // angles while leaving the narrow fixture cards as the brightest features.
  panel('Front aperture bounce',[1.3,5.2,5.8],[6.4,4.7],[.18,.21,.24]);
  let disposed = false;
  source.dispose = () => {
    if (disposed) return;
    disposed = true;
    geometry.dispose();
    for (const material of materials) material.dispose();
  };
  return source;
}
