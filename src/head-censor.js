import {
  Camera, Color, LinearFilter, LinearMipmapLinearFilter, Mesh, NearestFilter,
  PlaneGeometry, Scene, ShaderMaterial, Sphere, Vector2, Vector3, WebGLRenderTarget
} from 'three';

// A tracked photographic blur. The matte comes from the animated head's real
// silhouette, then feathers past the outline so even the hair edge is softened.
export function createHeadCensor(frame) {
  const matte = new WebGLRenderTarget(1, 1, {
    minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, generateMipmaps: true
  });
  const filtered = new WebGLRenderTarget(1, 1, {
    minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false
  });
  const resolution = { value: new Vector2() }, clipRange = { value: new Vector2() };
  const sceneDepth = { value: frame.depthTexture };
  const depthFunction = `
    uniform vec2 clipRange;
    float viewDepth(float d) {
      return clipRange.x * clipRange.y / (clipRange.y - d * (clipRange.y - clipRange.x));
    }`;
  const matteScene = new Scene();
  matteScene.background = new Color(0, 0, 0);
  const maskMaterial = new ShaderMaterial({
    uniforms: { sceneDepth, resolution, clipRange },
    vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `
      uniform sampler2D sceneDepth;
      uniform vec2 resolution;
      ${depthFunction}
      void main() {
        float sceneZ = viewDepth(texture2D(sceneDepth, gl_FragCoord.xy / resolution).r);
        // Red marks visible head pixels. Green also includes parts hidden
        // behind hands, props or walls, which must stay sharp in the edit.
        gl_FragColor = vec4(step(viewDepth(gl_FragCoord.z), sceneZ + .0015), 1., 0., 1.);
      }`
  });
  const shells = [];
  const editScene = new Scene(), editCamera = new Camera();
  const radius = { value: 1 }, feather = { value: 1 }, frontDepth = { value: 0 };
  const quad = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({
    uniforms: { image: { value: frame.texture }, matte: { value: matte.texture }, sceneDepth,
      resolution, clipRange, radius, feather, frontDepth },
    depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 uvImage; void main(){ uvImage = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: `
      uniform sampler2D image, matte, sceneDepth;
      uniform vec2 resolution;
      uniform float radius, feather, frontDepth;
      varying vec2 uvImage;
      ${depthFunction}
      void main() {
        vec4 original = textureLod(image, uvImage, 0.);
        gl_FragColor = original;
        float lodMask = log2(feather);
        vec2 spread = vec2(feather * .48) / resolution;
        float coverage = textureLod(matte, uvImage, lodMask).r * .36;
        coverage += .16 * (textureLod(matte, uvImage + vec2(spread.x, 0.), lodMask).r
                         + textureLod(matte, uvImage - vec2(spread.x, 0.), lodMask).r
                         + textureLod(matte, uvImage + vec2(0., spread.y), lodMask).r
                         + textureLod(matte, uvImage - vec2(0., spread.y), lodMask).r);
        if (coverage < .012) return;
        vec2 raw = textureLod(matte, uvImage, 0.).rg;
        if (raw.g - raw.r > .5 || viewDepth(texture2D(sceneDepth, uvImage).r) < frontDepth) return;
        vec2 stepUV = radius * .72 / resolution;
        float lod = max(0., log2(radius * .75));
        vec3 color = vec3(0.);
        for (int y = -2; y <= 2; y++) {
          for (int x = -2; x <= 2; x++) {
            vec2 delta = vec2(float(x), float(y));
            color += exp(-.5 * dot(delta, delta)) * textureLod(image, uvImage + delta * stepUV, lod).rgb;
          }
        }
        gl_FragColor.rgb = mix(original.rgb, color / 6.16892, smoothstep(.012, .42, coverage));
      }`
  }));
  quad.frustumCulled = false;
  editScene.add(quad);
  const bounds = new Sphere(), partBounds = new Sphere(), center = new Vector3();

  function apply(renderer, camera, head) {
    if (!head?.length) return frame.texture;
    bounds.makeEmpty();
    for (const part of head) {
      if (!part.geometry.boundingSphere) part.geometry.computeBoundingSphere();
      bounds.union(partBounds.copy(part.geometry.boundingSphere).applyMatrix4(part.matrixWorld));
    }
    center.copy(bounds.center).applyMatrix4(camera.matrixWorldInverse);
    const depth = -center.z;
    if (depth + bounds.radius < camera.near || depth - bounds.radius > camera.far) return frame.texture;
    const pixelRadius = bounds.radius * camera.projectionMatrix.elements[5] * frame.height / (2 * Math.max(camera.near, depth));
    center.applyMatrix4(camera.projectionMatrix);
    if (Math.abs(center.x) > 1 + 2.6 * pixelRadius / frame.width ||
        Math.abs(center.y) > 1 + 2.6 * pixelRadius / frame.height) return frame.texture;

    resolution.value.set(frame.width, frame.height);
    clipRange.value.set(camera.near, camera.far);
    frontDepth.value = Math.max(0, depth - bounds.radius - .01);
    radius.value = Math.max(1.5, pixelRadius * .135);
    feather.value = Math.max(2., pixelRadius * .22);
    matte.setSize(frame.width, frame.height);
    filtered.setSize(frame.width, frame.height);
    head.forEach((part, i) => {
      if (!shells[i]) {
        const shell = new Mesh(part.geometry, maskMaterial);
        shell.matrixAutoUpdate = false;
        shells.push(shell);
        matteScene.add(shell);
      }
      shells[i].geometry = part.geometry;
      shells[i].matrix.copy(part.matrixWorld);
      shells[i].matrixWorldNeedsUpdate = true;
    });
    renderer.setRenderTarget(matte);
    renderer.render(matteScene, camera);
    renderer.setRenderTarget(filtered);
    renderer.render(editScene, editCamera);
    return filtered.texture;
  }
  return { apply };
}
