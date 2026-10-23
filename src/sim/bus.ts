/**
 * Bus line: timetable, bus state initialisation and per-minute movement.
 *
 * Buses shuttle back and forth along their line. The timetable is computed from
 * the route geometry so that agents can plan around it; actual arrivals may be
 * late because of holds (interventions) or small seeded incidents.
 */

import { BUSES_PER_LINE, polylineLength, type City } from './city';
import type { BusLineDef, BusState, LocationId, Minute } from './types';

export interface ScheduledStop {
  busId: string;
  trip: number;
  stopIndex: number;
  stopId: LocationId;
  /** +1 towards the end of the stop list, -1 towards the start. */
  direction: 1 | -1;
  arrive: Minute;
  depart: Minute;
}

/** Extra minutes spent at terminals before turning around. */
export const TERMINAL_LAYOVER = 2;

export function travelTicks(line: BusLineDef, length: number): number {
  return Math.max(1, Math.ceil(length / line.speed));
}

/** Street polyline between two consecutive stops. */
export function stopPath(city: City, from: LocationId, to: LocationId) {
  const nodes = city.pathNodes(city.location(from).node, city.location(to).node);
  return nodes.map((n) => city.nodePos(n));
}

/**
 * Full-day timetable for every bus of a line. Bus k starts at terminal
 * (k % 2 === 0 ? last stop : first stop) so that two buses serve both directions.
 */
export function buildTimetable(city: City, line: BusLineDef): ScheduledStop[] {
  const out: ScheduledStop[] = [];
  const n = line.stops.length;
  // Segment travel ticks between consecutive stops
  const seg: number[] = [];
  for (let i = 0; i < n - 1; i++) seg.push(travelTicks(line, polylineLength(stopPath(city, line.stops[i], line.stops[i + 1]))));

  for (let b = 0; b < BUSES_PER_LINE; b++) {
    const busId = `${line.id}-${b + 1}`;
    let idx = b % 2 === 0 ? n - 1 : 0;
    let dir: 1 | -1 = b % 2 === 0 ? -1 : 1;
    let t = line.firstDeparture;
    let trip = 0;
    // First entry: departure from the terminal.
    out.push({ busId, trip, stopIndex: idx, stopId: line.stops[idx], direction: dir, arrive: t - line.dwell - TERMINAL_LAYOVER, depart: t });
    while (t < line.lastDeparture + 60) {
      const next = idx + dir;
      const s = dir === 1 ? seg[idx] : seg[next];
      t += s;
      const arrive = t;
      const terminal = next === 0 || next === n - 1;
      let depart = arrive + line.dwell + (terminal ? TERMINAL_LAYOVER : 0);
      if (terminal) {
        trip += 1;
        dir = dir === 1 ? -1 : 1;
        // Align terminal departures on the line headway grid for a readable timetable.
        const period = 2 * (seg.reduce((a, c) => a + c, 0) + (n - 2) * line.dwell) + 2 * (line.dwell + TERMINAL_LAYOVER);
        void period;
      }
      out.push({ busId, trip, stopIndex: next, stopId: line.stops[next], direction: dir, arrive, depart });
      idx = next;
      t = depart;
      if (t > line.lastDeparture + 60) break;
    }
  }
  return out;
}

export class Timetable {
  readonly entries: ScheduledStop[];
  private byStop = new Map<LocationId, ScheduledStop[]>();
  private byBus = new Map<string, ScheduledStop[]>();

  constructor(city: City, lines: BusLineDef[]) {
    this.entries = lines.flatMap((l) => buildTimetable(city, l));
    for (const e of this.entries) {
      if (!this.byStop.has(e.stopId)) this.byStop.set(e.stopId, []);
      this.byStop.get(e.stopId)!.push(e);
      if (!this.byBus.has(e.busId)) this.byBus.set(e.busId, []);
      this.byBus.get(e.busId)!.push(e);
    }
    for (const list of this.byStop.values()) list.sort((a, b) => a.depart - b.depart);
  }

  /** Next scheduled departure from a stop in the given direction at or after `t`. */
  nextDeparture(stopId: LocationId, direction: 1 | -1, t: Minute): ScheduledStop | null {
    const list = this.byStop.get(stopId) ?? [];
    for (const e of list) {
      // The direction recorded is the direction the bus takes when leaving the stop.
      if (e.depart >= t && e.direction === direction) return e;
    }
    return null;
  }

  /** Scheduled arrival of a given bus trip at a stop (after departure from `fromStop`). */
  arrivalAfter(busId: string, fromEntry: ScheduledStop, toStopId: LocationId): ScheduledStop | null {
    const list = this.byBus.get(busId) ?? [];
    const i = list.indexOf(fromEntry);
    for (let j = i + 1; j < list.length; j++) {
      if (list[j].stopId === toStopId) return list[j];
    }
    return null;
  }

  busEntries(busId: string): ScheduledStop[] {
    return this.byBus.get(busId) ?? [];
  }

  stopEntries(stopId: LocationId): ScheduledStop[] {
    return this.byStop.get(stopId) ?? [];
  }
}

/** Estimate a bus trip: walk to stop, wait, ride, walk from stop. */
export function planBusTrip(
  city: City,
  timetable: Timetable,
  line: BusLineDef,
  fromNode: string,
  toLocation: LocationId,
  t: Minute,
  walkSpeed: number,
): { boardStop: LocationId; alightStop: LocationId; entry: ScheduledStop; arrival: Minute; total: Minute; walkToStop: Minute; wait: Minute } | null {
  // Nearest stops by street distance.
  let bestBoard: LocationId | null = null;
  let bestBoardD = Infinity;
  let bestAlight: LocationId | null = null;
  let bestAlightD = Infinity;
  const toNode = city.location(toLocation).node;
  for (const s of line.stops) {
    const sn = city.location(s).node;
    const d1 = city.nodeDistance(fromNode, sn);
    if (d1 < bestBoardD) {
      bestBoardD = d1;
      bestBoard = s;
    }
    const d2 = city.nodeDistance(sn, toNode);
    if (d2 < bestAlightD) {
      bestAlightD = d2;
      bestAlight = s;
    }
  }
  if (!bestBoard || !bestAlight || bestBoard === bestAlight) return null;
  const bi = line.stops.indexOf(bestBoard);
  const ai = line.stops.indexOf(bestAlight);
  const direction: 1 | -1 = ai > bi ? 1 : -1;
  const walkToStop = Math.ceil(bestBoardD / walkSpeed);
  // Be at the stop at least one minute before the bus leaves.
  const entry = timetable.nextDeparture(bestBoard, direction, t + walkToStop + 1);
  if (!entry) return null;
  const arrivalEntry = timetable.arrivalAfter(entry.busId, entry, bestAlight);
  if (!arrivalEntry) return null;
  const walkFromStop = Math.ceil(bestAlightD / walkSpeed);
  const arrival = arrivalEntry.arrive + walkFromStop;
  return {
    boardStop: bestBoard,
    alightStop: bestAlight,
    entry,
    arrival,
    total: arrival - t,
    walkToStop,
    wait: entry.depart - (t + walkToStop),
  };
}

export function initBuses(city: City, lines: BusLineDef[]): Record<string, BusState> {
  const buses: Record<string, BusState> = {};
  for (const line of lines) {
    const n = line.stops.length;
    for (let b = 0; b < BUSES_PER_LINE; b++) {
      const id = `${line.id}-${b + 1}`;
      const startIdx = b % 2 === 0 ? n - 1 : 0;
      const stopId = line.stops[startIdx];
      buses[id] = {
        id,
        lineId: line.id,
        pos: { ...city.doorPos(stopId) },
        nextStopIndex: startIdx,
        path: [],
        progress: 0,
        pathLength: 0,
        dwellRemaining: 0,
        holdRemaining: 0,
        delay: 0,
        trip: 0,
        passengers: [],
        lastEventId: null,
        delayEventIds: [],
        inService: true,
        direction: b % 2 === 0 ? -1 : 1,
        scheduleIndex: 0,
        currentStopId: stopId,
        scheduledDeparture: line.firstDeparture,
      };
    }
  }
  return buses;
}
