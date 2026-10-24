/**
 * Speech bubbles above inhabitants (player mode).
 *
 * The bubbles are plain DOM elements rendered by the interface (ui/game);
 * they register here with the inhabitants they belong to. <BubbleProjector/>
 * lives inside the canvas and, every frame, projects the inhabitants'
 * positions (`agentWorld`) to the screen and writes each bubble's transform
 * directly — no React work per frame. Bubbles of the same inhabitant stack
 * upwards, the newest on top.
 */

import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { agentWorld } from './shared';

export interface BubbleAnchor {
  el: HTMLElement;
  /** Inhabitants the bubble is about (the first one is the anchor; two close ones share the midpoint). */
  agents: string[];
  /** Newest = highest. */
  order: number;
  /** Measured height (px), for stacking. */
  h: number;
}

export const bubbleAnchors = new Map<string, BubbleAnchor>();

/** Height above the doorstep of the indoor badge (Agents.tsx BADGE_Y), plus a margin. */
const INSIDE_Y = 5.2;
/** Gap between stacked bubbles (px). */
const STACK_GAP = 6;
/** Two anchors closer than this (m) share one bubble position. */
const PAIR_DIST = 18;

const v = new THREE.Vector3();
const w2 = new THREE.Vector3();

function anchorPoint(agents: string[], out: THREE.Vector3): boolean {
  const a = agentWorld.get(agents[0]);
  if (!a) return false;
  const lift = (p: { pos: THREE.Vector3; h?: number; inside?: boolean }, o: THREE.Vector3) => o.set(p.pos.x, p.pos.y + (p.inside ? INSIDE_Y : (p.h ?? 1.7) * 1.1 + 0.9), p.pos.z);
  lift(a, out);
  const b = agents[1] ? agentWorld.get(agents[1]) : undefined;
  if (b && b.pos.distanceTo(a.pos) < PAIR_DIST) {
    lift(b, w2);
    out.add(w2).multiplyScalar(0.5);
  }
  return true;
}

export function BubbleProjector() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useFrame(() => {
    if (!bubbleAnchors.size) return;
    // Oldest first: each bubble of an inhabitant sits above the previous ones.
    const list = [...bubbleAnchors.values()].sort((x, y) => x.order - y.order);
    const stack = new Map<string, number>();
    for (const b of list) {
      if (!anchorPoint(b.agents, v)) {
        b.el.style.visibility = 'hidden';
        continue;
      }
      v.project(camera);
      if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.15 || Math.abs(v.y) > 1.15) {
        b.el.style.visibility = 'hidden';
        continue;
      }
      const key = b.agents[0];
      const off = stack.get(key) ?? 0;
      stack.set(key, off + b.h + STACK_GAP);
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height - off;
      b.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      b.el.style.visibility = 'visible';
    }
  });
  return null;
}
