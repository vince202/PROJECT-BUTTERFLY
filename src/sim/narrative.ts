/**
 * Narrative reporting: factual French summaries built from the structured event
 * log. Nothing here invents events; every sentence points at recorded events.
 * An optional LLM may later rewrite these facts into richer prose.
 */

import type { Comparison } from './compare';
import { getCity } from './city';
import { ARC_KIND_LABELS, ARC_STATUS_LABELS, arcDeadline, arcOf, arcSeed, effectiveStakes } from './drama';
import { AGENTS, profileOf } from './population';
import type { Reality } from './reality';
import { fmtDuration, fmtTime, periodOfDay } from './time';
import type { AgentId, ArcState, EventId, SimEvent } from './types';

export interface ReportSection {
  title: string;
  items: { t?: number; text: string; eventId?: EventId; agents?: AgentId[] }[];
}

export interface DayReport {
  title: string;
  intro: string;
  sections: ReportSection[];
  perAgent: AgentSummary[];
}

export interface ArcSummary {
  arcId: string;
  title: string;
  kind: string;
  desire: string;
  tension: string;
  secret?: string;
  /** First names of those who learnt the secret today. */
  secretKnownBy: string[];
  deadline: number;
  stakes: number;
  status: ArcState['status'];
  statusLabel: string;
  progress: number;
  attempt: number;
  beats: { t: number; text: string; eventId: EventId; type: SimEvent['type'] }[];
  /** One French paragraph telling the arc. */
  story: string;
}

export interface AgentSummary {
  agentId: AgentId;
  name: string;
  headline: string;
  arc?: ArcSummary;
  timeline: { t: number; text: string; eventId: EventId }[];
  encounters: string[];
  objectives: { label: string; status: string }[];
  moodStart: number;
  moodEnd: number;
  relationshipChanges: string[];
  unresolved: string[];
  paragraph: string;
}

const locName = (id?: string | null) => (id ? getCity().location(id).name : '');
const firstName = (id: AgentId) => profileOf(id).firstName;

function moodWord(m: number): string {
  if (m > 0.5) return 'rayonnant';
  if (m > 0.2) return 'de bonne humeur';
  if (m > -0.2) return 'd’humeur neutre';
  if (m > -0.5) return 'contrarié';
  return 'abattu';
}

export function arcSummary(reality: Reality, agentId: AgentId): ArcSummary | undefined {
  const arc = arcOf(reality.engine.state, agentId);
  if (!arc) return undefined;
  const seed = arcSeed(arc.seedId);
  const p = profileOf(agentId);
  const beats = arc.beats.map((id) => reality.eventById(id)).filter((e): e is SimEvent => !!e).map((e) => ({ t: e.t, text: e.label, eventId: e.id, type: e.type }));
  const statusLabel = ARC_STATUS_LABELS[arc.status];
  const resolution = arc.resolutionEventId ? reality.eventById(arc.resolutionEventId) : undefined;
  const parts: string[] = [];
  parts.push(`${p.firstName} voulait aujourd’hui : ${seed.desire.replace(/\.$/, '')} (${ARC_KIND_LABELS[seed.kind].toLowerCase()}${arc.attempt > 1 ? `, ${arc.attempt}e tentative` : ''}).`);
  parts.push(seed.tension);
  const middle = beats.filter((b) => b.type !== 'arc_resolved');
  if (middle.length) parts.push(`En chemin : ${middle.slice(0, 4).map((b) => `${fmtTime(b.t)} ${b.text}`).join(' ; ')}.`);
  if (resolution) parts.push(`${fmtTime(resolution.t)} — ${resolution.label}${resolution.mechanism ? ` (${resolution.mechanism.toLowerCase()})` : ''}.`);
  else parts.push(`À ${fmtTime(reality.engine.state.t)}, l’histoire est encore ${statusLabel}${arc.progress > 0 ? ` (${Math.round(arc.progress * 100)} %)` : ''}.`);
  if (seed.secret && arc.knownBy.length) parts.push(`Son secret (${seed.secret.replace(/\.$/, '').toLowerCase()}) est désormais connu de ${arc.knownBy.map(firstName).join(', ')}.`);
  return {
    arcId: arc.id,
    title: seed.title,
    kind: ARC_KIND_LABELS[seed.kind],
    desire: seed.desire,
    tension: seed.tension,
    secret: seed.secret,
    secretKnownBy: arc.knownBy.map(firstName),
    deadline: arcDeadline(arc),
    stakes: effectiveStakes(arc),
    status: arc.status,
    statusLabel,
    progress: arc.progress,
    attempt: arc.attempt,
    beats,
    story: parts.join(' '),
  };
}

export function agentSummary(reality: Reality, agentId: AgentId): AgentSummary {
  const p = profileOf(agentId);
  const events = reality.eventsOf(agentId);
  const arc = arcSummary(reality, agentId);
  const start = reality.snapshots.get(360)!.agents[agentId];
  const end = reality.engine.state.agents[agentId];
  const notable = events.filter((e) => e.importance >= 0.3 && !['decision', 'depart', 'arrive', 'activity_end', 'bus_depart', 'bus_arrive'].includes(e.type));
  const timeline = notable.map((e) => ({ t: e.t, text: e.label, eventId: e.id }));
  const encounters = events
    .filter((e) => ['encounter', 'conversation', 'argument', 'meeting_start'].includes(e.type))
    .map((e) => `${fmtTime(e.t)} — ${e.label}`);
  const objectives = end.commitments.map((c) => ({ label: c.label, status: { pending: 'non réalisé', ongoing: 'en cours', done: 'accompli', missed: 'manqué', cancelled: 'abandonné' }[c.status] }));
  const relationshipChanges: string[] = [];
  for (const [other, r] of Object.entries(end.relationships)) {
    const before = start.relationships[other]?.affinity;
    if (before === undefined) {
      relationshipChanges.push(`Nouvelle connaissance : ${firstName(other)}`);
      continue;
    }
    const d = r.affinity - before;
    if (Math.abs(d) >= 0.1) relationshipChanges.push(`${firstName(other)} : ${d > 0 ? '+' : ''}${Math.round(d * 100)} (${before.toFixed(2)} → ${r.affinity.toFixed(2)})`);
  }
  const unresolved: string[] = [];
  for (const c of end.commitments) if (c.status === 'missed') unresolved.push(`Rendez-vous manqué : ${c.label}`);
  if (!end.inventory.includes('wallet')) unresolved.push('Portefeuille toujours perdu');
  for (const i of end.inventory) if (i.startsWith('wallet_of:')) unresolved.push(`Détient encore le portefeuille de ${firstName(i.slice(10))}`);
  if (end.locationId !== p.homeId) unresolved.push(`N’est pas rentré chez lui (${locName(end.locationId) || 'en chemin'})`);

  const missed = objectives.filter((o) => o.status === 'manqué').length;
  const done = objectives.filter((o) => o.status === 'accompli').length;
  const meetings = events.filter((e) => e.type === 'meeting_start').length;
  const chats = events.filter((e) => e.type === 'encounter' || e.type === 'conversation').length;
  const args = events.filter((e) => e.type === 'argument').length;
  const buses = events.filter((e) => e.type === 'board_bus').length;
  const late = events.filter((e) => e.type === 'late');
  const arcHeadline = arc && arc.status !== 'open' && arc.status !== 'advancing' ? `${p.firstName} — ${arc.title} : ${arc.statusLabel}` : null;
  const arcDrama = arc && (arc.status === 'failed' || arc.status === 'twisted') ? arcHeadline : null;
  const headline = missed ? `${p.firstName} a manqué ${missed} rendez-vous` : arcDrama ?? (args ? `${p.firstName} s’est disputé` : late.length ? `${p.firstName} est arrivé en retard` : arcHeadline ?? (chats >= 4 ? `Journée très sociale pour ${p.firstName}` : `Journée ordinaire pour ${p.firstName}`));

  const parts: string[] = [];
  parts.push(`${p.name}, ${p.age} ans, ${p.occupation.toLowerCase()}, a commencé la journée ${moodWord(start.emotions.mood)} et l’a terminée ${moodWord(end.emotions.mood)}.`);
  if (arc) parts.push(arc.story);
  if (done) parts.push(`${p.firstName} a accompli ${done} objectif${done > 1 ? 's' : ''} (${objectives.filter((o) => o.status === 'accompli').map((o) => o.label.toLowerCase()).join(', ')}).`);
  if (missed) parts.push(`${missed} engagement${missed > 1 ? 's ont' : ' a'} été manqué${missed > 1 ? 's' : ''} : ${objectives.filter((o) => o.status === 'manqué').map((o) => o.label.toLowerCase()).join(', ')}.`);
  if (meetings) parts.push(`${meetings} rendez-vous ${meetings > 1 ? 'ont' : 'a'} eu lieu.`);
  if (chats) parts.push(`${p.firstName} a échangé avec ${new Set(events.filter((e) => e.type === 'encounter' || e.type === 'conversation').flatMap((e) => e.actors.filter((x) => x !== agentId))).size} personne(s) au cours de ${chats} conversation${chats > 1 ? 's' : ''}.`);
  if (args) parts.push(`Il y a eu ${args} dispute${args > 1 ? 's' : ''}.`);
  if (buses) parts.push(`${p.firstName} a pris le bus ${buses} fois.`);
  for (const l of late) parts.push(`${l.label}.`);
  const strongMemories = end.memories.filter((m) => m.importance >= 0.6).slice(0, 3);
  if (strongMemories.length) parts.push(`Souvenirs marquants : ${strongMemories.map((m) => `${fmtTime(m.t)} ${m.text}`).join(' ; ')}.`);
  if (unresolved.length) parts.push(`Non résolu : ${unresolved.join(' ; ')}.`);

  return { agentId, name: p.name, headline, arc, timeline, encounters, objectives, moodStart: start.emotions.mood, moodEnd: end.emotions.mood, relationshipChanges, unresolved, paragraph: parts.join(' ') };
}

export function whoMetWhom(reality: Reality): { a: AgentId; b: AgentId; count: number; places: string[]; first: number }[] {
  const map = new Map<string, { a: AgentId; b: AgentId; count: number; places: Set<string>; first: number }>();
  for (const e of reality.events) {
    if (!['encounter', 'conversation', 'argument', 'meeting_start'].includes(e.type)) continue;
    const ids = [...e.actors].sort();
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]}|${ids[j]}`;
        const cur = map.get(key) ?? { a: ids[i], b: ids[j], count: 0, places: new Set<string>(), first: e.t };
        cur.count += 1;
        cur.places.add(e.busId ? `bus ${e.busId}` : locName(e.locationId));
        map.set(key, cur);
      }
  }
  return [...map.values()].map((v) => ({ ...v, places: [...v.places] })).sort((x, y) => y.count - x.count);
}

export function dayReport(reality: Reality, comparison?: Comparison | null): DayReport {
  const ev = reality.events;
  const important = ev.filter((e) => e.importance >= 0.5 && e.type !== 'decision');
  const graph = reality.causal;

  const overview: ReportSection = { title: 'Vue chronologique', items: [] };
  const periods = ['aube', 'matin', 'midi', 'après-midi', 'soir', 'nuit'] as const;
  for (const period of periods) {
    const inPeriod = important.filter((e) => periodOfDay(e.t) === period);
    if (!inPeriod.length) continue;
    const top = inPeriod.sort((a, b) => b.importance - a.importance || a.t - b.t).slice(0, 6).sort((a, b) => a.t - b.t);
    overview.items.push({ text: `— ${period.charAt(0).toUpperCase() + period.slice(1)} : ${inPeriod.length} événements marquants` });
    for (const e of top) overview.items.push({ t: e.t, text: e.label, eventId: e.id, agents: e.actors });
  }

  const encounters: ReportSection = { title: 'Rencontres significatives', items: [] };
  for (const e of ev.filter((e) => ['meeting_start', 'conversation', 'argument'].includes(e.type) || (e.type === 'encounter' && e.importance >= 0.5))) encounters.items.push({ t: e.t, text: e.label, eventId: e.id, agents: e.actors });

  const missed: ReportSection = { title: 'Occasions manquées', items: [] };
  for (const e of ev.filter((e) => ['meeting_missed', 'miss_bus', 'found_closed', 'late'].includes(e.type))) missed.items.push({ t: e.t, text: `${e.label}${e.mechanism ? ` — ${e.mechanism}` : ''}`, eventId: e.id, agents: e.actors });
  for (const e of ev.filter((e) => e.type === 'activity_end' && /ne trouve pas|trop tard/.test(e.label))) missed.items.push({ t: e.t, text: e.label, eventId: e.id, agents: e.actors });

  const unexpected: ReportSection = { title: 'Événements inattendus', items: [] };
  for (const e of ev.filter((e) => ['lose_item', 'find_item', 'return_item', 'shop_closed', 'weather', 'invitation', 'intervention', 'incident', 'accident', 'fire', 'theft', 'breakup', 'dismissal', 'promotion', 'illness'].includes(e.type) || (e.type === 'bus_delay' && Number(e.data?.minutes ?? 0) >= 2))) unexpected.items.push({ t: e.t, text: e.label, eventId: e.id, agents: e.actors });

  const relations: ReportSection = { title: 'Évolution des relations', items: [] };
  const startState = reality.snapshots.get(360)!;
  const endState = reality.engine.state;
  const relChanges: { a: AgentId; b: AgentId; d: number }[] = [];
  for (const a of Object.values(endState.agents)) {
    for (const [other, r] of Object.entries(a.relationships)) {
      const before = startState.agents[a.id].relationships[other]?.affinity ?? 0;
      const d = r.affinity - before;
      if (Math.abs(d) >= 0.12) relChanges.push({ a: a.id, b: other, d });
    }
  }
  relChanges.sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  for (const c of relChanges.slice(0, 12)) relations.items.push({ text: `${firstName(c.a)} → ${firstName(c.b)} : ${c.d > 0 ? 'se rapprochent' : 's’éloignent'} (${c.d > 0 ? '+' : ''}${Math.round(c.d * 100)})`, agents: [c.a, c.b] });
  const newAcq = ev.filter((e) => e.type === 'encounter' && /fait la connaissance/.test(e.label));
  for (const e of newAcq) relations.items.push({ t: e.t, text: e.label, eventId: e.id, agents: e.actors });

  const decisions: ReportSection = { title: 'Décisions personnelles importantes', items: [] };
  for (const e of ev.filter((e) => e.type === 'plan_change' || e.type === 'invitation').filter((e) => e.importance >= 0.5 && !/Dormir|Se reposer/.test(e.label)).slice(0, 15)) decisions.items.push({ t: e.t, text: `${e.label}${e.mechanism ? ` (${e.mechanism})` : ''}`, eventId: e.id, agents: e.actors });

  const unresolved: ReportSection = { title: 'Situations non résolues', items: [] };
  for (const a of Object.values(endState.agents)) {
    for (const c of a.commitments) if (c.status === 'missed' && c.with.length) unresolved.items.push({ text: `${firstName(a.id)} : « ${c.label} » n’a pas eu lieu`, agents: [a.id, ...c.with] });
    if (!a.inventory.includes('wallet')) unresolved.items.push({ text: `${firstName(a.id)} n’a toujours pas retrouvé son portefeuille`, agents: [a.id] });
    for (const i of a.inventory) if (i.startsWith('wallet_of:')) unresolved.items.push({ text: `${firstName(a.id)} détient encore le portefeuille de ${firstName(i.slice(10))}`, agents: [a.id, i.slice(10)] });
    if (a.locationId !== profileOf(a.id).homeId) unresolved.items.push({ text: `${firstName(a.id)} n’est pas rentré chez lui à minuit (${locName(a.locationId) || 'en chemin'})`, agents: [a.id] });
  }
  const dedup = new Set<string>();
  unresolved.items = unresolved.items.filter((i) => (dedup.has(i.text) ? false : (dedup.add(i.text), true)));

  const chains: ReportSection = { title: 'Chaînes causales intéressantes', items: [] };
  const top = graph.mostImpactful(5, (e) => e.importance >= 0.3 && !['decision', 'activity_start', 'wake', 'depart'].includes(e.type));
  for (const { event, impact, descendants } of top) {
    const far = [...graph.descendants(event.id).entries()].map(([id, d]) => ({ e: graph.get(id)!, d })).filter((x) => x.e.importance >= 0.5 && x.e.type !== 'decision').sort((x, y) => y.d - x.d)[0];
    const tail = far ? ` → … → ${fmtTime(far.e.t)} ${far.e.label} (${far.d} maillons)` : '';
    chains.items.push({ t: event.t, text: `${event.label} : ${descendants} événements en aval (impact ${impact.toFixed(1)})${tail}`, eventId: event.id, agents: event.actors });
  }

  const arcs: ReportSection = { title: 'Arcs du jour — ce que chacun voulait', items: [] };
  const arcStates = Object.values(endState.arcs ?? {});
  const order: Record<string, number> = { twisted: 0, failed: 1, fulfilled: 2, advancing: 3, open: 4 };
  for (const arc of [...arcStates].sort((x, y) => order[x.status] - order[y.status] || (x.resolvedAt ?? 9999) - (y.resolvedAt ?? 9999))) {
    const seed = arcSeed(arc.seedId);
    const res = arc.resolutionEventId ? reality.eventById(arc.resolutionEventId) : undefined;
    const word = ARC_STATUS_LABELS[arc.status];
    arcs.items.push({ t: res?.t, text: `${firstName(arc.agentId)} — « ${seed.title} » : ${word}${res ? ` — ${res.label.replace(/^[^—]+— [^:]+: /, '')}` : arc.progress > 0 ? ` (${Math.round(arc.progress * 100)} %)` : ''}`, eventId: res?.id, agents: [arc.agentId] });
  }
  const twists: ReportSection = { title: 'Confidences, rumeurs et dilemmes', items: [] };
  for (const e of ev.filter((e) => ['revelation', 'gossip', 'dilemma'].includes(e.type))) twists.items.push({ t: e.t, text: e.label, eventId: e.id, agents: e.actors });

  const sections = [arcs, overview, twists, encounters, missed, unexpected, relations, decisions, unresolved, chains];
  if (comparison) {
    const diff: ReportSection = { title: 'Ce qui a changé entre les deux réalités', items: [] };
    for (const s of comparison.summary) diff.items.push({ text: s });
    for (const c of comparison.arcChanges) diff.items.push({ t: c.eventB?.t, text: `Destin modifié — ${c.text}`, eventId: c.eventB?.id, agents: [c.agentId] });
    for (const m of comparison.consequences.slice(0, 12)) if (m.b) diff.items.push({ t: m.b.t, text: `${m.status === 'shifted' ? `(décalé de ${m.dt! > 0 ? '+' : ''}${m.dt} min) ` : ''}${m.b.label}`, eventId: m.b.id, agents: m.b.actors });
    sections.push(diff);
  }

  const n = ev.length;
  const meetings = ev.filter((e) => e.type === 'meeting_start').length;
  const missedN = ev.filter((e) => e.type === 'meeting_missed').length;
  const chats = ev.filter((e) => e.type === 'encounter' || e.type === 'conversation').length;
  const fulfilled = arcStates.filter((a) => a.status === 'fulfilled').length;
  const failed = arcStates.filter((a) => a.status === 'failed').length;
  const twisted = arcStates.filter((a) => a.status === 'twisted').length;
  const intro = `Journée simulée avec la graine ${reality.seed}${reality.def.interventions.length ? ` et ${reality.def.interventions.length} intervention(s)` : ''} : ${n} événements enregistrés, ${meetings} rendez-vous tenus, ${missedN} manqué${missedN > 1 ? 's' : ''}, ${chats} conversations, ${ev.filter((e) => e.type === 'board_bus').length} montées dans le bus${endState.weatherSchedule.some((w) => w.condition === 'rain') ? ', une averse' : ', pas de pluie'}. Sur ${arcStates.length} histoires du jour : ${fulfilled} accomplie${fulfilled > 1 ? 's' : ''}, ${failed} échouée${failed > 1 ? 's' : ''}, ${twisted} bouleversée${twisted > 1 ? 's' : ''}.`;

  const dayLabel = (reality.def.day ?? 1) > 1 ? `Jour ${reality.def.day} — ` : '';
  return { title: `Rapport de la journée — ${dayLabel}${reality.def.name}`, intro, sections, perAgent: AGENTS.map((a) => agentSummary(reality, a.id)) };
}

/** Answer simple French questions about a day (and optionally about a comparison). */
export function answerQuestion(question: string, reality: Reality, comparison?: Comparison | null): string {
  const q = question.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const agent = AGENTS.find((a) => q.includes(a.firstName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')));
  if (/qui a rencontre qui|qui a vu qui|rencontres/.test(q)) {
    const pairs = whoMetWhom(reality).slice(0, 12);
    if (!pairs.length) return 'Personne ne s’est rencontré aujourd’hui.';
    return pairs.map((p) => `${firstName(p.a)} et ${firstName(p.b)} : ${p.count} fois (${p.places.join(', ')}, dès ${fmtTime(p.first)})`).join('\n');
  }
  if (/plus d impact|plus grand impact|le plus de consequences|impact/.test(q)) {
    const top = reality.causal.mostImpactful(3, (e) => e.importance >= 0.3 && !['decision', 'activity_start', 'wake', 'depart'].includes(e.type));
    return top.map((x, i) => `${i + 1}. ${fmtTime(x.event.t)} ${x.event.label} — ${x.descendants} événements en aval, impact ${x.impact.toFixed(1)}`).join('\n');
  }
  if (/histoire|arc|voulait|destin|secret|objectif/.test(q)) {
    const arcs = Object.values(reality.engine.state.arcs ?? {});
    const pick = agent ? arcs.filter((a) => a.agentId === agent.id) : arcs;
    if (!pick.length) return 'Aucune histoire du jour n’est enregistrée.';
    return pick.map((a) => { const s = arcSummary(reality, a.agentId); return s ? `${firstName(a.agentId)} — « ${s.title} » (${s.statusLabel}) : ${s.story}` : ''; }).filter(Boolean).join('\n');
  }
  if (/change|differen|deux realites|realite b/.test(q)) {
    if (!comparison) return 'Aucune réalité alternative n’a encore été créée. Utilisez l’éditeur d’interventions.';
    return comparison.summary.join('\n');
  }
  if (agent) {
    const s = agentSummary(reality, agent.id);
    return `${s.headline}.\n${s.paragraph}`;
  }
  const r = dayReport(reality, comparison);
  return r.intro;
}

/** Plain-text export of a report. */
export function reportToText(report: DayReport): string {
  const lines: string[] = [report.title, '', report.intro, ''];
  for (const s of report.sections) {
    if (!s.items.length) continue;
    lines.push(`## ${s.title}`);
    for (const i of s.items) lines.push(`${i.t !== undefined ? fmtTime(i.t) + '  ' : ''}${i.text}`);
    lines.push('');
  }
  lines.push('## Habitants');
  for (const a of report.perAgent) {
    lines.push(`### ${a.name} — ${a.headline}`);
    lines.push(a.paragraph);
    lines.push('');
  }
  return lines.join('\n');
}

export function describeDuration(min: number): string {
  return fmtDuration(min);
}

export function eventSentence(e: SimEvent): string {
  return `${fmtTime(e.t)} — ${e.label}${e.mechanism ? ` (${e.mechanism})` : ''}`;
}
