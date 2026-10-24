/**
 * Teach the brain by playing: simulate days for a range of seeds, compare each
 * with a classic intervention (the first boarding arrival delayed by 3 min),
 * extract knowledge grains and ingest them into the local store.
 *
 *   npx tsx scripts/brain-learn.ts --from 1 --to 30 --file data/brain.json [--embed lexical|ollama]
 */
import { Brain } from '../server/brain';
import { compareRealities } from '../src/sim/compare';
import { busDelayFor } from '../src/sim/interventions';
import { extractGrains } from '../src/sim/knowledge';
import { Reality } from '../src/sim/reality';
import { LexicalEmbedder, type Embedder } from '../src/sim/recall';

async function main() {
  const args = process.argv.slice(2);
  const opt = (n: string, d: string) => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : d);
  const from = Number(opt('from', '1'));
  const to = Number(opt('to', '10'));
  let embedder: Embedder = new LexicalEmbedder();
  if (opt('embed', 'lexical') === 'ollama') {
    const { OllamaEmbedder } = await import('../server/embed');
    const o = new OllamaEmbedder({ model: process.env.OLLAMA_EMBED_MODEL, baseUrl: process.env.OLLAMA_URL });
    if (await o.probe()) embedder = o;
    else console.warn('Ollama indisponible : embedder lexical utilisé.');
  }
  const brain = new Brain({ file: opt('file', 'data/brain.json'), embedder });
  const t0 = performance.now();
  for (let seed = from; seed <= to; seed++) {
    const A = new Reality({ id: 'A', name: 'A', seed, interventions: [] }).generate();
    const arrival = A.events.find((e) => e.type === 'bus_arrive' && A.events.some((b) => b.type === 'board_bus' && b.t >= e.t && b.t <= e.t + 2 && b.busId === e.busId));
    let B: Reality | null = null;
    let cmp = null;
    if (arrival) {
      B = new Reality({ id: 'B', name: 'B', seed, interventions: [busDelayFor(arrival, 3)] }).generate();
      cmp = compareRealities(A, B);
    }
    const grains = extractGrains(A, B, cmp);
    const r = await brain.ingest(grains);
    console.log(`graine ${seed} : ${grains.length} grains (${r.added} nouveaux, ${r.reinforced} renforcés)`);
  }
  const s = brain.stats();
  console.log(`\n${s.grains} grains, ${s.observations} observations, ${s.seeds} graines, embedder ${s.embedder}, ${Math.round(performance.now() - t0)} ms → ${s.file}`);
  console.log('\nMotifs les plus fréquents :');
  for (const g of brain.patterns(undefined, 8)) console.log(`  ×${g.count}  ${g.text.slice(0, 160)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
