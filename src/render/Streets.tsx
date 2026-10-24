/**
 * Ground of the town: countryside, asphalt streets following the simulation
 * graph (centrelines never move), cobbled shared space on the café / market
 * street, raised blocks with rounded curbs and paved sidewalks, gardens,
 * zebra crossings, footpaths through the school and the park, forecourts of
 * every location, plus the street furniture (lamp posts with night halos, bus
 * shelters). Static geometry is merged per surface material.
 */

import { Suspense, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CITY_HEIGHT, CITY_WIDTH, LOCATIONS, STREET_SPACING, getCity } from '../sim/city';
import type { LocationDef } from '../sim/types';
import { type StaticBatch, roundedSlabGeometry } from './batch';
import { Batches, PAL, SignAtlas, bulbMat } from './kit';
import { CURB_H, EDGE, HERO_STOPS, ROAD, SIDEWALK_W, blocks, cobbled, lotFrames, localRect } from './layout';
import { U, makeBillboards, waterMaterial } from './materials';
import { instancedModel, useProtos } from './models';
import { env, radialTexture } from './shared';

const C = {
  asphalt: '#5b5e64',
  cobble: '#a39a8c',
  paving: '#c2b8a6',
  curb: '#b3aa9a',
  grass: '#8fb466',
  country: '#9cbc6c',
  marking: '#efe9dc',
  forecourt: '#d8cdb8',
  path: '#d9c9a3',
};

// ---------------------------------------------------------------------------
// Lamps (positions shared with the park)
// ---------------------------------------------------------------------------

export interface LampDef {
  x: number;
  z: number;
  /** Direction the lamp head faces (unit vector in XZ), towards the street. */
  dx: number;
  dz: number;
}

/** Lamp posts at the corners of intersections and mid-block, on the curb side of the sidewalk. */
export function streetLamps(): LampDef[] {
  const lamps: LampDef[] = [];
  const stops = LOCATIONS.filter((l) => l.kind === 'bus_stop');
  const nearStop = (x: number, z: number) => stops.some((s) => Math.hypot(s.pos.x + 4 - x, s.pos.y - z) < 15);
  const off = ROAD + 0.7;
  const corner = ROAD + 3.2;
  for (let x = 0; x <= CITY_WIDTH; x += STREET_SPACING) {
    for (let z = 0; z <= CITY_HEIGHT; z += STREET_SPACING) {
      for (const [sx, sz] of [[1, 1], [-1, -1]] as const) {
        const ex = x === 0 ? 1 : x === CITY_WIDTH ? -1 : sx;
        const ez = z === 0 ? 1 : z === CITY_HEIGHT ? -1 : sz;
        const lx = x + ex * corner;
        const lz = z + ez * corner;
        if (nearStop(lx, lz)) continue;
        if ((x + z) % 240 === 0 && sx < 0) continue;
        lamps.push({ x: lx, z: lz, dx: -ex * 0.7, dz: -ez * 0.7 });
      }
    }
  }
  for (let z = 0; z <= CITY_HEIGHT; z += STREET_SPACING) {
    for (let x = 60; x < CITY_WIDTH; x += STREET_SPACING) {
      for (const s of z === 0 ? [1] : z === CITY_HEIGHT ? [-1] : [-1, 1]) {
        const lx = x + 14 * s;
        const lz = z + s * off;
        if (nearStop(lx, lz)) continue;
        lamps.push({ x: lx, z: lz, dx: 0, dz: -s });
      }
    }
  }
  for (let x = 0; x <= CITY_WIDTH; x += STREET_SPACING) {
    for (let z = 60; z < CITY_HEIGHT; z += STREET_SPACING) {
      if (x === 360 && (z === 60 || z === 300)) continue;
      const s = x === 0 ? 1 : x === CITY_WIDTH ? -1 : (x / STREET_SPACING) % 2 ? 1 : -1;
      lamps.push({ x: x + s * off, z: z - 16, dx: -s, dz: 0 });
    }
  }
  return lamps;
}

const BULB_DAY = new THREE.Color('#d9d4c4');
const BULB_NIGHT = new THREE.Color('#ffd27a').multiplyScalar(2.2);

/** How much lamps are switched on for a given night factor (smooth ramp at dusk / dawn). */
export function lampsOn(night: number): number {
  return THREE.MathUtils.smoothstep(night, 0.15, 0.6);
}

/** Colour of an emissive lamp bulb for a given night factor. */
export function bulbColor(out: THREE.Color, night: number): THREE.Color {
  return out.copy(BULB_DAY).lerp(BULB_NIGHT, lampsOn(night));
}

/** Additive halos + warm ground pools at the given bulbs; fades in at dusk. */
export function LampGlow({ bulbs, pool = true, size = 5 }: { bulbs: THREE.Vector3[]; withLights?: boolean; pool?: boolean; size?: number }) {
  const { halo, poolMesh } = useMemo(() => {
    const halo = makeBillboards(bulbs.map((p, i) => ({ x: p.x, y: p.y, z: p.z, size, phase: (i * 0.37) % 1, color: '#ffd9a0' })), 'halo', '#ffcf86');
    let poolMesh: THREE.Mesh | null = null;
    if (pool && bulbs.length) {
      const quads = bulbs.map((p) => {
        const q = new THREE.PlaneGeometry(14, 14);
        q.rotateX(-Math.PI / 2);
        q.translate(p.x, CURB_H + 0.05, p.z);
        return q;
      });
      const g = mergeQuads(quads);
      poolMesh = new THREE.Mesh(
        g,
        new THREE.MeshBasicMaterial({ map: radialTexture(), color: '#ffc879', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4 }),
      );
      poolMesh.renderOrder = 1;
    }
    return { halo, poolMesh };
  }, [bulbs, pool, size]);
  useEffect(
    () => () => {
      halo.geometry.dispose();
      (halo.material as THREE.Material).dispose();
      poolMesh?.geometry.dispose();
      (poolMesh?.material as THREE.Material | undefined)?.dispose();
    },
    [halo, poolMesh],
  );
  useFrame(() => {
    const on = lampsOn(env.night);
    const hm = halo.material as THREE.ShaderMaterial;
    hm.uniforms.uOpacity.value = on * 0.85;
    halo.visible = on > 0.01;
    if (poolMesh) {
      (poolMesh.material as THREE.MeshBasicMaterial).opacity = on * 0.5;
      poolMesh.visible = on > 0.01;
    }
  });
  return (
    <group>
      <primitive object={halo} />
      {poolMesh && <primitive object={poolMesh} />}
    </group>
  );
}

/** Merge plain quads keeping their uvs. */
export function mergeQuads(quads: THREE.BufferGeometry[]): THREE.BufferGeometry {
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

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

/** Zebra crossing on the arm of an intersection, at the pedestrian line (8.5 m from the node). */
function zebra(b: StaticBatch, x: number, z: number, alongX: boolean): void {
  const stripes = 7;
  const pitch = (ROAD * 2 - 1) / stripes;
  for (let i = 0; i < stripes; i++) {
    const o = -ROAD + 0.5 + pitch * (i + 0.5);
    if (alongX) b.box(x, 0.02, z + o, 3.6, 0.04, pitch * 0.55, C.marking);
    else b.box(x + o, 0.02, z, pitch * 0.55, 0.04, 3.6, C.marking);
  }
}

function buildGround(): THREE.Mesh[] {
  const b = new Batches();
  const W = CITY_WIDTH;
  const H = CITY_HEIGHT;
  // Countryside
  // (split around the canal)
  b.get('grass').box(W / 2, -0.5, (496 - 2600) / 2, 5200, 0.42, 2600 + 496, C.country);
  b.get('grass').box(W / 2, -0.5, (512 + 2600) / 2, 5200, 0.42, 2600 - 512, C.country);
  // Outer sidewalk ring around the town
  const ring = ROAD + SIDEWALK_W + 3;
  const ringParts: [number, number, number, number][] = [
    [-ring, -ring, W + ring, -ROAD],
    [-ring, H + ROAD, W + ring, H + ring],
    [-ring, -ROAD, -ROAD, H + ROAD],
    [W + ROAD, -ROAD, W + ring, H + ROAD],
  ];
  for (const [x0, z0, x1, z1] of ringParts) {
    b.stone.box((x0 + x1) / 2, 0, (z0 + z1) / 2, x1 - x0, CURB_H - 0.03, z1 - z0, C.curb);
    b.get('paving').box((x0 + x1) / 2, 0, (z0 + z1) / 2, x1 - x0 - 0.6, CURB_H, z1 - z0 - 0.6, C.paving);
  }
  // The canal along the south edge: quay walls, towpath, water (separate mesh).
  {
    const z0 = 497;
    const z1 = 511;
    const lvl = -1.1;
    b.stone.box(W / 2, -2.4, (z0 + z1) / 2, 5200, 1.3, z1 - z0, '#6f7a74');
    for (const zz of [z0, z1]) b.stone.box(W / 2, -2.4, zz, 5200, 2.4 + CURB_H, 1.2, C.curb);
    b.get('paving').box(W / 2, -0.1, z0 - 1.5, 5200, 0.1 + CURB_H, 3.6, '#bdb3a0');
    b.get('gravel').box(W / 2, -0.1, z1 + 2.5, 5200, 0.12, 4, C.path);
    void lvl;
  }
  // Asphalt and cobbles (streets are long strips; footpath segments are skipped)
  for (let z = 0; z <= H; z += STREET_SPACING) {
    // Horizontal streets: split at x = 240 / 480 for the cobbled part on z = 120.
    const x0 = -ROAD;
    const x1 = W + ROAD;
    if (z === 120) {
      b.get('asphalt').box((x0 + 233) / 2, -0.1, z, 233 - x0, 0.1, ROAD * 2, C.asphalt);
      b.get('asphalt').box((487 + x1) / 2, -0.1, z, x1 - 487, 0.1, ROAD * 2, C.asphalt);
      b.get('cobble').box(360, -0.1, z, 254, 0.13, ROAD * 2, C.cobble);
      // Gutters of the shared space
      for (const s of [-1, 1]) b.stone.box(360, -0.1, z + s * (ROAD - 0.5), 254, 0.14, 0.9, C.curb);
    } else b.get('asphalt').box((x0 + x1) / 2, -0.1, z, x1 - x0, 0.1, ROAD * 2, C.asphalt);
  }
  for (let x = 0; x <= W; x += STREET_SPACING) {
    const segs: [number, number][] = x === 360 ? [[120 - ROAD, 240 + ROAD]] : [[-ROAD, H + ROAD]];
    for (const [z0, z1] of segs) b.get('asphalt').box(x, -0.105, (z0 + z1) / 2, ROAD * 2, 0.1, z1 - z0, C.asphalt);
  }
  // Centre dashes on asphalt (not on the cobbles, not across intersections)
  const mark = b.get('plain');
  for (let z = 0; z <= H; z += STREET_SPACING) {
    for (let x = 0; x < W; x += STREET_SPACING) {
      if (cobbled(x + 60, z)) continue;
      for (let i = 0; i < 6; i++) mark.box(x + 18 + i * 16.8, 0.0, z, 3.2, 0.03, 0.25, C.marking);
    }
  }
  for (let x = 0; x <= W; x += STREET_SPACING) {
    for (let z = 0; z < H; z += STREET_SPACING) {
      if (x === 360 && (z === 0 || z === 240)) continue;
      for (let i = 0; i < 6; i++) mark.box(x, 0.0, z + 18 + i * 16.8, 0.25, 0.03, 3.2, C.marking);
    }
  }
  // Blocks: curb + paved sidewalk + gardens inside
  for (const blk of blocks()) {
    const x0 = blk.x0 + ROAD;
    const z0 = blk.z0 + ROAD;
    const x1 = blk.x1 - ROAD;
    const z1 = blk.z1 - ROAD;
    b.stone.geo(roundedSlabGeometry(x0, z0, x1, z1, 4.5, CURB_H - 0.02, CURB_H - 0.02), 0, 0, 0, C.curb);
    b.get('paving').geo(roundedSlabGeometry(x0 + 0.35, z0 + 0.35, x1 - 0.35, z1 - 0.35, 4.2, 0.1, CURB_H), 0, 0, 0, C.paving);
    const inner = blk.inner;
    const lawn = blk.kind === 'park' ? '#86b860' : C.grass;
    b.get('grass').geo(roundedSlabGeometry(inner.x0, inner.z0, inner.x1, inner.z1, 2, 0.1, CURB_H + 0.02), 0, 0, 0, lawn);
  }
  // Footpaths of x = 360 through the school yard and the park.
  b.get('gravel').box(360, CURB_H, 60, 6, 0.04, 120 - 2 * EDGE + 1, C.path);
  b.get('gravel').box(360, CURB_H, 300, 6, 0.04, 120 - 2 * EDGE + 1, C.path);
  // Zebra crossings at every intersection of the central streets (asphalt only).
  for (let x = 120; x <= 480; x += STREET_SPACING) {
    for (let z = 0; z <= 360; z += STREET_SPACING) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const ax = x + dx * 8.6;
        const az = z + dz * 8.6;
        if (dx !== 0 && cobbled(ax, z)) continue;
        if (dz !== 0 && cobbled(x, az)) continue;
        if (dz !== 0 && (az < -1 || az > CITY_HEIGHT + 1)) continue;
        if (x === 360 && dz !== 0 && (z + dz * 30 < 120 || z + dz * 30 > 240)) continue;
        zebra(mark, ax, az, dx !== 0);
      }
    }
  }
  // Forecourts of the locations not handled by a detailed block builder.
  for (const f of lotFrames().values()) {
    if (f.loc.kind === 'park' || f.loc.kind === 'school' || DETAILED_LOTS.has(f.loc.id)) continue;
    const front = Math.min(f.stand.w0 - 5, f.depth / 2);
    const r = localRect(f, -f.width / 2 + 4, front - 2, f.width / 2 - 4, f.streetW + 0.2);
    b.get('paving').box((r.x0 + r.x1) / 2, CURB_H, (r.z0 + r.z1) / 2, r.x1 - r.x0, 0.05, r.z1 - r.z0, C.forecourt);
  }
  const meshes = b.build({ shadows: false });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(5200, 13.2), waterMaterial('#2f6a80'));
  water.rotation.x = -Math.PI / 2;
  water.position.set(W / 2, -1.1, 504);
  water.receiveShadow = true;
  water.name = 'canal-water';
  meshes.push(water);
  return meshes;
}

/** Lots whose ground, buildings and props are built by a detailed block builder. */
export const DETAILED_LOTS = new Set(['cafe', 'bakery', 'florist', 'supermarket']);

// ---------------------------------------------------------------------------
// Bus shelters
// ---------------------------------------------------------------------------

function buildShelters(b: Batches, signs: SignAtlas): void {
  const city = getCity();
  for (const stop of LOCATIONS.filter((l) => l.kind === 'bus_stop')) shelter(b, signs, stop, city.nodePos(stop.node));
}

function shelter(b: Batches, signs: SignAtlas, stop: LocationDef, node: { x: number; y: number }): void {
  const side = Math.sign(stop.pos.y - node.y) || -1;
  // Shelter at the back of the sidewalk, facing the street; waiting people stand in front of it.
  const z = node.y + side * (EDGE + 1.6);
  const x = stop.pos.x + 2;
  const frame = new THREE.Matrix4().makeRotationY(side < 0 ? Math.PI : 0).setPosition(x, CURB_H, z);
  const w = 6;
  const d = 2.2;
  const glass = b.get('glass');
  b.get('paving').box(0, 0, 0.6, w + 3, 0.04, d + 3.4, '#bdb5a5', 0, frame);
  glass.box(0, 0.2, d / 2 - 0.08, w, 2.4, 0.06, '#9fb8c6', 0, frame);
  for (const u of [-w / 2, w / 2]) glass.box(u, 0.2, 0, 0.06, 2.4, d - 0.2, '#9fb8c6', 0, frame);
  for (const [u, ww] of [[-w / 2, d / 2], [w / 2, d / 2], [-w / 2, -d / 2], [w / 2, -d / 2]]) b.metal.box(u, 0, ww, 0.12, 2.75, 0.12, '#2f4a3e', 0, frame);
  b.metal.box(0, 2.75, 0, w + 0.5, 0.18, d + 0.4, '#2f4a3e', 0, frame);
  b.trim.box(0, 2.6, -d / 2 - 0.1, w + 0.5, 0.3, 0.06, '#f39c12', 0, frame);
  b.wood.box(0, 0.5, d / 2 - 0.45, w - 1, 0.08, 0.45, PAL.wood, 0, frame);
  for (const u of [-(w - 1.6) / 2, (w - 1.6) / 2]) b.metal.box(u, 0, d / 2 - 0.45, 0.08, 0.5, 0.4, PAL.iron, 0, frame);
  // Stop pole with the line sign
  const pu = -w / 2 - 1.2;
  b.metal.cyl(pu, 0, -d / 2 + 0.2, 0.06, 3.3, '#2f4a3e', false, frame);
  b.trim.box(pu, 2.55, -d / 2 + 0.2, 0.8, 0.8, 0.08, '#f39c12', 0, frame);
  signs.quad(new THREE.Matrix4().makeTranslation(0, 0, 0).premultiply(frame), pu, 2.95, -d / 2 + 0.26, 0.78, 0.3, 'Ligne 1', { bg: '#f39c12', fg: '#1d2b3a', font: 'sans' });
  signs.quad(new THREE.Matrix4().makeRotationY(Math.PI).premultiply(new THREE.Matrix4().makeTranslation(0, 0, 0).premultiply(frame)), -pu, 2.95, d / 2 - 0.14, 0.78, 0.3, 'Ligne 1', { bg: '#f39c12', fg: '#1d2b3a', font: 'sans' });
  signs.quad(frame, 0, 2.6, -d / 2 - 0.15, w * 0.8, 0.26, stop.name.replace('Arrêt ', ''), { bg: '#2f4a3e', fg: '#fbf3dd', font: 'sans' });
  if (HERO_STOPS.has(stop.id)) {
    // Timetable panel
    b.trim.box(w / 2 - 0.2, 0.9, 0, 0.1, 1.3, 0.8, '#f4efe4', 0, frame);
  }
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export function Streets() {
  const ground = useMemo(buildGround, []);
  useEffect(() => () => ground.forEach((m) => m.geometry.dispose()), [ground]);
  useFrame(() => {
    U.uWet.value = env.rain;
  });
  return (
    <group>
      {ground.map((m) => (
        <primitive key={m.name} object={m} />
      ))}
      <Suspense fallback={null}>
        <StreetFurniture />
      </Suspense>
    </group>
  );
}

/** Lamp posts (instanced Quaternius street lights), bus shelters and night halos. */
function StreetFurniture() {
  const protos = useProtos();
  const built = useMemo(() => {
    const lamps = streetLamps();
    const lampProto = protos.lamp;
    const s = 4.6 / lampProto.size.y;
    // Detailed Quaternius lamps in the café block, a light procedural lantern post elsewhere.
    const detailed = (l: LampDef) => l.x > 113 && l.x < 487 && l.z > 113 && l.z < 262;
    const items = lamps.filter(detailed).map((l) => ({ x: l.x, z: l.z, y: CURB_H, rotY: Math.atan2(l.dx, l.dz), scale: s }));
    const meshes = instancedModel(lampProto, items);
    const bulbs = lamps.filter(detailed).map((l) => new THREE.Vector3(l.x, CURB_H + 4.2, l.z));
    const b = new Batches();
    for (const l of lamps.filter((q) => !detailed(q))) {
      b.metal.cyl(l.x, CURB_H, l.z, 0.16, 0.5, '#1f3b24');
      b.metal.cyl(l.x, CURB_H, l.z, 0.07, 4.1, '#1f3b24');
      b.metal.shape('cone4', l.x, CURB_H + 4.35, l.z, 0.55, 0.45, 0.55, '#1f3b24', { y: Math.PI / 4 });
      b.bulb.shape('cyl6', l.x, CURB_H + 4.0, l.z, 0.34, 0.5, 0.34, '#ffffff');
      bulbs.push(new THREE.Vector3(l.x, CURB_H + 4.0, l.z));
    }
    const signs = new SignAtlas();
    buildShelters(b, signs);
    const sm = signs.build();
    return { meshes: [...meshes, ...b.build(), ...(sm ? [sm] : [])], bulbs };
  }, [protos]);
  useFrame(() => {
    bulbColor(bulbMat().color, env.night);
  });
  return (
    <group>
      {built.meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
      <LampGlow bulbs={built.bulbs} />
    </group>
  );
}

