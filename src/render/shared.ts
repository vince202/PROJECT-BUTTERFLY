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
import { CITY_HEIGHT, CITY_WIDTH } from '../sim/city';

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
