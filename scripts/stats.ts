import { Engine } from '../src/sim/engine';
import { AGENTS } from '../src/sim/population';
const from = Number(process.argv[2] ?? 1), to = Number(process.argv[3] ?? 20);
const agg: Record<string, number> = {};
let maxDecisions = 0, maxDecisionAgent = '', stuck: string[] = [], neverLeft: string[] = [], notHome = 0, waitLoops = 0;
for (let seed = from; seed <= to; seed++) {
  const e = new Engine(seed); e.runToEnd();
  for (const ev of e.events) agg[ev.type] = (agg[ev.type] ?? 0) + 1;
  for (const p of AGENTS) {
    const mine = e.events.filter((x) => x.actors[0] === p.id);
    const dec = mine.filter((x) => x.type === 'decision').length;
    if (dec > maxDecisions) { maxDecisions = dec; maxDecisionAgent = `${p.id}@${seed}`; }
    const waits = mine.filter((x) => x.type === 'decision' && x.data?.action === 'wait').length;
    if (waits > 8) waitLoops++;
    if (!mine.some((x) => x.type === 'depart')) neverLeft.push(`${p.id}@${seed}`);
    const a = e.state.agents[p.id];
    if (a.travel) stuck.push(`${p.id}@${seed} travel ${a.travel.stage}`);
    if (a.locationId !== p.homeId && !a.asleep) notHome++;
  }
}
const n = to - from + 1;
console.log('avg per day:', Object.entries(agg).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${(v / n).toFixed(1)}`).join(' '));
console.log('max decisions', maxDecisions, maxDecisionAgent, '| wait-loop agents', waitLoops, '| stuck travelling at midnight:', stuck.length, stuck.slice(0, 5), '| never left:', neverLeft.length, neverLeft.slice(0, 5), '| not home & awake at midnight:', notHome);
