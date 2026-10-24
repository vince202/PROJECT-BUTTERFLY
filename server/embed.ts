/**
 * Local embeddings through Ollama (e.g. `embeddinggemma` or `nomic-embed-text`).
 * Runs on the user's machine: no paid API, no data leaving the computer. The
 * browser reaches it through POST /api/ai/embed; when Ollama is not running,
 * the client falls back to the deterministic lexical embedder.
 */

import type { Embedder } from '../src/sim/recall';

export class OllamaEmbedder implements Embedder {
  readonly name = 'ollama';
  readonly model: string;
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  constructor(opts: { model?: string; baseUrl?: string; fetchImpl?: typeof fetch } = {}) {
    this.model = opts.model ?? 'embeddinggemma';
    this.baseUrl = (opts.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const out: number[][] = [];
    // Ollama accepts batches; keep them modest.
    for (let i = 0; i < texts.length; i += 64) {
      const batch = texts.slice(i, i + 64);
      const res = await this.fetchImpl(`${this.baseUrl}/api/embed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: this.model, input: batch }) });
      if (!res.ok) throw new Error(`Ollama ${res.status} ${res.statusText}`);
      const data = (await res.json()) as { embeddings?: number[][] };
      if (!data.embeddings || data.embeddings.length !== batch.length) throw new Error('Réponse Ollama invalide (embeddings manquants).');
      out.push(...data.embeddings);
    }
    return out;
  }

  /** True when the Ollama server answers and the model is available. */
  async probe(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
      if (!res.ok) return false;
      const data = (await res.json()) as { models?: { name: string }[] };
      return !!data.models?.some((m) => m.name === this.model || m.name.startsWith(`${this.model}:`));
    } catch {
      return false;
    }
  }
}
