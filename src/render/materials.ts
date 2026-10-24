/**
 * Shared surface materials for the miniature town.
 *
 * Every static surface is a MeshStandardMaterial with vertex colours whose
 * shader is extended (onBeforeCompile) with:
 *  - a cheap procedural pattern evaluated in world space (plaster mottling,
 *    brick courses, roof tiles, cobbles, paving slabs, asphalt, grass...),
 *    faded out with screen-space derivatives to avoid aliasing at distance;
 *  - a wet look driven by the rain (darker albedo, glossier);
 *  - the "hero district" haze: outside the central band the image is
 *    gently desaturated and pulled towards the fog colour, like a
 *    depth-of-field blur that draws the eye to the centre;
 *  - optional wind sway (foliage, cloth) driven by a global time uniform.
 *
 * All materials share the same uniform objects so that one update per frame
 * (from the lighting rig) drives the whole city.
 */

import * as THREE from 'three';

export const U = {
  uTime: { value: 0 },
  uWet: { value: 0 },
  uNight: { value: 0 },
  /** Centre and radii (x, z) of the hero district ellipse. */
  uHeroC: { value: new THREE.Vector2(300, 185) },
  uHeroR: { value: new THREE.Vector2(225, 215) },
  uHazeColor: { value: new THREE.Color('#d8e0e6') },
  uHazeK: { value: 1 },
  uSky: { value: new THREE.Color('#a9d0ee') },
};

export type Surface =
  | 'plain'
  | 'plaster'
  | 'brick'
  | 'stone'
  | 'roof'
  | 'cobble'
  | 'paving'
  | 'asphalt'
  | 'grass'
  | 'gravel'
  | 'wood'
  | 'foliage'
  | 'cloth';

const SURFACE_ID: Record<Surface, number> = {
  plain: 0,
  plaster: 1,
  brick: 2,
  stone: 3,
  roof: 4,
  cobble: 5,
  paving: 6,
  asphalt: 7,
  grass: 8,
  gravel: 9,
  wood: 10,
  foliage: 11,
  cloth: 12,
};

/** GLSL helpers shared by the patterns. */
const NOISE_BASE = /* glsl */ `
float bf_hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float bf_noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(bf_hash12(i), bf_hash12(i + vec2(1.0, 0.0)), u.x), mix(bf_hash12(i + vec2(0.0, 1.0)), bf_hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;
const NOISE = NOISE_BASE + /* glsl */ `
float bf_haze(vec3 wp) {
  vec2 d = (wp.xz - uHeroC) / uHeroR;
  return smoothstep(0.95, 1.85, length(d)) * uHazeK;
}
`;

const PATTERN = /* glsl */ `
{
  vec3 wp = vBfPos;
  vec3 wn = normalize(vBfNrm);
  float px = length(fwidth(wp));
  float h = abs(wn.x) > abs(wn.z) ? wp.z : wp.x;
  bool top = wn.y > 0.6;
  vec3 c = diffuseColor.rgb;
#if BF_SURFACE == 1
  // Plaster: soft mottling, darker base (splash / grime), lighter at the top.
  float aa = clamp(1.0 - px * 0.6, 0.0, 1.0);
  c *= 0.94 + 0.1 * bf_noise(vec2(h * 0.35, wp.y * 0.5)) * aa + 0.03 * bf_noise(wp.xz * 0.05);
  if (!top) c *= mix(0.84, 1.0, smoothstep(0.2, 2.4, wp.y));
#elif BF_SURFACE == 2
  // Brick courses with staggered joints and per-brick variation.
  float aa = clamp(1.0 - px * 2.2, 0.0, 1.0);
  if (!top) {
    float row = wp.y / 0.42;
    float ri = floor(row);
    float bx = h / 0.95 + mod(ri, 2.0) * 0.5;
    float bi = floor(bx);
    float mortar = max(1.0 - smoothstep(0.0, 0.12, fract(row)), 1.0 - smoothstep(0.0, 0.06, fract(bx)));
    float v = bf_hash12(vec2(bi, ri));
    vec3 brick = c * (0.85 + 0.3 * v);
    c = mix(c, mix(brick, vec3(0.78, 0.74, 0.68), mortar * 0.8), aa);
    c *= mix(0.86, 1.0, smoothstep(0.2, 2.0, wp.y));
  }
#elif BF_SURFACE == 3
  // Dressed stone: large blocks.
  float aa = clamp(1.0 - px * 1.2, 0.0, 1.0);
  if (!top) {
    float row = wp.y / 0.9;
    float ri = floor(row);
    float bx = h / 1.8 + mod(ri, 2.0) * 0.5;
    float joint = max(1.0 - smoothstep(0.0, 0.05, fract(row)), 1.0 - smoothstep(0.0, 0.025, fract(bx)));
    float v = bf_hash12(vec2(floor(bx), ri));
    c = mix(c, c * (0.92 + 0.14 * v) * (1.0 - joint * 0.22), aa);
  }
  c *= 0.95 + 0.08 * bf_noise(wp.xz * 0.3 + wp.y);
#elif BF_SURFACE == 4
  // Roof tiles / slates: courses along the slope, staggered joints.
  float aa = clamp(1.0 - px * 1.6, 0.0, 1.0);
  float row = wp.y / 0.46;
  float ri = floor(row);
  float bx = h / 0.8 + mod(ri, 2.0) * 0.5;
  float bi = floor(bx);
  float v = bf_hash12(vec2(bi, ri));
  float course = smoothstep(0.0, 0.3, fract(row));
  float joint = smoothstep(0.0, 0.07, fract(bx)) * smoothstep(1.0, 0.93, fract(bx));
  c = mix(c * (0.97 + 0.06 * bf_noise(wp.xz * 0.2)), c * (0.8 + 0.28 * v) * (0.74 + 0.26 * course) * (0.86 + 0.14 * joint), aa);
#elif BF_SURFACE == 5
  // Cobblestones (setts) in staggered rows.
  float aa = clamp(1.0 - px * 2.6, 0.0, 1.0);
  vec2 q = wp.xz / vec2(0.75, 0.6);
  q.x += mod(floor(q.y), 2.0) * 0.5;
  vec2 f = fract(q) - 0.5;
  float d = max(abs(f.x) * 1.05, abs(f.y));
  float stone = 1.0 - smoothstep(0.36, 0.48, d);
  float v = bf_hash12(floor(q));
  vec3 cs = c * (0.82 + 0.32 * v) * (0.62 + 0.38 * stone);
  c = mix(c * (0.9 + 0.1 * bf_noise(wp.xz * 0.2)), cs, aa);
#elif BF_SURFACE == 6
  // Paving slabs.
  float aa = clamp(1.0 - px * 1.8, 0.0, 1.0);
  vec2 q = wp.xz / vec2(1.4, 1.0);
  q.x += mod(floor(q.y), 2.0) * 0.5;
  vec2 f = fract(q);
  float joint = max(1.0 - smoothstep(0.0, 0.04, f.x), 1.0 - smoothstep(0.0, 0.05, f.y));
  float v = bf_hash12(floor(q));
  c = mix(c, c * (0.94 + 0.1 * v) * (1.0 - joint * 0.25), aa);
  c *= 0.95 + 0.07 * bf_noise(wp.xz * 0.15);
#elif BF_SURFACE == 7
  // Asphalt: speckles and large patches.
  float aa = clamp(1.0 - px * 3.0, 0.0, 1.0);
  c *= 0.9 + 0.14 * bf_noise(wp.xz * 0.06) + (bf_hash12(floor(wp.xz * 5.0)) - 0.5) * 0.08 * aa;
#elif BF_SURFACE == 8
  // Grass: two octaves of value noise and a warm / cool tint.
  float n1 = bf_noise(wp.xz * 0.045);
  float n2 = bf_noise(wp.xz * 0.21);
  c *= 0.84 + 0.22 * n1 + 0.1 * n2;
  c = mix(c, c * vec3(1.12, 1.06, 0.72), smoothstep(0.55, 0.9, bf_noise(wp.xz * 0.012 + 7.0)) * 0.5);
  // Countryside: soft irregular fields (noise-warped cells) in desaturated greens and ochres,
  // with the odd hedgerow along a field edge.
  if (wp.x < -30.0 || wp.x > 750.0 || wp.z < -30.0 || wp.z > 525.0) {
    vec2 q = wp.xz / 140.0;
    q += vec2(bf_noise(wp.xz * 0.004 + 3.1), bf_noise(wp.xz * 0.004 + 9.7)) * 1.6 - 0.8;
    vec2 fc = floor(q);
    vec2 ff = fract(q);
    float fh = bf_hash12(fc);
    vec3 meadow = vec3(0.26, 0.37, 0.15);
    vec3 crop = fh < 0.22 ? vec3(0.5, 0.42, 0.2) : fh < 0.42 ? vec3(0.19, 0.29, 0.12) : fh < 0.58 ? vec3(0.4, 0.33, 0.2) : meadow;
    // Soft blend instead of hard field borders, slight furrow texture on crops.
    float edge = min(min(ff.x, 1.0 - ff.x), min(ff.y, 1.0 - ff.y));
    vec3 field = mix(meadow, crop, smoothstep(0.0, 0.08, edge));
    if (fh < 0.22 || (fh > 0.42 && fh < 0.58)) field *= 0.95 + 0.05 * sin(dot(wp.xz, vec2(0.6 + fh, 0.8 - fh)) * 1.3);
    float hedge = (1.0 - smoothstep(0.004, 0.018, edge)) * step(0.55, bf_hash12(fc + vec2(17.0, 3.0)));
    field = mix(field, vec3(0.1, 0.17, 0.07), hedge);
    field *= 0.9 + 0.16 * bf_noise(wp.xz * 0.02);
    c = field * 0.95;
  }
#elif BF_SURFACE == 9
  // Gravel / sand paths.
  float aa = clamp(1.0 - px * 3.0, 0.0, 1.0);
  c *= 0.93 + 0.08 * bf_noise(wp.xz * 0.3) + (bf_hash12(floor(wp.xz * 6.0)) - 0.5) * 0.12 * aa;
#elif BF_SURFACE == 10
  // Wood planks.
  float aa = clamp(1.0 - px * 2.0, 0.0, 1.0);
  float pl = top ? wp.x / 0.35 : wp.y / 0.32;
  c *= mix(1.0, 0.86 + 0.2 * bf_hash12(vec2(floor(pl), 3.0)) - (1.0 - smoothstep(0.0, 0.1, fract(pl))) * 0.18, aa);
#elif BF_SURFACE == 11
  // Foliage: dappled leaves, lighter towards the top.
  c *= 0.82 + 0.3 * bf_noise(wp.xz * 0.5 + wp.y * 0.7) ;
  c *= 0.86 + 0.2 * clamp(wn.y * 0.5 + 0.5, 0.0, 1.0);
#endif
  diffuseColor.rgb = c;
}
`;

export interface SurfaceOptions extends THREE.MeshStandardMaterialParameters {
  /** Wind sway amplitude (foliage / cloth), metres per metre of height. */
  sway?: number;
  /** Apply the rain wet look (ground surfaces). */
  wet?: number;
  /** Disable the hero haze (characters, UI-like objects). */
  noHaze?: boolean;
}

/** Patch a standard material with the city surface shader. */
export function patchSurface(mat: THREE.MeshStandardMaterial, surface: Surface, o: { sway?: number; wet?: number; noHaze?: boolean } = {}): THREE.MeshStandardMaterial {
  const id = SURFACE_ID[surface];
  const sway = o.sway ?? 0;
  const wet = o.wet ?? 0;
  const haze = !o.noHaze;
  mat.defines = { ...(mat.defines ?? {}), BF_SURFACE: id };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
varying vec3 vBfPos;
varying vec3 vBfNrm;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
${
  sway > 0
    ? `{
  vec3 ip = vec3(0.0);
  #ifdef USE_INSTANCING
  ip = instanceMatrix[3].xyz;
  #endif
  float hgt = max(position.y - 1.5, 0.0);
  float ph = uTime * 1.4 + ip.x * 0.07 + ip.z * 0.05;
  float amp = ${sway.toFixed(4)} * hgt;
  transformed.x += (sin(ph) * 0.7 + sin(ph * 2.3 + 1.7) * 0.3) * amp;
  transformed.z += cos(ph * 0.8 + 0.6) * amp * 0.6;
}`
    : ''
}`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
{
  vec4 bwp = vec4(transformed, 1.0);
  vec3 bn = objectNormal;
  #ifdef USE_INSTANCING
  bwp = instanceMatrix * bwp;
  bn = mat3(instanceMatrix) * bn;
  #endif
  vBfPos = (modelMatrix * bwp).xyz;
  vBfNrm = normalize(mat3(modelMatrix) * bn);
}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uWet;
uniform vec2 uHeroC;
uniform vec2 uHeroR;
uniform vec3 uHazeColor;
uniform float uHazeK;
varying vec3 vBfPos;
varying vec3 vBfNrm;
${NOISE}`,
      )
      .replace('#include <color_fragment>', `#include <color_fragment>\n${PATTERN}`)
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
${
  wet > 0
    ? `{
  float wetK = uWet * ${wet.toFixed(3)} * (normalize(vBfNrm).y > 0.6 ? 1.0 : 0.45);
  // Puddles: patches that get darker and mirror-like.
  float pud = smoothstep(0.62, 0.78, bf_noise(vBfPos.xz * 0.09 + 3.0)) * wetK;
  diffuseColor.rgb *= 1.0 - wetK * 0.45 - pud * 0.3;
  roughnessFactor = mix(roughnessFactor, 0.18, clamp(wetK * 0.75 + pud, 0.0, 1.0));
}`
    : ''
}`,
      )
      .replace(
        '#include <fog_fragment>',
        `${
          haze
            ? `{
  float farLand = smoothstep(600.0, 1800.0, length(vBfPos.xz - vec2(360.0, 240.0)));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uHazeColor, farLand * 0.7);
  float hz = bf_haze(vBfPos);
  float g = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
  vec3 calm = mix(vec3(g), gl_FragColor.rgb, 0.55);
  calm = mix(calm, uHazeColor, 0.24);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, calm, hz);
}`
            : ''
        }
#include <fog_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => `bf-surface-${id}-${sway}-${wet}-${haze}`;
  return mat;
}

const cache = new Map<string, THREE.MeshStandardMaterial>();

/**
 * A shared vertex-coloured surface material. Materials are cached by their
 * options and never disposed (they live as long as the page).
 */
export function surfaceMaterial(surface: Surface, o: SurfaceOptions = {}): THREE.MeshStandardMaterial {
  const key = `${surface}|${JSON.stringify(o)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { sway, wet, noHaze, ...params } = o;
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.88,
    metalness: 0,
    flatShading: true,
    ...params,
  });
  patchSurface(mat, surface, { sway, wet, noHaze });
  cache.set(key, mat);
  return mat;
}

// ---------------------------------------------------------------------------
// Billboards: lamp halos, chimney smoke, fountain spray (all GPU animated)
// ---------------------------------------------------------------------------

export type BillboardMode = 'halo' | 'smoke' | 'spray' | 'glint';
const MODE_ID: Record<BillboardMode, number> = { halo: 0, smoke: 1, spray: 2, glint: 3 };

export interface BillboardSpec {
  x: number;
  y: number;
  z: number;
  size: number;
  /** Per-instance phase in 0..1 (animation offset). */
  phase?: number;
  color?: THREE.ColorRepresentation;
}

const BB_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec3 aPos;
attribute float aSize;
attribute float aPhase;
attribute vec3 aColor;
uniform float uTime;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vUv = uv;
  vColor = aColor;
  vec3 center = aPos;
  float size = aSize;
  float alpha = 1.0;
#if BB_MODE == 1
  float k = fract(uTime * 0.09 + aPhase);
  center += vec3(sin(k * 5.0 + aPhase * 20.0) * 0.8 + k * 5.0, k * 13.0, k * 2.2);
  size *= 0.55 + k * 2.0;
  alpha = smoothstep(0.0, 0.12, k) * (1.0 - k) * (1.0 - k);
#elif BB_MODE == 2
  float k = fract(uTime * 0.75 + aPhase);
  float ang = aPhase * 6.2831 * 13.0;
  float r = aColor.r * k;
  center += vec3(cos(ang) * r, aColor.g * k - 9.0 * k * k * aColor.b, sin(ang) * r);
  vColor = vec3(1.0);
  alpha = 1.0 - k;
  size *= 0.6 + 0.6 * k;
#elif BB_MODE == 3
  alpha = 0.5 + 0.5 * sin(uTime * 2.0 + aPhase * 30.0);
#endif
  vAlpha = alpha;
  vec4 mvPosition = viewMatrix * vec4(center, 1.0);
  mvPosition.xy += position.xy * size;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const BB_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uOpacity;
uniform vec3 uTint;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0) discard;
#if BB_MODE == 1
  float a = (1.0 - r) * (1.0 - r);
  gl_FragColor = vec4(uTint, a * vAlpha * uOpacity);
#elif BB_MODE == 2
  float a = 1.0 - smoothstep(0.2, 1.0, r);
  gl_FragColor = vec4(uTint, a * vAlpha * uOpacity);
#else
  float a = exp(-r * 3.2) - 0.04;
  gl_FragColor = vec4(vColor * uTint * a * vAlpha * uOpacity, 1.0);
#endif
  #include <fog_fragment>
}
`;

/** Build an instanced billboard cloud. Returns a Mesh ready to add to the scene. */
export function makeBillboards(specs: BillboardSpec[], mode: BillboardMode, tint: THREE.ColorRepresentation = '#ffffff'): THREE.Mesh {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  const n = specs.length;
  const pos = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const phase = new Float32Array(n);
  const color = new Float32Array(n * 3);
  const c = new THREE.Color();
  specs.forEach((s, i) => {
    pos.set([s.x, s.y, s.z], i * 3);
    size[i] = s.size;
    phase[i] = s.phase ?? (i * 0.618) % 1;
    c.set(s.color ?? '#ffffff');
    color.set([c.r, c.g, c.b], i * 3);
  });
  geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 1));
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(color, 3));
  geo.instanceCount = n;
  const additive = mode === 'halo' || mode === 'glint';
  const mat = new THREE.ShaderMaterial({
    vertexShader: BB_VERT,
    fragmentShader: BB_FRAG,
    defines: { BB_MODE: MODE_ID[mode] },
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uOpacity: { value: 1 }, uTint: { value: new THREE.Color(tint) } }]),
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: true,
  });
  mat.uniforms.uTime = U.uTime;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = additive ? 4 : 3;
  return mesh;
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

/** Animated water: ripples in the normal, sky reflection with fresnel. */
export function waterMaterial(color = '#4f8fa8'): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.14, metalness: 0.05, transparent: true, opacity: 0.94, envMapIntensity: 0.45 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform vec3 uSky;
uniform float uNight;
varying vec3 vWp;
${NOISE_BASE}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec2 q = vWp.xz * 0.35;
  float t = uTime * 0.6;
  float nx = bf_noise(q + vec2(t, 0.3 * t)) - bf_noise(q + vec2(0.13, 0.0) + vec2(t, 0.3 * t));
  float nz = bf_noise(q * 1.3 + vec2(-0.4 * t, t)) - bf_noise(q * 1.3 + vec2(0.0, 0.13) + vec2(-0.4 * t, t));
  normal = normalize(normal + (viewMatrix * vec4(nx * 0.45, 0.0, nz * 0.45, 0.0)).xyz);
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float fres = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 3.0);
  totalEmissiveRadiance += uSky * (0.04 + 0.4 * fres) * (1.0 - uNight * 0.75);
}`,
      );
  };
  mat.customProgramCacheKey = () => 'bf-water';
  return mat;
}

// ---------------------------------------------------------------------------
// Imported window panes: lit at night cell by cell
// ---------------------------------------------------------------------------

const litUniforms = new Map<string, { value: number }>();
/** Share of lit windows (0..1) of a group of imported window panes (written each frame). */
export function litUniform(key = 'homes'): { value: number } {
  let u = litUniforms.get(key);
  if (!u) {
    u = { value: 0 };
    litUniforms.set(key, u);
  }
  return u;
}

const litMats = new Map<string, THREE.MeshStandardMaterial>();
/**
 * Material for the window panes of imported models (vertex coloured dark
 * glass). At night a deterministic subset of 2.5 m world cells emits warm
 * light, so windows switch on house by house without per-window data. Each
 * key (a location, or "homes") has its own share of lit windows.
 */
export function litWindowMaterial(key = 'homes'): THREE.MeshStandardMaterial {
  const hit = litMats.get(key);
  if (hit) return hit;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.1, flatShading: true });
  patchSurface(m, 'plain');
  const base = m.onBeforeCompile;
  const uLit = litUniform(key);
  m.onBeforeCompile = (shader, r) => {
    base.call(m, shader, r);
    shader.uniforms.uLit = uLit;
    shader.uniforms.uSky = U.uSky;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uLit;\nuniform vec3 uSky;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  vec3 cell = floor(vBfPos / 2.5);
  float h = bf_hash12(cell.xz + cell.y * 17.31);
  float on = step(h, uLit);
  float hv = bf_hash12(cell.zx + 3.1);
  vec3 warm = mix(vec3(1.0, 0.72, 0.38), vec3(1.0, 0.84, 0.55), hv) * (0.7 + 0.6 * bf_hash12(cell.xy + 7.7));
  // A few cool television-blue windows late in the evening.
  if (hv > 0.92) warm = vec3(0.55, 0.68, 1.0) * 0.9;
  totalEmissiveRadiance += warm * on * 1.25 + uSky * 0.12;
}`,
      );
  };
  m.customProgramCacheKey = () => 'bf-litwin';
  litMats.set(key, m);
  return m;
}
