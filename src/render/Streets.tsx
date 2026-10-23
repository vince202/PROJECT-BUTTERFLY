/**
 * Ground, street network, sidewalks, markings, zebra crossings, street lamps
 * and bus stops. All static geometry is merged into a few vertex-coloured
 * batches built once.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CITY_HEIGHT, CITY_WIDTH, LOCATIONS, STREET_SPACING, getCity } from '../sim/city';
import type { LocationDef } from '../sim/types';
import { StaticBatch, batchMaterial } from './batch';
import { BASE_MARGIN, LAYER, ROAD_HALF, SIDEWALK, env, hashString, radialTexture } from './shared';

const COLORS = {
  baseTop: '#b9d18e',
  baseSide: '#7a5c41',
  baseSideDark: '#5e4632',
  block: '#bcd394',
  lot: '#e8dcc0',
  asphalt: '#4b4f57',
  asphaltPatch: '#53575f',
  sidewalk: '#d8d0bf',
  curb: '#bdb4a3',
  marking: '#f2efe6',
  path: '#e6d6ae',
  yard: '#d9cdb4',
  lampPole: '#33363d',
  stopPole: '#5a5f68',
  stopSign: '#f1c40f',
  shelterRoof: '#3d4450',
  shelterGlass: '#a9c7d6',
  bench: '#8a5a3b',
};

/** Footprints that streets may cross (rendered as footpaths instead of roads). */
function footprintAt(x0: number, z0: number, x1: number, z1: number): LocationDef | null {
  for (const l of LOCATIONS) {
    if (l.kind === 'bus_stop') continue;
    const lx0 = l.pos.x - l.size.x / 2;
    const lx1 = l.pos.x + l.size.x / 2;
    const lz0 = l.pos.y - l.size.y / 2;
    const lz1 = l.pos.y + l.size.y / 2;
    const ox = Math.min(x1, lx1) - Math.max(x0, lx0);
    const oz = Math.min(z1, lz1) - Math.max(z0, lz0);
    if (ox > 1.5 && oz > 1.5) return l;
  }
  return null;
}

export interface StreetEdge {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  horizontal: boolean;
  /** Location crossed by this segment (it becomes a footpath), if any. */
  crosses: LocationDef | null;
}

/** Street segments with their classification (road or footpath). Computed once. */
let edgeCache: StreetEdge[] | null = null;
export function streetEdges(): StreetEdge[] {
  if (edgeCache) return edgeCache;
  const city = getCity();
  edgeCache = city.edges.map((e) => {
    const a = city.nodePos(e.a);
    const b = city.nodePos(e.b);
    const ax = Math.min(a.x, b.x);
    const bx = Math.max(a.x, b.x);
    const az = Math.min(a.y, b.y);
    const bz = Math.max(a.y, b.y);
    const horizontal = a.y === b.y;
    const crosses = horizontal ? footprintAt(ax, az - 2, bx, bz + 2) : footprintAt(ax - 2, az, bx + 2, bz);
    return { ax, az, bx, bz, horizontal, crosses };
  });
  return edgeCache;
}

/** Lamp placement (shared with the park which adds its own). */
export interface LampDef {
  x: number;
  z: number;
  /** Arm direction (unit vector in XZ) pointing over the street. */
  dx: number;
  dz: number;
}

export function streetLamps(): LampDef[] {
  const lamps: LampDef[] = [];
  const stops = LOCATIONS.filter((l) => l.kind === 'bus_stop');
  const nearStop = (x: number, z: number) => stops.some((s) => Math.hypot(s.pos.x - x, s.pos.y - z) < 14);
  const off = ROAD_HALF + SIDEWALK / 2;
  // One lamp at a corner of every intersection.
  for (let x = 0; x <= CITY_WIDTH; x += STREET_SPACING) {
    for (let z = 0; z <= CITY_HEIGHT; z += STREET_SPACING) {
      const h = hashString(`lamp${x}_${z}`);
      let sx = h & 1 ? 1 : -1;
      let sz = h & 2 ? 1 : -1;
      // Keep lamps inside the city on the border.
      if (x === 0) sx = 1;
      if (x === CITY_WIDTH) sx = -1;
      if (z === 0) sz = 1;
      if (z === CITY_HEIGHT) sz = -1;
      const lx = x + sx * off;
      const lz = z + sz * off;
      if (nearStop(lx, lz)) continue;
      lamps.push({ x: lx, z: lz, dx: -sx * 0.707, dz: -sz * 0.707 });
    }
  }
  // Mid-block lamps along horizontal streets.
  for (let z = 0; z <= CITY_HEIGHT; z += STREET_SPACING) {
    for (let x = 60; x < CITY_WIDTH; x += STREET_SPACING) {
      const s = z === 0 ? 1 : z === CITY_HEIGHT ? -1 : hashString(`mid${x}_${z}`) & 1 ? 1 : -1;
      const lx = x + 22;
      const lz = z + s * off;
      if (nearStop(lx, lz) || footprintAt(lx - 8, z - 8, lx + 8, z + 8)) continue;
      lamps.push({ x: lx, z: lz, dx: 0, dz: -s });
    }
  }
  return lamps;
}

/** Lamp posts go into the solid batch; returns bulb positions for the glow batch. */
export function addLamp(batch: StaticBatch, l: LampDef, bulbs: THREE.Vector3[]): void {
  const H = 9;
  batch.cyl(l.x, 0, l.z, 0.45, 0.8, COLORS.lampPole);
  batch.cyl(l.x, 0, l.z, 0.22, H, COLORS.lampPole);
  // Arm
  const armLen = 2.4;
  const ax = l.x + l.dx * armLen * 0.5;
  const az = l.z + l.dz * armLen * 0.5;
  batch.box(ax, H - 0.3, az, Math.abs(l.dx) * armLen + 0.25, 0.25, Math.abs(l.dz) * armLen + 0.25, COLORS.lampPole);
  const bx = l.x + l.dx * armLen;
  const bz = l.z + l.dz * armLen;
  batch.shape('cone4', bx, H - 0.1, bz, 1.6, 0.8, 1.6, COLORS.lampPole, { y: Math.PI / 4 });
  bulbs.push(new THREE.Vector3(bx, H - 0.75, bz));
}

/** A bus stop: pole with a yellow sign and a small glass shelter with a bench. */
function addBusStop(batch: StaticBatch, stop: LocationDef): void {
  const city = getCity();
  const node = city.nodePos(stop.node);
  // Stops sit on horizontal streets; side = which sidewalk.
  const side = Math.sign(stop.pos.y - node.y) || -1;
  const poleZ = node.y + side * (ROAD_HALF + 1.2);
  const px = stop.pos.x + 6;
  batch.cyl(px, 0, poleZ, 0.18, 6.5, COLORS.stopPole);
  batch.box(px, 5.0, poleZ, 0.25, 1.8, 1.8, COLORS.stopSign);
  batch.box(px, 5.55, poleZ, 0.3, 0.45, 1.9, '#2d3e50');
  // Shelter behind the sidewalk
  const sz = node.y + side * (ROAD_HALF + SIDEWALK + 2.6);
  const sx = stop.pos.x - 1;
  const w = 9;
  const d = 3.6;
  const backZ = sz + side * (d / 2 - 0.15);
  batch.box(sx, LAYER.sidewalk, sz, w + 1, 0.15, d + 0.6, COLORS.sidewalk);
  batch.box(sx, 0, backZ, w, 4.6, 0.25, COLORS.shelterGlass);
  batch.box(sx - w / 2, 0, sz, 0.3, 4.8, d, COLORS.shelterRoof);
  batch.box(sx + w / 2, 0, sz, 0.3, 4.8, d, COLORS.shelterRoof);
  batch.box(sx, 4.8, sz, w + 0.8, 0.35, d + 0.6, COLORS.shelterRoof);
  batch.box(sx, 4.6, sz - side * (d / 2 + 0.2), w + 0.8, 0.5, 0.15, COLORS.stopSign);
  // Bench
  batch.box(sx, 1.3, backZ - side * 1.0, w * 0.7, 0.3, 1.2, COLORS.bench);
  batch.box(sx - w * 0.3, 0, backZ - side * 1.0, 0.25, 1.3, 1.0, COLORS.lampPole);
  batch.box(sx + w * 0.3, 0, backZ - side * 1.0, 0.25, 1.3, 1.0, COLORS.lampPole);
}

/** Zebra crossing across a horizontal (or vertical) street centred at (x, z). */
function addZebra(batch: StaticBatch, x: number, z: number, horizontalStreet: boolean): void {
  const stripes = 6;
  const pitch = (ROAD_HALF * 2 - 1.2) / stripes;
  for (let i = 0; i < stripes; i++) {
    const o = -ROAD_HALF + 0.6 + pitch * (i + 0.5);
    if (horizontalStreet) batch.box(x, LAYER.road, z + o, 5, 0.08, pitch * 0.55, COLORS.marking);
    else batch.box(x + o, LAYER.road, z, pitch * 0.55, 0.08, 5, COLORS.marking);
  }
}

export function Streets() {
  const built = useMemo(() => {
    const ground = new StaticBatch();
    const solid = new StaticBatch();
    const bulbs: THREE.Vector3[] = [];
    const edges = streetEdges();

    // --- Diorama base -----------------------------------------------------
    const W = CITY_WIDTH + BASE_MARGIN * 2;
    const H = CITY_HEIGHT + BASE_MARGIN * 2;
    const cx = CITY_WIDTH / 2;
    const cz = CITY_HEIGHT / 2;
    ground.box(cx, -14, cz, W, 14, H, COLORS.baseSide);
    ground.box(cx, -18, cz, W - 6, 4, H - 6, COLORS.baseSideDark);
    ground.box(cx, -0.6, cz, W, 0.6, H, COLORS.baseTop);

    // --- City blocks --------------------------------------------------------
    const inset = ROAD_HALF + SIDEWALK;
    for (let x = 0; x < CITY_WIDTH; x += STREET_SPACING) {
      for (let z = 0; z < CITY_HEIGHT; z += STREET_SPACING) {
        ground.box(x + STREET_SPACING / 2, -0.1, z + STREET_SPACING / 2, STREET_SPACING - inset * 2, LAYER.block + 0.1, STREET_SPACING - inset * 2, COLORS.block);
      }
    }
    // Paved lots under buildings + a path from the door to the sidewalk.
    const city = getCity();
    for (const l of LOCATIONS) {
      if (l.kind === 'park' || l.kind === 'bus_stop') continue;
      ground.box(l.pos.x, -0.1, l.pos.y, l.size.x + 10, LAYER.lot + 0.1, l.size.y + 10, COLORS.lot);
      const door = city.doorPos(l.id);
      const dx = door.x - l.pos.x;
      const dz = door.y - l.pos.y;
      if (Math.abs(dx) / l.size.x > Math.abs(dz) / l.size.y) {
        const x0 = l.pos.x + Math.sign(dx) * l.size.x / 2;
        const x1 = door.x - Math.sign(dx) * inset;
        ground.box((x0 + x1) / 2, -0.1, door.y, Math.abs(x1 - x0), LAYER.lot + 0.1, 8, COLORS.lot);
      } else {
        const z0 = l.pos.y + Math.sign(dz) * l.size.y / 2;
        const z1 = door.y - Math.sign(dz) * inset;
        ground.box(door.x, -0.1, (z0 + z1) / 2, 8, LAYER.lot + 0.1, Math.abs(z1 - z0), COLORS.lot);
      }
    }

    // --- Streets --------------------------------------------------------------
    // Road presence per node and direction (to trim sidewalks at crossings).
    const roadDir = new Set<string>();
    for (const e of edges) {
      if (e.crosses) continue;
      if (e.horizontal) {
        roadDir.add(`${e.ax},${e.az},+x`);
        roadDir.add(`${e.bx},${e.bz},-x`);
      } else {
        roadDir.add(`${e.ax},${e.az},+z`);
        roadDir.add(`${e.bx},${e.bz},-z`);
      }
    }
    const has = (x: number, z: number, d: string) => roadDir.has(`${x},${z},${d}`);
    const corner = ROAD_HALF + SIDEWALK / 2;

    for (const e of edges) {
      if (e.crosses) {
        // Footpath through the park / school yard.
        const color = e.crosses.kind === 'park' ? COLORS.path : COLORS.yard;
        if (e.horizontal) ground.box((e.ax + e.bx) / 2, -0.1, e.az, e.bx - e.ax + 6, LAYER.parkPath + 0.1, 7, color);
        else ground.box(e.ax, -0.1, (e.az + e.bz) / 2, 7, LAYER.parkPath + 0.1, e.bz - e.az + 6, color);
        continue;
      }
      const len = e.horizontal ? e.bx - e.ax : e.bz - e.az;
      const mx = (e.ax + e.bx) / 2;
      const mz = (e.az + e.bz) / 2;
      // Asphalt (extended over intersections)
      if (e.horizontal) ground.box(mx, -0.1, mz, len + ROAD_HALF * 2, LAYER.road + 0.1, ROAD_HALF * 2, COLORS.asphalt);
      else ground.box(mx, -0.1, mz, ROAD_HALF * 2, LAYER.road + 0.1, len + ROAD_HALF * 2, COLORS.asphalt);

      // Sidewalk strips on both sides, trimmed where a cross street joins.
      for (const s of [-1, 1]) {
        const perp = e.horizontal ? (s > 0 ? '+z' : '-z') : s > 0 ? '+x' : '-x';
        const along0 = e.horizontal ? '-x' : '-z';
        const along1 = e.horizontal ? '+x' : '+z';
        let t0 = 0;
        let t1 = 0;
        if (has(e.ax, e.az, perp)) t0 = corner + SIDEWALK / 2;
        else if (!has(e.ax, e.az, along0)) t0 = -(corner + SIDEWALK / 2);
        if (has(e.bx, e.bz, perp)) t1 = corner + SIDEWALK / 2;
        else if (!has(e.bx, e.bz, along1)) t1 = -(corner + SIDEWALK / 2);
        const l = len - t0 - t1;
        if (l <= 0) continue;
        const c = (t0 - t1) / 2;
        if (e.horizontal) {
          ground.box(mx + c, -0.1, mz + s * corner, l, LAYER.sidewalk + 0.1, SIDEWALK, COLORS.sidewalk);
          ground.box(mx + c, -0.1, mz + s * (ROAD_HALF + 0.2), l, LAYER.sidewalk + 0.12, 0.4, COLORS.curb);
        } else {
          ground.box(mx + s * corner, -0.1, mz + c, SIDEWALK, LAYER.sidewalk + 0.1, l, COLORS.sidewalk);
          ground.box(mx + s * (ROAD_HALF + 0.2), -0.1, mz + c, 0.4, LAYER.sidewalk + 0.12, l, COLORS.curb);
        }
      }

      // Dashed centre line, skipping the intersection areas.
      const dashes = 5;
      for (let i = 0; i < dashes; i++) {
        const t = -len / 2 + 12 + ((len - 24) / (dashes - 1)) * i;
        if (e.horizontal) ground.box(mx + t, -0.1, mz, 3.2, LAYER.marking + 0.1, 0.35, COLORS.marking);
        else ground.box(mx, -0.1, mz + t, 0.35, LAYER.marking + 0.1, 3.2, COLORS.marking);
      }
    }

    // Sidewalk corner squares at intersections.
    for (let x = 0; x <= CITY_WIDTH; x += STREET_SPACING) {
      for (let z = 0; z <= CITY_HEIGHT; z += STREET_SPACING) {
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            ground.box(x + sx * corner, -0.1, z + sz * corner, SIDEWALK, LAYER.sidewalk + 0.1, SIDEWALK, COLORS.sidewalk);
          }
        }
      }
    }

    // --- Zebra crossings near bus stops and the school ----------------------------
    const zebras = new Map<string, [number, number, boolean]>();
    for (const l of LOCATIONS) {
      if (l.kind !== 'bus_stop') continue;
      const n = city.nodePos(l.node);
      zebras.set(`${n.x - 16},${n.y}`, [n.x - 16, n.y, true]);
    }
    const school = LOCATIONS.find((l) => l.kind === 'school');
    if (school) {
      const n = city.nodePos(school.node);
      zebras.set(`${n.x - 18},${n.y}`, [n.x - 18, n.y, true]);
      zebras.set(`${n.x + 18},${n.y}`, [n.x + 18, n.y, true]);
      zebras.set(`${n.x},${n.y + 18}`, [n.x, n.y + 18, false]);
    }
    for (const [x, z, h] of zebras.values()) addZebra(ground, x, z, h);

    // --- Lamps and bus stops -----------------------------------------------------
    const lamps = streetLamps();
    for (const l of lamps) addLamp(solid, l, bulbs);
    for (const l of LOCATIONS) if (l.kind === 'bus_stop') addBusStop(solid, l);

    return { ground: ground.build(), solid: solid.build(), bulbs };
  }, []);

  const groundMat = useMemo(() => batchMaterial({ roughness: 0.95 }), []);
  const solidMat = useMemo(() => batchMaterial(), []);

  useEffect(
    () => () => {
      built.ground?.dispose();
      built.solid?.dispose();
      groundMat.dispose();
      solidMat.dispose();
    },
    [built, groundMat, solidMat],
  );

  // Streets get slightly glossier when it rains.
  useFrame(() => {
    groundMat.roughness = 0.95 - env.rain * 0.35;
  });

  return (
    <group>
      {built.ground && <mesh geometry={built.ground} material={groundMat} receiveShadow />}
      {built.solid && <mesh geometry={built.solid} material={solidMat} castShadow receiveShadow />}
      <LampGlow bulbs={built.bulbs} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Night lighting: emissive bulbs, ground light pools and a few real lights.
// ---------------------------------------------------------------------------

/** Positions of the few real point lights (at most 4 for performance). */
const POINT_LIGHTS: [number, number][] = [
  [300, 128],
  [548, 248],
  [360, 300],
  [652, 368],
];

const BULB_DAY = new THREE.Color('#d9d4c4');
const BULB_NIGHT = new THREE.Color('#ffd27a').multiplyScalar(1.8);

/** How much lamps are switched on for a given night factor (smooth ramp at dusk / dawn). */
export function lampsOn(night: number): number {
  return THREE.MathUtils.smoothstep(night, 0.15, 0.6);
}

/** Colour of an emissive lamp bulb for a given night factor. */
export function bulbColor(out: THREE.Color, night: number): THREE.Color {
  return out.copy(BULB_DAY).lerp(BULB_NIGHT, lampsOn(night));
}

export function LampGlow({ bulbs, withLights = true }: { bulbs: THREE.Vector3[]; withLights?: boolean }) {
  const lights = useRef<(THREE.PointLight | null)[]>([]);

  const { bulbGeo, poolGeo } = useMemo(() => {
    const b = new StaticBatch();
    for (const p of bulbs) b.shape('ico1', p.x, p.y, p.z, 1.1, 1.1, 1.1, '#ffffff');
    // Light pools: flat quads with a radial texture, merged.
    const quads: THREE.BufferGeometry[] = [];
    for (const p of bulbs) {
      const q = new THREE.PlaneGeometry(22, 22);
      q.rotateX(-Math.PI / 2);
      q.translate(p.x, LAYER.sidewalk + 0.12, p.z);
      quads.push(q);
    }
    const pools = quads.length ? mergeQuads(quads) : null;
    return { bulbGeo: b.build(), poolGeo: pools };
  }, [bulbs]);

  const bulbMat = useMemo(() => new THREE.MeshBasicMaterial({ color: BULB_DAY.clone(), toneMapped: false }), []);
  const poolMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: radialTexture(),
        color: '#ffcf80',
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    [],
  );

  useEffect(
    () => () => {
      bulbGeo?.dispose();
      poolGeo?.dispose();
      bulbMat.dispose();
      poolMat.dispose();
    },
    [bulbGeo, poolGeo, bulbMat, poolMat],
  );

  useFrame(() => {
    const on = lampsOn(env.night);
    bulbColor(bulbMat.color, env.night);
    poolMat.opacity = on * 0.55;
    poolMat.visible = on > 0.01;
    for (const l of lights.current) if (l) l.intensity = on * 420;
  });

  return (
    <group>
      {bulbGeo && <mesh geometry={bulbGeo} material={bulbMat} />}
      {poolGeo && <mesh geometry={poolGeo} material={poolMat} renderOrder={1} />}
      {withLights && POINT_LIGHTS.map(([x, z], i) => (
        <pointLight
          key={i}
          ref={(el) => {
            lights.current[i] = el;
          }}
          position={[x, 10, z]}
          color="#ffc978"
          intensity={0}
          distance={90}
          decay={2}
        />
      ))}
    </group>
  );
}

/** Merge plain quads keeping their uvs (StaticBatch drops uvs). */
function mergeQuads(quads: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const total = quads.reduce((n, q) => n + q.attributes.position.count, 0);
  const pos = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const index: number[] = [];
  let off = 0;
  for (const q of quads) {
    pos.set(q.attributes.position.array as Float32Array, off * 3);
    uv.set(q.attributes.uv.array as Float32Array, off * 2);
    const idx = q.index!.array;
    for (let i = 0; i < idx.length; i++) index.push(idx[i] + off);
    off += q.attributes.position.count;
    q.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}
