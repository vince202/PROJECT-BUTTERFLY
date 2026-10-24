/**
 * English twin of the rule-based French interpreter: turns a sentence such as
 * « What if the bus were three minutes late? » into a structured intervention.
 * Same mechanics, same intervention kinds; descriptions are English. The
 * optional LLM path (server) is language-agnostic and remains the richer one.
 */

import { getCity } from './city';
import { AGENTS } from './population';
import { fmtTime } from './time';
import { DAY_END, DAY_START, type ActionType, type AgentId, type Intervention, type LocationId, type Minute, type SimEvent } from './types';
import { busDelayFor, newInterventionId, normalize, type InterpretContext, type InterpretResult } from './interventions';

const NUMBER_WORDS: Record<string, number> = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60 };

export function findAgentEn(text: string): AgentId | null {
  const n = normalize(text);
  for (const a of AGENTS) {
    const fn = normalize(a.firstName);
    if (new RegExp(`(^|[^a-z])${fn}([^a-z]|$)`).test(n)) return a.id;
  }
  return null;
}

const LOCATION_WORDS: [RegExp, LocationId][] = [
  [/bakery|baker s/, 'bakery'],
  [/cafe|coffee shop|papillon/, 'cafe'],
  [/supermarket|grocery|groceries|marche plus/, 'supermarket'],
  [/park|garden/, 'park'],
  [/library/, 'library'],
  [/restaurant|chez lucie|lucie s/, 'restaurant'],
  [/school|high school/, 'school'],
  [/gym|fitness/, 'gym'],
  [/florist|flower shop|flowers/, 'florist'],
  [/clinic|doctor|surgery/, 'clinic'],
  [/office|agency/, 'office'],
  [/town hall|city hall|townhall/, 'townhall'],
  [/workshop/, 'workshop'],
  [/station|terminal/, 'station'],
];

export function findLocationEn(text: string): LocationId | null {
  const n = normalize(text);
  for (const [re, id] of LOCATION_WORDS) if (re.test(n)) return id;
  return null;
}

const ACTION_WORDS: [RegExp, ActionType, LocationId | undefined][] = [
  [/have a coffee|grab a coffee|go to the cafe|a coffee/, 'coffee', 'cafe'],
  [/go to the park|take a walk|stroll|in the park/, 'relax_park', 'park'],
  [/library|read/, 'read_library', 'library'],
  [/restaurant|lunch at lucie|dinner at lucie/, 'eat_restaurant', 'restaurant'],
  [/bakery|croissant|bread/, 'eat_bakery', 'bakery'],
  [/groceries|shopping|supermarket/, 'shop_groceries', 'supermarket'],
  [/work out|workout|gym|exercise/, 'workout', 'gym'],
  [/go home|stay home|rest|sleep|nap/, 'rest_home', undefined],
  [/school|class|lesson/, 'school', 'school'],
  [/go to work|to work|office/, 'work', undefined],
];

function parseMinutes(n: string): number | null {
  const m = n.match(/(\d+|[a-z]+)\s*(?:min|minute)/);
  if (!m) return null;
  const v = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
  return v ?? null;
}

function parseClock(n: string): Minute | null {
  // "at 2 pm", "at 14:30", "at 8", "around 9am", "by 6:45 pm"
  const m = n.match(/(?:at|around|by|from|until|till|before|after)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|h)?/);
  if (!m) return null;
  let h = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  const ap = m[3];
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (!ap && h <= 5) h += 12; // « at 3 » in a 06:00–24:00 day means 15:00
  if (h > 24 || mm > 59) return null;
  const t = h * 60 + mm;
  if (t < DAY_START || t > DAY_END) return null;
  return t;
}

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
  return events.find((e) => e.type === 'bus_arrive' && e.t >= ctx.t) ?? null;
}

const first = (id: AgentId) => AGENTS.find((a) => a.id === id)!.firstName;

/** Interpret an English sentence into a structured intervention (rule-based). */
export function interpretEnglish(text: string, ctx: InterpretContext): InterpretResult {
  const n = normalize(text);
  const issues: string[] = [];
  const agent = findAgentEn(n);
  const clock = parseClock(n);
  const city = getCity();
  const loc = (id: LocationId) => city.location(id).name;

  // Bus delay
  if (/\bbus\b/.test(n) && /late|delay/.test(n) && !/miss(es|ed)? the bus/.test(n)) {
    const minutes = parseMinutes(n) ?? 3;
    const arrival = pickBusArrival(ctx, agent);
    if (!arrival) return { ok: false, explanation: 'Bus delay understood, but no bus arrival found after the current time.', issues: ['Select a bus arrival event in the timeline.'], confidence: 0.6 };
    let target = arrival;
    if (clock !== null && !ctx.selectedEvent) {
      const near = (ctx.events ?? []).filter((e) => e.type === 'bus_arrive' && e.t >= clock - 2).sort((a, b) => a.t - b.t)[0];
      if (near) target = near;
    }
    const iv = { ...busDelayFor(target, minutes), description: `Bus ${target.busId} reaches ${target.locationId ? loc(target.locationId) : 'its stop'} ${minutes} min late (due ${fmtTime(target.t)})` };
    return { ok: true, intervention: iv, explanation: `Bus ${target.busId} will be held ${minutes} min just before its ${fmtTime(target.t)} arrival at ${target.locationId ? loc(target.locationId) : ''}.`, issues, confidence: 0.9 };
  }

  // Weather
  if (/rain|storm|shower|downpour/.test(n)) {
    const start = clock ?? ctx.t;
    const stop = /stop|end|clear/.test(n) && !/start|begin/.test(n);
    const iv: Intervention = { id: newInterventionId(), kind: 'weather', t: start, condition: stop ? 'clear' : 'rain', until: stop ? undefined : Math.min(DAY_END, start + 90), description: stop ? `The rain stops at ${fmtTime(start)}` : `Rain starts at ${fmtTime(start)} (90 min)` };
    return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.85 };
  }

  // Fire (before « closes », since a fire also closes a place)
  if (/\bfire\b|\bburn|blaze|\bfires\b/.test(n) && !/\bfired\b/.test(n)) {
    const l = findLocationEn(n);
    if (!l) return { ok: false, explanation: 'A fire, but where? Name a place (bakery, café, library…).', issues, confidence: 0.3 };
    const t = clock ?? ctx.t;
    const iv: Intervention = { id: newInterventionId(), kind: 'fire', locationId: l, t, description: `A fire breaks out at ${loc(l)} at ${fmtTime(t)}` };
    return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.85 };
  }

  // Closing hours
  if (/clos(e|es|ed|ing)|shut/.test(n) && !/not .*clos/.test(n)) {
    const l = findLocationEn(n);
    if (!l) issues.push('Which place closes? (bakery, café, supermarket, library…)');
    const when = clock ?? (/noon|midday/.test(n) ? 12 * 60 : null);
    if (when === null) issues.push('At what time? (e.g. “at noon”, “at 3 pm”)');
    if (l && when !== null) {
      const iv: Intervention = { id: newInterventionId(), kind: 'location_hours', t: Math.min(when, Math.max(DAY_START, ctx.t)), locationId: l, closes: when, description: `${loc(l)} closes at ${fmtTime(when)}` };
      return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.85 };
    }
    return { ok: false, explanation: 'Early closing understood.', issues, confidence: 0.5 };
  }

  // Stay home
  if (agent && /(stay(s|ed)? (at )?home|stay(s|ed)? in|do(es)?n t (leave|go out)|never leaves|stays? put|doesn t get up)/.test(n)) {
    const until = clock ?? (/morning/.test(n) ? 12 * 60 : /afternoon/.test(n) ? 18 * 60 : DAY_END);
    const from = Math.max(DAY_START, Math.min(ctx.t, until - 1));
    const iv: Intervention = { id: newInterventionId(), kind: 'stay_home', agentId: agent, t: from, until, description: `${first(agent)} stays home until ${fmtTime(until)}` };
    return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.9 };
  }

  // World incidents
  if (agent && /(stolen|steal|robbed|pickpocket|theft)/.test(n)) {
    const t = clock ?? ctx.t;
    const iv: Intervention = { id: newInterventionId(), kind: 'theft', agentId: agent, t, description: `${first(agent)} has their wallet stolen at ${fmtTime(t)}` };
    return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.85 };
  }
  if (agent && /accident|run over|knocked down|falls? (down|off)|crash/.test(n)) {
    const t = clock ?? ctx.t;
    const iv: Intervention = { id: newInterventionId(), kind: 'accident', agentId: agent, t, minutes: 180, description: `${first(agent)} has an accident at ${fmtTime(t)} (three hours at the clinic)` };
    return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.85 };
  }
  if (agent && /br(eak|eaks|eaking|oke|oken) up|split(s)? up|separat|leaves? (her|his) (partner|boyfriend|girlfriend|husband|wife)/.test(n)) {
    const me = AGENTS.find((a) => a.id === agent)!;
    const rest = n.replace(normalize(me.firstName), ' ');
    const other = findAgentEn(rest) ?? me.relationships.find((r) => r.kind === 'partner')?.to ?? null;
    if (!other) return { ok: false, explanation: `${me.firstName} breaks up with whom? Name the person.`, issues, confidence: 0.3 };
    const t = clock ?? ctx.t;
    const iv: Intervention = { id: newInterventionId(), kind: 'breakup', agentA: agent, agentB: other, t, description: `${me.firstName} and ${first(other)} break up at ${fmtTime(t)}` };
    return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.8 };
  }
  if (agent && /fired|sacked|dismiss|laid off|loses? (her|his) job/.test(n)) {
    const t = clock ?? ctx.t;
    const iv: Intervention = { id: newInterventionId(), kind: 'dismissal', agentId: agent, t, description: `${first(agent)} is fired at ${fmtTime(t)}` };
    return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.85 };
  }
  if (agent && /promot|pay rise|raise/.test(n)) {
    const t = clock ?? ctx.t;
    const iv: Intervention = { id: newInterventionId(), kind: 'promotion', agentId: agent, t, description: `${first(agent)} gets promoted at ${fmtTime(t)}` };
    return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.85 };
  }
  if (agent && /faint|(feels?|felt|feeling) (ill|sick|unwell)|f(a|e)ll(s)? ill|\bflu\b|fever|collapse/.test(n)) {
    const t = clock ?? ctx.t;
    const iv: Intervention = { id: newInterventionId(), kind: 'illness', agentId: agent, t, minutes: 240, description: `${first(agent)} feels unwell at ${fmtTime(t)} and goes home to rest` };
    return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.8 };
  }

  // Lost wallet
  if (agent && /(forget|forgets|forgot|leaves? behind|lose|loses|lost|mislay)/.test(n) && /wallet|purse/.test(n)) {
    const t = clock ?? ctx.t;
    const iv: Intervention = { id: newInterventionId(), kind: 'lose_item', agentId: agent, t, item: 'wallet', description: `${first(agent)} forgets their wallet at ${fmtTime(t)}` };
    return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.85 };
  }

  // Missed / cancelled meeting
  if (agent && /(skip|miss|forget|forgets|forgot|cancel|bail)\w*\s+(the|their|her|his)?\s*(meeting|appointment|lunch|dinner|interview|game|session|coffee|date)/.test(n)) {
    const iv: Intervention = { id: newInterventionId(), kind: 'cancel_commitment', agentId: agent, t: ctx.t, description: `${first(agent)} does not go to their next appointment (without warning)` };
    return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.8 };
  }

  // Encounter
  if (agent && /(meet|meets|met|runs? into|ran into|bumps? into|bumped into|finds?|found|sees?|saw)\b/.test(n)) {
    const me = AGENTS.find((a) => a.id === agent)!;
    const rest = n.replace(normalize(me.firstName), ' ');
    let other = findAgentEn(rest);
    if (!other && /\bex\b|former (lover|partner|boyfriend|girlfriend)/.test(n)) other = me.relationships.find((r) => r.kind === 'ex')?.to ?? null;
    if (!other) {
      for (const [kind, re] of [['partner', /partner|boyfriend|girlfriend|husband|wife/], ['friend', /friend/], ['family', /daughter|son|mother|father|grandfather|grandson|grand/], ['crush', /crush/]] as const) {
        if (re.test(n)) {
          other = me.relationships.filter((r) => r.kind === kind).sort((a, b) => b.affinity - a.affinity)[0]?.to ?? null;
          if (other) break;
        }
      }
    }
    if (!other) return { ok: false, explanation: `${me.firstName} meets whom? Name the person.`, issues, confidence: 0.3 };
    const l = findLocationEn(n) ?? 'park';
    const t = clock ?? ctx.t;
    const iv: Intervention = { id: newInterventionId(), kind: 'encounter', agentA: agent, agentB: other, locationId: l, t, description: `${me.firstName} and ${first(other)} meet at ${loc(l)} from ${fmtTime(t)}` };
    return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.8 };
  }

  // Delay a person
  if (agent && /(lingers?|dawdles?|late|held up|delayed|takes? (her|his) time)/.test(n) && !/\bbus\b/.test(n)) {
    const minutes = parseMinutes(n) ?? 10;
    const t = clock ?? ctx.t;
    const iv: Intervention = { id: newInterventionId(), kind: 'agent_delay', agentId: agent, t, minutes, description: `${first(agent)} is held up ${minutes} min from ${fmtTime(t)}` };
    return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.8 };
  }

  // Force an action
  if (agent && /(decide|goes?|went|chooses?|instead|rather|would|leaves?|left|heads?|headed)/.test(n)) {
    for (const [re, action, target0] of ACTION_WORDS) {
      if (!re.test(n)) continue;
      const me = AGENTS.find((a) => a.id === agent)!;
      const target = target0 ?? (action === 'work' && me.workplaceId ? me.workplaceId : me.homeId);
      const t = clock ?? ctx.t;
      const iv: Intervention = { id: newInterventionId(), kind: 'force_action', agentId: agent, t, action, locationId: target, description: `${me.firstName} decides to ${actionLabel(action)} (${loc(target)}) at ${fmtTime(t)}` };
      return { ok: true, intervention: iv, explanation: iv.description, issues, confidence: 0.75 };
    }
  }

  return { ok: false, explanation: 'I could not turn this into a gesture. Try: “What if the bus were three minutes late?”, “What if Léa left for school at 7:30?”, “What if Sophie ran into Julien at the park?”', issues: agent ? [] : ['Name an inhabitant (Alice, Martin, Sophie…) or a bus.'], confidence: 0.2 };
}

function actionLabel(action: ActionType): string {
  const labels: Partial<Record<ActionType, string>> = {
    coffee: 'have a coffee',
    relax_park: 'go to the park',
    read_library: 'go to the library',
    eat_restaurant: 'eat at the restaurant',
    eat_bakery: 'stop by the bakery',
    shop_groceries: 'do the shopping',
    workout: 'work out',
    rest_home: 'stay home',
    school: 'leave for school',
    work: 'go to work',
    eat_home: 'eat at home',
    eat_cafe: 'eat at the café',
    stroll: 'take a walk',
    visit: 'join someone',
    stay_home: 'stay in',
  };
  return labels[action] ?? action;
}

export const INTERVENTION_TEMPLATES_EN: { id: string; label: string; example: string; kind: Intervention['kind'] }[] = [
  { id: 'bus', label: 'Delay a bus', example: 'What if the bus were three minutes late?', kind: 'bus_delay' },
  { id: 'home', label: 'Someone stays home', example: 'What if Alice stayed home this morning?', kind: 'stay_home' },
  { id: 'action', label: 'Change a decision', example: 'What if Martin decided to have a coffee instead of going to work?', kind: 'force_action' },
  { id: 'delay', label: 'Hold someone up', example: 'What if Gérard were held up ten minutes at 9 am?', kind: 'agent_delay' },
  { id: 'hours', label: 'Close a place early', example: 'What if the bakery closed at noon?', kind: 'location_hours' },
  { id: 'weather', label: 'Change the weather', example: 'What if it rained at 2 pm?', kind: 'weather' },
  { id: 'miss', label: 'Skip an appointment', example: 'What if Gérard forgot his appointment?', kind: 'cancel_commitment' },
  { id: 'meet', label: 'Make two people meet', example: 'What if Sophie ran into Julien at the park at 5 pm?', kind: 'encounter' },
  { id: 'wallet', label: 'Forget a wallet', example: 'What if Élodie forgot her wallet at noon?', kind: 'lose_item' },
  { id: 'theft', label: 'A theft', example: 'What if Gérard had his wallet stolen?', kind: 'theft' },
  { id: 'accident', label: 'An accident', example: 'What if Paul had an accident at 10 am?', kind: 'accident' },
  { id: 'fire', label: 'A fire', example: 'What if a fire broke out at the bakery at 11 am?', kind: 'fire' },
  { id: 'breakup', label: 'A breakup', example: 'What if Chloé and Antoine broke up?', kind: 'breakup' },
  { id: 'dismissal', label: 'A dismissal', example: 'What if Alice were fired?', kind: 'dismissal' },
  { id: 'promotion', label: 'A promotion', example: 'What if Martin got promoted?', kind: 'promotion' },
  { id: 'illness', label: 'Feeling unwell', example: 'What if Nadia felt unwell at 3 pm?', kind: 'illness' },
];
