/**
 * Comparison of two realities (A: original, B: modified).
 *
 * Events are matched by signature (type + actors + place + discriminator) and
 * by rank among identical signatures, so the k-th "Alice boards at Place du
 * Marché" in A is compared with the k-th in B. We then distinguish:
 *  - events present in both at the same minute,
 *  - events present in both but shifted in time,
 *  - events only in A ("ce qui n'a pas eu lieu"),
 *  - events only in B ("ce qui est apparu").
 * A B-event is tagged as a *verified consequence* only when the causal graph
 * links it to the intervention; everything else is reported as an observed
 * difference without a proven link.
 */

import type { Reality } from './reality';
import { fmtTime } from './time';
import type { AgentId, EventId, Minute, SimEvent } from './types';

export type MatchStatus = 'same' | 'shifted' | 'only_a' | 'only_b';

export interface EventMatch {
  status: MatchStatus;
  a?: SimEvent;
  b?: SimEvent;
  /** tB - tA for shifted events. */
  dt?: number;
  /** For B events: is the causal link to the intervention established? */
  causal: 'verified' | 'probable' | 'none';
  signature: string;
}

export interface AgentDiff {
  agentId: AgentId;
  locationA: string | null;
  locationB: string | null;
  activityA: string;
  activityB: string;
  moodA: number;
  moodB: number;
  objectivesA: number;
  objectivesB: number;
  relationshipChanges: { other: AgentId; a: number; b: number }[];
  eventCountA: number;
  eventCountB: number;
  /** Number of B events for this agent causally linked to the intervention. */
  affectedEvents: number;
}

export interface Comparison {
  interventionEvents: SimEvent[];
  firstDivergence: EventMatch | null;
  /** First consequence of the intervention that is not the intervention itself. */
  firstConsequence: EventMatch | null;
  matches: EventMatch[];
  same: number;
  shifted: EventMatch[];
  onlyA: EventMatch[];
  onlyB: EventMatch[];
  /** Verified downstream consequences (B events descending from the intervention), by time. */
  consequences: EventMatch[];
  agentDiffs: AgentDiff[];
  /** Agents whose day changed in a causally verified way. */
  affectedAgents: AgentId[];
  summary: string[];
}

const NOISE_TYPES = new Set(['decision', 'bus_depart', 'bus_arrive', 'activity_start', 'activity_end', 'depart', 'arrive', 'wake', 'day_start', 'day_end', 'purchase']);

function groupBySignature(events: SimEvent[]): Map<string, SimEvent[]> {
  const m = new Map<string, SimEvent[]>();
  for (const e of events) {
    if (!m.has(e.signature)) m.set(e.signature, []);
    m.get(e.signature)!.push(e);
  }
  return m;
}

export function compareRealities(A: Reality, B: Reality): Comparison {
  const ivIds = new Set<EventId>(Object.values(B.engine.state.interventionEventIds));
  const interventionEvents = B.events.filter((e) => e.type === 'intervention');
  const graphB = B.causal;
  const graphA = A.causal;
  const ga = groupBySignature(A.events);
  const gb = groupBySignature(B.events);
  const matches: EventMatch[] = [];
  const affectedB = new Set<EventId>();
  for (const e of B.events) if (graphB.descendsFromIntervention(e.id, ivIds)) affectedB.add(e.id);

  const sigs = new Set([...ga.keys(), ...gb.keys()]);
  for (const sig of sigs) {
    const la = ga.get(sig) ?? [];
    const lb = gb.get(sig) ?? [];
    const n = Math.max(la.length, lb.length);
    for (let i = 0; i < n; i++) {
      const a = la[i];
      const b = lb[i];
      if (a && b) {
        const dt = b.t - a.t;
        matches.push({ status: dt === 0 ? 'same' : 'shifted', a, b, dt, causal: affectedB.has(b.id) ? 'verified' : 'none', signature: sig });
      } else if (a) {
        matches.push({ status: 'only_a', a, causal: 'none', signature: sig });
      } else if (b) {
        matches.push({ status: 'only_b', b, causal: affectedB.has(b.id) ? 'verified' : 'none', signature: sig });
      }
    }
  }
  // A-only events whose direct causes (in A) were themselves altered in B are verified consequences:
  // their precondition no longer held. Process in time order so the status propagates.
  const matchByA = new Map<EventId, EventMatch>();
  for (const m of matches) if (m.a) matchByA.set(m.a.id, m);
  const alteredA = new Set<EventId>(); // A events whose B counterpart is shifted/missing and verified
  const timeOfMatch = (m: EventMatch) => Math.min(m.a?.t ?? Infinity, m.b?.t ?? Infinity);
  for (const m of [...matches].sort((x, y) => timeOfMatch(x) - timeOfMatch(y))) {
    if (!m.a) continue;
    if (m.status === 'shifted' && m.causal === 'verified') alteredA.add(m.a.id);
    if (m.status === 'only_a') {
      if (m.a.causes.some((c) => alteredA.has(c))) {
        m.causal = 'verified';
        alteredA.add(m.a.id);
      }
    }
  }
  // "Probable" links for A-only events: an actor was already affected in B before that time.
  const affectedTimeByAgent = new Map<AgentId, Minute>();
  for (const id of affectedB) {
    const e = graphB.get(id)!;
    for (const act of e.actors) {
      const cur = affectedTimeByAgent.get(act);
      if (cur === undefined || e.t < cur) affectedTimeByAgent.set(act, e.t);
    }
  }
  for (const m of matches) {
    if (m.status === 'only_a' && m.a && m.causal !== 'verified') {
      if (m.a.actors.some((act) => (affectedTimeByAgent.get(act) ?? Infinity) <= m.a!.t)) m.causal = 'probable';
    }
    if (m.status === 'shifted' && m.causal === 'none' && m.b) {
      if (m.b.actors.some((act) => (affectedTimeByAgent.get(act) ?? Infinity) <= m.b!.t)) m.causal = 'probable';
    }
  }
  const timeOf = (m: EventMatch) => Math.min(m.a?.t ?? Infinity, m.b?.t ?? Infinity);
  matches.sort((x, y) => timeOf(x) - timeOf(y));

  const diverging = matches.filter((m) => m.status !== 'same');
  const firstDivergence = diverging[0] ?? null;
  const isDirectManifestation = (e: SimEvent) => e.type === 'intervention' || (e.type === 'bus_delay' && !!e.interventionId) || (e.type === 'weather' && !!e.interventionId) || (e.type === 'commitment_cancelled' && !!e.interventionId);
  const firstConsequence = diverging.find((m) => m.b && !isDirectManifestation(m.b) && m.causal === 'verified' && !NOISE_TYPES.has(m.b.type)) ?? diverging.find((m) => m.b && !isDirectManifestation(m.b) && m.causal === 'verified') ?? null;

  const notNoise = (m: EventMatch) => !NOISE_TYPES.has((m.a ?? m.b)!.type);
  const shifted = matches.filter((m) => m.status === 'shifted' && notNoise(m));
  const onlyA = matches.filter((m) => m.status === 'only_a' && notNoise(m));
  const onlyB = matches.filter((m) => m.status === 'only_b' && notNoise(m));
  const consequences = matches.filter((m) => m.causal === 'verified' && !NOISE_TYPES.has((m.a ?? m.b)!.type) && ((m.b && !isDirectManifestation(m.b) && (m.status === 'only_b' || (m.status === 'shifted' && Math.abs(m.dt ?? 0) >= 1))) || (m.status === 'only_a')));
  const differingVerifiedB = new Set<EventId>(matches.filter((m) => m.b && m.causal === 'verified' && m.status !== 'same').map((m) => m.b!.id));

  // Per-agent end-of-day diffs
  const sa = A.engine.state;
  const sb = B.engine.state;
  const agentDiffs: AgentDiff[] = [];
  for (const id of Object.keys(sa.agents).sort()) {
    const a = sa.agents[id];
    const b = sb.agents[id];
    const rel: AgentDiff['relationshipChanges'] = [];
    const others = new Set([...Object.keys(a.relationships), ...Object.keys(b.relationships)]);
    for (const o of others) {
      const ra = a.relationships[o]?.affinity ?? 0;
      const rb = b.relationships[o]?.affinity ?? 0;
      if (Math.abs(ra - rb) >= 0.03) rel.push({ other: o, a: ra, b: rb });
    }
    const affected = B.events.filter((e) => e.actors.includes(id) && differingVerifiedB.has(e.id) && !NOISE_TYPES.has(e.type)).length;
    agentDiffs.push({
      agentId: id,
      locationA: a.locationId,
      locationB: b.locationId,
      activityA: a.activity?.label ?? (a.asleep ? 'Dort' : a.travel ? 'En chemin' : '—'),
      activityB: b.activity?.label ?? (b.asleep ? 'Dort' : b.travel ? 'En chemin' : '—'),
      moodA: a.emotions.mood,
      moodB: b.emotions.mood,
      objectivesA: a.objectivesDone,
      objectivesB: b.objectivesDone,
      relationshipChanges: rel,
      eventCountA: A.events.filter((e) => e.actors.includes(id)).length,
      eventCountB: B.events.filter((e) => e.actors.includes(id)).length,
      affectedEvents: affected,
    });
  }
  const affectedAgents = agentDiffs.filter((d) => d.affectedEvents > 0).map((d) => d.agentId);

  const same = matches.filter((m) => m.status === 'same').length;
  const summary: string[] = [];
  summary.push(`${same} événements identiques, ${shifted.length} décalés dans le temps, ${onlyA.length} présents seulement dans A, ${onlyB.length} seulement dans B.`);
  summary.push(`${consequences.length} conséquences causalement vérifiées de l’intervention, touchant ${affectedAgents.length} habitant${affectedAgents.length > 1 ? 's' : ''}.`);
  if (firstConsequence?.b) summary.push(`Première conséquence : ${fmtTime(firstConsequence.b.t)} — ${firstConsequence.b.label}.`);
  const majors = consequences.filter((m) => ((m.b ?? m.a)!.importance) >= 0.6);
  if (majors.length) summary.push(`Conséquences majeures : ${majors.slice(0, 4).map((m) => (m.b ? `${fmtTime(m.b.t)} ${m.b.label}` : `${fmtTime(m.a!.t)} « ${m.a!.label} » n’a pas eu lieu`)).join(' ; ')}.`);
  else if (consequences.length === 0) summary.push('L’intervention n’a produit aucune conséquence notable : la journée s’est déroulée presque à l’identique.');

  void graphA;
  return { interventionEvents, firstDivergence, firstConsequence, matches, same, shifted, onlyA, onlyB, consequences, agentDiffs, affectedAgents, summary };
}

/** Where is each agent at minute t in both realities (for the side-by-side view). */
export function agentPositionsAt(A: Reality, B: Reality, t: Minute) {
  const fa = A.frameAt(t);
  const fb = B.frameAt(t);
  const out: { agentId: AgentId; locA: string; locB: string; actA: string; actB: string; differs: boolean }[] = [];
  if (!fa || !fb) return out;
  for (const id of Object.keys(fa.agents).sort()) {
    const a = fa.agents[id];
    const b = fb.agents[id];
    if (!b) continue;
    out.push({ agentId: id, locA: a.loc, locB: b.loc, actA: a.act, actB: b.act, differs: a.loc !== b.loc || a.act !== b.act });
  }
  return out;
}
