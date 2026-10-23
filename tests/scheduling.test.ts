import { describe, expect, it } from 'vitest';
import { AGENTS, COMMITMENT_SEEDS } from '../src/sim/population';
import type { SimEvent } from '../src/sim/types';
import { NORMAL_SEED, runDay } from './helpers';

const OUTCOME_TYPES = new Set(['meeting_start', 'meeting_missed', 'meeting_end', 'commitment_cancelled', 'activity_start', 'wait_start']);

describe('Planification de la journée (graine 42)', () => {
  const R = runDay(NORMAL_SEED);
  const start = R.snapshots.get(360)!;

  it('chaque habitant avec un engagement de travail/école a un événement work_start', () => {
    const workers = AGENTS.filter((a) => start.agents[a.id].commitments.some((c) => c.kind === 'work' || c.kind === 'school'));
    expect(workers.length).toBeGreaterThanOrEqual(12);
    for (const a of workers) {
      const starts = R.events.filter((e) => e.type === 'work_start' && e.actors.includes(a.id));
      expect(starts.length, `${a.id} devrait avoir un work_start`).toBeGreaterThanOrEqual(1);
    }
  });

  it('le work_start a lieu sur le lieu de travail de l’habitant', () => {
    for (const a of AGENTS) {
      if (!a.workplaceId) continue;
      for (const e of R.events.filter((e) => e.type === 'work_start' && e.actors.includes(a.id))) {
        expect(e.locationId, `${a.id} @${e.t}`).toBe(a.workplaceId);
      }
    }
  });

  it('les habitants sans travail (retraités, etc.) n’ont pas de work_start', () => {
    const nonWorkers = AGENTS.filter((a) => !start.agents[a.id].commitments.some((c) => c.kind === 'work' || c.kind === 'school' || c.kind === 'shift'));
    for (const a of nonWorkers) {
      expect(R.events.some((e) => e.type === 'work_start' && e.actors.includes(a.id)), a.id).toBe(false);
    }
  });

  it('les habitants se réveillent à ou après leur heure de réveil habituelle', () => {
    const wakes = R.events.filter((e) => e.type === 'wake');
    expect(wakes.length).toBeGreaterThanOrEqual(10);
    for (const w of wakes) {
      const p = AGENTS.find((a) => a.id === w.actors[0])!;
      expect(w.t, `${p.id} se réveille à ${w.t}`).toBeGreaterThanOrEqual(p.routine.wake);
    }
  });

  it('chaque dormeur du début de journée se réveille exactement une fois', () => {
    const sleepers = AGENTS.filter((a) => start.agents[a.id].asleep);
    expect(sleepers.length).toBeGreaterThan(5);
    for (const a of sleepers) {
      const n = R.events.filter((e) => e.type === 'wake' && e.actors.includes(a.id)).length;
      expect(n, a.id).toBe(1);
    }
  });

  it('les dormeurs se réveillent à l’heure de leur routine (à la minute près)', () => {
    for (const a of AGENTS.filter((a) => start.agents[a.id].asleep)) {
      const w = R.events.find((e) => e.type === 'wake' && e.actors.includes(a.id))!;
      expect(w.t).toBe(a.routine.wake);
    }
  });

  it('au moins 80 % des rendez-vous prévus ont un événement de résultat', () => {
    const planned = COMMITMENT_SEEDS.filter((c) => c.kind === 'meeting' || c.kind === 'appointment' || c.kind === 'errand');
    const withOutcome = planned.filter((c) => R.events.some((e: SimEvent) => OUTCOME_TYPES.has(e.type) && e.data?.commitmentId === c.id));
    expect(planned.length).toBe(COMMITMENT_SEEDS.length);
    expect(withOutcome.length / planned.length).toBeGreaterThanOrEqual(0.8);
  });

  it('chaque réunion/rendez-vous aboutit à meeting_start, meeting_missed ou commitment_cancelled', () => {
    for (const c of COMMITMENT_SEEDS.filter((c) => c.kind === 'meeting' || c.kind === 'appointment')) {
      const ok = R.events.some((e) => ['meeting_start', 'meeting_missed', 'commitment_cancelled'].includes(e.type) && e.data?.commitmentId === c.id);
      expect(ok, c.id).toBe(true);
    }
  });

  it('chaque course (errand) a un activity_start ou meeting_end ou meeting_missed', () => {
    for (const c of COMMITMENT_SEEDS.filter((c) => c.kind === 'errand')) {
      const ok = R.events.some((e) => ['activity_start', 'meeting_end', 'meeting_missed', 'commitment_cancelled'].includes(e.type) && e.data?.commitmentId === c.id);
      expect(ok, c.id).toBe(true);
    }
  });

  it('les réunions ont lieu au bon endroit, au plus 5 min avant l’heure prévue et avant la fin de la tolérance', () => {
    for (const c of COMMITMENT_SEEDS.filter((c) => c.kind === 'meeting' || c.kind === 'appointment')) {
      const s = R.events.find((e) => e.type === 'meeting_start' && e.data?.commitmentId === c.id);
      if (!s) continue;
      expect(s.locationId, c.id).toBe(c.locationId);
      expect(s.t, c.id).toBeGreaterThanOrEqual(c.start - 5); // le moteur autorise un démarrage anticipé de 5 min quand tout le monde est là
      expect(s.t, c.id).toBeLessThanOrEqual(c.start + c.tolerance);
      for (const p of c.participants) expect(s.actors).toContain(p);
    }
  });

  it('les engagements semés existent dans l’état initial de chaque participant', () => {
    for (const c of COMMITMENT_SEEDS) {
      for (const p of c.participants) {
        const found = start.agents[p].commitments.find((x) => x.id === c.id);
        expect(found, `${p} / ${c.id}`).toBeDefined();
        expect(found!.start).toBe(c.start);
        expect(found!.locationId).toBe(c.locationId);
      }
    }
  });

  it('au moins 18 habitants sur 20 finissent la journée endormis ou chez eux', () => {
    const end = R.engine.state;
    const ok = AGENTS.filter((a) => end.agents[a.id].asleep || end.agents[a.id].locationId === a.homeId);
    expect(ok.length).toBeGreaterThanOrEqual(18);
  });

  it('tous les habitants dorment à minuit (événement sleep)', () => {
    for (const a of AGENTS) {
      const sleeps = R.events.filter((e) => e.type === 'sleep' && e.actors.includes(a.id));
      expect(sleeps.length, a.id).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('Planification stable sur d’autres graines', () => {
  it.each([1, 7, 100])('graine %i : mêmes garanties (travail, réveil, fin de journée)', (seed) => {
    const R = runDay(seed);
    const start = R.snapshots.get(360)!;
    for (const a of AGENTS) {
      if (start.agents[a.id].commitments.some((c) => c.kind === 'work' || c.kind === 'school')) {
        expect(R.events.some((e) => e.type === 'work_start' && e.actors.includes(a.id)), `${a.id}`).toBe(true);
      }
    }
    for (const w of R.events.filter((e) => e.type === 'wake')) {
      expect(w.t).toBeGreaterThanOrEqual(AGENTS.find((a) => a.id === w.actors[0])!.routine.wake);
    }
    const end = R.engine.state;
    expect(AGENTS.filter((a) => end.agents[a.id].asleep || end.agents[a.id].locationId === a.homeId).length).toBeGreaterThanOrEqual(18);
  });
});
