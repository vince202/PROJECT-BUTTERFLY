import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, keysOf, setLocale, t } from '../src/i18n';
import { ACTION_LABELS } from '../src/sim/decision';
import { LOCATIONS, BUS_LINES, getCity } from '../src/sim/city';
import { INTERVENTION_TEMPLATES } from '../src/sim/interventions';
import { fmtDuration, periodKey, periodLabel, periodOfDay } from '../src/sim/time';

const SIM_FILES = ['engine', 'bus', 'decision', 'interventions', 'compare', 'narrative', 'time', 'city'];

afterEach(() => setLocale('fr'));

describe('i18n : espaces engine et city', () => {
  it('chaque clé engine.* / city.* citée dans le code existe dans le catalogue français', () => {
    const known = new Set([...keysOf('engine').map((k) => `engine.${k}`), ...keysOf('city').map((k) => `city.${k}`)]);
    const missing: string[] = [];
    for (const f of SIM_FILES) {
      const src = readFileSync(new URL(`../src/sim/${f}.ts`, import.meta.url), 'utf8');
      for (const m of src.matchAll(/['"`]((?:engine|city)\.[a-z_A-Z0-9]+)['"`]/g)) if (!known.has(m[1])) missing.push(`${f}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });

  it('les noms de lieux et de lignes passent par city.* avec le français pour valeur', () => {
    for (const l of LOCATIONS) expect(t(`city.${l.id}`)).toBe(l.name);
    for (const l of BUS_LINES) expect(t(`city.line_${l.id}`)).toBe(l.name);
    expect(getCity().location('bakery').name).toBe('Boulangerie Au Levain d’Or');
    expect(getCity().locations.get('stop_gare')!.name).toBe('Arrêt Gare Routière');
  });

  it('en anglais, noms de lieux et libellés restent des textes non vides (traduction ou repli français)', () => {
    setLocale('en');
    expect(getLocale()).toBe('en');
    for (const l of LOCATIONS) expect(l.name.length).toBeGreaterThan(0);
    for (const label of Object.values(ACTION_LABELS)) expect(label.length).toBeGreaterThan(0);
  });

  it('les libellés lus par préfixe ailleurs restent stables en français', () => {
    expect(t('engine.comp_intervention').startsWith('Intervention')).toBe(true);
    expect(t('engine.comp_cost', { price: 4 })).toBe('Coût (4 €)');
    expect(t('engine.infl_invitation', { host: 'Léa' }).startsWith('Invitation')).toBe(true);
    expect(t('engine.mem_yesterday', { text: 'x' }).startsWith('Hier')).toBe(true);
    expect(t('engine.report_title_arcs').startsWith('Arcs du jour')).toBe(true);
    expect(t('engine.report_title_overview')).toBe('Vue chronologique');
    expect(t('engine.report_title_diff').startsWith('Ce qui a changé')).toBe(true);
    expect(t('engine.cmp_destinies', { list: 'a' }).startsWith('Destins modifiés')).toBe(true);
    expect(t('engine.report_destiny_changed', { text: 'Léa' }).startsWith('Destin modifié — Léa')).toBe(true);
  });

  it('ACTION_LABELS et les modèles d’intervention se lisent à l’accès', () => {
    expect(Object.keys(ACTION_LABELS)).toHaveLength(20);
    expect(INTERVENTION_TEMPLATES[0].label).toBe('Retarder un bus');
    expect(INTERVENTION_TEMPLATES[0].example).toBe('Et si le bus avait trois minutes de retard ?');
    expect(INTERVENTION_TEMPLATES).toHaveLength(16);
  });

  it('durées et périodes de la journée', () => {
    expect([30, 60, 65, 120].map(fmtDuration)).toEqual(['30 min', '1 h', '1 h 05', '2 h']);
    expect(periodOfDay(8 * 60)).toBe('matin');
    expect(periodLabel(periodKey(8 * 60))).toBe('matin');
    expect(periodLabel(periodKey(23 * 60))).toBe('nuit');
  });
});
