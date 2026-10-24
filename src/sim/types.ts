/**
 * BUTTERFLY — core simulation types.
 *
 * Everything in the simulation layer is plain, serialisable data so that the
 * world state can be cloned (snapshots), replayed and compared between realities.
 * Time is expressed in minutes since midnight; the simulated day runs from 06:00
 * (t = 360) to 24:00 (t = 1440), one discrete step per simulated minute.
 */

export type Minute = number;
export type AgentId = string;
export type LocationId = string;
export type NodeId = string;
export type EventId = string;

export const DAY_START: Minute = 6 * 60; // 06:00
export const DAY_END: Minute = 24 * 60; // 24:00
export const DAY_LENGTH = DAY_END - DAY_START; // 1080 steps

export interface Vec2 {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// City
// ---------------------------------------------------------------------------

export type LocationKind =
  | 'home'
  | 'cafe'
  | 'bakery'
  | 'supermarket'
  | 'park'
  | 'office'
  | 'school'
  | 'library'
  | 'restaurant'
  | 'clinic'
  | 'workshop'
  | 'florist'
  | 'gym'
  | 'townhall'
  | 'bus_stop';

export interface LocationDef {
  id: LocationId;
  name: string;
  kind: LocationKind;
  /** Street node acting as the entrance. */
  node: NodeId;
  /** Centre of the footprint (metres). */
  pos: Vec2;
  /** Footprint size (metres). */
  size: Vec2;
  /** Height of the building for rendering (metres). */
  height: number;
  color: string;
  /** Opening hours in clock minutes. Undefined = always open. */
  opens?: Minute;
  closes?: Minute;
  /** Maximum simultaneous visitors (shared resource constraint). */
  capacity?: number;
  /** Initial stock for shops that can sell out (bakery). */
  stock?: number;
}

export interface CityNode {
  id: NodeId;
  pos: Vec2;
}

export interface CityEdge {
  a: NodeId;
  b: NodeId;
  length: number;
}

export interface BusLineDef {
  id: string;
  name: string;
  color: string;
  /** Ordered loop of bus stop location ids (the loop returns to the first stop). */
  stops: LocationId[];
  /** First departure from the terminal (clock minutes). */
  firstDeparture: Minute;
  /** Last departure from the terminal (clock minutes). */
  lastDeparture: Minute;
  /** Minutes spent at each stop. */
  dwell: Minute;
  /** Metres per minute. */
  speed: number;
  /** Capacity in passengers. */
  capacity: number;
}

// ---------------------------------------------------------------------------
// Inhabitants
// ---------------------------------------------------------------------------

export interface Traits {
  /** 0 = always late / careless, 1 = extremely punctual. */
  punctuality: number;
  sociability: number;
  impulsivity: number;
  curiosity: number;
  ambition: number;
  patience: number;
  honesty: number;
  frugality: number;
  /** Baseline vitality: early birds have high values. */
  vitality: number;
}

export type TraitName = keyof Traits;

export interface Needs {
  /** 0 = sated, 100 = starving. */
  hunger: number;
  /** 0 = rested, 100 = exhausted. */
  fatigue: number;
  /** 0 = socially fulfilled, 100 = lonely. */
  social: number;
  /** 0 = entertained, 100 = bored. */
  boredom: number;
}

export type NeedName = keyof Needs;

export interface Emotions {
  /** -1 (miserable) .. 1 (joyful). */
  mood: number;
  /** 0 (serene) .. 1 (overwhelmed). */
  stress: number;
}

export type RelationshipKind =
  | 'friend'
  | 'partner'
  | 'ex'
  | 'colleague'
  | 'family'
  | 'neighbor'
  | 'acquaintance'
  | 'rival'
  | 'boss'
  | 'employee'
  | 'crush'
  | 'patient'
  | 'doctor'
  | 'teacher'
  | 'student';

export interface Relationship {
  to: AgentId;
  kind: RelationshipKind;
  /** -1 (hostile) .. 1 (deep affection). */
  affinity: number;
  /** Last minute an interaction happened, if any. */
  lastInteraction?: Minute;
}

export interface Memory {
  t: Minute;
  text: string;
  eventId: EventId;
  /** 0..1 */
  importance: number;
  about: AgentId[];
  /** Positive or negative colouring of the memory, -1..1. */
  valence: number;
}

export type CommitmentKind = 'work' | 'school' | 'meeting' | 'appointment' | 'errand' | 'shift';

export interface Commitment {
  id: string;
  kind: CommitmentKind;
  label: string;
  locationId: LocationId;
  start: Minute;
  end: Minute;
  /** Other participants (for meetings). */
  with: AgentId[];
  /** Minutes the other party is willing to wait before considering the meeting missed. */
  tolerance: Minute;
  status: 'pending' | 'ongoing' | 'done' | 'missed' | 'cancelled';
  /** Minutes of lateness at arrival (set when the commitment starts). */
  lateBy?: Minute;
}

export interface Routine {
  wake: Minute;
  bedtime: Minute;
  workStart?: Minute;
  workEnd?: Minute;
  lunch?: Minute;
}

export interface Preferences {
  favoriteFood: 'bakery' | 'cafe' | 'restaurant' | 'home';
  favoritePlace: LocationId;
  /** 0 = hates the bus, 1 = always prefers the bus. */
  busAffinity: number;
  /** Tendency to lose things / forget. */
  distraction: number;
}

export interface AgentProfile {
  id: AgentId;
  name: string;
  firstName: string;
  age: number;
  occupation: string;
  homeId: LocationId;
  workplaceId?: LocationId;
  traits: Traits;
  goals: string[];
  bio: string;
  color: string;
  routine: Routine;
  preferences: Preferences;
  /** Initial relationships (copied into the dynamic state). */
  relationships: Relationship[];
  /** Initial money in euros. */
  money: number;
  /** Where the agent is at 06:00 (defaults to home). */
  startLocationId?: LocationId;
}

export type ActionType =
  | 'sleep'
  | 'morning_routine'
  | 'work'
  | 'school'
  | 'commitment'
  | 'eat_home'
  | 'eat_bakery'
  | 'eat_cafe'
  | 'eat_restaurant'
  | 'coffee'
  | 'shop_groceries'
  | 'relax_park'
  | 'read_library'
  | 'workout'
  | 'rest_home'
  | 'visit'
  | 'stroll'
  | 'drive_bus'
  | 'stay_home'
  | 'wait';

export type TravelMode = 'walk' | 'bus';

export interface ScoreComponent {
  label: string;
  value: number;
}

export interface Candidate {
  action: ActionType;
  label: string;
  locationId: LocationId;
  duration: Minute;
  score: number;
  components: ScoreComponent[];
  commitmentId?: string;
  withAgent?: AgentId;
  /** Hard constraint that excluded the candidate, if any. */
  rejected?: string;
  travelMinutes: Minute;
  mode: TravelMode;
}

export interface DecisionRecord {
  t: Minute;
  eventId: EventId;
  chosen: Candidate;
  candidates: Candidate[];
  /** Event ids that influenced the decision (causal inputs). */
  influences: EventId[];
  /** Short French explanation of the dominating factors. */
  reasons: string[];
}

export interface Plan {
  action: ActionType;
  label: string;
  locationId: LocationId;
  /** Planned duration once at the location (minutes). */
  duration: Minute;
  commitmentId?: string;
  withAgent?: AgentId;
  decisionEventId: EventId;
  interruptible: boolean;
  mode: TravelMode;
  createdAt: Minute;
}

export type TravelStage = 'walking' | 'to_stop' | 'waiting' | 'riding' | 'from_stop';

export interface Travel {
  stage: TravelStage;
  destinationId: LocationId;
  /** Remaining polyline for the current walking segment. */
  path: Vec2[];
  /** Distance already walked along the current path. */
  progress: number;
  pathLength: number;
  /** Bus specifics. */
  boardStopId?: LocationId;
  alightStopId?: LocationId;
  busId?: string;
  waitingSince?: Minute;
  departEventId: EventId;
  startedAt: Minute;
  /** Arrival estimated when the trip was planned (used to detect delays). */
  expectedArrival: Minute;
  /** Delay events that affected this trip (causal inputs for the arrival). */
  delayEventIds: EventId[];
  /** Events of the trip (board / alight) for causal chaining. */
  legEventIds: EventId[];
  /** The walker stopped to chat until this minute. */
  pausedUntil?: Minute;
}

export interface Activity {
  action: ActionType;
  label: string;
  locationId: LocationId;
  since: Minute;
  until: Minute;
  commitmentId?: string;
  withAgent?: AgentId;
  startEventId: EventId;
  interruptible: boolean;
}

export interface Influence {
  eventId: EventId;
  reason: string;
}

export interface AgentState {
  id: AgentId;
  /** Null while travelling. */
  locationId: LocationId | null;
  pos: Vec2;
  needs: Needs;
  emotions: Emotions;
  money: number;
  relationships: Record<AgentId, Relationship>;
  memories: Memory[];
  commitments: Commitment[];
  plan: Plan | null;
  travel: Travel | null;
  activity: Activity | null;
  lastDecision: DecisionRecord | null;
  /** Events that changed the agent's situation since the last decision. */
  influences: Influence[];
  awake: boolean;
  asleep: boolean;
  /** Inventory items (e.g. 'wallet', 'bread', 'flowers'). */
  inventory: string[];
  groceries: number;
  minutesWorked: number;
  lastArrivalEventId: EventId | null;
  /** The agent must stay home until this minute (intervention). */
  confinedUntil?: Minute;
  /** Forced action injected by an intervention, consumed at the next decision. */
  forcedPlan?: { action: ActionType; locationId?: LocationId; t: Minute; interventionEventId: EventId; label: string; withAgent?: AgentId };
  /** Timestamp of the latest interaction with each agent (to avoid chatter spam). */
  lastChat: Record<AgentId, Minute>;
  /** Count of completed objectives (commitments done). */
  objectivesDone: number;
  /** Minute at which each action was last completed (avoids repeating the same thing). */
  recent: Partial<Record<ActionType, Minute>>;
  /** Minute of the last movement step (prevents moving twice in one minute). */
  movedAt?: Minute;
  /** Locations the agent has found closed today (they will not try again). */
  knownClosed?: LocationId[];
}

// ---------------------------------------------------------------------------
// Buses
// ---------------------------------------------------------------------------

export interface BusState {
  id: string;
  lineId: string;
  pos: Vec2;
  /** Index of the next stop in the line loop. */
  nextStopIndex: number;
  /** Remaining polyline to the next stop. */
  path: Vec2[];
  progress: number;
  pathLength: number;
  /** Minutes remaining at the current stop. */
  dwellRemaining: Minute;
  /** Minutes the bus is immobilised (traffic / intervention). */
  holdRemaining: Minute;
  /** Accumulated lateness in minutes versus the timetable. */
  delay: Minute;
  /** Trip index since the first departure. */
  trip: number;
  passengers: AgentId[];
  /** Last bus_arrive / bus_depart event id (causal chain). */
  lastEventId: EventId | null;
  /** Event ids of delays still "active" on the current trip. */
  delayEventIds: EventId[];
  /** Whether the bus is in service. */
  inService: boolean;
  /** Direction the bus takes when leaving its current/next stop (+1 towards the last stop). */
  direction: 1 | -1;
  /** Index of the next timetable entry for this bus. */
  scheduleIndex: number;
  /** Inhabitant driving the bus, if any. */
  driverId?: AgentId;
  /** Minute of the last scheduled departure of the current loop. */
  currentStopId: LocationId | null;
  /** Clock minute when the bus is scheduled to depart the current stop. */
  scheduledDeparture: Minute;
}

// ---------------------------------------------------------------------------
// Locations (dynamic)
// ---------------------------------------------------------------------------

export interface LocationState {
  id: LocationId;
  /** Items left behind (lost objects). */
  items: { item: string; ownerId: AgentId; eventId: EventId }[];
  stock: number;
  /** Closed before schedule (sold out / intervention). */
  closedEarlyAt?: Minute;
  closedEarlyEventId?: EventId;
  /** Opening hours override (intervention). */
  opens?: Minute;
  closes?: Minute;
  visitsToday: number;
}

export type Weather = 'clear' | 'rain';

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type EventType =
  | 'day_start'
  | 'wake'
  | 'decision'
  | 'depart'
  | 'arrive'
  | 'activity_start'
  | 'activity_end'
  | 'bus_depart'
  | 'bus_arrive'
  | 'bus_delay'
  | 'board_bus'
  | 'alight_bus'
  | 'miss_bus'
  | 'wait_start'
  | 'meeting_start'
  | 'meeting_missed'
  | 'meeting_end'
  | 'encounter'
  | 'conversation'
  | 'argument'
  | 'purchase'
  | 'shop_closed'
  | 'found_closed'
  | 'lose_item'
  | 'find_item'
  | 'return_item'
  | 'weather'
  | 'late'
  | 'work_start'
  | 'work_end'
  | 'sleep'
  | 'intervention'
  | 'plan_change'
  | 'invitation'
  | 'new_commitment'
  | 'commitment_cancelled'
  | 'mood_shift'
  | 'arc_beat'
  | 'arc_resolved'
  | 'revelation'
  | 'gossip'
  | 'dilemma'
  | 'day_end';

export interface StateChange {
  kind: 'need' | 'emotion' | 'relationship' | 'money' | 'commitment' | 'location' | 'inventory' | 'weather' | 'bus' | 'plan';
  agentId?: AgentId;
  otherId?: AgentId;
  field?: string;
  delta?: number;
  value?: string | number | boolean;
}

export interface RandomDraw {
  /** Stable key identifying the stream (e.g. "encounter:alice:hugo:512"). */
  key: string;
  value: number;
}

export interface SimEvent {
  id: EventId;
  t: Minute;
  type: EventType;
  actors: AgentId[];
  locationId?: LocationId;
  busId?: string;
  /** Short French label. */
  label: string;
  /** Longer French description. */
  description?: string;
  /** Direct causal dependencies (event ids). Only genuine mechanisms are recorded. */
  causes: EventId[];
  /** How the causes produced this event. */
  mechanism?: string;
  effects: StateChange[];
  randomDraws?: RandomDraw[];
  /** 0..1 — used for timeline markers. */
  importance: number;
  /** Set when the event is the direct product of an intervention. */
  interventionId?: string;
  data?: Record<string, string | number | boolean | string[] | undefined>;
  /** Signature used to match events across realities (type + actors + place, no time). */
  signature: string;
}

// ---------------------------------------------------------------------------
// Interventions
// ---------------------------------------------------------------------------

export type Intervention =
  | {
      id: string;
      kind: 'bus_delay';
      /** Minute at which the bus gets held. */
      t: Minute;
      minutes: Minute;
      busId: string;
      description: string;
    }
  | {
      id: string;
      kind: 'stay_home';
      agentId: AgentId;
      t: Minute;
      until: Minute;
      description: string;
    }
  | {
      id: string;
      kind: 'force_action';
      agentId: AgentId;
      t: Minute;
      action: ActionType;
      locationId?: LocationId;
      description: string;
    }
  | {
      id: string;
      kind: 'agent_delay';
      agentId: AgentId;
      t: Minute;
      minutes: Minute;
      description: string;
    }
  | {
      id: string;
      kind: 'location_hours';
      locationId: LocationId;
      t: Minute;
      closes?: Minute;
      opens?: Minute;
      description: string;
    }
  | {
      id: string;
      kind: 'weather';
      t: Minute;
      condition: Weather;
      until?: Minute;
      description: string;
    }
  | {
      id: string;
      kind: 'cancel_commitment';
      agentId: AgentId;
      commitmentId?: string;
      t: Minute;
      description: string;
    }
  | {
      id: string;
      kind: 'encounter';
      agentA: AgentId;
      agentB: AgentId;
      locationId: LocationId;
      t: Minute;
      description: string;
    };

export type InterventionKind = Intervention['kind'];

// ---------------------------------------------------------------------------
// Dramaturgy — daily arcs
// ---------------------------------------------------------------------------

export type ArcKind = 'romance' | 'ambition' | 'reconciliation' | 'duty' | 'curiosity' | 'courage' | 'care' | 'pride';

/**
 * What an arc is about, in terms the engine can check against events and state.
 * Every goal maps to concrete event types, so an arc's outcome is always traceable.
 */
export type ArcGoal =
  | { type: 'talk_to'; target: AgentId; deep?: boolean; after?: Minute }
  | { type: 'avoid'; target: AgentId }
  | { type: 'commitment'; commitmentId: string }
  | { type: 'on_time'; commitmentId: string }
  | { type: 'be_at'; locationId: LocationId; withAgent?: AgentId; after?: Minute }
  | { type: 'keep_wallet' }
  | { type: 'sell_out'; locationId: LocationId }
  | { type: 'conversations'; min: number }
  | { type: 'money_floor'; min: number }
  | { type: 'bus_on_time'; busId: string; maxDelay: Minute };

export interface ArcSeed {
  id: string;
  agentId: AgentId;
  kind: ArcKind;
  /** Short title, e.g. « Oser parler à Hugo ». */
  title: string;
  /** What the inhabitant wants today (one sentence). */
  desire: string;
  /** What the inhabitant hides; may be confided, then spread. */
  secret?: string;
  /** Who must not learn the secret (a gossip reaching them is a twist). */
  secretAbout?: AgentId;
  /** What is at stake / the obstacle (one sentence). */
  tension: string;
  /** Minute by which the arc must resolve (default: end of day). */
  deadline?: Minute;
  /** 0..1 — how much the arc weighs on decisions and on the report. */
  stakes: number;
  goal: ArcGoal;
}

export type ArcStatus = 'open' | 'advancing' | 'fulfilled' | 'failed' | 'twisted';

export interface ArcState {
  id: string;
  agentId: AgentId;
  seedId: string;
  status: ArcStatus;
  /** 0..1 */
  progress: number;
  /** Events that moved the arc (beats), in order. */
  beats: EventId[];
  /** Agents who know the secret. */
  knownBy: AgentId[];
  resolvedAt?: Minute;
  resolutionEventId?: EventId;
  /** Internal counters (conversations, etc.). */
  count: number;
  /** Minute of the last dilemma recorded for this arc (anti-spam). */
  lastDilemma?: Minute;
  /** Number of days this arc has been attempted (chained days). */
  attempt: number;
}

// ---------------------------------------------------------------------------
// World state
// ---------------------------------------------------------------------------

export interface WorldState {
  t: Minute;
  seed: number;
  /** Day index (1 = first simulated day). Later days start from the previous day's end state. */
  day: number;
  agents: Record<AgentId, AgentState>;
  buses: Record<string, BusState>;
  locations: Record<LocationId, LocationState>;
  weather: Weather;
  /** Scheduled weather changes [{t, condition}] (seeded, may be overridden). */
  weatherSchedule: { t: Minute; condition: Weather; interventionId?: string }[];
  eventSeq: number;
  commitmentSeq: number;
  /** Interventions already applied (ids). */
  appliedInterventions: string[];
  /** Root event ids per intervention (for causal attribution). */
  interventionEventIds: Record<string, EventId>;
  /** Dramatic arcs of the day, one per inhabitant (keyed by arc id). */
  arcs: Record<string, ArcState>;
  /** Last public place each agent left, and when (for near-miss beats). */
  lastLeft: Record<AgentId, { locationId: LocationId; t: Minute }>;
}

export interface TraceAgent {
  x: number;
  y: number;
  /** Location id or '' while travelling. */
  loc: LocationId | '';
  /** Short activity label. */
  act: string;
  mood: number;
  asleep: boolean;
  riding: boolean;
}

export interface TraceFrame {
  t: Minute;
  agents: Record<AgentId, TraceAgent>;
  buses: Record<string, { x: number; y: number; passengers: number; delay: number; stop: LocationId | null }>;
  weather: Weather;
}
