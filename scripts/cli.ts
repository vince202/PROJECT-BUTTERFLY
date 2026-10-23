/**
 * BUTTERFLY command-line runner: simulate a day and print a summary.
 *   npm run cli -- --seed 42 [--bus-delay 3 --at 08:12] [--agent alice] [--verbose]
 */
import { Engine } from '../src/sim/engine';
import { fmtTime } from '../src/sim/time';
import type { Intervention, SimEvent } from '../src/sim/types';
import { AGENTS } from '../src/sim/population';

const args = process.argv.slice(2);
const opt = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const seed = Number(opt('seed', '42'));
const verbose = args.includes('--verbose');
const agentFilter = opt('agent');
const interventions: Intervention[] = [];
const delay = opt('bus-delay');
if (delay) {
  const [h, m] = (opt('at', '08:12') as string).split(':').map(Number);
  interventions.push({ id: 'iv1', kind: 'bus_delay', t: h * 60 + m, minutes: Number(delay), busId: opt('bus', 'L1-1') as string, description: `Bus retardé de ${delay} min` });
}

const t0 = performance.now();
const engine = new Engine(seed, interventions);
engine.runToEnd();
const ms = performance.now() - t0;
const events = engine.events;
console.log(`Seed ${seed} — ${events.length} événements en ${ms.toFixed(0)} ms`);
const byType = new Map<string, number>();
for (const e of events) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
console.log([...byType.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '));

const important = events.filter((e) => e.importance >= 0.5 && !['decision'].includes(e.type));
console.log(`\n--- Événements marquants (${important.length}) ---`);
for (const e of important) console.log(`${fmtTime(e.t)}  [${e.type}] ${e.label}`);

if (agentFilter || verbose) {
  const ids = agentFilter ? [agentFilter] : AGENTS.map((a) => a.id);
  for (const id of ids) {
    console.log(`\n=== ${id} ===`);
    const mine = events.filter((e: SimEvent) => e.actors.includes(id) && !['decision'].includes(e.type));
    for (const e of mine) console.log(`${fmtTime(e.t)}  [${e.type}] ${e.label}${e.mechanism ? `  « ${e.mechanism} »` : ''}`);
    const a = engine.state.agents[id];
    console.log('needs', JSON.stringify(a.needs), 'mood', a.emotions, 'money', a.money, 'done', a.objectivesDone);
    console.log('memories:', a.memories.map((m) => `${fmtTime(m.t)} ${m.text}`).join(' | '));
  }
}
// Per-agent summary line
console.log('\n--- Habitants ---');
for (const p of AGENTS) {
  const a = engine.state.agents[p.id];
  const n = events.filter((e) => e.actors.includes(p.id)).length;
  const trips = events.filter((e) => e.type === 'depart' && e.actors[0] === p.id).length;
  const bus = events.filter((e) => e.type === 'board_bus' && e.actors[0] === p.id).length;
  console.log(`${p.firstName.padEnd(9)} ev:${String(n).padStart(3)} trajets:${String(trips).padStart(2)} bus:${bus} obj:${a.objectivesDone} lieu:${a.locationId ?? 'en chemin'} humeur:${a.emotions.mood.toFixed(2)} faim:${a.needs.hunger.toFixed(0)} fatigue:${a.needs.fatigue.toFixed(0)}`);
}
