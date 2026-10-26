// look/three-look.js — a finished three.js look in a few calls.
//
//   import * as THREE from 'three';
//   import { createLook } from './kit/look/three-look.js';
//   const L = createLook(THREE);                       // binds the three.js namespace once
//   const look = L.applyLook(renderer, scene, camera, 'sunset', { quality });
//   scene.add(L.groundPlane('cobbles', 60));
//   L.scatter(scene, ['rock', 'bush', 'tree'], { x: 0, z: 0, w: 50, d: 50 }, { count: 40, avoid: [{ x: 0, z: 0, r: 6 }] });
//   const hero = new THREE.Mesh(geo, L.toonMaterial('#4C86FF')); L.outline(hero);
//   loop: look.render();                                // bloom when the tier allows it
//
// What applyLook sets up: a gradient sky dome (or a background colour indoors)
// with sun glow, clouds and stars; fog matched to the horizon; a hemisphere +
// directional key light with soft shadows (map size by tier) + an ambient fill;
// ACES tone mapping and exposure; optional local lights, drifting particles,
// and UnrealBloom on mid/high tiers (never on low or a software renderer).
//
// Quality (quality.js): low or software -> no post, no shadow maps, Lambert
// surfaces, 256 px textures, fewer particles. mid -> bloom, 1024 shadows.
// high -> bloom, 2048 shadows, 512 px textures.

import {
  PALETTES, palette as getPalette, PRESETS, PRESET_NAMES, PRESET_GROUNDS, getPreset, presetAtHour, blendPresets,
  scatterPoints, normalizeArea, vnoise, hash2, createRng, mixHex, shadeHex,
} from './core.js';
import { paintSurface, SURFACES, SURFACE_KINDS, resolveKind } from './surfaces.js';
import { isSoftwareRenderer, gpuName } from '../quality.js';

export { PALETTES, PRESETS, PRESET_NAMES, PRESET_GROUNDS, SURFACE_KINDS };

let THREE = null;
const defaults = { tier: null, software: null };

/** bind the three.js namespace (import * as THREE from 'three'); returns the API */
export function useThree(ns) {
  if (!ns || !ns.WebGLRenderer && !ns.Mesh) throw new Error('look: useThree() needs the three.js namespace');
  THREE = ns;
  return API;
}
/** same as useThree, reads better at the call site: const L = createLook(THREE) */
export function createLook(ns) { return useThree(ns); }
function T3() {
  if (!THREE) throw new Error('look: call createLook(THREE) (or useThree) first: import * as THREE from "three"');
  return THREE;
}

// ------------------------------------------------------------------ tiers
const SETTINGS = {
  low: { shadows: false, bloom: false, particles: 0.4 },
  mid: { shadows: true, bloom: true, particles: 0.7 },
  high: { shadows: true, bloom: true, particles: 1.0 },
};
/** what this look will do on this device */
export function tierInfo(quality, renderer) {
  let software = quality ? !!quality.software : null;
  if (software == null) {
    try { software = isSoftwareRenderer(gpuName(renderer)); } catch { software = false; }
  }
  const tier = (quality && quality.tier) || defaults.tier || (software ? 'low' : 'mid');
  const s = SETTINGS[tier] || SETTINGS.mid;
  const lowish = software || tier === 'low';
  return {
    tier, software,
    post: !lowish && s.bloom,
    shadows: !lowish && s.shadows,
    shadowSize: tier === 'high' ? 2048 : 1024,
    texSize: tier === 'high' && !software ? 512 : 256,
    particles: software ? 0.3 : s.particles,
    lambert: lowish,
  };
}
function currentTier(o = {}) {
  if (o.quality || o.tier) return tierInfo(o.quality || { tier: o.tier, software: false });
  return tierInfo(defaults.tier ? { tier: defaults.tier, software: !!defaults.software } : null);
}

// ------------------------------------------------------------------ small texture helpers (no DOM)
let _blobTex = null, _dotTex = null;
function radialTexture(size, fn) {
  const { DataTexture, RGBAFormat, LinearFilter } = T3();
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
    const [c, a] = fn(Math.min(1, r));
    const i = (y * size + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = c; d[i + 3] = a;
  }
  const t = new DataTexture(d, size, size, RGBAFormat);
  t.magFilter = t.minFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}
/** soft dark disc for blob/contact shadows */
function blobTexture() {
  return _blobTex || (_blobTex = radialTexture(64, (r) => [0, Math.round(255 * Math.pow(Math.max(0, 1 - r), 1.6))]));
}
/** soft white dot for particles and glows */
function dotTexture() {
  return _dotTex || (_dotTex = radialTexture(64, (r) => [255, Math.round(255 * Math.pow(Math.max(0, 1 - r), 2.2))]));
}

// ------------------------------------------------------------------ sky dome
const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always on the far plane
}`;
const SKY_FRAG = /* glsl */`
uniform vec3 uTop, uHorizon, uBottom, uSun, uGlow, uSunDir, uCloud, uNebula;
uniform float uSunSize, uGlowAmt, uStars, uClouds, uTime, uCaustics, uHaze;
varying vec3 vDir;
#include <fog_pars_fragment>
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 col = y > 0.0 ? mix(uHorizon, uTop, pow(smoothstep(0.0, 0.48, y), 0.8))
                     : mix(uHorizon, uBottom, smoothstep(0.0, -0.3, y));
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  col += uGlow * uGlowAmt * (pow(s, 5.0) * 0.5 + pow(s, 40.0) * 0.7) * (0.6 + 0.4 * smoothstep(0.5, -0.05, y));
  if (uClouds > 0.0) {
    vec2 cp = d.xz / max(y + 0.18, 0.08) * 1.25 + vec2(uTime * 0.012, uTime * 0.004);
    float n = vn(cp * 1.2) * 0.55 + vn(cp * 2.9 + 3.1) * 0.3 + vn(cp * 7.3 + 1.7) * 0.15;
    float cl = smoothstep(0.5, 0.78, n) * smoothstep(0.015, 0.22, y) * uClouds;
    vec3 cc = mix(uCloud, uHorizon, 0.2) + uGlow * uGlowAmt * pow(s, 3.0) * 0.35;
    cc *= 0.85 + 0.25 * smoothstep(0.5, 0.9, n); // brighter tops
    col = mix(col, cc, cl * 0.9);
  }
  float disc = smoothstep(1.0 - 0.0011 * uSunSize, 1.0 - 0.0007 * uSunSize, s);
  col = mix(col, uSun * 1.5, disc);
  if (uStars > 0.0) {
    vec3 p = d * 260.0; vec3 cell = floor(p); float h = h3(cell);
    vec3 o = vec3(h3(cell + 1.3), h3(cell + 2.1), h3(cell + 3.7)) - 0.5;
    float dist = length(fract(p) - 0.5 - o * 0.6);
    float tw = 0.6 + 0.4 * sin(uTime * (1.5 + h * 3.0) + h * 60.0);
    float st = step(0.972, h) * smoothstep(0.13, 0.0, dist) * tw * (0.5 + 0.5 * h3(cell + 5.0));
    col += vec3(1.0, 0.95, 0.88) * st * uStars * smoothstep(-0.05, 0.2, y) * 1.6;
  }
  if (uNebula.r + uNebula.g + uNebula.b > 0.0) {
    float band = exp(-pow(dot(d, normalize(vec3(0.25, 0.9, 0.35))) * 2.4, 2.0));
    float n = vn(d.xy * 3.0 + d.z * 2.0) * 0.6 + vn(d.yz * 7.0 + 2.0) * 0.4;
    col += uNebula * band * smoothstep(0.35, 0.9, n) * 1.2;
  }
  if (uCaustics > 0.0) {
    // underwater: rippling light shafts from the surface above
    float a = atan(d.x, d.z);
    float rays = vn(vec2(a * 9.0, uTime * 0.35)) * smoothstep(0.0, 0.9, y);
    col += uGlow * rays * 0.25 * uCaustics;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef USE_FOG
    // haze: at the horizon the sky is exactly the fog colour (same space three uses
    // for fogged objects), so far ground melts into the sky with no seam
    gl_FragColor.rgb = mix(fogColor, gl_FragColor.rgb, smoothstep(-0.01, uHaze, y));
  #endif
}`;

function makeSky() {
  const { Mesh, SphereGeometry, ShaderMaterial, BackSide, Color, Vector3, UniformsUtils, UniformsLib } = T3();
  const U = {
    ...UniformsUtils.clone(UniformsLib.fog), uHaze: { value: 0.09 },
    uTop: { value: new Color() }, uHorizon: { value: new Color() }, uBottom: { value: new Color() },
    uSun: { value: new Color() }, uGlow: { value: new Color() }, uSunDir: { value: new Vector3(0, 1, 0) },
    uCloud: { value: new Color(1, 1, 1) }, uNebula: { value: new Color(0, 0, 0) },
    uSunSize: { value: 1 }, uGlowAmt: { value: 0.5 }, uStars: { value: 0 }, uClouds: { value: 0 }, uTime: { value: 0 }, uCaustics: { value: 0 },
  };
  const sky = new Mesh(new SphereGeometry(10, 32, 16), new ShaderMaterial({
    uniforms: U, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: BackSide, depthWrite: false, fog: true,
  }));
  sky.name = 'look:sky';
  sky.frustumCulled = false;
  // drawn after the opaque scene: it sits on the far plane, so the depth test skips
  // every pixel already covered (only visible sky gets shaded)
  sky.renderOrder = 1e6;
  sky.onBeforeRender = (_r, _s, cam) => { sky.position.copy(cam.position); sky.updateMatrixWorld(); };
  sky.raycast = () => {};
  return { sky, U };
}
function setSky(U, cfg, cheap = false) {
  const s = cfg.sky;
  U.uTop.value.set(s.top); U.uHorizon.value.set(s.horizon); U.uBottom.value.set(s.bottom);
  U.uSun.value.set(s.sun || '#FFFFFF'); U.uGlow.value.set(s.glow || s.horizon);
  U.uCloud.value.set(s.cloudColor || '#FFFFFF');
  U.uNebula.value.set(s.nebula || '#000000');
  const d = s.sunDir || cfg.key.dir;
  U.uSunDir.value.set(d[0], d[1], d[2]).normalize();
  U.uSunSize.value = s.sunSize ?? 1; U.uGlowAmt.value = s.glowAmt ?? 0.4;
  // cheap (low tier / software): no per-pixel cloud or caustic noise in the sky
  U.uStars.value = s.stars || 0; U.uClouds.value = cheap ? 0 : s.clouds || 0; U.uCaustics.value = cheap ? 0 : s.caustics || 0;
  U.uHaze.value = s.haze ?? 0.09;
}

/**
 * The sky and fog only (no lights): a gradient dome (or background colour) and FogExp2 matched to the horizon.
 * @returns {{ sky, fog, apply(cfg), setFog(density, color?), update(dt), dispose() }}
 */
export function skyAndFog(scene, preset = 'day', o = {}) {
  const { FogExp2, Color } = T3();
  let cfg = typeof preset === 'object' && preset.sky ? preset : getPreset(preset, o.overrides);
  const { sky, U } = makeSky();
  scene.add(sky);
  scene.fog = new FogExp2(new Color(cfg.fog.color), cfg.fog.density);
  const h = {
    sky, fog: scene.fog, uniforms: U,
    get config() { return cfg; },
    apply(next) {
      cfg = next;
      setSky(U, cfg, o.cheap ?? currentTier(o).lambert);
      const dome = cfg.sky.mode === 'dome';
      sky.visible = dome;
      scene.background = dome ? null : new Color(cfg.sky.horizon);
      if (!scene.fog) scene.fog = new FogExp2(new Color(), 0);
      scene.fog.color.set(cfg.fog.color);
      scene.fog.density = cfg.fog.density;
      h.fog = scene.fog;
    },
    setFog(density, color) {
      if (density && typeof density === 'object') ({ density, color } = density);
      if (!scene.fog) scene.fog = new FogExp2(new Color(cfg.fog.color), 0);
      if (Number.isFinite(density)) { scene.fog.density = density; cfg.fog.density = density; }
      if (color) { scene.fog.color.set(color); cfg.fog.color = typeof color === 'string' ? color : cfg.fog.color; }
    },
    update(dt = 0) { U.uTime.value += dt; },
    dispose() { scene.remove(sky); sky.geometry.dispose(); sky.material.dispose(); if (scene.fog === h.fog) scene.fog = null; },
  };
  h.apply(cfg);
  return h;
}

// ------------------------------------------------------------------ post (lazy, vendored addons)
let _post = null;
function loadPost() {
  if (!_post) {
    _post = Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'),
      import('three/addons/postprocessing/OutputPass.js'),
      import('three/addons/postprocessing/ShaderPass.js'),
    ]).then(([a, b, c, d, e]) => ({ EffectComposer: a.EffectComposer, RenderPass: b.RenderPass, UnrealBloomPass: c.UnrealBloomPass, OutputPass: d.OutputPass, ShaderPass: e.ShaderPass }))
      .catch((e) => { console.warn('look: bloom disabled (could not load three/addons postprocessing):', e && e.message); return null; });
  }
  return _post;
}

// ------------------------------------------------------------------ applyLook
/**
 * Give a scene a finished look.
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @param {string|object} [preset='day']  one of PRESET_NAMES, or a config (see core.getPreset)
 * @param {object} [o]
 * @param {object} [o.quality]   createQuality() result (tier + software detection)
 * @param {object} [o.overrides] deep-merged into the preset ({ fog: { density: 0.03 } })
 * @param {number} [o.shadowArea=30] half-size of the shadow frustum around the focus (world units)
 * @param {boolean} [o.bloom=true]  allow bloom (still only on mid/high, never software)
 * @param {boolean} [o.particles=true] allow the preset's particles
 * @param {object} [o.post] { EffectComposer, RenderPass, UnrealBloomPass, OutputPass } to skip the lazy import
 * @returns look handle: render(cam?), update(dt), setFocus(v, yaw?), setTimeOfDay(h), setFog(d, c),
 *   setPreset(p, overrides), setExposure(e), setBloom(on|opts), stats(), dispose(), and the objects.
 */
export function applyLook(renderer, scene, camera, preset = 'day', o = {}) {
  if (o.THREE) useThree(o.THREE);
  const X = T3();
  const { HemisphereLight, DirectionalLight, AmbientLight, PointLight, Vector3, Vector2, Color, PCFSoftShadowMap, ACESFilmicToneMapping, SRGBColorSpace } = X;
  const info = tierInfo(o.quality, renderer);
  defaults.tier = info.tier; defaults.software = info.software;
  let cfg = typeof preset === 'object' && preset.sky ? preset : getPreset(preset, o.overrides);

  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = cfg.exposure;
  if (renderer.shadowMap) {
    renderer.shadowMap.enabled = info.shadows;
    renderer.shadowMap.type = PCFSoftShadowMap;
  }

  const env = skyAndFog(scene, cfg, { cheap: info.lambert });
  const group = new X.Group();
  group.name = 'look:lights';
  scene.add(group);

  const hemi = new HemisphereLight(0xffffff, 0x444444, 1);
  const key = new DirectionalLight(0xffffff, 1);
  const ambient = new AmbientLight(0xffffff, 0.1);
  group.add(hemi, key, key.target, ambient);
  const area = o.shadowArea ?? 30;
  key.castShadow = info.shadows;
  key.shadow.mapSize.set(info.shadowSize, info.shadowSize);
  Object.assign(key.shadow.camera, { left: -area, right: area, top: area, bottom: -area, near: 0.5, far: area * 6 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.035;

  const focus = new Vector3();
  let focusYaw = 0;          // the player's facing: 'focus' lights keep their offset in front of it
  let points = [];
  let particles = null;
  let t = 0, lastNow = null, ticked = false;
  const lastFrame = { calls: 0, triangles: 0 };

  function buildPoints() {
    for (const p of points) { group.remove(p.light); p.light.dispose?.(); }
    points = (cfg.points || []).map((p) => {
      const light = new PointLight(new Color(p.color), p.intensity, p.distance ?? 20, 2);
      light.castShadow = false;
      group.add(light);
      return { cfg: p, light, base: p.intensity, seed: Math.random() * 100 };
    });
    placePoints();
  }
  function placePoints() {
    for (const p of points) {
      const [x, y, z] = p.cfg.pos || [0, 3, 0];
      if (p.cfg.follow === 'focus') {
        // the offset is in the player's frame (+Z = in front at yaw 0, the ctrl3d convention): turn it with the facing
        const c = Math.cos(focusYaw), s = Math.sin(focusYaw);
        p.light.position.set(focus.x + x * c + z * s, focus.y + y, focus.z - x * s + z * c);
      } else p.light.position.set(x, y, z);
    }
  }
  function buildParticles() {
    if (particles) { scene.remove(particles.points); particles.points.geometry.dispose(); particles.points.material.dispose(); particles = null; }
    const pc = cfg.particles;
    if (!pc || o.particles === false) return;
    const n = Math.max(0, Math.round(pc.count * info.particles));
    if (!n) return;
    const { BufferGeometry, BufferAttribute, Points, PointsMaterial, AdditiveBlending, NormalBlending } = X;
    const rng = createRng('look-particles');
    const pos = new Float32Array(n * 3), seeds = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rng.next() - 0.5) * pc.area; pos[i * 3 + 1] = rng.next() * pc.height; pos[i * 3 + 2] = (rng.next() - 0.5) * pc.area;
      seeds[i] = rng.next() * 100;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    const m = new PointsMaterial({
      color: new Color(pc.color), size: pc.size, map: dotTexture(), transparent: true, depthWrite: false,
      blending: pc.additive ? AdditiveBlending : NormalBlending, sizeAttenuation: true, opacity: 0.85, fog: true,
    });
    const pts = new Points(g, m);
    pts.name = 'look:particles';
    pts.frustumCulled = false;
    pts.raycast = () => {};
    scene.add(pts);
    particles = { points: pts, base: pos.slice(), seeds, cfg: pc };
  }

  function applyCfg(next) {
    cfg = next;
    env.apply(cfg);
    hemi.color.set(cfg.hemi.sky); hemi.groundColor.set(cfg.hemi.ground); hemi.intensity = cfg.hemi.intensity;
    key.color.set(cfg.key.color); key.intensity = cfg.key.intensity;
    ambient.color.set(cfg.ambient.color); ambient.intensity = cfg.ambient.intensity;
    renderer.toneMappingExposure = cfg.exposure;
    placeKey();
    if (bloom && cfg.bloom) { bloom.strength = cfg.bloom.strength; bloom.radius = cfg.bloom.radius; bloom.threshold = cfg.bloom.threshold; }
    setGrade();
  }
  function placeKey() {
    const d = cfg.key.dir;
    key.position.set(focus.x + d[0] * area * 2.5, focus.y + d[1] * area * 2.5, focus.z + d[2] * area * 2.5);
    key.target.position.copy(focus);
    key.target.updateMatrixWorld();
  }

  // ---------------- bloom
  let composer = null, bloom = null, renderPass = null, postWanted = info.post && o.bloom !== false && !!cfg.bloom;
  const size = new Vector2();
  let lastW = 0, lastH = 0, lastDpr = 0;
  let grade = null;
  function setGrade() {
    if (!grade) return;
    const g = { vignette: 0.28, saturation: 1.08, contrast: 1.04, ...(cfg.grade || {}) };
    grade.uniforms.uVignette.value = g.vignette; grade.uniforms.uSat.value = g.saturation; grade.uniforms.uContrast.value = g.contrast;
  }
  function initPost(mods) {
    if (!mods || composer) return;
    const { EffectComposer, RenderPass, UnrealBloomPass, OutputPass, ShaderPass } = mods;
    renderer.getSize(size);
    composer = new EffectComposer(renderer, new X.WebGLRenderTarget(2, 2, { type: X.HalfFloatType }));
    renderPass = new RenderPass(scene, camera);
    bloom = new UnrealBloomPass(new Vector2(Math.max(2, size.x), Math.max(2, size.y)), cfg.bloom.strength, cfg.bloom.radius, cfg.bloom.threshold);
    composer.addPass(renderPass);
    composer.addPass(bloom);
    if (ShaderPass) {
      // grade: a gentle saturation/contrast lift and a vignette (linear, before tone mapping)
      grade = new ShaderPass({
        uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.28 }, uSat: { value: 1.08 }, uContrast: { value: 1.04 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */`
          uniform sampler2D tDiffuse; uniform float uVignette, uSat, uContrast; varying vec2 vUv;
          void main(){
            vec4 c = texture2D(tDiffuse, vUv);
            vec3 col = c.rgb;
            float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
            col = mix(vec3(l), col, uSat);
            col = max((col - 0.18) * uContrast + 0.18, 0.0);
            vec2 q = vUv - 0.5;
            float v = smoothstep(0.82, 0.18, length(q * vec2(1.0, 0.92)));
            col *= mix(1.0 - uVignette, 1.0, v);
            gl_FragColor = vec4(col, c.a);
          }`,
      });
      composer.addPass(grade);
      setGrade();
    }
    composer.addPass(new OutputPass());
    syncSize(true);
  }
  function syncSize(force) {
    if (!composer) return;
    renderer.getSize(size);
    const dpr = renderer.getPixelRatio();
    if (force || size.x !== lastW || size.y !== lastH || dpr !== lastDpr) {
      lastW = size.x; lastH = size.y; lastDpr = dpr;
      composer.setPixelRatio(dpr);
      composer.setSize(Math.max(2, size.x), Math.max(2, size.y));
    }
  }
  const ready = postWanted
    ? (o.post ? Promise.resolve(o.post) : loadPost()).then((m) => { if (m && postWanted) initPost(m); return !!composer; })
    : Promise.resolve(false);

  // ---------------- quality changes (the auto downgrade)
  let offQuality = null;
  if (o.quality && typeof o.quality.onChange === 'function') {
    offQuality = o.quality.onChange(() => {
      const ni = tierInfo(o.quality, renderer);
      defaults.tier = ni.tier;
      postWanted = ni.post && o.bloom !== false && !!cfg.bloom;
      if (renderer.shadowMap && renderer.shadowMap.enabled !== ni.shadows) {
        renderer.shadowMap.enabled = ni.shadows;
        key.castShadow = ni.shadows;
        scene.traverse((ob) => { if (ob.material) [].concat(ob.material).forEach((m) => { m.needsUpdate = true; }); });
      }
      if (ni.shadows) key.shadow.mapSize.set(ni.shadowSize, ni.shadowSize);
      Object.assign(info, ni);
    });
  }

  function tick(dt) {
    t += dt;
    env.update(dt);
    for (const p of points) {
      if (p.cfg.flicker) {
        const f = vnoise(t * 9 + p.seed, p.seed) * 0.6 + vnoise(t * 23 + p.seed, p.seed + 3) * 0.4;
        p.light.intensity = p.base * (1 + (f - 0.5) * 2 * p.cfg.flicker);
      }
    }
    if (particles) {
      const a = particles.points.geometry.attributes.position, b = particles.base, pc = particles.cfg, s = particles.seeds;
      for (let i = 0; i < s.length; i++) {
        const k = i * 3;
        const y = ((b[k + 1] + t * pc.rise * (0.6 + (s[i] % 1) * 0.8)) % pc.height + pc.height) % pc.height;
        a.array[k] = focus.x + b[k] + Math.sin(t * 0.6 + s[i]) * 0.35;
        a.array[k + 1] = focus.y + y;
        a.array[k + 2] = focus.z + b[k + 2] + Math.cos(t * 0.5 + s[i] * 1.3) * 0.35;
      }
      a.needsUpdate = true;
    }
  }

  const look = {
    get config() { return cfg; },
    get tier() { return info.tier; },
    get software() { return info.software; },
    /** true while bloom post-processing is active */
    get post() { return !!(composer && postWanted); },
    info, scene, camera, renderer, hemi, key, ambient, group,
    get sky() { return env.sky; },
    get fog() { return scene.fog; },
    get points() { return points.map((p) => p.light); },
    get particles() { return particles && particles.points; },
    get composer() { return composer; },
    get bloomPass() { return bloom; },
    /** resolves true once bloom is ready (false when this tier has none) */
    ready,
    /** advance flicker, particles, clouds and stars (render() calls it when you do not) */
    update(dt = 1 / 60) { ticked = true; tick(dt); },
    /** draw a frame (composer with bloom when active, else a plain render) */
    render(cam = camera) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (!ticked) tick(lastNow == null ? 0 : Math.min(0.1, (now - lastNow) / 1000));
      ticked = false; lastNow = now;
      // several looks may share one renderer: re-assert ours
      renderer.toneMapping = ACESFilmicToneMapping;
      renderer.toneMappingExposure = cfg.exposure;
      const inf = renderer.info, auto = inf && inf.autoReset;
      if (inf) { inf.autoReset = false; inf.reset?.(); }
      if (composer && postWanted) {
        syncSize(false);
        renderPass.camera = cam;
        composer.render();
      } else renderer.render(scene, cam);
      if (inf) { lastFrame.calls = inf.render?.calls ?? 0; lastFrame.triangles = inf.render?.triangles ?? 0; inf.autoReset = auto; }
    },
    /** call when the canvas size changes (render() also notices on its own) */
    resize(w, h) { if (w && h) renderer.setSize(w, h, false); syncSize(true); },
    /**
     * centre the shadow frustum, the focus-following lights and the particles on the player.
     * yaw (radians, yaw 0 faces +Z): the facing, so a carried light (the dungeon-torch preset)
     * stays in front of the player; left out, v.yaw is used when v has one (a controller state).
     *   look.setFocus(hero.state);                 // x, y, z and yaw
     *   look.setFocus(camera.position, eye.yaw);   // explicit facing
     */
    setFocus(v, yaw) {
      focus.set(v.x || 0, v.y || 0, v.z || 0);
      const f = Number.isFinite(yaw) ? yaw : Number.isFinite(v.yaw) ? v.yaw : null;
      if (f !== null) focusYaw = f;
      placeKey(); placePoints();
    },
    /** outdoor cycle: hour 0..24 blends night, sunset and day; the key light follows the sun/moon */
    setTimeOfDay(hour, overrides) {
      const next = presetAtHour(hour, overrides);
      next.points = cfg.points; next.particles = cfg.particles;
      applyCfg(next);
      return cfg;
    },
    /** fog density (0 turns it off) and optional colour */
    setFog(density, color) { env.setFog(density, color); },
    /** switch preset (instant, or blended when { blend: 0..1 } from the current one) */
    setPreset(p, overrides, { blend } = {}) {
      const next = typeof p === 'object' && p.sky ? p : getPreset(p, overrides);
      applyCfg(Number.isFinite(blend) ? blendPresets(cfg, next, blend) : next);
      buildPoints(); buildParticles();
      postWanted = info.post && o.bloom !== false && !!cfg.bloom;
      if (postWanted && !composer) (o.post ? Promise.resolve(o.post) : loadPost()).then(initPost);
      return cfg;
    },
    setExposure(e) { cfg.exposure = e; renderer.toneMappingExposure = e; },
    /** bloom on/off, or tweak { strength, radius, threshold } */
    setBloom(v) {
      if (typeof v === 'object' && v) { cfg.bloom = { ...(cfg.bloom || {}), ...v }; if (bloom) Object.assign(bloom, v); postWanted = info.post; }
      else postWanted = !!v && info.post;
      if (postWanted && !composer) (o.post ? Promise.resolve(o.post) : loadPost()).then(initPost);
    },
    /** the last frame's draw calls (shadow and bloom passes included) plus what the look is doing */
    stats() {
      return { calls: lastFrame.calls, triangles: lastFrame.triangles, tier: info.tier, software: info.software, post: look.post, shadows: !!renderer.shadowMap?.enabled, points: points.length, particles: particles ? particles.seeds.length : 0 };
    },
    dispose() {
      offQuality?.();
      env.dispose();
      scene.remove(group);
      if (particles) { scene.remove(particles.points); particles.points.geometry.dispose(); particles.points.material.dispose(); }
      key.shadow.map?.dispose();
      composer?.dispose?.();
    },
  };
  applyCfg(cfg);
  buildPoints();
  buildParticles();
  return look;
}

// ------------------------------------------------------------------ toon + outline
const _gradients = new Map();
function gradientMap(steps) {
  steps = Math.max(2, Math.min(8, steps | 0));
  if (_gradients.has(steps)) return _gradients.get(steps);
  const { DataTexture, RGBAFormat, NearestFilter } = T3();
  const d = new Uint8Array(steps * 4);
  for (let i = 0; i < steps; i++) {
    // shadows stay readable: the darkest band is ~40 % of full light, not black
    const v = Math.round(255 * (0.4 + 0.6 * Math.pow(i / (steps - 1), 0.9)));
    d.set([v, v, v, 255], i * 4);
  }
  const t = new DataTexture(d, steps, 1, RGBAFormat);
  t.minFilter = t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  _gradients.set(steps, t);
  return t;
}

/**
 * Stylised cel material: banded light (gradient map) plus a soft rim light.
 * @param {string|number} color
 * @param {object} [o] { steps=3, rim=0.35, rimColor='#FFFFFF', map, emissive, emissiveIntensity, vertexColors, flat }
 */
export function toonMaterial(color = '#4C86FF', o = {}) {
  const { MeshToonMaterial, Color } = T3();
  const m = new MeshToonMaterial({
    color: new Color(color), gradientMap: gradientMap(o.steps ?? 3), map: o.map || null,
    emissive: new Color(o.emissive || '#000000'), emissiveIntensity: o.emissiveIntensity ?? 1,
    vertexColors: !!o.vertexColors, transparent: !!o.transparent, opacity: o.opacity ?? 1,
  });
  if (o.side != null) m.side = o.side;
  const rim = o.rim ?? 0.35;
  if (rim > 0) {
    const uRim = { value: rim }, uRimColor = { value: new Color(o.rimColor || '#FFFFFF') };
    m.userData.rim = uRim; m.userData.rimColor = uRimColor;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uRim = uRim; sh.uniforms.uRimColor = uRimColor;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uRim;\nuniform vec3 uRimColor;')
        .replace('#include <opaque_fragment>', `
          float bdFacing = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
          float bdRim = smoothstep(0.62, 0.8, 1.0 - bdFacing);
          outgoingLight += uRimColor * bdRim * uRim * (0.35 + 0.65 * diffuseColor.rgb);
          #include <opaque_fragment>`);
    };
    m.customProgramCacheKey = () => 'bd-toon-rim';
  }
  return m;
}

const _outlineMats = new Map();
function outlineMaterial(color, thick) {
  const key = `${color}|${thick.toFixed(4)}`;
  if (_outlineMats.has(key)) return _outlineMats.get(key);
  const { MeshBasicMaterial, BackSide, Color } = T3();
  const m = new MeshBasicMaterial({ color: new Color(color), side: BackSide, fog: true });
  const uThick = { value: thick };
  m.userData.thickness = uThick;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uThick = uThick;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 outlineNormal;\nuniform float uThick;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(outlineNormal + vec3(1e-6)) * uThick;');
  };
  m.customProgramCacheKey = () => 'bd-outline';
  _outlineMats.set(key, m);
  return m;
}
/** smooth (position-welded) normals, so hard-edged boxes get a closed hull */
function ensureOutlineNormals(geo) {
  if (geo.attributes.outlineNormal) return;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const p = geo.attributes.position, n = geo.attributes.normal;
  const sums = new Map(), keys = new Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const k = `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
    keys[i] = k;
    const s = sums.get(k) || [0, 0, 0];
    s[0] += n.getX(i); s[1] += n.getY(i); s[2] += n.getZ(i);
    sums.set(k, s);
  }
  const out = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const s = sums.get(keys[i]); const l = Math.hypot(s[0], s[1], s[2]) || 1;
    out[i * 3] = s[0] / l; out[i * 3 + 1] = s[1] / l; out[i * 3 + 2] = s[2] / l;
  }
  geo.setAttribute('outlineNormal', new (T3().BufferAttribute)(out, 3));
}

/**
 * Inverted-hull outline: a back-face shell pushed out along welded normals.
 * Cheap (one extra draw per mesh, no post-processing); works for meshes,
 * InstancedMesh and SkinnedMesh; ignores raycasts.
 * @param {THREE.Object3D} object
 * @param {object} [o] { thickness=0.03 (world units), color='#151021' }
 * @returns {{ meshes: THREE.Mesh[], remove(): void }}
 */
export function outline(object, { thickness = 0.03, color = '#151021' } = {}) {
  const X = T3();
  const made = [];
  const targets = [];
  object.traverse((m) => { if (m.isMesh && !m.userData.isOutline && !m.userData.noOutline) targets.push(m); });
  const ws = new X.Vector3();
  object.updateMatrixWorld(true);
  for (const m of targets) {
    ensureOutlineNormals(m.geometry);
    m.getWorldScale(ws);
    const s = (Math.abs(ws.x) + Math.abs(ws.y) + Math.abs(ws.z)) / 3 || 1;
    const mat = outlineMaterial(color, thickness / s);
    let o;
    if (m.isInstancedMesh) {
      o = new X.InstancedMesh(m.geometry, mat, m.count);
      o.instanceMatrix = m.instanceMatrix;
      o.onBeforeRender = () => { o.count = m.count; };
    } else if (m.isSkinnedMesh) {
      o = new X.SkinnedMesh(m.geometry, mat);
      o.bind(m.skeleton, m.bindMatrix);
      o.bindMode = m.bindMode;
    } else o = new X.Mesh(m.geometry, mat);
    o.userData.isOutline = true;
    o.castShadow = false; o.receiveShadow = false;
    o.raycast = () => {};
    o.frustumCulled = m.frustumCulled;
    o.renderOrder = m.renderOrder;
    o.name = `${m.name || 'mesh'}:outline`;
    m.add(o);
    made.push(o);
  }
  return { meshes: made, remove() { for (const o of made) o.parent?.remove(o); } };
}

// ------------------------------------------------------------------ surfaces
const _surfCache = new Map();
function makeImageSource(w, h, data) {
  const g = globalThis;
  let c = null;
  if (g.document && g.document.createElement) { c = g.document.createElement('canvas'); c.width = w; c.height = h; }
  else if (typeof g.OffscreenCanvas === 'function') c = new g.OffscreenCanvas(w, h);
  if (!c || !c.getContext) return null;
  const ctx = c.getContext('2d');
  if (!ctx || !ctx.createImageData) return null;
  const img = ctx.createImageData(w, h);
  img.data.set(data);
  ctx.putImageData(img, 0, 0);
  return c;
}
function baseTextures(kind, o) {
  const k = resolveKind(kind);
  if (!k) throw new Error(`look: unknown surface "${kind}" (have: ${SURFACE_KINDS.join(', ')})`);
  const size = o.size || currentTier(o).texSize;
  const keyObj = { k, size, palette: o.palette ?? null, seed: o.seed ?? 1, scale: o.scale ?? 1, lanes: o.lanes, lines: o.lines, center: o.center, flowers: o.flowers, checker: o.checker };
  const key = JSON.stringify(keyObj);
  if (_surfCache.has(key)) return _surfCache.get(key);
  const X = T3();
  const s = paintSurface(k, { ...o, size });
  const mk = (data, srgb) => {
    const src = makeImageSource(s.width, s.height, data);
    let t;
    if (src) t = new X.CanvasTexture(src);
    else { t = new X.DataTexture(data, s.width, s.height, X.RGBAFormat); t.flipY = false; t.userData.noCanvas = true; }
    t.wrapS = t.wrapT = X.RepeatWrapping;
    t.colorSpace = srgb ? X.SRGBColorSpace : X.NoColorSpace;
    t.generateMipmaps = true;
    t.minFilter = X.LinearMipmapLinearFilter;
    t.magFilter = X.LinearFilter;
    t.anisotropy = o.anisotropy ?? 8;
    t.needsUpdate = true;
    return t;
  };
  const entry = { s, map: mk(s.data, true), normal: s.normal ? mk(s.normal, false) : null };
  _surfCache.set(key, entry);
  return entry;
}
function withRepeat(t, repeat) {
  const c = t.clone(); // shares the image source (one GPU upload)
  const [rx, ry] = Array.isArray(repeat) ? repeat : [repeat ?? 1, repeat ?? 1];
  c.repeat.set(rx, ry);
  c.needsUpdate = true;
  return c;
}

/**
 * A tileable procedural surface as a CanvasTexture (sRGB, mipmapped, RepeatWrapping).
 * kinds: flagstones, cobbles, planks, grass, dirt (dirt-path), sand, asphalt (lanes, lines, center),
 * brick, tiles (checker), metal, wood, water, snow.
 * @param {object} [o] { palette, scale, seed, size, repeat=[1,1] | number, anisotropy }
 */
export function surfaceTexture(kind, o = {}) {
  return withRepeat(baseTextures(kind, o).map, o.repeat ?? 1);
}
/** the matching tangent-space normal map (null when disabled) */
export function surfaceNormalMap(kind, o = {}) {
  const b = baseTextures(kind, o);
  return b.normal ? withRepeat(b.normal, o.repeat ?? 1) : null;
}
/** world units one texture tile is designed to cover (flagstones 4 m, brick 2 m...) */
export function surfaceTile(kind) { return SURFACES[resolveKind(kind)]?.tile ?? 4; }

/**
 * A ready material for a surface: Standard with a normal map on mid/high,
 * Lambert on low/software, or toon ({ toon: true }).
 * @param {object} [o] { palette, seed, scale, size, repeat, quality, toon, normal=true, color, roughness, metalness, vertexColors }
 */
export function surfaceMaterial(kind, o = {}) {
  const X = T3();
  const info = currentTier(o);
  const b = baseTextures(kind, o);
  const map = withRepeat(b.map, o.repeat ?? 1);
  const color = new X.Color(o.color || '#FFFFFF');
  let m;
  if (o.toon) m = toonMaterial(color, { map, rim: o.rim ?? 0.15, steps: o.steps ?? 4, vertexColors: o.vertexColors });
  else if (info.lambert) m = new X.MeshLambertMaterial({ map, color, vertexColors: !!o.vertexColors });
  else {
    m = new X.MeshStandardMaterial({
      map, color, roughness: o.roughness ?? b.s.roughness, metalness: o.metalness ?? b.s.metalness, vertexColors: !!o.vertexColors,
    });
    if (o.normal !== false && b.normal) {
      m.normalMap = withRepeat(b.normal, o.repeat ?? 1);
      m.normalScale = new X.Vector2(0.9, 0.9);
    }
  }
  m.name = `surface:${resolveKind(kind)}`;
  m.userData.surface = resolveKind(kind);
  return m;
}

/**
 * A ground plane (XZ, facing up) with the surface tiled at its natural scale,
 * gentle large-scale colour variation (hides tiling) and shadows received.
 * Water planes drift their texture. size: number or [width, depth].
 */
export function groundPlane(kind = 'grass', size = 60, o = {}) {
  const X = T3();
  const [w, d] = Array.isArray(size) ? size : [size, size];
  const k = resolveKind(kind);
  const tile = o.tile ?? surfaceTile(k);
  const repeat = o.repeat ?? [w / tile, d / tile];
  const segs = Math.max(4, Math.min(64, Math.round(Math.max(w, d) / 2.5)));
  const geo = new X.PlaneGeometry(w, d, Math.max(1, Math.round(segs * w / Math.max(w, d))), Math.max(1, Math.round(segs * d / Math.max(w, d))));
  geo.rotateX(-Math.PI / 2);
  const vary = o.variation ?? (k === 'grass' || k === 'dirt' || k === 'sand' || k === 'snow' ? 0.24 : 0.14);
  const p = geo.attributes.position, col = new Float32Array(p.count * 3);
  const seed = (o.seed ?? 1) * 31;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + (o.x || 0), z = p.getZ(i) + (o.z || 0);
    const n = vnoise(x * 0.07, z * 0.07, seed) * 0.65 + vnoise(x * 0.21, z * 0.21, seed + 1) * 0.35;
    const c = 1 - vary * 0.5 + n * vary;
    col[i * 3] = c; col[i * 3 + 1] = c * (1 + (n - 0.5) * 0.04); col[i * 3 + 2] = c;
  }
  geo.setAttribute('color', new X.BufferAttribute(col, 3));
  const mat = o.material || surfaceMaterial(k, { ...o, repeat, vertexColors: true });
  const mesh = new X.Mesh(geo, mat);
  mesh.name = `ground:${k}`;
  mesh.receiveShadow = true;
  mesh.userData.look = { kind: k, tile };
  if (k === 'water') {
    const flow = o.flow ?? [0.012, 0.006];
    let last = null;
    mesh.onBeforeRender = () => {
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
      const dt = last == null ? 0 : Math.min(0.1, now - last); last = now;
      if (mat.map) { mat.map.offset.x += flow[0] * dt; mat.map.offset.y += flow[1] * dt; }
      if (mat.normalMap) { mat.normalMap.offset.x -= flow[1] * dt; mat.normalMap.offset.y += flow[0] * dt; }
    };
  }
  // horizon skirt: a much larger plane just behind the ground (polygon offset), so a
  // big ground never ends in a hard edge; fog melts it into the sky. Off for strips.
  if (o.horizon ?? Math.min(w, d) >= 30) {
    const k8 = o.horizonScale ?? 8;
    const sm = mat.clone();
    sm.vertexColors = false;
    if (mat.map) sm.map = withRepeat(mat.map, [mat.map.repeat.x * k8, mat.map.repeat.y * k8]);
    if (mat.normalMap) sm.normalMap = withRepeat(mat.normalMap, [mat.normalMap.repeat.x * k8, mat.normalMap.repeat.y * k8]);
    sm.color = (sm.color || new X.Color(1, 1, 1)).clone().multiplyScalar(1 - vary * 0.25);
    sm.polygonOffset = true; sm.polygonOffsetFactor = 2; sm.polygonOffsetUnits = 4;
    const skirt = new X.Mesh(new X.PlaneGeometry(w * k8, d * k8).rotateX(-Math.PI / 2), sm);
    skirt.name = `ground:${k}:horizon`;
    skirt.receiveShadow = true;
    skirt.raycast = () => {};
    skirt.renderOrder = 1; // after the ground, so the hidden part fails the depth test
    mesh.add(skirt);
  }
  if (o.position) mesh.position.set(o.position[0] || 0, o.position[1] || 0, o.position[2] || 0);
  return mesh;
}

// ------------------------------------------------------------------ geometry helpers
/** merge geometries (any mix of indexed / not) into one non-indexed geometry with position, normal, uv */
export function mergeGeometries(list) {
  const X = T3();
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o3 = 0, o2 = 0;
  for (const g of parts) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array, o3);
    nor.set(g.attributes.normal.array, o3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o2);
    o3 += g.attributes.position.count * 3; o2 += g.attributes.position.count * 2;
  }
  const out = new X.BufferGeometry();
  out.setAttribute('position', new X.BufferAttribute(pos, 3));
  out.setAttribute('normal', new X.BufferAttribute(nor, 3));
  out.setAttribute('uv', new X.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}

/**
 * Cheap vertex ambient occlusion: darker toward the bottom of the object and
 * on downward faces. Multiplies (or creates) the 'color' attribute; pass a mesh
 * to also switch its material to vertexColors.
 * @param {THREE.BufferGeometry|THREE.Mesh} target
 * @param {object} [o] { strength=0.55, floor (world y where contact is darkest; default: geometry bottom) }
 */
export function bakeAO(target, { strength = 0.55, floor = null } = {}) {
  const X = T3();
  const geo = target.isMesh ? target.geometry : target;
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const y0 = floor ?? bb.min.y, hgt = Math.max(1e-4, bb.max.y - y0);
  const p = geo.attributes.position;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const n = geo.attributes.normal;
  let c = geo.attributes.color;
  if (!c) {
    c = new X.BufferAttribute(new Float32Array(p.count * 3).fill(1), 3);
    geo.setAttribute('color', c);
  }
  for (let i = 0; i < p.count; i++) {
    const h = Math.max(0, Math.min(1, (p.getY(i) - y0) / hgt));
    let ao = 1 - strength + strength * Math.pow(h, 0.55);
    ao *= 1 - Math.max(0, -n.getY(i)) * strength * 0.45;
    c.setXYZ(i, c.getX(i) * ao, c.getY(i) * ao, c.getZ(i) * ao);
  }
  c.needsUpdate = true;
  if (target.isMesh) [].concat(target.material).forEach((m) => { m.vertexColors = true; m.needsUpdate = true; });
  return geo;
}

// ------------------------------------------------------------------ props (library-like primitives)
// Colours per palette for natural props; everything else comes from the palette swatch.
const PROP_COLORS = {
  default: { foliage: '#5E9A3E', foliage2: '#7DB24A', trunk: '#6B4A2E', stone: '#8A8680', metal: '#3A404A', glow: '#FFD27A', crystal: '#6FA8FF' },
  day: {}, sunset: { foliage: '#5E8A3A', foliage2: '#A8A040', glow: '#FFB45C' },
  night: { foliage: '#2E5A4A', foliage2: '#3E6A5A', stone: '#6A7488', glow: '#FFD27A', crystal: '#8FB4FF' },
  'night-neon': { foliage: '#2A6A5A', stone: '#5A5A6E', metal: '#2A2E3A', glow: '#FF2FD0', crystal: '#22E6FF' },
  'dungeon-torch': { foliage: '#4A5A3A', stone: '#6E665C', glow: '#FF9A3C', crystal: '#7AE0C0' },
  'cozy-indoor': { foliage: '#5A8A4A', glow: '#FFC861', crystal: '#FFB0A0' },
  space: { stone: '#6A6A7E', metal: '#4A5262', glow: '#22D3FF', crystal: '#B07AFF' },
  underwater: { foliage: '#FF7A8A', foliage2: '#FFB86B', trunk: '#8A6A5A', stone: '#6A8A8A', glow: '#9FF4FF', crystal: '#FF8AD0' },
  storybook: { foliage: '#6CC24A', foliage2: '#A6D84E', trunk: '#8A5A3A', stone: '#A09A94', glow: '#FFD27A', crystal: '#9AD0FF' },
};
function propColors(pal) { return { ...PROP_COLORS.default, ...(PROP_COLORS[pal] || {}) }; }

export const PROP_KINDS = Object.freeze(['crate', 'barrel', 'rock', 'tree', 'pine', 'bush', 'lamp', 'pillar', 'crystal', 'fence', 'torch', 'neon']);

/**
 * A finished-looking primitive prop (a Group, origin at its base, about 1 m scale).
 * kinds: crate, barrel, rock, tree, pine, bush, lamp, pillar, crystal, fence, torch, neon.
 * @param {object} [o] { palette, toon, outline (true | {thickness,color}), seed, color, quality }
 */
export function prop(kind, o = {}) {
  const X = T3();
  const { Group, Mesh, Matrix4, Color } = X;
  const pal = o.palette || 'day';
  const PC = propColors(pal);
  const info = currentTier(o);
  const rng = createRng(`${kind}:${o.seed ?? 1}`);
  const g = new Group();
  g.name = `prop:${kind}`;
  const lit = (color, extra = {}) => (o.toon
    ? toonMaterial(color, { steps: 3, rim: 0.3, vertexColors: true, ...extra })
    : info.lambert
      ? new X.MeshLambertMaterial({ color: new Color(color), vertexColors: true, ...extra })
      : new X.MeshStandardMaterial({ color: new Color(color), roughness: 0.8, metalness: 0, vertexColors: true, flatShading: !!extra.flatShading, ...extra }));
  const surf = (k, extra = {}) => {
    const m = surfaceMaterial(k, { palette: pal, toon: o.toon, quality: o.quality, vertexColors: true, ...extra });
    return m;
  };
  const glowMat = (color, k = 2.5) => new X.MeshBasicMaterial({ color: new Color(color).multiplyScalar(k), toneMapped: false });
  const add = (geos, mat, { ao = 0.45, cast = true, flat = false } = {}) => {
    let geo = mergeGeometries([].concat(geos));
    if (flat) { geo.computeVertexNormals(); }
    if (ao > 0) bakeAO(geo, { strength: ao, floor: 0 });
    const m = new Mesh(geo, mat);
    m.castShadow = cast; m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const at = (geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = null) => {
    const mtx = new Matrix4().makeRotationFromEuler(new X.Euler(rx, ry, rz));
    if (s) mtx.scale(new X.Vector3(...s));
    mtx.setPosition(x, y, z);
    return geo.applyMatrix4(mtx);
  };
  const jitter = (geo, amt) => {
    const p = geo.attributes.position;
    const seen = new Map();
    for (let i = 0; i < p.count; i++) {
      const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      let d = seen.get(k);
      if (!d) { d = [(rng.next() - 0.5) * amt, (rng.next() - 0.5) * amt, (rng.next() - 0.5) * amt]; seen.set(k, d); }
      p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
    }
    geo.computeVertexNormals();
    return geo;
  };
  switch (kind) {
    case 'crate': {
      const s = 1;
      const body = at(new X.BoxGeometry(s * 0.94, s * 0.94, s * 0.94), 0, s / 2);
      add(body, surf('planks', { scale: 1, seed: 7 }), { ao: 0.35 });
      const frame = [];
      const t = 0.1;
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) frame.push(at(new X.BoxGeometry(t, s, t), x * (s / 2 - t / 2), s / 2, z * (s / 2 - t / 2)));
      for (const y of [t / 2, s - t / 2]) {
        for (const z of [-1, 1]) frame.push(at(new X.BoxGeometry(s, t, t), 0, y, z * (s / 2 - t / 2)));
        for (const x of [-1, 1]) frame.push(at(new X.BoxGeometry(t, t, s), x * (s / 2 - t / 2), y, 0));
      }
      add(frame, surf('wood', { color: '#B89A80' }), { ao: 0.3 });
      break;
    }
    case 'barrel': {
      const pts = [];
      for (let i = 0; i <= 10; i++) { const y = i / 10; pts.push(new X.Vector2(0.36 + Math.sin(y * Math.PI) * 0.07, y * 1.1)); }
      const staves = new X.LatheGeometry(pts, 18);
      const m = surf('planks', { seed: 11 });
      m.map.rotation = Math.PI / 2; m.map.repeat.set(1.4, 2);
      if (m.normalMap) { m.normalMap.rotation = Math.PI / 2; m.normalMap.repeat.set(1.4, 2); }
      add([staves, at(new X.CircleGeometry(0.37, 18), 0, 1.1, 0, -Math.PI / 2)], m, { ao: 0.4 });
      const hoops = [0.14, 0.55, 0.96].map((y) => at(new X.TorusGeometry(0.36 + Math.sin((y / 1.1) * Math.PI) * 0.07 + 0.012, 0.025, 6, 24), 0, y, 0, Math.PI / 2));
      add(hoops, lit(PC.metal, info.lambert || o.toon ? {} : { metalness: 0.7, roughness: 0.4 }), { ao: 0 });
      break;
    }
    case 'rock': {
      const geo = jitter(at(new X.IcosahedronGeometry(0.55, 1), 0, 0.3, 0, 0, rng.next() * 6, 0, [1.15, 0.72, 1]), 0.22);
      const m = add(geo, lit(o.color || PC.stone, { flatShading: true }), { ao: 0.5 });
      m.geometry.computeVertexNormals();
      break;
    }
    case 'tree': {
      add(at(new X.CylinderGeometry(0.09, 0.15, 1.3, 7), 0, 0.65), lit(PC.trunk), { ao: 0.4 });
      const blobs = [[0, 1.75, 0, 0.75], [0.38, 1.45, 0.15, 0.5], [-0.32, 1.5, -0.2, 0.52], [0.05, 2.2, -0.05, 0.48]];
      add(blobs.map(([x, y, z, r]) => jitter(at(new X.IcosahedronGeometry(r, 1), x, y, z), r * 0.18)), lit(o.color || PC.foliage, { flatShading: true }), { ao: 0.5, flat: true });
      break;
    }
    case 'pine': {
      add(at(new X.CylinderGeometry(0.07, 0.12, 0.8, 6), 0, 0.4), lit(PC.trunk), { ao: 0.4 });
      const cones = [[0.62, 0.95, 0.5], [0.5, 0.85, 1.05], [0.36, 0.75, 1.55]].map(([r, h, y]) => at(new X.ConeGeometry(r, h, 8), 0, y + h / 2, 0, 0, rng.next(), 0));
      add(cones, lit(o.color || mixHex(PC.foliage, '#1E4A3A', 0.35), { flatShading: true }), { ao: 0.55, flat: true });
      break;
    }
    case 'bush': {
      const blobs = [[0, 0.35, 0, 0.42], [0.35, 0.28, 0.1, 0.3], [-0.3, 0.27, -0.08, 0.32]];
      add(blobs.map(([x, y, z, r]) => jitter(at(new X.IcosahedronGeometry(r, 1), x, y, z), r * 0.2)), lit(o.color || PC.foliage2, { flatShading: true }), { ao: 0.5, flat: true });
      break;
    }
    case 'lamp': {
      const metal = lit(PC.metal, info.lambert || o.toon ? {} : { metalness: 0.6, roughness: 0.45 });
      add([at(new X.CylinderGeometry(0.05, 0.08, 3, 8), 0, 1.5), at(new X.CylinderGeometry(0.16, 0.2, 0.18, 8), 0, 0.09), at(new X.BoxGeometry(0.7, 0.06, 0.06), 0.3, 2.95)], metal, { ao: 0.3 });
      const head = new Mesh(at(new X.BoxGeometry(0.32, 0.1, 0.2), 0.58, 2.88), glowMat(o.color || PC.glow, 3));
      g.add(head);
      // a soft additive pool of light on the ground reads as "lit" without a real light
      const pool = new Mesh(new X.PlaneGeometry(4, 4).rotateX(-Math.PI / 2), new X.MeshBasicMaterial({
        map: dotTexture(), color: new Color(o.color || PC.glow).multiplyScalar(0.5), transparent: true, depthWrite: false, blending: X.AdditiveBlending, toneMapped: false,
      }));
      pool.position.set(0.58, 0.03, 0); pool.renderOrder = 2; pool.raycast = () => {};
      pool.userData.noOutline = true;
      g.add(pool);
      if (o.light) { const pl = new X.PointLight(new Color(o.color || PC.glow), 12, 9, 2); pl.position.set(0.58, 2.6, 0); g.add(pl); }
      break;
    }
    case 'pillar': {
      const stone = surf('flagstones', { color: '#E8E4DC', scale: 1 });
      add([at(new X.CylinderGeometry(0.3, 0.33, 2.6, 12), 0, 1.5)], stone, { ao: 0.5 });
      add([at(new X.BoxGeometry(0.85, 0.22, 0.85), 0, 0.11), at(new X.BoxGeometry(0.8, 0.2, 0.8), 0, 2.9)], surf('cobbles', { color: '#D8D4CC' }), { ao: 0.4 });
      break;
    }
    case 'crystal': {
      const c = o.color || PC.crystal;
      const mat = o.toon ? toonMaterial(c, { emissive: c, emissiveIntensity: 0.5, rim: 0.5 })
        : new X.MeshStandardMaterial({ color: new Color(c), emissive: new Color(c), emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.1, flatShading: true });
      const shards = [[0, 0, 0, 0.28, 1.1, 0], [0.25, 0, 0.1, 0.18, 0.7, 0.4], [-0.2, 0, -0.12, 0.16, 0.6, -0.5]];
      add(shards.map(([x, y, z, r, h, tilt]) => at(new X.OctahedronGeometry(1, 0), x, y + h * 0.5, z, tilt * 0.4, rng.next(), tilt, [r, h * 0.6, r])), mat, { ao: 0.25 });
      break;
    }
    case 'fence': {
      const parts = [];
      for (const x of [-0.95, 0.95]) parts.push(at(new X.BoxGeometry(0.12, 1, 0.12), x, 0.5, 0));
      for (const y of [0.35, 0.75]) parts.push(at(new X.BoxGeometry(2, 0.1, 0.05), 0, y, 0));
      add(parts, surf('wood', { color: '#D8C0A0' }), { ao: 0.4 });
      break;
    }
    case 'torch': {
      add([at(new X.CylinderGeometry(0.035, 0.05, 1.1, 6), 0, 0.55), at(new X.CylinderGeometry(0.08, 0.06, 0.14, 8), 0, 1.12)], lit(PC.trunk), { ao: 0.3 });
      g.add(new Mesh(at(new X.ConeGeometry(0.085, 0.3, 8), 0, 1.33), glowMat(o.color || '#FF8A2A', 3)));
      const halo = new X.Sprite(new X.SpriteMaterial({ map: dotTexture(), color: new Color(o.color || '#FF9A3C'), transparent: true, depthWrite: false, blending: X.AdditiveBlending, opacity: 0.6 }));
      halo.position.set(0, 1.3, 0); halo.scale.setScalar(0.9);
      g.add(halo);
      break;
    }
    case 'neon': {
      add(at(new X.BoxGeometry(2.2, 1, 0.12), 0, 0.5), lit('#14101E'), { ao: 0 });
      const c = o.color || PC.glow;
      const tube = new X.TorusGeometry(0.34, 0.035, 6, 32);
      const tubes = [at(tube.clone(), -0.55, 0.5, 0.08), at(new X.BoxGeometry(0.9, 0.07, 0.04), 0.45, 0.68, 0.08), at(new X.BoxGeometry(0.9, 0.07, 0.04), 0.45, 0.32, 0.08)];
      g.add(new Mesh(mergeGeometries(tubes), glowMat(c, 3)));
      break;
    }
    default:
      throw new Error(`look: unknown prop "${kind}" (have: ${PROP_KINDS.join(', ')})`);
  }
  if (o.outline) outline(g, typeof o.outline === 'object' ? o.outline : { thickness: 0.025 });
  return g;
}

// ------------------------------------------------------------------ scatter
/**
 * Scatter props over an area with InstancedMesh (one draw per prop part, plus one for blob shadows).
 * @param {THREE.Object3D} scene  where the scatter group goes
 * @param {Array} items  prop kind strings ('rock'), Object3Ds, or { object|kind, weight, scale:[a,b] }
 * @param {object} area  {x, z, w, d} | {x, z, r} | {minX, maxX, minZ, maxZ}
 * @param {object} [o] { count=24, seed=1, avoid, minDist, scale=[0.8,1.25], y=0 | heightAt(x,z),
 *   blob=true (soft contact shadows), outline, palette, toon }
 * @returns {{ group, points, meshes, dispose() }}
 */
export function scatter(scene, items, area, o = {}) {
  const X = T3();
  const { InstancedMesh, Matrix4, Quaternion, Vector3, Box3, Group, MeshBasicMaterial, PlaneGeometry, Euler } = X;
  const list = (Array.isArray(items) ? items : [items]).map((it) => {
    if (typeof it === 'string') return { object: prop(it, { palette: o.palette, toon: o.toon, quality: o.quality, seed: o.seed }), weight: 1 };
    if (it && it.isObject3D) return { object: it, weight: 1 };
    const obj = it.object || prop(it.kind, { palette: o.palette, toon: o.toon, quality: o.quality, ...it });
    return { ...it, object: obj, weight: it.weight ?? 1 };
  });
  const pts = scatterPoints(area, {
    count: o.count ?? 24, seed: o.seed ?? 1, avoid: o.avoid, minDist: o.minDist ?? 0, scale: o.scale || [0.8, 1.25],
    weights: list.map((l) => l.weight), pad: o.pad ?? 0,
  });
  const group = new Group();
  group.name = 'look:scatter';
  const meshes = [];
  const M = new Matrix4(), R = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0), v = new Vector3(), sc = new Vector3();
  const yAt = typeof o.heightAt === 'function' ? o.heightAt : () => (typeof o.y === 'number' ? o.y : 0);
  const blobs = [];
  list.forEach((l, idx) => {
    const mine = pts.filter((p) => p.item === idx);
    if (!mine.length) return;
    const tpl = l.object;
    tpl.updateMatrixWorld(true);
    const inv = new Matrix4().copy(tpl.matrixWorld).invert();
    const box = new Box3().setFromObject(tpl);
    const foot = Math.max(0.2, Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.62);
    const sRange = l.scale;
    const placed = mine.map((p) => {
      const s = sRange ? sRange[0] + (p.scale - (o.scale?.[0] ?? 0.8)) / (((o.scale?.[1] ?? 1.25) - (o.scale?.[0] ?? 0.8)) || 1) * (sRange[1] - sRange[0]) : p.scale;
      return { ...p, s, y: yAt(p.x, p.z) };
    });
    tpl.traverse((part) => {
      if (!part.isMesh || part.userData.isOutline) return;
      const rel = new Matrix4().multiplyMatrices(inv, part.matrixWorld);
      const im = new InstancedMesh(part.geometry, part.material, placed.length);
      im.castShadow = part.castShadow; im.receiveShadow = part.receiveShadow;
      im.name = `${tpl.name || 'item'}:${part.name || 'part'}`;
      placed.forEach((p, i) => {
        q.setFromAxisAngle(up, p.rot);
        M.compose(v.set(p.x, p.y, p.z), q, sc.set(p.s, p.s, p.s));
        R.multiplyMatrices(M, rel);
        im.setMatrixAt(i, R);
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      group.add(im);
      meshes.push(im);
    });
    for (const p of placed) blobs.push({ x: p.x, y: p.y, z: p.z, r: foot * p.s });
  });
  if (o.blob !== false && blobs.length) {
    // without shadow maps (low tier, software) the blob is the only contact shadow: make it read
    const mat = new MeshBasicMaterial({ map: blobTexture(), color: 0x000000, transparent: true, opacity: o.blobOpacity ?? (currentTier(o).shadows ? 0.42 : 0.62), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const bm = new InstancedMesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, blobs.length);
    blobs.forEach((b, i) => { M.compose(v.set(b.x, b.y + 0.02, b.z), q.identity(), sc.set(b.r * 2, 1, b.r * 2)); bm.setMatrixAt(i, M); });
    bm.instanceMatrix.needsUpdate = true;
    bm.computeBoundingSphere();
    bm.renderOrder = 1;
    bm.name = 'look:blob-shadows';
    bm.raycast = () => {};
    bm.userData.noOutline = true;
    group.add(bm);
  }
  if (o.outline) outline(group, typeof o.outline === 'object' ? o.outline : { thickness: 0.025 });
  scene.add(group);
  return {
    group, points: pts, meshes,
    dispose() { scene.remove(group); for (const m of meshes) m.dispose?.(); },
  };
}

/** a blob (contact) shadow under one object: a soft dark disc you can move with it */
export function blobShadow(radius = 0.6, opacity = 0.5) {
  const X = T3();
  const m = new X.Mesh(new X.PlaneGeometry(radius * 2, radius * 2).rotateX(-Math.PI / 2), new X.MeshBasicMaterial({
    map: blobTexture(), color: 0x000000, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  }));
  m.position.y = 0.02;
  m.renderOrder = 1;
  m.raycast = () => {};
  m.userData.noOutline = true;
  m.name = 'look:blob';
  return m;
}

/** the colours for HUD/UI that match a preset (same keys for every palette) */
export function lookPalette(name) { return getPalette(name); }

const API = {
  useThree, createLook, applyLook, skyAndFog, toonMaterial, outline, surfaceTexture, surfaceNormalMap, surfaceMaterial, surfaceTile,
  groundPlane, scatter, prop, blobShadow, bakeAO, mergeGeometries, tierInfo, lookPalette,
  PALETTES, PRESETS, PRESET_NAMES, PRESET_GROUNDS, SURFACE_KINDS, PROP_KINDS,
  getPreset, presetAtHour, blendPresets, scatterPoints, normalizeArea, mixHex, shadeHex, hash2,
};
export default API;
