import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compareRealities } from '../src/sim/compare';
import { busDelayFor } from '../src/sim/interventions';
import { agentSummary, answerQuestion, dayReport, reportToText, whoMetWhom } from '../src/sim/narrative';
import { AGENTS } from '../src/sim/population';
import { BUS_SEED, NORMAL_SEED, fork, runDay } from './helpers';

const A = runDay(NORMAL_SEED, [], 'Réalité A');
const report = dayReport(A);

describe('dayReport', () => {
  it('a un titre, une introduction non vide et des sections', () => {
    expect(report.title).toContain('Rapport de la journée');
    expect(report.title).toContain('Réalité A');
    expect(report.intro.length).toBeGreaterThan(30);
    expect(report.intro).toContain('graine 42');
    expect(report.sections.length).toBeGreaterThanOrEqual(6);
    expect(report.sections.filter((s) => s.items.length > 0).length).toBeGreaterThanOrEqual(4);
    for (const s of report.sections) {
      expect(s.title.length).toBeGreaterThan(0);
      for (const i of s.items) expect(i.text.length).toBeGreaterThan(0);
    }
  });

  it('l’introduction chiffre correctement le journal d’événements', () => {
    expect(report.intro).toContain(`${A.events.length} événements`);
    const meetings = A.events.filter((e) => e.type === 'meeting_start').length;
    expect(report.intro).toContain(`${meetings} rendez-vous tenus`);
  });

  it('contient un résumé pour les 20 habitants, chacun mentionnant son prénom', () => {
    expect(report.perAgent).toHaveLength(20);
    for (const a of AGENTS) {
      const s = report.perAgent.find((x) => x.agentId === a.id)!;
      expect(s, a.id).toBeDefined();
      expect(s.name).toBe(a.name);
      expect(s.paragraph, a.id).toContain(a.firstName);
      expect(s.paragraph.length).toBeGreaterThan(60);
      expect(s.headline).toContain(a.firstName);
    }
  });

  it('les items référencent des événements qui existent', () => {
    for (const s of report.sections) for (const i of s.items) if (i.eventId) expect(A.eventById(i.eventId), i.eventId).toBeDefined();
  });

  it('sans comparaison, il n’y a pas de section « Ce qui a changé »', () => {
    expect(report.sections.some((s) => /changé/.test(s.title))).toBe(false);
  });

  it('avec une comparaison, la section « Ce qui a changé » reprend le résumé', () => {
    const R29 = runDay(BUS_SEED);
    const arrival = R29.events.find((e) => e.type === 'bus_arrive' && e.t === 500)!;
    const B = fork(R29, busDelayFor(arrival, 3));
    const cmp = compareRealities(R29, B);
    const r = dayReport(B, cmp);
    const diff = r.sections.find((s) => /changé/.test(s.title))!;
    expect(diff).toBeDefined();
    for (const line of cmp.summary) expect(diff.items.map((i) => i.text)).toContain(line);
    expect(diff.items.length).toBeGreaterThan(cmp.summary.length);
    expect(r.intro).toContain('1 intervention');
  });

  it('un rendez-vous manqué apparaît dans « Occasions manquées » et « Situations non résolues »', () => {
    const B = fork(A, { id: 'n1', kind: 'cancel_commitment', agentId: 'alice', commitmentId: 'c_alice_sophie_lunch', t: 420, description: 'Alice oublie' });
    const r = dayReport(B);
    expect(r.sections.find((s) => s.title === 'Occasions manquées')!.items.length).toBeGreaterThanOrEqual(1);
    expect(r.sections.find((s) => s.title === 'Situations non résolues')!.items.length).toBeGreaterThanOrEqual(1);
    expect(r.perAgent.find((a) => a.agentId === 'alice')!.paragraph).toMatch(/manqu/);
    expect(r.perAgent.find((a) => a.agentId === 'alice')!.headline).toMatch(/manqué/);
  });

  it('est déterministe : deux appels donnent le même rapport', () => {
    expect(JSON.stringify(dayReport(A))).toBe(JSON.stringify(report));
  });
});

describe('agentSummary et whoMetWhom', () => {
  it('agentSummary d’un habitant décrit son humeur de début et de fin', () => {
    const s = agentSummary(A, 'alice');
    expect(s.paragraph).toContain('Alice Moreau');
    expect(s.moodStart).toBeGreaterThanOrEqual(-1);
    expect(s.moodEnd).toBeLessThanOrEqual(1);
    expect(s.timeline.length).toBeGreaterThan(0);
    for (const t of s.timeline) expect(A.eventById(t.eventId)!.actors).toContain('alice');
  });

  it('whoMetWhom est trié par nombre décroissant, avec des paires uniques et ordonnées', () => {
    const pairs = whoMetWhom(A);
    expect(pairs.length).toBeGreaterThan(5);
    const keys = new Set<string>();
    for (let i = 0; i < pairs.length; i++) {
      const p = pairs[i];
      expect(p.a < p.b).toBe(true);
      expect(p.count).toBeGreaterThanOrEqual(1);
      expect(p.places.length).toBeGreaterThanOrEqual(1);
      if (i > 0) expect(p.count).toBeLessThanOrEqual(pairs[i - 1].count);
      keys.add(`${p.a}|${p.b}`);
    }
    expect(keys.size).toBe(pairs.length);
  });
});

describe('answerQuestion', () => {
  it('« Qu’est-il arrivé à Alice ? » contient « Alice »', () => {
    const a = answerQuestion('Qu\'est-il arrivé à Alice ?', A);
    expect(a).toContain('Alice');
    expect(a.length).toBeGreaterThan(50);
  });

  it('reconnaît n’importe quel prénom, même sans accent (Gérard / Gerard)', () => {
    expect(answerQuestion('Que fait Gerard ?', A)).toContain('Gérard');
    expect(answerQuestion('Raconte-moi la journée de Léa', A)).toContain('Léa');
  });

  it('« Qui a rencontré qui ? » renvoie une liste non vide de paires', () => {
    const a = answerQuestion('Qui a rencontré qui ?', A);
    expect(a.length).toBeGreaterThan(0);
    expect(a.split('\n').length).toBeGreaterThan(3);
    expect(a).toMatch(/ et .* fois/);
  });

  it('« Quel événement a eu le plus d’impact ? » liste des événements classés', () => {
    const a = answerQuestion('Quel événement a eu le plus d\'impact ?', A);
    const lines = a.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^1\. \d\d:\d\d /);
    expect(lines[2]).toMatch(/^3\. /);
    expect(a).toContain('événements en aval');
  });

  it('sans comparaison, « Qu’est-ce qui a changé ? » explique qu’aucune réalité alternative n’existe', () => {
    const a = answerQuestion('Qu\'est-ce qui a changé ?', A);
    expect(a).toMatch(/Aucune réalité alternative/);
    expect(answerQuestion('Quelle est la différence entre les deux réalités ?', A)).toMatch(/Aucune réalité alternative/);
  });

  it('avec une comparaison, « Qu’est-ce qui a changé ? » renvoie le résumé', () => {
    const R29 = runDay(BUS_SEED);
    const arrival = R29.events.find((e) => e.type === 'bus_arrive' && e.t === 500)!;
    const B = fork(R29, busDelayFor(arrival, 3));
    const cmp = compareRealities(R29, B);
    expect(answerQuestion('Qu\'est-ce qui a changé ?', B, cmp)).toBe(cmp.summary.join('\n'));
  });

  it('une question quelconque renvoie l’introduction du rapport', () => {
    expect(answerQuestion('Bonjour !', A)).toBe(report.intro);
    expect(answerQuestion('', A)).toBe(report.intro);
  });

  it('ne jette jamais, quelle que soit la question', () => {
    for (const q of ['', '???', 'Qui ?', 'impact impact', 'é'.repeat(3000), '<b>Alice</b>', 'Qu\'est-ce qui a changé ?']) {
      expect(() => answerQuestion(q, A)).not.toThrow();
      expect(typeof answerQuestion(q, A)).toBe('string');
    }
  });
});

describe('reportToText', () => {
  const text = reportToText(report);

  it('inclut le titre, l’introduction, les sections non vides et les 20 habitants', () => {
    expect(text.startsWith(report.title)).toBe(true);
    expect(text).toContain(report.intro);
    for (const s of report.sections.filter((s) => s.items.length)) expect(text).toContain(`## ${s.title}`);
    expect(text).toContain('## Habitants');
    for (const a of AGENTS) expect(text).toContain(`### ${a.name}`);
  });

  it('omet les sections vides et formate les heures en HH:MM', () => {
    for (const s of report.sections.filter((s) => s.items.length === 0)) expect(text).not.toContain(`## ${s.title}`);
    expect(text).toMatch(/\n\d\d:\d\d {2}/);
  });
});

describe('Principe « repli sans LLM »', () => {
  it('le module narratif n’importe aucun SDK ni ne référence de clé d’API', () => {
    for (const f of ['narrative.ts', 'interventions.ts', 'compare.ts', 'causal.ts', 'reality.ts', 'engine.ts', 'decision.ts']) {
      const src = readFileSync(new URL(`../src/sim/${f}`, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/api[_-]?key/i);
      expect(src, f).not.toMatch(/ANTHROPIC/i);
      expect(src, f).not.toMatch(/@anthropic-ai/);
      expect(src, f).not.toMatch(/process\.env/);
      expect(src, f).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it('les fonctions fonctionnent sans variable d’environnement de clé', () => {
    const saved = { ...process.env };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(() => dayReport(A)).not.toThrow();
      expect(() => answerQuestion('Qu\'est-il arrivé à Alice ?', A)).not.toThrow();
      expect(() => reportToText(dayReport(A))).not.toThrow();
    } finally {
      Object.assign(process.env, saved);
    }
  });

  it('les textes produits ne contiennent jamais de valeur indéfinie ou NaN', () => {
    const text = reportToText(report);
    expect(text).not.toMatch(/undefined|NaN|\[object Object\]/);
    for (const a of AGENTS) expect(agentSummary(A, a.id).paragraph).not.toMatch(/undefined|NaN|\[object Object\]/);
  });
});
