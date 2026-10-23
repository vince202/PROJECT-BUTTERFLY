import { DAY_END, DAY_START, type Minute } from './types';

/** Format clock minutes as HH:MM (24:00 for the end of the day). */
export function fmtTime(t: Minute): string {
  const clamped = Math.max(0, Math.min(DAY_END, Math.round(t)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Format a duration in minutes as a French string. */
export function fmtDuration(min: Minute): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
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

/** Day period used for lighting and narrative. */
export function periodOfDay(t: Minute): 'aube' | 'matin' | 'midi' | 'après-midi' | 'soir' | 'nuit' {
  if (t < 7 * 60) return 'aube';
  if (t < 11.5 * 60) return 'matin';
  if (t < 14 * 60) return 'midi';
  if (t < 18.5 * 60) return 'après-midi';
  if (t < 21.5 * 60) return 'soir';
  return 'nuit';
}
