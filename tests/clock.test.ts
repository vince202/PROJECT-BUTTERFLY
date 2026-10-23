import { describe, expect, it } from 'vitest';
import { Engine } from '../src/sim/engine';
import { fmtTime, parseTime } from '../src/sim/time';
import { DAY_END, DAY_LENGTH, DAY_START } from '../src/sim/types';

describe('Horloge du moteur', () => {
  it('les constantes de la journée sont 06:00 → 24:00', () => {
    expect(DAY_START).toBe(360);
    expect(DAY_END).toBe(1440);
    expect(DAY_LENGTH).toBe(1080);
  });

  it('démarre à 360 et n’est pas terminé', () => {
    const e = new Engine(42);
    expect(e.state.t).toBe(360);
    expect(e.done).toBe(false);
    expect(e.events).toHaveLength(0);
  });

  it('chaque step() avance d’exactement une minute', () => {
    const e = new Engine(42);
    for (let i = 0; i < 1080; i++) {
      const before = e.state.t;
      e.step();
      expect(e.state.t).toBe(before + 1);
    }
  });

  it('se termine à 1440 après 1080 steps et done devient vrai', () => {
    const e = new Engine(42);
    let steps = 0;
    while (!e.done) {
      e.step();
      steps++;
      expect(steps).toBeLessThanOrEqual(1080);
    }
    expect(steps).toBe(1080);
    expect(e.state.t).toBe(1440);
    expect(e.done).toBe(true);
  });

  it('step() après la fin ne change rien', () => {
    const e = new Engine(42);
    e.runToEnd();
    const n = e.events.length;
    expect(e.step()).toEqual([]);
    expect(e.state.t).toBe(1440);
    expect(e.events).toHaveLength(n);
  });

  it('les événements sont en ordre chronologique et dans [360, 1439]', () => {
    for (const seed of [42, 29]) {
      const e = new Engine(seed);
      e.runToEnd();
      let prev = -Infinity;
      for (const ev of e.events) {
        expect(ev.t).toBeGreaterThanOrEqual(DAY_START);
        expect(ev.t).toBeLessThanOrEqual(DAY_END - 1);
        expect(Number.isInteger(ev.t)).toBe(true);
        expect(ev.t).toBeGreaterThanOrEqual(prev);
        prev = ev.t;
      }
    }
  });

  it('commence par day_start à 06:00 et finit par day_end à 23:59', () => {
    const e = new Engine(42);
    e.runToEnd();
    expect(e.events[0].type).toBe('day_start');
    expect(e.events[0].t).toBe(360);
    expect(e.events.at(-1)!.type).toBe('day_end');
    expect(e.events.at(-1)!.t).toBe(1439);
  });

  it('les identifiants d’événements sont uniques', () => {
    const e = new Engine(42);
    e.runToEnd();
    expect(new Set(e.events.map((x) => x.id)).size).toBe(e.events.length);
  });

  it('step() retourne uniquement les événements émis pendant cette minute', () => {
    const e = new Engine(42);
    const out = e.step();
    expect(out.every((x) => x.t === 360)).toBe(true);
    expect(out.map((x) => x.id)).toEqual(e.events.map((x) => x.id));
  });
});

describe('fmtTime / parseTime', () => {
  it('formate en HH:MM', () => {
    expect(fmtTime(360)).toBe('06:00');
    expect(fmtTime(500)).toBe('08:20');
    expect(fmtTime(1439)).toBe('23:59');
    expect(fmtTime(1440)).toBe('24:00');
    expect(fmtTime(0)).toBe('00:00');
  });

  it('fait un aller-retour fmtTime → parseTime sur toute la journée', () => {
    for (let t = DAY_START; t <= DAY_END; t++) {
      expect(parseTime(fmtTime(t))).toBe(t);
    }
  });

  it('parseTime accepte plusieurs écritures et rejette le reste', () => {
    expect(parseTime('8h12')).toBe(8 * 60 + 12);
    expect(parseTime('08:12')).toBe(8 * 60 + 12);
    expect(parseTime('14 h')).toBe(840);
    expect(parseTime('14h')).toBe(840);
    expect(parseTime('banane')).toBeNull();
    expect(parseTime('25h00')).toBeNull();
    expect(parseTime('10:75')).toBeNull();
    expect(parseTime('')).toBeNull();
  });

  it('fmtTime borne les valeurs hors journée', () => {
    expect(fmtTime(-10)).toBe('00:00');
    expect(fmtTime(5000)).toBe('24:00');
  });
});
