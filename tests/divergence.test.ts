import type { SimEvent } from '../src/sim/types';
import { describe, expect, it } from 'vitest';
import { compareRealities, agentPositionsAt } from '../src/sim/compare';
import { busDelayFor } from '../src/sim/interventions';
import type { Intervention } from '../src/sim/types';
import { BUS_SEED, NORMAL_SEED, fork, freshDay, runDay, findBoardingArrival } from './helpers';

describe('Aucune divergence sans intervention', () => {
  it('A vs A2 (même graine, aucune intervention) : comparaison vide', () => {
    const A = runDay(NORMAL_SEED, [], 'A');
    const A2 = freshDay(NORMAL_SEED, [], 'A2');
    expect(A2).not.toBe(A);
    const cmp = compareRealities(A, A2);
    expect(cmp.shifted).toHaveLength(0);
    expect(cmp.onlyA).toHaveLength(0);
    expect(cmp.onlyB).toHaveLength(0);
    expect(cmp.consequences).toHaveLength(0);
    expect(cmp.interventionEvents).toHaveLength(0);
    expect(cmp.affectedAgents).toHaveLength(0);
    expect(cmp.firstDivergence).toBeNull();
    expect(cmp.firstConsequence).toBeNull();
    expect(cmp.same).toBe(A.events.length);
  });

  it('les différences par habitant sont nulles', () => {
    const A = runDay(BUS_SEED);
    const cmp = compareRealities(A, freshDay(BUS_SEED, [], 'A2'));
    expect(cmp.agentDiffs).toHaveLength(20);
    for (const d of cmp.agentDiffs) {
      expect(d.locationA).toBe(d.locationB);
      expect(d.activityA).toBe(d.activityB);
      expect(d.moodA).toBe(d.moodB);
      expect(d.objectivesA).toBe(d.objectivesB);
      expect(d.relationshipChanges).toEqual([]);
      expect(d.eventCountA).toBe(d.eventCountB);
      expect(d.affectedEvents).toBe(0);
    }
    expect(cmp.summary.join(' ')).toMatch(/aucune conséquence notable/);
  });

  it('des graines différentes divergent (la comparaison détecte bien des différences)', () => {
    const A = runDay(NORMAL_SEED);
    const C = runDay(7);
    const cmp = compareRealities(A, C);
    expect(cmp.onlyA.length + cmp.onlyB.length + cmp.shifted.length).toBeGreaterThan(0);
    expect(cmp.firstDivergence).not.toBeNull();
  });
});

describe('Divergence avec un retard de bus (graine 29)', () => {
  const A = runDay(BUS_SEED);
  const arrival = findBoardingArrival(A.events) as SimEvent;
  const iv = busDelayFor(arrival, 3);
  const B = fork(A, iv);
  const cmp = compareRealities(A, B);
  const ivEventIds = new Set(Object.values(B.engine.state.interventionEventIds));

  it('l’intervention est reconnue et une divergence est détectée', () => {
    expect(ivEventIds.size).toBe(1);
    expect(cmp.interventionEvents).toHaveLength(1);
    expect(cmp.shifted.length + cmp.onlyA.length + cmp.onlyB.length).toBeGreaterThan(0);
    expect(cmp.same).toBeGreaterThan(A.events.length * 0.9);
  });

  it('chaque conséquence est un événement only_b/shifted de B ou un only_a vérifié', () => {
    expect(cmp.consequences.length).toBeGreaterThan(0);
    for (const m of cmp.consequences) {
      expect(m.causal).toBe('verified');
      expect(['only_b', 'shifted', 'only_a']).toContain(m.status);
      if (m.status === 'only_a') {
        expect(m.a).toBeDefined();
        expect(m.b).toBeUndefined();
      } else {
        expect(m.b).toBeDefined();
      }
    }
  });

  it('toute conséquence vérifiée côté B porte l’interventionId ou descend de l’intervention', () => {
    for (const m of cmp.consequences.filter((m) => m.b)) {
      const e = m.b!;
      const direct = e.interventionId === iv.id;
      const descends = B.causal.descendsFromIntervention(e.id, ivEventIds);
      expect(direct || descends, `${e.id} ${e.label}`).toBe(true);
      const ancestors = B.causal.ancestors(e.id);
      const viaAncestor = [...ancestors.keys()].some((a) => ivEventIds.has(a));
      expect(direct || viaAncestor, `${e.id} ${e.label} sans ancêtre racine`).toBe(true);
    }
  });

  it('les conséquences only_a vérifiées avaient une cause directe elle-même altérée (précondition perdue)', () => {
    const onlyAVerified = cmp.consequences.filter((m) => m.status === 'only_a');
    for (const m of onlyAVerified) {
      expect(m.a!.causes.length, m.a!.label).toBeGreaterThan(0);
    }
  });

  it('les événements classés « same » ont des étiquettes et des heures identiques', () => {
    const same = cmp.matches.filter((m) => m.status === 'same');
    expect(same.length).toBe(cmp.same);
    for (const m of same) {
      expect(m.a!.t).toBe(m.b!.t);
      expect(m.a!.label, m.signature).toBe(m.b!.label);
      expect(m.a!.type).toBe(m.b!.type);
      expect(m.a!.signature).toBe(m.b!.signature);
    }
  });

  it('les événements « shifted » ont un dt non nul égal à tB − tA et la même signature', () => {
    const shifted = cmp.matches.filter((m) => m.status === 'shifted');
    expect(shifted.length).toBeGreaterThan(0);
    for (const m of shifted) {
      expect(m.dt).not.toBe(0);
      expect(m.dt).toBe(m.b!.t - m.a!.t);
      expect(m.a!.signature).toBe(m.b!.signature);
    }
  });

  it('chaque événement de A et de B apparaît exactement une fois dans les correspondances', () => {
    const seenA = new Map<string, number>();
    const seenB = new Map<string, number>();
    for (const m of cmp.matches) {
      if (m.a) seenA.set(m.a.id, (seenA.get(m.a.id) ?? 0) + 1);
      if (m.b) seenB.set(m.b.id, (seenB.get(m.b.id) ?? 0) + 1);
    }
    expect(seenA.size).toBe(A.events.length);
    expect(seenB.size).toBe(B.events.length);
    for (const n of [...seenA.values(), ...seenB.values()]) expect(n).toBe(1);
  });

  it('aucun événement antérieur à l’intervention ne diverge', () => {
    for (const m of cmp.matches) {
      const t = Math.min(m.a?.t ?? Infinity, m.b?.t ?? Infinity);
      if (t < iv.t) expect(m.status, `${m.signature}@${t}`).toBe('same');
    }
  });

  it('les matches sont triés par temps et le résumé mentionne les conséquences', () => {
    const times = cmp.matches.map((m) => Math.min(m.a?.t ?? Infinity, m.b?.t ?? Infinity));
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    expect(cmp.summary).toHaveLength(3 + (cmp.consequences.some((m) => ((m.b ?? m.a)!.importance) >= 0.6) ? 1 : 0));
    expect(cmp.summary[1]).toContain(`${cmp.consequences.length} conséquences`);
  });

  it('les habitants affectés sont ceux qui ont des événements vérifiés ; les autres sont inchangés', () => {
    expect(cmp.affectedAgents.length).toBeGreaterThan(0);
    const affected = new Set(cmp.affectedAgents);
    for (const d of cmp.agentDiffs) {
      expect(affected.has(d.agentId)).toBe(d.affectedEvents > 0);
    }
  });

  it('agentPositionsAt : identique avant l’intervention, des différences peuvent exister après', () => {
    const before = agentPositionsAt(A, B, iv.t - 1);
    expect(before).toHaveLength(20);
    expect(before.every((p) => !p.differs)).toBe(true);
    const during = agentPositionsAt(A, B, iv.t + 4);
    expect(during.some((p) => p.differs)).toBe(true);
  });
});

describe('Divergence pour d’autres types d’intervention', () => {
  const A = runDay(NORMAL_SEED);
  const cases: Intervention[] = [
    { id: 'd1', kind: 'cancel_commitment', agentId: 'nadia', commitmentId: 'c_nadia_yasmine_cafe', t: 420, description: 'Nadia oublie' },
    { id: 'd2', kind: 'location_hours', locationId: 'cafe', t: 360, closes: 720, description: 'café fermé' },
    { id: 'd3', kind: 'weather', t: 600, condition: 'rain', until: 900, description: 'pluie' },
    { id: 'd4', kind: 'force_action', agentId: 'martin', t: 420, action: 'coffee', locationId: 'cafe', description: 'café' },
  ];

  it.each(cases.map((c) => [c.kind, c] as const))('%s : les conséquences vérifiées descendent bien de l’intervention', (_k, iv) => {
    const B = fork(A, iv);
    const cmp = compareRealities(A, B);
    const ids = new Set(Object.values(B.engine.state.interventionEventIds));
    expect(cmp.interventionEvents).toHaveLength(1);
    expect(cmp.consequences.length).toBeGreaterThan(0);
    for (const m of cmp.consequences.filter((m) => m.b)) {
      expect(B.causal.descendsFromIntervention(m.b!.id, ids), `${m.b!.id} ${m.b!.label}`).toBe(true);
    }
    for (const m of cmp.matches.filter((m) => m.status === 'same')) expect(m.a!.label).toBe(m.b!.label);
    // Pas de divergence avant l'intervention.
    for (const m of cmp.matches) if (Math.min(m.a?.t ?? Infinity, m.b?.t ?? Infinity) < iv.t) expect(m.status).toBe('same');
  });
});
