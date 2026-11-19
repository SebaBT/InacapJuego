import { Box3, BoxGeometry, BufferGeometry, Float32BufferAttribute, Mesh, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Keep intact architecture batched. On impact, only triangles inside the struck
// pieces change. Original UVs, paint and normals are interpolated at the cut.
const fields = [['position', 3], ['normal', 3], ['uv', 2], ['color', 3]];

function splitFace(poly, axis, sign, limit) {
  const inside = [], outside = [];
  let prev = poly.at(-1), a = sign * (prev[axis] - limit);
  for (const v of poly) {
    const b = sign * (v[axis] - limit);
    if ((a < 0) !== (b < 0)) {
      const t = a / (a - b);
      const edge = prev.map((value, i) => value + t * (v[i] - value));
      inside.push(edge);
      outside.push(edge);
    }
    (b < 0 ? outside : inside).push(v);
    prev = v;
    a = b;
  }
  return { inside, outside };
}

function cutBatch(mesh, ranges, box) {
  const geom = mesh.geometry, pos = geom.attributes.position;
  const planes = [[0, 1, box.min.x], [0, -1, box.max.x], [2, 1, box.min.z],
    [2, -1, box.max.z], [1, 1, box.min.y], [1, -1, box.max.y]];
  const output = Object.fromEntries(fields.map(([key]) => [key, []]));
  const vertex = i => fields.flatMap(([key, size]) => {
    const attr = geom.attributes[key];
    return Array.from(attr.array.subarray(i * size, (i + 1) * size));
  });
  let changed = false;
  for (const range of ranges) {
    if (!range.bounds.intersectsBox(box)) continue;
    for (let i = range.start; i < range.end; i += 3) {
      if (geom.index && geom.index.getX(i + 1) === 0) continue;
      // Most triangles on long strips are wholly outside one cutting plane.
      if (planes.some(([axis, sign, limit]) => [i, i + 1, i + 2].every(j =>
        sign * (pos.array[j * 3 + axis] - limit) < 0))) continue;
      let face = [vertex(i), vertex(i + 1), vertex(i + 2)];
      const remnants = [];
      for (const [axis, sign, limit] of planes) {
        const { inside, outside } = splitFace(face, axis, sign, limit);
        if (outside.length >= 3) remnants.push(outside);
        face = inside;
        if (face.length < 3) break;
      }
      if (face.length < 3) continue;
      if (!geom.index) geom.setIndex(Array.from({ length: pos.count }, (_, j) => j));
      geom.index.array.fill(0, i, i + 3);
      changed = true;
      for (const poly of remnants) {
        for (let j = 1; j < poly.length - 1; j++) {
          for (const v of [poly[0], poly[j], poly[j + 1]]) {
            let offset = 0;
            for (const [key, size] of fields) {
              output[key].push(...v.slice(offset, offset + size));
              offset += size;
            }
          }
        }
      }
    }
  }
  if (changed) geom.index.needsUpdate = true;
  if (!output.position.length) return null;
  const patch = new BufferGeometry();
  for (const [key, size] of fields) patch.setAttribute(key, new Float32BufferAttribute(output[key], size));
  patch.computeBoundingBox();
  return new Mesh(patch, mesh.material);
}

// Expose the concrete core and a few bent ends of rebar along each torn jamb.
// These remnants join the damage meshes, so a second hit can widen the hole.
function fractureEdges(blocks, o, cut, top) {
  const alongZ = o.x1 - o.x0 < o.z1 - o.z0;
  const lo = alongZ ? o.z0 : o.x0, hi = alongZ ? o.z1 : o.x1;
  const a = alongZ ? cut.min.z : cut.min.x, b = alongZ ? cut.max.z : cut.max.x;
  const cross = alongZ ? (o.x0 + o.x1) / 2 : (o.z0 + o.z1) / 2;
  const thick = alongZ ? o.x1 - o.x0 : o.z1 - o.z0;
  if (thick > .48 || hi - lo < .7 || o.sightTop !== undefined || o.bottom !== undefined) return;
  function block(at, y, len, h, depth, tint, tilt = 0) {
    const g = new BoxGeometry(len, h, depth).toNonIndexed();
    const color = new Float32Array(g.attributes.position.count * 3);
    const rgb = [(tint >> 16 & 255)/255, (tint >> 8 & 255)/255, (tint & 255)/255];
    for (let i = 0; i < color.length; i += 3) color.set(rgb, i);
    g.setAttribute('color', new Float32BufferAttribute(color, 3));
    g.rotateZ(tilt);
    if (alongZ) g.rotateY(-Math.PI/2);
    g.translate(alongZ ? cross : at, y, alongZ ? at : cross);
    blocks.push(g);
  }
  const height = Math.min(o.top ?? top, top);
  for (const [at, dir] of [[a, 1], [b, -1]]) {
    if (at <= lo + .01 || at >= hi - .01) continue;
    for (let i = 0; i < 9; i++) {
      const grain = Math.sin(i * 5.2 + at * 1.7);
      block(at + dir * grain * .032, height * (i + .5)/9, .084, height/9 + .03,
        thick + .012, i % 3 ? 0x9a9283 : 0x776e60, grain * .10);
    }
    block(at + dir * .075, height * .63, .20, .017, .018, 0x6a4b39, dir * .24);
  }
  const start = Math.max(lo, a), end = Math.min(hi, b);
  if (end > start && (o.top ?? 3.08) > top) {
    block((start + end)/2, top, end - start, .07, thick, 0x8e8778);
  }
}

export function createDestruction(obstacles, doors, coreMaterial = null) {
  const originals = [], patches = [], added = new Set(), removed = new Map(), tornDoors = new Map();
  const doorParts = new Map();
  for (const door of doors) {
    for (const part of [door.obstacle, ...(door.pivots || []).map(p => p.obstacle)]) {
      if (part) doorParts.set(part, door);
    }
  }
  function register(mesh, ranges) { originals.push({ mesh, ranges }); }
  function disable(o) {
    if (!added.has(o) && !removed.has(o)) removed.set(o, o.active);
    o.active = false;
  }
  function breach(cx, cz, footY = 0, struck = null) {
    if (struck && doorParts.get(struck)?.id === 'porton') return false;
    if (struck?.movable) { disable(struck); return true; }
    const radius = 1.18;
    const x0 = cx - radius, x1 = cx + radius, z0 = cz - radius, z1 = cz + radius;
    const top = footY + 2.72;
    const box = new Box3(new Vector3(x0, .002, z0), new Vector3(x1, top, z1));
    const blocks = [];
    for (const { mesh, ranges } of [...originals, ...patches]) {
      const patch = cutBatch(mesh, ranges, box);
      if (!patch) continue;
      mesh.parent.add(patch);
      patches.push({ mesh: patch, ranges: [{ bounds: patch.geometry.boundingBox,
        start: 0, end: patch.geometry.attributes.position.count }] });
    }
    for (const o of obstacles.slice()) {
      if (o.active === false || o.step || o.movable || (o.bottom ?? 0) >= top ||
          o.x1 <= x0 || o.x0 >= x1 || o.z1 <= z0 || o.z0 >= z1) continue;
      const door = doorParts.get(o);
      if (door) {
        if (door.id === 'porton' || tornDoors.has(door)) continue;
        tornDoors.set(door, { open: door.open, targetOpen: door.targetOpen });
        door.breached = true;
        door.targetOpen = door.open = 1;
        if (door.obstacle) disable(door.obstacle);
        for (const p of door.pivots) {
          p.group.visible = false;
          if (p.obstacle) disable(p.obstacle);
        }
        continue;
      }
      const left = Math.max(o.x0, x0), right = Math.min(o.x1, x1);
      const near = Math.max(o.z0, z0), far = Math.min(o.z1, z1);
      if (coreMaterial) fractureEdges(blocks, o, box, top);
      function keep(ax, bx, az, bz, bottom = o.bottom) {
        if (bx - ax < .002 || bz - az < .002) return;
        const part = { ...o, x0: ax, x1: bx, z0: az, z1: bz, bottom, active: true };
        obstacles.push(part);
        added.add(part);
      }
      keep(o.x0, left, o.z0, o.z1);
      keep(right, o.x1, o.z0, o.z1);
      keep(left, right, o.z0, near);
      keep(left, right, far, o.z1);
      if ((o.top ?? o.sightTop ?? 3.08) > top) keep(left, right, near, far, top);
      disable(o);
    }
    if (blocks.length) {
      const mesh = new Mesh(mergeGeometries(blocks), coreMaterial);
      blocks.forEach(g => g.dispose());
      mesh.geometry.computeBoundingBox();
      originals[0].mesh.parent.add(mesh);
      patches.push({ mesh, ranges: [{ bounds: mesh.geometry.boundingBox, start: 0,
        end: mesh.geometry.attributes.position.count }] });
    }
    return !struck || struck.active === false;
  }
  function reset() {
    for (const { mesh } of originals) {
      // Dispose the GPU index before restoring the original non-indexed batch.
      if (mesh.geometry.index) { mesh.geometry.dispose(); mesh.geometry.setIndex(null); }
    }
    for (const { mesh } of patches.splice(0)) { mesh.removeFromParent(); mesh.geometry.dispose(); }
    for (let i = obstacles.length - 1; i >= 0; i--) {
      if (added.has(obstacles[i])) obstacles.splice(i, 1);
    }
    for (const [o, active] of removed) o.active = active;
    for (const [door, original] of tornDoors) {
      Object.assign(door, original);
      door.breached = false;
      for (const p of door.pivots) p.group.visible = true;
    }
    added.clear();
    removed.clear();
    tornDoors.clear();
  }
  return { register, breach, reset };
}
