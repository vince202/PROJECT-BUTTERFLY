/**
 * Conversations for the 3D view: encounters, conversations, arguments and
 * meetings from the reality's event log, indexed by minute. Two people in a
 * conversation face each other for a few minutes and a speech bubble shows.
 */

import * as THREE from 'three';
import type { Reality } from '../sim/reality';

export type TalkKind = 'talk' | 'argue' | 'meet';
export interface Talk {
  partner: string;
  kind: TalkKind;
  /** The first actor carries the bubble. */
  leader: boolean;
}

const TALK_MINUTES = 4;
const cache = new WeakMap<Reality, { n: number; byMinute: Map<number, Map<string, Talk>> }>();

function index(r: Reality): Map<number, Map<string, Talk>> {
  const events = r.events;
  const hit = cache.get(r);
  if (hit && hit.n === events.length) return hit.byMinute;
  const byMinute = new Map<number, Map<string, Talk>>();
  for (const e of events) {
    if (e.type !== 'encounter' && e.type !== 'conversation' && e.type !== 'argument' && e.type !== 'meeting_start') continue;
    if (e.actors.length < 2) continue;
    const kind: TalkKind = e.type === 'argument' ? 'argue' : e.type === 'meeting_start' ? 'meet' : 'talk';
    for (let m = e.t; m < e.t + TALK_MINUTES; m++) {
      if (!byMinute.has(m)) byMinute.set(m, new Map());
      const map = byMinute.get(m)!;
      const [a, b] = e.actors;
      if (!map.has(a)) map.set(a, { partner: b, kind, leader: true });
      for (const o of e.actors.slice(1)) if (!map.has(o)) map.set(o, { partner: a, kind, leader: false });
    }
  }
  cache.set(r, { n: events.length, byMinute });
  return byMinute;
}

/** Who is talking with whom at minute `m`. */
export function conversationsAt(r: Reality, m: number): Map<string, Talk> | undefined {
  return index(r).get(Math.floor(m));
}

/** Find-item events (an inhabitant picks up the lost wallet) at minute `m`. */
export function pickupsAt(r: Reality, m: number): Set<string> | undefined {
  const key = Math.floor(m);
  const ev = r.events.filter((e) => e.t === key && e.type === 'find_item');
  return ev.length ? new Set(ev.flatMap((e) => e.actors)) : undefined;
}

let textures: Record<TalkKind, THREE.CanvasTexture> | null = null;
/** Speech-bubble textures (canvas, no fonts needed). */
export function speechTextures(): Record<TalkKind, THREE.CanvasTexture> {
  if (textures) return textures;
  const make = (kind: TalkKind) => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 112;
    const ctx = c.getContext('2d')!;
    const fill = kind === 'argue' ? '#fff1ec' : '#fffdf8';
    const ink = kind === 'argue' ? '#d0453a' : kind === 'meet' ? '#3d6fa8' : '#3a342c';
    ctx.fillStyle = fill;
    ctx.strokeStyle = 'rgba(40,36,30,0.35)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    const r = 26;
    const x0 = 6, y0 = 6, x1 = 122, y1 = 80;
    ctx.moveTo(x0 + r, y0);
    ctx.arcTo(x1, y0, x1, y1, r);
    ctx.arcTo(x1, y1, x0, y1, r);
    ctx.lineTo(58, y1);
    ctx.lineTo(40, 106);
    ctx.lineTo(42, y1);
    ctx.arcTo(x0, y1, x0, y0, r);
    ctx.arcTo(x0, y0, x1, y0, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = ink;
    if (kind === 'argue') {
      ctx.font = '900 62px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', 50, 45);
      ctx.fillText('?', 80, 45);
    } else {
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(38 + i * 26, 43, 9, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  textures = { talk: make('talk'), argue: make('argue'), meet: make('meet') };
  return textures;
}
