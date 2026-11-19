import { Group, SphereGeometry, Vector3 } from 'three';
import { add, ellipsoid } from './model-parts.js';
import { canvasTexture, patina } from './textures.js';
import { makeEmergence, ease } from './emergence.js';
import { suitPerformance } from './suit-wear.js';

// A single pair of eyes stays sewn to the mask throughout the performance.
// The dark button, the ruby pupil and both glints share one curved surface.
function buttonEyes(anchor, makeMaterial) {
  let context, glowContext;
  const lens = canvasTexture(192, 224, c => { context = c; });
  const glowMap = canvasTexture(192, 224, c => { glowContext = c; });
  const mat = makeMaterial(lens, { emission: .08, monster: true, emissiveMap: glowMap, emissivePower: 0 });
  let paintedRadius = -1, currentLight = 0;
  function paint(radius) {
    if (Math.abs(paintedRadius-radius) < .0001) return;
    paintedRadius = radius;
    const c=context;
    c.save(); c.scale(2, 2);
    const lacquer = c.createLinearGradient(0,0,25,112);
    lacquer.addColorStop(0,'#39343d'); lacquer.addColorStop(.63,'#201d26'); lacquer.addColorStop(1,'#17151e');
    c.fillStyle=lacquer; c.fillRect(0,0,96,112);
    if (radius > .001) {
      c.save(); c.translate(48,56); c.scale(1,1.13);
      const r=46*radius, ruby=c.createRadialGradient(-r*.18,-r*.27,0,0,0,r);
      ruby.addColorStop(0,'#ff5148'); ruby.addColorStop(.58,'#e42b39'); ruby.addColorStop(.88,'#c41532'); ruby.addColorStop(1,'#7c122b');
      c.fillStyle=ruby; c.beginPath(); c.arc(0,0,r,0,2*Math.PI); c.fill(); c.restore();
    }
    function glint(color, x, y, rx, ry, angle) {
      c.fillStyle=color; c.beginPath(); c.ellipse(x,y,rx,ry,angle,0,2*Math.PI); c.fill();
    }
    glint('#fff5df',34,33,13.5,15,.34); glint('#d7d3d1',64,66,4.5,4.3,0);
    glint('#74616d',55,94,10,2.8,-.19);
    c.restore();
    lens.needsUpdate=true;

    const g=glowContext;
    g.save(); g.scale(2, 2);
    g.fillStyle='#000000'; g.fillRect(0,0,96,112);
    if (radius > .001) {
      g.save(); g.translate(48,56); g.scale(1,1.13);
      const r=46*radius, spill=r*1.45;
      const halo=g.createRadialGradient(0,0,r*.55,0,0,spill);
      halo.addColorStop(0,'rgba(215, 20, 24, .34)'); halo.addColorStop(1,'rgba(180, 10, 16, 0)');
      g.fillStyle=halo; g.beginPath(); g.arc(0,0,spill,0,2*Math.PI); g.fill();
      const core=g.createRadialGradient(-r*.18,-r*.27,0,0,0,r);
      core.addColorStop(0,'#ff422e'); core.addColorStop(.52,'#ee1824'); core.addColorStop(.86,'#ba0b18'); core.addColorStop(1,'#5e040c');
      g.fillStyle=core; g.beginPath(); g.arc(0,0,r,0,2*Math.PI); g.fill();
      g.restore();
      g.fillStyle='rgba(0, 0, 0, .42)';
      g.beginPath(); g.ellipse(34,33,13.5,15,.34,0,2*Math.PI); g.fill();
    }
    g.restore();
    glowMap.needsUpdate=true;
  }
  const eyes=[-1,1].map(s=>{
    const g=new SphereGeometry(1,36,24), p=g.attributes.position, uv=g.attributes.uv;
    for (let i=0;i<p.count;i++) uv.setXY(i,.5+.5*p.getX(i),.5+.5*p.getY(i));
    g.scale(.079,.095,.024);
    return add(anchor,s<0?'Ojo derecho':'Ojo izquierdo',g,mat);
  });
  const worldPos = new Vector3();
  function syncLights() {
    const lightsUniform = mat.uniforms?.pupilLights?.value;
    if (!lightsUniform) return;
    for (let i = 0; i < eyes.length; i++) {
      const target = lightsUniform[i];
      if (!target) continue;
      if (currentLight <= .001) {
        target.set(0, -99, 0, 0);
        continue;
      }
      eyes[i].updateWorldMatrix(true, false);
      worldPos.set(0, 0, .055).applyMatrix4(eyes[i].matrixWorld);
      target.set(worldPos.x, worldPos.y, worldPos.z, currentLight);
    }
  }
  return {mat, syncLights, pose(chase, tear, strain) {
    const dilation=ease(.13,.86,tear);
    const radius=.44*chase+.38*dilation;
    paint(radius);
    const glowLevel = radius > .001 ? Math.min(1, radius / .34) : 0;
    if (mat.uniforms?.emissivePower) mat.uniforms.emissivePower.value = glowLevel * (1.38 + .30 * dilation);
    currentLight = glowLevel * (.16 + .06 * dilation);
    for (const [i,eye] of eyes.entries()) {
      const s=i*2-1, growth=1+.48*chase+.18*dilation;
      eye.scale.set(growth,growth+.055*strain,growth+.24*strain);
      eye.position.set(s*(.218+.020*chase+.016*dilation),.110+.014*chase+(i===0?.014:-.006)*dilation,.007+.004*chase+.005*strain);
      eye.rotation.z=s*.09+(i===0?.06:-.10)*dilation;
    }
  }};
}

export function makeFace(anchor, makeMaterial, front, poseCostume) {
  const clothMap=canvasTexture(96,96,(c,w,h)=>patina(c,w,h,[242,237,232],14,809),true);
  const mat=makeMaterial(clothMap,{emission:.05, monster: true});
  const cheeks=new Group();
  anchor.add(cheeks);
  for (const s of [-1,1]) {
    const cheek=ellipsoid(cheeks,'Mejilla',mat,0xc28067,[0,0,0],[.074,.057,.011],20,14);
    cheek.position.set(s*.296,-.009,.003); cheek.rotation.z=-s*.18;
  }
  const eyes=buttonEyes(anchor,makeMaterial);
  const innerMat=makeMaterial(clothMap,{emission:.03, monster: true});
  const moveSeam=makeEmergence(anchor,mat,front,innerMat);
  const reducedMotion=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):{matches:false};
  let suit = suitPerformance();
  let lastPush = 0;
  function pose() {
    const { chase, scream, wear } = suit;
    const push = reducedMotion.matches ? 0 : suit.push;
    lastPush = push;
    const strain=ease(0,.28,scream)*(1-ease(.39,.69,scream))+.36*push;
    eyes.pose(chase,scream,strain);
    cheeks.rotation.z=-.016*strain;
    cheeks.position.y=-.013*ease(.24,.74,scream);
    cheeks.position.x=reducedMotion.matches ? 0 : .0025*strain*Math.sin(scream*34);
    moveSeam(scream, chase, wear, push);
    poseCostume(chase, scream, wear, push);
    eyes.syncLights();
  }
  pose();
  return {
    get animating() { return suit.needsFrame(!reducedMotion.matches); },
    get wear() { return suit.wear; },
    get previewing() { return suit.previewing; },
    reset() { suit = suitPerformance(); pose(); },
    setPreviewWear(value) { suit.setPreviewWear(value); pose(); },
    setExpression(name) { suit.setExpression(name); pose(); },
    syncLights() { eyes.syncLights(); },
    update(dt, distance) {
      const changed = suit.update(dt, distance, !reducedMotion.matches);
      if (!changed && !(reducedMotion.matches && lastPush > 0)) return false;
      pose();
      return true;
    },
    setWireframe(value) { mat.wireframe=innerMat.wireframe=eyes.mat.wireframe=value; }
  };
}
