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
import { profileOf } from './population';
import { Reality, type RealityDef } from './reality';
import { fmtTime } from './time';
import type { AgentId, AgentProfile, AgentState, Candidate, Minute } from './types';

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

function describeAgent(agent: AgentState, profile: AgentProfile, ctx: DecisionContext): Omit<AdviceRequest, 'key' | 'candidates' | 'baseline'> {
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
    traits: `forts : ${top.join(', ')} ; faibles : ${low.join(', ')}`,
    needs: `faim ${Math.round(agent.needs.hunger)}, fatigue ${Math.round(agent.needs.fatigue)}, solitude ${Math.round(agent.needs.social)}, ennui ${Math.round(agent.needs.boredom)} (0 = comblé, 100 = urgent)`,
    mood: `humeur ${agent.emotions.mood.toFixed(2)} (−1..1), stress ${agent.emotions.stress.toFixed(2)}`,
    goals: profile.goals,
    location: agent.locationId ? ctx.city.location(agent.locationId).name : 'dans la rue',
    recentMemories: agent.memories.slice(-4).map((m) => `${fmtTime(m.t)} ${m.text}`),
    influences: agent.influences.map((i) => i.reason),
    nextCommitment: next ? `${next.label} à ${fmtTime(next.start)} (${ctx.city.location(next.locationId).name})` : undefined,
  };
}

/** Decision policy that defers open choices to an advisor through a replayable cache. */
export class AdvisedPolicy implements DecisionPolicy {
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
  }

  decide(agent: AgentState, profile: AgentProfile, ctx: DecisionContext): DecisionOutcome {
    const base = this.base.decide(agent, profile, ctx);
    if (ctx.current) return base; // periodic re-evaluations are not open choices
    const valid = base.candidates.filter((c) => !c.rejected);
    if (valid.length < 2) return base;
    if (base.chosen.components.some((c) => c.label.startsWith('Intervention') || c.label.startsWith('Invitation'))) return base;
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
        const withTag: Candidate = { ...chosen, components: [...chosen.components, { label: `Conseiller IA : ${hit.reason}`, value: 0 }] };
        const candidates = base.candidates.map((c) => (c === chosen ? withTag : c));
        return { chosen: withTag, candidates, reasons: [`Arbitrage du conseiller : ${hit.reason}`, ...base.reasons] };
      }
      this.declined.add(key);
      return base;
    }
    if (!this.declined.has(key) && !this.pending.has(key)) {
      this.pending.set(key, {
        key,
        ...describeAgent(agent, profile, ctx),
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
export async function generateWithAdvisor(def: Omit<RealityDef, 'policy'>, advisor: DecisionAdvisor, opts: { maxPasses?: number; maxRequestsPerPass?: number; policy?: AdvisedPolicy; onPass?: (info: { pass: number; pending: number; answered: number }) => void } = {}): Promise<AdvisedRunResult> {
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
    log.push(`passe ${pass} : ${policy.pending.size} décisions ouvertes sans réponse, ${policy.applied} conseils appliqués`);
    opts.onPass?.({ pass, pending: policy.pending.size, answered });
    if (!requests.length) break;
    const answers = await advisor.advise(requests);
    const byKey = new Map(requests.map((r) => [r.key, r]));
    for (const a of answers) {
      const req = byKey.get(a.key);
      if (!req) continue;
      if (req.candidates.some((c) => c.choice === a.choice)) {
        policy.cache.set(a.key, a);
        answered += 1;
      } else {
        policy.cache.set(a.key, { key: a.key, choice: req.baseline, reason: 'réponse invalide, choix utilitaire conservé', fallback: true });
      }
    }
    // Requests the advisor left unanswered keep the utility choice (cached so the day stabilises).
    for (const r of requests) if (!policy.cache.has(r.key)) policy.cache.set(r.key, { key: r.key, choice: r.baseline, reason: 'sans avis, choix utilitaire', fallback: true });
  }
  // Final deterministic run with the complete cache (no more questions asked).
  policy.pending.clear();
  policy.applied = 0;
  reality = new Reality({ ...def, policy }).generate();
  const unresolved = policy.pending.size;
  log.push(`relecture finale : ${policy.applied} conseils appliqués, ${unresolved} décisions ouvertes restantes (choix utilitaire)`);
  return { reality, policy, passes: Math.min(pass, maxPasses), answered, applied: policy.applied, unresolved, log };
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
      const prefer = (pred: (c: AdviceCandidate) => boolean) => r.candidates.find(pred);
      let pick: AdviceCandidate | undefined;
      let reason = '';
      const fatigue = Number(/fatigue (\d+)/.exec(r.needs)?.[1] ?? 0);
      if (fatigue > 70 && (pick = prefer((c) => c.choice.startsWith('rest_home') || c.choice.startsWith('sleep')))) reason = 'trop fatigué pour autre chose';
      else if (p.traits.sociability > 0.7 && (pick = prefer((c) => /coffee|visit|eat_cafe|eat_restaurant/.test(c.choice)))) reason = 'a besoin de compagnie';
      else if (p.traits.curiosity > 0.75 && (pick = prefer((c) => /read_library|relax_park/.test(c.choice)))) reason = 'curiosité : envie de nouveauté';
      else if (p.traits.frugality > 0.75 && (pick = prefer((c) => /eat_home|rest_home/.test(c.choice)))) reason = 'économe : préfère rester simple';
      if (!pick) {
        pick = r.candidates.find((c) => c.choice === r.baseline) ?? r.candidates[0];
        reason = 'le choix utilitaire paraît raisonnable';
      }
      return { key: r.key, choice: pick.choice, reason };
    });
  }
}
