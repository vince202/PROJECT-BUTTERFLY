import { describe, expect, it, test } from 'vitest';
import { Timetable, buildTimetable, planBusTrip, initBuses } from '../src/sim/bus';
import { CITY_HEIGHT, CITY_WIDTH, WALK_SPEED, getCity } from '../src/sim/city';
import { BUS_DRIVERS } from '../src/sim/population';
import { NORMAL_SEED, BUS_SEED, runDay } from './helpers';

const city = getCity();
const line = city.lines[0];
const timetable = new Timetable(city, city.lines);

describe('Horaires (Timetable)', () => {
  it('deux bus circulent sur la ligne L1', () => {
    const ids = new Set(timetable.entries.map((e) => e.busId));
    expect(ids).toEqual(new Set(['L1-1', 'L1-2']));
    expect(Object.keys(initBuses(city, city.lines)).sort()).toEqual(['L1-1', 'L1-2']);
  });

  it.each(['L1-1', 'L1-2'])('les entrées du bus %s sont chronologiques (arrivée ≤ départ ≤ arrivée suivante)', (busId) => {
    const entries = timetable.busEntries(busId);
    expect(entries.length).toBeGreaterThan(20);
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      expect(e.depart, `${busId}#${i}`).toBeGreaterThanOrEqual(e.arrive);
      if (i > 0) {
        expect(e.arrive, `${busId}#${i}`).toBeGreaterThan(entries[i - 1].depart);
        expect(e.depart).toBeGreaterThan(entries[i - 1].depart);
      }
    }
  });

  it('le premier départ est 06:10 et le service couvre la journée jusqu’au soir', () => {
    for (const busId of ['L1-1', 'L1-2']) {
      const entries = timetable.busEntries(busId);
      expect(entries[0].depart).toBe(line.firstDeparture);
      expect(entries.at(-1)!.depart).toBeGreaterThanOrEqual(line.lastDeparture);
    }
  });

  it('les deux bus partent des deux terminus opposés et s’arrêtent aux arrêts de la ligne', () => {
    const first1 = timetable.busEntries('L1-1')[0];
    const first2 = timetable.busEntries('L1-2')[0];
    expect(first1.stopId).toBe(line.stops.at(-1));
    expect(first2.stopId).toBe(line.stops[0]);
    expect(first1.direction).toBe(-1);
    expect(first2.direction).toBe(1);
    for (const e of timetable.entries) {
      expect(line.stops).toContain(e.stopId);
      expect(line.stops[e.stopIndex]).toBe(e.stopId);
    }
  });

  it('les arrêts consécutifs sont voisins dans la ligne (aller-retour sans saut)', () => {
    for (const busId of ['L1-1', 'L1-2']) {
      const entries = timetable.busEntries(busId);
      for (let i = 1; i < entries.length; i++) expect(Math.abs(entries[i].stopIndex - entries[i - 1].stopIndex), `${busId}#${i}`).toBe(1);
    }
  });

  it('buildTimetable est déterministe', () => {
    expect(JSON.stringify(buildTimetable(city, line))).toBe(JSON.stringify(buildTimetable(city, line)));
  });

  it('nextDeparture renvoie le prochain départ dans le bon sens, jamais avant t', () => {
    for (const stop of line.stops) {
      for (const dir of [1, -1] as const) {
        const e = timetable.nextDeparture(stop, dir, 500);
        if (!e) continue; // terminus : un seul sens
        expect(e.depart).toBeGreaterThanOrEqual(500);
        expect(e.direction).toBe(dir);
        expect(e.stopId).toBe(stop);
      }
    }
    expect(timetable.nextDeparture(line.stops[0], 1, 99999)).toBeNull();
  });
});

describe('planBusTrip', () => {
  const t = 480;
  const fromNode = city.location('res_lilas').node;

  it('renvoie un plan dont l’arrivée est strictement postérieure à t', () => {
    const plan = planBusTrip(city, timetable, line, fromNode, 'office', t, WALK_SPEED)!;
    expect(plan).not.toBeNull();
    expect(plan.arrival).toBeGreaterThan(t);
    expect(plan.total).toBe(plan.arrival - t);
    expect(plan.entry.depart).toBeGreaterThan(t);
    expect(line.stops).toContain(plan.boardStop);
    expect(line.stops).toContain(plan.alightStop);
    expect(plan.boardStop).not.toBe(plan.alightStop);
  });

  it('la montée est cohérente avec la marche vers l’arrêt et l’attente', () => {
    const plan = planBusTrip(city, timetable, line, fromNode, 'office', t, WALK_SPEED)!;
    expect(plan.walkToStop).toBeGreaterThanOrEqual(0);
    expect(plan.entry.depart).toBeGreaterThanOrEqual(t + plan.walkToStop + 1);
    expect(plan.wait).toBe(plan.entry.depart - (t + plan.walkToStop));
  });

  it('plusieurs trajets et plusieurs heures : arrivée toujours > t', () => {
    const origins = ['res_lilas', 'cafe', 'park', 'library', 'imm_haussmann', 'station'];
    const dests = ['office', 'school', 'townhall', 'supermarket', 'loft_gare', 'florist'];
    let plans = 0;
    for (const o of origins) {
      for (const d of dests) {
        if (o === d) continue;
        for (const tt of [370, 600, 900, 1200]) {
          const plan = planBusTrip(city, timetable, line, city.location(o).node, d, tt, WALK_SPEED);
          if (!plan) continue;
          plans++;
          expect(plan.arrival, `${o}→${d}@${tt}`).toBeGreaterThan(tt);
        }
      }
    }
    expect(plans).toBeGreaterThan(30);
  });

  it('retourne null quand l’arrêt de montée et de descente coïncident, ou quand il n’y a plus de bus', () => {
    expect(planBusTrip(city, timetable, line, city.location('cafe').node, 'cafe', t, WALK_SPEED)).toBeNull();
    expect(planBusTrip(city, timetable, line, fromNode, 'office', 5000, WALK_SPEED)).toBeNull();
  });
});

describe.each([NORMAL_SEED, BUS_SEED])('Bus dans la simulation (graine %i)', (seed) => {
  const R = runDay(seed);

  it('les positions des bus restent dans les limites de la ville', () => {
    for (const f of R.trace) {
      for (const [id, b] of Object.entries(f.buses)) {
        expect(b.x, `${id}@${f.t}`).toBeGreaterThanOrEqual(0);
        expect(b.x).toBeLessThanOrEqual(CITY_WIDTH);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeLessThanOrEqual(CITY_HEIGHT);
      }
    }
  });

  it('un bus ne se déplace pas plus vite que sa vitesse commerciale (360 m/min)', () => {
    for (let i = 1; i < R.trace.length; i++) {
      for (const id of Object.keys(R.trace[i].buses)) {
        const p = R.trace[i - 1].buses[id];
        const c = R.trace[i].buses[id];
        expect(Math.hypot(c.x - p.x, c.y - p.y), `${id}@${R.trace[i].t}`).toBeLessThanOrEqual(line.speed + 1);
      }
    }
  });

  it('chaque board_bus a un alight_bus ultérieur du même habitant dans le même bus (ou la journée se termine)', () => {
    const boards = R.events.filter((e) => e.type === 'board_bus');
    expect(boards.length).toBeGreaterThan(3);
    for (const b of boards) {
      const alight = R.events.find((e) => e.type === 'alight_bus' && e.actors[0] === b.actors[0] && e.busId === b.busId && e.t > b.t);
      expect(alight || b.t >= 1439, `${b.id} ${b.label}`).toBeTruthy();
      if (alight) {
        expect(alight.causes).toContain(b.id);
        expect(alight.locationId).not.toBe(b.locationId);
      }
    }
  });

  it('l’alight_bus d’un trajet descend du bus qui a été pris, pas d’un autre', () => {
    for (const a of R.events.filter((e) => e.type === 'alight_bus')) {
      const board = [...R.events].reverse().find((e) => e.type === 'board_bus' && e.actors[0] === a.actors[0] && e.t <= a.t);
      expect(board, a.id).toBeDefined();
      expect(board!.busId).toBe(a.busId);
    }
  });

  it('les board_bus / alight_bus d’un habitant alternent (jamais deux montées de suite)', () => {
    const byAgent = new Map<string, string[]>();
    for (const e of R.events) {
      if (e.type !== 'board_bus' && e.type !== 'alight_bus') continue;
      const id = e.actors[0];
      byAgent.set(id, [...(byAgent.get(id) ?? []), e.type]);
    }
    for (const [id, seq] of byAgent) {
      seq.forEach((type, i) => expect(type, `${id}#${i}`).toBe(i % 2 === 0 ? 'board_bus' : 'alight_bus'));
    }
  });

  it('pendant qu’un habitant est dans le bus, sa position égale celle d’un bus (±0,5 m)', () => {
    let riders = 0;
    const bad: string[] = [];
    for (const f of R.trace) {
      for (const [id, a] of Object.entries(f.agents)) {
        if (!a.riding) continue;
        riders++;
        const ok = Object.values(f.buses).some((b) => Math.abs(b.x - a.x) <= 0.5 && Math.abs(b.y - a.y) <= 0.5);
        if (!ok) bad.push(`${id}@${f.t} (${a.x}, ${a.y})`);
      }
    }
    expect(riders).toBeGreaterThan(100); // chauffeur inclus
    expect(bad).toEqual([]);
  });

  it('le nombre de passagers par bus dans la trace correspond aux habitants « riding » (hors conducteur en service)', () => {
    for (const f of R.trace.filter((_, i) => i % 7 === 0)) {
      const riding = Object.values(f.agents).filter((a) => a.riding && a.act !== 'Conduit le bus').length;
      const onBoard = Object.values(f.buses).reduce((n, b) => n + b.passengers, 0);
      expect(onBoard, `@${f.t}`).toBe(riding);
    }
  });

  it('chaque bus_arrive tombe sur un arrêt de la ligne et les bus arrivent dans l’ordre de l’horaire', () => {
    for (const busId of ['L1-1', 'L1-2']) {
      const arrivals = R.events.filter((e) => e.type === 'bus_arrive' && e.busId === busId);
      expect(arrivals.length).toBeGreaterThan(20);
      let prev = -Infinity;
      for (const a of arrivals) {
        expect(line.stops).toContain(a.locationId);
        expect(a.t).toBeGreaterThan(prev);
        prev = a.t;
      }
    }
  });

  it('le retard annoncé data.delay vaut max(0, arrivée − heure planifiée) et les avances sont limitées au tout premier trajet', () => {
    for (const a of R.events.filter((e) => e.type === 'bus_arrive')) {
      const scheduled = Number(a.data!.scheduled);
      const delay = Number(a.data!.delay);
      expect(delay, a.id).toBe(Math.max(0, a.t - scheduled));
      if (a.t < scheduled) {
        // Avance tolérée uniquement pour la première arrivée de la journée (voir test.fails ci-dessous).
        expect(a.data!.trip, a.id).toBe(0);
        expect(scheduled - a.t, a.id).toBeLessThanOrEqual(1);
        expect(a.t, a.id).toBeLessThan(380);
      }
    }
  });

  // SUSPECTED BUG (engine.ts createInitialState): `bus.dwellRemaining = firstDeparture - DAY_START` (= 10)
  // but updateBuses() decrements it *before* testing `> 0`, so the first departure happens one minute
  // too early: at 06:09 instead of 06:10 (bus_depart data.delay = -1) and the first stop is reached
  // at 06:10 instead of 06:11 (bus_arrive e12/e13 of every seed). dwellRemaining should be +1.
  test.fails(`graine ${seed} : aucun bus ne part ni n’arrive avant l’heure planifiée (bug suspecté : off-by-one au premier départ)`, () => {
    for (const e of R.events.filter((e) => e.type === 'bus_depart' || e.type === 'bus_arrive')) {
      const scheduled = Number(e.data!.scheduled);
      expect(e.t, `${e.id} ${e.label}`).toBeGreaterThanOrEqual(scheduled);
    }
  });

  it('le chauffeur Antoine conduit le bus de son service puis le rend à la fin de son quart', () => {
    const d = BUS_DRIVERS[0];
    const end = R.events.find((e) => e.type === 'work_end' && e.actors[0] === d.agentId && e.busId === d.busId);
    expect(end).toBeDefined();
    expect(end!.t).toBeGreaterThanOrEqual(d.shiftEnd);
    expect(end!.t).toBeLessThan(d.shiftEnd + 60);
    expect(R.frameAt(400)!.agents[d.agentId].act).toMatch(/bus/i);
    expect(R.frameAt(end!.t + 5)!.agents[d.agentId].riding).toBe(false);
  });
});
