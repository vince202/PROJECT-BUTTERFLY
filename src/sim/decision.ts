/**
 * Agent decision engine (utility AI).
 *
 * Every time an inhabitant is free to choose, the engine builds a list of
 * candidate actions, scores each one from needs, personality, memories,
 * commitments, relationships and environment, applies hard constraints
 * (opening hours, money, capacity, time before the next commitment) and picks
 * the best. The full list of candidates with their score components is kept
 * so that the interface can show exactly why a decision was made.
 *
 * The scoring lives behind the `DecisionPolicy` interface so that a learned or
 * LLM-based policy can replace it later without touching the rest of the engine.
 */

import { planBusTrip, type Timetable } from './bus';
import { WALK_SPEED, WALK_SPEED_RAIN, type City } from './city';
import type {
  ActionType,
  AgentProfile,
  AgentState,
  Candidate,
  LocationDef,
  LocationId,
  Minute,
  ScoreComponent,
  TravelMode,
  WorldState,
} from './types';
import { Rng } from './rng';
import { applyDesire } from './drama';

export interface TravelEstimate {
  mode: TravelMode;
  minutes: Minute;
  distance: number;
  bus?: ReturnType<typeof planBusTrip>;
}

export interface DecisionContext {
  city: City;
  timetable: Timetable;
  world: WorldState;
  profiles: Map<string, AgentProfile>;
  rng: Rng;
  t: Minute;
  /** The activity currently in progress (when re-evaluating), to apply inertia. */
  current?: { action: ActionType; locationId: LocationId; label: string; score: number } | null;
}

export interface DecisionOutcome {
  chosen: Candidate;
  candidates: Candidate[];
  reasons: string[];
}

export interface DecisionPolicy {
  readonly name: string;
  decide(agent: AgentState, profile: AgentProfile, ctx: DecisionContext): DecisionOutcome;
}

export const ACTION_LABELS: Record<ActionType, string> = {
  sleep: 'Dormir',
  morning_routine: 'Routine du matin',
  work: 'Travailler',
  school: 'Suivre les cours',
  commitment: 'Honorer un engagement',
  eat_home: 'Manger à la maison',
  eat_bakery: 'Grignoter à la boulangerie',
  eat_cafe: 'Manger au café',
  eat_restaurant: 'Manger au restaurant',
  coffee: 'Prendre un café',
  shop_groceries: 'Faire les courses',
  relax_park: 'Se détendre au parc',
  read_library: 'Lire à la bibliothèque',
  workout: 'Faire du sport',
  rest_home: 'Se reposer à la maison',
  visit: 'Rejoindre quelqu’un',
  stroll: 'Se promener',
  drive_bus: 'Conduire le bus',
  stay_home: 'Rester à la maison',
  wait: 'Attendre',
};

export const ACTION_COSTS: Partial<Record<ActionType, number>> = {
  eat_bakery: 4,
  eat_cafe: 9,
  eat_restaurant: 20,
  coffee: 3,
  shop_groceries: 15,
  workout: 5,
};

export function walkSpeed(world: WorldState): number {
  return world.weather === 'rain' ? WALK_SPEED_RAIN : WALK_SPEED;
}

/** Street node the agent is currently closest to. */
export function agentNode(agent: AgentState, city: City): string {
  if (agent.locationId) return city.location(agent.locationId).node;
  return city.nearestNode(agent.pos);
}

/**
 * Is a location open at minute t? With `known = true` only the official opening
 * hours are used: inhabitants plan with what they know and discover unexpected
 * closures (sold out, intervention) when they arrive.
 */
export function isLocationOpen(city: City, world: WorldState, id: LocationId, t: Minute, known = false): boolean {
  const def = city.location(id);
  const st = world.locations[id];
  if (!known && st?.closedEarlyAt !== undefined && t >= st.closedEarlyAt) return false;
  const opens = known ? def.opens : st?.opens ?? def.opens;
  const closes = known ? def.closes : st?.closes ?? def.closes;
  if (opens !== undefined && t < opens) return false;
  if (closes !== undefined && t >= closes) return false;
  return true;
}

export function occupancy(world: WorldState, id: LocationId): number {
  let n = 0;
  for (const a of Object.values(world.agents)) if (a.locationId === id) n++;
  return n;
}

export function estimateTravel(agent: AgentState, profile: AgentProfile, dest: LocationId, ctx: DecisionContext): TravelEstimate {
  const { city, timetable, world, t } = ctx;
  const from = agentNode(agent, city);
  const toNode = city.location(dest).node;
  const distance = city.nodeDistance(from, toNode);
  const speed = walkSpeed(world);
  const walkMinutes = Math.ceil(distance / speed) + (agent.locationId === dest ? 0 : 1);
  const line = city.lines[0];
  let best: TravelEstimate = { mode: 'walk', minutes: walkMinutes, distance };
  if (distance >= 220 && profile.preferences.busAffinity > 0.05) {
    const bus = planBusTrip(city, timetable, line, from, dest, t, speed);
    if (bus) {
      // Preference bias: bus lovers accept a slightly longer trip.
      const bias = (profile.preferences.busAffinity - 0.5) * 8;
      if (bus.total - bias < walkMinutes && bus.wait <= 12) {
        best = { mode: 'bus', minutes: bus.total, distance, bus };
      }
    }
  }
  return best;
}

function clamp(v: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

function sum(components: ScoreComponent[]): number {
  return components.reduce((a, c) => a + c.value, 0);
}

function nextCommitmentAfter(agent: AgentState, t: Minute) {
  return agent.commitments
    .filter((c) => c.status === 'pending' && c.start >= t - 5)
    .sort((a, b) => a.start - b.start)[0];
}

interface Builder {
  agent: AgentState;
  profile: AgentProfile;
  ctx: DecisionContext;
  out: Candidate[];
}

function make(b: Builder, action: ActionType, locationId: LocationId, duration: Minute, components: ScoreComponent[], extra: Partial<Candidate> = {}): Candidate {
  const travel = estimateTravel(b.agent, b.profile, locationId, b.ctx);
  const comps = [...components];
  if (travel.minutes > 1 && b.agent.locationId !== locationId) {
    comps.push({ label: `Trajet (${travel.minutes} min${travel.mode === 'bus' ? ', bus' : ''})`, value: -Math.min(0.45, travel.minutes * 0.018) });
  }
  const recent = b.agent.recent[action];
  if (recent !== undefined && b.ctx.t - recent < 45 && !extra.commitmentId) {
    const strong = ['coffee', 'eat_home', 'eat_bakery', 'eat_cafe', 'eat_restaurant', 'workout', 'shop_groceries', 'visit'].includes(action);
    comps.push({ label: 'Vient de le faire', value: strong ? -0.45 : -0.15 });
  }
  const cand: Candidate = {
    action,
    label: extra.label ?? ACTION_LABELS[action],
    locationId,
    duration,
    score: 0,
    components: comps,
    travelMinutes: travel.minutes,
    mode: travel.mode,
    ...extra,
  };
  // Hard constraints
  const { city, world, t } = b.ctx;
  const def = city.location(locationId);
  const cost = ACTION_COSTS[action] ?? 0;
  if (!cand.rejected && cost > 0 && b.agent.money < cost) cand.rejected = `Pas assez d’argent (${cost} €)`;
  if (!cand.rejected && cost > 0 && !b.agent.inventory.includes('wallet')) cand.rejected = 'Portefeuille introuvable';
  const atLocation = b.agent.locationId === locationId;
  if (!cand.rejected && def.kind !== 'home' && def.kind !== 'bus_stop' && !isLocationOpen(city, world, locationId, t + Math.max(0, travel.minutes - 2), !atLocation)) {
    cand.rejected = `${def.name} est fermé`;
  }
  if (!cand.rejected && def.kind !== 'home' && (b.agent.knownClosed ?? []).includes(locationId)) {
    cand.rejected = `${def.name} est fermé (constaté)`;
  }
  if (!cand.rejected && def.capacity !== undefined && b.agent.locationId !== locationId && occupancy(world, locationId) >= def.capacity) {
    cand.rejected = `${def.name} est complet`;
  }
  if (!cand.rejected && b.agent.confinedUntil !== undefined && t < b.agent.confinedUntil && locationId !== b.profile.homeId) {
    cand.rejected = 'Doit rester à la maison (intervention)';
  }
  // Time budget before the next commitment
  const confinedHome = b.agent.confinedUntil !== undefined && t < b.agent.confinedUntil && locationId === b.profile.homeId;
  if (!cand.rejected && !cand.commitmentId && action !== 'sleep' && !confinedHome) {
    const next = nextCommitmentAfter(b.agent, t);
    if (next) {
      const back = city.nodeDistance(def.node, city.location(next.locationId).node) / walkSpeed(world);
      const finish = t + travel.minutes + duration + back;
      if (finish > next.start + next.tolerance * 0.5 && next.start - t < travel.minutes + duration + back) {
        // Allow when the activity is clearly short enough; otherwise reject.
        if (finish > next.start + 10) cand.rejected = `Pas le temps avant « ${next.label} » (${fmt(next.start)})`;
      }
    }
  }
  cand.score = cand.rejected ? -1 : sum(comps);
  b.out.push(cand);
  return cand;
}

function fmt(t: Minute): string {
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function isFreelanceHours(profile: AgentProfile, t: Minute): boolean {
  return !profile.workplaceId && profile.age < 60 && t >= 9 * 60 && t < 18 * 60;
}

/** Build every candidate action for an agent. */
export function buildCandidates(agent: AgentState, profile: AgentProfile, ctx: DecisionContext): Candidate[] {
  const b: Builder = { agent, profile, ctx, out: [] };
  const { city, world, t } = ctx;
  const needs = agent.needs;
  const tr = profile.traits;
  const home = profile.homeId;
  const hungerFactor = clamp((needs.hunger - 25) / 60, 0, 1.2);
  const rain = world.weather === 'rain';
  const evening = t >= 18 * 60;
  const night = t >= 22 * 60;

  // Forced action (intervention) dominates everything.
  if (agent.forcedPlan) {
    const f = agent.forcedPlan;
    const loc = f.locationId ?? defaultLocationFor(f.action, profile, city);
    const forcedCand = make(b, f.action, loc, defaultDuration(f.action), [{ label: 'Intervention de l’observateur', value: 10 }], { label: f.label, withAgent: f.withAgent });
    if (forcedCand.rejected && forcedCand.rejected.startsWith('Pas le temps')) {
      forcedCand.rejected = undefined;
      forcedCand.score = forcedCand.components.reduce((x, y) => x + y.value, 0);
    }
  }

  // Commitments
  for (const c of agent.commitments) {
    if (c.status === 'done' || c.status === 'missed' || c.status === 'cancelled') continue;
    if (t > c.end) continue;
    const travel = estimateTravel(agent, profile, c.locationId, ctx);
    const comps: ScoreComponent[] = [];
    const action: ActionType = c.kind === 'work' || c.kind === 'shift' ? 'work' : c.kind === 'school' ? 'school' : 'commitment';
    let label = c.label;
    if (c.status === 'ongoing') {
      comps.push({ label: 'Engagement en cours', value: 0.55 + 0.15 * tr.punctuality });
      label = c.kind === 'work' || c.kind === 'shift' ? 'Retourner au travail' : c.kind === 'school' ? 'Retourner en cours' : `Reprendre : ${c.label}`;
    } else {
      const slack = c.start - t - travel.minutes;
      const margin = 2 + 9 * tr.punctuality;
      if (slack > margin + 30) continue; // far too early to leave: not an option yet
      if (slack > margin + 25) {
        comps.push({ label: 'Un peu tôt pour partir', value: 0.1 });
      } else if (slack > margin) {
        const ramp = 1 - (slack - margin) / 25;
        comps.push({ label: `Départ bientôt (marge ${Math.round(slack)} min)`, value: 0.15 + 0.6 * ramp });
      } else if (slack >= 0) {
        comps.push({ label: 'C’est l’heure de partir', value: 0.78 + 0.25 * tr.punctuality });
      } else {
        comps.push({ label: `Déjà en retard (${Math.round(-slack)} min)`, value: 0.7 + 0.35 * tr.punctuality });
      }
      if (c.kind === 'meeting' || c.kind === 'appointment') {
        const aff = c.with.filter((w) => w !== agent.id).map((w) => agent.relationships[w]?.affinity ?? 0);
        const avg = aff.length ? aff.reduce((x, y) => x + y, 0) / aff.length : 0;
        comps.push({ label: 'Envie de voir la personne', value: 0.2 * avg });
      }
      if ((c.kind === 'work' || c.kind === 'shift') && tr.ambition > 0.6) comps.push({ label: 'Ambition professionnelle', value: 0.08 });
    }
    const duration = Math.max(10, c.end - Math.max(c.start, t + travel.minutes));
    const cand = make(b, action, c.locationId, duration, comps, { commitmentId: c.id, label, withAgent: c.with.find((w) => w !== agent.id) });
    if (cand.rejected && cand.rejected.startsWith('Pas le temps')) cand.rejected = undefined;
    if (cand.rejected && cand.rejected.endsWith('est fermé') && (c.kind === 'work' || c.kind === 'shift')) cand.rejected = undefined;
    if (!cand.rejected) cand.score = sum(cand.components);
  }

  // Sleep
  // Exhaustion long before bedtime calls for a nap at home (rest_home), not for the night.
  const bedtime = profile.routine.bedtime;
  if (t >= bedtime - 30 || (needs.fatigue >= 85 && t >= bedtime - 120)) {
    const comps: ScoreComponent[] = [
      { label: 'Heure du coucher', value: t >= bedtime ? 0.9 : 0.45 },
      { label: 'Fatigue', value: (needs.fatigue / 100) * 0.4 },
    ];
    make(b, 'sleep', home, 24 * 60 - t, comps);
  }

  // Eating
  if (needs.hunger >= 30) {
    const mealTime = profile.routine.lunch !== undefined && Math.abs(t - profile.routine.lunch) <= 30 ? 0.15 : t >= 19 * 60 && t <= 21 * 60 ? 0.12 : 0;
    const fav = profile.preferences.favoriteFood;
    make(b, 'eat_home', home, 30, [
      { label: 'Faim', value: hungerFactor * (fav === 'home' ? 0.9 : 0.6) },
      { label: 'Repas économique', value: tr.frugality * 0.2 },
      { label: 'Heure du repas', value: mealTime },
    ]);
    const bakeryState = world.locations['bakery'];
    if (bakeryState && bakeryState.stock > 0) {
      make(b, 'eat_bakery', 'bakery', 15, [
        { label: 'Faim', value: hungerFactor * (fav === 'bakery' ? 1.0 : 0.7) },
        { label: 'Coût (4 €)', value: -tr.frugality * 0.1 },
        { label: 'Heure du repas', value: mealTime },
      ]);
    }
    make(b, 'eat_cafe', 'cafe', 35, [
      { label: 'Faim', value: hungerFactor * (fav === 'cafe' ? 1.0 : 0.65) },
      { label: 'Ambiance sociale', value: tr.sociability * 0.15 },
      { label: 'Coût (9 €)', value: -tr.frugality * 0.22 },
      { label: 'Heure du repas', value: mealTime },
    ]);
    make(b, 'eat_restaurant', 'restaurant', 50, [
      { label: 'Faim', value: hungerFactor * (fav === 'restaurant' ? 1.05 : 0.6) },
      { label: 'Plaisir de la table', value: tr.sociability * 0.1 + (agent.emotions.mood > 0.3 ? 0.05 : 0) },
      { label: 'Coût (20 €)', value: -tr.frugality * 0.5 },
      { label: 'Heure du repas', value: mealTime },
    ]);
  }

  // Coffee / café
  if (needs.hunger < 70) {
    make(b, 'coffee', 'cafe', 25, [
      { label: 'Envie de compagnie', value: (needs.social / 100) * 0.35 * (0.4 + tr.sociability) },
      { label: 'Ennui', value: (needs.boredom / 100) * 0.25 },
      { label: 'Lieu favori', value: profile.preferences.favoritePlace === 'cafe' ? 0.15 : 0 },
      { label: 'Travail nomade', value: isFreelanceHours(profile, t) ? tr.ambition * 0.3 : 0 },
      { label: 'Il pleut, un abri', value: rain ? 0.1 : 0 },
      { label: 'Moral bas', value: agent.emotions.mood < -0.2 ? 0.1 : 0 },
      { label: 'Coût (3 €)', value: -tr.frugality * 0.08 },
      { label: 'Base', value: 0.08 },
    ]);
  }

  // Groceries
  if (agent.groceries < 2 && profile.workplaceId !== 'supermarket') {
    make(b, 'shop_groceries', 'supermarket', 20, [
      { label: 'Frigo vide', value: ((2 - agent.groceries) / 2) * 0.5 },
      { label: 'Fin de journée', value: t >= 16 * 60 ? 0.15 : 0 },
      { label: 'Coût (15 €)', value: -tr.frugality * 0.05 },
    ]);
  }

  // Park
  make(b, 'relax_park', 'park', 40, [
    { label: 'Ennui', value: (needs.boredom / 100) * 0.4 },
    { label: 'Curiosité', value: tr.curiosity * 0.1 },
    { label: 'Lieu favori', value: profile.preferences.favoritePlace === 'park' ? 0.2 : 0 },
    { label: 'Météo', value: rain ? -0.5 : 0.05 },
    { label: 'Belle lumière', value: t >= 14 * 60 && t < 20 * 60 ? 0.1 : night ? -0.3 : 0 },
    { label: 'Trop tôt le matin', value: t < 9 * 60 && tr.vitality <= 0.8 ? -0.25 : 0 },
    { label: 'Moral bas', value: agent.emotions.mood < -0.2 ? 0.1 : 0 },
    { label: 'Jogging matinal', value: tr.vitality > 0.8 && t < 9 * 60 ? 0.3 : 0 },
    { label: 'Base', value: 0.05 },
  ]);

  // Library
  make(b, 'read_library', 'library', 60, [
    { label: 'Ennui', value: (needs.boredom / 100) * 0.3 },
    { label: 'Curiosité', value: tr.curiosity * 0.3 },
    { label: 'Lieu favori', value: profile.preferences.favoritePlace === 'library' ? 0.2 : 0 },
    { label: 'Travail / études', value: isFreelanceHours(profile, t) ? tr.ambition * 0.45 : 0 },
    { label: 'Fatigue', value: -(needs.fatigue / 100) * 0.15 },
  ]);

  // Gym
  if (needs.fatigue < 75 && profile.workplaceId !== 'gym') {
    make(b, 'workout', 'gym', 50, [
      { label: 'Vitalité', value: tr.vitality * 0.3 },
      { label: 'Ennui', value: (needs.boredom / 100) * 0.2 },
      { label: 'Lieu favori', value: profile.preferences.favoritePlace === 'gym' ? 0.25 : 0 },
      { label: 'Fatigue', value: -(needs.fatigue / 100) * 0.4 },
      { label: 'Coût (5 €)', value: -tr.frugality * 0.1 },
    ]);
  }

  // Rest at home
  const upcoming = nextCommitmentAfter(agent, t);
  const waitingForCommitment = upcoming && upcoming.start - t <= 110 && upcoming.start - t > 0;
  make(b, 'rest_home', home, 45, [
    { label: 'Fatigue', value: (needs.fatigue / 100) * 0.5 },
    { label: 'Épuisement : une sieste s’impose', value: needs.fatigue >= 80 && t < bedtime - 120 ? 0.35 : 0 },
    { label: 'En attendant le prochain engagement', value: waitingForCommitment ? 0.22 : 0 },
    { label: 'Stress', value: agent.emotions.stress > 0.5 ? 0.15 : 0 },
    { label: 'Soirée', value: evening ? 0.2 : 0 },
    { label: 'Il pleut', value: rain ? 0.1 : 0 },
    { label: 'Base', value: 0.1 },
    { label: 'Ennui', value: -(needs.boredom / 100) * 0.25 },
  ]);

  // Visit friends currently somewhere reachable
  const publicKinds = new Set(['cafe', 'park', 'library', 'restaurant', 'gym', 'bakery']);
  for (const r of Object.values(agent.relationships)) {
    if (r.affinity < 0.4) continue;
    if (!['friend', 'partner', 'family', 'crush'].includes(r.kind)) continue;
    const other = world.agents[r.to];
    if (!other || !other.locationId || other.asleep) continue;
    const def: LocationDef = city.location(other.locationId);
    const otherBusy = other.activity && !other.activity.interruptible;
    if (otherBusy) continue;
    const atHome = def.kind === 'home';
    if (atHome && (other.locationId !== profile.homeId) && (r.affinity < 0.6 || t < 10 * 60 || t > 21 * 60)) continue;
    if (!atHome && !publicKinds.has(def.kind)) continue;
    if (other.locationId === agent.locationId) continue;
    const lastChat = agent.lastChat[r.to] ?? -999;
    if (t - lastChat < 120) continue;
    if (needs.social < 35) continue;
    const otherProfile = ctx.profiles.get(r.to)!;
    make(b, 'visit', other.locationId, 30, [
      { label: 'Besoin de compagnie', value: (needs.social / 100) * 0.3 * (0.5 + tr.sociability) },
      { label: `Affinité avec ${otherProfile.firstName}`, value: r.affinity * 0.2 },
      { label: 'Sentiments', value: r.kind === 'crush' || r.kind === 'partner' ? 0.12 : 0 },
      { label: 'Impulsivité', value: tr.impulsivity * 0.05 },
    ], { label: `Rejoindre ${otherProfile.firstName} (${def.name})`, withAgent: r.to });
  }

  // Fallback: wait where you are (10 minutes)
  if (agent.locationId) {
    make(b, 'wait', agent.locationId, 10, [{ label: 'Rien de mieux à faire', value: 0.04 }], { label: 'Rester sur place' });
  }

  // The desire of the day bends the scores a little (dramaturgy layer).
  applyDesire(b.out, agent, world, ctx.profiles, t);

  return b.out;
}

export function defaultLocationFor(action: ActionType, profile: AgentProfile, city: City): LocationId {
  switch (action) {
    case 'work':
    case 'school':
      return profile.workplaceId ?? profile.homeId;
    case 'eat_bakery':
      return 'bakery';
    case 'eat_cafe':
    case 'coffee':
      return 'cafe';
    case 'eat_restaurant':
      return 'restaurant';
    case 'shop_groceries':
      return 'supermarket';
    case 'relax_park':
    case 'stroll':
      return 'park';
    case 'read_library':
      return 'library';
    case 'workout':
      return 'gym';
    default:
      void city;
      return profile.homeId;
  }
}

export function defaultDuration(action: ActionType): Minute {
  switch (action) {
    case 'sleep':
      return 600;
    case 'morning_routine':
      return 25;
    case 'work':
    case 'school':
      return 240;
    case 'eat_home':
      return 30;
    case 'eat_bakery':
      return 15;
    case 'eat_cafe':
      return 35;
    case 'eat_restaurant':
      return 50;
    case 'coffee':
      return 25;
    case 'shop_groceries':
      return 20;
    case 'relax_park':
      return 40;
    case 'read_library':
      return 60;
    case 'workout':
      return 50;
    case 'rest_home':
    case 'stay_home':
      return 45;
    case 'visit':
      return 30;
    default:
      return 15;
  }
}

/** Interruptible activities can be abandoned on impulse (e.g. after an encounter). */
export function isInterruptible(action: ActionType): boolean {
  return !['sleep', 'work', 'school', 'commitment', 'drive_bus', 'morning_routine', 'eat_home', 'eat_bakery', 'eat_cafe', 'eat_restaurant', 'shop_groceries', 'wait'].includes(action);
}

/** Default policy: pick the best-scoring candidate, with a stable personality-scaled noise. */
export class UtilityPolicy implements DecisionPolicy {
  readonly name = 'utility-v1';

  decide(agent: AgentState, profile: AgentProfile, ctx: DecisionContext): DecisionOutcome {
    const candidates = buildCandidates(agent, profile, ctx);
    // Stable noise: same agent, same minute, same action => same nudge in every reality.
    for (const c of candidates) {
      if (c.rejected) continue;
      const noise = (ctx.rng.next(`decision:${agent.id}:${ctx.t}:${c.action}:${c.locationId}`) - 0.5) * 0.08 * (0.5 + profile.traits.impulsivity);
      c.components.push({ label: 'Humeur du moment', value: Number(noise.toFixed(3)) });
      c.score = sum(c.components);
    }
    if (ctx.current) {
      const cur = candidates.find((c) => !c.rejected && c.action === ctx.current!.action && c.locationId === ctx.current!.locationId);
      if (cur) {
        const inertia = 0.25 * (1 - profile.traits.impulsivity);
        cur.components.push({ label: 'Continuer ce qui est commencé', value: inertia });
        cur.score = sum(cur.components);
      }
    }
    const valid = candidates.filter((c) => !c.rejected);
    valid.sort((a, b) => b.score - a.score || a.action.localeCompare(b.action));
    let chosen = valid[0];
    if (!chosen) {
      // Every option is impossible: stay where you are (or at home when confined) for ten minutes.
      const here = agent.locationId ?? profile.homeId;
      chosen = { action: here === profile.homeId ? 'rest_home' : 'wait', label: 'Attend, aucune option possible', locationId: here, duration: 10, score: 0, components: [{ label: 'Aucune option valide', value: 0 }], travelMinutes: 0, mode: 'walk' };
      candidates.push(chosen);
    }
    const top = [...chosen.components].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 3);
    const reasons = top.map((c) => `${c.label} (${c.value >= 0 ? '+' : ''}${c.value.toFixed(2)})`);
    return { chosen, candidates: candidates.sort((a, b) => b.score - a.score), reasons };
  }
}
