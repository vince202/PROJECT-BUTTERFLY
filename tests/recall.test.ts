import { describe, expect, it } from 'vitest';
import { LexicalEmbedder, CachedEmbedder, cosine, rankMemories, recallMemories, recallMemoriesSync, situationQuery, tokenize, type Embedder } from '../src/sim/recall';
import { attachRelevantMemories, type AdviceRequest } from '../src/sim/advisor';
import { profileOf } from '../src/sim/population';
import type { Memory } from '../src/sim/types';
import { runDay } from './helpers';

const mem = (t: number, text: string, importance = 0.5): Memory => ({ t, text, eventId: 'e1', importance, valence: 0, about: [] });

describe('Embedder lexical (hors ligne)', () => {
  it('tokenise en retirant accents et mots vides', () => {
    expect(tokenize('Discussion avec Mireille à la boulangerie')).toEqual(['discus', 'mireil', 'boulan']);
  });

  it('est déterministe et normalisé', () => {
    const e = new LexicalEmbedder();
    const [a] = e.embedSync(['Dispute avec Julien au café']);
    const [b] = new LexicalEmbedder().embedSync(['Dispute avec Julien au café']);
    expect(a).toEqual(b);
    expect(Math.abs(cosine(a, a) - 1)).toBeLessThan(1e-9);
  });

  it('rapproche les textes qui partagent des noms et des lieux', () => {
    const e = new LexicalEmbedder();
    const [q, same, other] = e.embedSync(['Alice au café avec Sophie', 'Déjeuner avec Sophie au restaurant', 'Le bus L1-1 est en retard à la gare']);
    expect(cosine(q, same)).toBeGreaterThan(cosine(q, other));
  });
});

describe('Rappel de souvenirs', () => {
  const now = 15 * 60;
  const memories = [
    mem(7 * 60, 'Discussion avec Gérard dans le bus L1-1', 0.4),
    mem(9 * 60, 'Dispute avec Julien à Café Le Papillon', 0.8),
    mem(12 * 60, 'Déjeuner avec Alice à Chez Lucie', 0.5),
    mem(14 * 60 + 50, 'Acheté du pain à la boulangerie', 0.2),
  ];

  it('la similarité domine : rencontrer Julien rappelle la dispute', () => {
    const e = new LexicalEmbedder();
    const top = recallMemoriesSync(memories, 'Sophie à Café Le Papillon avec Julien', e, now, 2);
    expect(top[0].memory.text).toContain('Julien');
  });

  it('sans similarité, la récence et l’importance départagent', () => {
    const e = new LexicalEmbedder();
    const top = recallMemoriesSync(memories, 'quelque chose sans rapport xyz', e, now, 4);
    // Le souvenir le plus récent ou le plus important arrive avant la vieille discussion de 07:00.
    expect(top.at(-1)!.memory.text).toContain('Gérard');
  });

  it('rankMemories est stable (ordre déterministe à score égal)', () => {
    const e = new LexicalEmbedder();
    const [q, ...vecs] = e.embedSync(['rien', ...memories.map((m) => m.text)]);
    const a = rankMemories(memories, q, vecs, now).map((r) => r.memory.text);
    const b = rankMemories(memories, q, vecs, now).map((r) => r.memory.text);
    expect(a).toEqual(b);
  });

  it('CachedEmbedder n’interroge l’embedder interne qu’une fois par texte', async () => {
    let calls = 0;
    const inner: Embedder = { name: 'fake', embed: async (texts) => { calls += texts.length; return texts.map((t) => [t.length, 1]); } };
    const c = new CachedEmbedder(inner);
    await c.embed(['a', 'bb', 'a']);
    await c.embed(['bb', 'ccc']);
    expect(calls).toBe(3);
    expect(Object.keys(c.export()).sort()).toEqual(['a', 'bb', 'ccc']);
  });

  it('recallMemories (asynchrone) renvoie k résultats triés', async () => {
    const top = await recallMemories(memories, 'Alice au restaurant', new LexicalEmbedder(), now, 3);
    expect(top).toHaveLength(3);
    for (let i = 1; i < top.length; i++) expect(top[i - 1].score).toBeGreaterThanOrEqual(top[i].score);
    expect(top[0].memory.text).toContain('Alice');
  });
});

describe('Rappel branché sur le conseiller', () => {
  it('les demandes du conseiller portent une situation et le rappel remplace le vivier de souvenirs', async () => {
    const A = runDay(51);
    const alice = A.engine.state.agents.alice;
    const req: AdviceRequest = {
      key: 'k', agentId: 'alice', name: 'Alice', t: 20 * 60, time: '20:00', occupation: 'x', traits: '', needs: '', mood: '', goals: [], location: 'Café Le Papillon',
      recentMemories: [], influences: [], role: 'character', situation: situationQuery(alice, profileOf('alice'), { t: 20 * 60, locationName: 'Café Le Papillon', present: ['Sophie'] }),
      memoryPool: alice.memories, candidates: [], baseline: 'c0',
    };
    expect(req.situation).toContain('Sophie');
    await attachRelevantMemories([req], new LexicalEmbedder(), 4);
    expect(req.memoryPool).toBeUndefined();
    expect(req.relevantMemories!.length).toBeGreaterThan(0);
    expect(req.relevantMemories!.length).toBeLessThanOrEqual(4);
  });

  it('sans embedder, le vivier est retiré et les souvenirs récents restent', async () => {
    const req = { key: 'k', memoryPool: [mem(400, 'x')], recentMemories: ['a'], situation: 's', t: 500 } as unknown as AdviceRequest;
    await attachRelevantMemories([req], undefined);
    expect(req.memoryPool).toBeUndefined();
    expect(req.relevantMemories).toBeUndefined();
    expect(req.recentMemories).toEqual(['a']);
  });
});
