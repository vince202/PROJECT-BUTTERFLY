/**
 * Shared helpers for the BUTTERFLY test suite.
 * (Each test file stays independent: it only imports from here and from src/sim.)
 */
import { Engine } from '../src/sim/engine';
import { Reality, forkReality } from '../src/sim/reality';
import { AGENTS } from '../src/sim/population';
import type { Intervention, SimEvent, WorldState } from '../src/sim/types';

/** Seed used for "a normal day" in most tests. */
export const NORMAL_SEED = 42;
/** Seed with a known bus arrival at 08:20 (t = 500) at Les Lilas. */
export const BUS_SEED = 29;

const cache = new Map<string, Reality>();

/**
 * Simulate (and memoise, within one test file) a whole day.
 * The returned Reality must be treated as read-only by the caller.
 */
export function runDay(seed: number, interventions: Intervention[] = [], name = `R${seed}`): Reality {
  const key = `${seed}|${JSON.stringify(interventions)}`;
  let r = cache.get(key);
  if (!r) {
    r = new Reality({ id: name, name, seed, interventions }).generate();
    cache.set(key, r);
  }
  return r;
}

/** Same as runDay but never cached (for mutation / identity checks). */
export function freshDay(seed: number, interventions: Intervention[] = [], name = `F${seed}`): Reality {
  return new Reality({ id: name, name, seed, interventions }).generate();
}

/** Fork `base` with one intervention and generate it. */
export function fork(base: Reality, iv: Intervention, name = 'B'): Reality {
  return forkReality(base, iv, name, name).generate();
}

/** An engine stepped `steps` minutes (default: nothing). */
export function engineAt(seed: number, targetMinute: number, interventions: Intervention[] = []): Engine {
  const e = new Engine(seed, interventions);
  while (e.state.t < targetMinute) e.step();
  return e;
}

/** Recursively round numbers to `digits` decimals and sort object keys. */
export function canon(value: unknown, digits = 6): unknown {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    const f = 10 ** digits;
    const r = Math.round(value * f) / f;
    return Object.is(r, -0) ? 0 : r;
  }
  if (Array.isArray(value)) return value.map((v) => canon(v, digits));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = canon(v, digits);
    }
    return out;
  }
  return value;
}

/** Canonical JSON string (sorted keys, rounded numbers). */
export function canonJson(value: unknown, digits = 6): string {
  return JSON.stringify(canon(value, digits));
}

/** Canonical form of a world state. */
export function canonState(s: WorldState): string {
  return canonJson(s);
}

export const AGENT_IDS = AGENTS.map((a) => a.id);

export function profile(id: string) {
  const p = AGENTS.find((a) => a.id === id);
  if (!p) throw new Error(`unknown agent ${id}`);
  return p;
}

/** Events of a given type. */
export function ofType(events: SimEvent[], type: SimEvent['type']): SimEvent[] {
  return events.filter((e) => e.type === type);
}

/** Stable key for an event, excluding nothing (used to compare event lists). */
export function eventKey(e: SimEvent): string {
  return `${e.id}|${e.t}|${e.type}|${e.label}`;
}
