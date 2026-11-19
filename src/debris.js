import {
  BoxGeometry, BufferGeometry, CylinderGeometry, Float32BufferAttribute,
  Group, Matrix4, Mesh, OctahedronGeometry, Quaternion, Euler, Vector3
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  annex, annexDoorWidth, classroomDoorWidth, furnishingBays, hall, hallClearHalfWidth,
  hallWindows, landing, lights, plaza, rooms, stairs
} from './layout.js';

const DEFAULT_AMOUNT = 0.5;
const TOTAL_BUDGET = 1500;

function createRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function pointBlocked(x, z, obstacles, pad, surfaceY) {
  for (const b of obstacles) {
    // The landing is both a blocker at ground level and a support at 1.26 m.
    if (
      b.active === false ||
      (b.bottom !== undefined && b.bottom > surfaceY + 1e-6) ||
      (b.step && b.top <= surfaceY + 1e-6)
    ) continue;
    if (x >= b.x0 - pad && x <= b.x1 + pad && z >= b.z0 - pad && z <= b.z1 + pad) {
      return true;
    }
  }
  return false;
}

function nearDoorThreshold(x, z, pad) {
  if (Math.abs(z - hall.far) < 1.1 + pad && Math.abs(x) < annexDoorWidth / 2 + .3 + pad) return true;
  if (Math.abs(z - landing.z0) < .85 + pad && Math.abs(x - landing.doorX) < .85 + pad) return true;
  if (Math.abs(x - plaza.hallPortal.x) < 1.25 + pad &&
      Math.abs(z - plaza.hallPortal.z) < plaza.hallPortal.width / 2 + .42 + pad) return true;
  if (Math.abs(x - annex.sideExit.x) < 1.25 + pad &&
      Math.abs(z - annex.sideExit.z) < annex.sideExit.width / 2 + .42 + pad) return true;
  for (const r of rooms) {
    if (r.side !== 0 &&
        Math.abs(x - r.side * hall.halfWidth) < 1.25 + pad &&
        Math.abs(z - r.doorZ) < classroomDoorWidth / 2 + .42 + pad) {
      return true;
    }
    for (const d of (r.extraDoors || [])) {
      const hw = d.width / 2 + .42 + pad;
      if (d.wall === 'north' || d.wall === 'south') {
        if (Math.abs(z - d.z) < 1.25 + pad && Math.abs(x - d.x) < hw) return true;
      } else {
        if (Math.abs(x - d.x) < 1.25 + pad && Math.abs(z - d.z) < hw) return true;
      }
    }
  }
  return false;
}

function pickWeighted(rng, entries) {
  let total = 0;
  for (const e of entries) total += e[1];
  let roll = rng() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

const KIND_WEIGHTS = {
  corridor: [['plasterSlab', 22], ['rubbleChunk', 26], ['crumbCluster', 22], ['paperSheet', 12], ['glassShard', 11], ['woodSliver', 4], ['metalScrap', 3]],
  classroom: [['paperSheet', 30], ['plasterSlab', 20], ['rubbleChunk', 20], ['crumbCluster', 18], ['woodSliver', 7], ['glassShard', 5]],
  drafting: [['paperSheet', 40], ['woodSliver', 20], ['crumbCluster', 17], ['plasterSlab', 13], ['rubbleChunk', 10]],
  abandoned: [['plasterSlab', 28], ['rubbleChunk', 26], ['woodSliver', 18], ['paperSheet', 14], ['crumbCluster', 10], ['glassShard', 4]],
  computerLab: [['plasterSlab', 22], ['metalScrap', 22], ['paperSheet', 18], ['rubbleChunk', 16], ['crumbCluster', 14], ['glassShard', 8]],
  storage: [['woodSliver', 28], ['rubbleChunk', 24], ['crumbCluster', 20], ['plasterSlab', 14], ['paperSheet', 8], ['metalScrap', 6]],
  elecLab: [['metalScrap', 30], ['rubbleChunk', 24], ['plasterSlab', 18], ['crumbCluster', 14], ['glassShard', 10], ['woodSliver', 4]],
  guardhouse: [['paperSheet', 32], ['crumbCluster', 22], ['plasterSlab', 18], ['woodSliver', 14], ['metalScrap', 8], ['glassShard', 6]],
  plaza: [['rubbleChunk', 30], ['plasterSlab', 24], ['crumbCluster', 22], ['glassShard', 12], ['paperSheet', 7], ['woodSliver', 5]],
  annex: [['plasterSlab', 24], ['rubbleChunk', 28], ['crumbCluster', 20], ['glassShard', 14], ['paperSheet', 8], ['metalScrap', 6]],
  landing: [['plasterSlab', 22], ['rubbleChunk', 28], ['crumbCluster', 24], ['paperSheet', 12], ['metalScrap', 8], ['glassShard', 6]]
};
// Maximum horizontal reach including curled sheets and a cluster's satellite fragments.
const pieceRadius = { plasterSlab: .30, rubbleChunk: .20, crumbCluster: .16, glassShard: .19, woodSliver: .24, metalScrap: .21 };

export function sampleDebrisAt(placements, activeCount, x, z, footY = 0, maxRadius = 0.42) {
  if (!Array.isArray(placements) || activeCount <= 0) return null;
  const limit = Math.min(placements.length, Math.max(0, Math.round(activeCount)));
  let bestKind = null;
  let bestDistSq = Infinity;
  for (let i = 0; i < limit; i++) {
    const p = placements[i];
    if (Math.abs((p.y || 0) - footY) > 0.14) continue;
    const dx = x - p.x;
    const dz = z - p.z;
    const reach = (p.kind === 'paperSheet' ? 0.25 : (pieceRadius[p.kind] || 0.20) * (p.scale || 1)) + 0.18;
    const r = Math.max(maxRadius, reach);
    const dSq = dx * dx + dz * dz;
    if (dSq <= r * r && dSq < bestDistSq) {
      bestDistSq = dSq;
      bestKind = p.kind;
    }
  }
  return bestKind;
}

/**
 * Deterministically generates floor debris placements across the entire scenario:
 * corridor, all 7 rooms/labs/guardhouse, exterior plaza, annex ground floor, and mezzanine landing.
 */
export function generateDebrisPlacements(obstacles = [], { seed = 202611, totalBudget = TOTAL_BUDGET } = {}) {
  const rng = createRng(seed);
  const placements = [];
  const plazaBlockers = [...plaza.planters, plaza.pergola, plaza.bikeRack];
  function tryPush(zone, zoneKind, x, y, z, region) {
    const kind = pickWeighted(rng, KIND_WEIGHTS[zoneKind]);
    const scale = 0.72 + rng() * 0.75;
    const pad = kind === 'paperSheet' ? .25 : pieceRadius[kind] * scale;
    if (x < region.x0 + pad || x > region.x1 - pad || z < region.z0 + pad || z > region.z1 - pad) return false;
    if (pointBlocked(x, z, obstacles, pad, y) || nearDoorThreshold(x, z, pad)) return false;
    if (zone === 'corridor' && Math.abs(x) < hallClearHalfWidth + pad) return false;
    if (zone === 'annex' && ((x < stairs.x1 + pad && z < stairs.startZ + pad) ||
        (x < landing.x1 + pad && z < landing.z1 + pad))) return false;
    if (zone === 'plaza') {
      if (Math.hypot(x - plaza.fountain.x, z - plaza.fountain.z) < plaza.fountain.radius + 0.55 + pad) return false;
      if (plazaBlockers.some(b => x >= b.x0 - pad - 0.2 && x <= b.x1 + pad + 0.2 && z >= b.z0 - pad - 0.2 && z <= b.z1 + pad + 0.2)) {
        return false;
      }
    }
    const rotY = rng() * Math.PI * 2;
    const tilt = kind === 'plasterSlab' || kind === 'woodSliver' ? (rng() - 0.5) * 0.14 : (rng() - 0.5) * 0.08;
    placements.push({
      zone,
      kind,
      x,
      y,
      z,
      rotY,
      tiltX: tilt,
      tiltZ: (rng() - 0.5) * 0.08,
      scale,
      variant: rng(),
      bucket: kind === 'glassShard' ? 'glass' : 'opaque'
    });
    return true;
  }

  // 1. Main corridor (approx 32% of budget)
  const corridorTarget = Math.round(totalBudget * 0.32);
  const hallRegion = { x0: -hall.halfWidth, x1: hall.halfWidth, z0: hall.far, z1: hall.near };
  const brokenLampZs = [lights[2].z, lights[4].z, ...hallWindows.map(w => w.z)];
  for (let attempts = 0, added = 0; added < corridorTarget && attempts < corridorTarget * 6; attempts++) {
    const side = rng() < .5 ? -1 : 1;
    const x = side * (hallClearHalfWidth + rng() * (hall.halfWidth - hallClearHalfWidth));
    const z = rng() < .32
      ? brokenLampZs[Math.floor(rng() * brokenLampZs.length)] + (rng() - .5) * 2.8
      : hall.far + rng() * (hall.near - hall.far);
    if (tryPush('corridor', 'corridor', x, 0, z, hallRegion)) added++;
  }

  // 2. All 7 classrooms, labs & guardhouse (approx 36% of budget distributed by room condition)
  const roomWeights = {
    '101': 0.042,
    '102': 0.082,
    '103': 0.048,
    '104': 0.052,
    '105': 0.058,
    '106': 0.052,
    '107': 0.040
  };
  for (const r of rooms) {
    const bays = furnishingBays(r);
    const target = Math.round(totalBudget * (roomWeights[r.id] || 0.05));
    for (let attempts = 0, added = 0; added < target && attempts < target * 10; attempts++) {
      const bay = bays[Math.floor(rng() * bays.length)];
      const x = bay.x0 + rng() * (bay.x1 - bay.x0), z = bay.z0 + rng() * (bay.z1 - bay.z0);
      if (tryPush(`room-${r.id}`, r.kind, x, 0, z, bay)) added++;
    }
  }

  // 3. Exterior Mini Plaza (approx 10% of budget across main courtyard & north passage)
  const plazaTarget = Math.round(totalBudget * 0.10);
  const plazaZones = [plaza.main, plaza.northPassage];
  for (let attempts = 0, added = 0; added < plazaTarget && attempts < plazaTarget * 10; attempts++) {
    const region = rng() < 0.72 ? plazaZones[0] : plazaZones[1];
    const x = region.x0 + 0.22 + rng() * (region.x1 - region.x0 - 0.44);
    const z = region.z0 + 0.22 + rng() * (region.z1 - region.z0 - 0.44);
    if (tryPush('plaza', 'plaza', x, 0, z, region)) added++;
  }

  // 4. Annex ground floor (approx 14% of budget)
  const annexTarget = Math.round(totalBudget * 0.14);
  for (let attempts = 0, added = 0; added < annexTarget && attempts < annexTarget * 8; attempts++) {
    const x = annex.x0 + 0.18 + rng() * (annex.x1 - annex.x0 - 0.36);
    const z = annex.z0 + 0.18 + rng() * (annex.z1 - annex.z0 - 0.36);
    if (tryPush('annex', 'annex', x, 0, z, annex)) added++;
  }

  // 5. Mezzanine landing & stair step corners (remainder of budget)
  const landingTarget = Math.max(0, totalBudget - placements.length - stairs.count * 2);
  for (let attempts = 0, added = 0; added < landingTarget && attempts < landingTarget * 8; attempts++) {
    const x = landing.x0 + rng() * (landing.x1 - landing.x0);
    const z = landing.z0 + rng() * (landing.z1 - landing.z0);
    if (tryPush('landing', 'landing', x, landing.top, z, landing)) added++;
  }
  // Small dust/papers tucked on the inner corner of stair treads
  for (let step = 0; step < stairs.count && placements.length < totalBudget; step++) {
    for (let k = 0; k < 2 && placements.length < totalBudget; k++) {
      const sy = (step + 1) * stairs.rise;
      const z1 = stairs.startZ - step * stairs.run;
      const sx = stairs.x0 + .30 + rng() * .30;
      const sz = z1 - stairs.run / 2;
      placements.push({
        zone: 'stairs',
        kind: rng() < 0.45 ? 'paperSheet' : 'crumbCluster',
        x: sx,
        y: sy,
        z: sz,
        rotY: rng() * Math.PI * 2,
        tiltX: 0,
        tiltZ: 0,
        scale: 0.58 + rng() * 0.28,
        variant: rng(),
        bucket: 'opaque'
      });
    }
  }

  // Shuffle deterministically so scaling density affects all zones evenly.
  const shuffleRng = createRng(seed ^ 0x9e3779b9);
  for (let i = placements.length - 1; i > 0; i--) {
    const j = Math.floor(shuffleRng() * (i + 1));
    const tmp = placements[i];
    placements[i] = placements[j];
    placements[j] = tmp;
  }

  return placements;
}

function finalizePart(geometry, tint, matrix, repeatMeters = 1.6) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.applyMatrix4(matrix);
  g.computeVertexNormals();
  const pos = g.attributes.position;
  const normal = g.attributes.normal;
  let uv = g.attributes.uv;
  if (!uv) {
    uv = new Float32BufferAttribute(new Float32Array(pos.count * 2), 2);
    g.setAttribute('uv', uv);
  }
  const color = new Float32Array(pos.count * 3);
  const r = ((tint >> 16) & 255) / 255;
  const gr = ((tint >> 8) & 255) / 255;
  const b = (tint & 255) / 255;
  for (let i = 0; i < pos.count; i++) {
    const nx = normal.getX(i), ny = normal.getY(i), nz = normal.getZ(i);
    // Faceted PS1 shading: slight highlight on upward planes, darker underside
    const shade = 0.78 + 0.22 * clamp(ny, 0, 1);
    color[i * 3] = r * shade;
    color[i * 3 + 1] = gr * shade;
    color[i * 3 + 2] = b * shade;
    const px = pos.getX(i), pz = pos.getZ(i), py = pos.getY(i);
    if (Math.abs(ny) > 0.6) {
      uv.setXY(i, px / repeatMeters, pz / repeatMeters);
    } else if (Math.abs(nx) > 0.6) {
      uv.setXY(i, pz / repeatMeters, py / repeatMeters);
    } else {
      uv.setXY(i, px / repeatMeters, py / repeatMeters);
    }
  }
  g.setAttribute('color', new Float32BufferAttribute(color, 3));
  return g;
}

const SLAB_COLORS = [0xc2c3b3, 0xa8ac9d, 0x93978a, 0xd0ceb9];
const RUBBLE_COLORS = [0x767c74, 0x626862, 0x8a8d81, 0x545b55];
const PAPER_COLORS = [0xe4e0ca, 0xd4cfb9, 0xcac6b0];
const WOOD_COLORS = [0xa47d54, 0x856340, 0xb89368];
const METAL_COLORS = [0x46504b, 0x5c665f, 0x39423d];
const GLASS_COLORS = [0x9eb8b4, 0xbcd3cb, 0x86a3a2];

function buildPieceGeometry(p) {
  const rng = createRng(Math.floor(p.variant * 0xffffff) ^ Math.imul(Math.round(p.x * 100), 73856093) ^ Math.imul(Math.round(p.z * 100), 19349663));
  const parts = [];
  const mat = new Matrix4();
  const quat = new Quaternion();
  const euler = new Euler(p.tiltX, p.rotY, p.tiltZ, 'YXZ');
  const pos = new Vector3();
  const scl = new Vector3(1, 1, 1);

  function pushPart(geo, lx, ly, lz, tint, extraRotX = 0, extraRotY = 0, extraRotZ = 0) {
    const localQuat = new Quaternion().setFromEuler(new Euler(extraRotX, extraRotY, extraRotZ, 'YXZ'));
    quat.setFromEuler(euler).multiply(localQuat);
    const offset = new Vector3(lx, ly, lz).applyEuler(euler);
    pos.set(p.x + offset.x, p.y + offset.y, p.z + offset.z);
    mat.compose(pos, quat, scl);
    parts.push(finalizePart(geo, tint, mat));
  }

  if (p.kind === 'plasterSlab') {
    const w = (0.16 + rng() * 0.22) * p.scale;
    const d = (0.14 + rng() * 0.20) * p.scale;
    const h = 0.014 + rng() * 0.012;
    const tint = SLAB_COLORS[Math.floor(rng() * SLAB_COLORS.length)];
    const g = new BoxGeometry(w, h, d, 1, 1, 1);
    const pa = g.attributes.position;
    // Slightly shear/chip corners for broken ceiling tile silhouette
    for (let i = 0; i < pa.count; i++) {
      const vx = pa.getX(i), vz = pa.getZ(i);
      if (vx > 0 && vz > 0) pa.setX(i, vx * (0.68 + rng() * 0.30));
      if (vx < 0 && vz < 0) pa.setZ(i, vz * (0.72 + rng() * 0.28));
    }
    pushPart(g, 0, h * 0.5 + 0.002, 0, tint);
    if (rng() < 0.45) {
      const w2 = w * (0.45 + rng() * 0.3);
      const d2 = d * (0.45 + rng() * 0.3);
      pushPart(new BoxGeometry(w2, h * 0.85, d2), w * 0.24, h * 0.9, -d * 0.15, tint, 0.11, 0.5, -0.06);
    }
  } else if (p.kind === 'rubbleChunk') {
    const r = (0.042 + rng() * 0.052) * p.scale;
    const g = new OctahedronGeometry(r, 0);
    const pa = g.attributes.position;
    let minY = Infinity;
    for (let i = 0; i < pa.count; i++) {
      const vx = pa.getX(i) * (0.85 + rng() * 0.45);
      const vy = pa.getY(i) * (0.42 + rng() * 0.32);
      const vz = pa.getZ(i) * (0.85 + rng() * 0.45);
      pa.setXYZ(i, vx, vy, vz);
      if (vy < minY) minY = vy;
    }
    const tint = RUBBLE_COLORS[Math.floor(rng() * RUBBLE_COLORS.length)];
    pushPart(g, 0, -minY, 0, tint);
    if (rng() < 0.55) {
      const r2 = r * (0.45 + rng() * 0.3);
      const g2 = new OctahedronGeometry(r2, 0);
      g2.scale(1.1, 0.55, 0.9);
      pushPart(g2, r * 1.05, r2 * 0.45, (rng() - 0.5) * r, RUBBLE_COLORS[Math.floor(rng() * RUBBLE_COLORS.length)], 0, rng() * 3, 0);
    }
  } else if (p.kind === 'crumbCluster') {
    const count = 2 + Math.floor(rng() * 2);
    for (let k = 0; k < count; k++) {
      const r = (0.016 + rng() * 0.024) * p.scale;
      const g = new BoxGeometry(r * 1.4, r * 0.72, r * 1.15);
      const ox = (k === 0 ? 0 : (rng() - 0.5) * 0.16 * p.scale);
      const oz = (k === 0 ? 0 : (rng() - 0.5) * 0.16 * p.scale);
      const tint = rng() < 0.5 ? RUBBLE_COLORS[Math.floor(rng() * RUBBLE_COLORS.length)] : SLAB_COLORS[Math.floor(rng() * SLAB_COLORS.length)];
      pushPart(g, ox, r * 0.36, oz, tint, 0, rng() * 3, 0);
    }
  } else if (p.kind === 'paperSheet') {
    const w = 0.19 * (0.82 + rng() * 0.26);
    const d = 0.26 * (0.82 + rng() * 0.26);
    const g = new BoxGeometry(w, 0.004, d, 2, 1, 1);
    const pa = g.attributes.position;
    // Slight curl on one edge so it catches light rather than Z-fighting the floor
    for (let i = 0; i < pa.count; i++) {
      if (pa.getX(i) > w * 0.2) {
        pa.setY(i, pa.getY(i) + 0.007 * rng());
      }
    }
    const tint = PAPER_COLORS[Math.floor(rng() * PAPER_COLORS.length)];
    pushPart(g, 0, 0.0045 + rng() * 0.003, 0, tint);
    if (rng() < 0.42) {
      pushPart(new BoxGeometry(w * 0.92, 0.004, d * 0.92), 0.04, 0.009, 0.03, PAPER_COLORS[Math.floor(rng() * PAPER_COLORS.length)], 0, 0.42, 0);
    }
  } else if (p.kind === 'woodSliver') {
    const len = (0.20 + rng() * 0.26) * p.scale;
    const wid = (0.028 + rng() * 0.034) * p.scale;
    const thk = 0.014 + rng() * 0.010;
    const g = new BoxGeometry(len, thk, wid);
    const pa = g.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      if (pa.getX(i) > 0) pa.setZ(i, pa.getZ(i) * 0.45);
    }
    const tint = WOOD_COLORS[Math.floor(rng() * WOOD_COLORS.length)];
    pushPart(g, 0, thk * 0.5 + 0.001, 0, tint);
  } else if (p.kind === 'metalScrap') {
    const len = (0.18 + rng() * 0.22) * p.scale;
    const rad = 0.011 + rng() * 0.007;
    const g = new CylinderGeometry(rad, rad, len, 6);
    const tint = METAL_COLORS[Math.floor(rng() * METAL_COLORS.length)];
    pushPart(g, 0, rad + 0.001, 0, tint, 0, 0, Math.PI / 2);
  } else if (p.kind === 'glassShard') {
    const s = (0.045 + rng() * 0.065) * p.scale;
    const g = new CylinderGeometry(0.002, s, 0.006, 3);
    g.scale(1.3, 1, 0.72);
    const tint = GLASS_COLORS[Math.floor(rng() * GLASS_COLORS.length)];
    pushPart(g, 0, 0.004, 0, tint);
    if (rng() < 0.5) {
      const g2 = new CylinderGeometry(0.002, s * 0.65, 0.005, 3);
      pushPart(g2, s * 0.85, 0.0035, (rng() - 0.5) * s, tint, 0, 1.1, 0);
    }
  }

  return parts.length === 1 ? parts[0] : mergeGeometries(parts);
}

/**
 * Builds batched floor debris across the entire scenario with O(1) density control via drawRange.
 */
export function buildDebris(makeMaterial, art, obstacles = [], initialAmount = DEFAULT_AMOUNT) {
  const placements = generateDebrisPlacements(obstacles);
  const opaqueGeos = [];
  const glassGeos = [];
  const opaqueStops = new Int32Array(placements.length + 1);
  const glassStops = new Int32Array(placements.length + 1);

  let opaqueVerts = 0;
  let glassVerts = 0;

  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    const geo = buildPieceGeometry(p);
    const vertCount = geo.attributes.position.count;
    if (p.bucket === 'glass') {
      glassGeos.push(geo);
      glassVerts += vertCount;
    } else {
      opaqueGeos.push(geo);
      opaqueVerts += vertCount;
    }
    opaqueStops[i + 1] = opaqueVerts;
    glassStops[i + 1] = glassVerts;
  }

  const root = new Group();
  root.name = 'Escombros';

  const opaqueMat = makeMaterial(art.plaster, { repeat: [1.6, 1.6] });
  const glassMat = makeMaterial(art.glass, { emission: 0.16 });

  const opaqueGeo = opaqueGeos.length ? mergeGeometries(opaqueGeos) : new BufferGeometry();
  const glassGeo = glassGeos.length ? mergeGeometries(glassGeos) : new BufferGeometry();
  for (const g of opaqueGeos) g.dispose();
  for (const g of glassGeos) g.dispose();

  if (opaqueGeo.attributes.position) opaqueGeo.computeBoundingSphere();
  if (glassGeo.attributes.position) glassGeo.computeBoundingSphere();

  const opaqueMesh = new Mesh(opaqueGeo, opaqueMat);
  opaqueMesh.frustumCulled = false;
  const glassMesh = new Mesh(glassGeo, glassMat);
  glassMesh.frustumCulled = false;

  root.add(opaqueMesh, glassMesh);

  let amount = clamp(initialAmount, 0, 1);

  function applyAmount() {
    const count = Math.round(placements.length * amount);
    opaqueGeo.setDrawRange(0, opaqueStops[count]);
    glassGeo.setDrawRange(0, glassStops[count]);
    root.visible = count > 0;
  }

  applyAmount();

  return {
    root,
    placements,
    totalPieces: placements.length,
    get amount() { return amount; },
    get activePieces() { return Math.round(placements.length * amount); },
    get activeTriangles() {
      const count = Math.round(placements.length * amount);
      return Math.floor((opaqueStops[count] + glassStops[count]) / 3);
    },
    sampleAt(x, z, footY = 0, maxRadius = 0.42) {
      const count = Math.round(placements.length * amount);
      return sampleDebrisAt(placements, count, x, z, footY, maxRadius);
    },
    setAmount(value) {
      const next = clamp(Number.isFinite(value) ? value : DEFAULT_AMOUNT, 0, 1);
      if (next === amount) return false;
      amount = next;
      applyAmount();
      return true;
    },
    setWireframe(value) {
      opaqueMat.wireframe = Boolean(value);
      glassMat.wireframe = Boolean(value);
    }
  };
}
