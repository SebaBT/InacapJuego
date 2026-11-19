import { BufferGeometry, Float32BufferAttribute, Group, Mesh, SphereGeometry, Vector3 } from 'three';

export function add(parent, name, geometry, material, tint = 0xffffff) {
  const count = geometry.attributes.position.count, colors = new Float32Array(count * 3);
  const rgb = [((tint >> 16) & 255) / 255, ((tint >> 8) & 255) / 255, (tint & 255) / 255];
  for (let i = 0; i < count; i++) colors.set(rgb, i * 3);
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const mesh = new Mesh(geometry, material);
  mesh.name = name; parent.add(mesh);
  return mesh;
}

export function ellipsoid(parent, name, mat, tint, at, radii, widthSegments = 12, heightSegments = 8) {
  const g = new SphereGeometry(1, widthSegments, heightSegments);
  g.scale(...radii); g.translate(...at);
  return add(parent, name, g, mat, tint);
}

export function joint(parent, name, x = 0, y = 0, z = 0) {
  const node = new Group();
  node.name = name; node.position.set(x, y, z); parent.add(node);
  return node;
}

// Closed rings let the same low-poly construction follow a bent fabric sleeve,
// the rolled lip of a glove, or the changing footprint of a cartoon shoe.
export function loft(rings) {
  const positions = [], uv = [], indices = [], sides = rings[0].length;
  for (const [i, ring] of rings.entries()) {
    for (const [j, p] of ring.entries()) {
      positions.push(p.x, p.y, p.z); uv.push(j / sides, i / (rings.length - 1));
      if (i === rings.length - 1) continue;
      const a = i * sides + j, b = i * sides + (j + 1) % sides;
      indices.push(a, b, a + sides, b, b + sides, a + sides);
    }
  }
  for (const i of [0, rings.length - 1]) {
    const center = new Vector3();
    for (const p of rings[i]) center.add(p);
    center.multiplyScalar(1 / sides);
    // A cap has its own rim normals so it cannot flatten a sleeve at a joint.
    const rim = positions.length / 3;
    for (const p of rings[i]) { positions.push(p.x, p.y, p.z); uv.push(.5, .5); }
    const k = positions.length / 3;
    positions.push(center.x, center.y, center.z); uv.push(.5, .5);
    for (let j = 0; j < sides; j++) {
      const a = rim + j, b = rim + (j + 1) % sides;
      if (i === 0) indices.push(k, b, a); else indices.push(k, a, b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(indices); g.computeVertexNormals();
  return g;
}

export function hose(parent, name, mat, tint, stations, sides = 10) {
  const centers = stations.map(([x, y, z]) => new Vector3(x, y, z));
  const rings = centers.map((center, i) => {
    const tangent = centers[Math.min(i + 1, centers.length - 1)].clone().sub(centers[Math.max(0, i - 1)]).normalize();
    const ref = Math.abs(tangent.z) > .98 ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
    const u = ref.cross(tangent).normalize();
    const v = tangent.clone().cross(u);
    return Array.from({ length: sides }, (_, j) => {
      const a = 2 * Math.PI * j / sides;
      return center.clone().addScaledVector(u, Math.cos(a) * stations[i][3])
        .addScaledVector(v, Math.sin(a) * (stations[i][4] ?? stations[i][3]));
    });
  });
  return add(parent, name, loft(rings), mat, tint);
}
