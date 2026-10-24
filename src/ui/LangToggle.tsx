/**
 * « FR | EN » language switch (laboratory top bar and spectator corner).
 * Changing the language regenerates the realities in the new language (see
 * the store's `setLocale`).
 */

import { LOCALES, LOCALE_LABELS, t } from '../i18n';
import { useSimStore } from '../store/useSimStore';
import { useLocale } from './hooks';

export function LangToggle({ className = '' }: { className?: string }) {
  const locale = useLocale();
  const setLocale = useSimStore((s) => s.setLocale);
  return (
    <div className={`seg lang-toggle ${className}`} role="group" aria-label={t('ui.topbar_lang_group')}>
      {LOCALES.map((l) => (
        <button key={l} className={locale === l ? 'active' : ''} onClick={() => setLocale(l)} title={LOCALE_LABELS[l]} aria-pressed={locale === l} lang={l}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
