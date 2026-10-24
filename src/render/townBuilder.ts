/**
 * Town builders (pure functions, no React): composes blocks of houses from
 * the Quaternius medieval houses and the procedural kit, recoloured with the
 * BUTTERFLY palette, plus the detailed lots of the café block (Café Le
 * Papillon, Boulangerie Au Levain d'Or, Fleurs & Sens and Place du Marché).
 */

import * as THREE from 'three';
import { getCity } from '../sim/city';
import { type Ctx, Batches, PAL, SignAtlas, WindowSet, awning, calm, frameAt, house, type HouseSpec } from './kit';
import { CURB_H, type Block, type LotFrame, type Rect, inside, localRect, lotFrames, overlaps, rect, toWorldL } from './layout';
import { type InstanceSpec, type PropName, type Proto, type ModelName, type TexturedProto, chimneyTop, modelMatrix, placeModel } from './models';
import { BUTTERFLY_PALETTE as P, seeded, hashString } from './shared';
import { addSeat } from './seats';
import { addDoor } from './motion';

export const Q_SCALE = 5.5;
const KIT_SCALE = 0.8;

const WALLS = [P.creme[0], P.creme[1], P.creme[2], P.ocre[2], P.vertSauge[0], P.bleuGris[0], P.rougeFane[2], '#e9c9b4', P.ocre[0], P.ocre[1], P.pierre[0], '#d8c0a0', P.vertSauge[1], '#c9b4a8'];
const ROOFS = [P.brique[0], P.brique[1], P.brique[2], P.ardoise[0], P.rougeFane[1], P.ardoise[2], '#8a5a48', P.boisChaud[0], '#9a6f55', P.bleuGris[2]];
const SHUTTERS = [P.vertSauge[1], P.bleuGris[1], P.rougeFane[1], P.boisChaud[0], P.vertSauge[2]];

export interface TownOut {
  b: Batches;
  /** Per-location batches (their own lit-window group). */
  lotBatches: Map<string, Batches>;
  ctx: Ctx;
  instances: Map<ModelName, InstanceSpec[]>;
  textured: Map<PropName, InstanceSpec[]>;
  /** Tree spots (species, x, z, height). */
  trees: { kind: 'treeOak' | 'treeDefault' | 'treeDetailed' | 'treeTall' | 'treeFat'; x: number; z: number; h: number }[];
  bushes: { x: number; z: number; s: number }[];
  /** Countryside trees (cheap, no shadows). */
  farTrees: { kind: 'treeDefault' | 'treeFat'; x: number; z: number; h: number }[];
  /** Wall lanterns (halo positions). */
  lanterns: THREE.Vector3[];
  /** Hover / focus boxes of the locations. */
  pick: { id: string; box: THREE.Box3 }[];
}

export function newTownOut(): TownOut {
  // Town-wide batches are split in six regions so that close-up views (and the
  // tight shadow frustum) only draw what is around the camera.
  const b = new Batches('homes', (x, z) => `${x < 240 ? 0 : x < 480 ? 1 : 2}:${z < 240 ? 0 : 1}`);
  const ctx: Ctx = { b, win: new WindowSet(), signs: new SignAtlas(), emit: { smoke: [], lamps: [] }, rnd: seeded(77) };
  return { b, lotBatches: new Map(), ctx, instances: new Map(), textured: new Map(), trees: [], bushes: [], farTrees: [], lanterns: [], pick: [] };
}

function pushInst<K>(map: Map<K, InstanceSpec[]>, k: K, s: InstanceSpec): void {
  if (!map.has(k)) map.set(k, []);
  map.get(k)!.push(s);
}

const pick = <T,>(rnd: () => number, list: readonly T[]): T => list[Math.floor(rnd() * list.length) % list.length];

// ---------------------------------------------------------------------------
// Houses
// ---------------------------------------------------------------------------

type HouseType = 'q1' | 'q2' | 'kTown' | 'kMansard' | 'kTimber';

interface Footprint {
  type: HouseType;
  /** Along the street, and depth. */
  w: number;
  d: number;
  width?: number;
}

function footprint(type: HouseType, protos: Record<ModelName, Proto>, rnd: () => number): Footprint {
  switch (type) {
    case 'q1':
      return { type, w: protos.house1.size.x * Q_SCALE, d: protos.house1.size.z * Q_SCALE };
    case 'q2':
      return { type, w: protos.house2.size.x * Q_SCALE, d: protos.house2.size.z * Q_SCALE };
    case 'kMansard': {
      const width = 12 + Math.floor(rnd() * 3) * 1.5;
      return { type, w: width * KIT_SCALE, d: 13 * KIT_SCALE, width };
    }
    case 'kTimber': {
      const width = 9 + Math.floor(rnd() * 3);
      return { type, w: width * KIT_SCALE, d: 11 * KIT_SCALE, width };
    }
    default: {
      const width = 9 + Math.floor(rnd() * 4);
      return { type, w: width * KIT_SCALE, d: 11.5 * KIT_SCALE, width };
    }
  }
}

/**
 * Place one house of `fp` whose front centre is at (x, z) facing `rotY`
 * (0 = +z). Returns its world rect.
 */
export function placeHouse(out: TownOut, protos: Record<ModelName, Proto>, fp: Footprint, x: number, z: number, rotY: number, detail: 0 | 1 | 2, seed: number, opts: { wall?: string; roof?: string; shop?: HouseSpec['shop']; owner?: string; batches?: Batches; smoke?: boolean; hide?: HouseSpec['hide'] } = {}): Rect {
  const rnd = seeded(seed);
  const fx = Math.sin(rotY);
  const fz = Math.cos(rotY);
  const cx = x - fx * fp.d / 2;
  const cz = z - fz * fp.d / 2;
  const calmK = detail === 0 ? 0.4 : 0;
  const wall0 = opts.wall ?? (fp.type === 'kMansard' ? pick(rnd, [P.creme[0], P.creme[1], '#efe0c4', P.ocre[2]]) : pick(rnd, WALLS));
  const roof0 = opts.roof ?? pick(rnd, ROOFS);
  const wall = calmK ? calm(wall0, calmK) : wall0;
  const roof = calmK ? calm(roof0, calmK) : roof0;
  const b = opts.batches ?? out.b;
  if (fp.type === 'q1' || fp.type === 'q2') {
    const proto = fp.type === 'q1' ? protos.house1 : protos.house2;
    const m = modelMatrix(proto, cx, CURB_H, cz, rotY, Q_SCALE);
    const roofTint = roof;
    placeModel(b, proto, m, {
      tint: [
        [/plaster|beige/i, wall],
        [/roof/i, roofTint],
        [/^stone$/i, calmK ? calm(P.pierre[1], calmK) : P.pierre[1]],
      ],
    });
    const top = chimneyTop(proto);
    if (top && (opts.smoke ?? rnd() < 0.5) && detail >= 1) out.ctx.emit.smoke.push(top.clone().applyMatrix4(m).add(new THREE.Vector3(0, 0.4, 0)));
  } else {
    const frame = frameAt(cx, cz, rotY).multiply(new THREE.Matrix4().makeScale(KIT_SCALE, KIT_SCALE, KIT_SCALE));
    frame.setPosition(cx, CURB_H, cz);
    const ctx: Ctx = opts.batches ? { ...out.ctx, b: opts.batches } : out.ctx;
    const owner = out.ctx.win.owner(opts.owner ?? `filler:${seed}`, 'home');
    const width = fp.width ?? fp.w / KIT_SCALE;
    const spec: HouseSpec = {
      width,
      depth: fp.d / KIT_SCALE,
      floors: fp.type === 'kMansard' ? 2 + Math.floor(rnd() * 2) : 1 + Math.floor(rnd() * 2),
      wall,
      roof: fp.type === 'kMansard' ? 'mansard' : fp.type === 'kTimber' ? 'gableFront' : rnd() < 0.6 ? 'gable' : 'hip',
      roofColor: fp.type === 'kMansard' ? (calmK ? calm(P.ardoise[0], calmK) : P.ardoise[0]) : roof,
      pitch: fp.type === 'kTimber' ? 1.25 : 0.95,
      dormers: fp.type === 'kMansard' ? Math.max(2, Math.floor(width / 4)) : rnd() < 0.6 ? 2 : 0,
      chimneys: 1 + Math.floor(rnd() * 2),
      shutter: pick(rnd, SHUTTERS),
      timber: fp.type === 'kTimber' ? P.boisChaud[1] : null,
      jetty: fp.type === 'kTimber',
      balcony: fp.type === 'kMansard' ? 'continuous' : rnd() < 0.4 ? 'juliet' : 'none',
      door: opts.shop ? null : { u: (rnd() - 0.5) * (width - 4), arched: rnd() < 0.4 },
      shop: opts.shop ?? null,
      detail,
      owner,
      win: 'tall',
      flowerBoxes: rnd() < 0.6,
      ivy: rnd() < 0.25,
      quoins: fp.type === 'kMansard',
      smoke: detail >= 1 && rnd() < 0.5,
      wallSurface: fp.type === 'kMansard' ? 'stone' : 'plaster',
      trim: P.blanc[0],
      hide: opts.hide,
    };
    house(ctx, frame, spec);
  }
  const ax = Math.abs(fx) > 0.5;
  const hw = (ax ? fp.d : fp.w) / 2;
  const hd = (ax ? fp.w : fp.d) / 2;
  return rect(cx - hw, cz - hd, cx + hw, cz + hd);
}

// ---------------------------------------------------------------------------
// Block perimeter filler
// ---------------------------------------------------------------------------

const TYPES_HERO: HouseType[] = ['q1', 'kTown', 'kMansard', 'q2', 'kTimber', 'kTown', 'kMansard', 'q1', 'kTimber'];
const TYPES_CALM: HouseType[] = ['kTown', 'kMansard', 'kTown', 'kTimber'];

/**
 * Line the four sides of a block with houses facing the streets, skipping
 * keep-out rectangles (locations, forecourts, squares). Returns the rects of
 * the placed houses.
 */
export function fillBlock(out: TownOut, protos: Record<ModelName, Proto>, blk: Block, keep: Rect[], detail: 0 | 1 | 2, seed: number): Rect[] {
  const rnd = seeded(seed);
  const placed: Rect[] = [];
  const inner = blk.inner;
  const types = detail === 2 ? TYPES_HERO : TYPES_CALM;
  const sides: { rot: number; along: 'x' | 'z'; fixed: number; from: number; to: number }[] = [
    { rot: Math.PI, along: 'x', fixed: inner.z0, from: inner.x0, to: inner.x1 },
    { rot: 0, along: 'x', fixed: inner.z1, from: inner.x0, to: inner.x1 },
    { rot: -Math.PI / 2, along: 'z', fixed: inner.x0, from: inner.z0, to: inner.z1 },
    { rot: Math.PI / 2, along: 'z', fixed: inner.x1, from: inner.z0, to: inner.z1 },
  ];
  for (const side of sides) {
    let t = side.from + 0.3;
    let guard = 0;
    while (t < side.to - 6 && guard++ < 60) {
      const fp = footprint(types[Math.floor(rnd() * types.length)], protos, rnd);
      const setback = detail === 0 ? 0.6 : rnd() * 0.8;
      // Front centre
      const c = t + fp.w / 2;
      if (c + fp.w / 2 > side.to - 0.2) {
        t += 2;
        continue;
      }
      let fx: number, fz: number;
      if (side.along === 'x') {
        fx = c;
        fz = side.rot === Math.PI ? side.fixed + setback : side.fixed - setback;
      } else {
        fz = c;
        fx = side.rot < 0 ? side.fixed + setback : side.fixed - setback;
      }
      // Footprint rect for the test
      const dirx = Math.sin(side.rot);
      const dirz = Math.cos(side.rot);
      const cx = fx - dirx * fp.d / 2;
      const cz = fz - dirz * fp.d / 2;
      const hw = side.along === 'x' ? fp.w / 2 : fp.d / 2;
      const hd = side.along === 'x' ? fp.d / 2 : fp.w / 2;
      const r = rect(cx - hw, cz - hd, cx + hw, cz + hd);
      if (r.x0 < inner.x0 - 0.5 || r.x1 > inner.x1 + 0.5 || r.z0 < inner.z0 - 0.5 || r.z1 > inner.z1 + 0.5 || keep.some((k) => overlaps(r, k, 0.4)) || placed.some((p) => overlaps(r, p, 0.2))) {
        t += 2.5;
        continue;
      }
      const s = hashString(`${seed}:${side.rot}:${Math.round(t)}`);
      // Party walls between row houses get no windows (only block corners show their sides).
      const atStart = c - fp.w / 2 < side.from + 4;
      const atEnd = c + fp.w / 2 > side.to - 4;
      const flip = side.rot === Math.PI || side.rot === Math.PI / 2;
      const hide = { left: flip ? !atEnd : !atStart, right: flip ? !atStart : !atEnd };
      placed.push(placeHouse(out, protos, fp, fx, fz, side.rot, detail, s, { hide }));
      t += fp.w + (rnd() < 0.15 ? 3 + rnd() * 3 : 0.15 + rnd() * 0.6);
    }
  }
  return placed;
}

/** Trees, bushes, hedges and garden sheds in the free courtyard of a block. */
export function gardenBlock(out: TownOut, blk: Block, occupied: Rect[], seed: number, count: number): void {
  const rnd = seeded(seed);
  const inner = blk.inner;
  // Hedges and low walls dividing the back gardens, garden sheds.
  const cx = (inner.x0 + inner.x1) / 2;
  const cz = (inner.z0 + inner.z1) / 2;
  for (let i = 0; i < 6; i++) {
    const alongX = i % 2 === 0;
    const x = alongX ? cx + (rnd() - 0.5) * 30 : inner.x0 + 18 + rnd() * (inner.x1 - inner.x0 - 36);
    const z = alongX ? inner.z0 + 18 + rnd() * (inner.z1 - inner.z0 - 36) : cz + (rnd() - 0.5) * 30;
    const len = 10 + rnd() * 18;
    const r = alongX ? rect(x - len / 2, z - 0.6, x + len / 2, z + 0.6) : rect(x - 0.6, z - len / 2, x + 0.6, z + len / 2);
    if (occupied.some((o) => overlaps(r, o, 1))) continue;
    if (rnd() < 0.6) out.b.leaf.box((r.x0 + r.x1) / 2, CURB_H, (r.z0 + r.z1) / 2, r.x1 - r.x0, 1.4, r.z1 - r.z0, PAL.leafDark);
    else out.b.stone.box((r.x0 + r.x1) / 2, CURB_H, (r.z0 + r.z1) / 2, r.x1 - r.x0, 1.1, (r.z1 - r.z0) * 0.6, P.pierre[1]);
    occupied.push(r);
  }
  for (let i = 0; i < 3; i++) {
    const x = inner.x0 + 12 + rnd() * (inner.x1 - inner.x0 - 24);
    const z = inner.z0 + 12 + rnd() * (inner.z1 - inner.z0 - 24);
    const r = rect(x - 2, z - 1.6, x + 2, z + 1.6);
    if (occupied.some((o) => overlaps(r, o, 1.5))) continue;
    const f = frameAt(x, z, rnd() * Math.PI);
    out.b.wood.box(0, CURB_H, 0, 3.6, 2.2, 2.8, pick(rnd, [P.boisChaud[2], P.vertSauge[1], P.bleuGris[1]]), 0, f);
    out.b.roof.prism(0, CURB_H + 2.2, 0, 4.0, 1.0, 3.2, P.ardoise[1], true, f);
    occupied.push(r);
  }
  let n = 0;
  for (let i = 0; i < count * 10 && n < count; i++) {
    const x = inner.x0 + 6 + rnd() * (inner.x1 - inner.x0 - 12);
    const z = inner.z0 + 6 + rnd() * (inner.z1 - inner.z0 - 12);
    if (occupied.some((r) => inside(x, z, r, 3.5))) continue;
    if (out.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 7)) continue;
    out.trees.push({ kind: pick(rnd, ['treeOak', 'treeDefault', 'treeFat', 'treeDetailed'] as const), x, z, h: 8 + rnd() * 5 });
    n++;
  }
  for (let i = 0; i < count * 2; i++) {
    const x = inner.x0 + 4 + rnd() * (inner.x1 - inner.x0 - 8);
    const z = inner.z0 + 4 + rnd() * (inner.z1 - inner.z0 - 8);
    if (occupied.some((r) => inside(x, z, r, 1.5))) continue;
    out.bushes.push({ x, z, s: 1.4 + rnd() * 1.2 });
  }
}

// ---------------------------------------------------------------------------
// Small props (procedural, merged)
// ---------------------------------------------------------------------------

/** Bistro chair facing `rot` (0 = +z) at ground height y. */
export function bistroChair(b: Batches, x: number, y: number, z: number, rot: number, color = '#2f4a3e'): void {
  const f = frameAt(x, z, rot);
  const m = b.metal;
  for (const [u, w] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) m.box(u, y, w, 0.04, 0.46, 0.04, color, 0, f);
  b.get('wood').box(0, y + 0.44, 0, 0.46, 0.05, 0.46, '#b08a5a', 0, f);
  m.box(0, y + 0.46, -0.22, 0.44, 0.48, 0.04, color, 0, f);
  b.get('wood').box(0, y + 0.72, -0.24, 0.44, 0.16, 0.03, '#c89a62', 0, f);
}

/** Small round café table. */
export function bistroTable(b: Batches, x: number, y: number, z: number, top = '#f2ece0'): void {
  b.metal.cyl(x, y, z, 0.05, 0.7, '#2b2e33');
  b.metal.cyl(x, y, z, 0.22, 0.04, '#2b2e33', true);
  b.trim.cyl(x, y + 0.7, z, 0.36, 0.05, top, true);
}

/** Café parasol with a striped canopy. */
export function parasol(b: Batches, x: number, y: number, z: number, colA: string, colB: string, r = 1.6): void {
  b.metal.cyl(x, y, z, 0.05, 2.35, '#e9e4d8');
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const f = new THREE.Matrix4().makeRotationY(a).setPosition(x, 0, z);
    b.cloth.shape('box', 0, y + 2.25, r * 0.45, r * 0.78, 0.04, r * 0.95, i % 2 ? colA : colB, { x: 0.32 }, f);
  }
  b.cloth.shape('cone8', x, y + 2.55, z, 0.25, 0.3, 0.25, colA);
}

/** Wooden planter with a hedge and flowers. */
export function planter(b: Batches, x: number, y: number, z: number, len: number, alongX: boolean, rnd: () => number): void {
  const sx = alongX ? len : 0.7;
  const sz = alongX ? 0.7 : len;
  b.wood.box(x, y, z, sx, 0.6, sz, '#7a5236');
  b.leaf.box(x, y + 0.6, z, sx - 0.1, 0.45, sz - 0.1, PAL.leaf);
  const n = Math.max(2, Math.round(len / 0.5));
  for (let i = 0; i < n; i++) {
    const t = -len / 2 + 0.25 + ((len - 0.5) / (n - 1)) * i;
    const fx = alongX ? x + t : x + (rnd() - 0.5) * 0.3;
    const fz = alongX ? z + (rnd() - 0.5) * 0.3 : z + t;
    b.trim.shape('dodeca', fx, y + 1.1, fz, 0.28, 0.24, 0.28, pick(rnd, PAL.flowers));
  }
}

/** Wooden crate of fruit or vegetables (procedural, a few dozen triangles). */
export function fruitCrate(b: Batches, x: number, y: number, z: number, rot: number, fruit: string): void {
  const f = frameAt(x, z, rot);
  b.wood.box(0, y, 0, 0.75, 0.38, 0.5, '#9c7048', 0, f);
  for (let i = 0; i < 4; i++) b.trim.shape('dodeca', -0.2 + (i % 2) * 0.4, y + 0.4, -0.1 + Math.floor(i / 2) * 0.2, 0.3, 0.22, 0.24, fruit, undefined, f);
}

/** Crate of flowers (florist display). */
export function flowerCrate(b: Batches, x: number, y: number, z: number, rnd: () => number, rot = 0): void {
  const f = frameAt(x, z, rot);
  b.wood.box(0, y, 0, 0.9, 0.42, 0.6, '#9c7048', 0, f);
  const col = pick(rnd, PAL.flowers);
  for (let i = 0; i < 4; i++) {
    b.leaf.shape('dodeca', -0.3 + (i % 2) * 0.6, y + 0.48, -0.14 + Math.floor(i / 2) * 0.28, 0.4, 0.3, 0.32, PAL.leaf, undefined, f);
    b.trim.shape('dodeca', -0.3 + (i % 2) * 0.6, y + 0.62, -0.14 + Math.floor(i / 2) * 0.28, 0.3, 0.22, 0.26, col, undefined, f);
  }
}

/** Tiered flower stand (étagère) in front of the florist. */
export function flowerStand(b: Batches, x: number, y: number, z: number, rot: number, rnd: () => number): void {
  const f = frameAt(x, z, rot);
  for (let k = 0; k < 3; k++) {
    b.wood.box(0, y + 0.3 + k * 0.42, -k * 0.38, 2.2, 0.06, 0.4, '#8a5a3b', 0, f);
    for (let i = 0; i < 5; i++) {
      const u = -0.88 + i * 0.44;
      b.brick.cyl(u, y + 0.36 + k * 0.42, -k * 0.38, 0.13, 0.22, '#b5643c', false, f);
      b.trim.shape('dodeca', u, y + 0.68 + k * 0.42, -k * 0.38, 0.34, 0.3, 0.34, pick(rnd, PAL.flowers), undefined, f);
    }
  }
  for (const u of [-1.05, 1.05]) b.wood.box(u, y, -0.4, 0.06, 1.3, 1.2, '#6e4630', 0, f);
}

/** Small iron wall lantern on a bracket (local frame of a façade); its glass is a lamp bulb. */
export function wallLantern(b: Batches, F: THREE.Matrix4, u: number, v: number, w: number): void {
  b.metal.box(u, v + 0.35, w + 0.12, 0.06, 0.06, 0.3, PAL.iron, 0, F);
  b.metal.box(u, v - 0.22, w + 0.3, 0.26, 0.06, 0.26, PAL.iron, 0, F);
  b.bulb.box(u, v - 0.16, w + 0.3, 0.2, 0.36, 0.2, '#ffffff', 0, F);
  b.metal.shape('pyramid', u, v + 0.2, w + 0.3, 0.32, 0.2, 0.32, PAL.iron, undefined, F);
}

/** Striped canopy over a Quaternius market stall (local frame of the stall). */
function stallCanopy(b: Batches, f: THREE.Matrix4, w: number, d: number, h: number, colA: string, colB: string): void {
  const n = Math.max(4, Math.round(w / 0.5));
  for (let i = 0; i < n; i++) {
    const u = -w / 2 + (w / n) * (i + 0.5);
    b.cloth.shape('box', u, h, 0, w / n + 0.01, 0.05, d, i % 2 ? colA : colB, { x: -0.18 }, f);
    b.cloth.shape('box', u, h - 0.28 - d * 0.09, d / 2, w / n + 0.01, 0.4, 0.04, i % 2 ? colA : colB, undefined, f);
  }
}

// ---------------------------------------------------------------------------
// The café block: Café Le Papillon, the bakery, the florist and the square
// ---------------------------------------------------------------------------

export interface DetailedLotOut {
  keep: Rect[];
}

/**
 * Build the three detailed lots. Returns the keep-out rects that the block
 * fillers must respect.
 */
export function buildCafeBlockLots(out: TownOut, protos: Record<ModelName, Proto>, tprops: Record<PropName, TexturedProto>): Rect[] {
  const city = getCity();
  const keep: Rect[] = [];
  const rnd = seeded(2024);
  const g = out.b;
  const y = CURB_H;

  // ------------------------------------------------------------------ Café
  {
    const cb = new Batches('cafe');
    out.lotBatches.set('cafe', cb);
    const inn = protos.inn;
    const s = 5.2;
    const front = 155; // z of the façade line (the inn faces north, towards its door node)
    const depth = inn.size.z * s;
    const width = inn.size.x * s;
    const m = modelMatrix(inn, 300, y, front + depth / 2, Math.PI, s);
    placeModel(cb, inn, m, { tint: [[/plaster/i, P.creme[0]], [/roof/i, P.rougeFane[0]], [/^stone$/i, P.pierre[1]]] });
    const top = chimneyTop(inn);
    if (top) out.ctx.emit.smoke.push(top.clone().applyMatrix4(m));
    keep.push(rect(300 - width / 2 - 1, front - 1, 300 + width / 2 + 1, front + depth + 1));
    out.pick.push({ id: 'cafe', box: new THREE.Box3(new THREE.Vector3(300 - width / 2, 0, front), new THREE.Vector3(300 + width / 2, inn.size.y * s, front + depth)) });
    addDoor('cafe', 300, front - 0.7, Math.PI);
    // Forecourt: plain paving from the street, a warmer stone terrace within ~12 m of the façade.
    const t0 = 131.5;
    const tEdge = 142.6; // front edge of the terrace (the seats of rows 1-2 are behind it)
    keep.push(rect(281, t0 - 1, 319, front + 1));
    g.get('paving').box(300, y, (t0 + tEdge) / 2, 40, 0.04, tEdge - t0, '#c4baa8');
    g.get('paving').box(300, y, (tEdge + front) / 2, 34, 0.06, front - tEdge, '#cdb89a');
    // Porch front (local +z = north, the street): striped awning under the porch roof, name board on its edge.
    const F = frameAt(300, front, Math.PI);
    awning(out.ctx, F, 0, width * 0.86, 4.55, '#b4483c', '#f2e6cf', 2.2);
    out.ctx.signs.quad(F, 0, 3.05, 2.23, 6, 0.34, 'LE PAPILLON', { bg: '#b4483c', fg: '#fbf3dd', font: 'sans' });
    g.wood.box(0, 4.85, -0.35, 11.4, 1.5, 0.16, '#2a1d1a', 0, F);
    out.ctx.signs.quad(F, 0, 5.6, -0.25, 10.6, 1.25, 'Café Le Papillon', { bg: '#2a1d1a', fg: '#f3cf7a', font: 'serif' });
    // Wall lanterns on the porch posts
    for (const u of [-4.2, 4.2]) {
      const p = new THREE.Vector3(u, 3.2, 0.25).applyMatrix4(F);
      wallLantern(g, F, u, 3.2, 0.1);
      out.lanterns.push(p);
    }
    // Seats on the standing spots that fall on the terrace (rows 1-2): chairs facing the
    // street, Paris style, a small table in front. Spots of row 0 are on the open
    // forecourt: those inhabitants stand and chat there.
    const tables: [number, number][] = [];
    for (let slot = 0; slot < 12; slot++) {
      const p = city.insidePos('cafe', slot);
      if (p.y < tEdge) continue;
      bistroChair(g, p.x, y, p.y, Math.PI);
      tables.push([p.x, p.y - 0.85]);
      addSeat('cafe', { x: p.x, z: p.y, heading: Math.PI, height: 0.46 });
    }
    // A few more tables under the awning and at the terrace ends (14 in all).
    for (const [x, z, r] of [[287.5, 146, 0.3], [287.5, 151, -0.2], [312.5, 146, -0.3], [312.5, 151, 0.25], [295, 152.6, 0], [305, 152.6, 0]] as const) {
      tables.push([x, z]);
      bistroChair(g, x - 0.75, y, z + 0.1, Math.PI / 2 + r);
      bistroChair(g, x + 0.75, y, z - 0.1, -Math.PI / 2 + r);
    }
    for (const [x, z] of tables) bistroTable(g, x, y, z);
    // Parasols over the seated rows and the terrace ends
    for (const [x, z, a2] of [[295, 147.3, 0], [305, 147.3, 1], [287.5, 148.5, 1], [312.5, 148.5, 0]] as const) {
      parasol(g, x, y, z, a2 ? '#b4483c' : '#f2e6cf', a2 ? '#f2e6cf' : '#b4483c', 2.0);
    }
    // Low planter edge on the terrace sides and corners (the middle stays open for the walkers).
    planter(g, 284.2, y, 148.5, 11, false, rnd);
    planter(g, 315.8, y, 148.5, 11, false, rnd);
    planter(g, 287, y, tEdge - 0.4, 5, true, rnd);
    planter(g, 313, y, tEdge - 0.4, 5, true, rnd);
    // The open forecourt: planters, a bike rack with two bikes, a lamp.
    planter(g, 284, y, 133.6, 4, true, rnd);
    planter(g, 316, y, 133.6, 4, true, rnd);
    for (let i = 0; i < 5; i++) {
      const hoop = new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(309.5 + i * 0.9, y, 136.5);
      g.metal.shape('torus', 0, 0.5, 0, 0.75, 1.1, 0.75, '#2f4a3e', { z: 0 }, hoop);
    }
    const bike = protos.bicycle;
    for (const [x, c] of [[311.3, P.rougeFane[0]]] as const) {
      placeModel(g, bike, modelMatrix(bike, x, y, 136.5, 0, 1.75 / bike.size.z), { tint: [[/bike|material\.00[15]/i, c], [/wheel|handle|00[23]/i, '#2b2e33']] });
    }
    pushInst(out.instances, 'lamp', { x: 291, y, z: 135.5, rotY: 0, scale: 4.2 / protos.lamp.size.y });
    out.lanterns.push(new THREE.Vector3(291, y + 3.85, 135.5));
    // Houses flanking the inn on its façade line enclose the little square.
    for (const sg of [-1, 1]) {
      const fp = footprint(sg < 0 ? 'q2' : 'kMansard', protos, rnd);
      const cx = 300 + sg * (width / 2 + fp.w / 2 + 0.4);
      keep.push(placeHouse(out, protos, fp, cx, front + 1.5, Math.PI, 2, 911 + sg, { smoke: true }));
    }
    // Two trees framing the terrace, a bench under each
    out.trees.push({ kind: 'treeOak', x: 278, z: 150, h: 10.5 }, { kind: 'treeOak', x: 322, z: 150, h: 11 });
    pushInst(out.instances, 'bench1', { x: 278, y, z: 145.2, rotY: Math.PI, scale: 2.2 / protos.bench1.size.x });
    // Chalkboard menu
    const chalk = frameAt(297.5, 141.6, Math.PI - 0.3);
    g.wood.box(0, y, 0, 0.7, 1.1, 0.05, '#5c3f2c', 0, chalk);
    g.trim.box(0, y + 0.35, 0.03, 0.56, 0.62, 0.02, '#2c3a33', 0, chalk);
    g.metal.shape('box', 0, y + 0.55, -0.25, 0.05, 1.1, 0.05, '#5c3f2c', { x: -0.4 }, chalk);
  }

  // --------------------------------------------------------------- Bakery
  {
    const bb = new Batches('bakery');
    out.lotBatches.set('bakery', bb);
    const h2 = protos.house2;
    const s = Q_SCALE;
    const front = 156.5; // x of the façade line (faces west)
    const depth = h2.size.z * s;
    const width = h2.size.x * s;
    const m = modelMatrix(h2, front + depth / 2, y, 180, -Math.PI / 2, s);
    placeModel(bb, h2, m, { tint: [[/plaster|beige/i, P.ocre[2]], [/roof/i, P.brique[0]]] });
    const top = chimneyTop(h2);
    if (top) out.ctx.emit.smoke.push(top.clone().applyMatrix4(m), top.clone().applyMatrix4(m).add(new THREE.Vector3(0, 0.6, 0.3)));
    keep.push(rect(front - 1, 180 - width / 2 - 1, front + depth + 1, 180 + width / 2 + 1));
    out.pick.push({ id: 'bakery', box: new THREE.Box3(new THREE.Vector3(front, 0, 180 - width / 2), new THREE.Vector3(front + depth, h2.size.y * s, 180 + width / 2)) });
    addDoor('bakery', front - 0.7, 180, -Math.PI / 2);
    keep.push(rect(131, 160, front + 1, 200));
    g.get('paving').box((131.5 + front) / 2, y, 180, front - 131.5, 0.05, 40, '#d9ccb2');
    // Façade frame: local +z = west
    const F = frameAt(front + 1.2, 180, -Math.PI / 2);
    awning(out.ctx, F, 0, width * 0.85, 3.9, P.ocre[0], P.creme[0], 2.2);
    out.ctx.signs.quad(F, 0, 4.9, 0.2, 9.5, 1.05, 'Boulangerie Au Levain d’Or', { bg: '#5c3f2c', fg: '#f3cf7a', font: 'serif' });
    g.metal.box(0, 4.9, 0.08, 10.1, 1.25, 0.1, '#5c3f2c', 0, F);
    for (const u of [-3.8, 3.8]) {
      wallLantern(g, F, u, 3.2, 0.1);
      out.lanterns.push(new THREE.Vector3(u, 3.2, 0.25).applyMatrix4(F));
    }
    for (const sg of [-1, 1]) {
      const fp = footprint(sg < 0 ? 'kTown' : 'q1', protos, rnd);
      const cz = 180 + sg * (width / 2 + fp.w / 2 + 0.3);
      keep.push(placeHouse(out, protos, fp, front + 0.5, cz, -Math.PI / 2, 2, 555 + sg));
    }
    // Market stalls on both sides of the forecourt (bread, fruit)
    for (const [z, rot, colA, colB] of [[166.2, 0, P.ocre[0], P.creme[0]]] as const) {
      const sx = 142;
      const st = tprops.stall;
      const ss = 2.6 / st.size.y;
      pushInst(out.textured, 'stall', { x: sx, y, z, rotY: rot, scale: ss });
      const f = frameAt(sx, z, rot);
      stallCanopy(g, f, st.size.x * ss + 0.4, st.size.z * ss + 0.6, y + st.size.y * ss + 0.05, colA, colB);
      fruitCrate(g, sx - 1.6, y, z + (rot ? -1.6 : 1.6), rnd(), '#c8453a');
      pushInst(out.textured, 'barrelApples', { x: sx + 2.2, y, z: z + (rot ? -1.4 : 1.4), rotY: rnd(), scale: 1.0 / tprops.barrelApples.size.y });
    }
    // Baskets of loaves on a trestle by the door
    for (const z of [174.5, 185.5]) {
      g.wood.box(front - 1.6, y, z, 1.4, 0.8, 0.7, '#8a5a3b');
      for (let i = 0; i < 4; i++) g.trim.shape('dodeca', front - 2.1 + i * 0.33, y + 0.9, z + (rnd() - 0.5) * 0.3, 0.28, 0.16, 0.5, '#d49a52', { y: 0.4 });
    }
    // A small bakery terrace either side of the door, planters, a bench and trees.
    for (const [x, z] of [[151, 191.5], [147, 194.5]] as const) {
      bistroTable(g, x, y, z, '#f6efe0');
      bistroChair(g, x - 0.8, y, z, Math.PI / 2, '#5c3f2c');
      bistroChair(g, x + 0.8, y, z, -Math.PI / 2, '#5c3f2c');
    }
    parasol(g, 149.5, y, 193, P.creme[0], P.ocre[0], 1.9);
    planter(g, 133.5, y, 170, 5, false, rnd);
    planter(g, 133.5, y, 190, 5, false, rnd);
    pushInst(out.instances, 'bench1', { x: 134.5, y, z: 157.5, rotY: Math.PI / 2, scale: 2.2 / protos.bench1.size.x });
    pushInst(out.instances, 'bench1', { x: 134.5, y, z: 202.5, rotY: Math.PI / 2, scale: 2.2 / protos.bench1.size.x });
    out.trees.push({ kind: 'treeDefault', x: 137, z: 153.5, h: 9.5 }, { kind: 'treeDefault', x: 137, z: 206.5, h: 10 }, { kind: 'treeOak', x: 152, z: 161, h: 8 }, { kind: 'treeOak', x: 152, z: 199, h: 8.5 });
    // Frame the forecourt from the street: two trees in tubs, a bench between them, bread crates by the stall.
    for (const z of [167.5, 192.5]) {
      g.wood.box(134.2, y, z, 1.4, 0.7, 1.4, '#7a5236');
      out.trees.push({ kind: 'treeDefault', x: 134.2, z, h: 6.5 });
    }
    for (let i = 0; i < 4; i++) fruitCrate(g, 139.2 + (i % 2) * 0.8, y + (i > 1 ? 0.42 : 0), 163.4, i * 0.2, i % 2 ? '#e07b2c' : '#c8453a');
    // A delivery cart of flour sacks
    const cart = protos.cart;
    placeModel(g, cart, modelMatrix(cart, 150.5, y, 202, -0.4, 2.0 / cart.size.y));
    for (let i = 0; i < 3; i++) pushInst(out.textured, 'crateWood', { x: 154.5, y: y + (i === 2 ? 0.55 : 0), z: 165 + (i % 2) * 0.7, rotY: i * 0.3, scale: 0.55 / tprops.crateWood.size.y });
  }

  // --------------------------------------------------- Florist + Place du Marché
  {
    const fb = new Batches('florist');
    out.lotBatches.set('florist', fb);
    const h1 = protos.house1;
    const s = 5.0;
    const front = 156;
    const depth = h1.size.z * s;
    const width = h1.size.x * s;
    const m = modelMatrix(h1, 420, y, front + depth / 2, Math.PI, s);
    placeModel(fb, h1, m, { tint: [[/plaster|beige/i, '#ecd6d0'], [/roof/i, P.ardoise[0]]] });
    keep.push(rect(420 - width / 2 - 1, front - 1, 420 + width / 2 + 1, front + depth + 1));
    out.pick.push({ id: 'florist', box: new THREE.Box3(new THREE.Vector3(420 - width / 2, 0, front), new THREE.Vector3(420 + width / 2, h1.size.y * s, front + depth)) });
    addDoor('florist', 420, front - 0.7, Math.PI);
    // The square: cobbles from the street to the florist
    keep.push(rect(375, 131, 466, front + 2));
    g.get('cobble').box(420.5, y, 144, 93, 0.06, 25, '#b4aa9a');
    const F = frameAt(420, front + 1.6, Math.PI);
    awning(out.ctx, F, 0, width * 0.85, 3.6, P.vertSauge[2], P.creme[0], 2.0);
    out.ctx.signs.quad(F, 0, 4.6, 0.2, 7.5, 0.95, 'Fleurs & Sens', { bg: '#3f5d4a', fg: '#fbf3dd', font: 'serif' });
    g.metal.box(0, 4.6, 0.08, 8.0, 1.15, 0.1, '#3f5d4a', 0, F);
    for (const sg of [-1, 1]) {
      const fp = footprint(sg < 0 ? 'kTimber' : 'q2', protos, rnd);
      const cx = 420 + sg * (width / 2 + fp.w / 2 + 0.3);
      keep.push(placeHouse(out, protos, fp, cx, front + 0.5, Math.PI, 2, 733 + sg, { smoke: sg > 0 }));
    }
    // Flower crates and stands in front of the shop (outside the standing grid)
    for (const x of [409, 431]) flowerStand(g, x, y, front - 1.6, Math.PI, rnd);
    for (let i = 0; i < 6; i++) flowerCrate(g, 405 + (i % 3) * 1.0, y + (i > 2 ? 0.43 : 0), front - 3.4, rnd, Math.PI);
    for (let i = 0; i < 6; i++) flowerCrate(g, 433 + (i % 3) * 1.0, y + (i > 2 ? 0.43 : 0), front - 3.4, rnd, Math.PI);
    // Market stands (Quaternius, striped) along both sides of the square
    const stands: [number, number, number, 'stand1' | 'stand2'][] = [
      [384, 140, Math.PI / 2, 'stand1'],
      [384, 149, Math.PI / 2, 'stand2'],
      [457, 140, -Math.PI / 2, 'stand2'],
      [394, 154, Math.PI, 'stand1'],
    ];
    const awn = [P.rougeFane[0], P.bleuGris[1], P.vertSauge[1], P.ocre[0]];
    stands.forEach(([x, z, r, kind], i) => {
      const pr = protos[kind];
      const sc = 3.0 / pr.size.y;
      placeModel(g, pr, modelMatrix(pr, x, y, z, r, sc), { tint: [[/roof/i, awn[i % awn.length]]] });
    });
    for (const [x, z] of [[381, 144.5], [460, 144], [397.5, 151]]) {
      if (rnd() < 0.3) pushInst(out.textured, 'barrelApples', { x, y, z, rotY: rnd() * 3, scale: 1.0 / tprops.barrelApples.size.y });
      else fruitCrate(g, x, y, z, rnd() * 3, pick(rnd, ['#c8453a', '#e07b2c', '#7fae4a']));
    }
    // The well, a cart, a bench and trees on the square
    const well = protos.well;
    placeModel(g, well, modelMatrix(well, 451, y, 152, -0.4, 3.6 / well.size.y));
    const cart = protos.cart;
    placeModel(g, cart, modelMatrix(cart, 463, y, 151, 0.3, 2.2 / cart.size.y));
    pushInst(out.instances, 'bench1', { x: 445, y, z: 135, rotY: Math.PI, scale: 2.2 / protos.bench1.size.x });
    out.trees.push({ kind: 'treeTall', x: 378, z: 134.5, h: 11 }, { kind: 'treeOak', x: 463, z: 134.5, h: 10 });
    // Bell tower of the little chapel at the south-east corner (faces the park)
    const bt = protos.bellTower;
    const bs = 26 / bt.size.y;
    const btm = modelMatrix(bt, 457, y, 216, 0, bs);
    placeModel(g, bt, btm, { tint: [[/roof/i, P.ardoise[0]]] });
    keep.push(rect(457 - (bt.size.x * bs) / 2 - 1, 216 - (bt.size.z * bs) / 2 - 1, 457 + (bt.size.x * bs) / 2 + 1, 216 + (bt.size.z * bs) / 2 + 1));
  }
  // Trees and benches placed above are kept clear of the filler houses.
  for (const t of out.trees) keep.push(rect(t.x - 3, t.z - 3, t.x + 3, t.z + 3));
  for (const bch of out.instances.get('bench1') ?? []) keep.push(rect(bch.x - 2, bch.z - 2, bch.x + 2, bch.z + 2));
  return keep;
}

/** The three blocks of the café street (west to east), with the corners of the detailed lots. */
export function cafeBlocks(all: Block[]): Block[] {
  return all.filter((b) => b.z0 === 120 && (b.x0 === 120 || b.x0 === 240 || b.x0 === 360));
}

/** Park north edge: a row of trees and benches along the y = 240 street. */
export function parkNorthEdge(out: TownOut, protos: Record<ModelName, Proto>): void {
  const rnd = seeded(5);
  for (let x = 268; x <= 452; x += 15) {
    if (Math.abs(x - 360) < 14) continue;
    out.trees.push({ kind: rnd() < 0.5 ? 'treeOak' : 'treeDetailed', x: x + (rnd() - 0.5) * 3, z: 256.5 + rnd() * 2, h: 10 + rnd() * 3 });
  }
}

// ---------------------------------------------------------------------------
// The other locations (propagation): same kit and palette, calmer detail
// ---------------------------------------------------------------------------


/** Place a kit building with an explicit spec; (x, z) is the centre of its front. */
export function placeKit(out: TownOut, x: number, z: number, rotY: number, spec: Omit<HouseSpec, 'owner' | 'detail'>, detail: 0 | 1 | 2, owner: string, kind = 'home'): Rect {
  const fx = Math.sin(rotY);
  const fz = Math.cos(rotY);
  const d = spec.depth * KIT_SCALE;
  const cx = x - fx * d / 2;
  const cz = z - fz * d / 2;
  const frame = frameAt(cx, cz, rotY).multiply(new THREE.Matrix4().makeScale(KIT_SCALE, KIT_SCALE, KIT_SCALE));
  frame.setPosition(cx, CURB_H, cz);
  const ownerIdx = out.ctx.win.owner(owner, kind);
  const k = detail === 0 ? 0.4 : 0;
  house(out.ctx, frame, {
    ...spec,
    wall: k ? calm(spec.wall, k) : spec.wall,
    roofColor: k ? calm(spec.roofColor, k) : spec.roofColor,
    detail,
    owner: ownerIdx,
  });
  const w = spec.width * KIT_SCALE;
  const ax = Math.abs(fx) > 0.5;
  return rect(cx - (ax ? d : w) / 2, cz - (ax ? w : d) / 2, cx + (ax ? d : w) / 2, cz + (ax ? w : d) / 2);
}

/** Simple parked car (procedural, palette colours). */
export function parkedCar(b: Batches, x: number, y: number, z: number, rot: number, color: string): void {
  const f = frameAt(x, z, rot);
  b.trim.box(0, y + 0.35, 0, 1.75, 0.65, 4.1, color, 0, f);
  b.trim.box(0, y + 1.0, -0.25, 1.55, 0.6, 2.2, color, 0, f);
  b.get('glass').box(0, y + 1.02, -0.25, 1.6, 0.48, 2.0, '#3d4f60', 0, f);
  for (const [u, w] of [[-0.8, 1.3], [0.8, 1.3], [-0.8, -1.3], [0.8, -1.3]]) b.metal.shape('cyl8', u, y + 0.33, w, 0.66, 0.24, 0.66, '#222428', { z: Math.PI / 2 }, f);
  b.bulb.box(-0.6, y + 0.5, 2.06, 0.3, 0.14, 0.04, '#ffffff', 0, f);
  b.bulb.box(0.6, y + 0.5, 2.06, 0.3, 0.14, 0.04, '#ffffff', 0, f);
}

const CAR_COLORS = [P.bleuGris[1], P.rougeFane[0], P.creme[0], P.vertSauge[1], P.ocre[1], P.ardoise[2]];

/** Location building specs (kit units; width along the frontage). */
function locationSpec(id: string): (Omit<HouseSpec, 'owner' | 'detail'> & { q?: 'q1' | 'q2'; qTint?: string; sign?: string; signBg?: string }) | null {
  const base = { trim: P.blanc[0], shutter: P.vertSauge[1], chimneys: 2, door: { u: 0, arched: false } };
  switch (id) {
    case 'imm_haussmann': return { ...base, width: 30, depth: 16, floors: 4, wall: P.creme[0], wallSurface: 'stone', roof: 'mansard', roofColor: P.ardoise[0], balcony: 'continuous', quoins: true, door: { u: 0, arched: true } };
    case 'res_lilas': return { ...base, width: 28, depth: 15, floors: 3, wall: '#dcd0e2', roof: 'mansard', roofColor: P.ardoise[0], balcony: 'juliet', shutter: P.bleuGris[1] };
    case 'imm_voltaire': return { ...base, width: 26, depth: 14, floors: 3, wall: P.ocre[2], roof: 'gable', roofColor: P.brique[0], dormers: 4, balcony: 'juliet' };
    case 'res_parc': return { ...base, width: 30, depth: 16, floors: 4, wall: P.vertSauge[0], roof: 'flat', roofColor: P.ardoise[0], balcony: 'continuous', chimneys: 0 };
    case 'maison_canal': return { ...base, width: 13, depth: 13, floors: 2, wall: P.brique[2], wallSurface: 'brick', roof: 'stepped', roofColor: P.ardoise[0], pitch: 1.3, shutter: P.creme[1] };
    case 'loft_gare': return { ...base, width: 26, depth: 15, floors: 2, wall: P.brique[0], wallSurface: 'brick', roof: 'gable', roofColor: P.ardoise[2], win: 'wide', shutter: null, chimneys: 1 };
    case 'maison_bleue': return { ...base, width: 14, depth: 12, floors: 1, wall: P.bleuGris[0], roof: 'hip', roofColor: P.brique[1], q: 'q1', qTint: '#a9bccb' };
    case 'villa_rosa': return { ...base, width: 14, depth: 12, floors: 1, wall: '#e8b9ae', roof: 'hip', roofColor: P.brique[0], q: 'q2', qTint: '#e8b9ae' };
    case 'clinic': return { ...base, width: 28, depth: 16, floors: 1, wall: '#f1ede4', roof: 'flat', roofColor: P.ardoise[0], shutter: null, chimneys: 0, door: null, shop: { sign: 'Cabinet médical', signStyle: { bg: '#2e7d6a', fg: '#ffffff', font: 'sans' }, awning: null, windows: 'shop' } };
    case 'gym': return { ...base, width: 32, depth: 20, floors: 1, groundH: 6, wall: P.bleuGris[0], roof: 'flat', roofColor: P.ardoise[0], win: 'wide', shutter: null, chimneys: 0, door: null, shop: { sign: 'Gymnase Central', signStyle: { bg: '#20435c', fg: '#ffffff', font: 'sans' }, awning: null, windows: 'wide' } };
    case 'townhall': return { ...base, width: 38, depth: 18, floors: 2, wall: P.creme[1], wallSurface: 'stone', roof: 'mansard', roofColor: P.ardoise[0], win: 'arch', quoins: true, balcony: 'none', door: { u: 0, arched: true }, sign: 'Hôtel de Ville', signBg: P.creme[1] };
    case 'office': return { ...base, width: 26, depth: 22, floors: 7, floorH: 3.5, wall: P.brique[1], wallSurface: 'brick', roof: 'flat', roofColor: P.ardoise[0], win: 'office', shutter: null, chimneys: 0, door: null, shop: { sign: 'Agence Horizon', signStyle: { bg: '#1f2d44', fg: '#ffffff', font: 'sans' }, awning: null, windows: 'shop' } };
    case 'library': return { ...base, width: 30, depth: 18, floors: 1, groundH: 6, wall: P.pierre[0], wallSurface: 'stone', roof: 'hip', roofColor: P.ardoise[0], win: 'arch', shutter: null, chimneys: 0, door: { u: 0, arched: true }, sign: 'Bibliothèque Municipale', signBg: P.pierre[0] };
    case 'restaurant': return { ...base, width: 16, depth: 14, floors: 1, wall: P.ocre[2], roof: 'gable', roofColor: P.brique[0], q: 'q2', qTint: P.ocre[2], sign: 'Restaurant Chez Lucie', signBg: '#7a1f2b' };
    case 'workshop': return { ...base, width: 24, depth: 16, floors: 0, groundH: 5.5, wall: P.brique[0], wallSurface: 'brick', roof: 'gable', roofColor: P.ardoise[2], win: 'wide', shutter: null, door: null, shop: { sign: 'Atelier Dupré', signStyle: { bg: '#5c3f2c', fg: '#f3cf7a', font: 'serif' }, awning: null, windows: 'wide' } };
    case 'station': return { ...base, width: 30, depth: 14, floors: 0, groundH: 6, wall: P.creme[2], wallSurface: 'stone', roof: 'gable', roofColor: P.ardoise[0], win: 'arch', shutter: null, door: null, shop: { sign: 'Gare Routière', signStyle: { bg: '#d9822b', fg: '#ffffff', font: 'sans' }, awning: null, windows: 'arch' } };
    default: return null;
  }
}

/**
 * Build every location outside the café block. Returns the keep-out rects
 * (buildings + forecourts) for the block fillers.
 */
export function buildOtherLots(out: TownOut, protos: Record<ModelName, Proto>, skip: Set<string>): Rect[] {
  const keep: Rect[] = [];
  const city = getCity();
  const rnd = seeded(99);
  for (const f of lotFrames().values()) {
    const id = f.loc.id;
    if (skip.has(id) || f.loc.kind === 'park') continue;
    if (id === 'school') {
      keep.push(...buildSchool(out, protos, f));
      continue;
    }
    if (id === 'supermarket') {
      keep.push(...buildSupermarket(out, f, rnd));
      continue;
    }
    const spec = locationSpec(id);
    if (!spec) continue;
    const wF = f.stand.w0 - 5;
    const front = toWorldL(f, 0, wF);
    const detail = f.detail;
    const doorAt = toWorldL(f, spec.q ? 0 : (spec.door?.u ?? 0) * KIT_SCALE, wF + 0.7);
    addDoor(id, doorAt.x, doorAt.z, f.yaw);
    let r: Rect;
    let top = 12;
    if (spec.q) {
      const proto = spec.q === 'q1' ? protos.house1 : protos.house2;
      const fp = { type: spec.q, w: proto.size.x * Q_SCALE, d: proto.size.z * Q_SCALE } as const;
      r = placeHouse(out, protos, fp, front.x, front.z, f.yaw, detail, hashString(id), { wall: spec.qTint, roof: spec.roofColor, smoke: true });
      top = proto.size.y * Q_SCALE;
      // Garden flanks for the villas
      for (const sg of [-1, 1]) {
        const p = toWorldL(f, sg * 10, wF + 2);
        out.trees.push({ kind: sg < 0 ? 'treeFat' : 'treeDefault', x: p.x, z: p.z, h: 7 + rnd() * 2 });
      }
    } else {
      r = placeKit(out, front.x, front.z, f.yaw, spec, detail, id, f.loc.kind === 'home' ? 'home' : f.loc.kind);
      top = (spec.groundH ?? 4.8) * KIT_SCALE + spec.floors * (spec.floorH ?? 3.9) * KIT_SCALE + 6;
    }
    keep.push(r);
    // Name plate / sign over the door for civic buildings without a shopfront.
    const F = frameAt(front.x, front.z, f.yaw);
    if (spec.sign && !spec.shop) out.ctx.signs.quad(F, 0, spec.q ? 4.9 : 4.6, 0.32, Math.min(12, spec.width * 0.6), 0.9, spec.sign, { bg: spec.signBg ?? '#2a3d33', fg: spec.signBg && spec.signBg !== '#7a1f2b' ? '#4b3f2f' : '#fbf3dd', font: 'serif' });
    // Kind-specific dressing
    if (id === 'townhall') {
      const bt = protos.bellTower;
      const s = 30 / bt.size.y;
      const p = toWorldL(f, 0, wF - 18);
      placeModel(out.b, bt, modelMatrix(bt, p.x, CURB_H, p.z, f.yaw, s), { tint: [[/roof/i, calm(P.ardoise[0], 0.3)]] });
      for (const sg of [-1, 1]) {
        const q = toWorldL(f, sg * 6, wF + 3);
        out.b.metal.cyl(q.x, CURB_H, q.z, 0.08, 8, PAL.iron);
        const ff = frameAt(q.x, q.z, f.yaw + Math.PI / 2);
        out.b.cloth.box(0.75, CURB_H + 6.2, 0, 1.4, 1.6, 0.05, sg < 0 ? '#2f4f8f' : '#2f4f8f', 0, ff);
        out.b.cloth.box(0.75 + 0.47, CURB_H + 6.2, 0.01, 0.47, 1.6, 0.05, '#f6f1e6', 0, ff);
        out.b.cloth.box(0.75 + 0.94, CURB_H + 6.2, 0.02, 0.47, 1.6, 0.05, '#b4483c', 0, ff);
      }
    }
    if (id === 'clinic') {
      const p = toWorldL(f, 9, wF + 0.6);
      const ff = frameAt(p.x, p.z, f.yaw);
      out.b.glow.box(0, CURB_H + 4.2, 0.3, 0.45, 1.5, 0.2, '#2ecc71', 0, ff);
      out.b.glow.box(0, CURB_H + 4.7, 0.3, 1.5, 0.45, 0.2, '#2ecc71', 0, ff);
    }
    if (id === 'gym') {
      const c = toWorldL(f, 0, wF - 8);
      const along = Math.abs(Math.sin(f.yaw)) > 0.5;
      out.b.roof.shape('barrel', c.x, CURB_H + 6 * KIT_SCALE + 0.9, c.z, along ? 14 : 22, 5, along ? 22 : 14, calm(P.ardoise[2], 0.3), along ? undefined : { y: Math.PI / 2 });
    }
    if (id === 'library') {
      // Portico: columns, entablature and pediment.
      const pw = 14;
      for (let i = 0; i < 6; i++) {
        const p = toWorldL(f, -pw / 2 + (pw / 5) * i, wF + 2.2);
        out.b.stone.cyl(p.x, CURB_H + 0.5, p.z, 0.4, 5.2, P.pierre[0], true);
      }
      const ff = frameAt(front.x, front.z, f.yaw);
      out.b.stone.box(0, CURB_H, 1.4, pw + 3, 0.5, 3.4, P.pierre[1], 0, ff);
      out.b.stone.box(0, CURB_H + 5.7, 1.4, pw + 1.6, 0.9, 3, P.pierre[0], 0, ff);
      out.b.stone.prism(0, CURB_H + 6.6, 1.4, pw + 2, 1.8, 3.2, P.pierre[0], true, ff);
    }
    if (id === 'restaurant') {
      const F2 = frameAt(front.x, front.z, f.yaw);
      awning(out.ctx, F2, 0, 11, 3.9, '#7a1f2b', P.creme[0], 2.2);
      out.ctx.signs.quad(F2, 0, 4.85, 0.3, 9.5, 0.95, 'Restaurant Chez Lucie', { bg: '#7a1f2b', fg: '#fbf3dd', font: 'serif' });
      for (let slot = 0; slot < 14; slot++) {
        const p = city.insidePos(id, slot);
        bistroChair(out.b, p.x, CURB_H, p.y, f.yaw);
        const t = toWorldL(f, 0, 0.85);
        const t0 = toWorldL(f, 0, 0);
        bistroTable(out.b, p.x + (t.x - t0.x), CURB_H, p.y + (t.z - t0.z), '#f3e9d8');
        addSeat(id, { x: p.x, z: p.y, heading: f.yaw, height: 0.46 });
      }
      for (const u of [-9, 9]) {
        const p = toWorldL(f, u, (f.stand.w0 + f.stand.w1) / 2);
        parasol(out.b, p.x, CURB_H, p.z, '#7a1f2b', P.creme[0], 2.2);
      }
    }
    if (id === 'station') {
      // Long canopy over the bus bays.
      const ff = frameAt(front.x, front.z, f.yaw);
      for (let i = 0; i < 6; i++) out.b.metal.cyl(-15 + i * 6, CURB_H, 6.5, 0.15, 4.4, '#2f4a3e', false, ff);
      out.b.metal.box(0, CURB_H + 4.4, 4, 33, 0.3, 6, '#2f4a3e', 0, ff);
      out.b.trim.box(0, CURB_H + 4.2, 7, 33, 0.5, 0.1, '#f39c12', 0, ff);
    }
    if (id === 'workshop') {
      for (let i = 0; i < 4; i++) {
        const p = toWorldL(f, -14 + (i % 2) * 1.4, wF + 2 + Math.floor(i / 2) * 1.2);
        out.b.wood.box(p.x, CURB_H + (i > 1 ? 0.9 : 0), p.z, 1.1, 0.9, 1.1, '#9c7048');
      }
      const p = toWorldL(f, 12, wF + 3);
      out.b.wood.box(p.x, CURB_H, p.z, 4, 0.5, 1.2, '#b08a5a');
      out.b.wood.box(p.x, CURB_H + 0.5, p.z, 4, 0.5, 1.2, '#a07a4a', 0.04);
    }
    // Forecourt paving (keep-out for the fillers) and the pick box.
    const half = Math.max(Math.abs(f.stand.u0), Math.abs(f.stand.u1)) + 5;
    const fr = localRect(f, -half, wF - 0.5, half, f.streetW + 0.6);
    keep.push(fr);
    out.pick.push({ id, box: new THREE.Box3(new THREE.Vector3(r.x0, 0, r.z0), new THREE.Vector3(r.x1, top, r.z1)) });
  }
  return keep;
}

/** École Jules Ferry: two wings around the yard crossed by the footpath, bell tower, gate, fence. */
function buildSchool(out: TownOut, protos: Record<ModelName, Proto>, f: LotFrame): Rect[] {
  const keep: Rect[] = [];
  const rnd = seeded(7);
  const front = 82;
  const spec = { trim: P.blanc[0], shutter: P.bleuGris[1], width: 78, depth: 22, floors: 1, wall: P.creme[1], roof: 'hip' as const, roofColor: P.brique[0], dormers: 6, chimneys: 2, door: { u: 18, arched: true }, win: 'tall' as const, flowerBoxes: true };
  keep.push(placeKit(out, 302, front, 0, { ...spec, door: { u: 20, arched: true } }, 2, 'school', 'school'));
  keep.push(placeKit(out, 418, front, 0, { ...spec, door: { u: -20, arched: true }, wall: P.creme[0] }, 2, 'school', 'school'));
  // Bell tower beside the west wing
  const bt = protos.bellTower;
  placeModel(out.b, bt, modelMatrix(bt, 343.5, CURB_H, 52, 0, 22 / bt.size.y), { tint: [[/roof/i, P.ardoise[0]]] });
  keep.push(rect(336, 44, 351, 60));
  // Gate over the footpath with the school's name.
  const g = out.b;
  for (const x of [355.2, 364.8]) {
    g.stone.box(x, CURB_H, 104, 1.2, 4.6, 1.2, P.pierre[1]);
    g.stone.box(x, CURB_H + 4.6, 104, 1.5, 0.4, 1.5, P.pierre[0]);
  }
  g.metal.box(360, CURB_H + 3.9, 104, 9.6, 0.25, 0.25, PAL.iron);
  const F = frameAt(360, 104.2, 0);
  out.ctx.signs.quad(F, 0, 4.45, 0.0, 8.8, 0.75, 'École Jules Ferry', { bg: '#2c4a7a', fg: '#fff8ec', font: 'serif' });
  // Fence along the yard front, gaps at the gate.
  for (const [x0, x1] of [[254, 354], [366, 466]]) {
    const n = Math.round((x1 - x0) / 0.5);
    g.metal.box((x0 + x1) / 2, CURB_H + 1.2, 105.5, x1 - x0, 0.08, 0.08, '#2f4a3e');
    g.metal.box((x0 + x1) / 2, CURB_H + 0.15, 105.5, x1 - x0, 0.08, 0.08, '#2f4a3e');
    for (let i = 0; i <= n; i += 2) g.metal.box(x0 + i * 0.5, CURB_H, 105.5, 0.05, 1.35, 0.05, '#2f4a3e');
  }
  // Yard: gravel, trees, benches, a hopscotch
  g.get('gravel').box(302, CURB_H + 0.01, 94, 100, 0.03, 22, '#cdbf9f');
  g.get('gravel').box(418, CURB_H + 0.01, 94, 100, 0.03, 22, '#cdbf9f');
  for (const x of [275, 300, 325, 395, 420, 445]) out.trees.push({ kind: rnd() < 0.5 ? 'treeOak' : 'treeDetailed', x, z: 96 + (rnd() - 0.5) * 3, h: 9 + rnd() * 3 });
  for (const x of [287, 312, 407, 432]) out.instances.set('bench1', [...(out.instances.get('bench1') ?? []), { x, y: CURB_H, z: 99, rotY: Math.PI, scale: 2.2 / protos.bench1.size.x }]);
  for (let i = 0; i < 8; i++) g.trim.box(340 - (i % 2) * 0.9, CURB_H + 0.02, 88 + Math.floor(i / 2) * 1.0, 0.85, 0.02, 0.85, '#f6f1e6');
  // Courtyard behind the wings: sports ground.
  g.get('grass').box(360, CURB_H + 0.02, 34, 190, 0.02, 40, '#93b86a');
  out.pick.push({ id: 'school', box: new THREE.Box3(new THREE.Vector3(265, 0, 64), new THREE.Vector3(455, 16, 82)) });
  // The two wings' doors (u = +20 / -20 kit units from their front centres), on the yard side.
  addDoor('school', 302 + 20 * KIT_SCALE, front + 0.7, 0);
  addDoor('school', 418 - 20 * KIT_SCALE, front + 0.7, 0);
  return keep;
}

/** Supermarché Marché Plus: big shopfront, green awning, car park with a few cars. */
function buildSupermarket(out: TownOut, f: LotFrame, rnd: () => number): Rect[] {
  const keep: Rect[] = [];
  const wF = f.stand.w0 - 5;
  const front = toWorldL(f, 0, wF);
  const spec = {
    trim: P.blanc[0], width: 96, depth: 72, floors: 0, groundH: 6.5, wall: P.creme[0], roof: 'flat' as const, roofColor: P.ardoise[0], shutter: null, chimneys: 0, door: null, win: 'shop' as const,
    shop: { sign: 'Supermarché Marché Plus', signStyle: { bg: '#2f7d3b', fg: '#ffffff', font: 'sans' as const }, awning: [P.vertSauge[2], P.creme[0]] as [string, string], windows: 'shop' as const },
  };
  const r = placeKit(out, front.x, front.z, f.yaw, spec, 2, 'supermarket', 'supermarket');
  keep.push(r);
  const doorAt = toWorldL(f, 0, wF + 0.7);
  addDoor('supermarket', doorAt.x, doorAt.z, f.yaw);
  out.pick.push({ id: 'supermarket', box: new THREE.Box3(new THREE.Vector3(r.x0, 0, r.z0), new THREE.Vector3(r.x1, 7, r.z1)) });
  // Car park on both sides of the entrance
  const half = Math.max(Math.abs(f.stand.u0), Math.abs(f.stand.u1)) + 5;
  keep.push(localRect(f, -half, wF - 0.5, half, f.streetW + 0.6));
  for (const sg of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const u = sg * (half + 3 + i * 3.1);
      if (Math.abs(u) > f.width / 2 + 2) continue;
      const p = toWorldL(f, u, wF + 6);
      for (let k = 0; k < 2; k++) {
        const q = toWorldL(f, u + 1.5, wF + 1.5 + k * 9);
        out.b.trim.box(q.x, CURB_H + 0.01, q.z, 0.12, 0.02, 0.12, '#f6f1e6');
      }
      if (rnd() < 0.55) parkedCar(out.b, p.x, CURB_H, p.z, f.yaw + (rnd() < 0.5 ? 0 : Math.PI), pick(rnd, CAR_COLORS));
      void p;
    }
  }
  const pa = localRect(f, -f.width / 2 - 2, wF, f.width / 2 + 2, f.streetW);
  out.b.get('asphalt').box((pa.x0 + pa.x1) / 2, CURB_H, (pa.z0 + pa.z1) / 2, pa.x1 - pa.x0, 0.04, pa.z1 - pa.z0, '#6b6d70');
  keep.push(pa);
  // Trolleys by the door
  for (let i = 0; i < 5; i++) {
    const p = toWorldL(f, 9 + i * 0.75, wF + 1.4);
    out.b.metal.box(p.x, CURB_H + 0.25, p.z, 0.6, 0.6, 0.9, '#9aa3ab');
  }
  return keep;
}

/** Park visitors sit on picnic blankets spread on the lawn around the fountain path. */
export function parkChairs(out: TownOut): void {
  const city = getCity();
  const rnd = seeded(31);
  const cols = [P.rougeFane[0], P.bleuGris[1], P.ocre[0], P.vertSauge[1]];
  for (let slot = 0; slot < 16; slot++) {
    const p = city.insidePos('park', slot);
    // Blankets on the lawn either side of the path (people on the path itself stand).
    if (Math.abs(p.x - 360) < 3.5) continue;
    const head = (rnd() - 0.5) * 1.0 + (p.x < 360 ? 0.7 : -0.7);
    const f = frameAt(p.x, p.y, head);
    const c = pick(rnd, cols);
    // Gingham: a coloured cloth with pale stripes.
    out.b.cloth.box(0, CURB_H + 0.1, -0.25, 1.9, 0.03, 1.9, c, 0, f);
    for (const o of [-0.5, 0, 0.5]) {
      out.b.cloth.box(o, CURB_H + 0.115, -0.25, 0.22, 0.03, 1.9, P.blanc[0], 0, f);
      out.b.cloth.box(0, CURB_H + 0.118, -0.25 + o, 1.9, 0.03, 0.22, P.blanc[0], 0, f);
    }
    out.b.wood.box(0.7, CURB_H + 0.12, 0.45, 0.5, 0.32, 0.36, '#a6744f', 0, f);
    addSeat('park', { x: p.x, z: p.y, heading: head, height: 0.12 });
  }
}

// ---------------------------------------------------------------------------
// The canal along the south edge (purely decorative, off the street graph)
// ---------------------------------------------------------------------------

export const CANAL = { z0: 497, z1: 511, level: -1.1 };

/** Stone footbridges and moored boats on the canal behind Maison du Canal. */
export function canalDressing(out: TownOut, protos: Record<ModelName, Proto>): void {
  const rnd = seeded(12);
  const br = protos.bridge;
  for (const x of [180, 420, 660]) {
    const s = (CANAL.z1 - CANAL.z0 + 7) / br.size.x;
    placeModel(out.b, br, modelMatrix(br, x, CANAL.level + 0.4, (CANAL.z0 + CANAL.z1) / 2, Math.PI / 2, s), { tint: [[/./, P.pierre[1]]] });
  }
  const hulls = [P.bleuGris[1], P.rougeFane[0], P.vertSauge[1], P.creme[0], P.ocre[1]];
  for (const x of [70, 250, 300, 395, 470, 545, 610]) {
    const f = frameAt(x + rnd() * 10, CANAL.z0 + 3 + rnd() * 1.5, Math.PI / 2 + (rnd() - 0.5) * 0.1);
    const c = pick(rnd, hulls);
    const y = CANAL.level - 0.2;
    out.b.wood.box(0, y, 0, 2.4, 0.9, 7.5, c, 0, f);
    out.b.wood.box(0, y + 0.9, 0, 2.5, 0.15, 7.6, P.boisChaud[1], 0, f);
    out.b.wood.shape('prism', 0, y, 4.2, 2.4, 0.9, 1.4, c, { x: Math.PI / 2 }, f);
    if (rnd() < 0.6) {
      out.b.plaster.box(0, y + 1.0, -1.0, 1.8, 1.2, 2.6, P.creme[0], 0, f);
      out.b.roof.box(0, y + 2.2, -1.0, 2.1, 0.15, 2.9, P.rougeFane[1], 0, f);
    }
  }
  // Willows and benches along the quay
  for (let x = 30; x < 700; x += 55 + rnd() * 30) out.trees.push({ kind: 'treeFat', x, z: CANAL.z1 + 5 + rnd() * 3, h: 8 + rnd() * 3 });
}

// ---------------------------------------------------------------------------
// Parc des Tilleuls (real scale): paths, fountain, pond, bandstand, beds, hedges
// ---------------------------------------------------------------------------

export const PARK = { fountain: { x: 360, z: 300 }, pond: { x: 305, z: 279, rx: 21, rz: 11 }, kiosk: { x: 414, z: 323 } };

export function buildPark(out: TownOut, protos: Record<ModelName, Proto>): { lamps: THREE.Vector3[] } {
  const rnd = seeded(hashString('parc-des-tilleuls'));
  const g = out.b;
  const y = CURB_H + 0.02;
  const x0 = 252, x1 = 468, z0 = 252, z1 = 348;
  const gravel = g.get('gravel');
  // Diagonal path SW -> NE and a ring around the fountain
  const ax = x0 + 6, az = z1 - 6, bx = x1 - 6, bz = z0 + 6;
  const len = Math.hypot(bx - ax, bz - az);
  const rot = Math.atan2(-(bz - az), bx - ax);
  gravel.box((ax + bx) / 2, y, (az + bz) / 2, len, 0.04, 3.2, '#d9c9a3', rot);
  const F = PARK.fountain;
  gravel.cyl(F.x, y, F.z, 11, 0.05, '#ddd0ae', true);
  // Fountain: basin, rim, column, bowl (spray in Life.tsx)
  g.stone.cyl(F.x, y, F.z, 5, 0.65, P.pierre[1], true);
  g.stone.cyl(F.x, y + 0.65, F.z, 5.15, 0.12, P.pierre[0], true);
  g.stone.cyl(F.x, y, F.z, 0.45, 2.6, P.pierre[0], true);
  g.stone.cyl(F.x, y + 2.3, F.z, 1.4, 0.3, P.pierre[0], true);
  g.stone.cyl(F.x, y + 2.6, F.z, 0.25, 0.8, P.pierre[0], true);
  // Pond with a stone edge
  const pd = PARK.pond;
  g.stone.shape('cyl16', pd.x, y + 0.15, pd.z, pd.rx * 2 + 1.6, 0.3, pd.rz * 2 + 1.6, P.pierre[1]);
  // Bandstand (kiosque à musique) with a green roof
  const gz = protos.gazebo;
  placeModel(g, gz, modelMatrix(gz, PARK.kiosk.x, y, PARK.kiosk.z, -0.6, 6.5 / gz.size.y), { tint: [[/roof/i, P.vertSauge[2]], [/wood/i, P.creme[1]]] });
  g.stone.cyl(PARK.kiosk.x, y, PARK.kiosk.z, 4.8, 0.5, P.pierre[1]);
  // Flower beds
  for (const [bx2, bz2, r] of [[421, 268, 4.5], [438, 286, 3.2], [300, 323, 4]] as const) {
    g.wood.cyl(bx2, y, bz2, r + 0.2, 0.25, '#6b4a30', true);
    g.get('foliage').cyl(bx2, y + 0.1, bz2, r, 0.3, PAL.leafDark, true);
    for (let i = 0; i < r * 9; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * r * 0.9;
      g.trim.shape('dodeca', bx2 + Math.cos(a) * rr, y + 0.5, bz2 + Math.sin(a) * rr, 0.42, 0.34, 0.42, pick(rnd, PAL.flowers));
    }
  }
  // Low hedges along the border, gaps at the entrances (north / south paths and corners)
  const hedge = (a: number, b: number, fixed: number, horizontal: boolean) => {
    if (b - a < 1) return;
    if (horizontal) g.leaf.box((a + b) / 2, y, fixed, b - a, 1.1, 0.9, PAL.leafDark);
    else g.leaf.box(fixed, y, (a + b) / 2, 0.9, 1.1, b - a, PAL.leafDark);
  };
  hedge(x0 + 10, 352, z0 + 1.5, true);
  hedge(368, x1 - 3, z0 + 1.5, true);
  hedge(x0 + 3, 352, z1 - 1.5, true);
  hedge(368, x1 - 10, z1 - 1.5, true);
  hedge(z0 + 3, z1 - 10, x0 + 1.5, false);
  hedge(z0 + 10, z1 - 3, x1 - 1.5, false);
  // Benches around the fountain and the pond, facing the centre
  const benches: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.5;
    benches.push([F.x + Math.cos(a) * 9, F.z + Math.sin(a) * 9]);
  }
  benches.push([pd.x - 6, pd.z + pd.rz + 3], [pd.x + 8, pd.z + pd.rz + 3], [PARK.kiosk.x - 9, PARK.kiosk.z + 2], [PARK.kiosk.x - 7, PARK.kiosk.z - 6]);
  for (const [bx2, bz2] of benches) {
    if (Math.abs(bx2 - 360) < 4) continue;
    const toward = PARK.kiosk.x === bx2 ? 0 : Math.atan2(F.x - bx2, F.z - bz2);
    pushInst(out.instances, 'bench1', { x: bx2, y, z: bz2, rotY: toward + Math.PI, scale: 2.2 / protos.bench1.size.x });
  }
  // Trees (lindens = "tilleuls"), kept off paths, water, beds and the picnic lawn
  const blocked = (x: number, z: number) =>
    Math.abs(x - 360) < 12 ||
    Math.hypot(x - F.x, z - F.z) < 16 ||
    ((x - pd.x) / (pd.rx + 6)) ** 2 + ((z - pd.z) / (pd.rz + 6)) ** 2 < 1 ||
    Math.hypot(x - PARK.kiosk.x, z - PARK.kiosk.z) < 10 ||
    Math.abs((z - az) - ((x - ax) * (bz - az)) / (bx - ax)) < 5;
  let n = 0;
  for (let i = 0; i < 500 && n < 30; i++) {
    const x = x0 + 6 + rnd() * (x1 - x0 - 12);
    const z = z0 + 6 + rnd() * (z1 - z0 - 12);
    if (blocked(x, z) || out.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 8)) continue;
    out.trees.push({ kind: pick(rnd, ['treeOak', 'treeDetailed', 'treeDefault', 'treeOak'] as const), x, z, h: 9 + rnd() * 5 });
    n++;
  }
  // Lamps along the paths
  const lamps: THREE.Vector3[] = [];
  for (const [lx, lz] of [[355, 262], [365, 338], [330, 296], [390, 304], [290, 318], [428, 280], [F.x + 8, F.z - 8]] as const) {
    pushInst(out.instances, 'lamp', { x: lx, y, z: lz, rotY: rnd() * 6, scale: 4.2 / protos.lamp.size.y });
    lamps.push(new THREE.Vector3(lx, y + 3.85, lz));
  }
  out.pick.push({ id: 'park', box: new THREE.Box3(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, 3, z1)) });
  return { lamps };
}

/** Tree clumps and lone trees in the fields around the town (cheap species). */
export function countryside(out: TownOut): void {
  const rnd = seeded(808);
  const roads: [number, number][][] = [
    [[240, -18], [232, -160], [205, -330], [190, -560], [150, -900]],
    [[-18, 360], [-170, 372], [-360, 405], [-620, 420], [-1000, 470]],
    [[420, 514], [428, 640], [462, 820], [520, 1100]],
    [[738, 120], [900, 110], [1120, 70]],
  ];
  const nearRoad = (x: number, z: number) =>
    roads.some((r) => r.some(([ax, az], i) => {
      if (i === 0) return false;
      const [px, pz] = r[i - 1];
      const dx = ax - px, dz = az - pz;
      const t = Math.max(0, Math.min(1, ((x - px) * dx + (z - pz) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(x - (px + dx * t), z - (pz + dz * t)) < 9;
    }));
  const inTown = (x: number, z: number) => x > -40 && x < 760 && z > -40 && z < 530;
  let clumps = 0;
  for (let i = 0; i < 300 && clumps < 22; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 520 + rnd() * 620;
    const cx = 360 + Math.cos(a) * r * 1.2;
    const cz = 240 + Math.sin(a) * r;
    if (inTown(cx, cz) || Math.abs(cz - 504) < 30) continue;
    const n = 3 + Math.floor(rnd() * 6);
    for (let k = 0; k < n; k++) {
      const x = cx + (rnd() - 0.5) * 50;
      const z = cz + (rnd() - 0.5) * 36;
      if (inTown(x, z) || nearRoad(x, z) || Math.abs(z - 504) < 14) continue;
      out.farTrees.push({ kind: rnd() < 0.6 ? 'treeDefault' : 'treeFat', x, z, h: 9 + rnd() * 6 });
    }
    clumps++;
  }
  // Lone trees along the dirt roads
  for (const r of roads) {
    for (let i = 1; i < r.length; i++) {
      const [px, pz] = r[i - 1];
      const [ax, az] = r[i];
      for (let t = 0.2; t < 1; t += 0.45) {
        const x = px + (ax - px) * t + 8 * (rnd() < 0.5 ? -1 : 1);
        const z = pz + (az - pz) * t;
        if (!inTown(x, z) && Math.abs(z - 504) > 14) out.farTrees.push({ kind: 'treeFat', x, z, h: 8 + rnd() * 4 });
      }
    }
  }
}
