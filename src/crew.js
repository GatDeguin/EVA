/**
 * Three maintenance jobs, driven only by the exhibit's application clock.
 * Units are the hangar's display metres; +Z is the figure's forward direction.
 * A single shared body geometry is GPU-skinned by one small skeleton per person.
 */
export const CREW_ROLES = Object.freeze(['coordinator', 'engineer', 'technician']);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smooth = value => { const x = clamp(value, 0, 1); return x * x * (3 - 2 * x); };
const mix = (a, b, amount) => a + (b - a) * amount;
const envelope = (time, start, rise, hold, fall) => smooth((time - start) / rise) * (1 - smooth((time - start - rise - hold) / fall));

/** Analytical, pole-guided two-bone IK. The inputs and reusable outputs are arrays. */
export function solveTwoBoneIK(start, target, upperLength, lowerLength, pole, out = {}) {
  const delta = out.delta || (out.delta = [0, 0, 0]);
  const bend = out.bend || (out.bend = [0, 0, 0]);
  const joint = out.joint || (out.joint = [0, 0, 0]);
  const end = out.end || (out.end = [0, 0, 0]);
  for (let i = 0; i < 3; i++) delta[i] = target[i] - start[i];
  const originalDistance = Math.hypot(...delta);
  const distance = clamp(originalDistance, Math.abs(upperLength - lowerLength) + 1e-7, upperLength + lowerLength - 1e-7);
  if (originalDistance > 1e-8) {
    for (let i = 0; i < 3; i++) delta[i] /= originalDistance;
  } else { delta[0] = 0; delta[1] = -1; delta[2] = 0; }
  const projection = pole[0] * delta[0] + pole[1] * delta[1] + pole[2] * delta[2];
  for (let i = 0; i < 3; i++) bend[i] = pole[i] - delta[i] * projection;
  let bendLength = Math.hypot(...bend);
  if (bendLength < 1e-7) {
    // Choose a perpendicular axis even for a fully vertical or coincident target.
    const x = Math.abs(delta[0]) < 0.8 ? 1 : 0;
    const y = x ? 0 : 1;
    const dot = x * delta[0] + y * delta[1];
    bend[0] = x - dot * delta[0]; bend[1] = y - dot * delta[1]; bend[2] = -dot * delta[2];
    bendLength = Math.hypot(...bend);
  }
  for (let i = 0; i < 3; i++) bend[i] /= bendLength;
  const along = (upperLength * upperLength - lowerLength * lowerLength + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
  for (let i = 0; i < 3; i++) {
    joint[i] = start[i] + delta[i] * along + bend[i] * height;
    end[i] = start[i] + delta[i] * distance;
  }
  out.reachable = originalDistance <= upperLength + lowerLength && originalDistance >= Math.abs(upperLength - lowerLength);
  out.flexion = Math.PI - Math.acos(clamp((upperLength * upperLength + lowerLength * lowerLength - distance * distance) / (2 * upperLength * lowerLength), -1, 1));
  return out;
}

/** Job choreography in figure-local coordinates. Reusing `out` avoids frame allocations. */
export function sampleCrewPose(role, time, readiness = 0, out = {}) {
  const t = Number.isFinite(time) ? time : 0;
  const ready = clamp(Number.isFinite(readiness) ? readiness : 0, 0, 1);
  const id = typeof role === 'number' ? clamp(role, 0, 2) : Math.max(0, CREW_ROLES.indexOf(role));
  const breath = Math.sin(t * (1.07 + id * 0.083) + id * 1.7);
  const set = (key, x, y, z) => {
    const array = out[key] || (out[key] = [0, 0, 0]);
    array[0] = x; array[1] = y; array[2] = z;
  };
  set('pelvis', 0, 0.284 + breath * 0.0012 + ready * 0.0006, 0);
  set('pelvisRotation', 0, 0, 0);
  set('spine', 0.012 + breath * 0.007, 0, 0);
  set('chest', 0, 0, 0);
  set('neck', 0, 0, 0);
  set('head', 0, 0, 0);
  set('leftWrist', -0.080, 0.337, 0.045);
  set('rightWrist', 0.080, 0.340, 0.065);
  set('leftHand', -0.26, 0, 0.17);
  set('rightHand', -0.28, 0, -0.12);
  out.shoulderLift = 0;
  out.tapLift = 0;
  out.tapX = 0;
  out.adjust = 0;
  if (id === 0) {
    const cycle = ((t + 2.1) % 12.8 + 12.8) % 12.8;
    const signal = envelope(cycle, 1.3, 1.35, 2.15, 1.55);
    const inspect = envelope(cycle, 8.1, 0.8, 1.3, 1.1);
    const sweep = signal * Math.sin((cycle - 2.65) * 3.2);
    const cue = mix(signal, 0.91, ready * 0.88);
    out.pelvis[0] = -0.0035 + Math.sin(t * 0.31) * 0.0025;
    set('spine', 0.017 - cue * 0.022 + breath * 0.006, 0.018 + ready * 0.11, 0.015);
    set('chest', -0.014, -0.075 * inspect + ready * 0.055, -0.014 * cue);
    set('neck', -0.08 - cue * 0.06, -0.09 * inspect, 0);
    set('head', -0.13 - cue * 0.18 - ready * 0.12, 0.06 * Math.sin(t * 0.33) - inspect * 0.11, -0.025);
    set('rightWrist', 0.108 + sweep * 0.018 * (1 - ready), 0.361 + cue * 0.166, 0.063 + cue * 0.060);
    set('leftWrist', -0.077 + inspect * 0.016, 0.338 + inspect * 0.060, 0.040 + inspect * 0.040);
    set('rightHand', -0.28 + cue * 0.21, cue * 0.16, -0.05 - cue * 2.67 + sweep * 0.16 * (1 - ready));
    out.shoulderLift = 0.005 * cue;
    out.action = ready > 0.6 ? 'activation-ready' : signal > 0.2 ? 'signals-clearance' : 'watches-eva';
  } else if (id === 1) {
    const cycle = ((t + 0.9) % 8.6 + 8.6) % 8.6;
    const read = envelope(cycle, 0.2, 0.8, 3.45, 0.85);
    const tap = envelope(cycle, 1.5, 0.26, 0.04, 0.34) + envelope(cycle, 2.65, 0.24, 0.04, 0.36) + envelope(cycle, 3.8, 0.23, 0.04, 0.37);
    const look = envelope(cycle, 5.5, 0.8, 0.85, 0.9);
    out.pelvis[0] = 0.002 + Math.sin(t * 0.28 + 1.2) * 0.0017;
    set('spine', 0.035 * (1 - ready) + breath * 0.006, -0.025 - ready * 0.13, -0.011);
    set('chest', 0.025 * read * (1 - ready), -0.025 * read - ready * 0.08, 0.008);
    set('neck', mix(0.105 - look * 0.11, -0.11, ready), 0.045, 0);
    set('head', mix(0.225 + read * 0.075 - look * 0.34, -0.34, ready), mix(-0.055 + look * 0.15, -0.19, ready), 0.022);
    set('leftWrist', -0.050, 0.407 + breath * 0.0015 - ready * 0.022, 0.104 - ready * 0.014);
    set('leftHand', -0.28 + ready * 0.06, 0.03, Math.PI / 2);
    set('rightHand', 0.03, 0.05, -0.10);
    out.tapLift = mix(0.020 - tap * 0.019, 0.017, ready);
    out.tapX = Math.sin(cycle * 0.78) * 0.018;
    out.action = ready > 0.6 ? 'activation-ready' : tap > 0.25 ? 'taps-tablet' : look > 0.3 ? 'checks-eva' : 'reads-tablet';
  } else {
    const cycle = ((t + 4.0) % 11.6 + 11.6) % 11.6;
    const inspect = envelope(cycle, 1.0, 1.3, 3.2, 1.5);
    const adjust = envelope(cycle, 2.8, 0.7, 1.0, 0.7) * (1 - ready);
    const weight = Math.sin(t * 0.38 + 1.1);
    out.pelvis[0] = weight * 0.007;
    out.pelvis[1] -= 0.0016 * Math.abs(weight);
    set('pelvisRotation', 0, -0.028 + ready * 0.05, -weight * 0.022);
    set('spine', 0.030 + inspect * 0.018 + breath * 0.007 - ready * 0.039, -0.05 - ready * 0.16, weight * 0.028);
    set('chest', 0, 0.04 * inspect - ready * 0.07, 0.014 * inspect);
    set('neck', mix(0.045 + inspect * 0.08, -0.12, ready), 0.07, 0);
    set('head', mix(0.015 + inspect * 0.17, -0.33, ready), mix(0.12 + inspect * 0.14, -0.20, ready), -inspect * 0.03);
    set('rightWrist', 0.072 - inspect * 0.016, 0.352 + inspect * 0.065 - ready * 0.024, 0.066 + inspect * 0.054);
    set('rightHand', -0.83 - inspect * 0.32, 0.05 + inspect * 0.12, -0.15);
    set('leftWrist', mix(-0.079, -0.004, adjust), mix(0.333, 0.413, adjust), mix(0.038, 0.130, adjust));
    set('leftHand', -0.30, 0.10, 0.15 + adjust * 1.10);
    out.adjust = adjust;
    out.action = ready > 0.6 ? 'activation-ready' : adjust > 0.25 ? 'adjusts-instrument' : inspect > 0.25 ? 'reads-instrument' : 'scans-equipment';
  }
  return out;
}

export function createCrew(THREE, { materials = {}, deckY = 3.607 } = {}) {
  const group = new THREE.Group();
  group.name = 'Platform crew • three maintenance jobs';
  const ownMaterials = [];
  const makeMaterial = (color, roughness, source) => {
    // Crew occupy roughly thirty pixels vertically in the initial low-quality
    // view. Pale workwear preserves their silhouette against the purple armor;
    // cloning keeps this visibility correction local to the figures.
    const material = source ? source.clone() : new THREE.MeshStandardMaterial({ roughness, metalness: 0.035 });
    material.color.set(color);
    ownMaterials.push(material); return material;
  };
  const pale = makeMaterial(0xd2d6c7, 0.92, materials.crew);
  const dark = makeMaterial(0x98a28f, 0.95, materials.crewDark);
  const materialSets = [[dark, pale, dark], [dark, pale, dark], [pale, pale, dark]];
  const definitions = [
    ['pelvis', null, 0, 0.290, 0],
    ['spine', 'pelvis', 0, 0.041, 0],
    ['chest', 'spine', 0, 0.093, 0],
    ['neck', 'chest', 0, 0.056, 0],
    ['head', 'neck', 0, 0.026, 0],
  ];
  for (const [side, x] of [['left', -1], ['right', 1]]) {
    definitions.push(
      [`${side}Shoulder`, 'chest', x * 0.043, 0.028, 0],
      [`${side}UpperArm`, `${side}Shoulder`, x * 0.012, 0, 0],
      [`${side}Forearm`, `${side}UpperArm`, 0, -0.104, 0],
      [`${side}Hand`, `${side}Forearm`, 0, -0.091, 0],
      [`${side}UpperLeg`, 'pelvis', x * 0.032, 0, 0],
      [`${side}Shin`, `${side}UpperLeg`, 0, -0.135, 0],
      [`${side}Foot`, `${side}Shin`, 0, -0.124, 0],
    );
  }
  const boneIndex = Object.fromEntries(definitions.map(([name], index) => [name, index]));
  const parts = [[], [], []];
  const matrix = new THREE.Matrix4();
  const normalMatrix = new THREE.Matrix3();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();

  // Primitives are merged once, with skin weights in the common bind pose.
  function part(geometry, slot, at, size = [1, 1, 1], angles = [0, 0, 0], weights = 'chest', destination = parts) {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    position.fromArray(at); scale.fromArray(size); rotation.setFromEuler(euler.fromArray(angles));
    matrix.compose(position, rotation, scale); normalMatrix.getNormalMatrix(matrix);
    const data = { positions: [], normals: [], indices: [], weights: [] };
    const p = source.getAttribute('position'), n = source.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      position.fromBufferAttribute(p, i).applyMatrix4(matrix);
      data.positions.push(position.x, position.y, position.z);
      const blend = typeof weights === 'function' ? weights(position) : [[weights, 1]];
      for (let j = 0; j < 4; j++) { data.indices.push(blend[j] ? boneIndex[blend[j][0]] : 0); data.weights.push(blend[j] ? blend[j][1] : 0); }
      position.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize();
      data.normals.push(position.x, position.y, position.z);
    }
    destination[slot].push(data);
    source.dispose(); if (source !== geometry) geometry.dispose();
  }
  function finish(destination, skinned = true) {
    const all = { positions: [], normals: [], indices: [], weights: [] };
    const geometry = new THREE.BufferGeometry();
    for (let slot = 0; slot < destination.length; slot++) {
      const first = all.positions.length / 3;
      for (const data of destination[slot]) for (const key of Object.keys(all)) all[key].push(...data[key]);
      if (all.positions.length / 3 > first) geometry.addGroup(first, all.positions.length / 3 - first, slot);
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(all.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(all.normals, 3));
    if (skinned) {
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(all.indices, 4));
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(all.weights, 4));
    }
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    return geometry;
  }
  const sphere = () => new THREE.SphereGeometry(1, 10, 8);
  const box = () => new THREE.BoxGeometry(1, 1, 1);
  const cylinder = (top, bottom, length, segments = 10) => new THREE.CylinderGeometry(top, bottom, length, segments, 5);
  const blendAt = (a, b, jointY, extent = 0.017) => point => {
    const weight = smooth((jointY + extent - point.y) / (2 * extent));
    return [[a, 1 - weight], [b, weight]];
  };
  const torsoWeight = point => point.y < 0.347
    ? [['pelvis', 1 - smooth((point.y - 0.307) / 0.040)], ['spine', smooth((point.y - 0.307) / 0.040)]]
    : [['spine', 1 - smooth((point.y - 0.350) / 0.090)], ['chest', smooth((point.y - 0.350) / 0.090)]];
  part(cylinder(0.060, 0.047, 0.169), 0, [0, 0.386, 0], [1, 1, 0.70], [0, 0, 0], torsoWeight);
  // A narrow identification band wraps the work jacket and is readable from
  // the exhibit camera, which naturally sees the crew's backs.
  part(new THREE.CylinderGeometry(0.0595, 0.0585, 0.018, 10, 1), 1, [0, 0.442, 0], [1, 1, 0.71], [0, 0, 0], 'chest');
  part(sphere(), 0, [0, 0.448, 0], [0.060, 0.025, 0.038], [0, 0, 0], 'chest');
  part(cylinder(0.053, 0.049, 0.071), 2, [0, 0.287, 0], [1, 1, 0.77], [0, 0, 0], 'pelvis');
  part(box(), 2, [0, 0.319, 0], [0.102, 0.008, 0.077], [0, 0, 0], 'pelvis');
  part(box(), 1, [-0.025, 0.415, 0.040], [0.021, 0.028, 0.004], [0, 0, 0], 'chest');
  part(box(), 2, [0.008, 0.394, 0.037], [0.003, 0.108, 0.003], [0, 0, 0], torsoWeight);
  part(cylinder(0.029, 0.032, 0.017), 2, [0, 0.480, 0], [1, 1, 1], [0, 0, 0], 'neck');
  part(cylinder(0.020, 0.021, 0.039), 1, [0, 0.499, 0], [1, 1, 1], [0, 0, 0], blendAt('head', 'neck', 0.499, 0.020));
  part(sphere(), 1, [0, 0.550, 0.007], [0.041, 0.053, 0.039], [0, 0, 0], 'head');
  part(sphere(), 1, [0, 0.543, 0.046], [0.008, 0.011, 0.012], [0, 0, 0], 'head');
  for (const side of [-1, 1]) {
    part(sphere(), 1, [side * 0.040, 0.548, 0.004], [0.007, 0.013, 0.009], [0, 0, 0], 'head');
    part(sphere(), 2, [side * 0.016, 0.553, 0.043], [0.007, 0.002, 0.002], [0, 0, 0], 'head');
  }
  part(sphere(), 2, [0, 0.584, -0.004], [0.043, 0.028, 0.041], [0.07, 0, 0], 'head');
  for (const [side, sign] of [['left', -1], ['right', 1]]) {
    const upper = `${side}UpperArm`, lower = `${side}Forearm`, hand = `${side}Hand`;
    const thigh = `${side}UpperLeg`, shin = `${side}Shin`, foot = `${side}Foot`;
    part(sphere(), 0, [sign * 0.055, 0.450, 0], [0.024, 0.026, 0.025], [0, 0, 0], () => [['chest', 0.24], [upper, 0.76]]);
    part(cylinder(0.023, 0.017, 0.104), 0, [sign * 0.055, 0.400, 0], [1, 1, 1], [0, 0, 0], blendAt(upper, lower, 0.348));
    part(sphere(), 0, [sign * 0.055, 0.348, 0], [0.018, 0.019, 0.019], [0, 0, 0], blendAt(upper, lower, 0.348));
    part(cylinder(0.0165, 0.012, 0.091), 0, [sign * 0.055, 0.3025, 0], [1, 1, 1], [0, 0, 0], point => point.y > 0.329 ? blendAt(upper, lower, 0.348)(point) : blendAt(lower, hand, 0.257, 0.010)(point));
    part(sphere(), 1, [sign * 0.055, 0.245, 0], [0.0125, 0.022, 0.010], [0, 0, 0], hand);
    part(sphere(), 1, [sign * 0.045, 0.245, 0.003], [0.0055, 0.011, 0.006], [0, 0, sign * 0.28], hand);
    part(cylinder(0.025, 0.0195, 0.135), 2, [sign * 0.032, 0.2225, 0], [1, 1, 1], [0, 0, 0], blendAt(thigh, shin, 0.155));
    part(sphere(), 2, [sign * 0.032, 0.155, 0], [0.021, 0.022, 0.022], [0, 0, 0], blendAt(thigh, shin, 0.155));
    part(cylinder(0.0195, 0.014, 0.124), 2, [sign * 0.032, 0.093, 0], [1, 1, 1], [0, 0, 0], point => point.y > 0.137 ? blendAt(thigh, shin, 0.155)(point) : blendAt(shin, foot, 0.039, 0.008)(point));
    part(box(), 2, [sign * 0.032, 0.020, 0.011], [0.039, 0.040, 0.060], [0, 0, 0], foot);
    part(sphere(), 2, [sign * 0.032, 0.018, 0.039], [0.0195, 0.018, 0.027], [0, 0, 0], foot);
  }
  const bodyGeometry = finish(parts);
  // Static bounding envelope includes the raised clearance arm; avoids per-frame
  // skinned bounds evaluation and any culling pop at the default framing.
  bodyGeometry.boundingBox.set(new THREE.Vector3(-0.25, -0.025, -0.16), new THREE.Vector3(0.25, 0.70, 0.25));
  bodyGeometry.boundingSphere.set(new THREE.Vector3(0, 0.335, 0.04), 0.48);

  const helmetParts = [[], [], []];
  part(sphere(), 1, [0, 0.080, -0.003], [0.047, 0.029, 0.044], [0, 0, 0], 'head', helmetParts);
  part(cylinder(0.053, 0.053, 0.008, 12), 1, [0, 0.070, 0.005], [1, 1, 1], [0, 0, 0], 'head', helmetParts);
  const helmetGeometry = finish(helmetParts, false);
  const tabletParts = [[], [], []];
  part(box(), 2, [0, 0, 0], [0.097, 0.012, 0.069], [0, 0, 0], 'leftHand', tabletParts);
  part(box(), 1, [-0.003, 0.0065, -0.001], [0.079, 0.0015, 0.055], [0, 0, 0], 'leftHand', tabletParts);
  part(box(), 2, [-0.012, 0.0074, -0.014], [0.049, 0.0005, 0.003], [0, 0, 0], 'leftHand', tabletParts);
  part(box(), 2, [-0.019, 0.0074, -0.004], [0.035, 0.0005, 0.003], [0, 0, 0], 'leftHand', tabletParts);
  const tabletGeometry = finish(tabletParts, false);
  const instrumentParts = [[], [], []];
  part(box(), 2, [0, -0.004, 0], [0.023, 0.043, 0.024], [0, 0, 0], 'rightHand', instrumentParts);
  part(box(), 1, [0, -0.032, 0], [0.038, 0.031, 0.029], [0, 0, 0], 'rightHand', instrumentParts);
  part(box(), 2, [0, -0.031, 0.015], [0.026, 0.017, 0.003], [0, 0, 0], 'rightHand', instrumentParts);
  part(cylinder(0.006, 0.007, 0.017, 8), 2, [0.010, -0.056, 0], [1, 1, 1], [0, 0, 0], 'rightHand', instrumentParts);
  const instrumentGeometry = finish(instrumentParts, false);
  const accessoryMaterials = [dark, pale, dark];
  const workers = [], rigs = [];
  const placements = [[-0.73, 0.34, Math.PI + 0.24], [-0.10, 0.31, Math.PI - 0.37], [0.66, 0.37, Math.PI - 0.64]];
  for (let id = 0; id < 3; id++) {
    const worker = new THREE.Group(); worker.name = `Maintenance crew ${id + 1} • ${CREW_ROLES[id]}`;
    const [x, z, heading] = placements[id];
    worker.position.set(x, deckY, z); worker.rotation.y = heading;
    worker.userData.role = CREW_ROLES[id]; worker.userData.restHeading = heading;
    const mesh = new THREE.SkinnedMesh(bodyGeometry, materialSets[id]);
    mesh.name = `${CREW_ROLES[id]} • shared skinned body`; mesh.castShadow = true; mesh.receiveShadow = true;
    const bones = {};
    for (const [name, parent, bx, by, bz] of definitions) {
      const bone = new THREE.Bone(); bone.name = name; bone.position.set(bx, by, bz); bones[name] = bone;
      (parent ? bones[parent] : mesh).add(bone);
    }
    const skeleton = new THREE.Skeleton(definitions.map(([name]) => bones[name]));
    mesh.add(bones.pelvis); mesh.bind(skeleton);
    // Shared conservative bounds. SkinnedMesh otherwise recomputes its own
    // transformed bound on its first render in recent Three.js versions.
    mesh.boundingBox = bodyGeometry.boundingBox.clone(); mesh.boundingSphere = bodyGeometry.boundingSphere.clone();
    worker.add(mesh); group.add(worker);
    const rig = {
      id, role: CREW_ROLES[id], root: worker, mesh, bones, skeleton,
      pose: {}, readiness: 0, props: {}, joints: {},
      footprints: {
        left: [-0.044 - (id === 1 ? 0.006 : 0), 0.031, id === 0 ? -0.022 : -0.010],
        right: [0.044 + (id === 1 ? 0.006 : 0), 0.031, id === 0 ? 0.022 : 0.010],
      },
      _ik: { leftLeg: {}, rightLeg: {}, leftArm: {}, rightArm: {} },
      _start: [0, 0, 0], _target: [0, 0, 0], _point: new THREE.Vector3(),
      _direction: new THREE.Vector3(), _desired: new THREE.Quaternion(),
      _parent: new THREE.Quaternion(), _root: new THREE.Quaternion(), _angles: new THREE.Euler(),
    };
    function accessory(name, geometry, parent, at, angles) {
      const prop = new THREE.Mesh(geometry, accessoryMaterials); prop.name = name; prop.castShadow = true; prop.receiveShadow = true;
      prop.position.fromArray(at); prop.rotation.fromArray(angles); parent.add(prop); return prop;
    }
    if (id === 1) {
      rig.props.helmet = accessory('Engineer hard hat', helmetGeometry, bones.head, [0, 0, 0], [0, 0, 0]);
      rig.props.tablet = accessory('Inspection tablet • held in left palm', tabletGeometry, bones.leftHand, [0.017, -0.038, 0.008], [0, 0, -Math.PI / 2]);
    } else if (id === 2) {
      rig.props.instrument = accessory('Handheld maintenance instrument', instrumentGeometry, bones.rightHand, [0, -0.019, 0], [0, 0, 0]);
    }
    worker.userData.rigIndex = id;
    workers.push(worker); rigs.push(rig);
  }

  const down = new THREE.Vector3(0, -1, 0);
  const legPole = [0, 0, 1];
  const leftArmPole = [-0.8, -0.4, -0.35], rightArmPole = [0.8, -0.4, -0.35];
  function localPosition(rig, bone, target) {
    bone.getWorldPosition(rig._point); rig.root.worldToLocal(rig._point);
    target[0] = rig._point.x; target[1] = rig._point.y; target[2] = rig._point.z;
    return target;
  }
  function orient(rig, bone, desired) {
    bone.parent.getWorldQuaternion(rig._parent).invert();
    bone.quaternion.copy(rig._parent).multiply(rig._root).multiply(desired);
    bone.updateMatrixWorld(true);
  }
  function pointBone(rig, bone, a, b) {
    rig._direction.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    rig._desired.setFromUnitVectors(down, rig._direction); orient(rig, bone, rig._desired);
  }
  function orientEuler(rig, bone, angles) {
    rig._desired.setFromEuler(rig._angles.fromArray(angles)); orient(rig, bone, rig._desired);
  }
  function solveLeg(rig, side) {
    const upper = rig.bones[`${side}UpperLeg`], lower = rig.bones[`${side}Shin`], foot = rig.bones[`${side}Foot`];
    const start = localPosition(rig, upper, rig._start);
    const target = rig.footprints[side];
    const solution = solveTwoBoneIK(start, target, 0.135, 0.124, legPole, rig._ik[`${side}Leg`]);
    pointBone(rig, upper, start, solution.joint); pointBone(rig, lower, solution.joint, solution.end);
    rig._desired.setFromAxisAngle(down, side === 'left' ? 0.07 : -0.07); orient(rig, foot, rig._desired);
    rig.joints[`${side}KneeFlexion`] = solution.flexion;
  }
  function solveArm(rig, side, target, handAngles) {
    const upper = rig.bones[`${side}UpperArm`], lower = rig.bones[`${side}Forearm`], hand = rig.bones[`${side}Hand`];
    const start = localPosition(rig, upper, rig._start);
    const solution = solveTwoBoneIK(start, target, 0.104, 0.091, side === 'left' ? leftArmPole : rightArmPole, rig._ik[`${side}Arm`]);
    pointBone(rig, upper, start, solution.joint); pointBone(rig, lower, solution.joint, solution.end);
    orientEuler(rig, hand, handAngles);
    rig.joints[`${side}ElbowFlexion`] = solution.flexion;
  }
  function applyPose(rig, time) {
    const p = sampleCrewPose(rig.id, time, rig.readiness, rig.pose), b = rig.bones;
    b.pelvis.position.fromArray(p.pelvis); b.pelvis.rotation.fromArray(p.pelvisRotation);
    b.spine.rotation.fromArray(p.spine); b.chest.rotation.fromArray(p.chest);
    b.neck.rotation.fromArray(p.neck); b.head.rotation.fromArray(p.head);
    b.rightShoulder.position.y = 0.028 + p.shoulderLift;
    b.leftShoulder.rotation.z = 0.008 * Math.sin(time * 0.41 + rig.id);
    b.rightShoulder.rotation.z = -p.shoulderLift * 2;
    rig.root.updateMatrixWorld(true); rig.root.getWorldQuaternion(rig._root);
    solveLeg(rig, 'left'); solveLeg(rig, 'right');
    if (rig.props.tablet) {
      solveArm(rig, 'left', p.leftWrist, p.leftHand);
      // The tapping target is measured from the actual held tablet. It therefore
      // stays on the display as the engineer shifts, breathes or looks up.
      rig._point.set(p.tapX, 0.008 + p.tapLift, 0.008);
      rig.props.tablet.localToWorld(rig._point); rig.root.worldToLocal(rig._point);
      rig._target[0] = rig._point.x; rig._target[1] = rig._point.y; rig._target[2] = rig._point.z;
      rig._desired.setFromEuler(rig._angles.fromArray(p.rightHand));
      rig._point.set(0, -0.034, 0).applyQuaternion(rig._desired);
      p.rightWrist[0] = rig._target[0] - rig._point.x;
      p.rightWrist[1] = rig._target[1] - rig._point.y;
      p.rightWrist[2] = rig._target[2] - rig._point.z;
    }
    solveArm(rig, 'right', p.rightWrist, p.rightHand);
    if (!rig.props.tablet) {
      if (rig.props.instrument && p.adjust > 0) {
        // The second hand reaches the instrument's actual display, rather than
        // gesturing around a fixed point while the carrying arm moves away.
        rig._point.set(-0.014, -0.031, 0.018);
        rig.props.instrument.localToWorld(rig._point); rig.root.worldToLocal(rig._point);
        rig._target[0] = rig._point.x; rig._target[1] = rig._point.y; rig._target[2] = rig._point.z;
        rig._desired.setFromEuler(rig._angles.fromArray(p.leftHand));
        rig._point.set(0, -0.030, 0).applyQuaternion(rig._desired);
        p.leftWrist[0] = mix(p.leftWrist[0], rig._target[0] - rig._point.x, p.adjust);
        p.leftWrist[1] = mix(p.leftWrist[1], rig._target[1] - rig._point.y, p.adjust);
        p.leftWrist[2] = mix(p.leftWrist[2], rig._target[2] - rig._point.z, p.adjust);
      }
      solveArm(rig, 'left', p.leftWrist, p.leftHand);
    }
    rig.skeleton.update();
    rig.root.userData.action = p.action;
  }
  let time = 0, lastInputTime = null, initialized = false, reduced = false, disposed = false;
  function update(t = 0, dt = 0, state = {}) {
    if (disposed) return;
    const input = Number.isFinite(t) ? t : (lastInputTime ?? 0);
    const paused = state.paused === true || state.power === false;
    const nowReduced = state.reducedMotion === true;
    const changedClock = lastInputTime === null || input !== lastInputTime;
    const step = Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
    const activation = clamp(Number.isFinite(state.activation) ? state.activation : 0, 0, 1);
    const firstUpdate = !initialized;
    if (firstUpdate) { time = input; initialized = true; }
    // Pausing or hiding can advance a host timestamp; never use that wall-time
    // gap as animation progress. The caller owns dt, and long resumes are clamped.
    if (!firstUpdate && !paused && !nowReduced && changedClock) time += step;
    lastInputTime = input;
    if (paused) return;
    for (const rig of rigs) {
      // A one-pole readiness transition is continuous through rapid reversals.
      // Reduced motion resolves to a static pose with no ambient cycles.
      rig.readiness = nowReduced ? activation : mix(rig.readiness, activation, 1 - Math.exp(-step / (1.05 + rig.id * 0.16)));
      applyPose(rig, nowReduced ? 0 : time);
    }
    reduced = nowReduced;
    stats.time = time;
    for (const rig of rigs) stats.readiness[rig.id] = rig.readiness;
    stats.reducedMotion = reduced;
  }
  const geometries = [bodyGeometry, helmetGeometry, tabletGeometry, instrumentGeometry];
  const stats = {
    workers: 3, skinnedMeshes: 3, bonesPerWorker: definitions.length,
    drawCalls: 14, geometries: geometries.length,
    triangles: bodyGeometry.getAttribute('position').count + (helmetGeometry.getAttribute('position').count + tabletGeometry.getAttribute('position').count + instrumentGeometry.getAttribute('position').count) / 3,
    time: 0, readiness: [0, 0, 0], reducedMotion: false,
  };
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const geometry of geometries) geometry.dispose();
    for (const material of ownMaterials) material.dispose();
    for (const rig of rigs) rig.skeleton.dispose();
    group.removeFromParent();
  }
  // The initial pose is already a grounded job pose before the first draw.
  group.updateMatrixWorld(true);
  for (const rig of rigs) applyPose(rig, 0);
  return { group, workers, rigs, update, dispose, stats, bodyGeometry };
}
