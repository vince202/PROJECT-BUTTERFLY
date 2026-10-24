/**
 * BUTTERFLY internationalisation.
 *
 * Every user-facing string (engine labels, stories, data, interface) goes
 * through `t(key, params)`. Catalogues are plain objects per language and per
 * namespace (`src/i18n/fr/*.ts`, `src/i18n/en/*.ts`); a message is either a
 * string or a function of its parameters. French is the reference language:
 * a key missing in another language falls back to French, and a key missing
 * everywhere renders as the key itself (so nothing ever crashes).
 *
 * The locale is a process-wide setting: a reality generated while `fr` is
 * active carries French labels; switching language means regenerating.
 */

import * as fr from './fr';
import * as en from './en';

export type Locale = 'fr' | 'en';
export const LOCALES: Locale[] = ['fr', 'en'];
export const LOCALE_LABELS: Record<Locale, string> = { fr: 'Français', en: 'English' };

export type Params = Record<string, string | number | boolean | undefined>;
export type Msg = string | ((p: Params) => string);
export type Namespace = Record<string, Msg>;
export type Catalog = Record<string, Namespace>;

const catalogs: Record<Locale, Catalog> = { fr: fr as unknown as Catalog, en: en as unknown as Catalog };

let current: Locale = 'fr';
const listeners = new Set<(l: Locale) => void>();

export function getLocale(): Locale {
  return current;
}

export function setLocale(l: Locale): void {
  if (l === current) return;
  current = l;
  for (const fn of listeners) fn(l);
}

/** Subscribe to locale changes (the store regenerates realities). */
export function onLocaleChange(fn: (l: Locale) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function lookup(locale: Locale, ns: string, id: string): Msg | undefined {
  return catalogs[locale]?.[ns]?.[id];
}

/**
 * Translate `ns.id` with parameters. Example: t('engine.lose_wallet', { name: 'Gérard', place: 'Marché Plus' }).
 * Resolution order: current locale → French → the key itself.
 */
export function t(key: string, params: Params = {}): string {
  const dot = key.indexOf('.');
  const ns = dot < 0 ? '' : key.slice(0, dot);
  const id = dot < 0 ? key : key.slice(dot + 1);
  const msg = lookup(current, ns, id) ?? lookup('fr', ns, id);
  if (msg === undefined) return key;
  return typeof msg === 'function' ? msg(params) : msg;
}

/** True when the key exists in the current locale or in French. */
export function has(key: string): boolean {
  const dot = key.indexOf('.');
  const ns = key.slice(0, dot);
  const id = key.slice(dot + 1);
  return lookup(current, ns, id) !== undefined || lookup('fr', ns, id) !== undefined;
}

/** Translate in a given locale without switching (used by scripts and tests). */
export function tIn(locale: Locale, key: string, params: Params = {}): string {
  const prev = current;
  current = locale;
  try {
    return t(key, params);
  } finally {
    current = prev;
  }
}

/** Plural helper: n(1, 'habitant', 'habitants'). */
export function plural(n: number, one: string, many: string): string {
  return n > 1 || n === 0 ? many : one;
}

/** Keys of a namespace in the reference language (for coverage checks and translation scripts). */
export function keysOf(ns: string): string[] {
  return Object.keys(catalogs.fr[ns] ?? {});
}

export function namespaces(): string[] {
  return Object.keys(catalogs.fr);
}
