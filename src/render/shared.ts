/**
 * Shared helpers for the 3D rendering layer.
 *
 * - Coordinate mapping: sim (x east, y south, metres) -> three (x, 0, y).
 * - A tiny mutable "environment" singleton written by the lighting rig once per
 *   frame and read by every component that reacts to day/night or rain
 *   (windows, lamps, labels...). Using a plain object avoids React re-renders.
 * - Trace sampling with interpolation between integer minutes.
 * - Deterministic hashing for procedural variation.
 * - Canvas-texture labels (no network fonts).
 */

import * as THREE from 'three';
import type { Reality } from '../sim/reality';
import type { TraceFrame } from '../sim/types';
import type { SimStore } from '../store/useSimStore';
import { CITY_HEIGHT, CITY_WIDTH, STREET_SPACING, getCity, pointAlong, polylineLength } from '../sim/city';
import type { Vec2 } from '../sim/types';

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

export const CITY_CENTER = new THREE.Vector3(CITY_WIDTH / 2, 0, CITY_HEIGHT / 2);
/** Asphalt half width (street is 14 m wide). */
export const ROAD_HALF = 7;
/** Sidewalk width. */
export const SIDEWALK = 3;
/** Margin of the diorama base around the street grid. */
export const BASE_MARGIN = 70;

/** Field of view of the main camera (degrees). */
export const CAMERA_FOV = 38;

/** Vertical layering of flat ground elements (tops), chosen to avoid z-fighting. */
export const LAYER = {
  ground: 0,
  block: 0.12,
  lot: 0.24,
  road: 0.3,
  marking: 0.36,
  sidewalk: 0.55,
  park: 0.3,
  parkPath: 0.42,
} as const;

// ---------------------------------------------------------------------------
// Environment singleton
// ---------------------------------------------------------------------------

export interface RenderEnv {
  /** Display minute (float) sampled this frame. */
  time: number;
  /** 0 = full daylight, 1 = deep night. Drives windows and lamps. */
  night: number;
  /** 0..1 smoothed rain intensity. */
  rain: number;
  /** Distance from the camera to the orbit target (metres). */
  camDistance: number;
  /** Converts a desired on-screen height in CSS pixels into a sprite scale (sizeAttenuation = false). */
  pxToSprite: number;
}

export const env: RenderEnv = {
  time: 360,
  night: 0,
  rain: 0,
  camDistance: 800,
  pxToSprite: 0.001,
};

// ---------------------------------------------------------------------------
// Store / trace helpers
// ---------------------------------------------------------------------------

/** Reality currently displayed, computed from a raw store snapshot (for use inside useFrame). */
export function activeRealityOf(s: SimStore): Reality {
  return s.activeRealityId === 'B' && s.realityB ? s.realityB : s.realityA;
}

export interface FramePair {
  f0: TraceFrame;
  f1: TraceFrame;
  /** Interpolation fraction between f0 and f1. */
  k: number;
}

/** The two trace frames surrounding `time` plus the interpolation fraction. */
export function sampleFrames(reality: Reality, time: number): FramePair | null {
  const m = Math.floor(time);
  const f0 = reality.frameAt(m);
  if (!f0) return null;
  const f1 = reality.frameAt(m + 1) ?? f0;
  // frameAt clamps: if both minutes clamp to the same frame there is nothing to interpolate.
  const k = f1 === f0 ? 0 : Math.min(1, Math.max(0, time - m));
  return { f0, f1, k };
}

// ---------------------------------------------------------------------------
// Street-following interpolation
// ---------------------------------------------------------------------------

export interface StreetSample {
  x: number;
  y: number;
  /** Unit direction of travel at the sample (0, 0 when not moving). */
  dx: number;
  dy: number;
}

const onStreetX = (x: number) => Math.abs(x - Math.round(x / STREET_SPACING) * STREET_SPACING) < 0.5;
const routeCache = new Map<string, { pts: Vec2[]; len: number }>();

/**
 * Route between two trace positions one minute apart. Fast movers (buses) can
 * turn one or two corners within a minute, so a straight lerp would cut across
 * blocks: use an L-shaped path along streets when possible, otherwise the
 * shortest path on the street graph between the nearest nodes.
 */
function routeBetween(x0: number, y0: number, x1: number, y1: number): { pts: Vec2[]; len: number } {
  const key = `${x0.toFixed(1)},${y0.toFixed(1)}>${x1.toFixed(1)},${y1.toFixed(1)}`;
  const hit = routeCache.get(key);
  if (hit) return hit;
  let pts: Vec2[];
  if (onStreetX(y0) && onStreetX(x1)) {
    pts = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }];
  } else if (onStreetX(x0) && onStreetX(y1)) {
    pts = [{ x: x0, y: y0 }, { x: x0, y: y1 }, { x: x1, y: y1 }];
  } else {
    const city = getCity();
    const a = city.nearestNode({ x: x0, y: y0 });
    const b = city.nearestNode({ x: x1, y: y1 });
    pts = [{ x: x0, y: y0 }, ...city.pathNodes(a, b).map((n) => city.nodePos(n)), { x: x1, y: y1 }];
    // Drop a first / last node that would make us double back.
    if (pts.length > 3) {
      const [p, q, r] = pts;
      if ((q.x - p.x) * (r.x - q.x) + (q.y - p.y) * (r.y - q.y) < 0) pts.splice(1, 1);
    }
    if (pts.length > 3) {
      const n = pts.length;
      const [p, q, r] = [pts[n - 3], pts[n - 2], pts[n - 1]];
      if ((q.x - p.x) * (r.x - q.x) + (q.y - p.y) * (r.y - q.y) < 0) pts.splice(n - 2, 1);
    }
  }
  const route = { pts, len: polylineLength(pts) };
  if (routeCache.size > 4000) routeCache.clear();
  routeCache.set(key, route);
  return route;
}

/** Interpolate between two positions (fraction k) following the streets. */
export function streetLerp(x0: number, y0: number, x1: number, y1: number, k: number, out: StreetSample): StreetSample {
  const ddx = x1 - x0;
  const ddy = y1 - y0;
  const d = Math.hypot(ddx, ddy);
  if (d < 1e-3) {
    out.x = x0;
    out.y = y0;
    out.dx = 0;
    out.dy = 0;
    return out;
  }
  if (Math.abs(ddx) < 0.5 || Math.abs(ddy) < 0.5 || d < 12) {
    out.x = x0 + ddx * k;
    out.y = y0 + ddy * k;
    out.dx = ddx / d;
    out.dy = ddy / d;
    return out;
  }
  const r = routeBetween(x0, y0, x1, y1);
  const at = r.len * k;
  const p = pointAlong(r.pts, at);
  // Direction of the segment containing the sample.
  const q = pointAlong(r.pts, Math.min(r.len, at + 0.5));
  const p0 = at > 0.5 ? pointAlong(r.pts, at - 0.5) : p;
  const vx = q.x - p0.x;
  const vy = q.y - p0.y;
  const vl = Math.hypot(vx, vy) || 1;
  out.x = p.x;
  out.y = p.y;
  out.dx = vx / vl;
  out.dy = vy / vl;
  return out;
}

/** Map sim coordinates to a three.js vector on the ground. */
export function toWorld(x: number, y: number, h = 0, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(x, h, y);
}

/** Shortest signed angular difference b - a in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Frame-rate independent exponential smoothing factor. */
export function damp(lambda: number, dt: number): number {
  return 1 - Math.exp(-lambda * dt);
}

/** World positions of agents, written by <Agents/> every frame and read by the camera rig. */
export const agentWorld = new Map<string, { pos: THREE.Vector3; visible: boolean }>();

// ---------------------------------------------------------------------------
// Deterministic pseudo-randomness
// ---------------------------------------------------------------------------

/** Hash a string to a 32-bit unsigned integer (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small seeded PRNG (mulberry32) returning floats in [0, 1). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Darken / lighten a CSS colour by a factor (multiplies RGB in sRGB space). */
export function shade(color: string, factor: number): string {
  const c = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l * factor)));
  return `#${c.getHexString()}`;
}

// ---------------------------------------------------------------------------
// Canvas labels
// ---------------------------------------------------------------------------

const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export interface LabelOptions {
  text: string;
  /** Optional second, smaller line / suffix drawn after the main text. */
  suffix?: string;
  suffixColor?: string;
  /** Colour of the small dot drawn before the text (none if omitted). */
  dot?: string;
  background?: string;
  color?: string;
  border?: string;
  /** Font size in canvas pixels (canvas is drawn at 2x for crispness). */
  fontSize?: number;
  bold?: boolean;
}

export interface Label {
  texture: THREE.CanvasTexture;
  /** width / height of the label image. */
  aspect: number;
}

/** Draw a rounded "pill" label into a canvas texture. */
export function makeLabel(o: LabelOptions): Label {
  const fontSize = o.fontSize ?? 30;
  const padX = fontSize * 0.6;
  const padY = fontSize * 0.36;
  const dotR = o.dot ? fontSize * 0.26 : 0;
  const gap = o.dot ? fontSize * 0.36 : 0;
  const font = `${o.bold === false ? 500 : 650} ${fontSize}px ${FONT_STACK}`;
  const suffixFont = `700 ${fontSize}px ${FONT_STACK}`;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  const textW = ctx.measureText(o.text).width;
  ctx.font = suffixFont;
  const suffixW = o.suffix ? ctx.measureText(o.suffix).width + fontSize * 0.4 : 0;

  const w = Math.ceil(padX * 2 + dotR * 2 + gap + textW + suffixW);
  const h = Math.ceil(fontSize + padY * 2);
  canvas.width = w;
  canvas.height = h;

  // Background pill
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(r, 1);
  ctx.lineTo(w - r, 1);
  ctx.arc(w - r, r, r - 1, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(r, h - 1);
  ctx.arc(r, r, r - 1, Math.PI / 2, (Math.PI * 3) / 2);
  ctx.closePath();
  ctx.fillStyle = o.background ?? 'rgba(255, 252, 245, 0.92)';
  ctx.fill();
  if (o.border) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = o.border;
    ctx.stroke();
  }

  let x = padX;
  if (o.dot) {
    ctx.beginPath();
    ctx.arc(x + dotR, h / 2, dotR, 0, Math.PI * 2);
    ctx.fillStyle = o.dot;
    ctx.fill();
    x += dotR * 2 + gap;
  }
  ctx.textBaseline = 'middle';
  ctx.font = font;
  ctx.fillStyle = o.color ?? '#2b2620';
  ctx.fillText(o.text, x, h / 2 + fontSize * 0.04);
  if (o.suffix) {
    ctx.font = suffixFont;
    ctx.fillStyle = o.suffixColor ?? '#c0392b';
    ctx.fillText(o.suffix, x + textW + fontSize * 0.4, h / 2 + fontSize * 0.04);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return { texture, aspect: w / h };
}

/** Create a sprite material for a label (constant on-screen size, drawn above the scene). */
export function labelMaterial(label: Label, depthTest = true): THREE.SpriteMaterial {
  return new THREE.SpriteMaterial({
    map: label.texture,
    sizeAttenuation: false,
    transparent: true,
    depthTest,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
}

/** Set a label sprite's scale so it appears `px` CSS pixels tall on screen. */
export function sizeLabel(sprite: THREE.Sprite, aspect: number, px: number): void {
  const s = px * env.pxToSprite;
  sprite.scale.set(s * aspect, s, 1);
}

/** Text painted on a flat sign board (world-sized), e.g. a shop fascia. */
export function makeSignTexture(text: string, bg: string, fg: string, widthPx = 1024, heightPx = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, widthPx, heightPx);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, widthPx - 16, heightPx - 16);
  let size = heightPx * 0.56;
  ctx.font = `700 ${size}px Georgia, "Times New Roman", serif`;
  while (ctx.measureText(text).width > widthPx * 0.9 && size > 10) {
    size -= 2;
    ctx.font = `700 ${size}px Georgia, "Times New Roman", serif`;
  }
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, widthPx / 2, heightPx / 2 + size * 0.05);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Soft radial gradient texture (used for lamp light pools and glows). */
let radialTex: THREE.CanvasTexture | null = null;
export function radialTexture(): THREE.CanvasTexture {
  if (radialTex) return radialTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  radialTex = new THREE.CanvasTexture(c);
  radialTex.colorSpace = THREE.SRGBColorSpace;
  return radialTex;
}

// ---------------------------------------------------------------------------
// Mood colours
// ---------------------------------------------------------------------------

/** Mood palette: cool blue-violet (low) -> soft neutral grey -> warm gold / orange (joy). */
export const MOOD_LOW = new THREE.Color('#7a6cf2');
export const MOOD_NEUTRAL = new THREE.Color('#c4c2be');
export const MOOD_HIGH = new THREE.Color('#ffaa33');

/**
 * Colour for a mood in -1..1. Saturates at |mood| >= 0.5 and interpolates
 * linearly through the neutral grey around 0.
 */
export function moodColor(mood: number, out: THREE.Color): THREE.Color {
  const k = Math.max(-1, Math.min(1, mood * 2));
  return k >= 0 ? out.lerpColors(MOOD_NEUTRAL, MOOD_HIGH, k) : out.lerpColors(MOOD_NEUTRAL, MOOD_LOW, -k);
}

/** Displayed (interpolated, smoothed) mood of each agent, written by <Agents/> every frame. */
export const agentMood = new Map<string, number>();

// ---------------------------------------------------------------------------
// BUTTERFLY palette: one material language for procedural and imported models
// ---------------------------------------------------------------------------

/**
 * The common palette of the town. Every imported glTF material colour is
 * snapped to the nearest entry (see `remapColor`) so Quaternius and Kenney
 * models read as one world with the procedural parts.
 */
export const BUTTERFLY_PALETTE = {
  creme: ['#f2e6cf', '#e8d6b4', '#dcc59c'],
  brique: ['#b5654a', '#a0533d', '#c47a5c'],
  bleuGris: ['#8ea3b4', '#71889c', '#5d7286'],
  vertSauge: ['#a7b98f', '#8aa276', '#6f8c5f'],
  ocre: ['#d9a85b', '#c99248', '#e6bf7c'],
  rougeFane: ['#b4483c', '#983a33', '#c8665a'],
  ardoise: ['#5c6470', '#4a525d', '#737c88'],
  boisChaud: ['#8a5a3b', '#6e4630', '#a6744f'],
  feuillage: ['#6a9a4c', '#58884a', '#7fae5a', '#4c7a40'],
  pierre: ['#cfc4b0', '#b7ab96', '#9d927f'],
  fer: ['#33363b', '#24272b'],
  blanc: ['#f6f1e6'],
} as const;

export type PaletteFamily = keyof typeof BUTTERFLY_PALETTE;

const paletteEntries: { family: PaletteFamily; color: THREE.Color; lab: [number, number, number] }[] = [];

function srgbToOklab(c: THREE.Color): [number, number, number] {
  // THREE.Color stores linear components when colour management is enabled.
  const l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  const m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  const s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

for (const [family, list] of Object.entries(BUTTERFLY_PALETTE) as [PaletteFamily, readonly string[]][]) {
  for (const hex of list) {
    const color = new THREE.Color(hex);
    paletteEntries.push({ family, color, lab: srgbToOklab(color) });
  }
}

/** Material-name hints for imported packs (checked before colour distance). */
const NAME_HINTS: [RegExp, PaletteFamily, number][] = [
  [/leaf|leaves|foliage|grass|bush|plant/i, 'feuillage', 0],
  [/bark|trunk/i, 'boisChaud', 0],
  [/rooftiles_red|roof_red/i, 'brique', 0],
  [/rooftile|roof/i, 'ardoise', 0],
  [/plaster|beige/i, 'creme', 0],
  [/stone_dark/i, 'pierre', 2],
  [/stone_light/i, 'pierre', 0],
  [/^stone$|rock|stone/i, 'pierre', 1],
  [/darkwood/i, 'boisChaud', 1],
  [/wood_side|wood_light/i, 'boisChaud', 2],
  [/wood/i, 'boisChaud', 0],
  [/window|glass/i, 'ardoise', 1],
  [/metal|pole|iron|green\.|^green/i, 'fer', 0],
];

/** Snap a colour to the nearest palette entry (OKLab distance), optionally restricted to a family. */
export function remapColor(src: THREE.Color, out = new THREE.Color(), family?: PaletteFamily): THREE.Color {
  const lab = srgbToOklab(src);
  let best = paletteEntries[0];
  let bestD = Infinity;
  for (const e of paletteEntries) {
    if (family && e.family !== family) continue;
    const d = (e.lab[0] - lab[0]) ** 2 * 0.6 + (e.lab[1] - lab[1]) ** 2 + (e.lab[2] - lab[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return out.copy(best.color);
}

/** Palette colour for an imported material (name hints first, then nearest colour). */
export function paletteFor(name: string, color: THREE.Color, out = new THREE.Color()): THREE.Color {
  for (const [re, family, idx] of NAME_HINTS) {
    if (re.test(name)) {
      const list = BUTTERFLY_PALETTE[family];
      return out.set(list[Math.min(idx, list.length - 1)]);
    }
  }
  return remapColor(color, out);
}

/**
 * Replace an imported material's colour by the palette and normalise its
 * response (roughness ~0.8, no metalness, no textures).
 */
export function remapMaterial(m: THREE.Material): THREE.MeshStandardMaterial {
  const src = m as THREE.MeshStandardMaterial;
  const out = new THREE.MeshStandardMaterial({
    name: src.name,
    color: paletteFor(src.name ?? '', src.color ?? new THREE.Color('#cccccc')),
    roughness: 0.8,
    metalness: 0,
    side: src.side,
    transparent: src.transparent,
    opacity: src.opacity,
  });
  return out;
}
