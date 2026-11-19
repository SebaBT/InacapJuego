import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, ShaderMaterial, Vector4 } from 'three';
import { makeFace } from '../src/face.js';

function createCanvasStub() {
  const ops = [];
  const gradient = () => ({ addColorStop() {} });
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    save() {},
    restore() {},
    scale() {},
    translate() {},
    beginPath() {},
    arc(...args) { ops.push({ op: 'arc', args, fillStyle: ctx.fillStyle }); },
    ellipse(...args) { ops.push({ op: 'ellipse', args, fillStyle: ctx.fillStyle }); },
    fill() {},
    fillRect(...args) { ops.push({ op: 'fillRect', args, fillStyle: ctx.fillStyle }); },
    createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData() {},
    createLinearGradient: gradient,
    createRadialGradient: gradient
  };
  return {
    ops,
    canvas: {
      width: 0,
      height: 0,
      getContext() { return ctx; }
    }
  };
}

test('corpóreo pupils light up red only when the red pupils are visible', () => {
  const prevDocument = globalThis.document;
  const canvases = [];
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const stub = createCanvasStub();
      canvases.push(stub);
      return stub.canvas;
    }
  };

  try {
    const pupilLights = { value: [new Vector4(), new Vector4()] };
    const root = new Group();
    root.position.set(0, 0, -15);
    const anchor = new Group();
    anchor.position.set(0, 1.7, .23);
    root.add(anchor);
    const front = new ShaderMaterial();
    let eyeMat = null;

    const makeMaterial = (texture, opts = {}) => {
      const m = new ShaderMaterial({
        uniforms: {
          pupilLights,
          ...(opts.emissiveMap ? {
            emissiveMap: { value: opts.emissiveMap },
            emissivePower: { value: opts.emissivePower ?? 1 }
          } : {})
        }
      });
      if (opts.emissiveMap) eyeMat = m;
      return m;
    };

    const face = makeFace(anchor, makeMaterial, front, () => {});
    assert.ok(eyeMat, 'buttonEyes should create an emissive material');
    const glowOps = canvases[2].ops;

    // Normal expression: red pupils are hidden, so glow & pupil lights stay off.
    assert.equal(eyeMat.uniforms.emissivePower.value, 0);
    assert.equal(pupilLights.value[0].w, 0);
    assert.equal(pupilLights.value[1].w, 0);
    assert.equal(glowOps.some(o => o.op === 'arc'), false);

    // Chase expression: red pupils appear and light up red.
    glowOps.length = 0;
    face.setExpression('chase');
    for (let i = 0; i < 40; i++) face.update(1 / 60, 4);
    const chasePower = eyeMat.uniforms.emissivePower.value;
    const chaseLight = pupilLights.value[0].w;
    assert.ok(chasePower > 1.2, `expected emissivePower > 1.2 in chase, got ${chasePower}`);
    assert.ok(chaseLight > .14, `expected pupil light > 0.14 in chase, got ${chaseLight}`);
    assert.equal(pupilLights.value[1].w, chaseLight);
    assert.ok(pupilLights.value[0].x < 0 && pupilLights.value[1].x > 0);
    assert.ok(pupilLights.value[0].z > -15 + .23, 'pupil light sits in front of the eye lens');
    assert.ok(glowOps.some(o => o.op === 'arc'), 'glow map draws red pupil aura and core');

    // Scream expression: dilated red pupils burn even brighter.
    face.setExpression('scream');
    for (let i = 0; i < 180; i++) face.update(1 / 60, 2);
    assert.ok(eyeMat.uniforms.emissivePower.value > chasePower);
    assert.ok(pupilLights.value[0].w > chaseLight);

    // Preview wear at 0 turns red pupil glow back off cleanly.
    glowOps.length = 0;
    face.setPreviewWear(0);
    assert.equal(eyeMat.uniforms.emissivePower.value, 0);
    assert.equal(pupilLights.value[0].w, 0);
    assert.equal(pupilLights.value[1].w, 0);
    assert.equal(glowOps.some(o => o.op === 'arc'), false);
  } finally {
    globalThis.document = prevDocument;
  }
});
