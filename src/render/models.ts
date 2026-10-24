/**
 * Imported glTF models (Quaternius, Kenney — CC0, see docs/CREDITS.md).
 *
 * Models are loaded once with drei's useGLTF (Suspense), then turned into
 * "prototypes": their meshes baked into model space, split by material, with
 * every material colour snapped to the BUTTERFLY palette. Prototypes are
 * either
 *  - baked into the static merged batches (buildings, unique props): one draw
 *    call per material for the whole town, or
 *  - instanced (trees, lamps, benches...): one InstancedMesh per material.
 */

import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BatchKey, Batches } from './kit';
import { materialFor } from './kit';
import { paletteFor } from './shared';
import { surfaceMaterial } from './materials';

export const MODELS = {
  inn: 'quaternius/medieval/Inn',
  house1: 'quaternius/medieval/House_1',
  house2: 'quaternius/medieval/House_2',
  house3: 'quaternius/medieval/House_3',
  blacksmith: 'quaternius/medieval/Blacksmith',
  bellTower: 'quaternius/medieval/Bell_Tower',
  stand1: 'quaternius/medieval/MarketStand_1',
  stand2: 'quaternius/medieval/MarketStand_2',
  well: 'quaternius/medieval/Well',
  cart: 'quaternius/medieval/Cart',
  barrel: 'quaternius/medieval/Barrel',
  crate: 'quaternius/medieval/Crate',
  bags: 'quaternius/medieval/Bags',
  bench1: 'quaternius/medieval/Bench_1',
  gazebo: 'quaternius/medieval/Gazebo',
  lamp: 'quaternius/street/Streetlight_Single',
  lamp2: 'quaternius/street/Streetlight_Double',
  treeOak: 'kenney/nature/tree_oak',
  treeDefault: 'kenney/nature/tree_default',
  treeDetailed: 'kenney/nature/tree_detailed',
  treeTall: 'kenney/nature/tree_tall',
  treeFat: 'kenney/nature/tree_fat',
  bush: 'kenney/nature/plant_bushLarge',
  bushSmall: 'kenney/nature/plant_bushDetailed',
  flowerRed: 'kenney/nature/flower_redA',
  flowerYellow: 'kenney/nature/flower_yellowA',
  bridge: 'kenney/nature/bridge_stoneRound',
  bicycle: 'quaternius/transport/Bicycle',
} as const;

export type ModelName = keyof typeof MODELS;
export const modelUrl = (name: ModelName) => `/models/${MODELS[name]}.glb`;
const ALL_URLS = (Object.keys(MODELS) as ModelName[]).map(modelUrl);

export interface ProtoPart {
  geometry: THREE.BufferGeometry;
  material: string;
  color: THREE.Color;
  key: BatchKey;
}

export interface Proto {
  name: ModelName;
  parts: ProtoPart[];
  box: THREE.Box3;
  size: THREE.Vector3;
}

/** Batch (surface) used for an imported material. */
function keyFor(material: string): BatchKey {
  if (/^light/i.test(material)) return 'bulb';
  if (/^glass/i.test(material)) return 'glass';
  if (/window/i.test(material)) return 'winLit';
  if (/plaster|beige/i.test(material)) return 'plaster';
  if (/roof/i.test(material)) return 'roof';
  if (/leaf|leaves|bush|plant|grass/i.test(material)) return 'foliage';
  if (/metal|pole|bell|^green/i.test(material) && !/wood|stone/i.test(material)) return 'metal';
  return 'plain';
}

function prepare(name: ModelName, scene: THREE.Object3D): Proto {
  scene.updateMatrixWorld(true);
  const byMat = new Map<string, THREE.BufferGeometry[]>();
  const colors = new Map<string, THREE.Color>();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const src = mesh.geometry;
    const groups = Array.isArray(mesh.material) && src.groups.length ? src.groups : [{ start: 0, count: src.index ? src.index.count : src.attributes.position.count, materialIndex: 0 }];
    for (const grp of groups) {
      const mat = mats[grp.materialIndex ?? 0] as THREE.MeshStandardMaterial;
      const mname = mat.name || 'mat';
      let g = src.index ? src.toNonIndexed() : src.clone();
      if (groups.length > 1) {
        const pos = g.attributes.position.array.slice(grp.start * 3, (grp.start + grp.count) * 3);
        const nrm = g.attributes.normal?.array.slice(grp.start * 3, (grp.start + grp.count) * 3);
        g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        if (nrm) g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      }
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      g.applyMatrix4(mesh.matrixWorld);
      if (!byMat.has(mname)) byMat.set(mname, []);
      byMat.get(mname)!.push(g);
      if (!colors.has(mname)) colors.set(mname, paletteFor(mname, mat.color ?? new THREE.Color('#cccccc')));
    }
  });
  const parts: ProtoPart[] = [];
  for (const [material, geos] of byMat) {
    const geometry = geos.length === 1 ? geos[0] : mergeGeometries(geos, false)!;
    parts.push({ geometry, material, color: colors.get(material)!, key: keyFor(material) });
  }
  const box = new THREE.Box3().setFromObject(scene);
  return { name, parts, box, size: box.getSize(new THREE.Vector3()) };
}

const protoCache = new Map<ModelName, Proto>();

/** Load every model of the library (suspends) and return the prototypes. */
export function useProtos(): Record<ModelName, Proto> {
  const gltfs = useGLTF(ALL_URLS) as unknown as { scene: THREE.Object3D }[];
  const names = Object.keys(MODELS) as ModelName[];
  const out = {} as Record<ModelName, Proto>;
  names.forEach((n, i) => {
    let p = protoCache.get(n);
    if (!p) {
      p = prepare(n, gltfs[i].scene);
      protoCache.set(n, p);
    }
    out[n] = p;
  });
  return out;
}

/** Start downloading the library early. */
export function preloadModels(): void {
  for (const u of ALL_URLS) useGLTF.preload(u);
}

export interface PlaceOptions {
  /** Colour overrides by material-name pattern (applied after the palette). */
  tint?: [RegExp, THREE.ColorRepresentation][];
  /** Multiply all colours (slight per-instance variation). */
  shade?: number;
}

const tmpColor = new THREE.Color();
const tmpM = new THREE.Matrix4();

/**
 * Bake a prototype into the static batches with world matrix `m`
 * (model units; include the scale in `m`).
 */
export function placeModel(b: Batches, proto: Proto, m: THREE.Matrix4, o: PlaceOptions = {}): void {
  for (const part of proto.parts) {
    tmpColor.copy(part.color);
    if (o.tint) for (const [re, c] of o.tint) if (re.test(part.material)) tmpColor.set(c);
    if (o.shade) tmpColor.multiplyScalar(o.shade);
    b.get(part.key).add(part.geometry, m, tmpColor.clone());
  }
}

/** Placement matrix: model scaled by `s`, rotated by `rotY`, its base centre at (x, y, z). */
export function modelMatrix(proto: { box: THREE.Box3 }, x: number, y: number, z: number, rotY: number, s: number, out = new THREE.Matrix4()): THREE.Matrix4 {
  const cx = (proto.box.min.x + proto.box.max.x) / 2;
  const cz = (proto.box.min.z + proto.box.max.z) / 2;
  out.makeTranslation(-cx, -proto.box.min.y, -cz);
  out.premultiply(tmpM.makeScale(s, s, s));
  out.premultiply(tmpM.makeRotationY(rotY));
  out.premultiply(tmpM.makeTranslation(x, y, z));
  return out;
}

/** Scale that makes the model `h` metres tall. */
export const scaleToHeight = (p: Proto, h: number) => h / p.size.y;

export interface InstanceSpec {
  x: number;
  y?: number;
  z: number;
  rotY?: number;
  scale: number;
  /** Per-instance colour multiplier. */
  tint?: THREE.ColorRepresentation;
}

/** Instanced meshes (one per material) for many copies of a prototype. */
export function instancedModel(proto: Proto, items: InstanceSpec[], o: { castShadow?: boolean; sway?: number } = {}): THREE.InstancedMesh[] {
  if (!items.length) return [];
  const out: THREE.InstancedMesh[] = [];
  const mats = items.map((it) => modelMatrix(proto, it.x, it.y ?? 0, it.z, it.rotY ?? 0, it.scale));
  for (const part of proto.parts) {
    const leafy = part.key === 'foliage';
    const material = leafy ? surfaceMaterial('foliage', { roughness: 0.92, sway: o.sway ?? 0.012, vertexColors: false }) : materialFor(part.key === 'winLit' ? 'plain' : part.key) as THREE.Material;
    // Bake the palette colour into a vertex colour attribute so that the shared materials work.
    const g = part.geometry.clone();
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([part.color.r, part.color.g, part.color.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mesh = new THREE.InstancedMesh(g, material, items.length);
    items.forEach((it, i) => {
      mesh.setMatrixAt(i, mats[i]);
      if (leafy) mesh.setColorAt(i, tmpColor.copy(part.color).multiply(new THREE.Color(it.tint ?? '#ffffff')));
      else if (it.tint) mesh.setColorAt(i, tmpColor.set(it.tint));
      else mesh.setColorAt(i, tmpColor.set('#ffffff'));
    });
    mesh.castShadow = o.castShadow !== false;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.name = `inst:${proto.name}:${part.material}`;
    out.push(mesh);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Textured props (Quaternius Fantasy Props MegaKit: base colour atlases)
// ---------------------------------------------------------------------------

export const PROPS = {
  chair: 'quaternius/props/Chair_1',
  stool: 'quaternius/props/Stool',
  tableLarge: 'quaternius/props/Table_Large',
  bench: 'quaternius/props/Bench',
  barrelApples: 'quaternius/props/Barrel_Apples',
  crateApple: 'quaternius/props/FarmCrate_Apple',
  crateCarrot: 'quaternius/props/FarmCrate_Carrot',
  crateEmpty: 'quaternius/props/FarmCrate_Empty',
  crateWood: 'quaternius/props/Crate_Wooden',
  stall: 'quaternius/props/Stall_Empty',
  stallCart: 'quaternius/props/Stall_Cart_Empty',
  lantern: 'quaternius/props/Lantern_Wall',
  pot: 'quaternius/props/Pot_1',
} as const;
export type PropName = keyof typeof PROPS;
const PROP_URLS = (Object.keys(PROPS) as PropName[]).map((n) => `/models/${PROPS[n]}.glb`);

export interface TexturedProto {
  name: PropName;
  meshes: { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }[];
  box: THREE.Box3;
  size: THREE.Vector3;
}

const texCache = new Map<PropName, TexturedProto>();

export function useTexturedProps(): Record<PropName, TexturedProto> {
  const gltfs = useGLTF(PROP_URLS) as unknown as { scene: THREE.Object3D }[];
  const names = Object.keys(PROPS) as PropName[];
  const out = {} as Record<PropName, TexturedProto>;
  names.forEach((n, i) => {
    let p = texCache.get(n);
    if (!p) {
      const scene = gltfs[i].scene;
      scene.updateMatrixWorld(true);
      const meshes: TexturedProto['meshes'] = [];
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const src = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
        const material = new THREE.MeshStandardMaterial({ map: src.map ?? null, color: src.map ? '#ffffff' : src.color, roughness: 0.85, metalness: 0 });
        if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
        const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
        meshes.push({ geometry: g, material });
      });
      const box = new THREE.Box3().setFromObject(scene);
      p = { name: n, meshes, box, size: box.getSize(new THREE.Vector3()) };
      texCache.set(n, p);
    }
    out[n] = p;
  });
  return out;
}

/** Instanced textured prop (one InstancedMesh per sub-mesh). */
export function instancedTextured(proto: TexturedProto, items: InstanceSpec[], castShadow = true): THREE.InstancedMesh[] {
  if (!items.length) return [];
  const mats = items.map((it) => modelMatrix(proto, it.x, it.y ?? 0, it.z, it.rotY ?? 0, it.scale));
  return proto.meshes.map(({ geometry, material }) => {
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.name = `tex:${proto.name}`;
    return mesh;
  });
}

/**
 * Highest point of a prototype's chimney-like stone parts in model space
 * (used to emit smoke from imported houses), or null.
 */
export function chimneyTop(proto: Proto): THREE.Vector3 | null {
  let best: THREE.Vector3 | null = null;
  const v = new THREE.Vector3();
  for (const p of proto.parts) {
    if (!/stone/i.test(p.material)) continue;
    const pos = p.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (v.y > proto.box.min.y + proto.size.y * 0.7 && (!best || v.y > best.y)) best = v.clone();
    }
  }
  return best;
}
