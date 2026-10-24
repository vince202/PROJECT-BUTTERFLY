/**
 * UI helpers for the dramaturgy layer: status tones, arc status at a given
 * minute (without rebuilding the world state), and the fact sheets handed to
 * the narration model (morning, counterfactual, dialogue). Pure functions only;
 * every fact comes from the recorded event log or the world state.
 */

import type { Comparison } from '../sim/compare';
import { ARC_KIND_LABELS, ARC_STATUS_LABELS, arcDeadline, arcOf, arcSeed, effectiveStakes } from '../sim/drama';
import type { DayReport } from '../sim/narrative';
import { AGENTS, profileOf } from '../sim/population';
import type { Reality } from '../sim/reality';
import { fmtTime } from '../sim/time';
import type { AgentId, AgentProfile, ArcSeed, ArcState, ArcStatus, Minute, SimEvent, WorldState } from '../sim/types';
import { RELATIONSHIP_LABELS, firstName, locName } from './format';

/** Badge tone of each arc status (neutral, accent, ok, danger, warn). */
export const ARC_STATUS_TONE: Record<ArcStatus, string> = {
  open: 'muted',
  advancing: 'accent',
  fulfilled: 'ok',
  failed: 'danger',
  twisted: 'warn',
};

/** Profiles by id, for the recall helpers (`presentNames`). */
export const PROFILES: Map<AgentId, AgentProfile> = new Map(AGENTS.map((a) => [a.id, a]));

/** « 2e tentative », « 3e tentative » (nothing for a first attempt). */
export function attemptLabel(attempt: number): string | null {
  return attempt > 1 ? `${attempt}e tentative` : null;
}

/** 1 to 3 flames for the stakes of an arc (0..1). */
export function stakesLevel(stakes: number): 1 | 2 | 3 {
  return stakes >= 0.7 ? 3 : stakes >= 0.5 ? 2 : 1;
}

export const STAKES_WORDS = ['', 'modéré', 'important', 'élevé'] as const;

export interface ArcAt {
  arc: ArcState;
  seed: ArcSeed;
  status: ArcStatus;
  statusLabel: string;
}

/**
 * Status of an inhabitant's arc at `minute`, derived from the end-of-day arc
 * and the timestamps of its beats (no `stateAt`): the last turning point
 * already passed gives the outcome, any earlier beat means « en marche ».
 */
export function arcStatusAt(reality: Reality, agentId: AgentId, minute: Minute): ArcAt | null {
  const arc = arcOf(reality.engine.state, agentId);
  if (!arc) return null;
  const seed = arcSeed(arc.seedId);
  let status: ArcStatus = 'open';
  for (const id of arc.beats) {
    const e = reality.eventById(id);
    if (!e || e.t > minute) continue;
    if (e.type === 'arc_resolved') status = (e.data?.outcome as ArcStatus | undefined) ?? arc.status;
    else if (e.type === 'arc_beat' && status === 'open' && !e.data?.aftershock) status = 'advancing';
  }
  return { arc, seed, status, statusLabel: ARC_STATUS_LABELS[status] };
}

/** Drama events worth a toast in spectator mode. */
export function isDramaHighlight(e: SimEvent): boolean {
  return e.type === 'arc_resolved' || e.type === 'revelation' || e.type === 'dilemma' || (e.type === 'gossip' && !!e.data?.reachesTarget);
}

/** The inhabitant a drama event is about (owner of the arc). */
export function dramaSubject(e: SimEvent): AgentId | undefined {
  if (e.type === 'gossip' && typeof e.data?.about === 'string') return e.data.about;
  return e.actors[0];
}

/** Lower-case the first letter only (« Graphiste à l’Agence Horizon » → « graphiste à l’Agence Horizon »). */
export function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

export function truncate(s: string, n = 90): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

// ---------------------------------------------------------------------------
// Fact sheets for the narration model
// ---------------------------------------------------------------------------

/**
 * « Ce matin, dans la ville » : who wants what, what threatens it and (in the
 * laboratory) who hides what — before the day happens. No outcome is included.
 */
export function morningFacts(report: DayReport, reality: Reality, withSecrets: boolean): string {
  const start = reality.snapshots.get(360);
  const lines: string[] = [`Ville de BUTTERFLY, jour ${reality.def.day ?? 1}, 06:00 — la journée n’a pas encore eu lieu.`, 'Histoires du jour (désir, tension, échéance, enjeu) :'];
  for (const s of report.perAgent) {
    const a = s.arc;
    if (!a) continue;
    const p = profileOf(s.agentId);
    const seed = arcSeed(a.arcId);
    const parts = [`- ${p.name} (${p.age} ans, ${lowerFirst(p.occupation)}) — « ${a.title} » (${a.kind.toLowerCase()}${a.attempt > 1 ? `, ${a.attempt}e tentative après un échec la veille` : ''}).`];
    parts.push(`Désir : ${a.desire}`);
    parts.push(`Tension : ${a.tension}`);
    parts.push(`Échéance : ${fmtTime(a.deadline)}. Enjeu : ${STAKES_WORDS[stakesLevel(a.stakes)]}.`);
    if (withSecrets && a.secret) {
      const knownAtStart = start ? (arcOf(start, s.agentId)?.knownBy ?? []) : [];
      parts.push(`Secret : ${a.secret.replace(/\.$/, '')}${seed.secretAbout ? ` (caché à ${firstName(seed.secretAbout)})` : ''}${knownAtStart.length ? ` — déjà connu de ${knownAtStart.map(firstName).join(', ')}` : ''}.`);
    }
    lines.push(parts.join(' '));
  }
  return lines.join('\n');
}

/** « Ce qui aurait pu arriver » : intervention, summary, changed destinies and verified consequences. */
export function counterfactualFacts(comparison: Comparison, realityB: Reality): string {
  const lines: string[] = [];
  lines.push('Intervention(s) dans la réalité B :');
  for (const iv of realityB.def.interventions) lines.push(`- ${fmtTime(iv.t)} ${iv.description}`);
  lines.push('', 'Résumé de la comparaison :');
  for (const s of comparison.summary) lines.push(`- ${s}`);
  lines.push('', 'Destins modifiés :');
  if (comparison.arcChanges.length) for (const c of comparison.arcChanges) lines.push(`- ${c.text}${c.verified ? ' (lien causal vérifié avec l’intervention)' : ' (différence observée, sans lien causal prouvé)'}${c.eventA ? ` ; en A : ${fmtTime(c.eventA.t)} ${c.eventA.label}` : ''}${c.eventB ? ` ; en B : ${fmtTime(c.eventB.t)} ${c.eventB.label}` : ''}`);
  else lines.push('- Aucun.');
  lines.push('', 'Conséquences causalement vérifiées (dans l’ordre) :');
  if (comparison.consequences.length) {
    for (const m of comparison.consequences.slice(0, 40)) {
      if (m.status === 'only_a' && m.a) lines.push(`- ${fmtTime(m.a.t)} n’a pas eu lieu en B : ${m.a.label}`);
      else if (m.b) lines.push(`- ${fmtTime(m.b.t)} ${m.status === 'shifted' ? `(décalé de ${m.dt! > 0 ? '+' : ''}${m.dt} min) ` : m.status === 'only_b' ? '(seulement en B) ' : ''}${m.b.label}`);
    }
    if (comparison.consequences.length > 40) lines.push(`- … et ${comparison.consequences.length - 40} autres.`);
  } else lines.push('- Aucune.');
  return lines.join('\n');
}

/** Event types that can be staged as a dialogue. */
export const DIALOGUE_TYPES = new Set<SimEvent['type']>(['conversation', 'encounter', 'argument', 'revelation', 'gossip']);

/**
 * Facts for a staged dialogue around one event: the event, its mechanism, both
 * inhabitants, their relationship, their desires of the day and what each one
 * remembers of the other up to that minute. `state` is the world at `e.t`.
 */
export function dialogueFacts(e: SimEvent, state: WorldState): string {
  const [x, y] = e.actors;
  const lines: string[] = [];
  lines.push(`Événement (${fmtTime(e.t)}) : ${e.label}`);
  if (e.description) lines.push(`Description : ${e.description}`);
  if (e.mechanism) lines.push(`Mécanisme : ${e.mechanism}`);
  lines.push(`Lieu : ${e.busId ? `bus ${e.busId}` : locName(e.locationId, 'en chemin')} · heure : ${fmtTime(e.t)}`);
  const people = [x, y].filter((id): id is AgentId => !!id && !!state.agents[id]);
  for (const id of people) {
    const p = profileOf(id);
    const a = state.agents[id];
    const other = people.find((o) => o !== id);
    const parts = [`Personnage : ${p.name}, ${p.age} ans, ${lowerFirst(p.occupation)}.`];
    if (other) {
      const r = a.relationships[other];
      parts.push(r ? `Relation avec ${firstName(other)} : ${RELATIONSHIP_LABELS[r.kind] ?? r.kind}, affinité ${r.affinity.toFixed(2)} (de −1 à +1).` : `Ne connaît pas encore ${firstName(other)}.`);
    }
    const arc = arcOf(state, id);
    if (arc) {
      const seed = arcSeed(arc.seedId);
      parts.push(`Histoire du jour : « ${seed.title} » — ${seed.desire} (${ARC_KIND_LABELS[seed.kind].toLowerCase()}, ${ARC_STATUS_LABELS[arc.status]} à cet instant, échéance ${fmtTime(arcDeadline(arc))}, enjeu ${STAKES_WORDS[stakesLevel(effectiveStakes(arc))]}).`);
    }
    lines.push(parts.join(' '));
    if (other) {
      const mems = a.memories.filter((m) => m.t <= e.t && m.about.includes(other)).slice(-6);
      lines.push(mems.length ? `Souvenirs de ${p.firstName} à propos de ${firstName(other)} : ${mems.map((m) => `${fmtTime(m.t)} ${m.text}`).join(' ; ')}.` : `${p.firstName} n’a aucun souvenir enregistré à propos de ${firstName(other)}.`);
    }
  }
  return lines.join('\n');
}
