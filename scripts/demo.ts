/** Print the demonstration scenario (seed + bus delay) as Markdown for the README. */
import { Reality } from '../src/sim/reality';
import { compareRealities } from '../src/sim/compare';
import { busDelayFor } from '../src/sim/interventions';
import { fmtTime } from '../src/sim/time';
import { getCity } from '../src/sim/city';
const seed = Number(process.argv[2] ?? 150);
const at = process.argv[3] ?? '09:25';
const [h, m] = at.split(':').map(Number);
const A = new Reality({ id: 'A', name: 'A', seed, interventions: [] }).generate();
const arr = A.events.find((e) => e.type === 'bus_arrive' && e.t === h * 60 + m);
if (!arr) throw new Error('no arrival');
const B = new Reality({ id: 'B', name: 'B', seed, interventions: [busDelayFor(arr, 3)] }).generate();
const c = compareRealities(A, B);
const city = getCity();
console.log(`**Graine ${seed}** — événement : « ${arr.label} » (${fmtTime(arr.t)}, ${city.location(arr.locationId!).name}), retard imposé : 3 minutes.\n`);
for (const s of c.summary) console.log(`- ${s}`);
console.log('\nConséquences vérifiées :\n');
for (const x of c.consequences) {
  const e = (x.b ?? x.a)!;
  const tag = x.status === 'only_a' ? 'n’a pas eu lieu dans B' : x.status === 'shifted' ? `décalé de ${x.dt! > 0 ? '+' : ''}${x.dt} min` : 'seulement dans B';
  console.log(`- ${fmtTime(e.t)} — ${e.label} *(${tag})*`);
}
const major = [...c.consequences].reverse().find((x) => x.b && (x.b.importance >= 0.6));
if (major?.b) {
  const iv = B.events.find((e) => e.type === 'intervention')!;
  const chain = B.causal.chain(iv.id, major.b.id);
  console.log(`\nChaîne causale vers « ${major.b.label} » (${chain?.length ?? 0} maillons) :\n`);
  for (const e of chain ?? []) console.log(`${fmtTime(e.t)} · ${e.label}${c.statusB[e.id] && c.statusB[e.id] !== 'same' ? ` **[${c.statusB[e.id]}]**` : ''}`);
}
