import { describe, expect, it } from 'vitest';
import { compareRealities, MAX_SHIFT } from '../src/sim/compare';
import { questAlerts, questFocus, questLink, questStatus } from '../src/sim/quest';
import { GRAVITY_LABELS } from '../src/sim/types';
import { BUS_SEED, fork, runDay } from './helpers';

const A = runDay(BUS_SEED);

describe('Gravité des événements', () => {
  it('chaque événement porte une gravité de 0 à 3', () => {
    for (const e of A.events) {
      expect([0, 1, 2, 3]).toContain(e.gravity);
      expect(GRAVITY_LABELS[e.gravity]).toBeTruthy();
    }
  });

  it('les routines sont des anecdotes, les disputes et rendez-vous manqués sont graves, les coups de théâtre vitaux', () => {
    for (const e of A.events.filter((x) => ['decision', 'depart', 'arrive', 'wake', 'bus_arrive', 'purchase'].includes(x.type))) expect(e.gravity).toBe(0);
    for (const e of A.events.filter((x) => x.type === 'argument' || x.type === 'meeting_missed')) expect(e.gravity).toBeGreaterThanOrEqual(2);
    for (const e of A.events.filter((x) => x.type === 'arc_resolved')) expect(e.gravity).toBeGreaterThanOrEqual(1);
    for (const e of A.events.filter((x) => x.type === 'arc_resolved' && x.data?.outcome === 'fulfilled')) expect(e.gravity).toBeGreaterThanOrEqual(2);
    for (const e of A.events.filter((x) => x.type === 'arc_resolved' && x.data?.outcome === 'twisted')) expect(e.gravity).toBe(3);
  });
});

describe('Appariement borné des événements décalés', () => {
  it('aucun événement « décalé » ne l’est de plus de deux heures', () => {
    const B = fork(A, { id: 'cc', kind: 'cancel_commitment', agentId: 'gerard', t: 360, description: 'Gérard renonce' });
    const cmp = compareRealities(A, B);
    for (const m of cmp.matches.filter((x) => x.status === 'shifted')) expect(Math.abs(m.dt!)).toBeLessThanOrEqual(MAX_SHIFT);
    // Every event still appears exactly once.
    const seenA = new Set<string>();
    const seenB = new Set<string>();
    for (const m of cmp.matches) {
      if (m.a) { expect(seenA.has(m.a.id)).toBe(false); seenA.add(m.a.id); }
      if (m.b) { expect(seenB.has(m.b.id)).toBe(false); seenB.add(m.b.id); }
    }
    expect(seenA.size).toBe(A.events.length);
    expect(seenB.size).toBe(B.events.length);
  });
});

describe('Quête : ce qui compte pour le personnage suivi', () => {
  it('le foyer de la quête contient la cible et le lieu de l’objectif', () => {
    const ines = questFocus(A.engine.state, 'ines');
    expect(ines.targets).toContain('hugo');
    const gerard = questFocus(A.engine.state, 'gerard');
    expect(gerard.places).toContain('park');
    expect(gerard.targets).toContain('paul');
  });

  it('les liens sont classés : soi, histoire, cible, lieu, aucun', () => {
    const focus = questFocus(A.engine.state, 'ines');
    const own = A.events.find((e) => e.actors.includes('ines'))!;
    expect(questLink(own, 'ines', focus)).toBe('self');
    const hugoOnly = A.events.find((e) => e.actors.includes('hugo') && !e.actors.includes('ines'))!;
    expect(questLink(hugoOnly, 'ines', focus)).toBe('target');
    const elsewhere = A.events.find((e) => e.type === 'bus_depart')!;
    expect(questLink(elsewhere, 'ines', focus)).toBe('none');
  });

  it('les alertes filtrent par gravité et marquent le lien', () => {
    const alerts = questAlerts(A, 'ines');
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.length).toBeLessThan(A.events.length / 4);
    for (const a of alerts) {
      expect(a.gravity).toBeGreaterThanOrEqual(1);
      if (a.link === 'none') expect(a.gravity).toBeGreaterThanOrEqual(2);
    }
    const upTo = questAlerts(A, 'ines', { upTo: 12 * 60 });
    expect(upTo.every((a) => a.event.t <= 12 * 60)).toBe(true);
  });

  it('questStatus reflète l’arc', () => {
    const s = questStatus(A, 'antoine');
    expect(s.title).toBe('Rentrer pour le dîner');
    expect(['fulfilled', 'failed', 'twisted']).toContain(s.status);
  });
});
