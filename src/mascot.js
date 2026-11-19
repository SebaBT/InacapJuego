import {
  Box3, DoubleSide, ExtrudeGeometry, Group,
  Mesh, MeshBasicMaterial, PlaneGeometry, Shape, Vector3
} from 'three';
import { canvasTexture, patina } from './textures.js';
import { add, ellipsoid, hose, joint, loft } from './model-parts.js';
import { makeFace } from './face.js';
import { ease } from './emergence.js';
import { abdomenTears, hoodTears, wingTears } from './cloth-tears.js';
import { makeBodyDamage } from './body-damage.js';
import { makeAnimator } from './animate.js';
import { monsterSpawn } from './layout.js';

const halfBody = .64, bodyHeight = 1.43, bottom = .69, depth = .34;
const uvBorder = .065;
const sleeve = 0x61534f, leatherBrown = 0x52484c, binding = 0x302d35;
const glove = 0x887a6e, cuffShade = 0x9a795b;
const legSpread = .237;
const partBox = new Box3();

function setBoxFromVisible(box, obj) {
  box.makeEmpty();
  obj.traverseVisible(part => {
    if (!part.isMesh) return;
    if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
    partBox.copy(part.geometry.boundingBox).applyMatrix4(part.matrixWorld);
    box.union(partBox);
  });
  return box;
}

// A broad silk hood with high temples and notched cheek tufts.
function outline(path, inset = 0) {
  const k = 1 - inset * 2;
  const point = (x, y) => [x*k, .92+(y-.92)*k];
  const curve = (a,b,c,d,e,f) => path.bezierCurveTo(...point(a,b), ...point(c,d), ...point(e,f));
  path.moveTo(...point(0,.39));
  curve(.19,.39,.34,.46,.43,.57);
  path.lineTo(...point(.53,.53)); path.lineTo(...point(.50,.66));
  path.lineTo(...point(.61,.65)); path.lineTo(...point(.555,.81));
  curve(.65,.95,.64,1.14,.54,1.28);
  curve(.41,1.46,.21,1.48,0,1.37);
  curve(-.21,1.48,-.41,1.46,-.54,1.28);
  curve(-.64,1.14,-.65,.95,-.555,.81);
  path.lineTo(...point(-.61,.65)); path.lineTo(...point(-.50,.66));
  path.lineTo(...point(-.53,.53)); path.lineTo(...point(-.43,.57));
  curve(-.34,.46,-.19,.39,0,.39);
  path.closePath();
  return path;
}

function feltPanel(back) {
  return canvasTexture(512, 512, (c, w, h) => {
    patina(c, w, h, back ? [105,87,78] : [209,186,143], 23, back ? 407 : 408);
    const sx = w / (halfBody * 2 + 2 * uvBorder), sy = h / (bodyHeight + 2 * uvBorder);
    c.setTransform(sx,0,0,-sy,w/2,h-uvBorder*sy);
    const wash = c.createLinearGradient(0,.43,0,1.43);
    wash.addColorStop(0,'#45343a91'); wash.addColorStop(.45,'#b18b6020'); wash.addColorStop(1,'#fff1ba39');
    c.fillStyle=wash; c.fillRect(-.7,.32,1.4,1.25);
    function mark(color, points) {
      c.fillStyle=color; c.beginPath(); c.moveTo(...points[0]);
      for(const pt of points.slice(1)) c.lineTo(...pt);
      c.closePath(); c.fill();
    }
    for(const side of [-1,1]) {
      c.save(); c.scale(side,1);
      mark('#59484b',[[.07,1.36],[.25,1.41],[.47,1.31],[.58,1.16],[.54,1.04],[.44,1.18],[.29,1.27],[.18,1.25]]);
      mark('#957d66',[[.13,1.35],[.27,1.37],[.42,1.30],[.49,1.22],[.36,1.30],[.25,1.32]]);
      for(let n=0;n<4;n++) {
        const y=.74+n*.057;
        mark('#6d585765',[[.40,y],[.58,y+.081],[.54,y+.016],[.44,y-.012]]);
      }
      for(let n=0;n<3;n++) {
        const x=.13+n*.078, y=.49+n*.045;
        mark('#63535455',[[x,y+.11],[x+.035,y+.027],[x+.065,y+.004],[x+.055,y+.061]]);
      }
      for(let n=0;n<31;n++) {
        const x=.31+.19*(.5+.5*Math.sin(n*37.72)), y=.78+.45*(.5+.5*Math.cos(n*12.9));
        mark('#70594f55',[[x,y],[x+.006,y+.014],[x+.022,y+.028]]);
      }
      c.restore();
    }
    mark('#51454a',[[0,1.30],[.032,1.245],[0,1.19],[-.032,1.245]]);
    c.beginPath(); outline(c,.017); c.strokeStyle='#61514d'; c.lineWidth=.008; c.stroke();
    c.beginPath(); outline(c,.028); c.setLineDash([.016,.012]); c.strokeStyle='#f0d4a4'; c.lineWidth=.004; c.stroke();
    if(back) {
      c.setLineDash([]); c.strokeStyle='#39313a'; c.lineWidth=.024;
      c.beginPath(); c.moveTo(0,.43); c.lineTo(0,1.36); c.stroke();
      for(let y=.45;y<1.35;y+=.024) {
        c.beginPath(); c.moveTo(-.018,y); c.lineTo(.018,y+.012);
        c.lineWidth=.006; c.strokeStyle='#c5b38f'; c.stroke();
      }
    }
  });
}

function shell(parent, front, back, cloth) {
  const g = new ExtrudeGeometry(outline(new Shape()), {
    depth, bevelEnabled: true, bevelThickness: .061, bevelSize: .033, bevelSegments: 5, curveSegments: 12
  });
  g.translate(0, 0, -depth / 2);
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  const capCount = g.groups[0].count;
  const body = add(parent, 'Capucha de seda', g, [front, back, cloth]);
  g.clearGroups();
  let groupStart = 0, previous = -1;
  for (let i = 0; i < p.count; i += 3) {
    const m = i >= capCount ? 2 : n.getZ(i) > 0 ? 0 : 1;
    if (m !== previous) {
      if (i) g.addGroup(groupStart, i - groupStart, previous);
      groupStart = i; previous = m;
    }
    for (let j = i; j < i + 3; j++) {
      const x = p.getX(j), y = p.getY(j), z = p.getZ(j);
      if (m !== 2) {
        uv.setXY(j, .5 + x / (2 * (halfBody + uvBorder)), (y + uvBorder) / (bodyHeight + 2 * uvBorder));
      } else {
        const rim = Math.max(0, n.getZ(j));
        g.attributes.color.setXYZ(j, .41 + .26 * rim, .34 + .23 * rim, .33 + .14 * rim);
        uv.setXY(j, (x + y) * 2, z * 1.8);
      }
    }
  }
  g.addGroup(groupStart, p.count - groupStart, previous);
  return body;
}

function mothAbdomen(torso, cloth, velvet) {
  const abdomen = joint(torso, 'Tórax y abdomen');
  const levels = [[-.025,.22,.12],[.035,.32,.18],[.12,.36,.206],[.14,.34,.19],
    [.18,.39,.21],[.27,.405,.225],[.292,.37,.203],[.33,.43,.23],
    [.43,.44,.228],[.45,.413,.209],[.49,.47,.23],[.61,.48,.22],[.70,.34,.16]];
  const rings = levels.map(([y,w,d]) => Array.from({length:20},(_,i) => {
    const a = i*Math.PI/10;
    return new Vector3(w*Math.cos(a),y,-.035-d*Math.sin(a));
  }));
  const shell = add(abdomen,'Anillos de terciopelo',loft(rings),velvet);
  const palette = [0x544751,0x776459,0x957959,0x4a4248,0x847057,0xb29469,
    0x50464b,0x857367,0xa59075,0x665354,0xb19a77,0xc4a986,0x74645c];
  const color = shell.geometry.attributes.color;
  for (let i=0;i<levels.length;i++) for (let j=0;j<20;j++) {
    const tint=palette[i], k=i*20+j;
    color.setXYZ(k,((tint>>16)&255)/255,((tint>>8)&255)/255,(tint&255)/255);
  }
  const occupant = joint(abdomen, 'Coraza bajo el terciopelo');
  ellipsoid(occupant,'Abdomen interior',cloth,0x3d2c36,[0,.274,-.031],[.26,.29,.158]);
  ellipsoid(occupant,'Hendidura ventral',cloth,0x140e18,[0,.255,.102],[.046,.215,.038]);
  for (const [i,y] of [.102,.191,.288,.371].entries()) {
    const z=.121+.015*Math.sin(i);
    hose(occupant,'Reborde de quitina',cloth,i%2===0?0x877267:0x73626b,[
      [-.21,y-.038,.026,.008],[-.107,y-.020,z-.022,.016],
      [-.012,y+.009,z,.019,.012],[.094,y+.021,z-.012,.016],[.19,y+.018,.06,.006]
    ],7);
    for (const s of [-1,1]) {
      hose(occupant,'Costilla interior',cloth,0xb9a68b,[
        [s*.12,y-.012,z-.010,.012],[s*.055,y+.010,z+.018,.010],[s*.014,y+.002,z+.024,.003]
      ],6);
      ellipsoid(occupant,'Espiráculo',cloth,0x221a24,[s*.165,y+.026,z-.052],[.019,.022,.014]);
    }
  }
  for (const s of [-1,1]) {
    hose(occupant,'Tendón abdominal',cloth,0x6a4f54,[
      [-s*.038,.09,.122,.005],[s*.022,.22,.135,.006],[-s*.030,.36,.126,.005]
    ],5);
  }
  // The pointed neck ruff overlaps the abdomen like folded scales.
  for (let i=0;i<13;i++) {
    const a=i*Math.PI*2/13, x=.41*Math.cos(a), z=.19*Math.sin(a);
    const rootY=.58+.035*Math.cos(2*a), light=i%3===0?0xc2af90:0xa6937b;
    hose(abdomen,'Mechón del cuello',cloth,light,[
      [x*.85,rootY+.12,z*.88-.04,.055,.048],
      [x,rootY+.01,z-.035,.089,.053],
      [x*1.02,rootY-.07,z*1.18-.035,.059,.036],
      [x*.97,rootY-.14-.024*Math.cos(3*a),z*1.20-.035,.006,.008]
    ],7);
  }
  const tear = abdomenTears(velvet);
  return { abdomen, pose(wear, push) {
    tear(wear);
    occupant.visible = wear > .09;
    occupant.position.z = .024*push;
    occupant.scale.set(1 + .032*push, 1, 1 + .048*push);
  } };
}

function antenna(torso, s, cloth) {
  const base=joint(torso,'Antena pectinada',s*.31,1.33,-.018);
  const bent=s<0?.83:1;
  const spine=t=>[s*(.045+.37*t+.036*t*t),(.07+.50*t-.10*t*t)*bent,-.085*t*t];
  const shaft=[0,.22,.47,.72,1].map(t=>[...spine(t),.018*(1-t)+.004]);
  hose(base,'Raquis',cloth,0x443d44,shaft,8);
  ellipsoid(base,'Base de la antena',cloth,0x887663,[s*.034,.058,0],[.052,.091,.049]);
  for (let i=0;i<10;i++) {
    const t=.075+i*.093, [x,y,z]=spine(t);
    const length=.042+.115*Math.sin(Math.PI*t);
    for (const edge of [-1,1]) {
      hose(base,'Barba de la antena',cloth,edge<0?0x79685c:0x6a5d58,[
        [x,y,z,.010],[x+s*(.019-edge*length*.26),y+edge*length*.36+.009,z-.009,.013],
        [x+s*(.040-edge*length*.49),y+edge*length*.76+.031,z-.022,.006],
        [x+s*(.050-edge*length*.56),y+edge*length*.84+.054,z-.036,.0015]
      ],5);
    }
  }
  return base;
}

function wingPrint(hind) {
  return canvasTexture(256,384,(c,w,h)=>{
    patina(c,w,h,hind?[102,79,70]:[131,108,88],25,hind?784:342);
    c.scale(w/.90,h/1.42);
    function band(color,width,points) {
      c.beginPath(); c.moveTo(...points[0]);
      for(const pt of points.slice(1)) c.lineTo(...pt);
      c.strokeStyle=color; c.lineWidth=width; c.stroke();
    }
    const bandLine=[[.02,.53],[.24,.63],[.33,.60],[.43,.70],[.53,.68],[.68,.81],[.82,.79],[.92,.87]];
    band('#403c45',.13,bandLine);
    band('#d9bf8c',.042,bandLine.map(([x,y])=>[x,y+.043]));
    band('#745951',.019,bandLine.map(([x,y])=>[x,y-.094]));
    for(let i=0;i<7;i++) {
      const end=.19+.105*i;
      band('#483e4677',.009,[[.03,.071],[.17+.031*i,.34],[end*.77,.67],[end,1.29]]);
    }
    const cx=hind?.43:.56, cy=hind?.96:.48;
    for(const [dx,dy,rx,ry,paint] of [
      [0,0,.146,.122,'#a08764'],[0,0,.135,.111,'#463c42'],[-.002,-.006,.112,.086,'#d7b984'],
      [.008,-.014,.097,.074,'#655051'],[.024,-.024,.077,.060,'#35343f'],[-.015,.003,.037,.009,'#d1b995']
    ]) {
      c.beginPath(); c.ellipse(cx+dx,cy+dy,rx,ry,.44,0,Math.PI*2); c.fillStyle=paint; c.fill();
    }
    for(let i=0;i<85;i++) {
      const x=.011+(.5+.5*Math.sin(i*93.37))*.87, y=.01+(.5+.5*Math.sin(i*33.64)) *1.39;
      band('#ddc69c44',.0045,[[x,y],[x+.008,y+.013]]);
    }
  });
}

function mothWing(torso,s,prints) {
  const wing=joint(torso,'Ala plegada',s*.22,1.04,-.186);
  for(const hind of [true,false]) {
    const shape=new Shape();
    shape.moveTo(0,0);
    const curve=(a,b,c,d,x,y)=>shape.bezierCurveTo(s*a,-b,s*c,-d,s*x,-y);
    const tip=(x,y)=>shape.lineTo(s*x,-y);
    if(hind) {
      curve(.34,.10,.68,.47,.67,.81);
      curve(.68,1.00,.58,1.08,.53,1.16);
      tip(.47,1.11); tip(.42,s<0?1.32:1.24); tip(.35,1.15); tip(.27,1.24);
      curve(.19,1.03,.015,.68,0,0);
    } else {
      curve(.33,.005,.65,.19,.76,.47);
      curve(.815,.66,.80,.86,.77,.99);
      tip(.67,.91); tip(.64,1.03); tip(.54,.90); tip(.49,.97);
      curve(.38,.79,.18,.61,.10,.37); curve(.055,.20,.02,.12,0,0);
    }
    shape.closePath();
    const g=new ExtrudeGeometry(shape,{depth:.027,bevelEnabled:true,bevelThickness:.010,bevelSize:.010,bevelSegments:1,curveSegments:6});
    const p=g.attributes.position, uv=g.attributes.uv;
    for(let i=0;i<p.count;i++) {
      const x=s*p.getX(i), y=-p.getY(i);
      uv.setXY(i,x/.90,1-y/1.42);
      p.setZ(i,p.getZ(i)-.24*x-.095*y+.08*Math.sin(Math.PI*x/.9)+(hind?-.058:0));
    }
    g.computeVertexNormals();
    // The cut goes through both faces and the bound outer edge of the wing.
    add(wing,hind?'Ala posterior':'Ala anterior',g,hind?prints.hind:prints.fore);
    const rim=g.groups[1];
    for(let i=rim.start;i<rim.start+rim.count;i++) g.attributes.color.setXYZ(i,.46,.38,.33);
  }
  return wing;
}

function arm(torso, s, side, cloth) {
  const shoulder = joint(torso, 'Hombro.' + side, s * .51, .62, -.055);
  const elbow = joint(shoulder, 'Codo.' + side, s * .275, -.012, 0);
  const hand = joint(elbow, 'Muñeca.' + side, s * .246, .014, .012);
  function tube(node, name, tint, points, sides) {
    return hose(node, name, cloth, tint, points.map(([x, ...rest]) => [s * x, ...rest]), sides);
  }
  tube(shoulder, 'Boca de la manga', binding, [[-.03,0,0,.091],[.033,0,0,.099],[.064,0,0,.089]]);
  tube(shoulder, 'Brazo', sleeve, [[.02,0,0,.083],[.09,0,0,.079],[.20,-.009,-.003,.065],[.29,-.012,0,.061]]);
  tube(elbow, 'Antebrazo', sleeve, [[-.014,0,0,.061],[.065,.002,.002,.063],[.16,.013,.009,.068],[.25,.014,.012,.060]]);
  tube(hand, 'Puño enrollado', glove, [[-.03,0,0,.074],[-.022,0,0,.091],[-.006,0,0,.101],[.031,0,0,.104],[.052,0,0,.089],[.059,0,0,.079]]);
  tube(hand, 'Ribete del puño', cuffShade, [[-.027,0,0,.081],[-.023,0,0,.092],[-.017,0,0,.094]]);
  const palm = joint(hand, 'Palma.' + side);
  palm.rotation.x = -.36;
  ellipsoid(palm, 'Guante', cloth, glove, [s * .12,0,.004], [.126,.103,.071]);
  const fingers = [
    ['Índice', [[.157,.059,0,.047],[.221,.071,.006,.048],[.295,.089,.023,.041],[.323,.091,.029,.028],[.335,.089,.032,.010]]],
    ['Medio', [[.16,.001,.006,.049],[.243,.003,.013,.048],[.317,0,.035,.043],[.347,-.006,.044,.030],[.362,-.007,.047,.011]]],
    ['Meñique', [[.155,-.057,.003,.047],[.215,-.070,.011,.045],[.270,-.087,.030,.040],[.292,-.092,.042,.028],[.304,-.091,.046,.009]]],
    ['Pulgar', [[.07,.047,.018,.051],[.086,.094,.031,.053],[.107,.135,.046,.049],[.143,.162,.058,.039],[.163,.166,.061,.019],[.168,.165,.061,.008]]]
  ];
  for (const [name, points] of fingers) tube(palm, name, glove, points, 9);
  for (const y of [-.028, .027]) {
    tube(palm, 'Costura del guante', 0xb8a698, [[.099,y,.070,.003],[.136,y * 1.12,.072,.004],[.178,y * 1.22,.066,.003]], 5);
  }
  return { shoulder, elbow, hand, palm };
}

function shoe(ankle, s, mat) {
  const foot = joint(ankle, 'Zapato', 0, -.205, 0);
  foot.rotation.y = s * .17;
  function leather(name, tint, levels) {
    const rings = levels.map(([y, width, heel, toe]) => Array.from({ length: 16 }, (_, j) => {
      const a = 2 * Math.PI * j / 16, f = -Math.sin(a);
      const x = Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), .83) * width * (1 + f * .12);
      return new Vector3(x, y, (heel + toe) / 2 + f * (toe - heel) / 2);
    }));
    add(foot, name, loft(rings), mat, tint);
  }
  leather('Suela de goma', 0x302b32, [[0,.147,-.123,.302],[.014,.163,-.138,.321],[.037,.165,-.140,.323],[.048,.162,-.138,.321]]);
  leather('Canto de la suela', 0x917457, [[.037,.166,-.141,.324],[.047,.166,-.140,.324],[.053,.161,-.137,.319]]);
  leather('Puntera y empeine', leatherBrown, [[.050,.162,-.138,.320],[.086,.168,-.140,.331],[.128,.158,-.136,.306],
    [.157,.142,-.127,.266],[.179,.116,-.119,.202],[.197,.098,-.110,.123],[.23,.090,-.102,.083],[.245,.088,-.098,.076]]);
  leather('Borde del zapato', 0x66544f, [[.223,.092,-.104,.086],[.232,.098,-.109,.09],[.247,.095,-.105,.086],[.254,.084,-.094,.077]]);
  return foot;
}

function leg(torso, s, side, cloth) {
  const hip = joint(torso, 'Cadera.' + side, s * legSpread, .026, -.008);
  const knee = joint(hip, 'Rodilla.' + side, s * .013, -.255, -.008);
  const ankle = joint(knee, 'Tobillo.' + side, s * .026, .205 - (bottom + .026 - .255), .018);
  hose(hip, 'Muslo', cloth, sleeve, [[0,.018,0,.094],[0,-.068,0,.090],[s*.006,-.17,-.004,.075],[s*.013,-.267,-.008,.071]]);
  hose(knee, 'Pierna', cloth, sleeve, [[0,.008,0,.071],[s*.006,-.077,-.002,.077],[s*.020,-.176,.012,.073],
    [ankle.position.x,ankle.position.y,ankle.position.z,.067]]);
  const foot = shoe(ankle, s, cloth);
  return { hip, knee, ankle, foot };
}

function shadow() {
  const tex = canvasTexture(192, 128, (c, w, h) => {
    function pool(x, z, rx, rz, alpha) {
      c.save(); c.translate(w * (.5 + x / 3.8), h * (.5 + z / 2.4)); c.scale(w * rx / 3.8, h * rz / 2.4);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, 'rgba(0,0,0,' + alpha + ')'); g.addColorStop(.48, 'rgba(0,0,0,' + alpha * .66 + ')');
      g.addColorStop(1, 'transparent'); c.fillStyle = g; c.fillRect(-1,-1,2,2); c.restore();
    }
    pool(0,-.25,1.09,.8,.38); pool(0,-.42,1.69,.44,.17);
  });
  const body = new Mesh(new PlaneGeometry(3.8, 2.4), new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  body.name = 'Sombra de contacto'; body.rotation.x = -Math.PI / 2; body.position.y = .002;

  const footTex = canvasTexture(64, 96, (c, w, h) => {
    c.save(); c.translate(w / 2, h / 2); c.scale(w / 2, h / 2);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(0,0,0,.72)'); g.addColorStop(.48, 'rgba(0,0,0,.475)');
    g.addColorStop(1, 'transparent'); c.fillStyle = g; c.fillRect(-1, -1, 2, 2); c.restore();
  });
  const feet = ['D', 'I'].map(side => {
    const m = new Mesh(new PlaneGeometry(.45, .66), new MeshBasicMaterial({ map: footTex, transparent: true, depthWrite: false }));
    m.name = 'Sombra del pie.' + side; m.rotation.set(-Math.PI / 2, 0, 0, 'YXZ'); m.position.y = .003;
    return m;
  });
  return { body, feet };
}

export function makeMascot(makeMaterial) {
  const weave = canvasTexture(96, 96, (c, w, h) => patina(c, w, h, [245,242,236], 11, 613), true);
  const cloth = makeMaterial(weave, { emission: .04, monster: true });
  const fabric = makeMaterial(weave, { emission: .04, monster: true });
  const hoodRim = makeMaterial(weave, { emission: .04, monster: true });
  const front = makeMaterial(feltPanel(false), { emission: .05, monster: true });
  const back = makeMaterial(feltPanel(true), { emission: .03, monster: true });
  const velvet = makeMaterial(weave, { emission: .04, monster: true });
  for (const m of [front, back, hoodRim, velvet, fabric]) m.side = DoubleSide;
  const root = new Group(); root.name = 'La Veladora';
  root.position.set(monsterSpawn.x, 0, monsterSpawn.z);
  const torso = joint(root, 'Torso', 0, bottom, 0);
  const body = shell(torso, front, back, hoodRim);
  const faceAnchor = joint(torso, 'Anclaje del rostro', 0, 1.01, depth / 2 + .062);
  const { abdomen, pose: poseAbdomen } = mothAbdomen(torso, cloth, velvet);
  const foreMap = wingPrint(false), hindMap = wingPrint(true);
  const wingMaterials = [], poseWingTears = [];
  const wings = [-1,1].map(side => {
    const fore = makeMaterial(foreMap,{emission:.04, monster: true}), hind = makeMaterial(hindMap,{emission:.04, monster: true});
    wingMaterials.push(fore, hind);
    poseWingTears.push(wingTears(fore, side, false), wingTears(hind, side, true));
    return mothWing(torso, side, {fore, hind});
  });
  const antennae = [-1,1].map(side => antenna(torso, side, cloth));
  const arms = [], legs = [];
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'D' : 'I'; // The mascot faces +Z.
    arms.push(arm(torso, s, side, cloth)); legs.push(leg(torso, s, side, cloth));
  }
  const shadows = shadow();
  const animator = makeAnimator({ torso, wings, antennae, arms, legs, shadow: shadows.body, footShadows: shadows.feet });
  root.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(root, true);
  const collisionParts = [...wings, body, abdomen, ...arms.map(a => a.shoulder), ...legs.map(l => l.hip)];
  const collisions = collisionParts.map(() => new Box3());
  function updateCollisions() {
    root.updateMatrixWorld(true);
    for (let i = 0; i < collisions.length; i++) setBoxFromVisible(collisions[i], collisionParts[i]);
  }
  const poseHood = hoodTears(torso, front, cloth, depth / 2 + .061);
  const bodyDamage = makeBodyDamage(torso, abdomen, arms, legs, cloth, fabric, [front, back, hoodRim]);
  let collisionsDirty = false, ready = false;
  const face = makeFace(faceAnchor, makeMaterial, front, (chase, scream, wear, push) => {
    poseHood(wear, push);
    poseAbdomen(wear, push);
    bodyDamage.pose(wear, push);
    for (const poseTears of poseWingTears) poseTears(wear);
    for(const [i,wing] of wings.entries()) {
      const side=i*2-1;
      const spread=.32*ease(.20+i*.07,.84,wear)+.68*ease(.33+i*.07,.88,scream);
      const angle=side*(.08*chase+.78*spread+push*(i===0?.068:.033));
      animator.setWingBase(i, angle, -side*.12*spread);
    }
    if (ready) collisionsDirty = true;
  });
  updateCollisions();
  face.syncLights();
  ready = true;
  root.add(shadows.body, ...shadows.feet);
  const glove = new Vector3();
  const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  return { root, bounds, collisions, face,
    get animation() { return animator.mode; },
    get animating() { return animator.animating(reducedMotion.matches) || face.animating; },
    setAnimation(name) { animator.setAnimation(name); },
    place(x, y, z, yaw) {
      if (root.position.x === x && root.position.y === y && root.position.z === z && root.rotation.y === yaw) return;
      root.position.set(x, y, z);
      root.rotation.y = yaw;
      collisionsDirty = true;
    },
    gripCenter(out, side = 0) {
      out.set(0, 0, 0);
      for (let i = 0; i < arms.length; i++) {
        if (side && side !== 2 * i - 1) continue;
        glove.set((2 * i - 1) * .12, 0, .004);
        out.add(arms[i].palm.localToWorld(glove));
      }
      return side ? out : out.multiplyScalar(.5);
    },
    facePosition(out) { return faceAnchor.getWorldPosition(out); },
    update(dt, distance, target = null, encounter = null) {
      const animChanged = animator.update(dt, reducedMotion.matches, distance, target, encounter);
      const faceChanged = face.update(dt, distance);
      if (animChanged || faceChanged || collisionsDirty) {
        collisionsDirty = false;
        updateCollisions();
        face.syncLights();
      }
      return faceChanged;
    },
    get triangles() {
      let count = 0;
      torso.traverseVisible(part => {
        if (part.isMesh) count += (part.geometry.index?.count ?? part.geometry.attributes.position.count) / 3;
      });
      return count;
    }, setWireframe(value) {
      for (const m of [front,back,cloth,hoodRim,fabric,velvet,...wingMaterials]) m.wireframe=value;
      face.setWireframe(value);
    } };
}
