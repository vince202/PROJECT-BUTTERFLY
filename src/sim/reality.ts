/**
 * A Reality is one fully simulated day: a seed, a list of interventions, the
 * resulting event log, periodic state snapshots and a per-minute trace used by
 * the renderer. Reality A (original) and Reality B (modified) are both built
 * from the same initial state and seed; only the interventions differ.
 */

import { Engine } from './engine';
import { CausalGraph } from './causal';
import { DAY_END, DAY_START, type AgentId, type EventId, type Intervention, type Minute, type SimEvent, type TraceFrame, type WorldState } from './types';

export interface RealityDef {
  id: string;
  name: string;
  seed: number;
  interventions: Intervention[];
}

export const SNAPSHOT_INTERVAL = 15;

function activityLabel(a: WorldState['agents'][string]): string {
  if (a.asleep) return 'Dort';
  if (a.travel) {
    switch (a.travel.stage) {
      case 'waiting':
        return 'Attend le bus';
      case 'riding':
        return a.activity?.action === 'drive_bus' ? 'Conduit le bus' : 'Dans le bus';
      default:
        return 'En chemin';
    }
  }
  return a.activity?.label ?? 'Réfléchit';
}

export function frameOf(state: WorldState): TraceFrame {
  const agents: TraceFrame['agents'] = {};
  for (const a of Object.values(state.agents)) {
    agents[a.id] = {
      x: Math.round(a.pos.x * 10) / 10,
      y: Math.round(a.pos.y * 10) / 10,
      loc: a.locationId ?? '',
      act: activityLabel(a),
      mood: Math.round(a.emotions.mood * 100) / 100,
      asleep: a.asleep,
      riding: a.travel?.stage === 'riding',
    };
  }
  const buses: TraceFrame['buses'] = {};
  for (const b of Object.values(state.buses)) {
    buses[b.id] = { x: Math.round(b.pos.x * 10) / 10, y: Math.round(b.pos.y * 10) / 10, passengers: b.passengers.length, delay: b.delay, stop: b.currentStopId };
  }
  return { t: state.t, agents, buses, weather: state.weather };
}

export class Reality {
  readonly def: RealityDef;
  readonly engine: Engine;
  readonly snapshots = new Map<Minute, WorldState>();
  readonly trace: TraceFrame[] = [];
  private index = new Map<EventId, SimEvent>();
  private graph: CausalGraph | null = null;

  constructor(def: RealityDef) {
    this.def = def;
    this.engine = new Engine(def.seed, def.interventions);
    this.snapshots.set(DAY_START, structuredClone(this.engine.state));
  }

  get events(): SimEvent[] {
    return this.engine.events;
  }

  get seed(): number {
    return this.def.seed;
  }

  get generatedUntil(): Minute {
    return this.engine.state.t;
  }

  get isComplete(): boolean {
    return this.engine.done;
  }

  /** Advance the simulation up to minute `t` (inclusive of the state at t). */
  advanceTo(t: Minute): void {
    const target = Math.min(DAY_END, t);
    while (this.engine.state.t < target) {
      if (this.trace.length === 0 || this.trace[this.trace.length - 1].t !== this.engine.state.t) this.trace.push(frameOf(this.engine.state));
      this.engine.step();
      const now = this.engine.state.t;
      if (now % SNAPSHOT_INTERVAL === 0 && !this.snapshots.has(now)) this.snapshots.set(now, structuredClone(this.engine.state));
      if (now === DAY_END) this.trace.push(frameOf(this.engine.state));
    }
    this.graph = null;
  }

  /** Simulate the whole day. */
  generate(): this {
    this.advanceTo(DAY_END);
    return this;
  }

  /** Trace frame at an integer minute (clamped to the generated range). */
  frameAt(t: Minute): TraceFrame | undefined {
    const i = Math.max(0, Math.min(this.trace.length - 1, Math.floor(t) - DAY_START));
    return this.trace[i];
  }

  /** Full world state at minute t, rebuilt from the nearest snapshot by deterministic replay. */
  stateAt(t: Minute): WorldState {
    const target = Math.max(DAY_START, Math.min(this.generatedUntil, Math.floor(t)));
    if (target === this.engine.state.t) return structuredClone(this.engine.state);
    let base = DAY_START;
    for (const k of this.snapshots.keys()) if (k <= target && k > base) base = k;
    const snapshot = structuredClone(this.snapshots.get(base)!);
    if (base === target) return snapshot;
    const priorEvents = this.events.filter((e) => e.t < base);
    const scratch = Engine.fromState(snapshot, priorEvents, this.def.interventions);
    while (scratch.state.t < target) scratch.step();
    return scratch.state;
  }

  eventById(id: EventId): SimEvent | undefined {
    if (this.index.size !== this.events.length) {
      this.index = new Map(this.events.map((e) => [e.id, e]));
    }
    return this.index.get(id);
  }

  eventsBetween(t0: Minute, t1: Minute): SimEvent[] {
    return this.events.filter((e) => e.t >= t0 && e.t <= t1);
  }

  eventsOf(agentId: AgentId): SimEvent[] {
    return this.events.filter((e) => e.actors.includes(agentId));
  }

  get causal(): CausalGraph {
    if (!this.graph || this.graph.size !== this.events.length) this.graph = new CausalGraph(this.events);
    return this.graph;
  }

  /** Events worth showing on the timeline. */
  markers(minImportance = 0.5): SimEvent[] {
    return this.events.filter((e) => e.importance >= minImportance && e.type !== 'decision');
  }
}

/** Fork: build a new reality from the same seed with an extra intervention. */
export function forkReality(base: Reality, intervention: Intervention, id: string, name: string): Reality {
  return new Reality({ id, name, seed: base.def.seed, interventions: [...base.def.interventions, intervention] });
}
