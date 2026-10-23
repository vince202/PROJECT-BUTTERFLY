import { describe, expect, it } from 'vitest';
import { Engine } from '../src/sim/engine';
import { Reality } from '../src/sim/reality';
import { canonJson } from './helpers';

function runEngine(seed: number): Engine {
  const e = new Engine(seed);
  e.runToEnd();
  return e;
}

describe('Reproductibilité du moteur', () => {
  it('deux moteurs de même graine produisent exactement le même journal d’événements', () => {
    const a = runEngine(42);
    const b = runEngine(42);
    expect(a.events.length).toBeGreaterThan(1000);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });

  it('deux moteurs de même graine terminent dans le même état final', () => {
    const a = runEngine(7);
    const b = runEngine(7);
    expect(canonJson(a.state)).toBe(canonJson(b.state));
  });

  it('reste vrai pour plusieurs graines', () => {
    for (const seed of [1, 29, 1234]) {
      expect(JSON.stringify(runEngine(seed).events)).toBe(JSON.stringify(runEngine(seed).events));
    }
  });

  it('des graines différentes produisent des journaux différents', () => {
    const a = runEngine(42);
    const b = runEngine(43);
    expect(JSON.stringify(a.events)).not.toBe(JSON.stringify(b.events));
    const sigs = (e: Engine) => e.events.map((x) => `${x.t}|${x.signature}`).join('\n');
    expect(sigs(a)).not.toBe(sigs(b));
  });

  it('l’ordre de consommation aléatoire n’influe pas : un moteur « pas à pas » égale runToEnd()', () => {
    const a = new Engine(5);
    while (!a.done) a.step();
    const b = runEngine(5);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });

  it('les événements retournés par step() correspondent au journal', () => {
    const e = new Engine(11);
    const collected: unknown[] = [];
    while (!e.done) collected.push(...e.step());
    expect(JSON.stringify(collected)).toBe(JSON.stringify(e.events));
  });
});

describe('Reproductibilité des réalités', () => {
  const def = { id: 'A', name: 'A', seed: 42, interventions: [] };

  it('deux Realities de même graine ont les mêmes événements', () => {
    const a = new Reality(def).generate();
    const b = new Reality({ ...def, id: 'B', name: 'B' }).generate();
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });

  it('deux Realities de même graine ont la même trace (frames) et les mêmes snapshots', () => {
    const a = new Reality(def).generate();
    const b = new Reality(def).generate();
    expect(a.trace.length).toBe(b.trace.length);
    expect(JSON.stringify(a.trace)).toBe(JSON.stringify(b.trace));
    expect([...a.snapshots.keys()]).toEqual([...b.snapshots.keys()]);
    for (const k of a.snapshots.keys()) expect(canonJson(a.snapshots.get(k))).toBe(canonJson(b.snapshots.get(k)));
  });

  it('générer par étapes (advanceTo) donne le même résultat que generate()', () => {
    const a = new Reality(def);
    for (const t of [400, 600, 900, 1200, 1440]) a.advanceTo(t);
    const b = new Reality(def).generate();
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(JSON.stringify(a.trace)).toBe(JSON.stringify(b.trace));
  });

  it('des graines différentes donnent des traces différentes', () => {
    const a = new Reality(def).generate();
    const b = new Reality({ ...def, seed: 99 }).generate();
    expect(JSON.stringify(a.trace)).not.toBe(JSON.stringify(b.trace));
  });
});
