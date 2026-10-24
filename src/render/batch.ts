/**
 * StaticBatch: collects many small primitives (boxes, cylinders, prisms...)
 * with per-vertex colours and merges them into a single BufferGeometry.
 *
 * The whole static city is drawn with a handful of draw calls this way: all
 * shapes share one MeshStandardMaterial with `vertexColors`. Each primitive
 * is transformed on the CPU once, at build time.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Unit primitives shared by all batches (never rendered directly).
const UNIT = {
  box: new THREE.BoxGeometry(1, 1, 1).toNonIndexed(),
  cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8).toNonIndexed(),
  cyl16: new THREE.CylinderGeometry(0.5, 0.5, 1, 16).toNonIndexed(),
  cone6: new THREE.ConeGeometry(0.5, 1, 6).toNonIndexed(),
  cone4: new THREE.ConeGeometry(0.5, 1, 4).toNonIndexed(),
  ico: new THREE.IcosahedronGeometry(0.5, 0),
  ico1: new THREE.IcosahedronGeometry(0.5, 1),
  prism: makePrism(),
  torus: new THREE.TorusGeometry(0.5, 0.18, 6, 14).toNonIndexed(),
  plane: new THREE.PlaneGeometry(1, 1).toNonIndexed(),
  cone8: new THREE.ConeGeometry(0.5, 1, 8).toNonIndexed(),
  cone12: new THREE.ConeGeometry(0.5, 1, 12).toNonIndexed(),
  sphere: new THREE.IcosahedronGeometry(0.5, 1),
  dodeca: new THREE.DodecahedronGeometry(0.5, 0),
  cyl12: new THREE.CylinderGeometry(0.5, 0.5, 1, 12).toNonIndexed(),
  cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6).toNonIndexed(),
  /** Half cylinder (barrel vault), axis along z, flat side down, radius 0.5, length 1. */
  barrel: (() => {
    const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, false, -Math.PI / 2, Math.PI);
    g.rotateX(Math.PI / 2);
    g.rotateZ(Math.PI / 2);
    return g.toNonIndexed();
  })(),
  /** Slab with a round arch on top: width 1, height 1 (arch spring at 0.68), depth 1. */
  arch: makeArchSlab(),
  /** Pyramid with a square base 1x1 and height 1, base at y = 0. */
  pyramid: (() => {
    const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
    g.rotateY(Math.PI / 4);
    g.translate(0, 0.5, 0);
    return g.toNonIndexed();
  })(),
  /** Stepped gable end (Flemish) profile: width 1, height 1, depth 1, base at y = 0. */
  stepGable: makeStepGable(),
};
export type UnitShape = keyof typeof UNIT;

/**
 * Unit triangular prism: base 1 (x) by 1 (z), height 1 (y), ridge along z.
 * Bottom face at y = 0.
 */
function makePrism(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, 0);
  shape.lineTo(0.5, 0);
  shape.lineTo(0, 1);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  const n = g.index ? g.toNonIndexed() : g;
  n.computeVertexNormals();
  return n;
}

function makeArchSlab(): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  sh.moveTo(-0.5, 0);
  sh.lineTo(0.5, 0);
  sh.lineTo(0.5, 0.68);
  sh.absarc(0, 0.68, 0.5, 0, Math.PI, false);
  sh.lineTo(-0.5, 0);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -0.5);
  g.scale(1, 1 / 1.18, 1);
  const n = g.index ? g.toNonIndexed() : g;
  n.computeVertexNormals();
  return n;
}

function makeStepGable(): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  const steps = 4;
  sh.moveTo(-0.5, 0);
  sh.lineTo(0.5, 0);
  for (let i = 0; i < steps; i++) {
    const x = 0.5 - (i * 0.5) / steps;
    const y0 = i / steps;
    sh.lineTo(x, y0 + 1 / steps);
    sh.lineTo(x - 0.5 / steps, y0 + 1 / steps);
  }
  for (let i = steps - 1; i >= 0; i--) {
    const x = -0.5 + (i * 0.5) / steps;
    const y0 = i / steps;
    sh.lineTo(x + 0.5 / steps, y0 + 1 / steps);
    sh.lineTo(x, y0 + 1 / steps);
  }
  sh.lineTo(-0.5, 0);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  const n = g.index ? g.toNonIndexed() : g;
  n.computeVertexNormals();
  return n;
}

/**
 * Hip roof over a rectangle sx (x) by sz (z), height h, base at y = 0.
 * The ridge runs along the longer side; equal slopes on all four sides.
 */
export function hipRoofGeometry(sx: number, sz: number, h: number): THREE.BufferGeometry {
  const ax = sx / 2;
  const az = sz / 2;
  const alongX = sx >= sz;
  const r = alongX ? ax - az : az - ax;
  const p = (x: number, y: number, z: number) => [x, y, z];
  const A = p(-ax, 0, -az), B = p(ax, 0, -az), C = p(ax, 0, az), D = p(-ax, 0, az);
  const R1 = alongX ? p(-r, h, 0) : p(0, h, -r);
  const R2 = alongX ? p(r, h, 0) : p(0, h, r);
  const tris: number[][] = alongX
    ? [[A, R1, R2], [A, R2, B], [C, R2, R1], [C, R1, D], [D, R1, A], [B, R2, C]].flat()
    : [[A, R1, B], [B, R1, R2], [B, R2, C], [C, R2, D], [D, R2, R1], [D, R1, A]].flat();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Mansard roof: steep lower slopes rising by `h1` to a rectangle inset by `inset`,
 * then a shallow hip of height `h2`. Base at y = 0.
 */
export function mansardGeometry(sx: number, sz: number, h1: number, inset: number, h2: number): THREE.BufferGeometry {
  const ax = sx / 2, az = sz / 2;
  const bx = ax - inset, bz = az - inset;
  const v = (x: number, y: number, z: number) => [x, y, z];
  const A = v(-ax, 0, -az), B = v(ax, 0, -az), C = v(ax, 0, az), D = v(-ax, 0, az);
  const a = v(-bx, h1, -bz), b = v(bx, h1, -bz), c = v(bx, h1, bz), d = v(-bx, h1, bz);
  const quad = (p: number[], q: number[], r: number[], s: number[]) => [p, q, r, p, r, s];
  const lower = [...quad(A, a, b, B), ...quad(B, b, c, C), ...quad(C, c, d, D), ...quad(D, d, a, A)];
  const top = hipRoofGeometry(bx * 2, bz * 2, h2);
  top.translate(0, h1, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(lower.flat(), 3));
  g.computeVertexNormals();
  const merged = mergeGeometries([g, top], false)!;
  return merged;
}

/** Flat horizontal slab with a rounded-rectangle outline (x0..x1, z0..z1), top at y = top. */
export function roundedSlabGeometry(x0: number, z0: number, x1: number, z1: number, radius: number, thickness: number, top: number): THREE.BufferGeometry {
  const r = Math.max(0.01, Math.min(radius, (x1 - x0) / 2 - 0.01, (z1 - z0) / 2 - 0.01));
  const sh = new THREE.Shape();
  sh.moveTo(x0 + r, z0);
  sh.lineTo(x1 - r, z0);
  sh.absarc(x1 - r, z0 + r, r, -Math.PI / 2, 0, false);
  sh.lineTo(x1, z1 - r);
  sh.absarc(x1 - r, z1 - r, r, 0, Math.PI / 2, false);
  sh.lineTo(x0 + r, z1);
  sh.absarc(x0 + r, z1 - r, r, Math.PI / 2, Math.PI, false);
  sh.lineTo(x0, z0 + r);
  sh.absarc(x0 + r, z0 + r, r, Math.PI, Math.PI * 1.5, false);
  const g = new THREE.ExtrudeGeometry(sh, { depth: thickness, bevelEnabled: false, curveSegments: 5 });
  // Shape is drawn in (x, y=z); extrude along +z. Map to (x, y up, z).
  g.rotateX(Math.PI / 2);
  g.translate(0, top, 0);
  return g;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();

export class StaticBatch {
  private parts: THREE.BufferGeometry[] = [];

  /** Add a geometry transformed by `matrix` with a flat colour. */
  add(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.ColorRepresentation): void {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(matrix);
    tmpC.set(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = tmpC.r;
      arr[i * 3 + 1] = tmpC.g;
      arr[i * 3 + 2] = tmpC.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.parts.push(g);
  }

  /**
   * Add a unit shape scaled to (sx, sy, sz), rotated by (rx, ry, rz) and placed so
   * that its centre is at (x, y, z). An optional parent matrix (e.g. a facade frame)
   * is applied last.
   */
  shape(
    kind: UnitShape,
    x: number, y: number, z: number,
    sx: number, sy: number, sz: number,
    color: THREE.ColorRepresentation,
    rot?: { x?: number; y?: number; z?: number },
    parent?: THREE.Matrix4,
  ): void {
    tmpE.set(rot?.x ?? 0, rot?.y ?? 0, rot?.z ?? 0);
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
    if (parent) tmpM.premultiply(parent);
    this.add(UNIT[kind], tmpM, color);
  }

  /** Axis-aligned (optionally yaw-rotated) box whose bottom sits at `y0`. */
  box(x: number, y0: number, z: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation, rotY = 0, parent?: THREE.Matrix4): void {
    this.shape('box', x, y0 + sy / 2, z, sx, sy, sz, color, { y: rotY }, parent);
  }

  /** Vertical cylinder whose bottom sits at `y0`. */
  cyl(x: number, y0: number, z: number, r: number, h: number, color: THREE.ColorRepresentation, smooth = false, parent?: THREE.Matrix4): void {
    this.shape(smooth ? 'cyl16' : 'cyl8', x, y0 + h / 2, z, r * 2, h, r * 2, color, undefined, parent);
  }

  /** Triangular prism (roof) whose bottom sits at `y0`; ridge along local z (or x if `ridgeX`). */
  prism(x: number, y0: number, z: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation, ridgeX = false, parent?: THREE.Matrix4): void {
    if (ridgeX) this.shape('prism', x, y0, z, sz, sy, sx, color, { y: Math.PI / 2 }, parent);
    else this.shape('prism', x, y0, z, sx, sy, sz, color, undefined, parent);
  }

  /** Add an arbitrary geometry with a local transform (parent applied last). */
  geo(geo: THREE.BufferGeometry, x: number, y: number, z: number, color: THREE.ColorRepresentation, rotY = 0, parent?: THREE.Matrix4, sx = 1, sy = 1, sz = 1): void {
    tmpQ.setFromEuler(tmpE.set(0, rotY, 0));
    tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
    if (parent) tmpM.premultiply(parent);
    this.add(geo, tmpM, color);
  }

  get size(): number {
    return this.parts.length;
  }

  /** Merge everything into a single geometry (null if empty). */
  build(): THREE.BufferGeometry | null {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    if (merged) merged.computeBoundingSphere();
    return merged;
  }
}

/** The shared material used for every vertex-coloured static batch. */
export function batchMaterial(opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, flatShading: true, ...opts });
}

/**
 * A local coordinate frame attached to a building facade:
 * u = along the facade (tangent), v = up, w = outwards (normal).
 */
export interface Facade {
  /** Outward normal in world XZ (unit, axis aligned). */
  nx: number;
  nz: number;
  /** Centre of the facade at ground level (world). */
  cx: number;
  cz: number;
  /** Facade length (metres). */
  length: number;
  /** Matrix mapping local (u, v, w) -> world. */
  frame: THREE.Matrix4;
}

/** Build the four facades of an axis-aligned box footprint centred at (x, z). */
export function facadesOf(x: number, z: number, sx: number, sz: number): Facade[] {
  const defs: [number, number][] = [
    [0, 1], // south (+z)
    [0, -1], // north
    [1, 0], // east
    [-1, 0], // west
  ];
  return defs.map(([nx, nz]) => {
    const cx = x + (nx * sx) / 2;
    const cz = z + (nz * sz) / 2;
    const length = nx !== 0 ? sz : sx;
    // Tangent so that (t, up, n) is right-handed: t = up x n
    const t = new THREE.Vector3(nz, 0, -nx);
    const frame = new THREE.Matrix4().makeBasis(t, new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 0, nz));
    frame.setPosition(cx, 0, cz);
    return { nx, nz, cx, cz, length, frame };
  });
}

/**
 * A StaticBatch that routes every primitive to a spatial chunk (by the world
 * position of its transform), so that the merged meshes can be frustum-culled
 * (main and shadow cameras) when the camera is close to the ground.
 */
export class ChunkedBatch extends StaticBatch {
  readonly chunks = new Map<string, StaticBatch>();
  constructor(private chunkOf: (x: number, z: number) => string) {
    super();
  }
  override add(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.ColorRepresentation): void {
    const key = this.chunkOf(matrix.elements[12], matrix.elements[14]);
    let b = this.chunks.get(key);
    if (!b) {
      b = new StaticBatch();
      this.chunks.set(key, b);
    }
    b.add(geo, matrix, color);
  }
  override get size(): number {
    let n = 0;
    for (const b of this.chunks.values()) n += b.size;
    return n;
  }
  /** Build every chunk (the inherited build() of the router itself is empty). */
  buildChunks(): THREE.BufferGeometry[] {
    const out: THREE.BufferGeometry[] = [];
    for (const b of this.chunks.values()) {
      const g = b.build();
      if (g) out.push(g);
    }
    return out;
  }
}
