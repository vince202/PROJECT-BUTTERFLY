/**
 * Buses of the line, built once as merged vertex-coloured models and moved
 * every frame from the interpolated trace. Buses keep to the right-hand lane,
 * turn smoothly towards their direction of travel and carry a small label
 * with their id and current delay.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BUS_LINES } from '../sim/city';
import { useActiveReality, useSimStore } from '../store/useSimStore';
import { StaticBatch, batchMaterial } from './batch';
import { activeRealityOf, angleDelta, damp, env, labelMaterial, makeLabel, sampleFrames, sizeLabel } from './shared';
import { bulbColor } from './Streets';

const LANE_OFFSET = 3.6;
const LENGTH = 17;
const WIDTH = 5.2;
const HEIGHT = 5.4;
const CLEARANCE = 1.0;

/** Bus body model with its length along local +z (front at +z). */
function buildBusModel(color: string) {
  const b = new StaticBatch();
  const glow = new StaticBatch();
  const L = LENGTH;
  const W = WIDTH;
  const y0 = CLEARANCE;
  const glass = '#2c3b4d';
  // Body
  b.box(0, y0, 0, W, HEIGHT, L, color);
  b.box(0, y0, 0, W + 0.1, 0.9, L + 0.1, '#e9e4d8'); // skirt
  b.box(0, y0 + HEIGHT, 0, W - 0.8, 0.5, L - 2, '#f6f1e6'); // roof cap
  // Side windows
  for (const s of [-1, 1]) {
    b.box(s * (W / 2 + 0.03), y0 + 2.4, -0.6, 0.12, 2.1, L - 4.8, glass);
    for (let i = 0; i < 5; i++) b.box(s * (W / 2 + 0.06), y0 + 2.3, -L / 2 + 2.6 + i * ((L - 4.6) / 4), 0.14, 2.3, 0.35, color);
    // Doors (right side only)
    if (s < 0) {
      b.box(-W / 2 - 0.05, y0 + 0.2, L / 2 - 2.6, 0.12, 4.2, 2.4, glass);
      b.box(-W / 2 - 0.05, y0 + 0.2, -1.2, 0.12, 4.2, 2.4, glass);
    }
  }
  // Windscreen and rear window
  b.box(0, y0 + 2.0, L / 2 + 0.03, W - 0.6, 2.8, 0.12, glass);
  b.box(0, y0 + 2.8, -L / 2 - 0.03, W - 1.2, 1.6, 0.12, glass);
  // Destination display (glows) and lights
  glow.box(0, y0 + 4.9, L / 2 + 0.08, W - 1.4, 0.55, 0.1, '#ffb703');
  for (const s of [-1, 1]) {
    glow.box(s * (W / 2 - 0.8), y0 + 0.8, L / 2 + 0.08, 0.9, 0.5, 0.1, '#fff6d8');
    glow.box(s * (W / 2 - 0.7), y0 + 1.0, -L / 2 - 0.08, 0.6, 0.6, 0.1, '#ff3b30');
  }
  // Roof sign with the line number
  b.box(0, y0 + HEIGHT + 0.5, L / 2 - 2.5, 2.4, 1.0, 1.2, '#2d3e50');
  glow.box(0, y0 + HEIGHT + 0.65, L / 2 - 1.85, 1.8, 0.7, 0.05, '#ffd166');
  // Wheels
  for (const s of [-1, 1]) {
    for (const zz of [L / 2 - 3.2, -L / 2 + 3.4]) {
      b.shape('cyl16', s * (W / 2 - 0.3), 1.25, zz, 2.5, 0.9, 2.5, '#22252b', { z: Math.PI / 2 });
      b.shape('cyl8', s * (W / 2 - 0.2), 1.25, zz, 1.2, 0.95, 1.2, '#9aa0a6', { z: Math.PI / 2 });
    }
  }
  return { body: b.build(), glow: glow.build() };
}

interface BusRig {
  root: THREE.Group;
  label: THREE.Sprite;
  labelKey: string;
  aspect: number;
  heading: number;
  offset: THREE.Vector3;
  init: boolean;
}

const tmpOffset = new THREE.Vector3();

export function Buses() {
  const reality = useActiveReality();
  const generation = useSimStore((s) => s.generation);
  // Bus ids from the first trace frame (stable for a reality).
  const busIds = useMemo(() => {
    const f = reality.frameAt(0);
    return f ? Object.keys(f.buses).sort() : [];
    // generation bumps when the reality is regenerated
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reality, generation]);

  const color = BUS_LINES[0]?.color ?? '#f39c12';
  const model = useMemo(() => buildBusModel(color), [color]);
  const bodyMat = useMemo(() => batchMaterial({ roughness: 0.45, flatShading: true }), []);
  const glowMat = useMemo(() => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), []);
  const headlight = useMemo(() => new THREE.Color(), []);

  useEffect(
    () => () => {
      model.body?.dispose();
      model.glow?.dispose();
      bodyMat.dispose();
      glowMat.dispose();
    },
    [model, bodyMat, glowMat],
  );

  const rigs = useRef(new Map<string, BusRig>());

  const groups = useMemo(() => {
    const map = new Map<string, BusRig>();
    for (const id of busIds) {
      const root = new THREE.Group();
      root.name = `bus:${id}`;
      if (model.body) {
        const m = new THREE.Mesh(model.body, bodyMat);
        m.castShadow = true;
        m.receiveShadow = true;
        root.add(m);
      }
      if (model.glow) root.add(new THREE.Mesh(model.glow, glowMat));
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false, fog: false }));
      label.center.set(0.5, 0);
      label.position.y = HEIGHT + CLEARANCE + 3.5;
      label.renderOrder = 8;
      root.add(label);
      map.set(id, { root, label, labelKey: '', aspect: 1, heading: 0, offset: new THREE.Vector3(), init: false });
    }
    rigs.current = map;
    return map;
  }, [busIds, model, bodyMat, glowMat]);

  useEffect(
    () => () => {
      for (const r of groups.values()) {
        const mat = r.label.material as THREE.SpriteMaterial;
        mat.map?.dispose();
        mat.dispose();
      }
    },
    [groups],
  );

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const s = useSimStore.getState();
    const pair = sampleFrames(activeRealityOf(s), s.time);
    bulbColor(headlight, env.night);
    glowMat.color.setScalar(0.8 + env.night * 0.6);

    for (const [id, r] of rigs.current) {
      const b0 = pair?.f0.buses[id];
      const b1 = pair?.f1.buses[id] ?? b0;
      if (!pair || !b0 || !b1) {
        r.root.visible = false;
        continue;
      }
      r.root.visible = true;
      const dx = b1.x - b0.x;
      const dz = b1.y - b0.y;
      const d = Math.hypot(dx, dz);
      const k = d > 400 ? (pair.k < 0.5 ? 0 : 1) : pair.k;
      const x = b0.x + dx * k;
      const z = b0.y + dz * k;
      if (d > 0.5 && d < 400) {
        const target = Math.atan2(dx, dz);
        if (!r.init) r.heading = target;
        else r.heading += angleDelta(r.heading, target) * damp(5, dt);
      }
      // Right-hand lane offset follows the (smoothed) heading.
      tmpOffset.set(-Math.cos(r.heading) * LANE_OFFSET, 0, Math.sin(r.heading) * LANE_OFFSET);
      if (!r.init) r.offset.copy(tmpOffset);
      else r.offset.lerp(tmpOffset, damp(6, dt));
      r.init = true;
      r.root.position.set(x + r.offset.x, 0, z + r.offset.z);
      r.root.rotation.y = r.heading;

      // Label: regenerate the texture only when its text changes.
      const delay = Math.round(b0.delay);
      const key = `${id}|${delay}`;
      if (key !== r.labelKey) {
        r.labelKey = key;
        const lab = makeLabel({
          text: `Bus ${id}`,
          suffix: delay > 0 ? `+${delay} min` : undefined,
          dot: color,
          fontSize: 28,
        });
        const mat = r.label.material as THREE.SpriteMaterial;
        mat.map?.dispose();
        mat.map = lab.texture;
        mat.needsUpdate = true;
        r.aspect = lab.aspect;
      }
      sizeLabel(r.label, r.aspect, 18);
    }
  });

  return (
    <group>
      {[...groups.entries()].map(([id, r]) => (
        <primitive key={id} object={r.root} />
      ))}
    </group>
  );
}

/** Same as labelMaterial but exported for symmetry (kept for future label variants). */
export const busLabelMaterial = labelMaterial;
