/**
 * Small ambient life, all cheap: fountain spray (GPU particles), the pond
 * water, ducks paddling in slow loops, pigeons pecking on the fountain plaza
 * and Place du Marché (they flutter away when someone walks by).
 */

import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CURB_H } from './layout';
import { makeBillboards, waterMaterial } from './materials';
import { agentWorld, damp, env, seeded } from './shared';
import { PARK } from './townBuilder';

const DUCKS = 6;
const PIGEONS = 16;

function duckGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.28, 8, 6);
  body.scale(1, 0.7, 1.5);
  body.translate(0, 0.12, 0);
  const head = new THREE.SphereGeometry(0.14, 8, 6);
  head.translate(0, 0.38, 0.32);
  const beak = new THREE.ConeGeometry(0.05, 0.16, 4);
  beak.rotateX(Math.PI / 2);
  beak.translate(0, 0.36, 0.5);
  return mergeAll([body, head, beak]);
}

function pigeonGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.12, 6, 5);
  body.scale(1, 0.85, 1.6);
  body.translate(0, 0.13, 0);
  const head = new THREE.SphereGeometry(0.065, 6, 5);
  head.translate(0, 0.24, 0.15);
  return mergeAll([body, head]);
}

function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  for (const p of flat) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  let o = 0;
  for (const p of flat) {
    pos.set(p.attributes.position.array as Float32Array, o * 3);
    nrm.set(p.attributes.normal.array as Float32Array, o * 3);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}

interface Bird {
  x: number;
  z: number;
  hx: number;
  hz: number;
  heading: number;
  peck: number;
  fly: number;
  vx: number;
  vz: number;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const tmpE = new THREE.Euler();

export function Life() {
  const built = useMemo(() => {
    const rnd = seeded(404);
    const F = PARK.fountain;
    const spray = makeBillboards(
      Array.from({ length: 70 }, (_, i) => ({ x: F.x, y: CURB_H + 3.3, z: F.z, size: 0.35, phase: i / 70, color: new THREE.Color(1.3 + rnd() * 0.9, 1.2 + rnd() * 1.2, 0.5) })),
      'spray',
      '#e4f2fb',
    );
    (spray.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0.8;
    // Pond water
    const pd = PARK.pond;
    const pond = new THREE.Mesh(new THREE.CircleGeometry(1, 32), waterMaterial('#2f6f86'));
    pond.rotation.x = -Math.PI / 2;
    pond.scale.set(pd.rx, pd.rz, 1);
    pond.position.set(pd.x, CURB_H + 0.36, pd.z);
    pond.receiveShadow = true;
    const basin = new THREE.Mesh(new THREE.CircleGeometry(4.8, 24), waterMaterial('#3d84a0'));
    basin.rotation.x = -Math.PI / 2;
    basin.position.set(F.x, CURB_H + 0.71, F.z);
    const duckMat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
    const ducks = new THREE.InstancedMesh(duckGeometry(), duckMat, DUCKS);
    const duckCols = ['#f4f1ea', '#f4f1ea', '#7a5a3c', '#f4f1ea', '#6b5a48', '#f4f1ea'];
    for (let i = 0; i < DUCKS; i++) ducks.setColorAt(i, new THREE.Color(duckCols[i]));
    ducks.castShadow = true;
    ducks.frustumCulled = false;
    const pigeonMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    const pigeons = new THREE.InstancedMesh(pigeonGeometry(), pigeonMat, PIGEONS);
    const birds: Bird[] = [];
    for (let i = 0; i < PIGEONS; i++) {
      const home = i < 9 ? { x: F.x + 3, z: F.z - 9 } : { x: 418, z: 136 };
      const x = home.x + (rnd() - 0.5) * 8;
      const z = home.z + (rnd() - 0.5) * 6;
      birds.push({ x, z, hx: home.x, hz: home.z, heading: rnd() * 6.28, peck: rnd() * 10, fly: 0, vx: 0, vz: 0 });
      pigeons.setColorAt(i, new THREE.Color(['#8a8f99', '#a3a7ad', '#6f747c', '#b9b3a8'][i % 4]));
    }
    pigeons.castShadow = true;
    pigeons.frustumCulled = false;
    return { spray, pond, basin, ducks, pigeons, birds, duckMat, pigeonMat };
  }, []);

  useEffect(
    () => () => {
      built.spray.geometry.dispose();
      built.ducks.geometry.dispose();
      built.pigeons.geometry.dispose();
      built.duckMat.dispose();
      built.pigeonMat.dispose();
    },
    [built],
  );

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const t = performance.now() / 1000;
    const near = env.camDistance < 450;
    built.ducks.visible = near && env.night < 0.7;
    built.pigeons.visible = near && env.rain < 0.5 && env.night < 0.5;
    built.spray.visible = near;
    if (!near) return;
    const pd = PARK.pond;
    for (let i = 0; i < DUCKS; i++) {
      const a = t * (0.05 + i * 0.012) + i * 1.3;
      const r = 0.35 + (i % 3) * 0.18;
      const x = pd.x + Math.cos(a) * pd.rx * r;
      const z = pd.z + Math.sin(a) * pd.rz * r;
      const heading = Math.atan2(-Math.sin(a) * pd.rx, Math.cos(a) * pd.rz);
      tmpQ.setFromAxisAngle(UP, heading);
      tmpP.set(x, CURB_H + 0.32 + Math.sin(t * 2 + i) * 0.02, z);
      tmpM.compose(tmpP, tmpQ, tmpS.set(1, 1, 1));
      built.ducks.setMatrixAt(i, tmpM);
    }
    built.ducks.instanceMatrix.needsUpdate = true;
    // Pigeons: peck around their spot, flutter away from passers-by.
    for (let i = 0; i < PIGEONS; i++) {
      const b = built.birds[i];
      let scared = false;
      for (const a of agentWorld.values()) {
        if (!a.visible || a.inside) continue;
        const dx = b.x - a.pos.x;
        const dz = b.z - a.pos.z;
        if (dx * dx + dz * dz < 6) {
          scared = true;
          const d = Math.hypot(dx, dz) || 1;
          b.vx = (dx / d) * 4;
          b.vz = (dz / d) * 4;
          break;
        }
      }
      if (scared && b.fly <= 0) b.fly = 1.2;
      let y = CURB_H;
      if (b.fly > 0) {
        b.fly -= dt;
        b.x += b.vx * dt;
        b.z += b.vz * dt;
        b.heading = Math.atan2(b.vx, b.vz);
        y += Math.sin(Math.max(0, b.fly) / 1.2 * Math.PI) * 1.6;
      } else {
        // Drift back home while pecking.
        b.peck -= dt;
        if (b.peck < 0) {
          b.peck = 0.6 + ((i * 7.3 + t) % 2.4);
          b.heading += (((i * 13.7 + Math.floor(t)) % 5) - 2) * 0.5;
        }
        const step = 0.35 * dt;
        b.x += Math.sin(b.heading) * step + (b.hx - b.x) * damp(0.15, dt);
        b.z += Math.cos(b.heading) * step + (b.hz - b.z) * damp(0.15, dt);
      }
      const bob = b.fly > 0 ? 0 : Math.max(0, Math.sin(t * 9 + i)) * 0.4;
      tmpQ.setFromEuler(tmpE.set(bob, b.heading, 0));
      tmpP.set(b.x, y, b.z);
      tmpM.compose(tmpP, tmpQ, tmpS.set(1, 1, 1));
      built.pigeons.setMatrixAt(i, tmpM);
    }
    built.pigeons.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <primitive object={built.spray} />
      <primitive object={built.pond} />
      <primitive object={built.basin} />
      <primitive object={built.ducks} />
      <primitive object={built.pigeons} />
    </group>
  );
}
