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

import { t } from '../i18n';
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
  const text = t('story.grain_text', { situation: g.situation, cause: g.cause, effects: g.effects.join(t('story.sep_semicolon')) || t('story.grain_nothing_notable') });
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
        situation: t('story.grain_arc_situation', { name: first(arc.agentId), desire: seed.desire, tension: seed.tension }),
        cause: resolution?.mechanism ? clip(resolution.mechanism, 120) : t('story.grain_arc_deadline', { time: fmtTime(seed.deadline ?? 1439) }),
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
        situation: t('story.grain_secret_situation', { name: first(arc.agentId), secret: seed.secret }),
        cause: `${fmtTime(trail[0].t)} ${clip(trail[0].label, 110)}`,
        effects: trail.slice(1, 5).map((e) => `${fmtTime(e.t)} ${clip(e.label, 100)}`).concat(reached ? [t('story.grain_secret_reached', { name: first(seed.secretAbout!) })] : [t('story.grain_secret_known_by', { names: arc.knownBy.map(first).join(', ') })]),
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
        situation: event.locationId ? t('story.grain_chain_situation_at', { period: periodOfDay(event.t), time: fmtTime(event.t), place: reality.engine.city.location(event.locationId).name }) : t('story.grain_chain_situation', { period: periodOfDay(event.t), time: fmtTime(event.t) }),
        cause: clip(event.label, 110),
        effects: far.map((x) => t('story.grain_chain_effect', { text: `${fmtTime(x.e.t)} ${clip(x.e.label, 100)}`, n: x.d })),
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
        situation: e.locationId
          ? t('story.grain_encounter_at', { names: e.actors.map(first).join(t('story.list_and')), period: periodOfDay(e.t), place: reality.engine.city.location(e.locationId).name })
          : e.busId
            ? t('story.grain_encounter_bus', { names: e.actors.map(first).join(t('story.list_and')), period: periodOfDay(e.t), bus: e.busId })
            : t('story.grain_encounter_street', { names: e.actors.map(first).join(t('story.list_and')), period: periodOfDay(e.t) }),
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
    const effects = consequences.map((m) => {
      if (!m.b) return t('story.grain_effect_absent', { label: clip(m.a!.label, 90) });
      const text = `${fmtTime(m.b.t)} ${clip(m.b.label, 100)}`;
      return m.status === 'shifted' ? t('story.grain_effect_shifted', { text, delta: `${m.dt! > 0 ? '+' : ''}${m.dt}` }) : text;
    });
    for (const c of comparison.arcChanges) effects.push(t('story.grain_effect_destiny', { text: c.text }));
    const touched = comparison.affectedAgents;
    const agentId = 'agentId' in iv ? iv.agentId : 'agentA' in iv ? iv.agentA : undefined;
    const where = [t('story.grain_when', { period: periodOfDay(iv.t), time: fmtTime(iv.t) })];
    if (agentId) where.push(first(agentId));
    if ('busId' in iv) where.push(t('story.grain_bus', { bus: iv.busId }));
    if ('locationId' in iv && iv.locationId) where.push(A.engine.city.location(iv.locationId).name);
    const situation = t('story.grain_intervention_situation', { where: where.join(', '), kind: iv.kind });
    out.push(
      grain({
        signature: `intervention|${iv.kind}|${agentId ?? ('busId' in iv ? iv.busId : '')}|${Math.round(iv.t / 30)}|${comparison.arcChanges.map((c) => `${c.arcId}:${c.statusB}`).sort().join(',')}`,
        kind: 'intervention',
        situation,
        cause: root ? clip(root.label, 120) : iv.description,
        effects: effects.length ? effects : [t('story.grain_no_effect')],
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
  if (B && comparison) out.push(...interventionGrains(A, B, comparison), ...arcGrains(B));
  // One grain per signature within a day (the same pair may chat twice at the same counter).
  const seen = new Set<string>();
  return out.filter((g) => (seen.has(g.signature) ? false : (seen.add(g.signature), true)));
}
