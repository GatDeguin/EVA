import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CREW_ROLES, createCrew, sampleCrewPose, solveTwoBoneIK } from '../src/crew.js';
import { createHangar } from '../src/hangar.js';
import { createEva } from '../src/eva.js';
import { updateWindowCamera } from '../src/projection.js';

const distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]));
const snapshot = crew => crew.rigs.map(rig => Object.values(rig.bones).map(bone => [...bone.position.toArray(), ...bone.quaternion.toArray()]));
const localFoot = (rig, side) => rig.root.worldToLocal(rig.bones[`${side}Foot`].getWorldPosition(new THREE.Vector3())).toArray();

test('analytic IK preserves segment lengths and handles collinear/unreachable inputs', () => {
  for (const target of [[0.03, 0.031, 0.01], [0, -1, 0], [0, 0.29, 0]]) {
    const start = [0, 0.29, 0];
    const solution = solveTwoBoneIK(start, target, 0.135, 0.124, [0, 0, 1]);
    assert.ok(Math.abs(distance(start, solution.joint) - 0.135) < 1e-9);
    assert.ok(Math.abs(distance(solution.joint, solution.end) - 0.124) < 1e-9);
    assert.ok([...solution.joint, ...solution.end, solution.flexion].every(Number.isFinite));
    if (solution.reachable) assert.ok(distance(solution.end, target) < 1e-9);
  }
});

test('three distinct jobs articulate their limbs while sharing one GPU body geometry', () => {
  const crew = createCrew(THREE);
  assert.deepEqual(crew.rigs.map(rig => rig.role), CREW_ROLES);
  assert.equal(new Set(crew.rigs.map(rig => rig.mesh.geometry)).size, 1);
  assert.ok(crew.rigs.every(rig => rig.mesh.isSkinnedMesh && rig.skeleton.bones.length === 19));
  assert.equal(crew.stats.drawCalls, 14);
  assert.equal(crew.stats.geometries, 4);
  assert.ok(crew.rigs[1].props.tablet.parent === crew.rigs[1].bones.leftHand);
  assert.ok(crew.rigs[2].props.instrument.parent === crew.rigs[2].bones.rightHand);
  const before = snapshot(crew);
  for (let frame = 0; frame <= 360; frame++) crew.update(frame / 60, 1 / 60, {});
  const after = snapshot(crew);
  for (let i = 0; i < 3; i++) {
    assert.notDeepEqual(before[i], after[i]);
    const rig = crew.rigs[i];
    assert.notDeepEqual(rig.bones.leftForearm.quaternion.toArray(), rig.bones.rightForearm.quaternion.toArray());
    assert.equal(rig.root.rotation.y, rig.root.userData.restHeading);
    assert.equal(rig.root.rotation.z, 0);
  }
  assert.notDeepEqual(crew.rigs[0].pose.rightWrist, crew.rigs[1].pose.rightWrist);
  assert.notDeepEqual(crew.rigs[1].pose.rightWrist, crew.rigs[2].pose.rightWrist);
  crew.dispose();
});

test('skin weights are normalized and soles remain on their fixed deck footprints through complete cycles', () => {
  const crew = createCrew(THREE);
  const geometry = crew.bodyGeometry;
  const weights = geometry.getAttribute('skinWeight'), indices = geometry.getAttribute('skinIndex');
  const positions = geometry.getAttribute('position');
  for (let vertex = 0; vertex < weights.count; vertex++) {
    assert.ok(Math.abs(weights.getX(vertex) + weights.getY(vertex) + weights.getZ(vertex) + weights.getW(vertex) - 1) < 1e-6);
  }
  const soleVertices = crew.rigs.map(rig => {
    const feet = [rig.skeleton.bones.indexOf(rig.bones.leftFoot), rig.skeleton.bones.indexOf(rig.bones.rightFoot)];
    const samples = [];
    for (let vertex = 0; vertex < positions.count; vertex++) {
      if (feet.includes(indices.getX(vertex)) && weights.getX(vertex) === 1 && Math.abs(positions.getY(vertex)) < 1e-8) {
        const point = rig.mesh.applyBoneTransform(vertex, new THREE.Vector3().fromBufferAttribute(positions, vertex));
        rig.mesh.localToWorld(point); samples.push({ vertex, point: point.clone() });
      }
    }
    assert.ok(samples.length >= 12);
    return samples;
  });
  const vertexPosition = new THREE.Vector3();
  for (let frame = 0; frame <= 720; frame++) {
    crew.update(frame / 20, 1 / 20, { activation: frame > 400 ? 1 : 0 });
    if (frame % 12) continue;
    for (const [id, rig] of crew.rigs.entries()) {
      for (const side of ['left', 'right']) {
        assert.ok(distance(localFoot(rig, side), rig.footprints[side]) < 1e-8, `${rig.role} ${side} ankle drift`);
        assert.ok(rig._ik[`${side}Leg`].reachable);
        assert.ok(rig.joints[`${side}KneeFlexion`] > 0.15 && rig.joints[`${side}KneeFlexion`] < 0.70);
        assert.ok(rig.joints[`${side}ElbowFlexion`] > 0.3 && rig.joints[`${side}ElbowFlexion`] < 2.4);
      }
      for (const { vertex, point } of soleVertices[id]) {
        vertexPosition.fromBufferAttribute(positions, vertex);
        rig.mesh.applyBoneTransform(vertex, vertexPosition); rig.mesh.localToWorld(vertexPosition);
        assert.ok(vertexPosition.distanceTo(point) < 2e-7, `${rig.role} skinned sole slid`);
        assert.ok(Math.abs(vertexPosition.y - 3.607) < 2e-7, `${rig.role} sole left deck`);
      }
    }
  }
  crew.dispose();
});

test('readiness eases continuously, reverses immediately, and remains finite after clock interruptions', () => {
  const crew = createCrew(THREE);
  crew.update(0, 0, {});
  for (let frame = 1; frame <= 60; frame++) crew.update(frame / 60, 1 / 60, { activation: 1 });
  for (const rig of crew.rigs) assert.ok(rig.readiness > 0.50 && rig.readiness < 0.65);
  const previous = crew.rigs.map(rig => rig.readiness);
  crew.update(1.02, 0.02, { activation: 0 });
  for (const [id, rig] of crew.rigs.entries()) assert.ok(rig.readiness < previous[id] && rig.readiness > previous[id] - 0.02);
  const paused = snapshot(crew), pausedTime = crew.stats.time;
  crew.update(50000, 50000, { paused: true, activation: 1 });
  assert.deepEqual(snapshot(crew), paused);
  assert.equal(crew.stats.time, pausedTime);
  crew.update(50001, 50000, { activation: 1 });
  assert.ok(crew.stats.time - pausedTime <= 0.1000001);
  crew.update(Number.NaN, Number.POSITIVE_INFINITY, { activation: Number.NaN });
  for (const person of snapshot(crew)) for (const transform of person) assert.ok(transform.every(Number.isFinite));
  crew.dispose();
});

test('a reducedMotion flag remains static while unpaused and reflects activation without a loop', () => {
  const crew = createCrew(THREE);
  crew.update(0, 0, { reducedMotion: true, activation: 0 });
  const stable = snapshot(crew);
  for (let frame = 1; frame <= 120; frame++) crew.update(frame / 60, 1 / 60, { reducedMotion: true, paused: false, activation: 0 });
  assert.deepEqual(snapshot(crew), stable);
  crew.update(3, 1 / 60, { reducedMotion: true, activation: 1 });
  assert.deepEqual(crew.rigs.map(rig => rig.readiness), [1, 1, 1]);
  const activated = snapshot(crew);
  assert.notDeepEqual(activated, stable);
  crew.update(900, 500, { reducedMotion: true, activation: 1 });
  assert.deepEqual(snapshot(crew), activated);
  crew.dispose();
});

test('working fingers reach the held device surfaces instead of detached animation targets', () => {
  const crew = createCrew(THREE);
  let taps = 0, adjustments = 0;
  for (let frame = 0; frame <= 720; frame++) {
    crew.update(frame / 60, 1 / 60, {});
    const engineer = crew.rigs[1], technician = crew.rigs[2];
    if (engineer.pose.tapLift < 0.003) {
      const finger = engineer.bones.rightHand.localToWorld(new THREE.Vector3(0, -0.034, 0));
      engineer.props.tablet.worldToLocal(finger);
      assert.ok(Math.abs(finger.y - (0.008 + engineer.pose.tapLift)) < 1e-7);
      assert.ok(Math.abs(finger.x) < 0.039 && Math.abs(finger.z) < 0.027);
      taps++;
    }
    if (technician.pose.adjust === 1) {
      const finger = technician.bones.leftHand.localToWorld(new THREE.Vector3(0, -0.030, 0));
      const control = technician.props.instrument.localToWorld(new THREE.Vector3(-0.014, -0.031, 0.018));
      assert.ok(finger.distanceTo(control) < 1e-7);
      adjustments++;
    }
  }
  assert.ok(taps > 10 && adjustments > 10);
  crew.dispose();
});

test('geometry and materials stay constant across repeated activation and job cycles; disposal is idempotent', () => {
  const crew = createCrew(THREE);
  const resources = () => {
    const geometries = new Set(), materials = new Set(); let draws = 0;
    crew.group.traverse(object => {
      if (!object.isMesh) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      draws += Array.isArray(object.material) ? object.geometry.groups.length : 1;
    });
    return { geometries, materials, draws };
  };
  const initial = resources();
  for (let frame = 0; frame < 1000; frame++) crew.update(frame / 30, 1 / 30, { activation: frame % 180 > 90 ? 1 : 0 });
  const final = resources();
  assert.deepEqual(final, initial);
  assert.equal(final.draws, crew.stats.drawCalls);
  assert.equal(final.geometries.size, crew.stats.geometries);
  let disposals = 0;
  for (const geometry of final.geometries) geometry.addEventListener('dispose', () => disposals++);
  crew.dispose(); crew.dispose();
  assert.equal(disposals, final.geometries.size);
});

test('pure job samples have intentional signal, tapping, adjustment and activation states', () => {
  const states = CREW_ROLES.map(() => new Set());
  for (let time = 0; time < 13; time += 0.1) for (let id = 0; id < 3; id++) states[id].add(sampleCrewPose(id, time).action);
  assert.ok(states[0].has('signals-clearance') && states[0].has('watches-eva'));
  assert.ok(states[1].has('taps-tablet') && states[1].has('reads-tablet') && states[1].has('checks-eva'));
  assert.ok(states[2].has('adjusts-instrument') && states[2].has('reads-instrument') && states[2].has('scans-equipment'));
  for (let id = 0; id < 3; id++) assert.equal(sampleCrewPose(id, 0, 1).action, 'activation-ready');
});

test('paused integrated hangar keeps GPU skin bounds, visible surfaces and workwear contrast in the initial window', () => {
  const previousDocument = globalThis.document;
  const context = new Proxy({}, {
    get(_object, key) {
      if (key === 'createImageData') return (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
      return () => {};
    },
    set() { return true; },
  });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
  let hangar;
  try {
    const scene = new THREE.Scene(), eva = createEva(THREE);
    hangar = createHangar(THREE);
    eva.group.position.set(0, 0, -5); scene.add(eva.group, hangar.group);
    eva.update(0, 0, { x: 0, y: 0, activation: 0.75 });
    hangar.update(0, 0, { paused: true, reducedMotion: true });
    scene.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera();
    updateWindowCamera(camera, { width: 18.028346456692912, height: 10.8, centerY: 5.45, eyeY: 5.45, eyeZ: 21.9375 });
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const ray = new THREE.Raycaster(), point = new THREE.Vector3(), projected = new THREE.Vector3();
    const bindVertex = new THREE.Vector4(), gpuVertex = new THREE.Vector4(), contribution = new THREE.Vector4(), matrix = new THREE.Matrix4();
    const luminance = color => color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
    for (const rig of hangar.crew.rigs) {
      const mesh = rig.mesh, g = mesh.geometry, positions = g.getAttribute('position');
      const worldBounds = new THREE.Box3(), screenBounds = new THREE.Box3();
      assert.equal(frustum.intersectsObject(mesh), true);
      rig.skeleton.computeBoneTexture(); rig.skeleton.update();
      for (let vertex = 0; vertex < positions.count; vertex += 7) {
        point.fromBufferAttribute(positions, vertex); mesh.applyBoneTransform(vertex, point); mesh.localToWorld(point);
        worldBounds.expandByPoint(point); projected.copy(point).project(camera); screenBounds.expandByPoint(projected);
        bindVertex.set(positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex), 1).applyMatrix4(mesh.bindMatrix);
        gpuVertex.set(0, 0, 0, 0);
        for (let influence = 0; influence < 4; influence++) {
          matrix.fromArray(rig.skeleton.boneMatrices, g.attributes.skinIndex.array[vertex * 4 + influence] * 16);
          contribution.copy(bindVertex).applyMatrix4(matrix);
          gpuVertex.addScaledVector(contribution, g.attributes.skinWeight.array[vertex * 4 + influence]);
        }
        gpuVertex.applyMatrix4(mesh.bindMatrixInverse).applyMatrix4(mesh.matrixWorld);
        assert.ok(Math.hypot(gpuVertex.x - point.x, gpuVertex.y - point.y, gpuVertex.z - point.z) < 3e-7);
      }
      assert.ok(worldBounds.min.y >= 3.607 - 1e-6 && worldBounds.max.y <= 4.25);
      assert.ok((screenBounds.max.y - screenBounds.min.y) * 635 * 0.78 / 2 > 26, 'the low-quality figure keeps at least 26 physical pixels of height');
      for (const height of [0.39, 0.55]) {
        point.set(0, height, 0); rig.root.localToWorld(point);
        ray.set(camera.position, projected.copy(point).sub(camera.position).normalize());
        const nearest = ray.intersectObject(scene, true).find(hit => hit.object.isMesh);
        assert.equal(nearest.object, mesh, `${rig.role} surface is hidden behind the EVA or bridge`);
      }
      // At this display scale and background, the original dark material lost
      // its body fill. Keep a reflectance floor without emissive/unlit figures.
      assert.ok(luminance(mesh.material[0].color) > 0.30);
      assert.ok(luminance(mesh.material[1].color) > 0.60);
      assert.equal(mesh.material[0].emissive.getHex(), 0);
      assert.ok(mesh.material.every(material => material.opacity === 1 && material.visible));
    }
  } finally {
    hangar?.crew.dispose();
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});
