/**
 * Jev advisor — TypeSafe's "System One" structured decision model.
 *
 * Jev does not write text: it evaluates a `state` and answers typed questions.
 * For BUTTERFLY each open decision becomes one `choice` question whose options
 * are the engine-validated candidates; Jev returns the chosen option, a
 * probability per option and a confidence. Input tokens are billed, output is
 * free, and answers are fast, which makes it a good fit for hundreds of small
 * decisions per simulated day. Docs: https://docs.typesafe.ai
 */
import type { AdviceAnswer, AdviceRequest, DecisionAdvisor } from '../src/sim/advisor';

export interface JevOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /** Parallel requests in flight. */
  concurrency?: number;
  /** Below this confidence the utility choice is kept (0 disables). */
  minConfidence?: number;
  fetchImpl?: typeof fetch;
}

interface JevChoiceAnswer {
  type: 'choice';
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

interface JevResponse {
  model: string;
  answers: Record<string, JevChoiceAnswer>;
  usage?: { input_tokens: number; output_tokens: number };
}

/** Build the System One request for one open decision. */
export function buildJevRequest(r: AdviceRequest, model: string) {
  const criteria: Record<string, string> = {};
  for (const c of r.candidates) {
    const comps = c.components.map((x) => `${x.label} ${x.value > 0 ? '+' : ''}${x.value}`).join(', ');
    criteria[c.choice] = `${c.label} (score utilitaire ${c.score}${comps ? ' : ' + comps : ''})`;
  }
  return {
    model,
    state: {
      habitant: { nom: r.name, metier: r.occupation, traits: r.traits, objectifs: r.goals },
      moment: { heure: r.time, lieu: r.location, prochain_engagement: r.nextCommitment ?? 'aucun' },
      etat: { besoins: r.needs, humeur: r.mood },
      souvenirs_recents: r.recentMemories,
      vient_de_vivre: r.influences,
      choix_utilitaire: r.baseline,
      consigne: 'Choisir ce que cette personne ferait maintenant, en cohérence avec sa personnalité, ses besoins, ses objectifs, ses souvenirs et le moment de la journée. Les scores sont indicatifs.',
    },
    questions: {
      decision: {
        type: 'choice',
        instructions: `Que fait ${r.name} maintenant (${r.time}) ?`,
        criteria,
      },
    },
  };
}

export class JevAdvisor implements DecisionAdvisor {
  readonly name = 'jev';
  readonly model: string;
  private baseUrl: string;
  private concurrency: number;
  private minConfidence: number;
  private fetchImpl: typeof fetch;
  /** Cumulative input tokens for cost reporting. */
  inputTokens = 0;

  constructor(private opts: JevOptions) {
    this.model = opts.model ?? 'jev-latest';
    this.baseUrl = (opts.baseUrl ?? 'https://api.typesafe.ai').replace(/\/$/, '');
    this.concurrency = opts.concurrency ?? 6;
    this.minConfidence = opts.minConfidence ?? 0.15;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async advise(requests: AdviceRequest[]): Promise<AdviceAnswer[]> {
    const out: AdviceAnswer[] = [];
    let next = 0;
    const worker = async () => {
      while (next < requests.length) {
        const r = requests[next++];
        try {
          const a = await this.ask(r);
          if (a) out.push(a);
        } catch {
          /* this decision keeps its utility choice */
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, requests.length) }, worker));
    return out;
  }

  private async ask(r: AdviceRequest, attempt = 0): Promise<AdviceAnswer | null> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/systemone`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.opts.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(buildJevRequest(r, this.model)),
    });
    if (res.status === 429 && attempt < 4) {
      const wait = Number(res.headers.get('retry-after') ?? 0) * 1000 || 500 * 2 ** attempt;
      await new Promise((ok) => setTimeout(ok, wait));
      return this.ask(r, attempt + 1);
    }
    if (!res.ok) throw new Error(`Jev ${res.status}`);
    const data = (await res.json()) as JevResponse;
    this.inputTokens += data.usage?.input_tokens ?? 0;
    const ans = data.answers?.decision;
    if (!ans || ans.type !== 'choice') return null;
    if (!r.candidates.some((c) => c.choice === ans.choice)) return null;
    if (ans.confidence < this.minConfidence) return null;
    const p = Math.round((ans.probabilities?.[ans.choice] ?? 0) * 100);
    return { key: r.key, choice: ans.choice, reason: `Jev ${data.model} : ${p} % pour ce choix, confiance ${ans.confidence.toFixed(2)}` };
  }
}
