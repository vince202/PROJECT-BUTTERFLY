import { Reality } from '../src/sim/reality';
import { compareRealities } from '../src/sim/compare';
import { busDelayFor } from '../src/sim/interventions';
import { fmtTime } from '../src/sim/time';
const seed = Number(process.argv[2] ?? 150);
const at = process.argv[3] ?? '09:25';
const [h, m] = at.split(':').map(Number);
const A = new Reality({ id: 'A', name: 'A', seed, interventions: [] }).generate();
const arr = A.events.find((e) => e.type === 'bus_arrive' && e.t === h * 60 + m)!;
const iv = busDelayFor(arr, 3);
const B = new Reality({ id: 'B', name: 'B', seed, interventions: [iv] }).generate();
const c = compareRealities(A, B);
console.log(c.summary.join('\n'));
const ivEvent = B.events.find((e) => e.type === 'intervention')!;
const target = [...c.consequences].reverse().find((x) => x.b && ['meeting_missed', 'return_item', 'find_item', 'late', 'argument'].includes(x.b.type));
if (target?.b) {
  console.log(`\nChaîne vers : ${fmtTime(target.b.t)} ${target.b.label}`);
  const chain = B.causal.chain(ivEvent.id, target.b.id);
  if (!chain) console.log('  (aucune chaîne directe trouvée)');
  else for (const e of chain) console.log(`  ${fmtTime(e.t)} [${e.type}] ${e.label}${e.mechanism ? ` — ${e.mechanism}` : ''}`);
}
console.log('\nA: rain?', A.engine.state.weatherSchedule, ' events', A.events.length, ' meetings', A.events.filter(e=>e.type==='meeting_start').length, 'missed', A.events.filter(e=>e.type==='meeting_missed').length, 'bus boardings', A.events.filter(e=>e.type==='board_bus').length);
console.log('A missed:', A.events.filter(e=>e.type==='meeting_missed').map(e=>`${fmtTime(e.t)} ${e.label}`).join(' | '));
