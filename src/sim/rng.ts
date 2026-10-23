/**
 * Stateless, hash-based random streams.
 *
 * Instead of a single sequential generator whose consumption order would make
 * two realities diverge for purely technical reasons, every random decision is
 * drawn from a key such as `encounter:alice:hugo:08:12`. The same key with the
 * same seed always yields the same value, in any reality — so a bus delay never
 * changes the "luck" of an unrelated inhabitant unless the situation itself
 * changed (different place, different time, different partner).
 */

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mix(a: number, b: number): number {
  // splitmix32 finaliser over the combined seeds
  let z = (a ^ Math.imul(b, 0x9e3779b9)) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return (z ^ (z >>> 16)) >>> 0;
}

/** Uniform value in [0, 1) for the given seed and stream key. */
export function hashRandom(seed: number, key: string): number {
  const h = mix(fnv1a(key), seed >>> 0);
  return h / 4294967296;
}

/** Helper bound to a seed. */
export class Rng {
  constructor(public readonly seed: number) {}

  /** Uniform [0, 1). */
  next(key: string): number {
    return hashRandom(this.seed, key);
  }

  /** Bernoulli trial. */
  chance(key: string, p: number): boolean {
    return hashRandom(this.seed, key) < p;
  }

  /** Integer in [min, max]. */
  int(key: string, min: number, max: number): number {
    return min + Math.floor(hashRandom(this.seed, key) * (max - min + 1));
  }

  /** Uniform in [min, max). */
  range(key: string, min: number, max: number): number {
    return min + hashRandom(this.seed, key) * (max - min);
  }

  /** Pick an element. */
  pick<T>(key: string, items: readonly T[]): T {
    return items[Math.floor(hashRandom(this.seed, key) * items.length)];
  }
}

/** Parse a seed from a string (numbers pass through, words are hashed). */
export function seedFromString(s: string): number {
  const n = Number(s);
  if (Number.isFinite(n) && s.trim() !== '') return Math.floor(n) >>> 0;
  return fnv1a(s);
}
