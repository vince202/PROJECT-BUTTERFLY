/** Seed search v2: rank bus-delay scenarios by story value. */
import { Reality } from '../src/sim/reality';
import { compareRealities } from '../src/sim/compare';
import { busDelayFor } from '../src/sim/interventions';
import { fmtTime } from '../src/sim/time';
const STORY = new Set(['meeting_missed', 'late', 'miss_bus', 'argument', 'conversation', 'invitation', 'find_item', 'return_item', 'meeting_start', 'lose_item', 'found_closed']);
const from = Number(process.argv[2] ?? 1), to = Number(process.argv[3] ?? 120);
const out: string[] = [];
for (let seed = from; seed <= to; seed++) {
  const A = new Reality({ id: 'A', name: 'A', seed, interventions: [] }).generate();
  const boardings = A.events.filter((e) => e.type === 'board_bus' && e.t >= 440 && e.t <= 600);
  const seen = new Set<string>();
  for (const b of boardings) {
    const arr = A.events.find((e) => e.type === 'bus_arrive' && e.busId === b.busId && e.locationId === b.locationId && e.t === b.t);
    if (!arr || seen.has(arr.id)) continue;
    seen.add(arr.id);
    const B = new Reality({ id: 'B', name: 'B', seed, interventions: [busDelayFor(arr, 3)] }).generate();
    const c = compareRealities(A, B);
    const story = c.consequences.filter((m) => STORY.has((m.b ?? m.a)!.type));
    if (story.length >= 2) {
      out.push(`seed ${seed} @${fmtTime(arr.t)} ${arr.busId} ${arr.locationId} cons=${c.consequences.length} story=${story.length} affected=${c.affectedAgents.length}`);
      for (const m of story.slice(0, 6)) out.push(`     ${m.b ? fmtTime(m.b.t) + ' [' + m.status + '] ' + m.b.label : fmtTime(m.a!.t) + ' [A seulement] ' + m.a!.label}`);
    }
  }
}
console.log(out.join('\n'));
