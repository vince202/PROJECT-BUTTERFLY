import type { Namespace } from '../index';

export const common: Namespace = {
  app_name: 'BUTTERFLY',
  tagline: 'Twenty Lives. One Day. Infinite Possibilities.',
  reality_a: 'Reality A — original',
  reality_b: 'Reality B — modified',
  reality_b_loop: 'Reality B — your loop',
  day_n: ({ n }) => `Day ${n}`,
  minutes: ({ n }) => `${n} min`,
  at_time: ({ time }) => `at ${time}`,
};
