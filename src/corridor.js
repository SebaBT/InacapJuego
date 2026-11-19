import {
  BoxGeometry, CylinderGeometry, Float32BufferAttribute, Group, Mesh,
  PlaneGeometry, Scene, Vector3
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  annex, annexDoorWidth, benchZ, classroomDoorWidth, extraLights, hall, hallWindows,
  lights, lightX, pairedFixtureOffset, plaza, rooms, switchOffset, wallThickness
} from './layout.js';
import { makeTextures, roomPlate } from './textures.js';
import { buildRooms } from './rooms.js';
import { buildDebris } from './debris.js';

const { halfWidth: W, height: H, near, far } = hall;
const WHITE = 0xffffff;
const UP = new Vector3(0, 1, 0);
const _linkDir = new Vector3();

function positionLink(mesh, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  mesh.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  mesh.scale.set(1, Math.max(1e-4, len), 1);
  if (len > 1e-6) {
    _linkDir.set(dx / len, dy / len, dz / len);
    mesh.quaternion.setFromUnitVectors(UP, _linkDir);
  }
}

function group(parent, x, z, angle = 0) {
  const g = new Group();
  g.position.set(x, 0, z);
  g.rotation.y = angle;
  parent.add(g);
  return g;
}

function group3(parent, x, y, z) {
  const g = new Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

function piece(parent, material, geometry, x, y, z, tint = WHITE) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.attributes.position, normal = g.attributes.normal;
  const meters = material.userData.repeatMeters;
  const color = new Float32Array(pos.count * 3);
  const rgb = [((tint >> 16) & 255) / 255, ((tint >> 8) & 255) / 255, (tint & 255) / 255];
  for (let i = 0; i < pos.count; i++) {
    color.set(rgb, i * 3);
    if (!meters) continue;
    const px = pos.getX(i) + x, py = pos.getY(i) + y, pz = pos.getZ(i) + z;
    const nx = normal.getX(i), ny = normal.getY(i), nz = normal.getZ(i);
    let u = px * Math.sign(nz), v = py;
    if (Math.abs(nx) > .7) u = -pz * Math.sign(nx);
    if (Math.abs(ny) > .7) { u = px; v = -pz * Math.sign(ny); }
    g.attributes.uv.setXY(i, u / meters[0], v / meters[1]);
  }
  g.setAttribute('color', new Float32BufferAttribute(color, 3));
  const mesh = new Mesh(g, material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function box(p, m, x, y, z, width, height, depth, tint) {
  return piece(p, m, new BoxGeometry(width, height, depth), x, y, z, tint);
}
function face(p, m, x, y, z, w, h, tint) {
  return piece(p, m, new PlaneGeometry(w, h), x, y, z, tint);
}
function cylinder(p, m, x, y, z, top, bottom, height, tint, sides = 8) {
  const g = new CylinderGeometry(top, bottom, height, sides).toNonIndexed();
  g.computeVertexNormals();
  return piece(p, m, g, x, y, z, tint);
}
function rod(p, m, start, end, radius, tint) {
  const a = new Vector3(...start), b = new Vector3(...end);
  const dir = b.clone().sub(a), mid = a.addScaledVector(dir, .5);
  const mesh = cylinder(p, m, mid.x, mid.y, mid.z, radius, radius, dir.length(), tint, 6);
  mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
}

// Assemble in local architectural coordinates, then batch the stationary meshes.
function bake(root) {
  root.updateMatrixWorld(true);
  const batches = new Map();
  root.traverse(obj => {
    if (!obj.isMesh) return;
    const list = batches.get(obj.material) || [];
    list.push(obj.geometry.applyMatrix4(obj.matrixWorld));
    batches.set(obj.material, list);
  });
  const scene = new Scene();
  for (const [mat, geometries] of batches) {
    const merged = mergeGeometries(geometries);
    merged.computeBoundingSphere();
    scene.add(new Mesh(merged, mat));
    for (const g of geometries) g.dispose();
  }
  return scene;
}

export function buildCorridor(makeMaterial) {
  const art = makeTextures();
  const solid = makeMaterial(art.white);
  const wood = makeMaterial(art.wood, { repeat: [1.09, 2.17] });
  const paint = makeMaterial(art.paint, { repeat: [2.24, 1.12] });
  const plaster = makeMaterial(art.plaster, { repeat: [2.7, 2.7] });
  const floorMat = makeMaterial(art.floor, { floor: true, repeat: [4.16, 4.16] });
  const ceilingMat = makeMaterial(art.ceiling, { repeat: [2.40, 2.40] });
  const luminous = makeMaterial(art.white, { emission: 1 });
  const glass = makeMaterial(art.glass, { emission: .24, shininess: .82 });
  const amber = makeMaterial(art.amberGlass, { emission: .88, shininess: .82 });
  const lanternAmberMat = makeMaterial(art.amberGlass, { emission: .55, shininess: .82, opacity: .62 });
  const doorWood = makeMaterial(art.wood, { repeat: [1.09, 2.17], shininess: .46 });
  const doorPaint = makeMaterial(art.paint, { repeat: [2.24, 1.12], shininess: .40 });
  const doorTrim = makeMaterial(art.white, { shininess: .68 });
  const doorGlass = makeMaterial(art.glass, { emission: .08, shininess: .94, opacity: .40 });
  const windows = art.windows.map(tex => makeMaterial(tex, { emission: .84, window: true }));
  const exitMat = makeMaterial(art.exit, { emission: .88 });
  const boardMat = makeMaterial(art.bulletin);
  const root = new Group();
  const lampTubes = new Group();
  const dynamicRoot = new Group();
  const obstacles = [];
  const doors = [];
  const switches = [];
  const furniture = [];

  function cutoutFrame(parent, mat, cx, yB, yT, width, depth, tint, gx, gy, holeW, holeH) {
    const left = cx - width / 2, right = cx + width / 2;
    const hx0 = gx - holeW / 2, hx1 = gx + holeW / 2;
    const hy0 = gy - holeH / 2, hy1 = gy + holeH / 2;
    box(parent, mat, cx, (yB + hy0) / 2, 0, width, hy0 - yB, depth, tint);
    box(parent, mat, cx, (hy1 + yT) / 2, 0, width, yT - hy1, depth, tint);
    box(parent, mat, (left + hx0) / 2, gy, 0, hx0 - left, holeH, depth, tint);
    box(parent, mat, (hx1 + right) / 2, gy, 0, right - hx1, holeH, depth, tint);
  }

  function visionWindow(parent, gx, gy, holeW, holeH, frameDepth, glassMat, glassTint) {
    const bar = .022, bBar = .012;
    const hx0 = gx - holeW / 2, hx1 = gx + holeW / 2;
    const hy0 = gy - holeH / 2, hy1 = gy + holeH / 2;
    box(parent, doorTrim, hx0 - bar / 2 + .004, gy, 0, bar, holeH + bar * 2 - .008, frameDepth, 0x3b433c);
    box(parent, doorTrim, hx1 + bar / 2 - .004, gy, 0, bar, holeH + bar * 2 - .008, frameDepth, 0x3b433c);
    box(parent, doorTrim, gx, hy0 - bar / 2 + .004, 0, holeW - .008, bar, frameDepth, 0x3b433c);
    box(parent, doorTrim, gx, hy1 + bar / 2 - .004, 0, holeW - .008, bar, frameDepth, 0x3b433c);
    const bz = frameDepth / 2 + .003;
    for (const s of [1, -1]) {
      box(parent, doorTrim, hx0 - bBar / 2 + .003, gy, s * bz, bBar, holeH + bBar * 2 - .006, .009, 0xa5a599);
      box(parent, doorTrim, hx1 + bBar / 2 - .003, gy, s * bz, bBar, holeH + bBar * 2 - .006, .009, 0xa5a599);
      box(parent, doorTrim, gx, hy0 - bBar / 2 + .003, s * bz, holeW - .006, bBar, .009, 0xa5a599);
      box(parent, doorTrim, gx, hy1 + bBar / 2 - .003, s * bz, holeW - .006, bBar, .009, 0xa5a599);
    }
    box(parent, glassMat, gx, gy, 0, holeW - .002, holeH - .002, .014, glassTint);
  }

  function plaque(p, material, x, y, width, height, depth = .032) {
    box(p, solid, x, y, .012, width + .025, height + .025, .025, 0x38443e);
    box(p, solid, x, y, .021 + depth / 2, width, height, depth, 0x879087);
    face(p, material, x, y, .022 + depth, width - .009, height - .009);
  }

  function wallPanel(p, left, right, bottom = 0, top = H, doubleSided = false) {
    if (right - left < .001 || top - bottom < .001) return;
    const width = right - left, cx = (left + right) / 2;
    function layer(low, high, depth, front, mat, color) {
      const y0 = Math.max(bottom, low), y1 = Math.min(top, high);
      if (y1 <= y0) return;
      box(p, mat, cx, (y0 + y1) / 2, front - depth / 2, width, y1 - y0, depth, color);
    }
    function trimLayer(low, high, depth, front, color) {
      layer(low, high, depth, front, solid, color);
      if (doubleSided) {
        const y0 = Math.max(bottom, low), y1 = Math.min(top, high);
        if (y1 > y0) box(p, solid, cx, (y0 + y1) / 2, -wallThickness - front + depth / 2, width, y1 - y0, depth, color);
      }
    }
    layer(0, 1.075, wallThickness, 0, paint);
    layer(1.075, H, wallThickness, 0, plaster);
    trimLayer(0, .092, .028, .025, 0x45514b);
    trimLayer(.092, .112, .026, .022, 0x79867b);
    trimLayer(1.059, 1.077, .013, .012, 0x526b61);
    trimLayer(1.077, 1.098, .014, .012, 0xaab5a2);
    trimLayer(H - .047, H, .025, .023, 0x939c8d);
  }

  function classroom(p, door, side) {
    const { x, w, top, hand, id: number, lab, label, lightId, z } = door;
    const dark = 0x38423b, steel = 0x78857b, handle = 0xc0c4b3;
    const leaf = w - .14, h = top - .076;
    for (const s of [-1, 1]) {
      box(p, doorTrim, x + s * (w / 2 - .027), top / 2, -.044, .065, top, .18, steel);
      box(p, doorTrim, x + s * (w / 2 + .003), top / 2, .039, .062, top + .025, .030, 0x8b968a);
      box(p, doorTrim, x + s * (leaf / 2 + .009), h / 2, -.049, .018, h, .045, dark);
    }
    box(p, doorTrim, x, top - .023, -.032, w + .07, .07, .19, steel);

    // Articulated door leaf mounted on hinge pivot in dynamicRoot
    const doorFrame = group(dynamicRoot, side * W, 0, -side * Math.PI / 2);
    const hingeLocalX = x - hand * (leaf / 2);
    const leafZ = -.103;
    const pivot = group(doorFrame, hingeLocalX, leafZ, 0);
    const cx = hand * (leaf / 2);
    const front = .031;

    const gx = cx - hand * leaf * .185, gy = 1.675;
    const woodTint = number % 2 ? 0xfff1da : 0xf2ebd9;
    cutoutFrame(pivot, doorWood, cx, .025, h - .001, leaf, .058, woodTint, gx, gy, .224, .676);
    visionWindow(pivot, gx, gy, .224, .676, .076, doorGlass, WHITE);
    for (const s of [1, -1]) {
      box(pivot, doorTrim, cx, .20, s * (front + .005), leaf - .043, .265, .014, 0x869187);
      box(pivot, doorTrim, cx, .338, s * (front + .004), leaf - .043, .009, .012, 0xb2b5a4);
    }
    const hx = cx + hand * (leaf / 2 - .107);
    const leverPivots = [];
    const handles = [];
    for (const s of [1, -1]) {
      const fz = s > 0 ? front : -front;
      box(pivot, doorTrim, hx, 1.016, fz + s * .017, .068, .183, .032, steel);
      box(pivot, doorTrim, hx, 1.049, fz + s * .052, .032, .035, .07, handle);
      const leverPivot = group3(pivot, hx, 1.049, fz + s * .083);
      box(leverPivot, doorTrim, -hand * .055, 0, 0, .143, .027, .033, handle);
      const grip = group3(leverPivot, -hand * .078, 0, s * .004);
      leverPivots.push({ group: leverPivot, hand });
      handles.push(grip);
    }
    box(pivot, doorTrim, hx, .985, front + .035, .01, .024, .006, dark);
    const hingeLocalOffset = hand * .011;
    for (const y of [.24, 1.92]) box(pivot, doorTrim, hingeLocalOffset, y, front + .012, .022, .094, .025, steel);
    box(pivot, doorTrim, cx - hand * .23, h - .095, front + .029, .228, .061, .056, 0x59645d);
    const spindleLocalX = hand * .175;
    const spindleLocalZ = front + .029;
    const spindleY = h - .056;
    cylinder(pivot, doorTrim, spindleLocalX, h - .059, spindleLocalZ, .013, .015, .018, steel, 8);
    const shoeX = x - hand * .24;
    const shoeZ = -.040;
    const shoeJointY = top - .073;
    box(p, doorTrim, shoeX, top - .064, shoeZ, .056, .014, .038, 0x59645d);
    const arm1 = cylinder(doorFrame, doorTrim, 0, 0, 0, .009, .009, 1, steel, 6);
    const arm2 = cylinder(doorFrame, doorTrim, 0, 0, 0, .008, .008, 1, 0x627068, 6);
    const elbowPin = cylinder(doorFrame, doorTrim, 0, 0, 0, .012, .012, .024, dark, 8);
    const closerLinkLen = .18;
    const closer = {
      spindleLocalX,
      spindleLocalZ,
      spindleY,
      shoeX,
      shoeJointY,
      shoeZ,
      arm1,
      arm2,
      elbowPin
    };
    function updateCloser(angle) {
      const theta = hand * angle;
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      const ax = hingeLocalX + spindleLocalX * c + spindleLocalZ * s;
      const az = leafZ - spindleLocalX * s + spindleLocalZ * c;
      const dx = shoeX - ax;
      const dz = shoeZ - az;
      const dist = Math.hypot(dx, dz);
      const halfD = Math.min(dist * 0.5, closerLinkLen - 1e-4);
      const bend = Math.sqrt(Math.max(0, closerLinkLen * closerLinkLen - halfD * halfD));
      const invD = dist > 1e-6 ? 1 / dist : 0;
      const nx = dist > 1e-6 ? -hand * dz * invD : 0;
      const nz = dist > 1e-6 ? hand * dx * invD : 1;
      const ex = (ax + shoeX) * 0.5 + nx * bend;
      const ey = (spindleY + shoeJointY) * 0.5;
      const ez = (az + shoeZ) * 0.5 + nz * bend;
      positionLink(arm1, ax, spindleY, az, ex, ey, ez);
      positionLink(arm2, ex, ey, ez, shoeX, shoeJointY, shoeZ);
      elbowPin.position.set(ex, ey, ez);
    }
    updateCloser(0);

    const plateX = x + hand * switchOffset;
    plaque(p, makeMaterial(roomPlate(number, lab, door.subject)), plateX, 1.71, .5, .25);
    box(p, solid, plateX, 1.21, .012, .086, .116, .024, 0xb9b9a7);
    const swGroup = group(dynamicRoot, side * W, 0, -side * Math.PI / 2);
    const rocker = box(swGroup, solid, plateX, 1.213, .027, .039, .055, .016, 0xd1cebb);

    const x0 = side > 0 ? W : -W - wallThickness;
    const x1 = side > 0 ? W + wallThickness : -W;
    const doorObstacle = { x0, x1, z0: z - w / 2, z1: z + w / 2, active: true, rounded: true };
    obstacles.push(doorObstacle);
    obstacles.push({
      x0: side > 0 ? W - .063 : -W - wallThickness,
      x1: side > 0 ? W + wallThickness : -W + .063,
      z0: z - w / 2,
      z1: z + w / 2,
      bottom: top - .058,
      top: H,
      rounded: true
    });

    const hingeWorldX = side * (W + .103);
    const hingeWorldZ = z - side * hand * (leaf / 2);
    const leafEndZ = hingeWorldZ + side * hand * leaf;
    const leafObstacle = {
      kind: 'segment',
      ax: hingeWorldX,
      az: hingeWorldZ,
      bx: hingeWorldX,
      bz: leafEndZ,
      halfThick: .034,
      x0: hingeWorldX - .034,
      x1: hingeWorldX + .034,
      z0: Math.min(hingeWorldZ, leafEndZ) - .034,
      z1: Math.max(hingeWorldZ, leafEndZ) + .034,
      active: true
    };
    obstacles.push(leafObstacle);

    doors.push({
      id: String(number),
      label,
      locked: false,
      open: 0,
      targetOpen: 0,
      rattle: 0,
      slam: 0,
      bounce: 0,
      pos: { x: side * (W + .09), y: 1.15, z },
      openPos: { x: side * (W + .58), y: 1.15, z: z - side * hand * .55 },
      threshold: { x0: x0 - .14, x1: x1 + .14, z0: z - w / 2, z1: z + w / 2 },
      pivots: [{
        group: pivot,
        hand,
        maxAngle: 1.76,
        hx: hingeWorldX,
        hz: hingeWorldZ,
        length: leaf,
        closedDirX: 0,
        closedDirZ: side * hand,
        swingDirX: side,
        swingDirZ: 0,
        obstacle: leafObstacle,
        closer,
        updateCloser
      }],
      leverPivots,
      handles,
      obstacle: doorObstacle
    });

    const swWorldZ = z + side * hand * switchOffset;
    switches.push({
      id: `sw-out-${number}`,
      lightId, label,
      pos: { x: side * (W - .027), y: 1.213, z: swWorldZ },
      rocker,
      sideCheck: pose => (side > 0 ? pose.x < W + .02 : pose.x > -W - .02)
    });
  }

  function plazaPortal(p, f) {
    const { x, z, w, top } = f;
    const leafLen = 1.068;
    const hingeOffset = 1.077;
    const leafZ = -.135;
    const pivots = [];
    const handles = [];

    for (const s of [-1, 1]) {
      box(p, doorTrim, x + s * (w / 2 - .035), top / 2, -.09, .085, top, .22, 0x708076);
      box(p, doorGlass, x + s * .538, 2.327, -.09, 1.03, .22, .014, WHITE);
    }
    box(p, doorTrim, x, top - .024, -.09, w + .06, .075, .22, 0x78857a);
    box(p, doorTrim, x, 2.19, -.09, w - .08, .071, .19, 0x6c7a70);
    plaque(p, exitMat, x, 2.74, .77, .216, .065);
    box(p, doorTrim, x, .012, -.09, w, .024, .26, 0x88948a);

    const leafContainer = group(dynamicRoot, -W, z, Math.PI / 2);
    for (const s of [-1, 1]) {
      const hingeLocalX = s * hingeOffset;
      const leafMount = group(leafContainer, hingeLocalX, leafZ, 0);
      const lx = -s * (leafLen / 2);

      cutoutFrame(leafMount, doorPaint, lx, .015, 2.165, leafLen, .065, 0xafc0b6, lx, 1.67, .48, .66);
      visionWindow(leafMount, lx, 1.67, .48, .66, .080, doorGlass, WHITE);
      for (const faceSign of [1, -1]) {
        box(leafMount, doorTrim, lx, .19, faceSign * .045, leafLen - .055, .23, .020, 0x8c9689);
        for (const off of [-.34, .34]) {
          box(leafMount, doorTrim, lx + off, 1.015, faceSign * .072, .065, .052, .09, 0x637067);
        }
        box(leafMount, doorTrim, lx, 1.02, faceSign * .125, .82, .048, .042, 0xb4b9a8);
      }

      const hingeWorldX = -W + leafZ;
      const hingeWorldZ = z - hingeLocalX;
      const leafEndZ = hingeWorldZ + s * leafLen;
      const leafObstacle = {
        kind: 'segment',
        ax: hingeWorldX,
        az: hingeWorldZ,
        bx: hingeWorldX,
        bz: leafEndZ,
        halfThick: .036,
        x0: hingeWorldX - .036,
        x1: hingeWorldX + .036,
        z0: Math.min(hingeWorldZ, leafEndZ) - .036,
        z1: Math.max(hingeWorldZ, leafEndZ) + .036,
        active: true
      };
      obstacles.push(leafObstacle);
      pivots.push({
        group: leafMount,
        hand: -s,
        maxAngle: 1.65,
        hx: hingeWorldX,
        hz: hingeWorldZ,
        length: leafLen,
        closedDirX: 0,
        closedDirZ: s,
        swingDirX: -1,
        swingDirZ: 0,
        obstacle: leafObstacle
      });
      const frontBar = group3(leafMount, lx - s * .14, 1.02, .125);
      const backBar = group3(leafMount, lx - s * .14, 1.02, -.125);
      handles.push(frontBar, backBar);
    }

    const centerBlocker = {
      x0: -W - wallThickness,
      x1: -W,
      z0: z - w / 2,
      z1: z + w / 2,
      active: true,
      rounded: true
    };
    obstacles.push(centerBlocker);
    obstacles.push({
      x0: -W - wallThickness,
      x1: -W + .063,
      z0: z - w / 2,
      z1: z + w / 2,
      bottom: 2.154,
      top: H,
      rounded: true
    });

    doors.push({
      id: 'plaza',
      label: 'Puertas de la Plaza',
      locked: false,
      open: 0,
      targetOpen: 0,
      rattle: 0,
      slam: 0,
      bounce: 0,
      pos: { x: -W - .09, y: 1.15, z },
      openPos: [
        { x: -W - .68, y: 1.15, z: z - .96 },
        { x: -W - .68, y: 1.15, z: z + .96 }
      ],
      threshold: { x0: -W - .26, x1: -W + .16, z0: z - w / 2, z1: z + w / 2 },
      pivots,
      handles,
      obstacle: centerBlocker
    });
  }

  function windowBank(p, f) {
    const { x, w, bottom, top, variant = 0, blinds, side } = f;
    const h = top - bottom, y = (bottom + top) / 2, trim = 0x777f76;
    const plazaFacing = side === -1;
    if (plazaFacing) {
      box(p, doorGlass, x, y, -.09, w - .06, h - .06, .016, WHITE);
    } else {
      face(p, windows[variant], x, y, -.145, w, h);
    }
    const frameZ = plazaFacing ? -.09 : -.045;
    const frameDepth = plazaFacing ? .22 : .20;
    for (const s of [-1, 1]) {
      box(p, solid, x + s * (w / 2 - .025), y, frameZ, .055, h, frameDepth, trim);
      box(p, solid, x, y + s * (h / 2 - .026), frameZ, w, .053, frameDepth, trim);
    }
    for (const s of [-1, 1]) {
      const mx = x + s * w / 6;
      box(p, solid, mx, y, plazaFacing ? -.09 : -.08, .039, h - .075, plazaFacing ? .15 : .10, 0x525f5b);
      box(p, solid, mx, y, -.024, .024, h - .075, .018, 0x8d988c);
      if (plazaFacing) box(p, solid, mx, y, -.162, .024, h - .075, .018, 0x8d988c);
    }
    box(p, solid, x, top - h * .25, plazaFacing ? -.09 : -.060, w, .039, plazaFacing ? .16 : .073, 0x727f77);
    if (plazaFacing) {
      box(p, solid, x, bottom - .013, -.09, w + .11, .052, .34, 0xacb1a2);
      box(p, solid, x, bottom - .04, .042, w + .06, .024, .112, 0x79877b);
      box(p, solid, x, bottom - .04, -.222, w + .06, .024, .112, 0x79877b);
    } else {
      box(p, solid, x, bottom - .013, -.008, w + .11, .052, .25, 0xacb1a2);
      box(p, solid, x, bottom - .04, .042, w + .06, .024, .112, 0x79877b);
    }
    if (blinds) {
      box(p, solid, x, top - .059, -.05, w - .07, .065, .065, 0x919889);
      for (let i = 0; i < 7; i++) {
        const slat = box(p, solid, x, top - .115 - i * .043, -.060, w - .075, .022, .054, 0xb0b3a0);
        slat.rotation.x = -.19;
      }
    }
  }

  function sideWall(side) {
    const p = group(root, side * W, 0, -side * Math.PI / 2);
    const openings = [
      ...rooms.filter(r => r.side === side).map(r => ({ ...r, z: r.doorZ, w: classroomDoorWidth, top: 2.28 })),
      ...hallWindows.filter(f => f.side === side).map(f => ({ ...f, bottom: 1.12, top: 2.64 })),
      ...(side === -1 ? [{ z: plaza.hallPortal.z, w: plaza.hallPortal.width, top: 2.49, isPlazaPortal: true }] : [])
    ].map(f => ({ ...f, x: side * f.z })).sort((a, b) => a.x - b.x);
    let edge = Math.min(side * far, side * near);
    let wallRunStart = edge;
    const x0 = side > 0 ? W : -W - wallThickness;
    const x1 = side > 0 ? W + wallThickness : -W;
    function pushWallRun(a, b) {
      if (b - a < .02) return;
      const z0 = Math.min(side * a, side * b);
      const z1 = Math.max(side * a, side * b);
      obstacles.push({ x0, x1, z0, z1, rounded: true });
    }
    for (const f of openings) {
      wallPanel(p, edge, f.x - f.w / 2, 0, H, true);
      wallPanel(p, f.x - f.w / 2, f.x + f.w / 2, 0, f.bottom || 0, true);
      wallPanel(p, f.x - f.w / 2, f.x + f.w / 2, f.top, H, true);
      if (f.id) {
        pushWallRun(wallRunStart, f.x - f.w / 2);
        classroom(p, f, side);
        wallRunStart = f.x + f.w / 2;
      } else if (f.isPlazaPortal) {
        pushWallRun(wallRunStart, f.x - f.w / 2);
        plazaPortal(p, f);
        wallRunStart = f.x + f.w / 2;
      } else {
        windowBank(p, f);
      }
      edge = f.x + f.w / 2;
    }
    wallPanel(p, edge, Math.max(side * far, side * near), 0, H, true);
    pushWallRun(wallRunStart, Math.max(side * far, side * near));
    return p;
  }

  const left = sideWall(-1);
  const right = sideWall(1);
  const length = near - far, midZ = (far + near) / 2;
  box(root, floorMat, 0, -.066, midZ, W * 2, .132, length);
  box(root, ceilingMat, 0, H + .054, midZ, W * 2, .108, length);

  function endWall(z, angle, warm, openable = false) {
    const p = group(root, 0, z, angle);
    const w = annexDoorWidth, top = 2.49;
    wallPanel(p, -W, -w / 2); wallPanel(p, w / 2, W); wallPanel(p, -w / 2, w / 2, top, H);
    if (!openable) box(p, solid, 0, top / 2, -.135, w, top, .15, 0x333e39);
    const leafContainer = openable ? group(dynamicRoot, 0, z, angle) : p;
    const lockedHandlesContainer = !openable ? group(dynamicRoot, 0, z, angle) : null;
    const pivots = [];
    const handles = [];

    for (const s of [-1, 1]) {
      box(p, doorTrim, s * (w / 2 - .035), top / 2, 0, .085, top, .15, 0x708076);
      if (openable) {
        box(p, doorGlass, s * .468, 2.327, -.032, .89, .22, .014, warm ? 0xf5e5cc : WHITE);
      } else {
        face(p, warm ? amber : glass, s * .468, 2.327, -.032, .89, .22);
      }
      const hingeX = s * .927;
      const leafMount = openable ? group(leafContainer, hingeX, -.044, 0) : p;
      const lx = openable ? -s * .459 : s * .468;
      const lzOff = openable ? 0 : -.044;

      if (openable) {
        cutoutFrame(leafMount, doorPaint, lx, .015, 2.165, .918, .065, warm ? 0xc4c9b8 : 0xafc0b6, lx, 1.67, .44, .66);
        visionWindow(leafMount, lx, 1.67, .44, .66, .080, doorGlass, warm ? 0xf5e5cc : WHITE);
      } else {
        box(leafMount, doorPaint, lx, 1.09, lzOff, .918, 2.15, .065, warm ? 0xb8bcaa : 0xafc0b6);
        box(leafMount, doorTrim, lx, 1.67, lzOff + .052, .49, .71, .055, 0x3a4943);
        box(leafMount, warm ? amber : glass, lx, 1.67, lzOff + .046, .435, .655, .016, WHITE);
      }
      box(leafMount, doorTrim, lx, .19, lzOff + .046, .861, .23, .024, 0x8c9689);
      for (const off of [-.31, .31]) box(leafMount, doorTrim, lx + off, 1.015, lzOff + .099, .065, .052, .11, 0x637067);
      box(leafMount, doorTrim, lx, 1.02, lzOff + .156, .72, .048, .045, 0xb4b9a8);
      if (openable) {
        // Interior push bar & kickplate on the Annex side
        box(leafMount, doorTrim, lx, .19, -.044, .861, .23, .020, 0x8c9689);
        for (const off of [-.31, .31]) box(leafMount, doorTrim, lx + off, 1.015, -.055, .065, .052, .08, 0x637067);
        box(leafMount, doorTrim, lx, 1.02, -.095, .72, .048, .040, 0xb4b9a8);
        const hingeWorldX = hingeX;
        const hingeWorldZ = z - .044;
        const leafEndX = hingeWorldX - s * .918;
        const leafObstacle = {
          kind: 'segment',
          ax: hingeWorldX,
          az: hingeWorldZ,
          bx: leafEndX,
          bz: hingeWorldZ,
          halfThick: .036,
          x0: Math.min(hingeWorldX, leafEndX) - .036,
          x1: Math.max(hingeWorldX, leafEndX) + .036,
          z0: hingeWorldZ - .036,
          z1: hingeWorldZ + .036,
          active: true
        };
        obstacles.push(leafObstacle);
        pivots.push({
          group: leafMount,
          hand: -s,
          maxAngle: 1.68,
          hx: hingeWorldX,
          hz: hingeWorldZ,
          length: .918,
          closedDirX: -s,
          closedDirZ: 0,
          swingDirX: 0,
          swingDirZ: -1,
          obstacle: leafObstacle
        });
        const frontBar = group3(leafMount, lx - s * .14, 1.02, .156);
        const backBar = group3(leafMount, lx - s * .14, 1.02, -.095);
        handles.push(frontBar, backBar);
      } else {
        const staticBar = group3(lockedHandlesContainer, lx - s * .14, 1.02, lzOff + .156);
        handles.push(staticBar);
      }
    }
    box(p, doorTrim, 0, top - .024, 0, w + .06, .075, .15, 0x78857a);
    box(p, doorTrim, 0, 2.19, .003, w - .08, .071, .107, 0x6c7a70);
    plaque(p, exitMat, 0, 2.74, .77, .216, .065);
    box(p, doorTrim, 0, .012, .02, w, .024, .26, 0x88948a);

    if (openable) {
      obstacles.push(
        { x0: -W, x1: -w / 2, z0: z - .17, z1: z + .02, rounded: true },
        { x0: w / 2, x1: W, z0: z - .17, z1: z + .02, rounded: true }
      );
      const centerBlocker = { x0: -w / 2, x1: w / 2, z0: z - .17, z1: z + .02, active: true, rounded: true };
      obstacles.push(centerBlocker);
      obstacles.push({
        x0: -w / 2,
        x1: w / 2,
        z0: z - .17,
        z1: z + .075,
        bottom: 2.154,
        top: annex.height,
        rounded: true
      });
      doors.push({
        id: 'anexo',
        label: 'Puertas del Anexo',
        locked: false,
        open: 0,
        targetOpen: 0,
        rattle: 0,
        slam: 0,
        bounce: 0,
        pos: { x: 0, y: 1.15, z },
        openPos: [
          { x: -.98, y: 1.15, z: z - .50 },
          { x: .98, y: 1.15, z: z - .50 }
        ],
        threshold: { x0: -w / 2, x1: w / 2, z0: z - .26, z1: z + .16 },
        pivots,
        handles,
        obstacle: centerBlocker
      });
    } else {
      obstacles.push({ x0: -W, x1: W, z0: z - .02, z1: z + .18 });
      doors.push({
        id: 'entrada',
        label: 'Salida principal',
        locked: true,
        open: 0,
        targetOpen: 0,
        rattle: 0,
        slam: 0,
        bounce: 0,
        pos: { x: 0, y: 1.15, z: z - .08 },
        pivots: [],
        handles,
        obstacle: null
      });
    }
  }
  endWall(far, 0, true, true);
  endWall(near, Math.PI, false, false);

  function ceilingFixture(x, z, ceiling, lamp, tubeMat) {
    box(root, solid, x, ceiling - .016, z, .39, .034, 1.72, 0x65716a);
    box(root, solid, x, ceiling - .051, z, .318, .044, 1.66, 0xadb5a5);
    box(root, solid, x, ceiling - .077, z, .24, .011, 1.54, 0xc6cdb9);
    for (const s of [-1, 1]) {
      const tx = x + s * .077;
      const active = lamp.power > .3 || s > 0;
      const tubeColor = lamp.power < .3 ? 0xb9bfaa : lamp.warmth > .4 ? 0xfffbe1 : 0xf0fff4;
      const tube = cylinder(active ? lampTubes : root, active ? tubeMat : solid, tx, ceiling - .121, z,
        .030, .030, 1.51, active ? tubeColor : 0x8a9589, 8);
      tube.rotation.x = Math.PI / 2;
      for (const e of [-1, 1]) box(root, solid, tx, ceiling - .1, z + e * .76, .073, .078, .056, 0x707b72);
    }
  }
  function streetLamp(x, z, lamp, tubeMat) {
    const iron = 0x262e2c, trim = 0x3b4642;
    cylinder(root, solid, x, .18, z, .14, .18, .36, iron, 8);
    cylinder(root, solid, x, .46, z, .095, .135, .24, trim, 8);
    cylinder(root, solid, x, 1.88, z, .052, .082, 2.68, iron, 8);
    cylinder(root, solid, x, 1.35, z, .092, .092, .06, trim, 8);
    cylinder(root, solid, x, 3.04, z, .088, .062, .07, trim, 8);
    box(root, solid, x, 3.21, z, .24, .05, .24, iron);
    for (const sx of [-.10, .10]) for (const sz of [-.10, .10]) {
      box(root, solid, x + sx, 3.35, z + sz, .026, .26, .026, iron);
    }
    box(root, lanternAmberMat, x, 3.35, z, .19, .22, .19, lamp.warmth > .4 ? 0xffdf9e : 0xd8ece4);
    cylinder(root, solid, x, 3.51, z, .16, .21, .06, iron, 4).rotation.y = Math.PI / 4;
    cylinder(root, solid, x, 3.60, z, .03, .15, .13, iron, 4).rotation.y = Math.PI / 4;
    cylinder(root, solid, x, 3.70, z, .008, .022, .09, trim, 6);
    const bulbColor = lamp.warmth > .4 ? 0xffe6ad : 0xe4fff3;
    cylinder(lampTubes, tubeMat, x, 3.35, z, .078, .062, .19, bulbColor, 8);
    const inPlanter = plaza.planters.some(pl => x >= pl.x0 && x <= pl.x1 && z >= pl.z0 && z <= pl.z1);
    if (!inPlanter) {
      obstacles.push({ x0: x - .16, x1: x + .16, z0: z - .16, z1: z + .16, rounded: true });
    }
  }
  [...lights, ...extraLights].forEach((lamp, lampIndex) => {
    const mat = makeMaterial(art.white, { emission: 1, lampIndex });
    if (lampIndex < lights.length + rooms.length) {
      for (const sign of [-1, 1]) ceilingFixture(lamp.x ?? lightX, lamp.z + sign * pairedFixtureOffset, H, lamp, mat);
    } else if (lampIndex < lights.length + rooms.length + 2) {
      ceilingFixture(lamp.x, lamp.z, annex.height, lamp, mat);
      if (lamp.id === 'anexo2') {
        obstacles.push({
          x0: lamp.x - .195,
          x1: lamp.x + .195,
          z0: lamp.z - .86,
          z1: lamp.z + .86,
          bottom: annex.height - .151,
          top: annex.height
        });
      }
    } else {
      streetLamp(lamp.x, lamp.z, lamp, mat);
    }
  });

  // The raised piers and conduit interrupt the long painted walls at real joints.
  const doorZ = id => rooms.find(r => r.id === id).doorZ;
  const eastBoardZ = doorZ('102') + 2.5, westBoardZ = doorZ('106') + 2.5;
  for (let i = 1; i < lights.length; i++) {
    const z = (lights[i - 1].z + lights[i].z) / 2;
    for (const side of [-1, 1]) {
      if (rooms.some(r => r.side === side && Math.abs(z - r.doorZ) < switchOffset + .45) ||
          hallWindows.some(w => w.side === side && Math.abs(z - w.z) < w.w / 2 + .24) ||
          Math.abs(z - (side > 0 ? eastBoardZ : westBoardZ)) < 1.1 ||
          (side < 0 && Math.abs(z - benchZ) < 1.1) ||
          (side < 0 && Math.abs(z - plaza.hallPortal.z) < plaza.hallPortal.width / 2 + .25)) continue;
      const p = group(root, side * (W - .085), z, -side * Math.PI / 2);
      wallPanel(p, -.125, .125);
      obstacles.push({ x0: side < 0 ? -W : W - .11, x1: side < 0 ? -W + .11 : W, z0: z - .125, z1: z + .125 });
    }
    box(root, plaster, 0, H - .06, z, 2 * W, .12, .25, 0xd4d7c9);
    obstacles.push({ x0: -W, x1: W, z0: z - .125, z1: z + .125, bottom: H - .12, top: H });
  }
  box(right, solid, midZ, 2.83, .032, length, .028, .044, 0x8c978a);
  for (let z = far + 1; z < near; z += 2.25) box(right, solid, z, 2.83, .033, .034, .048, .057, 0x69776b);

  for (const { z } of lights.filter((_, i) => i % 2 === 0)) {
    box(root, solid, .97, H - .013, z, .42, .026, .58, 0x818b80);
    box(root, solid, .97, H - .027, z, .372, .018, .53, 0x424e48);
    for (let i = 0; i < 8; i++) box(root, solid, .97, H - .04, z - .214 + i * .06, .347, .014, .024, 0x8c9689);
  }

  plaque(left, makeMaterial(art.directory), -benchZ, 1.78, 1.62, .604);
  function noticeboard(p, x) {
    box(p, wood, x, 1.71, .04, 1.86, .981, .09, 0xc9c9b4);
    box(p, solid, x, 1.71, .083, 1.80, .929, .014, 0x514f3f);
    face(p, boardMat, x, 1.71, .092, 1.762, .885);
  }
  noticeboard(right, eastBoardZ);
  noticeboard(left, -westBoardZ);

  const bench = group(root, -W, benchZ, Math.PI / 2);
  for (const x of [-.65, .65]) {
    for (const z of [.155, .477]) {
      box(bench, solid, x, .21, z, .049, .39, .048, 0x434e46);
      box(bench, solid, x, .031, z, .073, .060, .072, 0x37433c);
    }
    box(bench, solid, x, .404, .32, .065, .057, .471, 0x626e63);
    const back = box(bench, solid, x, .575, .125, .045, .419, .041, 0x4d5a50);
    back.rotation.x = -.11;
  }
  box(bench, solid, 0, .33, .32, 1.39, .047, .037, 0x515f54);
  for (let i = 0; i < 4; i++) box(bench, wood, 0, .45, .138 + i * .115, 1.83, .055, .101, 0xf7ead3);
  for (let i = 0; i < 2; i++) {
    const plank = box(bench, wood, 0, .629 + .122 * i, .133 - .016 * i, 1.83, .10, .043, 0xf8ead2);
    plank.rotation.x = -.11;
  }
  obstacles.push(
    { x0: -W, x1: -W + .14, z0: benchZ - .92, z1: benchZ + .92, top: .78 },
    { x0: -W + .14, x1: -W + .54, z0: benchZ - .92, z1: benchZ + .92, top: .48 }
  );

  function extinguisher(side, z) {
    const p = group(root, side * W, z, -side * Math.PI / 2);
    const red = 0xae412e, zc = .158;
    box(p, solid, 0, .87, .047, .087, .20, .091, 0x525a50);
    cylinder(p, solid, 0, .765, zc, .103, .103, .345, red, 10);
    cylinder(p, solid, 0, .961, zc, .039, .103, .047, red, 10);
    cylinder(p, solid, 0, .573, zc, .103, .076, .040, 0x933825, 10);
    cylinder(p, solid, 0, 1.003, zc, .036, .036, .063, 0x9d9061);
    box(p, solid, -.027, 1.041, zc, .122, .026, .041, 0x323c36);
    box(p, solid, -.039, 1.067, zc, .132, .016, .035, red);
    face(p, solid, 0, .775, zc + .104, .099, .148, 0xded5ae);
    face(p, solid, 0, .817, zc + .105, .086, .023, 0x404f45);
    for (let i = 0; i < 4; i++) face(p, solid, 0, .782 - .014 * i, zc + .105, .068, .004, 0x727a66);
    rod(p, solid, [.035, 1.026, zc], [.126, .994, zc], .016, 0x323a34);
    rod(p, solid, [.126, .994, zc], [.146, .883, zc], .016, 0x323a34);
    rod(p, solid, [.146, .883, zc], [.131, .685, zc + .025], .018, 0x323a34);
    cylinder(p, solid, .132, .667, zc + .026, .022, .031, .084, 0x323a34);
    plaque(p, makeMaterial(art.fire), 0, 1.53, .19, .248, .005);
    obstacles.push({ x0: side < 0 ? -W : W - .28, x1: side < 0 ? -W + .28 : W, z0: z - .15, z1: z + .15, top: 1.15 });
  }
  extinguisher(1, doorZ('101') - 2.2);
  extinguisher(-1, doorZ('103') - 2);

  // A two-sided blade sign can be read on the return walk as well.
  const signZ = doorZ('104') + 2.45;
  const sign = group(root, W - .49, signZ);
  box(sign, solid, .452, 2.60, 0, .23, .05, .06, 0x69786b);
  box(sign, solid, 0, 2.60, 0, .77, .245, .096, 0x495a4c);
  face(sign, exitMat, 0, 2.60, .05, .73, .207);
  face(sign, exitMat, 0, 2.60, -.05, .73, .207).rotation.y = Math.PI;
  obstacles.push({
    x0: W - .875,
    x1: W,
    z0: signZ - .05,
    z1: signZ + .05,
    bottom: 2.477,
    top: 2.723
  });
  buildRooms({
    root,
    dynamicRoot,
    obstacles,
    switches,
    doors,
    materials: { solid, wood, paint, plaster, floorMat, ceilingMat, luminous, doorWood, doorPaint, doorTrim, doorGlass },
    makeMaterial,
    art,
    movableFurniture: furniture
  });

  const scene = bake(root);
  for (const child of [...bake(lampTubes).children]) scene.add(child);
  scene.add(dynamicRoot);
  dynamicRoot.updateMatrixWorld(true);
  const debris = buildDebris(makeMaterial, art, obstacles);
  scene.add(debris.root);
  return { scene, obstacles, doors, switches, debris, furniture };
}

