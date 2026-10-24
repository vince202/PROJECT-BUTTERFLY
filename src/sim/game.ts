/**
 * The time-loop game: the player follows one inhabitant and tries to make
 * their daily arc succeed. Reality A is the day as it repeats; each loop the
 * player spends a few « gestures » (interventions) to bend reality B, watching
 * it unfold forward only. Midnight (or the inhabitant's end) closes the loop:
 * the outcome is recorded, the gestures go into a notebook that survives the
 * loop, and the day starts again.
 *
 * Pure data and helpers; the store applies them and the interface shows them.
 */

import { arcOf, arcSeed, effectiveStakes } from './drama';
import { agree, profileOf } from './population';
import type { Reality } from './reality';
import { fmtTime } from './time';
import type { AgentId, ArcSeed, ArcStatus, Intervention, Minute } from './types';
import { DAY_END, DAY_START } from './types';
import { questStatus } from './quest';

export type QuestOutcome = Exclude<ArcStatus, 'open' | 'advancing'> | 'unfinished';

export interface Gesture {
  /** Stable key: kind + target + time bucket, to recognise a gesture tried before. */
  key: string;
  intervention: Intervention;
  /** Loop in which the gesture was first used. */
  firstLoop: number;
  /** Loops in which it was used. */
  loops: number[];
  /** Outcomes of the loops it was part of. */
  outcomes: QuestOutcome[];
}

export interface LoopRecord {
  loop: number;
  interventions: Intervention[];
  outcome: QuestOutcome;
  /** Minute at which the loop ended (midnight, or earlier). */
  endedAt: Minute;
  /** Progress of the arc when the loop ended. */
  progress: number;
  /** Title of the resolution event, when any. */
  resolution?: string;
  /** Other inhabitants whose destiny changed in that loop (French lines). */
  destinies: string[];
}

export interface GameState {
  seed: number;
  agentId: AgentId;
  loop: number;
  /** Gestures allowed per loop. */
  budget: number;
  /** All gestures ever tried with this inhabitant (notebook). */
  notebook: Gesture[];
  loops: LoopRecord[];
  /** 'playing' while the day runs; 'ended' after midnight until the next loop; 'won' when the arc was fulfilled. */
  phase: 'playing' | 'ended' | 'won';
  startedAt: string;
}

export interface QuestCard {
  agentId: AgentId;
  name: string;
  firstName: string;
  occupation: string;
  color: string;
  title: string;
  desire: string;
  tension: string;
  deadline: Minute;
  kind: ArcSeed['kind'];
  /** 1 (tutoriel) .. 5 (très difficile). */
  difficulty: number;
  difficultyLabel: string;
  budget: number;
  /** Whether the arc already succeeds in reality A (then the quest is trivial, flagged). */
  trivialInA: boolean;
}

export const DIFFICULTY_LABELS: Record<number, string> = { 1: 'Entraînement', 2: 'Facile', 3: 'Moyen', 4: 'Difficile', 5: 'Très difficile' };

/** Difficulty from the goal type and the stakes; tuned so that Léa's « À l’heure au lycée » is the tutorial. */
export function questDifficulty(seed: ArcSeed): number {
  const g = seed.goal;
  let d = 2;
  switch (g.type) {
    case 'on_time':
    case 'keep_wallet':
      d = 1;
      break;
    case 'commitment':
    case 'be_at':
    case 'sell_out':
    case 'money_floor':
      d = 2;
      break;
    case 'conversations':
      d = 3;
      break;
    case 'talk_to':
      d = g.deep ? 4 : 3;
      break;
    case 'avoid':
      d = 3;
      break;
    case 'bus_on_time':
      d = 4;
      break;
  }
  if (seed.stakes >= 0.7) d += 1;
  return Math.max(1, Math.min(5, d));
}

export function questBudget(difficulty: number): number {
  return difficulty <= 1 ? 2 : difficulty <= 3 ? 3 : 4;
}

/** The quests on offer for a reality A (one per inhabitant). */
export function questCards(A: Reality): QuestCard[] {
  const cards: QuestCard[] = [];
  for (const arc of Object.values(A.engine.state.arcs ?? {})) {
    const seed = arcSeed(arc.seedId);
    const p = profileOf(arc.agentId);
    const difficulty = questDifficulty(seed);
    cards.push({
      agentId: arc.agentId,
      name: p.name,
      firstName: p.firstName,
      occupation: p.occupation,
      color: p.color,
      title: seed.title,
      desire: seed.desire,
      tension: seed.tension,
      deadline: seed.deadline ?? DAY_END - 1,
      kind: seed.kind,
      difficulty,
      difficultyLabel: DIFFICULTY_LABELS[difficulty],
      budget: questBudget(difficulty),
      trivialInA: arc.status === 'fulfilled',
    });
  }
  return cards.sort((x, y) => x.difficulty - y.difficulty || x.firstName.localeCompare(y.firstName));
}

export function gestureKey(iv: Intervention): string {
  const who = 'agentId' in iv ? iv.agentId : 'agentA' in iv ? `${iv.agentA}+${iv.agentB}` : 'busId' in iv ? iv.busId : 'locationId' in iv ? iv.locationId : '';
  const what = iv.kind === 'force_action' ? `${iv.action}:${iv.locationId ?? ''}` : iv.kind === 'bus_delay' || iv.kind === 'agent_delay' ? `${iv.minutes}` : iv.kind === 'weather' ? iv.condition : '';
  return `${iv.kind}|${who}|${what}|${Math.round(iv.t / 15)}`;
}

export function newGame(A: Reality, agentId: AgentId): GameState {
  const card = questCards(A).find((c) => c.agentId === agentId);
  if (!card) throw new Error(`Aucune quête pour ${agentId}`);
  return { seed: A.seed, agentId, loop: 1, budget: card.budget, notebook: [], loops: [], phase: 'playing', startedAt: new Date().toISOString() };
}

/** Can this gesture be applied now? (budget, time not in the past, not a duplicate of the loop). */
export function canApplyGesture(game: GameState, current: Intervention[], iv: Intervention, now: Minute): { ok: boolean; reason?: string } {
  if (game.phase !== 'playing') return { ok: false, reason: 'La journée est terminée : relancez la boucle.' };
  if (current.length >= game.budget) return { ok: false, reason: `Budget de gestes épuisé (${game.budget} par boucle).` };
  if (iv.t < Math.floor(now) - 1) return { ok: false, reason: `Impossible de revenir en arrière : il est ${fmtTime(Math.floor(now))}.` };
  if (iv.t >= DAY_END) return { ok: false, reason: 'Trop tard : la journée se termine à minuit.' };
  if (current.some((c) => gestureKey(c) === gestureKey(iv))) return { ok: false, reason: 'Ce geste est déjà en place dans cette boucle.' };
  return { ok: true };
}

/** Outcome of the followed inhabitant's arc in a reality. */
export function loopOutcome(reality: Reality, agentId: AgentId): QuestOutcome {
  const s = questStatus(reality, agentId);
  return s.status === 'open' || s.status === 'advancing' ? 'unfinished' : s.status;
}

/** Close the loop: record it, update the notebook, decide the phase. */
export function closeLoop(game: GameState, played: Reality, destinies: string[], endedAt: Minute = DAY_END): GameState {
  const outcome = loopOutcome(played, game.agentId);
  const arc = arcOf(played.engine.state, game.agentId);
  const resolution = arc?.resolutionEventId ? played.eventById(arc.resolutionEventId)?.label : undefined;
  const record: LoopRecord = { loop: game.loop, interventions: played.def.interventions, outcome, endedAt, progress: arc?.progress ?? 0, resolution, destinies };
  const notebook = game.notebook.map((g) => ({ ...g, loops: [...g.loops], outcomes: [...g.outcomes] }));
  for (const iv of played.def.interventions) {
    const key = gestureKey(iv);
    const hit = notebook.find((g) => g.key === key);
    if (hit) {
      if (!hit.loops.includes(game.loop)) {
        hit.loops.push(game.loop);
        hit.outcomes.push(outcome);
      }
    } else notebook.push({ key, intervention: iv, firstLoop: game.loop, loops: [game.loop], outcomes: [outcome] });
  }
  return { ...game, notebook, loops: [...game.loops, record], phase: outcome === 'fulfilled' ? 'won' : 'ended' };
}

/** Start the next loop (same inhabitant, same day). */
export function nextLoop(game: GameState): GameState {
  if (game.phase === 'playing') return game;
  // A won quest can be replayed for a cleaner run, but the budget never shrinks.
  return { ...game, loop: game.loop + 1, phase: 'playing' };
}

/** Human-readable one-line summary of a gesture (its description, with the time). */
export function gestureLabel(g: Gesture): string {
  return `${fmtTime(g.intervention.t)} — ${g.intervention.description}`;
}

/** Score-like summary for the end-of-loop screen. */
export function loopSummary(game: GameState, played: Reality): { title: string; lines: string[] } {
  const p = profileOf(game.agentId);
  const arc = arcOf(played.engine.state, game.agentId);
  const seed = arc ? arcSeed(arc.seedId) : undefined;
  const outcome = loopOutcome(played, game.agentId);
  const lines: string[] = [];
  if (seed && arc) {
    lines.push(`Objectif : ${seed.title} (enjeu ${Math.round(effectiveStakes(arc) * 100)} %).`);
    const res = arc.resolutionEventId ? played.eventById(arc.resolutionEventId) : undefined;
    if (res) lines.push(`${fmtTime(res.t)} — ${res.label}.`);
    else lines.push(`À minuit, l’histoire restait en suspens (${Math.round(arc.progress * 100)} %).`);
  }
  lines.push(`Gestes utilisés : ${played.def.interventions.length} / ${game.budget}.`);
  const title = outcome === 'fulfilled' ? `${p.firstName} y est ${agree(p.id, 'arrivé')} — boucle ${game.loop}` : outcome === 'twisted' ? `Coup de théâtre pour ${p.firstName} — boucle ${game.loop}` : `${p.firstName} n’y est pas ${agree(p.id, 'arrivé')} — boucle ${game.loop}`;
  return { title, lines };
}

export const LOOP_START: Minute = DAY_START;
