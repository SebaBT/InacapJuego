import {
  ClampToEdgeWrapping, Float32BufferAttribute, FrontSide, Group, Mesh, MeshBasicMaterial,
  NoColorSpace, PlaneGeometry, Uint16BufferAttribute, Vector3
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { canvasTexture, patina } from './textures.js';
import { MII_BODY_BINARIES, MII_HEAD_BINARY } from './mii-assets.js';
import {
  applyStreetPassPose,
  applySwitchPose,
  computePlayerBodyPlacement,
  PLAYER_BODY_CONFIG,
  PLAYER_BODY_STYLES,
  stripSwitchNeckAndCapCollar
} from './player-body-pose.js';
import {
  applyStreetPassArmAvoidance,
  applySwitchArmAvoidance,
  createArmAvoidanceState,
  resetArmAvoidanceState
} from './arm-avoidance.js';

const SHIRT_RGB = [0xc8 / 255, 0x34 / 255, 0x34 / 255];
const SKIN_RGB = [0xe3 / 255, 0xb5 / 255, 0x97 / 255];
const HAIR_RGB = [0x48 / 255, 0x29 / 255, 0x19 / 255];
const WHITE_RGB = [1, 1, 1];
const PANTS_RGB = [0x2f / 255, 0x35 / 255, 0x40 / 255];
const SHOE_RGB = [0x22 / 255, 0x24 / 255, 0x2a / 255];
const SOLE_RGB = [0xcb / 255, 0xc5 / 255, 0xb4 / 255];

function paintHeadMesh(mesh, rgb, shadeStyle = 'flat') {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const norm = g.attributes.normal;
  const count = pos.count;
  if (!g.attributes.uv) {
    const uvs = new Float32Array(count * 2);
    uvs.fill(0.5);
    g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  }
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const ny = norm ? norm.getY(i) : 0;
    const nz = norm ? norm.getZ(i) : 0;
    let shade = 1;
    if (shadeStyle === 'skin') {
      shade = 0.92 + 0.08 * ny + 0.04 * Math.max(0, nz);
    } else if (shadeStyle === 'hair') {
      shade = 0.90 + 0.16 * Math.max(0, ny);
    }
    colors[i * 3] = rgb[0] * shade;
    colors[i * 3 + 1] = rgb[1] * shade;
    colors[i * 3 + 2] = rgb[2] * shade;
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
}

function paintGeometry(mesh, style, collarCenterIdx = -1) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const count = pos.count;
  if (!g.attributes.uv) {
    const uvs = new Float32Array(count * 2);
    uvs.fill(0.5);
    g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  }
  const colors = new Float32Array(count * 3);
  const si = g.attributes.skinIndex;
  const bones = mesh.isSkinnedMesh ? mesh.skeleton.bones : [];
  mesh.updateMatrixWorld(true);
  const v = new Vector3();

  for (let i = 0; i < count; i++) {
    if (mesh.isSkinnedMesh) mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
    else v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    const boneName = si && bones.length ? bones[si.getX(i)]?.name : '';
    let rgb = SHIRT_RGB;
    let shade = 1;

    if (style === 'streetpass') {
      if (mesh.name === 'hands_m') {
        rgb = SKIN_RGB;
        shade = 0.94 + 0.08 * Math.min(1, Math.max(0, (v.y - 4.4) / 3.0));
      } else if (mesh.name === 'legs_m') {
        rgb = PANTS_RGB;
        shade = 0.88 + 0.14 * Math.min(1, Math.max(0, (v.y - 2.5) / 2.6));
      } else {
        rgb = SHIRT_RGB;
        shade = 0.90 + 0.14 * Math.min(1, Math.max(0, (v.y - 5.0) / 6.5));
      }
    } else {
      if (mesh.name === 'legs_m') {
        if (boneName === 'ankle_l' || boneName === 'ankle_r') {
          rgb = v.y < 0.24 ? SOLE_RGB : SHOE_RGB;
          shade = v.y < 0.24 ? 1 : 0.94 + 0.08 * Math.min(1, Math.max(0, v.y / 1.2));
        } else {
          rgb = PANTS_RGB;
          shade = 0.90 + 0.12 * Math.min(1, Math.max(0, v.y / 7.2));
        }
      } else if (i === collarCenterIdx) {
        rgb = SHIRT_RGB;
        shade = 0.42;
      } else if (boneName === 'wrist_l' || boneName === 'wrist_r') {
        rgb = SKIN_RGB;
        shade = 0.96;
      } else {
        rgb = SHIRT_RGB;
        shade = 0.88 + 0.16 * Math.min(1, Math.max(0, (v.y - 7.0) / 5.0));
      }
    }

    colors[i * 3] = rgb[0] * shade;
    colors[i * 3 + 1] = rgb[1] * shade;
    colors[i * 3 + 2] = rgb[2] * shade;
  }

  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
}

function makeShadowMesh(name, width, depth) {
  const tex = canvasTexture(64, 64, (c, w, h) => {
    c.save();
    c.translate(w / 2, h / 2);
    c.scale(w / 2, h / 2);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(0,0,0,.58)');
    g.addColorStop(0.5, 'rgba(0,0,0,.32)');
    g.addColorStop(1, 'transparent');
    c.fillStyle = g;
    c.fillRect(-1, -1, 2, 2);
    c.restore();
  });
  const mat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const mesh = new Mesh(new PlaneGeometry(width, depth), mat);
  mesh.name = name;
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.002;
  return mesh;
}

export function makePlayerBody(makeMaterial, wake) {
  const root = new Group();
  root.name = 'Cuerpo Mii del jugador';
  root.visible = false;

  const rigHolder = new Group();
  rigHolder.name = 'Rig del jugador';
  root.add(rigHolder);

  const weave = canvasTexture(64, 64, (c, w, h) => patina(c, w, h, [242, 240, 234], 10, 811), true);
  const bodyMaterial = makeMaterial(weave, { emission: 0.30 });
  bodyMaterial.side = FrontSide;
  const headOpaqueMaterial = makeMaterial(weave, { emission: 0.30 });
  headOpaqueMaterial.side = FrontSide;
  const headMaterials = [headOpaqueMaterial];

  const streetpassShadow = makeShadowMesh('Sombra jugador StreetPass', 0.46, 0.46);
  const switchShadows = [
    makeShadowMesh('Sombra zapato izq', 0.22, 0.33),
    makeShadowMesh('Sombra zapato der', 0.22, 0.33)
  ];
  root.add(streetpassShadow, ...switchShadows);

  const rigs = {};
  const bonesByStyle = {};
  const headsByStyle = {};
  let headTemplate = null;
  let currentStyle = 'streetpass';
  let wireframe = false;
  let lastYaw = null;
  let turnRate = 0;
  const armAvoidance = createArmAvoidanceState();
  const loader = new GLTFLoader();
  const tmpVec = new Vector3();

  function attachHeads() {
    if (!headTemplate) return;
    for (const style of ['streetpass', 'switch']) {
      if (headsByStyle[style] || !bonesByStyle[style]) continue;
      const headBone = style === 'streetpass' ? bonesByStyle[style].Head : bonesByStyle[style].head;
      if (!headBone) continue;
      const clone = headTemplate.clone(true);
      clone.name = 'Cabeza Mii';
      clone.visible = false;
      clone.scale.setScalar(PLAYER_BODY_CONFIG[style].headScale);
      headBone.add(clone);
      headsByStyle[style] = clone;
    }
    wake?.();
  }

  async function loadHead() {
    if (!MII_HEAD_BINARY) return;
    const buffer = MII_HEAD_BINARY.buffer.slice(MII_HEAD_BINARY.byteOffset, MII_HEAD_BINARY.byteOffset + MII_HEAD_BINARY.byteLength);
    const gltf = await loader.parseAsync(buffer, '');
    const scene = gltf.scene;
    scene.traverse(obj => {
      if (!obj.isMesh) return;
      obj.frustumCulled = false;
      const name = obj.name || '';
      if (name === 'XluMask' || name === 'XluNoseLine') {
        const tex = obj.material?.map || weave;
        if (tex !== weave) {
          tex.colorSpace = NoColorSpace;
          tex.wrapS = ClampToEdgeWrapping;
          tex.wrapT = ClampToEdgeWrapping;
          tex.needsUpdate = true;
        }
        paintHeadMesh(obj, WHITE_RGB, 'flat');
        const mat = makeMaterial(tex, { emission: 0.32, alphaTexture: true });
        mat.side = FrontSide;
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = -2;
        mat.polygonOffsetUnits = -2;
        mat.wireframe = wireframe;
        headMaterials.push(mat);
        obj.material = mat;
        obj.renderOrder = name === 'XluNoseLine' ? 3 : 2;
      } else if (name === 'OpaHair') {
        paintHeadMesh(obj, HAIR_RGB, 'hair');
        obj.material = headOpaqueMaterial;
      } else {
        paintHeadMesh(obj, SKIN_RGB, 'skin');
        obj.material = headOpaqueMaterial;
      }
    });
    headTemplate = scene;
    attachHeads();
  }

  async function loadStyle(style) {
    const bytes = MII_BODY_BINARIES[style];
    if (!bytes) return;
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const gltf = await loader.parseAsync(buffer, '');
    const model = gltf.scene;
    model.name = `Mii_${style}`;
    model.updateMatrixWorld(true);

    const boneMap = {};
    model.traverse(obj => {
      if (obj.isBone) boneMap[obj.name] = obj;
      if (!obj.isMesh) return;
      const collarCenterIdx = style === 'switch' && obj.name === 'body_m'
        ? stripSwitchNeckAndCapCollar(obj, { Float32BufferAttribute, Uint16BufferAttribute })
        : -1;
      paintGeometry(obj, style, collarCenterIdx);
      obj.material = bodyMaterial;
      obj.frustumCulled = false;
    });

    rigs[style] = model;
    bonesByStyle[style] = boneMap;
    rigHolder.add(model);
    attachHeads();
    syncVisibility();
    wake?.();
  }

  function syncVisibility() {
    for (const [style, model] of Object.entries(rigs)) {
      model.visible = style === currentStyle;
    }
    streetpassShadow.visible = currentStyle === 'streetpass' && Boolean(rigs.streetpass);
    const showSwitchShadows = currentStyle === 'switch' && Boolean(rigs.switch);
    for (const s of switchShadows) s.visible = showSwitchShadows;
  }

  Promise.all([loadStyle('streetpass'), loadStyle('switch'), loadHead()]).catch(err => {
    console.error('No se pudo cargar el cuerpo Mii del jugador:', err);
  });

  function setStyle(nextStyle) {
    if (!PLAYER_BODY_STYLES.includes(nextStyle)) return;
    currentStyle = nextStyle;
    resetArmAvoidanceState(armAvoidance);
    syncVisibility();
    wake?.();
  }

  function setWireframe(enabled) {
    wireframe = Boolean(enabled);
    bodyMaterial.wireframe = wireframe;
    for (const mat of headMaterials) mat.wireframe = wireframe;
  }

  function update(dt, pose, opts = {}) {
    const facingYaw = pose.bodyYaw ?? pose.yaw;
    if (dt > 0.0001 && Number.isFinite(facingYaw)) {
      if (lastYaw !== null) {
        let deltaYaw = (facingYaw - lastYaw) % (Math.PI * 2);
        if (deltaYaw > Math.PI) deltaYaw -= Math.PI * 2;
        if (deltaYaw < -Math.PI) deltaYaw += Math.PI * 2;
        const rawRate = Math.max(-8, Math.min(8, deltaYaw / dt));
        const damp = 1 - Math.exp(-14 * dt);
        turnRate += (rawRate - turnRate) * damp;
      }
      lastYaw = facingYaw;
    } else {
      turnRate *= 0.85;
      if (Number.isFinite(facingYaw)) lastYaw = facingYaw;
    }

    const placement = computePlayerBodyPlacement(pose, currentStyle, opts);
    const activeRig = rigs[currentStyle];
    if (!placement.visible || !activeRig || pose.capture?.hideBody) {
      root.visible = false;
      resetArmAvoidanceState(armAvoidance);
      return;
    }

    root.visible = true;
    root.position.set(placement.x, 0, placement.z);
    root.rotation.y = placement.rotationY;
    rigHolder.position.y = placement.y;
    rigHolder.scale.set(placement.scaleX, placement.scaleY, placement.scaleZ);
    root.updateMatrixWorld(true);

    const doorInteraction = opts.doorInteraction ?? pose.doorInteraction ?? null;
    const headOpacity = pose.headOpacity !== undefined
      ? Math.max(0, Math.min(1, pose.headOpacity))
      : ((pose.showPlayerHead ?? (pose.thirdPersonBlend > 0.15)) ? 1 : 0);
    const showHead = headOpacity > 0.01;
    for (const [style, headMesh] of Object.entries(headsByStyle)) {
      headMesh.visible = style === currentStyle && showHead;
    }
    if (showHead) {
      const fading = headOpacity < 0.99;
      if (headOpaqueMaterial.transparent !== fading) {
        headOpaqueMaterial.transparent = fading;
        headOpaqueMaterial.needsUpdate = true;
      }
      for (const mat of headMaterials) {
        if (mat.uniforms?.opacity) mat.uniforms.opacity.value = headOpacity;
      }
    }
    const bones = bonesByStyle[currentStyle];
    const avoidanceOpts = !pose.capture && (opts.obstacles || opts.bounds)
      ? {
          dt,
          obstacles: opts.obstacles || [],
          bounds: opts.bounds,
          reducedMotion: Boolean(opts.reducedMotion)
        }
      : null;
    if (currentStyle === 'streetpass') {
      const spPose = { ...pose, doorInteraction };
      applyStreetPassPose(bones, spPose);
      if (avoidanceOpts) {
        applyStreetPassArmAvoidance(bones, spPose, armAvoidance, avoidanceOpts);
      }
      rigHolder.updateMatrixWorld(true);
      const jumpHeight = pose.jump ? pose.jump.height : 0;
      const scaleDrop = Math.max(0.55, 1 - jumpHeight * 0.45);
      streetpassShadow.scale.setScalar(scaleDrop);
      streetpassShadow.material.opacity = Math.max(0.25, 1 - jumpHeight * 0.85);
    } else if (currentStyle === 'switch') {
      const swPose = { ...pose, turnRate, doorInteraction };
      applySwitchPose(bones, swPose);
      if (avoidanceOpts) {
        applySwitchArmAvoidance(bones, swPose, armAvoidance, avoidanceOpts);
      }
      rigHolder.updateMatrixWorld(true);
      const jumpHeight = pose.jump ? pose.jump.height : 0;
      const ankles = [bones.ankle_l, bones.ankle_r];
      for (let i = 0; i < 2; i++) {
        const ankle = ankles[i];
        const shadow = switchShadows[i];
        if (!ankle) continue;
        ankle.getWorldPosition(tmpVec);
        root.worldToLocal(tmpVec);
        const clearance = Math.max(0, tmpVec.y - 0.12);
        shadow.position.set(tmpVec.x, 0.002, tmpVec.z + 0.045);
        shadow.scale.setScalar(Math.max(0.55, 1 - (clearance + jumpHeight) * 0.45));
        shadow.material.opacity = Math.max(0.2, 1 - (clearance + jumpHeight) * 0.9);
      }
    }
    if (pose.capture) {
      const c = pose.capture;
      const brace = c.grip * (1 - c.drop);
      if (currentStyle === 'streetpass') {
        for (const hand of [bones.handLPs, bones.handRPs]) {
          if (!hand) continue;
          hand.position.y += 21 * brace;
          hand.position.z += 15 * brace;
        }
      } else {
        for (const side of ['l', 'r']) {
          const s = side === 'l' ? 1 : -1;
          const arm = bones['arm_' + side + '1'], elbow = bones['arm_' + side + '2'];
          if (arm) arm.rotation.x -= .94 * brace;
          if (elbow) elbow.rotation.y -= s * .56 * brace;
        }
      }
      const neck = bones.Head ?? bones.head;
      if (neck) {
        neck.getWorldPosition(tmpVec);
        // Place the upper chest between the gloves on either Mii skeleton.
        rigHolder.position.y += (c.gripY + .09 - tmpVec.y) * c.grip;
        rigHolder.position.y = Math.max(c.floorY + (PLAYER_BODY_CONFIG[currentStyle].tpBaseY || 0), rigHolder.position.y);
      }
    }
  }

  return {
    root,
    get style() { return currentStyle; },
    setStyle,
    setWireframe,
    update
  };
}
