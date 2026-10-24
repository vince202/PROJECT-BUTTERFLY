/**
 * Architecture kit: everything needed to assemble the town procedurally.
 *
 *  - Batches: one StaticBatch per surface (plaster, brick, roof tiles...).
 *    Each batch becomes a single merged mesh with a shared surface material,
 *    so the whole town is drawn with a dozen draw calls.
 *  - WindowSet: every window of the town as instances (frames per style,
 *    glass panes with a per-instance emissive colour for the night glow,
 *    shutters with a per-instance colour).
 *  - SignAtlas: shop fascias, blade signs and plaques drawn into one canvas
 *    texture and merged into one mesh.
 *  - house(): a parametric European house (10 presets in `presets.ts`):
 *    plinth, walls, string courses, cornice, gable / hip / mansard / flat /
 *    stepped roofs with thickness and overhangs, dormers, chimneys, half
 *    timbering with a jettied upper floor, balconies, shutters, flower boxes,
 *    ivy, shopfronts with striped awnings, arched doors and door lamps.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ChunkedBatch, StaticBatch, hipRoofGeometry, mansardGeometry } from './batch';
import { type Surface, surfaceMaterial, litWindowMaterial } from './materials';
import { shade } from './shared';

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

export const PAL = {
  walls: ['#efe3cb', '#e9cf9f', '#e8b98a', '#dca77c', '#e7c6b5', '#d8c3a5', '#c9d3bd', '#b9cad6', '#ead9b0', '#f1e8d8', '#d9b0a0', '#c7b9d3'],
  stone: '#d9cdb6',
  stoneDark: '#b8ab95',
  roofs: ['#b8573c', '#c4683f', '#a94d35', '#bf5f45', '#9e4632'],
  slate: '#5e6672',
  zinc: '#7f8891',
  trim: '#f4eee2',
  timber: '#5a3d2b',
  wood: '#8a5a3b',
  woodDark: '#5c3f2c',
  iron: '#2f3236',
  shutters: ['#6f8f6a', '#5f7f9e', '#8a4b4b', '#7f9fa0', '#b78b4a', '#6a6f8f'],
  doors: ['#6b3f2e', '#3f5d4a', '#2f4a66', '#7a2f2f', '#5a4a3a'],
  brick: '#b0634a',
  flowers: ['#ff6fa8', '#ffd23f', '#e84a5f', '#c77dff', '#ffffff', '#ff8c42'],
  leaf: '#5f9a48',
  leafDark: '#4a7f3a',
  awnings: [
    ['#c0392b', '#f6efe3'],
    ['#2f6fa8', '#f4f1e8'],
    ['#4f8a4a', '#f4f1e8'],
    ['#e0a526', '#fbf3dd'],
    ['#7a1f2b', '#f3e9d8'],
  ] as [string, string][],
};

/** Desaturate and soften a colour (used for the calm outer districts). */
export function calm(color: string, k = 0.45): string {
  const c = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s * (1 - k), Math.min(0.92, hsl.l * (1 - k * 0.1) + k * 0.08));
  return `#${c.getHexString()}`;
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

export type BatchKey = Surface | 'metal' | 'glow' | 'bulb' | 'glass' | 'clothSoft' | 'winLit';

let bulbMaterial: THREE.MeshBasicMaterial | null = null;
/** Shared emissive material of every lamp bulb (colour animated by the lighting rig). */
export function bulbMat(): THREE.MeshBasicMaterial {
  if (!bulbMaterial) bulbMaterial = new THREE.MeshBasicMaterial({ color: '#d9d4c4', toneMapped: false });
  return bulbMaterial;
}
let glowMaterial: THREE.MeshBasicMaterial | null = null;
export function glowMat(): THREE.MeshBasicMaterial {
  if (!glowMaterial) glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  return glowMaterial;
}

export function materialFor(key: BatchKey): THREE.Material {
  switch (key) {
    case 'metal':
      return surfaceMaterial('plain', { roughness: 0.45, metalness: 0.35 });
    case 'glass':
      return surfaceMaterial('plain', { roughness: 0.15, metalness: 0.2 });
    case 'winLit':
      return litWindowMaterial();
    case 'glow':
      return glowMat();
    case 'bulb':
      return bulbMat();
    case 'clothSoft':
      return surfaceMaterial('plain', { roughness: 0.95, side: THREE.DoubleSide });
    case 'roof':
      return surfaceMaterial('roof', { roughness: 0.78 });
    case 'plain':
      return surfaceMaterial('plain', { roughness: 0.62 });
    case 'foliage':
      return surfaceMaterial('foliage', { roughness: 0.9, sway: 0.006 });
    case 'cobble':
    case 'paving':
    case 'asphalt':
    case 'gravel':
      return surfaceMaterial(key, { roughness: 0.92, wet: 1 });
    case 'grass':
      return surfaceMaterial('grass', { roughness: 0.95, wet: 0.5 });
    default:
      return surfaceMaterial(key);
  }
}

const SHADOWLESS = new Set<BatchKey>(['glow', 'bulb', 'cobble', 'paving', 'asphalt', 'grass', 'gravel']);

export class Batches {
  private map = new Map<BatchKey, StaticBatch>();
  /**
   * @param litKey group of the lit-window material used for imported window panes
   * @param chunk optional spatial chunking (merged meshes per region, frustum-culled)
   */
  constructor(public litKey = 'homes', private chunk?: (x: number, z: number) => string) {}
  get(k: BatchKey): StaticBatch {
    let b = this.map.get(k);
    if (!b) {
      b = this.chunk ? new ChunkedBatch(this.chunk) : new StaticBatch();
      this.map.set(k, b);
    }
    return b;
  }
  get plaster() { return this.get('plaster'); }
  get brick() { return this.get('brick'); }
  get stone() { return this.get('stone'); }
  get roof() { return this.get('roof'); }
  get trim() { return this.get('plain'); }
  get wood() { return this.get('wood'); }
  get metal() { return this.get('metal'); }
  get cloth() { return this.get('clothSoft'); }
  get leaf() { return this.get('foliage'); }
  get glow() { return this.get('glow'); }
  get bulb() { return this.get('bulb'); }
  wall(s: 'plaster' | 'brick' | 'stone'): StaticBatch { return this.get(s); }
  /** Gravel deck of a flat roof. */
  gravel_deck(x: number, y: number, z: number, sx: number, sz: number, frame: THREE.Matrix4): void {
    this.get('gravel').box(x, y, z, sx, 0.12, sz, '#77726a', 0, frame);
  }
  /** Small glazed transom above a door. */
  glass_transom(u: number, v: number, w: number, frame: THREE.Matrix4): void {
    this.get('glass').box(u, v - 0.4, 0.1, w, 0.55, 0.1, '#3d4f60', 0, frame);
  }

  /** Merge every batch into a mesh with its shared material. */
  build(opts: { shadows?: boolean } = {}): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [k, b] of this.map) {
      const geos = b instanceof ChunkedBatch ? b.buildChunks() : [b.build()];
      for (const g of geos) {
        if (!g) continue;
        const m = new THREE.Mesh(g, k === 'winLit' ? litWindowMaterial(this.litKey) : materialFor(k));
        const cast = opts.shadows !== false && !SHADOWLESS.has(k);
        m.castShadow = cast;
        m.receiveShadow = k !== 'glow' && k !== 'bulb';
        m.name = `batch:${k}`;
        out.push(m);
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

export type WindowStyle = 'tall' | 'square' | 'small' | 'arch' | 'shop' | 'office' | 'dormer' | 'wide' | 'round';

interface StyleDef {
  w: number;
  h: number;
  glass: 'rect' | 'arch' | 'round';
  mullion: 'cross' | 'vert' | 'transom' | 'office' | 'grid' | 'none';
  shutters: boolean;
  sill: boolean;
}

export const WINDOW_STYLES: Record<WindowStyle, StyleDef> = {
  tall: { w: 1.5, h: 2.6, glass: 'rect', mullion: 'cross', shutters: true, sill: true },
  square: { w: 1.7, h: 1.9, glass: 'rect', mullion: 'cross', shutters: true, sill: true },
  small: { w: 1.15, h: 1.4, glass: 'rect', mullion: 'vert', shutters: true, sill: true },
  arch: { w: 1.7, h: 2.9, glass: 'arch', mullion: 'vert', shutters: false, sill: true },
  shop: { w: 3.6, h: 3.0, glass: 'rect', mullion: 'transom', shutters: false, sill: false },
  office: { w: 3.0, h: 2.7, glass: 'rect', mullion: 'office', shutters: false, sill: false },
  dormer: { w: 1.15, h: 1.5, glass: 'rect', mullion: 'cross', shutters: false, sill: false },
  wide: { w: 3.4, h: 2.6, glass: 'rect', mullion: 'grid', shutters: false, sill: true },
  round: { w: 1.4, h: 1.4, glass: 'round', mullion: 'cross', shutters: false, sill: false },
};

function boxAt(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  const n = g.toNonIndexed();
  g.dispose();
  return n;
}

/** Frame geometry of a window style, local: centre at origin, wall plane z = 0, facing +z. */
function frameGeometry(st: StyleDef): THREE.BufferGeometry {
  const { w, h } = st;
  const t = st.mullion === 'office' ? 0.1 : 0.14;
  const d = 0.16;
  const parts: THREE.BufferGeometry[] = [];
  const zc = d / 2;
  if (st.glass === 'round') {
    const ring = new THREE.TorusGeometry(w / 2, 0.12, 4, 14);
    ring.translate(0, 0, zc);
    parts.push(ring.toNonIndexed());
    parts.push(boxAt(w, 0.07, 0.06, 0, 0, 0.06), boxAt(0.07, h, 0.06, 0, 0, 0.06));
  } else {
    const hr = st.glass === 'arch' ? h - w / 2 : h;
    const y0 = -h / 2;
    // Outer frame
    parts.push(boxAt(t, hr, d, -w / 2 - t / 2, y0 + hr / 2, zc));
    parts.push(boxAt(t, hr, d, w / 2 + t / 2, y0 + hr / 2, zc));
    parts.push(boxAt(w + t * 2, t, d, 0, y0 - t / 2, zc));
    if (st.glass === 'arch') {
      const arc = new THREE.TorusGeometry(w / 2 + t / 2, t / 2, 4, 10, Math.PI);
      arc.translate(0, y0 + hr, zc);
      parts.push(arc.toNonIndexed());
      // Keystone
      parts.push(boxAt(0.4, 0.5, d + 0.06, 0, y0 + hr + w / 2 + 0.1, zc + 0.03));
    } else parts.push(boxAt(w + t * 2, t * 1.4, d + 0.04, 0, h / 2 + t * 0.7, zc + 0.02));
    // Mullions
    const m = 0.07;
    if (st.mullion === 'cross') {
      parts.push(boxAt(m, h, 0.08, 0, 0, 0.05));
      parts.push(boxAt(w, m, 0.08, 0, h * 0.18, 0.05));
    } else if (st.mullion === 'vert') {
      parts.push(boxAt(m, hr, 0.08, 0, y0 + hr / 2, 0.05));
    } else if (st.mullion === 'transom') {
      parts.push(boxAt(w, 0.12, 0.08, 0, h / 2 - 0.7, 0.05));
      parts.push(boxAt(0.1, h, 0.08, 0, 0, 0.05));
    } else if (st.mullion === 'grid') {
      for (const u of [-w / 4, 0, w / 4]) parts.push(boxAt(m, h, 0.08, u, 0, 0.05));
      parts.push(boxAt(w, m, 0.08, 0, 0, 0.05));
    } else if (st.mullion === 'office') {
      parts.push(boxAt(0.08, h, 0.08, 0, 0, 0.05));
    }
    if (st.sill) parts.push(boxAt(w + 0.5, 0.16, 0.42, 0, y0 - t - 0.08, 0.21));
  }
  const g = mergeGeometries(parts.map((p) => { const q = p.index ? p.toNonIndexed() : p; for (const k of Object.keys(q.attributes)) if (k !== 'position' && k !== 'normal') q.deleteAttribute(k); return q; }), false)!;
  return g;
}

function shutterGeometry(st: StyleDef): THREE.BufferGeometry {
  const pw = st.w * 0.5 + 0.08;
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const u = s * (st.w / 2 + 0.16 + pw / 2);
    parts.push(boxAt(pw, st.h, 0.08, u, 0, 0.06));
    for (const f of [0.33, 0.66]) parts.push(boxAt(pw - 0.1, 0.06, 0.05, u, -st.h / 2 + st.h * f, 0.12));
  }
  return mergeGeometries(parts, false)!;
}

function glassGeometry(kind: 'rect' | 'arch' | 'round'): THREE.BufferGeometry {
  if (kind === 'rect') return new THREE.PlaneGeometry(1, 1);
  if (kind === 'round') return new THREE.CircleGeometry(0.5, 14);
  // Unit arch: width 1, height 1; the arch radius is in the instance scale (w / h).
  const sh = new THREE.Shape();
  // Built for a nominal aspect; per-instance scaling stretches it (ok for 1.7 x 2.9).
  const r = 0.5;
  const hr = 1 - (r * 1.7) / 2.9;
  sh.moveTo(-0.5, -0.5);
  sh.lineTo(0.5, -0.5);
  sh.lineTo(0.5, -0.5 + hr);
  sh.absellipse(0, -0.5 + hr, 0.5, 1 - hr, 0, Math.PI, false);
  sh.lineTo(-0.5, -0.5);
  return new THREE.ShapeGeometry(sh, 8);
}

interface WinInstance {
  /** Glass only (calm outer districts): no frame, no shutters. */
  bare: boolean;
  style: WindowStyle;
  matrix: THREE.Matrix4;
  trim: THREE.Color;
  shutter: THREE.Color | null;
  owner: number;
  seed: number;
}

/** Owner of windows: a location (lit according to its hours) or a filler house. */
export interface WindowOwner {
  id: string;
  kind: string;
}

export class WindowSet {
  list: WinInstance[] = [];
  owners: WindowOwner[] = [];
  /** When true, windows added are glass only (set by the house builder for calm massing). */
  bare = false;
  private ownerIdx = new Map<string, number>();

  owner(id: string, kind: string): number {
    let i = this.ownerIdx.get(id);
    if (i === undefined) {
      i = this.owners.length;
      this.owners.push({ id, kind });
      this.ownerIdx.set(id, i);
    }
    return i;
  }

  add(style: WindowStyle, frame: THREE.Matrix4, u: number, v: number, owner: number, seed: number, trim: string, shutter: string | null): void {
    const m = new THREE.Matrix4().makeTranslation(u, v, 0).premultiply(frame);
    this.list.push({ bare: this.bare, style, matrix: m, trim: new THREE.Color(trim), shutter: shutter && WINDOW_STYLES[style].shutters ? new THREE.Color(shutter) : null, owner, seed });
  }

  /** Instanced meshes: frames per style, glass per shape, shutters per style. */
  build(): { meshes: THREE.Mesh[]; glass: THREE.InstancedMesh[]; glassOwner: Int32Array[]; glassSeed: Float32Array[] } {
    const meshes: THREE.Mesh[] = [];
    const glass: THREE.InstancedMesh[] = [];
    const glassOwner: Int32Array[] = [];
    const glassSeed: Float32Array[] = [];
    const frameMat = surfaceMaterial('plain', { roughness: 0.6 });
    const shutterMat = surfaceMaterial('wood', { roughness: 0.75 });
    const byStyle = new Map<WindowStyle, WinInstance[]>();
    for (const w of this.list) {
      if (w.bare) continue;
      if (!byStyle.has(w.style)) byStyle.set(w.style, []);
      byStyle.get(w.style)!.push(w);
    }
    const tmp = new THREE.Matrix4();
    const scale = new THREE.Matrix4();
    for (const [style, items] of byStyle) {
      const st = WINDOW_STYLES[style];
      const fg = frameGeometry(st);
      const fm = new THREE.InstancedMesh(fg, frameMat, items.length);
      items.forEach((w, i) => {
        fm.setMatrixAt(i, w.matrix);
        fm.setColorAt(i, w.trim);
      });
      fm.receiveShadow = true;
      fm.castShadow = false;
      fm.computeBoundingSphere();
      meshes.push(fm);
      const sh = items.filter((w) => w.shutter);
      if (sh.length) {
        const sm = new THREE.InstancedMesh(shutterGeometry(st), shutterMat, sh.length);
        sh.forEach((w, i) => {
          sm.setMatrixAt(i, w.matrix);
          sm.setColorAt(i, w.shutter!);
        });
        sm.receiveShadow = true;
        sm.computeBoundingSphere();
        meshes.push(sm);
      }
    }
    // Glass: one instanced mesh per glass shape.
    for (const kind of ['rect', 'arch', 'round'] as const) {
      const items = this.list.filter((w) => WINDOW_STYLES[w.style].glass === kind);
      if (!items.length) continue;
      const gm = new THREE.InstancedMesh(glassGeometry(kind), glassMaterial(), items.length);
      gm.name = `glass:${kind}`;
      const own = new Int32Array(items.length);
      const seeds = new Float32Array(items.length);
      const black = new THREE.Color(0, 0, 0);
      items.forEach((w, i) => {
        const st = WINDOW_STYLES[w.style];
        scale.makeScale(st.w, st.h, 1).setPosition(0, 0, 0.04);
        tmp.multiplyMatrices(w.matrix, scale);
        gm.setMatrixAt(i, tmp);
        gm.setColorAt(i, black);
        own[i] = w.owner;
        seeds[i] = w.seed;
      });
      gm.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      gm.receiveShadow = true;
      gm.computeBoundingSphere();
      glass.push(gm);
      glassOwner.push(own);
      glassSeed.push(seeds);
    }
    return { meshes, glass, glassOwner, glassSeed };
  }
}

let glassMat: THREE.MeshStandardMaterial | null = null;
/**
 * Window glass: dark bluish, glossy, with a fake sky reflection and the
 * instance colour used as emitted light (warm interiors at night).
 */
export function glassMaterial(): THREE.MeshStandardMaterial {
  if (glassMat) return glassMat;
  const m = new THREE.MeshStandardMaterial({ color: '#4a5d70', roughness: 0.18, metalness: 0.1 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSky = U_SKY;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvGUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSky;\nvarying vec2 vGUv;')
      .replace('#include <color_fragment>', '')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float fres = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 2.0);
  // Diagonal sheen + sky reflection by day.
  float sheen = smoothstep(0.35, 0.5, fract(vGUv.x * 0.7 + vGUv.y * 0.9)) * 0.12;
  totalEmissiveRadiance += uSky * (0.16 + 0.4 * fres + sheen);
  #ifdef USE_COLOR
  // Lit interior: warm, brighter at the bottom, a soft curtain edge on the sides.
  float curtain = smoothstep(0.0, 0.18, vGUv.x) * smoothstep(1.0, 0.82, vGUv.x);
  totalEmissiveRadiance += vColor.rgb * (0.65 + 0.45 * (1.0 - vGUv.y)) * mix(0.55, 1.0, curtain);
  #endif
}`,
      );
  };
  m.customProgramCacheKey = () => 'bf-glass';
  glassMat = m;
  return m;
}
/** Sky colour uniform shared with the glass (set by the lighting rig). */
export const U_SKY = { value: new THREE.Color('#9fbfdc') };

// ---------------------------------------------------------------------------
// Sign atlas
// ---------------------------------------------------------------------------

export interface SignStyle {
  bg: string;
  fg: string;
  font?: 'serif' | 'sans' | 'script';
  border?: string;
  /** Transparent background (painted lettering). */
  clear?: boolean;
}

/** Sign materials (their glow follows the night, see Lighting). */
export const SIGN_MATERIALS = new Set<THREE.MeshStandardMaterial>();

const ATLAS_W = 2048;
const ATLAS_H = 2048;
const CELL_W = 1024;
const CELL_H = 128;

export class SignAtlas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  private n = 0;
  private pos: number[] = [];
  private nrm: number[] = [];
  private uv: number[] = [];
  private cache = new Map<string, [number, number, number, number]>();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS_W;
    this.canvas.height = ATLAS_H;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.clearRect(0, 0, ATLAS_W, ATLAS_H);
  }

  /** Draw a sign into the next free cell; returns its uv rect [u0, v0, u1, v1]. */
  cell(text: string, s: SignStyle): [number, number, number, number] {
    const key = `${text}|${s.bg}|${s.fg}|${s.font}|${s.clear}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const cols = ATLAS_W / CELL_W;
    const i = this.n++;
    const x = (i % cols) * CELL_W;
    const y = Math.floor(i / cols) * CELL_H;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    if (!s.clear) {
      ctx.fillStyle = s.bg;
      ctx.fillRect(0, 0, CELL_W, CELL_H);
      ctx.strokeStyle = s.border ?? 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 6;
      ctx.strokeRect(10, 10, CELL_W - 20, CELL_H - 20);
    }
    const family = s.font === 'sans' ? '"Helvetica Neue", Arial, sans-serif' : s.font === 'script' ? '"Brush Script MT", "Segoe Script", cursive' : 'Georgia, "Times New Roman", serif';
    const weight = s.font === 'script' ? 400 : 700;
    let size = CELL_H * 0.6;
    ctx.font = `${s.font === 'serif' || !s.font ? 'italic ' : ''}${weight} ${size}px ${family}`;
    while (ctx.measureText(text).width > CELL_W * 0.88 && size > 12) {
      size -= 2;
      ctx.font = `${s.font === 'serif' || !s.font ? 'italic ' : ''}${weight} ${size}px ${family}`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (s.clear) {
      ctx.lineWidth = 8;
      ctx.strokeStyle = s.bg;
      ctx.strokeText(text, CELL_W / 2, CELL_H / 2 + 4);
    }
    ctx.fillStyle = s.fg;
    ctx.fillText(text, CELL_W / 2, CELL_H / 2 + 4);
    ctx.restore();
    const rect: [number, number, number, number] = [x / ATLAS_W, 1 - (y + CELL_H) / ATLAS_H, (x + CELL_W) / ATLAS_W, 1 - y / ATLAS_H];
    this.cache.set(key, rect);
    return rect;
  }

  /**
   * Add a sign quad centred at local (u, v, w) of `frame`, facing local +z.
   * The text keeps the 8:1 cell aspect inside `width` x `height` (cropped horizontally).
   */
  quad(frame: THREE.Matrix4, u: number, v: number, w: number, width: number, height: number, text: string, s: SignStyle, doubleSided = false): void {
    const r = this.cell(text, s);
    // Crop the cell horizontally to the quad aspect so the text is not stretched.
    const aspect = width / height;
    const cellAspect = CELL_W / CELL_H;
    let [u0, v0, u1, v1] = r;
    if (aspect < cellAspect) {
      const keep = aspect / cellAspect;
      const mid = (u0 + u1) / 2;
      const half = ((u1 - u0) * keep) / 2;
      u0 = mid - half;
      u1 = mid + half;
    } else {
      const keep = cellAspect / aspect;
      const mid = (v0 + v1) / 2;
      const half = ((v1 - v0) * keep) / 2;
      v0 = mid - half;
      v1 = mid + half;
    }
    const faces = doubleSided ? [1, -1] : [1];
    for (const side of faces) {
      const hw = width / 2;
      const hh = height / 2;
      const zz = w + side * 0.01;
      const corners = side > 0
        ? [[-hw, -hh, u0, v0], [hw, -hh, u1, v0], [hw, hh, u1, v1], [-hw, hh, u0, v1]]
        : [[hw, -hh, u0, v0], [-hw, -hh, u1, v0], [-hw, hh, u1, v1], [hw, hh, u0, v1]];
      const p = corners.map(([x, y]) => new THREE.Vector3(u + x, v + y, zz).applyMatrix4(frame));
      const n = new THREE.Vector3(0, 0, side).transformDirection(frame);
      const order = [0, 1, 2, 0, 2, 3];
      for (const k of order) {
        this.pos.push(p[k].x, p[k].y, p[k].z);
        this.nrm.push(n.x, n.y, n.z);
        this.uv.push(corners[k][2], corners[k][3]);
      }
    }
  }

  build(): THREE.Mesh | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    const tex = new THREE.CanvasTexture(this.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.05, roughness: 0.7, transparent: true, alphaTest: 0.3 });
    SIGN_MATERIALS.add(mat);
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'signs';
    mesh.receiveShadow = true;
    return mesh;
  }
}

// ---------------------------------------------------------------------------
// Build context shared by houses, civic buildings and props
// ---------------------------------------------------------------------------

export interface Emitters {
  /** Chimney tops (smoke). */
  smoke: THREE.Vector3[];
  /** Door / wall lamps (halo + bulb). */
  lamps: THREE.Vector3[];
}

export interface Ctx {
  b: Batches;
  win: WindowSet;
  signs: SignAtlas;
  emit: Emitters;
  rnd: () => number;
}

/** Frame matrix: rotation about Y then translation. */
export function frameAt(x: number, z: number, rotY: number, parent?: THREE.Matrix4): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, 0, z);
  if (parent) m.premultiply(parent);
  return m;
}

export interface FacadeL {
  frame: THREE.Matrix4;
  length: number;
  side: 'front' | 'back' | 'left' | 'right';
}

/** Four facade frames of a box (w along x, d along z) centred at local (cx, cz) of `parent`. */
export function facades(parent: THREE.Matrix4, cx: number, cz: number, w: number, d: number): FacadeL[] {
  const mk = (x: number, z: number, rot: number, length: number, side: FacadeL['side']): FacadeL => ({ frame: frameAt(cx + x, cz + z, rot, parent), length, side });
  return [
    mk(0, d / 2, 0, w, 'front'),
    mk(0, -d / 2, Math.PI, w, 'back'),
    mk(w / 2, 0, Math.PI / 2, d, 'right'),
    mk(-w / 2, 0, -Math.PI / 2, d, 'left'),
  ];
}

// ---------------------------------------------------------------------------
// The parametric house
// ---------------------------------------------------------------------------

export type RoofKind = 'gable' | 'gableFront' | 'hip' | 'mansard' | 'flat' | 'stepped' | 'pyramid';

export interface Shopfront {
  sign?: string;
  signStyle?: SignStyle;
  awning?: [string, string] | null;
  blade?: string;
  /** Door offset along the front (default 0). */
  doorU?: number;
  windows?: WindowStyle;
}

export interface HouseSpec {
  width: number;
  depth: number;
  /** Upper floors above the ground floor. */
  floors: number;
  groundH?: number;
  floorH?: number;
  wall: string;
  wallSurface?: 'plaster' | 'brick' | 'stone';
  trim?: string;
  shutter?: string | null;
  roof: RoofKind;
  roofColor: string;
  /** Roof rise / half span (gable steepness). */
  pitch?: number;
  dormers?: number;
  chimneys?: number;
  timber?: string | null;
  jetty?: boolean;
  balcony?: 'none' | 'juliet' | 'continuous';
  shop?: Shopfront | null;
  door?: { u: number; color?: string; arched?: boolean } | null;
  hide?: { left?: boolean; right?: boolean; back?: boolean };
  /** 2 = hero (full detail), 1 = medium, 0 = calm outer massing. */
  detail: 0 | 1 | 2;
  owner: number;
  win?: WindowStyle;
  flowerBoxes?: boolean;
  ivy?: boolean;
  quoins?: boolean;
  smoke?: boolean;
  /** Extra rows of windows under a mansard roof (dormer storey). */
  sideWindows?: boolean;
}

export interface HouseResult {
  /** Height of the eaves (top of walls). */
  eaves: number;
  /** Highest point of the roof. */
  top: number;
}

/**
 * Build one house at `frame` (local origin = footprint centre at ground level,
 * local +z = front facing the street).
 */
export function house(ctx: Ctx, frame: THREE.Matrix4, s: HouseSpec): HouseResult {
  const { b, win, rnd } = ctx;
  const prevBare = win.bare;
  win.bare = s.detail === 0;
  const W = s.width;
  const D = s.depth;
  const gH = s.groundH ?? (s.shop ? 5.4 : 4.8);
  const fH = s.floorH ?? 3.9;
  const H = gH + s.floors * fH;
  const trim = s.trim ?? PAL.trim;
  const wallS = s.wallSurface ?? 'plaster';
  const wb = b.wall(wallS);
  const detail = s.detail;
  const jet = s.jetty && s.floors > 0 ? 0.6 : 0;

  // --- Body ------------------------------------------------------------------
  b.stone.box(0, 0, 0, W + 0.3, 0.9, D + 0.3, PAL.stoneDark, 0, frame);
  if (jet) {
    wb.box(0, 0, 0, W, gH, D, s.wall, 0, frame);
    wb.box(0, gH, jet / 2, W, H - gH, D + jet, s.wall, 0, frame);
    b.wood.box(0, gH - 0.35, D / 2 + jet / 2, W + 0.1, 0.45, jet + 0.1, s.timber ?? PAL.timber, 0, frame);
  } else wb.box(0, 0, 0, W, H, D, s.wall, 0, frame);
  // Cornice under the eaves
  if (s.roof !== 'flat') b.trim.box(0, H - 0.45, jet / 2, W + 0.35, 0.45, D + jet + 0.35, trim, 0, frame);
  // String courses
  if (detail >= 1 && !s.timber) {
    for (let k = 1; k <= s.floors; k++) {
      const v = gH + (k - 1) * fH;
      b.trim.box(0, v - 0.12, 0, W + 0.22, 0.24, D + 0.22, shade(trim, 0.97), 0, frame);
    }
  }
  // Corner quoins
  if (s.quoins && detail === 2) {
    for (const [x, z] of [[-W / 2, D / 2], [W / 2, D / 2], [-W / 2, -D / 2], [W / 2, -D / 2]]) {
      for (let v = 1.0, i = 0; v < H - 0.8; v += 0.7, i++) {
        const big = i % 2 === 0;
        b.stone.box(x, v, z, big ? 1.0 : 0.6, 0.6, big ? 0.6 : 1.0, PAL.stone, 0, frame);
      }
    }
  }

  // --- Roof ----------------------------------------------------------------------
  let top = H;
  const ov = 0.75;
  const roofC = s.roofColor;
  const Dj = D + jet;
  const zc = jet / 2;
  if (s.roof === 'gable' || s.roof === 'gableFront' || s.roof === 'stepped') {
    const front = s.roof !== 'gable';
    const span = front ? W : Dj;
    const len = front ? Dj : W;
    const half = span / 2;
    const rise = half * (s.pitch ?? 0.95);
    const th = Math.atan2(rise, half);
    const slabT = 0.42;
    const slopeL = (half + ov) / Math.cos(th) + 0.2;
    // Gable walls (wall colour) inside the roof
    if (front) wb.prism(0, H, zc, W, rise, Dj, s.wall, false, frame);
    else wb.prism(0, H, zc, W, rise, Dj, s.wall, true, frame);
    for (const sgn of [-1, 1]) {
      const cAcross = sgn * ((half + ov) / 2 - 0.1);
      const cy = H + rise - ((half + ov) / 2 - 0.1) * Math.tan(th);
      const nx = Math.sin(th) * slabT * 0.5;
      const ny = Math.cos(th) * slabT * 0.5;
      if (front) {
        b.roof.shape('box', cAcross + sgn * nx, cy + ny, zc, slopeL, slabT, len + ov * 2 - (s.roof === 'stepped' ? ov * 2 - 0.2 : 0), roofC, { z: -sgn * th }, frame);
      } else {
        b.roof.shape('box', 0, cy + ny, zc + cAcross + sgn * nx, W + ov * 2, slabT, slopeL, roofC, { x: sgn * th }, frame);
      }
    }
    // Ridge cap
    if (front) b.roof.box(0, H + rise - 0.05, zc, 0.6, 0.5, len + (s.roof === 'stepped' ? 0.2 : ov * 2), shade(roofC, 0.82), 0, frame);
    else b.roof.box(0, H + rise - 0.05, zc, W + ov * 2, 0.5, 0.6, shade(roofC, 0.82), 0, frame);
    top = H + rise;
    if (s.roof === 'stepped') {
      // Stepped gable walls standing proud of the roof at both ends.
      for (const sgn of [-1, 1]) wb.shape('stepGable', 0, H - 0.01, zc + sgn * (Dj / 2 - 0.35), W + 0.6, rise + 1.6, 0.7, s.wall, undefined, frame);
      top += 1.6;
    }
    // Gable-end windows (small) when the gable faces the street
    if (front && detail >= 1) {
      const fz = new THREE.Matrix4().makeTranslation(0, 0, zc + Dj / 2).premultiply(frame);
      win.add(rise > 4.5 ? 'square' : 'small', fz, 0, H + rise * 0.38, s.owner, rnd(), trim, null);
      if (detail === 2 && rise > 6) win.add('round', fz, 0, H + rise * 0.72, s.owner, rnd(), trim, null);
    }
    // Dormers on the long slopes
    const nd = s.dormers ?? 0;
    if (nd > 0 && !front) {
      for (const sgn of detail >= 1 ? [1, -1] : [1]) {
        for (let i = 0; i < nd; i++) {
          const u = -W / 2 + (W / nd) * (i + 0.5);
          const zIn = half - 1.5;
          const ySl = H + rise * (1 - zIn / half);
          const df = frameAt(u, zc + sgn * zIn, sgn > 0 ? 0 : Math.PI, frame);
          dormer(ctx, df, ySl, s, trim, roofC);
        }
      }
    }
  } else if (s.roof === 'hip' || s.roof === 'pyramid') {
    const rise = Math.min(W, Dj) * 0.5 * (s.pitch ?? 0.85);
    const g = s.roof === 'pyramid' ? null : hipRoofGeometry(W + ov * 2, Dj + ov * 2, rise + ov * 0.6);
    if (g) b.roof.geo(g, 0, H - ov * 0.6 + 0.1, zc, roofC, 0, frame);
    else b.roof.shape('pyramid', 0, H - ov * 0.6 + 0.1, zc, W + ov * 2, rise + ov * 0.6, Dj + ov * 2, roofC, undefined, frame);
    b.trim.box(0, H - ov * 0.6 - 0.15, zc, W + ov * 2, 0.32, Dj + ov * 2, shade(trim, 0.92), 0, frame);
    top = H + rise + 0.1;
    const nd = s.dormers ?? 0;
    if (nd > 0) {
      for (let i = 0; i < nd; i++) {
        const u = -W / 2 + 2 + ((W - 4) / nd) * (i + 0.5);
        const half = Dj / 2;
        const zIn = half - 1.6;
        const ySl = H + rise * (1 - zIn / half) * 0.95;
        dormer(ctx, frameAt(u, zc + zIn, 0, frame), ySl, s, trim, roofC);
      }
    }
  } else if (s.roof === 'mansard') {
    const h1 = fH * 0.95;
    const inset = 1.5;
    const g = mansardGeometry(W + 0.5, Dj + 0.5, h1, inset, 1.6);
    b.roof.geo(g, 0, H, zc, roofC, 0, frame);
    b.trim.box(0, H - 0.1, zc, W + 0.9, 0.4, Dj + 0.9, trim, 0, frame);
    top = H + h1 + 1.6;
    // Dormers in the steep lower slope (front, back and sides)
    const nd = s.dormers ?? Math.max(1, Math.floor(W / 4));
    for (const sgn of detail >= 1 ? [1, -1] : [1]) {
      for (let i = 0; i < nd; i++) {
        const u = -W / 2 + (W / nd) * (i + 0.5);
        const df = frameAt(u, zc + sgn * (Dj / 2 - 0.4), sgn > 0 ? 0 : Math.PI, frame);
        dormer(ctx, df, H + 0.35, s, trim, roofC, true);
      }
    }
    if (s.sideWindows !== false && detail >= 1) {
      const nds = Math.max(1, Math.floor(Dj / 5));
      for (const sgn of [-1, 1]) {
        for (let i = 0; i < nds; i++) {
          const zz = -Dj / 2 + (Dj / nds) * (i + 0.5);
          dormer(ctx, frameAt(sgn * (W / 2 - 0.4), zc + zz, sgn * Math.PI / 2, frame), H + 0.35, s, trim, roofC, true);
        }
      }
    }
  } else {
    // Flat roof: parapet with coping and a gravel deck.
    const pT = 0.5;
    b.gravel_deck(0, H, zc, W - pT, Dj - pT, frame);
    for (const [x, z, sx, sz] of [[0, Dj / 2 - pT / 2, W, pT], [0, -Dj / 2 + pT / 2, W, pT], [W / 2 - pT / 2, 0, pT, Dj], [-W / 2 + pT / 2, 0, pT, Dj]]) {
      wb.box(x, H, zc + z, sx, 1.0, sz, s.wall, 0, frame);
    }
    b.trim.box(0, H + 1.0, zc, W + 0.3, 0.22, Dj + 0.3, trim, 0, frame);
    top = H + 1.2;
    // Rooftop technical boxes and skylights on large flat roofs.
    if (W * Dj > 300) {
      const n = Math.min(6, Math.floor((W * Dj) / 250));
      for (let i = 0; i < n; i++) {
        const ux = (rnd() - 0.5) * (W - 6);
        const uz = zc + (rnd() - 0.5) * (Dj - 6);
        b.metal.box(ux, H, uz, 2.6 + rnd() * 2, 1.4 + rnd(), 2 + rnd() * 1.5, '#a9adb1', 0, frame);
      }
      if (W > 40) for (let i = 0; i < 3; i++) b.get('glass').box(-W / 4 + (i * W) / 4, H, zc, 4, 0.5, Dj * 0.6, '#7d95a8', 0, frame);
    }
  }

  // Chimneys
  const nCh = s.chimneys ?? (s.roof === 'flat' ? 0 : 1);
  for (let i = 0; i < nCh; i++) {
    const u = (i % 2 === 0 ? -1 : 1) * (W / 2 - 1.4 - rnd() * 1.5);
    const z = zc + (rnd() - 0.5) * Dj * 0.3;
    const h = top - H + 1.8;
    b.brick.box(u, H, z, 1.3, h, 1.1, PAL.brick, 0, frame);
    b.stone.box(u, H + h, z, 1.6, 0.3, 1.4, PAL.stone, 0, frame);
    if (detail >= 1) for (const du of [-0.3, 0.3]) b.brick.cyl(u + du, H + h + 0.3, z, 0.18, 0.5, '#9a5040', false, frame);
    if (s.smoke) ctx.emit.smoke.push(new THREE.Vector3(u, H + h + 0.8, z).applyMatrix4(frame));
  }

  // --- Facades -------------------------------------------------------------------
  const style = s.win ?? 'tall';
  const st = WINDOW_STYLES[style];
  const shutter = detail >= 1 ? s.shutter ?? null : null;
  const fs = facades(frame, 0, 0, W, D);
  const fsUp = jet ? facades(frame, 0, jet / 2, W, D + jet) : fs;
  const doorU = s.shop ? s.shop.doorU ?? 0 : s.door?.u ?? 0;
  for (let fi = 0; fi < 4; fi++) {
    const f = fs[fi];
    const fu = fsUp[fi];
    if (f.side === 'left' && s.hide?.left) continue;
    if (f.side === 'right' && s.hide?.right) continue;
    if (f.side === 'back' && s.hide?.back) continue;
    const isFront = f.side === 'front';
    // Frames and shutters only on hero fronts; glass only elsewhere (cheap).
    win.bare = detail < 2 || !isFront;
    const spacing = st.w + (style === 'office' ? 0.9 : 1.9);
    const ncol = Math.max(1, Math.floor((f.length - 1.2) / spacing));
    // Upper floors
    for (let k = 0; k < s.floors; k++) {
      const v = gH + k * fH + fH * 0.5;
      for (let i = 0; i < ncol; i++) {
        const u = -f.length / 2 + (f.length / ncol) * (i + 0.5);
        win.add(style, fu.frame, u, v, s.owner, rnd(), trim, shutter);
        if (detail === 2 && s.flowerBoxes && isFront && (i + k) % 2 === 0 && k < 2) flowerBox(ctx, fu.frame, u, v - st.h / 2 - 0.2, st.w);
        if (isFront && detail === 2 && s.balcony === 'juliet' && style === 'tall' && (i + k) % 2 === 1) juliet(ctx, fu.frame, u, v - st.h / 2, st.w);
      }
      if (isFront && s.balcony === 'continuous' && (k === 0 || k === s.floors - 1) && detail >= 1) {
        const v0 = gH + k * fH;
        b.stone.box(0, v0 - 0.1, 0.65, f.length + 0.4, 0.28, 1.3, PAL.stone, 0, fu.frame);
        railing(ctx, fu.frame, 0, v0 + 0.18, 1.25, f.length + 0.3);
      }
    }
    // Half-timbering on upper floors
    if (s.timber && s.floors > 0 && detail >= 1) timberFrame(ctx, fu, gH, H, fH, s.floors, ncol, st.w, s.timber);
    // Ground floor
    if (isFront && s.shop) {
      shopfront(ctx, f, s, gH, doorU, trim);
    } else {
      const gstyle: WindowStyle = style === 'office' ? 'office' : style === 'wide' ? 'wide' : style === 'arch' ? 'arch' : 'tall';
      const gst = WINDOW_STYLES[gstyle];
      const gcol = Math.max(1, Math.floor((f.length - 1.2) / (gst.w + 2.0)));
      for (let i = 0; i < gcol; i++) {
        const u = -f.length / 2 + (f.length / gcol) * (i + 0.5);
        if (isFront && s.door && Math.abs(u - doorU) < gst.w / 2 + 1.7) continue;
        win.add(gstyle, f.frame, u, gH * 0.5 + 0.1, s.owner, rnd(), trim, shutter);
      }
      if (isFront && s.door) door(ctx, f.frame, doorU, s.door.color ?? PAL.doors[Math.floor(rnd() * PAL.doors.length)], !!s.door.arched, detail, trim);
    }
    // Ivy climbing a front corner
    if (s.ivy && detail === 2 && isFront) ivy(ctx, f.frame, (rnd() < 0.5 ? -1 : 1) * (f.length / 2 - 0.8), Math.min(H - 1, 4 + rnd() * 6), rnd);
  }
  win.bare = prevBare;
  return { eaves: H, top };
}


/** A dormer window standing on a roof slope; `frame` faces outwards, base at y = yBase. */
function dormer(ctx: Ctx, frame: THREE.Matrix4, yBase: number, s: HouseSpec, trim: string, roofC: string, mansard = false): void {
  const { b, win, rnd } = ctx;
  const w = 2.1;
  const h = 2.3;
  const d = mansard ? 1.6 : 3.2;
  b.plaster.box(0, yBase, -d / 2 + 0.25, w, h, d, mansard ? trim : s.wall, 0, frame);
  if (mansard || rnd() < 0.5) {
    b.roof.prism(0, yBase + h, -d / 2 + 0.25, w + 0.5, 1.1, d + 0.4, roofC, false, frame);
  } else {
    b.roof.shape('barrel', 0, yBase + h - 0.05, -d / 2 + 0.25, w + 0.5, 1.3, d + 0.4, roofC, undefined, frame);
  }
  win.add('dormer', frame, 0, yBase + h * 0.5, s.owner, rnd(), trim, null);
}

function flowerBox(ctx: Ctx, frame: THREE.Matrix4, u: number, v: number, w: number): void {
  const { b, rnd } = ctx;
  b.wood.box(u, v - 0.45, 0.35, w + 0.2, 0.45, 0.55, PAL.woodDark, 0, frame);
  for (let i = 0; i < 3; i++) {
    const x = u - w / 3 + (i * w) / 3;
    b.leaf.shape('dodeca', x, v + 0.05, 0.4, 0.75, 0.6, 0.6, PAL.leaf, { y: rnd() * 3 }, frame);
    b.trim.shape('dodeca', x + 0.1, v + 0.35, 0.5, 0.38, 0.34, 0.38, PAL.flowers[Math.floor(rnd() * PAL.flowers.length)], undefined, frame);
  }
}

function juliet(ctx: Ctx, frame: THREE.Matrix4, u: number, v: number, w: number): void {
  const { b } = ctx;
  b.stone.box(u, v - 0.2, 0.35, w + 0.9, 0.2, 0.7, PAL.stone, 0, frame);
  railing(ctx, frame, u, v, 0.65, w + 0.8);
}

/** A wrought-iron railing along local x centred at u, standing at height v, distance w from the wall. */
export function railing(ctx: Ctx, frame: THREE.Matrix4, u: number, v: number, w: number, len: number, h = 1.0): void {
  const { b } = ctx;
  b.metal.box(u, v + h - 0.06, w, len, 0.1, 0.1, PAL.iron, 0, frame);
  b.metal.box(u, v + 0.1, w, len, 0.06, 0.06, PAL.iron, 0, frame);
  const n = Math.max(2, Math.round(len / 0.65));
  for (let i = 0; i <= n; i++) b.metal.box(u - len / 2 + (len / n) * i, v, w, 0.05, h, 0.05, PAL.iron, 0, frame);
}

function timberFrame(ctx: Ctx, f: FacadeL, gH: number, H: number, fH: number, floors: number, ncol: number, ww: number, color: string): void {
  const { b } = ctx;
  const L = f.length;
  const t = 0.28;
  const z = 0.06;
  for (let k = 0; k <= floors; k++) {
    const v = Math.min(H - 0.5, gH + k * fH);
    b.wood.box(0, v - t / 2, z, L + 0.05, t, 0.14, color, 0, f.frame);
  }
  const posts: number[] = [-L / 2 + t / 2, L / 2 - t / 2];
  for (let i = 0; i < ncol; i++) {
    const u = -L / 2 + (L / ncol) * (i + 0.5);
    posts.push(u - ww / 2 - 0.45, u + ww / 2 + 0.45);
  }
  for (const u of posts) b.wood.box(u, gH, z, t, H - gH - 0.4, 0.14, color, 0, f.frame);
  // Diagonal braces between windows
  for (let k = 0; k < floors; k++) {
    for (let i = 0; i <= ncol; i++) {
      const uA = i === 0 ? -L / 2 : -L / 2 + (L / ncol) * (i - 0.5) + ww / 2 + 0.45;
      const uB = i === ncol ? L / 2 : -L / 2 + (L / ncol) * (i + 0.5) - ww / 2 - 0.45;
      const gap = uB - uA;
      if (gap < 0.9) continue;
      const v0 = gH + k * fH;
      const len = Math.hypot(gap, fH - t);
      const ang = Math.atan2(fH - t, gap) * (i % 2 === 0 ? 1 : -1);
      b.wood.shape('box', (uA + uB) / 2, v0 + fH / 2, z, len, t * 0.8, 0.12, color, { z: ang }, f.frame);
    }
  }
}

/** Front door with surround, step, and a lamp. */
export function door(ctx: Ctx, frame: THREE.Matrix4, u: number, color: string, arched: boolean, detail: number, trim: string, w = 1.9, h = 3.5): void {
  const { b, emit } = ctx;
  b.stone.box(u, 0, 0.55, w + 1.4, 0.32, 1.1, PAL.stone, 0, frame);
  if (arched) {
    b.stone.shape('arch', u, (h + 0.5) / 2, 0.04, w + 0.7, h + 0.5, 0.16, PAL.stone, undefined, frame);
    b.wood.shape('arch', u, h / 2 + 0.1, 0.1, w, h, 0.14, color, undefined, frame);
  } else {
    b.trim.box(u, 0, 0.05, w + 0.6, h + 0.4, 0.14, trim, 0, frame);
    b.wood.box(u, 0.1, 0.1, w, h, 0.14, color, 0, frame);
    if (detail >= 1) b.glass_transom(u, h + 0.45, w, frame);
  }
  b.metal.box(u + w * 0.3, 1.72, 0.24, 0.14, 0.14, 0.14, '#c9a24a', 0, frame);
  if (detail >= 1) {
    const lp = new THREE.Vector3(u + w / 2 + 0.7, 3.4, 0.45).applyMatrix4(frame);
    b.metal.box(u + w / 2 + 0.7, 3.2, 0.25, 0.12, 0.12, 0.5, PAL.iron, 0, frame);
    b.metal.box(u + w / 2 + 0.7, 3.35, 0.45, 0.4, 0.6, 0.4, PAL.iron, 0, frame);
    emit.lamps.push(lp);
  }
}


/** Shop ground floor: pillars, large windows, glazed door, fascia sign, awning, blade sign. */
function shopfront(ctx: Ctx, f: FacadeL, s: HouseSpec, gH: number, doorU: number, trim: string): void {
  const { b, win, signs, rnd } = ctx;
  const sh = s.shop!;
  const L = f.length;
  const F = f.frame;
  const style = sh.windows ?? 'shop';
  const st = WINDOW_STYLES[style];
  const signStyle = sh.signStyle ?? { bg: '#2a3d33', fg: '#f6e7c0' };
  const panel = shade(signStyle.bg, 1.0);
  // Painted wooden shopfront frame
  b.trim.box(0, 0, 0.1, L - 0.6, 0.6, 0.25, panel, 0, F);
  b.trim.box(0, gH - 1.55, 0.12, L - 0.4, 1.3, 0.3, panel, 0, F);
  b.trim.box(0, gH - 0.28, 0.12, L - 0.2, 0.28, 0.45, shade(panel, 0.8), 0, F);
  const n = Math.max(1, Math.floor((L - 2) / (st.w + 1.2)));
  for (let i = 0; i < n; i++) {
    const u = -L / 2 + (L / n) * (i + 0.5);
    if (Math.abs(u - doorU) < st.w / 2 + 1.3) continue;
    win.add(style, F, u, 0.6 + st.h / 2 + 0.05, s.owner, rnd(), panel, null);
  }
  for (let i = 0; i <= n; i++) b.trim.box(-L / 2 + 0.3 + ((L - 0.6) / n) * i, 0, 0.15, 0.45, gH - 1.5, 0.3, panel, 0, F);
  // Glazed door
  b.trim.box(doorU, 0, 0.08, 2.3, 3.7, 0.16, panel, 0, F);
  b.get('glass').box(doorU, 0.15, 0.16, 1.6, 3.2, 0.06, '#33414f', 0, F);
  b.stone.box(doorU, 0, 0.55, 3.2, 0.3, 1.1, PAL.stone, 0, F);
  // Fascia
  if (sh.sign) signs.quad(F, 0, gH - 0.9, 0.3, Math.min(L - 1.2, 1.1 * 9), 1.1, sh.sign, signStyle);
  // Striped awning
  if (sh.awning && s.detail >= 1) awning(ctx, F, 0, L - 1.0, gH - 1.7, sh.awning[0], sh.awning[1]);
  // Blade sign (perpendicular) on a bracket
  if (sh.blade && s.detail === 2) {
    const u = L / 2 - 0.9;
    b.metal.box(u, gH + 1.15, 0.8, 0.08, 0.08, 1.6, PAL.iron, 0, F);
    const bf = frameAt(u, 1.15, Math.PI / 2, F);
    signs.quad(bf, 0, gH + 0.45, 0, 1.3, 1.1, sh.blade, { bg: signStyle.bg, fg: signStyle.fg, font: signStyle.font }, true);
  }
}

/** Striped awning sloping out of a facade (local frame), top edge at height `vTop`. */
export function awning(ctx: Ctx, F: THREE.Matrix4, uc: number, width: number, vTop: number, colA: string, colB: string, depth = 2.6): void {
  const { b } = ctx;
  const drop = 1.1;
  const len = Math.hypot(depth, drop);
  const tilt = Math.atan2(drop, depth);
  const n = Math.max(4, Math.round(width / 0.9));
  const sw = width / n;
  for (let i = 0; i < n; i++) {
    const u = uc - width / 2 + sw * (i + 0.5);
    const col = i % 2 === 0 ? colA : colB;
    b.cloth.shape('box', u, vTop - drop / 2, depth / 2, sw + 0.01, 0.1, len, col, { x: tilt }, F);
    // Scalloped valance
    b.cloth.shape('box', u, vTop - drop - 0.3, depth + 0.02, sw + 0.01, 0.6, 0.06, col, undefined, F);
    b.cloth.shape('cone4', u, vTop - drop - 0.68, depth + 0.02, sw * 0.9, 0.3, 0.06, col, { x: Math.PI, y: Math.PI / 4 }, F);
  }
  // Side cheeks
  for (const sg of [-1, 1]) b.cloth.shape('box', uc + sg * width / 2, vTop - drop * 0.75, depth * 0.55, 0.06, drop * 0.9, depth * 0.9, colA, { x: tilt * 0.5 }, F);
  b.metal.box(uc, vTop - 0.1, 0.1, width + 0.2, 0.15, 0.15, PAL.iron, 0, F);
}

/** Ivy patch climbing a wall from the ground. */
function ivy(ctx: Ctx, F: THREE.Matrix4, u: number, h: number, rnd: () => number): void {
  for (let v = 0.3; v < h; v += 0.9) {
    const spread = 0.8 + (1 - v / h) * 0.9;
    for (let i = 0; i < 2; i++) {
      ctx.b.leaf.shape('dodeca', u + (rnd() - 0.5) * spread * 2, v + rnd() * 0.6, 0.25, 1.1, 1.0, 0.5, rnd() < 0.5 ? PAL.leaf : PAL.leafDark, { y: rnd() }, F);
    }
  }
}
