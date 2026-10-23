import { describe, expect, it } from 'vitest';
import { AdvisedPolicy, MockAdvisor, generateWithAdvisor, type AdviceRequest, type DecisionAdvisor } from '../src/sim/advisor';
import { Reality } from '../src/sim/reality';
import { AGENTS, profileOf } from '../src/sim/population';

const def = { id: 'A', name: 'A', seed: 51, interventions: [] };

describe('Politique de décision conseillée (DecisionPolicy + cache oracle)', () => {
  it('converge avec le conseiller simulé, applique des conseils valides et reste rejouable', async () => {
    const res = await generateWithAdvisor(def, new MockAdvisor(), { maxPasses: 4, maxRequestsPerPass: 150 });
    expect(res.answered).toBeGreaterThan(50);
    expect(res.applied).toBeGreaterThan(20);
    expect(res.reality.events.length).toBeGreaterThan(2000);
    // Every advised decision picked a candidate the engine had validated.
    const advised = res.reality.events.filter((e) => e.type === 'decision' && String(e.description).includes('Arbitrage du conseiller'));
    expect(advised.length).toBeGreaterThan(20);
    const again = new Reality({ ...def, policy: res.policy }).generate();
    expect(again.events.length).toBe(res.reality.events.length);
    expect(again.events.map((e) => e.label)).toEqual(res.reality.events.map((e) => e.label));
    // World constraints still hold.
    const end = res.reality.engine.state;
    const home = AGENTS.filter((a) => end.agents[a.id].asleep || end.agents[a.id].locationId === a.homeId).length;
    expect(home).toBeGreaterThanOrEqual(18);
  }, 60000);

  it('ignore les réponses invalides et garde le choix utilitaire', async () => {
    const garbage: DecisionAdvisor = { name: 'garbage', async advise(reqs: AdviceRequest[]) { return reqs.map((r) => ({ key: r.key, choice: 'teleport@moon', reason: 'nope' })); } };
    const res = await generateWithAdvisor(def, garbage, { maxPasses: 2, maxRequestsPerPass: 50 });
    expect(res.applied).toBe(0);
    const base = new Reality(def).generate();
    expect(res.reality.events.length).toBe(base.events.length);
  }, 60000);

  it('ne consulte le conseiller que pour des choix ouverts (jamais pour une intervention ou un engagement dû)', async () => {
    const policy = new AdvisedPolicy();
    new Reality({ ...def, policy }).generate();
    for (const req of policy.pending.values()) {
      expect(req.candidates.length).toBeGreaterThanOrEqual(2);
      expect(req.candidates.some((c) => c.choice === req.baseline)).toBe(true);
      expect(profileOf(req.agentId)).toBeTruthy();
    }
  });
});
