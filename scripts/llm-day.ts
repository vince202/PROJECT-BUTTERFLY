/**
 * Simulate a day with the advised decision policy.
 *   npm run cli:advised -- --seed 51 --advisor mock        (deterministic mock, no key needed)
 *   npm run cli:advised -- --seed 51 --advisor anthropic   (needs ANTHROPIC_API_KEY in .env)
 *   npm run cli:advised -- --seed 51 --advisor jev         (needs TYPESAFE_API_KEY in .env)
 */
import { generateWithAdvisor, MockAdvisor, type DecisionAdvisor } from '../src/sim/advisor';
import { Reality } from '../src/sim/reality';
import { fmtTime } from '../src/sim/time';

async function main() {
  const args = process.argv.slice(2);
  const opt = (n: string, d: string) => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : d);
  const seed = Number(opt('seed', '51'));
  const which = opt('advisor', 'mock');
  let advisor: DecisionAdvisor;
  if (which === 'jev') {
    if (!process.env.TYPESAFE_API_KEY) throw new Error('TYPESAFE_API_KEY manquante (voir .env.example)');
    const { JevAdvisor } = await import('../server/jev');
    advisor = new JevAdvisor({ apiKey: process.env.TYPESAFE_API_KEY, model: process.env.TYPESAFE_MODEL ?? 'jev-latest' });
  } else if (which === 'anthropic') {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) throw new Error('ANTHROPIC_API_KEY manquante (voir .env.example)');
    const { AnthropicAdvisor } = await import('../server/advisor');
    advisor = new AnthropicAdvisor(process.env.ANTHROPIC_MODEL ?? 'claude-opus-5-5', process.env.ANTHROPIC_FALLBACKS !== 'off');
  } else advisor = new MockAdvisor();
  const t0 = performance.now();
  const res = await generateWithAdvisor({ id: 'A', name: 'A', seed, interventions: [] }, advisor, { maxPasses: Number(opt('passes', '4')), maxRequestsPerPass: Number(opt('batch', which === 'anthropic' ? '40' : '150')) });
  console.log(res.log.join('\n'));
  console.log(`\nConseiller ${advisor.name} — ${res.answered} réponses, ${res.applied} conseils appliqués, ${res.unresolved} choix restés utilitaires, ${Math.round(performance.now() - t0)} ms`);
  const base = new Reality({ id: 'A', name: 'A', seed, interventions: [] }).generate();
  console.log(`Événements : utilitaire ${base.events.length}, conseillé ${res.reality.events.length}`);
  console.log('\nExemples de décisions arbitrées :');
  for (const e of res.reality.events.filter((e) => e.type === 'decision' && String(e.description).includes('Arbitrage')).slice(0, 12)) console.log(`${fmtTime(e.t)} ${e.label} — ${String(e.description).split(' · ')[0]}`);
}
main();
