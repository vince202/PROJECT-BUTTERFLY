/**
 * Knowledge grains: compact, textual cause → effect records extracted from a
 * simulated day (and from a Reality A/B comparison). They feed the persistent
 * « brain » (server/brain.ts): a growing web of what happened in this city,
 * across seeds and days, vectorised so that similar situations can be found.
 *
 * Grains only describe recorded facts. They never contain invented events, and
 * nothing in the deterministic engine depends on them: they inform the
 * intervention editor (imagination), the advisors (precedents) and the narrator.
 */

import type { Comparison } from './compare';
import { arcSeed } from './drama';
import { profileOf } from './population';
import type { Reality } from './reality';
import { fmtTime, periodOfDay } from './time';
import type { AgentId, SimEvent } from './types';

export type GrainKind = 'intervention' | 'arc' | 'chain' | 'encounter' | 'secret';

export interface KnowledgeGrain {
  /** Stable signature: identical situations across runs collapse into one grain whose count grows. */
  signature: string;
  kind: GrainKind;
  /** The situation before the cause (who, where, when, what was at stake). */
  situation: string;
  /** The cause or gesture (intervention, meeting, confidence…). */
  cause: string;
  /** The recorded effects, most important first. */
  effects: string[];
  /** One text used for embedding and display. */
  text: string;
  agents: AgentId[];
  seed: number;
  day: number;
  /** Clock minute of the cause. */
  t: number;
  /** 0..1 — how dramatic the grain is (drives ranking ties and the UI). */
  weight: number;
  tags: string[];
}

const first = (id: AgentId) => profileOf(id).firstName;

function clip(s: string, n = 140): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function grain(g: Omit<KnowledgeGrain, 'text'>): KnowledgeGrain {
  const text = `${g.situation} → ${g.cause} → ${g.effects.join(' ; ') || 'rien de notable'}`;
  return { ...g, text };
}

/** Grains about the day's arcs: desire + tension → outcome, with the beats as effects. */
export function arcGrains(reality: Reality): KnowledgeGrain[] {
  const out: KnowledgeGrain[] = [];
  const state = reality.engine.state;
  for (const arc of Object.values(state.arcs ?? {})) {
    if (arc.status === 'open' || arc.status === 'advancing') continue;
    const seed = arcSeed(arc.seedId);
    const beats = arc.beats.map((id) => reality.eventById(id)).filter((e): e is SimEvent => !!e);
    const resolution = arc.resolutionEventId ? reality.eventById(arc.resolutionEventId) : undefined;
    const effects = beats.filter((e) => e.id !== arc.resolutionEventId).slice(0, 4).map((e) => `${fmtTime(e.t)} ${clip(e.label, 100)}`);
    if (resolution) effects.push(`${fmtTime(resolution.t)} ${clip(resolution.label, 120)}`);
    out.push(
      grain({
        signature: `arc|${arc.seedId}|${arc.status}`,
        kind: 'arc',
        situation: `${first(arc.agentId)} voulait : ${seed.desire} ${seed.tension}`,
        cause: resolution?.mechanism ? clip(resolution.mechanism, 120) : `échéance ${fmtTime(seed.deadline ?? 1439)}`,
        effects,
        agents: [arc.agentId],
        seed: reality.seed,
        day: state.day,
        t: arc.resolvedAt ?? 0,
        weight: arc.status === 'twisted' ? 0.95 : 0.6 + 0.3 * seed.stakes,
        tags: ['arc', arc.status, seed.kind, arc.agentId],
      }),
    );
  }
  return out;
}

/** Grains about secrets that travelled: who confided to whom, who spread it, whether it reached its target. */
export function secretGrains(reality: Reality): KnowledgeGrain[] {
  const out: KnowledgeGrain[] = [];
  const state = reality.engine.state;
  for (const arc of Object.values(state.arcs ?? {})) {
    const seed = arcSeed(arc.seedId);
    if (!seed.secret || !arc.knownBy.length) continue;
    const trail = reality.events.filter((e) => (e.type === 'revelation' || e.type === 'gossip') && e.data?.arcId === arc.id);
    if (!trail.length) continue;
    const reached = trail.some((e) => e.type === 'gossip' && e.data?.reachesTarget);
    out.push(
      grain({
        signature: `secret|${arc.seedId}|${reached ? 'reached' : 'kept'}|${arc.knownBy.length}`,
        kind: 'secret',
        situation: `Le secret de ${first(arc.agentId)} (${seed.secret})`,
        cause: `${fmtTime(trail[0].t)} ${clip(trail[0].label, 110)}`,
        effects: trail.slice(1, 5).map((e) => `${fmtTime(e.t)} ${clip(e.label, 100)}`).concat(reached ? [`la rumeur atteint ${first(seed.secretAbout!)}`] : [`connu de ${arc.knownBy.map(first).join(', ')}`]),
        agents: [arc.agentId, ...arc.knownBy],
        seed: reality.seed,
        day: state.day,
        t: trail[0].t,
        weight: reached ? 0.9 : 0.5,
        tags: ['secret', reached ? 'reached' : 'kept', arc.agentId],
      }),
    );
  }
  return out;
}

/** Grains about the most impactful causal chains of the day (root → farthest important descendant). */
export function chainGrains(reality: Reality, n = 5): KnowledgeGrain[] {
  const graph = reality.causal;
  const top = graph.mostImpactful(n, (e) => e.importance >= 0.4 && !['decision', 'activity_start', 'wake', 'depart', 'arrive', 'day_start'].includes(e.type));
  const out: KnowledgeGrain[] = [];
  for (const { event, descendants } of top) {
    const far = [...graph.descendants(event.id).entries()]
      .map(([id, d]) => ({ e: graph.get(id)!, d }))
      .filter((x) => x.e.importance >= 0.5 && x.e.type !== 'decision')
      .sort((x, y) => y.e.importance - x.e.importance || y.d - x.d)
      .slice(0, 3);
    if (!far.length) continue;
    out.push(
      grain({
        signature: `chain|${event.signature}|${far[0].e.signature}`,
        kind: 'chain',
        situation: `${periodOfDay(event.t)}, ${fmtTime(event.t)}${event.locationId ? `, ${reality.engine.city.location(event.locationId).name}` : ''}`,
        cause: clip(event.label, 110),
        effects: far.map((x) => `${fmtTime(x.e.t)} ${clip(x.e.label, 100)} (${x.d} maillons)`),
        agents: [...new Set([...event.actors, ...far.flatMap((x) => x.e.actors)])],
        seed: reality.seed,
        day: reality.engine.state.day,
        t: event.t,
        weight: Math.min(1, 0.4 + descendants / 200),
        tags: ['chain', event.type],
      }),
    );
  }
  return out;
}

/** Grains about notable encounters (deep conversations, arguments, reunions) and what followed within the hour. */
export function encounterGrains(reality: Reality, max = 12): KnowledgeGrain[] {
  const out: KnowledgeGrain[] = [];
  const graph = reality.causal;
  const notable = reality.events.filter((e) => (e.type === 'conversation' || e.type === 'argument') && e.importance >= 0.6).slice(0, max);
  for (const e of notable) {
    const after = [...graph.descendants(e.id, 6).keys()].map((id) => graph.get(id)!).filter((x) => x.t <= e.t + 60 && x.importance >= 0.45 && x.type !== 'decision').slice(0, 3);
    out.push(
      grain({
        signature: `encounter|${e.signature}|${e.type}`,
        kind: 'encounter',
        situation: `${e.actors.map(first).join(' et ')}, ${periodOfDay(e.t)}${e.locationId ? `, ${reality.engine.city.location(e.locationId).name}` : e.busId ? `, bus ${e.busId}` : ', dans la rue'}`,
        cause: clip(e.label, 110),
        effects: after.map((x) => `${fmtTime(x.t)} ${clip(x.label, 100)}`),
        agents: e.actors,
        seed: reality.seed,
        day: reality.engine.state.day,
        t: e.t,
        weight: e.importance,
        tags: ['encounter', e.type],
      }),
    );
  }
  return out;
}

/** Grains about an intervention and its verified consequences (the heart of « what if »). */
export function interventionGrains(A: Reality, B: Reality, comparison: Comparison): KnowledgeGrain[] {
  const out: KnowledgeGrain[] = [];
  for (const iv of B.def.interventions) {
    const root = comparison.interventionEvents.find((e) => e.interventionId === iv.id) ?? comparison.interventionEvents[0];
    const consequences = comparison.consequences.filter((m) => m.b || m.a).slice(0, 8);
    const effects = consequences.map((m) => (m.b ? `${fmtTime(m.b.t)} ${clip(m.b.label, 100)}${m.status === 'shifted' ? ` (décalé de ${m.dt! > 0 ? '+' : ''}${m.dt} min)` : ''}` : `« ${clip(m.a!.label, 90)} » n’a pas eu lieu`));
    for (const c of comparison.arcChanges) effects.push(`destin modifié : ${c.text}`);
    const touched = comparison.affectedAgents;
    const agentId = 'agentId' in iv ? iv.agentId : 'agentA' in iv ? iv.agentA : undefined;
    const situation = `${periodOfDay(iv.t)}, ${fmtTime(iv.t)}${agentId ? `, ${first(agentId)}` : ''}${'busId' in iv ? `, bus ${iv.busId}` : ''}${'locationId' in iv && iv.locationId ? `, ${A.engine.city.location(iv.locationId).name}` : ''} (${iv.kind})`;
    out.push(
      grain({
        signature: `intervention|${iv.kind}|${agentId ?? ('busId' in iv ? iv.busId : '')}|${Math.round(iv.t / 30)}|${comparison.arcChanges.map((c) => `${c.arcId}:${c.statusB}`).sort().join(',')}`,
        kind: 'intervention',
        situation,
        cause: root ? clip(root.label, 120) : iv.description,
        effects: effects.length ? effects : ['aucune conséquence notable : la journée se déroule presque à l’identique'],
        agents: touched,
        seed: A.seed,
        day: A.engine.state.day,
        t: iv.t,
        weight: Math.min(1, 0.3 + consequences.length / 15 + comparison.arcChanges.length * 0.2),
        tags: ['intervention', iv.kind, ...(comparison.arcChanges.length ? ['destin'] : []), ...(consequences.length === 0 ? ['sans-effet'] : [])],
      }),
    );
  }
  return out;
}

/** Everything worth remembering from a day (and from its comparison, when any). */
export function extractGrains(A: Reality, B?: Reality | null, comparison?: Comparison | null): KnowledgeGrain[] {
  const out = [...arcGrains(A), ...secretGrains(A), ...chainGrains(A), ...encounterGrains(A)];
  if (B && comparison) out.push(...interventionGrains(A, B, comparison), ...arcGrains(B).filter((g) => !out.some((x) => x.signature === g.signature)));
  return out;
}
