import { describe, expect, it } from 'vitest';
import { interpretFrench } from '../src/sim/interventions';
import type { Intervention, SimEvent } from '../src/sim/types';
import { DAY_START } from '../src/sim/types';
import { BUS_SEED, fork, runDay } from './helpers';

const A = runDay(BUS_SEED);
const ctx = { t: DAY_START, selectedEvent: null, recentEvents: [] as SimEvent[] };

describe('Incidents du monde : mécaniques réelles', () => {
  it('un accident conduit l’habitant à la clinique, le retient et prévient ses proches', () => {
    const iv: Intervention = { id: 'acc', kind: 'accident', agentId: 'gerard', t: 600, minutes: 120, description: 'x' };
    const B = fork(A, iv);
    const ev = B.events.find((e) => e.type === 'accident')!;
    expect(ev.gravity).toBe(3);
    expect(ev.actors).toEqual(['gerard']);
    const s = B.stateAt(601).agents.gerard;
    expect(s.locationId).toBe('clinic');
    expect(s.heldUntil).toBe(720);
    expect(B.stateAt(700).agents.gerard.locationId).toBe('clinic');
    // Noé (famille) apprend la nouvelle.
    expect(B.stateAt(601).agents.noe.memories.some((m) => /accident/.test(m.text))).toBe(true);
    expect(B.stateAt(601).agents.noe.emotions.mood).toBeLessThan(A.stateAt(601).agents.noe.emotions.mood);
  });

  it('un incendie ferme le lieu pour la journée, évacue les présents et fait manquer les engagements', () => {
    const iv: Intervention = { id: 'fire', kind: 'fire', locationId: 'cafe', t: 11 * 60, description: 'x' };
    const B = fork(A, iv);
    const ev = B.events.find((e) => e.type === 'fire')!;
    expect(ev.gravity).toBe(3);
    expect(B.stateAt(661).locations.cafe.closes).toBe(660);
    for (const a of Object.values(B.stateAt(662).agents)) expect(a.locationId === 'cafe' && !a.asleep && a.activity).toBeFalsy();
    for (const e of B.events.filter((e) => e.type === 'arrive' && e.locationId === 'cafe' && e.t > 661)) {
      expect(B.events.some((x) => x.type === 'found_closed' && x.actors[0] === e.actors[0] && x.t === e.t)).toBe(true);
    }
    const missed = B.events.filter((e) => e.type === 'meeting_missed' && e.locationId === 'cafe' && e.t >= 660);
    expect(missed.length).toBeGreaterThan(0);
  });

  it('un vol retire le portefeuille et l’argent, et crée une course à la mairie', () => {
    const iv: Intervention = { id: 'theft', kind: 'theft', agentId: 'mireille', t: 10 * 60, description: 'x' };
    const B = fork(A, iv);
    const s = B.stateAt(601).agents.mireille;
    expect(s.inventory).not.toContain('wallet');
    expect(s.money).toBe(Math.max(0, A.stateAt(600).agents.mireille.money - 40));
    expect(s.commitments.some((c) => c.id === 'theft_mireille')).toBe(true);
    expect(B.events.find((e) => e.type === 'theft')!.gravity).toBe(2);
  });

  it('une rupture change les relations, annule les rendez-vous partagés et pèse sur l’humeur', () => {
    const iv: Intervention = { id: 'brk', kind: 'breakup', agentA: 'chloe', agentB: 'antoine', t: 9 * 60, description: 'x' };
    const B = fork(A, iv);
    const s = B.stateAt(541);
    expect(s.agents.chloe.relationships.antoine.kind).toBe('ex');
    expect(s.agents.antoine.relationships.chloe.kind).toBe('ex');
    expect(s.agents.chloe.commitments.find((c) => c.id === 'c_chloe_antoine_dinner')!.status).toBe('cancelled');
    expect(s.agents.chloe.emotions.mood).toBeLessThan(A.stateAt(541).agents.chloe.emotions.mood - 0.3);
    expect(B.engine.state.arcs['arc_chloe_diner'].status).not.toBe('fulfilled');
  });

  it('un renvoi annule le travail du jour ; une promotion enrichit et réjouit', () => {
    const fired = fork(A, { id: 'dis', kind: 'dismissal', agentId: 'alice', t: 10 * 60, description: 'x' });
    const s = fired.stateAt(601).agents.alice;
    expect(s.commitments.find((c) => c.id === 'w_alice')!.status).toBe('cancelled');
    expect(fired.events.some((e) => e.type === 'work_start' && e.actors[0] === 'alice' && e.t > 600 && !e.data?.resuming)).toBe(false);
    const promoted = fork(A, { id: 'pro', kind: 'promotion', agentId: 'martin', t: 10 * 60, description: 'x' });
    expect(promoted.stateAt(601).agents.martin.money).toBe(A.stateAt(600).agents.martin.money + 100);
    expect(promoted.stateAt(601).agents.martin.emotions.mood).toBeGreaterThan(A.stateAt(600).agents.martin.emotions.mood);
  });

  it('un malaise renvoie l’habitant chez lui pour la durée indiquée', () => {
    const B = fork(A, { id: 'ill', kind: 'illness', agentId: 'nadia', t: 15 * 60, minutes: 240, description: 'x' });
    expect(B.stateAt(901).agents.nadia.confinedUntil).toBe(15 * 60 + 240);
    const home = B.events.find((e) => e.type === 'arrive' && e.actors[0] === 'nadia' && e.locationId === 'maison_bleue' && e.t >= 900);
    expect(home).toBeDefined();
  });

  it('les incidents sont déterministes et n’altèrent pas la réalité A', () => {
    const B1 = fork(A, { id: 'fire', kind: 'fire', locationId: 'bakery', t: 9 * 60, description: 'x' });
    const B2 = fork(A, { id: 'fire', kind: 'fire', locationId: 'bakery', t: 9 * 60, description: 'x' });
    expect(B1.events.map((e) => e.label)).toEqual(B2.events.map((e) => e.label));
    expect(A.events.some((e) => e.type === 'fire')).toBe(false);
  });
});

describe('Incidents du monde : interprète français', () => {
  it.each([
    ['Et si Gérard se faisait voler son portefeuille ?', 'theft'],
    ['Et si Paul avait un accident à 10h ?', 'accident'],
    ['Et si un incendie se déclarait à la boulangerie à 11h ?', 'fire'],
    ['Et si Chloé et Antoine se séparaient ?', 'breakup'],
    ['Et si Alice était renvoyée ?', 'dismissal'],
    ['Et si Martin était promu ?', 'promotion'],
    ['Et si Nadia faisait un malaise à 15h ?', 'illness'],
  ])('« %s » → %s', (text, kind) => {
    const r = interpretFrench(text, ctx);
    expect(r.ok, r.explanation).toBe(true);
    expect(r.intervention!.kind).toBe(kind);
  });

  it('un incendie sans lieu demande une précision', () => {
    expect(interpretFrench('Et si un incendie se déclarait ?', ctx).ok).toBe(false);
  });
});
