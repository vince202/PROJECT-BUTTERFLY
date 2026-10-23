/**
 * Vegetation and the park: low-poly trees along streets, in gardens and in the
 * countryside ring, plus the "Parc des Tilleuls" (lawn, hedges, diagonal path,
 * fountain plaza, pond, flower beds, benches and lamps).
 */

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { CITY_HEIGHT, CITY_WIDTH, LOCATIONS, STREET_SPACING, getCity } from '../sim/city';
import type { LocationDef } from '../sim/types';
import { StaticBatch, batchMaterial } from './batch';
import { BASE_MARGIN, LAYER, ROAD_HALF, SIDEWALK, hashString, seeded } from './shared';
import { LampGlow, addLamp, streetLamps, type LampDef } from './Streets';

const GREENS = ['#5f9e4a', '#6aa84f', '#4f8a3f', '#7cb35a', '#5a9a55', '#88b85c'];
const TRUNK = '#7a5a3c';

/** A low-poly tree: round (deciduous) or conical (conifer). */
export function addTree(b: StaticBatch, x: number, z: number, scale: number, rnd: () => number): void {
  const green = GREENS[Math.floor(rnd() * GREENS.length)];
  const conifer = rnd() < 0.25;
  const s = scale * (0.85 + rnd() * 0.35);
  if (conifer) {
    b.cyl(x, 0, z, 0.5 * s, 3 * s, TRUNK);
    b.shape('cone6', x, 6 * s, z, 7 * s, 7 * s, 7 * s, green, { y: rnd() });
    b.shape('cone6', x, 9.5 * s, z, 5 * s, 5.5 * s, 5 * s, green, { y: rnd() });
  } else {
    b.cyl(x, 0, z, 0.55 * s, 4.5 * s, TRUNK);
    b.shape('ico1', x, 7.5 * s, z, 7.5 * s, 6.5 * s, 7.5 * s, green, { y: rnd() * 3 });
    if (rnd() < 0.6) {
      const ox = (rnd() - 0.5) * 3 * s;
      const oz = (rnd() - 0.5) * 3 * s;
      b.shape('ico1', x + ox, 9.5 * s, z + oz, 4.8 * s, 4.4 * s, 4.8 * s, green, { y: rnd() * 3 });
    }
  }
}

/** A park bench facing local +z, rotated by `rotY`. */
function addBench(b: StaticBatch, x: number, z: number, rotY: number): void {
  const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, 0, z);
  b.box(0, 1.1, 0, 4.4, 0.3, 1.3, '#8a5a3b', 0, m);
  b.box(0, 1.4, -0.65, 4.4, 1.3, 0.25, '#8a5a3b', 0, m);
  for (const u of [-1.8, 1.8]) b.box(u, 0, 0, 0.3, 1.1, 1.2, '#33363d', 0, m);
}

// ---------------------------------------------------------------------------
// Placement constraints
// ---------------------------------------------------------------------------

const BUILDINGS = LOCATIONS.filter((l) => l.kind !== 'park' && l.kind !== 'bus_stop');
const PARK = LOCATIONS.find((l) => l.kind === 'park')!;

function inRect(x: number, z: number, l: LocationDef, margin: number): boolean {
  return Math.abs(x - l.pos.x) < l.size.x / 2 + margin && Math.abs(z - l.pos.y) < l.size.y / 2 + margin;
}

/** True if (x, z) is free for a street / garden tree. */
function freeSpot(x: number, z: number, lamps: LampDef[]): boolean {
  const city = getCity();
  for (const l of BUILDINGS) {
    if (inRect(x, z, l, 7)) return false;
    const d = city.doorPos(l.id);
    const dx = d.x - l.pos.x;
    const dz = d.y - l.pos.y;
    const between = (v: number, a: number, c: number) => v >= Math.min(a, c) - 2 && v <= Math.max(a, c) + 2;
    // The whole frontage on the door side stays clear (terraces, canopies, steps).
    if (Math.abs(dx) / l.size.x > Math.abs(dz) / l.size.y) {
      if (Math.abs(z - l.pos.y) < l.size.y / 2 + 3 && between(x, l.pos.x + (Math.sign(dx) * l.size.x) / 2, d.x)) return false;
    } else if (Math.abs(x - l.pos.x) < l.size.x / 2 + 3 && between(z, l.pos.y + (Math.sign(dz) * l.size.y) / 2, d.y)) return false;
  }
  if (inRect(x, z, PARK, 4)) return false;
  for (const s of LOCATIONS) if (s.kind === 'bus_stop' && Math.hypot(s.pos.x - x, s.pos.y - z) < 16) return false;
  for (const l of lamps) if (Math.hypot(l.x - x, l.z - z) < 6) return false;
  // Not on a street (asphalt + sidewalk)
  const mx = ((x % STREET_SPACING) + STREET_SPACING) % STREET_SPACING;
  const mz = ((z % STREET_SPACING) + STREET_SPACING) % STREET_SPACING;
  const near = ROAD_HALF + SIDEWALK + 2.5;
  if (x >= -near && x <= CITY_WIDTH + near && z >= -near && z <= CITY_HEIGHT + near) {
    if (mx < near || mx > STREET_SPACING - near || mz < near || mz > STREET_SPACING - near) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Trees outside the park
// ---------------------------------------------------------------------------

export function Trees() {
  const geo = useMemo(() => {
    const b = new StaticBatch();
    const lamps = streetLamps();
    const rnd = seeded(1234);
    const off = ROAD_HALF + SIDEWALK + 3.5;
    // Street trees along both sides of every street.
    for (let z = 0; z <= CITY_HEIGHT; z += STREET_SPACING) {
      for (let x = 15; x < CITY_WIDTH; x += 22) {
        for (const s of [-1, 1]) {
          const tz = z + s * off;
          if (tz < 0 || tz > CITY_HEIGHT) continue;
          if (hashString(`st${x}_${tz}`) % 100 > 55) continue;
          if (freeSpot(x, tz, lamps)) addTree(b, x, tz, 0.75, rnd);
        }
      }
    }
    for (let x = 0; x <= CITY_WIDTH; x += STREET_SPACING) {
      for (let z = 15; z < CITY_HEIGHT; z += 22) {
        for (const s of [-1, 1]) {
          const tx = x + s * off;
          if (tx < 0 || tx > CITY_WIDTH) continue;
          if (hashString(`sv${tx}_${z}`) % 100 > 50) continue;
          if (freeSpot(tx, z, lamps)) addTree(b, tx, z, 0.75, rnd);
        }
      }
    }
    // Garden trees inside blocks.
    for (let bx = 0; bx < CITY_WIDTH; bx += STREET_SPACING) {
      for (let bz = 0; bz < CITY_HEIGHT; bz += STREET_SPACING) {
        let placed = 0;
        for (let i = 0; i < 14 && placed < 3; i++) {
          const x = bx + 20 + rnd() * (STREET_SPACING - 40);
          const z = bz + 20 + rnd() * (STREET_SPACING - 40);
          if (freeSpot(x, z, lamps)) {
            addTree(b, x, z, 0.9, rnd);
            placed++;
          }
        }
      }
    }
    // Countryside ring around the city.
    const m = BASE_MARGIN;
    for (let i = 0; i < 260; i++) {
      const x = -m + 6 + rnd() * (CITY_WIDTH + 2 * m - 12);
      const z = -m + 6 + rnd() * (CITY_HEIGHT + 2 * m - 12);
      const outside = x < -18 || x > CITY_WIDTH + 18 || z < -18 || z > CITY_HEIGHT + 18;
      if (!outside) continue;
      addTree(b, x, z, 0.9 + rnd() * 0.5, rnd);
    }
    // A few bushes in the ring.
    for (let i = 0; i < 80; i++) {
      const x = -m + 4 + rnd() * (CITY_WIDTH + 2 * m - 8);
      const z = -m + 4 + rnd() * (CITY_HEIGHT + 2 * m - 8);
      if (!(x < -16 || x > CITY_WIDTH + 16 || z < -16 || z > CITY_HEIGHT + 16)) continue;
      b.shape('ico', x, 1.2, z, 4 + rnd() * 3, 2.6, 4 + rnd() * 3, GREENS[i % GREENS.length]);
    }
    return b.build();
  }, []);
  const mat = useMemo(() => batchMaterial({ roughness: 0.9 }), []);
  useEffect(
    () => () => {
      geo?.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  return geo ? <mesh geometry={geo} material={mat} castShadow receiveShadow /> : null;
}

// ---------------------------------------------------------------------------
// Park
// ---------------------------------------------------------------------------

export function Park() {
  const built = useMemo(() => {
    const b = new StaticBatch();
    const water = new StaticBatch();
    const bulbs: THREE.Vector3[] = [];
    const rnd = seeded(hashString('park'));
    const px = PARK.pos.x;
    const pz = PARK.pos.y;
    const sx = PARK.size.x;
    const sz = PARK.size.y;
    const x0 = px - sx / 2;
    const x1 = px + sx / 2;
    const z0 = pz - sz / 2;
    const z1 = pz + sz / 2;
    const lawn = '#8cc66a';
    const path = '#e6d6ae';
    const hedge = '#4f8a3f';

    // Lawn
    b.box(px, -0.1, pz, sx, LAYER.park + 0.1, sz, lawn);

    // Diagonal path from the south-west to the north-east corner.
    const ax = x0 + 6;
    const az = z1 - 6;
    const bx2 = x1 - 6;
    const bz2 = z0 + 6;
    const len = Math.hypot(bx2 - ax, bz2 - az);
    const rot = Math.atan2(-(bz2 - az), bx2 - ax);
    b.box((ax + bx2) / 2, -0.1, (az + bz2) / 2, len + 10, LAYER.parkPath + 0.1, 6, path, rot);
    const pathZ = (x: number) => az + ((x - ax) / (bx2 - ax)) * (bz2 - az);
    const distToDiag = (x: number, z: number) => Math.abs(z - pathZ(x)) * Math.cos(Math.atan2(bz2 - az, bx2 - ax));

    // Central plaza + fountain where the paths cross.
    const fx = px;
    const fz = pathZ(px);
    b.cyl(fx, 0, fz, 13, LAYER.parkPath + 0.04, path, true);
    b.cyl(fx, 0, fz, 6, 1.3, '#cfc6b4', true);
    water.cyl(fx, 0, fz, 5.3, 1.15, '#5aa6c8', true);
    b.cyl(fx, 1.1, fz, 0.7, 3.2, '#cfc6b4', true);
    b.cyl(fx, 4.2, fz, 2.0, 0.5, '#cfc6b4', true);
    water.cyl(fx, 4.4, fz, 1.7, 0.35, '#7cc0dc', true);

    // Pond (north-west) with a stone rim and two ducks.
    const pondX = x0 + 45;
    const pondZ = z0 + 26;
    b.shape('cyl16', pondX, LAYER.park + 0.1, pondZ, 48, 0.2, 26, '#cfc6b4');
    water.shape('cyl16', pondX, LAYER.park + 0.25, pondZ, 44, 0.2, 22, '#4f9fc4');
    for (const [dx, dz] of [[-6, 2], [5, -3]]) {
      b.box(pondX + dx, LAYER.park + 0.35, pondZ + dz, 1.6, 0.9, 1.0, '#ffffff');
      b.box(pondX + dx + 0.8, LAYER.park + 1.0, pondZ + dz, 0.7, 0.7, 0.7, '#ffffff');
      b.box(pondX + dx + 1.3, LAYER.park + 1.1, pondZ + dz, 0.5, 0.2, 0.3, '#f39c12');
    }

    // Flower beds (south-east and north-east).
    const flowers = ['#ff6fa8', '#ffd23f', '#e84a5f', '#c77dff', '#ffffff', '#ff8c42'];
    const beds: [number, number, number, number][] = [
      [x1 - 50, z1 - 22, 14, 7],
      [x1 - 22, z1 - 34, 9, 6],
      [px + 32, z0 + 14, 11, 5],
    ];
    for (const [bx, bz, rx, rz] of beds) {
      b.shape('cyl16', bx, LAYER.park + 0.2, bz, rx * 2, 0.4, rz * 2, '#7a5236');
      for (let i = 0; i < 26; i++) {
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd()) * 0.85;
        b.shape('ico', bx + Math.cos(a) * rx * r, LAYER.park + 0.9, bz + Math.sin(a) * rz * r, 1.4, 1.1, 1.4, flowers[i % flowers.length]);
      }
    }

    // Hedges along the border, with gaps for the entrances.
    const gapsX = [px];
    const hedgeSeg = (ax0: number, ax1: number, fixed: number, horizontal: boolean) => {
      const len2 = ax1 - ax0;
      if (len2 <= 1) return;
      if (horizontal) b.box((ax0 + ax1) / 2, 0, fixed, len2, 1.8, 2, hedge);
      else b.box(fixed, 0, (ax0 + ax1) / 2, 2, 1.8, len2, hedge);
    };
    for (const zEdge of [z0 + 1, z1 - 1]) {
      const segs: [number, number][] = [];
      let cur = x0 + (zEdge > pz ? 16 : 0);
      for (const g of gapsX) {
        segs.push([cur, g - 6]);
        cur = g + 6;
      }
      segs.push([cur, x1 - (zEdge < pz ? 16 : 0)]);
      for (const [a, c] of segs) hedgeSeg(a, c, zEdge, true);
    }
    hedgeSeg(z0, z1 - 16, x0 + 1, false);
    hedgeSeg(z0 + 16, z1, x1 - 1, false);

    // Benches around the plaza and along the paths.
    const benches: [number, number, number][] = [
      [fx - 9.5, fz - 15, Math.PI / 2],
      [fx + 9.5, fz + 15, -Math.PI / 2],
      [fx - 9.5, fz + 18, Math.PI / 2],
      [fx + 9.5, fz - 18, -Math.PI / 2],
      [pondX + 2, pondZ + 16, Math.PI],
      [pondX - 16, pondZ + 15, Math.PI],
    ];
    for (const [x, z, r] of benches) addBench(b, x, z, r);
    // Benches along the diagonal path, facing it.
    for (const t of [0.22, 0.78]) {
      const x = ax + (bx2 - ax) * t;
      const z = az + (bz2 - az) * t;
      const nx = Math.sin(rot);
      const nz = Math.cos(rot);
      addBench(b, x + nx * 6, z + nz * 6, rot + Math.PI);
    }

    // Trees, kept off paths / water / beds.
    let placed = 0;
    for (let i = 0; i < 400 && placed < 22; i++) {
      const x = x0 + 8 + rnd() * (sx - 16);
      const z = z0 + 8 + rnd() * (sz - 16);
      if (Math.abs(x - px) < 10) continue;
      if (distToDiag(x, z) < 9) continue;
      if (Math.hypot(x - fx, z - fz) < 22) continue;
      if (((x - pondX) / 30) ** 2 + ((z - pondZ) / 18) ** 2 < 1) continue;
      if (beds.some(([bx, bz, rx, rz]) => ((x - bx) / (rx + 5)) ** 2 + ((z - bz) / (rz + 5)) ** 2 < 1)) continue;
      if (benches.some(([bx, bz]) => Math.hypot(bx - x, bz - z) < 6)) continue;
      addTree(b, x, z, 0.95, rnd);
      placed++;
    }

    // Park lamps along the paths.
    const lamps: LampDef[] = [
      { x: px - 5, z: z0 + 18, dx: 1, dz: 0 },
      { x: px + 5, z: z1 - 18, dx: -1, dz: 0 },
      { x: x0 + 40, z: pathZ(x0 + 40) - 5, dx: 0, dz: 1 },
      { x: x1 - 40, z: pathZ(x1 - 40) + 5, dx: 0, dz: -1 },
    ];
    for (const l of lamps) addLamp(b, l, bulbs);

    return { solid: b.build(), water: water.build(), bulbs };
  }, []);

  const mat = useMemo(() => batchMaterial({ roughness: 0.9 }), []);
  const waterMat = useMemo(() => batchMaterial({ roughness: 0.12, metalness: 0.15, flatShading: false }), []);
  useEffect(
    () => () => {
      built.solid?.dispose();
      built.water?.dispose();
      mat.dispose();
      waterMat.dispose();
    },
    [built, mat, waterMat],
  );

  return (
    <group>
      {built.solid && <mesh geometry={built.solid} material={mat} castShadow receiveShadow />}
      {built.water && <mesh geometry={built.water} material={waterMat} receiveShadow />}
      <LampGlow bulbs={built.bulbs} withLights={false} />
    </group>
  );
}
