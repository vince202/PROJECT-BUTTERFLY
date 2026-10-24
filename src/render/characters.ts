/**
 * Animated inhabitants: Quaternius "Ultimate Animated Character Pack" (CC0).
 *
 * Each of the twenty profiles is cast to one of the rigged models, cloned
 * with SkeletonUtils, recoloured (clothes tinted with the profile colour so
 * everybody stays identifiable, skin / hair from the profile) and merged into
 * a single skinned mesh (one draw call per inhabitant). Clips: Idle, Walk,
 * SitDown (held on its last frame), StandUp, Victory, PickUp, Defeat.
 */

import { useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AGENTS } from '../sim/population';
import type { AgentProfile } from '../sim/types';
import { hashString } from './shared';

export const CLIP = {
  idle: 'CharacterArmature|Idle',
  walk: 'CharacterArmature|Walk',
  sit: 'CharacterArmature|SitDown',
  stand: 'CharacterArmature|StandUp',
  victory: 'CharacterArmature|Victory',
  pickup: 'CharacterArmature|PickUp',
  defeat: 'CharacterArmature|Defeat',
} as const;
export type ClipName = keyof typeof CLIP;

/** Casting of the twenty inhabitants (model file, relative size). */
export const CASTING: Record<string, { model: string; size?: number }> = {
  camille: { model: 'Chef_Female' },
  hugo: { model: 'Chef_Male' },
  lucie: { model: 'Chef_Female' },
  nadia: { model: 'Doctor_Female_Young' },
  gerard: { model: 'OldClassy_Male', size: 0.97 },
  mireille: { model: 'OldClassy_Female', size: 0.95 },
  thomas: { model: 'Suit_Male', size: 1.03 },
  martin: { model: 'Suit_Male' },
  yasmine: { model: 'Suit_Female' },
  alice: { model: 'Casual_Female' },
  sophie: { model: 'Casual2_Female' },
  chloe: { model: 'Casual2_Female' },
  ines: { model: 'Casual3_Female' },
  lea: { model: 'Casual3_Female', size: 0.93 },
  noe: { model: 'Casual3_Male', size: 0.95 },
  julien: { model: 'Casual2_Male' },
  karim: { model: 'Casual_Bald', size: 1.04 },
  paul: { model: 'Worker_Male' },
  antoine: { model: 'Worker_Male' },
  elodie: { model: 'Worker_Female' },
};

/** Inhabitants rendered with an animated model (all twenty). */
export const ANIMATED = new Set(AGENTS.map((a) => a.id));

const MODEL_URL = (m: string) => `/models/quaternius/characters/${m}.glb`;
const MODEL_NAMES = [...new Set(Object.values(CASTING).map((c) => c.model))];
const URLS = MODEL_NAMES.map(MODEL_URL);

/** Target height of a character (metres). */
export const CHARACTER_HEIGHT = 1.75;
/** Native height of the models (units). */
const NATIVE_HEIGHT = 3.2;

const SKIN = ['#f1c7a5', '#e5b48e', '#c98e66', '#8d5a3b', '#f4d2b8', '#d9a27a'];
const HAIR = ['#3b2a20', '#5a3b26', '#1f1a17', '#a8743f', '#d9b56c', '#7a3f22'];

export interface CharacterRig {
  id: string;
  group: THREE.Group;
  mesh: THREE.SkinnedMesh;
  material: THREE.MeshStandardMaterial;
  mixer: THREE.AnimationMixer;
  actions: Record<ClipName, THREE.AnimationAction | null>;
  current: ClipName | null;
  /** Base uniform scale of `group` (before LOD growth). */
  baseScale: number;
}

function roleColor(p: AgentProfile, material: string, out: THREE.Color): THREE.Color {
  const h = hashString(p.id);
  const main = new THREE.Color(p.color);
  const n = material.toLowerCase();
  if (/^(shirt|clothes|main|jacket|top)/.test(n)) return out.copy(main);
  if (/pants|darkclothes|^black|^brown/.test(n)) return out.copy(main).multiplyScalar(0.35).lerp(new THREE.Color('#2d3440'), 0.55);
  if (/^skin/.test(n)) return out.set(SKIN[h % SKIN.length]);
  if (/hair|moustache/.test(n)) return out.set(p.age >= 60 ? '#d8d6d0' : HAIR[(h >>> 3) % HAIR.length]);
  if (/^face/.test(n)) return out.set('#2a2420');
  if (/belt/.test(n)) return out.set('#4a3524');
  if (/hat/.test(n)) return out.set(/worker/i.test(CASTING[p.id]?.model ?? '') ? '#e0a526' : '#34323a');
  if (/detail|band|scarf/.test(n)) return out.copy(main).offsetHSL(0.45, -0.1, 0.05);
  return out.set('#9a9286');
}

function buildRig(p: AgentProfile, gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }): CharacterRig {
  const clone = SkeletonUtils.clone(gltf.scene) as THREE.Group;
  const skinned: THREE.SkinnedMesh[] = [];
  clone.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
  });
  const c = new THREE.Color();
  const geos = skinned.map((m) => {
    const g = m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'skinIndex', 'skinWeight'].includes(k)) g.deleteAttribute(k);
    roleColor(p, (m.material as THREE.Material).name ?? '', c);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g.index ? g : g;
  });
  const allIndexed = geos.every((g) => g.index);
  const merged = mergeGeometries(allIndexed ? geos : geos.map((g) => (g.index ? g.toNonIndexed() : g)), false)!;
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 });
  const first = skinned[0];
  const mesh = new THREE.SkinnedMesh(merged, material);
  mesh.position.copy(first.position);
  mesh.quaternion.copy(first.quaternion);
  mesh.scale.copy(first.scale);
  mesh.bind(first.skeleton, first.bindMatrix);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  first.parent!.add(mesh);
  for (const m of skinned) {
    m.parent!.remove(m);
    m.geometry.dispose();
  }
  const group = new THREE.Group();
  group.name = `character:${p.id}`;
  group.add(clone);
  const baseScale = (CHARACTER_HEIGHT / NATIVE_HEIGHT) * (CASTING[p.id]?.size ?? 1);
  group.scale.setScalar(baseScale);
  const mixer = new THREE.AnimationMixer(clone);
  const actions = {} as Record<ClipName, THREE.AnimationAction | null>;
  for (const k of Object.keys(CLIP) as ClipName[]) {
    const clip = gltf.animations.find((a) => a.name === CLIP[k]);
    const act = clip ? mixer.clipAction(clip) : null;
    if (act && (k === 'sit' || k === 'stand' || k === 'victory' || k === 'pickup' || k === 'defeat')) {
      act.setLoop(THREE.LoopOnce, 1);
      act.clampWhenFinished = true;
    }
    actions[k] = act;
  }
  // Desynchronise idles.
  mixer.setTime((hashString(p.id) % 1000) / 250);
  return { id: p.id, group, mesh, material, mixer, actions, current: null, baseScale };
}

/** Cross-fade a rig to `clip` (no-op if already playing). */
export function playClip(rig: CharacterRig, clip: ClipName, fade = 0.25, timeScale = 1): void {
  const next = rig.actions[clip];
  if (!next) return;
  if (rig.current === clip) {
    next.timeScale = timeScale;
    return;
  }
  const prev = rig.current ? rig.actions[rig.current] : null;
  next.reset();
  next.timeScale = timeScale;
  next.enabled = true;
  next.setEffectiveWeight(1);
  next.play();
  if (prev) prev.crossFadeTo(next, fade, false);
  rig.current = clip;
}

/**
 * Loads the character models (suspends) and hands the rigs to `onReady`.
 * Rendered inside <Suspense>: until it resolves, the procedural figures are shown.
 */
export function CharacterCast({ onReady }: { onReady: (rigs: Map<string, CharacterRig>) => void }) {
  const gltfs = useGLTF(URLS) as unknown as { scene: THREE.Object3D; animations: THREE.AnimationClip[] }[];
  const rigs = useMemo(() => {
    const byName = new Map(MODEL_NAMES.map((n, i) => [n, gltfs[i]]));
    const map = new Map<string, CharacterRig>();
    for (const p of AGENTS) {
      if (!ANIMATED.has(p.id)) continue;
      const g = byName.get(CASTING[p.id]?.model ?? 'Casual_Male');
      if (g) map.set(p.id, buildRig(p, g));
    }
    return map;
  }, [gltfs]);
  useEffect(() => {
    onReady(rigs);
    return () => {
      for (const r of rigs.values()) {
        r.group.removeFromParent();
        r.mesh.geometry.dispose();
        r.material.dispose();
        r.mixer.stopAllAction();
      }
    };
  }, [rigs, onReady]);
  return null;
}
