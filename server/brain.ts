/**
 * The persistent « brain » of BUTTERFLY: a local store of knowledge grains
 * (cause → effect records extracted from simulated days), vectorised so that
 * similar situations can be found across seeds and days. It grows with every
 * day played and every reality compared, and it only ever *informs*: the
 * deterministic engine never reads it.
 *
 * Storage is a single JSON file (data/brain.json by default), fully local.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { KnowledgeGrain } from '../src/sim/knowledge';
import { LexicalEmbedder, cosine, type Embedder } from '../src/sim/recall';

export interface StoredGrain extends KnowledgeGrain {
  id: string;
  /** How many times this exact situation → effect was observed. */
  count: number;
  /** Seeds (and days) where it was observed. */
  seen: { seed: number; day: number }[];
  firstSeen: string;
  lastSeen: string;
  /** Embedding vector (model-dependent). */
  vector?: number[];
  /** Name of the embedder that produced the vector. */
  embeddedBy?: string;
}

export interface BrainQuery {
  text: string;
  k?: number;
  kinds?: KnowledgeGrain['kind'][];
  agents?: string[];
  tags?: string[];
}

export interface BrainHit {
  grain: StoredGrain;
  similarity: number;
  score: number;
}

export interface BrainStats {
  grains: number;
  observations: number;
  byKind: Record<string, number>;
  seeds: number;
  embedder: string;
  file: string;
  updatedAt?: string;
}

interface BrainFile {
  version: 1;
  grains: StoredGrain[];
}

export class Brain {
  readonly file: string;
  private grains = new Map<string, StoredGrain>();
  private seq = 0;
  private embedder: Embedder;
  private updatedAt?: string;

  constructor(opts: { file?: string; embedder?: Embedder } = {}) {
    this.file = opts.file ?? 'data/brain.json';
    this.embedder = opts.embedder ?? new LexicalEmbedder();
    this.load();
  }

  /** Swap the embedder (e.g. once Ollama is detected); vectors are recomputed lazily. */
  setEmbedder(e: Embedder) {
    this.embedder = e;
  }

  get embedderName(): string {
    return this.embedder.name;
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as BrainFile;
      for (const g of data.grains ?? []) {
        this.grains.set(g.signature, g);
        const n = Number(g.id.replace(/^g/, ''));
        if (Number.isFinite(n)) this.seq = Math.max(this.seq, n);
      }
    } catch (err) {
      console.warn(`[brain] fichier illisible (${this.file}) : ${(err as Error).message} — on repart de zéro.`);
    }
  }

  save() {
    mkdirSync(dirname(this.file), { recursive: true });
    const payload: BrainFile = { version: 1, grains: [...this.grains.values()] };
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload));
    renameSync(tmp, this.file);
    this.updatedAt = new Date().toISOString();
  }

  /** Add grains: known signatures gain an observation, new ones are embedded and stored. */
  async ingest(grains: KnowledgeGrain[]): Promise<{ added: number; reinforced: number }> {
    const now = new Date().toISOString();
    let added = 0;
    let reinforced = 0;
    const fresh: StoredGrain[] = [];
    for (const g of grains) {
      const hit = this.grains.get(g.signature);
      if (hit) {
        hit.count += 1;
        reinforced += 1;
        hit.lastSeen = now;
        if (!hit.seen.some((s) => s.seed === g.seed && s.day === g.day)) hit.seen.push({ seed: g.seed, day: g.day });
        hit.weight = Math.max(hit.weight, g.weight);
        continue;
      }
      const stored: StoredGrain = { ...g, id: `g${++this.seq}`, count: 1, seen: [{ seed: g.seed, day: g.day }], firstSeen: now, lastSeen: now };
      this.grains.set(g.signature, stored);
      fresh.push(stored);
      added += 1;
    }
    await this.embedMissing(fresh);
    this.save();
    return { added, reinforced };
  }

  private async embedMissing(list: StoredGrain[]) {
    const todo = list.filter((g) => !g.vector || g.embeddedBy !== this.embedder.name);
    if (!todo.length) return;
    for (let i = 0; i < todo.length; i += 128) {
      const batch = todo.slice(i, i + 128);
      const vecs = await this.embedder.embed(batch.map((g) => g.text));
      batch.forEach((g, j) => {
        if (vecs[j]?.length) {
          g.vector = vecs[j];
          g.embeddedBy = this.embedder.name;
        }
      });
    }
  }

  /** Find the grains closest to a situation; frequency and weight break ties and lift recurring patterns. */
  async query(q: BrainQuery): Promise<BrainHit[]> {
    const all = [...this.grains.values()].filter((g) => (!q.kinds?.length || q.kinds.includes(g.kind)) && (!q.agents?.length || q.agents.some((a) => g.agents.includes(a))) && (!q.tags?.length || q.tags.every((t) => g.tags.includes(t))));
    if (!all.length) return [];
    await this.embedMissing(all);
    const [qv] = await this.embedder.embed([q.text]);
    const hits: BrainHit[] = all.map((g) => {
      const similarity = Math.max(0, cosine(qv, g.vector ?? []));
      const frequency = Math.min(1, Math.log2(1 + g.count) / 4);
      return { grain: g, similarity, score: 0.7 * similarity + 0.15 * frequency + 0.15 * g.weight };
    });
    return hits.sort((a, b) => b.score - a.score || b.grain.count - a.grain.count).slice(0, q.k ?? 8);
  }

  /** Most observed patterns (optionally of one kind). */
  patterns(kind?: KnowledgeGrain['kind'], k = 20): StoredGrain[] {
    return [...this.grains.values()].filter((g) => !kind || g.kind === kind).sort((a, b) => b.count - a.count || b.weight - a.weight).slice(0, k);
  }

  stats(): BrainStats {
    const byKind: Record<string, number> = {};
    let observations = 0;
    const seeds = new Set<number>();
    for (const g of this.grains.values()) {
      byKind[g.kind] = (byKind[g.kind] ?? 0) + 1;
      observations += g.count;
      for (const s of g.seen) seeds.add(s.seed);
    }
    return { grains: this.grains.size, observations, byKind, seeds: seeds.size, embedder: this.embedder.name, file: this.file, updatedAt: this.updatedAt };
  }

  /** Forget everything (tests, « nouvelle ville »). */
  clear() {
    this.grains.clear();
    this.seq = 0;
    this.save();
  }
}
