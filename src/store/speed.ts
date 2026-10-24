/**
 * Playback speeds of the display clock (pure helpers, no store / DOM).
 *
 * ×N means N times real time: ×1 is real time (one simulated minute lasts 60
 * real seconds), ×60 plays one simulated minute per real second. The
 * simulation itself always advances minute by minute; the speed only changes
 * how fast the replay clock moves.
 */

import { t } from '../i18n';

export const SPEEDS = [1, 5, 20, 60] as const;
export type Speed = (typeof SPEEDS)[number];
export const DEFAULT_SPEED: Speed = 20;

/** Real seconds in one simulated minute at ×1. */
export const REAL_SECONDS_PER_SIM_MINUTE = 60;

export function isSpeed(v: unknown): v is Speed {
  return typeof v === 'number' && (SPEEDS as readonly number[]).includes(v);
}

/** A persisted (possibly outdated) speed value: kept if it is a preset, otherwise ×20. */
export function normalizeSpeed(v: unknown): Speed {
  return isSpeed(v) ? v : DEFAULT_SPEED;
}

/** Simulated minutes elapsed during `dtSeconds` of real time at `speed`. */
export function simMinutes(dtSeconds: number, speed: Speed): number {
  return (dtSeconds * speed) / REAL_SECONDS_PER_SIM_MINUTE;
}

/** Next / previous preset (clamped at both ends). */
export function stepSpeed(speed: Speed, dir: 1 | -1): Speed {
  const i = SPEEDS.indexOf(speed);
  const j = Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? SPEEDS.indexOf(DEFAULT_SPEED) : i) + dir));
  return SPEEDS[j];
}

/** Tooltip of a preset, in the active language. */
export function speedTitle(s: Speed): string {
  if (s === 1) return t('ui.speed_x1');
  if (s === 60) return t('ui.speed_x60');
  return t('ui.speed_xn', { n: s, secs: REAL_SECONDS_PER_SIM_MINUTE / s });
}
