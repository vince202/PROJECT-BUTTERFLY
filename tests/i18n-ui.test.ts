import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getLocale, has, t } from '../src/i18n';
import { ui } from '../src/i18n/fr/ui';
import { EVENT_TYPE_LABELS, FAMILY_LABELS, INTERVENTION_KIND_LABELS, NEED_LABELS, RELATIONSHIP_LABELS, TRAIT_LABELS, TRAVEL_STAGE_LABELS, COMMITMENT_STATUS, moodWord, stressWord, weatherLabel, pct } from '../src/ui/format';
import { speedTitle } from '../src/store/speed';
import { OUTCOME_MARKS, QUICK_LABELS } from '../src/ui/game/gestures';
import { stakesWord } from '../src/ui/drama';

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('interface catalogue (ui)', () => {
  it('runs in French by default', () => {
    expect(getLocale()).toBe('fr');
  });

  it('defines every static ui.* key used by the interface sources', () => {
    const files = [...sources('src/ui'), ...sources('src/render'), ...sources('src/store'), ...sources('src/ai'), 'src/App.tsx', 'src/main.tsx'];
    const missing: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/['"`](ui\.[a-z0-9_]+)['"`]/g)) if (!has(m[1])) missing.push(`${f}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });

  it('has no empty message', () => {
    for (const [k, v] of Object.entries(ui)) expect(typeof v === 'function' || v.length > 0, k).toBe(true);
  });

  it('keeps the French wording of the label tables', () => {
    expect(EVENT_TYPE_LABELS.activity_start).toBe('Début d’activité');
    expect(EVENT_TYPE_LABELS.incident).toBe('Coup du sort');
    expect(Object.values(EVENT_TYPE_LABELS).every((v) => !v.startsWith('ui.'))).toBe(true);
    expect(Object.values(FAMILY_LABELS).every((v) => !v.startsWith('ui.'))).toBe(true);
    expect(Object.values(RELATIONSHIP_LABELS).every((v) => !v.startsWith('ui.'))).toBe(true);
    expect(Object.values(TRAIT_LABELS).every((v) => !v.startsWith('ui.'))).toBe(true);
    expect(Object.values(NEED_LABELS).every((v) => !v.startsWith('ui.'))).toBe(true);
    expect(Object.values(TRAVEL_STAGE_LABELS).every((v) => !v.startsWith('ui.'))).toBe(true);
    expect(Object.values(INTERVENTION_KIND_LABELS).every((v) => !v.startsWith('ui.'))).toBe(true);
    expect(Object.values(COMMITMENT_STATUS).map((c) => c.label)).toEqual(['prévu', 'en cours', 'accompli', 'manqué', 'abandonné']);
    expect(FAMILY_LABELS.world).toBe('Objets, météo, commerces');
    expect(RELATIONSHIP_LABELS.crush).toBe('coup de cœur');
    expect(TRAVEL_STAGE_LABELS.from_stop).toBe('Descendu du bus, termine à pied');
    expect(INTERVENTION_KIND_LABELS.lose_item).toBe('Portefeuille oublié');
  });

  it('keeps the French helpers identical', () => {
    expect(moodWord(0.7)).toBe('rayonnant·e');
    expect(moodWord(-0.9)).toBe('abattu·e');
    expect(stressWord(0.3)).toBe('légèrement tendu·e');
    expect(weatherLabel('rain')).toEqual({ icon: '🌧', text: 'Pluie' });
    expect(weatherLabel('clear')).toEqual({ icon: '☀', text: 'Dégagé' });
    expect(pct(0.5)).toBe('50 %');
    expect(speedTitle(1)).toBe('×1 = temps réel : 1 minute simulée dure 60 secondes');
    expect(speedTitle(5)).toBe('×5 = 5 fois le temps réel : 1 minute simulée toutes les 12 secondes');
    expect(speedTitle(60)).toBe('×60 = 1 minute simulée par seconde réelle');
    expect(OUTCOME_MARKS.twisted.label).toBe('coup de théâtre');
    expect(QUICK_LABELS.location_hours.label).toBe('Fermer un lieu plus tôt');
    expect(stakesWord(3)).toBe('élevé');
  });

  it('resolves dynamic panel keys', () => {
    for (const id of ['butterfly', 'causal', 'compare', 'report']) {
      expect(has(`ui.topbar_panel_${id}`)).toBe(true);
      expect(has(`ui.topbar_panel_${id}_title`)).toBe(true);
      expect(has(`ui.panel_sub_${id}`)).toBe(true);
    }
  });

  it('formats parameterised messages as before', () => {
    expect(t('ui.topbar_next_day_confirm_b', { day: 3 })).toBe('Passer au jour 3 à partir de la fin de la réalité B ? Les relations, souvenirs importants et portefeuilles perdus sont conservés ; la réalité B est abandonnée.');
    expect(t('ui.topbar_ai_on', { model: 'm1' })).toBe('Narration IA : activée · m1');
    expect(t('ui.topbar_ai_on', {})).toBe('Narration IA : activée');
    expect(t('ui.hud_budget_left', { left: 2, total: 3 })).toBe('2 gestes restants sur 3');
    expect(t('ui.timeline_cons_shifted', { dt: '+5', label: 'X' })).toBe('Décalé de +5 min : X');
    expect(t('ui.iv_rain_until', { time: '14:00', until: '15:30' })).toBe('La pluie commence à 14:00 jusqu’à 15:30');
    expect(t('ui.inspector_why')).toBe('Pourquoi fait-il cela ?');
  });
});

describe('language switch in the store', () => {
  it('regenerates the realities in the new language and restores French', async () => {
    const { useSimStore } = await import('../src/store/useSimStore');
    const { setLocale: setI18nLocale } = await import('../src/i18n');
    const before = useSimStore.getState();
    expect(before.locale).toBe('fr');
    expect(before.realityA.def.name).toBe(t('common.reality_a'));
    try {
      useSimStore.getState().setLocale('en');
      const en = useSimStore.getState();
      expect(en.locale).toBe('en');
      expect(getLocale()).toBe('en');
      expect(en.generation).toBeGreaterThan(before.generation);
      expect(en.realityA).not.toBe(before.realityA);
      expect(en.realityA.def.name).toBe(t('common.reality_a'));
      expect(en.realityA.isComplete).toBe(true);
    } finally {
      useSimStore.getState().setLocale('fr');
      setI18nLocale('fr');
    }
    expect(useSimStore.getState().realityA.def.name).toBe('Réalité A — originale');
  });
});
