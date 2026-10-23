/**
 * Lightweight rain: a few thousand streaks (LineSegments) recycled in a box
 * around the camera target. Only visible while `env.rain` > 0.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CITY_CENTER, env, seeded } from './shared';

const COUNT = 2600;
const AREA = 760;
const TOP = 280;
const SPEED = 190; // m/s (stylised)
const STREAK = 7;
const WIND = 0.18;

export function Rain() {
  const lines = useRef<THREE.LineSegments>(null);
  const controls = useThree((s) => s.controls) as unknown as { target?: THREE.Vector3 } | null;

  const { geo, drops } = useMemo(() => {
    const rnd = seeded(99);
    const drops = new Float32Array(COUNT * 3); // local x, y, z of each drop head
    for (let i = 0; i < COUNT; i++) {
      drops[i * 3] = (rnd() - 0.5) * AREA;
      drops[i * 3 + 1] = rnd() * TOP;
      drops[i * 3 + 2] = (rnd() - 0.5) * AREA;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 6), 3));
    return { geo, drops };
  }, []);
  const mat = useMemo(() => new THREE.LineBasicMaterial({ color: '#c3d4e6', transparent: true, opacity: 0, depthWrite: false }), []);
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );

  useFrame((_, rawDt) => {
    const l = lines.current;
    if (!l) return;
    const rain = env.rain;
    l.visible = rain > 0.02;
    if (!l.visible) return;
    const dt = Math.min(rawDt, 0.05);
    mat.opacity = 0.5 * rain;
    const c = controls?.target ?? CITY_CENTER;
    l.position.set(c.x, 0, c.z);
    const pos = geo.attributes.position.array as Float32Array;
    // Fewer visible drops in light rain: draw only part of the buffer.
    const n = Math.floor(COUNT * Math.min(1, 0.25 + rain));
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      let y = drops[j + 1] - SPEED * dt;
      if (y < 0) {
        y += TOP;
        drops[j] = ((drops[j] + AREA * 0.618) % AREA) - AREA / 2;
      }
      drops[j + 1] = y;
      const x = drops[j];
      const z = drops[j + 2];
      const k = i * 6;
      pos[k] = x;
      pos[k + 1] = y;
      pos[k + 2] = z;
      pos[k + 3] = x - WIND * STREAK;
      pos[k + 4] = y + STREAK;
      pos[k + 5] = z;
    }
    geo.setDrawRange(0, n * 2);
    geo.attributes.position.needsUpdate = true;
  });

  return <lineSegments ref={lines} geometry={geo} material={mat} frustumCulled={false} visible={false} />;
}
