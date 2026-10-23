/**
 * Procedural buildings for every location except the park and bus stops.
 *
 * Each building = body box + roof (pitched or flat) + per-kind details, all
 * merged into one vertex-coloured batch. Windows are a single InstancedMesh
 * whose per-instance colours are updated each frame: glass by day, warm light
 * at night depending on occupancy / opening hours. Shop signs are canvas
 * textured planes, and every building gets a floating name label.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LOCATIONS, getCity } from '../sim/city';
import { AGENTS } from '../sim/population';
import type { LocationDef } from '../sim/types';
import { useSimStore } from '../store/useSimStore';
import { type Facade, StaticBatch, batchMaterial, facadesOf } from './batch';
import { ROAD_HALF, SIDEWALK, activeRealityOf, env, hashString, labelMaterial, makeLabel, makeSignTexture, seeded, shade, sizeLabel } from './shared';
import { bulbColor } from './Streets';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SignDef {
  texture: THREE.CanvasTexture;
  position: THREE.Vector3;
  rotY: number;
  width: number;
  height: number;
}

interface LabelDef {
  id: string;
  name: string;
  color: string;
  position: THREE.Vector3;
}

interface WindowList {
  matrices: THREE.Matrix4[];
  building: number[];
  seeds: number[];
}

interface ClockDef {
  position: THREE.Vector3;
  rotY: number;
  radius: number;
}

const PITCHED = new Set(['home', 'bakery', 'cafe', 'restaurant']);
const ROOF_COLORS = ['#b4553d', '#a84b36', '#c0644a', '#9c4a3a'];
const SLATE = '#59616d';
const FLAT_ROOF = '#8e8c88';
const WOOD = '#6b4430';
const DOOR_GLASS = '#33414f';
const IRON = '#3a3d42';
const BRICK = '#9a5b45';

/** Short text for the facade sign of a business. */
const SIGN_TEXT: Record<string, string> = {
  cafe: 'Café Le Papillon',
  bakery: 'Boulangerie',
  supermarket: 'Marché Plus',
  office: 'Agence Horizon',
  library: 'Bibliothèque',
  restaurant: 'Chez Lucie',
  clinic: 'Cabinet médical',
  workshop: 'Atelier Dupré',
  florist: 'Fleurs & Sens',
  gym: 'Gymnase Central',
  townhall: 'Hôtel de Ville',
  station: 'Gare Routière',
  school: 'École Jules Ferry',
};

// ---------------------------------------------------------------------------
// Construction helpers
// ---------------------------------------------------------------------------

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();

/** World position of a local facade point (u along, v up, w out). */
function facadePoint(f: Facade, u: number, v: number, w: number): THREE.Vector3 {
  return new THREE.Vector3(u, v, w).applyMatrix4(f.frame);
}

function facadeYaw(f: Facade): number {
  return Math.atan2(f.nx, f.nz);
}

/** Add a window instance on facade `f` at local (u, vCentre) with size (w, h). */
function addWindow(list: WindowList, f: Facade, building: number, u: number, v: number, w: number, h: number, seed: number): void {
  tmpQ.setFromAxisAngle(tmpV.set(0, 1, 0), facadeYaw(f));
  const p = facadePoint(f, u, v, 0.09);
  tmpM.compose(p, tmpQ, tmpS.set(w, h, 1));
  list.matrices.push(tmpM.clone());
  list.building.push(building);
  list.seeds.push(seed);
}

/** Striped sloping awning attached to a facade. */
function addAwning(b: StaticBatch, f: Facade, uc: number, width: number, vTop: number, colA: string, colB: string): void {
  const depth = 3.6;
  const drop = 1.3;
  const len = Math.hypot(depth, drop);
  const tilt = Math.atan2(drop, depth);
  const n = Math.max(4, Math.round(width / 1.6));
  const sw = width / n;
  for (let i = 0; i < n; i++) {
    const u = uc - width / 2 + sw * (i + 0.5);
    const col = i % 2 === 0 ? colA : colB;
    b.shape('box', u, vTop - drop / 2, depth / 2, sw, 0.18, len, col, { x: tilt }, f.frame);
    // Valance
    b.box(u, vTop - drop - 0.7, depth, sw, 0.7, 0.12, col, 0, f.frame);
  }
}

/** A small café table with two chairs and a parasol (local facade coordinates). */
function addTerraceTable(b: StaticBatch, f: Facade, u: number, w: number, parasol: string): void {
  b.cyl(u, 0, w, 0.18, 2.0, IRON, false, f.frame);
  b.cyl(u, 2.0, w, 1.3, 0.18, '#f4efe4', true, f.frame);
  b.box(u - 2.0, 0, w, 1.1, 1.3, 1.1, '#5c4a3d', 0, f.frame);
  b.box(u - 2.0, 1.3, w + 0.5, 1.1, 1.3, 0.15, '#5c4a3d', 0, f.frame);
  b.box(u + 2.0, 0, w, 1.1, 1.3, 1.1, '#5c4a3d', 0, f.frame);
  b.box(u + 2.0, 1.3, w - 0.5, 1.1, 1.3, 0.15, '#5c4a3d', 0, f.frame);
  b.cyl(u, 2.1, w, 0.1, 3.4, '#e9e4d8', false, f.frame);
  b.shape('cone6', u, 6.0, w, 5.6, 1.2, 5.6, parasol, undefined, f.frame);
}

/** Flat roof with a parapet. */
function addFlatRoof(b: StaticBatch, x: number, z: number, sx: number, sz: number, H: number, wallColor: string): void {
  b.box(x, H, z, sx - 0.6, 0.25, sz - 0.6, FLAT_ROOF);
  const p = shade(wallColor, 1.06);
  b.box(x, H, z - sz / 2 + 0.4, sx, 1.1, 0.8, p);
  b.box(x, H, z + sz / 2 - 0.4, sx, 1.1, 0.8, p);
  b.box(x - sx / 2 + 0.4, H, z, 0.8, 1.1, sz, p);
  b.box(x + sx / 2 - 0.4, H, z, 0.8, 1.1, sz, p);
}

/** Rooftop technical boxes (AC units). */
function addRooftopUnits(b: StaticBatch, x: number, z: number, sx: number, sz: number, H: number, rnd: () => number, count: number): void {
  for (let i = 0; i < count; i++) {
    const ux = x + (rnd() - 0.5) * (sx - 14);
    const uz = z + (rnd() - 0.5) * (sz - 14);
    b.box(ux, H, uz, 4 + rnd() * 3, 2 + rnd() * 1.2, 3 + rnd() * 2, '#b9bcc0');
    b.cyl(ux + 1, H + 2.6, uz, 0.9, 0.3, '#8d9094');
  }
}

// ---------------------------------------------------------------------------
// Building generator
// ---------------------------------------------------------------------------

interface Built {
  solid: THREE.BufferGeometry | null;
  glow: THREE.BufferGeometry | null;
  bulbs: THREE.BufferGeometry | null;
  windows: WindowList;
  signs: SignDef[];
  labels: LabelDef[];
  clocks: ClockDef[];
  /** Building ids in window "building" index order. */
  ids: string[];
}

function buildAll(): Built {
  const city = getCity();
  const solid = new StaticBatch();
  const glow = new StaticBatch();
  const bulbs = new StaticBatch();
  const windows: WindowList = { matrices: [], building: [], seeds: [] };
  const signs: SignDef[] = [];
  const labels: LabelDef[] = [];
  const clocks: ClockDef[] = [];
  const ids: string[] = [];

  const locs = LOCATIONS.filter((l) => l.kind !== 'park' && l.kind !== 'bus_stop');
  locs.forEach((loc, bi) => {
    ids.push(loc.id);
    const rnd = seeded(hashString(loc.id));
    const door = city.doorPos(loc.id);
    const kind = loc.id === 'station' ? 'station' : loc.kind;
    const x = loc.pos.x;
    const z = loc.pos.y;
    const sx = loc.size.x;
    const sz = loc.size.y;
    const H = loc.height;
    const color = loc.color;
    const isHome = kind === 'home';
    const groundH = isHome ? 4 : 6;
    // The town hall door and steps sit on the front of its clock tower.
    const doorW0 = kind === 'townhall' ? 2.5 : 0;

    const facades = facadesOf(x, z, sx, sz);
    const dx = door.x - x;
    const dz = door.y - z;
    const fi = Math.abs(dx) / sx > Math.abs(dz) / sz ? (dx > 0 ? 2 : 3) : dz > 0 ? 0 : 1;
    const df = facades[fi];
    const doorU = THREE.MathUtils.clamp((door.x - df.cx) * df.nz - (door.y - df.cz) * df.nx, -df.length / 2 + 5, df.length / 2 - 5);
    const gap = Math.abs((door.x - df.cx) * df.nx + (door.y - df.cz) * df.nz) - (ROAD_HALF + SIDEWALK);

    let roofTop = H;

    // ----- Body -----------------------------------------------------------
    if (kind === 'school') {
      buildSchool(loc, bi, solid, windows, signs, rnd);
      labels.push({ id: loc.id, name: loc.name, color, position: new THREE.Vector3(x, H + 9, z) });
      return;
    }
    solid.box(x, 0, z, sx, H, sz, color);
    // Stone plinth for homes, cornice for everyone
    if (isHome) solid.box(x, 0, z, sx + 0.5, 1.2, sz + 0.5, shade(color, 0.72));
    solid.box(x, H - 0.9, z, sx + 1.0, 0.7, sz + 1.0, shade(color, 1.15));
    // Floor bands on tall homes
    if (isHome && H > 16) {
      for (let v = groundH; v < H - 3; v += 3.6) solid.box(x, v - 0.15, z, sx + 0.3, 0.3, sz + 0.3, shade(color, 1.1));
    }

    // ----- Roof -------------------------------------------------------------
    if (PITCHED.has(kind)) {
      const roofH = THREE.MathUtils.clamp(Math.min(sx, sz) * 0.26, 4, 10);
      const ridgeX = sx >= sz;
      const roofColor = loc.id === 'imm_haussmann' ? SLATE : ROOF_COLORS[hashString(loc.id) % ROOF_COLORS.length];
      solid.prism(x, H, z, sx + 1.8, roofH, sz + 1.8, roofColor, ridgeX);
      roofTop = H + roofH;
      // Chimneys
      const nCh = 1 + (hashString(loc.id + 'c') % 2);
      for (let i = 0; i < nCh; i++) {
        const along = (i === 0 ? -0.25 : 0.28) * (ridgeX ? sx : sz);
        const off = (rnd() - 0.5) * 0.3 * (ridgeX ? sz : sx);
        const cx = ridgeX ? x + along : x + off;
        const cz = ridgeX ? z + off : z + along;
        solid.box(cx, H + roofH * 0.35, cz, 2.2, roofH * 0.85, 2.2, BRICK);
        solid.box(cx, H + roofH * 1.2, cz, 2.6, 0.4, 2.6, shade(BRICK, 0.8));
      }
    } else {
      addFlatRoof(solid, x, z, sx, sz, H, color);
      roofTop = H + 1.1;
      if (kind === 'office' || kind === 'supermarket' || kind === 'clinic' || kind === 'gym') {
        addRooftopUnits(solid, x, z, sx, sz, H, rnd, kind === 'office' ? 4 : 2);
      }
    }

    // ----- Windows ------------------------------------------------------------
    const office = kind === 'office';
    const bigWindows = office || kind === 'gym';
    const spacing = office ? 4.4 : bigWindows ? 6 : 6.4;
    const ww = office ? 3.4 : bigWindows ? 4.2 : 2.1;
    const wh = office ? 2.7 : bigWindows ? 2.8 : 2.1;
    const floors = Math.max(0, Math.floor((H - groundH - 1.0) / 3.6));
    const smallHouse = isHome && H < 16;
    const tallHome = isHome && H >= 18;
    const shutter = ['#5b7f5a', '#4f6d8f', '#8a5a44', '#6e8f7a'][hashString(loc.id + 's') % 4];

    facades.forEach((f, idx) => {
      const isDoorSide = idx === fi;
      const ncol = Math.max(1, Math.floor((f.length - 3) / spacing));
      for (let k = 0; k < floors; k++) {
        const v = groundH + k * 3.6 + 0.9 + wh / 2;
        for (let i = 0; i < ncol; i++) {
          const u = -f.length / 2 + (f.length / ncol) * (i + 0.5);
          addWindow(windows, f, bi, u, v, ww, wh, rnd());
          if (smallHouse) {
            solid.box(u - ww / 2 - 0.5, v - wh / 2, 0.1, 0.9, wh, 0.2, shutter, 0, f.frame);
            solid.box(u + ww / 2 + 0.5, v - wh / 2, 0.1, 0.9, wh, 0.2, shutter, 0, f.frame);
            if (isDoorSide) {
              solid.box(u, v - wh / 2 - 0.55, 0.4, ww + 0.5, 0.5, 0.7, '#7a5236', 0, f.frame);
              for (let j = 0; j < 3; j++) {
                const fc = ['#ff6fa8', '#ffd23f', '#e84a5f', '#c77dff'][(i + j + k) % 4];
                solid.shape('ico', u - ww / 3 + (j * ww) / 3, v - wh / 2 + 0.1, 0.45, 0.8, 0.7, 0.8, fc, undefined, f.frame);
              }
            }
          } else if (!office) {
            // Sill
            solid.box(u, v - wh / 2 - 0.2, 0.15, ww + 0.4, 0.2, 0.35, shade(color, 1.2), 0, f.frame);
          }
          if (tallHome && isDoorSide && i % 2 === 0) {
            solid.box(u, v - wh / 2 - 0.35, 0.7, ww + 1.6, 0.25, 1.4, shade(color, 0.9), 0, f.frame);
            solid.box(u, v - wh / 2 - 0.1, 1.35, ww + 1.6, 1.0, 0.12, IRON, 0, f.frame);
          }
        }
      }
      // Ground floor
      const shop = !isHome && kind !== 'office';
      const gw = shop && isDoorSide ? 4.6 : isHome ? 2.0 : ww;
      const gh = shop && isDoorSide ? 2.8 : isHome ? 1.8 : 2.4;
      const gv = shop && isDoorSide ? 2.0 : isHome ? 2.2 : 2.6;
      const gsp = shop && isDoorSide ? 6.2 : spacing;
      const gcol = Math.max(1, Math.floor((f.length - 3) / gsp));
      for (let i = 0; i < gcol; i++) {
        const u = -f.length / 2 + (f.length / gcol) * (i + 0.5);
        if (isDoorSide && Math.abs(u - doorU) < gw / 2 + 2.2) continue;
        addWindow(windows, f, bi, u, gv, gw, gh, rnd());
      }
    });

    // ----- Door -------------------------------------------------------------
    const doorColor = isHome || kind === 'bakery' || kind === 'cafe' || kind === 'restaurant' ? WOOD : DOOR_GLASS;
    const doorW = kind === 'supermarket' || kind === 'station' || office ? 5 : 2.6;
    solid.box(doorU, 0, doorW0 + 0.1, doorW + 0.8, 4.0, 0.3, shade(color, 1.25), 0, df.frame);
    solid.box(doorU, 0, doorW0 + 0.2, doorW, 3.6, 0.3, doorColor, 0, df.frame);
    solid.box(doorU, 0, doorW0 + 0.8, doorW + 2, 0.3, 1.4, '#cfc6b4', 0, df.frame);
    if (isHome) {
      solid.box(doorU, 4.1, 0.8, doorW + 1.6, 0.25, 1.6, shade(color, 0.8), 0, df.frame);
    }
    // Door lamp (lit at night)
    const lp = facadePoint(df, doorU + doorW / 2 + 1.0, 3.6, doorW0 + 0.45);
    bulbs.shape('ico1', lp.x, lp.y, lp.z, 0.7, 0.7, 0.7, '#ffffff');

    // ----- Facade sign ------------------------------------------------------------
    const signText = SIGN_TEXT[kind];
    if (signText && !isHome && kind !== 'library' && kind !== 'townhall') {
      // Sign board above the shopfront / awning; taller on single-storey buildings.
      const v0 = kind === 'station' ? 7.4 : 4.4;
      const maxH = floors === 0 ? Math.max(1.2, H - 1.4 - v0) : 1.4;
      const height = Math.min(Math.min(df.length * 0.62, kind === 'supermarket' ? 30 : 22) / 8, maxH);
      const width = height * 8;
      const v = v0 + height / 2;
      const bg = kind === 'cafe' ? '#2a1d1a' : kind === 'supermarket' ? '#2f7d3b' : kind === 'clinic' ? '#2e7d6a' : kind === 'gym' ? '#20435c' : kind === 'station' ? '#d9822b' : kind === 'office' ? '#1f2d44' : shade(color, 0.45);
      const fg = kind === 'cafe' ? '#f6d28b' : '#fff8ec';
      solid.box(0, v - height / 2 - 0.2, 0.1, width + 0.8, height + 0.4, 0.3, shade(bg, 0.7), 0, df.frame);
      signs.push({ texture: makeSignTexture(signText, bg, fg), position: facadePoint(df, 0, v, 0.32), rotY: facadeYaw(df), width, height });
    }

    // ----- Kind specific details --------------------------------------------------
    const F = df.frame;
    const terraceW = THREE.MathUtils.clamp(gap * 0.45, 3, 7);
    switch (kind) {
      case 'cafe': {
        addAwning(solid, df, 0, Math.min(df.length * 0.8, 40), 4.0, '#c0392b', '#f6efe3');
        const us = [-16, -8, 8, 16].map((d) => doorU + d).filter((u) => Math.abs(u) < df.length / 2 - 3);
        for (const [i, u] of us.entries()) addTerraceTable(solid, df, u, terraceW + 1, i % 2 ? '#f6efe3' : '#c0392b');
        break;
      }
      case 'bakery': {
        addAwning(solid, df, 0, Math.min(df.length * 0.75, 34), 4.0, '#8b5a2b', '#f5e6c8');
        // Hanging golden bread sign on a bracket
        solid.box(doorU + 5, 6.2, 1.2, 0.25, 0.25, 2.4, IRON, 0, F);
        solid.shape('torus', doorU + 5, 5.0, 2.1, 2.2, 2.2, 2.2, '#d9a441', { y: Math.PI / 2 }, F);
        // Bread display baskets
        for (const d of [-7, 7]) {
          solid.box(doorU + d, 0, 1.4, 3, 1.4, 1.6, '#a0703f', 0, F);
          for (let j = 0; j < 3; j++) solid.shape('ico', doorU + d - 1 + j, 1.6, 1.4, 1.2, 0.6, 0.8, '#d49a52', { y: 0.3 * j }, F);
        }
        break;
      }
      case 'florist': {
        addAwning(solid, df, 0, Math.min(df.length * 0.8, 36), 4.0, '#4f7f4a', '#f4f1e8');
        const flowers = ['#ff6fa8', '#ffd23f', '#c77dff', '#ffffff', '#ff8c42', '#e84a5f'];
        let n = 0;
        for (let u = -df.length / 2 + 3; u < df.length / 2 - 2; u += 2.6) {
          if (Math.abs(u - doorU) < 3) continue;
          const w = 1.6 + (n % 2) * 1.4;
          solid.cyl(u, 0, w, 0.75, 1.1, '#b5643c', false, F);
          solid.shape('ico', u, 1.6, w, 1.7, 1.4, 1.7, '#4f8a3a', undefined, F);
          solid.shape('ico', u + 0.2, 2.2, w, 1.1, 1.0, 1.1, flowers[n % flowers.length], undefined, F);
          n++;
        }
        // Flower stand
        solid.box(doorU - 6, 0, terraceW + 1, 4, 1.0, 2.4, '#7a5236', 0, F);
        solid.box(doorU - 6, 1.0, terraceW + 0.6, 4, 1.0, 1.4, '#7a5236', 0, F);
        for (let j = 0; j < 4; j++) solid.shape('ico', doorU - 7.5 + j, 2.2, terraceW + 0.6, 1, 0.9, 1, flowers[(j + 2) % flowers.length], undefined, F);
        break;
      }
      case 'restaurant': {
        addAwning(solid, df, 0, Math.min(df.length * 0.8, 40), 4.0, '#7a1f2b', '#f3e9d8');
        const us = [-14, 10].map((d) => doorU + d).filter((u) => Math.abs(u) < df.length / 2 - 3);
        for (const u of us) addTerraceTable(solid, df, u, terraceW + 1, '#f3e9d8');
        // String lights between two posts
        const ext = Math.min(df.length / 2 - 4, 22);
        for (const u of [-ext, ext]) solid.cyl(u, 0, terraceW + 4, 0.15, 6.5, IRON, false, F);
        for (let i = 0; i <= 14; i++) {
          const u = -ext + ((2 * ext) / 14) * i;
          const sag = 0.8 * Math.sin((Math.PI * i) / 14);
          const p = facadePoint(df, u, 6.3 - sag, terraceW + 4);
          bulbs.shape('ico', p.x, p.y, p.z, 0.45, 0.45, 0.45, '#ffffff');
        }
        break;
      }
      case 'supermarket': {
        // Entrance canopy + cart corral
        solid.box(doorU, 4.4, 2, 12, 0.4, 4, '#2f7d3b', 0, F);
        for (let i = 0; i < 4; i++) solid.box(doorU + 9 + i * 0.9, 0, 2, 0.8, 1.6, 2.2, '#c9ccd1', 0, F);
        break;
      }
      case 'office': {
        solid.box(doorU, 4.6, 2.2, 10, 0.4, 4.4, '#2b3d55', 0, F);
        solid.cyl(x + sx * 0.25, H, z - sz * 0.2, 0.3, 12, '#9aa0a6');
        glow.shape('ico', x + sx * 0.25, H + 12.3, z - sz * 0.2, 0.9, 0.9, 0.9, '#ff3b30');
        roofTop = H + 4;
        break;
      }
      case 'clinic': {
        // Projecting green cross (glows)
        solid.box(doorU + 6, 7.5, 0.8, 0.25, 0.25, 1.6, IRON, 0, F);
        glow.box(doorU + 6, 6.1, 1.6, 0.4, 3.0, 1.0, '#2ecc71', 0, F);
        glow.box(doorU + 6, 7.1, 1.6, 0.42, 1.0, 3.0, '#2ecc71', 0, F);
        // Flat white cross on the roof
        glow.box(x, H + 0.3, z, 12, 0.1, 4, '#e74c3c');
        glow.box(x, H + 0.3, z, 4, 0.1, 12, '#e74c3c');
        break;
      }
      case 'library': {
        // Classical portico: columns, entablature, pediment, steps.
        const pw = Math.min(df.length * 0.7, 40);
        solid.box(0, 0, 3, pw + 4, 0.5, 6, '#d8cfbd', 0, F);
        solid.box(0, 0.5, 2.6, pw + 2, 0.5, 5.2, '#e2dacb', 0, F);
        const nCol = 6;
        for (let i = 0; i < nCol; i++) {
          const u = -pw / 2 + 1.5 + ((pw - 3) / (nCol - 1)) * i;
          solid.cyl(u, 1.0, 4.4, 0.8, 8.2, '#efe8da', true, F);
        }
        solid.box(0, 9.2, 2.4, pw + 1, 1.6, 4.8, '#e9e1d1', 0, F);
        solid.prism(0, 10.8, 2.4, pw + 2, 3.6, 5.0, '#e2d8c5', true, F);
        roofTop = Math.max(roofTop, 14.4);
        signs.push({ texture: makeSignTexture('BIBLIOTHÈQUE', '#e9e1d1', '#5a4632'), position: facadePoint(df, 0, 10.0, 4.85), rotY: facadeYaw(df), width: pw * 0.6, height: 1.2 });
        break;
      }
      case 'workshop': {
        // Sawtooth roof
        roofTop = H + 1.1;
        const n = 3;
        for (let i = 0; i < n; i++) {
          const px = x - sx / 2 + (sx / n) * (i + 0.5);
          solid.prism(px, H + 1.0, z, sx / n - 1, 4, sz - 4, i % 2 ? '#6d6a66' : '#7b7772');
        }
        roofTop = H + 5;
        // Garage door and crates
        const gu = doorU + (doorU > 0 ? -10 : 10);
        solid.box(gu, 0, 0.15, 9, 5.6, 0.3, '#6b6f75', 0, F);
        for (let j = 1; j < 5; j++) solid.box(gu, j * 1.1, 0.32, 9, 0.12, 0.1, '#55595e', 0, F);
        for (let j = 0; j < 4; j++) solid.box(doorU + (doorU > 0 ? 6 : -6) + (j % 2) * 2.2, j > 1 ? 1.6 : 0, 2.5 + (j % 2), 1.8, 1.6, 1.8, '#b08850', rnd() * 0.4, F);
        solid.box(gu, 0, 4, 6, 0.6, 1.4, '#c49a6c', 0, F);
        solid.box(gu, 0.6, 4, 6, 0.6, 1.4, '#b88d60', 0.05, F);
        break;
      }
      case 'gym': {
        // Skylight strip and a basketball hoop
        solid.box(x, H + 0.2, z, sx * 0.6, 1.2, 6, '#8fb8d4');
        const hu = doorU + (doorU > 0 ? -14 : 14);
        const hw = Math.min(gap - 2, 12);
        solid.cyl(hu, 0, hw, 0.25, 7.5, IRON, false, F);
        solid.box(hu, 6.4, hw - 0.6, 3.6, 2.4, 0.2, '#f4f4f4', 0, F);
        solid.shape('torus', hu, 6.5, hw - 1.6, 1.4, 1.4, 1.4, '#e8590c', { x: Math.PI / 2 }, F);
        break;
      }
      case 'townhall': {
        const tf: Facade = { ...df, frame: df.frame.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, doorW0)) };
        // Balustrade flags and a central clock tower
        const tw = 13;
        const tH = H + 13;
        solid.box(0, 0, -tw / 2 + 2.5, tw, tH, tw, shade(color, 0.97), 0, F);
        solid.box(0, tH - 0.8, -tw / 2 + 2.5, tw + 1.2, 0.8, tw + 1.2, shade(color, 1.1), 0, F);
        solid.shape('cone4', 0, tH + 4.5, -tw / 2 + 2.5, tw * 1.35, 9, tw * 1.35, SLATE, { y: Math.PI / 4 }, F);
        solid.cyl(0, tH + 9, -tw / 2 + 2.5, 0.15, 3.5, IRON, false, F);
        roofTop = tH + 12;
        // Clock face
        const cv = tH - 5;
        clocks.push({ position: facadePoint(tf, 0, cv, 0.1), rotY: facadeYaw(df), radius: 3.6 });
        // Tall windows on the tower front
        addWindow(windows, tf, bi, 0, 9.5, 2.4, 3.2, 0.01);
        addWindow(windows, tf, bi, 0, 14.5, 2.4, 3.2, 0.02);
        // Steps + flags
        solid.box(0, 0, doorW0 + 1.4, 16, 0.35, 2.8, '#d8cfbd', 0, F);
        solid.box(0, 0.35, doorW0 + 0.9, 12, 0.35, 1.8, '#e2dacb', 0, F);
        for (const u of [-df.length / 2 + 6, df.length / 2 - 6]) {
          solid.cyl(u, H, -2, 0.15, 7, IRON, false, F);
          solid.box(u + 0.9, H + 5, -2, 1.2, 2.2, 0.1, '#1f4aa8', 0, F);
          solid.box(u + 2.1, H + 5, -2, 1.2, 2.2, 0.1, '#ffffff', 0, F);
          solid.box(u + 3.3, H + 5, -2, 1.2, 2.2, 0.1, '#d62828', 0, F);
        }
        signs.push({ texture: makeSignTexture('HÔTEL DE VILLE', shade(color, 0.92), '#4b3f2f'), position: facadePoint(tf, 0, 19.5, 0.12), rotY: facadeYaw(df), width: 11, height: 1.4 });
        break;
      }
      case 'station': {
        // Bus canopy over the forecourt
        const cw = df.length * 0.85;
        const depth = Math.min(gap - 1.5, 12);
        solid.box(0, 6.6, depth / 2, cw, 0.5, depth, '#3d4450', 0, F);
        solid.box(0, 6.4, depth, cw, 0.8, 0.3, '#f39c12', 0, F);
        for (let u = -cw / 2 + 2; u <= cw / 2 - 2; u += (cw - 4) / 5) solid.cyl(u, 0, depth - 0.6, 0.3, 6.6, '#5a5f68', false, F);
        for (let i = 0; i < 3; i++) solid.box(-cw / 3 + (i * cw) / 3, 0.25, depth * 0.45, 5, 1.1, 1.2, '#8a5a3b', 0, F);
        break;
      }
      case 'home': {
        if (smallHouse) {
          // Little front garden hedge
          for (const s of [-1, 1]) solid.box(doorU + s * 7, 0, 3, 8, 1.4, 1.4, '#5f8f4a', 0, F);
        }
        break;
      }
    }

    labels.push({ id: loc.id, name: loc.name, color, position: new THREE.Vector3(x, roofTop + 5, z) });
  });

  // Park label
  const park = LOCATIONS.find((l) => l.kind === 'park');
  if (park) labels.push({ id: park.id, name: park.name, color: park.color, position: new THREE.Vector3(park.pos.x, 14, park.pos.y - 16) });

  return { solid: solid.build(), glow: glow.build(), bulbs: bulbs.build(), windows, signs, labels, clocks, ids };
}

/** The school: two wings linked by a covered bridge (gateway) over the yard. */
function buildSchool(loc: LocationDef, bi: number, solid: StaticBatch, windows: WindowList, signs: SignDef[], rnd: () => number): void {
  const x = loc.pos.x;
  const z = loc.pos.y;
  const H = loc.height;
  const yard = 30;
  const wingW = (loc.size.x - yard) / 2;
  const sz = loc.size.y;
  const color = loc.color;
  for (const s of [-1, 1]) {
    const wx = x + s * (yard / 2 + wingW / 2);
    solid.box(wx, 0, z, wingW, H, sz, color);
    solid.box(wx, 0, z, wingW + 0.5, 1.0, sz + 0.5, shade(color, 0.75));
    addFlatRoof(solid, wx, z, wingW, sz, H, color);
    solid.prism(wx, H, z, wingW - 6, 2.2, sz - 6, '#b4553d', true);
    const fs = facadesOf(wx, z, wingW, sz);
    fs.forEach((f) => {
      const ncol = Math.max(1, Math.floor((f.length - 3) / 5.5));
      for (const v of [2.6, 7.4, 11.0]) {
        if (v + 1.4 > H - 0.8) continue;
        for (let i = 0; i < ncol; i++) {
          const u = -f.length / 2 + (f.length / ncol) * (i + 0.5);
          addWindow(windows, f, bi, u, v, 3.0, 2.4, rnd());
        }
      }
    });
    // Door onto the yard (inner facade, near the street)
    const inner = fs[s < 0 ? 2 : 3];
    const du = (inner.nx > 0 ? -1 : 1) * (sz / 2 - 10);
    solid.box(du, 0, 0.2, 3, 3.8, 0.3, '#33414f', 0, inner.frame);
  }
  // Bridge / gateway on the street side
  const bz = z + sz / 2 - 7;
  solid.box(x, 8.5, bz, yard + 0.4, H - 8.5, 14, shade(color, 0.96));
  solid.box(x, H - 0.8, bz, yard + 1.4, 0.8, 15, shade(color, 1.12));
  const bf = facadesOf(x, bz, yard, 14)[0];
  for (const u of [-9, 9]) addWindow(windows, bf, bi, u, 11, 3.6, 2.2, rnd());
  signs.push({ texture: makeSignTexture('ÉCOLE JULES FERRY', '#2c4a7a', '#fff8ec'), position: new THREE.Vector3(x, 10.1, bz + 7.05), rotY: 0, width: 13, height: 1.6 });
  // Yard: court markings, flag pole, benches, fence on the north side
  const mark = '#f7f3ea';
  const y0 = 0.42;
  solid.box(x, y0, z - 8, yard - 6, 0.06, 0.3, mark);
  solid.box(x, y0, z + 14, yard - 6, 0.06, 0.3, mark);
  solid.box(x - (yard - 6) / 2, y0, z + 3, 0.3, 0.06, 22, mark);
  solid.box(x + (yard - 6) / 2, y0, z + 3, 0.3, 0.06, 22, mark);
  solid.cyl(x, y0, z + 3, 3, 0.06, mark, true);
  solid.cyl(x - 11, 0, z - 22, 0.15, 12, IRON);
  solid.box(x - 10.1, 9.5, z - 22, 1.2, 2.2, 0.1, '#1f4aa8');
  solid.box(x - 8.9, 9.5, z - 22, 1.2, 2.2, 0.1, '#ffffff');
  solid.box(x - 7.7, 9.5, z - 22, 1.2, 2.2, 0.1, '#d62828');
  for (const s of [-1, 1]) {
    solid.box(x + s * 12.5, 1.2, z - 2, 1.2, 0.3, 7, '#8a5a3b');
    solid.box(x + s * 13.2, 1.5, z - 2, 0.25, 1.4, 7, '#8a5a3b');
    solid.box(x + s * 10, 0, z - sz / 2 + 0.6, yard / 2 - 6, 2.2, 0.25, '#4d6b4f');
  }
}

// ---------------------------------------------------------------------------
// Window colouring
// ---------------------------------------------------------------------------

const GLASS_DAY = new THREE.Color('#87a2bd');
const GLASS_NIGHT = new THREE.Color('#1b2333');
const WARM = [new THREE.Color('#ffd27f'), new THREE.Color('#ffe2a8'), new THREE.Color('#ffbe6a')].map((c) => c.multiplyScalar(1.35));
const tmpC = new THREE.Color();
const tmpGlass = new THREE.Color();

const residentsOf = new Map<string, string[]>();
for (const a of AGENTS) {
  if (!residentsOf.has(a.homeId)) residentsOf.set(a.homeId, []);
  residentsOf.get(a.homeId)!.push(a.id);
}

/** Fraction of windows lit for a building at a given time. */
function activityOf(loc: LocationDef, t: number, awakeInside: number): number {
  if (loc.kind === 'home') {
    let base = t < 7.5 * 60 ? 0.3 : t < 22 * 60 ? 0.45 : t < 23 * 60 ? 0.3 : 0.12;
    if (awakeInside > 0) base += 0.3;
    return Math.min(0.92, base);
  }
  const open = loc.opens === undefined || loc.closes === undefined || (t >= loc.opens && t < loc.closes);
  if (open) return loc.kind === 'school' ? 0.7 : 0.9;
  return awakeInside > 0 ? 0.25 : 0.05;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export function Buildings() {
  const built = useMemo(buildAll, []);
  const solidMat = useMemo(() => batchMaterial(), []);
  const glowMat = useMemo(() => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), []);
  const bulbMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#d9d4c4', toneMapped: false }), []);
  const windowMat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  const windowGeo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  // Windows: one InstancedMesh with per-instance colours (created up-front so the
  // shader is compiled with instance colours enabled).
  const windowMesh = useMemo(() => {
    const mesh = new THREE.InstancedMesh(windowGeo, windowMat, built.windows.matrices.length);
    built.windows.matrices.forEach((m, i) => {
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, GLASS_DAY);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    return mesh;
  }, [built, windowGeo, windowMat]);

  const locById = useMemo(() => new Map(LOCATIONS.map((l) => [l.id, l])), []);
  const activity = useMemo(() => new Float32Array(built.ids.length), [built]);

  useEffect(
    () => () => {
      built.solid?.dispose();
      built.glow?.dispose();
      built.bulbs?.dispose();
      for (const s of built.signs) s.texture.dispose();
      solidMat.dispose();
      glowMat.dispose();
      bulbMat.dispose();
      windowMat.dispose();
      windowGeo.dispose();
      windowMesh.dispose();
    },
    [built, solidMat, glowMat, bulbMat, windowMat, windowGeo, windowMesh],
  );

  const awake = useMemo(() => new Map<string, number>(), []);

  useFrame(() => {
    const mesh = windowMesh;
    const s = useSimStore.getState();
    const t = s.time;
    const night = env.night;
    const frame = activeRealityOf(s).frameAt(Math.floor(t));

    // Awake agents per location.
    awake.clear();
    if (frame) {
      for (const id in frame.agents) {
        const a = frame.agents[id];
        if (a.loc && !a.asleep) awake.set(a.loc, (awake.get(a.loc) ?? 0) + 1);
      }
    }
    built.ids.forEach((id, i) => {
      activity[i] = activityOf(locById.get(id)!, t, awake.get(id) ?? 0);
    });

    // Glass colour: sky-ish by day, dark by night, greyer under rain.
    tmpGlass.copy(GLASS_DAY).lerp(GLASS_NIGHT, night).multiplyScalar(1 - env.rain * 0.25);
    const glowK = THREE.MathUtils.smoothstep(night, 0.1, 0.7);
    const { building, seeds } = built.windows;
    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i];
      const lit = seed < activity[building[i]];
      tmpC.copy(tmpGlass).multiplyScalar(0.92 + (seed * 7919 % 1) * 0.16);
      if (lit && glowK > 0) tmpC.lerp(WARM[Math.floor(seed * 1000) % 3], glowK);
      mesh.setColorAt(i, tmpC);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    bulbColor(bulbMat.color, night);
    glowMat.color.setScalar(0.85 + night * 0.5);
  });

  return (
    <group>
      {built.solid && <mesh geometry={built.solid} material={solidMat} castShadow receiveShadow />}
      {built.glow && <mesh geometry={built.glow} material={glowMat} />}
      {built.bulbs && <mesh geometry={built.bulbs} material={bulbMat} />}
      <primitive object={windowMesh} />
      {built.signs.map((s, i) => (
        <Sign key={i} def={s} />
      ))}
      {built.clocks.map((c, i) => (
        <TownClock key={i} def={c} />
      ))}
      {built.labels.map((l) => (
        <PlaceLabel key={l.id} def={l} />
      ))}
    </group>
  );
}

/** A flat sign board; gently self-lit at night. */
function Sign({ def }: { def: SignDef }) {
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ map: def.texture, emissiveMap: def.texture, emissive: '#ffffff', emissiveIntensity: 0.05, roughness: 0.7 }),
    [def],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(() => {
    mat.emissiveIntensity = 0.08 + env.night * 0.55;
  });
  return (
    <mesh position={def.position} rotation-y={def.rotY} material={mat}>
      <planeGeometry args={[def.width, def.height]} />
    </mesh>
  );
}

/** Town hall clock face with hands showing the simulated time. */
function TownClock({ def }: { def: ClockDef }) {
  const hour = useRef<THREE.Group>(null);
  const minute = useRef<THREE.Group>(null);
  const faceTex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#f7f1e1';
    ctx.beginPath();
    ctx.arc(128, 128, 124, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#3b3326';
    ctx.stroke();
    ctx.fillStyle = '#3b3326';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r0 = i % 3 === 0 ? 88 : 98;
      ctx.save();
      ctx.translate(128 + Math.sin(a) * ((r0 + 110) / 2), 128 - Math.cos(a) * ((r0 + 110) / 2));
      ctx.rotate(a);
      ctx.fillRect(-4, -(110 - r0) / 2, 8, 110 - r0);
      ctx.restore();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  const faceMat = useMemo(
    () => new THREE.MeshStandardMaterial({ map: faceTex, emissiveMap: faceTex, emissive: '#fff3d0', emissiveIntensity: 0, transparent: true, alphaTest: 0.5 }),
    [faceTex],
  );
  const handMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2b251c' }), []);
  useEffect(
    () => () => {
      faceTex.dispose();
      faceMat.dispose();
      handMat.dispose();
    },
    [faceTex, faceMat, handMat],
  );

  useFrame(() => {
    const t = env.time;
    const m = t % 60;
    const h = (t / 60) % 12;
    if (minute.current) minute.current.rotation.z = -(m / 60) * Math.PI * 2;
    if (hour.current) hour.current.rotation.z = -(h / 12) * Math.PI * 2;
    faceMat.emissiveIntensity = env.night * 0.7;
  });

  const r = def.radius;
  return (
    <group position={def.position} rotation-y={def.rotY}>
      <mesh material={faceMat}>
        <planeGeometry args={[r * 2, r * 2]} />
      </mesh>
      <group ref={hour} position-z={0.08}>
        <mesh position-y={r * 0.25} material={handMat}>
          <boxGeometry args={[0.35, r * 0.55, 0.08]} />
        </mesh>
      </group>
      <group ref={minute} position-z={0.14}>
        <mesh position-y={r * 0.38} material={handMat}>
          <boxGeometry args={[0.22, r * 0.8, 0.08]} />
        </mesh>
      </group>
    </group>
  );
}

/** Floating name label above a building. */
function PlaceLabel({ def }: { def: LabelDef }) {
  const sprite = useRef<THREE.Sprite>(null);
  const { label, mat } = useMemo(() => {
    const label = makeLabel({ text: def.name, dot: def.color, fontSize: 28 });
    return { label, mat: labelMaterial(label) };
  }, [def]);
  useEffect(
    () => () => {
      label.texture.dispose();
      mat.dispose();
    },
    [label, mat],
  );
  useFrame(() => {
    if (!sprite.current) return;
    sizeLabel(sprite.current, label.aspect, 19);
    // Fade slightly when far away to reduce clutter.
    mat.opacity = THREE.MathUtils.clamp(1.25 - env.camDistance / 1400, 0.45, 0.95);
  });
  return <sprite ref={sprite} position={def.position} material={mat} center={[0.5, 0]} renderOrder={5} />;
}
