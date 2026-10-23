import { describe, expect, it, test } from 'vitest';
import { compareRealities } from '../src/sim/compare';
import { busDelayFor } from '../src/sim/interventions';
import { forkReality } from '../src/sim/reality';
import type { Intervention } from '../src/sim/types';
import { BUS_SEED, NORMAL_SEED, fork, profile, runDay } from './helpers';

describe('Branchement : retard de bus de 3 minutes (graine 29, bus de 08:20)', () => {
  const A = runDay(BUS_SEED);
  const arrival = A.events.find((e) => e.type === 'bus_arrive' && e.t === 500)!;
  const iv = busDelayFor(arrival, 3);
  const B = fork(A, iv, 'B');

  it('le bus de 08:20 existe dans la réalité A, avec un passager qui monte à la même minute', () => {
    expect(arrival).toBeDefined();
    expect(arrival.locationId).toBe('stop_lilas');
    expect(A.events.some((e) => e.type === 'board_bus' && e.t === 500 && e.busId === arrival.busId && e.locationId === arrival.locationId)).toBe(true);
  });

  it('l’intervention est posée une minute avant l’arrivée prévue', () => {
    expect(iv.kind).toBe('bus_delay');
    expect(iv.t).toBe(499);
    expect(iv).toMatchObject({ minutes: 3, busId: 'L1-1' });
  });

  it('tous les événements de B antérieurs à l’intervention sont identiques à ceux de A', () => {
    const before = (r: typeof A) => r.events.filter((e) => e.t < iv.t);
    const a = before(A);
    const b = before(B);
    expect(a.length).toBeGreaterThan(300);
    expect(b.length).toBe(a.length);
    expect(b.map((e) => `${e.id}|${e.t}|${e.label}`)).toEqual(a.map((e) => `${e.id}|${e.t}|${e.label}`));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('B contient un événement intervention et un bus_delay portant l’interventionId', () => {
    const interventions = B.events.filter((e) => e.type === 'intervention');
    expect(interventions).toHaveLength(1);
    expect(interventions[0].interventionId).toBe(iv.id);
    expect(interventions[0].t).toBe(iv.t);
    const delays = B.events.filter((e) => e.type === 'bus_delay' && e.interventionId === iv.id);
    expect(delays).toHaveLength(1);
    expect(delays[0].busId).toBe('L1-1');
    expect(delays[0].data?.minutes).toBe(3);
    expect(delays[0].causes).toContain(interventions[0].id);
  });

  it('A ne contient aucun événement d’intervention', () => {
    expect(A.events.some((e) => e.type === 'intervention' || e.interventionId)).toBe(false);
  });

  it('l’arrivée du bus à cet arrêt a lieu exactement 3 minutes plus tard dans B', () => {
    const inB = B.events.find((e) => e.type === 'bus_arrive' && e.signature === arrival.signature)!;
    expect(inB).toBeDefined();
    expect(inB.t - arrival.t).toBe(3);
    expect(inB.t).toBe(503);
    expect(inB.data?.delay).toBe(Number(arrival.data?.delay) + 3);
  });

  it('le passager qui attendait monte 3 minutes plus tard', () => {
    const boardA = A.events.find((e) => e.type === 'board_bus' && e.t === 500 && e.busId === arrival.busId && e.locationId === arrival.locationId)!;
    const boardB = B.events.find((e) => e.type === 'board_bus' && e.signature === boardA.signature && e.actors[0] === boardA.actors[0])!;
    expect(boardB.t - boardA.t).toBe(3);
  });

  it('compareRealities : première divergence à l’heure de l’intervention et conséquences vérifiées', () => {
    const cmp = compareRealities(A, B);
    expect(cmp.firstDivergence).not.toBeNull();
    const d = cmp.firstDivergence!;
    expect(Math.min(d.a?.t ?? Infinity, d.b?.t ?? Infinity)).toBe(iv.t);
    expect(cmp.interventionEvents).toHaveLength(1);
    expect(cmp.consequences.length).toBeGreaterThanOrEqual(1);
    expect(cmp.firstConsequence).not.toBeNull();
    expect(cmp.firstConsequence!.causal).toBe('verified');
    expect(cmp.affectedAgents).toContain('alice');
  });

  it('après la fin de la journée, B reste complète (même nombre de frames)', () => {
    expect(B.trace.length).toBe(A.trace.length);
    expect(B.engine.state.t).toBe(1440);
  });
});

describe('Branchement : l’historique passé est préservé pour tous les types d’intervention', () => {
  const A = runDay(NORMAL_SEED);
  const interventions: Intervention[] = [
    { id: 'p1', kind: 'stay_home', agentId: 'alice', t: 430, until: 480, description: 'stay' },
    { id: 'p2', kind: 'force_action', agentId: 'martin', t: 450, action: 'coffee', locationId: 'cafe', description: 'force' },
    { id: 'p3', kind: 'weather', t: 700, condition: 'rain', until: 800, description: 'rain' },
    { id: 'p4', kind: 'location_hours', locationId: 'bakery', t: 600, closes: 720, description: 'hours' },
    { id: 'p5', kind: 'cancel_commitment', agentId: 'alice', commitmentId: 'c_alice_sophie_lunch', t: 500, description: 'cancel' },
    { id: 'p6', kind: 'encounter', agentA: 'sophie', agentB: 'julien', locationId: 'park', t: 650, description: 'enc' },
    { id: 'p7', kind: 'agent_delay', agentId: 'martin', t: 470, minutes: 10, description: 'delay' },
    { id: 'p8', kind: 'bus_delay', busId: 'L1-1', t: 600, minutes: 4, description: 'bus' },
  ];

  it.each(interventions.map((i) => [i.kind, i] as const))('%s : B == A avant t', (_kind, iv) => {
    const B = fork(A, iv);
    const a = A.events.filter((e) => e.t < iv.t);
    const b = B.events.filter((e) => e.t < iv.t);
    expect(b.length).toBe(a.length);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    const root = B.events.find((e) => e.type === 'intervention');
    expect(root, 'événement racine').toBeDefined();
    expect(root!.t).toBe(iv.t);
    expect(root!.interventionId).toBe(iv.id);
    // Les états avant l’intervention sont les mêmes.
    expect(JSON.stringify(B.frameAt(iv.t - 1))).toBe(JSON.stringify(A.frameAt(iv.t - 1)));
  });

  it('forkReality conserve la graine et ajoute l’intervention aux précédentes', () => {
    const first = interventions[0];
    const B1 = forkReality(A, first, 'B1', 'B1');
    const B2 = forkReality(B1, interventions[2], 'B2', 'B2');
    expect(B2.def.seed).toBe(A.def.seed);
    expect(B2.def.interventions.map((i) => i.id)).toEqual(['p1', 'p3']);
    expect(A.def.interventions).toHaveLength(0);
  });
});

describe('Intervention stay_home', () => {
  const A = runDay(NORMAL_SEED);
  const alice = profile('alice');

  it('Alice reste chez elle entre t et until (fenêtre courte)', () => {
    const iv: Intervention = { id: 'sh1', kind: 'stay_home', agentId: 'alice', t: 420, until: 480, description: 'Alice reste chez elle' };
    const B = fork(A, iv);
    for (const m of [420, 430, 450, 470, 479]) {
      const s = B.stateAt(m).agents.alice;
      expect(s.locationId, `à ${m}`).toBe(alice.homeId);
      expect(s.travel, `à ${m}`).toBeNull();
    }
  });

  it('Alice, qui sortait normalement, reste chez elle pendant que la même fenêtre est vide en A', () => {
    // En A, Alice a quitté son domicile avant 09:00 ; en B (restée chez elle jusqu’à 08:30) elle part plus tard.
    const iv: Intervention = { id: 'sh2', kind: 'stay_home', agentId: 'alice', t: 360, until: 510, description: 'Alice reste chez elle' };
    const B = fork(A, iv);
    const leaveA = A.events.find((e) => e.type === 'depart' && e.actors[0] === 'alice')!;
    const leaveB = B.events.find((e) => e.type === 'depart' && e.actors[0] === 'alice');
    expect(leaveB === undefined || leaveB.t >= leaveA.t).toBe(true);
    for (const m of [380, 440, 480, 505]) expect(B.stateAt(m).agents.alice.locationId).toBe(alice.homeId);
  });

  it('un habitant déjà chez lui reste chez lui : confinedUntil est positionné', () => {
    const iv: Intervention = { id: 'sh3', kind: 'stay_home', agentId: 'alice', t: 420, until: 480, description: 'x' };
    const B = fork(A, iv);
    expect(B.stateAt(421).agents.alice.confinedUntil).toBe(480);
  });

  // SUSPECTED BUG (decision.ts UtilityPolicy.decide: `valid[0] ?? candidates[0]`): when *every*
  // candidate is rejected the policy still picks candidates[0], i.e. a rejected option. For a stay_home
  // intervention covering a work commitment ("Et si Alice ne quittait pas son appartement ce matin ?"
  // until 12:00) all home options are rejected ("Pas le temps avant « Travail — Agence Horizon »")
  // and the work option is rejected ("Doit rester à la maison (intervention)"); the rejected work option
  // is chosen anyway: at 09:00 Alice walks to the office (arrives 09:10, "en retard") although she
  // must stay home until 12:00.  Repro: seed 42, stay_home(alice, t=360, until=720).
  test.fails('« ne quitte pas son appartement ce matin » : Alice reste chez elle jusqu’à 12:00 (bug suspecté)', () => {
    const iv: Intervention = { id: 'sh4', kind: 'stay_home', agentId: 'alice', t: 360, until: 720, description: 'Alice reste chez elle ce matin' };
    const B = fork(A, iv);
    const away: string[] = [];
    for (let m = 360; m < 720; m += 10) {
      const s = B.stateAt(m).agents.alice;
      if (s.locationId !== alice.homeId) away.push(`${m}: ${s.locationId}`);
    }
    expect(away).toEqual([]);
  });
});

describe('Intervention force_action', () => {
  const A = runDay(NORMAL_SEED);

  it('Martin décide de prendre un café : decision + activity_start coffee peu après t', () => {
    const iv: Intervention = { id: 'fa1', kind: 'force_action', agentId: 'martin', t: 420, action: 'coffee', locationId: 'cafe', description: 'Martin prend un café' };
    const B = fork(A, iv);
    const decision = B.events.find((e) => e.type === 'decision' && e.actors[0] === 'martin' && e.t >= iv.t && e.data?.action === 'coffee');
    expect(decision, 'décision « coffee »').toBeDefined();
    expect(decision!.t - iv.t).toBeLessThanOrEqual(5);
    expect(decision!.data?.target).toBe('cafe');
    const start = B.events.find((e) => e.type === 'activity_start' && e.actors[0] === 'martin' && e.t >= iv.t && e.data?.action === 'coffee');
    expect(start, 'activity_start « coffee »').toBeDefined();
    expect(start!.t - iv.t).toBeLessThanOrEqual(15);
    expect(start!.locationId).toBe('cafe');
    // Il part de l’intervention : cause chaînée.
    const root = B.events.find((e) => e.type === 'intervention')!;
    expect(B.causal.ancestors(start!.id).has(root.id)).toBe(true);
  });

  it('en A, Martin ne prend pas de café à ce moment-là', () => {
    expect(A.events.some((e) => e.type === 'activity_start' && e.actors[0] === 'martin' && e.data?.action === 'coffee' && e.t >= 420 && e.t < 480)).toBe(false);
  });

  it('une action forcée vers un lieu (parc) place l’habitant dans ce lieu', () => {
    const iv: Intervention = { id: 'fa2', kind: 'force_action', agentId: 'martin', t: 420, action: 'relax_park', locationId: 'park', description: 'Martin va au parc' };
    const B = fork(A, iv);
    const start = B.events.find((e) => e.type === 'activity_start' && e.actors[0] === 'martin' && e.data?.action === 'relax_park' && e.t >= iv.t);
    expect(start).toBeDefined();
    expect(B.stateAt(start!.t + 1).agents.martin.locationId).toBe('park');
  });
});

describe('Intervention weather', () => {
  const A = runDay(NORMAL_SEED);
  const iv: Intervention = { id: 'w1', kind: 'weather', t: 840, condition: 'rain', until: 930, description: 'La pluie commence à 14 h' };
  const B = fork(A, iv);

  it('produit un événement weather à t, rattaché à l’intervention', () => {
    const w = B.events.filter((e) => e.type === 'weather');
    expect(w[0].t).toBe(840);
    expect(w[0].interventionId).toBe('w1');
    expect(w[0].effects).toEqual([{ kind: 'weather', value: 'rain' }]);
    const root = B.events.find((e) => e.type === 'intervention')!;
    expect(w[0].causes).toContain(root.id);
  });

  it('state.weather vaut « rain » pendant la pluie, « clear » avant et après', () => {
    expect(B.stateAt(839).weather).toBe('clear');
    expect(B.stateAt(840).weather).toBe('clear');
    expect(B.stateAt(841).weather).toBe('rain');
    expect(B.stateAt(900).weather).toBe('rain');
    expect(B.stateAt(931).weather).toBe('clear');
    expect(B.frameAt(900)!.weather).toBe('rain');
  });

  it('la pluie sans fin reste jusqu’à minuit', () => {
    const C = fork(A, { id: 'w2', kind: 'weather', t: 840, condition: 'rain', description: 'pluie' });
    expect(C.engine.state.weather).toBe('rain');
    expect(C.events.filter((e) => e.type === 'weather')).toHaveLength(1);
  });

  it('un événement weather de rétablissement apparaît à la fin de la pluie', () => {
    const w = B.events.filter((e) => e.type === 'weather');
    expect(w.map((e) => e.t)).toEqual([840, 930]);
    expect(w[1].label).toMatch(/cesse/i);
  });
});

describe('Intervention location_hours', () => {
  const A = runDay(NORMAL_SEED);

  it('fermer la boulangerie à midi produit un shop_closed à 720', () => {
    const iv: Intervention = { id: 'lh1', kind: 'location_hours', locationId: 'bakery', t: 360, closes: 720, description: 'La boulangerie ferme à midi' };
    const B = fork(A, iv);
    const closed = B.events.find((e) => e.type === 'shop_closed' && e.locationId === 'bakery');
    expect(closed).toBeDefined();
    expect(closed!.t).toBe(720);
    expect(closed!.interventionId).toBe('lh1');
    expect(B.stateAt(721).locations.bakery.closedEarlyAt).toBe(720);
    // En A elle ferme bien plus tard (stock épuisé).
    const closedA = A.events.find((e) => e.type === 'shop_closed' && e.locationId === 'bakery')!;
    expect(closedA.t).toBeGreaterThan(720);
  });

  it('personne n’achète à la boulangerie fermée après 720', () => {
    const iv: Intervention = { id: 'lh1b', kind: 'location_hours', locationId: 'bakery', t: 360, closes: 720, description: 'x' };
    const B = fork(A, iv);
    const late = B.events.filter((e) => e.type === 'purchase' && e.locationId === 'bakery' && e.t > 722 && e.actors.length > 0);
    expect(late).toEqual([]);
  });

  it('les habitants qui arrivent ensuite trouvent le lieu fermé (found_closed) — café fermé à midi', () => {
    const iv: Intervention = { id: 'lh2', kind: 'location_hours', locationId: 'cafe', t: 360, closes: 720, description: 'Le café ferme à midi' };
    const B = fork(A, iv);
    const closed = B.events.find((e) => e.type === 'shop_closed' && e.locationId === 'cafe')!;
    expect(closed.t).toBe(720);
    const found = B.events.filter((e) => e.type === 'found_closed' && e.locationId === 'cafe');
    expect(found.length).toBeGreaterThanOrEqual(1);
    for (const f of found) {
      expect(f.t).toBeGreaterThan(720);
      expect(B.causal.ancestors(f.id).has(closed.id), f.label).toBe(true);
    }
    // Ces visites n’aboutissent à aucun café acheté après la fermeture.
    expect(B.events.some((e) => e.type === 'purchase' && e.locationId === 'cafe' && e.t > 722)).toBe(false);
  });
});

describe('Intervention cancel_commitment', () => {
  const A = runDay(NORMAL_SEED);
  const iv: Intervention = { id: 'cc1', kind: 'cancel_commitment', agentId: 'alice', commitmentId: 'c_alice_sophie_lunch', t: 420, description: 'Alice oublie le déjeuner' };
  const B = fork(A, iv);

  it('provoque un commitment_cancelled puis un meeting_missed pour cet engagement', () => {
    const cancelled = B.events.find((e) => e.type === 'commitment_cancelled' && e.data?.commitmentId === 'c_alice_sophie_lunch')!;
    expect(cancelled).toBeDefined();
    expect(cancelled.t).toBe(420);
    expect(cancelled.interventionId).toBe('cc1');
    const missed = B.events.find((e) => e.type === 'meeting_missed' && e.data?.commitmentId === 'c_alice_sophie_lunch')!;
    expect(missed).toBeDefined();
    expect(missed.t).toBeGreaterThan(750);
    expect(B.events.some((e) => e.type === 'meeting_start' && e.data?.commitmentId === 'c_alice_sophie_lunch')).toBe(false);
  });

  it('en A, ce même déjeuner a bien lieu', () => {
    expect(A.events.some((e) => e.type === 'meeting_start' && e.data?.commitmentId === 'c_alice_sophie_lunch')).toBe(true);
    expect(A.events.some((e) => e.type === 'meeting_missed' && e.data?.commitmentId === 'c_alice_sophie_lunch')).toBe(false);
  });

  it('l’état final marque l’engagement comme manqué chez les deux participantes', () => {
    const s = B.engine.state;
    expect(s.agents.alice.commitments.find((c) => c.id === 'c_alice_sophie_lunch')!.status).toBe('missed');
    expect(s.agents.sophie.commitments.find((c) => c.id === 'c_alice_sophie_lunch')!.status).toBe('missed');
  });

  it('sans commitmentId, le prochain rendez-vous en attente est annulé', () => {
    const C = fork(A, { id: 'cc2', kind: 'cancel_commitment', agentId: 'gerard', t: 420, description: 'Gérard oublie' });
    const cancelled = C.events.find((e) => e.type === 'commitment_cancelled' && e.actors[0] === 'gerard')!;
    expect(cancelled).toBeDefined();
    expect(cancelled.data?.commitmentId).toBe('c_gerard_doc'); // le prochain, 09:00
  });
});

describe('Interventions agent_delay et encounter', () => {
  const A = runDay(NORMAL_SEED);

  it('agent_delay : Martin s’attarde, et l’événement dépend de l’intervention', () => {
    const iv: Intervention = { id: 'ad1', kind: 'agent_delay', agentId: 'martin', t: 440, minutes: 10, description: 'Martin traîne' };
    const B = fork(A, iv);
    const root = B.events.find((e) => e.type === 'intervention')!;
    const direct = B.events.filter((e) => e.interventionId === 'ad1' && e.id !== root.id);
    expect(direct.length).toBeGreaterThanOrEqual(1);
    for (const e of direct) expect(B.causal.ancestors(e.id).has(root.id)).toBe(true);
  });

  it('encounter : Sophie et Julien se rejoignent au parc', () => {
    const iv: Intervention = { id: 'en1', kind: 'encounter', agentA: 'sophie', agentB: 'julien', locationId: 'park', t: 600, description: 'Sophie retrouve Julien au parc' };
    const B = fork(A, iv);
    const decisions = B.events.filter((e) => e.type === 'decision' && e.t === 600 && (e.actors[0] === 'sophie' || e.actors[0] === 'julien'));
    expect(decisions).toHaveLength(2);
    for (const d of decisions) expect(d.data?.target).toBe('park');
    const together = B.events.find((e) => ['encounter', 'conversation', 'argument', 'meeting_start'].includes(e.type) && e.actors.includes('sophie') && e.actors.includes('julien') && e.locationId === 'park' && e.t >= 600);
    expect(together, 'rencontre au parc').toBeDefined();
    expect(together!.t - 600).toBeLessThanOrEqual(30);
  });
});
