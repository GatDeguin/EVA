import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEva } from '../src/eva.js';
import { applySurfaceDetail, buildSurfaceAttributes, createSurfaceTextureData } from '../src/surface-detail.js';
import { createExhibitLighting, createHangarEnvironment } from '../src/exhibit-lighting.js';

function range(values, stride = 1) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < values.length; i += stride) { min = Math.min(min, values[i]); max = Math.max(max, values[i]); }
  return { min, max };
}

test('finish fields are reproducible, bounded and visibly distinct scalar data', () => {
  const signatures = new Set();
  for (const role of ['paint', 'cast', 'machined', 'elastomer']) {
    const a = createSurfaceTextureData(role, 128), b = createSurfaceTextureData(role, 128);
    assert.deepEqual(a, b, `${role} must not depend on global random state or time`);
    const rough = range(a.roughness, 4), height = range(a.bump, 4);
    assert.ok(rough.min >= 185 && rough.max <= 255 && rough.max - rough.min >= 6);
    assert.ok(height.min >= 108 && height.max <= 148 && height.max - height.min >= 4);
    for (let i = 0; i < a.roughness.length; i += 4) {
      assert.equal(a.roughness[i], a.roughness[i + 1]);
      assert.equal(a.roughness[i + 1], a.roughness[i + 2]);
      assert.equal(a.roughness[i + 3], 255);
      assert.equal(a.bump[i + 3], 255);
    }
    signatures.add(Buffer.from(a.roughness).toString('base64'));
  }
  assert.equal(signatures.size, 4);
  assert.throws(() => createSurfaceTextureData('paint', 127), RangeError);
  assert.throws(() => createSurfaceTextureData('unknown'), RangeError);
});

test('UV charts recover metres without changing the authored UV layout or geometry', () => {
  const geometry = new THREE.BoxGeometry(2, 3, 4).toNonIndexed();
  const original = geometry.getAttribute('uv');
  const before = original.array.slice();
  const attributes = buildSurfaceAttributes(geometry);
  assert.equal(attributes.charts, 6, 'hard box faces must retain separate charts');
  assert.equal(geometry.getAttribute('uv'), original);
  assert.deepEqual(original.array, before);
  const expected = [[4, 3], [2, 4], [2, 3]];
  for (const axis of [0, 1, 2]) {
    const us = [], vs = [];
    for (let i = 0; i < original.count; i++) if (geometry.attributes.normal.array[i * 3 + axis] > .99) {
      us.push(attributes.uv1[i * 2]); vs.push(attributes.uv1[i * 2 + 1]);
    }
    const u = range(us), v = range(vs);
    assert.ok(Math.abs(u.max - u.min - expected[axis][0]) < 1e-5);
    assert.ok(Math.abs(v.max - v.min - expected[axis][1]) < 1e-5);
  }
  for (const values of [attributes.uv1, attributes.uv2, attributes.colors]) {
    for (const value of values) assert.ok(Number.isFinite(value));
  }
  assert.ok(range(attributes.uv2).min >= 0 && range(attributes.uv2).max <= 1);
  geometry.dispose();
});

test('the full EVA receives filtered object-space detail without more meshes or changed optics', () => {
  const scene = new THREE.Scene(), eva = createEva(THREE);
  scene.add(eva.group);
  const authored = new Map(), meshes = [];
  eva.group.traverse(mesh => {
    if (!mesh.isMesh) return;
    meshes.push(mesh);
    authored.set(mesh, { geometry: mesh.geometry, uv: mesh.geometry.getAttribute('uv'), position: mesh.geometry.getAttribute('position'), material: mesh.material });
  });
  const untouchedMaterial = new THREE.MeshStandardMaterial({ roughness: .93 });
  const untouched = new THREE.Mesh(new THREE.BoxGeometry(), untouchedMaterial);
  scene.add(untouched);
  const surface = applySurfaceDetail(THREE, scene, { maxAnisotropy: 2 });
  assert.equal(surface.stats.meshes, 32);
  assert.equal(surface.stats.materials, 16);
  assert.equal(surface.stats.textures, 10);
  assert.equal(surface.stats.addedDrawCalls, 0);
  assert.ok(surface.stats.textureBytes < 5 * 1024 * 1024);
  assert.ok(surface.stats.attributeBytes > 0 && surface.stats.attributeBytes < 8 * 1024 * 1024);
  assert.ok(surface.stats.polishedVertices > 0 && surface.stats.retainedVertices > 0);
  assert.equal(untouched.material, untouchedMaterial);
  assert.equal(untouched.material.roughnessMap, null);
  assert.equal(untouched.geometry.hasAttribute('uv1'), false);
  const textures = new Set();
  for (const mesh of meshes) {
    const saved = authored.get(mesh);
    assert.equal(mesh.geometry, saved.geometry);
    assert.equal(mesh.geometry.getAttribute('uv'), saved.uv);
    assert.equal(mesh.geometry.getAttribute('position'), saved.position);
    assert.equal(mesh.material, saved.material);
    if (!mesh.material.userData.surfaceRole) {
      assert.equal(mesh.geometry.hasAttribute('uv1'), false, 'optical lenses retain their smooth surface');
      continue;
    }
    for (const name of ['uv1', 'uv2', 'color']) for (const value of mesh.geometry.getAttribute(name).array) assert.ok(Number.isFinite(value));
    for (const name of ['roughnessMap', 'bumpMap', 'aoMap', 'clearcoatRoughnessMap']) {
      const texture = mesh.material[name];
      if (!texture) continue;
      textures.add(texture);
      assert.equal(texture.generateMipmaps, true);
      assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter);
      assert.equal(texture.magFilter, THREE.LinearFilter);
      assert.equal(texture.colorSpace, THREE.NoColorSpace);
      assert.ok(texture.anisotropy >= 1 && texture.anisotropy <= 2);
      assert.equal(texture.channel, name === 'roughnessMap' || name === 'bumpMap' ? 1 : 2);
      const data = texture.image.data;
      for (let i = 0; i < data.length; i += 4) {
        assert.equal(data[i], data[i + 1], 'scalar maps agree across backend channel conventions');
        assert.equal(data[i + 1], data[i + 2]);
      }
    }
  }
  assert.equal(textures.size, 10);
  let disposed = 0;
  for (const texture of textures) texture.addEventListener('dispose', () => disposed++);
  surface.dispose(); surface.dispose();
  assert.equal(disposed, 10);
  for (const mesh of meshes) {
    assert.equal(mesh.geometry.hasAttribute('uv1'), false);
    assert.equal(mesh.geometry.hasAttribute('uv2'), false);
    assert.equal(mesh.geometry.hasAttribute('color'), false);
    assert.equal(mesh.material.roughnessMap, null);
  }
});

test('the CanvasTexture path uploads the same scalar data and orientation', () => {
  const prior = globalThis.document;
  globalThis.document = {
    createElement() {
      const canvas = { width: 0, height: 0 };
      canvas.getContext = () => ({
        createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
        putImageData: image => { canvas.data = image.data; },
      });
      return canvas;
    },
  };
  try {
    const material = new THREE.MeshPhysicalMaterial({ clearcoat: .14 });
    material.userData.surfaceRole = 'paint';
    const scene = new THREE.Scene(); scene.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
    const surface = applySurfaceDetail(THREE, scene, { maxAnisotropy: 4 });
    assert.equal(material.roughnessMap.isCanvasTexture, true);
    assert.equal(material.roughnessMap.flipY, false);
    assert.equal(material.aoMap.flipY, false);
    assert.deepEqual(material.roughnessMap.image.data, createSurfaceTextureData('paint').roughness);
    surface.dispose();
  } finally {
    if (prior === undefined) delete globalThis.document; else globalThis.document = prior;
  }
});

test('lighting uses one shadow caster, settles, and applies reduced-motion states immediately', () => {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b1215);
  const rig = createExhibitLighting(THREE, scene);
  const lights = scene.children.filter(child => child.isLight);
  assert.equal(lights.length, 6);
  assert.equal(lights.filter(light => light.castShadow).length, 1);
  rig.update(0, .5, 'night', 1 / 60, true);
  assert.equal(rig.isSettled('night', .5), true);
  rig.update(0, .5, 'studio', 1 / 60, true);
  assert.equal(rig.isSettled('studio', .5), false);
  for (let i = 0; i < 120; i++) rig.update(i / 60, .5, 'studio', 1 / 60, true);
  assert.equal(rig.isSettled('studio', .5), true);
  rig.update(0, .8, 'alarm', 0, false);
  assert.equal(rig.isSettled('alarm', .8), true);
  const frozen = lights.map(light => light.intensity);
  rig.update(975.2, .8, 'alarm', 1 / 60, true);
  assert.deepEqual(lights.map(light => light.intensity), frozen, 'alarm has no sine pulse');
  rig.update(NaN, NaN, 'unknown', NaN, false);
  for (const light of lights) assert.ok(Number.isFinite(light.intensity));
  assert.equal(rig.isSettled('night', 0), true);
  rig.dispose();
  assert.equal(scene.children.length, 0);
});

test('the hangar reflection source contains finite HDR cards and can be disposed once', () => {
  const source = createHangarEnvironment(THREE), geometries = new Set(), materials = new Set();
  let hdr = 0;
  source.traverse(mesh => {
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry); materials.add(mesh.material);
    for (const n of [...mesh.position.toArray(), ...mesh.scale.toArray(), ...mesh.material.color.toArray()]) assert.ok(Number.isFinite(n));
    if (mesh.material.color.r > 1) hdr++;
  });
  assert.ok(hdr >= 8);
  assert.equal(geometries.size, 1, 'all temporary reflection panels share one geometry');
  let disposed = 0;
  for (const resource of [...geometries, ...materials]) resource.addEventListener('dispose', () => disposed++);
  source.dispose(); source.dispose();
  assert.equal(disposed, geometries.size + materials.size);
});
