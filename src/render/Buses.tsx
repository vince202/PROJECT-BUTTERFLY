/**
 * The Ligne 1 buses: Quaternius bus model recoloured with the line colour,
 * turning wheels, a "Ligne 1" destination sign, lit headlights at night and
 * small passenger silhouettes behind the windows. Positions come from the
 * interpolated trace (right-hand lane, smooth turns); the small id / delay
 * label only shows in laboratory mode.
 */

import { Suspense, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { BUS_LINES } from '../sim/city';
import { useActiveReality, useSimStore } from '../store/useSimStore';
import { bulbMat } from './kit';
import { type StreetSample, activeRealityOf, angleDelta, damp, env, makeLabel, sampleFrames, sizeLabel, streetLerp } from './shared';

const LANE_OFFSET = 3.6;
const URL = '/models/quaternius/transport/Bus.glb';
/** Model scale: along the bus and up (wheels stay round), and across. */
const S_LEN = 2.25;
const S_WIDE = 1.55;
const MAX_SILHOUETTES = 12;

export function Buses() {
  return (
    <Suspense fallback={null}>
      <BusFleet />
    </Suspense>
  );
}

function signTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1b1d22';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#ffb703';
  ctx.font = '700 40px "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Ligne 1', 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface BusRig {
  root: THREE.Group;
  wheels: THREE.Mesh[];
  people: THREE.InstancedMesh;
  label: THREE.Sprite;
  labelKey: string;
  aspect: number;
  heading: number;
  offset: THREE.Vector3;
  init: boolean;
  last: THREE.Vector3;
  shown: number;
}

const COLORS: Record<string, string> = {
  Bumper: '#f6f1e6',
  Top: '#e8962e',
  Bottom: '#3a3d42',
  Windows: '#2e3d4c',
  Details: '#2b2e33',
  Material: '#232529',
};

function BusFleet() {
  const reality = useActiveReality();
  const generation = useSimStore((s) => s.generation);
  const gltf = useGLTF(URL) as unknown as { scene: THREE.Object3D };
  const busIds = useMemo(() => {
    const f = reality.frameAt(0);
    return f ? Object.keys(f.buses).sort() : [];
    // `generation` bumps when the reality is regenerated.
  }, [reality, generation]);
  const lineColor = BUS_LINES[0]?.color ?? '#f39c12';

  const shared = useMemo(() => {
    const mats = new Map<string, THREE.Material>();
    const matFor = (name: string) => {
      if (name === 'Lights') return bulbMat();
      let m = mats.get(name);
      if (!m) {
        m = new THREE.MeshStandardMaterial({ color: COLORS[name] ?? '#9aa0a6', roughness: name === 'Windows' ? 0.15 : 0.55, metalness: name === 'Windows' ? 0.2 : 0.05, flatShading: true });
        mats.set(name, m);
      }
      return m;
    };
    const sign = signTexture();
    const signMat = new THREE.MeshBasicMaterial({ map: sign, toneMapped: false });
    const personGeo = new THREE.CapsuleGeometry(0.28, 0.45, 3, 8);
    const personMat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
    return { matFor, mats, sign, signMat, personGeo, personMat };
  }, []);

  const rigs = useMemo(() => {
    const map = new Map<string, BusRig>();
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const cx = (box.min.x + box.max.x) / 2;
    for (const id of busIds) {
      const root = new THREE.Group();
      root.name = `bus:${id}`;
      // Model: length along x with the front at -x -> rotate so the front faces +z.
      const model = new THREE.Group();
      model.rotation.y = Math.PI / 2;
      model.scale.set(S_LEN, S_LEN, S_WIDE);
      root.add(model);
      const wheels: THREE.Mesh[] = [];
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        const src = o as THREE.Mesh;
        if (!src.isMesh) return;
        const g = src.geometry.clone().applyMatrix4(src.matrixWorld);
        g.translate(-cx, -box.min.y, 0);
        const name = (src.material as THREE.Material).name;
        const mesh = new THREE.Mesh(g, shared.matFor(name));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (/wheel/i.test(src.name)) {
          g.computeBoundingBox();
          const c = g.boundingBox!.getCenter(new THREE.Vector3());
          g.translate(-c.x, -c.y, -c.z);
          mesh.position.copy(c);
          wheels.push(mesh);
        }
        model.add(mesh);
      });
      // Destination sign above the windscreen and on the right side.
      const front = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.24), shared.signMat);
      front.position.set(box.min.x - cx - 0.02, box.max.y - box.min.y - 0.22, 0);
      front.rotation.y = -Math.PI / 2;
      model.add(front);
      const side = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.2), shared.signMat);
      side.position.set(0.6, box.max.y - box.min.y - 0.2, box.max.z + 0.01);
      model.add(side);
      // Passengers behind the windows.
      const people = new THREE.InstancedMesh(shared.personGeo, shared.personMat, MAX_SILHOUETTES);
      const pal = ['#5d6b7a', '#8a5a3b', '#b4483c', '#6f8c5f', '#d9a85b', '#71889c'];
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < MAX_SILHOUETTES; i++) {
        const row = Math.floor(i / 2);
        m4.makeTranslation(i % 2 ? 0.55 : -0.55, 2.45, 3.2 - row * 1.25);
        people.setMatrixAt(i, m4);
        people.setColorAt(i, new THREE.Color(pal[i % pal.length]));
      }
      people.count = 0;
      people.frustumCulled = false;
      root.add(people);
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false, fog: false }));
      label.center.set(0.5, 0);
      label.position.y = 5.2;
      label.renderOrder = 8;
      root.add(label);
      map.set(id, { root, wheels, people, label, labelKey: '', aspect: 1, heading: 0, offset: new THREE.Vector3(), init: false, last: new THREE.Vector3(), shown: 0 });
    }
    return map;
  }, [busIds, gltf, shared]);

  useEffect(
    () => () => {
      for (const r of rigs.values()) {
        r.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose?.());
        const mat = r.label.material as THREE.SpriteMaterial;
        mat.map?.dispose();
        mat.dispose();
      }
    },
    [rigs],
  );

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const s = useSimStore.getState();
    const pair = sampleFrames(activeRealityOf(s), s.time);
    const lab = s.uiMode === 'lab';
    for (const [id, r] of rigs) {
      const b0 = pair?.f0.buses[id];
      const b1 = pair?.f1.buses[id] ?? b0;
      if (!pair || !b0 || !b1) {
        r.root.visible = false;
        continue;
      }
      r.root.visible = true;
      const d = Math.hypot(b1.x - b0.x, b1.y - b0.y);
      const k = d > 600 ? (pair.k < 0.5 ? 0 : 1) : pair.k;
      streetLerp(b0.x, b0.y, b1.x, b1.y, k, sample);
      if (d > 0.5 && d <= 600) {
        const target = Math.atan2(sample.dx, sample.dy);
        if (!r.init) r.heading = target;
        else r.heading += angleDelta(r.heading, target) * damp(5, dt);
      }
      tmpOffset.set(-Math.cos(r.heading) * LANE_OFFSET, 0, Math.sin(r.heading) * LANE_OFFSET);
      if (!r.init) r.offset.copy(tmpOffset);
      else r.offset.lerp(tmpOffset, damp(6, dt));
      r.root.position.set(sample.x + r.offset.x, 0.02, sample.y + r.offset.z);
      r.root.rotation.y = r.heading;
      // Wheels turn with the distance actually covered (capped for fast playback).
      const moved = r.init ? Math.min(r.last.distanceTo(r.root.position), dt * 30) : 0;
      r.last.copy(r.root.position);
      r.init = true;
      for (const w of r.wheels) w.rotation.z += moved / 0.75;
      // Passenger silhouettes
      const want = Math.min(MAX_SILHOUETTES, Math.round(b0.passengers));
      if (want !== r.shown) {
        r.shown = want;
        r.people.count = want;
      }
      // Label: lab mode only; regenerate the texture only when its text changes.
      r.label.visible = lab;
      if (lab) {
        const delay = Math.round(b0.delay);
        const key = `${id}|${delay}`;
        if (key !== r.labelKey) {
          r.labelKey = key;
          const l = makeLabel({ text: `Bus ${id}`, suffix: delay > 0 ? `+${delay} min` : undefined, dot: lineColor, fontSize: 28 });
          const mat = r.label.material as THREE.SpriteMaterial;
          mat.map?.dispose();
          mat.map = l.texture;
          mat.needsUpdate = true;
          r.aspect = l.aspect;
        }
        sizeLabel(r.label, r.aspect, env.camDistance < 150 ? 16 : 18);
      }
    }
  });

  return (
    <group>
      {[...rigs.entries()].map(([id, r]) => (
        <primitive key={id} object={r.root} />
      ))}
    </group>
  );
}

const tmpOffset = new THREE.Vector3();
const sample: StreetSample = { x: 0, y: 0, dx: 0, dy: 0 };
