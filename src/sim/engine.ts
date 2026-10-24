/**
 * BUTTERFLY simulation engine.
 *
 * Discrete-time, deterministic simulation: one step per simulated minute from
 * 06:00 to 24:00. The engine owns a plain-data `WorldState`, advances it with
 * `step()`, and appends structured `SimEvent`s with explicit causal links to
 * `events`. Randomness comes from stateless hash streams (see rng.ts), so the
 * same seed and interventions always reproduce the same day, and a change at
 * minute T leaves everything before T untouched.
 */

import { ACTION_LABELS, UtilityPolicy, agentNode, defaultDuration, defaultLocationFor, isInterruptible, isLocationOpen, walkSpeed, type DecisionContext, type DecisionPolicy } from './decision';
import { Timetable, TERMINAL_LAYOVER, stopPath } from './bus';
import { getCity, polylineLength, pointAlong, type City } from './city';
import { AGENTS, BUS_DRIVERS, COMMITMENT_SEEDS, type CommitmentSeed } from './population';
import { Rng, daySeed } from './rng';
import { ARC_STATUS_LABELS, fateOf, arcDeadline, arcOf, arcSeed, deadlineOutcome, detectDilemma, effectiveStakes, evaluateBeat, gossipChance, initialArcs, nextDayArcs, revealChance, secretsToSpread, type Beat } from './drama';
import { fmtTime } from './time';
import { initBuses } from './bus';
import {
  DAY_END,
  DAY_START,
  type ActionType,
  type AgentId,
  type AgentProfile,
  type AgentState,
  type ArcState,
  type BusState,
  type Candidate,
  type Commitment,
  type EventId,
  type EventType,
  type Gravity,
  type Intervention,
  type LocationId,
  type Minute,
  type Plan,
  type SimEvent,
  type StateChange,
  type RandomDraw,
  type TravelStage,
  type WorldState,
} from './types';

export interface EmitSpec {
  type: EventType;
  actors: AgentId[];
  locationId?: LocationId;
  busId?: string;
  label: string;
  description?: string;
  causes?: (EventId | null | undefined)[];
  mechanism?: string;
  effects?: StateChange[];
  randomDraws?: RandomDraw[];
  importance?: number;
  gravity?: Gravity;
  interventionId?: string;
  data?: SimEvent['data'];
  sig?: string;
}

/** Default gravity per event type (0 anecdote, 1 notable, 2 grave, 3 vital); emit() may override. */
const GRAVITY: Partial<Record<EventType, Gravity>> = {
  arc_beat: 1,
  arc_resolved: 2,
  revelation: 1,
  gossip: 1,
  dilemma: 1,
  bus_delay: 1,
  miss_bus: 1,
  meeting_missed: 2,
  argument: 2,
  conversation: 1,
  shop_closed: 1,
  found_closed: 1,
  lose_item: 1,
  find_item: 1,
  return_item: 1,
  weather: 1,
  late: 1,
  intervention: 1,
  invitation: 1,
  new_commitment: 1,
  commitment_cancelled: 1,
  mood_shift: 1,
  accident: 3,
  fire: 3,
  theft: 2,
  breakup: 3,
  dismissal: 3,
  promotion: 2,
  illness: 2,
  incident: 1,
};

const IMPORTANCE: Partial<Record<EventType, number>> = {
  accident: 0.95,
  fire: 0.95,
  theft: 0.8,
  breakup: 0.95,
  dismissal: 0.9,
  promotion: 0.8,
  illness: 0.75,
  incident: 0.65,
  arc_beat: 0.55,
  arc_resolved: 0.85,
  revelation: 0.8,
  gossip: 0.7,
  dilemma: 0.55,
  day_start: 0.2,
  day_end: 0.2,
  wake: 0.05,
  decision: 0.12,
  depart: 0.08,
  arrive: 0.1,
  activity_start: 0.12,
  activity_end: 0.08,
  bus_depart: 0.05,
  bus_arrive: 0.1,
  bus_delay: 0.6,
  board_bus: 0.2,
  alight_bus: 0.15,
  miss_bus: 0.55,
  wait_start: 0.3,
  meeting_start: 0.55,
  meeting_missed: 0.85,
  meeting_end: 0.3,
  encounter: 0.5,
  conversation: 0.45,
  argument: 0.75,
  purchase: 0.15,
  shop_closed: 0.6,
  found_closed: 0.5,
  lose_item: 0.5,
  find_item: 0.7,
  return_item: 0.8,
  weather: 0.6,
  late: 0.6,
  work_start: 0.2,
  work_end: 0.15,
  sleep: 0.1,
  intervention: 1,
  plan_change: 0.5,
  invitation: 0.5,
  new_commitment: 0.5,
  commitment_cancelled: 0.6,
  mood_shift: 0.4,
};

export interface EngineOptions {
  policy?: DecisionPolicy;
  city?: City;
  /** Day index for a fresh start (ignored when initialState is given). */
  day?: number;
  /** Resume from this state instead of building the initial one. */
  initialState?: WorldState;
  /** Events emitted before the resumed state (needed for some look-ups). */
  priorEvents?: SimEvent[];
}

export class Engine {
  readonly city: City;
  readonly timetable: Timetable;
  readonly profiles: Map<AgentId, AgentProfile>;
  readonly rng: Rng;
  readonly policy: DecisionPolicy;
  readonly interventions: Intervention[];
  state: WorldState;
  events: SimEvent[] = [];

  constructor(seed: number, interventions: Intervention[] = [], opts: EngineOptions = {}) {
    this.city = opts.city ?? getCity();
    this.timetable = new Timetable(this.city, this.city.lines);
    this.profiles = new Map(AGENTS.map((a) => [a.id, a]));
    const day = opts.initialState?.day ?? opts.day ?? 1;
    this.rng = new Rng(daySeed(seed, day));
    this.policy = opts.policy ?? new UtilityPolicy();
    this.interventions = [...interventions].sort((a, b) => a.t - b.t);
    this.state = opts.initialState ?? this.createInitialState(seed, day);
    if (opts.priorEvents) this.events = [...opts.priorEvents];
  }

  /**
   * Initial state of the next day, carrying over what persists between days:
   * relationships, important memories, money, a damped mood and lost wallets.
   */
  static nextDayState(prev: WorldState): WorldState {
    const engine = new Engine(prev.seed, [], { day: prev.day + 1 });
    const fresh = engine.state;
    for (const a of Object.values(fresh.agents)) {
      const old = prev.agents[a.id];
      if (!old) continue;
      a.relationships = structuredClone(old.relationships);
      const baseline = new Map(engine.profiles.get(a.id)!.relationships.map((r) => [r.to, r.affinity]));
      for (const r of Object.values(a.relationships)) {
        r.lastInteraction = undefined;
        // Bonds relax a little overnight towards their long-term baseline.
        const base = baseline.get(r.to) ?? 0;
        r.affinity = base + (r.affinity - base) * 0.9;
      }
      const kept = old.memories.filter((m) => m.importance >= 0.5).slice(-12).map((m) => ({ ...m, text: `Hier — ${m.text}`, importance: m.importance * 0.8 }));
      a.memories = kept;
      a.money = Math.max(0, old.money) + 20; // a little daily income
      a.emotions.mood = old.emotions.mood * 0.4;
      a.emotions.stress = old.emotions.stress * 0.5;
      a.groceries = Math.max(0, old.groceries - 1);
      if (!old.inventory.includes('wallet')) {
        a.memories.push({ t: DAY_START, text: 'Hier — Portefeuille perdu (un nouveau a été préparé)', eventId: 'e0', importance: 0.5, valence: -0.3, about: [] });
      }
      const arc = arcOf(prev, a.id);
      if (arc && arc.status !== 'open') {
        const seed = arcSeed(arc.seedId);
        a.memories.push({ t: DAY_START, text: `Hier — « ${seed.title} » : ${ARC_STATUS_LABELS[arc.status]}`, eventId: arc.resolutionEventId ?? 'e0', importance: 0.6, valence: arc.status === 'fulfilled' ? 0.5 : arc.status === 'failed' ? -0.5 : 0.1, about: [] });
      }
    }
    fresh.arcs = nextDayArcs(prev.arcs ?? {});
    fresh.incidents = fateOf(fresh.arcs);
    fresh.incidentEventIds = {};
    return fresh;
  }

  /** Engine resuming from a snapshot (deterministic replay). */
  static fromState(state: WorldState, priorEvents: SimEvent[], interventions: Intervention[], opts: EngineOptions = {}): Engine {
    return new Engine(state.seed, interventions, { ...opts, initialState: state, priorEvents });
  }

  // ---------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------

  createInitialState(seed: number, day = 1): WorldState {
    const city = this.city;
    const rng = new Rng(daySeed(seed, day));
    const agents: Record<AgentId, AgentState> = {};
    for (const p of AGENTS) {
      const startLoc = p.startLocationId ?? p.homeId;
      const slot = Object.values(agents).filter((a) => a.locationId === startLoc).length;
      const relationships: AgentState['relationships'] = {};
      for (const r of p.relationships) relationships[r.to] = { ...r };
      const asleep = p.routine.wake > DAY_START;
      agents[p.id] = {
        id: p.id,
        locationId: startLoc,
        pos: city.insidePos(startLoc, slot),
        needs: {
          hunger: 35 + rng.range(`init:hunger:${p.id}`, 0, 15),
          fatigue: 10 + rng.range(`init:fatigue:${p.id}`, 0, 15),
          social: 30 + rng.range(`init:social:${p.id}`, 0, 25),
          boredom: 20 + rng.range(`init:boredom:${p.id}`, 0, 20),
        },
        emotions: { mood: rng.range(`init:mood:${p.id}`, -0.1, 0.4), stress: rng.range(`init:stress:${p.id}`, 0.05, 0.3) },
        money: p.money,
        relationships,
        memories: [],
        commitments: [],
        plan: null,
        travel: null,
        activity: null,
        lastDecision: null,
        influences: [],
        awake: !asleep,
        asleep,
        inventory: ['wallet'],
        groceries: rng.int(`init:groceries:${p.id}`, 0, 3),
        minutesWorked: 0,
        lastArrivalEventId: null,
        lastChat: {},
        objectivesDone: 0,
        recent: {},
      };
    }
    // Commitments from routines (work / school shifts)
    let seq = 0;
    for (const p of AGENTS) {
      const a = agents[p.id];
      if (p.workplaceId && p.routine.workStart !== undefined && p.routine.workEnd !== undefined) {
        const isSchool = p.workplaceId === 'school' && p.age < 20;
        const driver = BUS_DRIVERS.find((d) => d.agentId === p.id);
        if (!driver) {
          a.commitments.push({
            id: `w_${p.id}`,
            kind: isSchool ? 'school' : 'work',
            label: isSchool ? 'Cours au lycée' : `Travail — ${city.location(p.workplaceId).name}`,
            locationId: p.workplaceId,
            start: p.routine.workStart,
            end: p.routine.workEnd,
            with: [],
            tolerance: 10,
            status: 'pending',
          });
        }
      }
    }
    for (const seed of COMMITMENT_SEEDS) this.addSeedCommitment(agents, seed);
    seq = COMMITMENT_SEEDS.length;

    const locations: WorldState['locations'] = {};
    for (const l of city.locations.values()) {
      locations[l.id] = { id: l.id, items: [], stock: l.stock ?? 0, visitsToday: 0 };
    }
    const buses = initBuses(city, city.lines);
    for (const b of Object.values(buses)) b.dwellRemaining = city.lines[0].firstDeparture - DAY_START + 1;
    for (const d of BUS_DRIVERS) {
      const bus = buses[d.busId];
      const a = agents[d.agentId];
      if (!bus || !a) continue;
      bus.driverId = d.agentId;
      a.locationId = null;
      a.pos = { ...bus.pos };
      a.travel = {
        stage: 'riding',
        destinationId: bus.currentStopId ?? 'station',
        path: [],
        progress: 0,
        pathLength: 0,
        busId: bus.id,
        departEventId: 'e0',
        startedAt: DAY_START,
        expectedArrival: d.shiftEnd,
        delayEventIds: [],
        legEventIds: [],
      };
      a.activity = {
        action: 'drive_bus',
        label: `Conduit le bus ${bus.id}`,
        locationId: 'station',
        since: DAY_START,
        until: d.shiftEnd,
        startEventId: 'e0',
        interruptible: false,
      };
    }

    // Weather: some days a shower comes in the afternoon.
    const weatherSchedule: WorldState['weatherSchedule'] = [];
    if (rng.chance('weather:rain', 0.45)) {
      const start = rng.int('weather:start', 13 * 60, 17 * 60);
      const dur = rng.int('weather:dur', 45, 120);
      weatherSchedule.push({ t: start, condition: 'rain' }, { t: start + dur, condition: 'clear' });
    }

    return {
      t: DAY_START,
      seed,
      day,
      agents,
      buses,
      locations,
      weather: 'clear',
      weatherSchedule,
      eventSeq: 1,
      commitmentSeq: seq,
      appliedInterventions: [],
      interventionEventIds: {},
      arcs: initialArcs(),
      lastLeft: {},
      incidents: fateOf(initialArcs()),
      incidentEventIds: {},
    };
  }

  private addSeedCommitment(agents: Record<AgentId, AgentState>, seed: CommitmentSeed) {
    for (const pid of seed.participants) {
      const a = agents[pid];
      if (!a) continue;
      a.commitments.push({
        id: seed.id,
        kind: seed.kind,
        label: seed.label,
        locationId: seed.locationId,
        start: seed.start,
        end: seed.end,
        with: seed.participants.filter((p) => p !== pid),
        tolerance: seed.tolerance,
        status: 'pending',
      });
    }
  }

  // ---------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------

  emit(spec: EmitSpec): SimEvent {
    const id = `e${this.state.eventSeq++}`;
    const actors = [...spec.actors];
    const causes = Array.from(new Set((spec.causes ?? []).filter((c): c is EventId => !!c)));
    const ev: SimEvent = {
      id,
      t: this.state.t,
      type: spec.type,
      actors,
      locationId: spec.locationId,
      busId: spec.busId,
      label: spec.label,
      description: spec.description,
      causes,
      mechanism: spec.mechanism,
      effects: spec.effects ?? [],
      randomDraws: spec.randomDraws,
      importance: spec.importance ?? IMPORTANCE[spec.type] ?? 0.2,
      gravity: spec.gravity ?? GRAVITY[spec.type] ?? 0,
      interventionId: spec.interventionId,
      data: spec.data,
      signature: `${spec.type}|${[...actors].sort().join('+')}|${spec.locationId ?? spec.busId ?? ''}|${spec.sig ?? ''}`,
    };
    this.events.push(ev);
    return ev;
  }

  private name(id: AgentId): string {
    return this.profiles.get(id)?.firstName ?? id;
  }

  private locName(id: LocationId | null | undefined): string {
    return id ? this.city.location(id).name : 'en chemin';
  }

  private remember(agent: AgentState, ev: SimEvent, text: string, importance: number, valence: number, about: AgentId[] = []) {
    agent.memories.push({ t: this.state.t, text, eventId: ev.id, importance, valence, about });
    if (agent.memories.length > 60) agent.memories.shift();
  }

  private influence(agent: AgentState, ev: SimEvent, reason: string) {
    agent.influences.push({ eventId: ev.id, reason });
    if (agent.influences.length > 8) agent.influences.shift();
  }

  private adjustRelationship(agent: AgentState, other: AgentId, delta: number, kind?: Commitment['kind'] | string): StateChange {
    const r = agent.relationships[other] ?? { to: other, kind: 'acquaintance', affinity: 0 };
    r.affinity = Math.max(-1, Math.min(1, r.affinity + delta));
    r.lastInteraction = this.state.t;
    agent.relationships[other] = r;
    void kind;
    return { kind: 'relationship', agentId: agent.id, otherId: other, delta };
  }

  private mood(agent: AgentState, dMood: number, dStress = 0): StateChange[] {
    agent.emotions.mood = Math.max(-1, Math.min(1, agent.emotions.mood + dMood));
    agent.emotions.stress = Math.max(0, Math.min(1, agent.emotions.stress + dStress));
    const out: StateChange[] = [{ kind: 'emotion', agentId: agent.id, field: 'mood', delta: dMood }];
    if (dStress) out.push({ kind: 'emotion', agentId: agent.id, field: 'stress', delta: dStress });
    return out;
  }

  // ---------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------

  get done(): boolean {
    return this.state.t >= DAY_END;
  }

  /** Advance the world by one simulated minute. Returns the events emitted. */
  step(): SimEvent[] {
    const start = this.events.length;
    const t = this.state.t;
    if (t >= DAY_END) return [];
    if (t === DAY_START) {
      const start = this.emit({ type: 'day_start', actors: [], label: this.state.day > 1 ? `Jour ${this.state.day} — la journée commence (06:00)` : 'La journée commence (06:00)', description: 'Vingt habitants, une journée, une infinité de possibilités.' });
      for (const bus of Object.values(this.state.buses)) {
        if (!bus.driverId) continue;
        const d = this.state.agents[bus.driverId];
        const p = this.profiles.get(bus.driverId)!;
        const ev = this.emit({ type: 'activity_start', actors: [bus.driverId], busId: bus.id, locationId: 'station', label: `${p.firstName} prend son service au volant du bus ${bus.id}`, causes: [start.id], mechanism: 'Début de service du chauffeur', sig: `driver:${bus.id}` });
        if (d.travel) d.travel.departEventId = ev.id;
        if (d.activity) d.activity.startEventId = ev.id;
        d.lastArrivalEventId = ev.id;
      }
    }

    this.applyIncidents();
    this.applyInterventions();
    this.applyWeather();
    this.updateBuses();
    const ids = Object.keys(this.state.agents).sort();
    for (const id of ids) this.updateAgent(this.state.agents[id]);
    this.handleMeetings();
    this.handleEncounters();
    this.updateLocations();
    this.growNeeds();
    this.processDrama(start);

    if (t === DAY_END - 1) this.emit({ type: 'day_end', actors: [], label: 'Minuit — fin de la journée simulée' });
    this.state.t = t + 1;
    return this.events.slice(start);
  }

  runToEnd(): void {
    while (!this.done) this.step();
  }

  // ---------------------------------------------------------------------
  // Interventions
  // ---------------------------------------------------------------------

  private applyInterventions() {
    const t = this.state.t;
    for (const iv of this.interventions) {
      if (iv.t !== t || this.state.appliedInterventions.includes(iv.id)) continue;
      this.state.appliedInterventions.push(iv.id);
      const root = this.emit({ type: 'intervention', actors: 'agentId' in iv ? [iv.agentId] : iv.kind === 'encounter' ? [iv.agentA, iv.agentB] : [], label: `Intervention : ${iv.description}`, interventionId: iv.id, importance: 1, sig: iv.id, locationId: 'locationId' in iv ? iv.locationId : undefined });
      this.state.interventionEventIds[iv.id] = root.id;
      this.applyEffect(iv, root, iv.id);
    }
  }

  /** Coups du sort: the day's built-in obstacles, applied like interventions but without an observer. */
  private applyIncidents() {
    const t = this.state.t;
    for (const iv of this.state.incidents ?? []) {
      if (iv.t !== t || this.state.incidentEventIds[iv.id]) continue;
      const fate = iv as Intervention & { gravity?: Gravity; requires?: 'home' | 'public' };
      const gravity = fate.gravity ?? 1;
      if (fate.requires && 'agentId' in iv) {
        const a = this.state.agents[iv.agentId];
        const home = this.profiles.get(iv.agentId)?.homeId;
        const atHome = !!a && a.locationId === home;
        const inPublic = !!a && !!a.locationId && a.locationId !== home && this.city.location(a.locationId).kind !== 'bus_stop';
        if ((fate.requires === 'home' && !atHome) || (fate.requires === 'public' && !inPublic)) {
          this.state.incidentEventIds[iv.id] = this.emit({ type: 'incident', actors: [iv.agentId], label: `Coup du sort évité : ${iv.description}`, importance: 0.4, gravity: 0, sig: `${iv.id}:dodged`, data: { incidentId: iv.id, dodged: true } }).id;
          continue;
        }
      }
      const root = this.emit({ type: 'incident', actors: 'agentId' in iv ? [iv.agentId] : iv.kind === 'encounter' ? [iv.agentA, iv.agentB] : [], label: `Coup du sort : ${iv.description}`, importance: 0.65, gravity, sig: iv.id, locationId: 'locationId' in iv ? iv.locationId : undefined, data: { incidentId: iv.id } });
      this.state.incidentEventIds[iv.id] = root.id;
      this.applyEffect(iv, root, undefined);
    }
  }

  /** Mechanics shared by interventions and incidents. `tag` marks sub-events as products of an intervention. */
  private applyEffect(iv: Intervention, root: SimEvent, tag: string | undefined) {
    const t = this.state.t;
    {
      switch (iv.kind) {
        case 'bus_delay': {
          const bus = this.state.buses[iv.busId];
          if (!bus) break;
          bus.holdRemaining += iv.minutes;
          const ev = this.emit({ type: 'bus_delay', actors: bus.driverId ? [bus.driverId] : [], busId: bus.id, locationId: bus.currentStopId ?? undefined, label: `Le bus ${bus.id} est retenu ${iv.minutes} min`, description: iv.description, causes: [root.id], mechanism: 'Immobilisation imposée par l’intervention', interventionId: tag, importance: 0.8, data: { minutes: iv.minutes }, sig: `${bus.id}:${t}` });
          bus.delayEventIds.push(ev.id);
          break;
        }
        case 'stay_home': {
          const a = this.state.agents[iv.agentId];
          if (!a) break;
          a.confinedUntil = iv.until;
          const p = this.profiles.get(a.id)!;
          if (a.locationId === p.homeId) {
            if (a.activity && a.activity.locationId !== p.homeId) a.activity = null;
            if (a.plan && a.plan.locationId !== p.homeId) {
              this.emit({ type: 'plan_change', actors: [a.id], locationId: a.locationId, label: `${p.firstName} renonce à sortir`, causes: [root.id], interventionId: tag, mechanism: 'Intervention : rester à la maison' });
              a.plan = null;
            }
            this.influence(a, root, 'Doit rester à la maison');
            if (!a.activity && !a.travel) this.decide(a, root.id);
          } else {
            this.influence(a, root, 'Doit rentrer à la maison');
            if (a.travel && a.travel.stage !== 'riding') this.cancelTravel(a);
            if (a.activity) this.endActivity(a, root.id, 'interrompu par l’intervention');
            else if (!a.travel) this.decide(a, root.id);
          }
          break;
        }
        case 'force_action': {
          const a = this.state.agents[iv.agentId];
          if (!a) break;
          const p = this.profiles.get(a.id)!;
          const loc = iv.locationId ?? defaultLocationFor(iv.action, p, this.city);
          a.forcedPlan = { action: iv.action, locationId: loc, t, interventionEventId: root.id, label: `${ACTION_LABELS[iv.action]} (${this.locName(loc)})` };
          this.influence(a, root, 'Intervention de l’observateur');
          if (a.asleep) {
            this.wakeUp(a, root.id);
          }
          if (a.travel && a.travel.stage !== 'riding') this.cancelTravel(a);
          if (a.activity) this.endActivity(a, root.id, 'interrompu par l’intervention');
          else if (!a.travel) this.decide(a, root.id);
          break;
        }
        case 'agent_delay': {
          const a = this.state.agents[iv.agentId];
          if (!a) break;
          const p = this.profiles.get(a.id)!;
          if (a.travel && a.travel.stage !== 'riding') {
            // Pause the walk (or the wait at the stop): the traveller stands still for the whole delay.
            a.travel.pausedUntil = Math.max(a.travel.pausedUntil ?? 0, t + iv.minutes);
            a.travel.expectedArrival += iv.minutes;
            a.travel.delayEventIds.push(root.id);
            this.emit({ type: 'plan_change', actors: [a.id], label: `${p.firstName} est retardé de ${iv.minutes} min en chemin`, causes: [root.id], interventionId: tag });
          } else if (a.activity) {
            // The agent is held where they are: no leaving, no plan change until the delay has passed.
            a.heldUntil = Math.max(a.heldUntil ?? 0, t + iv.minutes);
            this.emit({ type: 'plan_change', actors: [a.id], locationId: a.locationId ?? undefined, label: `${p.firstName} s’attarde ${iv.minutes} min`, causes: [root.id], interventionId: tag, mechanism: tag ? 'Retard imposé par l’intervention' : 'Retard imposé par les circonstances' });
          } else if (a.locationId) {
            a.plan = null;
            a.heldUntil = Math.max(a.heldUntil ?? 0, t + iv.minutes);
            const ev = this.emit({ type: 'activity_start', actors: [a.id], locationId: a.locationId, label: `${p.firstName} s’attarde ${iv.minutes} min`, causes: [root.id], interventionId: tag, sig: 'delay' });
            a.activity = { action: 'wait', label: `S’attarde (${iv.minutes} min)`, locationId: a.locationId, since: t, until: t + iv.minutes, startEventId: ev.id, interruptible: false };
          }
          break;
        }
        case 'location_hours': {
          const ls = this.state.locations[iv.locationId];
          if (!ls) break;
          if (iv.closes !== undefined) {
            ls.closes = iv.closes;
            ls.closedEarlyAt = iv.closes;
            ls.closedEarlyEventId = root.id;
          }
          if (iv.opens !== undefined) ls.opens = iv.opens;
          break;
        }
        case 'weather': {
          this.state.weatherSchedule = this.state.weatherSchedule.filter((w) => w.t < t);
          this.state.weatherSchedule.push({ t, condition: iv.condition, interventionId: tag });
          if (iv.until !== undefined) this.state.weatherSchedule.push({ t: iv.until, condition: iv.condition === 'rain' ? 'clear' : 'rain', interventionId: tag });
          break;
        }
        case 'cancel_commitment': {
          const a = this.state.agents[iv.agentId];
          if (!a) break;
          const c = iv.commitmentId
            ? a.commitments.find((c) => c.id === iv.commitmentId)
            : a.commitments.filter((c) => c.status === 'pending' && (c.kind === 'meeting' || c.kind === 'appointment') && c.start >= t).sort((x, y) => x.start - y.start)[0];
          if (!c) break;
          c.status = 'cancelled';
          const p = this.profiles.get(a.id)!;
          this.emit({ type: 'commitment_cancelled', actors: [a.id], locationId: c.locationId, label: `${p.firstName} renonce à « ${c.label} »`, causes: [root.id], interventionId: tag, mechanism: 'Intervention : l’engagement est abandonné sans prévenir', data: { commitmentId: c.id }, sig: c.id });
          this.influence(a, root, `Renonce à ${c.label}`);
          if (a.plan?.commitmentId === c.id) {
            if (a.travel && a.travel.stage !== 'riding') this.cancelTravel(a);
            if (a.activity) this.endActivity(a, root.id, 'engagement annulé');
            else if (!a.travel) this.decide(a, root.id);
          }
          break;
        }
        case 'encounter': {
          for (const id of [iv.agentA, iv.agentB]) {
            const a = this.state.agents[id];
            if (!a) continue;
            const other = id === iv.agentA ? iv.agentB : iv.agentA;
            a.forcedPlan = { action: 'visit', locationId: iv.locationId, t, interventionEventId: root.id, label: `Rejoindre ${this.name(other)} (${this.locName(iv.locationId)})`, withAgent: other };
            this.influence(a, root, 'Intervention de l’observateur');
            if (a.asleep) this.wakeUp(a, root.id);
            if (a.travel && a.travel.stage !== 'riding') this.cancelTravel(a);
            if (a.activity) this.endActivity(a, root.id, 'interrompu par l’intervention');
            else if (!a.travel) this.decide(a, root.id);
          }
          break;
        }
        case 'lose_item': {
          const a = this.state.agents[iv.agentId];
          if (!a || !a.inventory.includes('wallet')) break;
          const loc = a.locationId;
          const def = loc ? this.city.location(loc) : null;
          if (!loc || !def || def.kind === 'home' || def.kind === 'bus_stop') {
            this.emit({ type: 'plan_change', actors: [a.id], label: `${this.name(a.id)} garde son portefeuille sur lui : il n’était pas dans un lieu public`, causes: [root.id], interventionId: tag, importance: 0.2, sig: 'keep_wallet' });
            break;
          }
          a.inventory = a.inventory.filter((i) => i !== 'wallet');
          const lose = this.emit({ type: 'lose_item', actors: [a.id], locationId: loc, label: `${this.name(a.id)} oublie son portefeuille à ${def.name}`, causes: [root.id], mechanism: 'Moment de distraction', interventionId: tag, effects: [{ kind: 'inventory', agentId: a.id, value: 'wallet', delta: -1 }], sig: loc });
          this.state.locations[loc].items.push({ item: 'wallet', ownerId: a.id, eventId: lose.id });
          this.addWalletErrand(a, lose.id);
          break;
        }
        case 'accident': {
          const a = this.state.agents[iv.agentId];
          if (!a) break;
          const where = a.locationId ? this.locName(a.locationId) : 'dans la rue';
          if (a.travel && a.travel.stage !== 'riding') this.cancelTravel(a);
          if (a.activity) this.endActivity(a, root.id, 'accident');
          const ev = this.emit({ type: 'accident', actors: [a.id], locationId: 'clinic', label: `${this.name(a.id)} a un accident ${a.locationId ? `à ${where}` : where} et est conduit à la clinique`, causes: [root.id], mechanism: tag ? 'Accident imposé par l’intervention' : 'Accident', interventionId: tag, effects: this.mood(a, -0.4, 0.4), sig: a.id });
          this.moveTo(a, 'clinic');
          a.heldUntil = t + iv.minutes;
          a.needs.fatigue = Math.min(100, a.needs.fatigue + 25);
          a.activity = { action: 'wait', label: 'Soigné à la clinique', locationId: 'clinic', since: t, until: t + iv.minutes, startEventId: ev.id, interruptible: false };
          a.plan = null;
          this.remember(a, ev, `Accident : ${iv.minutes} min à la clinique`, 0.9, -0.8);
          this.notifyClose(a.id, ev, `${this.name(a.id)} a eu un accident`, -0.25, 0.25);
          break;
        }
        case 'fire': {
          const ls = this.state.locations[iv.locationId];
          if (!ls) break;
          const def = this.city.location(iv.locationId);
          const ev = this.emit({ type: 'fire', actors: [], locationId: iv.locationId, label: `Un incendie se déclare à ${def.name} : le lieu est évacué et fermé pour la journée`, causes: [root.id], mechanism: tag ? 'Incendie imposé par l’intervention' : 'Incendie', interventionId: tag, sig: iv.locationId });
          ls.closedEarlyAt = t;
          ls.closedEarlyEventId = ev.id;
          ls.closes = t;
          for (const o of Object.values(this.state.agents)) {
            if (o.locationId !== iv.locationId || o.asleep) continue;
            ev.effects.push(...this.mood(o, -0.2, 0.35));
            this.remember(o, ev, `Incendie à ${def.name} : évacuation dans la panique`, 0.85, -0.7);
            this.influence(o, ev, `Incendie à ${def.name}`);
            o.heldUntil = undefined;
            const c = o.activity?.commitmentId ? o.commitments.find((x) => x.id === o.activity!.commitmentId) : undefined;
            if (c && (c.kind === 'work' || c.kind === 'shift' || c.kind === 'school') && c.status === 'ongoing') c.status = 'done';
            if (o.activity) this.endActivity(o, ev.id, 'évacuation');
            else if (!o.travel) this.decide(o, ev.id);
          }
          for (const o of Object.values(this.state.agents)) {
            for (const c of o.commitments) if (c.locationId === iv.locationId && c.status === 'pending' && c.start >= t) this.failCommitment(o, c.id, ev.id, 'le lieu a brûlé');
          }
          break;
        }
        case 'theft': {
          const a = this.state.agents[iv.agentId];
          if (!a || !a.inventory.includes('wallet')) break;
          const taken = Math.min(a.money, 40);
          a.inventory = a.inventory.filter((i) => i !== 'wallet');
          a.money -= taken;
          const ev = this.emit({ type: 'theft', actors: [a.id], locationId: a.locationId ?? undefined, label: `${this.name(a.id)} se fait voler son portefeuille${a.locationId ? ` à ${this.locName(a.locationId)}` : ' dans la rue'}`, causes: [root.id], mechanism: tag ? 'Vol imposé par l’intervention' : 'Vol', interventionId: tag, effects: [{ kind: 'money', agentId: a.id, delta: -taken }, { kind: 'inventory', agentId: a.id, value: 'wallet', delta: -1 }, ...this.mood(a, -0.3, 0.3)], sig: a.id });
          this.remember(a, ev, `Portefeuille volé (${taken} €)`, 0.85, -0.8);
          this.influence(a, ev, 'Portefeuille volé');
          const c: Commitment = { id: `theft_${a.id}`, kind: 'errand', label: 'Déclarer le vol à la mairie', locationId: 'townhall', start: t + 20, end: Math.min(DAY_END - 1, t + 150), with: [], tolerance: 120, status: 'pending' };
          a.commitments.push(c);
          this.emit({ type: 'new_commitment', actors: [a.id], locationId: 'townhall', label: `${this.name(a.id)} veut déclarer le vol à la mairie`, causes: [ev.id], data: { commitmentId: c.id }, sig: c.id });
          break;
        }
        case 'breakup': {
          const a = this.state.agents[iv.agentA];
          const b = this.state.agents[iv.agentB];
          if (!a || !b) break;
          const effects: StateChange[] = [];
          for (const [x, y] of [[a, b], [b, a]] as [AgentState, AgentState][]) {
            const r = x.relationships[y.id] ?? { to: y.id, kind: 'acquaintance', affinity: 0 };
            r.kind = 'ex';
            r.affinity = Math.max(-1, r.affinity - 0.6);
            r.lastInteraction = t;
            x.relationships[y.id] = r;
            effects.push({ kind: 'relationship', agentId: x.id, otherId: y.id, delta: -0.6 }, ...this.mood(x, -0.5, 0.35));
            for (const c of x.commitments) if (c.status === 'pending' && c.with.includes(y.id)) c.status = 'cancelled';
          }
          const ev = this.emit({ type: 'breakup', actors: [a.id, b.id], locationId: a.locationId ?? undefined, label: `${this.name(a.id)} et ${this.name(b.id)} se séparent`, causes: [root.id], mechanism: tag ? 'Rupture imposée par l’intervention' : 'Rupture', interventionId: tag, effects, sig: `${a.id}+${b.id}` });
          this.remember(a, ev, `Rupture avec ${this.name(b.id)}`, 0.95, -0.9, [b.id]);
          this.remember(b, ev, `Rupture avec ${this.name(a.id)}`, 0.95, -0.9, [a.id]);
          this.influence(a, ev, 'Rupture');
          this.influence(b, ev, 'Rupture');
          break;
        }
        case 'dismissal': {
          const a = this.state.agents[iv.agentId];
          if (!a) break;
          const p = this.profiles.get(a.id)!;
          const work = a.commitments.find((c) => (c.kind === 'work' || c.kind === 'shift') && c.status !== 'done' && c.status !== 'missed');
          const ev = this.emit({ type: 'dismissal', actors: [a.id], locationId: p.workplaceId, label: `${p.firstName} est renvoyé${p.workplaceId ? ` de ${this.locName(p.workplaceId)}` : ''}`, causes: [root.id], mechanism: tag ? 'Renvoi imposé par l’intervention' : 'Renvoi', interventionId: tag, effects: this.mood(a, -0.5, 0.45), sig: a.id });
          if (work) work.status = 'cancelled';
          for (const [other, r] of Object.entries(a.relationships)) if (r.kind === 'boss') ev.effects.push(this.adjustRelationship(a, other, -0.35));
          this.remember(a, ev, 'Renvoyé. Que faire maintenant ?', 0.95, -0.9);
          this.influence(a, ev, 'Renvoyé');
          if (a.activity && (a.activity.action === 'work' || a.activity.action === 'school')) this.endActivity(a, ev.id, 'renvoyé');
          this.notifyClose(a.id, ev, `${p.firstName} a été renvoyé`, -0.1, 0.1);
          break;
        }
        case 'promotion': {
          const a = this.state.agents[iv.agentId];
          if (!a) break;
          const p = this.profiles.get(a.id)!;
          a.money += 100;
          const ev = this.emit({ type: 'promotion', actors: [a.id], locationId: a.locationId ?? undefined, label: `${p.firstName} reçoit une promotion`, causes: [root.id], mechanism: tag ? 'Promotion imposée par l’intervention' : 'Promotion', interventionId: tag, effects: [{ kind: 'money', agentId: a.id, delta: 100 }, ...this.mood(a, 0.45, -0.2)], sig: a.id });
          for (const [other, r] of Object.entries(a.relationships)) if (r.kind === 'boss') ev.effects.push(this.adjustRelationship(a, other, 0.2));
          this.remember(a, ev, 'Promu ! Une grande nouvelle', 0.9, 0.9);
          this.influence(a, ev, 'Promotion');
          this.notifyClose(a.id, ev, `${p.firstName} a été promu`, 0.1, -0.05);
          break;
        }
        case 'illness': {
          const a = this.state.agents[iv.agentId];
          if (!a) break;
          const p = this.profiles.get(a.id)!;
          const ev = this.emit({ type: 'illness', actors: [a.id], locationId: a.locationId ?? undefined, label: `${p.firstName} fait un malaise et doit rentrer se reposer`, causes: [root.id], mechanism: tag ? 'Malaise imposé par l’intervention' : 'Malaise (épuisement)', interventionId: tag, effects: this.mood(a, -0.25, 0.2), sig: a.id });
          a.needs.fatigue = Math.min(100, a.needs.fatigue + 40);
          a.confinedUntil = Math.max(a.confinedUntil ?? 0, t + iv.minutes);
          this.remember(a, ev, 'Malaise : obligé de rentrer', 0.8, -0.6);
          this.influence(a, ev, 'Malaise');
          if (a.travel && a.travel.stage !== 'riding') this.cancelTravel(a);
          if (a.activity) this.endActivity(a, ev.id, 'malaise');
          else if (!a.travel) this.decide(a, ev.id);
          break;
        }
      }
    }
  }

  /** Put an agent at a location immediately (ambulance, evacuation): used by incidents only. */
  private moveTo(a: AgentState, loc: LocationId) {
    if (a.travel) a.travel = null;
    a.locationId = loc;
    a.pos = this.city.insidePos(loc, this.slotFor(loc) - 1);
    this.state.locations[loc].visitsToday += 1;
  }

  /** Family, partners and close friends learn big news at once (phone call), with a memory and a mood shift. */
  private notifyClose(agentId: AgentId, ev: SimEvent, text: string, dMood: number, dStress: number) {
    for (const o of Object.values(this.state.agents)) {
      if (o.id === agentId) continue;
      const r = o.relationships[agentId];
      if (!r || !(r.kind === 'family' || r.kind === 'partner' || (r.kind === 'friend' && r.affinity >= 0.6))) continue;
      ev.effects.push(...this.mood(o, dMood, dStress));
      this.remember(o, ev, text, 0.75, dMood < 0 ? -0.6 : 0.5, [agentId]);
      this.influence(o, ev, text);
    }
  }

  private applyWeather() {
    const t = this.state.t;
    for (const w of this.state.weatherSchedule) {
      if (w.t !== t || w.condition === this.state.weather) continue;
      this.state.weather = w.condition;
      const root = w.interventionId ? this.state.interventionEventIds[w.interventionId] : undefined;
      const ev = this.emit({
        type: 'weather',
        actors: [],
        label: w.condition === 'rain' ? 'La pluie commence à tomber' : 'La pluie cesse',
        causes: root ? [root] : [],
        interventionId: w.interventionId,
        mechanism: root ? 'Météo imposée par l’intervention' : 'Météo du jour (graine aléatoire)',
        randomDraws: root ? undefined : [{ key: 'weather:rain', value: this.rng.next('weather:rain') }],
        effects: [{ kind: 'weather', value: w.condition }],
        sig: w.condition,
      });
      // People in the park leave when it rains.
      if (w.condition === 'rain') {
        for (const a of Object.values(this.state.agents)) {
          if (a.locationId === 'park' && a.activity && isInterruptible(a.activity.action)) {
            this.influence(a, ev, 'La pluie a commencé');
            this.endActivity(a, ev.id, 'chassé par la pluie');
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------
  // Buses
  // ---------------------------------------------------------------------

  private updateBuses() {
    const t = this.state.t;
    for (const bus of Object.values(this.state.buses)) {
      if (!bus.inService) continue;
      const line = this.city.lines.find((l) => l.id === bus.lineId)!;
      const entries = this.timetable.busEntries(bus.id);
      if (bus.holdRemaining > 0) {
        bus.holdRemaining -= 1;
        bus.delay += 1;
        this.syncRiders(bus);
        continue;
      }
      if (bus.currentStopId !== null) {
        // Dwelling at a stop
        bus.dwellRemaining -= 1;
        if (bus.dwellRemaining > 0) {
          this.syncRiders(bus);
          continue;
        }
        if (bus.scheduleIndex >= entries.length - 1) {
          bus.inService = false;
          continue;
        }
        const entry = entries[bus.scheduleIndex];
        const nextEntry = entries[bus.scheduleIndex + 1];
        const delay = t - entry.depart;
        bus.delay = delay;
        const isTerminal = entry.stopIndex === 0 || entry.stopIndex === line.stops.length - 1;
        // A departure exactly on schedule from a terminal is dictated by the timetable, not by the previous trip.
        const scheduleRooted = isTerminal && delay <= 0;
        if (scheduleRooted) bus.delayEventIds = [];
        const ev = this.emit({
          type: 'bus_depart',
          actors: bus.driverId ? [bus.driverId] : [],
          busId: bus.id,
          locationId: bus.currentStopId,
          label: `Le bus ${bus.id} quitte ${this.locName(bus.currentStopId)}${delay > 0 ? ` (${delay} min de retard)` : ''}`,
          causes: scheduleRooted ? [] : [bus.lastEventId, ...(delay > 0 ? bus.delayEventIds : [])],
          mechanism: delay > 0 ? 'Départ retardé par les incidents précédents' : 'Horaire de la ligne',
          data: { delay, scheduled: entry.depart, trip: bus.trip },
          sig: `${bus.id}:${bus.scheduleIndex}`,
          importance: delay > 0 ? 0.3 : 0.05,
        });
        bus.lastEventId = ev.id;
        bus.path = stopPath(this.city, bus.currentStopId, nextEntry.stopId);
        bus.pathLength = polylineLength(bus.path);
        bus.progress = 0;
        bus.currentStopId = null;
        bus.scheduleIndex += 1;
        this.syncRiders(bus);
        continue;
      }
      // Moving
      bus.progress += line.speed;
      if (bus.progress >= bus.pathLength) {
        const entry = entries[bus.scheduleIndex];
        bus.pos = { ...this.city.doorPos(entry.stopId) };
        bus.currentStopId = entry.stopId;
        bus.nextStopIndex = entry.stopIndex;
        const delay = Math.max(0, t - entry.arrive);
        bus.delay = delay;
        const terminal = entry.stopIndex === 0 || entry.stopIndex === line.stops.length - 1;
        if (terminal) {
          bus.trip = entry.trip;
          bus.direction = entry.direction;
        }
        const ev = this.emit({
          type: 'bus_arrive',
          actors: bus.driverId ? [bus.driverId] : [],
          busId: bus.id,
          locationId: entry.stopId,
          label: `Le bus ${bus.id} arrive à ${this.locName(entry.stopId)}${delay > 0 ? ` avec ${delay} min de retard` : ''}`,
          causes: [bus.lastEventId, ...(delay > 0 ? bus.delayEventIds : [])],
          mechanism: delay > 0 ? 'Arrivée décalée par les retards accumulés' : 'Trajet nominal',
          data: { delay, scheduled: entry.arrive, trip: bus.trip, direction: bus.direction },
          sig: `${bus.id}:${bus.scheduleIndex}`,
          importance: delay > 0 ? 0.35 : 0.1,
        });
        bus.lastEventId = ev.id;
        // Small seeded incident (a stroller, a red light…)
        let extraDwell = 0;
        const incidentKey = `bus:${bus.id}:${bus.scheduleIndex}`;
        if (!terminal && this.rng.chance(incidentKey, 0.05)) {
          extraDwell = 1;
          const d = this.emit({
            type: 'bus_delay',
            actors: bus.driverId ? [bus.driverId] : [],
            busId: bus.id,
            locationId: entry.stopId,
            label: `Petit incident à ${this.locName(entry.stopId)} : le bus ${bus.id} repart avec 1 min de retard`,
            causes: [ev.id],
            mechanism: 'Aléa du trafic (graine aléatoire)',
            randomDraws: [{ key: incidentKey, value: this.rng.next(incidentKey) }],
            data: { minutes: 1 },
            importance: 0.3,
            sig: `${bus.id}:${bus.scheduleIndex}`,
          });
          bus.delayEventIds.push(d.id);
        }
        // Scheduled departure: dwell, plus make up time at terminals (a late bus turns around faster).
        const baseDwell = terminal ? line.dwell + extraDwell : line.dwell + extraDwell;
        bus.dwellRemaining = Math.max(baseDwell, entry.depart - t);
        bus.scheduledDeparture = entry.depart;
        void TERMINAL_LAYOVER;
        if (terminal && t + baseDwell <= entry.depart) bus.delayEventIds = [];
        this.handleAlighting(bus, ev.id);
        this.handleBoarding(bus, ev.id);
        this.syncRiders(bus);
      } else {
        bus.pos = pointAlong(bus.path, bus.progress);
        this.syncRiders(bus);
      }
    }
  }

  private syncRiders(bus: BusState) {
    for (const id of bus.passengers) {
      const a = this.state.agents[id];
      if (a) a.pos = { ...bus.pos };
    }
    if (bus.driverId) {
      const d = this.state.agents[bus.driverId];
      if (d && d.travel?.stage === 'riding') d.pos = { ...bus.pos };
    }
  }

  private handleAlighting(bus: BusState, arriveEventId: EventId) {
    const t = this.state.t;
    const stop = bus.currentStopId!;
    for (const id of [...bus.passengers]) {
      const a = this.state.agents[id];
      if (!a?.travel || a.travel.alightStopId !== stop) continue;
      bus.passengers = bus.passengers.filter((p) => p !== id);
      const p = this.profiles.get(id)!;
      const ev = this.emit({
        type: 'alight_bus',
        actors: [id],
        busId: bus.id,
        locationId: stop,
        label: `${p.firstName} descend du bus à ${this.locName(stop)}`,
        causes: [arriveEventId, ...a.travel.legEventIds],
        mechanism: 'Le bus atteint l’arrêt de descente',
        sig: `${stop}:${a.travel.destinationId}`,
      });
      a.travel.legEventIds.push(ev.id);
      if (bus.delay > 0) a.travel.delayEventIds.push(...bus.delayEventIds.filter((d) => !a.travel!.delayEventIds.includes(d)));
      a.travel.stage = 'from_stop';
      a.travel.busId = undefined;
      a.pos = { ...this.city.doorPos(stop) };
      a.travel.path = this.city.walkPath(a.pos, this.city.location(stop).node, a.travel.destinationId, this.slotFor(a.travel.destinationId));
      a.travel.pathLength = polylineLength(a.travel.path);
      a.travel.progress = 0;
      if (a.travel.pathLength <= walkSpeed(this.state)) this.arriveAtDestination(a);
    }
    // Driver end of shift at a terminal
    if (bus.driverId) {
      const d = this.state.agents[bus.driverId];
      const shift = BUS_DRIVERS.find((s) => s.agentId === bus.driverId)!;
      const line = this.city.lines.find((l) => l.id === bus.lineId)!;
      const terminal = bus.nextStopIndex === 0 || bus.nextStopIndex === line.stops.length - 1;
      if (d && d.travel?.stage === 'riding' && t >= shift.shiftEnd && terminal) {
        const p = this.profiles.get(d.id)!;
        const ev = this.emit({ type: 'work_end', actors: [d.id], busId: bus.id, locationId: stop, label: `${p.firstName} termine son service et rend le bus`, causes: [arriveEventId], mechanism: 'Fin de service du chauffeur', importance: 0.3 });
        bus.driverId = undefined;
        d.travel = null;
        d.activity = null;
        d.locationId = stop;
        d.pos = this.city.insidePos(stop, this.slotFor(stop));
        d.lastArrivalEventId = ev.id;
        d.objectivesDone += 1;
        this.remember(d, ev, `Service terminé à ${fmtTime(t)}${bus.delay > 0 ? ` avec ${bus.delay} min de retard` : ', à l’heure'}`, 0.3, bus.delay > 0 ? -0.2 : 0.2);
        this.decide(d, ev.id);
      }
    }
  }

  private handleBoarding(bus: BusState, arriveEventId: EventId) {
    const stop = bus.currentStopId!;
    const line = this.city.lines.find((l) => l.id === bus.lineId)!;
    for (const a of Object.values(this.state.agents)) {
      if (!a.travel || a.travel.stage !== 'waiting' || a.travel.boardStopId !== stop) continue;
      const bi = line.stops.indexOf(stop);
      const ai = line.stops.indexOf(a.travel.alightStopId!);
      const wanted: 1 | -1 = ai > bi ? 1 : -1;
      if (bus.direction !== wanted) continue;
      if (bus.passengers.length >= line.capacity) continue;
      const p = this.profiles.get(a.id)!;
      const ev = this.emit({
        type: 'board_bus',
        actors: [a.id],
        busId: bus.id,
        locationId: stop,
        label: `${p.firstName} monte dans le bus ${bus.id} à ${this.locName(stop)}`,
        causes: [arriveEventId, a.travel.departEventId],
        mechanism: 'Le bus se présente à l’arrêt où l’habitant attend',
        data: { waited: this.state.t - (a.travel.waitingSince ?? this.state.t), busDelay: bus.delay },
        sig: `${stop}:${a.travel.alightStopId}`,
      });
      bus.passengers.push(a.id);
      a.travel.stage = 'riding';
      a.travel.busId = bus.id;
      a.travel.legEventIds.push(ev.id);
      if (bus.delay > 0) a.travel.delayEventIds.push(...bus.delayEventIds);
      a.locationId = null;
      a.pos = { ...bus.pos };
    }
  }

  // ---------------------------------------------------------------------
  // Agents
  // ---------------------------------------------------------------------

  private slotFor(locationId: LocationId): number {
    let n = 0;
    for (const a of Object.values(this.state.agents)) if (a.locationId === locationId) n++;
    return n;
  }

  private updateAgent(a: AgentState) {
    const t = this.state.t;
    const p = this.profiles.get(a.id)!;
    if (a.asleep) {
      if (t >= p.routine.wake && !(a.activity?.action === 'sleep' && t > p.routine.wake)) this.wakeUp(a, null);
      return;
    }
    if (a.travel) {
      this.advanceTravel(a);
      return;
    }
    if (a.heldUntil !== undefined && t < a.heldUntil) {
      // Held in place: the current activity continues (or turns into waiting) and nothing interrupts it.
      if (a.activity) {
        this.applyActivityEffects(a);
        if (t >= a.activity.until && a.activity.action !== 'wait') {
          const prev = a.activity;
          this.endActivityQuietly(a, prev);
        }
      }
      if (!a.activity && a.locationId) {
        const ev = this.emit({ type: 'activity_start', actors: [a.id], locationId: a.locationId, label: `${p.firstName} s’attarde encore`, sig: 'delay:hold', importance: 0.05 });
        a.activity = { action: 'wait', label: 'S’attarde', locationId: a.locationId, since: t, until: a.heldUntil, startEventId: ev.id, interruptible: false };
      }
      return;
    }
    if (a.heldUntil !== undefined && t >= a.heldUntil) a.heldUntil = undefined;
    if (a.activity) {
      this.applyActivityEffects(a);
      if (t >= a.activity.until) {
        // Meetings are closed by handleMeetings() so that every participant ends together.
        const c = a.activity.commitmentId ? a.commitments.find((x) => x.id === a.activity!.commitmentId) : undefined;
        const meetingLike = a.activity.action === 'commitment' && c && (c.kind === 'meeting' || c.kind === 'appointment');
        if (!meetingLike) this.endActivity(a, null, 'terminé');
        return;
      }
      // A meeting, appointment or errand that is due interrupts work.
      if ((a.activity.action === 'work' || a.activity.action === 'school') && this.hasDueCommitment(a, p)) {
        this.reevaluate(a);
        return;
      }
      // Lunch break from work
      if ((a.activity.action === 'work' || a.activity.action === 'school') && p.routine.lunch !== undefined && t >= p.routine.lunch - 10 && t <= p.routine.lunch + 40 && a.needs.hunger >= 40 && !a.inventory.includes('lunch_taken') && (t - p.routine.lunch) % 5 === 0) {
        a.inventory.push('lunch_taken');
        this.reevaluate(a);
        return;
      }
      // Periodic re-evaluation of interruptible activities
      if (a.activity.interruptible && t > a.activity.since && (t - a.activity.since) % 10 === 0) {
        this.reevaluate(a);
      }
      return;
    }
    this.decide(a, a.lastArrivalEventId);
  }

  private hasDueCommitment(a: AgentState, p: AgentProfile): boolean {
    const t = this.state.t;
    for (const c of a.commitments) {
      if (c.status !== 'pending' || c.kind === 'work' || c.kind === 'school' || c.kind === 'shift') continue;
      if (c.start - t > 45 || c.start - t < -c.tolerance) continue;
      if (c.id === a.activity?.commitmentId) continue;
      if (c.locationId === a.locationId) continue; // handled by the meeting logic on the spot
      const dist = this.city.nodeDistance(agentNode(a, this.city), this.city.location(c.locationId).node);
      const travel = Math.ceil(dist / walkSpeed(this.state)) + 1;
      const margin = 2 + 9 * p.traits.punctuality;
      if (c.start - t - travel <= margin) return true;
    }
    return false;
  }

  private wakeUp(a: AgentState, cause: EventId | null) {
    const p = this.profiles.get(a.id)!;
    a.asleep = false;
    a.awake = true;
    const ev = this.emit({ type: 'wake', actors: [a.id], locationId: a.locationId ?? undefined, label: `${p.firstName} se réveille`, causes: cause ? [cause] : [], mechanism: cause ? 'Réveillé par l’intervention' : 'Routine personnelle' });
    const home = a.locationId === p.homeId;
    const until = this.state.t + (home ? defaultDuration('morning_routine') : 5);
    const start = this.emit({ type: 'activity_start', actors: [a.id], locationId: a.locationId ?? undefined, label: `${p.firstName} : ${home ? 'routine du matin' : 'se prépare'}`, causes: [ev.id], sig: 'morning_routine' });
    a.activity = { action: 'morning_routine', label: home ? 'Routine du matin (petit-déjeuner, douche)' : 'Se prépare', locationId: a.locationId ?? p.homeId, since: this.state.t, until, startEventId: start.id, interruptible: false };
  }

  private reevaluate(a: AgentState) {
    const act = a.activity!;
    const p = this.profiles.get(a.id)!;
    const ctx = this.ctx({ action: act.action, locationId: act.locationId, label: act.label, score: 0 });
    const outcome = this.policy.decide(a, p, ctx);
    const c = outcome.chosen;
    if (c.rejected) return;
    if (c.action === act.action && c.locationId === act.locationId) return;
    // Switch.
    const ev = this.emit({
      type: 'plan_change',
      actors: [a.id],
      locationId: a.locationId ?? undefined,
      label: `${p.firstName} abandonne « ${act.label} » pour « ${c.label} »`,
      causes: [act.startEventId, ...a.influences.map((i) => i.eventId)],
      mechanism: outcome.reasons.join(' ; '),
      data: { from: act.action, to: c.action },
      sig: `${act.action}>${c.action}`,
    });
    this.influence(a, ev, 'Changement de plan');
    a.activity = null;
    this.applyDecision(a, outcome, ev.id);
  }

  private ctx(current: DecisionContext['current'] = null): DecisionContext {
    return { city: this.city, timetable: this.timetable, world: this.state, profiles: this.profiles, rng: this.rng, t: this.state.t, current };
  }

  private decide(a: AgentState, trigger: EventId | null) {
    if (a.asleep || a.travel) return;
    const p = this.profiles.get(a.id)!;
    const outcome = this.policy.decide(a, p, this.ctx());
    this.applyDecision(a, outcome, trigger);
  }

  private applyDecision(a: AgentState, outcome: { chosen: Candidate; candidates: Candidate[]; reasons: string[] }, trigger: EventId | null) {
    const t = this.state.t;
    const p = this.profiles.get(a.id)!;
    const c = outcome.chosen;
    const forced = a.forcedPlan && c.components.some((x) => x.label.startsWith('Intervention'));
    const causes = [trigger, ...a.influences.map((i) => i.eventId), forced ? a.forcedPlan!.interventionEventId : null];
    const ev = this.emit({
      type: 'decision',
      actors: [a.id],
      locationId: a.locationId ?? undefined,
      label: `${p.firstName} décide : ${c.label}`,
      description: outcome.reasons.join(' · '),
      causes,
      mechanism: a.influences.length ? `Influencé par : ${a.influences.map((i) => i.reason).join(', ')}` : 'Évaluation des besoins et engagements',
      data: { action: c.action, target: c.locationId, score: Number(c.score.toFixed(3)), mode: c.mode },
      sig: `${c.action}:${c.locationId}`,
      interventionId: forced ? a.forcedPlan!.interventionEventId && this.interventionIdForEvent(a.forcedPlan!.interventionEventId) : undefined,
    });
    a.lastDecision = { t, eventId: ev.id, chosen: c, candidates: outcome.candidates, influences: a.influences.map((i) => i.eventId), reasons: outcome.reasons };
    a.influences = [];
    const arc = arcOf(this.state, a.id);
    const dilemma = detectDilemma(c, outcome.candidates, arc, t);
    if (arc && dilemma) {
      arc.lastDilemma = t;
      const seed = arcSeed(arc.seedId);
      const d = this.emit({ type: 'dilemma', actors: [a.id], locationId: a.locationId ?? undefined, label: `${p.firstName} ${dilemma.text}`, causes: [ev.id], mechanism: `Deux options proches (écart ${(c.score - dilemma.other.score).toFixed(2)}) ; enjeu du jour : « ${seed.title} »`, data: { arcId: arc.id, chosen: c.label, other: dilemma.other.label }, sig: `${arc.id}:${c.action}` });
      arc.beats.push(d.id);
      this.remember(a, d, `Dilemme : ${c.label} plutôt que ${dilemma.other.label}`, 0.5, 0, []);
    }
    if (forced) a.forcedPlan = undefined;
    const plan: Plan = {
      action: c.action,
      label: c.label,
      locationId: c.locationId,
      duration: c.duration,
      commitmentId: c.commitmentId,
      withAgent: c.withAgent,
      decisionEventId: ev.id,
      interruptible: isInterruptible(c.action),
      mode: c.mode,
      createdAt: t,
    };
    a.plan = plan;
    if (a.locationId === c.locationId) {
      this.startActivity(a, ev.id);
    } else {
      this.startTravel(a, ev.id);
    }
  }

  private interventionIdForEvent(eventId: EventId): string | undefined {
    for (const [iv, ev] of Object.entries(this.state.interventionEventIds)) if (ev === eventId) return iv;
    return undefined;
  }

  // ---------------------------------------------------------------------
  // Travel
  // ---------------------------------------------------------------------

  private startTravel(a: AgentState, decisionEventId: EventId) {
    const t = this.state.t;
    const p = this.profiles.get(a.id)!;
    const plan = a.plan!;
    const fromNode = agentNode(a, this.city);
    const fromLoc = a.locationId;
    const speed = walkSpeed(this.state);
    let path = this.city.walkPath(a.pos, fromNode, plan.locationId, this.slotFor(plan.locationId));
    let stage: TravelStage = 'walking';
    let boardStop: LocationId | undefined;
    let alightStop: LocationId | undefined;
    let expected = t + Math.ceil(polylineLength(path) / speed);
    let busInfo = '';
    if (plan.mode === 'bus') {
      const line = this.city.lines[0];
      const trip = planBusTripSafe(this, fromNode, plan.locationId, t, speed);
      if (trip && line) {
        boardStop = trip.boardStop;
        alightStop = trip.alightStop;
        path = this.city.walkPath(a.pos, fromNode, boardStop, 0);
        stage = 'to_stop';
        expected = trip.arrival;
        busInfo = ` en bus (${this.locName(boardStop)} → ${this.locName(alightStop)}, bus de ${fmtTime(trip.entry.depart)})`;
      }
    }
    const ev = this.emit({
      type: 'depart',
      actors: [a.id],
      locationId: fromLoc ?? undefined,
      label: `${p.firstName} part vers ${this.locName(plan.locationId)}${busInfo}`,
      causes: [decisionEventId],
      mechanism: 'Mise en œuvre de la décision',
      data: { to: plan.locationId, mode: plan.mode, expected },
      sig: `${fromLoc ?? ''}>${plan.locationId}`,
    });
    if (fromLoc && this.city.location(fromLoc).kind !== 'home') (this.state.lastLeft ??= {})[a.id] = { locationId: fromLoc, t };
    // Leaving a public place: distracted people sometimes forget their wallet.
    if (fromLoc && a.inventory.includes('wallet')) {
      const def = this.city.location(fromLoc);
      if (def.kind !== 'home' && def.kind !== 'bus_stop') {
        const key = `lose:${a.id}:${t}`;
        if (this.rng.chance(key, p.preferences.distraction * 0.04)) {
          a.inventory = a.inventory.filter((i) => i !== 'wallet');
          const lose = this.emit({
            type: 'lose_item',
            actors: [a.id],
            locationId: fromLoc,
            label: `${p.firstName} oublie son portefeuille à ${def.name}`,
            causes: [ev.id],
            mechanism: 'Distraction au moment de partir (graine aléatoire)',
            randomDraws: [{ key, value: this.rng.next(key) }],
            effects: [{ kind: 'inventory', agentId: a.id, value: 'wallet', delta: -1 }],
            sig: fromLoc,
          });
          this.state.locations[fromLoc].items.push({ item: 'wallet', ownerId: a.id, eventId: lose.id });
        }
      }
    }
    a.locationId = null;
    a.activity = null;
    a.travel = {
      stage,
      destinationId: plan.locationId,
      path,
      progress: 0,
      pathLength: polylineLength(path),
      boardStopId: boardStop,
      alightStopId: alightStop,
      departEventId: ev.id,
      startedAt: t,
      expectedArrival: expected,
      delayEventIds: [],
      legEventIds: [],
    };
    // Walk the first minute immediately so departures are visible.
    this.advanceTravel(a);
  }

  private cancelTravel(a: AgentState) {
    if (!a.travel) return;
    // The traveller stops where they are; the next decision starts from the nearest node.
    a.travel = null;
    a.plan = null;
  }

  private advanceTravel(a: AgentState) {
    const tr = a.travel!;
    const t = this.state.t;
    if (tr.stage === 'riding') return; // position synced by the bus
    if (a.movedAt === t) return; // already walked this minute (travel started outside the agent loop)
    if (tr.pausedUntil !== undefined && t < tr.pausedUntil) return; // stopped to chat
    a.movedAt = t;
    if (tr.stage === 'waiting') {
      // Give up on the bus after a long wait and walk instead.
      const waited = t - (tr.waitingSince ?? t);
      const p = this.profiles.get(a.id)!;
      if (waited >= 10 + Math.round(p.traits.patience * 8)) {
        const ev = this.emit({
          type: 'plan_change',
          actors: [a.id],
          locationId: tr.boardStopId,
          label: `${p.firstName} renonce au bus après ${waited} min d’attente et part à pied`,
          causes: [tr.departEventId],
          mechanism: 'Attente trop longue par rapport à la patience de l’habitant',
          data: { waited },
          sig: 'give_up_bus',
        });
        tr.legEventIds.push(ev.id);
        tr.stage = 'walking';
        tr.path = this.city.walkPath(a.pos, this.city.location(tr.boardStopId!).node, tr.destinationId, this.slotFor(tr.destinationId));
        tr.pathLength = polylineLength(tr.path);
        tr.progress = 0;
        a.locationId = null;
        tr.expectedArrival = t + Math.ceil(tr.pathLength / walkSpeed(this.state));
      }
      return;
    }
    tr.progress += walkSpeed(this.state);
    if (tr.progress < tr.pathLength) {
      a.pos = pointAlong(tr.path, tr.progress);
      return;
    }
    a.pos = tr.path[tr.path.length - 1];
    if (tr.stage === 'to_stop') {
      tr.stage = 'waiting';
      tr.waitingSince = t;
      a.locationId = tr.boardStopId!;
      a.pos = this.city.insidePos(tr.boardStopId!, this.slotFor(tr.boardStopId!));
      const p = this.profiles.get(a.id)!;
      // Did the planned bus already leave?
      const line = this.city.lines[0];
      const bi = line.stops.indexOf(tr.boardStopId!);
      const ai = line.stops.indexOf(tr.alightStopId!);
      const dir: 1 | -1 = ai > bi ? 1 : -1;
      const planned = this.timetable.nextDeparture(tr.boardStopId!, dir, tr.startedAt);
      const busHere = Object.values(this.state.buses).some((b) => b.currentStopId === tr.boardStopId && b.direction === dir && b.inService);
      if (planned && planned.depart <= t && !busHere) {
        const departed = this.events.filter((e) => e.type === 'bus_depart' && e.locationId === tr.boardStopId && e.t >= planned.depart - 2 && e.t <= t).pop();
        const ev = this.emit({
          type: 'miss_bus',
          actors: [a.id],
          locationId: tr.boardStopId,
          label: `${p.firstName} rate le bus de ${fmtTime(planned.depart)} à ${this.locName(tr.boardStopId)}`,
          causes: [tr.departEventId, departed?.id],
          mechanism: `Arrivé à l’arrêt à ${fmtTime(t)}, après le départ du bus`,
          sig: `${tr.boardStopId}:${planned.depart}`,
        });
        tr.legEventIds.push(ev.id);
        this.influence(a, ev, 'A raté le bus');
        this.remember(a, ev, `Raté le bus de ${fmtTime(planned.depart)}`, 0.4, -0.3);
      }
      return;
    }
    this.arriveAtDestination(a);
  }

  private arriveAtDestination(a: AgentState) {
    const tr = a.travel!;
    const t = this.state.t;
    const p = this.profiles.get(a.id)!;
    const dest = tr.destinationId;
    const lateBy = t - tr.expectedArrival;
    const ev = this.emit({
      type: 'arrive',
      actors: [a.id],
      locationId: dest,
      label: `${p.firstName} arrive à ${this.locName(dest)}${lateBy > 0 ? ` (${lateBy} min plus tard que prévu)` : ''}`,
      causes: [tr.departEventId, ...tr.legEventIds, ...tr.delayEventIds],
      mechanism: tr.delayEventIds.length ? 'Trajet affecté par des retards' : 'Fin du trajet',
      data: { lateBy, mode: tr.boardStopId ? 'bus' : 'walk', travelMinutes: t - tr.startedAt },
      sig: dest,
    });
    a.travel = null;
    a.locationId = dest;
    a.pos = this.city.insidePos(dest, this.slotFor(dest) - 1);
    a.lastArrivalEventId = ev.id;
    this.state.locations[dest].visitsToday += 1;
    if (!a.plan) {
      this.decide(a, ev.id);
      return;
    }
    // Closed on arrival? (staff can enter their workplace before opening hours)
    const def = this.city.location(dest);
    const planCommitment = a.plan.commitmentId ? a.commitments.find((x) => x.id === a.plan!.commitmentId) : undefined;
    const staffAccess = !!planCommitment && (planCommitment.kind === 'work' || planCommitment.kind === 'school' || planCommitment.kind === 'shift');
    const ls0 = this.state.locations[dest];
    const soldOut = ls0.closedEarlyAt !== undefined && t >= ls0.closedEarlyAt && ls0.stock === 0;
    if (def.kind !== 'home' && def.kind !== 'bus_stop' && (!staffAccess || soldOut) && !isLocationOpen(this.city, this.state, dest, t)) {
      const ls = this.state.locations[dest];
      const closed = this.emit({
        type: 'found_closed',
        actors: [a.id],
        locationId: dest,
        label: `${p.firstName} trouve ${def.name} fermé`,
        causes: [ev.id, ls.closedEarlyEventId],
        mechanism: ls.closedEarlyAt !== undefined ? 'Fermeture anticipée' : 'Horaires d’ouverture',
        sig: dest,
      });
      this.remember(a, closed, `${def.name} était fermé à ${fmtTime(t)}`, 0.4, -0.3);
      a.knownClosed = [...(a.knownClosed ?? []), dest];
      this.influence(a, closed, `${def.name} fermé`);
      this.mood(a, -0.1, 0.05);
      if (a.plan.commitmentId) this.failCommitment(a, a.plan.commitmentId, closed.id, 'lieu fermé');
      a.plan = null;
      this.decide(a, closed.id);
      return;
    }
    if (def.capacity !== undefined && this.slotFor(dest) - 1 >= def.capacity) {
      const full = this.emit({ type: 'found_closed', actors: [a.id], locationId: dest, label: `${p.firstName} trouve ${def.name} complet`, causes: [ev.id], mechanism: 'Capacité maximale atteinte', sig: `${dest}:full` });
      this.influence(a, full, `${def.name} complet`);
      a.plan = null;
      this.decide(a, full.id);
      return;
    }
    this.startActivity(a, ev.id);
  }

  // ---------------------------------------------------------------------
  // Activities
  // ---------------------------------------------------------------------

  private startActivity(a: AgentState, cause: EventId) {
    const t = this.state.t;
    const p = this.profiles.get(a.id)!;
    const plan = a.plan!;
    const loc = plan.locationId;
    const effects: StateChange[] = [];
    const cost = { eat_bakery: 4, eat_cafe: 9, eat_restaurant: 20, coffee: 3, shop_groceries: 15, workout: 5 }[plan.action as string] ?? 0;

    // Found items lying around?
    this.checkFoundItems(a, loc, cause);

    if (plan.action === 'sleep') {
      const ev = this.emit({ type: 'sleep', actors: [a.id], locationId: loc, label: `${p.firstName} va dormir`, causes: [cause], sig: 'sleep' });
      a.asleep = true;
      a.awake = false;
      a.activity = { action: 'sleep', label: 'Dort', locationId: loc, since: t, until: DAY_END + 1, startEventId: ev.id, interruptible: false };
      a.plan = null;
      return;
    }

    if (plan.commitmentId) {
      const c = a.commitments.find((x) => x.id === plan.commitmentId);
      if (c && (c.status === 'pending' || c.status === 'ongoing')) {
        if (c.kind === 'work' || c.kind === 'school' || c.kind === 'shift') {
          this.startWork(a, c, cause);
          return;
        }
        if (c.kind === 'meeting' || c.kind === 'appointment') {
          // Wait for the other participants; handleMeetings() turns this into a meeting.
          const others = c.with.map((w) => this.name(w)).join(' et ');
          const ev = this.emit({ type: 'wait_start', actors: [a.id], locationId: loc, label: `${p.firstName} attend ${others} (${c.label})`, causes: [cause], mechanism: 'Arrivée au lieu du rendez-vous', data: { commitmentId: c.id }, sig: c.id });
          a.activity = { action: 'wait', label: `Attend ${others}`, locationId: loc, since: t, until: Math.max(c.start, t) + c.tolerance + Math.round(p.traits.patience * 10), commitmentId: c.id, withAgent: c.with[0], startEventId: ev.id, interruptible: false };
          a.plan = null;
          return;
        }
        if (c.kind === 'errand' && c.id.startsWith('return_')) {
          // Returning a found wallet to its owner's home.
          const ownerId = c.with[0];
          const owner = this.state.agents[ownerId];
          const item = a.inventory.find((i) => i === `wallet_of:${ownerId}`);
          c.status = 'done';
          a.objectivesDone += 1;
          a.plan = null;
          if (item) {
            a.inventory = a.inventory.filter((i) => i !== item);
            if (owner && owner.locationId === loc && !owner.asleep) {
              owner.inventory.push('wallet');
              const ret = this.emit({ type: 'return_item', actors: [a.id, ownerId], locationId: loc, label: `${p.firstName} rend son portefeuille à ${this.name(ownerId)}`, causes: [cause], mechanism: 'Le trouveur se présente chez le propriétaire, qui est là', effects: [this.adjustRelationship(owner, a.id, 0.3), this.adjustRelationship(a, ownerId, 0.1), ...this.mood(owner, 0.4, -0.3)], sig: `${a.id}>${ownerId}` });
              this.remember(owner, ret, `${p.firstName} m\u2019a rapporté mon portefeuille !`, 0.9, 0.8, [a.id]);
              this.remember(a, ret, `Rendu le portefeuille à ${this.name(ownerId)}`, 0.7, 0.5, [ownerId]);
              for (const oc of owner.commitments) if (oc.id === `wallet_${ownerId}` && oc.status === 'pending') { oc.status = 'done'; owner.objectivesDone += 1; }
              a.lastChat[ownerId] = t;
              owner.lastChat[a.id] = t;
              this.decide(a, ret.id);
              return;
            }
            // Owner absent: leave the wallet at the door; the owner finds it when coming home.
            const lose = this.events.filter((e) => e.type === 'lose_item' && e.actors[0] === ownerId).pop();
            const left = this.emit({ type: 'return_item', actors: [a.id, ownerId], locationId: loc, label: `${p.firstName} dépose le portefeuille de ${this.name(ownerId)} à son domicile (${this.name(ownerId)} est absent)`, causes: [cause, lose?.id], mechanism: 'Le propriétaire n\u2019est pas chez lui', data: { left: true }, sig: `${a.id}>${ownerId}:left` });
            this.state.locations[loc].items.push({ item: 'wallet', ownerId, eventId: left.id });
            this.remember(a, left, `Déposé le portefeuille de ${this.name(ownerId)} chez lui`, 0.6, 0.3, [ownerId]);
            this.decide(a, left.id);
            return;
          }
          this.decide(a, cause);
          return;
        }
        if (c.kind === 'errand') {
          c.status = 'ongoing';
          const ev = this.emit({ type: 'activity_start', actors: [a.id], locationId: loc, label: `${p.firstName} : ${c.label}`, causes: [cause], data: { commitmentId: c.id }, sig: c.id });
          if (loc === 'bakery') this.purchase(a, loc, 'pain pour le restaurant (12 pièces)', 30, 12, ev.id);
          if (loc === 'restaurant') this.purchase(a, loc, 'déjeuner', 20, 0, ev.id);
          a.activity = { action: 'commitment', label: c.label, locationId: loc, since: t, until: Math.max(c.end, t + 10), commitmentId: c.id, startEventId: ev.id, interruptible: false };
          a.plan = null;
          return;
        }
      }
      if (c && (c.status === 'missed' || c.status === 'cancelled')) {
        const ev = this.emit({ type: 'activity_end', actors: [a.id], locationId: loc, label: `${p.firstName} arrive trop tard : « ${c.label} » n’aura pas lieu`, causes: [cause], mechanism: 'Le rendez-vous a déjà été considéré comme manqué', sig: `${c.id}:late` });
        this.remember(a, ev, `Arrivé trop tard pour « ${c.label} »`, 0.6, -0.4, c.with);
        this.influence(a, ev, 'Rendez-vous manqué');
        this.mood(a, -0.15, 0.1);
        a.plan = null;
        this.decide(a, ev.id);
        return;
      }
    }

    // Visiting someone who is no longer there (or not there yet)
    if (plan.action === 'visit' && plan.withAgent) {
      const other = this.state.agents[plan.withAgent];
      const otherComing = !!other && other.locationId !== loc && ((other.plan?.locationId === loc) || (other.travel?.destinationId === loc) || other.forcedPlan?.locationId === loc);
      if (other && otherComing) {
        const ev = this.emit({ type: 'wait_start', actors: [a.id], locationId: loc, label: `${p.firstName} attend ${this.name(plan.withAgent)} à ${this.locName(loc)}`, causes: [cause], mechanism: `${this.name(plan.withAgent)} est en chemin`, sig: `visit:${plan.withAgent}` });
        a.activity = { action: 'wait', label: `Attend ${this.name(plan.withAgent)}`, locationId: loc, since: t, until: t + 25, withAgent: plan.withAgent, startEventId: ev.id, interruptible: false };
        a.plan = null;
        return;
      }
      if (!other || other.locationId !== loc) {
        const ev = this.emit({ type: 'activity_end', actors: [a.id], locationId: loc, label: `${p.firstName} ne trouve pas ${this.name(plan.withAgent)} à ${this.locName(loc)}`, causes: [cause], mechanism: 'La personne est partie entre-temps', sig: `missed_visit:${plan.withAgent}` });
        this.remember(a, ev, `${this.name(plan.withAgent)} n’était plus à ${this.locName(loc)}`, 0.35, -0.2, [plan.withAgent]);
        this.influence(a, ev, `${this.name(plan.withAgent)} introuvable`);
        a.plan = null;
        this.decide(a, ev.id);
        return;
      }
    }

    const ev = this.emit({ type: 'activity_start', actors: [a.id], locationId: loc, label: `${p.firstName} : ${plan.label}`, causes: [cause], data: { action: plan.action }, sig: plan.action, effects });
    if (cost > 0) {
      const what = { eat_bakery: 'un sandwich', eat_cafe: 'un déjeuner', eat_restaurant: 'un repas', coffee: 'un café', shop_groceries: 'des courses', workout: 'une séance' }[plan.action as string] ?? 'un achat';
      this.purchase(a, loc, what, cost, plan.action === 'eat_bakery' ? 1 : 0, ev.id);
      if (plan.action === 'shop_groceries') a.groceries += 3;
    }
    a.activity = {
      action: plan.action,
      label: plan.label,
      locationId: loc,
      since: t,
      until: t + plan.duration,
      withAgent: plan.withAgent,
      startEventId: ev.id,
      interruptible: isInterruptible(plan.action),
    };
    a.plan = null;
    if (plan.action === 'visit' && plan.withAgent) {
      const other = this.state.agents[plan.withAgent];
      if (other) this.converse(a, other, loc, ev.id, 'visit');
    }
  }

  private purchase(a: AgentState, loc: LocationId, what: string, price: number, stockUnits: number, cause: EventId) {
    const p = this.profiles.get(a.id)!;
    const ls = this.state.locations[loc];
    if (!a.inventory.includes('wallet')) {
      const ev = this.emit({ type: 'mood_shift', actors: [a.id], locationId: loc, label: `${p.firstName} s’aperçoit qu’il n’a plus son portefeuille`, causes: [cause, ...this.lostWalletEvent(a.id)], mechanism: 'Impossible de payer : le portefeuille a été oublié plus tôt', sig: 'no_wallet' });
      this.mood(a, -0.3, 0.3);
      this.remember(a, ev, `Portefeuille perdu ! Impossible de payer à ${this.locName(loc)}`, 0.8, -0.6);
      this.influence(a, ev, 'Portefeuille perdu');
      this.addWalletErrand(a, ev.id);
      return;
    }
    a.money -= price;
    if (stockUnits > 0) ls.stock = Math.max(0, ls.stock - stockUnits);
    const ev = this.emit({ type: 'purchase', actors: [a.id], locationId: loc, label: `${p.firstName} achète ${what} (${price} €)`, causes: [cause], effects: [{ kind: 'money', agentId: a.id, delta: -price }], data: { price, stockLeft: ls.stock }, sig: what });
    if (stockUnits > 0 && ls.stock === 0 && ls.closedEarlyAt === undefined) this.closeShop(loc, ev.id, 'Tout est vendu');
  }

  private lostWalletEvent(agentId: AgentId): EventId[] {
    for (const ls of Object.values(this.state.locations)) {
      const item = ls.items.find((i) => i.item === 'wallet' && i.ownerId === agentId);
      if (item) return [item.eventId];
    }
    // Someone may have picked it up already.
    const ev = this.events.filter((e) => e.type === 'lose_item' && e.actors[0] === agentId).pop();
    return ev ? [ev.id] : [];
  }

  private addWalletErrand(a: AgentState, cause: EventId) {
    if (a.commitments.some((c) => c.id.startsWith('wallet_') && c.status === 'pending')) return;
    let where: LocationId | null = null;
    for (const ls of Object.values(this.state.locations)) if (ls.items.some((i) => i.item === 'wallet' && i.ownerId === a.id)) where = ls.id;
    if (!where) {
      const ev = this.events.filter((e) => e.type === 'lose_item' && e.actors[0] === a.id).pop();
      where = ev?.locationId ?? null;
    }
    if (!where) return;
    const c: Commitment = { id: `wallet_${a.id}`, kind: 'errand', label: `Retourner chercher le portefeuille (${this.locName(where)})`, locationId: where, start: this.state.t, end: this.state.t + 90, with: [], tolerance: 120, status: 'pending' };
    a.commitments.push(c);
    this.emit({ type: 'new_commitment', actors: [a.id], locationId: where, label: `${this.name(a.id)} veut retourner chercher son portefeuille à ${this.locName(where)}`, causes: [cause], data: { commitmentId: c.id }, sig: c.id });
  }

  private checkFoundItems(a: AgentState, loc: LocationId, cause: EventId) {
    const ls = this.state.locations[loc];
    if (!ls.items.length) return;
    const p = this.profiles.get(a.id)!;
    for (const item of [...ls.items]) {
      if (item.ownerId === a.id) {
        ls.items = ls.items.filter((i) => i !== item);
        a.inventory.push('wallet');
        const ev = this.emit({ type: 'find_item', actors: [a.id], locationId: loc, label: `${p.firstName} retrouve son portefeuille à ${this.locName(loc)}`, causes: [cause, item.eventId], mechanism: 'Retour sur les lieux de la perte', sig: `own:${loc}` });
        this.remember(a, ev, `Ouf : portefeuille retrouvé à ${this.locName(loc)}`, 0.7, 0.6);
        this.mood(a, 0.3, -0.2);
        const c = a.commitments.find((x) => x.id === `wallet_${a.id}`);
        if (c) {
          c.status = 'done';
          a.objectivesDone += 1;
        }
        continue;
      }
      const key = `notice:${a.id}:${loc}:${this.state.t}`;
      if (!this.rng.chance(key, 0.45 + p.traits.curiosity * 0.4)) continue;
      ls.items = ls.items.filter((i) => i !== item);
      const owner = this.name(item.ownerId);
      const honest = p.traits.honesty >= 0.5;
      const knows = !!a.relationships[item.ownerId];
      const ev = this.emit({
        type: 'find_item',
        actors: [a.id, item.ownerId],
        locationId: loc,
        label: `${p.firstName} trouve un portefeuille oublié à ${this.locName(loc)}${knows ? ` : celui de ${owner}` : ''}`,
        causes: [cause, item.eventId],
        mechanism: 'Présent au même endroit après la perte (graine aléatoire)',
        randomDraws: [{ key, value: this.rng.next(key) }],
        data: { owner: item.ownerId, honest },
        sig: `${item.ownerId}:${loc}`,
      });
      this.remember(a, ev, `Trouvé le portefeuille de ${owner} à ${this.locName(loc)}`, 0.7, honest ? 0.3 : -0.1, [item.ownerId]);
      if (honest) {
        a.inventory.push(`wallet_of:${item.ownerId}`);
        const ownerHome = this.profiles.get(item.ownerId)!.homeId;
        const c: Commitment = { id: `return_${item.ownerId}_${a.id}`, kind: 'errand', label: `Rendre le portefeuille à ${owner}`, locationId: ownerHome, start: Math.max(this.state.t + 60, 18 * 60 + 30), end: 21 * 60, with: [item.ownerId], tolerance: 60, status: 'pending' };
        a.commitments.push(c);
        this.emit({ type: 'new_commitment', actors: [a.id, item.ownerId], locationId: ownerHome, label: `${p.firstName} décide de rendre le portefeuille à ${owner}`, causes: [ev.id], mechanism: 'Honnêteté du trouveur', data: { commitmentId: c.id }, sig: c.id });
      } else {
        const ownerState = this.state.agents[item.ownerId];
        const taken = Math.min(ownerState.money, 30);
        ownerState.money -= taken;
        a.money += taken;
        this.remember(a, ev, `Gardé ${taken} € du portefeuille de ${owner}…`, 0.6, -0.2, [item.ownerId]);
      }
    }
  }

  private closeShop(loc: LocationId, cause: EventId, reason: string) {
    const ls = this.state.locations[loc];
    const def = this.city.location(loc);
    ls.closedEarlyAt = this.state.t;
    const ev = this.emit({ type: 'shop_closed', actors: [], locationId: loc, label: `${def.name} ferme plus tôt que prévu : ${reason.toLowerCase()}`, causes: [cause], mechanism: reason, sig: loc });
    ls.closedEarlyEventId = ev.id;
    // Staff and customers inside leave.
    for (const a of Object.values(this.state.agents)) {
      if (a.locationId !== loc || !a.activity) continue;
      const c = a.activity.commitmentId ? a.commitments.find((x) => x.id === a.activity!.commitmentId) : undefined;
      if (c && (c.kind === 'work' || c.kind === 'shift')) {
        c.status = 'done';
        a.objectivesDone += 1;
        const end = this.emit({ type: 'work_end', actors: [a.id], locationId: loc, label: `${this.name(a.id)} termine plus tôt : la boutique est vide`, causes: [ev.id], sig: c.id });
        this.remember(a, end, `Fermé plus tôt : tout vendu à ${fmtTime(this.state.t)}`, 0.5, 0.4);
        this.influence(a, end, 'Boutique fermée plus tôt');
        a.activity = null;
        this.decide(a, end.id);
      } else if (a.activity.interruptible) {
        this.influence(a, ev, `${def.name} ferme`);
        this.endActivity(a, ev.id, 'le lieu ferme');
      }
    }
  }

  private startWork(a: AgentState, c: Commitment, cause: EventId) {
    const t = this.state.t;
    const p = this.profiles.get(a.id)!;
    const loc = c.locationId;
    const action: ActionType = c.kind === 'school' ? 'school' : 'work';
    const resuming = c.status === 'ongoing';
    c.status = 'ongoing';
    const lateBy = resuming ? 0 : t - c.start;
    const ev = this.emit({
      type: 'work_start',
      actors: [a.id],
      locationId: loc,
      label: resuming ? `${p.firstName} reprend le travail` : lateBy > 5 ? `${p.firstName} arrive au travail avec ${lateBy} min de retard` : lateBy < -10 ? `${p.firstName} arrive ${c.kind === 'school' ? 'au lycée' : 'au travail'} ${-lateBy} min en avance` : `${p.firstName} commence ${c.kind === 'school' ? 'les cours' : 'sa journée de travail'}`,
      causes: [cause],
      data: { commitmentId: c.id, lateBy, resuming },
      sig: `${c.id}:${resuming ? 'resume' : 'start'}`,
    });
    if (!resuming) c.lateBy = Math.max(0, lateBy);
    if (!resuming && lateBy > 5) {
      const travelCauses = this.events.find((e) => e.id === cause)?.causes ?? [];
      const late = this.emit({
        type: 'late',
        actors: [a.id],
        locationId: loc,
        label: `${p.firstName} est en retard de ${lateBy} min ${c.kind === 'school' ? 'au lycée' : 'au travail'}`,
        causes: [cause, ...travelCauses],
        mechanism: 'Arrivée après l’heure de début de l’engagement',
        data: { lateBy, commitmentId: c.id },
        effects: this.mood(a, -0.15, 0.2),
        sig: c.id,
      });
      this.remember(a, late, `En retard de ${lateBy} min ${c.kind === 'school' ? 'au lycée' : 'au travail'}`, 0.6, -0.5);
      // Boss or teacher present notices.
      for (const o of Object.values(this.state.agents)) {
        if (o.id === a.id || o.locationId !== loc) continue;
        const rel = o.relationships[a.id];
        if (rel && (rel.kind === 'employee' || rel.kind === 'student') && lateBy >= 10) {
          const op = this.profiles.get(o.id)!;
          const notice = this.emit({
            type: 'mood_shift',
            actors: [o.id, a.id],
            locationId: loc,
            label: `${op.firstName} remarque le retard de ${p.firstName}`,
            causes: [late.id],
            mechanism: `${op.firstName} est présent et patient à ${Math.round(op.traits.patience * 100)} %`,
            effects: [this.adjustRelationship(o, a.id, -0.06 - (1 - op.traits.patience) * 0.08), ...this.mood(o, -0.05, 0.05)],
            sig: `${o.id}:${c.id}`,
          });
          this.remember(o, notice, `${p.firstName} est arrivé en retard (${lateBy} min)`, 0.5, -0.3, [a.id]);
          this.remember(a, notice, `${op.firstName} a remarqué mon retard`, 0.5, -0.4, [o.id]);
        }
      }
    }
    a.activity = { action, label: c.kind === 'school' ? 'Suit les cours' : `Travaille — ${this.locName(loc)}`, locationId: loc, since: t, until: c.end, commitmentId: c.id, startEventId: ev.id, interruptible: false };
    a.plan = null;
  }

  private failCommitment(a: AgentState, id: string, cause: EventId, reason: string) {
    const c = a.commitments.find((x) => x.id === id);
    if (!c || c.status === 'done' || c.status === 'missed') return;
    c.status = 'missed';
    this.emit({ type: 'meeting_missed', actors: [a.id, ...c.with], locationId: c.locationId, label: `« ${c.label} » n’a pas lieu : ${reason}`, causes: [cause], data: { commitmentId: c.id }, sig: c.id, importance: 0.6 });
  }

  /** End the current activity while the agent is held: records the end, no new decision. */
  private endActivityQuietly(a: AgentState, act: NonNullable<AgentState['activity']>) {
    const t = this.state.t;
    a.recent[act.action] = t;
    const c = act.commitmentId ? a.commitments.find((x) => x.id === act.commitmentId) : undefined;
    if (c && (c.kind === 'work' || c.kind === 'school' || c.kind === 'shift') && t >= c.end) {
      c.status = 'done';
      a.objectivesDone += 1;
      this.emit({ type: 'work_end', actors: [a.id], locationId: act.locationId, label: `${this.name(a.id)} termine sa journée`, causes: [act.startEventId], sig: c.id });
    } else {
      this.emit({ type: 'activity_end', actors: [a.id], locationId: act.locationId, label: `${this.name(a.id)} termine : ${act.label}`, causes: [act.startEventId], sig: act.action, importance: 0.08 });
    }
    a.activity = null;
    a.plan = null;
  }

  private endActivity(a: AgentState, cause: EventId | null, reason: string) {
    const act = a.activity!;
    const t = this.state.t;
    a.recent[act.action] = t;
    const p = this.profiles.get(a.id)!;
    const c = act.commitmentId ? a.commitments.find((x) => x.id === act.commitmentId) : undefined;
    let ev: SimEvent;
    if (c && (c.kind === 'work' || c.kind === 'school' || c.kind === 'shift') && (act.action === 'work' || act.action === 'school')) {
      if (t >= c.end) {
        c.status = 'done';
        a.objectivesDone += 1;
        ev = this.emit({ type: 'work_end', actors: [a.id], locationId: act.locationId, label: `${p.firstName} termine sa journée`, causes: [act.startEventId, cause], sig: c.id });
        a.inventory = a.inventory.filter((i) => i !== 'lunch_taken');
      } else {
        ev = this.emit({ type: 'activity_end', actors: [a.id], locationId: act.locationId, label: `${p.firstName} fait une pause : ${reason}`, causes: [act.startEventId, cause], sig: `${act.action}:pause` });
      }
    } else if (c && act.action === 'commitment') {
      c.status = 'done';
      a.objectivesDone += 1;
      ev = this.emit({ type: 'meeting_end', actors: [a.id, ...c.with], locationId: act.locationId, label: `${p.firstName} termine « ${c.label} »`, causes: [act.startEventId, cause], data: { commitmentId: c.id }, sig: c.id });
    } else if (c && act.action === 'wait') {
      // Waiting ended without the meeting happening — handled in handleMeetings; just record.
      ev = this.emit({ type: 'activity_end', actors: [a.id], locationId: act.locationId, label: `${p.firstName} cesse d’attendre`, causes: [act.startEventId, cause], sig: `${c.id}:stopwait` });
    } else {
      ev = this.emit({ type: 'activity_end', actors: [a.id], locationId: act.locationId, label: `${p.firstName} termine : ${act.label}${reason !== 'terminé' ? ` (${reason})` : ''}`, causes: [act.startEventId, cause], sig: act.action, importance: reason === 'terminé' ? 0.08 : 0.3 });
    }
    a.activity = null;
    a.plan = null;
    if (!a.asleep) this.decide(a, ev.id);
  }

  private applyActivityEffects(a: AgentState) {
    const act = a.activity!;
    const n = a.needs;
    const e = a.emotions;
    switch (act.action) {
      case 'morning_routine':
        n.hunger -= 1.6;
        n.fatigue -= 0.2;
        break;
      case 'work':
      case 'drive_bus':
        n.fatigue += 0.05;
        n.boredom += 0.04;
        n.social -= 0.05;
        a.minutesWorked += 1;
        break;
      case 'school':
        n.fatigue += 0.04;
        n.boredom += 0.1;
        n.social -= 0.1;
        break;
      case 'commitment':
        n.social -= 0.8;
        n.boredom -= 0.5;
        e.mood += 0.003;
        break;
      case 'eat_home':
        n.hunger -= 2;
        break;
      case 'eat_bakery':
        n.hunger -= 2.6;
        break;
      case 'eat_cafe':
        n.hunger -= 1.9;
        n.social -= 0.3;
        break;
      case 'eat_restaurant':
        n.hunger -= 1.5;
        n.social -= 0.4;
        e.mood += 0.003;
        break;
      case 'coffee':
        n.social -= 0.8;
        n.boredom -= 0.8;
        n.fatigue -= 0.1;
        n.hunger -= 0.3;
        break;
      case 'shop_groceries':
        n.boredom -= 0.2;
        break;
      case 'relax_park':
        n.boredom -= 1;
        n.fatigue -= 0.08;
        e.mood += 0.002;
        e.stress -= 0.004;
        break;
      case 'read_library':
        n.boredom -= 0.8;
        e.stress -= 0.002;
        break;
      case 'workout':
        n.fatigue += 0.35;
        n.boredom -= 1;
        e.mood += 0.005;
        e.stress -= 0.005;
        break;
      case 'rest_home':
      case 'stay_home':
        n.fatigue -= 0.22;
        n.boredom += 0.12;
        e.stress -= 0.003;
        break;
      case 'visit':
        n.social -= 1.2;
        n.boredom -= 0.6;
        break;
      case 'wait':
        n.boredom += 0.35;
        break;
      case 'sleep':
        n.fatigue -= 0.5;
        break;
      default:
        break;
    }
    this.clampNeeds(a);
  }

  private clampNeeds(a: AgentState) {
    for (const k of ['hunger', 'fatigue', 'social', 'boredom'] as const) a.needs[k] = Math.max(0, Math.min(100, a.needs[k]));
    a.emotions.mood = Math.max(-1, Math.min(1, a.emotions.mood));
    a.emotions.stress = Math.max(0, Math.min(1, a.emotions.stress));
  }

  private growNeeds() {
    for (const a of Object.values(this.state.agents)) {
      if (a.asleep) {
        a.needs.fatigue = Math.max(0, a.needs.fatigue - 0.3);
        continue;
      }
      const p = this.profiles.get(a.id)!;
      a.needs.hunger += 0.11;
      a.needs.fatigue += 0.05 + 0.03 * (1 - p.traits.vitality);
      a.needs.social += 0.08 * (0.4 + p.traits.sociability);
      a.needs.boredom += 0.06 * (0.4 + p.traits.curiosity);
      a.emotions.mood *= 0.995;
      a.emotions.stress = Math.max(0, a.emotions.stress - 0.002);
      this.clampNeeds(a);
    }
  }

  // ---------------------------------------------------------------------
  // Meetings
  // ---------------------------------------------------------------------

  private handleMeetings() {
    const t = this.state.t;
    const seen = new Set<string>();
    for (const a of Object.values(this.state.agents)) {
      for (const c of a.commitments) {
        // A solo errand whose window closed without being done is missed (cause: the last decision or hold).
        if (c.kind === 'errand' && c.status === 'pending' && t > c.end && !(a.activity?.commitmentId === c.id)) {
          const cause = a.lastDecision?.eventId ?? a.lastArrivalEventId ?? 'e0';
          this.failCommitment(a, c.id, cause, `${this.name(a.id)} n’a pas trouvé le temps`);
          continue;
        }
        if (c.kind !== 'meeting' && c.kind !== 'appointment') continue;
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        const participants = [a.id, ...c.with];
        const copies = participants.map((id) => this.state.agents[id]?.commitments.find((x) => x.id === c.id)).filter((x): x is Commitment => !!x);
        const status = copies.some((x) => x.status === 'cancelled') ? 'cancelled' : c.status;
        if (status !== 'pending' && status !== 'ongoing') {
          if (status === 'cancelled') for (const x of copies) if (x.status === 'pending') x.status = 'cancelled';
        }
        if (status === 'ongoing') {
          if (t >= c.end) this.finishMeeting(c, copies, participants);
          continue;
        }
        if (status !== 'pending') {
          // A cancelled meeting: the others don't know; they wait and eventually miss it.
          if (status === 'cancelled') this.checkMeetingTimeout(c, copies, participants, true);
          continue;
        }
        if (t < c.start - 25) continue;
        const present = participants.filter((id) => {
          const s = this.state.agents[id];
          return s && s.locationId === c.locationId && !s.asleep;
        });
        if (present.length === participants.length && t >= c.start - 5) {
          this.startMeeting(c, copies, participants);
          continue;
        }
        this.checkMeetingTimeout(c, copies, participants, false);
      }
    }
  }

  private startMeeting(c: Commitment, copies: Commitment[], participants: AgentId[]) {
    const t = this.state.t;
    const causes: EventId[] = [];
    for (const id of participants) {
      const s = this.state.agents[id];
      if (s.lastArrivalEventId) causes.push(s.lastArrivalEventId);
      if (s.activity?.action === 'wait' && s.activity.commitmentId === c.id) causes.push(s.activity.startEventId);
    }
    const lateBy = Math.max(0, t - c.start);
    const names = participants.map((id) => this.name(id)).join(' et ');
    const ev = this.emit({
      type: 'meeting_start',
      actors: participants,
      locationId: c.locationId,
      label: `${names} se retrouvent : ${c.label}${lateBy > 0 ? ` (${lateBy} min de retard)` : ''}`,
      causes,
      mechanism: 'Tous les participants sont présents au lieu du rendez-vous',
      data: { commitmentId: c.id, lateBy },
      sig: c.id,
    });
    for (const x of copies) {
      x.status = 'ongoing';
      x.lateBy = lateBy;
    }
    for (const id of participants) {
      const s = this.state.agents[id];
      const others = participants.filter((o) => o !== id);
      const effects: StateChange[] = [];
      for (const o of others) {
        effects.push(this.adjustRelationship(s, o, 0.06));
        s.lastChat[o] = t;
      }
      s.needs.social = Math.max(0, s.needs.social - 25);
      this.mood(s, 0.08, -0.05);
      this.remember(s, ev, `${c.label} avec ${others.map((o) => this.name(o)).join(', ')} à ${fmtTime(t)}`, 0.5, 0.4, others);
      // Participants working at the venue keep working; the others switch to the meeting.
      const working = s.activity && (s.activity.action === 'work' || s.activity.action === 'school') && s.activity.locationId === c.locationId;
      if (!working) {
        s.activity = { action: 'commitment', label: c.label, locationId: c.locationId, since: t, until: Math.max(c.end, t + 15), commitmentId: c.id, withAgent: others[0], startEventId: ev.id, interruptible: false };
        s.plan = null;
      }
      if (c.id === 'c_mireille_dresser' && id === 'mireille') {
        s.inventory.push('dresser');
        s.money -= 40;
        this.state.agents['paul'].money += 40;
      }
    }
  }

  private finishMeeting(c: Commitment, copies: Commitment[], participants: AgentId[]) {
    for (const x of copies) x.status = 'done';
    const starts = participants.map((id) => this.state.agents[id].activity).filter((x) => x && x.commitmentId === c.id).map((x) => x!.startEventId);
    const ev = this.emit({ type: 'meeting_end', actors: participants, locationId: c.locationId, label: `Fin de « ${c.label} »`, causes: starts, data: { commitmentId: c.id }, sig: c.id });
    for (const id of participants) {
      const s = this.state.agents[id];
      s.objectivesDone += 1;
      s.recent.commitment = this.state.t;
      if (s.activity?.commitmentId === c.id && s.activity.action === 'commitment') {
        s.activity = null;
        s.plan = null;
        this.decide(s, ev.id);
      }
    }
  }

  private checkMeetingTimeout(c: Commitment, copies: Commitment[], participants: AgentId[], cancelled: boolean) {
    const t = this.state.t;
    const cancelledIds = new Set(participants.filter((id) => this.state.agents[id]?.commitments.find((x) => x.id === c.id)?.status === 'cancelled'));
    const waiting = participants.filter((id) => {
      const s = this.state.agents[id];
      return s && s.locationId === c.locationId && !s.asleep && !cancelledIds.has(id);
    });
    const absent = participants.filter((id) => !waiting.includes(id));
    // Patience of the people waiting extends the tolerance a little.
    const patience = waiting.length ? Math.max(...waiting.map((id) => this.profiles.get(id)!.traits.patience)) : 0.5;
    const deadline = c.start + c.tolerance + Math.round(patience * 10);
    const nobodyCame = waiting.length === 0 && t >= c.end;
    if (t < deadline && !nobodyCame) return;
    if (copies.every((x) => x.status === 'missed')) return;
    for (const x of copies) if (x.status === 'pending' || x.status === 'cancelled') x.status = 'missed';
    const causes: EventId[] = [];
    const mech: string[] = [];
    for (const id of waiting) {
      const s = this.state.agents[id];
      if (s.activity?.commitmentId === c.id) causes.push(s.activity.startEventId);
      else if (s.lastArrivalEventId) causes.push(s.lastArrivalEventId);
    }
    for (const id of absent) {
      const s = this.state.agents[id];
      const name = this.name(id);
      if (cancelled && cancelledIds.has(id)) {
        const cancel = this.events.filter((e) => e.type === 'commitment_cancelled' && e.actors[0] === id && e.data?.commitmentId === c.id).pop();
        if (cancel) causes.push(cancel.id);
        mech.push(`${name} a renoncé sans prévenir`);
      } else if (s.travel) {
        causes.push(s.travel.departEventId, ...s.travel.legEventIds, ...s.travel.delayEventIds);
        mech.push(`${name} est encore en chemin (parti à ${fmtTime(s.travel.startedAt)}${s.travel.delayEventIds.length ? ', retardé' : ''})`);
      } else if (s.lastDecision) {
        causes.push(s.lastDecision.eventId);
        mech.push(`${name} a choisi « ${s.lastDecision.chosen.label} » (${this.locName(s.locationId)})`);
      }
      if (s.confinedUntil !== undefined && t < s.confinedUntil) {
        const iv = this.events.filter((e) => e.type === 'intervention' && e.actors.includes(id)).pop();
        if (iv) causes.push(iv.id);
        mech.push(`${name} est resté chez lui`);
      }
    }
    const waitingNames = waiting.map((id) => this.name(id)).join(' et ');
    const absentNames = absent.map((id) => this.name(id)).join(' et ');
    const ev = this.emit({
      type: 'meeting_missed',
      actors: participants,
      locationId: c.locationId,
      label: nobodyCame || !waiting.length ? `« ${c.label} » n’a pas lieu : ${absentNames || 'personne'} ${absent.length > 1 ? 'ne sont pas venus' : 'n’est pas venu'}` : `${absentNames} manque${absent.length > 1 ? 'nt' : ''} « ${c.label} » : ${waitingNames} a attendu ${t - Math.min(c.start, t)} min`,
      causes,
      mechanism: mech.join(' ; ') || 'Délai d’attente dépassé',
      data: { commitmentId: c.id, waited: Math.max(0, t - c.start), absent: absent },
      sig: c.id,
    });
    for (const id of waiting) {
      const s = this.state.agents[id];
      const effects: StateChange[] = [];
      for (const o of absent) effects.push(this.adjustRelationship(s, o, -0.15 - (1 - this.profiles.get(id)!.traits.patience) * 0.1));
      effects.push(...this.mood(s, -0.2, 0.12));
      ev.effects.push(...effects);
      this.remember(s, ev, `${absentNames} n’est pas venu : « ${c.label} »`, 0.8, -0.6, absent);
      this.influence(s, ev, 'Rendez-vous manqué');
      if (s.activity?.commitmentId === c.id) {
        s.activity = null;
        s.plan = null;
        this.decide(s, ev.id);
      }
    }
    for (const id of absent) {
      const s = this.state.agents[id];
      this.remember(s, ev, `Manqué : « ${c.label} » avec ${waitingNames || 'personne'}`, 0.6, -0.4, waiting);
      if (s.plan?.commitmentId === c.id && !s.travel) {
        s.plan = null;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Encounters
  // ---------------------------------------------------------------------

  private socialWeight(a: AgentState): number {
    if (a.asleep) return 0;
    if (a.travel) return a.travel.stage === 'waiting' || a.travel.stage === 'riding' ? 1 : 0;
    if (!a.activity) return 1;
    switch (a.activity.action) {
      case 'commitment':
      case 'sleep':
      case 'morning_routine':
        return 0;
      case 'work':
      case 'school':
      case 'drive_bus':
        return 0.3;
      case 'wait':
        return 0.8;
      default:
        return 1;
    }
  }

  private handleEncounters() {
    const t = this.state.t;
    const groups = new Map<string, AgentId[]>();
    for (const a of Object.values(this.state.agents)) {
      if (a.asleep) continue;
      const key = a.travel?.stage === 'riding' && a.travel.busId ? `bus:${a.travel.busId}` : a.locationId ? `loc:${a.locationId}` : null;
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(a.id);
    }
    this.handleStreetEncounters();
    for (const [key, ids] of groups) {
      if (ids.length < 2) continue;
      ids.sort();
      const isBus = key.startsWith('bus:');
      const loc = isBus ? undefined : key.slice(4);
      const kind = loc ? this.city.location(loc).kind : 'bus';
      const base = { cafe: 0.16, park: 0.12, bus_stop: 0.2, bus: 0.18, bakery: 0.12, restaurant: 0.1, library: 0.05, gym: 0.12, home: 0.25, office: 0.07, school: 0.08, supermarket: 0.06, clinic: 0.05, florist: 0.1, workshop: 0.08, townhall: 0.05 }[kind as string] ?? 0.05;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = this.state.agents[ids[i]];
          const b = this.state.agents[ids[j]];
          const last = Math.max(a.lastChat[b.id] ?? -999, b.lastChat[a.id] ?? -999);
          if (t - last < 90) continue;
          const lastAnyA = Math.max(-999, ...Object.values(a.lastChat));
          const lastAnyB = Math.max(-999, ...Object.values(b.lastChat));
          if (t - lastAnyA < 8 || t - lastAnyB < 8) continue;
          const pa = this.profiles.get(a.id)!;
          const pb = this.profiles.get(b.id)!;
          // Shopkeepers chat with their customers over the counter: the shop is their social place.
          const staffA = !!loc && a.activity?.action === 'work' && pa.workplaceId === loc && ['bakery', 'cafe', 'florist', 'supermarket', 'restaurant', 'gym', 'library'].includes(kind as string);
          const staffB = !!loc && b.activity?.action === 'work' && pb.workplaceId === loc && ['bakery', 'cafe', 'florist', 'supermarket', 'restaurant', 'gym', 'library'].includes(kind as string);
          const counter = staffA !== staffB;
          const wa = counter && staffA ? 0.9 : this.socialWeight(a);
          const wb = counter && staffB ? 0.9 : this.socialWeight(b);
          if (wa === 0 || wb === 0) continue;
          const rel = a.relationships[b.id];
          const relFactor = rel ? 0.8 + Math.max(-0.5, rel.affinity) : 0.03 * ((pa.traits.curiosity + pb.traits.curiosity) / 2);
          const p = base * wa * wb * (0.3 + (pa.traits.sociability + pb.traits.sociability) / 2) * relFactor;
          const key2 = `encounter:${a.id}:${b.id}:${t}`;
          if (!this.rng.chance(key2, p)) continue;
          this.converse(a, b, loc ?? null, null, counter ? 'counter' : 'chance', { key: key2, value: this.rng.next(key2) }, isBus ? key.slice(4) : undefined);
        }
      }
    }
  }

  /** Pedestrians crossing paths in the street may stop for a short chat (which delays both). */
  private handleStreetEncounters() {
    const t = this.state.t;
    const walkers = Object.values(this.state.agents).filter((a) => !a.asleep && a.travel && a.locationId === null && ['walking', 'to_stop', 'from_stop'].includes(a.travel.stage) && !(a.travel.pausedUntil !== undefined && t < a.travel.pausedUntil));
    walkers.sort((x, y) => x.id.localeCompare(y.id));
    for (let i = 0; i < walkers.length; i++) {
      for (let j = i + 1; j < walkers.length; j++) {
        const a = walkers[i];
        const b = walkers[j];
        if (Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) > 20) continue;
        const last = Math.max(a.lastChat[b.id] ?? -999, b.lastChat[a.id] ?? -999);
        if (t - last < 90) continue;
        const lastAnyA = Math.max(-999, ...Object.values(a.lastChat));
        const lastAnyB = Math.max(-999, ...Object.values(b.lastChat));
        if (t - lastAnyA < 8 || t - lastAnyB < 8) continue;
        const pa = this.profiles.get(a.id)!;
        const pb = this.profiles.get(b.id)!;
        const rel = a.relationships[b.id];
        const relFactor = rel ? 0.8 + Math.max(-0.5, rel.affinity) : 0.02 * ((pa.traits.curiosity + pb.traits.curiosity) / 2);
        // Hurried people (a due commitment) rarely stop.
        const hurryA = a.plan?.commitmentId ? 0.4 : 1;
        const hurryB = b.plan?.commitmentId ? 0.4 : 1;
        const p = 0.45 * hurryA * hurryB * (0.3 + (pa.traits.sociability + pb.traits.sociability) / 2) * relFactor;
        const key = `street:${a.id}:${b.id}:${t}`;
        if (!this.rng.chance(key, p)) continue;
        const ev = this.converse(a, b, null, null, 'chance', { key, value: this.rng.next(key) });
        if (!ev) continue;
        for (const w of [a, b]) {
          if (!w.travel) continue;
          w.travel.pausedUntil = t + 2;
          w.travel.expectedArrival += 2;
          w.travel.delayEventIds.push(ev.id);
        }
      }
    }
  }

  /** A conversation between two inhabitants, with relationship effects and possible plan changes. */
  private converse(a: AgentState, b: AgentState, loc: LocationId | null, cause: EventId | null, how: 'chance' | 'visit' | 'counter', draw?: RandomDraw, busId?: string): SimEvent | null {
    const t = this.state.t;
    const pa = this.profiles.get(a.id)!;
    const pb = this.profiles.get(b.id)!;
    const relA = a.relationships[b.id];
    const relB = b.relationships[a.id];
    const stranger = !relA;
    const where = busId ? `dans le bus ${busId}` : loc ? (how === 'counter' ? `au comptoir de ${this.locName(loc)}` : `à ${this.locName(loc)}`) : 'dans la rue';
    const presenceCauses = [cause, a.lastArrivalEventId, b.lastArrivalEventId, a.travel?.legEventIds.at(-1), b.travel?.legEventIds.at(-1), a.travel?.departEventId, b.travel?.departEventId];
    a.lastChat[b.id] = t;
    b.lastChat[a.id] = t;

    const busyKinds = new Set(['work', 'school', 'commitment', 'drive_bus', 'morning_routine']);
    const busy = (x: AgentState) => (!!x.activity && busyKinds.has(x.activity.action)) || (x.heldUntil !== undefined && t < x.heldUntil);
    // Over a counter, people exchange a few words, never a deep conversation.
    const bothFree = how !== 'counter' && !busy(a) && !busy(b);
    let type: EventType = 'encounter';
    let label = `${pa.firstName} et ${pb.firstName} discutent ${where}`;
    let mechanism = how === 'visit' ? `${pa.firstName} est venu retrouver ${pb.firstName}` : how === 'counter' ? 'Échange au comptoir entre le commerçant et son client (graine aléatoire)' : 'Présents au même endroit au même moment (graine aléatoire)';
    let dA = 0.05;
    let dB = 0.05;
    let moodA = 0.05;
    let moodB = 0.05;
    let importance = 0.45;
    let memA = `Discussion avec ${pb.firstName} ${where}`;
    let memB = `Discussion avec ${pa.firstName} ${where}`;
    const draws: RandomDraw[] = draw ? [draw] : [];

    if (stranger) {
      label = `${pa.firstName} fait la connaissance de ${pb.firstName} ${where}`;
      a.relationships[b.id] = { to: b.id, kind: 'acquaintance', affinity: 0.1 };
      b.relationships[a.id] = { to: a.id, kind: 'acquaintance', affinity: 0.1 };
      dA = 0;
      dB = 0;
      importance = 0.55;
      memA = `Rencontré ${pb.firstName} ${where}`;
      memB = `Rencontré ${pa.firstName} ${where}`;
    } else {
      const kindA = relA.kind;
      const kindB = relB?.kind;
      const outcomeKey = `chat:${a.id}:${b.id}:${t}`;
      const roll = this.rng.next(outcomeKey);
      draws.push({ key: outcomeKey, value: roll });
      if (kindA === 'ex' || kindB === 'ex') {
        if (bothFree && roll < 0.3 && a.emotions.mood > 0 && b.emotions.mood > 0) {
          type = 'conversation';
          label = `Retrouvailles : ${pa.firstName} et ${pb.firstName} se parlent longuement ${where}`;
          dA = 0.25;
          dB = 0.25;
          moodA = 0.35;
          moodB = 0.35;
          importance = 0.9;
          memA = `Retrouvailles avec ${pb.firstName} ${where}… et si ?`;
          memB = `Retrouvailles avec ${pa.firstName} ${where}… et si ?`;
          mechanism += ' ; les deux étaient de bonne humeur';
        } else if (roll > 0.65) {
          type = 'argument';
          label = `${pa.firstName} et ${pb.firstName} se disputent ${where}`;
          dA = -0.15;
          dB = -0.15;
          moodA = -0.25;
          moodB = -0.25;
          importance = 0.8;
          memA = `Dispute avec ${pb.firstName} ${where}`;
          memB = `Dispute avec ${pa.firstName} ${where}`;
        } else {
          label = `${pa.firstName} et ${pb.firstName} échangent quelques mots gênés ${where}`;
          dA = 0.03;
          dB = 0.03;
          moodA = -0.03;
          moodB = -0.03;
          importance = 0.6;
        }
      } else if (kindA === 'rival' || relA.affinity < 0 || (relB && relB.affinity < 0)) {
        if (roll < 0.5) {
          type = 'argument';
          label = `${pa.firstName} et ${pb.firstName} s’accrochent ${where}`;
          dA = -0.1;
          dB = -0.1;
          moodA = -0.2;
          moodB = -0.2;
          importance = 0.75;
          memA = `Accrochage avec ${pb.firstName} ${where}`;
          memB = `Accrochage avec ${pa.firstName} ${where}`;
        } else {
          label = `${pa.firstName} et ${pb.firstName} s’ignorent poliment ${where}`;
          dA = 0.02;
          dB = 0.02;
          moodA = 0;
          moodB = 0;
          importance = 0.3;
        }
      } else if (kindA === 'crush' || kindB === 'crush') {
        const admirer = kindA === 'crush' ? a : b;
        const pAdm = this.profiles.get(admirer.id)!;
        if (bothFree && roll < 0.2 + pAdm.traits.sociability * 0.25) {
          type = 'conversation';
          label = `${pAdm.firstName} ose enfin une vraie conversation avec ${admirer === a ? pb.firstName : pa.firstName} ${where}`;
          dA = 0.15;
          dB = 0.15;
          moodA = 0.3;
          moodB = 0.2;
          importance = 0.85;
          memA = admirer === a ? `J’ai osé parler à ${pb.firstName} ${where} !` : `${pa.firstName} m’a fait la conversation ${where}`;
          memB = admirer === b ? `J’ai osé parler à ${pa.firstName} ${where} !` : `${pb.firstName} m’a fait la conversation ${where}`;
        } else {
          label = `${pa.firstName} et ${pb.firstName} échangent un sourire et quelques mots ${where}`;
          dA = 0.04;
          dB = 0.04;
        }
      } else if (kindA === 'boss' || kindA === 'employee') {
        label = `${pa.firstName} et ${pb.firstName} parlent boulot ${where}`;
        dA = 0.03;
        dB = 0.03;
        moodA = 0.02;
        moodB = 0.02;
        importance = 0.3;
      } else {
        const bonus = 0.04 + 0.04 * ((pa.traits.sociability + pb.traits.sociability) / 2);
        dA = bonus;
        dB = bonus;
        if (relA.affinity > 0.6) {
          label = `${pa.firstName} et ${pb.firstName} bavardent joyeusement ${where}`;
          moodA = 0.12;
          moodB = 0.12;
          if (bothFree && (how === 'visit' ? roll < 0.5 : roll < 0.3)) {
            type = 'conversation';
            label = `${pa.firstName} et ${pb.firstName} ont une vraie conversation ${where}`;
            importance = 0.6;
            dA += 0.04;
            dB += 0.04;
            memA = `Vraie conversation avec ${pb.firstName} ${where}`;
            memB = `Vraie conversation avec ${pa.firstName} ${where}`;
          }
        }
      }
    }

    const effects: StateChange[] = [];
    if (dA) effects.push(this.adjustRelationship(a, b.id, dA));
    if (dB) effects.push(this.adjustRelationship(b, a.id, dB));
    effects.push(...this.mood(a, moodA, type === 'argument' ? 0.12 : -0.03), ...this.mood(b, moodB, type === 'argument' ? 0.12 : -0.03));
    a.needs.social = Math.max(0, a.needs.social - 30);
    b.needs.social = Math.max(0, b.needs.social - 30);

    const ev = this.emit({ type, actors: [a.id, b.id], locationId: loc ?? undefined, busId, label, causes: presenceCauses, mechanism, effects, randomDraws: draws, importance, sig: busId ?? '' });
    this.remember(a, ev, memA, importance, moodA, [b.id]);
    this.remember(b, ev, memB, importance, moodB, [a.id]);
    this.influence(a, ev, `Conversation avec ${pb.firstName}`);
    this.influence(b, ev, `Conversation avec ${pa.firstName}`);
    if (type !== 'argument') this.shareSecrets(a, b, ev, type === 'conversation');

    // Returning a found wallet
    for (const [x, y] of [[a, b], [b, a]] as [AgentState, AgentState][]) {
      const item = x.inventory.find((i) => i === `wallet_of:${y.id}`);
      if (!item) continue;
      x.inventory = x.inventory.filter((i) => i !== item);
      y.inventory.push('wallet');
      const ret = this.emit({ type: 'return_item', actors: [x.id, y.id], locationId: loc ?? undefined, busId, label: `${this.name(x.id)} rend son portefeuille à ${this.name(y.id)}`, causes: [ev.id], mechanism: 'Le trouveur et le propriétaire se rencontrent', effects: [this.adjustRelationship(y, x.id, 0.3), this.adjustRelationship(x, y.id, 0.1), ...this.mood(y, 0.4, -0.3)], sig: `${x.id}>${y.id}` });
      this.remember(y, ret, `${this.name(x.id)} m’a rendu mon portefeuille !`, 0.9, 0.8, [x.id]);
      this.remember(x, ret, `Rendu le portefeuille à ${this.name(y.id)}`, 0.7, 0.5, [y.id]);
      for (const c of x.commitments) if (c.id === `return_${y.id}_${x.id}` && c.status === 'pending') { c.status = 'done'; x.objectivesDone += 1; }
      for (const c of y.commitments) if (c.id === `wallet_${y.id}` && c.status === 'pending') { c.status = 'done'; y.objectivesDone += 1; }
    }

    // Spontaneous invitation: an impulsive, free inhabitant joins the other's pleasant activity.
    if (type !== 'argument' && how === 'chance' && !stranger) {
      for (const [host, guest] of [[a, b], [b, a]] as [AgentState, AgentState][]) {
        const hostAct = host.activity;
        if (!hostAct || !['coffee', 'eat_cafe', 'eat_restaurant', 'relax_park', 'eat_bakery'].includes(hostAct.action)) continue;
        if (guest.activity && !guest.activity.interruptible) continue;
        if (guest.travel) continue;
        if (guest.activity?.locationId === hostAct.locationId && guest.activity.action === hostAct.action) continue;
        const pg = this.profiles.get(guest.id)!;
        const next = guest.commitments.filter((c) => c.status === 'pending' && c.start > t).sort((x, y) => x.start - y.start)[0];
        if (next && next.start - t < 35) continue;
        const key = `invite:${host.id}:${guest.id}:${t}`;
        const pInvite = pg.traits.impulsivity * 0.5 * (0.5 + (guest.relationships[host.id]?.affinity ?? 0));
        if (!this.rng.chance(key, pInvite)) continue;
        const prevLabel = guest.activity?.label ?? 'ses plans';
        if (guest.activity) guest.activity = null;
        guest.plan = null;
        const inv = this.emit({
          type: 'invitation',
          actors: [host.id, guest.id],
          locationId: loc ?? undefined,
          label: `${this.name(guest.id)} laisse tomber « ${prevLabel} » pour rejoindre ${this.name(host.id)} (${hostAct.label.toLowerCase()})`,
          causes: [ev.id],
          mechanism: `Impulsivité de ${pg.firstName} (${Math.round(pg.traits.impulsivity * 100)} %) après la conversation`,
          randomDraws: [{ key, value: this.rng.next(key) }],
          data: { from: prevLabel, to: hostAct.action },
          sig: `${host.id}>${guest.id}`,
        });
        this.influence(guest, inv, `Invitation de ${this.name(host.id)}`);
        const cand: Candidate = { action: hostAct.action, label: `${ACTION_LABELS[hostAct.action]} avec ${this.name(host.id)}`, locationId: hostAct.locationId, duration: Math.max(10, hostAct.until - t), score: 1, components: [{ label: `Invitation de ${this.name(host.id)}`, value: 1 }], withAgent: host.id, travelMinutes: 0, mode: 'walk' };
        this.applyDecision(guest, { chosen: cand, candidates: [cand], reasons: [`Invitation de ${this.name(host.id)}`] }, inv.id);
        break;
      }
    }
    return ev;
  }

  // ---------------------------------------------------------------------
  // Dramaturgy
  // ---------------------------------------------------------------------

  /** Secrets travel through conversations: the owner confides, holders gossip. */
  private shareSecrets(a: AgentState, b: AgentState, conv: SimEvent, deep: boolean) {
    const t = this.state.t;
    if (!this.state.arcs) return;
    for (const [owner, listener] of [[a, b], [b, a]] as [AgentState, AgentState][]) {
      const arc = arcOf(this.state, owner.id);
      if (!arc) continue;
      const seed = arcSeed(arc.seedId);
      if (!seed.secret || arc.knownBy.includes(listener.id) || seed.secretAbout === listener.id) continue;
      const po = this.profiles.get(owner.id)!;
      const key = `reveal:${arc.id}:${listener.id}:${t}`;
      const p = revealChance(owner, po, listener.id, deep);
      if (p <= 0 || !this.rng.chance(key, p)) continue;
      arc.knownBy.push(listener.id);
      const ev = this.emit({
        type: 'revelation',
        actors: [owner.id, listener.id],
        locationId: conv.locationId,
        busId: conv.busId,
        label: `${po.firstName} se confie à ${this.name(listener.id)} : ${seed.secret}`,
        causes: [conv.id],
        mechanism: `${deep ? 'Vraie conversation' : 'Discussion'} et confiance (affinité ${(owner.relationships[listener.id]?.affinity ?? 0).toFixed(2)})`,
        randomDraws: [{ key, value: this.rng.next(key) }],
        effects: [this.adjustRelationship(listener, owner.id, 0.08), this.adjustRelationship(owner, listener.id, 0.05), ...this.mood(owner, 0.05, -0.08)],
        data: { arcId: arc.id, secretAbout: seed.secretAbout },
        sig: `${arc.id}>${listener.id}`,
      });
      arc.beats.push(ev.id);
      this.remember(listener, ev, `${po.firstName} m’a confié un secret : ${seed.secret}`, 0.8, 0.2, [owner.id]);
      this.remember(owner, ev, `J’ai confié mon secret à ${this.name(listener.id)}`, 0.6, 0.1, [listener.id]);
    }
    // Gossip: a holder passes on a third party's secret.
    for (const [holder, listener] of [[a, b], [b, a]] as [AgentState, AgentState][]) {
      const ph = this.profiles.get(holder.id)!;
      for (const arc of secretsToSpread(this.state, holder.id, listener.id)) {
        const seed = arcSeed(arc.seedId);
        const key = `gossip:${arc.id}:${holder.id}:${listener.id}:${t}`;
        if (!this.rng.chance(key, gossipChance(ph, listener, holder.id))) continue;
        arc.knownBy.push(listener.id);
        const source = this.events.filter((e) => (e.type === 'revelation' || e.type === 'gossip') && e.actors[1] === holder.id && e.data?.arcId === arc.id).pop();
        const owner = this.state.agents[arc.agentId];
        const reachesTarget = seed.secretAbout === listener.id;
        const ev = this.emit({
          type: 'gossip',
          actors: [holder.id, listener.id],
          locationId: conv.locationId,
          busId: conv.busId,
          label: `${ph.firstName} rapporte à ${this.name(listener.id)} le secret de ${this.name(arc.agentId)} : ${seed.secret}`,
          causes: [conv.id, source?.id],
          mechanism: `Curiosité de ${ph.firstName} (${Math.round(ph.traits.curiosity * 100)} %) et discrétion limitée (${Math.round(ph.traits.honesty * 100)} %)`,
          randomDraws: [{ key, value: this.rng.next(key) }],
          data: { arcId: arc.id, about: arc.agentId, reachesTarget },
          importance: reachesTarget ? 0.85 : 0.65,
          gravity: reachesTarget ? 2 : 1,
          sig: `${arc.id}:${holder.id}>${listener.id}`,
        });
        arc.beats.push(ev.id);
        this.remember(listener, ev, `${ph.firstName} m’a raconté : ${seed.secret}`, reachesTarget ? 0.9 : 0.6, reachesTarget ? -0.5 : 0, [arc.agentId, holder.id]);
        if (reachesTarget) {
          // The secret reaches the very person it was kept from: a twist for the owner's arc.
          const effects: StateChange[] = [this.adjustRelationship(listener, arc.agentId, -0.12), ...this.mood(listener, -0.15, 0.1)];
          ev.effects.push(...effects);
          this.influence(listener, ev, `A appris le secret de ${this.name(arc.agentId)}`);
          if (arc.status === 'open' || arc.status === 'advancing') {
            this.resolveArc(arc, 'twisted', `${this.name(listener.id)} apprend par ${ph.firstName} ce que ${this.name(arc.agentId)} lui cachait`, 'Le secret a atteint la personne concernée par la rumeur', [ev.id], conv.locationId);
          } else {
            // The arc is already closed: the leak is an aftershock, not a new resolution.
            const after = this.emit({ type: 'arc_beat', actors: [arc.agentId, listener.id], locationId: conv.locationId, busId: conv.busId, label: `Contrecoup — ${seed.title} : ${this.name(listener.id)} apprend par ${ph.firstName} ce que ${this.name(arc.agentId)} lui cachait`, causes: [ev.id, arc.resolutionEventId], mechanism: 'Le secret a atteint la personne concernée après la fin de l’histoire', importance: 0.7, data: { arcId: arc.id, aftershock: true }, sig: `${arc.id}:aftershock` });
            arc.beats.push(after.id);
          }
          if (owner) this.mood(owner, 0, 0.1);
        }
      }
    }
  }

  /** Turn the minute's events into arc beats and resolve arcs whose deadline passed. */
  private processDrama(fromIndex: number) {
    if (!this.state.arcs) this.state.arcs = initialArcs();
    const t = this.state.t;
    const minuteEvents = this.events.slice(fromIndex);
    for (const arc of Object.values(this.state.arcs)) {
      if (arc.status !== 'open' && arc.status !== 'advancing') continue;
      for (const ev of minuteEvents) {
        const beat = evaluateBeat(arc, ev, this.state, this.profiles);
        if (!beat) continue;
        this.applyBeat(beat, ev);
        if (arc.status !== 'open' && arc.status !== 'advancing') break;
      }
      if ((arc.status === 'open' || arc.status === 'advancing') && t >= arcDeadline(arc)) {
        const out = deadlineOutcome(arc, this.state, this.profiles);
        if (!out) continue;
        const a = this.state.agents[arc.agentId];
        const causes: EventId[] = [arc.beats.at(-1), a?.lastDecision?.eventId, a?.lastArrivalEventId].filter((x): x is EventId => !!x);
        this.resolveArc(arc, out.outcome, out.text, out.mechanism, causes, a?.locationId ?? undefined);
      }
    }
  }

  private applyBeat(beat: Beat, ev: SimEvent) {
    const arc = beat.arc;
    const seed = arcSeed(arc.seedId);
    if (seed.goal.type === 'conversations') arc.count += 1;
    if (beat.outcome) {
      arc.progress = beat.progress;
      this.resolveArc(arc, beat.outcome, beat.text, beat.mechanism, [ev.id], ev.locationId);
      return;
    }
    arc.progress = Math.max(arc.progress, beat.progress);
    arc.status = 'advancing';
    const b = this.emit({ type: 'arc_beat', actors: [arc.agentId], locationId: ev.locationId, busId: ev.busId, label: beat.text, causes: [ev.id], mechanism: beat.mechanism, importance: beat.importance, data: { arcId: arc.id, progress: Number(arc.progress.toFixed(2)) }, sig: `${arc.id}:${Math.round(arc.progress * 10)}` });
    arc.beats.push(b.id);
  }

  private resolveArc(arc: ArcState, outcome: 'fulfilled' | 'failed' | 'twisted', text: string, mechanism: string, causes: EventId[], locationId?: LocationId) {
    const seed = arcSeed(arc.seedId);
    const a = this.state.agents[arc.agentId];
    const stakes = effectiveStakes(arc);
    arc.status = outcome;
    arc.resolvedAt = this.state.t;
    if (outcome === 'fulfilled') arc.progress = 1;
    const effects: StateChange[] = a ? (outcome === 'fulfilled' ? this.mood(a, 0.25 * stakes + 0.1, -0.15 * stakes) : outcome === 'failed' ? this.mood(a, -(0.25 * stakes + 0.1), 0.2 * stakes) : this.mood(a, -0.1, 0.25 * stakes)) : [];
    const word = outcome === 'fulfilled' ? 'Accompli' : outcome === 'failed' ? 'Échec' : 'Coup de théâtre';
    const ev = this.emit({
      type: 'arc_resolved',
      actors: [arc.agentId],
      locationId,
      label: `${word} — ${seed.title} : ${text}`,
      description: `${seed.desire} ${seed.tension}`,
      causes,
      mechanism,
      effects,
      importance: outcome === 'twisted' ? 0.95 : 0.8 + 0.15 * stakes,
      gravity: outcome === 'twisted' || stakes >= 0.7 ? 3 : 2,
      data: { arcId: arc.id, outcome, stakes: Number(stakes.toFixed(2)), attempt: arc.attempt },
      sig: `${arc.id}:${outcome}`,
    });
    arc.beats.push(ev.id);
    arc.resolutionEventId = ev.id;
    if (a) {
      this.remember(a, ev, `${word} : ${seed.title.toLowerCase()} — ${text}`, 0.7 + 0.2 * stakes, outcome === 'fulfilled' ? 0.7 : -0.6, []);
      this.influence(a, ev, `${word} : ${seed.title.toLowerCase()}`);
    }
  }

  // ---------------------------------------------------------------------
  // Locations
  // ---------------------------------------------------------------------

  private updateLocations() {
    const t = this.state.t;
    // Background bakery sales (customers who are not simulated inhabitants).
    const bakery = this.state.locations['bakery'];
    if (bakery && bakery.stock > 0 && bakery.closedEarlyAt === undefined && t >= 7 * 60 && t < 19 * 60 && t % 12 === 0) {
      bakery.stock -= 1;
      if (bakery.stock === 0) {
        const last = this.events.filter((e) => e.type === 'purchase' && e.locationId === 'bakery').slice(-3).map((e) => e.id);
        const ev = this.emit({ type: 'purchase', actors: [], locationId: 'bakery', label: 'Un client de passage achète la dernière baguette', causes: last, mechanism: 'Ventes de fond continues + achats des habitants', sig: 'last' });
        this.closeShop('bakery', ev.id, 'Tout est vendu');
      }
    }
    // Scheduled closures (intervention or opening hours) evict people inside.
    for (const ls of Object.values(this.state.locations)) {
      const def = this.city.location(ls.id);
      if (def.kind === 'home' || def.kind === 'bus_stop') continue;
      const closes = ls.closes ?? def.closes;
      if (closes === undefined || t !== closes) continue;
      if (ls.closedEarlyEventId && ls.closedEarlyAt === t) {
        // Intervention closure: announce it.
        const ev = this.emit({ type: 'shop_closed', actors: [], locationId: ls.id, label: `${def.name} ferme ses portes (${fmtTime(t)})`, causes: [ls.closedEarlyEventId], mechanism: 'Fermeture imposée par l’intervention', sig: ls.id, interventionId: this.interventionIdForEvent(ls.closedEarlyEventId) });
        ls.closedEarlyEventId = ev.id;
      }
      for (const a of Object.values(this.state.agents)) {
        if (a.locationId !== ls.id || !a.activity || a.asleep) continue;
        // Someone held here (an urgent case at the clinic, a delivery…) stays after closing time.
        if (a.heldUntil !== undefined && t < a.heldUntil) continue;
        const c = a.activity.commitmentId ? a.commitments.find((x) => x.id === a.activity!.commitmentId) : undefined;
        if (c && (c.kind === 'work' || c.kind === 'shift' || c.kind === 'school')) {
          if (c.end > t) {
            c.status = 'done';
            a.objectivesDone += 1;
            const ev = this.emit({ type: 'work_end', actors: [a.id], locationId: ls.id, label: `${this.name(a.id)} termine plus tôt : ${def.name} ferme`, causes: [ls.closedEarlyEventId], sig: c.id });
            a.activity = null;
            this.influence(a, ev, `${def.name} ferme`);
            this.decide(a, ev.id);
          }
          continue;
        }
        if (a.activity.interruptible || a.activity.action === 'wait') {
          this.influence(a, ls.closedEarlyEventId ? { id: ls.closedEarlyEventId } as SimEvent : ({ id: a.activity.startEventId } as SimEvent), `${def.name} ferme`);
          this.endActivity(a, ls.closedEarlyEventId ?? null, 'le lieu ferme');
        }
      }
    }
  }
}

/** Plan a bus trip with the engine's static data (helper kept outside the class for testing). */
export function planBusTripSafe(engine: Engine, fromNode: string, dest: LocationId, t: Minute, speed: number) {
  const line = engine.city.lines[0];
  // Lazy import to avoid a circular reference at module evaluation.
  return planBusTripImpl(engine, line.id, fromNode, dest, t, speed);
}

import { planBusTrip } from './bus';
function planBusTripImpl(engine: Engine, lineId: string, fromNode: string, dest: LocationId, t: Minute, speed: number) {
  const line = engine.city.lines.find((l) => l.id === lineId)!;
  return planBusTrip(engine.city, engine.timetable, line, fromNode, dest, t, speed);
}
