import { describe, expect, it } from 'vitest';
import { Engine } from '../src/sim/engine';
import { Reality, SNAPSHOT_INTERVAL, frameOf } from '../src/sim/reality';
import type { Intervention } from '../src/sim/types';
import { NORMAL_SEED, canonJson, canonState, freshDay, fork, runDay } from './helpers';

function stepped(seed: number, t: number, interventions: Intervention[] = []): Engine {
  const e = new Engine(seed, interventions);
  while (e.state.t < t) e.step();
  return e;
}

describe('stateAt : relecture déterministe', () => {
  const R = runDay(NORMAL_SEED);

  it.each([360, 361, 400, 487, 495, 733, 1100, 1439])('stateAt(%i) égale l’état d’un moteur neuf avancé jusque-là', (t) => {
    const s = R.stateAt(t);
    expect(s.t).toBe(t);
    expect(canonState(s)).toBe(canonState(stepped(NORMAL_SEED, t).state));
  });

  it('stateAt à un instant exactement sur un snapshot (multiple de 15) est cohérent', () => {
    for (const t of [375, 600, 900, 1050]) {
      expect(t % SNAPSHOT_INTERVAL).toBe(0);
      expect(canonState(R.stateAt(t))).toBe(canonState(R.snapshots.get(t)!));
      expect(canonState(R.stateAt(t))).toBe(canonState(stepped(NORMAL_SEED, t).state));
    }
  });

  it('stateAt(1440) vaut l’état final du moteur ; hors bornes il est borné à [360, 1440]', () => {
    expect(R.stateAt(1440).t).toBe(1440);
    expect(R.stateAt(5000).t).toBe(1440);
    expect(R.stateAt(0).t).toBe(360);
    expect(R.stateAt(487.9).t).toBe(487);
  });

  it('la relecture est fidèle aussi avec des interventions', () => {
    const iv: Intervention = { id: 'rp1', kind: 'force_action', agentId: 'martin', t: 420, action: 'coffee', locationId: 'cafe', description: 'café' };
    const B = fork(R, iv);
    for (const t of [419, 421, 430, 600, 1000]) {
      expect(canonState(B.stateAt(t)), `t=${t}`).toBe(canonState(stepped(NORMAL_SEED, t, [iv]).state));
    }
  });

  it('stateAt ne modifie pas la réalité : deux appels donnent le même résultat, l’état final reste à 1440', () => {
    const fresh = freshDay(NORMAL_SEED);
    const eventsBefore = JSON.stringify(fresh.events);
    const finalBefore = canonState(fresh.engine.state);
    const snapshotKeys = [...fresh.snapshots.keys()];
    const first = canonState(fresh.stateAt(733));
    const second = canonState(fresh.stateAt(733));
    expect(second).toBe(first);
    fresh.stateAt(400);
    fresh.stateAt(1100);
    expect(fresh.engine.state.t).toBe(1440);
    expect(fresh.engine.done).toBe(true);
    expect(canonState(fresh.engine.state)).toBe(finalBefore);
    expect(JSON.stringify(fresh.events)).toBe(eventsBefore);
    expect([...fresh.snapshots.keys()]).toEqual(snapshotKeys);
  });

  it('modifier l’état retourné ne corrompt pas les snapshots ni les appels suivants', () => {
    const fresh = freshDay(NORMAL_SEED);
    const s = fresh.stateAt(733);
    const reference = canonState(fresh.stateAt(733));
    s.agents.alice.money = 99999;
    s.agents.alice.pos.x = -1;
    s.weather = 'rain';
    expect(canonState(fresh.stateAt(733))).toBe(reference);
    expect(canonState(fresh.snapshots.get(720)!)).toBe(canonState(stepped(NORMAL_SEED, 720).state));
  });

  it('stateAt n’écrase pas les événements du moteur principal (le journal complet est conservé)', () => {
    const fresh = freshDay(NORMAL_SEED);
    const n = fresh.events.length;
    fresh.stateAt(500);
    fresh.stateAt(1300);
    expect(fresh.events).toHaveLength(n);
    expect(fresh.events.length).toBe(R.events.length);
  });

  it('une Reality partiellement générée relit uniquement le passé généré', () => {
    const partial = new Reality({ id: 'P', name: 'P', seed: NORMAL_SEED, interventions: [] });
    partial.advanceTo(600);
    expect(partial.generatedUntil).toBe(600);
    expect(partial.stateAt(5000).t).toBe(600);
    expect(canonState(partial.stateAt(500))).toBe(canonState(stepped(NORMAL_SEED, 500).state));
  });
});

describe('Snapshots et frames', () => {
  const R = runDay(NORMAL_SEED);

  it('il y a environ 73 snapshots, un tous les 15 minutes de 360 à 1440', () => {
    expect(R.snapshots.size).toBe(73);
    const keys = [...R.snapshots.keys()].sort((a, b) => a - b);
    expect(keys[0]).toBe(360);
    expect(keys.at(-1)).toBe(1440);
    for (let i = 1; i < keys.length; i++) expect(keys[i] - keys[i - 1]).toBe(SNAPSHOT_INTERVAL);
  });

  it('chaque snapshot a le temps de sa clé', () => {
    for (const [k, s] of R.snapshots) expect(s.t).toBe(k);
  });

  it('frameAt renvoie des frames avec 20 habitants et 2 bus', () => {
    for (const t of [360, 400, 500, 900, 1439, 1440]) {
      const f = R.frameAt(t)!;
      expect(f).toBeDefined();
      expect(Object.keys(f.agents)).toHaveLength(20);
      expect(Object.keys(f.buses).sort()).toEqual(['L1-1', 'L1-2']);
      expect(f.t).toBe(t);
    }
  });

  it('frameAt borne les temps hors journée', () => {
    expect(R.frameAt(0)!.t).toBe(360);
    expect(R.frameAt(99999)!.t).toBe(1440);
  });

  it('la frame d’une minute correspond au frameOf(stateAt(minute))', () => {
    for (const t of [361, 500, 733, 1100]) {
      expect(JSON.stringify(R.frameAt(t))).toBe(JSON.stringify(frameOf(R.stateAt(t))));
    }
  });

  it('les frames ont des valeurs finies et un champ asleep/riding booléen', () => {
    for (const f of R.trace.filter((_, i) => i % 30 === 0)) {
      for (const a of Object.values(f.agents)) {
        expect(Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.mood)).toBe(true);
        expect(typeof a.asleep).toBe('boolean');
        expect(typeof a.riding).toBe('boolean');
      }
    }
  });

  it('eventById / eventsBetween / eventsOf sont cohérents avec le journal', () => {
    const e = R.events[100];
    expect(R.eventById(e.id)).toBe(e);
    expect(R.eventById('inconnu')).toBeUndefined();
    const between = R.eventsBetween(500, 520);
    expect(between.length).toBeGreaterThan(0);
    for (const x of between) {
      expect(x.t).toBeGreaterThanOrEqual(500);
      expect(x.t).toBeLessThanOrEqual(520);
    }
    for (const x of R.eventsOf('alice')) expect(x.actors).toContain('alice');
  });

  it('markers() ne renvoie que des événements importants et jamais de decision', () => {
    const m = R.markers(0.5);
    expect(m.length).toBeGreaterThan(5);
    for (const e of m) {
      expect(e.importance).toBeGreaterThanOrEqual(0.5);
      expect(e.type).not.toBe('decision');
    }
    expect(R.markers(0.9).length).toBeLessThanOrEqual(m.length);
  });

  it('canonJson arrondit à 6 décimales (helper)', () => {
    expect(canonJson({ b: 1.00000049, a: [0.1 + 0.2] })).toBe('{"a":[0.3],"b":1}');
  });
});
