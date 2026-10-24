/**
 * Natural-language intervention interpreter and example templates, chosen from
 * the interface language (French rule-based interpreter, or its English twin).
 */

import { getLocale } from '../i18n';
import { INTERVENTION_TEMPLATES, interpretFrench, type InterpretContext, type InterpretResult } from '../sim/interventions';
import { INTERVENTION_TEMPLATES_EN, interpretEnglish } from '../sim/interventions.en';

export function interpretText(text: string, ctx: InterpretContext): InterpretResult {
  return getLocale() === 'en' ? interpretEnglish(text, ctx) : interpretFrench(text, ctx);
}

export function interventionTemplates(): typeof INTERVENTION_TEMPLATES {
  return getLocale() === 'en' ? INTERVENTION_TEMPLATES_EN : INTERVENTION_TEMPLATES;
}
