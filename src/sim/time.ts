import { t as tl } from '../i18n';
import { DAY_END, DAY_START, type Minute } from './types';

/** Format clock minutes as HH:MM (24:00 for the end of the day). */
export function fmtTime(t: Minute): string {
  const clamped = Math.max(0, Math.min(DAY_END, Math.round(t)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Format a duration in minutes as text in the active language ("45 min", "1 h 05"). */
export function fmtDuration(min: Minute): string {
  const m = Math.round(min);
  if (m < 60) return tl('engine.duration_min', { n: m });
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? tl('engine.duration_h_min', { h, m: String(r).padStart(2, '0') }) : tl('engine.duration_h', { h });
}

/** Parse "8h12", "08:12", "14 h" into clock minutes. */
export function parseTime(s: string): Minute | null {
  const m = s.trim().match(/^(\d{1,2})\s*(?:h|:)\s*(\d{2})?$/i);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

export function clampToDay(t: Minute): Minute {
  return Math.max(DAY_START, Math.min(DAY_END, t));
}

export type DayPeriod = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';
export const DAY_PERIODS: DayPeriod[] = ['dawn', 'morning', 'noon', 'afternoon', 'evening', 'night'];

/** Day period (machine key) used for grouping in narratives. */
export function periodKey(t: Minute): DayPeriod {
  if (t < 7 * 60) return 'dawn';
  if (t < 11.5 * 60) return 'morning';
  if (t < 14 * 60) return 'noon';
  if (t < 18.5 * 60) return 'afternoon';
  if (t < 21.5 * 60) return 'evening';
  return 'night';
}

/** Display word for a day period in the active language ("aube", "matin", "midi"…). */
export function periodLabel(p: DayPeriod): string {
  switch (p) {
    case 'dawn':
      return tl('engine.period_dawn');
    case 'morning':
      return tl('engine.period_morning');
    case 'noon':
      return tl('engine.period_noon');
    case 'afternoon':
      return tl('engine.period_afternoon');
    case 'evening':
      return tl('engine.period_evening');
    default:
      return tl('engine.period_night');
  }
}

const PERIOD_FR = { dawn: 'aube', morning: 'matin', noon: 'midi', afternoon: 'après-midi', evening: 'soir', night: 'nuit' } as const;

/**
 * Day period used for lighting and narrative. The value is a stable French key
 * (« matin », « soir »…), not display text: translate it through `periodLabel(periodKey(t))`.
 */
export function periodOfDay(t: Minute): 'aube' | 'matin' | 'midi' | 'après-midi' | 'soir' | 'nuit' {
  return PERIOD_FR[periodKey(t)];
}
