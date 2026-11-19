import {
  BoxGeometry, Float32BufferAttribute, Group, Mesh,
  RingGeometry, Vector3
} from 'three';
import { createCarryingHand, createItemModels } from './item-models.js';
import { worldBounds } from './layout.js';
import { castCameraRay } from './third-person.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;

export const EQUIP_SLOTS = Object.freeze(['fuse', 'masterKey', 'boltCutters', 'energy', 'decoy', 'flash']);

export const ENERGY_SECONDS = 8;
export const FLASH_SECONDS = 3.8;
const tape = n => ({
  id: 'tape' + n, category: 'lore', label: 'Cinta ' + n,
  purpose: 'Reúne las tres para revelar la grabación.',
  halo: 0xe9a5b5
});

export const ITEM_CATALOG = Object.freeze({
  fuse: {
    id: 'fuse', category: 'key', label: 'Fusible industrial', short: 'Fusible',
    purpose: 'Alimenta el motor del portón.', action: 'Instalar fusible',
    result: 'Motor del portón con corriente', location: 'Bodega 105', halo: 0xffc362
  },
  masterKey: {
    id: 'masterKey', category: 'key', label: 'Llave maestra', short: 'Llave',
    purpose: 'Abre la cerradura del portón.', action: 'Girar la llave',
    result: 'Cerradura abierta', location: 'Caseta 107', halo: 0xffcf75
  },
  boltCutters: {
    id: 'boltCutters', category: 'key', label: 'Cortapernos', short: 'Cortapernos',
    purpose: 'Corta la cadena del portón.', action: 'Cortar la cadena',
    result: 'Cadena cortada', location: 'Anexo · descanso de la escalera', halo: 0xffae72
  },
  energy: {
    id: 'energy', category: 'tool', label: 'Bebida energética', short: 'Bebida',
    purpose: 'Corre 8 s sin agotarte.', action: 'Beber', halo: 0x64ebc1
  },
  decoy: {
    id: 'decoy', category: 'tool', label: 'Despertador señuelo', short: 'Señuelo',
    purpose: 'La distrae si no te ve, hasta el frenesí.',
    action: 'Lanzar', halo: 0xffb265
  },
  flash: {
    id: 'flash', category: 'tool', label: 'Flash de mano', short: 'Flash',
    purpose: 'Aturde a La Veladora de cerca durante 4 s.',
    action: 'Disparar', halo: 0xadf2ff
  },
  tape1: tape(1), tape2: tape(2), tape3: tape(3)
});

export const WORLD_ITEM_PLACEMENTS = Object.freeze([
  { id: 'item-fuse', kind: 'fuse', x: 13.72, y: 1.15, z: -20.22, facing: -Math.PI / 2 },
  { id: 'item-key', kind: 'masterKey', x: -25.40, y: 1.43, z: 15.59, facing: Math.PI / 2 },
  { id: 'item-cutters', kind: 'boltCutters', x: -0.25, y: 1.26, z: -39.60 },
  { id: 'item-energy-1', kind: 'energy', x: 5.54, y: 0.78, z: 20.06 },
  { id: 'item-energy-2', kind: 'energy', x: -24.10, y: 0.47, z: -1.80 },
  { id: 'item-decoy-1', kind: 'decoy', x: -5.64, y: 0.78, z: 19.75 },
  { id: 'item-decoy-2', kind: 'decoy', x: 5.84, y: 0.77, z: -6.74 },
  { id: 'item-flash-1', kind: 'flash', x: -5.84, y: 0.91, z: -19.22 },
  { id: 'item-flash-2', kind: 'flash', x: 10.56, y: 0.74, z: 2.84 },
  { id: 'item-tape-1', kind: 'tape1', x: 5.54, y: 0.78, z: 3.94 },
  { id: 'item-tape-2', kind: 'tape2', x: 12.15, y: 0.77, z: -10.71 },
  { id: 'item-tape-3', kind: 'tape3', x: -12.62, y: 0.58, z: -1.80 }
]);

export function createInventory() {
  const slots = EQUIP_SLOTS.map(kind => ({
    kind,
    count: 0,
    usedOnGate: false
  }));
  let selectedIndex = 0;
  const collectedTapes = new Set();
  let adrenalineTimer = 0;
  let sonarTimer = 0;

  function findSlot(kind) {
    return slots.findIndex(s => s.kind === kind);
  }

  function add(kind) {
    const def = ITEM_CATALOG[kind];
    if (!def) return false;
    if (def.category === 'lore') {
      if (collectedTapes.has(kind)) return false;
      collectedTapes.add(kind);
      sonarTimer = Math.max(sonarTimer, 6.0);
      return true;
    }
    const idx = findSlot(kind);
    if (idx < 0) return false;
    const slot = slots[idx];
    if (def.category === 'key') {
      if (slot.count > 0 || slot.usedOnGate) return false;
      slot.count = 1;
    } else {
      slot.count += 1;
    }
    selectedIndex = idx;
    return true;
  }

  function equip(index) {
    if (!Number.isInteger(index) || index < 0 || index >= slots.length || !slots[index].count) return false;
    selectedIndex = index;
    return slots[selectedIndex].count > 0;
  }

  function equipKind(kind) {
    const idx = findSlot(kind);
    if (idx < 0 || slots[idx].count <= 0) return false;
    selectedIndex = idx;
    return true;
  }

  function cycle(dir = 1) {
    const owned = slots
      .map((s, i) => (s.count > 0 ? i : -1))
      .filter(i => i >= 0);
    if (!owned.length) return selectedIndex;
    const pos = owned.indexOf(selectedIndex);
    if (pos < 0) {
      selectedIndex = owned[0];
    } else {
      selectedIndex = owned[(pos + (dir >= 0 ? 1 : -1) + owned.length) % owned.length];
    }
    return selectedIndex;
  }

  function consume(kind) {
    const idx = findSlot(kind);
    if (idx < 0 || slots[idx].count <= 0) return false;
    slots[idx].count -= 1;
    if (ITEM_CATALOG[kind].category === 'key') {
      slots[idx].usedOnGate = true;
    }
    if (slots[selectedIndex].count <= 0) {
      const next = slots.findIndex(s => s.count > 0);
      if (next >= 0) selectedIndex = next;
    }
    return true;
  }

  function update(dt) {
    const safeDt = Math.max(0, dt || 0);
    if (adrenalineTimer > 0) adrenalineTimer = Math.max(0, adrenalineTimer - safeDt);
    if (sonarTimer > 0) sonarTimer = Math.max(0, sonarTimer - safeDt);
  }

  function reset() {
    for (const s of slots) {
      s.count = 0;
      s.usedOnGate = false;
    }
    selectedIndex = 0;
    collectedTapes.clear();
    adrenalineTimer = 0;
    sonarTimer = 0;
  }

  return {
    slots,
    get selectedIndex() { return selectedIndex; },
    get equipped() {
      const s = slots[selectedIndex];
      return s && s.count > 0 ? s.kind : null;
    },
    get tapesCount() { return collectedTapes.size; },
    get collectedTapes() { return collectedTapes; },
    get keysHeldCount() {
      return slots.filter(s => ITEM_CATALOG[s.kind].category === 'key' && s.count > 0).length;
    },
    get keysFoundCount() {
      return slots.filter(s => ITEM_CATALOG[s.kind].category === 'key' && (s.count > 0 || s.usedOnGate)).length;
    },
    get adrenalineActive() { return adrenalineTimer > 0; },
    get adrenalineTimer() { return adrenalineTimer; },
    set adrenalineTimer(v) { adrenalineTimer = Math.max(0, v); },
    get sonarActive() { return sonarTimer > 0; },
    get sonarTimer() { return sonarTimer; },
    has(kind) {
      if (ITEM_CATALOG[kind]?.category === 'lore') return collectedTapes.has(kind);
      const idx = findSlot(kind);
      return idx >= 0 && slots[idx].count > 0;
    },
    add,
    equip,
    equipKind,
    cycle,
    consume,
    update,
    reset
  };
}

export function createWorldItems({ scene, makeMaterial, whiteTex = null, placements = WORLD_ITEM_PLACEMENTS,
  models = createItemModels(makeMaterial, whiteTex), visible = null }) {
  const root = new Group();
  root.name = 'Objetos del mundo';
  scene.add(root);

  const ringMat = makeMaterial(whiteTex, { emission: 0.95, opacity: 0.42 });
  const items = placements.map(p => {
    const def = ITEM_CATALOG[p.kind];
    const holder = new Group();
    holder.position.set(p.x, p.y, p.z);
    const mesh = models(p.kind);
    mesh.scale.setScalar(1.38);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.x = p.facing !== undefined ? 0 : p.kind === 'energy' || p.kind === 'decoy' ? -.12 : -.88;
    holder.add(mesh);

    const haloGeo = new RingGeometry(.112, .120, 32);
    const haloColors = new Float32Array(haloGeo.attributes.position.count * 3);
    const r = ((def.halo >> 16) & 255) / 255;
    const g = ((def.halo >> 8) & 255) / 255;
    const b = (def.halo & 255) / 255;
    for (let i = 0; i < haloGeo.attributes.position.count; i++) {
      haloColors[i * 3] = r;
      haloColors[i * 3 + 1] = g;
      haloColors[i * 3 + 2] = b;
    }
    haloGeo.setAttribute('color', new Float32BufferAttribute(haloColors, 3));
    const halo = new Mesh(haloGeo, ringMat);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.005;
    holder.add(halo);

    root.add(holder);
    return {
      id: p.id,
      kind: p.kind,
      def,
      x: p.x,
      y: p.y,
      z: p.z,
      collected: false,
      group: holder,
      mesh,
      halo,
      facing: p.facing,
      phase: (p.x * 1.7 + p.z * 0.9) % (Math.PI * 2)
    };
  });

  function update(dt, time = 0, reducedMotion = false) {
    for (const item of items) {
      if (item.collected) continue;
      if (reducedMotion) {
        item.mesh.position.y = 0.086;
        item.mesh.rotation.y = item.facing ?? item.phase;
        item.halo.scale.setScalar(1);
      } else {
        item.mesh.position.y = .086 + Math.sin(time * 1.8 + item.phase) * .012;
        item.mesh.rotation.y = item.facing ?? (time * .48 + item.phase);
        const pulse = 0.85 + 0.25 * Math.sin(time * 3.2 + item.phase);
        item.halo.scale.setScalar(pulse);
      }
    }
  }

  function findTarget(pose) {
    if (!pose) return null;
    const cosP = Math.cos(pose.pitch || 0);
    const dirX = -Math.sin(pose.yaw || 0) * cosP;
    const dirY = Math.sin(pose.pitch || 0);
    const dirZ = -Math.cos(pose.yaw || 0) * cosP;
    const camY = pose.cameraY ?? 1.61;
    let best = null;
    let bestScore = Infinity;

    for (const item of items) {
      if (item.collected) continue;
      const dx = item.x - pose.x;
      const dy = item.y + 0.08 - camY;
      const dz = item.z - pose.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 2.55 || dist < 0.08) continue;
      const dot = (dx * dirX + dy * dirY + dz * dirZ) / dist;
      const miss = Math.sqrt(Math.max(0, 1 - dot * dot)) * dist;
      if (dot < 0.54 || miss > 0.72) continue;
      if (visible && !visible(pose, item)) continue;
      const score = dist * 0.55 + miss * 1.35;
      if (score < bestScore) {
        bestScore = score;
        best = { item, dist };
      }
    }
    return best;
  }

  function collect(item) {
    if (!item || item.collected) return false;
    item.collected = true;
    item.group.visible = false;
    return true;
  }

  function reset() {
    for (const item of items) {
      item.collected = false;
      item.group.visible = true;
      item.mesh.position.y = 0.086;
    }
  }

  return { items, update, findTarget, collect, reset };
}

// One model lives on the active character's palm in both camera modes.
export function createHandViewModel({ makeMaterial, whiteTex = null, models = createItemModels(makeMaterial, whiteTex) }) {
  const root = new Group();
  root.name = 'Objeto empuñado';
  const grip = createCarryingHand(makeMaterial, whiteTex);
  root.add(grip.root);
  const meshes = new Map();
  let selected = null, shown = null, gesture = null, raise = 1;

  function setItem(kind) { selected = kind; }
  function triggerUse(kind) {
    gesture = { kind, elapsed: 0, duration: kind === 'energy' ? .76 : .48, inspect: false };
  }
  function inspect(kind) { gesture = { kind, elapsed: 0, duration: 1.7, inspect: true }; }
  function update(dt, reducedMotion = false) {
    const kind = gesture?.kind ?? selected;
    if (kind !== shown) {
      if (shown) meshes.get(shown).visible = false;
      if (kind && !meshes.has(kind)) {
        const model = models(kind);
        root.add(model);
        meshes.set(kind, model);
      }
      if (kind) { meshes.get(kind).visible = true; grip.fit(kind); }
      shown = kind;
      raise = 0;
    }
    raise = Math.min(1, raise + dt * 5);
    const t = gesture ? Math.min(1, gesture.elapsed / gesture.duration) : 0;
    const wave = Math.sin(t * Math.PI);
    const lift = gesture?.inspect ? .07 : kind === 'energy' ? .115 : .035;
    const reach = gesture?.inspect ? .01 : kind === 'energy' ? -.095 : .13;
    const tilt = gesture?.inspect ? -.25 : kind === 'energy' ? 1.05 : -.46;
    const motion = reducedMotion ? .22 : 1;
    const pose = { root, sleeve: grip.sleeve, reachShoulder: grip.reachShoulder, kind, lift: (lift * wave - .09 * (1 - raise)) * motion,
      reach: reach * wave * motion, tilt: tilt * wave * motion };
    if (gesture && (gesture.elapsed += dt) >= gesture.duration) gesture = null;
    return pose;
  }
  function reset() { selected = null; gesture = null; update(0); root.visible = false; }
  return { setItem, triggerUse, inspect, update, reset,
    get currentKind() { return selected; }, get using() { return Boolean(gesture && !gesture.inspect); } };
}

export function createDecoyProjectiles({ scene, obstacles, makeMaterial, whiteTex = null, models = createItemModels(makeMaterial, whiteTex) }) {
  const root = new Group();
  root.name = 'Señuelos activos';
  scene.add(root);

  const active = [];
  const dirVec = new Vector3();

  function spawn(pose, camera) {
    if (!pose) return null;
    if (camera) camera.getWorldDirection(dirVec);
    else {
      const cp = Math.cos(pose.pitch || 0);
      dirVec.set(-Math.sin(pose.yaw || 0) * cp, Math.sin(pose.pitch || 0), -Math.cos(pose.yaw || 0) * cp);
    }
    const mesh = models('decoy');
    const startX = pose.x + dirVec.x * 0.35;
    const startY = Math.max(0.45, (pose.cameraY ?? 1.61) - 0.14 + dirVec.y * 0.25);
    const startZ = pose.z + dirVec.z * 0.35;
    mesh.position.set(startX, startY, startZ);
    root.add(mesh);
    const item = {
      mesh,
      x: startX,
      y: startY,
      z: startZ,
      vx: dirVec.x * 8.5,
      vy: dirVec.y * 5.2 + 2.4,
      vz: dirVec.z * 8.5,
      grounded: false,
      life: 6.5,
      beepTimer: 0,
      justBeeped: false,
      active: true
    };
    active.push(item);
    return item;
  }

  function update(dt) {
    const safeDt = Math.max(0, Math.min(0.08, dt || 0));
    let loudest = null;
    let beepEvent = null;

    for (let i = active.length - 1; i >= 0; i--) {
      const d = active[i];
      d.justBeeped = false;
      d.life -= safeDt;
      if (d.life <= 0) {
        root.remove(d.mesh);
        active.splice(i, 1);
        continue;
      }
      if (!d.grounded) {
        d.vy -= 14.5 * safeDt;
        const nx = d.x + d.vx * safeDt;
        const ny = d.y + d.vy * safeDt;
        const nz = d.z + d.vz * safeDt;
        const hitT = castCameraRay(
          { x: d.x, y: d.y, z: d.z },
          { x: nx, y: ny, z: nz },
          obstacles,
          worldBounds,
          0.06
        );
        if (hitT < 1) {
          d.x = lerp(d.x, nx, hitT);
          d.y = lerp(d.y, ny, hitT);
          d.z = lerp(d.z, nz, hitT);
          if (d.y <= 0.10 || d.vy < -1.0) {
            d.vx *= 0.35;
            d.vz *= 0.35;
            d.vy = Math.abs(d.vy) * 0.3;
            if (d.y <= 0.08 && d.vy < 0.8) {
              d.y = 0.02;
              d.vx = d.vy = d.vz = 0;
              d.grounded = true;
            }
          } else {
            d.vx *= -0.4;
            d.vz *= -0.4;
          }
        } else {
          d.x = nx; d.y = ny; d.z = nz;
        }
        if (d.y <= 0.02) {
          d.y = 0.02;
          d.vx = d.vy = d.vz = 0;
          d.grounded = true;
        }
        d.mesh.position.set(d.x, d.y, d.z);
        d.mesh.rotation.y += safeDt * 6;
      } else {
        d.beepTimer -= safeDt;
        if (d.beepTimer <= 0) {
          d.beepTimer = 0.55;
          d.justBeeped = true;
          beepEvent = { x: d.x, z: d.z };
        }
        d.mesh.rotation.z = Math.sin(d.life * 32) * (d.beepTimer > 0.35 ? 0.12 : 0.02);
      }
      if (!loudest || d.life > loudest.life) {
        loudest = d;
      }
    }

    return {
      loudest: loudest ? { x: loudest.x, z: loudest.z, active: true, noiseRadius: 34 } : null,
      beepEvent
    };
  }

  function silenceAt(x, z, radius = 1.6) {
    for (let i = active.length - 1; i >= 0; i--) {
      const d = active[i];
      if (Math.hypot(d.x - x, d.z - z) <= radius) {
        root.remove(d.mesh);
        active.splice(i, 1);
      }
    }
  }

  function reset() {
    for (const d of active) root.remove(d.mesh);
    active.length = 0;
  }

  return { spawn, update, silenceAt, reset, get items() { return active; } };
}

export function createBreakableDebris({ scene, makeMaterial, whiteTex = null }) {
  const root = new Group();
  root.name = 'Fragmentos de destrucción';
  scene.add(root);
  const mat = makeMaterial(whiteTex, { emission: 0.08 });
  const chunks = [];

  function burst(x, y, z, tint = 0x9aa396, count = 14, dx = 0, dz = 0) {
    for (let i = 0; i < count; i++) {
      const size = 0.08 + (i % 3) * 0.05;
      const g = new BoxGeometry(size * 1.4, size * 0.8, size);
      const m = new Mesh(g, mat);
      const colors = new Float32Array(g.attributes.position.count * 3);
      const r = ((tint >> 16) & 255) / 255;
      const gr = ((tint >> 8) & 255) / 255;
      const b = (tint & 255) / 255;
      for (let j = 0; j < g.attributes.position.count; j++) {
        colors[j * 3] = r; colors[j * 3 + 1] = gr; colors[j * 3 + 2] = b;
      }
      g.setAttribute('color', new Float32BufferAttribute(colors, 3));
      const ang = (i / count) * Math.PI * 2 + (i % 2) * 0.3;
      const spd = 2.2 + (i % 4) * 1.1;
      m.position.set(x + Math.cos(ang) * 0.3, y + 0.3 + (i % 3) * 0.4, z + Math.sin(ang) * 0.3);
      root.add(m);
      chunks.push({
        mesh: m,
        vx: Math.cos(ang) * spd + dx * 2.8,
        vy: 1.8 + (i % 4) * 0.9,
        vz: Math.sin(ang) * spd + dz * 2.8,
        rx: (i % 2 ? 1 : -1) * 5,
        rz: (i % 3 ? 1 : -1) * 4,
        life: 3.5
      });
    }
  }

  function update(dt) {
    const safeDt = Math.max(0, Math.min(0.08, dt || 0));
    for (let i = chunks.length - 1; i >= 0; i--) {
      const c = chunks[i];
      c.life -= safeDt;
      if (c.life <= 0) {
        root.remove(c.mesh);
        c.mesh.geometry.dispose();
        chunks.splice(i, 1);
        continue;
      }
      if (c.mesh.position.y > 0.05 || c.vy > 0) {
        c.vy -= 14.0 * safeDt;
        c.mesh.position.x += c.vx * safeDt;
        c.mesh.position.y = Math.max(0.04, c.mesh.position.y + c.vy * safeDt);
        c.mesh.position.z += c.vz * safeDt;
        c.mesh.rotation.x += c.rx * safeDt;
        c.mesh.rotation.z += c.rz * safeDt;
        if (c.mesh.position.y <= 0.045) {
          c.vy = 0;
          c.vx *= 0.2;
          c.vz *= 0.2;
        }
      }
    }
  }

  function reset() {
    for (const c of chunks) {
      root.remove(c.mesh);
      c.mesh.geometry.dispose();
    }
    chunks.length = 0;
  }

  return { burst, update, reset };
}
