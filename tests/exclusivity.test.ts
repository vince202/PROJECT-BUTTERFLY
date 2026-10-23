import { describe, expect, it } from 'vitest';
import { Engine } from '../src/sim/engine';
import { getCity } from '../src/sim/city';
import { AGENTS, BUS_DRIVERS } from '../src/sim/population';
import type { WorldState } from '../src/sim/types';

const city = getCity();
const line = city.lines[0];

/** Run a whole day, calling `check` on the state before each step and at the end. */
function walkDay(seed: number, check: (s: WorldState) => void): Engine {
  const e = new Engine(seed);
  while (!e.done) {
    check(e.state);
    e.step();
  }
  check(e.state);
  return e;
}

describe.each([42, 29, 7])('Exclusivité des états (graine %i)', (seed) => {
  it('jamais travel ET activity non nuls en même temps (sauf chauffeur de bus)', () => {
    const bad: string[] = [];
    walkDay(seed, (s) => {
      for (const a of Object.values(s.agents)) {
        if (a.travel && a.activity && a.activity.action !== 'drive_bus') bad.push(`${a.id}@${s.t}: travel=${a.travel.stage} activity=${a.activity.action}`);
      }
    });
    expect(bad).toEqual([]);
  });

  it('un habitant en déplacement n’a pas de lieu et n’est jamais endormi', () => {
    const bad: string[] = [];
    walkDay(seed, (s) => {
      for (const a of Object.values(s.agents)) {
        if (a.travel && a.asleep) bad.push(`${a.id}@${s.t}: endormi en déplacement`);
        if (a.travel && a.travel.stage === 'walking' && a.locationId !== null) bad.push(`${a.id}@${s.t}: marche mais locationId=${a.locationId}`);
        if (a.travel && a.travel.stage === 'riding' && a.locationId !== null) bad.push(`${a.id}@${s.t}: dans le bus mais locationId=${a.locationId}`);
      }
    });
    expect(bad).toEqual([]);
  });

  it('un habitant endormi n’a ni déplacement ni activité autre que dormir', () => {
    const bad: string[] = [];
    walkDay(seed, (s) => {
      for (const a of Object.values(s.agents)) {
        if (!a.asleep) continue;
        if (a.travel) bad.push(`${a.id}@${s.t}: endormi mais voyage`);
        if (a.activity && a.activity.action !== 'sleep') bad.push(`${a.id}@${s.t}: endormi mais activité ${a.activity.action}`);
      }
    });
    expect(bad).toEqual([]);
  });

  it('un habitant a un lieu OU voyage (jamais les deux, jamais aucun sauf en transit)', () => {
    const bad: string[] = [];
    walkDay(seed, (s) => {
      for (const a of Object.values(s.agents)) {
        if (a.locationId === null && !a.travel) bad.push(`${a.id}@${s.t}: ni lieu ni déplacement`);
        if (a.locationId !== null && a.travel && a.travel.stage !== 'waiting' && a.travel.stage !== 'to_stop') bad.push(`${a.id}@${s.t}: lieu ${a.locationId} et déplacement ${a.travel.stage}`);
        if (a.locationId !== null && !city.locations.has(a.locationId)) bad.push(`${a.id}@${s.t}: lieu inconnu ${a.locationId}`);
      }
    });
    expect(bad).toEqual([]);
  });

  it('les passagers d’un bus ne dépassent jamais la capacité de la ligne', () => {
    let maxSeen = 0;
    walkDay(seed, (s) => {
      for (const b of Object.values(s.buses)) {
        maxSeen = Math.max(maxSeen, b.passengers.length);
        expect(b.passengers.length, `${b.id}@${s.t}`).toBeLessThanOrEqual(line.capacity);
      }
    });
    expect(maxSeen).toBeGreaterThanOrEqual(1); // le test voit au moins un passager
  });

  it('aucun habitant n’est dans deux bus à la fois ni deux fois dans le même bus', () => {
    const bad: string[] = [];
    walkDay(seed, (s) => {
      const seen = new Map<string, string>();
      for (const b of Object.values(s.buses)) {
        for (const id of b.passengers) {
          if (seen.has(id)) bad.push(`${id}@${s.t}: dans ${seen.get(id)} et ${b.id}`);
          seen.set(id, b.id);
        }
      }
    });
    expect(bad).toEqual([]);
  });

  it('un passager est bien en état « riding » dans ce bus', () => {
    const bad: string[] = [];
    walkDay(seed, (s) => {
      for (const b of Object.values(s.buses)) {
        for (const id of b.passengers) {
          const a = s.agents[id];
          if (!a.travel || a.travel.stage !== 'riding' || a.travel.busId !== b.id) bad.push(`${id}@${s.t}: passager de ${b.id} mais travel=${JSON.stringify(a.travel && { stage: a.travel.stage, busId: a.travel.busId })}`);
        }
      }
    });
    expect(bad).toEqual([]);
  });

  it('un lieu n’accueille jamais plus de visiteurs que sa capacité (à chaque minute)', () => {
    const bad: string[] = [];
    walkDay(seed, (s) => {
      const count = new Map<string, number>();
      for (const a of Object.values(s.agents)) if (a.locationId) count.set(a.locationId, (count.get(a.locationId) ?? 0) + 1);
      for (const [loc, n] of count) {
        const cap = city.location(loc).capacity;
        if (cap !== undefined && n > cap) bad.push(`${loc}@${s.t}: ${n} > ${cap}`);
      }
    });
    expect(bad).toEqual([]);
  });

  it('au plus un chauffeur par bus, et seul un chauffeur a l’activité drive_bus', () => {
    const drivers = new Set(BUS_DRIVERS.map((d) => d.agentId));
    walkDay(seed, (s) => {
      for (const a of Object.values(s.agents)) {
        if (a.activity?.action === 'drive_bus') expect(drivers.has(a.id), `${a.id}@${s.t}`).toBe(true);
      }
      for (const b of Object.values(s.buses)) {
        if (b.driverId) expect(s.agents[b.driverId]).toBeDefined();
      }
    });
  });
});

describe('Cohérence générale de l’état', () => {
  it('les 20 habitants existent à chaque minute avec des besoins et émotions bornés', () => {
    walkDay(42, (s) => {
      expect(Object.keys(s.agents)).toHaveLength(20);
      if (s.t % 30 !== 0) return;
      for (const a of AGENTS) {
        const st = s.agents[a.id];
        for (const v of Object.values(st.needs)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
        }
        expect(st.emotions.mood).toBeGreaterThanOrEqual(-1);
        expect(st.emotions.mood).toBeLessThanOrEqual(1);
        expect(st.emotions.stress).toBeGreaterThanOrEqual(0);
        expect(st.emotions.stress).toBeLessThanOrEqual(1);
        expect(Number.isFinite(st.pos.x) && Number.isFinite(st.pos.y)).toBe(true);
      }
    });
  });
});
