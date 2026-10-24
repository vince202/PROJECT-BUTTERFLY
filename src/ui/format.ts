/**
 * French labels and small formatting helpers shared by the UI.
 * Pure functions only (no React).
 */

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

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  day_start: 'Début de journée',
  wake: 'Réveil',
  decision: 'Décision',
  depart: 'Départ',
  arrive: 'Arrivée',
  activity_start: 'Début d’activité',
  activity_end: 'Fin d’activité',
  bus_depart: 'Départ du bus',
  bus_arrive: 'Arrivée du bus',
  bus_delay: 'Retard de bus',
  board_bus: 'Montée dans le bus',
  alight_bus: 'Descente du bus',
  miss_bus: 'Bus manqué',
  wait_start: 'Attente',
  meeting_start: 'Rendez-vous',
  meeting_missed: 'Rendez-vous manqué',
  meeting_end: 'Fin de rendez-vous',
  encounter: 'Rencontre',
  conversation: 'Conversation',
  argument: 'Dispute',
  purchase: 'Achat',
  shop_closed: 'Fermeture d’un lieu',
  found_closed: 'Porte close',
  lose_item: 'Objet perdu',
  find_item: 'Objet trouvé',
  return_item: 'Objet rendu',
  weather: 'Météo',
  late: 'Retard',
  work_start: 'Début du travail',
  work_end: 'Fin du travail',
  sleep: 'Coucher',
  intervention: 'Intervention',
  plan_change: 'Changement de plan',
  invitation: 'Invitation',
  new_commitment: 'Nouvel engagement',
  commitment_cancelled: 'Engagement annulé',
  mood_shift: 'Changement d’humeur',
  arc_beat: 'Temps fort',
  arc_resolved: 'Point de bascule',
  revelation: 'Confidence',
  gossip: 'Rumeur',
  dilemma: 'Dilemme',
  incident: 'Coup du sort',
  accident: 'Accident',
  fire: 'Incendie',
  theft: 'Vol',
  breakup: 'Rupture',
  dismissal: 'Renvoi',
  promotion: 'Promotion',
  illness: 'Malaise',
  day_end: 'Fin de journée',
};

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

export const FAMILY_LABELS: Record<EventFamily, string> = {
  social: 'Rencontres',
  trouble: 'Contretemps',
  bus: 'Bus',
  world: 'Objets, météo, commerces',
  decision: 'Décisions',
  drama: 'Drame',
  intervention: 'Intervention',
  routine: 'Routine',
};

export const RELATIONSHIP_LABELS: Record<RelationshipKind, string> = {
  friend: 'ami·e',
  partner: 'partenaire',
  ex: 'ex',
  colleague: 'collègue',
  family: 'famille',
  neighbor: 'voisin·e',
  acquaintance: 'connaissance',
  rival: 'rival·e',
  boss: 'patron·ne',
  employee: 'employé·e',
  crush: 'coup de cœur',
  patient: 'patient·e',
  doctor: 'médecin',
  teacher: 'enseignant·e',
  student: 'élève',
};

export const TRAIT_LABELS: Record<TraitName, string> = {
  punctuality: 'Ponctualité',
  sociability: 'Sociabilité',
  impulsivity: 'Impulsivité',
  curiosity: 'Curiosité',
  ambition: 'Ambition',
  patience: 'Patience',
  honesty: 'Honnêteté',
  frugality: 'Économie',
  vitality: 'Vitalité',
};

export const NEED_LABELS: Record<NeedName, string> = {
  hunger: 'Faim',
  fatigue: 'Fatigue',
  social: 'Solitude',
  boredom: 'Ennui',
};

export const COMMITMENT_STATUS: Record<Commitment['status'], { label: string; tone: string }> = {
  pending: { label: 'prévu', tone: 'muted' },
  ongoing: { label: 'en cours', tone: 'accent' },
  done: { label: 'accompli', tone: 'ok' },
  missed: { label: 'manqué', tone: 'danger' },
  cancelled: { label: 'abandonné', tone: 'warn' },
};

export const TRAVEL_STAGE_LABELS: Record<TravelStage, string> = {
  walking: 'Marche',
  to_stop: 'Va à l’arrêt de bus',
  waiting: 'Attend le bus',
  riding: 'Dans le bus',
  from_stop: 'Descendu du bus, termine à pied',
};

export const INTERVENTION_KIND_LABELS: Record<InterventionKind, string> = {
  bus_delay: 'Retard de bus',
  stay_home: 'Rester chez soi',
  force_action: 'Décision forcée',
  agent_delay: 'Départ retardé',
  location_hours: 'Horaires d’un lieu',
  weather: 'Météo',
  cancel_commitment: 'Rendez-vous manqué',
  encounter: 'Rencontre provoquée',
  lose_item: 'Portefeuille oublié',
  theft: 'Vol',
  accident: 'Accident',
  fire: 'Incendie',
  breakup: 'Rupture',
  dismissal: 'Renvoi',
  promotion: 'Promotion',
  illness: 'Malaise',
};

export const actionLabel = (a: ActionType): string => ACTION_LABELS[a] ?? a;

export function weatherLabel(w: Weather | undefined): { icon: string; text: string } {
  return w === 'rain' ? { icon: '🌧', text: 'Pluie' } : { icon: '☀', text: 'Dégagé' };
}

/** Location display name; tolerant to unknown / empty ids. */
export function locName(id: LocationId | null | undefined, fallback = 'En chemin'): string {
  if (!id) return fallback;
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
  if (m > 0.5) return 'rayonnant·e';
  if (m > 0.2) return 'de bonne humeur';
  if (m > -0.2) return 'neutre';
  if (m > -0.5) return 'contrarié·e';
  return 'abattu·e';
}

export function stressWord(s: number): string {
  if (s > 0.75) return 'débordé·e';
  if (s > 0.5) return 'tendu·e';
  if (s > 0.25) return 'légèrement tendu·e';
  return 'serein·e';
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
  return `${Math.round(v * 100)} %`;
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
