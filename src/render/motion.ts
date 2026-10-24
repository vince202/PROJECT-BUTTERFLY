/**
 * Rendered motion of the inhabitants (visual only: the simulation trace stays
 * the source of truth and is never modified).
 *
 * The trace gives one position per simulated minute. On top of it the view
 * builds, for every walk, a smooth "track":
 *
 * - the street route between consecutive frames (shared.routeBetween) is
 *   concatenated into one polyline for the whole walk;
 * - the polyline is offset to the walker's right-hand sidewalk (mitred joins,
 *   per-inhabitant distance so people do not all walk the same line), with no
 *   offset at the standing spots and doors where the walk starts / ends;
 * - every corner is rounded (quadratic Bézier, a few metres of cut);
 * - the arc length is interpolated in time with a monotone cubic Hermite
 *   spline through the frames, so speed changes are smooth while the walker is
 *   still exactly on schedule at each minute (up to the rounded corners).
 *
 * Buildings: when the trace places an inhabitant at a building (home, office,
 * school, shops, café interior...), the figure walks from its standing spot to
 * the building's door at walking speed, disappears inside, and walks back out
 * to the standing spot just before the trace makes it leave. Park, bus stops,
 * streets and the café terrace keep people outside; café visitors are split
 * deterministically (per inhabitant and visit) between the terrace and inside.
 */

import { LOCATIONS, WALK_SPEED, getCity } from '../sim/city';
import { AGENTS } from '../sim/population';
import type { Reality } from '../sim/reality';
import { DAY_START, type LocationKind, type TraceAgent } from '../sim/types';
import { hashString, routeBetween } from './shared';
import { lotFrames, toWorldL } from './layout';

// ---------------------------------------------------------------------------
// Doors
// ---------------------------------------------------------------------------

export interface Door {
  /** Stable key (location id + door index), used to group indicators. */
  key: string;
  locId: string;
  /** Point just in front of the door, on the forecourt (world x, z). */
  x: number;
  z: number;
  /** Direction the façade faces (three.js rotation.y; the street side). */
  heading: number;
}

const DOORS = new Map<string, Door[]>();
const FALLBACK = new Map<string, Door[]>();
/** Bumped whenever a door is registered (cached tracks are rebuilt). */
let doorVersion = 0;

/**
 * Register the walk-in point of a building door. Called by the town builders
 * (which know the actual façades); locations without a registered door use the
 * façade line of their lot frame.
 */
export function addDoor(locId: string, x: number, z: number, heading: number): void {
  const list = DOORS.get(locId) ?? [];
  if (list.some((d) => Math.abs(d.x - x) < 0.01 && Math.abs(d.z - z) < 0.01)) return;
  list.push({ key: `${locId}#${list.length}`, locId, x, z, heading });
  DOORS.set(locId, list);
  doorVersion++;
}

/** Door used by an inhabitant (by hash) for a location, or null for open-air places. */
export function doorFor(locId: string, agentHash: number): Door | null {
  let list = DOORS.get(locId);
  if (!list || list.length === 0) {
    list = FALLBACK.get(locId);
    if (!list) {
      const f = lotFrames().get(locId);
      list = [];
      if (f) {
        // Same façade line as townBuilder.buildOtherLots (front at stand.w0 - 5).
        const p = toWorldL(f, 0, f.stand.w0 - 5 + 0.7);
        list.push({ key: `${locId}#0`, locId, x: p.x, z: p.z, heading: f.yaw });
      }
      FALLBACK.set(locId, list);
    }
  }
  return list.length ? list[agentHash % list.length] : null;
}

const LOC_KIND = new Map<string, LocationKind>(LOCATIONS.map((l) => [l.id, l.kind]));
const WORKPLACE = new Map(AGENTS.map((a) => [a.id, a.workplaceId ?? '']));

/** Share of café visits spent on the terrace (the rest inside), out of 5. */
const CAFE_TERRACE_OF_5 = 3;

/** Does this visit (agent, location, arrival minute) happen inside the building? */
export function isIndoorVisit(agentId: string, locId: string, arrival: number): boolean {
  const kind = LOC_KIND.get(locId);
  if (!kind || kind === 'park' || kind === 'bus_stop') return false;
  // Café: the staff works inside; customers are split per visit between the terrace and the room.
  if (kind === 'cafe') return WORKPLACE.get(agentId) === locId || hashString(`${agentId}:${arrival}`) % 5 >= CAFE_TERRACE_OF_5;
  return true;
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

/** Lateral offset to the right-hand sidewalk (metres, before per-agent jitter). */
export const SIDEWALK_OFFSET = 8.5;
/** Corner cut of the rounded paths (metres). */
const CORNER_CUT = 4.5;
/** Bézier subdivisions per rounded corner (even: the middle sample is the corner's anchor). */
const CORNER_STEPS = 8;

interface Track {
  /** Time span (simulated minutes) covered by the track. */
  t0: number;
  t1: number;
  /** Knots: time, arc length, tangent (metres per simulated minute). */
  kt: number[];
  ks: number[];
  kv: number[];
  /** Dense rounded path and cumulative lengths. */
  px: number[];
  pz: number[];
  pc: number[];
}

const newTrack = (): Track => ({ t0: 0, t1: -1, kt: [], ks: [], kv: [], px: [], pz: [], pc: [] });

// Scratch buffers for building tracks (reused, no per-frame allocation).
const vx: number[] = [];
const vz: number[] = [];
const vw: number[] = [];
const wx: number[] = [];
const wz: number[] = [];
const knotV: number[] = [];
const cx: number[] = [];
const cz: number[] = [];

function pushV(x: number, z: number, w: number): void {
  const n = vx.length;
  if (n > 0 && Math.abs(vx[n - 1] - x) < 0.05 && Math.abs(vz[n - 1] - z) < 0.05) {
    vw[n - 1] = Math.min(vw[n - 1], w);
    return;
  }
  vx.push(x);
  vz.push(z);
  vw.push(w);
}

function pushP(tr: Track, x: number, z: number): void {
  const n = tr.px.length;
  if (n > 0) {
    const d = Math.hypot(x - tr.px[n - 1], z - tr.pz[n - 1]);
    if (d < 1e-4) return;
    tr.pc.push(tr.pc[n - 1] + d);
  } else tr.pc.push(0);
  tr.px.push(x);
  tr.pz.push(z);
}

const tmpA = { x: 0, y: 0 };
const tmpB = { x: 0, y: 0 };
const rx: number[] = [];
const rz: number[] = [];

/** Does the polyline turn back on itself (more than 90°) at route point j? */
const doublesBack = (i: number, j: number, k: number) => (rx[j] - rx[i]) * (rx[k] - rx[j]) + (rz[j] - rz[i]) * (rz[k] - rz[j]) < 0;

/**
 * Street route between two consecutive frames (interior points pushed). A walk
 * leaving or reaching a location goes through that location's own door node,
 * as in the simulation (City.walkPath); otherwise shared.routeBetween. A first
 * or last node that would make the walker turn back (frame already past the
 * node, a bus stop right next to it, a park spot behind it) is skipped.
 */
function pushRoute(p: TraceAgent, f: TraceAgent): void {
  rx.length = rz.length = 0;
  if (!p.loc && !f.loc) {
    const dx = f.x - p.x;
    const dy = f.y - p.y;
    if (Math.abs(dx) < 0.5 || Math.abs(dy) < 0.5 || Math.hypot(dx, dy) < 12) return;
    const r = routeBetween(p.x, p.y, f.x, f.y);
    for (const q of r.pts) {
      rx.push(q.x);
      rz.push(q.y);
    }
  } else {
    const city = getCity();
    tmpA.x = p.x;
    tmpA.y = p.y;
    tmpB.x = f.x;
    tmpB.y = f.y;
    const A = p.loc ? city.location(p.loc).node : city.nearestNode(tmpA);
    const B = f.loc ? city.location(f.loc).node : city.nearestNode(tmpB);
    rx.push(p.x);
    rz.push(p.y);
    for (const id of city.pathNodes(A, B)) {
      const q = city.nodePos(id);
      rx.push(q.x);
      rz.push(q.y);
    }
    rx.push(f.x);
    rz.push(f.y);
  }
  if (rx.length > 2 && doublesBack(0, 1, 2)) {
    rx.splice(1, 1);
    rz.splice(1, 1);
  }
  const n = rx.length;
  if (n > 2 && doublesBack(n - 3, n - 2, n - 1)) {
    rx.splice(n - 2, 1);
    rz.splice(n - 2, 1);
  }
  for (let i = 1; i < rx.length - 1; i++) pushV(rx[i], rz[i], 1);
}

/** 1 - cos of the turn of the raw polyline at vertex i (0 = straight or end). */
function turnAt(i: number, n: number): number {
  if (i <= 0 || i >= n - 1) return 0;
  const ax = vx[i] - vx[i - 1];
  const az = vz[i] - vz[i - 1];
  const bx = vx[i + 1] - vx[i];
  const bz = vz[i + 1] - vz[i];
  const l = Math.hypot(ax, az) * Math.hypot(bx, bz);
  return l > 1e-9 ? 1 - (ax * bx + az * bz) / l : 0;
}

/** A walk to build: trace frames a..b (each consecutive pair moving), optional door legs. */
interface TripSpec {
  a: number;
  b: number;
  /** Door left at the start (walk door -> standing spot during [a - eStart, a]). */
  startDoor: Door | null;
  eStart: number;
  /** Door entered at the end (walk standing spot -> door during [b, b + eEnd]). */
  endDoor: Door | null;
  eEnd: number;
}

function buildTrack(tr: Track, frames: (m: number) => TraceAgent, spec: TripSpec, lateral: number): void {
  vx.length = vz.length = vw.length = knotV.length = 0;
  tr.kt.length = tr.ks.length = tr.kv.length = 0;
  tr.px.length = tr.pz.length = tr.pc.length = 0;

  // 1. Raw polyline through the frames along the streets; knots at the frames.
  if (spec.startDoor) {
    pushV(spec.startDoor.x, spec.startDoor.z, 0);
    knotV.push(0);
    tr.kt.push(spec.a - spec.eStart);
  }
  for (let m = spec.a; m <= spec.b; m++) {
    const f = frames(m);
    const onStreet = f.loc === '' ? 1 : 0;
    if (m > spec.a) pushRoute(frames(m - 1), f);
    // Interior frames are on the way (full offset); the ends only if they are in the street.
    pushV(f.x, f.y, m === spec.a || m === spec.b ? onStreet : 1);
    knotV.push(vx.length - 1);
    tr.kt.push(m);
  }
  if (spec.endDoor) {
    pushV(spec.endDoor.x, spec.endDoor.z, 0);
    knotV.push(vx.length - 1);
    tr.kt.push(spec.b + spec.eEnd);
  }
  const n = vx.length;

  // 2. Right-hand sidewalk offset with mitred joins.
  wx.length = wz.length = 0;
  for (let i = 0; i < n; i++) {
    let ox = 0;
    let oz = 0;
    if (vw[i] > 0 && n > 1) {
      // Normals (-dz, dx) of the incoming and outgoing segments.
      let n1x = 0, n1z = 0, n2x = 0, n2z = 0;
      if (i > 0) {
        const l = Math.hypot(vx[i] - vx[i - 1], vz[i] - vz[i - 1]) || 1;
        n1x = -(vz[i] - vz[i - 1]) / l;
        n1z = (vx[i] - vx[i - 1]) / l;
      }
      if (i < n - 1) {
        const l = Math.hypot(vx[i + 1] - vx[i], vz[i + 1] - vz[i]) || 1;
        n2x = -(vz[i + 1] - vz[i]) / l;
        n2z = (vx[i + 1] - vx[i]) / l;
      }
      if (i === 0) { n1x = n2x; n1z = n2z; }
      if (i === n - 1) { n2x = n1x; n2z = n1z; }
      const sx = n1x + n2x;
      const sz = n1z + n2z;
      const sl = Math.hypot(sx, sz);
      if (sl > 0.2) {
        const mx = sx / sl;
        const mz = sz / sl;
        const k = lateral * vw[i] / Math.max(0.5, mx * n1x + mz * n1z);
        ox = mx * k;
        oz = mz * k;
      }
    }
    wx.push(vx[i] + ox);
    wz.push(vz[i] + oz);
  }
  // Short segments next to a corner can flip direction once offset: merge their
  // ends (the straighter vertex moves onto the corner; standing spots never move).
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let i = 0; i < n - 1; i++) {
      if ((wx[i + 1] - wx[i]) * (vx[i + 1] - vx[i]) + (wz[i + 1] - wz[i]) * (vz[i + 1] - vz[i]) >= 0) continue;
      const moveI = vw[i] > 0 && (vw[i + 1] === 0 || turnAt(i, n) <= turnAt(i + 1, n));
      if (moveI) {
        wx[i] = wx[i + 1];
        wz[i] = wz[i + 1];
      } else {
        wx[i + 1] = wx[i];
        wz[i + 1] = wz[i];
      }
      changed = true;
    }
    if (!changed) break;
  }

  // 3. Rounded corners on the simplified polyline (duplicates and collinear
  //    points removed, so frames lying near a corner do not shrink its radius).
  cx.length = cz.length = 0;
  for (let i = 0; i < n; i++) {
    const m = cx.length;
    if (m > 0 && Math.abs(cx[m - 1] - wx[i]) < 1e-3 && Math.abs(cz[m - 1] - wz[i]) < 1e-3) continue;
    if (m > 1) {
      const ax = cx[m - 1] - cx[m - 2];
      const az = cz[m - 1] - cz[m - 2];
      const bx = wx[i] - cx[m - 1];
      const bz = wz[i] - cz[m - 1];
      const l = Math.hypot(ax, az) * Math.hypot(bx, bz);
      if (l > 1e-9 && (ax * bx + az * bz) / l > 0.9995) {
        cx[m - 1] = wx[i];
        cz[m - 1] = wz[i];
        continue;
      }
    }
    cx.push(wx[i]);
    cz.push(wz[i]);
  }
  const nc = cx.length;
  for (let i = 0; i < nc; i++) {
    if (i === 0 || i === nc - 1) {
      pushP(tr, cx[i], cz[i]);
      continue;
    }
    const ax = cx[i] - cx[i - 1];
    const az = cz[i] - cz[i - 1];
    const bx = cx[i + 1] - cx[i];
    const bz = cz[i + 1] - cz[i];
    const la = Math.hypot(ax, az);
    const lb = Math.hypot(bx, bz);
    const c = Math.min(CORNER_CUT, la * 0.5, lb * 0.5);
    const p0x = cx[i] - (ax / la) * c;
    const p0z = cz[i] - (az / la) * c;
    const p2x = cx[i] + (bx / lb) * c;
    const p2z = cz[i] + (bz / lb) * c;
    for (let j = 0; j <= CORNER_STEPS; j++) {
      const u = j / CORNER_STEPS;
      const a0 = (1 - u) * (1 - u);
      const a1 = 2 * u * (1 - u);
      const a2 = u * u;
      pushP(tr, a0 * p0x + a1 * cx[i] + a2 * p2x, a0 * p0z + a1 * cz[i] + a2 * p2z);
    }
  }

  // 4. Knot arc lengths and monotone (Fritsch–Carlson style) tangents.
  // Knots: projection of their (offset) frame point onto the rounded path, searched forward.
  const nk = tr.kt.length;
  const np = tr.px.length;
  let seg = 0;
  for (let j = 0; j < nk; j++) {
    const v = knotV[j];
    if (j === 0 && v === 0) {
      tr.ks.push(0);
      continue;
    }
    if (j === nk - 1 && v === n - 1) {
      tr.ks.push(tr.pc[np - 1] ?? 0);
      continue;
    }
    let best = Infinity;
    let bestS = tr.ks.length ? tr.ks[tr.ks.length - 1] : 0;
    let bestSeg = seg;
    for (let q = seg; q < np - 1; q++) {
      const ax = tr.px[q];
      const az = tr.pz[q];
      const dx = tr.px[q + 1] - ax;
      const dz = tr.pz[q + 1] - az;
      const l2 = dx * dx + dz * dz;
      const u = l2 > 0 ? Math.min(1, Math.max(0, ((wx[v] - ax) * dx + (wz[v] - az) * dz) / l2)) : 0;
      const ex = ax + dx * u - wx[v];
      const ez = az + dz * u - wz[v];
      const d = ex * ex + ez * ez;
      if (d < best - 1e-9) {
        best = d;
        bestS = tr.pc[q] + Math.sqrt(l2) * u;
        bestSeg = q;
      }
    }
    seg = bestSeg;
    tr.ks.push(bestS);
  }
  for (let j = 1; j < nk; j++) if (tr.ks[j] < tr.ks[j - 1]) tr.ks[j] = tr.ks[j - 1];
  const secant = (j: number) => {
    const h = tr.kt[j + 1] - tr.kt[j];
    return h > 1e-6 ? (tr.ks[j + 1] - tr.ks[j]) / h : 0;
  };
  for (let j = 0; j < nk; j++) {
    if (nk < 2) tr.kv.push(0);
    else if (j === 0) tr.kv.push(secant(0));
    else if (j === nk - 1) tr.kv.push(secant(nk - 2));
    else {
      const d0 = secant(j - 1);
      const d1 = secant(j);
      tr.kv.push(d0 <= 0 || d1 <= 0 ? 0 : Math.min((d0 + d1) / 2, 3 * Math.min(d0, d1)));
    }
  }
  tr.t0 = tr.kt[0];
  tr.t1 = tr.kt[nk - 1];
}

export interface Pose {
  x: number;
  z: number;
  /** Unit direction of travel (0, 0 when standing). */
  dx: number;
  dz: number;
  /** Walking along a track (street or door leg). */
  moving: boolean;
  /** Inside a building: (x, z) is the door, `door` is set. */
  inside: boolean;
  door: Door | null;
  /** Location of the current trace frame ('' in the street). */
  loc: string;
  /** Speed along the track (metres per simulated minute). */
  speed: number;
}

export function newPose(): Pose {
  return { x: 0, z: 0, dx: 0, dz: 0, moving: false, inside: false, door: null, loc: '', speed: 0 };
}

function sampleTrack(tr: Track, t: number, out: Pose): void {
  const nk = tr.kt.length;
  let j = 0;
  while (j < nk - 2 && t > tr.kt[j + 1]) j++;
  let s: number;
  let v: number;
  const h = nk > 1 ? tr.kt[j + 1] - tr.kt[j] : 0;
  if (h <= 1e-6) {
    s = tr.ks[Math.min(nk - 1, j + (t > tr.kt[j] ? 1 : 0))];
    v = 0;
  } else {
    const u = Math.min(1, Math.max(0, (t - tr.kt[j]) / h));
    const u2 = u * u;
    const u3 = u2 * u;
    const s0 = tr.ks[j];
    const s1 = tr.ks[j + 1];
    const m0 = tr.kv[j] * h;
    const m1 = tr.kv[j + 1] * h;
    s = (2 * u3 - 3 * u2 + 1) * s0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * s1 + (u3 - u2) * m1;
    v = ((6 * u2 - 6 * u) * s0 + (3 * u2 - 4 * u + 1) * m0 + (-6 * u2 + 6 * u) * s1 + (3 * u2 - 2 * u) * m1) / h;
    s = Math.min(Math.max(s, Math.min(s0, s1)), Math.max(s0, s1));
  }
  // Locate s on the dense path (binary search).
  const pc = tr.pc;
  const np = pc.length;
  if (np < 2) {
    out.x = tr.px[0] ?? out.x;
    out.z = tr.pz[0] ?? out.z;
    out.dx = out.dz = 0;
  } else {
    let lo = 0;
    let hi = np - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pc[mid] <= s) lo = mid;
      else hi = mid;
    }
    const seg = pc[hi] - pc[lo];
    const f = seg > 1e-6 ? Math.min(1, Math.max(0, (s - pc[lo]) / seg)) : 0;
    out.x = tr.px[lo] + (tr.px[hi] - tr.px[lo]) * f;
    out.z = tr.pz[lo] + (tr.pz[hi] - tr.pz[lo]) * f;
    const l = seg || 1;
    out.dx = (tr.px[hi] - tr.px[lo]) / l;
    out.dz = (tr.pz[hi] - tr.pz[lo]) / l;
  }
  out.speed = Math.max(0, v);
  out.moving = true;
  out.inside = false;
  out.door = null;
}

/** Does the inhabitant walk between these two consecutive frames? */
function walking(p: TraceAgent, q: TraceAgent): boolean {
  if (p.riding || q.riding) return false;
  const d = Math.hypot(q.x - p.x, q.y - p.y);
  if (d > 250) return false; // teleport (day start, replays): no walk
  return d > 2 || (d > 0.05 && (p.loc === '' || q.loc === ''));
}

interface Stay {
  valid: boolean;
  loc: string;
  from: number;
  to: number;
  indoor: boolean;
  door: Door | null;
  /** Door legs (simulated minutes): walk in after `from`, walk out before `to`. */
  eIn: number;
  eOut: number;
}

/**
 * Per-inhabitant motion state: caches the current track and stay so that a
 * frame normally costs a couple of comparisons and a binary search.
 */
export class AgentMotion {
  readonly id: string;
  readonly hash: number;
  /** Right-hand sidewalk offset of this inhabitant (metres). */
  readonly lateral: number;
  private reality: Reality | null = null;
  private traceLen = 0;
  private version = -1;
  private first = DAY_START;
  private last = DAY_START;
  private readonly track = newTrack();
  private trackOk = false;
  private readonly stay: Stay = { valid: false, loc: '', from: 0, to: -1, indoor: false, door: null, eIn: 0, eOut: 0 };
  private readonly spec: TripSpec = { a: 0, b: 0, startDoor: null, eStart: 0, endDoor: null, eEnd: 0 };
  private readonly frames = (m: number): TraceAgent => this.reality!.frameAt(m)!.agents[this.id];

  constructor(id: string) {
    this.id = id;
    this.hash = hashString(id);
    this.lateral = SIDEWALK_OFFSET + (((this.hash >>> 4) & 0xff) / 255 - 0.5) * 2.4;
  }

  private sync(reality: Reality): void {
    if (reality === this.reality && reality.trace.length === this.traceLen && doorVersion === this.version) return;
    this.reality = reality;
    this.traceLen = reality.trace.length;
    this.version = doorVersion;
    this.first = reality.trace[0]?.t ?? DAY_START;
    this.last = this.first + Math.max(0, this.traceLen - 1);
    this.trackOk = false;
    this.stay.valid = false;
  }

  private at(m: number): TraceAgent | undefined {
    return this.reality!.frameAt(m)?.agents[this.id];
  }

  private walkingAt(m: number): boolean {
    if (m < this.first || m >= this.last) return false;
    const p = this.at(m);
    const q = this.at(m + 1);
    return !!p && !!q && walking(p, q);
  }

  /** Standing run containing minute m (same location, no walking in between). */
  private stayAt(m: number): Stay {
    const st = this.stay;
    if (st.valid && m >= st.from && m <= st.to) return st;
    const f = this.at(m)!;
    let from = m;
    while (from > this.first && !this.walkingAt(from - 1) && this.at(from - 1)?.loc === f.loc) from--;
    let to = m;
    while (to < this.last && !this.walkingAt(to) && this.at(to + 1)?.loc === f.loc) to++;
    st.valid = true;
    st.loc = f.loc;
    st.from = from;
    st.to = to;
    st.indoor = f.loc !== '' && isIndoorVisit(this.id, f.loc, from);
    st.door = st.indoor ? doorFor(f.loc, this.hash) : null;
    if (!st.door) st.indoor = false;
    if (st.indoor && st.door) {
      const walk = Math.hypot(st.door.x - f.x, st.door.z - f.y) / WALK_SPEED;
      const half = (to - from) / 2;
      st.eIn = from <= this.first ? 0 : Math.min(walk, half);
      st.eOut = to >= this.last ? 0 : Math.min(walk, half);
    } else st.eIn = st.eOut = 0;
    return st;
  }

  /** Build the walk containing the moving pair (m, m+1), with its door legs. */
  private buildTrip(m: number): void {
    let a = m;
    let b = m + 1;
    while (a > this.first && this.walkingAt(a - 1)) a--;
    while (b < this.last && this.walkingAt(b)) b++;
    const sp = this.spec;
    sp.a = a;
    sp.b = b;
    const sa = this.at(a)!.loc !== '' ? this.stayAt(a) : null;
    sp.startDoor = sa && sa.indoor && sa.eOut > 0 ? sa.door : null;
    sp.eStart = sp.startDoor ? sa!.eOut : 0;
    const sb = this.at(b)!.loc !== '' ? this.stayAt(b) : null;
    sp.endDoor = sb && sb.indoor && sb.eIn > 0 ? sb.door : null;
    sp.eEnd = sp.endDoor ? sb!.eIn : 0;
    buildTrack(this.track, this.frames, sp, this.lateral);
    this.trackOk = true;
  }

  /** Door leg alone (no walk before / after it in the trace). */
  private buildLeg(m: number, door: Door, t0: number, t1: number, toDoor: boolean): void {
    const sp = this.spec;
    sp.a = sp.b = m;
    sp.startDoor = toDoor ? null : door;
    sp.eStart = toDoor ? 0 : t1 - t0;
    sp.endDoor = toDoor ? door : null;
    sp.eEnd = toDoor ? t1 - t0 : 0;
    buildTrack(this.track, this.frames, sp, this.lateral);
    this.trackOk = true;
  }

  /** Displayed pose at (float) time `time`. Returns false when the inhabitant has no frame. */
  resolve(reality: Reality, time: number, out: Pose): boolean {
    this.sync(reality);
    if (this.traceLen === 0) return false;
    const t = Math.min(this.last, Math.max(this.first, time));
    const m = Math.floor(t);
    const f0 = this.at(m);
    if (!f0) return false;
    out.loc = f0.loc;
    const tr = this.track;
    if (this.trackOk && t >= tr.t0 && t <= tr.t1 && tr.t1 > tr.t0) {
      sampleTrack(tr, t, out);
      return true;
    }
    if (this.walkingAt(m)) {
      this.buildTrip(m);
      sampleTrack(tr, t, out);
      return true;
    }
    const st = this.stayAt(m);
    if (st.indoor && st.door) {
      if (st.eIn > 0 && t < st.from + st.eIn) {
        if (this.walkingAt(st.from - 1)) this.buildTrip(st.from - 1);
        else this.buildLeg(st.from, st.door, st.from, st.from + st.eIn, true);
        sampleTrack(tr, t, out);
        return true;
      }
      if (st.eOut > 0 && t > st.to - st.eOut) {
        if (this.walkingAt(st.to)) this.buildTrip(st.to);
        else this.buildLeg(st.to, st.door, st.to - st.eOut, st.to, false);
        sampleTrack(tr, t, out);
        return true;
      }
      out.x = st.door.x;
      out.z = st.door.z;
      out.dx = out.dz = 0;
      out.moving = false;
      out.inside = true;
      out.door = st.door;
      out.speed = 0;
      return true;
    }
    // Standing outside (terrace, park, bus stop, street): the trace position.
    out.x = f0.x;
    out.z = f0.y;
    out.dx = out.dz = 0;
    out.moving = false;
    out.inside = false;
    out.door = null;
    out.speed = 0;
    return true;
  }
}
