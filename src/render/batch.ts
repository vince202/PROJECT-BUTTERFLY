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
  ico: new THREE.IcosahedronGeometry(0.5, 0).toNonIndexed(),
  ico1: new THREE.IcosahedronGeometry(0.5, 1).toNonIndexed(),
  prism: makePrism(),
  torus: new THREE.TorusGeometry(0.5, 0.18, 6, 14).toNonIndexed(),
  plane: new THREE.PlaneGeometry(1, 1).toNonIndexed(),
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
  const n = g.toNonIndexed();
  n.computeVertexNormals();
  return n;
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
