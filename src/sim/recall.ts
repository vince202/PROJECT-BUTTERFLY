/**
 * Similarity memory: recall the memories that matter for the situation at hand.
 *
 * Memories are ranked by a mix of semantic similarity to a « situation » query,
 * recency and importance — the classic generative-agents recipe. Similarity
 * comes from an `Embedder`: a local embedding model (Ollama, through the
 * server) when available, otherwise a deterministic lexical embedder that works
 * offline and in tests. Embeddings are cached by text so that a day replays
 * identically, and the recall only *informs* the advisors and the interface —
 * the deterministic engine never depends on it.
 */

import { t } from '../i18n';
import type { AgentId, AgentProfile, AgentState, Memory, Minute } from './types';
import { fmtTime } from './time';

export interface Embedder {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

/** Embedder with a synchronous path (no network), used by the interface. */
export interface SyncEmbedder extends Embedder {
  embedSync(texts: string[]): number[][];
}

export const LEXICAL_DIMS = 256;

const STOPWORDS = new Set(
  'le la les l de des du d un une et a à au aux en pour avec sans son sa ses ce cette ces qui que quoi dont où dans sur sous par est sont été etre être ne pas plus moins il elle ils elles je tu on nous vous mon ma mes ton ta tes leur leurs lui y se s me m te t ou mais donc or ni car si tout tous toute toutes très trop peu bien mal encore déjà deja hier aujourd hui demain min h'
    .split(/\s+/),
);

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, ' ');
}

export function tokenize(s: string): string[] {
  return normalizeText(s)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map((w) => (w.length > 6 ? w.slice(0, 6) : w));
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function l2(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  if (n === 0) return v;
  const inv = 1 / Math.sqrt(n);
  return v.map((x) => x * inv);
}

/**
 * Deterministic hashed bag-of-words (unigrams + bigrams, signed hashing).
 * Crude but dependency-free; good enough to pull « Mireille » memories when
 * Mireille walks in, or « portefeuille » memories at the supermarket.
 */
export class LexicalEmbedder implements SyncEmbedder {
  readonly name = 'lexical';
  private readonly cache = new Map<string, number[]>();

  embedOne(text: string): number[] {
    const hit = this.cache.get(text);
    if (hit) return hit;
    const v = new Array<number>(LEXICAL_DIMS).fill(0);
    const toks = tokenize(text);
    const add = (tok: string, w: number) => {
      const h = fnv1a(tok);
      const idx = h % LEXICAL_DIMS;
      const sign = (h >>> 8) & 1 ? 1 : -1;
      v[idx] += sign * w;
    };
    for (let i = 0; i < toks.length; i++) {
      add(toks[i], 1);
      if (i > 0) add(`${toks[i - 1]}_${toks[i]}`, 0.5);
    }
    const out = l2(v);
    this.cache.set(text, out);
    return out;
  }

  embedSync(texts: string[]): number[][] {
    return texts.map((t) => this.embedOne(t));
  }

  async embed(texts: string[]): Promise<number[][]> {
    return this.embedSync(texts);
  }
}

/** Caches another embedder's vectors by text (exportable for persistence). */
export class CachedEmbedder implements Embedder {
  readonly name: string;
  readonly cache = new Map<string, number[]>();
  constructor(private readonly inner: Embedder, initial?: Record<string, number[]>) {
    this.name = inner.name;
    if (initial) for (const [k, v] of Object.entries(initial)) this.cache.set(k, v);
  }
  async embed(texts: string[]): Promise<number[][]> {
    const missing = [...new Set(texts.filter((t) => !this.cache.has(t)))];
    if (missing.length) {
      const vecs = await this.inner.embed(missing);
      missing.forEach((t, i) => {
        if (vecs[i]) this.cache.set(t, vecs[i]);
      });
    }
    return texts.map((t) => this.cache.get(t) ?? []);
  }
  export(): Record<string, number[]> {
    return Object.fromEntries(this.cache);
  }
}

export function cosine(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

export interface RecallWeights {
  similarity: number;
  recency: number;
  importance: number;
}

export const DEFAULT_WEIGHTS: RecallWeights = { similarity: 0.55, recency: 0.2, importance: 0.25 };

export interface RecalledMemory {
  memory: Memory;
  score: number;
  similarity: number;
  recency: number;
}

/** Recency decays over about half a day (and yesterday's memories start lower). */
export function recencyScore(memory: Memory, now: Minute): number {
  const age = Math.max(0, now - memory.t);
  const yesterday = memory.yesterday === true;
  return Math.exp(-age / 360) * (yesterday ? 0.6 : 1);
}

export function rankMemories(memories: Memory[], queryVec: number[], memoryVecs: number[][], now: Minute, weights: RecallWeights = DEFAULT_WEIGHTS): RecalledMemory[] {
  const out: RecalledMemory[] = memories.map((m, i) => {
    const similarity = Math.max(0, cosine(queryVec, memoryVecs[i] ?? []));
    const recency = recencyScore(m, now);
    const score = weights.similarity * similarity + weights.recency * recency + weights.importance * m.importance;
    return { memory: m, score, similarity, recency };
  });
  // Stable sort: score desc, then most recent first, then insertion order.
  return out
    .map((r, i) => ({ r, i }))
    .sort((x, y) => y.r.score - x.r.score || y.r.memory.t - x.r.memory.t || x.i - y.i)
    .map((x) => x.r);
}

/** Recall the k most relevant memories for a query. */
export async function recallMemories(memories: Memory[], query: string, embedder: Embedder, now: Minute, k = 5, weights?: RecallWeights): Promise<RecalledMemory[]> {
  if (!memories.length) return [];
  const [q, ...vecs] = await embedder.embed([query, ...memories.map((m) => m.text)]);
  return rankMemories(memories, q, vecs, now, weights).slice(0, k);
}

/** Synchronous variant for the interface (lexical embedder). */
export function recallMemoriesSync(memories: Memory[], query: string, embedder: SyncEmbedder, now: Minute, k = 5, weights?: RecallWeights): RecalledMemory[] {
  if (!memories.length) return [];
  const [q, ...vecs] = embedder.embedSync([query, ...memories.map((m) => m.text)]);
  return rankMemories(memories, q, vecs, now, weights).slice(0, k);
}

/**
 * Describe the situation an inhabitant is in, as a query: where, with whom,
 * what is pending, what the day is about. Names matter most for recall.
 */
export function situationQuery(agent: AgentState, profile: AgentProfile, opts: { t: Minute; locationName: string; present: string[]; nextCommitment?: string; desire?: string; options?: string[] }): string {
  const parts = [t('story.recall_at', { name: profile.firstName, place: opts.locationName, time: fmtTime(opts.t) })];
  if (opts.present.length) parts.push(t('story.recall_with', { names: opts.present.join(', ') }));
  if (opts.nextCommitment) parts.push(t('story.recall_next_commitment', { label: opts.nextCommitment }));
  if (opts.desire) parts.push(opts.desire);
  if (opts.options?.length) parts.push(t('story.recall_options', { list: opts.options.join(', ') }));
  if (agent.needs.hunger > 60) parts.push(t('story.recall_hunger'));
  if (agent.needs.fatigue > 70) parts.push(t('story.recall_fatigue'));
  if (agent.needs.social > 60) parts.push(t('story.recall_lonely'));
  return parts.join(t('story.sep_semicolon'));
}

/** Names of the other inhabitants present at the agent's location. */
export function presentNames(agent: AgentState, agents: Record<AgentId, AgentState>, profiles: Map<AgentId, AgentProfile>): string[] {
  if (!agent.locationId) return [];
  return Object.values(agents)
    .filter((o) => o.id !== agent.id && o.locationId === agent.locationId && !o.asleep)
    .map((o) => profiles.get(o.id)?.firstName ?? o.id)
    .sort();
}
