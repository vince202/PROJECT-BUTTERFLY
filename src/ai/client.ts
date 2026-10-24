/**
 * Browser client for the optional AI adapter (server/index.ts).
 * All calls degrade gracefully: when the server is absent or has no API key,
 * the application falls back to deterministic local behaviour.
 */

import type { AiStatus } from '../store/useSimStore';
import type { Intervention, SimEvent } from '../sim/types';
import type { AdviceAnswer, AdviceRequest, DecisionAdvisor } from '../sim/advisor';

const BASE = '/api/ai';

async function post<T>(path: string, body: unknown, timeoutMs = 20000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkAiStatus(): Promise<AiStatus> {
  try {
    const res = await fetch(`${BASE}/status`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { checked: true, enabled: false, message: 'Serveur IA indisponible — narration IA désactivée' };
    const data = (await res.json()) as { enabled: boolean; model?: string; message?: string; advisor?: string | null; advisorModel?: string };
    return { checked: true, enabled: data.enabled, model: data.model, message: data.message, advisor: data.advisor ?? undefined, advisorModel: data.advisorModel };
  } catch {
    return { checked: true, enabled: false, message: 'Serveur IA non démarré — narration IA désactivée' };
  }
}

export interface AiInterpretResponse {
  ok: boolean;
  intervention?: Intervention;
  explanation: string;
  issues: string[];
}

/** Ask the LLM to translate a French request into a structured intervention. */
export function aiInterpret(text: string, context: { t: number; selectedEvent?: SimEvent | null; recentEvents: SimEvent[] }): Promise<AiInterpretResponse> {
  return post<AiInterpretResponse>('/interpret', { text, context });
}

export interface AiNarrateResponse {
  ok: boolean;
  text: string;
}

/** Ask the LLM to rewrite factual summaries into prose (facts only, no invention). */
export function aiNarrate(facts: string, style: 'day' | 'agent' | 'causal' | 'compare'): Promise<AiNarrateResponse> {
  return post<AiNarrateResponse>('/narrate', { facts, style }, 60000);
}

/** Advisor that forwards open decisions to the server-side LLM adapter. */
export class HttpAdvisor implements DecisionAdvisor {
  readonly name = 'http';
  async advise(requests: AdviceRequest[]): Promise<AdviceAnswer[]> {
    const res = await post<{ ok: boolean; answers: AdviceAnswer[] }>('/decide', { requests }, 120000);
    return res.ok ? res.answers : [];
  }
}
