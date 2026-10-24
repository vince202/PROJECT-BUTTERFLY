import { describe, expect, it } from 'vitest';
import { JevAdvisor, buildJevRequest } from '../server/jev';
import { AdvisedPolicy, generateWithAdvisor, type AdviceRequest } from '../src/sim/advisor';
import { Reality } from '../src/sim/reality';

function sampleRequest(): AdviceRequest {
  const policy = new AdvisedPolicy();
  new Reality({ id: 'A', name: 'A', seed: 51, interventions: [], policy }).generate();
  return [...policy.pending.values()][0];
}

describe('Conseiller Jev (TypeSafe System One)', () => {
  it('construit une question « choice » dont les options sont exactement les candidats validés', () => {
    const r = sampleRequest();
    const body = buildJevRequest(r, 'jev-latest');
    expect(body.model).toBe('jev-latest');
    expect(body.questions.decision.type).toBe('choice');
    expect(Object.keys(body.questions.decision.criteria).sort()).toEqual(r.candidates.map((c) => c.choice).sort());
    expect(JSON.stringify(body.state)).toContain(r.name);
  });

  it('accepte une réponse valide, rejette un choix inconnu ou peu confiant, et respecte la relecture', async () => {
    const calls: string[] = [];
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const options = Object.keys(body.questions.decision.criteria);
      calls.push(options.join('|'));
      const pick = options[options.length - 1];
      const probs: Record<string, number> = {};
      for (const o of options) probs[o] = o === pick ? 0.7 : 0.3 / Math.max(1, options.length - 1);
      return new Response(JSON.stringify({ model: 'jev-1.14.0', answers: { decision: { type: 'choice', choice: pick, confidence: 0.6, probabilities: probs } }, usage: { input_tokens: 500, output_tokens: 10 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const advisor = new JevAdvisor({ apiKey: 'test', fetchImpl: fakeFetch, concurrency: 4 });
    const res = await generateWithAdvisor({ id: 'A', name: 'A', seed: 51, interventions: [] }, advisor, { maxPasses: 2, maxRequestsPerPass: 40 });
    expect(calls.length).toBeGreaterThan(0);
    expect(res.answered).toBeGreaterThan(0);
    expect(advisor.inputTokens).toBe(calls.length * 500);
    const again = new Reality({ id: 'A', name: 'A', seed: 51, interventions: [], policy: res.policy }).generate();
    expect(again.events.map((e) => e.label)).toEqual(res.reality.events.map((e) => e.label));

    const garbage = new JevAdvisor({ apiKey: 'test', fetchImpl: (async () => new Response(JSON.stringify({ model: 'jev', answers: { decision: { type: 'choice', choice: 'fly@moon', confidence: 0.9, probabilities: {} } } }), { status: 200 })) as unknown as typeof fetch });
    expect(await garbage.advise([sampleRequest()])).toEqual([]);
    const timid = new JevAdvisor({ apiKey: 'test', minConfidence: 0.5, fetchImpl: (async (_u: string, init?: RequestInit) => { const b = JSON.parse(String(init?.body)); const o = Object.keys(b.questions.decision.criteria)[0]; return new Response(JSON.stringify({ model: 'jev', answers: { decision: { type: 'choice', choice: o, confidence: 0.1, probabilities: { [o]: 0.3 } } } }), { status: 200 }); }) as unknown as typeof fetch });
    expect(await timid.advise([sampleRequest()])).toEqual([]);
  }, 60000);
});
