import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Brain } from '../server/brain';
import { compareRealities } from '../src/sim/compare';
import { busDelayFor } from '../src/sim/interventions';
import { arcGrains, chainGrains, encounterGrains, extractGrains, interventionGrains, secretGrains } from '../src/sim/knowledge';
import { Reality } from '../src/sim/reality';
import { AGENT_IDS } from '../src/sim/population';
import { BUS_SEED, findBoardingArrival, runDay } from './helpers';
import type { SimEvent } from '../src/sim/types';

const A = runDay(BUS_SEED);
const arrival = findBoardingArrival(A.events) as SimEvent;
const B = new Reality({ id: 'B', name: 'B', seed: BUS_SEED, interventions: [busDelayFor(arrival, 3)] }).generate();
const cmp = compareRealities(A, B);

describe('Grains de connaissance', () => {
  it('chaque arc résolu donne un grain avec situation, cause et effets', () => {
    const g = arcGrains(A);
    expect(g.length).toBe(Object.values(A.engine.state.arcs).filter((a) => a.status !== 'open' && a.status !== 'advancing').length);
    for (const x of g) {
      expect(x.kind).toBe('arc');
      expect(x.signature).toMatch(/^arc\|/);
      expect(x.situation.length).toBeGreaterThan(10);
      expect(x.text).toContain('→');
      expect(x.agents.every((a) => AGENT_IDS.includes(a))).toBe(true);
      expect(x.seed).toBe(BUS_SEED);
    }
  });

  it('les grains de secrets suivent les confidences et rumeurs enregistrées', () => {
    for (const g of secretGrains(A)) {
      expect(g.kind).toBe('secret');
      expect(g.agents.length).toBeGreaterThanOrEqual(2);
      expect(g.effects.length).toBeGreaterThan(0);
    }
  });

  it('les chaînes et rencontres sont tirées du graphe causal', () => {
    const chains = chainGrains(A);
    expect(chains.length).toBeGreaterThan(0);
    for (const g of chains) expect(g.effects[0]).toMatch(/maillons/);
    for (const g of encounterGrains(A)) expect(g.cause.length).toBeGreaterThan(0);
  });

  it('le grain d’intervention cite les conséquences vérifiées et les destins modifiés', () => {
    const [g] = interventionGrains(A, B, cmp);
    expect(g.kind).toBe('intervention');
    expect(g.tags).toContain('bus_delay');
    expect(g.effects.some((e) => /destin modifié/.test(e))).toBe(cmp.arcChanges.length > 0);
    expect(g.effects.length).toBeGreaterThan(0);
  });

  it('extractGrains est déterministe et sans doublon de signature', () => {
    const a = extractGrains(A, B, cmp);
    const b = extractGrains(runDay(BUS_SEED), B, cmp);
    expect(a.map((g) => g.text)).toEqual(b.map((g) => g.text));
    expect(new Set(a.map((g) => g.signature)).size).toBe(a.length);
  });
});

describe('Cerveau persistant (store local)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'butterfly-brain-'));
  const file = join(dir, 'brain.json');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('ingère, renforce les motifs déjà vus et persiste sur disque', async () => {
    const brain = new Brain({ file });
    const grains = extractGrains(A, B, cmp);
    const r1 = await brain.ingest(grains);
    expect(r1.added).toBe(grains.length);
    const r2 = await brain.ingest(grains);
    expect(r2.added).toBe(0);
    expect(r2.reinforced).toBe(grains.length);
    const again = new Brain({ file });
    expect(again.stats().grains).toBe(grains.length);
    expect(again.stats().observations).toBe(grains.length * 2);
    expect(again.patterns(undefined, 3)[0].count).toBe(2);
  });

  it('retrouve les grains proches d’une situation (Antoine, horaire du bus)', async () => {
    const brain = new Brain({ file });
    const hits = await brain.query({ text: 'Antoine tenir l’horaire bus L1-1 retard', k: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].grain.text.toLowerCase()).toMatch(/antoine|bus/);
    for (let i = 1; i < hits.length; i++) expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
    const onlyInterventions = await brain.query({ text: 'retard de bus', kinds: ['intervention'] });
    expect(onlyInterventions.every((h) => h.grain.kind === 'intervention')).toBe(true);
  });

  it('clear() vide le cerveau', async () => {
    const brain = new Brain({ file });
    brain.clear();
    expect(new Brain({ file }).stats().grains).toBe(0);
  });
});
