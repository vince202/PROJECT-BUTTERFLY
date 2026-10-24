import { describe, expect, it } from 'vitest';
import { canApplyGesture, newGame } from '../src/sim/game';
import { questAlerts } from '../src/sim/quest';
import type { Intervention } from '../src/sim/types';
import { advanceAlerts, alertIndexAt, buildGesture, busOptions, MAX_PLAY_STEP, OUTCOME_MARKS, quickGestures } from '../src/ui/game/gestures';
import { BUS_SEED, runDay } from './helpers';

const A = runDay(BUS_SEED);
const alerts = [...questAlerts(A, 'lea')].sort((a, b) => a.event.t - b.event.t);

describe('Mode joueur — curseur des alertes', () => {
  it('l’index compte les alertes passées', () => {
    expect(alertIndexAt(alerts, 0)).toBe(0);
    expect(alertIndexAt(alerts, 24 * 60)).toBe(alerts.length);
    for (const m of [480, 600, 900, 1200]) expect(alertIndexAt(alerts, m)).toBe(alerts.filter((a) => a.event.t <= m).length);
  });

  it('la lecture fait apparaître les alertes franchies, une seule fois, et jamais lors d’un saut', () => {
    expect(alerts.length).toBeGreaterThan(0);
    const first = alerts[0].event.t;
    const at = alertIndexAt(alerts, first - 1);
    const step = advanceAlerts(alerts, at, first - 1, first, true);
    expect(step.fresh.length).toBeGreaterThan(0);
    expect(step.fresh.every((a) => a.event.t === first)).toBe(true);
    // The same minute again: nothing new.
    expect(advanceAlerts(alerts, step.idx, first, first, true).fresh).toHaveLength(0);
    // A forward jump (seek) moves the cursor silently.
    const jump = advanceAlerts(alerts, at, first - 1, first + MAX_PLAY_STEP + 60, true);
    expect(jump.fresh).toHaveLength(0);
    expect(jump.idx).toBe(alertIndexAt(alerts, first + MAX_PLAY_STEP + 60));
    // Paused: no bubble either.
    expect(advanceAlerts(alerts, at, first - 1, first, false).fresh).toHaveLength(0);
    // Backwards (new loop): the cursor is recomputed.
    expect(advanceAlerts(alerts, alerts.length, 1440, 360, true)).toEqual({ idx: alertIndexAt(alerts, 360), fresh: [] });
  });

  it('chaque issue a un symbole', () => {
    expect(OUTCOME_MARKS.fulfilled.sym).toBe('✓');
    expect(OUTCOME_MARKS.failed.sym).toBe('✗');
    expect(OUTCOME_MARKS.twisted.sym).toBe('⚡');
  });
});

describe('Mode joueur — gestes rapides', () => {
  it('propose au plus six gestes, avec des heures dans le futur', () => {
    const now = 7 * 60 + 20;
    const q = quickGestures(A, 'lea', now);
    expect(q.kinds.length).toBeGreaterThanOrEqual(4);
    expect(q.kinds.length).toBeLessThanOrEqual(6);
    expect(new Set(q.kinds).size).toBe(q.kinds.length);
    for (const k of q.kinds) {
      const d = q.draft(k);
      expect(d.t).toBeGreaterThanOrEqual(now);
      const iv = buildGesture(d, A, now);
      expect(typeof iv).not.toBe('string');
      expect((iv as Intervention).t).toBeGreaterThanOrEqual(now - 1);
      expect(canApplyGesture(newGame(A, 'lea'), [], iv as Intervention, now).ok).toBe(true);
    }
  });

  it('refuse une heure déjà passée', () => {
    const now = 10 * 60;
    const d = { ...quickGestures(A, 'lea', now).draft('stay_home'), t: 9 * 60 };
    expect(buildGesture(d, A, now)).toMatch(/déjà passée/);
  });

  it('les bus proposés sont encore à venir', () => {
    const now = 8 * 60;
    const opts = busOptions(A, 'lea', now);
    expect(opts.length).toBeGreaterThan(0);
    for (const o of opts) expect(o.event.t - 1).toBeGreaterThanOrEqual(now);
  });
});
