import { describe, expect, it } from 'vitest';
import { Rng, hashRandom, seedFromString } from '../src/sim/rng';

describe('hashRandom', () => {
  it('est déterministe pour un même (seed, clé)', () => {
    for (const seed of [0, 1, 42, 29, 123456789]) {
      for (const key of ['a', 'encounter:alice:hugo:08:12', 'weather:rain', '']) {
        expect(hashRandom(seed, key)).toBe(hashRandom(seed, key));
      }
    }
  });

  it('diffère selon la clé', () => {
    const values = new Set<number>();
    for (let i = 0; i < 200; i++) values.add(hashRandom(7, `key:${i}`));
    expect(values.size).toBe(200);
    expect(hashRandom(7, 'a')).not.toBe(hashRandom(7, 'b'));
  });

  it('diffère selon la graine', () => {
    const values = new Set<number>();
    for (let seed = 0; seed < 200; seed++) values.add(hashRandom(seed, 'same-key'));
    expect(values.size).toBe(200);
    expect(hashRandom(1, 'k')).not.toBe(hashRandom(2, 'k'));
  });

  it('renvoie des valeurs dans [0, 1)', () => {
    for (let i = 0; i < 5000; i++) {
      const v = hashRandom(i % 97, `k${i}`);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('est à peu près uniforme sur 10 000 tirages (moyenne ≈ 0,5 ± 0,03)', () => {
    let sum = 0;
    const N = 10_000;
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < N; i++) {
      const v = hashRandom(42, `draw:${i}`);
      sum += v;
      buckets[Math.floor(v * 10)]++;
    }
    expect(Math.abs(sum / N - 0.5)).toBeLessThan(0.03);
    // Chaque dixième contient environ 1000 tirages (tolérance large : ±30 %).
    for (const b of buckets) {
      expect(b).toBeGreaterThan(700);
      expect(b).toBeLessThan(1300);
    }
  });

  it('est uniforme aussi quand on varie la graine à clé fixe', () => {
    let sum = 0;
    const N = 10_000;
    for (let s = 0; s < N; s++) sum += hashRandom(s, 'fixed');
    expect(Math.abs(sum / N - 0.5)).toBeLessThan(0.03);
  });
});

describe('Rng', () => {
  it('délègue à hashRandom et reste sans état', () => {
    const r = new Rng(42);
    expect(r.next('x')).toBe(hashRandom(42, 'x'));
    expect(r.next('x')).toBe(r.next('x'));
  });

  it('int() reste dans [min, max] et couvre toutes les valeurs', () => {
    const r = new Rng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.int(`i${i}`, 2, 6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([2, 3, 4, 5, 6]);
  });

  it('range() reste dans [min, max)', () => {
    const r = new Rng(3);
    for (let i = 0; i < 1000; i++) {
      const v = r.range(`r${i}`, -5, 5);
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThan(5);
    }
  });

  it('chance() respecte les cas limites 0 et 1 et une probabilité intermédiaire', () => {
    const r = new Rng(9);
    let hits = 0;
    for (let i = 0; i < 5000; i++) {
      expect(r.chance(`c${i}`, 0)).toBe(false);
      expect(r.chance(`c${i}`, 1)).toBe(true);
      if (r.chance(`c${i}`, 0.3)) hits++;
    }
    expect(Math.abs(hits / 5000 - 0.3)).toBeLessThan(0.03);
  });

  it('pick() renvoie un élément de la liste', () => {
    const r = new Rng(1);
    const items = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 100; i++) expect(items).toContain(r.pick(`p${i}`, items));
  });
});

describe('seedFromString', () => {
  it('laisse passer les nombres et hache les mots de façon stable', () => {
    expect(seedFromString('42')).toBe(42);
    expect(seedFromString('butterfly')).toBe(seedFromString('butterfly'));
    expect(seedFromString('butterfly')).not.toBe(seedFromString('papillon'));
  });
});
