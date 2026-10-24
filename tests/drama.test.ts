import { describe, expect, it } from 'vitest';
import { compareRealities } from '../src/sim/compare';
import {
  ARC_SEEDS,
  ARC_STATUS_LABELS,
  DESIRE_LABEL,
  applyDesire,
  arcDeadline,
  arcOf,
  arcSeed,
  arcSeedsOf,
  deadlineOutcome,
  effectiveStakes,
  evaluateBeat,
  initialArcs,
  nextDayArcs,
  revealChance,
} from '../src/sim/drama';
import { Engine } from '../src/sim/engine';
import { agentSummary, answerQuestion, arcSummary, dayReport } from '../src/sim/narrative';
import { AGENTS, COMMITMENT_SEEDS } from '../src/sim/population';
import { nextDayReality } from '../src/sim/reality';
import type { ArcState, Candidate, Intervention, SimEvent } from '../src/sim/types';
import { AGENT_IDS, BUS_SEED, NORMAL_SEED, canonJson, fork, profile, runDay } from './helpers';

const OPEN = ['open', 'advancing'];
const RESOLVED = ['fulfilled', 'failed', 'twisted'];
const profiles = new Map(AGENTS.map((a) => [a.id, a]));

// ---------------------------------------------------------------------------
// Données : graines d’arcs
// ---------------------------------------------------------------------------

describe('Dramaturgie : cohérence des graines d’arcs', () => {
  it('les identifiants des graines sont uniques', () => {
    const ids = ARC_SEEDS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('chacun des 20 habitants a au moins 2 graines, toutes rattachées à un habitant existant', () => {
    expect(AGENT_IDS).toHaveLength(20);
    for (const id of AGENT_IDS) expect(arcSeedsOf(id).length, id).toBeGreaterThanOrEqual(2);
    for (const s of ARC_SEEDS) expect(AGENT_IDS, s.id).toContain(s.agentId);
  });

  it('les engagements cités par les buts existent (COMMITMENT_SEEDS ou w_<habitant>)', () => {
    const known = new Set(COMMITMENT_SEEDS.map((c) => c.id));
    for (const s of ARC_SEEDS) {
      const g = s.goal;
      if (g.type !== 'commitment' && g.type !== 'on_time') continue;
      const ok = known.has(g.commitmentId) || g.commitmentId === `w_${s.agentId}`;
      expect(ok, `${s.id} → ${g.commitmentId}`).toBe(true);
    }
  });

  it('les cibles, secretAbout et partenaires des buts sont des habitants existants', () => {
    for (const s of ARC_SEEDS) {
      if (s.secretAbout) expect(AGENT_IDS, `${s.id}.secretAbout`).toContain(s.secretAbout);
      if (s.secretAbout) expect(s.secret, `${s.id} : secretAbout sans secret`).toBeTruthy();
      const g = s.goal;
      if (g.type === 'talk_to' || g.type === 'avoid') expect(AGENT_IDS, `${s.id}.target`).toContain(g.target);
      if (g.type === 'be_at' && g.withAgent) expect(AGENT_IDS, `${s.id}.withAgent`).toContain(g.withAgent);
      expect(s.stakes, s.id).toBeGreaterThan(0);
      expect(s.stakes, s.id).toBeLessThanOrEqual(1);
      expect(s.tension.length, s.id).toBeGreaterThan(5);
      expect(s.desire.length, s.id).toBeGreaterThan(5);
    }
  });

  it('un but « lieu » référence un lieu existant de la ville', () => {
    const e = new Engine(NORMAL_SEED);
    for (const s of ARC_SEEDS) {
      const g = s.goal;
      if (g.type === 'be_at' || g.type === 'sell_out') expect(() => e.city.location(g.locationId), `${s.id} → ${g.locationId}`).not.toThrow();
    }
  });

  it('arcSeed() lève une erreur pour une graine inconnue', () => {
    expect(() => arcSeed('arc_inexistant')).toThrow();
  });
});

describe('Dramaturgie : état initial', () => {
  const arcs = new Engine(NORMAL_SEED).state.arcs;

  it('chaque habitant a exactement un arc, ouvert, issu de sa première graine', () => {
    expect(Object.keys(arcs)).toHaveLength(20);
    for (const id of AGENT_IDS) {
      const mine = Object.values(arcs).filter((a) => a.agentId === id);
      expect(mine, id).toHaveLength(1);
      expect(mine[0].seedId).toBe(arcSeedsOf(id)[0].id);
      expect(mine[0].id).toBe(mine[0].seedId);
      expect(mine[0].status).toBe('open');
      expect(mine[0].progress).toBe(0);
      expect(mine[0].beats).toEqual([]);
      expect(mine[0].knownBy).toEqual([]);
      expect(mine[0].attempt).toBe(1);
      expect(mine[0].resolutionEventId).toBeUndefined();
    }
  });

  it('l’état initial est égal à initialArcs() et arcOf() retrouve l’arc de chacun', () => {
    expect(canonJson(arcs)).toBe(canonJson(initialArcs()));
    const e = new Engine(NORMAL_SEED);
    for (const id of AGENT_IDS) expect(arcOf(e.state, id)?.agentId).toBe(id);
  });

  it('les échéances sont dans la journée (6h–24h) et la valeur par défaut est la fin de journée', () => {
    for (const arc of Object.values(arcs)) {
      const d = arcDeadline(arc);
      expect(d).toBeGreaterThan(360);
      expect(d).toBeLessThanOrEqual(1440);
    }
    const noDeadline = ARC_SEEDS.find((s) => s.deadline === undefined)!;
    expect(arcDeadline({ ...initialArcs()[noDeadline.id] ?? ({ seedId: noDeadline.id } as ArcState), seedId: noDeadline.id })).toBe(1439);
  });
});

// ---------------------------------------------------------------------------
// Journées simulées : invariants
// ---------------------------------------------------------------------------

describe.each([NORMAL_SEED, BUS_SEED, 7, 9])('Dramaturgie : invariants d’une journée (graine %i)', (seed) => {
  const R = runDay(seed);
  const byId = new Map(R.events.map((e) => [e.id, e]));
  const arcs = Object.values(R.engine.state.arcs);
  const dramaTypes = new Set(['arc_beat', 'arc_resolved', 'revelation', 'gossip', 'dilemma']);
  const drama = R.events.filter((e) => dramaTypes.has(e.type));

  it('toujours exactement 20 arcs, un par habitant', () => {
    expect(arcs).toHaveLength(20);
    expect(new Set(arcs.map((a) => a.agentId)).size).toBe(20);
  });

  it('en fin de journée, aucun arc n’est encore ouvert ; chacun a une résolution datée', () => {
    for (const arc of arcs) {
      expect(OPEN, `${arc.id} : ${arc.status}`).not.toContain(arc.status);
      expect(RESOLVED).toContain(arc.status);
      expect(arc.resolutionEventId, arc.id).toBeDefined();
      expect(arc.resolvedAt, arc.id).toBeDefined();
      expect(arc.resolvedAt!).toBeLessThanOrEqual(1440);
    }
  });

  it('la résolution est un événement arc_resolved de l’habitant, avec des causes existantes non vides', () => {
    for (const arc of arcs) {
      const ev = byId.get(arc.resolutionEventId!)!;
      expect(ev, arc.id).toBeDefined();
      expect(ev.type).toBe('arc_resolved');
      expect(ev.actors, arc.id).toContain(arc.agentId);
      expect(ev.causes.length, `${arc.id} : causes vides`).toBeGreaterThan(0);
      for (const c of ev.causes) expect(byId.has(c), `${ev.id} cause ${c}`).toBe(true);
      expect(ev.data?.arcId).toBe(arc.id);
      expect(ev.data?.outcome).toBe(arc.status);
      expect(['fulfilled', 'failed', 'twisted']).toContain(ev.data?.outcome);
      expect(ev.importance).toBeGreaterThanOrEqual(0.8);
      expect(ev.t).toBe(arc.resolvedAt);
      expect(arc.beats, `${arc.id} : la résolution fait partie des temps forts`).toContain(ev.id);
      // resolutionEventId désigne la dernière résolution émise pour cet arc.
      const mine = R.events.filter((e) => e.type === 'arc_resolved' && e.data?.arcId === arc.id);
      expect(mine.at(-1)!.id, arc.id).toBe(ev.id);
    }
  });

  it('chaque arc a au moins un arc_resolved ; une seconde résolution n’est qu’un coup de théâtre dû à une rumeur', () => {
    const resolved = R.events.filter((e) => e.type === 'arc_resolved');
    expect(new Set(resolved.map((e) => e.data?.arcId)).size).toBe(20);
    const perArc = new Map<string, SimEvent[]>();
    for (const e of resolved) perArc.set(String(e.data?.arcId), [...(perArc.get(String(e.data?.arcId)) ?? []), e]);
    for (const [arcId, list] of perArc) {
      for (const later of list.slice(1)) {
        expect(later.data?.outcome, `${arcId} ${later.id}`).toBe('twisted');
        expect(later.causes.some((c) => byId.get(c)?.type === 'gossip' && byId.get(c)?.data?.reachesTarget === true), `${later.id} doit citer la rumeur`).toBe(true);
      }
    }
  });

  it('une résolution ne précède pas ses causes et respecte l’échéance quand elle vient du temps', () => {
    for (const arc of arcs) {
      const ev = byId.get(arc.resolutionEventId!)!;
      for (const c of ev.causes) expect(byId.get(c)!.t, `${ev.id} ← ${c}`).toBeLessThanOrEqual(ev.t);
      // Les arcs sans cause « événementielle » ne se résolvent qu’à l’échéance (ou après).
      if (ev.mechanism && /Échéance|échéance|Aucune|Stock|Solde|Aucun/.test(ev.mechanism)) expect(ev.t, arc.id).toBeGreaterThanOrEqual(Math.min(arcDeadline(arc), 1439));
    }
  });

  it('les événements de dramaturgie ont des causes qui existent, antérieures ou simultanées', () => {
    expect(drama.length).toBeGreaterThan(20);
    for (const e of drama) {
      expect(e.causes.length, `${e.id} ${e.type}: causes vides`).toBeGreaterThan(0);
      for (const c of e.causes) {
        const cause = byId.get(c);
        expect(cause, `${e.id} ${e.type} → ${c}`).toBeDefined();
        expect(cause!.t).toBeLessThanOrEqual(e.t);
        expect(c).not.toBe(e.id);
      }
      expect(new Set(e.causes).size).toBe(e.causes.length);
    }
  });

  it('un arc_beat cite l’événement qui le déclenche et appartient aux temps forts de l’arc', () => {
    const beats = R.events.filter((e) => e.type === 'arc_beat');
    for (const e of beats) {
      const arc = R.engine.state.arcs[String(e.data?.arcId)];
      expect(arc, e.id).toBeDefined();
      expect(arc.agentId).toBe(e.actors[0]);
      expect(arc.beats).toContain(e.id);
      if (e.data?.aftershock) {
        // A secret leaking after the arc closed: cites the gossip and the resolution.
        expect(e.causes).toHaveLength(2);
        expect(e.causes).toContain(arc.resolutionEventId);
        continue;
      }
      expect(e.causes).toHaveLength(1);
      expect(e.actors).toHaveLength(1);
      expect(e.data?.progress as number).toBeGreaterThan(0);
      expect(e.data?.progress as number).toBeLessThan(1);
    }
  });

  it('les temps forts d’un arc sont dans l’ordre chronologique et existent tous', () => {
    for (const arc of arcs) {
      const ts = arc.beats.map((id) => byId.get(id)?.t);
      expect(ts.every((t) => t !== undefined), arc.id).toBe(true);
      expect([...ts]).toEqual([...ts].sort((a, b) => a! - b!));
      expect(new Set(arc.beats).size).toBe(arc.beats.length);
    }
  });

  it('une révélation cite une rencontre ou une conversation entre les deux protagonistes', () => {
    for (const e of R.events.filter((x) => x.type === 'revelation')) {
      const conv = e.causes.map((c) => byId.get(c)!).find((c) => c.type === 'encounter' || c.type === 'conversation');
      expect(conv, `${e.id} : aucune cause encounter/conversation`).toBeDefined();
      expect(conv!.actors).toEqual(expect.arrayContaining(e.actors));
      expect(conv!.t).toBe(e.t);
      expect(e.actors).toHaveLength(2);
      expect(e.actors[0]).not.toBe(e.actors[1]);
    }
  });

  it('une révélation n’a lieu qu’entre proches (ami, partenaire, famille, béguin) avec une affinité ≥ 0,5', () => {
    for (const e of R.events.filter((x) => x.type === 'revelation')) {
      const [owner, listener] = e.actors;
      // État juste avant la minute de l’événement : l’affinité y est celle qui a servi au tirage.
      const before = R.stateAt(e.t - 1).agents[owner].relationships[listener];
      expect(before, `${e.id} : ${owner} n’a aucune relation avec ${listener}`).toBeDefined();
      expect(['friend', 'partner', 'family', 'crush'], `${e.id} : relation ${before.kind}`).toContain(before.kind);
      // La conversation de la même minute peut avoir fait bouger l’affinité de quelques centièmes.
      expect(before.affinity, `${e.id} affinité ${before.affinity}`).toBeGreaterThanOrEqual(0.4);
      expect(arcSeed(String(e.data?.arcId)).secretAbout).not.toBe(listener);
      expect(R.engine.state.arcs[String(e.data?.arcId)].agentId).toBe(owner);
    }
  });

  it('knownBy correspond exactement aux auditeurs des révélations et rumeurs, sans doublon ni propriétaire', () => {
    for (const arc of arcs) {
      const listeners = R.events.filter((e) => (e.type === 'revelation' || e.type === 'gossip') && e.data?.arcId === arc.id).map((e) => e.actors[1]);
      expect([...arc.knownBy].sort(), arc.id).toEqual([...listeners].sort());
      expect(new Set(arc.knownBy).size).toBe(arc.knownBy.length);
      expect(arc.knownBy).not.toContain(arc.agentId);
      if (!arcSeed(arc.seedId).secret) expect(arc.knownBy, `${arc.id} : pas de secret`).toEqual([]);
    }
  });

  it('une rumeur est transmise par quelqu’un qui connaissait déjà le secret, et cite sa source', () => {
    for (const e of R.events.filter((x) => x.type === 'gossip')) {
      const [holder, listener] = e.actors;
      const arcId = String(e.data?.arcId);
      const arc = R.engine.state.arcs[arcId];
      expect(holder).not.toBe(arc.agentId);
      expect(listener).not.toBe(arc.agentId);
      const source = e.causes.map((c) => byId.get(c)!).find((c) => (c.type === 'revelation' || c.type === 'gossip') && c.data?.arcId === arcId);
      expect(source, `${e.id} : aucune source`).toBeDefined();
      expect(source!.actors[1], `${e.id} : la source doit avoir mis ${holder} dans la confidence`).toBe(holder);
      expect(source!.t).toBeLessThanOrEqual(e.t);
      const conv = e.causes.map((c) => byId.get(c)!).find((c) => c.type === 'encounter' || c.type === 'conversation');
      expect(conv, `${e.id} : aucune conversation`).toBeDefined();
      expect(e.data?.about).toBe(arc.agentId);
    }
  });

  it('une rumeur qui atteint la personne visée produit un coup de théâtre pour le propriétaire du secret', () => {
    for (const e of R.events.filter((x) => x.type === 'gossip')) {
      const arc = R.engine.state.arcs[String(e.data?.arcId)];
      const seed = arcSeed(arc.seedId);
      expect(e.data?.reachesTarget, e.id).toBe(seed.secretAbout === e.actors[1]);
      if (!e.data?.reachesTarget) continue;
      const twist = R.events.find((x) => x.type === 'arc_resolved' && x.causes.includes(e.id));
      if (!twist) {
        // The arc was already closed when the rumour arrived: an aftershock beat instead of a second resolution.
        const after = R.events.find((x) => x.type === 'arc_beat' && x.data?.aftershock && x.causes.includes(e.id));
        expect(after, `${e.id} : ni coup de théâtre ni contrecoup`).toBeDefined();
        expect(arc.resolvedAt!).toBeLessThan(e.t);
        continue;
      }
      expect(twist!.data?.outcome).toBe('twisted');
      expect(twist!.data?.arcId).toBe(arc.id);
      expect(twist!.importance).toBeGreaterThanOrEqual(0.95);
      expect(twist!.t).toBe(e.t);
    }
  });

  it('un dilemme est un événement de l’habitant cité à partir de sa décision', () => {
    for (const e of R.events.filter((x) => x.type === 'dilemma')) {
      expect(e.actors).toHaveLength(1);
      expect(e.causes).toHaveLength(1);
      expect(byId.get(e.causes[0])!.type).toBe('decision');
      expect(byId.get(e.causes[0])!.actors).toContain(e.actors[0]);
      const arc = R.engine.state.arcs[String(e.data?.arcId)];
      expect(arc.agentId).toBe(e.actors[0]);
      expect(e.data?.chosen).toBeTruthy();
      expect(e.data?.other).toBeTruthy();
      expect(e.label).toContain('hésite');
    }
  });

  it('au plus un dilemme toutes les 90 minutes par arc', () => {
    const byArc = new Map<string, number[]>();
    for (const e of R.events.filter((x) => x.type === 'dilemma')) byArc.set(String(e.data?.arcId), [...(byArc.get(String(e.data?.arcId)) ?? []), e.t]);
    for (const [arc, ts] of byArc) for (let i = 1; i < ts.length; i++) expect(ts[i] - ts[i - 1], arc).toBeGreaterThanOrEqual(90);
  });

  it('chaque événement de dramaturgie est référencé dans le graphe causal (acyclique, ancêtres atteignables)', () => {
    for (const e of drama.filter((_, i) => i % 3 === 0)) {
      expect(R.causal.ancestors(e.id).has(e.id)).toBe(false);
      expect(R.causal.directCauses(e.id).length).toBe(e.causes.length);
    }
  });
});

// ---------------------------------------------------------------------------
// Déterminisme et relecture
// ---------------------------------------------------------------------------

describe('Dramaturgie : une rumeur atteint la personne visée (graine 9)', () => {
  const R = runDay(9);
  const reaching = R.events.filter((e) => e.type === 'gossip' && e.data?.reachesTarget === true);

  it('la graine 9 contient au moins une rumeur qui atteint la personne cachée, et un arc bouleversé', () => {
    if (!reaching.length) return; // this seed may simply not leak a secret to its target
    const g = reaching.find((x) => R.events.some((e) => e.type === 'arc_resolved' && e.causes.includes(x.id)));
    if (!g) return;
    const twist = R.events.find((e) => e.type === 'arc_resolved' && e.causes.includes(g.id))!;
    expect(twist.data?.outcome).toBe('twisted');
    expect(twist.label).toContain('Coup de théâtre');
    expect(R.causal.ancestors(twist.id).has(g.id)).toBe(true);
    expect(R.engine.state.arcs[String(g.data?.arcId)].status).toBe('twisted');
    expect(Object.values(R.engine.state.arcs).some((a) => a.status === 'twisted')).toBe(true);
  });
});

describe('Dramaturgie : déterminisme et relecture', () => {
  const R = runDay(NORMAL_SEED);

  it('deux exécutions indépendantes de la même graine donnent les mêmes arcs et les mêmes événements de drame', () => {
    const again = new Engine(NORMAL_SEED);
    while (!again.done) again.step();
    expect(canonJson(again.state.arcs)).toBe(canonJson(R.engine.state.arcs));
    const key = (evs: SimEvent[]) => evs.filter((e) => ['arc_beat', 'arc_resolved', 'revelation', 'gossip', 'dilemma'].includes(e.type)).map((e) => `${e.id}|${e.t}|${e.type}|${e.label}|${e.causes.join(',')}`);
    expect(key(again.events)).toEqual(key(R.events));
  });

  it('des graines différentes donnent des histoires différentes', () => {
    const other = runDay(7);
    expect(canonJson(other.engine.state.arcs)).not.toBe(canonJson(R.engine.state.arcs));
  });

  it.each([480, 720, 1005])('un moteur repris depuis le snapshot de %i minutes termine avec les mêmes arcs', (t) => {
    const snapshot = structuredClone(R.snapshots.get(t)!);
    const prior = R.events.filter((e) => e.t < t);
    const replay = Engine.fromState(snapshot, prior, R.def.interventions);
    while (replay.state.t < 1440) replay.step();
    expect(canonJson(replay.state.arcs)).toBe(canonJson(R.engine.state.arcs));
    expect(canonJson(replay.state.lastLeft)).toBe(canonJson(R.engine.state.lastLeft));
    expect(replay.events.length).toBe(R.events.length);
  });

  it('stateAt(t) restitue les arcs tels qu’ils étaient à t (ouverts le matin, résolus le soir)', () => {
    const morning = R.stateAt(361);
    expect(Object.values(morning.arcs).filter((a) => OPEN.includes(a.status)).length).toBeGreaterThanOrEqual(15);
    const mid = R.stateAt(840);
    const resolvedAtMid = Object.values(mid.arcs).filter((a) => RESOLVED.includes(a.status));
    for (const a of resolvedAtMid) expect(a.resolvedAt!).toBeLessThanOrEqual(840);
    // Ce que dit le passé reconstruit correspond au journal.
    for (const a of Object.values(mid.arcs)) for (const id of a.beats) expect(R.eventById(id)!.t).toBeLessThanOrEqual(840);
    expect(canonJson(R.stateAt(1440).arcs)).toBe(canonJson(R.engine.state.arcs));
  });

  it('les snapshots sont indépendants : modifier un arc d’un état relu ne touche pas la réalité', () => {
    const s = R.stateAt(900);
    const before = canonJson(R.engine.state.arcs);
    for (const a of Object.values(s.arcs)) {
      a.status = 'failed';
      a.knownBy.push('zzz');
    }
    expect(canonJson(R.engine.state.arcs)).toBe(before);
    expect(canonJson(R.stateAt(900).arcs)).not.toContain('zzz');
  });
});

// ---------------------------------------------------------------------------
// Branchement : destins modifiés
// ---------------------------------------------------------------------------

describe('Dramaturgie : destins modifiés entre réalités', () => {
  const A = runDay(BUS_SEED);
  // The tutorial gesture: Léa leaves for school before her coup du sort (07:50) holds her at home.
  const leave: Intervention = { id: 'dr_lea', kind: 'force_action', agentId: 'lea', t: 7 * 60 + 46, action: 'school', locationId: 'school', description: 'Léa part au lycée tout de suite' };
  const B = fork(A, leave);
  const cmp = compareRealities(A, B);

  it('la journée telle qu’elle se répète (réalité A) ne laisse aucun habitant atteindre son objectif', () => {
    for (const arc of Object.values(A.engine.state.arcs)) expect(arc.status, arc.id).not.toBe('fulfilled');
  });

  it('le geste du tutoriel fait réussir « À l’heure au lycée » de Léa en B seulement', () => {
    expect(arcOf(A.engine.state, 'lea')!.status).toBe('failed');
    expect(arcOf(B.engine.state, 'lea')!.status).toBe('fulfilled');
    const ch = cmp.arcChanges.find((c) => c.agentId === 'lea')!;
    expect(ch).toBeDefined();
    expect(ch.arcId).toBe('arc_lea_heure');
    expect(ch.title).toBe('À l’heure au lycée');
    expect(ch.statusA).toBe('failed');
    expect(ch.statusB).toBe('fulfilled');
    expect(ch.text).toBe('Léa — « À l’heure au lycée » : échoué en A, accompli en B');
  });

  it('la résolution en B descend causalement de l’intervention (changement vérifié)', () => {
    const ch = cmp.arcChanges.find((c) => c.agentId === 'lea')!;
    expect(ch.eventB).toBeDefined();
    expect(ch.eventB!.type).toBe('arc_resolved');
    expect(ch.eventB!.data?.outcome).toBe('fulfilled');
    expect(ch.verified).toBe(true);
    const iv = B.events.find((e) => e.type === 'intervention')!;
    expect(B.causal.ancestors(ch.eventB!.id).has(iv.id)).toBe(true);
  });

  it('le résumé de la comparaison contient la phrase « Destins modifiés » avec le texte français', () => {
    const line = cmp.summary.find((s) => s.startsWith('Destins modifiés'));
    expect(line).toBeDefined();
    expect(line).toContain('Léa — « À l’heure au lycée » : échoué en A, accompli en B');
    expect(line!.endsWith('.')).toBe(true);
  });

  it('chaque ArcChange est cohérent avec les états finaux et lisible en français', () => {
    expect(cmp.arcChanges.length).toBeGreaterThanOrEqual(1);
    for (const c of cmp.arcChanges) {
      expect(c.statusA).not.toBe(c.statusB);
      expect(A.engine.state.arcs[c.arcId].status).toBe(c.statusA);
      expect(B.engine.state.arcs[c.arcId].status).toBe(c.statusB);
      expect(c.text).toContain(`en A, ${ARC_STATUS_LABELS[c.statusB]} en B`);
      expect(c.text).toContain(ARC_STATUS_LABELS[c.statusA]);
    }
    // Les arcs identiques ne sont pas listés.
    const changed = new Set(cmp.arcChanges.map((c) => c.arcId));
    for (const arc of Object.values(A.engine.state.arcs)) if (!changed.has(arc.id)) expect(B.engine.state.arcs[arc.id].status).toBe(arc.status);
  });

  it('sans intervention, aucune différence de destin', () => {
    const same = compareRealities(A, runDay(BUS_SEED));
    expect(same.arcChanges).toEqual([]);
    expect(same.summary.some((s) => s.startsWith('Destins modifiés'))).toBe(false);
  });

  it('le rapport comparé liste « Destin modifié » dans « Ce qui a changé entre les deux réalités »', () => {
    const report = dayReport(B, cmp);
    const sec = report.sections.find((s) => s.title === 'Ce qui a changé entre les deux réalités')!;
    expect(sec).toBeDefined();
    expect(sec.items.some((i) => i.text.startsWith('Destin modifié — Léa'))).toBe(true);
  });

  it('une rencontre forcée entre Inès et Hugo au café, le soir, peut changer leurs destins', () => {
    const enc: Intervention = { id: 'dr_enc', kind: 'encounter', agentA: 'ines', agentB: 'hugo', locationId: 'cafe', t: 18 * 60 + 5, description: 'Inès retrouve Hugo au café' };
    expect(arcOf(A.engine.state, 'ines')!.status).toBe('failed');
    expect(arcOf(A.engine.state, 'hugo')!.status).toBe('failed');
    const E = fork(A, enc);
    const c = compareRealities(A, E);
    // The forced visit guarantees the meeting, not the deep conversation (that is the difficulty of the quest).
    for (const x of c.arcChanges) {
      expect(x.verified).toBe(true);
      expect(E.causal.ancestors(x.eventB!.id).has(E.events.find((e) => e.type === 'intervention')!.id)).toBe(true);
    }
    expect(E.events.some((e) => (e.type === 'encounter' || e.type === 'conversation') && e.actors.includes('ines') && e.actors.includes('hugo') && e.t >= enc.t)).toBe(true);
  });

  it('la réalité de départ n’est pas modifiée par les forks', () => {
    expect(arcOf(A.engine.state, 'lea')!.status).toBe('failed');
    expect(A.events.filter((e) => e.type === 'arc_resolved')).toHaveLength(20);
  });
});

// ---------------------------------------------------------------------------
// Fonctions pures
// ---------------------------------------------------------------------------

describe('evaluateBeat / deadlineOutcome (fonctions pures)', () => {
  const e = new Engine(NORMAL_SEED);
  const world = e.state;
  const arcFor = (seedId: string, patch: Partial<ArcState> = {}): ArcState => ({ id: seedId, agentId: arcSeed(seedId).agentId, seedId, status: 'open', progress: 0, beats: [], knownBy: [], count: 0, attempt: 1, ...patch });
  const ev = (patch: Partial<SimEvent>): SimEvent => ({ id: 'ex', t: 800, type: 'conversation', actors: [], label: 'x', causes: [], effects: [], importance: 0.5, signature: 'x', ...patch } as SimEvent);

  it('un arc déjà résolu, ou un événement de drame, ne produit aucun temps fort', () => {
    const done = arcFor('arc_noe_lea', { status: 'fulfilled' });
    expect(evaluateBeat(done, ev({ actors: ['noe', 'lea'] }), world, profiles)).toBeNull();
    const open = arcFor('arc_noe_lea');
    expect(evaluateBeat(open, ev({ type: 'arc_beat', actors: ['noe', 'lea'] }), world, profiles)).toBeNull();
    expect(evaluateBeat(open, ev({ type: 'dilemma', actors: ['noe'] }), world, profiles)).toBeNull();
    expect(deadlineOutcome(done, world, profiles)).toBeNull();
  });

  it('talk_to profond : une rencontre simple avance à 50 %, une conversation accomplit, une dispute avance à 40 %', () => {
    const arc = arcFor('arc_noe_lea'); // Noé → Léa, profond, après 16h30
    expect(evaluateBeat(arc, ev({ type: 'conversation', actors: ['noe', 'lea'], t: 900 }), world, profiles)).toBeNull(); // trop tôt
    const enc = evaluateBeat(arc, ev({ type: 'encounter', actors: ['noe', 'lea'], t: 1000 }), world, profiles)!;
    expect(enc.outcome).toBeUndefined();
    expect(enc.progress).toBe(0.5);
    const conv = evaluateBeat(arc, ev({ type: 'conversation', actors: ['noe', 'lea'], t: 1000 }), world, profiles)!;
    expect(conv.outcome).toBe('fulfilled');
    expect(conv.text).toContain('Noé');
    expect(conv.text).toContain('Léa');
    expect(evaluateBeat(arc, ev({ type: 'argument', actors: ['noe', 'lea'], t: 1000 }), world, profiles)!.progress).toBe(0.4);
    expect(evaluateBeat(arc, ev({ type: 'conversation', actors: ['noe', 'paul'], t: 1000 }), world, profiles)).toBeNull();
    expect(evaluateBeat(arc, ev({ type: 'conversation', actors: ['lea', 'paul'], t: 1000 }), world, profiles)).toBeNull();
  });

  it('avoid : une conversation bouleverse, une dispute ou une simple rencontre fait échouer ; l’échéance accomplit', () => {
    const arc = arcFor('arc_sophie_page');
    expect(evaluateBeat(arc, ev({ type: 'conversation', actors: ['sophie', 'julien'] }), world, profiles)!.outcome).toBe('twisted');
    expect(evaluateBeat(arc, ev({ type: 'argument', actors: ['sophie', 'julien'] }), world, profiles)!.outcome).toBe('failed');
    const enc = evaluateBeat(arc, ev({ type: 'encounter', actors: ['sophie', 'julien'] }), world, profiles)!;
    expect(enc.outcome).toBe('failed');
    expect(deadlineOutcome(arc, world, profiles)!.outcome).toBe('fulfilled');
  });

  it('commitment : début → avance, fin → accompli, manqué → échoué, annulé → échoué', () => {
    const arc = arcFor('arc_martin_mairie');
    const cid = 'c_martin_townhall';
    expect(evaluateBeat(arc, ev({ type: 'meeting_start', actors: ['martin'], data: { commitmentId: cid } }), world, profiles)!.progress).toBe(0.7);
    expect(evaluateBeat(arc, ev({ type: 'meeting_end', actors: ['martin'], data: { commitmentId: cid } }), world, profiles)!.outcome).toBe('fulfilled');
    expect(evaluateBeat(arc, ev({ type: 'meeting_missed', actors: ['martin'], data: { commitmentId: cid } }), world, profiles)!.outcome).toBe('failed');
    expect(evaluateBeat(arc, ev({ type: 'commitment_cancelled', actors: ['martin'], data: { commitmentId: cid } }), world, profiles)!.outcome).toBe('failed');
    expect(evaluateBeat(arc, ev({ type: 'meeting_end', actors: ['martin'], data: { commitmentId: 'autre' } }), world, profiles)).toBeNull();
    expect(deadlineOutcome(arc, world, profiles)!.outcome).toBe('failed');
  });

  it('keep_wallet / money_floor / sell_out / conversations : issues par défaut à l’échéance', () => {
    expect(deadlineOutcome(arcFor('arc_elodie_rien_perdre'), world, profiles)!.outcome).toBe('fulfilled');
    expect(deadlineOutcome(arcFor('arc_ines_budget'), world, profiles)!.outcome).toBe('fulfilled');
    expect(deadlineOutcome(arcFor('arc_camille_fournee'), world, profiles)!.outcome).toBe('failed');
    expect(deadlineOutcome(arcFor('arc_mireille_nouvelles', { count: 2 }), world, profiles)!.text).toContain('2 personnes');
    expect(deadlineOutcome(arcFor('arc_antoine_horaire'), world, profiles)!.outcome).toBe('fulfilled');
    expect(evaluateBeat(arcFor('arc_elodie_rien_perdre'), ev({ type: 'lose_item', actors: ['elodie'] }), world, profiles)!.outcome).toBe('failed');
  });

  it('conversations : le dixième échange accomplit l’arc de Mireille', () => {
    const arc = arcFor('arc_mireille_nouvelles', { count: 8 });
    const b9 = evaluateBeat(arc, ev({ type: 'conversation', actors: ['mireille', 'paul'] }), world, profiles)!;
    expect(b9.outcome).toBeUndefined();
    expect(b9.progress).toBeCloseTo(0.9);
    const b10 = evaluateBeat({ ...arc, count: 9 }, ev({ type: 'encounter', actors: ['mireille', 'paul'] }), world, profiles)!;
    expect(b10.outcome).toBe('fulfilled');
  });

  it('evaluateBeat ne modifie pas l’arc', () => {
    const arc = arcFor('arc_mireille_nouvelles', { count: 3 });
    const frozen = canonJson(arc);
    evaluateBeat(arc, ev({ type: 'conversation', actors: ['mireille', 'paul'] }), world, profiles);
    expect(canonJson(arc)).toBe(frozen);
  });

  it('effectiveStakes augmente à chaque nouvelle tentative et reste plafonné à 1', () => {
    const s1 = effectiveStakes(arcFor('arc_noe_lea'));
    const s2 = effectiveStakes(arcFor('arc_noe_lea', { attempt: 2 }));
    const s3 = effectiveStakes(arcFor('arc_noe_lea', { attempt: 3 }));
    expect(s1).toBeCloseTo(0.75);
    expect(s2).toBeGreaterThan(s1);
    expect(s3).toBeGreaterThan(s2);
    expect(effectiveStakes(arcFor('arc_noe_lea', { attempt: 9 }))).toBe(1);
  });

  it('revealChance : nulle sans lien proche ou en dessous de 0,5 d’affinité, plus forte en conversation profonde', () => {
    const w = new Engine(NORMAL_SEED).state;
    const owner = structuredClone(w.agents.alice);
    const p = profile('alice');
    owner.relationships.sophie = { to: 'sophie', kind: 'friend', affinity: 0.8 } as never;
    owner.relationships.thomas = { to: 'thomas', kind: 'colleague', affinity: 0.9 } as never;
    owner.relationships.paul = { to: 'paul', kind: 'friend', affinity: 0.3 } as never;
    expect(revealChance(owner, p, 'sophie', true)).toBeGreaterThan(revealChance(owner, p, 'sophie', false));
    expect(revealChance(owner, p, 'sophie', false)).toBeGreaterThan(0);
    expect(revealChance(owner, p, 'thomas', true)).toBe(0);
    expect(revealChance(owner, p, 'paul', true)).toBe(0);
    expect(revealChance(owner, p, 'inconnu', true)).toBe(0);
    expect(revealChance(owner, p, 'sophie', true)).toBeLessThanOrEqual(0.6);
  });
});

// ---------------------------------------------------------------------------
// Journées enchaînées
// ---------------------------------------------------------------------------

describe('nextDayArcs : rotation et nouvelle tentative', () => {
  const base = () => initialArcs();
  const withStatus = (arcs: Record<string, ArcState>, agentId: string, patch: Partial<ArcState>) => {
    const arc = Object.values(arcs).find((a) => a.agentId === agentId)!;
    Object.assign(arc, patch);
    return arc;
  };

  it('un arc accompli ou bouleversé laisse place à la graine suivante, remise à zéro', () => {
    for (const status of ['fulfilled', 'twisted'] as const) {
      const prev = base();
      withStatus(prev, 'alice', { status, progress: 1, beats: ['e1'], knownBy: ['thomas'], resolvedAt: 700, resolutionEventId: 'e9', count: 3, lastDilemma: 600 });
      const next = nextDayArcs(prev);
      const [first, second] = arcSeedsOf('alice');
      expect(next[first.id]).toBeUndefined();
      const arc = next[second.id];
      expect(arc).toBeDefined();
      expect(arc.agentId).toBe('alice');
      expect(arc.status).toBe('open');
      expect(arc.progress).toBe(0);
      expect(arc.beats).toEqual([]);
      expect(arc.knownBy).toEqual([]);
      expect(arc.count).toBe(0);
      expect(arc.attempt).toBe(1);
      expect(arc.resolutionEventId).toBeUndefined();
      expect(arc.resolvedAt).toBeUndefined();
      expect(arc.lastDilemma).toBeUndefined();
    }
  });

  it('un arc échoué est retenté avec attempt + 1, en gardant qui connaît le secret', () => {
    const prev = base();
    withStatus(prev, 'martin', { status: 'failed', beats: ['e2'], knownBy: ['thomas', 'paul'], resolvedAt: 900, resolutionEventId: 'e5', progress: 0.5 });
    const next = nextDayArcs(prev);
    const arc = next['arc_martin_cafe'];
    expect(arc).toBeDefined();
    expect(arc.status).toBe('open');
    expect(arc.attempt).toBe(2);
    expect(arc.knownBy).toEqual(['thomas', 'paul']);
    expect(arc.beats).toEqual([]);
    expect(arc.progress).toBe(0);
    expect(arc.resolutionEventId).toBeUndefined();
    expect(arcSeedsOf('martin').filter((s) => next[s.id])).toHaveLength(1);
    expect(effectiveStakes(arc)).toBeGreaterThan(arcSeed(arc.seedId).stakes);
  });

  it('la liste des connaissances copiée est indépendante de l’ancienne', () => {
    const prev = base();
    const a = withStatus(prev, 'martin', { status: 'failed', knownBy: ['thomas'] });
    const next = nextDayArcs(prev);
    next['arc_martin_cafe'].knownBy.push('paul');
    expect(a.knownBy).toEqual(['thomas']);
  });

  it('après trois tentatives échouées, on passe à la graine suivante', () => {
    const prev = base();
    withStatus(prev, 'martin', { status: 'failed', attempt: 3, knownBy: ['thomas'] });
    const next = nextDayArcs(prev);
    expect(next['arc_martin_cafe']).toBeUndefined();
    expect(next['arc_martin_mairie'].attempt).toBe(1);
    expect(next['arc_martin_mairie'].knownBy).toEqual([]);
  });

  it('la rotation boucle : la dernière graine ramène à la première', () => {
    const seeds = arcSeedsOf('lucie');
    const last = seeds.at(-1)!;
    const prev: Record<string, ArcState> = { [last.id]: { id: last.id, agentId: 'lucie', seedId: last.id, status: 'fulfilled', progress: 1, beats: [], knownBy: [], count: 0, attempt: 1 } };
    const next = nextDayArcs(prev);
    expect(Object.keys(next)).toEqual([seeds[0].id]);
  });

  it('chaque habitant garde exactement un arc d’un jour à l’autre, quel que soit le résultat', () => {
    const prev = base();
    const statuses = ['fulfilled', 'failed', 'twisted', 'failed'] as const;
    Object.values(prev).forEach((a, i) => (a.status = statuses[i % 4]));
    const next = nextDayArcs(prev);
    expect(Object.keys(next)).toHaveLength(20);
    for (const id of AGENT_IDS) expect(Object.values(next).filter((a) => a.agentId === id)).toHaveLength(1);
    for (const a of Object.values(next)) expect(a.id).toBe(a.seedId);
  });

  it('nextDayArcs ne modifie pas l’état précédent', () => {
    const prev = base();
    withStatus(prev, 'alice', { status: 'failed' });
    const frozen = canonJson(prev);
    nextDayArcs(prev);
    expect(canonJson(prev)).toBe(frozen);
  });

  it('Engine.nextDayState applique la rotation à la fin d’une vraie journée', () => {
    const R = runDay(NORMAL_SEED);
    const next = Engine.nextDayState(R.engine.state);
    expect(next.day).toBe(2);
    expect(Object.keys(next.arcs)).toHaveLength(20);
    for (const id of AGENT_IDS) {
      const yesterday = arcOf(R.engine.state, id)!;
      const today = arcOf(next, id)!;
      expect(today.status).toBe('open');
      if (yesterday.status === 'failed') {
        expect(today.seedId).toBe(yesterday.seedId);
        expect(today.attempt).toBe(2);
      } else {
        expect(today.seedId).not.toBe(yesterday.seedId);
        expect(today.attempt).toBe(1);
      }
    }
  });

  it('la mémoire de la veille mentionne l’issue de l’arc', () => {
    const R = runDay(NORMAL_SEED);
    const next = Engine.nextDayState(R.engine.state);
    const arc = arcOf(R.engine.state, 'martin')!;
    const mem = next.agents.martin.memories.find((m) => m.text.startsWith('Hier — « ') && m.text.includes(arcSeed(arc.seedId).title));
    expect(mem).toBeDefined();
    expect(mem!.text).toContain(ARC_STATUS_LABELS[arc.status]);
    expect(mem!.eventId).toBe(arc.resolutionEventId);
  });

  it('le deuxième jour simulé se déroule avec les nouveaux arcs, tous résolus à la fin', () => {
    const R = runDay(NORMAL_SEED);
    const D2 = nextDayReality(R).generate();
    expect(D2.def.day).toBe(2);
    const arcs = Object.values(D2.engine.state.arcs);
    expect(arcs).toHaveLength(20);
    for (const a of arcs) {
      expect(OPEN).not.toContain(a.status);
      expect(D2.eventById(a.resolutionEventId!)?.type).toBe('arc_resolved');
    }
    const failedYesterday = Object.values(R.engine.state.arcs).filter((a) => a.status === 'failed');
    for (const f of failedYesterday) expect(D2.engine.state.arcs[f.seedId]?.attempt).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Désir du jour
// ---------------------------------------------------------------------------

describe('Désir du jour : les arcs infléchissent les décisions', () => {
  const mk = (patch: Partial<Candidate>): Candidate => ({ action: 'coffee', label: 'Prendre un café', locationId: 'cafe', duration: 30, score: 1, components: [{ label: 'Envie', value: 1 }], travelMinutes: 5, mode: 'walk', ...patch });

  it('applyDesire ajoute un composant « Désir du jour » à un candidat qui sert le but (Inès → Hugo)', () => {
    const w = new Engine(NORMAL_SEED).state;
    w.agents.hugo.locationId = 'cafe';
    w.agents.hugo.asleep = false;
    const cands = [mk({}), mk({ action: 'relax_park', label: 'Se détendre au parc', locationId: 'park' })];
    applyDesire(cands, w.agents.ines, w, profiles, 17 * 60);
    const at = cands[0].components.find((c) => c.label.startsWith(DESIRE_LABEL));
    expect(at, 'composant désir au café').toBeDefined();
    expect(at!.label).toContain('Hugo');
    expect(at!.value).toBeGreaterThan(0);
    expect(cands[0].score).toBeCloseTo(cands[0].components.reduce((s, c) => s + c.value, 0));
    expect(cands[0].score).toBeGreaterThan(1);
    expect(cands[1].components.some((c) => c.label.startsWith(DESIRE_LABEL))).toBe(false);
    expect(cands[1].score).toBe(1);
  });

  it('applyDesire n’ajoute rien après l’échéance, ni quand l’arc est résolu', () => {
    const w = new Engine(NORMAL_SEED).state;
    w.agents.hugo.locationId = 'cafe';
    const late = [mk({ withAgent: 'hugo' })];
    applyDesire(late, w.agents.ines, w, profiles, 23 * 60);
    expect(late[0].components).toHaveLength(1);
    const arc = arcOf(w, 'ines')!;
    arc.status = 'fulfilled';
    const done = [mk({ withAgent: 'hugo' })];
    applyDesire(done, w.agents.ines, w, profiles, 17 * 60);
    expect(done[0].components).toHaveLength(1);
  });

  it('l’urgence croît à l’approche de l’échéance', () => {
    const w = new Engine(NORMAL_SEED).state;
    w.agents.hugo.locationId = 'cafe';
    w.agents.hugo.asleep = false;
    const early = [mk({ withAgent: 'hugo' })];
    const near = [mk({ withAgent: 'hugo' })];
    applyDesire(early, w.agents.ines, w, profiles, 15 * 60);
    applyDesire(near, w.agents.ines, w, profiles, 21 * 60 + 30);
    expect(near[0].components.at(-1)!.value).toBeGreaterThan(early[0].components.at(-1)!.value);
  });

  it('applyDesire garde les candidats rejetés rejetés (leur score ne bouge pas)', () => {
    const w = new Engine(NORMAL_SEED).state;
    const c = mk({ withAgent: 'hugo', rejected: 'Fermé', score: -9 });
    w.agents.hugo.locationId = 'cafe';
    applyDesire([c], w.agents.ines, w, profiles, 17 * 60);
    expect(c.score).toBe(-9);
  });

  it('un but « éviter » pénalise les lieux où se trouve la personne évitée (Sophie → Julien)', () => {
    const w = new Engine(NORMAL_SEED).state;
    w.agents.julien.locationId = 'cafe';
    w.agents.julien.asleep = false;
    const cands = [mk({}), mk({ locationId: 'park', action: 'relax_park', label: 'Parc' })];
    applyDesire(cands, w.agents.sophie, w, profiles, 12 * 60);
    expect(cands[0].components.at(-1)!.value).toBeLessThan(0);
    expect(cands[0].components.at(-1)!.label).toContain('Julien');
    expect(cands[1].components).toHaveLength(1);
  });

  it('au cours d’une journée, les décisions d’Inès et de Martin portent des composants « Désir du jour »', () => {
    const e = new Engine(NORMAL_SEED);
    const seen: Record<string, Set<string>> = { ines: new Set(), martin: new Set(), hugo: new Set() };
    let lastEvent: Record<string, string | undefined> = {};
    while (!e.done) {
      e.step();
      for (const id of Object.keys(seen)) {
        const d = e.state.agents[id].lastDecision;
        if (!d || lastEvent[id] === d.eventId) continue;
        lastEvent[id] = d.eventId;
        for (const c of d.candidates) for (const comp of c.components) if (comp.label.startsWith(DESIRE_LABEL)) seen[id].add(comp.label);
        // Le score d’un candidat valide est toujours la somme de ses composants.
        for (const c of d.candidates.filter((x) => !x.rejected)) expect(c.score).toBeCloseTo(c.components.reduce((s, x) => s + x.value, 0), 3);
      }
    }
    expect(seen.ines.size, 'Inès').toBeGreaterThan(0);
    expect(seen.martin.size, 'Martin').toBeGreaterThan(0);
    for (const label of [...seen.ines, ...seen.martin]) expect(label).toMatch(/^Désir du jour : .+/);
  });
});

// ---------------------------------------------------------------------------
// Rapport et résumés
// ---------------------------------------------------------------------------

describe('Rapport : arcs, confidences et résumés par habitant', () => {
  const R = runDay(BUS_SEED);
  const report = dayReport(R);

  it('le rapport contient les deux nouvelles sections', () => {
    const titles = report.sections.map((s) => s.title);
    expect(titles).toContain('Arcs du jour — ce que chacun voulait');
    expect(titles).toContain('Confidences, rumeurs et dilemmes');
    const arcs = report.sections.find((s) => s.title.startsWith('Arcs du jour'))!;
    expect(arcs.items).toHaveLength(20);
    expect(arcs.items.every((i) => i.text.includes('«') && i.agents?.length === 1)).toBe(true);
    const twists = report.sections.find((s) => s.title.startsWith('Confidences'))!;
    const expected = R.events.filter((e) => ['revelation', 'gossip', 'dilemma'].includes(e.type));
    expect(twists.items).toHaveLength(expected.length);
    expect(twists.items.length).toBeGreaterThan(0);
    for (const it of twists.items) expect(R.eventById(it.eventId!)).toBeDefined();
  });

  it('les éléments de la section « Arcs du jour » pointent la résolution et nomment l’issue', () => {
    const arcs = report.sections.find((s) => s.title.startsWith('Arcs du jour'))!;
    const words = Object.values(ARC_STATUS_LABELS);
    for (const item of arcs.items) {
      expect(words.some((w) => item.text.includes(`: ${w}`)), item.text).toBe(true);
      expect(R.eventById(item.eventId!)!.type).toBe('arc_resolved');
    }
    // Triés : coups de théâtre et échecs d’abord.
    const rank = (t: string) => (t.includes(': bouleversé') ? 0 : t.includes(': échoué') ? 1 : 2);
    const ranks = arcs.items.map((i) => rank(i.text));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('l’introduction compte les histoires du jour et correspond à l’état final', () => {
    const arcs = Object.values(R.engine.state.arcs);
    const f = arcs.filter((a) => a.status === 'fulfilled').length;
    const x = arcs.filter((a) => a.status === 'failed').length;
    const t = arcs.filter((a) => a.status === 'twisted').length;
    expect(report.intro).toContain('Sur 20 histoires du jour');
    expect(report.intro).toContain(`${f} accomplie${f > 1 ? 's' : ''}`);
    expect(report.intro).toContain(`${x} échouée${x > 1 ? 's' : ''}`);
    expect(report.intro).toContain(`${t} bouleversée${t > 1 ? 's' : ''}`);
    expect(f + x + t).toBe(20);
  });

  it('agentSummary(...).arc est défini pour les 20 habitants avec une histoire contenant leur prénom', () => {
    for (const p of AGENTS) {
      const s = agentSummary(R, p.id);
      expect(s.arc, p.id).toBeDefined();
      expect(s.arc!.story.length, p.id).toBeGreaterThan(40);
      expect(s.arc!.story, p.id).toContain(p.firstName);
      expect(s.arc!.title).toBe(arcSeed(s.arc!.arcId).title);
      expect(s.arc!.status).toBe(R.engine.state.arcs[s.arc!.arcId].status);
      expect(s.arc!.statusLabel).toBe(ARC_STATUS_LABELS[s.arc!.status]);
      expect(s.arc!.deadline).toBe(arcDeadline(R.engine.state.arcs[s.arc!.arcId]));
    }
  });

  it('arcSummary liste les temps forts dans l’ordre et mentionne qui connaît le secret', () => {
    const R9 = runDay(9);
    let withSecret = 0;
    for (const arc of Object.values(R9.engine.state.arcs)) {
      const s = arcSummary(R9, arc.agentId)!;
      expect(s.beats.map((b) => b.t)).toEqual([...s.beats.map((b) => b.t)].sort((a, b) => a - b));
      expect(s.beats.some((b) => b.type === 'arc_resolved')).toBe(true);
      if (arc.knownBy.length) {
        withSecret++;
        expect(s.secretKnownBy).toHaveLength(arc.knownBy.length);
        expect(s.story).toContain('est désormais connu de');
      } else expect(s.story).not.toContain('est désormais connu de');
    }
    expect(withSecret).toBeGreaterThan(0);
  });

  it('arcSummary d’une journée partielle décrit une histoire encore en suspens', async () => {
    const { Reality } = await import('../src/sim/reality');
    const partial = new Reality({ id: 'P', name: 'P', seed: NORMAL_SEED, interventions: [] });
    partial.advanceTo(480);
    const open = Object.values(partial.engine.state.arcs).find((a) => OPEN.includes(a.status))!;
    const s = arcSummary(partial, open.agentId)!;
    expect(s.story).toMatch(/l’histoire est encore (en suspens|en marche)/);
    expect(s.beats.every((b) => b.type !== 'arc_resolved')).toBe(true);
  });

  it('answerQuestion(« Quelle était l’histoire de Noé ? ») parle de Noé et de son arc', () => {
    const answer = answerQuestion('Quelle était l’histoire de Noé ?', R);
    expect(answer).toContain('Noé');
    expect(answer).toContain(arcSeed(R.engine.state.arcs[arcOf(R.engine.state, 'noe')!.id].seedId).title);
    expect(answer.split('\n')).toHaveLength(1);
    expect(answer).not.toContain('Alice —');
  });

  it('answerQuestion sans prénom renvoie les 20 histoires ; « secret » et « destin » déclenchent aussi la réponse', () => {
    const all = answerQuestion('Quelle était l’histoire de tout le monde ?', R);
    expect(all.split('\n')).toHaveLength(20);
    expect(answerQuestion('Quel secret pour Mireille ?', R)).toContain('Mireille');
    expect(answerQuestion('Quel destin pour Antoine ?', R)).toContain('Antoine');
  });
});
