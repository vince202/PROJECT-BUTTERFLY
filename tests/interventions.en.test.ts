import { describe, expect, it } from 'vitest';
import { INTERVENTION_TEMPLATES_EN, interpretEnglish } from '../src/sim/interventions.en';
import { validateIntervention } from '../src/sim/interventions';
import { DAY_START, type SimEvent } from '../src/sim/types';
import { BUS_SEED, runDay } from './helpers';

const A = runDay(BUS_SEED);
const ctx = { t: DAY_START, selectedEvent: null, events: A.events as SimEvent[] };

describe('English interpreter', () => {
  it.each(INTERVENTION_TEMPLATES_EN.map((t) => [t.id, t] as const))('template “%s” is understood with the right kind', (_id, tpl) => {
    const r = interpretEnglish(tpl.example, ctx);
    expect(r.ok, `${tpl.example} → ${r.explanation} ${r.issues.join(' / ')}`).toBe(true);
    expect(r.intervention!.kind).toBe(tpl.kind);
    expect(validateIntervention(r.intervention!)).toEqual([]);
  });

  it('covers every intervention kind exactly once', () => {
    expect(new Set(INTERVENTION_TEMPLATES_EN.map((t) => t.kind)).size).toBe(INTERVENTION_TEMPLATES_EN.length);
    expect(INTERVENTION_TEMPLATES_EN).toHaveLength(16);
  });

  it('parses 12-hour and 24-hour clocks', () => {
    expect(interpretEnglish('What if Léa left for school at 7:30?', ctx).intervention!.t).toBe(7 * 60 + 30);
    expect(interpretEnglish('What if Nadia felt unwell at 3 pm?', ctx).intervention!.t).toBe(15 * 60);
    expect(interpretEnglish('What if Paul had an accident at 10 am?', ctx).intervention!.t).toBe(10 * 60);
    expect(interpretEnglish('What if the bakery closed at 14:00?', ctx).intervention!.t).toBeLessThanOrEqual(14 * 60);
  });

  it('asks for a person or a place when they are missing', () => {
    expect(interpretEnglish('What if a fire broke out?', ctx).ok).toBe(false);
    const r = interpretEnglish('What if something happened?', ctx);
    expect(r.ok).toBe(false);
    expect(r.issues.length).toBeGreaterThan(0);
  });

  it('the forced action for Léa binds school and produces a valid intervention', () => {
    const r = interpretEnglish('What if Léa left for school at 7:46?', ctx);
    expect(r.ok).toBe(true);
    expect(r.intervention!.kind).toBe('force_action');
    if (r.intervention!.kind === 'force_action') {
      expect(r.intervention!.action).toBe('school');
      expect(r.intervention!.locationId).toBe('school');
    }
  });
});
