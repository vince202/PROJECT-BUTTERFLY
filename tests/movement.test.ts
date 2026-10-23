import { describe, expect, it } from 'vitest';
import { CITY_HEIGHT, CITY_WIDTH, WALK_SPEED, getCity } from '../src/sim/city';
import type { Intervention, SimEvent, TraceFrame } from '../src/sim/types';
import { BUS_SEED, NORMAL_SEED, runDay } from './helpers';

const SEEDS = [NORMAL_SEED, BUS_SEED];

describe('Mouvement des habitants', () => {
  it('la vitesse de marche vaut 72 m/min', () => {
    expect(WALK_SPEED).toBe(72);
  });

  /** Largest per-minute displacement of agents that are neither riding nor boarding/alighting. */
  function walkingViolations(R: ReturnType<typeof runDay>, from = 0): { violations: string[]; samples: number } {
    const limit = WALK_SPEED * 1.05;
    const violations: string[] = [];
    let samples = 0;
    for (let i = Math.max(1, from); i < R.trace.length; i++) {
      const prev = R.trace[i - 1];
      const cur = R.trace[i];
      for (const id of Object.keys(cur.agents)) {
        const a0 = prev.agents[id];
        const a1 = cur.agents[id];
        // Exclusions : trajets en bus (montée / descente / conduite) dans l’une ou l’autre frame.
        if (a0.riding || a1.riding) continue;
        if (a0.act.includes('bus') || a1.act.includes('bus')) continue;
        const d = Math.hypot(a1.x - a0.x, a1.y - a0.y);
        if (d > 0.5) samples++;
        if (d > limit) violations.push(`${id} ${prev.t}→${cur.t}: ${d.toFixed(1)} m (${a0.act} → ${a1.act})`);
      }
    }
    return { violations, samples };
  }

  it.each([NORMAL_SEED, 100])('graine %i : un piéton se déplace d’au plus 1,05 × WALK_SPEED par minute', (seed) => {
    const { violations, samples } = walkingViolations(runDay(seed));
    expect(samples).toBeGreaterThan(500);
    expect(violations).toEqual([]);
  });

  // SUSPECTED BUG (engine.ts, startTravel + applyWeather/applyInterventions): startTravel() already
  // walks the first minute ("so departures are visible"). When the decision is taken *before* the
  // per-agent loop of the same step (rain chasing people out of the park, an intervention, a driver
  // finishing his shift...), updateAgent() then advances the same traveller a second time in the same
  // minute, so the walker covers two steps (up to 120-144 m) in one minute.
  // Repro: seed 29, Hugo leaves the park at 984 because of the rain: 106.6 m between t=984 and t=985
  // (path 225 m at 60 m/min in the rain takes 3 steps instead of 4: arrival 986 although expected 988).
  it('graine 29 : aucun saut de marche quand la pluie chasse quelqu’un du parc (bug suspecté : double déplacement)', () => {
    const { violations } = walkingViolations(runDay(BUS_SEED));
    expect(violations).toEqual([]);
  });

  // Same root cause, triggered by an intervention (applied before the agent loop).
  it('une décision forcée par intervention ne fait pas marcher deux fois dans la même minute (bug suspecté)', () => {
    const iv: Intervention = { id: 'iv_force', kind: 'force_action', agentId: 'martin', t: 420, action: 'coffee', locationId: 'cafe', description: 'Martin prend un café' };
    const R = runDay(NORMAL_SEED, [iv]);
    const { violations } = walkingViolations(R, 420 - 360);
    expect(violations).toEqual([]);
  });

  it.each(SEEDS)('graine %i : la trace couvre chaque minute de 360 à 1440 sans trou', (seed) => {
    const R = runDay(seed);
    expect(R.trace).toHaveLength(1081);
    R.trace.forEach((f, i) => expect(f.t).toBe(360 + i));
  });

  it.each(SEEDS)('graine %i : toutes les positions restent dans les limites de la ville (tolérance 30 m)', (seed) => {
    const R = runDay(seed);
    const tol = 30;
    const out: string[] = [];
    const check = (label: string, f: TraceFrame, x: number, y: number) => {
      if (!(x >= -tol && x <= CITY_WIDTH + tol && y >= -tol && y <= CITY_HEIGHT + tol)) out.push(`${label}@${f.t}: (${x}, ${y})`);
    };
    for (const f of R.trace) {
      for (const [id, a] of Object.entries(f.agents)) check(id, f, a.x, a.y);
      for (const [id, b] of Object.entries(f.buses)) check(id, f, b.x, b.y);
    }
    expect(out).toEqual([]);
  });

  it.each(SEEDS)('graine %i : chaque événement arrive place l’habitant au lieu d’arrivée à la minute suivante', (seed) => {
    const R = runDay(seed);
    const arrives = R.events.filter((e) => e.type === 'arrive');
    expect(arrives.length).toBeGreaterThan(100);
    const bad: string[] = [];
    for (const e of arrives) {
      const s = R.stateAt(e.t + 1).agents[e.actors[0]];
      if (s.locationId === e.locationId) continue;
      // Exception légitime : l’habitant est déjà reparti dans la même minute (aucune durée sur place).
      const leftImmediately = s.locationId === null && R.events.some((d) => d.type === 'depart' && d.t === e.t && d.actors[0] === e.actors[0]);
      if (!leftImmediately) bad.push(`${e.id} ${e.actors[0]} @${e.t}: attendu ${e.locationId}, obtenu ${s.locationId}`);
    }
    expect(bad).toEqual([]);
  });

  it.each(SEEDS)('graine %i : la durée d’un trajet à pied respecte la distance des rues', (seed) => {
    const R = runDay(seed);
    const city = getCity();
    const problems: string[] = [];
    let checked = 0;
    for (const dep of R.events.filter((e) => e.type === 'depart' && e.data?.mode === 'walk')) {
      const agent = dep.actors[0];
      const to = String(dep.data!.to);
      // Prochain événement depart/arrive de cet habitant : doit être l’arrivée correspondante, sinon le trajet a été interrompu.
      const next = R.events.find((e) => e.t >= dep.t && e.id !== dep.id && e.actors[0] === agent && (e.type === 'depart' || e.type === 'arrive'));
      if (!next || next.type !== 'arrive' || next.locationId !== to || !dep.locationId) continue;
      checked++;
      const dist = city.locationDistance(dep.locationId, to);
      const minMinutes = Math.ceil(dist / WALK_SPEED) - 1;
      const duration = next.t - dep.t;
      if (duration < minMinutes) problems.push(`${agent} ${dep.locationId}→${to}: ${duration} min < ${minMinutes} min (${dist} m)`);
    }
    expect(checked).toBeGreaterThan(50);
    expect(problems).toEqual([]);
  });

  it('chaque depart à pied a un arrive ou un changement de plan ultérieur pour le même habitant', () => {
    const R = runDay(NORMAL_SEED);
    for (const dep of R.events.filter((e) => e.type === 'depart')) {
      const after = R.events.some((e: SimEvent) => e.t >= dep.t && e.actors[0] === dep.actors[0] && (e.type === 'arrive' || e.type === 'depart' || e.type === 'sleep'));
      expect(after || dep.t >= 1400, `${dep.id}`).toBe(true);
    }
  });

  it('le data.travelMinutes d’un arrive correspond à la durée depuis le depart', () => {
    const R = runDay(NORMAL_SEED);
    let checked = 0;
    for (const arr of R.events.filter((e) => e.type === 'arrive' && typeof e.data?.travelMinutes === 'number')) {
      const dep = arr.causes.map((c) => R.eventById(c)).find((e) => e?.type === 'depart');
      if (!dep) continue;
      checked++;
      expect(arr.data!.travelMinutes).toBe(arr.t - dep.t);
    }
    expect(checked).toBeGreaterThan(50);
  });
});
