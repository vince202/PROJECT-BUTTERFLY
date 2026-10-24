import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { has, keysOf, t } from '../src/i18n';
import { story } from '../src/i18n/fr/story';
import { ARC_KIND_LABELS, ARC_KIND_LABELS_FR, ARC_SEEDS, ARC_STATUS_LABELS, ARC_STATUS_LABELS_FR, DESIRE_LABEL, arcSeed, arcSeedsOf, desireLabel } from '../src/sim/drama';
import { DIFFICULTY_LABELS, DIFFICULTY_LABELS_FR } from '../src/sim/game';
import { AGENTS, COMMITMENT_SEEDS, commitmentSeeds, localizedAgents, profileOf } from '../src/sim/population';
import { QUEST_LINK_LABELS, QUEST_LINK_LABELS_FR } from '../src/sim/quest';
import { collectStoryData, syncSource } from '../scripts/i18n-sync-story';

describe('i18n story : le catalogue de données est généré depuis les fichiers de données', () => {
  it('la partie générée de story.ts est à jour (npx tsx scripts/i18n-sync-story.ts)', () => {
    const source = readFileSync(new URL('../src/i18n/fr/story.ts', import.meta.url), 'utf8');
    expect(syncSource(source, collectStoryData())).toBe(source);
  });

  it('chaque texte de donnée a sa clé story.* et la valeur française du catalogue est le littéral', () => {
    const data = collectStoryData();
    for (const [id, text] of Object.entries(data)) {
      expect(story[id], id).toBe(text);
      expect(t(`story.${id}`), id).toBe(text);
    }
    // 20 inhabitants × (occupation + bio + 3 goals), every commitment, every arc title/desire/tension.
    expect(Object.keys(data).filter((k) => k.endsWith('.occupation')).length).toBe(AGENTS.length);
    expect(Object.keys(data).filter((k) => /^commitment\./.test(k)).length).toBe(COMMITMENT_SEEDS.length);
    expect(Object.keys(data).filter((k) => /^arc\..*\.title$/.test(k)).length).toBe(ARC_SEEDS.length);
  });
});

describe('i18n story : les accesseurs rendent le français à l’identique', () => {
  it('profileOf / localizedAgents / commitmentSeeds / arcSeed / arcSeedsOf', () => {
    for (const a of AGENTS) {
      const p = profileOf(a.id);
      expect(p.occupation).toBe(a.occupation);
      expect(p.bio).toBe(a.bio);
      expect(p.goals).toEqual(a.goals);
      expect(p.name).toBe(a.name);
    }
    expect(localizedAgents().map((p) => p.id)).toEqual(AGENTS.map((a) => a.id));
    expect(commitmentSeeds().map((c) => [c.id, c.label])).toEqual(COMMITMENT_SEEDS.map((c) => [c.id, c.label]));
    for (const s of ARC_SEEDS) expect(arcSeed(s.id)).toEqual(s);
    expect(arcSeedsOf('alice').map((s) => s.id)).toEqual(ARC_SEEDS.filter((s) => s.agentId === 'alice').map((s) => s.id));
  });

  it('les tables de libellés se lisent comme des Record', () => {
    expect({ ...ARC_KIND_LABELS }).toEqual(ARC_KIND_LABELS_FR);
    expect({ ...ARC_STATUS_LABELS }).toEqual(ARC_STATUS_LABELS_FR);
    expect({ ...DIFFICULTY_LABELS }).toEqual(DIFFICULTY_LABELS_FR);
    expect({ ...QUEST_LINK_LABELS }).toEqual(QUEST_LINK_LABELS_FR);
    expect(DESIRE_LABEL).toBe('Désir du jour');
    expect(desireLabel()).toBe(DESIRE_LABEL);
  });
});

describe('i18n story : couverture des clés utilisées par le code', () => {
  const files = ['drama', 'game', 'quest', 'knowledge', 'population', 'advisor', 'recall'];

  it('toute clé story.* citée dans src/sim existe dans le catalogue français', () => {
    const missing: string[] = [];
    for (const f of files) {
      const src = readFileSync(new URL(`../src/sim/${f}.ts`, import.meta.url), 'utf8');
      for (const m of src.matchAll(/'(story\.[a-z0-9_]+)'/g)) if (!has(m[1])) missing.push(`${f}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });

  it('aucune clé de mécanique du catalogue n’est orpheline (citée dans le code ou construite par préfixe)', () => {
    const code = files.map((f) => readFileSync(new URL(`../src/sim/${f}.ts`, import.meta.url), 'utf8')).join('\n');
    const dataPrefix = /^(agent|arc|arc_kind|arc_status|commitment|difficulty|quest_link)\./;
    const orphans = keysOf('story').filter((id) => !dataPrefix.test(id) && !code.includes(`'story.${id}'`));
    expect(orphans).toEqual([]);
  });
});
