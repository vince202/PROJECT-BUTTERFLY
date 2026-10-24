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
import { ACTION_LABELS } from './decision';
import { t } from '../i18n';
import { DAY_PERIODS, fmtDuration, fmtTime, periodKey, periodLabel } from './time';
import type { AgentId, ArcState, Commitment, EventId, SimEvent } from './types';

export interface ReportSection {
  /** Stable machine id (titles are translated): arcs, overview, twists, encounters, missed, unexpected, relations, decisions, unresolved, chains, diff. */
  id?: string;
  title: string;
  /** `heading: true` marks a sub-heading line (e.g. a day period) rather than an event. */
  items: { t?: number; text: string; eventId?: EventId; agents?: AgentId[]; heading?: boolean }[];
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
  /** `status` is the translated word; `state` is the stable commitment status. */
  objectives: { label: string; status: string; state: Commitment['status'] }[];
  moodStart: number;
  moodEnd: number;
  relationshipChanges: string[];
  unresolved: string[];
  paragraph: string;
}

const locName = (id?: string | null) => (id ? getCity().location(id).name : '');
const firstName = (id: AgentId) => profileOf(id).firstName;

function objectiveWord(s: Commitment['status']): string {
  switch (s) {
    case 'pending':
      return t('engine.report_obj_pending');
    case 'ongoing':
      return t('engine.report_obj_ongoing');
    case 'done':
      return t('engine.report_obj_done');
    case 'missed':
      return t('engine.report_obj_missed');
    default:
      return t('engine.report_obj_cancelled');
  }
}

/** Labels of the « quiet » activities (sleeping, resting) that the decisions section leaves out. */
const quietLabels = () => [ACTION_LABELS.sleep, ACTION_LABELS.rest_home];

/** An `activity_end` that records a missed arrival (visit target gone, appointment already missed): recognised by its signature, not by its text. */
function isMissedArrival(e: SimEvent): boolean {
  const sig = e.signature.split('|').slice(3).join('|');
  return sig.startsWith('missed_visit:') || sig.endsWith(':late');
}

function moodWord(m: number): string {
  if (m > 0.5) return t('engine.mood_radiant');
  if (m > 0.2) return t('engine.mood_good');
  if (m > -0.2) return t('engine.mood_neutral');
  if (m > -0.5) return t('engine.mood_annoyed');
  return t('engine.mood_down');
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
  parts.push(t(arc.attempt > 1 ? 'engine.report_arc_wanted_retry' : 'engine.report_arc_wanted', { name: p.firstName, desire: seed.desire.replace(/\.$/, ''), kind: ARC_KIND_LABELS[seed.kind].toLowerCase(), attempt: arc.attempt }));
  parts.push(seed.tension);
  const middle = beats.filter((b) => b.type !== 'arc_resolved');
  if (middle.length) parts.push(t('engine.report_arc_on_the_way', { list: middle.slice(0, 4).map((b) => `${fmtTime(b.t)} ${b.text}`).join(t('engine.sep_semicolon')) }));
  if (resolution) parts.push(resolution.mechanism ? t('engine.report_arc_resolution_mech', { time: fmtTime(resolution.t), label: resolution.label, mechanism: resolution.mechanism.toLowerCase() }) : t('engine.report_arc_resolution', { time: fmtTime(resolution.t), label: resolution.label }));
  else parts.push(arc.progress > 0 ? t('engine.report_arc_ongoing_progress', { time: fmtTime(reality.engine.state.t), status: statusLabel, percent: Math.round(arc.progress * 100) }) : t('engine.report_arc_ongoing', { time: fmtTime(reality.engine.state.t), status: statusLabel }));
  if (seed.secret && arc.knownBy.length) parts.push(t('engine.report_arc_secret_known', { secret: seed.secret.replace(/\.$/, '').toLowerCase(), names: arc.knownBy.map(firstName).join(', ') }));
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
  const objectives = end.commitments.map((c) => ({ label: c.label, status: objectiveWord(c.status), state: c.status }));
  const relationshipChanges: string[] = [];
  for (const [other, r] of Object.entries(end.relationships)) {
    const before = start.relationships[other]?.affinity;
    if (before === undefined) {
      relationshipChanges.push(t('engine.report_new_acquaintance', { name: firstName(other) }));
      continue;
    }
    const d = r.affinity - before;
    if (Math.abs(d) >= 0.1) relationshipChanges.push(`${firstName(other)} : ${d > 0 ? '+' : ''}${Math.round(d * 100)} (${before.toFixed(2)} → ${r.affinity.toFixed(2)})`);
  }
  const unresolved: string[] = [];
  for (const c of end.commitments) if (c.status === 'missed') unresolved.push(t('engine.report_unres_missed_meeting', { label: c.label }));
  if (!end.inventory.includes('wallet')) unresolved.push(t('engine.report_unres_wallet_lost'));
  for (const i of end.inventory) if (i.startsWith('wallet_of:')) unresolved.push(t('engine.report_unres_holds_wallet', { owner: firstName(i.slice(10)) }));
  if (end.locationId !== p.homeId) unresolved.push(t('engine.report_unres_not_home', { place: locName(end.locationId) || t('engine.on_the_way') }));

  const missed = objectives.filter((o) => o.state === 'missed').length;
  const done = objectives.filter((o) => o.state === 'done').length;
  const meetings = events.filter((e) => e.type === 'meeting_start').length;
  const chats = events.filter((e) => e.type === 'encounter' || e.type === 'conversation').length;
  const args = events.filter((e) => e.type === 'argument').length;
  const buses = events.filter((e) => e.type === 'board_bus').length;
  const late = events.filter((e) => e.type === 'late');
  const arcHeadline = arc && arc.status !== 'open' && arc.status !== 'advancing' ? t('engine.report_headline_arc', { name: p.firstName, title: arc.title, status: arc.statusLabel }) : null;
  const arcDrama = arc && (arc.status === 'failed' || arc.status === 'twisted') ? arcHeadline : null;
  const headline = missed ? t('engine.report_headline_missed', { name: p.firstName, n: missed }) : arcDrama ?? (args ? t('engine.report_headline_argued', { name: p.firstName }) : late.length ? t('engine.report_headline_late', { name: p.firstName }) : arcHeadline ?? (chats >= 4 ? t('engine.report_headline_social', { name: p.firstName }) : t('engine.report_headline_ordinary', { name: p.firstName })));

  const parts: string[] = [];
  parts.push(t('engine.report_para_mood', { name: p.name, age: p.age, occupation: p.occupation.toLowerCase(), start: moodWord(start.emotions.mood), end: moodWord(end.emotions.mood) }));
  if (arc) parts.push(arc.story);
  if (done) parts.push(t('engine.report_para_done', { name: p.firstName, n: done, list: objectives.filter((o) => o.state === 'done').map((o) => o.label.toLowerCase()).join(', ') }));
  if (missed) parts.push(t('engine.report_para_missed', { n: missed, list: objectives.filter((o) => o.state === 'missed').map((o) => o.label.toLowerCase()).join(', ') }));
  if (meetings) parts.push(t('engine.report_para_meetings', { n: meetings }));
  if (chats) parts.push(t('engine.report_para_chats', { name: p.firstName, people: new Set(events.filter((e) => e.type === 'encounter' || e.type === 'conversation').flatMap((e) => e.actors.filter((x) => x !== agentId))).size, n: chats }));
  if (args) parts.push(t('engine.report_para_disputes', { n: args }));
  if (buses) parts.push(t('engine.report_para_bus', { name: p.firstName, n: buses }));
  for (const l of late) parts.push(`${l.label}.`);
  const strongMemories = end.memories.filter((m) => m.importance >= 0.6).slice(0, 3);
  if (strongMemories.length) parts.push(t('engine.report_para_memories', { list: strongMemories.map((m) => `${fmtTime(m.t)} ${m.text}`).join(t('engine.sep_semicolon')) }));
  if (unresolved.length) parts.push(t('engine.report_para_unresolved', { list: unresolved.join(t('engine.sep_semicolon')) }));

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
        cur.places.add(e.busId ? t('engine.report_place_bus', { bus: e.busId }) : locName(e.locationId));
        map.set(key, cur);
      }
  }
  return [...map.values()].map((v) => ({ ...v, places: [...v.places] })).sort((x, y) => y.count - x.count);
}

export function dayReport(reality: Reality, comparison?: Comparison | null): DayReport {
  const ev = reality.events;
  const important = ev.filter((e) => e.importance >= 0.5 && e.type !== 'decision');
  const graph = reality.causal;

  const overview: ReportSection = { id: 'overview', title: t('engine.report_title_overview'), items: [] };
  for (const period of DAY_PERIODS) {
    const inPeriod = important.filter((e) => periodKey(e.t) === period);
    if (!inPeriod.length) continue;
    const top = inPeriod.sort((a, b) => b.importance - a.importance || a.t - b.t).slice(0, 6).sort((a, b) => a.t - b.t);
    const periodWord = periodLabel(period);
    overview.items.push({ text: t('engine.report_period_heading', { period: periodWord.charAt(0).toUpperCase() + periodWord.slice(1), n: inPeriod.length }), heading: true });
    for (const e of top) overview.items.push({ t: e.t, text: e.label, eventId: e.id, agents: e.actors });
  }

  const encounters: ReportSection = { id: 'encounters', title: t('engine.report_title_encounters'), items: [] };
  for (const e of ev.filter((e) => ['meeting_start', 'conversation', 'argument'].includes(e.type) || (e.type === 'encounter' && e.importance >= 0.5))) encounters.items.push({ t: e.t, text: e.label, eventId: e.id, agents: e.actors });

  const missed: ReportSection = { id: 'missed', title: t('engine.report_title_missed'), items: [] };
  for (const e of ev.filter((e) => ['meeting_missed', 'miss_bus', 'found_closed', 'late'].includes(e.type))) missed.items.push({ t: e.t, text: `${e.label}${e.mechanism ? ` — ${e.mechanism}` : ''}`, eventId: e.id, agents: e.actors });
  for (const e of ev.filter((e) => e.type === 'activity_end' && isMissedArrival(e))) missed.items.push({ t: e.t, text: e.label, eventId: e.id, agents: e.actors });

  const unexpected: ReportSection = { id: 'unexpected', title: t('engine.report_title_unexpected'), items: [] };
  for (const e of ev.filter((e) => ['lose_item', 'find_item', 'return_item', 'shop_closed', 'weather', 'invitation', 'intervention', 'incident', 'accident', 'fire', 'theft', 'breakup', 'dismissal', 'promotion', 'illness'].includes(e.type) || (e.type === 'bus_delay' && Number(e.data?.minutes ?? 0) >= 2))) unexpected.items.push({ t: e.t, text: e.label, eventId: e.id, agents: e.actors });

  const relations: ReportSection = { id: 'relations', title: t('engine.report_title_relations'), items: [] };
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
  for (const c of relChanges.slice(0, 12)) relations.items.push({ text: t(c.d > 0 ? 'engine.report_rel_closer' : 'engine.report_rel_apart', { a: firstName(c.a), b: firstName(c.b), delta: `${c.d > 0 ? '+' : ''}${Math.round(c.d * 100)}` }), agents: [c.a, c.b] });
  const newAcq = ev.filter((e) => e.type === 'encounter' && e.data?.stranger === true);
  for (const e of newAcq) relations.items.push({ t: e.t, text: e.label, eventId: e.id, agents: e.actors });

  const decisions: ReportSection = { id: 'decisions', title: t('engine.report_title_decisions'), items: [] };
  for (const e of ev.filter((e) => e.type === 'plan_change' || e.type === 'invitation').filter((e) => e.importance >= 0.5 && !quietLabels().some((q) => e.label.includes(q))).slice(0, 15)) decisions.items.push({ t: e.t, text: `${e.label}${e.mechanism ? ` (${e.mechanism})` : ''}`, eventId: e.id, agents: e.actors });

  const unresolved: ReportSection = { id: 'unresolved', title: t('engine.report_title_unresolved'), items: [] };
  for (const a of Object.values(endState.agents)) {
    for (const c of a.commitments) if (c.status === 'missed' && c.with.length) unresolved.items.push({ text: t('engine.report_unres_commitment', { name: firstName(a.id), label: c.label }), agents: [a.id, ...c.with] });
    if (!a.inventory.includes('wallet')) unresolved.items.push({ text: t('engine.report_unres_no_wallet', { name: firstName(a.id) }), agents: [a.id] });
    for (const i of a.inventory) if (i.startsWith('wallet_of:')) unresolved.items.push({ text: t('engine.report_unres_holds_wallet_of', { name: firstName(a.id), owner: firstName(i.slice(10)) }), agents: [a.id, i.slice(10)] });
    if (a.locationId !== profileOf(a.id).homeId) unresolved.items.push({ text: t('engine.report_unres_not_home_midnight', { name: firstName(a.id), place: locName(a.locationId) || t('engine.on_the_way') }), agents: [a.id] });
  }
  const dedup = new Set<string>();
  unresolved.items = unresolved.items.filter((i) => (dedup.has(i.text) ? false : (dedup.add(i.text), true)));

  const chains: ReportSection = { id: 'chains', title: t('engine.report_title_chains'), items: [] };
  const top = graph.mostImpactful(5, (e) => e.importance >= 0.3 && !['decision', 'activity_start', 'wake', 'depart'].includes(e.type));
  for (const { event, impact, descendants } of top) {
    const far = [...graph.descendants(event.id).entries()].map(([id, d]) => ({ e: graph.get(id)!, d })).filter((x) => x.e.importance >= 0.5 && x.e.type !== 'decision').sort((x, y) => y.d - x.d)[0];
    const text = far ? t('engine.report_chain_far', { label: event.label, n: descendants, impact: impact.toFixed(1), time: fmtTime(far.e.t), far: far.e.label, links: far.d }) : t('engine.report_chain', { label: event.label, n: descendants, impact: impact.toFixed(1) });
    chains.items.push({ t: event.t, text, eventId: event.id, agents: event.actors });
  }

  const arcs: ReportSection = { id: 'arcs', title: t('engine.report_title_arcs'), items: [] };
  const arcStates = Object.values(endState.arcs ?? {});
  const order: Record<string, number> = { twisted: 0, failed: 1, fulfilled: 2, advancing: 3, open: 4 };
  for (const arc of [...arcStates].sort((x, y) => order[x.status] - order[y.status] || (x.resolvedAt ?? 9999) - (y.resolvedAt ?? 9999))) {
    const seed = arcSeed(arc.seedId);
    const res = arc.resolutionEventId ? reality.eventById(arc.resolutionEventId) : undefined;
    const word = ARC_STATUS_LABELS[arc.status];
    const line = { name: firstName(arc.agentId), title: seed.title, status: word };
    const text = res ? t('engine.report_arc_line_resolved', { ...line, text: typeof res.data?.text === 'string' ? res.data.text : res.label }) : arc.progress > 0 ? t('engine.report_arc_line_progress', { ...line, percent: Math.round(arc.progress * 100) }) : t('engine.report_arc_line', line);
    arcs.items.push({ t: res?.t, text, eventId: res?.id, agents: [arc.agentId] });
  }
  const twists: ReportSection = { id: 'twists', title: t('engine.report_title_twists'), items: [] };
  for (const e of ev.filter((e) => ['revelation', 'gossip', 'dilemma'].includes(e.type))) twists.items.push({ t: e.t, text: e.label, eventId: e.id, agents: e.actors });

  const sections = [arcs, overview, twists, encounters, missed, unexpected, relations, decisions, unresolved, chains];
  if (comparison) {
    const diff: ReportSection = { id: 'diff', title: t('engine.report_title_diff'), items: [] };
    for (const s of comparison.summary) diff.items.push({ text: s });
    for (const c of comparison.arcChanges) diff.items.push({ t: c.eventB?.t, text: t('engine.report_destiny_changed', { text: c.text }), eventId: c.eventB?.id, agents: [c.agentId] });
    for (const m of comparison.consequences.slice(0, 12)) if (m.b) diff.items.push({ t: m.b.t, text: m.status === 'shifted' ? t('engine.report_shifted', { delta: `${m.dt! > 0 ? '+' : ''}${m.dt}`, label: m.b.label }) : m.b.label, eventId: m.b.id, agents: m.b.actors });
    sections.push(diff);
  }

  const n = ev.length;
  const meetings = ev.filter((e) => e.type === 'meeting_start').length;
  const missedN = ev.filter((e) => e.type === 'meeting_missed').length;
  const chats = ev.filter((e) => e.type === 'encounter' || e.type === 'conversation').length;
  const fulfilled = arcStates.filter((a) => a.status === 'fulfilled').length;
  const failed = arcStates.filter((a) => a.status === 'failed').length;
  const twisted = arcStates.filter((a) => a.status === 'twisted').length;
  const intro = t('engine.report_intro', { seed: reality.seed, ivs: reality.def.interventions.length, events: n, meetings, missed: missedN, chats, boards: ev.filter((e) => e.type === 'board_bus').length, rain: endState.weatherSchedule.some((w) => w.condition === 'rain'), arcs: arcStates.length, fulfilled, failed, twisted });

  const title = (reality.def.day ?? 1) > 1 ? t('engine.report_title_dayn', { day: reality.def.day, name: reality.def.name }) : t('engine.report_title_day1', { name: reality.def.name });
  return { title, intro, sections, perAgent: AGENTS.map((a) => agentSummary(reality, a.id)) };
}

/** Answer simple French questions about a day (and optionally about a comparison). */
export function answerQuestion(question: string, reality: Reality, comparison?: Comparison | null): string {
  const q = question.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const agent = AGENTS.find((a) => q.includes(a.firstName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')));
  if (/qui a rencontre qui|qui a vu qui|rencontres/.test(q)) {
    const pairs = whoMetWhom(reality).slice(0, 12);
    if (!pairs.length) return t('engine.report_answer_nobody_met');
    return pairs.map((p) => t('engine.report_answer_pair', { a: firstName(p.a), b: firstName(p.b), count: p.count, places: p.places.join(', '), time: fmtTime(p.first) })).join('\n');
  }
  if (/plus d impact|plus grand impact|le plus de consequences|impact/.test(q)) {
    const top = reality.causal.mostImpactful(3, (e) => e.importance >= 0.3 && !['decision', 'activity_start', 'wake', 'depart'].includes(e.type));
    return top.map((x, i) => t('engine.report_answer_impact', { rank: i + 1, time: fmtTime(x.event.t), label: x.event.label, n: x.descendants, impact: x.impact.toFixed(1) })).join('\n');
  }
  if (/histoire|arc|voulait|destin|secret|objectif/.test(q)) {
    const arcs = Object.values(reality.engine.state.arcs ?? {});
    const pick = agent ? arcs.filter((a) => a.agentId === agent.id) : arcs;
    if (!pick.length) return t('engine.report_answer_no_arcs');
    return pick.map((a) => { const s = arcSummary(reality, a.agentId); return s ? t('engine.report_answer_arc', { name: firstName(a.agentId), title: s.title, status: s.statusLabel, story: s.story }) : ''; }).filter(Boolean).join('\n');
  }
  if (/change|differen|deux realites|realite b/.test(q)) {
    if (!comparison) return t('engine.report_answer_no_comparison');
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
  lines.push(`## ${t('engine.report_heading_inhabitants')}`);
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
