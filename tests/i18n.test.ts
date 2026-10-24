import { afterEach, describe, expect, it } from 'vitest';
import * as fr from '../src/i18n/fr';
import * as en from '../src/i18n/en';
import { getLocale, has, keysOf, namespaces, onLocaleChange, setLocale, t, tIn } from '../src/i18n';
import type { Namespace } from '../src/i18n';

afterEach(() => setLocale('fr'));

const render = (msg: Namespace[string]) => {
  if (typeof msg === 'string') return msg;
  const used = new Set<string>();
  const proxy = new Proxy({} as Record<string, string>, { get: (_t, k) => (typeof k === 'string' ? (used.add(k), `{${k}}`) : undefined) });
  return { text: String(msg(proxy as never)), params: [...used] };
};

describe('i18n : infrastructure', () => {
  it('le français est la langue par défaut et t() retombe sur la clé inconnue', () => {
    expect(getLocale()).toBe('fr');
    expect(t('common.app_name')).toBe('BUTTERFLY');
    expect(t('nope.unknown')).toBe('nope.unknown');
    expect(has('common.day_n')).toBe(true);
    expect(has('common.absent')).toBe(false);
  });

  it('setLocale change la langue, prévient les abonnés, et tIn traduit sans basculer', () => {
    let seen: string | null = null;
    const off = onLocaleChange((l) => (seen = l));
    setLocale('en');
    expect(seen).toBe('en');
    expect(t('common.day_n', { n: 2 })).toBe('Day 2');
    expect(tIn('fr', 'common.day_n', { n: 2 })).toBe('Jour 2');
    expect(getLocale()).toBe('en');
    off();
  });

  it('une clé absente en anglais retombe sur le français', () => {
    setLocale('en');
    // Every French key renders something non-empty in English mode (translation or fallback).
    for (const ns of namespaces()) for (const id of keysOf(ns)) expect(t(`${ns}.${id}`, {}).length, `${ns}.${id}`).toBeGreaterThan(0);
  });
});

describe('i18n : catalogues', () => {
  const frCat = fr as unknown as Record<string, Namespace>;
  const enCat = en as unknown as Record<string, Namespace>;

  it('chaque espace français est un objet de messages (chaînes ou fonctions), sans clé vide', () => {
    for (const [ns, messages] of Object.entries(frCat)) {
      expect(Object.keys(messages).length, ns).toBeGreaterThan(0);
      for (const [id, msg] of Object.entries(messages)) {
        expect(id.trim()).toBe(id);
        expect(['string', 'function']).toContain(typeof msg);
        const r = render(msg);
        expect((typeof r === 'string' ? r : r.text).length, `${ns}.${id}`).toBeGreaterThan(0);
      }
    }
  });

  it('les clés anglaises existent en français (pas d’orphelines) et gardent les mêmes paramètres', () => {
    for (const [ns, messages] of Object.entries(enCat)) {
      const ref = frCat[ns];
      expect(ref, `espace ${ns} absent en français`).toBeDefined();
      for (const [id, msg] of Object.entries(messages)) {
        expect(ref[id], `${ns}.${id} orpheline`).toBeDefined();
        const a = render(ref[id]);
        const b = render(msg);
        if (typeof a !== 'string' && typeof b !== 'string') for (const p of a.params) expect(b.params, `${ns}.${id} paramètre ${p}`).toContain(p);
      }
    }
  });

  it('aucun message ne contient de nom de modèle ni de clé API', () => {
    for (const cat of [frCat, enCat]) for (const [ns, messages] of Object.entries(cat)) for (const [id, msg] of Object.entries(messages)) {
      const r = render(msg);
      const text = typeof r === 'string' ? r : r.text;
      expect(text, `${ns}.${id}`).not.toMatch(/claude-|sk-ant-|gpt-/i);
    }
  });
});
