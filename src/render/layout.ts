/**
 * Static urban layout derived from the simulation's city (never mutates it).
 *
 * The street graph is fixed (people walk on it), so the town is designed
 * around it: each block becomes a perimeter of houses around gardens, each
 * location is a small "placette" — its building recessed at the back of the
 * lot, a forecourt / terrace / yard in front where the inhabitants stand
 * (City.insidePos), flanked by filler houses that line the streets.
 */

import * as THREE from 'three';
import { CITY_HEIGHT, CITY_WIDTH, LOCATIONS, STREET_SPACING, getCity } from '../sim/city';
import type { LocationDef } from '../sim/types';

export const ROAD = 7;
export const SIDEWALK_W = 4.5;
/** Distance from a street centreline to the inner edge of the sidewalk. */
export const EDGE = ROAD + SIDEWALK_W;
/** Height of the sidewalk / block slabs. */
export const CURB_H = 0.28;

/** Locations rendered with full detail (the hero district). */
export const HERO_LOCATIONS = new Set(['cafe', 'bakery', 'florist', 'park', 'school', 'supermarket']);
/** Bus stops of the hero district. */
export const HERO_STOPS = new Set(['stop_parc', 'stop_marche', 'stop_super']);

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export const rect = (x0: number, z0: number, x1: number, z1: number): Rect => ({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) });
export const overlaps = (a: Rect, b: Rect, m = 0) => a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.z0 < b.z1 + m && a.z1 > b.z0 - m;
export const inside = (x: number, z: number, r: Rect, m = 0) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;

/** Hero district ellipse (also used by the haze shader). */
export const HERO_C = new THREE.Vector2(300, 185);
export const HERO_R = new THREE.Vector2(240, 230);
export function heroDist(x: number, z: number): number {
  return Math.hypot((x - HERO_C.x) / HERO_R.x, (z - HERO_C.y) / HERO_R.y);
}

/** Blocks between streets (street centrelines), with merged blocks for the park and the school. */
export interface Block {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Inner area (inside the sidewalks). */
  inner: Rect;
  hero: boolean;
  kind: 'normal' | 'park' | 'school';
}

const HERO_BLOCKS = new Set(['120,0', '240,0', '120,120', '240,120', '360,120', '120,240', '240,240']);

let blockCache: Block[] | null = null;
export function blocks(): Block[] {
  if (blockCache) return blockCache;
  const out: Block[] = [];
  for (let x = 0; x < CITY_WIDTH; x += STREET_SPACING) {
    for (let z = 0; z < CITY_HEIGHT; z += STREET_SPACING) {
      let x1 = x + STREET_SPACING;
      let kind: Block['kind'] = 'normal';
      // The x = 360 street crosses the park and the school: merge those blocks.
      if (x === 360 && (z === 0 || z === 240)) continue;
      if (x === 240 && (z === 0 || z === 240)) {
        x1 = 480;
        kind = z === 0 ? 'school' : 'park';
      }
      const z1 = z + STREET_SPACING;
      out.push({ x0: x, z0: z, x1, z1, inner: rect(x + EDGE, z + EDGE, x1 - EDGE, z1 - EDGE), hero: HERO_BLOCKS.has(`${x},${z}`), kind });
    }
  }
  blockCache = out;
  return out;
}

export type Side = 'N' | 'S' | 'E' | 'W';

/** A location expressed in its own frame: local +z points to its door (street). */
export interface LotFrame {
  loc: LocationDef;
  side: Side;
  yaw: number;
  frame: THREE.Matrix4;
  /** Frontage width (along local x) and depth (along local z). */
  width: number;
  depth: number;
  /** Local z of the door node and of the sidewalk inner edge. */
  doorW: number;
  streetW: number;
  /** Bounding box of the standing spots (local), slots 0..11. */
  stand: { u0: number; u1: number; w0: number; w1: number };
  hero: boolean;
  /** 2 = hero, 1 = medium, 0 = calm. */
  detail: 0 | 1 | 2;
}

export function yawOf(side: Side): number {
  return side === 'S' ? 0 : side === 'N' ? Math.PI : side === 'E' ? Math.PI / 2 : -Math.PI / 2;
}

/** World -> local of a lot frame. */
export function toLocal(f: LotFrame, x: number, z: number): { u: number; w: number } {
  const dx = x - f.loc.pos.x;
  const dz = z - f.loc.pos.y;
  const c = Math.cos(f.yaw);
  const s = Math.sin(f.yaw);
  // local u axis = (cos, -sin), w axis = (sin, cos)
  return { u: dx * c - dz * s, w: dx * s + dz * c };
}

/** Local -> world of a lot frame. */
export function toWorldL(f: LotFrame, u: number, w: number): { x: number; z: number } {
  const c = Math.cos(f.yaw);
  const s = Math.sin(f.yaw);
  return { x: f.loc.pos.x + u * c + w * s, z: f.loc.pos.y - u * s + w * c };
}

/** World rect of a local rect (u0..u1, w0..w1) of a lot frame. */
export function localRect(f: LotFrame, u0: number, w0: number, u1: number, w1: number): Rect {
  const a = toWorldL(f, u0, w0);
  const b = toWorldL(f, u1, w1);
  return rect(a.x, a.z, b.x, b.z);
}

let lotCache: Map<string, LotFrame> | null = null;
export function lotFrames(): Map<string, LotFrame> {
  if (lotCache) return lotCache;
  const city = getCity();
  const map = new Map<string, LotFrame>();
  for (const loc of LOCATIONS) {
    if (loc.kind === 'bus_stop') continue;
    const door = city.doorPos(loc.id);
    const dx = door.x - loc.pos.x;
    const dz = door.y - loc.pos.y;
    const side: Side = Math.abs(dx) / loc.size.x > Math.abs(dz) / loc.size.y ? (dx > 0 ? 'E' : 'W') : dz > 0 ? 'S' : 'N';
    const yaw = yawOf(side);
    const frame = new THREE.Matrix4().makeRotationY(yaw).setPosition(loc.pos.x, 0, loc.pos.y);
    const ns = side === 'N' || side === 'S';
    const f: LotFrame = {
      loc,
      side,
      yaw,
      frame,
      width: ns ? loc.size.x : loc.size.y,
      depth: ns ? loc.size.y : loc.size.x,
      doorW: 0,
      streetW: 0,
      stand: { u0: 0, u1: 0, w0: 0, w1: 0 },
      hero: HERO_LOCATIONS.has(loc.id),
      detail: 0,
    };
    f.doorW = toLocal(f, door.x, door.y).w;
    f.streetW = f.doorW - EDGE;
    let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
    for (let s = 0; s < 12; s++) {
      const p = city.insidePos(loc.id, s);
      const l = toLocal(f, p.x, p.y);
      u0 = Math.min(u0, l.u); u1 = Math.max(u1, l.u);
      w0 = Math.min(w0, l.w); w1 = Math.max(w1, l.w);
    }
    f.stand = { u0, u1, w0, w1 };
    const blk = blocks().find((b) => inside(loc.pos.x, loc.pos.y, rect(b.x0, b.z0, b.x1, b.z1)));
    f.detail = f.hero ? 2 : blk?.hero ? 1 : 0;
    map.set(loc.id, f);
  }
  lotCache = map;
  return map;
}

/** Detail level of a filler at a world position. */
export function detailAt(x: number, z: number): 0 | 1 | 2 {
  const blk = blocks().find((b) => inside(x, z, rect(b.x0, b.z0, b.x1, b.z1)));
  if (blk?.hero) return 2;
  return heroDist(x, z) < 1.3 ? 1 : 0;
}

/** Spots where people wait at a bus stop are pushed this far onto the sidewalk (render only). */
export const STOP_PUSH = 5;

/** Is (x, z) on the asphalt of a street (not a footpath)? */
export function onRoad(x: number, z: number): boolean {
  const nx = Math.round(x / STREET_SPACING) * STREET_SPACING;
  const nz = Math.round(z / STREET_SPACING) * STREET_SPACING;
  const inX = Math.abs(x - nx) < ROAD && z > -ROAD && z < CITY_HEIGHT + ROAD && nx >= 0 && nx <= CITY_WIDTH;
  const inZ = Math.abs(z - nz) < ROAD && x > -ROAD && x < CITY_WIDTH + ROAD && nz >= 0 && nz <= CITY_HEIGHT;
  if (!inX && !inZ) return false;
  // Footpath segments of x = 360 through the school and the park.
  if (inX && !inZ && nx === 360 && ((z > 0 && z < 120) || (z > 240 && z < 360))) return false;
  return true;
}

/** Cobbled street segments (shared space of Place du Marché and the café street). */
export function cobbled(x: number, z: number): boolean {
  return Math.abs(z - 120) < ROAD + 0.5 && x > 233 && x < 487;
}
