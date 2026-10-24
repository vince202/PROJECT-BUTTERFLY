import type { Namespace } from '../index';

/** Shared words. Keep ids in English snake_case; keep French texts exactly as the app shows them today. */
export const common: Namespace = {
  app_name: 'BUTTERFLY',
  tagline: 'Twenty Lives. One Day. Infinite Possibilities.',
  reality_a: 'Réalité A — originale',
  reality_b: 'Réalité B — modifiée',
  reality_b_loop: 'Réalité B — votre boucle',
  day_n: ({ n }) => `Jour ${n}`,
  minutes: ({ n }) => `${n} min`,
  at_time: ({ time }) => `à ${time}`,
};
