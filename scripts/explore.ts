/** Exploration: determinism checks + seed search for a meaningful bus-delay demo. */
import { Reality } from '../src/sim/reality';
import { Engine } from '../src/sim/engine';
import { compareRealities } from '../src/sim/compare';
import { busDelayFor } from '../src/sim/interventions';
import { fmtTime } from '../src/sim/time';

function canon(obj: unknown): string {
  return JSON.stringify(obj, (_k, v) => (typeof v === 'number' ? Number(v.toFixed(6)) : v));
}

// 1. Reproducibility
{
  const a = new Engine(42); a.runToEnd();
  const b = new Engine(42); b.runToEnd();
  console.log('reproducible:', canon(a.events) === canon(b.events) && canon(a.state) === canon(b.state));
}
// 2. Replay from snapshots
{
  const r = new Reality({ id: 'A', name: 'A', seed: 42, interventions: [] }).generate();
  let ok = true;
  for (const t of [365, 400, 487, 600, 733, 900, 1100, 1439]) {
    const replay = r.stateAt(t);
    const fresh = new Engine(42);
    while (fresh.state.t < t) fresh.step();
    const same = canon(replay) === canon(fresh.state);
    if (!same) { ok = false; console.log('replay mismatch at', fmtTime(t)); }
  }
  console.log('replay ok:', ok, 'snapshots:', r.snapshots.size, 'trace frames:', r.trace.length);
}
// 3. Seed search for the bus-delay demo
const results: { seed: number; t: number; bus: string; stop: string; cons: number; majors: number; affected: number; first: string; labels: string[] }[] = [];
const seedArg = process.argv.indexOf('--seeds');
const maxSeed = seedArg >= 0 ? Number(process.argv[seedArg + 1]) : 40;
for (let seed = 1; seed <= maxSeed; seed++) {
  const A = new Reality({ id: 'A', name: 'A', seed, interventions: [] }).generate();
  // Candidate arrivals: buses with a boarding in the morning (07:30–09:30)
  const boardings = A.events.filter((e) => e.type === 'board_bus' && e.t >= 450 && e.t <= 570);
  const seen = new Set<string>();
  for (const b of boardings) {
    const arr = A.events.find((e) => e.type === 'bus_arrive' && e.busId === b.busId && e.locationId === b.locationId && e.t === b.t);
    if (!arr || seen.has(arr.id)) continue;
    seen.add(arr.id);
    const iv = busDelayFor(arr, 3);
    const B = new Reality({ id: 'B', name: 'B', seed, interventions: [iv] }).generate();
    const c = compareRealities(A, B);
    const majors = c.consequences.filter((m) => (m.b?.importance ?? 0) >= 0.6);
    results.push({ seed, t: arr.t, bus: arr.busId!, stop: arr.locationId!, cons: c.consequences.length, majors: majors.length, affected: c.affectedAgents.length, first: c.firstConsequence?.b ? `${fmtTime(c.firstConsequence.b.t)} ${c.firstConsequence.b.label}` : '-', labels: majors.slice(0, 4).map((m) => `${fmtTime(m.b!.t)} ${m.b!.label}`) });
  }
}
results.sort((x, y) => y.majors - x.majors || y.cons - x.cons);
console.log(`\n${results.length} scénarios testés`);
for (const r of results.slice(0, 15)) {
  console.log(`seed ${r.seed} @${fmtTime(r.t)} ${r.bus} ${r.stop}: cons=${r.cons} majors=${r.majors} affected=${r.affected} first=${r.first}`);
  for (const l of r.labels) console.log(`     ${l}`);
}
const zero = results.filter((r) => r.cons === 0).length;
console.log(`\nScénarios sans conséquence notable : ${zero}/${results.length}`);
