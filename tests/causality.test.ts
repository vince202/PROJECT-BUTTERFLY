import { describe, expect, it } from 'vitest';
import { CausalGraph } from '../src/sim/causal';
import { busDelayFor } from '../src/sim/interventions';
import type { Intervention, SimEvent } from '../src/sim/types';
import { BUS_SEED, NORMAL_SEED, fork, runDay, findBoardingArrival } from './helpers';

// Alice abandonne son déjeuner avec Sophie : elle est au bureau, donc réellement absente du restaurant.
const cancelAlice: Intervention = { id: 'iv_cancel', kind: 'cancel_commitment', agentId: 'alice', commitmentId: 'c_alice_sophie_lunch', t: 420, description: 'Alice oublie son déjeuner' };
// Martin abandonne une réunion qui a lieu sur son lieu de travail (il est donc physiquement présent).
const cancelMartin: Intervention = { id: 'iv_cancel_m', kind: 'cancel_commitment', agentId: 'martin', commitmentId: 'c_martin_thomas', t: 420, description: 'Martin oublie sa réunion' };

/** 'e0' est l'identifiant factice de l'activité initiale du chauffeur de bus (voir it plus bas). */
const DRIVER_PLACEHOLDER = 'e0';

describe.each([NORMAL_SEED, BUS_SEED, 7])('Intégrité du graphe causal (graine %i)', (seed) => {
  const R = runDay(seed);
  const byId = new Map(R.events.map((e) => [e.id, e]));

  it('chaque cause référence un événement existant, antérieur ou simultané', () => {
    const bad: string[] = [];
    for (const e of R.events) {
      for (const c of e.causes) {
        if (c === DRIVER_PLACEHOLDER) continue;
        const cause = byId.get(c);
        if (!cause) bad.push(`${e.id} (${e.type}): cause inconnue ${String(c)}`);
        else if (cause.t > e.t) bad.push(`${e.id} (${e.type}@${e.t}): cause ${c}@${cause.t} dans le futur`);
      }
    }
    expect(bad).toEqual([]);
  });

  // SUSPECTED BUG (engine.ts ~l.225/237): the bus driver's initial `travel.departEventId` and
  // `activity.startEventId` are the placeholder 'e0', which is not an event. Any 'encounter' between
  // the driver and a passenger (and other events citing the driver's activity) then gets 'e0' in `causes`.
  // Repro: seed 42, event e792 (t=622, Antoine/Mireille in bus L1-1) has causes [..., 'e0', ...].
  it(`graine ${seed} : aucune cause dangling (le chauffeur de bus injecte l’id factice « e0 »)`, () => {
    const dangling = R.events.flatMap((e) => e.causes.filter((c) => !byId.has(c)).map((c) => `${e.id}→${c}`));
    expect(dangling).toEqual([]);
  });

  it('aucun événement n’est sa propre cause, sans doublon dans causes[]', () => {
    for (const e of R.events) {
      expect(e.causes, e.id).not.toContain(e.id);
      expect(new Set(e.causes).size, `${e.id} ${e.type}: causes dupliquées`).toBe(e.causes.length);
    }
  });

  it('l’ordre des identifiants suit l’ordre d’émission : une cause a toujours un id plus ancien', () => {
    const seq = (id: string) => Number(id.replace(/^e/, ''));
    for (const e of R.events) for (const c of e.causes) expect(seq(c), `${e.id} <- ${c}`).toBeLessThan(seq(e.id));
  });

  it('le graphe est acyclique : tout événement n’est pas son propre ancêtre', () => {
    const g = R.causal;
    for (const e of R.events.filter((_, i) => i % 7 === 0)) expect(g.ancestors(e.id).has(e.id), e.id).toBe(false);
  });
});

describe('Chaînes causales du déplacement et du bus', () => {
  const R = runDay(NORMAL_SEED);
  const g = R.causal;

  it('les ancêtres d’un arrive incluent son depart', () => {
    const arrives = R.events.filter((e) => e.type === 'arrive');
    expect(arrives.length).toBeGreaterThan(100);
    for (const arr of arrives) {
      // Le depart le plus récent du même habitant vers ce lieu, avant l’arrivée.
      const dep = [...R.events].reverse().find((e) => e.type === 'depart' && e.actors[0] === arr.actors[0] && e.t <= arr.t && e.data?.to === arr.locationId && e.id !== arr.id);
      expect(dep, `depart de ${arr.id}`).toBeDefined();
      expect(g.ancestors(arr.id).has(dep!.id), `${arr.id} (${arr.label}) devrait descendre de ${dep!.id}`).toBe(true);
    }
  });

  it('un arrive a le depart correspondant comme cause directe', () => {
    for (const arr of R.events.filter((e) => e.type === 'arrive')) {
      const direct = g.directCauses(arr.id);
      expect(direct.some((c) => c.type === 'depart' && c.actors[0] === arr.actors[0]), arr.id).toBe(true);
    }
  });

  it('les board_bus ont un bus_arrive pour cause (même bus, même arrêt)', () => {
    const boards = R.events.filter((e) => e.type === 'board_bus');
    expect(boards.length).toBeGreaterThan(3);
    for (const b of boards) {
      const arrive = g.directCauses(b.id).find((c) => c.type === 'bus_arrive' && c.busId === b.busId && c.locationId === b.locationId);
      expect(arrive, `${b.id} ${b.label}`).toBeDefined();
      expect(arrive!.t).toBe(b.t);
    }
  });

  it('les alight_bus ont aussi un bus_arrive comme cause (même bus, même arrêt)', () => {
    for (const a of R.events.filter((e) => e.type === 'alight_bus')) {
      const arrive = g.directCauses(a.id).find((c) => c.type === 'bus_arrive' && c.busId === a.busId && c.locationId === a.locationId);
      expect(arrive, a.id).toBeDefined();
    }
  });

  it('une arrivée en bus descend du board_bus de l’habitant', () => {
    for (const arr of R.events.filter((e) => e.type === 'arrive' && e.data?.mode === 'bus')) {
      const anc = g.ancestors(arr.id);
      const board = [...anc.keys()].map((id) => g.get(id)!).find((e) => e.type === 'board_bus' && e.actors[0] === arr.actors[0]);
      expect(board, arr.id).toBeDefined();
    }
  });

  it('les bus_depart / bus_arrive successifs d’un bus sont chaînés', () => {
    const arrives = R.events.filter((e) => e.type === 'bus_arrive' && e.busId === 'L1-1');
    expect(arrives.length).toBeGreaterThan(20);
    // On saute les départs de terminus à l’heure (racines légitimes) et on vérifie que chaque bus_arrive a au moins une cause.
    for (const a of arrives) expect(a.causes.length, a.id).toBeGreaterThanOrEqual(1);
  });
});

describe('meeting_missed et commitment_cancelled', () => {
  const R = runDay(NORMAL_SEED, [cancelAlice]);
  const g = R.causal;

  it('un rendez-vous manqué (après annulation) est produit et a au moins une cause', () => {
    const missed = R.events.filter((e) => e.type === 'meeting_missed');
    expect(missed.length).toBeGreaterThanOrEqual(1);
    for (const m of missed) expect(m.causes.length, `${m.id} ${m.label}`).toBeGreaterThanOrEqual(1);
  });

  it('le meeting_missed descend de l’événement d’annulation puis de l’intervention', () => {
    const missed = R.events.find((e) => e.type === 'meeting_missed' && e.data?.commitmentId === 'c_alice_sophie_lunch')!;
    const cancelled = R.events.find((e) => e.type === 'commitment_cancelled' && e.data?.commitmentId === 'c_alice_sophie_lunch')!;
    const intervention = R.events.find((e) => e.type === 'intervention')!;
    const anc = g.ancestors(missed.id);
    expect(anc.has(cancelled.id)).toBe(true);
    expect(anc.has(intervention.id)).toBe(true);
  });

  it('chain(intervention, meeting_missed) est un chemin dont chaque étape est une cause directe de la suivante', () => {
    const missed = R.events.find((e) => e.type === 'meeting_missed' && e.data?.commitmentId === 'c_alice_sophie_lunch')!;
    const intervention = R.events.find((e) => e.type === 'intervention')!;
    const path = g.chain(intervention.id, missed.id)!;
    expect(path).not.toBeNull();
    expect(path[0].id).toBe(intervention.id);
    expect(path.at(-1)!.id).toBe(missed.id);
    expect(path.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < path.length; i++) {
      expect(path[i].causes, `${path[i - 1].id} → ${path[i].id}`).toContain(path[i - 1].id);
      expect(g.directCauses(path[i].id).map((e) => e.id)).toContain(path[i - 1].id);
    }
  });
});

describe('meeting_missed : annulation par un participant déjà présent sur place', () => {
  // SUSPECTED BUG (engine.ts checkMeetingTimeout): when the person who cancelled is physically at the
  // venue anyway (Martin works at the office where the meeting takes place), `absent` is computed from
  // *location only*, so nobody is "absent": the event reads « manque « Réunion… » : Martin et Thomas a
  // attendu 17 min » (empty subject) and the `commitment_cancelled` event is NOT among its causes.
  // Repro: seed 42 + cancel_commitment(martin, c_martin_thomas, t=420) -> meeting_missed e(557) has
  // causes [e353, e238] without the commitment_cancelled event.
  it('le meeting_missed d’une réunion annulée par un participant présent cite l’annulation parmi ses ancêtres', () => {
    const R = runDay(NORMAL_SEED, [cancelMartin]);
    const missed = R.events.find((e) => e.type === 'meeting_missed' && e.data?.commitmentId === 'c_martin_thomas')!;
    const cancelled = R.events.find((e) => e.type === 'commitment_cancelled' && e.data?.commitmentId === 'c_martin_thomas')!;
    expect(missed).toBeDefined();
    expect(R.causal.ancestors(missed.id).has(cancelled.id)).toBe(true);
  });

  it('… mais il descend quand même de l’intervention et existe bien', () => {
    const R = runDay(NORMAL_SEED, [cancelMartin]);
    const missed = R.events.find((e) => e.type === 'meeting_missed' && e.data?.commitmentId === 'c_martin_thomas')!;
    const intervention = R.events.find((e) => e.type === 'intervention')!;
    expect(missed.causes.length).toBeGreaterThanOrEqual(1);
    expect(R.causal.ancestors(missed.id).has(intervention.id)).toBe(true);
  });
});

describe('Retards de bus et causalité', () => {
  const A = runDay(BUS_SEED);
  const arrival = findBoardingArrival(A.events) as SimEvent;
  const iv = busDelayFor(arrival, 3);
  const B = fork(A, iv);
  const g = B.causal;

  it('les bus_arrive en retard qui suivent un bus_delay du même bus l’ont parmi leurs ancêtres', () => {
    const delays = B.events.filter((e) => e.type === 'bus_delay' && e.interventionId);
    expect(delays.length).toBe(1);
    const d = delays[0];
    const late = B.events.filter((e) => e.type === 'bus_arrive' && e.busId === d.busId && Number(e.data?.delay) > 0 && e.t >= d.t && e.t <= d.t + 10);
    expect(late.length).toBeGreaterThanOrEqual(1);
    for (const l of late) {
      const hasDelay = [...g.ancestors(l.id).keys()].some((id) => g.get(id)?.type === 'bus_delay');
      expect(hasDelay, `${l.id} ${l.label}`).toBe(true);
    }
    // Le premier en retard descend directement de l’événement bus_delay de l’intervention.
    const first = late[0];
    expect(g.ancestors(first.id).has(d.id)).toBe(true);
  });

  it('tout bus_arrive en retard (delay > 0) a au moins un bus_delay en ancêtre dans cette réalité', () => {
    const lateArrivals = B.events.filter((e) => e.type === 'bus_arrive' && Number(e.data?.delay) > 0);
    expect(lateArrivals.length).toBeGreaterThan(0);
    const orphan = lateArrivals.filter((l) => ![...g.ancestors(l.id).keys()].some((id) => g.get(id)?.type === 'bus_delay'));
    expect(orphan.map((e) => `${e.id}@${e.t}: ${e.label}`)).toEqual([]);
  });

  it('les board_bus de l’habitant retardé descendent de l’intervention', () => {
    const boardAfter = B.events.find((e) => e.type === 'board_bus' && e.busId === arrival.busId && e.locationId === arrival.locationId && e.t >= iv.t);
    expect(boardAfter).toBeDefined();
    const ancestors = g.ancestors(boardAfter!.id);
    const interventionEvent = B.events.find((e) => e.type === 'intervention')!;
    expect(ancestors.has(interventionEvent.id)).toBe(true);
  });
});

describe('CausalGraph : requêtes', () => {
  const R = runDay(BUS_SEED, [cancelAlice]);
  const g: CausalGraph = R.causal;

  it('mostImpactful est trié par impact décroissant et respecte la limite', () => {
    const top = g.mostImpactful(10);
    expect(top).toHaveLength(10);
    for (let i = 1; i < top.length; i++) expect(top[i - 1].impact).toBeGreaterThanOrEqual(top[i].impact);
    for (const x of top) {
      expect(x.event).toBeDefined();
      expect(x.descendants).toBe(g.descendants(x.event.id).size);
      expect(x.impact).toBeCloseTo(g.impact(x.event.id), 9);
      expect(['day_start', 'bus_depart', 'bus_arrive']).not.toContain(x.event.type);
    }
  });

  it('mostImpactful applique le filtre fourni', () => {
    const top = g.mostImpactful(5, (e) => e.type === 'decision');
    expect(top.length).toBeGreaterThan(0);
    for (const x of top) expect(x.event.type).toBe('decision');
  });

  it('l’intervention a des descendants et un impact strictement positif', () => {
    const iv = R.events.find((e) => e.type === 'intervention')!;
    expect(g.descendants(iv.id).size).toBeGreaterThan(2);
    expect(g.impact(iv.id)).toBeGreaterThan(0);
    const ranked = g.mostImpactful(10_000);
    const entry = ranked.find((x) => x.event.id === iv.id)!;
    expect(entry.descendants).toBe(g.descendants(iv.id).size);
  });

  it('ancestors et descendants sont symétriques', () => {
    const iv = R.events.find((e) => e.type === 'intervention')!;
    for (const [d, depth] of g.descendants(iv.id)) {
      const up = g.ancestors(d);
      expect(up.has(iv.id), d).toBe(true);
      expect(up.get(iv.id)!).toBeLessThanOrEqual(depth);
    }
  });

  it('les profondeurs partent de 1 (cause directe) et maxDepth limite l’exploration', () => {
    const iv = R.events.find((e) => e.type === 'intervention')!;
    const direct = g.descendants(iv.id, 1);
    expect(direct.size).toBeGreaterThan(0);
    for (const d of direct.values()) expect(d).toBe(1);
    expect(g.descendants(iv.id).size).toBeGreaterThanOrEqual(direct.size);
  });

  it('chain(a, a) est réduit à l’événement, chain vers un non-descendant vaut null', () => {
    const iv = R.events.find((e) => e.type === 'intervention')!;
    expect(g.chain(iv.id, iv.id)!.map((e) => e.id)).toEqual([iv.id]);
    const first = R.events[0]; // day_start n'est pas un descendant de l'intervention
    expect(g.chain(iv.id, first.id)).toBeNull();
  });

  it('chain(from, to) existe pour chaque descendant, avec des étapes causales consécutives', () => {
    const iv = R.events.find((e) => e.type === 'intervention')!;
    const targets = [...g.descendants(iv.id).keys()].filter((_, i) => i % 3 === 0).slice(0, 15);
    expect(targets.length).toBeGreaterThan(0);
    for (const to of targets) {
      const path = g.chain(iv.id, to)!;
      expect(path, to).not.toBeNull();
      for (let i = 1; i < path.length; i++) expect(g.directCauses(path[i].id).map((e: SimEvent) => e.id)).toContain(path[i - 1].id);
      // Plus court chemin : sa longueur égale la profondeur BFS du descendant (+1 pour le départ).
      expect(path.length - 1).toBe(g.descendants(iv.id).get(to));
    }
  });

  it('descendsFromIntervention reconnaît l’intervention et ses conséquences, pas les événements sans lien', () => {
    const ivEvent = R.events.find((e) => e.type === 'intervention')!;
    const set = new Set([ivEvent.id]);
    expect(g.descendsFromIntervention(ivEvent.id, set)).toBe(true);
    const child = [...g.descendants(ivEvent.id).keys()][0];
    expect(g.descendsFromIntervention(child, set)).toBe(true);
    expect(g.descendsFromIntervention(R.events[0].id, set)).toBe(false);
    expect(g.descendsFromIntervention('inconnu', set)).toBe(false);
  });

  it('roots() ne renvoie que des événements sans cause, triés par temps', () => {
    const iv = R.events.find((e) => e.type === 'meeting_missed')!;
    const roots = g.roots(iv.id);
    expect(roots.length).toBeGreaterThan(0);
    for (const r of roots) expect(r.causes).toHaveLength(0);
    for (let i = 1; i < roots.length; i++) expect(roots[i].t).toBeGreaterThanOrEqual(roots[i - 1].t);
  });
});
