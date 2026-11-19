import {
  BackSide, Camera, Mesh, NearestFilter, PlaneGeometry, Scene, ShaderMaterial,
  Vector2, Vector3, Vector4, WebGLRenderer, WebGLRenderTarget
} from 'three';
import {
  annex, annexDoorWidth, benchZ, classroomDoorWidth, extraLights, hall, hallWindows,
  lights, lightX, pairedFixtureOffset, plaza, plazaLights, rooms
} from './layout.js';
import { SCREEN_FX_MASK } from './screen-fx.js';

const worldVertex = `
  #include <skinning_pars_vertex>
  varying vec3 worldPos;
  varying vec3 surfaceNormal;
  varying vec2 texCoord;
  varying vec3 paint;
  #ifdef TORN_SLEEVE
  attribute vec4 tearCoord;
  varying vec4 tubePoint;
  #endif
  #if defined(FELT_CUT) || defined(CLOTH_TEARS)
  varying vec2 panelPoint;
  #endif
  #ifdef TORN_HEM
  varying vec2 hemPoint;
  #endif
  void main() {
    #ifdef SKYBOX
    vec4 skyWorld = modelMatrix * vec4(position, 1.0);
    worldPos = skyWorld.xyz;
    surfaceNormal = vec3(0.0, 1.0, 0.0);
    texCoord = uv;
    paint = vec3(1.0);
    gl_Position = projectionMatrix * viewMatrix * skyWorld;
    #else
    #include <beginnormal_vertex>
    #include <begin_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <skinning_vertex>
    #if defined(FELT_CUT) || defined(CLOTH_TEARS)
    panelPoint = transformed.xy;
    #endif
    #ifdef TORN_HEM
    hemPoint = transformed.xy;
    #endif
    #ifdef VERTICAL_TEAR
    panelPoint = transformed.yx;
    #endif
    #ifdef TORN_SLEEVE
    tubePoint = tearCoord;
    #endif
    vec4 world = modelMatrix * vec4(transformed, 1.0);
    worldPos = world.xyz;
    surfaceNormal = mat3(modelMatrix) * objectNormal;
    texCoord = uv;
    paint = color;
    gl_Position = projectionMatrix * viewMatrix * world;
    #endif
  }
`;

const worldFragment = `
  uniform sampler2D surfaceMap;
  uniform vec4 strips[LAMP_COUNT];
  uniform vec4 extraStrips[EXTRA_LAMP_COUNT];
  uniform vec4 doorOpenings[DOOR_COUNT];
  uniform vec4 roomBounds[ROOM_COUNT];
  uniform vec4 plazaPortal;
  uniform vec3 outerWindows[WINDOW_COUNT];
  uniform vec4 room;
  uniform float benchCenter;
  uniform float selfLight;
  uniform float tileFloor;
  uniform float shininess;
  uniform float opacity;
  uniform float ambientLevel;
  uniform float eerieTint;
  uniform float fogDensity;
  uniform float windowGlow;
  uniform float isWindow;
  uniform float lampIndex;
  uniform float isMonster;
  uniform float monsterLight;
  uniform float time;
  uniform vec4 pupilLights[2];
  #ifdef EMISSIVE_MAP
  uniform sampler2D emissiveMap;
  uniform float emissivePower;
  #endif
  #ifdef INNER_CREATURE
  uniform float lightThroughSeam;
  #endif
  varying vec3 worldPos;
  varying vec3 surfaceNormal;
  varying vec2 texCoord;
  varying vec3 paint;
  #ifdef TORN_SLEEVE
  varying vec4 tubePoint;
  uniform float garmentWear;
  float sleeveEdge() {
    if (garmentWear <= tubePoint.w) return 0.0;
    float progress = (garmentWear - tubePoint.w) / (1.0 - tubePoint.w);
    float angle = atan(tubePoint.z, tubePoint.y + 0.00001);
    float weave = 1.0 - 4.0 * abs(fract(angle * (5.0 / 6.2831853) + 0.17) - 0.5);
    float line = 0.44 * sin(angle) + 0.20 * sin(3.0 * angle + 0.8) + 0.19 * weave;
    float onset = 0.15 + 0.13 * cos(angle);
    float reach = clamp((progress - onset) / (1.0 - onset), 0.0, 1.0);
    float width = reach * (1.75 - 0.75 * reach) * (1.06 + 0.20 * sin(2.0 * angle));
    float dist = abs(tubePoint.x - line) - width;
    if (dist < 0.0) return -1.0;
    float fibre = 0.07 + 0.04 * cos(23.0 * angle);
    return (1.0 - smoothstep(0.0, fibre, dist)) * min(1.0, width * 14.0);
  }
  #endif

  #if defined(FELT_CUT) || defined(CLOTH_TEARS)
  varying vec2 panelPoint;
  #endif
  #ifdef TORN_HEM
  uniform float garmentWear;
  varying vec2 hemPoint;
  float hemEdge() {
    if (garmentWear <= 0.14 || hemPoint.y > 0.77) return 0.0;
    float x = hemPoint.x;
    float left = max(0.0, 1.0 - abs((x + 0.19) / 0.30));
    float right = max(0.0, 1.0 - abs((x - 0.23) / 0.24));
    float tooth = abs(fract(x * 13.7 + 0.33) * 2.0 - 1.0);
    float tear = smoothstep(0.14, 1.0, garmentWear);
    float line = 0.345 + tear * (0.102 + 0.250 * left + 0.196 * right + 0.061 * tooth);
    float gap = hemPoint.y - line;
    if (gap < 0.0) return -1.0;
    return tear * (1.0 - smoothstep(0.0, 0.012, gap));
  }
  #endif
  #ifdef FELT_CUT
  uniform vec2 cutOrigin;
  uniform vec2 cutEdge[FELT_CUT];
  #endif
  #ifdef CLOTH_TEARS
  uniform float showTears;
  uniform vec3 tearRows[CLOTH_TEARS * TEAR_ROWS];
  // Negative inside the opening, positive on the pale loose fibres.
  float clothEdge() {
    float fibre = 0.0;
    if (showTears < 0.5) return fibre;
    for (int seam = 0; seam < CLOTH_TEARS; seam++) {
      int start = seam * TEAR_ROWS;
      vec3 a = tearRows[start];
      float endX = tearRows[start + TEAR_ROWS - 1].x;
      if (panelPoint.x < min(a.x, endX) || panelPoint.x > max(a.x, endX)) continue;
      for (int j = 1; j < TEAR_ROWS; j++) {
        vec3 b = tearRows[start + j];
        float u = (panelPoint.x - a.x) / (b.x - a.x);
        if (u >= 0.0 && u <= 1.0) {
          vec2 row = mix(a.yz, b.yz, u);
          float gap = abs(panelPoint.y - row.x) - row.y;
          if (gap < 0.0) return -1.0;
          float threads = fract(panelPoint.x * 127.0 + panelPoint.y * 53.0);
          float trim = min(0.010, row.y * 0.32) * (0.48 + 0.52 * threads);
          fibre = max(fibre, (1.0 - smoothstep(0.0, max(trim, 0.0001), gap)) * min(row.y * 180.0, 1.0));
          break;
        }
        a = b;
      }
    }
    return fibre;
  }
  #endif
  float insideRoomInterior(vec3 p, vec4 rb, float roofY) {
    return smoothstep(rb.x + 0.08, rb.x + 0.24, p.x)
         * (1.0 - smoothstep(rb.y - 0.24, rb.y - 0.08, p.x))
         * smoothstep(rb.z + 0.08, rb.z + 0.24, p.z)
         * (1.0 - smoothstep(rb.w - 0.24, rb.w - 0.08, p.z))
         * (1.0 - smoothstep(roofY - 0.02, roofY + 0.12, p.y));
  }
  void main() {
    #ifdef SKYBOX
    vec3 dir = normalize(worldPos - cameraPosition);
    vec3 skyHorizon = vec3(0.032, 0.052, 0.082);
    vec3 skyZenith = vec3(0.008, 0.014, 0.028);
    vec3 sky = mix(skyHorizon, skyZenith, smoothstep(0.0, 0.72, max(dir.y, 0.0)));

    vec2 cloudUv = dir.xz / (max(dir.y, 0.05) + 0.45) * 0.28;
    vec3 cloudA = texture2D(surfaceMap, cloudUv + vec2(time * 0.0018, time * 0.0007)).rgb;
    vec3 cloudB = texture2D(surfaceMap, cloudUv * 1.65 - vec2(time * 0.0011, -time * 0.0014)).rgb;
    float cloudLum = clamp(dot(cloudA + cloudB, vec3(0.299, 0.587, 0.114)) * 0.5, 0.0, 1.0);
    float cloudCover = smoothstep(0.07, 0.18, cloudLum);
    float cloudMask = smoothstep(0.02, 0.24, dir.y);
    vec3 cloudCol = (cloudA * 0.55 + cloudB * 0.45) * vec3(1.15, 1.35, 1.60) * (0.75 + 0.35 * windowGlow);
    sky = mix(sky, max(sky, cloudCol), cloudMask * 0.52);

    vec3 skyMoonDir = normalize(vec3(0.46, 0.33, -0.82));
    float moonCos = max(dot(dir, skyMoonDir), 0.0);
    float moonMask = 1.0 - smoothstep(0.994, 0.9985, moonCos);

    vec3 sp = dir * 135.0;
    vec3 sc = floor(sp);
    vec3 sf = fract(sp) - 0.5;
    float sh = fract(sin(dot(sc, vec3(127.1, 311.7, 74.7))) * 43758.5453);
    float sh2 = fract(sin(dot(sc, vec3(269.5, 183.3, 419.2))) * 43758.5453);
    vec3 starOff = (vec3(sh, sh2, fract(sh * 17.3)) - 0.5) * 0.44;
    float starDist = length(sf - starOff);
    float starBright = step(0.955, sh) * (1.0 - smoothstep(0.05, 0.24, starDist));
    float starMask = smoothstep(0.06, 0.35, dir.y) * (1.0 - cloudCover * 0.72) * moonMask;
    float twinkle = 0.75 + 0.25 * sin(time * (1.4 + sh2 * 2.2) + sh * 40.0);
    vec3 starTint = mix(vec3(0.55, 0.70, 0.90), vec3(0.85, 0.92, 1.0), sh2);
    sky += starTint * starBright * twinkle * starMask * 0.52 * (0.65 + 0.35 * windowGlow);

    vec3 moonUp = normalize(cross(vec3(0.0, 1.0, 0.0), skyMoonDir));
    vec3 moonRight = cross(skyMoonDir, moonUp);
    vec2 moonLocal = vec2(dot(dir, moonRight), dot(dir, moonUp)) * 18.0;
    float maria = 0.86 + 0.14 * sin(moonLocal.x * 2.4 + moonLocal.y * 1.7) * cos(moonLocal.y * 2.9 - moonLocal.x * 1.3);
    float moonDisc = smoothstep(0.9989, 0.9994, moonCos);
    float safeMoonCos = max(moonCos, 0.0001);
    float moonHalo = pow(safeMoonCos, 38.0) * 0.22 + pow(safeMoonCos, 8.0) * 0.06;
    float moonVis = (1.0 - cloudCover * 0.45) * (0.65 + 0.35 * windowGlow);
    sky += vec3(0.18, 0.28, 0.38) * moonHalo * moonVis;
    sky = mix(sky, vec3(0.72, 0.80, 0.88) * maria * moonVis, moonDisc);

    float horizonMist = 1.0 - smoothstep(-0.02, 0.14, dir.y);
    sky = mix(sky, vec3(0.018, 0.030, 0.042), horizonMist * 0.92);
    gl_FragColor = vec4(sky, 1.0);
    #else
    #ifdef FELT_CUT
    vec2 at = panelPoint - cutOrigin;
    if (abs(at.x) < 0.30 && at.y > -0.55 && at.y < 0.10) {
      bool inside = false;
      vec2 prev = cutEdge[FELT_CUT - 1];
      for (int i = 0; i < FELT_CUT; i++) {
        vec2 nextPoint = cutEdge[i];
        if ((prev.y > at.y) != (nextPoint.y > at.y)) {
          if (at.x < prev.x + (nextPoint.x-prev.x)*(at.y-prev.y)/(nextPoint.y-prev.y)) inside = !inside;
        }
        prev = nextPoint;
      }
      if (inside) discard;
    }
    #endif
    vec3 n = normalize(surfaceNormal);
    vec3 view = normalize(cameraPosition - worldPos);
    vec4 texel = texture2D(surfaceMap, texCoord);
    #ifdef ALPHA_TEXTURE
    if (texel.a < 0.04) discard;
    #endif
    vec3 base = texel.rgb * paint;
    if (isWindow > 0.5) {
      vec3 nightBase = base * vec3(0.28, 0.42, 0.52);
      base = mix(nightBase, base, windowGlow);
    }
    #ifdef TORN_HEM
    float tornHem = hemEdge();
    if (tornHem < 0.0) discard;
    base = mix(base, vec3(0.88, 0.73, 0.54), tornHem);
    #endif
    #ifdef TORN_SLEEVE
    float hem = sleeveEdge();
    if (hem < 0.0) discard;
    base = mix(base, vec3(0.91, 0.76, 0.57), hem);
    #endif
    #ifdef CLOTH_TEARS
    float fray = clothEdge();
    if (fray < 0.0) discard;
    base = mix(base, vec3(0.84, 0.71, 0.55), fray);
    #endif
    vec3 normalAmb = vec3(0.178, 0.210, 0.222);
    vec3 eerieAmb = vec3(0.098, 0.140, 0.146);
    vec3 light = mix(normalAmb, eerieAmb, eerieTint) * ambientLevel + max(n.y, 0.0) * (0.024 * ambientLevel);
    light *= mix(1.0, 0.65, isMonster);
    vec3 gloss = vec3(0.0);
    vec3 surfaceGloss = vec3(0.0);
    vec3 monsterSpec = vec3(0.0);
    float wallGap = max(0.0, room.x - abs(worldPos.x));
    float wallFoot = smoothstep(0.0, 0.45, worldPos.y + wallGap);
    vec3 ray = reflect(-view, n);
    vec2 reflection = worldPos.xz + ray.xz * (room.y - 0.11 - worldPos.y) / max(ray.y, 0.015);

    float inCorridorX = 1.0 - smoothstep(room.x + 0.08, room.x + 0.34, abs(worldPos.x));
    float inHallZ = smoothstep(room.z - 0.32, room.z - 0.06, worldPos.z);
    float hallPortal = 0.0;
    for (int i = 0; i < ROOM_COUNT + 1; i++) {
      vec4 d = doorOpenings[i];
      float openAmt = smoothstep(0.02, 0.45, d.z);
      if (openAmt <= 0.001) continue;
      if (i < ROOM_COUNT) {
        if (abs(abs(d.x) - room.x) > 0.2) continue;
        float sameSide = step(0.0, d.x * worldPos.x);
        float intoRoom = smoothstep(-0.08, 0.14, abs(worldPos.x) - room.x);
        float nearPortalZ = 1.0 - smoothstep(d.w * 0.72, d.w + 1.55, abs(worldPos.z - d.y));
        float reachX = 1.0 - smoothstep(0.05, 2.85, max(0.0, abs(worldPos.x) - room.x));
        hallPortal = max(hallPortal, openAmt * sameSide * intoRoom * nearPortalZ * reachX);
      } else {
        float intoAnnex = smoothstep(-0.18, 0.10, room.z - worldPos.z);
        float nearPortalX = 1.0 - smoothstep(d.w * 0.75, d.w + 1.65, abs(worldPos.x - d.x));
        float reachZ = 1.0 - smoothstep(0.05, 3.05, max(0.0, room.z - worldPos.z));
        hallPortal = max(hallPortal, openAmt * intoAnnex * nearPortalX * reachZ);
      }
    }
    if (ROOM_COUNT + 2 < DOOR_COUNT) {
      float plazaOpen = smoothstep(0.02, 0.45, doorOpenings[ROOM_COUNT + 2].z);
      if (plazaOpen > 0.001) {
        float intoPlaza = smoothstep(-0.08, 0.14, -room.x - worldPos.x);
        float nearPlazaZ = 1.0 - smoothstep(plazaPortal.w * 0.72, plazaPortal.w + 1.65, abs(worldPos.z - plazaPortal.y));
        float reachPlazaX = 1.0 - smoothstep(0.05, 3.10, max(0.0, -room.x - worldPos.x));
        hallPortal = max(hallPortal, plazaOpen * intoPlaza * nearPlazaZ * reachPlazaX);
      }
    }
    float corridorMask = max(inCorridorX * inHallZ, hallPortal * 0.96);
    float shinyWrapMix = smoothstep(0.0, 0.25, shininess);
    float specPower = mix(10.0, 38.0, shininess);

    vec3 coldTint = mix(vec3(0.78, 0.94, 1.035), vec3(0.65, 0.93, 0.81), eerieTint);
    vec3 warmTint = mix(vec3(1.08, 1.005, 0.84), vec3(1.04, 0.84, 0.52), eerieTint);
    float spreadBase = mix(3.65, 2.75, eerieTint);
    float outerReach = mix(83.0, 56.0, eerieTint);

    for (int i = 0; i < LAMP_COUNT; i++) {
      vec4 lamp = strips[i];
      vec3 d = vec3(lamp.x - worldPos.x, room.y - 0.14 - worldPos.y, lamp.y - worldPos.z);
      d.z = sign(d.z) * max(abs(d.z) - (0.68 + PAIRED_FIXTURE_OFFSET), 0.0);
      float radius = d.x*d.x * 0.92 + d.y*d.y * 0.59 + d.z*d.z * 1.28;
      vec3 lightDir = normalize(d + vec3(0.0001));
      float ndl = dot(n, lightDir);
      float direct = max(ndl, 0.0);
      float wrap = max(ndl * 0.56 + 0.44, 0.0);
      float pool = lamp.z * 4.6 / (spreadBase + radius) * (1.0 - smoothstep(26.0, outerReach, radius));
      pool *= mix(0.04, 1.0, corridorMask);
      if (worldPos.y < 0.42 && worldPos.x < -room.x + 0.83 && worldPos.x > -room.x - 0.08 && abs(worldPos.z - benchCenter) < 2.3) {
        float travel = (0.45 - worldPos.y) / (room.y - 0.14 - worldPos.y);
        vec2 hit = mix(worldPos.xz, lamp.xy, travel);
        vec2 edge = abs(hit - vec2(-room.x + 0.32, benchCenter)) - vec2(0.22, 0.91);
        pool *= mix(0.42, 1.0, smoothstep(-0.02, 0.10, max(edge.x, edge.y)));
      }
      vec3 tint = mix(coldTint, warmTint, lamp.w);
      float monsterTerm = 0.14 + 1.32 * pow(direct, 1.15);
      float surfaceDir = mix(0.34 + 0.86 * direct, 0.45 + 0.78 * wrap, shinyWrapMix);
      float dirTerm = mix(surfaceDir, monsterTerm * monsterLight, isMonster);
      light += tint * pool * dirTerm;
      if (isMonster > 0.5) {
        vec3 halfDir = normalize(lightDir + view);
        float spec = pow(max(dot(n, halfDir), 0.0), 14.0);
        monsterSpec += tint * pool * spec * 0.42 * monsterLight;
      } else if (shininess > 0.01) {
        vec3 halfDir = normalize(lightDir + view);
        float spec = pow(max(dot(n, halfDir), 0.0), specPower) * smoothstep(-0.22, 0.24, ndl);
        surfaceGloss += tint * pool * spec * (0.26 + 0.64 * shininess);
      }
      if (tileFloor > 0.5) {
        vec2 offset = abs(reflection - lamp.xy);
        float across = abs(offset.x - 0.069);
        float along = max(0.0, offset.y - (0.73 + PAIRED_FIXTURE_OFFSET));
        float satin = 1.0 / (1.0 + 12.0*across*across + 3.0*along*along);
        float core = 1.0 / (1.0 + 130.0*across*across + 14.0*along*along);
        gloss += tint * lamp.z * (satin * 0.058 + core * 0.14) * corridorMask;
      }
    }

    vec4 rb103 = roomBounds[2];
    vec4 rb106 = roomBounds[5];
    vec4 rb107 = roomBounds[6];
    float inside103 = insideRoomInterior(worldPos, rb103, room.y);
    float inside106 = insideRoomInterior(worldPos, rb106, room.y);
    float inside107 = insideRoomInterior(worldPos, rb107, room.y);
    float plazaBaseMask = 1.0 - smoothstep(-room.x + 0.05, -room.x + 0.22, worldPos.x);
    if (worldPos.z < room.z - 0.05) {
      plazaBaseMask *= 1.0 - smoothstep(ANNEX_SIDE_X + 0.05, ANNEX_SIDE_X + 0.22, worldPos.x);
    }

    for (int i = 0; i < EXTRA_LAMP_COUNT; i++) {
      vec4 lamp = extraStrips[i];
      if (lamp.z <= 0.001) continue;
      vec4 dDoor = doorOpenings[i];
      float openAmt = smoothstep(0.02, 0.45, dDoor.z);
      float spaceMask = 1.0;
      bool isRoom = i < ROOM_COUNT;
      bool isPlaza = i >= ROOM_COUNT + 2;
      if (isRoom) {
        vec4 rb = roomBounds[i];
        float inZ = smoothstep(rb.z - 0.12, rb.z + 0.02, worldPos.z) * (1.0 - smoothstep(rb.w - 0.02, rb.w + 0.12, worldPos.z));
        if (abs(dDoor.x) > 0.5 && abs(abs(dDoor.x) - room.x) < 0.2) {
          float sideSign = sign(dDoor.x);
          float inX = smoothstep(room.x + 0.03, room.x + 0.18, worldPos.x * sideSign);
          inX *= sideSign > 0.0
            ? (1.0 - smoothstep(rb.y, rb.y + 0.18, worldPos.x))
            : smoothstep(rb.x - 0.18, rb.x, worldPos.x);
          float insideRoom = inX * inZ;
          float portalAlong = 1.0 - smoothstep(dDoor.w * 0.72, dDoor.w + 2.1, abs(worldPos.z - dDoor.y));
          float spillCorridor = 1.0 - smoothstep(0.0, 3.6, max(0.0, room.x + 0.16 - worldPos.x * sideSign));
          spaceMask = max(insideRoom, openAmt * portalAlong * spillCorridor * 0.96);
          float extraSpill = 0.0;
          if (i == 0 || i == 1) {
            float sideAdj = (i == 0) ? step(worldPos.z, 12.08) : step(11.92, worldPos.z);
            float dzDoor = (i == 0) ? max(0.0, 12.0 - worldPos.z) : max(0.0, worldPos.z - 12.0);
            float dxDoor = max(0.0, abs(worldPos.x - 10.2) - 0.55);
            extraSpill = (1.0 - smoothstep(0.0, 2.8, length(vec2(dxDoor, dzDoor)))) * sideAdj * step(room.x + 0.04, worldPos.x) * 0.45;
          } else if (i == 3 || i == 4) {
            float sideAdj = (i == 3) ? step(worldPos.z, -14.72) : step(-14.88, worldPos.z);
            float dzDoor = (i == 3) ? max(0.0, -14.8 - worldPos.z) : max(0.0, worldPos.z + 14.8);
            float dxDoor = max(0.0, abs(worldPos.x - 11.4) - 0.55);
            extraSpill = (1.0 - smoothstep(0.0, 2.8, length(vec2(dxDoor, dzDoor)))) * sideAdj * step(room.x + 0.04, worldPos.x) * 0.45;
          } else if (i == 2 || i == 5) {
            float intoPlaza = (i == 2) ? step(worldPos.z, rb.z + 0.08) : step(rb.w - 0.08, worldPos.z);
            float dzWall = (i == 2) ? max(0.0, rb.z - worldPos.z) : max(0.0, worldPos.z - rb.w);
            float doorX = (i == 2) ? -8.6 : -9.0;
            float dxDoor = max(0.0, abs(worldPos.x - doorX) - 0.65);
            float inSpanX = step(rb.x - 0.25, worldPos.x) * step(worldPos.x, rb.y + 0.25);
            float doorSpill = (1.0 - smoothstep(0.0, 3.2, length(vec2(dxDoor, dzWall)))) * 0.52;
            float winSpill = (1.0 - smoothstep(0.0, 2.4, dzWall)) * 0.28;
            extraSpill = max(doorSpill, winSpill) * intoPlaza * inSpanX;
          }
          spaceMask = max(spaceMask, extraSpill);
        } else {
          // Guardhouse 107: bounded interior plus warm spill outside its east/north plaza-facing walls.
          float inX = smoothstep(rb.x - 0.12, rb.x + 0.04, worldPos.x) * (1.0 - smoothstep(rb.y - 0.04, rb.y + 0.12, worldPos.x));
          float insideRoom = inX * inZ;
          float dxOut = max(0.0, worldPos.x - rb.y);
          float dzOut = max(0.0, rb.z - worldPos.z);
          float dxNeg = max(0.0, rb.x - worldPos.x);
          float dzPos = max(0.0, worldPos.z - rb.w);
          float outDist = length(vec2(max(dxOut, dxNeg), max(dzOut, dzPos)));
          float plazaFacing = step(rb.x - 0.25, worldPos.x) * step(worldPos.z, rb.w + 0.25);
          float guardSpill = (1.0 - smoothstep(0.0, 1.8, outDist)) * plazaFacing * 0.65;
          float guardDoorSpill = openAmt * (1.0 - smoothstep(0.0, 2.8, outDist)) * plazaFacing * 0.92;
          spaceMask = max(insideRoom, max(guardSpill, guardDoorSpill));
        }
      } else if (!isPlaza) {
        float insideAnnex = smoothstep(0.03, 0.18, room.z - worldPos.z) * (1.0 - smoothstep(3.92, 4.12, abs(worldPos.x)));
        vec4 ad = doorOpenings[ROOM_COUNT];
        float aOpen = smoothstep(0.02, 0.45, ad.z);
        float portalX = 1.0 - smoothstep(ad.w * 0.75, ad.w + 2.2, abs(worldPos.x - ad.x));
        float spillHall = 1.0 - smoothstep(0.0, 4.4, max(0.0, worldPos.z - (room.z - 0.18)));
        float sidePortalZ = 1.0 - smoothstep(ANNEX_SIDE_HALF_W * 0.75, ANNEX_SIDE_HALF_W + 1.8, abs(worldPos.z - ANNEX_SIDE_Z));
        float spillWest = 1.0 - smoothstep(0.0, 3.2, max(0.0, ANNEX_SIDE_X - worldPos.x)) * step(worldPos.x, ANNEX_SIDE_X + 0.15);
        spaceMask = max(insideAnnex, max(aOpen * portalX * spillHall * 0.96, sidePortalZ * spillWest * 0.60));
      } else {
        float spill103 = exp(-1.2 * max(0.0, worldPos.z - rb103.z)) * 0.34;
        float spill106 = exp(-1.2 * max(0.0, rb106.w - worldPos.z)) * 0.34;
        float spill107 = exp(-1.3 * min(max(0.0, worldPos.z - rb107.z), max(0.0, rb107.y - worldPos.x))) * 0.34;
        float closedMask = max(max(inside103 * (1.0 - spill103), inside106 * (1.0 - spill106)), inside107 * (1.0 - spill107));
        float plazaOutdoor = plazaBaseMask * (1.0 - closedMask);
        float plazaOpen = smoothstep(0.02, 0.45, dDoor.z);
        float intoHall = smoothstep(-0.08, 0.14, worldPos.x + room.x);
        float nearPortalZ = 1.0 - smoothstep(plazaPortal.w * 0.72, plazaPortal.w + 1.85, abs(worldPos.z - plazaPortal.y));
        float reachHallX = 1.0 - smoothstep(0.05, 3.2, max(0.0, worldPos.x + room.x));
        float portalSpill = plazaOpen * intoHall * nearPortalZ * reachHallX * 0.90;
        float winSpill = 0.0;
        for (int w = 0; w < WINDOW_COUNT; w++) {
          vec3 ow = outerWindows[w];
          if (ow.x > 0.0) continue;
          float alongW = max(0.0, abs(worldPos.z - ow.y) - ow.z);
          float reachW = 1.0 - smoothstep(0.0, 2.8, length(vec2(max(0.0, worldPos.x - ow.x), alongW)));
          winSpill = max(winSpill, reachW * step(ow.x - 0.05, worldPos.x) * 0.35);
        }
        spaceMask = max(plazaOutdoor, max(portalSpill, winSpill));
      }
      if (spaceMask <= 0.001) continue;
      float ceiling = isRoom ? room.y : (isPlaza ? PLAZA_LAMP_Y : ANNEX_HEIGHT);
      float extraRun = isRoom ? PAIRED_FIXTURE_OFFSET : 0.0;
      vec3 d = vec3(lamp.x - worldPos.x, ceiling - 0.14 - worldPos.y, lamp.y - worldPos.z);
      if (!isPlaza) {
        d.z = sign(d.z) * max(abs(d.z) - 0.68 - extraRun, 0.0);
      }
      float radius = isPlaza
        ? ((d.x*d.x + d.z*d.z) * 0.58 + d.y*d.y * 0.42)
        : (d.x*d.x * 1.02 + d.y*d.y * 0.59 + d.z*d.z * 1.25);
      vec3 lightDir = normalize(d + vec3(0.0001));
      float ndl = dot(n, lightDir);
      float direct = max(ndl, 0.0);
      float wrap = max(ndl * 0.56 + 0.44, 0.0);
      float pool = isPlaza
        ? (lamp.z * 3.85 / (spreadBase + radius) * (1.0 - smoothstep(22.0, 82.0, radius)) * spaceMask)
        : (lamp.z * 4.5 / (spreadBase + radius) * (1.0 - smoothstep(22.0, isRoom ? 78.0 : 50.0, radius)) * spaceMask);
      vec3 tint = mix(coldTint, warmTint, lamp.w);
      float monsterTerm = 0.14 + 1.32 * pow(direct, 1.15);
      float surfaceDir = mix(0.34 + 0.86 * direct, 0.45 + 0.78 * wrap, shinyWrapMix);
      float dirTerm = mix(surfaceDir, monsterTerm * monsterLight, isMonster);
      light += tint * pool * dirTerm;
      if (isMonster > 0.5) {
        vec3 halfDir = normalize(lightDir + view);
        float spec = pow(max(dot(n, halfDir), 0.0), 14.0);
        monsterSpec += tint * pool * spec * 0.42 * monsterLight;
      } else if (shininess > 0.01) {
        vec3 halfDir = normalize(lightDir + view);
        float spec = pow(max(dot(n, halfDir), 0.0), specPower) * smoothstep(-0.22, 0.24, ndl);
        surfaceGloss += tint * pool * spec * (0.26 + 0.64 * shininess);
      }
      if (tileFloor > 0.5) {
        vec2 reflected = reflection + ray.xz * ((ceiling - room.y) / max(ray.y, 0.015));
        vec2 offset = abs(reflected - lamp.xy);
        float across = isPlaza ? offset.x : abs(offset.x - 0.069);
        float along = isPlaza ? offset.y : max(0.0, offset.y - 0.73 - extraRun);
        float satin = 1.0 / (1.0 + 12.0*across*across + 3.0*along*along);
        float core = 1.0 / (1.0 + 130.0*across*across + 14.0*along*along);
        gloss += tint * lamp.z * (satin * 0.048 + core * 0.11) * spaceMask;
      }
    }

    for (int i = 0; i < 2; i++) {
      vec4 eyeL = pupilLights[i];
      if (eyeL.w <= 0.001) continue;
      vec3 ed = eyeL.xyz - worldPos;
      float dist2 = dot(ed, ed);
      if (dist2 > 2.89) continue;
      vec3 eDir = normalize(ed + vec3(0.0001));
      float eDiff = max(dot(n, eDir), 0.0);
      float eAtten = eyeL.w / (0.032 + dist2 * 5.5);
      float eMask = smoothstep(2.89, 0.04, dist2);
      float dirBoost = mix(0.28 + 0.72 * eDiff, 0.18 + 0.88 * eDiff, isMonster);
      light += vec3(1.25, 0.10, 0.07) * eAtten * dirBoost * eMask;
    }

    // Cool borrowed light from the windows, and warm glow at the far annex doors when lit/closed.
    float borrowed = 0.0;
    for (int i = 0; i < WINDOW_COUNT; i++) {
      vec3 opening = outerWindows[i];
      float along = max(0.0, abs(worldPos.z - opening.y) - opening.z);
      borrowed = max(borrowed, 1.0 - smoothstep(0.0, 3.1, length(vec2(worldPos.x - opening.x, along))));
    }
    float inPlazaOpen = plazaBaseMask * (1.0 - max(max(inside103, inside106), inside107));
    light += vec3(0.024, 0.058, 0.085) * borrowed * windowGlow * max(inCorridorX * inHallZ, inPlazaOpen * 0.70);
    light += vec3(0.016, 0.036, 0.054) * windowGlow * inPlazaOpen * 0.55;
    vec3 moonDir = normalize(vec3(-0.38, 0.56, -0.46));
    float moonNdl = 0.48 + 0.52 * max(dot(n, moonDir), 0.0);
    light += vec3(0.045, 0.068, 0.090) * moonNdl * (0.60 + 0.40 * windowGlow) * inPlazaOpen;
    float annexLitAmt = clamp(extraStrips[ROOM_COUNT].z, 0.0, 1.0);
    float annexOpenFade = 1.0 - 0.75 * smoothstep(0.0, 0.48, doorOpenings[ROOM_COUNT].z);
    float endGlow = (1.0 - smoothstep(0.15, 4.2, abs(worldPos.z - room.z))) * (1.0 - smoothstep(1.25, 2.55, abs(worldPos.x)));
    light += vec3(0.32, 0.15, 0.032) * endGlow * mix(1.0, 0.78, eerieTint) * (0.18 + 0.82 * annexLitAmt) * annexOpenFade;
    float cove = smoothstep(0.0, 0.33, max(0.0, room.y - worldPos.y) + wallGap);
    float wallShadeMask = inCorridorX * inHallZ;
    float footShade = mix(1.0, mix(mix(0.60, 0.44, eerieTint), 1.0, wallFoot), wallShadeMask);
    float coveShade = mix(1.0, mix(mix(0.74, 0.56, eerieTint), 1.0, cove), wallShadeMask);
    float glassFresnel = pow(clamp(1.0 - abs(dot(n, view)), 0.0001, 1.0), 3.0);
    if (opacity < 0.99) {
      surfaceGloss += mix(coldTint, vec3(0.45, 0.58, 0.56), 0.5) * (0.04 + 0.22 * glassFresnel) * ambientLevel * shininess;
    }
    vec3 rgb = base * light * footShade * coveShade + monsterSpec * (0.35 + 0.65 * base) + surfaceGloss * (0.48 + 0.52 * base);
    if (tileFloor > 0.5) {
      float byBench = 1.0 - smoothstep(0.78, 1.14, abs(worldPos.z - benchCenter));
      float underSeat = byBench * (1.0 - smoothstep(0.37, 0.78, worldPos.x + room.x)) * step(-room.x - 0.05, worldPos.x);
      vec2 feet = abs(vec2(worldPos.x + room.x - 0.316, worldPos.z - benchCenter)) - vec2(0.16, 0.65);
      float contact = (1.0 - smoothstep(0.026, 0.11, length(feet))) * step(-room.x - 0.05, worldPos.x);
      rgb *= (1.0 - 0.29 * underSeat) * (1.0 - 0.32 * contact);
      rgb += gloss * smoothstep(0.49, 0.83, base.r) * (1.0 - 0.7 * max(view.y, 0.0));
      for (int i = 0; i < ROOM_COUNT; i++) {
        vec4 d = doorOpenings[i];
        if (abs(abs(d.x) - room.x) > 0.2) continue;
        float closed = 1.0 - smoothstep(0.0, 0.28, d.z);
        float litAmt = clamp(extraStrips[i].z, 0.0, 1.0);
        if (closed * litAmt <= 0.001) continue;
        float sideSign = sign(d.x);
        float doorGap = max(0.0, room.x - worldPos.x * sideSign);
        float inFront = step(worldPos.x * sideSign, room.x + 0.06);
        float sill = (1.0 - smoothstep(d.w - 0.19, d.w - 0.05 + doorGap * 0.12, abs(worldPos.z - d.y))) * inFront;
        vec3 lampTint = mix(coldTint, warmTint, extraStrips[i].w);
        rgb += lampTint * vec3(0.24, 0.16, 0.09) * sill * exp(-8.0 * doorGap) * closed * litAmt;
      }
      vec4 ad = doorOpenings[ROOM_COUNT];
      float aClosed = 1.0 - smoothstep(0.0, 0.28, ad.z);
      float aLit = clamp(extraStrips[ROOM_COUNT].z, 0.0, 1.0);
      if (aClosed * aLit > 0.001) {
        float doorGap = max(0.0, worldPos.z - room.z);
        float inFront = step(room.z - 0.06, worldPos.z);
        float sill = (1.0 - smoothstep(ad.w - 0.17, ad.w + 0.03 + doorGap * 0.14, abs(worldPos.x - ad.x))) * inFront;
        vec3 lampTint = mix(coldTint, warmTint, extraStrips[ROOM_COUNT].w);
        rgb += lampTint * vec3(0.24, 0.16, 0.09) * sill * exp(-7.5 * doorGap) * aClosed * aLit;
      }
    }
    // Keep detail in pale surfaces even immediately beside a fluorescent tube.
    rgb /= vec3(1.0) + 0.82 * max(rgb - 0.64, 0.0);
    float effectiveSelfLight = isWindow > 0.5 ? selfLight * (0.18 + 0.82 * windowGlow) : selfLight;
    if (isMonster > 0.5) {
      effectiveSelfLight *= mix(1.0, 0.35, eerieTint);
    }
    if (lampIndex >= 0.0) {
      vec4 lampData = strips[0];
      for (int i = 0; i < LAMP_COUNT; i++) {
        if (abs(float(i) - lampIndex) < 0.5) lampData = strips[i];
      }
      for (int i = 0; i < EXTRA_LAMP_COUNT; i++) {
        if (abs(float(i + LAMP_COUNT) - lampIndex) < 0.5) lampData = extraStrips[i];
      }
      float p = max(lampData.z, 0.0);
      vec3 coldTube = mix(vec3(0.94, 1.0, 0.96), vec3(0.74, 0.98, 0.88), eerieTint);
      vec3 warmTube = mix(vec3(1.0, 0.98, 0.88), vec3(1.0, 0.84, 0.56), eerieTint);
      vec3 tubeEmit = mix(coldTube, warmTube, lampData.w) * paint;
      float endDist = abs(worldPos.z - lampData.y);
      if (lampIndex < float(LAMP_COUNT + ROOM_COUNT)) endDist = abs(endDist - PAIRED_FIXTURE_OFFSET);
      float cathode = smoothstep(0.54, 0.74, endDist) * smoothstep(0.01, 0.14, p) * (1.0 - smoothstep(0.28, 0.55, p));
      if (lampIndex >= float(LAMP_COUNT + ROOM_COUNT + 2)) cathode = 0.0;
      vec3 glow = tubeEmit * clamp(p * 1.05, 0.0, 1.45) + vec3(0.95, 0.48, 0.16) * cathode * 0.45;
      rgb = max(rgb * 0.42, glow);
      effectiveSelfLight = clamp(p, 0.0, 1.0);
    } else {
      rgb = mix(rgb, base, effectiveSelfLight);
    }
    if (isMonster > 0.5) {
      rgb += max(paint - vec3(1.05), vec3(0.0)) * 0.55;
    }
    #ifdef INNER_CREATURE
    rgb *= lightThroughSeam;
    #endif
    #ifdef EMISSIVE_MAP
    vec3 emissiveGlow = texture2D(emissiveMap, texCoord).rgb * emissivePower;
    rgb += emissiveGlow;
    #endif
    float dist = length(cameraPosition - worldPos);
    vec3 fogCol = mix(vec3(0.067, 0.105, 0.117), vec3(0.017, 0.029, 0.030), eerieTint);
    fogCol = mix(fogCol, vec3(0.018, 0.030, 0.042), inPlazaOpen * 0.70);
    float k = 0.00049 * (0.35 + 2.45 * fogDensity) * mix(1.0, 0.78, inPlazaOpen);
    float haze = 1.0 - exp(-k * dist * dist);
    float glowPierce = 0.0;
    #ifdef EMISSIVE_MAP
    glowPierce = clamp(max(emissiveGlow.r, max(emissiveGlow.g, emissiveGlow.b)) * 0.65, 0.0, 0.85);
    #endif
    rgb = mix(rgb, fogCol, haze * (1.0 - max(0.50 * effectiveSelfLight, glowPierce)));
    float glassBoost = shininess > 0.01 ? dot(surfaceGloss, vec3(0.333)) * 0.55 + glassFresnel * 0.18 : 0.0;
    float outAlpha = opacity < 0.99 && shininess > 0.01 ? clamp(opacity + glassBoost, opacity, 0.92) : opacity;
    #ifdef ALPHA_TEXTURE
    outAlpha *= texel.a;
    #endif
    gl_FragColor = vec4(rgb, outAlpha);
    #endif
  }
`;

const screenFragment = `
  uniform sampler2D frame;
  uniform vec2 resolution;
  uniform float sprintCloud;
  uniform vec2 headBlur;
  uniform float vignetteAmount;
  uniform float grainAmount;
  uniform float eerieTint;
  uniform float time;
  uniform float hazardDanger;
  uniform float hazardChase;
  uniform float hazardGrip;
  uniform float hazardFear;
  uniform float hazardFade;
  uniform float hazardMotion;
  uniform vec2 hazardBearing;
  uniform float hazardSide;
  #define HZ_INNER ${SCREEN_FX_MASK.inner.toFixed(3)}
  #define HZ_OUTER ${SCREEN_FX_MASK.outer.toFixed(3)}
  #define HZ_X ${SCREEN_FX_MASK.xCompression.toFixed(3)}
  #define HZ_GRIP_OPEN ${SCREEN_FX_MASK.gripOpen.toFixed(3)}
  #define HZ_GRIP_CLOSED ${SCREEN_FX_MASK.gripClosed.toFixed(3)}
  #define HZ_GRIP_OUTER ${SCREEN_FX_MASK.gripOuter.toFixed(3)}
  varying vec2 coord;

  vec3 bright(vec2 offset) {
    vec3 c = texture2D(frame, coord + offset / resolution).rgb;
    return max(c - 0.81, 0.0);
  }
  float bayer(vec2 p) {
    vec2 a = mod(floor(p), 2.0);
    float small = 2.0 * a.x + 3.0 * a.y - 4.0 * a.x * a.y;
    vec2 b = mod(floor(p * 0.5), 2.0);
    return (4.0 * small + 2.0*b.x + 3.0*b.y - 4.0*b.x*b.y + 0.5) / 16.0;
  }
  void main() {
    vec3 c = texture2D(frame, coord).rgb;
    if (dot(headBlur, headBlur) > 0.000001) {
      vec3 motion = texture2D(frame, clamp(coord - headBlur, 0.001, 0.999)).rgb * 0.08
                  + texture2D(frame, clamp(coord - headBlur * 0.667, 0.001, 0.999)).rgb * 0.14
                  + texture2D(frame, clamp(coord - headBlur * 0.333, 0.001, 0.999)).rgb * 0.18
                  + c * 0.20
                  + texture2D(frame, clamp(coord + headBlur * 0.333, 0.001, 0.999)).rgb * 0.18
                  + texture2D(frame, clamp(coord + headBlur * 0.667, 0.001, 0.999)).rgb * 0.14
                  + texture2D(frame, clamp(coord + headBlur, 0.001, 0.999)).rgb * 0.08;
      c = motion;
    }
    vec2 radial = coord - 0.5;
    float rim = smoothstep(0.08, 0.68, length(radial));
    if (sprintCloud > 0.005) {
      vec2 radStep = normalize(radial + vec2(0.0001)) * (rim * 0.022 + 0.0045) * sprintCloud;
      vec3 clouded = texture2D(frame, clamp(coord - radStep, 0.001, 0.999)).rgb * 0.15
                   + texture2D(frame, clamp(coord - radStep * 0.5, 0.001, 0.999)).rgb * 0.22
                   + c * 0.26
                   + texture2D(frame, clamp(coord + radStep * 0.5, 0.001, 0.999)).rgb * 0.22
                   + texture2D(frame, clamp(coord + radStep, 0.001, 0.999)).rgb * 0.15;
      float luma = dot(clouded, vec3(0.299, 0.587, 0.114));
      vec3 haze = mix(clouded, vec3(luma) * 0.86 + vec3(0.06, 0.075, 0.08), rim * sprintCloud * 0.45);
      c = mix(c, haze, clamp(sprintCloud * (0.35 + 0.65 * rim), 0.0, 1.0));
    }
    vec3 halo = bright(vec2(-2., 0.)) + bright(vec2(2., 0.)) +
                bright(vec2(0., -2.)) + bright(vec2(0., 2.));
    halo += (bright(vec2(-4., -3.)) + bright(vec2(4., 3.)) +
             bright(vec2(4., -3.)) + bright(vec2(-4., 3.))) * 0.5;
    c += halo * 0.11;
    if (eerieTint > 0.01) {
      vec3 crushed = max(c * vec3(0.95, 1.0, 1.01) - vec3(0.008) * eerieTint, 0.0);
      c = mix(c, crushed, eerieTint * 0.65);
    }
    vec2 p = coord * 2.0 - 1.0;
    c *= 1.0 - (vignetteAmount + 0.16 * sprintCloud) * smoothstep(0.20, 1.76, dot(p, p));
    if (hazardDanger + hazardChase + hazardGrip + hazardFade + hazardFear > 0.002) {
      // All states are radial. HZ_INNER starts outside the clear band so the
      // face, eyes and mouth are never covered by the pressure.
      vec2 hz = vec2(p.x * HZ_X, p.y);
      float radius = length(hz);
      float hzRim = smoothstep(HZ_INNER, HZ_OUTER, radius);
      float slowPulse = mix(0.5, 0.5 + 0.5 * sin(time * 1.55), hazardMotion);
      vec2 outward = normalize(p + vec2(0.00001));
      vec2 threat = normalize(hazardBearing + vec2(0.00001));
      float threatLobe = hzRim * smoothstep(-0.10, 0.90, dot(outward, threat));

      // One dread envelope drives the heavy distortions, so proximity, pursuit
      // and eye-contact fear stack instead of each adding a separate wobble.
      // Explicitly (danger * 0.65 + chase * 0.85 + fear * 1.15) * motion.
      float dread = clamp(hazardDanger * 0.65 + hazardChase * 0.85 + hazardFear * 1.15, 0.0, 1.0);
      // A double-beat heart: fast attack, softer second thump.
      float beat = 0.5 + 0.5 * (0.64 * sin(time * 5.8) + 0.36 * sin(time * 11.6 + 1.35));
      // Nervous high-frequency skin crawl running down the frame.
      float nerve = sin(coord.y * 55.0 + time * 19.0) * 0.6
                  + sin(coord.x * 47.0 - time * 14.5) * 0.4;

      // Barrel lens warp + heartbeat swell + ripple. The middle of the frame is
      // left at HZ_INNER, so this only ever bends the edges of vision.
      if (hazardMotion > 0.001 && dread > 0.002) {
        vec2 warp = outward * hzRim * dread * hazardMotion * (0.0105 + 0.0165 * beat);
        warp += vec2(nerve, nerve * -0.6) * hzRim * dread * hazardMotion * 0.0026;
        vec3 warped = texture2D(frame, clamp(coord + warp, 0.001, 0.999)).rgb;
        c = mix(c, warped, clamp(hzRim * (0.30 + 0.70 * dread), 0.0, 1.0));
      }

      // PS1-style horizontal tear: peripheral scanline bands slip, biased
      // toward the bearing the suit is coming from.
      float tearAmt = clamp(hazardDanger + hazardChase + hazardFear, 0.0, 1.0);
      if (hazardMotion > 0.001 && tearAmt > 0.10) {
        float band = floor(gl_FragCoord.y / 5.0);
        float bandNoise = fract(sin(band * 78.233 + floor(time * 22.0) * 12.9898) * 43758.5453);
        float bandMask = smoothstep(0.70, 0.99, bandNoise) * smoothstep(0.30, 0.95, hzRim);
        vec2 slip = vec2((bandNoise - 0.5) * 0.0095 + threat.x * 0.0045, 0.0);
        vec3 torn = texture2D(frame, clamp(coord + slip * bandMask * tearAmt * hazardMotion, 0.001, 0.999)).rgb;
        c = mix(c, torn, clamp(bandMask * tearAmt * hazardMotion * 0.62, 0.0, 0.75));
      }

      // Directional chromatic aberration, split along the threat *and* the lens
      // radius so the whole border separates into channels, not just one side.
      vec2 splitDir = normalize(threat * 1.15 + outward * 1.45 + vec2(0.00001));
      float splitAmt = hzRim * (0.0015 + 0.0048 * dread) * (0.60 + 0.40 * beat);
      vec3 fringe = c;
      fringe.r = texture2D(frame, clamp(coord + splitDir * splitAmt, 0.001, 0.999)).r;
      fringe.b = texture2D(frame, clamp(coord - splitDir * splitAmt * 1.35, 0.001, 0.999)).b;
      fringe.g = mix(fringe.g, texture2D(frame, clamp(coord + splitDir * splitAmt * 0.40, 0.001, 0.999)).g, 0.55);
      float splitMask = clamp(hzRim * (hazardDanger * 0.42 + hazardChase * 0.52 + hazardFear * 0.72), 0.0, 0.92);
      c = mix(c, fringe, splitMask);

      // Proximity: the edge of vision loses colour and thickens inwards.
      float dangerEdge = hazardDanger * hzRim * (0.55 + 0.45 * slowPulse);
      float hzLuma = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c, vec3(hzLuma) * vec3(0.93, 1.005, 1.0), dangerEdge * 0.30);
      c *= 1.0 - dangerEdge * 0.135;
      if (hazardMotion > 0.001 && hazardDanger > 0.004) {
        vec2 bend = outward * hzRim * (0.0046 + 0.0038 * slowPulse) * hazardDanger * hazardMotion;
        vec3 edge = texture2D(frame, clamp(coord + bend, 0.001, 0.999)).rgb;
        c = mix(c, edge, hzRim * hazardDanger * 0.18);
      }

      // Pursuit: a colder pressure with a lobe pointed at the real bearing.
      float chasePulse = mix(0.5, 0.5 + 0.5 * sin(time * 3.05 + 1.2), hazardMotion);
      float chaseEdge = hazardChase * hzRim;
      c = mix(c, c * vec3(0.90, 0.97, 1.0), chaseEdge * 0.26);
      c *= 1.0 - chaseEdge * 0.11;
      if (hazardMotion > 0.001 && hazardChase > 0.004) {
        vec2 drag = outward * hzRim * (0.0048 + 0.0032 * chasePulse) * hazardChase * hazardMotion;
        vec3 streak = texture2D(frame, clamp(coord + drag, 0.001, 0.999)).rgb;
        c = mix(c, streak, chaseEdge * 0.20);
      }
      c += vec3(0.20, 0.34, 0.32) * threatLobe * hazardChase * (0.055 + 0.045 * chasePulse);

      // Fear: cold, oppressive desaturation with a contrast crush that closes
      // in on every heartbeat. Masked away from the centre, so the eyes and
      // mouth stay legible while everything around them goes wrong.
      float fearMask = hzRim * clamp(hazardFear, 0.0, 1.0);
      if (fearMask > 0.002) {
        float fearLuma = dot(c, vec3(0.299, 0.587, 0.114));
        vec3 coldBlood = vec3(fearLuma) * vec3(0.82, 0.94, 1.02);
        coldBlood = (coldBlood - 0.46) * 1.16 + 0.46;
        c = mix(c, coldBlood, fearMask * (0.30 + 0.18 * beat));
        c *= 1.0 - fearMask * (0.20 + 0.16 * beat);
        c -= vec3(0.010, 0.004, 0.006) * threatLobe * hazardFear * (0.55 + 0.45 * beat);
      }

      // Dynamic static surge: the sensor falls apart at the border when the
      // suit is close, on every frame rather than at the fixed film rate.
      float grainSurge = hzRim * clamp(hazardDanger + hazardChase + hazardFear, 0.0, 1.0);
      if (grainSurge > 0.004) {
        float surgeNoise = fract(sin(dot(gl_FragCoord.xy + vec2(floor(time * 57.0) * 3.1, floor(time * 43.0) * 5.7), vec2(12.9898, 78.233))) * 43758.5453);
        c += (surgeNoise - 0.5) * 0.085 * grainSurge;
      }

      // Grip: darkness closes from the border but stops around the clear band.
      float gripInner = mix(HZ_GRIP_OPEN, HZ_GRIP_CLOSED, clamp(hazardGrip, 0.0, 1.0));
      float gripMask = smoothstep(gripInner, HZ_GRIP_OUTER, radius + hazardSide * p.x * 0.035 * hazardGrip);
      c = mix(c, vec3(0.006, 0.012, 0.012), gripMask * hazardGrip * 0.82);
      float ring = smoothstep(gripInner, gripInner + 0.10, radius) *
                   (1.0 - smoothstep(gripInner + 0.10, gripInner + 0.22, radius));
      c += vec3(0.055, 0.082, 0.078) * ring * hazardGrip * (0.55 + 0.45 * slowPulse);

      // Final fade: drain colour just ahead of the CSS curtain.
      float fade = clamp(hazardFade, 0.0, 1.0);
      float fadeLuma = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c, vec3(fadeLuma) * 0.72, fade * 0.58);
      c *= 1.0 - fade * 0.30;
    }
    if (grainAmount > 0.005) {
      float noise = fract(sin(dot(gl_FragCoord.xy + vec2(fract(time * 0.37) * 97.0, fract(time * 0.61) * 53.0), vec2(12.9898, 78.233))) * 43758.5453);
      c += (noise - 0.5) * 0.042 * grainAmount;
    }
    c = mix(c, floor(clamp(c, 0.0, 1.0) * 48.0 + bayer(gl_FragCoord.xy)) / 48.0, 0.70);
    gl_FragColor = vec4(c, 1.0);
  }
`;

export function makeRenderer(canvas) {
  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0x0b1212);
  const resolution = { value: new Vector2(1, 1) };
  const sprintCloud = { value: 0 };
  const headBlur = { value: new Vector2(0, 0) };
  const strips = { value: lights.map(l => new Vector4(lightX, l.z, l.power, l.warmth)) };
  const extraStrips = { value: extraLights.map(l => new Vector4(l.x, l.z, l.defaultOn ? l.power : 0, l.warmth)) };
  const doorOpenings = {
    value: [
      ...rooms.map(r => new Vector4(
        r.side === 0 ? r.x1 : r.side * hall.halfWidth,
        r.doorZ,
        0,
        (r.side === 0 ? (r.extraDoors?.[1]?.width ?? classroomDoorWidth) : classroomDoorWidth) / 2
      )),
      new Vector4(0, hall.far, 0, annexDoorWidth / 2),
      new Vector4(annex.sideExit.x, annex.sideExit.z, 0, annex.sideExit.width / 2),
      ...plazaLights.map(() => new Vector4(plaza.hallPortal.x, plaza.hallPortal.z, 0, plaza.hallPortal.width / 2))
    ]
  };
  const roomBounds = { value: rooms.map(r => new Vector4(r.x0, r.x1, r.z0, r.z1)) };
  const plazaPortal = { value: new Vector4(plaza.hallPortal.x, plaza.hallPortal.z, 0, plaza.hallPortal.width / 2) };
  const outerWindows = { value: hallWindows.map(w => new Vector3(w.side * hall.halfWidth, w.z, w.w / 2)) };
  const room = { value: new Vector4(hall.halfWidth, hall.height, hall.far, hall.near) };
  const ambientLevel = { value: 0.30 };
  const eerieTint = { value: 0.85 };
  const fogDensity = { value: 0.96 };
  const windowGlow = { value: 0.32 };
  const vignetteAmount = { value: 0.28 };
  const grainAmount = { value: 0.42 };
  const monsterLight = { value: 1.45 };
  const pupilLights = { value: [new Vector4(0, -99, 0, 0), new Vector4(0, -99, 0, 0)] };
  const time = { value: 0 };
  const hazardDanger = { value: 0 };
  const hazardChase = { value: 0 };
  const hazardGrip = { value: 0 };
  const hazardFear = { value: 0 };
  const hazardFade = { value: 0 };
  const hazardMotion = { value: 1 };
  const hazardBearing = { value: new Vector2(0, -1) };
  const hazardSide = { value: 0 };
  const target = new WebGLRenderTarget(1, 1, { minFilter: NearestFilter, magFilter: NearestFilter });
  const screen = new Scene(), screenCamera = new Camera();
  const quad = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({
    uniforms: {
      frame: { value: target.texture }, resolution, sprintCloud, headBlur,
      vignetteAmount, grainAmount, eerieTint, time,
      hazardDanger, hazardChase, hazardGrip, hazardFear, hazardFade, hazardMotion, hazardBearing, hazardSide
    },
    vertexShader: 'varying vec2 coord; void main() { coord = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: screenFragment, depthWrite: false, depthTest: false
  }));
  quad.frustumCulled = false;
  screen.add(quad);

  function material(texture, {
    emission = 0, floor = false, repeat, window = false, lampIndex = -1, monster = false,
    shininess = 0, opacity = 1, alphaTexture = false, emissiveMap = null, emissivePower = 1,
    skybox = false
  } = {}) {
    const defines = {
      LAMP_COUNT: lights.length,
      EXTRA_LAMP_COUNT: extraLights.length,
      DOOR_COUNT: doorOpenings.value.length,
      ROOM_COUNT: rooms.length,
      WINDOW_COUNT: hallWindows.length,
      PAIRED_FIXTURE_OFFSET: pairedFixtureOffset.toFixed(3),
      ANNEX_HEIGHT: annex.height.toFixed(3),
      ANNEX_SIDE_X: annex.sideExit.x.toFixed(3),
      ANNEX_SIDE_Z: annex.sideExit.z.toFixed(3),
      ANNEX_SIDE_HALF_W: (annex.sideExit.width / 2).toFixed(3),
      PLAZA_LAMP_Y: '3.490'
    };
    if (alphaTexture) defines.ALPHA_TEXTURE = 1;
    if (skybox) defines.SKYBOX = 1;
    const isFloor = Boolean(floor && !skybox);
    const uniforms = {
      strips, extraStrips, doorOpenings, roomBounds, plazaPortal, outerWindows, room, benchCenter: { value: benchZ },
      surfaceMap: { value: texture }, selfLight: { value: emission }, tileFloor: { value: Number(isFloor) },
      shininess: { value: shininess }, opacity: { value: opacity },
      ambientLevel, eerieTint, fogDensity, windowGlow, monsterLight, pupilLights, time,
      isWindow: { value: Number(window) }, lampIndex: { value: lampIndex }, isMonster: { value: Number(monster) }
    };
    if (emissiveMap) {
      defines.EMISSIVE_MAP = 1;
      uniforms.emissiveMap = { value: emissiveMap };
      uniforms.emissivePower = { value: emissivePower };
    }
    const m = new ShaderMaterial({
      vertexColors: true,
      transparent: opacity < 1 || alphaTexture,
      depthWrite: opacity >= 1 && !alphaTexture,
      ...(skybox ? { side: BackSide } : {}),
      defines,
      uniforms,
      vertexShader: worldVertex, fragmentShader: worldFragment
    });
    m.userData.repeatMeters = repeat;
    return m;
  }

  function resize(camera) {
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    const scale = Math.min(1, 432 / h, 1100 / w);
    const rw = Math.max(1, Math.round(w * scale)), rh = Math.max(1, Math.round(h * scale));
    renderer.setSize(rw, rh, false);
    target.setSize(rw, rh);
    resolution.value.set(rw, rh);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function draw(scene, camera, screenFx = null) {
    const fx = camera.userData?.postFx;
    sprintCloud.value = fx ? fx.sprintCloud : 0;
    if (fx) headBlur.value.set(fx.headBlurX, fx.headBlurY);
    else headBlur.value.set(0, 0);
    // No caller-provided state means no residual screen effect. This is also
    // the path used by pause and inspection frames.
    hazardDanger.value = screenFx?.danger || 0;
    hazardChase.value = screenFx?.chase || 0;
    hazardGrip.value = screenFx?.grip || 0;
    hazardFear.value = screenFx?.fear || 0;
    hazardFade.value = screenFx?.fade || 0;
    hazardMotion.value = screenFx?.motion ?? 1;
    hazardBearing.value.set(screenFx?.bearingX ?? 0, screenFx?.bearingY ?? -1);
    hazardSide.value = screenFx?.side || 0;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(screen, screenCamera);
  }
  const environment = {
    strips, extraStrips, doorOpenings, ambientLevel, eerieTint, fogDensity, windowGlow, vignetteAmount, grainAmount, monsterLight, pupilLights, time
  };
  return { material, resize, draw, environment };
}
