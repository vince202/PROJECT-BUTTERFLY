/**
 * Structured interventions: creation helpers, validation and a rule-based
 * French natural-language interpreter (works without any LLM).
 *
 * The interpreter turns sentences such as « Et si le bus avait trois minutes de
 * retard ? » into a validated `Intervention`. An optional LLM can do the same
 * job with more flexibility, but the simulation engine only ever executes the
 * structured form.
 */

import { getCity } from './city';
import { AGENTS } from './population';
import { fmtTime } from './time';
import { DAY_END, DAY_START, type ActionType, type AgentId, type Intervention, type LocationId, type Minute, type SimEvent } from './types';

let seq = 1;
export function newInterventionId(): string {
  return `iv_${Date.now().toString(36)}_${seq++}`;
}

export interface InterpretContext {
  /** Current simulated time shown to the user. */
  t: Minute;
  /** Event selected in the interface, if any (used for bus delays). */
  selectedEvent?: SimEvent | null;
  /** Event log of the original reality (to locate buses and meetings). */
  events?: SimEvent[];
}

export interface InterpretResult {
  ok: boolean;
  intervention?: Intervention;
  /** French explanation of what was understood. */
  explanation: string;
  /** What is missing or ambiguous. */
  issues: string[];
  confidence: number;
}

const NUMBER_WORDS: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, quinze: 15, vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60 };

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findAgent(text: string): AgentId | null {
  const n = normalize(text);
  for (const a of AGENTS) {
    const fn = normalize(a.firstName);
    if (new RegExp(`(^|[^a-z])${fn}([^a-z]|$)`).test(n)) return a.id;
  }
  return null;
}

const LOCATION_WORDS: [RegExp, LocationId][] = [
  [/boulangerie/, 'bakery'],
  [/cafe|bistrot|papillon/, 'cafe'],
  [/supermarche|courses|marche plus/, 'supermarket'],
  [/parc|jardin/, 'park'],
  [/bibliotheque/, 'library'],
  [/restaurant|chez lucie/, 'restaurant'],
  [/ecole|lycee/, 'school'],
  [/gymnase|salle de sport|gym/, 'gym'],
  [/fleuriste|fleurs/, 'florist'],
  [/cabinet|medecin|clinique|docteur/, 'clinic'],
  [/bureau|agence/, 'office'],
  [/mairie|hotel de ville/, 'townhall'],
  [/atelier/, 'workshop'],
  [/gare/, 'station'],
];

export function findLocation(text: string): LocationId | null {
  const n = normalize(text);
  for (const [re, id] of LOCATION_WORDS) if (re.test(n)) return id;
  return null;
}

const ACTION_WORDS: [RegExp, ActionType, LocationId | undefined][] = [
  [/prendre un cafe|boire un cafe|aller au cafe|un cafe/, 'coffee', 'cafe'],
  [/aller au parc|se promener|promenade|au parc/, 'relax_park', 'park'],
  [/bibliotheque|lire/, 'read_library', 'library'],
  [/restaurant|dejeuner chez lucie|diner chez lucie/, 'eat_restaurant', 'restaurant'],
  [/boulangerie|croissant|pain/, 'eat_bakery', 'bakery'],
  [/courses|supermarche/, 'shop_groceries', 'supermarket'],
  [/sport|gymnase|salle/, 'workout', 'gym'],
  [/rentrer|maison|chez (elle|lui)|se reposer|dormir/, 'rest_home', undefined],
  [/lycee|en cours|a l ecole|ecole/, 'school', 'school'],
  [/travailler|au travail|au bureau/, 'work', undefined],
];

function parseMinutes(n: string): number | null {
  const m = n.match(/(\d+|[a-z]+)\s*(?:min|minute)/);
  if (!m) return null;
  const v = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
  return v ?? null;
}

function parseClock(n: string): Minute | null {
  // "à 14 h", "a 8h12", "a 08:12", "vers 14h"
  const m = n.match(/(?:a|vers|des|avant|apres|jusqu a)\s*(\d{1,2})\s*(?:h|:)\s*(\d{2})?/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  if (h > 24 || mm > 59) return null;
  const t = h * 60 + mm;
  if (t < DAY_START || t > DAY_END) return null;
  return t;
}

/** Find the bus arrival the user most likely means: the selected event, or the next arrival after t. */
function pickBusArrival(ctx: InterpretContext, agentHint?: AgentId | null): SimEvent | null {
  if (ctx.selectedEvent && (ctx.selectedEvent.type === 'bus_arrive' || ctx.selectedEvent.type === 'bus_depart') && ctx.selectedEvent.busId) return ctx.selectedEvent;
  const events = ctx.events ?? [];
  if (agentHint) {
    const board = events.find((e) => e.type === 'board_bus' && e.actors[0] === agentHint && e.t >= ctx.t);
    if (board?.busId) {
      const arr = events.find((e) => e.type === 'bus_arrive' && e.busId === board.busId && e.locationId === board.locationId && Math.abs(e.t - board.t) <= 2);
      if (arr) return arr;
    }
  }
  return events.find((e) => e.type === 'bus_arrive' && e.t >= ctx.t && e.actors.length >= 0) ?? null;
}

/** Build a bus-delay intervention targeting a specific bus arrival event. */
export function busDelayFor(arrival: SimEvent, minutes: number): Intervention {
  const t = Math.max(DAY_START, arrival.t - 1);
  const city = getCity();
  const where = arrival.locationId ? city.location(arrival.locationId).name : 'la ligne';
  return {
    id: newInterventionId(),
    kind: 'bus_delay',
    t,
    minutes,
    busId: arrival.busId!,
    description: `Le bus ${arrival.busId} arrive à ${where} avec ${minutes} min de retard (prévu ${fmtTime(arrival.t)})`,
  };
}

export function describeIntervention(iv: Intervention): string {
  return iv.description;
}

/** Interpret a French sentence into a structured intervention (rule-based fallback). */
export function interpretFrench(text: string, ctx: InterpretContext): InterpretResult {
  const n = normalize(text);
  const issues: string[] = [];
  const agent = findAgent(n);
  const clock = parseClock(n);
  const city = getCity();

  // Bus delay
  if (/\bbus\b/.test(n) && /retard|tard/.test(n) && !/rat(e|ait) le bus/.test(n)) {
    const minutes = parseMinutes(n) ?? 3;
    const arrival = pickBusArrival(ctx, agent);
    if (!arrival) {
      return { ok: false, explanation: 'Retard de bus compris, mais aucun passage de bus trouvé après l’heure courante.', issues: ['Sélectionnez un événement d’arrivée de bus dans la chronologie.'], confidence: 0.6 };
    }
    let target = arrival;
    if (clock !== null && !ctx.selectedEvent) {
      const near = (ctx.events ?? []).filter((e) => e.type === 'bus_arrive' && e.t >= clock - 2).sort((a, b) => a.t - b.t)[0];
      if (near) target = near;
    }
    const iv = busDelayFor(target, minutes);
    return { ok: true, intervention: iv, explanation: `Le bus ${target.busId} sera retenu ${minutes} min juste avant son arrivée de ${fmtTime(target.t)} à ${target.locationId ? city.location(target.locationId).name : ''}.`, issues, confidence: 0.9 };
  }

  // Rain / weather
  if (/pluie|pleuv|orage|averse/.test(n)) {
    const start = clock ?? ctx.t;
    const stop = /s arret|cess|fin/.test(n) && !/commen/.test(n);
    const iv: Intervention = { id: newInterventionId(), kind: 'weather', t: start, condition: stop ? 'clear' : 'rain', until: stop ? undefined : Math.min(DAY_END, start + 90), description: stop ? `La pluie cesse à ${fmtTime(start)}` : `La pluie commence à ${fmtTime(start)} (90 min)` };
    return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.85 };
  }

  // Shop closing / opening hours
  const closeMatch = /ferm/.test(n) && !/ne .*ferm/.test(n);
  if (closeMatch) {
    const loc = findLocation(n);
    if (!loc) issues.push('Quel lieu ferme ? (boulangerie, café, supermarché, bibliothèque…)');
    const when = clock ?? (/midi/.test(n) ? 12 * 60 : null);
    if (when === null) issues.push('À quelle heure ? (ex. « à midi », « à 15 h »)');
    if (loc && when !== null) {
      const iv: Intervention = { id: newInterventionId(), kind: 'location_hours', t: Math.min(when, Math.max(DAY_START, ctx.t)), locationId: loc, closes: when, description: `${city.location(loc).name} ferme à ${fmtTime(when)}` };
      return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.85 };
    }
    return { ok: false, explanation: 'Fermeture anticipée comprise.', issues, confidence: 0.5 };
  }

  // Stay home
  if (agent && /(ne|n)\s*(quitt|sort|bouge)\w*\s*pas|rest\w* (chez|a la maison)|ne se lev\w* pas/.test(n)) {
    const until = clock ?? (/matin/.test(n) ? 12 * 60 : /apres-midi|apres midi/.test(n) ? 18 * 60 : DAY_END);
    const from = Math.max(DAY_START, Math.min(ctx.t, until - 1));
    const name = AGENTS.find((a) => a.id === agent)!.firstName;
    const iv: Intervention = { id: newInterventionId(), kind: 'stay_home', agentId: agent, t: from, until, description: `${name} reste à la maison jusqu’à ${fmtTime(until)}` };
    return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.9 };
  }

  // World incidents: theft, accident, fire, breakup, dismissal, promotion, illness
  if (agent && /\b(vol[ée]?|voler|volait|derob)/.test(n) && /portefeuille|porte-monnaie|sac/.test(n)) {
    const name = AGENTS.find((a) => a.id === agent)!.firstName;
    const t = clock ?? ctx.t;
    const iv: Intervention = { id: newInterventionId(), kind: 'theft', agentId: agent, t, description: `${name} se fait voler son portefeuille à ${fmtTime(t)}` };
    return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.85 };
  }
  if (agent && /accident|renvers|chut|tomb\w* (dans|de|du) /.test(n) && !/tomb\w* sur/.test(n)) {
    const name = AGENTS.find((a) => a.id === agent)!.firstName;
    const t = clock ?? ctx.t;
    const iv: Intervention = { id: newInterventionId(), kind: 'accident', agentId: agent, t, minutes: 180, description: `${name} a un accident à ${fmtTime(t)} (trois heures à la clinique)` };
    return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.85 };
  }
  if (/incendie|brul|feu /.test(n)) {
    const loc = findLocation(n);
    if (!loc) return { ok: false, explanation: 'Un incendie, mais où ? Nommez un lieu (boulangerie, café, bibliothèque…).', issues, confidence: 0.3 };
    const t = clock ?? ctx.t;
    const iv: Intervention = { id: newInterventionId(), kind: 'fire', locationId: loc, t, description: `Un incendie se déclare à ${getCity().location(loc).name} à ${fmtTime(t)}` };
    return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.85 };
  }
  if (agent && /separ|rompr|rupture|quitt\w* (son|sa) (compagn|partenaire|copain|copine|mari|femme)/.test(n)) {
    const me = AGENTS.find((a) => a.id === agent)!;
    const rest = n.replace(normalize(me.firstName), ' ');
    const other = findAgent(rest) ?? me.relationships.find((r) => r.kind === 'partner')?.to ?? null;
    if (!other) return { ok: false, explanation: `${me.firstName} se sépare de qui ? Nommez la personne.`, issues, confidence: 0.3 };
    const t = clock ?? ctx.t;
    const iv: Intervention = { id: newInterventionId(), kind: 'breakup', agentA: agent, agentB: other, t, description: `${me.firstName} et ${AGENTS.find((a) => a.id === other)!.firstName} se séparent à ${fmtTime(t)}` };
    return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.8 };
  }
  if (agent && /renvoy|licenci|vir[ée]e? /.test(n)) {
    const name = AGENTS.find((a) => a.id === agent)!.firstName;
    const t = clock ?? ctx.t;
    const iv: Intervention = { id: newInterventionId(), kind: 'dismissal', agentId: agent, t, description: `${name} est renvoyé à ${fmtTime(t)}` };
    return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.85 };
  }
  if (agent && /promu|promotion|augment/.test(n)) {
    const name = AGENTS.find((a) => a.id === agent)!.firstName;
    const t = clock ?? ctx.t;
    const iv: Intervention = { id: newInterventionId(), kind: 'promotion', agentId: agent, t, description: `${name} est promu à ${fmtTime(t)}` };
    return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.85 };
  }
  if (agent && /malaise|evanou|tomb\w* malade|fievre|grippe/.test(n)) {
    const name = AGENTS.find((a) => a.id === agent)!.firstName;
    const t = clock ?? ctx.t;
    const iv: Intervention = { id: newInterventionId(), kind: 'illness', agentId: agent, t, minutes: 240, description: `${name} fait un malaise à ${fmtTime(t)} et rentre se reposer` };
    return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.8 };
  }

  // Lost wallet: « Et si Gérard oubliait son portefeuille ? »
  if (agent && /(oubli|perd|egar)\w*\s+(son|le)?\s*(portefeuille|porte-monnaie)/.test(n)) {
    const name = AGENTS.find((a) => a.id === agent)!.firstName;
    const t = clock ?? ctx.t;
    const iv: Intervention = { id: newInterventionId(), kind: 'lose_item', agentId: agent, t, item: 'wallet', description: `${name} oublie son portefeuille à ${fmtTime(t)}` };
    return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.85 };
  }

  // Missed / cancelled meeting
  if (agent && /(rat|manqu|oubli|annul|zapp)\w*\s+(son|sa|le|la|leur)?\s*(rendez|rdv|reunion|dejeuner|diner|interview|partie|seance|cafe entre)/.test(n)) {
    const name = AGENTS.find((a) => a.id === agent)!.firstName;
    const iv: Intervention = { id: newInterventionId(), kind: 'cancel_commitment', agentId: agent, t: ctx.t, description: `${name} ne se rend pas à son prochain rendez-vous (sans prévenir)` };
    return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.8 };
  }

  // Encounter: "Sophie retrouvait son ancien amoureux au parc"
  if (agent && /(retrouv|rencontr|crois|tomb\w* sur)/.test(n)) {
    const me = AGENTS.find((a) => a.id === agent)!;
    let other: AgentId | null = null;
    const rest = n.replace(normalize(me.firstName), ' ');
    other = findAgent(rest);
    if (!other && /ancien amoureux|ancienne amoureuse|son ex|ancien compagnon|ancienne compagne/.test(n)) {
      other = me.relationships.find((r) => r.kind === 'ex')?.to ?? null;
      if (!other) issues.push(`${me.firstName} n’a pas d’ancien amoureux connu.`);
    }
    if (!other && /son (amie?|copain|copine|frere|soeur|mere|pere|grand-pere|petit-fils|fille|fils|compagnon|compagne|patron|collegue)/.test(n)) {
      const kind = /amour|compagn/.test(n) ? 'partner' : /mere|pere|grand|fils|fille|soeur|frere/.test(n) ? 'family' : /patron/.test(n) ? 'boss' : /collegue/.test(n) ? 'colleague' : 'friend';
      other = me.relationships.filter((r) => r.kind === kind).sort((a, b) => b.affinity - a.affinity)[0]?.to ?? null;
    }
    if (!other) issues.push('Qui doit-il/elle rencontrer ?');
    const loc = findLocation(n) ?? 'park';
    if (other) {
      const t = clock ?? Math.max(ctx.t, DAY_START);
      const iv: Intervention = { id: newInterventionId(), kind: 'encounter', agentA: agent, agentB: other, locationId: loc, t, description: `${me.firstName} et ${AGENTS.find((a) => a.id === other)!.firstName} se retrouvent à ${city.location(loc).name} à partir de ${fmtTime(t)}` };
      return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.8 };
    }
    return { ok: false, explanation: 'Rencontre comprise.', issues, confidence: 0.5 };
  }

  // Agent delay: "partait 10 minutes plus tard", "traînait"
  if (agent && /(plus tard|s attard|train)/.test(n)) {
    const minutes = parseMinutes(n) ?? 10;
    const name = AGENTS.find((a) => a.id === agent)!.firstName;
    const iv: Intervention = { id: newInterventionId(), kind: 'agent_delay', agentId: agent, t: clock ?? ctx.t, minutes, description: `${name} s’attarde ${minutes} min` };
    return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.75 };
  }

  // Forced action: "Martin décidait de prendre un café plutôt que d'aller travailler"
  if (agent) {
    for (const [re, action, loc] of ACTION_WORDS) {
      if (!re.test(n)) continue;
      if (action === 'work') continue;
      const name = AGENTS.find((a) => a.id === agent)!.firstName;
      const target = loc ?? AGENTS.find((a) => a.id === agent)!.homeId;
      const iv: Intervention = { id: newInterventionId(), kind: 'force_action', agentId: agent, t: clock ?? ctx.t, action, locationId: target, description: `${name} décide : ${labelFor(action)} (${city.location(target).name}) à ${fmtTime(clock ?? ctx.t)}` };
      return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.75 };
    }
    issues.push('Action non reconnue. Essayez : « prendre un café », « aller au parc », « rester à la maison », « rater son rendez-vous ».');
    return { ok: false, explanation: `Habitant reconnu : ${AGENTS.find((a) => a.id === agent)!.firstName}.`, issues, confidence: 0.3 };
  }

  issues.push('Je n’ai pas reconnu d’habitant, de bus, de lieu ni de météo dans cette phrase.');
  return { ok: false, explanation: 'Phrase non comprise.', issues, confidence: 0 };
}

function labelFor(action: ActionType): string {
  const labels: Partial<Record<ActionType, string>> = {
    coffee: 'prendre un café',
    relax_park: 'aller au parc',
    read_library: 'aller à la bibliothèque',
    eat_restaurant: 'manger au restaurant',
    eat_bakery: 'passer à la boulangerie',
    shop_groceries: 'faire les courses',
    workout: 'faire du sport',
    rest_home: 'rester à la maison',
    school: 'partir au lycée',
    work: 'aller travailler',
    eat_home: 'manger à la maison',
    eat_cafe: 'manger au café',
    stroll: 'se promener',
    visit: 'rejoindre quelqu’un',
    stay_home: 'rester chez soi',
  };
  return labels[action] ?? action;
}

/** Validate an intervention against the world definition. */
export function validateIntervention(iv: Intervention): string[] {
  const errors: string[] = [];
  const city = getCity();
  if (iv.t < DAY_START || iv.t >= DAY_END) errors.push(`L’heure ${fmtTime(iv.t)} est hors de la journée simulée (06:00–24:00).`);
  const agentIds = new Set(AGENTS.map((a) => a.id));
  if ('agentId' in iv && !agentIds.has(iv.agentId)) errors.push(`Habitant inconnu : ${iv.agentId}`);
  if (iv.kind === 'encounter') {
    if (!agentIds.has(iv.agentA) || !agentIds.has(iv.agentB)) errors.push('Habitant inconnu dans la rencontre.');
    if (iv.agentA === iv.agentB) errors.push('Une rencontre demande deux personnes différentes.');
  }
  if ('locationId' in iv && iv.locationId && !city.locations.has(iv.locationId)) errors.push(`Lieu inconnu : ${iv.locationId}`);
  if (iv.kind === 'breakup' && iv.agentA === iv.agentB) errors.push('Deux habitants différents sont nécessaires.');
  if ((iv.kind === 'accident' || iv.kind === 'illness') && (iv.minutes < 10 || iv.minutes > 600)) errors.push('Durée invalide (10 à 600 min).');
  if (iv.kind === 'bus_delay') {
    if (iv.minutes < 1 || iv.minutes > 60) errors.push('Le retard doit être compris entre 1 et 60 minutes.');
    if (!/^L\d+-\d+$/.test(iv.busId)) errors.push(`Bus inconnu : ${iv.busId}`);
  }
  if (iv.kind === 'stay_home' && iv.until <= iv.t) errors.push('L’heure de fin doit être après le début.');
  if (iv.kind === 'location_hours' && iv.closes !== undefined && (iv.closes < DAY_START || iv.closes > DAY_END)) errors.push('Heure de fermeture invalide.');
  return errors;
}

/** Predefined intervention templates for the no-LLM selection interface. */
export const INTERVENTION_TEMPLATES: { id: string; label: string; example: string; kind: Intervention['kind'] }[] = [
  { id: 'bus', label: 'Retarder un bus', example: 'Et si le bus avait trois minutes de retard ?', kind: 'bus_delay' },
  { id: 'home', label: 'Un habitant reste chez lui', example: 'Et si Alice ne quittait pas son appartement ce matin ?', kind: 'stay_home' },
  { id: 'action', label: 'Changer une décision', example: 'Et si Martin décidait de prendre un café plutôt que d’aller travailler ?', kind: 'force_action' },
  { id: 'close', label: 'Fermer un lieu plus tôt', example: 'Et si la boulangerie fermait à midi ?', kind: 'location_hours' },
  { id: 'meet', label: 'Provoquer une rencontre', example: 'Et si Sophie retrouvait son ancien amoureux au parc ?', kind: 'encounter' },
  { id: 'rain', label: 'Changer la météo', example: 'Et si la pluie commençait à 14 h ?', kind: 'weather' },
  { id: 'miss', label: 'Manquer un rendez-vous', example: 'Et si Gérard oubliait son rendez-vous ?', kind: 'cancel_commitment' },
  { id: 'wallet', label: 'Oublier son portefeuille', example: 'Et si Élodie oubliait son portefeuille à midi ?', kind: 'lose_item' },
  { id: 'theft', label: 'Un vol', example: 'Et si Gérard se faisait voler son portefeuille ?', kind: 'theft' },
  { id: 'accident', label: 'Un accident', example: 'Et si Paul avait un accident à 10h ?', kind: 'accident' },
  { id: 'fire', label: 'Un incendie', example: 'Et si un incendie se déclarait à la boulangerie à 11h ?', kind: 'fire' },
  { id: 'breakup', label: 'Une rupture', example: 'Et si Chloé et Antoine se séparaient ?', kind: 'breakup' },
  { id: 'dismissal', label: 'Un renvoi', example: 'Et si Alice était renvoyée ?', kind: 'dismissal' },
  { id: 'promotion', label: 'Une promotion', example: 'Et si Martin était promu ?', kind: 'promotion' },
  { id: 'illness', label: 'Un malaise', example: 'Et si Nadia faisait un malaise à 15h ?', kind: 'illness' },
  { id: 'late', label: 'Partir plus tard', example: 'Et si Léa partait dix minutes plus tard ?', kind: 'agent_delay' },
];
