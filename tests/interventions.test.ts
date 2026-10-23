import type { SimEvent } from '../src/sim/types';
import { describe, expect, it } from 'vitest';
import { INTERVENTION_TEMPLATES, busDelayFor, findAgent, findLocation, interpretFrench, normalize, validateIntervention } from '../src/sim/interventions';
import { AGENTS } from '../src/sim/population';
import type { Intervention } from '../src/sim/types';
import { BUS_SEED, NORMAL_SEED, fork, runDay, findBoardingArrival } from './helpers';

const A = runDay(NORMAL_SEED);
const ctx = { t: 500, events: A.events };

describe('INTERVENTION_TEMPLATES', () => {
  it('propose huit modèles couvrant les huit types d’intervention', () => {
    expect(INTERVENTION_TEMPLATES).toHaveLength(8);
    expect(new Set(INTERVENTION_TEMPLATES.map((t) => t.kind))).toEqual(new Set(['bus_delay', 'stay_home', 'force_action', 'location_hours', 'encounter', 'weather', 'cancel_commitment', 'agent_delay']));
    expect(new Set(INTERVENTION_TEMPLATES.map((t) => t.id)).size).toBe(8);
  });

  it.each(INTERVENTION_TEMPLATES.map((t) => [t.id, t] as const))('l’exemple « %s » est interprété (ok === true) et du bon type', (_id, tpl) => {
    const r = interpretFrench(tpl.example, ctx);
    expect(r.ok, `${tpl.example} → ${r.explanation} ${r.issues.join(' / ')}`).toBe(true);
    expect(r.intervention).toBeDefined();
    expect(r.intervention!.kind).toBe(tpl.kind);
    expect(r.issues).toEqual([]);
    expect(r.confidence).toBeGreaterThan(0.5);
    expect(r.explanation.length).toBeGreaterThan(5);
    expect(validateIntervention(r.intervention!)).toEqual([]);
  });

  it('les interventions issues des modèles s’exécutent de bout en bout (événement racine émis)', () => {
    for (const tpl of INTERVENTION_TEMPLATES) {
      const iv = interpretFrench(tpl.example, ctx).intervention!;
      const B = fork(A, iv);
      const root = B.events.find((e) => e.type === 'intervention');
      expect(root, tpl.id).toBeDefined();
      expect(root!.interventionId).toBe(iv.id);
      expect(root!.t).toBe(iv.t);
    }
  });
});

describe('interpretFrench : phrases précises', () => {
  it('« Et si le bus avait trois minutes de retard ? » → bus_delay de 3 minutes', () => {
    const r = interpretFrench('Et si le bus avait trois minutes de retard ?', ctx);
    expect(r.ok).toBe(true);
    const iv = r.intervention as Extract<Intervention, { kind: 'bus_delay' }>;
    expect(iv.kind).toBe('bus_delay');
    expect(iv.minutes).toBe(3);
    expect(iv.busId).toMatch(/^L1-[12]$/);
    expect(iv.t).toBeGreaterThanOrEqual(500 - 1);
  });

  it('les chiffres sont compris aussi (« 10 minutes »)', () => {
    const r = interpretFrench('Et si le bus avait 10 minutes de retard ?', ctx);
    expect((r.intervention as Extract<Intervention, { kind: 'bus_delay' }>).minutes).toBe(10);
  });

  it('le retard de bus cible l’arrivée de bus sélectionnée quand il y en a une', () => {
    const arrival = findBoardingArrival(runDay(BUS_SEED).events) as SimEvent;
    const r = interpretFrench('Et si le bus avait trois minutes de retard ?', { t: 400, selectedEvent: arrival });
    const iv = r.intervention as Extract<Intervention, { kind: 'bus_delay' }>;
    expect(iv.busId).toBe(arrival.busId);
    expect(iv.t).toBe(arrival.t - 1);
  });

  it('sans événements ni sélection, un retard de bus n’est pas interprétable et explique pourquoi', () => {
    const r = interpretFrench('Et si le bus avait trois minutes de retard ?', { t: 500 });
    expect(r.ok).toBe(false);
    expect(r.intervention).toBeUndefined();
    expect(r.issues.length).toBeGreaterThan(0);
  });

  it('« Et si Alice ne quittait pas son appartement ce matin ? » → stay_home alice jusqu’à 12:00', () => {
    const r = interpretFrench('Et si Alice ne quittait pas son appartement ce matin ?', ctx);
    const iv = r.intervention as Extract<Intervention, { kind: 'stay_home' }>;
    expect(r.ok).toBe(true);
    expect(iv.kind).toBe('stay_home');
    expect(iv.agentId).toBe('alice');
    expect(iv.until).toBe(720);
    expect(iv.t).toBe(500);
  });

  it('« Et si Martin décidait de prendre un café plutôt que d’aller travailler ? » → force_action martin coffee', () => {
    const r = interpretFrench('Et si Martin décidait de prendre un café plutôt que d’aller travailler ?', ctx);
    const iv = r.intervention as Extract<Intervention, { kind: 'force_action' }>;
    expect(r.ok).toBe(true);
    expect(iv.kind).toBe('force_action');
    expect(iv.agentId).toBe('martin');
    expect(iv.action).toBe('coffee');
    expect(iv.locationId).toBe('cafe');
  });

  it('« Et si la boulangerie fermait à midi ? » → location_hours bakery closes 720', () => {
    const r = interpretFrench('Et si la boulangerie fermait à midi ?', ctx);
    const iv = r.intervention as Extract<Intervention, { kind: 'location_hours' }>;
    expect(r.ok).toBe(true);
    expect(iv.kind).toBe('location_hours');
    expect(iv.locationId).toBe('bakery');
    expect(iv.closes).toBe(720);
  });

  it('une fermeture sans lieu ou sans heure est refusée avec une question', () => {
    const noPlace = interpretFrench('Et si ça fermait à midi ?', ctx);
    expect(noPlace.ok).toBe(false);
    expect(noPlace.issues.join(' ')).toMatch(/lieu/i);
    const noTime = interpretFrench('Et si la boulangerie fermait ?', ctx);
    expect(noTime.ok).toBe(false);
    expect(noTime.issues.join(' ')).toMatch(/heure/i);
  });

  it('« Et si Sophie retrouvait son ancien amoureux au parc ? » → encounter sophie / julien au parc', () => {
    const r = interpretFrench('Et si Sophie retrouvait son ancien amoureux au parc ?', ctx);
    const iv = r.intervention as Extract<Intervention, { kind: 'encounter' }>;
    expect(r.ok).toBe(true);
    expect(iv.kind).toBe('encounter');
    expect(new Set([iv.agentA, iv.agentB])).toEqual(new Set(['sophie', 'julien']));
    expect(iv.agentA).toBe('sophie');
    expect(iv.locationId).toBe('park');
  });

  it('« Et si la pluie commençait à 14 h ? » → weather rain à 840', () => {
    const r = interpretFrench('Et si la pluie commençait à 14 h ?', ctx);
    const iv = r.intervention as Extract<Intervention, { kind: 'weather' }>;
    expect(r.ok).toBe(true);
    expect(iv.kind).toBe('weather');
    expect(iv.condition).toBe('rain');
    expect(iv.t).toBe(840);
    expect(iv.until).toBe(930);
  });

  it('« Et si la pluie s’arrêtait à 15h ? » → weather clear à 900', () => {
    const iv = interpretFrench('Et si la pluie s’arrêtait à 15h ?', ctx).intervention as Extract<Intervention, { kind: 'weather' }>;
    expect(iv.condition).toBe('clear');
    expect(iv.t).toBe(900);
  });

  it('« Et si Gérard oubliait son rendez-vous ? » → cancel_commitment gerard', () => {
    const iv = interpretFrench('Et si Gérard oubliait son rendez-vous ?', ctx).intervention as Extract<Intervention, { kind: 'cancel_commitment' }>;
    expect(iv.kind).toBe('cancel_commitment');
    expect(iv.agentId).toBe('gerard');
  });

  it('« Et si Léa partait dix minutes plus tard ? » → agent_delay lea 10', () => {
    const iv = interpretFrench('Et si Léa partait dix minutes plus tard ?', ctx).intervention as Extract<Intervention, { kind: 'agent_delay' }>;
    expect(iv.kind).toBe('agent_delay');
    expect(iv.agentId).toBe('lea');
    expect(iv.minutes).toBe(10);
  });

  it('est insensible à la casse et aux accents', () => {
    const r = interpretFrench('ET SI ALICE NE QUITTAIT PAS SON APPARTEMENT CE MATIN ?', ctx);
    expect(r.ok).toBe(true);
    expect((r.intervention as Extract<Intervention, { kind: 'stay_home' }>).agentId).toBe('alice');
    const r2 = interpretFrench('Et si Gerard oubliait son rendez vous ?', ctx);
    expect(r2.intervention?.kind).toBe('cancel_commitment');
  });

  it('chaque interprétation produit un identifiant unique', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) ids.add(interpretFrench('Et si la boulangerie fermait à midi ?', ctx).intervention!.id);
    expect(ids.size).toBe(5);
  });
});

describe('interpretFrench : textes incompréhensibles', () => {
  it.each(['blablabla', 'Quel temps fait-il ?', '', '   ', '???', 'Et si on mangeait des pommes ?'])('« %s » → ok false avec des explications', (text) => {
    const r = interpretFrench(text, ctx);
    expect(r.ok).toBe(false);
    expect(r.intervention).toBeUndefined();
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.explanation.length).toBeGreaterThan(0);
    expect(r.confidence).toBeLessThan(0.5);
  });

  it('un habitant reconnu mais sans action reconnue reste refusé avec une confiance faible', () => {
    const r = interpretFrench('Et si Alice faisait le poirier ?', ctx);
    expect(r.ok).toBe(false);
    expect(r.explanation).toContain('Alice');
    expect(r.issues.length).toBeGreaterThan(0);
  });

  it('ne jette jamais d’exception, quel que soit le texte', () => {
    const weird = ['\u0000', 'é'.repeat(5000), '😀😀', 'Et si <script>alert(1)</script> ?', 'Et si Alice Alice Alice Alice ?', 'bus bus bus retard retard', 'ferme ferme ferme', 'à 99h99', 'Et si la pluie commençait à 25 h ?'];
    for (const w of weird) expect(() => interpretFrench(w, ctx)).not.toThrow();
    for (const w of weird) expect(() => interpretFrench(w, { t: 0 })).not.toThrow();
  });

  it('une heure hors de la journée n’est pas reprise telle quelle (météo à 25 h → heure courante)', () => {
    const iv = interpretFrench('Et si la pluie commençait à 25 h ?', ctx).intervention as Extract<Intervention, { kind: 'weather' }>;
    expect(iv.t).toBe(500);
  });
});

describe('Utilitaires de recherche', () => {
  it('normalize retire accents, casse et apostrophes', () => {
    expect(normalize('  L’École  Jules-FERRY ')).toBe('l ecole jules-ferry');
  });

  it('findAgent retrouve chacun des 20 prénoms', () => {
    for (const a of AGENTS) expect(findAgent(`Et si ${a.firstName} sortait ?`)).toBe(a.id);
    expect(findAgent('personne ici')).toBeNull();
  });

  it('findLocation associe des mots aux lieux', () => {
    expect(findLocation('à la boulangerie')).toBe('bakery');
    expect(findLocation('au parc')).toBe('park');
    expect(findLocation('chez Lucie, le restaurant')).toBe('restaurant');
    expect(findLocation('rien')).toBeNull();
  });
});

describe('validateIntervention', () => {
  const base = { id: 'v', description: 'test' };

  it('accepte des interventions bien formées', () => {
    expect(validateIntervention({ ...base, kind: 'bus_delay', t: 500, minutes: 3, busId: 'L1-1' })).toEqual([]);
    expect(validateIntervention({ ...base, kind: 'stay_home', agentId: 'alice', t: 400, until: 720 })).toEqual([]);
    expect(validateIntervention({ ...base, kind: 'weather', t: 840, condition: 'rain' })).toEqual([]);
    expect(validateIntervention({ ...base, kind: 'location_hours', locationId: 'bakery', t: 600, closes: 720 })).toEqual([]);
    expect(validateIntervention({ ...base, kind: 'encounter', agentA: 'sophie', agentB: 'julien', locationId: 'park', t: 600 })).toEqual([]);
  });

  it('rejette les heures hors de la journée simulée', () => {
    for (const t of [0, 359, 1440, 2000, -5]) {
      const errs = validateIntervention({ ...base, kind: 'weather', t, condition: 'rain' });
      expect(errs.length, `t=${t}`).toBeGreaterThan(0);
      expect(errs[0]).toMatch(/hors de la journée/);
    }
    expect(validateIntervention({ ...base, kind: 'weather', t: 360, condition: 'rain' })).toEqual([]);
    expect(validateIntervention({ ...base, kind: 'weather', t: 1439, condition: 'rain' })).toEqual([]);
  });

  it('rejette un habitant inconnu', () => {
    expect(validateIntervention({ ...base, kind: 'stay_home', agentId: 'bob', t: 400, until: 500 }).join(' ')).toMatch(/Habitant inconnu/);
    expect(validateIntervention({ ...base, kind: 'cancel_commitment', agentId: 'zorro', t: 400 }).length).toBeGreaterThan(0);
    expect(validateIntervention({ ...base, kind: 'encounter', agentA: 'alice', agentB: 'nobody', locationId: 'park', t: 600 }).length).toBeGreaterThan(0);
  });

  it('rejette un retard de bus de 0 minute (et hors de 1–60)', () => {
    for (const minutes of [0, -3, 61, 1000]) {
      expect(validateIntervention({ ...base, kind: 'bus_delay', t: 500, minutes, busId: 'L1-1' }).join(' '), `minutes=${minutes}`).toMatch(/entre 1 et 60/);
    }
    expect(validateIntervention({ ...base, kind: 'bus_delay', t: 500, minutes: 1, busId: 'L1-1' })).toEqual([]);
    expect(validateIntervention({ ...base, kind: 'bus_delay', t: 500, minutes: 60, busId: 'L1-1' })).toEqual([]);
  });

  it('rejette un bus ou un lieu inconnu', () => {
    expect(validateIntervention({ ...base, kind: 'bus_delay', t: 500, minutes: 3, busId: 'bus9' }).join(' ')).toMatch(/Bus inconnu/);
    expect(validateIntervention({ ...base, kind: 'location_hours', locationId: 'nowhere', t: 600, closes: 700 }).join(' ')).toMatch(/Lieu inconnu/);
  });

  it('rejette stay_home dont la fin précède le début, et une rencontre avec soi-même', () => {
    expect(validateIntervention({ ...base, kind: 'stay_home', agentId: 'alice', t: 500, until: 500 }).join(' ')).toMatch(/fin/);
    expect(validateIntervention({ ...base, kind: 'encounter', agentA: 'alice', agentB: 'alice', locationId: 'park', t: 500 }).join(' ')).toMatch(/différentes/);
  });

  it('rejette une heure de fermeture hors de la journée', () => {
    expect(validateIntervention({ ...base, kind: 'location_hours', locationId: 'bakery', t: 400, closes: 100 }).length).toBeGreaterThan(0);
  });

  it('cumule plusieurs erreurs', () => {
    const errs = validateIntervention({ ...base, kind: 'bus_delay', t: 10, minutes: 0, busId: 'x' });
    expect(errs.length).toBe(3);
  });
});

describe('busDelayFor', () => {
  const arrival = findBoardingArrival(runDay(BUS_SEED).events) as SimEvent;

  it('crée un bus_delay une minute avant l’arrivée visée', () => {
    const iv = busDelayFor(arrival, 4) as Extract<Intervention, { kind: 'bus_delay' }>;
    expect(iv.kind).toBe('bus_delay');
    expect(iv.t).toBe(arrival.t - 1);
    expect(iv.minutes).toBe(4);
    expect(iv.busId).toBe(arrival.busId);
    expect(iv.description).toContain('4 min');
    expect(validateIntervention(iv)).toEqual([]);
  });

  it('ne place jamais l’intervention avant 06:00', () => {
    const early = { ...arrival, t: 360 };
    expect(busDelayFor(early, 2).t).toBe(360);
  });
});
