/**
 * Building names: no permanent labels. A name appears when a building is
 * hovered (invisible pick boxes) and, when the camera is close, for the two or
 * three nearest buildings (only the nearest one in spectator mode).
 * Double-clicking a building focuses the camera on it.
 */

import { useEffect, useMemo, useRef } from 'react';
import { type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { LOCATIONS } from '../sim/city';
import { useSimStore } from '../store/useSimStore';
import { env, labelMaterial, makeLabel, sizeLabel } from './shared';

interface Pick {
  id: string;
  box: THREE.Box3;
}

const NAMES = new Map(LOCATIONS.map((l) => [l.id, l.name]));
const COLORS = new Map(LOCATIONS.map((l) => [l.id, l.color]));
const POOL = 4;
const tmpC = new THREE.Vector3();

export function PlaceLabels({ picks }: { picks: Pick[] }) {
  const controls = useThree((s) => s.controls) as unknown as { target?: THREE.Vector3 } | null;
  const gl = useThree((s) => s.gl);
  const hovered = useRef<string | null>(null);

  const { boxes, pickMat, labels, sprites } = useMemo(() => {
    const pickMat = new THREE.MeshBasicMaterial({ visible: false });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const boxes = picks.map((p) => {
      const m = new THREE.Mesh(geo, pickMat);
      p.box.getCenter(m.position);
      p.box.getSize(m.scale);
      m.userData.locationId = p.id;
      m.name = `pick:${p.id}`;
      return m;
    });
    const labels = new Map<string, { mat: THREE.SpriteMaterial; aspect: number; tex: THREE.Texture }>();
    const sprites = Array.from({ length: POOL }, () => {
      const s = new THREE.Sprite();
      s.center.set(0.5, 0);
      s.renderOrder = 6;
      s.visible = false;
      s.raycast = () => {};
      return s;
    });
    return { boxes, pickMat, labels, sprites };
  }, [picks]);

  useEffect(
    () => () => {
      pickMat.dispose();
      boxes[0]?.geometry.dispose();
      for (const l of labels.values()) {
        l.tex.dispose();
        l.mat.dispose();
      }
    },
    [boxes, pickMat, labels],
  );

  const labelFor = (id: string) => {
    let l = labels.get(id);
    if (!l) {
      const lab = makeLabel({ text: NAMES.get(id) ?? id, dot: COLORS.get(id), fontSize: 28 });
      l = { mat: labelMaterial(lab), aspect: lab.aspect, tex: lab.texture };
      labels.set(id, l);
    }
    return l;
  };

  const show = useRef<{ id: string; k: number }[]>([]);
  useFrame(() => {
    const s = useSimStore.getState();
    const spectator = s.uiMode === 'spectator';
    const wanted: string[] = [];
    if (hovered.current) wanted.push(hovered.current);
    const t = controls?.target;
    const close = spectator ? 75 : 120;
    if (t && env.camDistance < close) {
      const ranked = picks
        .map((p) => ({ id: p.id, d: p.box.getCenter(tmpC).setY(0).distanceTo(new THREE.Vector3(t.x, 0, t.z)) }))
        .filter((p) => p.d < (spectator ? 45 : 90))
        .sort((a, b) => a.d - b.d)
        .slice(0, spectator ? 1 : 3);
      for (const r of ranked) if (!wanted.includes(r.id)) wanted.push(r.id);
    }
    show.current = wanted.slice(0, POOL).map((id) => ({ id, k: 1 }));
    sprites.forEach((sp, i) => {
      const w = show.current[i];
      sp.visible = !!w;
      if (!w) return;
      const p = picks.find((q) => q.id === w.id)!;
      const l = labelFor(w.id);
      sp.material = l.mat;
      p.box.getCenter(sp.position);
      sp.position.y = p.box.max.y + 1.5;
      sizeLabel(sp, l.aspect, w.id === hovered.current ? 20 : 17);
      l.mat.opacity = w.id === hovered.current ? 1 : 0.85;
    });
  });

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    hovered.current = e.object.userData.locationId as string;
    if (!useSimStore.getState().hoveredAgentId) gl.domElement.style.cursor = 'help';
  };
  const onOut = (e: ThreeEvent<PointerEvent>) => {
    if (hovered.current === e.object.userData.locationId) hovered.current = null;
    if (!useSimStore.getState().hoveredAgentId) gl.domElement.style.cursor = '';
  };
  const onDouble = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    (window as unknown as { __butterflyCamera?: { focusLocation: (id: string) => void } }).__butterflyCamera?.focusLocation(e.object.userData.locationId as string);
  };

  return (
    <group>
      {boxes.map((b) => (
        <primitive key={b.name} object={b} onPointerOver={onOver} onPointerOut={onOut} onDoubleClick={onDouble} />
      ))}
      {sprites.map((sp, i) => (
        <primitive key={i} object={sp} />
      ))}
    </group>
  );
}
