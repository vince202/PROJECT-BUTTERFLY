/**
 * Labels (in the active language, through `t`) and small formatting helpers
 * shared by the UI. Pure functions only (no React).
 *
 * The label tables below are objects whose entries are getters: reading
 * `EVENT_TYPE_LABELS[type]` resolves the text at call time, so a language
 * change is picked up by the next render without rebuilding anything.
 */

import { t } from '../i18n';
import { getCity } from '../sim/city';
import { ACTION_LABELS } from '../sim/decision';
import { profileOf } from '../sim/population';
import type {
  ActionType,
  AgentId,
  Commitment,
  EventType,
  InterventionKind,
  LocationId,
  NeedName,
  RelationshipKind,
  TraitName,
  TravelStage,
  Weather,
} from '../sim/types';

/** Record of getters `ui.format_<prefix>_<key>`: texts are looked up when read, in the current language. */
function labels<K extends string>(prefix: string, keys: readonly K[]): Record<K, string> {
  const o = {} as Record<K, string>;
  for (const k of keys) Object.defineProperty(o, k, { get: () => t(`ui.format_${prefix}_${k}`), enumerable: true });
  return o;
}

export const EVENT_TYPE_LABELS: Record<EventType, string> = labels('event', ['day_start', 'wake', 'decision', 'depart', 'arrive', 'activity_start', 'activity_end', 'bus_depart', 'bus_arrive', 'bus_delay', 'board_bus', 'alight_bus', 'miss_bus', 'wait_start', 'meeting_start', 'meeting_missed', 'meeting_end', 'encounter', 'conversation', 'argument', 'purchase', 'shop_closed', 'found_closed', 'lose_item', 'find_item', 'return_item', 'weather', 'late', 'work_start', 'work_end', 'sleep', 'intervention', 'plan_change', 'invitation', 'new_commitment', 'commitment_cancelled', 'mood_shift', 'arc_beat', 'arc_resolved', 'revelation', 'gossip', 'dilemma', 'incident', 'accident', 'fire', 'theft', 'breakup', 'dismissal', 'promotion', 'illness', 'day_end']);

export const eventTypeLabel = (t: EventType): string => EVENT_TYPE_LABELS[t] ?? t;

/** Visual family of an event type (drives marker colour and timeline lane). */
export type EventFamily = 'social' | 'trouble' | 'bus' | 'world' | 'decision' | 'drama' | 'intervention' | 'routine';

export function eventFamily(t: EventType): EventFamily {
  switch (t) {
    case 'intervention':
      return 'intervention';
    case 'encounter':
    case 'conversation':
    case 'meeting_start':
    case 'meeting_end':
    case 'invitation':
    case 'new_commitment':
      return 'social';
    case 'miss_bus':
    case 'meeting_missed':
    case 'late':
    case 'argument':
    case 'found_closed':
    case 'commitment_cancelled':
    case 'incident':
    case 'accident':
    case 'fire':
    case 'theft':
    case 'breakup':
    case 'dismissal':
    case 'promotion':
    case 'illness':
      return 'trouble';
    case 'bus_depart':
    case 'bus_arrive':
    case 'bus_delay':
    case 'board_bus':
    case 'alight_bus':
    case 'wait_start':
      return 'bus';
    case 'purchase':
    case 'shop_closed':
    case 'lose_item':
    case 'find_item':
    case 'return_item':
    case 'weather':
      return 'world';
    case 'decision':
    case 'plan_change':
    case 'mood_shift':
      return 'decision';
    case 'arc_beat':
    case 'arc_resolved':
    case 'revelation':
    case 'gossip':
    case 'dilemma':
      return 'drama';
    default:
      return 'routine';
  }
}

export const FAMILY_LABELS: Record<EventFamily, string> = labels('family', ['social', 'trouble', 'bus', 'world', 'decision', 'drama', 'intervention', 'routine']);

export const RELATIONSHIP_LABELS: Record<RelationshipKind, string> = labels('rel', ['friend', 'partner', 'ex', 'colleague', 'family', 'neighbor', 'acquaintance', 'rival', 'boss', 'employee', 'crush', 'patient', 'doctor', 'teacher', 'student']);

export const TRAIT_LABELS: Record<TraitName, string> = labels('trait', ['punctuality', 'sociability', 'impulsivity', 'curiosity', 'ambition', 'patience', 'honesty', 'frugality', 'vitality']);

export const NEED_LABELS: Record<NeedName, string> = labels('need', ['hunger', 'fatigue', 'social', 'boredom']);

export const COMMITMENT_STATUS: Record<Commitment['status'], { label: string; tone: string }> = {
  pending: { get label() { return t('ui.format_commit_pending'); }, tone: 'muted' },
  ongoing: { get label() { return t('ui.format_commit_ongoing'); }, tone: 'accent' },
  done: { get label() { return t('ui.format_commit_done'); }, tone: 'ok' },
  missed: { get label() { return t('ui.format_commit_missed'); }, tone: 'danger' },
  cancelled: { get label() { return t('ui.format_commit_cancelled'); }, tone: 'warn' },
};

export const TRAVEL_STAGE_LABELS: Record<TravelStage, string> = labels('travel', ['walking', 'to_stop', 'waiting', 'riding', 'from_stop']);

export const INTERVENTION_KIND_LABELS: Record<InterventionKind, string> = labels('iv', ['bus_delay', 'stay_home', 'force_action', 'agent_delay', 'location_hours', 'weather', 'cancel_commitment', 'encounter', 'lose_item', 'theft', 'accident', 'fire', 'breakup', 'dismissal', 'promotion', 'illness']);

export const actionLabel = (a: ActionType): string => ACTION_LABELS[a] ?? a;

export function weatherLabel(w: Weather | undefined): { icon: string; text: string } {
  return w === 'rain' ? { icon: '🌧', text: t('ui.format_weather_rain') } : { icon: '☀', text: t('ui.format_weather_clear') };
}

/** Location display name; tolerant to unknown / empty ids. */
export function locName(id: LocationId | null | undefined, fallback?: string): string {
  if (!id) return fallback ?? t('ui.format_en_route');
  return getCity().locations.get(id)?.name ?? id;
}

export function firstName(id: AgentId): string {
  try {
    return profileOf(id).firstName;
  } catch {
    return id;
  }
}

export function agentColor(id: AgentId): string {
  try {
    return profileOf(id).color;
  } catch {
    return '#8b95ad';
  }
}

export function moodWord(m: number): string {
  if (m > 0.5) return t('ui.format_mood_radiant');
  if (m > 0.2) return t('ui.format_mood_good');
  if (m > -0.2) return t('ui.format_mood_neutral');
  if (m > -0.5) return t('ui.format_mood_upset');
  return t('ui.format_mood_down');
}

export function stressWord(s: number): string {
  if (s > 0.75) return t('ui.format_stress_overwhelmed');
  if (s > 0.5) return t('ui.format_stress_tense');
  if (s > 0.25) return t('ui.format_stress_slightly_tense');
  return t('ui.format_stress_calm');
}

/** Colour of a mood value -1..1 (red → grey → green). */
export function moodColor(m: number): string {
  const v = Math.max(-1, Math.min(1, m));
  if (v >= 0) return mix([139, 149, 173], [78, 205, 160], v);
  return mix([139, 149, 173], [255, 107, 107], -v);
}

function mix(a: number[], b: number[], k: number): string {
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * k));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export function signed(v: number, digits = 2): string {
  const s = v.toFixed(digits);
  return v > 0 ? `+${s}` : s;
}

export function pct(v: number): string {
  return t('ui.format_pct', { n: Math.round(v * 100) });
}

/** Accent-insensitive, case-insensitive normalisation for search. */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Parse a "HH:MM" / "8h12" string into clock minutes (or null). */
export function parseClock(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2})\s*(?:h|:)?\s*(\d{2})?$/i);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}
