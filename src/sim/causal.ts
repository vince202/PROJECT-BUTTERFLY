/**
 * Causal dependency graph over the event log.
 *
 * Edges come exclusively from `event.causes`, which the engine fills only with
 * genuine mechanisms (an arrival caused by a departure, a boarding caused by a
 * bus arrival, a missed meeting caused by the other party's lateness…).
 * Correlations (two things happening at the same time) are never edges.
 */

import type { EventId, SimEvent } from './types';

export class CausalGraph {
  readonly byId = new Map<EventId, SimEvent>();
  readonly children = new Map<EventId, EventId[]>();
  readonly size: number;

  constructor(events: SimEvent[]) {
    this.size = events.length;
    for (const e of events) this.byId.set(e.id, e);
    for (const e of events) {
      for (const c of e.causes) {
        if (!this.children.has(c)) this.children.set(c, []);
        this.children.get(c)!.push(e.id);
      }
    }
  }

  get(id: EventId): SimEvent | undefined {
    return this.byId.get(id);
  }

  directCauses(id: EventId): SimEvent[] {
    const e = this.byId.get(id);
    if (!e) return [];
    return e.causes.map((c) => this.byId.get(c)).filter((x): x is SimEvent => !!x);
  }

  directEffects(id: EventId): SimEvent[] {
    return (this.children.get(id) ?? []).map((c) => this.byId.get(c)).filter((x): x is SimEvent => !!x);
  }

  /** All ancestors with their depth (1 = direct cause). */
  ancestors(id: EventId, maxDepth = Infinity): Map<EventId, number> {
    const out = new Map<EventId, number>();
    const queue: [EventId, number][] = [[id, 0]];
    while (queue.length) {
      const [cur, d] = queue.shift()!;
      if (d >= maxDepth) continue;
      const e = this.byId.get(cur);
      if (!e) continue;
      for (const c of e.causes) {
        if (out.has(c)) continue;
        out.set(c, d + 1);
        queue.push([c, d + 1]);
      }
    }
    return out;
  }

  /** All descendants with their depth (1 = direct effect). */
  descendants(id: EventId, maxDepth = Infinity): Map<EventId, number> {
    const out = new Map<EventId, number>();
    const queue: [EventId, number][] = [[id, 0]];
    while (queue.length) {
      const [cur, d] = queue.shift()!;
      if (d >= maxDepth) continue;
      for (const c of this.children.get(cur) ?? []) {
        if (out.has(c)) continue;
        out.set(c, d + 1);
        queue.push([c, d + 1]);
      }
    }
    return out;
  }

  /** Impact score: number of descendants weighted by their importance. */
  impact(id: EventId): number {
    let s = 0;
    for (const [d] of this.descendants(id)) {
      const e = this.byId.get(d);
      if (e) s += e.importance;
    }
    return s;
  }

  /** Events ranked by downstream impact (ignores the trivial routine events). */
  mostImpactful(n = 10, filter?: (e: SimEvent) => boolean): { event: SimEvent; impact: number; descendants: number }[] {
    const out: { event: SimEvent; impact: number; descendants: number }[] = [];
    for (const e of this.byId.values()) {
      if (filter && !filter(e)) continue;
      if (e.type === 'day_start' || e.type === 'bus_depart' || e.type === 'bus_arrive') continue;
      const desc = this.descendants(e.id);
      let impact = 0;
      for (const d of desc.keys()) impact += this.byId.get(d)?.importance ?? 0;
      out.push({ event: e, impact, descendants: desc.size });
    }
    return out.sort((a, b) => b.impact - a.impact).slice(0, n);
  }

  /** Shortest causal path from `from` (earlier) to `to` (later), or null. */
  chain(from: EventId, to: EventId): SimEvent[] | null {
    const prev = new Map<EventId, EventId>();
    const queue: EventId[] = [from];
    const seen = new Set<EventId>([from]);
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur === to) {
        const path: SimEvent[] = [];
        let c: EventId | undefined = to;
        while (c) {
          const e = this.byId.get(c);
          if (e) path.push(e);
          if (c === from) break;
          c = prev.get(c);
        }
        return path.reverse();
      }
      for (const next of this.children.get(cur) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        prev.set(next, cur);
        queue.push(next);
      }
    }
    return null;
  }

  /** Root causes (ancestors with no causes of their own). */
  roots(id: EventId): SimEvent[] {
    const out: SimEvent[] = [];
    for (const a of this.ancestors(id).keys()) {
      const e = this.byId.get(a);
      if (e && e.causes.length === 0) out.push(e);
    }
    return out.sort((a, b) => a.t - b.t);
  }

  /** Does `id` descend from any event produced by an intervention? */
  descendsFromIntervention(id: EventId, interventionEventIds: Set<EventId>): boolean {
    const e = this.byId.get(id);
    if (!e) return false;
    if (e.interventionId || interventionEventIds.has(e.id)) return true;
    for (const a of this.ancestors(id).keys()) {
      if (interventionEventIds.has(a)) return true;
      const ae = this.byId.get(a);
      if (ae?.type === 'intervention') return true;
    }
    return false;
  }
}
