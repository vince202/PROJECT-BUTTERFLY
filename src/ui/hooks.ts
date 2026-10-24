/**
 * Shared hooks for the UI: per-minute subscriptions and memoised world-state
 * reconstruction (stateAt is a few ms, so it is cached per reality & minute).
 */

import { useCallback, useMemo } from 'react';
import { useActiveReality, useSimStore, type RealityId } from '../store/useSimStore';
import type { Reality } from '../sim/reality';
import type { Minute, SimEvent, WorldState } from '../sim/types';
import type { Locale } from '../i18n';

/**
 * Subscribes the calling component to the interface language: it re-renders
 * when the language changes, so every `t()` call it makes at render time
 * returns the new text. Call it once in each component that renders text.
 */
export function useLocale(): Locale {
  return useSimStore((s) => s.locale);
}

/** Integer minute of the display clock (re-renders once per simulated minute). */
export function useMinute(): Minute {
  return useSimStore((s) => Math.floor(s.time));
}

const stateCache = new WeakMap<Reality, Map<Minute, WorldState>>();
const CACHE_SIZE = 48;

/** Memoised `reality.stateAt(minute)` with a small per-reality LRU cache. */
export function cachedStateAt(reality: Reality, minute: Minute): WorldState {
  let m = stateCache.get(reality);
  if (!m) {
    m = new Map();
    stateCache.set(reality, m);
  }
  const hit = m.get(minute);
  if (hit) {
    m.delete(minute);
    m.set(minute, hit);
    return hit;
  }
  const s = reality.stateAt(minute);
  m.set(minute, s);
  if (m.size > CACHE_SIZE) m.delete(m.keys().next().value as Minute);
  return s;
}

export function useWorldState(reality: Reality, minute: Minute): WorldState {
  const generation = useSimStore((s) => s.generation);
  return useMemo(() => cachedStateAt(reality, minute), [reality, minute, generation]);
}

/** Which reality id is the given reality object (A or B). */
export function useRealityIdOf(): (r: Reality) => RealityId {
  const b = useSimStore((s) => s.realityB);
  return useCallback((r: Reality) => (b && r === b ? 'B' : 'A'), [b]);
}

/**
 * Returns a handler that selects an event (optionally in a given reality) and,
 * when `seek` is true, moves the clock to its time.
 */
export function useGoToEvent() {
  const selectEvent = useSimStore((s) => s.selectEvent);
  const seekFn = useSimStore((s) => s.seek);
  const switchReality = useSimStore((s) => s.switchReality);
  const active = useSimStore((s) => s.activeRealityId);
  return useCallback(
    (e: SimEvent, opts: { seek?: boolean; reality?: RealityId } = {}) => {
      if (opts.reality && opts.reality !== active) switchReality(opts.reality);
      selectEvent(e.id);
      if (opts.seek) seekFn(e.t);
    },
    [selectEvent, seekFn, switchReality, active],
  );
}

export { useActiveReality };
