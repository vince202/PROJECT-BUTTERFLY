/**
 * Quest view of a day: the player follows one inhabitant and tries to make
 * their arc succeed. This module answers « what matters for my quest? » from
 * the recorded events: alerts filtered by gravity and tagged by their link to
 * the followed inhabitant, their arc target, their goal place or their arc.
 * Pure functions over the event log and the world state.
 */

import { arcOf, arcSeed } from './drama';
import { labelTable } from './population';
import type { Reality } from './reality';
import type { AgentId, ArcSeed, Gravity, LocationId, SimEvent, WorldState } from './types';

export type QuestLink = 'self' | 'target' | 'place' | 'arc' | 'none';

/** French source of the quest link labels (the catalogue's data part is generated from it). */
export const QUEST_LINK_LABELS_FR: Record<QuestLink, string> = {
  self: 'votre personnage',
  target: 'la personne visée',
  place: 'le lieu de votre objectif',
  arc: 'votre histoire',
  none: '',
};

/** Read through `story.quest_link.<link>` at access time. */
export const QUEST_LINK_LABELS: Record<QuestLink, string> = labelTable('quest_link', QUEST_LINK_LABELS_FR);

export interface QuestAlert {
  event: SimEvent;
  link: QuestLink;
  gravity: Gravity;
}

/** People and places the arc of `agentId` depends on. */
export function questFocus(world: WorldState, agentId: AgentId): { targets: AgentId[]; places: LocationId[]; commitmentIds: string[]; seed?: ArcSeed; arcId?: string } {
  const arc = arcOf(world, agentId);
  if (!arc) return { targets: [], places: [], commitmentIds: [] };
  const seed = arcSeed(arc.seedId);
  const g = seed.goal;
  const targets: AgentId[] = [];
  const places: LocationId[] = [];
  const commitmentIds: string[] = [];
  if ('target' in g) targets.push(g.target);
  if (g.type === 'be_at') {
    places.push(g.locationId);
    if (g.withAgent) targets.push(g.withAgent);
  }
  if (g.type === 'sell_out') places.push(g.locationId);
  if (g.type === 'commitment' || g.type === 'on_time') {
    commitmentIds.push(g.commitmentId);
    const c = world.agents[agentId]?.commitments.find((x) => x.id === g.commitmentId);
    if (c) {
      places.push(c.locationId);
      targets.push(...c.with);
    }
  }
  if (seed.secretAbout) targets.push(seed.secretAbout);
  return { targets: [...new Set(targets)], places: [...new Set(places)], commitmentIds, seed, arcId: arc.id };
}

/** How an event relates to the quest of `agentId` (strongest link first). */
export function questLink(event: SimEvent, agentId: AgentId, focus: ReturnType<typeof questFocus>): QuestLink {
  if (event.actors.includes(agentId)) return 'self';
  if (focus.arcId && event.data?.arcId === focus.arcId) return 'arc';
  if (focus.commitmentIds.length && typeof event.data?.commitmentId === 'string' && focus.commitmentIds.includes(event.data.commitmentId)) return 'arc';
  if (event.actors.some((a) => focus.targets.includes(a))) return 'target';
  if (event.locationId && focus.places.includes(event.locationId)) return 'place';
  return 'none';
}

/**
 * Alerts for the player: events of gravity ≥ minGravity, tagged by their link
 * to the quest. Unlinked events need a higher gravity to be shown.
 */
export function questAlerts(reality: Reality, agentId: AgentId, opts: { minGravity?: Gravity; minUnlinkedGravity?: Gravity; upTo?: number } = {}): QuestAlert[] {
  const minG = opts.minGravity ?? 1;
  const minU = opts.minUnlinkedGravity ?? 2;
  const focus = questFocus(reality.engine.state, agentId);
  const out: QuestAlert[] = [];
  for (const e of reality.events) {
    if (opts.upTo !== undefined && e.t > opts.upTo) continue;
    if (e.gravity < minG) continue;
    const link = questLink(e, agentId, focus);
    if (link === 'none' && e.gravity < minU) continue;
    out.push({ event: e, link, gravity: e.gravity });
  }
  return out;
}

/** Outcome of the quest at the end (or current state) of a reality. */
export function questStatus(reality: Reality, agentId: AgentId): { status: 'open' | 'advancing' | 'fulfilled' | 'failed' | 'twisted'; progress: number; title: string; resolvedAt?: number } {
  const arc = arcOf(reality.engine.state, agentId);
  if (!arc) return { status: 'open', progress: 0, title: '' };
  return { status: arc.status, progress: arc.progress, title: arcSeed(arc.seedId).title, resolvedAt: arc.resolvedAt };
}
