/**
 * EVA-01: an articulated, fully volumetric hard-surface bust.
 * Every visible piece is generated locally. No remote models or textures.
 * The reference's hollow temporal arches, two crown vents, swept horn and
 * layered mandibular armor are built as separate, physically thick shells.
 */
export function createEva(THREE) {
  const group = new THREE.Group();
  group.name = 'EVA-01 • restrained biomechanical bust';
  const breathing = new THREE.Group();
  group.add(breathing);
  const torso = new THREE.Group();
  torso.name = 'Pectoral armor and exposed neck';
  breathing.add(torso);
  const headPivot = new THREE.Group();
  headPivot.name = 'Neck articulation';
  headPivot.position.set(0, 5.42, 0);
  breathing.add(headPivot);
  const head = new THREE.Group();
  head.position.set(0, -5.42, .12);
  headPivot.add(head);
  const jawPivot = new THREE.Group();
  jawPivot.name = 'Mandibular articulation';
  jawPivot.position.set(0, 6.02, 1.07);
  head.add(jawPivot);
  const jaw = new THREE.Group();
  jaw.position.set(0, -6.02, -1.07);
  jawPivot.add(jaw);

  const clamp = THREE.MathUtils.clamp;
  const v3 = p => new THREE.Vector3(...p);
  const color = c => new THREE.Color(c);
  const mat = (name, c, r, m, extra = {}) => {
    const {surfaceRole, ...parameters} = extra;
    const Material = parameters.clearcoat ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
    const value = new Material({color: c, roughness: r, metalness: m, ...parameters});
    value.name = name;
    if (surfaceRole) value.userData.surfaceRole = surfaceRole;
    return value;
  };
  // The armor is a dielectric coating over a metal casting. Its broad paint
  // response and restrained protective coat stay distinct from bare rods,
  // blackened castings and seals. Surface detail is installed once by the host.
  const coating = {surfaceRole: 'paint', clearcoat: .14, clearcoatRoughness: .35, ior: 1.46};
  const M = {
    purple: mat('Unit 01 • amethyst ceramic armor', '#695078', .55, .065, coating),
    pale: mat('Worn lavender armor bevels', '#897397', .52, .075, coating),
    plum: mat('Armor shadow coat', '#4c3b59', .58, .065, {...coating, clearcoat: .10}),
    darkPurple: mat('Deep violet undercuts', '#372641', .57, .10, {...coating, clearcoat: .075}),
    jaw: mat('Mandible • desaturated titanium purple', '#574d64', .55, .18, {...coating, clearcoat: .09}),
    black: mat('Flexible graphite understructure', '#171a21', .73, .075, {surfaceRole: 'elastomer'}),
    rubber: mat('Elastomer seals', '#090d12', .83, .015, {surfaceRole: 'elastomer'}),
    charcoal: mat('Pectoral carbon alloy', '#353442', .53, .25, {surfaceRole: 'cast'}),
    gun: mat('Gunmetal mechanics', '#333f49', .45, .84, {surfaceRole: 'cast'}),
    steel: mat('Machined titanium', '#a1afb1', .32, .91, {surfaceRole: 'machined'}),
    bolt: mat('Blackened fasteners', '#54616b', .48, .76, {surfaceRole: 'machined'}),
    green: mat('Fluorescent lime ceramic', '#8dce20', .49, .035, {...coating, clearcoat: .17, emissive: '#527910', emissiveIntensity: .035}),
    greenDark: mat('Lime bevel and channel', '#5c9115', .55, .07, {...coating, clearcoat: .09}),
    orange: mat('Saffron collar armor', '#cf801f', .53, .055, coating),
    orangeDark: mat('Orange shadow bevel', '#9f4614', .58, .07, {...coating, clearcoat: .085}),
    red: mat('Recessed crimson service ports', '#b62035', .38, .48, {surfaceRole: 'machined', emissive: '#430407', emissiveIntensity: .2}),
    redDark: mat('Oxide red panel gaskets', '#6b2030', .68, .075, {surfaceRole: 'elastomer'}),
    eye: mat('Eyes • amber phosphor', '#997100', .22, .03, {emissive: '#ffd51c', emissiveIntensity: 3.0, toneMapped: false}),
    eyeCore: mat('Eyes • bright yellow inner light', '#725100', .18, .01, {emissive: '#ffe93d', emissiveIntensity: 2.3, toneMapped: false}),
    eyeRim: mat('Optical housing • amber', '#cf681b', .32, .49, {emissive: '#bd4110', emissiveIntensity: .18}),
  };

  let originalPieces = 0;
  function add(parent, geometry, material, pos, rot, scale) {
    const mesh = new THREE.Mesh(geometry, material);
    if (pos) mesh.position.set(...pos);
    if (rot) mesh.rotation.set(...rot);
    if (scale) mesh.scale.set(...scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    originalPieces++;
    return mesh;
  }
  function box(parent, size, pos, material, rot) {
    return add(parent, new THREE.BoxGeometry(...size), material, pos, rot);
  }
  function sphere(parent, radius, pos, material, scale, width = 24, height = 14) {
    return add(parent, new THREE.SphereGeometry(radius, width, height), material, pos, null, scale);
  }
  function cylinder(parent, start, end, radiusA, radiusB, material, radial = 16) {
    const a = v3(start), b = v3(end), delta = b.clone().sub(a);
    const mesh = add(parent, new THREE.CylinderGeometry(radiusB, radiusA, delta.length(), radial), material);
    mesh.position.copy(a.add(b).multiplyScalar(.5));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    return mesh;
  }
  function tube(parent, points, radius, material, segments = 32, radial = 7) {
    const curve = new THREE.CatmullRomCurve3(points.map(v3));
    return add(parent, new THREE.TubeGeometry(curve, segments, radius, radial, false), material);
  }
  function torus(parent, radius, thickness, pos, material, rot = [0, 0, 0], arc = Math.PI * 2) {
    return add(parent, new THREE.TorusGeometry(radius, thickness, 7, 32, arc), material, pos, rot);
  }
  // Armor is extruded and beveled. A mild depth warp creates wrapped, convex
  // plates instead of flat profile cutouts. Each plate has a back and sidewall.
  function panel(parent, points, z, depth, material, bevel = .045, warp = null, holes = []) {
    const shape = new THREE.Shape(points.map(p => new THREE.Vector2(p[0], p[1])));
    for (const hole of holes) shape.holes.push(new THREE.Path(hole.map(p => new THREE.Vector2(p[0], p[1]))));
    let geometry = new THREE.ExtrudeGeometry(shape, {
      depth, steps: 1, bevelEnabled: bevel > 0, bevelSegments: 2,
      bevelThickness: bevel, bevelSize: bevel, curveSegments: 6,
    });
    if(warp) {
      // Extruded caps normally contain only a few large triangles. Subdivide
      // those before bending, and transform their normals analytically with
      // the height field. This preserves a continuous painted surface instead
      // of revealing the polygon triangulation as a patchwork of reflections.
      const source=geometry.index?geometry.toNonIndexed():geometry;
      const a=source.attributes.position,n=source.attributes.normal,u=source.attributes.uv;
      const positions=[],normals=[],uvs=[];
      const vertex=i=>({p:[a.getX(i),a.getY(i),a.getZ(i)],n:[n.getX(i),n.getY(i),n.getZ(i)],u:[u.getX(i),u.getY(i)]});
      const mid=(a,b)=>({p:a.p.map((v,k)=>(v+b.p[k])*.5),n:a.n.map((v,k)=>(v+b.n[k])*.5),u:a.u.map((v,k)=>(v+b.u[k])*.5)});
      const distance=(a,b)=>a.p.reduce((v,x,k)=>v+(x-b.p[k])**2,0);
      function emit(a,b,c,level=0) {
        const lengths=[distance(a,b),distance(b,c),distance(c,a)],longest=Math.max(...lengths);
        if(longest>.17&&level<6) {
          const edge=lengths.indexOf(longest);
          if(edge===0){const m=mid(a,b);emit(a,m,c,level+1);emit(m,b,c,level+1);}
          else if(edge===1){const m=mid(b,c);emit(a,b,m,level+1);emit(a,m,c,level+1);}
          else{const m=mid(c,a);emit(a,b,m,level+1);emit(m,b,c,level+1);}
          return;
        }
        for(const v of [a,b,c]){
          const [x,y,pz]=v.p,e=.002;
          const fx=(warp(x+e,y)-warp(x-e,y))/(2*e),fy=(warp(x,y+e)-warp(x,y-e))/(2*e);
          const normal=new THREE.Vector3(v.n[0]-fx*v.n[2],v.n[1]-fy*v.n[2],v.n[2]).normalize();
          positions.push(x,y,pz+z-depth+warp(x,y));normals.push(normal.x,normal.y,normal.z);uvs.push(...v.u);
        }
      }
      for(let i=0;i<a.count;i+=3)emit(vertex(i),vertex(i+1),vertex(i+2));
      geometry.dispose();if(source!==geometry)source.dispose();
      geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    } else {
      geometry.translate(0,0,z-depth);
      geometry.computeVertexNormals();
    }
    return add(parent, geometry, material);
  }
  const mirror = (points, s) => points.map(([x, y]) => [x * s, y]);
  function roundContour(points,amount=.14) {
    const out=[];
    points.forEach((p,i)=>{
      const prev=points[(i+points.length-1)%points.length],next=points[(i+1)%points.length];
      const a=p.map((v,k)=>v+(prev[k]-v)*amount),b=p.map((v,k)=>v+(next[k]-v)*amount);
      for(let j=0;j<=4;j++){const t=j/4;out.push(p.map((v,k)=>(1-t)**2*a[k]+2*(1-t)*t*v+t*t*b[k]));}
    });
    return out;
  }
  function pairedPanel(parent, points, z, depth, material, bevel, warp) {
    return [-1, 1].map(s => panel(parent, mirror(points, s), z, depth, material, bevel, warp));
  }
  // Cubic interpolation of cross sections makes the helmet a continuous
  // double-curved shell, with independently controlled longitudinal profile.
  function rowAt(rows, y) {
    let i = 0;
    while(i < rows.length - 2 && rows[i + 1][0] < y) i++;
    const a = rows[i], b = rows[i + 1], p = rows[Math.max(0, i - 1)], q = rows[Math.min(rows.length - 1, i + 2)];
    const h = b[0] - a[0], t = clamp((y - a[0]) / h, 0, 1);
    const t2 = t*t, t3 = t2*t;
    const out = [y];
    for(let k = 1; k < a.length; k++) {
      const ma = (b[k] - p[k]) / (b[0] - p[0]);
      const mb = (q[k] - a[k]) / (q[0] - a[0]);
      out[k] = (2*t3 - 3*t2 + 1)*a[k] + (t3 - 2*t2 + t)*h*ma + (-2*t3 + 3*t2)*b[k] + (t3 - t2)*h*mb;
    }
    out[1] = Math.max(.015, out[1]);
    return out;
  }
  function denseRows(rows, from = rows[0][0], to = rows[rows.length-1][0], density = 22) {
    const steps = Math.max(2, Math.ceil((to - from) * density));
    return Array.from({length: steps + 1}, (_, i) => rowAt(rows, from + (to - from) * i / steps));
  }
  // A ruled surface swept between two 3D curves. Its back and side walls are
  // closed, allowing eyes and cheek guards to wrap around the head in depth.
  function ribbon(parent, inner, outer, depth, material, mirrorX = 1, steps = 24, columns = 5) {
    const a = new THREE.CatmullRomCurve3(inner.map(v3)), b = new THREE.CatmullRomCurve3(outer.map(v3));
    const pos = [], uv = [], indices = [], stride = columns + 1;
    for(let back=0;back<2;back++)for(let i=0;i<=steps;i++) {
      const v=i/steps, p=a.getPoint(v), q=b.getPoint(v);
      for(let j=0;j<=columns;j++) {
        const u=j/columns, r=p.clone().lerp(q,u);
        pos.push(r.x, r.y, r.z - back*depth + .012*Math.sin(u*Math.PI));
        uv.push(u,v);
      }
    }
    const count=(steps+1)*stride;
    const quad=(a,b,c,d,flip=false)=>{if(flip)indices.push(a,c,b,a,d,c);else indices.push(a,b,c,a,c,d);};
    for(let i=0;i<steps;i++)for(let j=0;j<columns;j++) {
      const a=i*stride+j,b=a+1,c=b+stride,d=a+stride;
      quad(a,b,c,d);quad(a+count,b+count,c+count,d+count,true);
    }
    for(let i=0;i<steps;i++) {
      const a=i*stride,b=a+columns;
      quad(a,a+stride,a+stride+count,a+count);
      quad(b,b+count,b+stride+count,b+stride);
    }
    for(let j=0;j<columns;j++) {
      quad(j,j+count,j+count+1,j+1);
      const a=steps*stride+j;quad(a,a+1,a+count+1,a+count);
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();
    const mesh=add(parent,g,material);mesh.scale.x=mirrorX;return mesh;
  }
  // Closed loft: rows specify [y, half-width, center-front-z, edge-z].
  // Broad curved faces join a rear shell; changing row widths sculpts the nose.
  function loft(parent, rows, thickness, material, segments = 12) {
    const pos = [], uv = [], indices = [];
    const stride = segments + 1, count = rows.length * stride;
    for (let back = 0; back < 2; back++) {
      rows.forEach(([y, w, front, edge], ri) => {
        for (let j = 0; j <= segments; j++) {
          const u = 2 * j / segments - 1;
          const z = front - (front - edge) * u * u - back * thickness;
          pos.push(w * u, y, z);
          uv.push(j / segments, ri / Math.max(1, rows.length - 1));
        }
      });
    }
    function quad(a, b, c, d, reverse = false) {
      if (reverse) indices.push(a, c, b, a, d, c);
      else indices.push(a, b, c, a, c, d);
    }
    for (let r = 0; r < rows.length - 1; r++) {
      for (let j = 0; j < segments; j++) {
        const a = r * stride + j, b = a + 1, c = b + stride, d = a + stride;
        quad(a, b, c, d);
        quad(a + count, b + count, c + count, d + count, true);
      }
      const l = r * stride, h = r * stride + segments;
      quad(l, l + stride, l + stride + count, l + count);
      quad(h, h + count, h + stride + count, h + stride);
    }
    for (let j = 0; j < segments; j++) {
      quad(j, j + count, j + count + 1, j + 1);
      const a = (rows.length - 1) * stride + j;
      quad(a, a + 1, a + count + 1, a + count);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return add(parent, geometry, material);
  }
  // Elliptical, polygon-section volume, useful for the internal thorax/skull.
  function volume(parent, rows, material, sections = 24) {
    const pos = [], uv = [], idx = [];
    rows.forEach(([y, w, f, b], ri) => {
      const mid = (f + b) / 2, depth = (f - b) / 2;
      for (let j = 0; j < sections; j++) {
        const t = j / sections * Math.PI * 2;
        pos.push(Math.sin(t) * w, y, mid + Math.cos(t) * depth);
        uv.push(j / sections, ri / (rows.length - 1));
      }
    });
    for (let r = 0; r < rows.length - 1; r++) for (let j = 0; j < sections; j++) {
      const a = r * sections + j, b = r * sections + (j + 1) % sections;
      idx.push(a, b, a + sections, b, b + sections, a + sections);
    }
    const bottom = pos.length / 3;
    pos.push(0, rows[0][0], (rows[0][2] + rows[0][3]) / 2);
    uv.push(.5, .5);
    const top = pos.length / 3;
    const last = rows[rows.length - 1];
    pos.push(0, last[0], (last[2] + last[3]) / 2);
    uv.push(.5, .5);
    for (let j = 0; j < sections; j++) {
      const n = (j + 1) % sections;
      idx.push(bottom, n, j);
      idx.push(top, (rows.length - 1) * sections + j, (rows.length - 1) * sections + n);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(idx);
    geometry.computeVertexNormals();
    return add(parent, geometry, material);
  }
  function fastener(parent, p, radius = .052, facing = 'z', material = M.bolt) {
    const end = [...p];
    end[facing === 'x' ? 0 : facing === 'y' ? 1 : 2] += .042;
    cylinder(parent, p, end, radius, radius, material, 6);
  }
  function ribbedHose(parent, points, radius = .085, ribs = 17) {
    const curve = new THREE.CatmullRomCurve3(points.map(v3));
    add(parent, new THREE.TubeGeometry(curve, 35, radius, 8, false), M.rubber);
    for (let i = 0; i <= ribs; i++) {
      const t = i / ribs, p = curve.getPoint(t), tangent = curve.getTangent(t);
      const ring = add(parent, new THREE.TorusGeometry(radius * 1.035, radius * .2, 5, 10), M.gun);
      ring.position.copy(p);
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
    }
  }

  // ── Truncated thorax: strongly divided, sculpted pectoral plates ──
  volume(torso, [
    [.26, 2.42, .78, -1.13], [.55, 2.86, 1.1, -1.43], [1.40, 3.13, 1.21, -1.64],
    [2.62, 3.20, 1.11, -1.73], [3.63, 2.91, .91, -1.43], [4.30, 2.30, .61, -1.12],
    [4.62, 1.32, .52, -.90],
  ], M.black, 32);
  const chestWarp = (x, y) => -.073 * Math.abs(x) ** 2 + .145 * Math.sin(y * .77);
  pairedPanel(torso, roundContour([[.27,.54],[2.55,.37],[3.13,.70],[3.32,1.79],[3.11,3.37],[2.86,3.88],[1.17,4.05],[.42,3.35]],.16),
    1.44, .58, M.purple, .095, chestWarp);
  pairedPanel(torso, roundContour([[.32,.68],[2.50,.58],[2.90,1.35],[2.80,3.34],[2.57,3.60],[.79,3.40],[.34,2.44]],.16),
    1.62, .35, M.rubber, .04, chestWarp);
  pairedPanel(torso, roundContour([[.40,.79],[2.40,.72],[2.75,1.39],[2.66,3.22],[2.47,3.39],[.85,3.22],[.44,2.36]],.17),
    1.68, .24, M.charcoal, .048, chestWarp);
  // Broad beveled upper rims have a crisp paint catch along the top edge.
  pairedPanel(torso, [[.45,3.49],[.76,3.86],[2.80,4.05],[3.04,3.72],[2.93,3.56],[.86,3.60]],
    1.33, .30, M.plum, .07, chestWarp);
  pairedPanel(torso, [[.67,3.61],[.80,3.78],[2.81,3.96],[2.92,3.80],[2.77,3.71],[.91,3.66]],
    1.44, .17, M.purple, .035, chestWarp);
  pairedPanel(torso, [[.77,3.74],[.82,3.81],[2.78,3.98],[2.83,3.91]],
    1.48, .045, M.purple, .012, chestWarp);
  // Lime lower plates step around the truncated rib cage, as in the model.
  pairedPanel(torso, [[1.67,.38],[2.79,.48],[2.89,.88],[2.62,.91],[2.62,1.26],[2.32,1.26],[1.75,1.50],[1.57,1.22]],
    1.73, .27, M.greenDark, .065, chestWarp);
  pairedPanel(torso, [[1.71,.40],[2.75,.51],[2.83,.82],[2.54,.88],[2.54,1.23],[2.31,1.20],[1.78,1.42],[1.66,1.18]],
    1.82, .19, M.green, .055, chestWarp);
  panel(torso, [[-.21,.74],[.20,.74],[.33,1.25],[.21,1.49],[-.21,1.49],[-.33,1.25]],
    1.75, .28, M.green, .06);
  panel(torso, [[-.12,1.6],[.12,1.6],[.20,3.36],[0,3.7],[-.2,3.36]], 1.17, .23, M.darkPurple, .04);
  for (const s of [-1, 1]) {
    for (const [y, x, r] of [[1.08, .89, .28], [2.42, 1.42, .35]]) {
      const z = 1.78 + chestWarp(x, y);
      cylinder(torso, [s*x, y, z-.12], [s*x, y, z+.005], r+.115, r+.115, M.rubber, 32);
      torus(torso, r+.048, .045, [s*x, y, z+.025], M.gun);
      cylinder(torso, [s*x, y, z], [s*x, y, z+.052], r, r*.97, M.red, 32);
      torus(torso, r*.72, .028, [s*x, y, z+.060], M.redDark);
      cylinder(torso, [s*x, y, z+.05], [s*x, y, z+.071], r*.49, r*.49, M.red, 24);
      fastener(torso, [s*x, y+r+.08, z+.035], .035);
      fastener(torso, [s*x, y-r-.08, z+.035], .035);
    }
    // Long radial division below the outer pectoral trim.
    tube(torso, [[s*2.76,1.55,1.15],[s*2.87,2.20,1.03],[s*2.71,3.23,1.15]], .023, M.darkPurple, 14, 5);
    for (const [x,y] of [[.62,3.0],[2.52,3.20],[2.86,1.38],[2.61,.69]])
      fastener(torso, [s*x,y,1.72+chestWarp(x,y)], .046);
    // Thick armor over the cut upper arms and rounded back of the thorax.
    sphere(torso, 1, [s*2.72,2.65,-.47], M.plum, [.59,1.22,.94], 20, 12);
    panel(torso, mirror([[2.45,1.55],[3.10,1.72],[3.28,3.3],[2.97,3.75],[2.50,3.42]],s),
      .13,.44,M.purple,.08,(x,y)=>-.11*Math.abs(x));
    for (let j=0;j<4;j++) {
      const y=2.0+j*.25;
      box(torso,[.31,.062,.36],[s*3.04,y,-.46],M.rubber,[0,0,s*-.08]);
    }
  }

  // ── Neck, exposed hydraulics, collar and dorsal vertebrae ──
  cylinder(torso,[0,3.87,-.21],[0,5.70,-.20],.72,.57,M.rubber,24);
  for (let j=0;j<6;j++) {
    cylinder(torso,[0,4.32+j*.18,-.2],[0,4.39+j*.18,-.2],.69-j*.016,.69-j*.016,j%2?M.gun:M.black,24);
    box(torso,[.59,.125,.20],[0,4.18+j*.20,-.93],M.steel);
    box(torso,[.16,.055,.07],[0,4.2+j*.20,-1.055],M.gun);
  }
  for (const s of [-1,1]) {
    ribbedHose(torso,[[s*2.38,3.78,-.81],[s*1.92,4.34,-1.01],[s*1.26,4.77,-.73],[s*.66,5.36,-.37]],.09,20);
    cylinder(torso,[s*.63,4.14,.32],[s*.89,5.57,.15],.12,.12,M.gun,14);
    cylinder(torso,[s*.70,4.52,.27],[s*.94,5.64,.13],.061,.061,M.steel,12);
    torus(torso,.16,.047,[s*.91,5.33,.18],M.gun,[Math.PI/2,0,0]);
    ribbedHose(torso,[[s*1.37,3.98,.09],[s*1.12,4.60,.39],[s*.73,4.97,.45]],.055,12);
    cylinder(torso,[s*.58,5.12,-.28],[s*1.25,5.60,-.35],.16,.19,M.black,16);
  }
  const collarWarp = (x, y) => -.14*Math.abs(x) + .12*(5-y);
  pairedPanel(torso, [[.46,3.94],[.83,5.13],[1.27,5.27],[2.45,4.92],[2.92,4.38],[2.94,4.12],[1.51,4.22],[.89,3.79]],
    .74,.48,M.rubber,.065,collarWarp);
  pairedPanel(torso, [[.57,4.03],[.90,5.06],[1.25,5.15],[1.91,4.99],[1.54,4.13],[.91,3.91]],
    .88,.30,M.orange,.055,collarWarp);
  pairedPanel(torso, [[1.66,4.13],[2.02,4.96],[2.41,4.80],[2.80,4.37],[2.82,4.20],[2.24,4.20]],
    .86,.30,M.orange,.052,collarWarp);
  pairedPanel(torso, [[1.05,5.11],[1.23,5.2],[2.39,4.87],[2.53,4.72],[2.38,4.74],[1.26,5.02]],
    .85,.16,M.orangeDark,.024,collarWarp);

  // ── Cranial sculpture: a tall teardrop mask and a deep swept-back skull ──
  // The dimensions deliberately distinguish the narrow face from the broad
  // temporal fins. The previous global width stretch erased that hierarchy.
  const skullProfile = [
    [5.65,.66,1.12,-.74],[6.10,1.02,1.46,-1.19],[6.70,1.29,1.52,-1.65],
    [7.32,1.35,1.19,-1.98],[7.95,1.27,.82,-2.15],[8.47,1.07,.31,-2.03],
    [8.87,.70,-.14,-1.73],[9.13,.27,-.69,-1.37],
  ];
  volume(head,denseRows(skullProfile),M.darkPurple,40);
  const occipitalProfile = [
    [6.05,.81,-.62,-1.43],[6.60,1.13,-.58,-1.99],[7.32,1.22,-.70,-2.18],
    [7.96,1.13,-.97,-2.10],[8.51,.84,-1.13,-1.88],[8.94,.29,-1.32,-1.56],
  ];
  volume(head,denseRows(occipitalProfile),M.plum,36);
  // A low mechanical occipital ridge sits between the two raised arches.
  tube(head,[[0,5.72,-.83],[0,6.31,-1.52],[0,7.13,-2.00],[0,7.87,-1.99],[0,8.48,-1.75]],.12,M.gun,36,10);
  for(let j=0;j<6;j++) {
    const y=6.14+j*.30,z=-1.55-Math.sin(j*.35)*.43;
    box(head,[.40,.075,.075],[0,y,z-.05],M.bolt,[-.16,0,0]);
  }

  // The temporal armor is a real open arch, with flowing contours instead of
  // the squared handles of the earlier block-out. The hole remains open at
  // oblique angles, and the surface flares progressively toward the cheeks.
  for(const s of [-1,1]) {
    const shape=new THREE.Shape();
    shape.moveTo(1.76,6.01);
    shape.bezierCurveTo(2.14,6.76,1.92,7.91,1.21,8.77);
    shape.bezierCurveTo(.92,9.11,.40,9.07,.21,8.84);
    shape.bezierCurveTo(.05,8.64,.28,8.40,.28,8.10);
    shape.bezierCurveTo(.19,7.61,-.31,7.22,-.96,6.92);
    shape.lineTo(-1.11,6.46);shape.lineTo(-.54,5.96);shape.closePath();
    const hole=new THREE.Path();
    hole.moveTo(1.21,6.97);
    hole.bezierCurveTo(1.46,7.55,1.21,8.19,.95,8.56);
    hole.bezierCurveTo(.76,8.79,.52,8.70,.49,8.52);
    hole.bezierCurveTo(.50,8.26,.49,7.90,.17,7.57);
    hole.bezierCurveTo(-.10,7.28,.16,7.10,.55,7.00);
    hole.closePath();shape.holes.push(hole);
    const g=new THREE.ExtrudeGeometry(shape,{depth:.24,steps:1,bevelEnabled:true,bevelSize:.055,bevelThickness:.065,bevelSegments:4,curveSegments:20});
    g.translate(0,0,-.12);g.rotateY(Math.PI/2);
    const p=g.attributes.position;
    for(let i=0;i<p.count;i++)p.setX(i,p.getX(i)+1.06+(8.8-p.getY(i))*.21);
    g.computeVertexNormals();const mesh=add(head,g,M.purple);mesh.scale.x=s;
    // The lining is recessed inside the opening, not a contrasting outline.
    tube(head,[[s*1.50,7.01,-1.21],[s*1.37,7.62,-1.36],[s*1.16,8.25,-1.12],[s*1.10,8.59,-.82]],.025,M.plum,32,6);
    // Swept rear cheek blade: a thick shell converging to a narrow lower tail.
    const tail=new THREE.Shape();
    tail.moveTo(2.35,5.49);tail.bezierCurveTo(2.03,5.72,1.54,5.95,.66,6.14);
    tail.lineTo(.18,6.60);tail.lineTo(.72,7.02);
    tail.bezierCurveTo(1.44,6.64,1.97,6.03,2.35,5.49);
    const tg=new THREE.ExtrudeGeometry(tail,{depth:.31,steps:1,bevelEnabled:true,bevelSize:.035,bevelThickness:.045,bevelSegments:3,curveSegments:14});
    tg.rotateY(Math.PI/2);tg.translate(1.42,0,0);
    const tm=add(head,tg,M.plum);tm.scale.x=s;
    cylinder(head,[s*1.45,6.18,-.25],[s*1.77,6.18,-.25],.26,.25,M.rubber,24);
    cylinder(head,[s*1.72,6.18,-.25],[s*1.795,6.18,-.25],.18,.18,M.gun,24);
    cylinder(head,[s*1.79,6.18,-.25],[s*1.81,6.18,-.25],.067,.067,M.bolt,6);
  }

  // ── Continuous double curvature from the high crown to the nasal point ──
  const maskProfile = [
    [6.08,.13,2.60,2.46],[6.38,.37,2.75,2.48],[6.74,.60,2.77,2.32],
    [7.10,.80,2.63,2.09],[7.40,1.08,2.31,1.76],[7.82,1.36,1.86,1.26],
    [8.23,1.38,1.32,.76],[8.61,1.15,.69,.18],[8.94,.78,.10,-.30],
    [9.20,.37,-.62,-.80],[9.32,.075,-.99,-1.04],
  ];
  const frontSurface=(x,y)=>{
    const [,w,f,e]=rowAt(maskProfile,y);return f-(f-e)*(x/w)**2;
  };
  // Three closed armor sections leave two true transverse recesses. Their
  // curvature follows the whole crown instead of crossing it as flat bars.
  for(const [a,b]of [[6.08,8.25],[8.35,8.58],[8.68,9.32]])
    loft(head,denseRows(maskProfile,a,b,28),.235,M.purple,32);
  for(const [a,b]of [[8.245,8.356],[8.575,8.686]]) {
    const rows=denseRows(maskProfile,a,b,25).map(r=>[r[0],r[1]-.012,r[2]-.17,r[3]-.17]);
    loft(head,rows,.13,M.rubber,32);
  }
  for(const y of [8.356,8.686]) {
    const row=rowAt(maskProfile,y), points=[];
    for(let i=0;i<=28;i++){const x=(i/14-1)*row[1]*.98;points.push([x,y,frontSurface(x,y)+.008]);}
    tube(head,points,.012,M.plum,32,5);
  }
  for(const s of [-1,1]) {
    const x=s*.61,y=8.305;
    cylinder(head,[x,y-.034,frontSurface(x,y)-.125],[x,y+.044,frontSurface(x,y)-.07],.029,.029,M.plum,8);
    // Sparse engraved seams emphasize the relation between brow and temples.
    tube(head,[[s*1.03,7.48,1.61],[s*1.18,7.68,1.31],[s*1.29,7.96,.95]],.014,M.darkPurple,20,5);
  }

  // ── Eyes: narrow, steep, recessed lenses on the sides of the nasal shield ──
  const eyeInner=[[.70,6.42,2.52],[.86,6.64,2.37],[1.03,6.97,2.10],[1.22,7.28,1.69]];
  const eyeOuter=[[.78,6.40,2.40],[1.02,6.63,2.07],[1.23,6.94,1.70],[1.25,7.29,1.61]];
  for(const s of [-1,1]) {
    const socketA=eyeInner.map(([x,y,z],i)=>[x-.12,y+(i===0?-.095:i===3?.09:0),z-.105]);
    const socketB=eyeOuter.map(([x,y,z],i)=>[x+.18,y+(i===0?-.095:i===3?.09:0),z-.105]);
    ribbon(head,socketA,socketB,.16,M.rubber,s,30,7);
    const sealA=eyeInner.map(([x,y,z],i)=>[x-.044,y+(i===0?-.049:i===3?.04:0),z-.046]);
    const sealB=eyeOuter.map(([x,y,z],i)=>[x+.064,y+(i===0?-.049:i===3?.04:0),z-.046]);
    ribbon(head,sealA,sealB,.085,M.eyeRim,s,30,6);
    ribbon(head,eyeInner,eyeOuter,.052,M.eye,s,30,6);
  }
  // Substantial cheek castings surround the optical recess and sweep back
  // toward the large temporal wings. No bright horizontal lip spans the face.
  const cheekContour=[[1.22,7.45],[1.46,7.39],[1.72,7.12],[1.78,6.69],[1.59,6.26],[.94,5.95],[.38,6.11],[.72,6.28],[1.09,6.40],[1.42,6.73],[1.50,7.14],[1.24,7.32]];
  const cheekDepth=(x,y)=>-.53*Math.abs(x)+.045*(y-6.5);
  pairedPanel(head,cheekContour,2.78,.25,M.purple,.038,cheekDepth);
  pairedPanel(head,[[1.45,7.20],[1.75,7.23],[2.11,6.77],[2.19,6.30],[1.84,6.10],[1.59,6.44]],
    1.31,.49,M.plum,.047,(x,y)=>-.34*(Math.abs(x)-1.45)+.12*(y-6.5));
  pairedPanel(head,[[1.65,7.12],[1.84,7.00],[2.10,6.68],[2.13,6.44],[1.85,6.50]],
    1.34,.18,M.purple,.031,(x,y)=>-.32*(Math.abs(x)-1.45)+.12*(y-6.5));
  for(const s of [-1,1]) {
    tube(head,[[s*1.53,6.73,2.00],[s*1.65,6.68,1.92],[s*1.72,6.58,1.84]],.015,M.redDark,12,5);
    tube(head,[[s*1.08,6.04,2.22],[s*1.29,6.17,2.13],[s*1.39,6.36,2.09]],.016,M.redDark,14,5);
    fastener(head,[s*1.62,6.93,1.96],.025);
  }

  // ── Broad green cheek fins, angled backward rather than pasted on the face ──
  const wingDepth=(x,y)=>-.60*(Math.abs(x)-1.65)+.045*(y-6.0);
  const wingBase=[[1.66,6.49],[2.12,6.51],[2.49,6.29],[2.68,5.99],[2.62,5.77],[2.16,5.44],[2.09,5.95],[1.65,6.10]];
  const wingMain=[[1.78,6.46],[2.15,6.43],[2.46,6.25],[2.61,5.99],[2.57,5.80],[2.23,5.55],[2.18,6.02],[1.76,6.14]];
  pairedPanel(head,wingBase,1.37,.42,M.greenDark,.040,wingDepth);
  pairedPanel(head,wingMain,1.46,.31,M.green,.047,wingDepth);
  // The doubled horizontal channel visible in the reference is a real inset.
  pairedPanel(head,[[1.66,6.33],[2.12,6.28],[2.24,6.15],[2.19,6.02],[1.68,6.13]],
    1.51,.13,M.green,.021,wingDepth);
  pairedPanel(head,[[1.69,6.23],[2.15,6.19],[2.19,6.13],[2.16,6.075],[1.70,6.16]],
    1.529,.020,M.greenDark,.009,wingDepth);
  for(const s of [-1,1]) {
    sphere(head,.30,[s*2.03,5.78,.89],M.red,[1.02,.46,.85],24,12);
    tube(head,[[s*1.84,5.73,1.0],[s*2.02,5.65,.99],[s*2.20,5.75,.86]],.034,M.darkPurple,18,6);
    // Jaw pivot and the cable socket are largely buried by armor.
    cylinder(head,[s*1.00,5.70,.36],[s*1.47,5.70,.36],.39,.37,M.rubber,28);
    cylinder(head,[s*1.39,5.70,.36],[s*1.52,5.70,.36],.265,.255,M.gun,28);
    cylinder(head,[s*1.51,5.70,.36],[s*1.565,5.70,.36],.15,.145,M.plum,20);
    cylinder(head,[s*1.56,5.70,.36],[s*1.587,5.70,.36],.053,.053,M.bolt,6);
    ribbedHose(head,[[s*.90,5.61,-.35],[s*1.05,5.96,-.75],[s*1.26,6.31,-1.18]],.052,12);
  }

  // ── Forward horn: a tapered diamond-section armor blade ──
  // A pronounced forward projection and four planar faces give the horn a
  // rigid manufactured silhouette. The high crown leads the upward profile;
  // the blade converges to a small acute chamfer rather than a round rod cap.
  const hornRows=[
    {p:[0,7.07,2.54],r:.345}, {p:[0,7.28,2.92],r:.270},
    {p:[0,7.46,3.38],r:.223}, {p:[0,7.73,4.09],r:.165},
    {p:[0,8.02,4.84],r:.111}, {p:[0,8.34,5.67],r:.046},
    {p:[0,8.46,5.97],r:.011}, {p:[0,8.465,5.985],r:.004},
  ];
  function hornSection(rows,material,boost=0) {
    const pos=[],uv=[],idx=[],n=4;
    rows.forEach((row,i)=>{
      const p=v3(row.p),prev=v3(rows[Math.max(0,i-1)].p),next=v3(rows[Math.min(rows.length-1,i+1)].p);
      const axis=next.sub(prev).normalize(),side=new THREE.Vector3(1,0,0),up=new THREE.Vector3().crossVectors(axis,side).normalize();
      for(let j=0;j<n;j++){
        const a=j/n*Math.PI*2;
        const v=p.clone().addScaledVector(side,Math.cos(a)*(row.r+boost)*.78).addScaledVector(up,Math.sin(a)*(row.r+boost));
        pos.push(v.x,v.y,v.z);uv.push(j/n,i/(rows.length-1));
      }
    });
    for(let i=0;i<rows.length-1;i++)for(let j=0;j<n;j++){
      const a=i*n+j,b=i*n+(j+1)%n;idx.push(a,b,a+n,b,b+n,a+n);
    }
    for(let j=1;j<n-1;j++){idx.push(0,j+1,j);const k=(rows.length-1)*n;idx.push(k,k+j,k+j+1);}
    const indexed=new THREE.BufferGeometry();indexed.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));indexed.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));indexed.setIndex(idx);
    const g=indexed.toNonIndexed();indexed.dispose();g.computeVertexNormals();
    return add(head,g,material);
  }
  hornSection(hornRows,M.purple);
  function hornAt(z){
    let i=0;while(i<hornRows.length-2&&hornRows[i+1].p[2]<z)i++;
    const a=hornRows[i],b=hornRows[i+1],f=(z-a.p[2])/(b.p[2]-a.p[2]);
    return {p:a.p.map((v,j)=>v+(b.p[j]-v)*f),r:a.r+(b.r-a.r)*f};
  }
  for(const [a,b]of [[2.92,3.12],[3.29,3.41]])hornSection([hornAt(a),hornAt(b)],M.green,.006);

  // ── Short dark mouth and a layered, elongated mandible ──
  panel(jaw,[[-.38,6.17],[-.18,6.13],[0,6.10],[.18,6.13],[.38,6.17],[.26,5.99],[0,5.92],[-.26,5.99]],
    2.60, .16, M.rubber, .023);
  const jawBar=[[-1.29,6.25],[-.94,6.06],[-.41,5.94],[0,5.92],[.41,5.94],[.94,6.06],[1.29,6.25],[1.19,5.99],[.75,5.80],[.28,5.71],[0,5.73],[-.28,5.71],[-.75,5.80],[-1.19,5.99]];
  panel(jaw,jawBar,2.64,.24,M.plum,.029,(x,y)=>-.40*Math.abs(x));
  const chinCore=[
    [4.24,.17,1.95,1.42],[4.62,.27,2.16,1.41],[5.07,.41,2.39,1.40],
    [5.44,.62,2.47,1.37],[5.83,.79,2.31,1.23],
  ];
  loft(jaw,denseRows(chinCore,4.24,5.83,18),.58,M.darkPurple,24);
  const lowerChin=[[4.29,.15,2.008,1.51],[4.64,.235,2.24,1.55],[5.08,.395,2.48,1.69]];
  loft(jaw,denseRows(lowerChin,4.29,5.08,20),.23,M.jaw,20);
  const upperChin=[[5.13,.411,2.48,1.69],[5.43,.59,2.55,1.56],[5.82,.708,2.39,1.43]];
  loft(jaw,denseRows(upperChin,5.13,5.82,20),.25,M.jaw,22);
  // Two side mandibular casts deepen the side silhouette around the pivot.
  pairedPanel(jaw,[[.34,4.63],[.57,4.93],[.91,5.57],[.98,5.91],[.74,5.98],[.54,5.65],[.40,5.18]],
    1.74,.41,M.plum,.04,(x,y)=>-.24*Math.abs(x));
  pairedPanel(jaw,[[.44,4.97],[.64,5.20],[.83,5.72],[.78,5.84],[.61,5.70],[.47,5.36]],
    1.99,.22,M.jaw,.026,(x,y)=>-.34*Math.abs(x));
  for(const s of [-1,1]) {
    tube(jaw,[[s*.13,5.105,2.485],[s*.34,5.16,2.04],[s*.51,5.40,1.80],[s*.64,5.69,1.58]],.014,M.redDark,22,5);
    tube(jaw,[[s*.52,4.98,1.40],[s*.78,5.49,1.20],[s*1.10,5.71,.65]],.069,M.rubber,24,8);
    cylinder(jaw,[s*.81,5.36,1.08],[s*.97,5.77,.68],.045,.045,M.steel,12);
    fastener(jaw,[s*.53,5.58,1.93],.027);
  }
  // A very fine center ridge reads as pressed metal, without a white stripe.
  loft(jaw,[[4.32,.031,2.022,2.014],[4.67,.043,2.267,2.254],[5.03,.053,2.468,2.446]],.016,M.plum,6);

  // Cooling louvers are concentrated on the back where they belong.
  for(const s of[-1,1])for(let j=0;j<6;j++){
    const y=6.89+j*.14,x=s*(.58+j*.066),z=-2.08+j*.018;
    box(head,[.20,.033,.04],[x,y,z],M.rubber,[0,s*.13,s*-.28]);
  }

  // Small physical service stencils use a locally drawn atlas. They are kept
  // subtle and sit flush with the appropriate armor; no external fonts needed.
  if(typeof document!=='undefined') {
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,512,128);
    ctx.fillStyle='#c4b6d6';ctx.font='600 55px monospace';ctx.textAlign='center';ctx.fillText('EVA  01',256,58);
    ctx.font='18px monospace';ctx.fillStyle='#8f869a';ctx.fillText('TEST TYPE · NEURAL INTERFACE',256,96);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const decal=new THREE.MeshStandardMaterial({map:texture,transparent:true,depthWrite:false,roughness:.8,metalness:0,polygonOffset:true,polygonOffsetFactor:-2});
    const label=add(torso,new THREE.PlaneGeometry(.94,.235),decal,[-1.93,2.98,1.76+chestWarp(-1.93,2.98)],[-.07,-.274,.015]);
    label.castShadow=false;
  }

  // A faint local bounce lets the phosphor illuminate its own recessed rims.
  const eyeBounce = new THREE.PointLight('#ffd744', .75, 2.4, 2);
  eyeBounce.position.set(0,6.75,2.54);
  head.add(eyeBounce);

  // Bake each rigid part by material, maintaining articulation while greatly
  // reducing draw calls. Nonindexed concatenation also preserves hard bevels.
  function mergeRigid(parent) {
    const batches=new Map();
    for(const child of [...parent.children]) {
      if(!child.isMesh||Array.isArray(child.material)||child.material.transparent)continue;
      child.updateMatrix();
      let g=child.geometry.index?child.geometry.toNonIndexed():child.geometry.clone();
      g.applyMatrix4(child.matrix);
      // Mirrored rigid parts need their triangle winding reversed after the
      // negative scale is baked (the renderer no longer sees that transform).
      if(child.matrix.determinant()<0)for(const attribute of Object.values(g.attributes)){
        const array=attribute.array,stride=attribute.itemSize;
        for(let triangle=0;triangle<attribute.count;triangle+=3)for(let k=0;k<stride;k++){
          const b=(triangle+1)*stride+k,c=(triangle+2)*stride+k,tmp=array[b];
          array[b]=array[c];array[c]=tmp;
        }
      }
      const list=batches.get(child.material)||[];list.push(g);batches.set(child.material,list);
      parent.remove(child);child.geometry.dispose();
    }
    for(const [material,geometries]of batches){
      const total=geometries.reduce((n,g)=>n+g.attributes.position.count,0);
      const p=new Float32Array(total*3),n=new Float32Array(total*3),u=new Float32Array(total*2);
      let cursor=0;
      for(const g of geometries){
        const count=g.attributes.position.count;
        p.set(g.attributes.position.array,cursor*3);
        if(g.attributes.normal)n.set(g.attributes.normal.array,cursor*3);
        if(g.attributes.uv)u.set(g.attributes.uv.array,cursor*2);
        cursor+=count;g.dispose();
      }
      const g=new THREE.BufferGeometry();
      g.setAttribute('position',new THREE.BufferAttribute(p,3));g.setAttribute('normal',new THREE.BufferAttribute(n,3));g.setAttribute('uv',new THREE.BufferAttribute(u,2));
      g.computeBoundingSphere();
      const mesh=new THREE.Mesh(g,material);mesh.castShadow=true;mesh.receiveShadow=true;mesh.name=material.name;parent.add(mesh);
    }
  }
  mergeRigid(torso);mergeRigid(head);mergeRigid(jaw);
  group.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(group);
  let meshes=0,triangles=0;
  group.traverse(o=>{if(o.isMesh){meshes++;triangles+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3;}});
  const stats={meshes,triangles:Math.round(triangles),originalPieces,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},description:'Volumetric, beveled EVA-01 armor; hollow temporal arches; articulated neck and mandible'};
  let awake=true,awakeLevel=1,activationUntil=-1,elapsed=0;
  function setAwake(value){awake=Boolean(value);}
  function trigger(){awake=true;activationUntil=elapsed+2.8;}
  function update(t=0,dt=1/60,pose={}){
    elapsed=t;
    dt=clamp(Number.isFinite(dt)?dt:1/60,.001,.08);
    const response=1-Math.exp(-dt*5.5);
    const active=typeof pose.activation==='number'?clamp(pose.activation,0,1):(awake?1:0);
    awakeLevel+=(active-awakeLevel)*response;
    const pulse=Math.sin(t*1.7)*.085+Math.sin(t*4.3)*.025;
    const burst=activationUntil>t?Math.sin(clamp((activationUntil-t)/2.8,0,1)*Math.PI):0;
    const x=clamp(Number.isFinite(pose.x)?pose.x:0,-1,1),y=clamp(Number.isFinite(pose.y)?pose.y:0,-1,1);
    const yaw=x*.22+Math.sin(t*.31)*.006*awakeLevel;
    const pitch=-y*.13+.010*Math.sin(t*.83)*awakeLevel-.022*burst;
    const roll=-x*.025;
    headPivot.rotation.y+=(yaw-headPivot.rotation.y)*response;
    headPivot.rotation.x+=(pitch-headPivot.rotation.x)*response;
    headPivot.rotation.z+=(roll-headPivot.rotation.z)*response;
    breathing.scale.y=1+Math.sin(t*.92)*.0025*awakeLevel;
    breathing.position.y=Math.sin(t*.92)*.008*awakeLevel;
    jawPivot.rotation.x=awakeLevel*(.006+.007*Math.sin(t*1.27))+.032*burst;
    M.eye.emissiveIntensity=.12+awakeLevel*(2.7+pulse)+burst*3.0;
    M.eyeCore.emissiveIntensity=.06+awakeLevel*(2.15+pulse*.6)+burst*2.2;
    M.eyeRim.emissiveIntensity=.06+awakeLevel*.22+burst*.3;
    eyeBounce.intensity=.015+awakeLevel*.24+burst*.32;
  }
  return {group,update,setAwake,trigger,stats};
}
