import { describe, expect, it } from 'vitest';
import { canApplyGesture, closeLoop, gestureKey, loopOutcome, loopSummary, newGame, nextLoop, questBudget, questCards, questDifficulty } from '../src/sim/game';
import { arcSeed } from '../src/sim/drama';
import { forkReality } from '../src/sim/reality';
import { busDelayFor } from '../src/sim/interventions';
import type { Intervention, SimEvent } from '../src/sim/types';
import { BUS_SEED, findBoardingArrival, runDay } from './helpers';

const A = runDay(BUS_SEED);

describe('Quêtes proposées', () => {
  it('une carte par habitant, triées par difficulté, Léa en entraînement', () => {
    const cards = questCards(A);
    expect(cards).toHaveLength(20);
    expect(new Set(cards.map((c) => c.agentId)).size).toBe(20);
    for (let i = 1; i < cards.length; i++) expect(cards[i - 1].difficulty).toBeLessThanOrEqual(cards[i].difficulty);
    const lea = cards.find((c) => c.agentId === 'lea')!;
    expect(lea.difficulty).toBe(1);
    expect(lea.difficultyLabel).toBe('Entraînement');
    expect(lea.budget).toBe(questBudget(1));
    for (const c of cards) {
      expect(c.difficulty).toBeGreaterThanOrEqual(1);
      expect(c.difficulty).toBeLessThanOrEqual(5);
      expect(c.title).toBeTruthy();
      expect(typeof c.trivialInA).toBe('boolean');
    }
  });

  it('la difficulté suit le type d’objectif et l’enjeu', () => {
    expect(questDifficulty(arcSeed('arc_lea_heure'))).toBe(1);
    expect(questDifficulty(arcSeed('arc_ines_hugo'))).toBe(5); // conversation profonde, enjeu 0,75
    expect(questDifficulty(arcSeed('arc_antoine_horaire'))).toBe(4);
  });
});

describe('Boucle de jeu', () => {
  const arrival = findBoardingArrival(A.events) as SimEvent;
  const delay = busDelayFor(arrival, 3);

  it('un geste ne peut ni dépasser le budget, ni remonter le temps, ni se répéter', () => {
    const game = newGame(A, 'lea');
    expect(game.loop).toBe(1);
    expect(game.budget).toBe(2);
    expect(canApplyGesture(game, [], delay, 400).ok).toBe(true);
    expect(canApplyGesture(game, [], delay, arrival.t + 30).ok).toBe(false);
    expect(canApplyGesture(game, [delay], delay, 400).ok).toBe(false);
    const other: Intervention = { id: 'x', kind: 'stay_home', agentId: 'alice', t: 400, until: 600, description: 'Alice reste chez elle' };
    expect(canApplyGesture(game, [delay, other], { ...other, id: 'y', t: 500 }, 400).ok).toBe(false);
    expect(canApplyGesture({ ...game, phase: 'ended' }, [], delay, 400).ok).toBe(false);
  });

  it('la clé d’un geste ignore l’identifiant mais garde le quart d’heure', () => {
    expect(gestureKey(delay)).toBe(gestureKey({ ...delay, id: 'autre' }));
    expect(gestureKey(delay)).not.toBe(gestureKey({ ...delay, t: delay.t + 60 }));
  });

  it('fermer la boucle enregistre l’issue, remplit le carnet et relance proprement', () => {
    const game = newGame(A, 'antoine');
    const B = forkReality(A, delay, 'B', 'B').generate();
    expect(loopOutcome(B, 'antoine')).toBe('failed');
    const closed = closeLoop(game, B, ['Antoine — « Tenir l’horaire » : accompli en A, échoué en B']);
    expect(closed.phase).toBe('ended');
    expect(closed.loops).toHaveLength(1);
    expect(closed.loops[0].outcome).toBe('failed');
    expect(closed.loops[0].destinies).toHaveLength(1);
    expect(closed.notebook).toHaveLength(1);
    expect(closed.notebook[0].key).toBe(gestureKey(delay));
    expect(closed.notebook[0].outcomes).toEqual(['failed']);
    expect(game.notebook).toHaveLength(0); // input not mutated
    const next = nextLoop(closed);
    expect(next.loop).toBe(2);
    expect(next.phase).toBe('playing');
    // Reusing the same gesture in loop 2 adds to the existing notebook entry.
    const again = closeLoop(next, B, []);
    expect(again.notebook).toHaveLength(1);
    expect(again.notebook[0].loops).toEqual([1, 2]);
  });

  it('une boucle sans geste reprend l’issue de la réalité A ; une réussite passe la partie en « won »', () => {
    const game = newGame(A, 'lea');
    const closed = closeLoop(game, A, []);
    expect(closed.loops[0].interventions).toHaveLength(0);
    expect(closed.phase).toBe(loopOutcome(A, 'lea') === 'fulfilled' ? 'won' : 'ended');
    const s = loopSummary(game, A);
    expect(s.title).toContain('Léa');
    expect(s.lines.some((l) => /Gestes utilisés/.test(l))).toBe(true);
  });
});
