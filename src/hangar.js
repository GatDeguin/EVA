import { createCrew } from './crew.js';

/**
 * Procedural, self-contained maintenance cage for the EVA display.
 * All dimensions are in display metres.  Front is +Z; the floor is Y = 0.
 * The shell is deliberately separate so an inspection camera can remove it.
 */
export function createHangar(THREE) {
  const group = new THREE.Group();
  group.name = 'EVA 01 • Cage 07';
  const shell = new THREE.Group();
  shell.name = 'Hangar walls';
  const structure = new THREE.Group();
  structure.name = 'Restraints, service decks, and floor';
  group.add(shell, structure);

  const batches = new Map();
  const animated = [];
  const lights = [];
  const vUp = new THREE.Vector3(0, 1, 0);
  let seed = 218761;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  // Each finish has its own scale and wear mechanism.  Paint is mostly intact;
  // the visible variation comes from handling, vertical runoff and roughness.
  // Separate random streams keep the manufactured panel layout deterministic.
  function surfaceTexture(kind, size = 512, variant = 0) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const roughCanvas = document.createElement('canvas');
    roughCanvas.width = roughCanvas.height = size;
    const roughCtx = roughCanvas.getContext('2d');
    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = bumpCanvas.height = size;
    const bumpCtx = bumpCanvas.getContext('2d');
    const pixels = ctx.createImageData(size, size);
    const roughPixels = roughCtx.createImageData(size, size);
    const bumpPixels = bumpCtx.createImageData(size, size);
    let localSeed = 769471 + variant * 7741 + (kind === 'wall' ? 501 : kind === 'floor' ? 1837 : 0);
    const rng = () => { localSeed = (1664525 * localSeed + 1013904223) >>> 0; return localSeed / 4294967296; };
    const lattice = Array.from({ length: 17 * 17 }, () => rng());
    const smooth = value => value * value * (3 - 2 * value);
    const field = (x, y, scale) => {
      const xx = x * scale, yy = y * scale;
      const ix = Math.floor(xx) % 16, iy = Math.floor(yy) % 16;
      const tx = smooth(xx - Math.floor(xx)), ty = smooth(yy - Math.floor(yy));
      const a = lattice[iy * 17 + ix] * (1 - tx) + lattice[iy * 17 + ix + 1] * tx;
      const b = lattice[(iy + 1) * 17 + ix] * (1 - tx) + lattice[(iy + 1) * 17 + ix + 1] * tx;
      return a * (1 - ty) + b * ty;
    };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const broad = field(x / size, y / size, 5.7) - 0.5;
        const fine = field(x / size, y / size, 15.1) - 0.5;
        const grain = (rng() - 0.5) * (kind === 'wall' ? 6.0 : 3.0);
        const edgeDistance = Math.min(x, y, size - 1 - x, size - 1 - y) / size;
        const edgeDeposit = kind === 'wall' ? Math.max(0, 1 - edgeDistance / 0.027) * 10 : 0;
        const value = Math.max(0, Math.min(255, 237 + broad * (kind === 'wall' ? 21 : 11) + fine * 4 + grain - edgeDeposit));
        pixels.data[i] = value;
        pixels.data[i + 1] = value;
        pixels.data[i + 2] = value - (kind === 'wall' ? 2 : 0);
        pixels.data[i + 3] = 255;
        const rough = (kind === 'wall' ? 236 : kind === 'floor' ? 211 : 207) + broad * 26 + fine * 9 + grain;
        const bump = 128 + grain * (kind === 'wall' ? 2.1 : 1.3) + fine * (kind === 'wall' ? 15 : 6);
        for (let c = 0; c < 3; c++) { roughPixels.data[i + c] = rough; bumpPixels.data[i + c] = bump; }
        roughPixels.data[i + 3] = bumpPixels.data[i + 3] = 255;
      }
    }
    ctx.putImageData(pixels, 0, 0);
    roughCtx.putImageData(roughPixels, 0, 0);
    bumpCtx.putImageData(bumpPixels, 0, 0);
    if (kind === 'wall') {
      // Faint, interrupted runoff originates under upper seams, never all over.
      for (let i = 0; i < 13; i++) {
        const x = 12 + rng() * (size - 24), y = rng() * size * 0.20;
        const length = size * (0.11 + rng() * 0.42), width = 0.45 + rng() * 2.0;
        const gradient = ctx.createLinearGradient(x, y, x, y + length);
        gradient.addColorStop(0, `rgba(78,82,65,${0.065 + rng() * 0.06})`);
        gradient.addColorStop(0.3, 'rgba(84,88,71,0.033)');
        gradient.addColorStop(1, 'rgba(84,88,71,0)');
        ctx.fillStyle = gradient; ctx.fillRect(x, y, width, length);
      }
      const baseDeposit = ctx.createLinearGradient(0, size * 0.89, 0, size);
      baseDeposit.addColorStop(0, 'rgba(76,78,62,0)'); baseDeposit.addColorStop(1, 'rgba(76,78,62,0.065)');
      ctx.fillStyle = baseDeposit; ctx.fillRect(0, size * 0.89, size, size * 0.11);
    } else {
      // Broad scuffs affect the specular response more than the paint colour.
      for (let i = 0; i < (kind === 'floor' ? 23 : 11); i++) {
        const x = rng() * size, y = rng() * size;
        const length = 14 + rng() * 92;
        ctx.strokeStyle = `rgba(255,255,246,${0.012 + rng() * 0.036})`;
        ctx.lineWidth = 0.5 + rng() * 1.0;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + length, y + rng() * 5); ctx.stroke();
        roughCtx.strokeStyle = 'rgba(100,100,100,0.16)'; roughCtx.lineWidth = 1.5 + rng() * 6;
        roughCtx.beginPath(); roughCtx.moveTo(x, y); roughCtx.lineTo(x + length, y + 2); roughCtx.stroke();
      }
      if (kind === 'metal') {
        for (let i = 0; i < 16; i++) {
          const x = rng() * size, y = rng() < 0.5 ? rng() * 18 : size - rng() * 18;
          ctx.fillStyle = `rgba(77,89,85,${0.025 + rng() * 0.045})`;
          ctx.fillRect(x, y, 1 + rng() * 8, 0.5 + rng() * 1.2);
        }
      }
    }
    const texture = (source, srgb) => {
      const result = new THREE.CanvasTexture(source);
      result.wrapS = result.wrapT = THREE.RepeatWrapping;
      result.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      result.anisotropy = 4;
      return result;
    };
    return { map: texture(canvas, true), roughnessMap: texture(roughCanvas, false), bumpMap: texture(bumpCanvas, false) };
  }

  const metalFinish = surfaceTexture('metal');
  const wallFinishes = [0, 1, 2].map(i => surfaceTexture('wall', 512, i));
  const floorFinish = surfaceTexture('floor');
  for (const map of Object.values(floorFinish)) map.repeat.set(2, 2);
  const metalMap = metalFinish.map;
  const wallMap = wallFinishes[0].map;
  const floorMap = floorFinish.map;

  const material = (c, roughness = 0.66, metalness = 0.25, map = metalMap) =>
    new THREE.MeshStandardMaterial({ color: c, roughness, metalness, map });
  const mat = {
    wall: [0x616b59, 0x656e5c, 0x56614f, 0x6a725f, 0x5e6757].map(c => material(c, 0.99, 0.025, wallMap)),
    wallBand: material(0x4e583e, 0.98, 0.055, wallMap),
    seam: material(0x222a24, 0.95, 0.10),
    frame: material(0x3b4841, 0.81, 0.31),
    steel: material(0x75858a, 0.83, 0.24),
    steelLight: material(0x86979b, 0.78, 0.27),
    steelMid: material(0x56696d, 0.87, 0.28),
    edge: material(0x9facab, 0.51, 0.60),
    recess: material(0x2b3639, 0.87, 0.24),
    dark: material(0x20292c, 0.82, 0.36),
    rubber: material(0x161c1d, 0.93, 0.02, null),
    bolt: material(0x798b8c, 0.49, 0.65),
    floor: material(0x8a1729, 0.90, 0.055, floorMap),
    base: material(0x321d27, 0.55, 0.33),
    paint: material(0x999779, 0.90, 0.03, null),
    redPaint: material(0x772a3d, 0.90, 0.03, null),
    crew: material(0xaab3a9, 0.92, 0.035, null),
    crewDark: material(0x6c7b70, 0.95, 0.035, null),
    lamp: new THREE.MeshStandardMaterial({ color: 0xcad9c9, emissive: 0xc5dcca, emissiveIntensity: 1.65, roughness: 0.43 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xd2a23f, emissive: 0xf0b44b, emissiveIntensity: 2.2, roughness: 0.30 }),
    signal: new THREE.MeshStandardMaterial({ color: 0x99bdb4, emissive: 0x94c6b4, emissiveIntensity: 1.8, roughness: 0.30 }),
  };

  for (const [i, m] of mat.wall.entries()) Object.assign(m, wallFinishes[i % 3], { bumpScale: 0.009 });
  Object.assign(mat.wallBand, wallFinishes[2], { bumpScale: 0.008 });
  for (const name of ['frame', 'steel', 'steelLight', 'steelMid', 'edge', 'recess', 'dark', 'bolt']) {
    Object.assign(mat[name], { roughnessMap: metalFinish.roughnessMap, bumpMap: metalFinish.bumpMap, bumpScale: 0.0045 });
  }
  Object.assign(mat.floor, floorFinish, { bumpScale: 0.006 });

  // Baked contact occlusion is restricted to known interfaces and uses the
  // standard material's indirect-light term.  Direct and moving shadows remain
  // real renderer shadows; no image of the scene or camera-facing shadow card.
  function floorContactAO() {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1024, 1024);
    const p = (x, z) => [(x + 7.4) / 14.8 * 1024, (z + 10.5) / 12 * 1024];
    const ellipse = (x, z, rx, rz, strength) => {
      const [px, py] = p(x, z);
      ctx.save(); ctx.translate(px, py); ctx.scale(rx / 14.8 * 1024, rz / 12 * 1024);
      const g = ctx.createRadialGradient(0, 0, 0.1, 0, 0, 1);
      g.addColorStop(0, `rgba(0,0,0,${strength})`); g.addColorStop(0.43, `rgba(0,0,0,${strength * 0.42})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
    };
    ellipse(0, -5.1, 3.8, 2.3, 0.35);
    for (const side of [-1, 1]) {
      ellipse(side * 4.43, -6.0, 1.42, 1.78, 0.59);
      ellipse(side * 4.56, 0.2, 0.74, 0.72, 0.70);
      ctx.save(); ctx.filter = 'blur(4px)'; ctx.lineWidth = 5.5; ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); const first = p(side * 5.45, -5.88); ctx.moveTo(...first);
      ctx.bezierCurveTo(...p(side * 7.03, -4.4), ...p(side * 5.87, -2.4), ...p(side * 6.44, -1.2)); ctx.stroke(); ctx.restore();
    }
    for (const side of [-1, 1]) {
      const edge = side < 0 ? 0 : 1024, inner = side < 0 ? 36 : 988;
      const g = ctx.createLinearGradient(edge, 0, inner, 0); g.addColorStop(0, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(Math.min(edge, inner), 0, 36, 1024);
    }
    const g = ctx.createLinearGradient(0, 0, 0, 30); g.addColorStop(0, 'rgba(0,0,0,0.33)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 30);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.NoColorSpace; texture.anisotropy = 4;
    return texture;
  }
  mat.floor.aoMap = floorContactAO(); mat.floor.aoMapIntensity = 0.75;

  function walkwayFinish() {
    const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 256;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#e7e9e1'; ctx.fillRect(0, 0, 2048, 256);
    const rough = document.createElement('canvas'); rough.width = 2048; rough.height = 256;
    const roughCtx = rough.getContext('2d'); roughCtx.fillStyle = '#dbdbdb'; roughCtx.fillRect(0, 0, 2048, 256);
    const ao = document.createElement('canvas'); ao.width = 2048; ao.height = 256;
    const aoCtx = ao.getContext('2d'); aoCtx.fillStyle = '#fff'; aoCtx.fillRect(0, 0, 2048, 256);
    const p = (x, z) => [(x + 4.45) / 8.9 * 2048, (z + 0.116) / 0.936 * 256];
    const track = roughCtx.createLinearGradient(0, 34, 0, 230);
    track.addColorStop(0, 'rgba(114,114,114,0)'); track.addColorStop(0.46, 'rgba(114,114,114,0.25)'); track.addColorStop(1, 'rgba(114,114,114,0)');
    roughCtx.fillStyle = track; roughCtx.fillRect(0, 34, 2048, 196);
    for (let i = 0; i < 59; i++) {
      const x = (i * 179.3 + 29) % 2048, y = 62 + (i * 53.7) % 128;
      ctx.strokeStyle = i % 3 ? 'rgba(108,123,110,0.040)' : 'rgba(255,255,250,0.12)';
      ctx.lineWidth = 0.4 + (i % 3) * 0.24; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 9 + (i * 7.2) % 58, y + (i % 5) - 2); ctx.stroke();
    }
    for (const [x, z] of [[-0.73, 0.34], [-0.10, 0.31], [0.66, 0.37]]) {
      for (const foot of [-0.044, 0.044]) {
        const [px, py] = p(x + foot, z);
        aoCtx.save(); aoCtx.translate(px, py); aoCtx.scale(19, 27);
        const g = aoCtx.createRadialGradient(0, 0, 0.10, 0, 0, 1);
        g.addColorStop(0, 'rgba(0,0,0,0.57)'); g.addColorStop(0.42, 'rgba(0,0,0,0.19)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        aoCtx.fillStyle = g; aoCtx.fillRect(-1, -1, 2, 2); aoCtx.restore();
      }
    }
    const texture = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 4; return t; };
    return { map: texture(canvas, true), roughnessMap: texture(rough, false), aoMap: texture(ao, false) };
  }
  mat.deck = new THREE.MeshStandardMaterial({ color: 0x7b8c90, roughness: 0.86, metalness: 0.19, ...walkwayFinish(), aoMapIntensity: 0.68 });
  mat.deck.userData.uvProjection = 'walkway';

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitSphere = new THREE.SphereGeometry(1, 14, 10);
  const tmpObject = new THREE.Object3D();

  function addGeometry(geometry, m, parent = structure, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1], castShadow = true) {
    tmpObject.position.set(...position);
    tmpObject.rotation.set(...rotation);
    tmpObject.scale.set(...scale);
    tmpObject.updateMatrix();
    const g = geometry.clone().applyMatrix4(tmpObject.matrix);
    if (m.userData.uvProjection === 'walkway') {
      const positions = g.attributes.position, uv = new Float32Array(positions.count * 2);
      for (let i = 0; i < positions.count; i++) { uv[i * 2] = (positions.getX(i) + 4.45) / 8.9; uv[i * 2 + 1] = 1 - (positions.getZ(i) + 0.116) / 0.936; }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    const key = `${parent.id}:${m.id}:${castShadow ? 1 : 0}`;
    if (!batches.has(key)) batches.set(key, { parent, material: m, castShadow, geometries: [] });
    batches.get(key).geometries.push(g);
  }

  function box(m, x, y, z, w, h, d, parent = structure, rotation = [0, 0, 0], cast = true) {
    addGeometry(unitBox, m, parent, [x, y, z], rotation, [w, h, d], cast);
  }

  function cylinder(m, x, y, z, rTop, rBottom, height, segments = 12, rotation = [0, 0, 0], parent = structure) {
    const g = new THREE.CylinderGeometry(rTop, rBottom, height, segments);
    addGeometry(g, m, parent, [x, y, z], rotation); g.dispose();
  }

  function bar(m, a, b, width, depth = width, parent = structure) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const direction = end.clone().sub(start);
    const q = new THREE.Quaternion().setFromUnitVectors(vUp, direction.clone().normalize());
    const matrix = new THREE.Matrix4().compose(start.add(end).multiplyScalar(0.5), q, new THREE.Vector3(width, direction.length(), depth));
    const g = unitBox.clone().applyMatrix4(matrix);
    const key = `${parent.id}:${m.id}:1`;
    if (!batches.has(key)) batches.set(key, { parent, material: m, castShadow: true, geometries: [] });
    batches.get(key).geometries.push(g);
  }

  function pipe(m, points, radius = 0.045, parent = structure, segments = 28) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    const geometry = new THREE.TubeGeometry(curve, segments, radius, 6, false);
    addGeometry(geometry, m, parent); geometry.dispose();
  }

  function xyPlate(points, depth, m, x, y, z, bevel = 0.035, parent = structure) {
    const s = new THREE.Shape();
    points.forEach((p, i) => i ? s.lineTo(...p) : s.moveTo(...p)); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, steps: 1, curveSegments: 1 });
    addGeometry(g, m, parent, [x, y, z]); g.dispose();
  }

  function yzPrism(points, width, m, x, bevel = 0.05) {
    const s = new THREE.Shape();
    points.forEach(([z, y], i) => i ? s.lineTo(-z, y) : s.moveTo(-z, y)); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, steps: 1, curveSegments: 1 });
    addGeometry(g, m, structure, [x - width / 2, 0, 0], [0, Math.PI / 2, 0]); g.dispose();
  }

  // A small local merge avoids a second runtime dependency and keeps the cage
  // inexpensive even though bolts, grilles, seams, and wall panels are physical.
  function merge(geometries) {
    const gs = geometries.map(g => g.index ? g.toNonIndexed() : g);
    const count = gs.reduce((n, g) => n + g.attributes.position.count, 0);
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    let offset = 0;
    for (const g of gs) {
      const n = g.attributes.position.count;
      positions.set(g.attributes.position.array, offset * 3);
      normals.set(g.attributes.normal.array, offset * 3);
      if (g.attributes.uv) uvs.set(g.attributes.uv.array, offset * 2);
      offset += n;
    }
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    result.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    result.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    result.computeBoundingSphere(); result.computeBoundingBox();
    for (let i = 0; i < geometries.length; i++) { if (gs[i] !== geometries[i]) gs[i].dispose(); geometries[i].dispose(); }
    return result;
  }

  function label(text, x, y, z, width, height, options = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 1024, 256);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = options.color || '#c4c7a9';
    ctx.font = `600 ${options.fontSize || 118}px "Courier New", monospace`;
    ctx.fillText(text, 512, options.sub ? 108 : 130, 970);
    if (options.sub) {
      ctx.font = '32px "Courier New", monospace';
      ctx.fillText(options.sub, 512, 204, 950);
    }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshStandardMaterial({ map: texture, transparent: true, alphaTest: 0.08, depthWrite: false, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), m);
    mesh.position.set(x, y, z); mesh.rotation.y = options.rotation || 0;
    mesh.name = text; (options.parent || shell).add(mesh);
    return mesh;
  }

  // Crimson display plinth and a matte, shadow-receiving surface.
  box(mat.base, 0, -0.24, -4.52, 15.14, 0.47, 12.24);
  box(mat.floor, 0, -0.025, -4.50, 14.80, 0.05, 12.00);
  box(mat.dark, 0, -0.27, 1.64, 15.14, 0.24, 0.14);
  box(mat.steelMid, 0, -0.11, 1.67, 14.91, 0.04, 0.025);
  for (const side of [-1, 1]) {
    box(mat.dark, side * 7.34, 0.07, -4.49, 0.12, 0.14, 11.98);
    box(mat.redPaint, side * 6.16, 0.007, -4.6, 0.035, 0.009, 9.1, structure, [0, 0, 0], false);
    for (let j = 0; j < 7; j++) {
      box(mat.paint, side * 6.19, 0.013, -9.1 + j * 1.37, 0.035, 0.009, 0.46, structure, [0, 0, 0], false);
    }
  }

  // Recessed backing and an intentionally irregular panel grid.
  box(mat.seam, 0, 6.25, -10.64, 15.1, 12.50, 0.34, shell);
  for (const side of [-1, 1]) box(mat.seam, side * 7.55, 6.25, -4.50, 0.32, 12.5, 12.0, shell);
  // A shallow ceiling closes the volume when the viewer looks up through the
  // off-axis window.  Broad panels keep the upper region visually quiet.
  box(mat.seam, 0, 12.46, -4.50, 15.10, 0.08, 12.0, shell);
  for (let x = -5.52; x < 7.0; x += 3.68) {
    for (let z = -8.875; z < 1.2; z += 2.96) {
      box(mat.wall[2], x, 12.399, z, 3.625, 0.034, 2.905, shell);
    }
  }
  for (const z of [-9.65, -4.60, 0.90]) {
    box(mat.frame, 0, 12.34, z, 14.67, 0.12, 0.17, shell);
    box(mat.steelMid, 0, 12.27, z, 14.67, 0.025, 0.053, shell);
  }
  for (const x of [-4.75, 4.75]) {
    box(mat.recess, x, 12.355, -2.85, 1.38, 0.055, 0.25, shell);
    box(mat.lamp, x, 12.319, -2.85, 1.05, 0.015, 0.094, shell, [0, 0, 0], false);
  }
  const rows = [0.07, 2.14, 4.64, 7.82, 10.15, 12.45];
  for (let row = 0; row < rows.length - 1; row++) {
    let x = -7.28;
    while (x < 7.27) {
      const width = Math.min(1.03 + random() * 1.63, 7.28 - x);
      const height = rows[row + 1] - rows[row];
      box(mat.wall[Math.floor(random() * mat.wall.length)], x + width / 2, rows[row] + height / 2, -10.42, width - 0.037, height - 0.047, 0.12, shell);
      if (width > 1.7 && row % 2 === 0) box(mat.seam, x + width * 0.57, rows[row] + height * 0.33, -10.351, 0.018, height * 0.66, 0.008, shell, [0, 0, 0], false);
      if (random() > 0.68) box(mat.frame, x + width / 2, rows[row] + 0.06, -10.345, width - 0.12, 0.023, 0.015, shell);
      x += width;
    }
    for (const side of [-1, 1]) {
      let z = -10.37;
      while (z < 1.49) {
        const length = Math.min(1.03 + random() * 1.74, 1.50 - z);
        const height = rows[row + 1] - rows[row];
        box(mat.wall[Math.floor(random() * mat.wall.length)], side * 7.355, rows[row] + height / 2, z + length / 2, 0.13, height - 0.046, length - 0.041, shell);
        if (length > 1.45 && (row + (side > 0 ? 1 : 0)) % 2 === 0) box(mat.seam, side * 7.283, rows[row] + height * 0.58, z + length * 0.67, 0.01, height * 0.82, 0.017, shell, [0, 0, 0], false);
        if (random() > 0.70) box(mat.frame, side * 7.279, rows[row] + height * 0.37, z + length / 2, 0.012, 0.020, length - 0.1, shell);
        z += length;
      }
    }
  }
  for (const side of [-1, 1]) {
    for (const z of [-8.10, -2.0]) {
      box(mat.wallBand, side * 7.266, 6.25, z, 0.06, 12.40, 0.33, shell);
      box(mat.frame, side * 7.227, 6.25, z - 0.19, 0.065, 12.42, 0.046, shell);
      box(mat.frame, side * 7.227, 6.25, z + 0.19, 0.065, 12.42, 0.046, shell);
    }
    for (const y of [2.18, 4.64, 11.95]) {
      box(mat.frame, side * 7.245, y, -4.51, 0.10, 0.05, 11.94, shell);
      box(mat.edge, side * 7.192, y + 0.059, -4.51, 0.045, 0.014, 11.9, shell);
      for (let z = -9.8; z < 1.4; z += 1.3) box(mat.bolt, side * 7.178, y, z, 0.025, 0.09, 0.075, shell);
    }
    for (const z of [-9.88, -4.94, 1.12]) {
      box(mat.frame, side * 7.19, 6.22, z, 0.18, 12.35, 0.13, shell);
      box(mat.steelMid, side * 7.084, 6.22, z, 0.034, 12.35, 0.048, shell);
    }
    for (const y of [3.12, 3.28]) {
      pipe(mat.frame, [[side * 7.17, y, 1.35], [side * 7.17, y, -3.0], [side * 7.17, y, -9.85], [side * 6.82, y, -10.2]], 0.032, shell, 14);
      for (let z = -9.4; z < 1.1; z += 1.48) box(mat.steelMid, side * 7.145, y, z, 0.075, 0.12, 0.055, shell);
    }
    box(mat.frame, side * 6.43, 6.23, -10.295, 0.18, 12.38, 0.17, shell);
    box(mat.steelMid, side * 6.43, 6.23, -10.190, 0.055, 12.38, 0.024, shell);
  }
  for (const y of [4.65, 9.98, 12.24]) box(mat.frame, 0, y, -10.286, 14.51, 0.075, 0.11, shell);
  // Foreground jambs are an actual occluding aperture.  The inner reveal and
  // quiet chamfer are strong parallax cues, especially as the viewer moves.
  for (const side of [-1, 1]) {
    box(mat.dark, side * 7.325, 6.25, 1.435, 0.35, 12.5, 0.53, shell);
    box(mat.frame, side * 7.127, 6.25, 1.34, 0.060, 12.33, 0.37, shell);
    box(mat.recess, side * 7.083, 6.25, 1.224, 0.032, 12.26, 0.14, shell);
    for (const y of [0.62, 3.61, 8.81, 11.93]) {
      cylinder(mat.recess, side * 7.315, y, 1.713, 0.057, 0.057, 0.016, 6, [Math.PI / 2, 0, 0], shell);
    }
  }
  box(mat.dark, 0, 12.30, 1.435, 14.66, 0.40, 0.53, shell);
  box(mat.frame, 0, 12.073, 1.34, 14.21, 0.052, 0.37, shell);
  box(mat.dark, 0, 0.074, 1.435, 14.66, 0.148, 0.53, shell);
  box(mat.steelMid, 0, 0.160, 1.432, 14.20, 0.024, 0.38, shell);
  label('CAGE 07', 0, 11.54, -10.326, 2.36, 0.60, { sub: 'EVANGELION  /  RESTRAINT SYSTEM', color: '#b0b59a' });
  label('EVA 01', -5.24, 7.65, -10.325, 1.20, 0.36, { color: '#a2aa90' });
  label('07', 7.271, 8.80, -2.82, 0.94, 0.55, { rotation: -Math.PI / 2, color: '#a9af93' });
  label('AUTHORIZED PERSONNEL', -7.274, 1.67, -1.33, 1.32, 0.23, { rotation: Math.PI / 2, color: '#b2b499', fontSize: 88 });

  // Tall, heavy articulated restraints.  Their cross-section reproduces the
  // stepped fin, deep upper shield, sloped shoulder saddle, and flared foot.
  const pylonProfile = [
    [-7.0, 0.68], [-5.25, 0.68], [-4.94, 1.28], [-4.72, 2.52],
    [-3.55, 3.71], [-3.50, 4.13], [-4.63, 5.19], [-5.25, 6.55],
    [-5.25, 10.38], [-6.03, 10.59], [-6.03, 11.67], [-7.0, 11.67],
  ];
  const shieldBack = [[-0.60, 0.0], [0.60, 0.0], [0.60, -2.9], [0.23, -3.52], [-0.28, -3.80], [-0.60, -3.25]];
  const shieldFace = [[-0.43, -0.16], [0.43, -0.16], [0.43, -2.77], [0.12, -3.27], [-0.11, -3.44], [-0.43, -3.02]];
  for (const side of [-1, 1]) {
    const x = side * 4.43;
    yzPrism(pylonProfile, 1.61, mat.steelMid, x, 0.065);
    // The narrow top stem and its brighter rim catch the light above the head.
    box(mat.recess, x, 11.00, -5.998, 1.13, 1.16, 0.04);
    box(mat.steel, x - 0.71, 11.12, -5.973, 0.14, 1.26, 0.105);
    box(mat.steel, x + 0.71, 11.12, -5.973, 0.14, 1.26, 0.105);
    box(mat.steelLight, x, 11.73, -6.08, 1.48, 0.07, 0.82);
    xyPlate(shieldBack, 0.042, mat.dark, x, 10.38, -5.163, 0.022);
    xyPlate(shieldFace, 0.046, mat.steel, x, 10.38, -5.084, 0.040);
    // The raised frame projects farther than the shield: the dark reveal is a
    // real space between layered parts and stays convincing as the camera moves.
    box(mat.steel, x - 0.707, 8.48, -4.978, 0.153, 3.87, 0.302);
    box(mat.steel, x + 0.707, 8.48, -4.978, 0.153, 3.87, 0.302);
    box(mat.steel, x, 10.45, -5.017, 1.57, 0.175, 0.36);
    box(mat.steelLight, x - 0.773, 8.48, -4.815, 0.018, 3.85, 0.020);
    box(mat.steelLight, x + 0.773, 8.48, -4.815, 0.018, 3.85, 0.020);
    box(mat.recess, x, 10.303, -4.983, 1.28, 0.051, 0.17);
    for (const y of [7.59, 7.93, 8.27]) bar(mat.recess, [x - 0.30, y, -4.994], [x + 0.29, y + 0.32, -4.994], 0.018, 0.010);
    for (const yy of [7.0, 8.6, 10.16]) {
      for (const xx of [-0.69, 0.69]) cylinder(mat.bolt, x + xx, yy, -4.803, 0.032, 0.032, 0.024, 6, [Math.PI / 2, 0, 0]);
    }
    // Paired ribs on the pylon's visible outer side.
    for (const dz of [-6.84, -6.60]) box(mat.recess, x + side * 0.82, 8.21, dz, 0.025, 6.32, 0.027);
    // Substantial low pivot, with stepped hub and visible hexagonal cap.
    cylinder(mat.recess, x, 1.96, -5.98, 1.23, 1.23, 1.78, 12, [0, 0, Math.PI / 2]);
    cylinder(mat.steelMid, x + side * 0.92, 1.96, -5.98, 1.01, 1.01, 0.18, 10, [0, 0, Math.PI / 2]);
    cylinder(mat.dark, x + side * 1.032, 1.96, -5.98, 0.64, 0.64, 0.08, 8, [0, 0, Math.PI / 2]);
    cylinder(mat.steel, x + side * 1.09, 1.96, -5.98, 0.51, 0.51, 0.10, 6, [0, 0, Math.PI / 2]);
    cylinder(mat.bolt, x + side * 1.16, 1.96, -5.98, 0.21, 0.21, 0.045, 6, [0, 0, Math.PI / 2]);
    yzPrism([[-7.02, 0.57], [-5.44, 0.57], [-5.07, 0.97], [-4.90, 2.72], [-3.60, 3.37], [-3.73, 3.79], [-5.30, 3.18], [-6.79, 3.25]], 0.19, mat.steel, x + side * 0.88, 0.055);
    box(mat.dark, x, 0.61, -6.08, 1.78, 0.12, 1.77);
    yzPrism([[-7.0, 0.025], [-5.16, 0.025], [-5.32, 0.53], [-6.85, 0.53]], 1.71, mat.recess, x, 0.026);
    // Forward arm: an angular solid with a low outer rail and thin access plates.
    yzPrism([[-4.04, 3.30], [-0.05, 3.23], [1.01, 3.32], [1.01, 3.73], [0.67, 3.90], [-3.71, 3.90], [-4.04, 4.10]], 1.76, mat.steel, x, 0.048);
    for (const z of [-3.2, -2.14, -1.08, -0.02]) {
      box(mat.recess, x, 3.945, z, 1.47, 0.014, 0.965);
      box(mat.steel, x, 3.963, z, 1.435, 0.020, 0.93);
      box(mat.steelMid, x - side * 0.33, 3.984, z - 0.23, 0.45, 0.021, 0.026);
      box(mat.steelMid, x - side * 0.33, 3.984, z + 0.22, 0.45, 0.021, 0.026);
      for (const xx of [-0.60, 0.60]) cylinder(mat.bolt, x + xx, 3.982, z + 0.37, 0.021, 0.021, 0.013, 6);
    }
    box(mat.steel, x + side * 0.853, 4.036, -1.25, 0.095, 0.22, 4.21);
    box(mat.steelLight, x + side * 0.857, 4.149, -1.25, 0.104, 0.014, 4.25);
    box(mat.recess, x, 3.247, -1.22, 1.61, 0.097, 3.91);
    // Shoulder saddle slopes back up to the tall fin, leaving the face unobscured.
    bar(mat.recess, [x, 3.99, -3.62], [x, 5.40, -5.14], 1.59, 0.24);
    bar(mat.steel, [x, 4.04, -3.64], [x, 5.43, -5.15], 1.33, 0.20);
    for (const offset of [-0.746, 0.746]) bar(mat.steel, [x + offset, 4.01, -3.62], [x + offset, 5.50, -5.14], 0.11, 0.29);
    box(mat.steel, x, 5.56, -5.19, 1.65, 0.17, 0.40);
    cylinder(mat.recess, x - side * 0.62, 5.63, -4.93, 0.24, 0.28, 0.30, 8, [0.3, 0, 0]);
    cylinder(mat.bolt, x - side * 0.62, 5.78, -4.89, 0.21, 0.21, 0.09, 6, [0.3, 0, 0]);
    // Dark diagonal ventilation cut-outs on the outer cantilever fascias.
    box(mat.recess, x + side * 0.895, 3.565, -1.13, 0.017, 0.13, 3.60);
    for (let j = 0; j < 31; j++) {
      bar(mat.steelMid, [x + side * 0.912, 3.490, -2.92 + j * 0.116], [x + side * 0.912, 3.645, -2.83 + j * 0.116], 0.018, 0.026);
    }
    box(mat.recess, x, 3.538, 1.064, 1.37, 0.17, 0.014);
    for (let j = 0; j < 11; j++) box(mat.steelMid, x - 0.64 + j * 0.125, 3.54, 1.08, 0.027, 0.18, 0.024, structure, [0, 0, -0.62]);
    cylinder(mat.dark, x + side * 0.70, 3.69, 1.112, 0.263, 0.263, 0.18, 8, [Math.PI / 2, 0, 0]);
    cylinder(mat.bolt, x + side * 0.70, 3.69, 1.233, 0.231, 0.231, 0.10, 6, [Math.PI / 2, 0, 0]);
    // Slender ribbed support legs beneath the nose of each platform.
    box(mat.recess, x + side * 0.13, 1.59, 0.20, 0.42, 3.18, 0.51);
    box(mat.steelMid, x + side * 0.13, 1.59, 0.486, 0.42, 3.08, 0.045);
    for (let j = 0; j < 30; j++) box(mat.steel, x + side * 0.13, 0.17 + j * 0.095, 0.513, 0.435, 0.012, 0.012);
    box(mat.steel, x + side * 0.13, 0.11, 0.22, 0.68, 0.20, 0.70);
    for (const ox of [-0.22, 0.22]) cylinder(mat.bolt, x + side * 0.13 + ox, 0.227, 0.4, 0.045, 0.045, 0.035, 6);
    // Floor power looms curve away behind the machinery; no crossing of the open front.
    for (let j = 0; j < 3; j++) {
      pipe(mat.rubber, [[x + side * 0.78, 0.28, -5.99], [side * (5.80 + j * 0.11), 0.077, -5.75], [side * (6.36 + j * 0.10), 0.061, -4.38], [side * (6.19 + j * 0.11), 0.061, -2.33], [side * 6.44, 0.062, -1.20]], 0.055, structure, 32);
    }
    for (const z of [-4.77, -3.73, -2.67]) {
      box(mat.steelMid, side * 6.47, 0.145, z, 0.46, 0.04, 0.055);
      for (const dx of [-0.218, 0.218]) box(mat.steelMid, side * 6.47 + dx, 0.0625, z, 0.040, 0.125, 0.055);
    }
    // Quiet utility indicators and a tiny service terminal on each outer arm.
    box(mat.recess, x + side * 0.32, 4.047, -2.84, 0.50, 0.17, 0.31, structure, [-0.28, 0, 0]);
    box(mat.dark, x + side * 0.32, 4.145, -2.83, 0.43, 0.015, 0.25, structure, [-0.28, 0, 0]);
    box(mat.signal, x + side * 0.38, 4.162, -2.79, 0.17, 0.009, 0.12, structure, [-0.28, 0, 0], false);
    box(mat.amber, x + side * 0.74, 11.18, -5.905, 0.047, 0.29, 0.020, structure, [0, 0, 0], false);
  }

  // The bridge is thin enough to expose the breastplate, and its low lip stays
  // below the crew's knees.  Physical slashes make its front edge read as a grate.
  box(mat.recess, 0, 3.474, 0.34, 8.85, 0.20, 0.91);
  box(mat.steelMid, 0, 3.580, 0.34, 8.84, 0.025, 0.90);
  box(mat.dark, 0, 3.334, 0.25, 8.59, 0.078, 0.50);
  for (let i = 0; i < 12; i++) {
    const x = -4.22 + i * 0.767;
    if (x > 4.20) break;
    box(mat.deck, x, 3.599, 0.34, 0.73, 0.016, 0.77);
    box(mat.steelMid, x, 3.614, 0.37, 0.30, 0.016, 0.015);
    for (const z of [0.00, 0.69]) cylinder(mat.bolt, x + 0.28, 3.620, z, 0.018, 0.018, 0.012, 6);
  }
  box(mat.dark, 0, 3.472, 0.813, 8.85, 0.135, 0.029);
  for (let i = 0; i < 87; i++) {
    const x = -4.36 + i * 0.101;
    if (Math.abs(x) < 0.13 || Math.abs(x) > 4.00) continue;
    box(mat.steel, x, 3.475, 0.841, 0.017, 0.148, 0.014, structure, [0, 0, -0.67]);
  }
  box(mat.steelMid, 0, 3.474, 0.852, 0.23, 0.178, 0.043);
  for (const z of [-0.116, 0.819]) box(mat.steel, 0, 3.613, z, 8.92, 0.035, 0.033);
  for (const [x, width] of [[-3.14, 0.37], [-0.67, 0.19], [1.17, 0.25], [3.38, 0.31]]) box(mat.steelLight, x, 3.632, 0.819, width, 0.008, 0.028);
  for (const side of [-1, 1]) {
    bar(mat.steelMid, [side * 4.10, 3.37, 0.33], [side * 3.63, 3.11, -0.13], 0.12, 0.13);
    box(mat.recess, side * 4.28, 3.50, 0.35, 0.34, 0.34, 1.05);
    box(mat.steel, side * 4.28, 3.52, 0.35, 0.24, 0.33, 1.04);
    for (const z of [0.00, 0.69]) cylinder(mat.bolt, side * 4.28, 3.704, z, 0.028, 0.028, 0.025, 6);
  }

  // Shared GPU-skinned figures retain their service jobs and planted footprints.
  const crew = createCrew(THREE, { materials: mat, deckY: 3.607 });
  const workers = crew.workers;
  structure.add(crew.group);
  animated.push(...workers);

  // Recessed wall fixtures provide parallax landmarks without becoming a neon
  // frame.  They use emissive geometry; the host controls the room's lighting.
  for (const side of [-1, 1]) {
    for (const z of [-8.7, -3.15, 0.85]) {
      box(mat.recess, side * 7.06, 7.39, z, 0.23, 1.17, 0.22, shell);
      box(mat.steelMid, side * 6.921, 7.39, z, 0.058, 1.10, 0.24, shell);
      box(mat.lamp, side * 6.881, 7.39, z, 0.026, 0.80, 0.114, shell, [0, 0, 0], false);
      for (const yy of [7.03, 7.77]) box(mat.frame, side * 6.855, yy, z, 0.025, 0.046, 0.19, shell);
    }
    box(mat.recess, side * 5.29, 11.66, -10.18, 0.91, 0.17, 0.14, shell);
    box(mat.lamp, side * 5.29, 11.66, -10.09, 0.67, 0.053, 0.035, shell, [0, 0, 0], false);
    // Low equipment boxes break up the empty wall without competing with the bust.
    box(mat.frame, side * 6.86, 1.0, -7.42, 0.52, 1.42, 0.98, shell);
    box(mat.steelMid, side * 6.57, 1.02, -7.42, 0.07, 1.15, 0.79, shell);
    for (let i = 0; i < 6; i++) box(mat.recess, side * 6.528, 1.31 - i * 0.087, -7.42, 0.014, 0.025, 0.57, shell);
  }

  // Finish static batches.  The shell owns its own batches, including fixtures.
  let staticPieces = 0;
  for (const batch of batches.values()) {
    staticPieces += batch.geometries.length;
    const mesh = new THREE.Mesh(merge(batch.geometries), batch.material);
    mesh.castShadow = batch.castShadow;
    mesh.receiveShadow = true;
    mesh.name = batch.parent === shell ? 'Architectural detail' : 'Mechanical detail';
    batch.parent.add(mesh);
  }
  batches.clear(); unitBox.dispose(); unitSphere.dispose();

  const dustGeometry = new THREE.BufferGeometry();
  const dustPositions = new Float32Array(66 * 3);
  for (let i = 0; i < 66; i++) {
    dustPositions[i * 3] = (random() - 0.5) * 12.6;
    dustPositions[i * 3 + 1] = 0.7 + random() * 11.2;
    dustPositions[i * 3 + 2] = -0.45 - random() * 8.9;
  }
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0xc4d4bd, size: 0.018, transparent: true, opacity: 0.16, depthWrite: false, sizeAttenuation: true }));
  dust.name = 'Airborne dust'; group.add(dust); animated.push(dust);

  let mode = 'window';
  function setMode(nextMode = 'window') {
    mode = nextMode;
    shell.visible = nextMode !== 'inspect';
    dust.visible = nextMode !== 'inspect';
  }
  function update(t = 0, dt = 0, state = {}) {
    const time = Number.isFinite(t) ? t : 0;
    if (state.power === false) {
      mat.amber.emissiveIntensity = 0.35;
      mat.signal.emissiveIntensity = 0.20;
    } else if (state.paused !== true) {
      const lightTime = state.reducedMotion === true ? 0 : time;
      mat.amber.emissiveIntensity = 1.9 + 0.32 * Math.sin(lightTime * 1.3);
      mat.signal.emissiveIntensity = 1.5 + 0.20 * Math.sin(lightTime * 0.67 + 1.2);
    }
    crew.update(time, dt, state);
    if (state.paused !== true && state.reducedMotion !== true && state.power !== false) {
      dust.rotation.y = Math.sin(time * 0.013) * 0.018;
      dust.position.y = Math.sin(time * 0.11) * 0.11;
    }
  }

  const stats = { drawCalls: 0, triangles: 0, physicalDetails: staticPieces, workers: 3, width: 15.14, height: 12.50, depth: 12.45 };
  group.traverse(object => {
    if (object.isMesh || object.isPoints) stats.drawCalls += Array.isArray(object.material) ? Math.max(1, object.geometry.groups.length) : 1;
    if (object.isMesh) stats.triangles += (object.geometry.index ? object.geometry.index.count : object.geometry.attributes.position.count) / 3;
  });
  group.userData.bounds = { min: [-7.74, -0.475, -10.81], max: [7.74, 12.5, 1.73] };
  group.userData.stats = stats;
  return { group, shell, walls: shell.children, structure, update, setMode, animated, lights, workers, crew, stats };
}
