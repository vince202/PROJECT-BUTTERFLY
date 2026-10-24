/**
 * Pure helpers of the player mode: quick gesture templates relevant to the
 * followed inhabitant's quest, their builders (same structured interventions
 * and descriptions as the laboratory's structured form), outcome marks and the
 * forward-only alert cursor used by the bubbles and the feed.
 */

import { getCity, LOCATIONS } from '../../sim/city';
import { defaultLocationFor } from '../../sim/decision';
import type { QuestOutcome } from '../../sim/game';
import { busDelayFor, newInterventionId, validateIntervention } from '../../sim/interventions';
import { profileOf } from '../../sim/population';
import { questFocus, type QuestAlert } from '../../sim/quest';
import type { Reality } from '../../sim/reality';
import { fmtTime } from '../../sim/time';
import { DAY_END, DAY_START, type ActionType, type AgentId, type Intervention, type LocationId, type Minute, type SimEvent, type Weather } from '../../sim/types';
import { actionLabel, firstName, locName } from '../format';

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

export const OUTCOME_MARKS: Record<QuestOutcome, { sym: string; label: string; tone: string }> = {
  fulfilled: { sym: '✓', label: 'réussie', tone: 'ok' },
  failed: { sym: '✗', label: 'échouée', tone: 'danger' },
  twisted: { sym: '⚡', label: 'coup de théâtre', tone: 'warn' },
  unfinished: { sym: '✗', label: 'inachevée à minuit', tone: 'muted' },
};

// ---------------------------------------------------------------------------
// Forward-only alert cursor
// ---------------------------------------------------------------------------

/** Number of alerts at or before `minute` (alerts sorted by time). */
export function alertIndexAt(list: readonly QuestAlert[], minute: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].event.t <= minute) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** A jump of more than this many simulated minutes in one update is a seek, not playback. */
export const MAX_PLAY_STEP = 3;

/**
 * Advance the cursor from minute `prev` to `cur`: returns the new index and
 * the alerts crossed during playback (none on a backward move or a jump).
 */
export function advanceAlerts(list: readonly QuestAlert[], idx: number, prev: number, cur: number, playing: boolean): { idx: number; fresh: QuestAlert[] } {
  if (cur < prev) return { idx: alertIndexAt(list, cur), fresh: [] };
  let next = idx;
  while (next < list.length && list[next].event.t <= cur) next++;
  if (!playing || cur - prev > MAX_PLAY_STEP) return { idx: next, fresh: [] };
  return { idx: next, fresh: list.slice(idx, next) };
}

/** Inhabitants a bubble is attached to (the speaker first; at most two). */
export function alertAnchors(e: SimEvent): AgentId[] {
  return e.actors.slice(0, 2);
}

// ---------------------------------------------------------------------------
// Quick gestures
// ---------------------------------------------------------------------------

export type QuickKind = 'bus_delay' | 'stay_home' | 'encounter' | 'force_action' | 'location_hours' | 'weather';

export const QUICK_LABELS: Record<QuickKind, { label: string; icon: string }> = {
  bus_delay: { label: 'Retarder un bus', icon: '🚌' },
  stay_home: { label: 'Retenir quelqu’un chez lui', icon: '🏠' },
  encounter: { label: 'Faire se croiser deux personnes', icon: '🤝' },
  force_action: { label: 'Imposer une décision', icon: '👉' },
  location_hours: { label: 'Fermer un lieu plus tôt', icon: '🔒' },
  weather: { label: 'Changer la météo', icon: '🌦' },
};

export const GAME_ACTIONS: ActionType[] = ['school', 'work', 'coffee', 'eat_bakery', 'eat_cafe', 'eat_restaurant', 'shop_groceries', 'relax_park', 'read_library', 'workout', 'stroll', 'rest_home', 'stay_home'];
export const GAME_PLACES = LOCATIONS.filter((l) => l.kind !== 'bus_stop');

export interface GestureDraft {
  kind: QuickKind;
  /** Start minute (bus: taken from the arrival). */
  t: Minute;
  agentId: AgentId;
  agentB: AgentId;
  locationId: LocationId;
  minutes: number;
  until: Minute;
  closes: Minute;
  action: ActionType;
  condition: Weather;
  arrivalId: string;
}

export interface BusOption {
  event: SimEvent;
  /** The followed inhabitant boards this bus there. */
  mine: boolean;
}

/** Bus arrivals still reachable by a gesture (held one minute before), the followed inhabitant's first. */
export function busOptions(played: Reality, agentId: AgentId, now: Minute, limit = 30): BusOption[] {
  const arrivals = played.events.filter((e) => e.type === 'bus_arrive' && e.busId && e.t - 1 >= now);
  const boards = played.events.filter((e) => e.type === 'board_bus' && e.actors[0] === agentId && e.t >= now);
  const mine = new Set<string>();
  for (const b of boards) {
    const a = arrivals.find((e) => e.busId === b.busId && e.locationId === b.locationId && Math.abs(e.t - b.t) <= 2);
    if (a) mine.add(a.id);
  }
  const out: BusOption[] = arrivals.filter((e) => mine.has(e.id)).map((event) => ({ event, mine: true }));
  for (const e of arrivals) {
    if (out.length >= limit) break;
    if (!mine.has(e.id)) out.push({ event: e, mine: false });
  }
  return out;
}

/** Quick gestures in order of relevance for the quest, with defaults filled from it. */
export function quickGestures(played: Reality, agentId: AgentId, now: Minute): { kinds: QuickKind[]; draft: (kind: QuickKind) => GestureDraft } {
  const focus = questFocus(played.engine.state, agentId);
  const target = focus.targets.find((x) => x !== agentId) ?? profileOf(agentId).relationships[0]?.to ?? agentId;
  const place = focus.places[0] ?? 'cafe';
  const buses = busOptions(played, agentId, now, 1);
  // « Imposer une décision » defaults to going where the quest happens (school or work when it is the workplace).
  const p = profileOf(agentId);
  const goalAction: ActionType = place === p.workplaceId ? (place === 'school' && p.age < 20 ? 'school' : 'work') : 'stroll';
  const kinds: QuickKind[] = [];
  if (buses[0]?.mine) kinds.push('bus_delay');
  if (focus.targets.length) kinds.push('encounter');
  kinds.push('stay_home', 'force_action');
  if (!kinds.includes('bus_delay')) kinds.push('bus_delay');
  if (!kinds.includes('encounter')) kinds.push('encounter');
  kinds.push('location_hours', 'weather');
  const t = Math.max(DAY_START, Math.min(DAY_END - 1, Math.ceil(now)));
  const draft = (kind: QuickKind): GestureDraft => ({
    kind,
    t,
    agentId: kind === 'stay_home' && target !== agentId && focus.targets.length ? target : agentId,
    agentB: target === agentId ? (profileOf(agentId).relationships.find((r) => r.to !== agentId)?.to ?? agentId) : target,
    locationId: kind === 'location_hours' ? (GAME_PLACES.some((l) => l.id === place) ? place : 'cafe') : place,
    minutes: 5,
    until: Math.min(DAY_END, t + 60),
    closes: Math.min(DAY_END, Math.max(t + 1, Math.ceil(t / 60) * 60)),
    action: goalAction,
    condition: 'rain',
    arrivalId: buses[0]?.event.id ?? '',
  });
  return { kinds: kinds.slice(0, 6), draft };
}

/** Build the intervention of a draft, or a French reason why it cannot be built. */
export function buildGesture(d: GestureDraft, played: Reality, now: Minute): Intervention | string {
  const floor = Math.floor(now);
  const id = newInterventionId();
  const name = firstName(d.agentId);
  let iv: Intervention;
  if (d.kind === 'bus_delay') {
    const arr = played.events.find((e) => e.id === d.arrivalId) ?? busOptions(played, d.agentId, now, 1)[0]?.event;
    if (!arr) return 'Plus aucun passage de bus d’ici minuit.';
    iv = busDelayFor(arr, d.minutes);
  } else {
    if (!Number.isFinite(d.t) || d.t < DAY_START || d.t >= DAY_END) return 'Heure invalide (HH:MM avant minuit).';
    if (d.t < floor) return `Cette heure est déjà passée : il est ${fmtTime(floor)}.`;
    switch (d.kind) {
      case 'stay_home':
        if (d.until <= d.t) return 'L’heure de fin doit être après le début.';
        iv = { id, kind: 'stay_home', agentId: d.agentId, t: d.t, until: d.until, description: `${name} reste à la maison de ${fmtTime(d.t)} à ${fmtTime(d.until)}` };
        break;
      case 'encounter':
        if (d.agentId === d.agentB) return 'Choisissez deux personnes différentes.';
        iv = { id, kind: 'encounter', agentA: d.agentId, agentB: d.agentB, locationId: d.locationId, t: d.t, description: `${name} et ${firstName(d.agentB)} se retrouvent à ${locName(d.locationId)} à partir de ${fmtTime(d.t)}` };
        break;
      case 'force_action': {
        const loc = d.locationId || defaultLocationFor(d.action, profileOf(d.agentId), getCity());
        iv = { id, kind: 'force_action', agentId: d.agentId, t: d.t, action: d.action, locationId: loc, description: `${name} décide : ${actionLabel(d.action).toLowerCase()} (${locName(loc)}) à ${fmtTime(d.t)}` };
        break;
      }
      case 'location_hours':
        if (d.closes < floor) return `Cette heure est déjà passée : il est ${fmtTime(floor)}.`;
        iv = { id, kind: 'location_hours', locationId: d.locationId, t: Math.min(d.t, d.closes), closes: d.closes, description: `${locName(d.locationId)} ferme à ${fmtTime(d.closes)}` };
        break;
      case 'weather': {
        const until = d.condition === 'rain' && d.until > d.t ? d.until : undefined;
        iv = {
          id,
          kind: 'weather',
          t: d.t,
          condition: d.condition,
          until,
          description: d.condition === 'rain' ? `La pluie commence à ${fmtTime(d.t)}${until !== undefined ? ` jusqu’à ${fmtTime(until)}` : ''}` : `Le ciel se dégage à ${fmtTime(d.t)}`,
        };
        break;
      }
    }
  }
  const errs = validateIntervention(iv);
  return errs.length ? errs.join(' ') : iv;
}

/** Fresh copy of a notebook gesture (new id, same content) to reuse it in another loop. */
export function reuseIntervention(iv: Intervention): Intervention {
  return { ...iv, id: newInterventionId() };
}
