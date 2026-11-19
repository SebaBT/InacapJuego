import { BufferGeometry, Float32BufferAttribute, Mesh, Vector3 } from 'three';
import { ellipsoid, hose, joint } from './model-parts.js';
import { ease } from './emergence.js';
import { backTears } from './cloth-tears.js';

const shell = 0x534b55, jointShade = 0x382d3b, ridge = 0x9a8f84, horn = 0xd3c29e;

// Axial distance from the break and direction around it. Interpolating two
// radial components keeps the torn edge continuous across a tube's UV seam.
function splitCover(mesh, material, axis, sign, center, halfWidth, start, twist) {
  const g = mesh.geometry, p = g.attributes.position, coords = [];
  g.computeBoundingBox();
  const low = g.boundingBox.min, size = g.boundingBox.getSize(new Vector3());
  const radialA = axis === 0 ? 1 : 0, radialB = 3 - axis - radialA;
  const point = new Vector3();
  for (let i = 0; i < p.count; i++) {
    point.fromBufferAttribute(p,i).sub(low).divide(size);
    const along = sign > 0 ? point.getComponent(axis) : 1 - point.getComponent(axis);
    const angle = Math.atan2(point.getComponent(radialB)-.5, point.getComponent(radialA)-.5) + twist;
    coords.push((along-center)/halfWidth, Math.cos(angle), Math.sin(angle), start);
  }
  g.setAttribute('tearCoord', new Float32BufferAttribute(coords,4));
  mesh.material = material;
}

function mirroredHose(parent, name, material, color, side, points) {
  return hose(parent,name,material,color,points.map(([x,...rest]) => [side*x,...rest]),8);
}

// A folded panel has a woven outside, a lighter backing and an uneven free
// edge. Its top row is the hinge that stays stitched to the costume.
function hangingCloth(parent, material, name, at, width, length, side, start, back = false) {
  const positions = [], colors = [], uvs = [], indices = [];
  const palette = [0x594952,0xa28b70,0x7a6959,0xa89170,0x68574f,0xbb9e79];
  const fringe = [.03,.22,.04,.30,.095], rows = palette.length, cols = fringe.length;
  for (let face=0; face<2; face++) for (let row=0; row<rows; row++) {
    const t=row/(rows-1), curl=side*(1.75*t*t-.22*t);
    for (let col=0; col<cols; col++) {
      const u=col/(cols-1), across=(u-.5)*width*(1-.36*t);
      const end=row===rows-1 ? fringe[col] : 0;
      positions.push(across*Math.cos(curl)+side*width*.32*t*t, -length*(t+end),
        across*Math.sin(curl)+length*.10*Math.sin(Math.PI*t)+(col%2)*width*.12*t+(face?-.0015:0));
      const tint=face ? (row===rows-1?0xe1c6a1:0xc4ac8e) : palette[row];
      const shade=col%2 ? .77 : 1;
      colors.push((tint>>16)/255*shade,((tint>>8)&255)/255*shade,(tint&255)/255*shade);
      uvs.push(u,t);
      if (col===cols-1 || row===rows-1) continue;
      const a=positions.length/3-1, b=a+cols;
      if (face) indices.push(a,a+1,b, a+1,b+1,b);
      else indices.push(a,b,a+1, a+1,b,b+1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position',new Float32BufferAttribute(positions,3));
  g.setAttribute('color',new Float32BufferAttribute(colors,3));
  g.setAttribute('uv',new Float32BufferAttribute(uvs,2));
  g.setIndex(indices); g.computeVertexNormals();
  const strip=new Mesh(g,material);
  strip.name=name; strip.position.set(...at); strip.visible=false;
  parent.add(strip);
  return (wear,push) => {
    const fold=ease(start,1,wear);
    strip.visible=fold>0;
    if (!strip.visible) return;
    strip.scale.set(.25+.75*fold,fold,fold);
    strip.rotation.set(-.25-.47*fold-.20*push, back?Math.PI:0, side*(.12+.40*fold));
  };
}

function armDamage({shoulder,elbow,hand,palm}, s, felt, fabric) {
  const delay=s<0?0:.09;
  splitCover(shoulder.getObjectByName('Brazo'),fabric,0,s,.54,.51,.05+delay,s*.69);
  splitCover(elbow.getObjectByName('Antebrazo'),fabric,0,s,.50,.52,.15+delay,-s*.80);
  splitCover(palm.getObjectByName('Guante'),fabric,0,s,.64,.53,.27+delay,s*.56);
  for (const [i,name] of ['Índice','Medio','Meñique','Pulgar'].entries()) {
    splitCover(palm.getObjectByName(name),fabric,0,s,.76,.63,.36+.045*i+delay,s*(.58+i*.70));
  }
  const upper=joint(shoulder,'Húmero de quitina'), lower=joint(elbow,'Articulación interior del codo');
  mirroredHose(upper,'Coraza del brazo',felt,shell,s,[
    [-.014,0,0,.053],[.06,.007,.005,.055],[.14,.014,.012,.030],[.22,-.004,.008,.035],[.282,-.012,0,.048]
  ]);
  mirroredHose(upper,'Nervio del brazo',felt,ridge,s,[
    [.026,.003,.033,.013],[.09,.013,.037,.019],[.15,.024,.032,.008],[.242,.007,.025,.012]
  ]);
  ellipsoid(lower,'Cóndilo',felt,ridge,[0,0,.004],[.052,.051,.053]);
  mirroredHose(lower,'Antebrazo acorazado',felt,shell,s,[
    [.006,0,0,.049],[.057,-.003,.004,.048],[.130,.008,.013,.034],[.18,.019,.009,.044],[.256,.014,.012,.031]
  ]);
  mirroredHose(lower,'Cresta del antebrazo',felt,ridge,s,[
    [.038,-.015,.030,.009],[.105,-.010,.041,.016],[.161,.002,.043,.012],[.229,.013,.033,.005]
  ]);
  mirroredHose(lower,'Tendón del codo',felt,0x6e4e54,s,[
    [-.048,.012,.025,.006],[.010,.018,.044,.009],[.078,.010,.032,.005]
  ]);
  const spur=joint(lower,'Espolón del codo',s*.025,.017,-.016);
  mirroredHose(spur,'Púa del codo',felt,ridge,s,[
    [0,0,0,.029],[.023,.061,-.019,.025],[.065,.12,-.043,.016],[.098,.156,-.061,.0015]
  ]);
  mirroredHose(spur,'Púa secundaria del codo',felt,horn,s,[
    [.018,-.020,-.006,.017],[.052,.015,-.034,.014],[.086,.042,-.056,.0015]
  ]);
  const digits=joint(palm,'Garras bajo el guante',s*.084,0,.005);
  ellipsoid(digits,'Palma acorazada',felt,jointShade,[s*.035,0,0],[.090,.076,.048]);
  for (const [i,y] of [.100,.042,-.014,-.062].entries()) {
    const thumb=i===0, span=thumb?.245:i===2?.434:i===1?.399:.335;
    const rise=thumb?.081:.028-i*.006;
    mirroredHose(digits,'Falange segmentada',felt,i%2===0?ridge:shell,s,[
      [0,y*.55,0,.032],[span*.24,y+.003,.019,.030],[span*.42,y+rise*.48,.029,.023],[span*.53,y+rise,.039,.025]
    ]);
    mirroredHose(digits,'Garra curvada',felt,horn,s,[
      [span*.49,y+rise*.83,.036,.023],[span*.65,y+rise+.010,.049,.028],
      [span*.84,y+rise-.002,.065,.020],[span,y+rise-(thumb?.020:.056),.089,.002]
    ]);
  }
  const strip=hangingCloth(hand,felt,'Manga colgante',[0,-.065,.028],.087,s<0?.227:.163,s,.22+delay);
  return { tips: digits, pose(wear,push) {
    upper.visible=lower.visible=wear>.05+delay;
    const claw=ease(.31+delay,1,wear);
    digits.visible=claw>0;
    digits.scale.set(.40+.60*claw,.76+.24*claw,.65+.35*claw);
    const hornGrowth=ease(.37+delay,.96,wear);
    spur.scale.setScalar(.02+.98*hornGrowth);
    strip(wear,push);
  } };
}

function legDamage({hip,knee,foot}, s, felt, fabric) {
  const delay=s<0?.08:0;
  splitCover(hip.getObjectByName('Muslo'),fabric,1,-1,.48,.49,.055+delay,-s*.81);
  splitCover(knee.getObjectByName('Pierna'),fabric,1,-1,.52,.53,.18+delay,s*.94);
  splitCover(foot.getObjectByName('Puntera y empeine'),fabric,2,1,.71,.51,.36+delay,s*.52);
  const thigh=joint(hip,'Fémur del habitante'), shin=joint(knee,'Tibia del habitante');
  mirroredHose(thigh,'Fémur estriado',felt,shell,s,[
    [0,.012,0,.063],[.004,-.066,.007,.059],[.009,-.14,-.009,.038],[.017,-.212,-.007,.037],[.013,-.257,-.008,.049]
  ]);
  mirroredHose(thigh,'Arista femoral',felt,ridge,s,[
    [-.009,-.028,.044,.018],[.007,-.098,.048,.023],[.016,-.164,.029,.012],[.019,-.234,.030,.009]
  ]);
  ellipsoid(shin,'Rótula de quitina',felt,ridge,[0,-.008,.031],[.058,.059,.039]);
  mirroredHose(shin,'Tendón rotuliano',felt,0x6e4e54,s,[
    [.018,.045,.034,.008],[.006,-.008,.052,.011],[.014,-.074,.036,.007]
  ]);
  mirroredHose(shin,'Caña de quitina',felt,shell,s,[
    [0,0,0,.052],[.013,-.067,-.008,.049],[.022,-.144,.005,.030],[.027,-.212,.016,.036],[.027,-.262,.018,.044]
  ]);
  mirroredHose(shin,'Tendón tibial',felt,0xaaa394,s,[
    [-.026,-.018,.032,.012],[-.008,-.084,.034,.018],[.012,-.142,.027,.012],[.023,-.231,.047,.006]
  ]);
  const barbs=joint(shin,'Espolones de la rodilla',s*.028,-.039,-.012);
  for (const [i,y] of [[0,0],[1,-.055]]) mirroredHose(barbs,'Espina tibial',felt,i?ridge:horn,s,[
    [0,y,0,.021],[.044,y+.018,-.018,.020],[.085,y+.052,-.044,.012],[i?.098:.122,y+.090,-.056,.001]
  ]);
  const toes=joint(foot,'Garras bajo el zapato',0,.069,.103);
  ellipsoid(toes,'Tarso',felt,shell,[0,.031,-.01],[.122,.070,.160]);
  for (const [i,spread] of [-1,0,1].entries()) {
    const reach=i===1?.341:.294;
    hose(toes,'Dedo del tarso',felt,ridge,[
      [spread*.043,.012,.016,.037],[spread*.070,.032,.102,.037],[spread*.094,.048,.159,.029]
    ],8);
    hose(toes,'Uña del tarso',felt,horn,[
      [spread*.091,.047,.14,.027],[spread*.112,.066,.21,.033],
      [spread*.139,.038,reach-.032,.021],[spread*.153,-.040,reach,.002]
    ],8);
  }
  const ribbon=hangingCloth(hip,felt,'Pernera deshilachada',[s*.058,-.041,.034],.094,s<0?.242:.19,s,.28+delay);
  return { tips: toes, pose(wear,push) {
    thigh.visible=shin.visible=wear>.055+delay;
    const claw=ease(.37+delay,1,wear);
    toes.visible=claw>0;
    toes.scale.set(.81+.19*claw,.73+.27*claw,.40+.60*claw);
    barbs.scale.setScalar(.02+.98*ease(.42+delay,1,wear));
    ribbon(wear,push);
  } };
}

export function makeBodyDamage(torso, abdomen, arms, legs, felt, fabric, hoodMaterials) {
  const wearUniform={value:0};
  fabric.defines.TORN_SLEEVE=1;
  fabric.uniforms.garmentWear=wearUniform;
  fabric.needsUpdate=true;
  for (const material of hoodMaterials) {
    material.defines.TORN_HEM=1;
    material.uniforms.garmentWear=wearUniform;
    material.needsUpdate=true;
  }
  const back=hoodMaterials[1], openBack=backTears(back);
  const spine=joint(torso,'Coraza bajo el cierre dorsal');
  ellipsoid(spine,'Forro dorsal',felt,jointShade,[0,.908,-.083],[.367,.511,.113]);
  const dorsalSpines=[];
  for (const [i,y] of [.51,.66,.81,.96,1.11,1.25].entries()) {
    const breadth=.095+.048*Math.sin(i*Math.PI/5);
    for (const side of [-1,1]) {
      const plate=ellipsoid(spine,'Placa dorsal',felt,i%2?0x847780:0x998778,[0,0,0],[breadth,.104,.040]);
      plate.position.set(side*breadth*.67,y,-.165); plate.rotation.z=-side*.52;
      if (i>0) hose(spine,'Ligamento dorsal',felt,0x6a4f55,[
        [side*breadth*.45,y-.12,-.168,.006],[side*.02,y-.04,-.182,.008],[side*breadth*.38,y+.02,-.164,.005]
      ],5);
    }
    ellipsoid(spine,'Quilla dorsal',felt,0xbdab8e,[0,y+.016,-.193],[.032,.067,.027]);
    const spike=joint(spine,'Espina dorsal',0,y+.024,-.196);
    hose(spike,'Púa dorsal',felt,horn,[
      [0,0,0,.022],[0,.032,-.046,.015],[0,.072,-.082,.002]
    ],6);
    dorsalSpines.push(spike);
  }
  const flaps=[];
  for (const s of [-1,1]) {
    flaps.push(hangingCloth(abdomen,felt,'Faldón de terciopelo',[s*.266,.395,.137],s<0?.216:.181,s<0?.478:.376,s,s<0?.10:.22));
    flaps.push(hangingCloth(torso,felt,'Solapa del cierre dorsal',[s*.219,1.08,-.224],.117,s<0?.295:.222,-s,.46,true));
  }
  const limbs=[...arms.map((arm,i)=>armDamage(arm,i*2-1,felt,fabric)), ...legs.map((leg,i)=>legDamage(leg,i*2-1,felt,fabric))];
  return { tips: limbs.map(limb=>limb.tips), pose(wear,push) {
    wearUniform.value=wear; openBack(wear);
    spine.visible=wear>.12;
    spine.position.z=-.025*ease(.40,1,wear)-.013*push;
    const spikeGrowth=ease(.32,.95,wear);
    for (const spike of dorsalSpines) spike.scale.setScalar(.15+.85*spikeGrowth);
    for (const flap of flaps) flap(wear,push);
    for (const limb of limbs) limb.pose(wear,push);
  } };
}
