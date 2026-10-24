/**
 * Advised decision policy: an external "advisor" (an LLM, a learned model, or a
 * deterministic mock) arbitrates the genuinely open choices of the inhabitants.
 *
 * The engine stays authoritative: it builds the candidates, applies every hard
 * constraint, and only asks the advisor to pick among valid options when the
 * utility scores are close. Because the engine is synchronous and
 * deterministic, advice is gathered with an "oracle cache": the day is
 * simulated, the open decisions that have no cached answer are collected, the
 * advisor answers them in a batch, and the day is simulated again with the
 * cache. A few passes converge; what remains unanswered falls back to the
 * utility choice. The same cache replays identically, so realities A and B
 * built with the same policy object stay comparable.
 */

import { UtilityPolicy, type DecisionContext, type DecisionOutcome, type DecisionPolicy } from './decision';
import { t as tx } from '../i18n';
import { profileOf } from './population';
import { Reality, type RealityDef } from './reality';
import { fmtTime } from './time';
import { ARC_STATUS_LABELS, arcDeadline, arcOf, arcSeed, desireLabel } from './drama';
import { presentNames, recallMemories, situationQuery, type Embedder } from './recall';
import type { AgentId, AgentProfile, AgentState, Candidate, Memory, Minute } from './types';

export interface AdviceCandidate {
  /** Stable identity of the option: `${action}@${locationId}`. */
  choice: string;
  label: string;
  score: number;
  /** Main score components, rounded, for the advisor's context. */
  components: { label: string; value: number }[];
}

export interface AdviceRequest {
  key: string;
  agentId: AgentId;
  name: string;
  t: Minute;
  time: string;
  occupation: string;
  traits: string;
  needs: string;
  mood: string;
  goals: string[];
  location: string;
  recentMemories: string[];
  influences: string[];
  nextCommitment?: string;
  /** Dramaturgical stakes of the day (desire, tension, deadline, state), when an arc is open. */
  stakes?: string;
  /** One-line description of the situation (query for memory recall). */
  situation: string;
  /** Who the advisor plays: the inhabitant's free will, or the dramaturge keeping the day's stories unresolved. */
  role: AdvisorRole;
  /** Memories ranked by relevance to the situation (filled by the recall step). */
  relevantMemories?: string[];
  /** Precedents from the persistent brain: what happened in similar situations before (filled server-side). */
  precedents?: string[];
  /** All memories at decision time (consumed by the recall step, not sent to advisors). */
  memoryPool?: Memory[];
  candidates: AdviceCandidate[];
  /** The utility policy's own pick (baseline). */
  baseline: string;
}

export interface AdviceAnswer {
  key: string;
  /** One of the request's candidate `choice` values. */
  choice: string;
  reason: string;
  /** Set when the entry is a cached utility fallback (no usable advice), not an advisor pick. */
  fallback?: true;
}

export interface DecisionAdvisor {
  readonly name: string;
  advise(requests: AdviceRequest[]): Promise<AdviceAnswer[]>;
}

export interface AdvisedPolicyOptions {
  /** Maximum score gap between the two best options for the advisor to be consulted. */
  margin?: number;
  /** 'character' (default) or 'antagonist' (dramaturge of the repeating day). */
  role?: AdvisorRole;
}

function choiceOf(c: Candidate): string {
  return `${c.action}@${c.locationId}`;
}

function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function describeAgent(agent: AgentState, profile: AgentProfile, ctx: DecisionContext): Omit<AdviceRequest, 'key' | 'candidates' | 'baseline' | 'role'> {
  const tr = profile.traits;
  const top = (Object.entries(tr) as [string, number][]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${Math.round(v * 100)}%`);
  const low = (Object.entries(tr) as [string, number][]).sort((a, b) => a[1] - b[1]).slice(0, 2).map(([k, v]) => `${k} ${Math.round(v * 100)}%`);
  const next = agent.commitments.filter((c) => c.status === 'pending' && c.start > ctx.t).sort((a, b) => a.start - b.start)[0];
  return {
    agentId: agent.id,
    name: profile.name,
    t: ctx.t,
    time: fmtTime(ctx.t),
    occupation: profile.occupation,
    traits: tx('story.advisor_traits', { strong: top.join(', '), weak: low.join(', ') }),
    needs: tx('story.advisor_needs', { hunger: Math.round(agent.needs.hunger), fatigue: Math.round(agent.needs.fatigue), social: Math.round(agent.needs.social), boredom: Math.round(agent.needs.boredom) }),
    mood: tx('story.advisor_mood', { mood: agent.emotions.mood.toFixed(2), stress: agent.emotions.stress.toFixed(2) }),
    goals: profile.goals,
    location: agent.locationId ? ctx.city.location(agent.locationId).name : tx('story.in_the_street'),
    recentMemories: agent.memories.slice(-4).map((m) => `${fmtTime(m.t)} ${m.text}`),
    influences: agent.influences.map((i) => i.reason),
    nextCommitment: next ? tx('story.advisor_next_commitment', { label: next.label, time: fmtTime(next.start), place: ctx.city.location(next.locationId).name }) : undefined,
    stakes: describeStakes(agent, ctx),
    situation: situationQuery(agent, profile, { t: ctx.t, locationName: agent.locationId ? ctx.city.location(agent.locationId).name : tx('story.in_the_street'), present: presentNames(agent, ctx.world.agents, ctx.profiles), nextCommitment: next?.label, desire: arcOf(ctx.world, agent.id) ? arcSeed(arcOf(ctx.world, agent.id)!.seedId).desire : undefined }),
    memoryPool: agent.memories.slice(-40),
  };
}

function describeStakes(agent: AgentState, ctx: DecisionContext): string | undefined {
  const arc = arcOf(ctx.world, agent.id);
  if (!arc) return undefined;
  const seed = arcSeed(arc.seedId);
  const state = arc.status === 'open' || arc.status === 'advancing' ? tx('story.advisor_state_open', { percent: Math.round(arc.progress * 100), time: fmtTime(arcDeadline(arc)) }) : ARC_STATUS_LABELS[arc.status];
  const p = { title: seed.title, desire: seed.desire, tension: seed.tension, state, secret: seed.secret, n: arc.knownBy.length };
  if (!seed.secret) return tx('story.advisor_stakes', p);
  return tx(arc.knownBy.length ? 'story.advisor_stakes_secret_known' : 'story.advisor_stakes_secret', p);
}

export type AdvisorRole = 'character' | 'antagonist';

/** Decision policy that defers open choices to an advisor through a replayable cache. */
export class AdvisedPolicy implements DecisionPolicy {
  /** Role requested from the advisor (the dramaturge « antagonist » keeps arcs unresolved while staying plausible). */
  role: AdvisorRole;
  readonly name = 'advised-v1';
  readonly cache: Map<string, AdviceAnswer>;
  readonly pending = new Map<string, AdviceRequest>();
  /** Keys answered but whose choice was invalid (kept to avoid asking again). */
  readonly declined = new Set<string>();
  private base = new UtilityPolicy();
  private margin: number;
  /** Number of decisions actually taken from the advisor during the last run. */
  applied = 0;

  constructor(cache: Map<string, AdviceAnswer> = new Map(), opts: AdvisedPolicyOptions = {}) {
    this.cache = cache;
    this.margin = opts.margin ?? 0.25;
    this.role = opts.role ?? 'character';
  }

  decide(agent: AgentState, profile: AgentProfile, ctx: DecisionContext): DecisionOutcome {
    const base = this.base.decide(agent, profile, ctx);
    if (ctx.current) return base; // periodic re-evaluations are not open choices
    const valid = base.candidates.filter((c) => !c.rejected);
    if (valid.length < 2) return base;
    if (base.chosen.components.some((c) => c.tag === 'forced' || c.tag === 'invitation')) return base;
    if (base.chosen.commitmentId && base.chosen.score >= 0.8) return base; // a due commitment is not open to debate
    const sorted = [...valid].sort((a, b) => b.score - a.score);
    if (sorted[0].score - sorted[1].score > this.margin) return base;
    const options = sorted.slice(0, 6);
    // Keys are bucketed by 10 minutes so advice survives small timing shifts between passes.
    const key = `${agent.id}:${Math.floor(ctx.t / 10)}:${hashString(options.map(choiceOf).join('|'))}`;
    const hit = this.cache.get(key);
    if (hit) {
      if (hit.fallback) return base;
      const chosen = options.find((c) => choiceOf(c) === hit.choice);
      if (chosen) {
        this.applied += 1;
        const withTag: Candidate = { ...chosen, components: [...chosen.components, { label: tx('engine.comp_advisor', { reason: hit.reason }), value: 0, tag: 'advisor' }] };
        const candidates = base.candidates.map((c) => (c === chosen ? withTag : c));
        return { chosen: withTag, candidates, reasons: [tx('engine.reason_advisor', { reason: hit.reason }), ...base.reasons] };
      }
      this.declined.add(key);
      return base;
    }
    if (!this.declined.has(key) && !this.pending.has(key)) {
      this.pending.set(key, {
        key,
        ...describeAgent(agent, profile, ctx),
        role: this.role,
        candidates: options.map((c) => ({ choice: choiceOf(c), label: c.label, score: Number(c.score.toFixed(2)), components: c.components.filter((x) => Math.abs(x.value) >= 0.05).map((x) => ({ label: x.label, value: Number(x.value.toFixed(2)) })) })),
        baseline: choiceOf(base.chosen),
      });
    }
    return base;
  }
}

export interface AdvisedRunResult {
  reality: Reality;
  policy: AdvisedPolicy;
  passes: number;
  answered: number;
  applied: number;
  unresolved: number;
  log: string[];
}

/**
 * Simulate a day with an advisor: iterate "simulate → ask → cache" until no
 * open decision is left unanswered (or the pass budget is spent).
 */
export async function generateWithAdvisor(def: Omit<RealityDef, 'policy'>, advisor: DecisionAdvisor, opts: { maxPasses?: number; maxRequestsPerPass?: number; policy?: AdvisedPolicy; onPass?: (info: { pass: number; pending: number; answered: number }) => void; embedder?: Embedder; recallK?: number } = {}): Promise<AdvisedRunResult> {
  const policy = opts.policy ?? new AdvisedPolicy();
  const maxPasses = opts.maxPasses ?? 6;
  const maxReq = opts.maxRequestsPerPass ?? 120;
  const log: string[] = [];
  let answered = 0;
  let reality = new Reality({ ...def, policy });
  let pass = 0;
  for (pass = 1; pass <= maxPasses; pass++) {
    policy.pending.clear();
    policy.applied = 0;
    reality = new Reality({ ...def, policy }).generate();
    const requests = [...policy.pending.values()].slice(0, maxReq);
    log.push(tx('engine.advisor_log_pass', { pass, pending: policy.pending.size, applied: policy.applied }));
    opts.onPass?.({ pass, pending: policy.pending.size, answered });
    if (!requests.length) break;
    await attachRelevantMemories(requests, opts.embedder, opts.recallK ?? 5);
    const answers = await advisor.advise(requests);
    const byKey = new Map(requests.map((r) => [r.key, r]));
    for (const a of answers) {
      const req = byKey.get(a.key);
      if (!req) continue;
      if (req.candidates.some((c) => c.choice === a.choice)) {
        policy.cache.set(a.key, a);
        answered += 1;
      } else {
        policy.cache.set(a.key, { key: a.key, choice: req.baseline, reason: tx('engine.advisor_invalid_answer'), fallback: true });
      }
    }
    // Requests the advisor left unanswered keep the utility choice (cached so the day stabilises).
    for (const r of requests) if (!policy.cache.has(r.key)) policy.cache.set(r.key, { key: r.key, choice: r.baseline, reason: tx('engine.advisor_no_answer'), fallback: true });
  }
  // Final deterministic run with the complete cache (no more questions asked).
  policy.pending.clear();
  policy.applied = 0;
  reality = new Reality({ ...def, policy }).generate();
  const unresolved = policy.pending.size;
  log.push(tx('engine.advisor_log_final', { applied: policy.applied, unresolved }));
  return { reality, policy, passes: Math.min(pass, maxPasses), answered, applied: policy.applied, unresolved, log };
}

/**
 * Replace « recent memories » by the memories most relevant to each situation
 * (similarity + recency + importance). Without an embedder, the recent ones stay.
 * The memory pool is dropped either way so that advisors receive a compact request.
 */
export async function attachRelevantMemories(requests: AdviceRequest[], embedder: Embedder | undefined, k = 5): Promise<void> {
  if (embedder) {
    const texts = new Set<string>();
    for (const r of requests) {
      texts.add(r.situation);
      for (const m of r.memoryPool ?? []) texts.add(m.text);
    }
    // Warm the embedder in one batch (it may be remote).
    await embedder.embed([...texts]);
    for (const r of requests) {
      const pool = r.memoryPool ?? [];
      if (!pool.length) continue;
      const ranked = await recallMemories(pool, r.situation, embedder, r.t, k);
      r.relevantMemories = ranked.map((x) => `${fmtTime(x.memory.t)} ${x.memory.text}`);
    }
  }
  for (const r of requests) delete r.memoryPool;
}

/**
 * Deterministic mock advisor used for tests and offline demos: it leans on the
 * inhabitant's personality instead of the utility scores (sociable people seek
 * company, curious ones seek novelty, tired ones rest).
 */
export class MockAdvisor implements DecisionAdvisor {
  readonly name = 'mock';
  async advise(requests: AdviceRequest[]): Promise<AdviceAnswer[]> {
    return requests.map((r) => {
      const p = profileOf(r.agentId);
      if (r.role === 'antagonist') {
        // The dramaturge: among plausible options (close to the best score), take the one that serves the desire least.
        const best = Math.max(...r.candidates.map((c) => c.score));
        const plausible = r.candidates.filter((c) => best - c.score <= 0.4);
        const desire = desireLabel();
        const desireOf = (c: AdviceCandidate) => c.components.filter((x) => x.label.startsWith(desire)).reduce((s, x) => s + x.value, 0);
        const pick = [...plausible].sort((a, b) => desireOf(a) - desireOf(b) || b.score - a.score)[0] ?? r.candidates[0];
        return { key: r.key, choice: pick.choice, reason: desireOf(pick) < desireOf(r.candidates.find((c) => c.choice === r.baseline) ?? pick) ? tx('story.advisor_reason_dramaturge_diverts') : tx('story.advisor_reason_nothing_plausible') };
      }
      const prefer = (pred: (c: AdviceCandidate) => boolean) => r.candidates.find(pred);
      let pick: AdviceCandidate | undefined;
      let reason = '';
      const fatigue = Number(/fatigue (\d+)/.exec(r.needs)?.[1] ?? 0);
      if (fatigue > 70 && (pick = prefer((c) => c.choice.startsWith('rest_home') || c.choice.startsWith('sleep')))) reason = tx('story.advisor_reason_too_tired');
      else if (p.traits.sociability > 0.7 && (pick = prefer((c) => /coffee|visit|eat_cafe|eat_restaurant/.test(c.choice)))) reason = tx('story.advisor_reason_needs_company');
      else if (p.traits.curiosity > 0.75 && (pick = prefer((c) => /read_library|relax_park/.test(c.choice)))) reason = tx('story.advisor_reason_curious');
      else if (p.traits.frugality > 0.75 && (pick = prefer((c) => /eat_home|rest_home/.test(c.choice)))) reason = tx('story.advisor_reason_frugal');
      if (!pick) {
        pick = r.candidates.find((c) => c.choice === r.baseline) ?? r.candidates[0];
        reason = tx('story.advisor_reason_utility_fine');
      }
      return { key: r.key, choice: pick.choice, reason };
    });
  }
}
