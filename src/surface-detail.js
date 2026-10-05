/**
 * Object-space surface detail for the EVA's explicitly tagged finishes.
 *
 * Stock PBR maps and vertex attributes work on both renderers. The original
 * UVs, silhouette and rigid batches are preserved; there are no screen-space
 * noise passes, extra meshes or shader-string patches here.
 */
const clamp01 = value => Math.max(0, Math.min(1, value));
const smooth = value => value * value * (3 - 2 * value);
const smoothstep = (a, b, value) => smooth(clamp01((value - a) / (b - a)));
const fract = value => value - Math.floor(value);

const FINISHES = Object.freeze({
  paint: { size: 512, seed: 198401, tileSize: .86, bumpScale: .0042, ao: .42 },
  cast: { size: 256, seed: 314159, tileSize: .58, bumpScale: .006, ao: .50 },
  machined: { size: 256, seed: 733137, tileSize: .48, bumpScale: .0016, ao: .46 },
  elastomer: { size: 256, seed: 424219, tileSize: .46, bumpScale: .0032, ao: .52 },
});

function hash(x, y, z, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function periodicNoise(u, v, cells, seed) {
  const x = u * cells, y = v * cells;
  const ix = Math.floor(x), iy = Math.floor(y), sx = smooth(fract(x)), sy = smooth(fract(y));
  const mod = n => ((n % cells) + cells) % cells;
  const a = hash(mod(ix), mod(iy), 0, seed), b = hash(mod(ix + 1), mod(iy), 0, seed);
  const c = hash(mod(ix), mod(iy + 1), 0, seed), d = hash(mod(ix + 1), mod(iy + 1), 0, seed);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

function spatialNoise(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const sx = smooth(fract(x)), sy = smooth(fract(y)), sz = smooth(fract(z));
  const plane = zz => {
    const a = hash(ix, iy, zz, seed), b = hash(ix + 1, iy, zz, seed);
    const c = hash(ix, iy + 1, zz, seed), d = hash(ix + 1, iy + 1, zz, seed);
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };
  return plane(iz) * (1 - sz) + plane(iz + 1) * sz;
}

/** Pure, deterministic, tileable texture data; also used by the Node tests. */
export function createSurfaceTextureData(role, size = FINISHES[role]?.size) {
  const finish = FINISHES[role];
  if (!finish) throw new RangeError(`Unknown surface finish: ${role}`);
  if (!Number.isInteger(size) || size < 16 || size > 1024 || (size & (size - 1))) {
    throw new RangeError('Surface texture size must be a power of two from 16 to 1024.');
  }
  const roughness = new Uint8ClampedArray(size * size * 4);
  const bump = new Uint8ClampedArray(size * size * 4);
  const seed = finish.seed;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size, v = (y + .5) / size;
    const broad = periodicNoise(u, v, 4, seed) - .5;
    const mid = periodicNoise(u, v, 16, seed + 71) - .5;
    const fine = periodicNoise(u, v, 64, seed + 193) - .5;
    const grain = hash(x, y, 0, seed + 419) - .5;
    let r, b;
    if (role === 'paint') {
      // Broad coating variation, fine orange peel, then very low-amplitude
      // grain. They live in roughness/height, leaving the archive's paint hue.
      r = 236 + broad * 17 + mid * 9 + fine * 8 + grain * 1.5;
      b = 128 + mid * 2 + fine * 11 + grain * 1.5;
    } else if (role === 'cast') {
      r = 236 + broad * 17 + mid * 13 + fine * 9;
      b = 128 + mid * 7 + fine * 14 + grain * 2;
    } else if (role === 'machined') {
      // Axial UVs on rods turn these interrupted bands into restrained lathe
      // marks. Filtering integrates the fine grooves at exhibition distance.
      const lines = periodicNoise(.25, v, 128, seed + 601) - .5;
      const broken = .6 + .4 * periodicNoise(u, v, 8, seed + 37);
      r = 223 + broad * 11 + lines * broken * 31 + fine * 3;
      b = 128 + lines * broken * 13 + grain;
    } else {
      r = 247 + broad * 8 + mid * 5 + fine * 4;
      b = 128 + mid * 4 + fine * 8 + grain;
    }
    const i = (y * size + x) * 4;
    roughness[i] = roughness[i + 1] = roughness[i + 2] = r;
    bump[i] = bump[i + 1] = bump[i + 2] = b;
    roughness[i + 3] = bump[i + 3] = 255;
  }
  return { width: size, height: size, roughness, bump };
}

function responseData(kind, size = 64) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const polish = x / (size - 1), retained = y / (size - 1), i = (y * size + x) * 4;
    const value = kind === 'occlusion' ? 1 - retained * .35 : Math.min(1, 1 - polish * .32 + retained * .05);
    // Keep these scalar ramps separate and grayscale: Three r186's WebGPU
    // material reads coat roughness from R while WebGL reads it from G.
    data[i] = data[i + 1] = data[i + 2] = 255 * value;
    data[i + 3] = 255;
  }
  return { width: size, height: size, data };
}

/**
 * Preserve each existing UV chart and recover its metric from triangle
 * tangents. A normalized 3m plate and a normalized 6cm rod no longer show the
 * same size grain. A separate response UV stores geometric wear/retention;
 * it cannot introduce rectangular texture-border wear on arbitrary armor.
 */
export function buildSurfaceAttributes(geometry) {
  const position = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  const normal = geometry.getAttribute('normal');
  if (!position || !uv || !normal || position.count !== uv.count || normal.count !== position.count) return null;
  const count = position.count, index = geometry.index;
  const corners = index ? index.count : count;
  if (corners % 3) return null;
  const vertex = i => index ? index.getX(i) : i;
  const parent = new Int32Array(count), positionGroup = new Int32Array(count);
  const welds = new Map(), locations = new Map(), groups = [];
  const q = (v, scale) => Math.round(v * scale);
  const find = i => { let j = i; while (parent[j] !== j) j = parent[j]; while (parent[i] !== i) { const next = parent[i]; parent[i] = j; i = next; } return j; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  for (let i = 0; i < count; i++) {
    parent[i] = i;
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const pKey = `${q(x, 1e5)},${q(y, 1e5)},${q(z, 1e5)}`;
    let location = locations.get(pKey);
    if (location === undefined) {
      location = groups.length;
      locations.set(pKey, location);
      groups.push({ x, y, z, nx: 0, ny: 0, nz: 0, cx: 0, cy: 0, cz: 0, weight: 0 });
    }
    positionGroup[i] = location;
    // Normal discontinuities keep the six BoxGeometry charts separate even
    // where an unrelated face happens to reuse the same UV corner.
    const key = `${pKey}|${q(uv.getX(i), 1e5)},${q(uv.getY(i), 1e5)}`;
    const candidates = welds.get(key) || [];
    // Extruded curved bevels may store a distinct face normal on either side
    // of a smooth join. Weld those by angle, avoiding per-triangle grain.
    const prior = candidates.find(j => normal.getX(i) * normal.getX(j) + normal.getY(i) * normal.getY(j) + normal.getZ(i) * normal.getZ(j) > .64);
    if (prior === undefined) { candidates.push(i); welds.set(key, candidates); } else union(i, prior);
  }

  const metrics = new Float32Array(corners);
  for (let t = 0; t < corners; t += 3) {
    const a = vertex(t), b = vertex(t + 1), c = vertex(t + 2);
    union(a, b); union(a, c);
    const ax = position.getX(a), ay = position.getY(a), az = position.getZ(a);
    const bx = position.getX(b), by = position.getY(b), bz = position.getZ(b);
    const cx = position.getX(c), cy = position.getY(c), cz = position.getZ(c);
    const ab = [bx - ax, by - ay, bz - az], ac = [cx - ax, cy - ay, cz - az];
    let nx = ab[1] * ac[2] - ab[2] * ac[1], ny = ab[2] * ac[0] - ab[0] * ac[2], nz = ab[0] * ac[1] - ab[1] * ac[0];
    const area2 = Math.hypot(nx, ny, nz);
    if (area2 < 1e-10) continue;
    nx /= area2; ny /= area2; nz /= area2;
    const center = [(ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3];
    // Corner angle weighting avoids making wear depend on cap subdivision.
    const points = [[ax, ay, az], [bx, by, bz], [cx, cy, cz]], ids = [a, b, c];
    for (let j = 0; j < 3; j++) {
      const p = points[j], p1 = points[(j + 1) % 3], p2 = points[(j + 2) % 3];
      const v1 = p1.map((n, k) => n - p[k]), v2 = p2.map((n, k) => n - p[k]);
      const length = Math.hypot(...v1) * Math.hypot(...v2);
      const angle = Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / Math.max(length, 1e-20))));
      const g = groups[positionGroup[ids[j]]];
      g.nx += nx * angle; g.ny += ny * angle; g.nz += nz * angle;
      g.cx += center[0] * angle; g.cy += center[1] * angle; g.cz += center[2] * angle; g.weight += angle;
    }
    const du1 = uv.getX(b) - uv.getX(a), dv1 = uv.getY(b) - uv.getY(a);
    const du2 = uv.getX(c) - uv.getX(a), dv2 = uv.getY(c) - uv.getY(a);
    const det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-10) continue;
    const tangentU = ab.map((v, k) => (v * dv2 - ac[k] * dv1) / det);
    const tangentV = ac.map((v, k) => (v * du1 - ab[k] * du2) / det);
    metrics[t] = area2;
    metrics[t + 1] = Math.hypot(...tangentU);
    metrics[t + 2] = Math.hypot(...tangentV);
  }

  const charts = new Map();
  for (let t = 0; t < corners; t += 3) {
    const root = find(vertex(t));
    let chart = charts.get(root);
    if (!chart) { chart = { u: 0, v: 0, area: 0, offsetU: hash(root, 3, 7, 91), offsetV: hash(root, 5, 9, 91) }; charts.set(root, chart); }
    const area = metrics[t];
    chart.area += area; chart.u += metrics[t + 1] * area; chart.v += metrics[t + 2] * area;
  }
  for (const chart of charts.values()) {
    chart.u = Math.max(.002, Math.min(100, chart.area ? chart.u / chart.area : 1));
    chart.v = Math.max(.002, Math.min(100, chart.area ? chart.v / chart.area : 1));
  }
  let polishedVertices = 0, retainedVertices = 0;
  for (const g of groups) {
    const length = Math.hypot(g.nx, g.ny, g.nz), weight = Math.max(g.weight, 1e-20);
    const nx = g.nx / Math.max(length, 1e-20), ny = g.ny / Math.max(length, 1e-20), nz = g.nz / Math.max(length, 1e-20);
    const curvature = nx * (g.x - g.cx / weight) + ny * (g.y - g.cy / weight) + nz * (g.z - g.cz / weight);
    const bend = smoothstep(.012, .22, 1 - length / weight);
    const exposed = clamp01(.30 + Math.max(ny, 0) * .50 + Math.max(nz, 0) * .20);
    const interrupted = .12 + .88 * smoothstep(.42, .76, spatialNoise(g.x * 3.7, g.y * 3.7, g.z * 3.7, 1947));
    g.polish = bend * smoothstep(.00002, .003, curvature) * exposed * interrupted;
    g.retained = bend * smoothstep(.00002, .004, -curvature) * (.45 + .55 * (1 - Math.max(ny, 0)));
  }
  const uv1 = new Float32Array(count * 2), uv2 = new Float32Array(count * 2), colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const chart = charts.get(find(i)) || { u: 1, v: 1, offsetU: 0, offsetV: 0 };
    uv1[i * 2] = uv.getX(i) * chart.u + chart.offsetU;
    uv1[i * 2 + 1] = uv.getY(i) * chart.v + chart.offsetV;
    const g = groups[positionGroup[i]];
    // Texel-center endpoints keep CanvasTexture and DataTexture sampling the
    // same smooth response ramp, including its exact unoccluded white end.
    uv2[i * 2] = (g.polish * 63 + .5) / 64;
    uv2[i * 2 + 1] = (g.retained * 63 + .5) / 64;
    const retained = g.retained * .032;
    colors[i * 3] = 1 - retained;
    colors[i * 3 + 1] = 1 - retained * 1.05;
    colors[i * 3 + 2] = 1 - retained * 1.12;
    if (g.polish > .04) polishedVertices++;
    if (g.retained > .04) retainedVertices++;
  }
  return { uv1, uv2, colors, charts: charts.size, polishedVertices, retainedVertices };
}

function textureFromBytes(THREE, bytes, width, height, name, options) {
  let canvas, context;
  if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    context = canvas.getContext('2d');
  }
  let texture;
  if (context) {
    const pixels = context.createImageData(width, height); pixels.data.set(bytes); context.putImageData(pixels, 0, 0);
    texture = new THREE.CanvasTexture(canvas);
    // The coordinates and ramp data use bottom-left UV convention. Explicit
    // flipY keeps the data-texture fallback and the canvas path identical.
    texture.flipY = false;
  } else {
    texture = new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat);
    texture.needsUpdate = true;
  }
  texture.name = name;
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = options.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = options.anisotropy;
  texture.channel = options.channel;
  return texture;
}

/** Install once after adding the sculpture. The returned disposer restores it. */
export function applySurfaceDetail(THREE, scene, { maxAnisotropy = 4 } = {}) {
  const anisotropy = Math.max(1, Math.min(8, Math.floor(Number.isFinite(maxAnisotropy) ? maxAnisotropy : 1)));
  const textures = [], finishes = new Map(), materialStates = new Map(), geometryStates = new Map();
  const stats = { meshes: 0, materials: 0, textures: 0, charts: 0, polishedVertices: 0, retainedVertices: 0, addedDrawCalls: 0, textureBytes: 0, attributeBytes: 0 };
  const mipBytes = (width,height) => { let bytes = 0; for (;;) { bytes += width*height*4; if (width===1 && height===1) return bytes; width=Math.max(1,width>>1); height=Math.max(1,height>>1); } };
  const responseMaps = {};
  for (const kind of ['occlusion','polish']) {
    const response = responseData(kind);
    const map = textureFromBytes(THREE, response.data, response.width, response.height, `EVA • geometric ${kind}`, { anisotropy: 1, channel: 2 });
    responseMaps[kind] = map; textures.push(map);
    stats.textureBytes += mipBytes(response.width,response.height);
  }
  const getFinish = role => {
    if (finishes.has(role)) return finishes.get(role);
    const finish = FINISHES[role], data = createSurfaceTextureData(role);
    const maps = {};
    for (const key of ['roughness', 'bump']) {
      const map = textureFromBytes(THREE, data[key], data.width, data.height, `EVA • ${role} ${key}`, { anisotropy, channel: 1, repeat: true });
      map.repeat.set(1 / finish.tileSize, 1 / finish.tileSize);
      maps[`${key}Map`] = map; textures.push(map);
      stats.textureBytes += mipBytes(data.width,data.height);
    }
    finishes.set(role, maps);
    return maps;
  };
  scene.traverse(mesh => {
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const material = mesh.material, role = material.userData?.surfaceRole;
    if (!FINISHES[role] || !material.isMeshStandardMaterial) return;
    const geometry = mesh.geometry;
    if (!geometryStates.has(geometry)) {
      const attributes = buildSurfaceAttributes(geometry);
      if (!attributes) return;
      const saved = { geometry, uv1: geometry.getAttribute('uv1'), uv2: geometry.getAttribute('uv2'), color: geometry.getAttribute('color') };
      geometryStates.set(geometry, saved);
      geometry.setAttribute('uv1', new THREE.BufferAttribute(attributes.uv1, 2));
      geometry.setAttribute('uv2', new THREE.BufferAttribute(attributes.uv2, 2));
      if (saved.color) for (let i = 0; i < saved.color.count; i++) for (let c = 0; c < 3; c++) attributes.colors[i * 3 + c] *= saved.color.array[i * saved.color.itemSize + c];
      geometry.setAttribute('color', new THREE.BufferAttribute(attributes.colors, 3));
      stats.attributeBytes += attributes.uv1.byteLength + attributes.uv2.byteLength + attributes.colors.byteLength;
      stats.charts += attributes.charts;
      stats.polishedVertices += attributes.polishedVertices;
      stats.retainedVertices += attributes.retainedVertices;
    }
    stats.meshes++;
    if (materialStates.has(material)) return;
    const keys = ['roughnessMap', 'bumpMap', 'bumpScale', 'aoMap', 'aoMapIntensity', 'vertexColors'];
    if (material.isMeshPhysicalMaterial) keys.push('clearcoatRoughnessMap');
    materialStates.set(material, Object.fromEntries(keys.map(key => [key, material[key]])));
    Object.assign(material, getFinish(role), { bumpScale: FINISHES[role].bumpScale, aoMap: responseMaps.occlusion, aoMapIntensity: FINISHES[role].ao, vertexColors: true });
    if (material.isMeshPhysicalMaterial && material.clearcoat > 0) material.clearcoatRoughnessMap = responseMaps.polish;
    material.needsUpdate = true;
  });
  stats.materials = materialStates.size;
  stats.textures = textures.length;
  let disposed = false;
  return {
    stats,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [material, saved] of materialStates) { Object.assign(material, saved); material.needsUpdate = true; }
      for (const { geometry, ...saved } of geometryStates.values()) for (const [key, attribute] of Object.entries(saved)) {
        if (attribute) geometry.setAttribute(key, attribute); else geometry.deleteAttribute(key);
      }
      for (const texture of textures) texture.dispose();
    },
  };
}
