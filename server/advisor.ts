/**
 * LLM-backed decision advisor (server side). It receives the open choices the
 * engine could not settle on its own and answers with one of the proposed
 * options per request; the engine validates every answer before use.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { AdviceAnswer, AdviceRequest, DecisionAdvisor } from '../src/sim/advisor';

const ANSWERS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answers'],
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'choice', 'reason'],
        properties: { key: { type: 'string' }, choice: { type: 'string' }, reason: { type: 'string' } },
      },
    },
  },
} as const;

const SYSTEM = [
  'Tu incarnes le libre arbitre des habitants d’une ville miniature simulée (BUTTERFLY).',
  'Pour chaque demande, un habitant hésite entre quelques options que le moteur de simulation a déjà jugées possibles. Choisis l’option la plus cohérente avec sa personnalité, ses besoins, ses objectifs, ses souvenirs récents et le moment de la journée.',
  'Règles : réponds pour chaque clé fournie ; `choice` doit être EXACTEMENT l’identifiant d’une option proposée ; `reason` est une justification courte en français (moins de 15 mots), à la troisième personne, sans inventer de faits.',
  'Les scores utilitaires sont indicatifs : tu peux t’en écarter quand la personnalité le justifie, mais pas systématiquement.',
].join('\n');

const SYSTEM_ANTAGONIST = [
  'Tu es le dramaturge d’une journée qui se répète dans une ville miniature simulée (BUTTERFLY).',
  'Pour chaque demande, un habitant hésite entre quelques options que le moteur a déjà jugées possibles ; son « enjeu du jour » décrit ce qu’il désire. Choisis l’option crédible (proche du meilleur score, fidèle à son caractère) qui maintient la tension et l’éloigne de son désir, sans jamais le faire agir contre nature.',
  'Règles : réponds pour chaque clé fournie ; `choice` doit être EXACTEMENT l’identifiant d’une option proposée ; `reason` est une justification courte en français (moins de 15 mots), à la troisième personne, sans inventer de faits.',
].join('\n');

export class AnthropicAdvisor implements DecisionAdvisor {
  readonly name = 'anthropic';
  private client = new Anthropic();
  constructor(private model: string, private useFallbacks = true) {}

  async advise(requests: AdviceRequest[]): Promise<AdviceAnswer[]> {
    const out: AdviceAnswer[] = [];
    for (let i = 0; i < requests.length; i += 25) {
      const batch = requests.slice(i, i + 25);
      const user = batch
        .map((r) => [
          `### ${r.key}`,
          `${r.name} (${r.occupation}) à ${r.time}, ${r.location}. Traits ${r.traits}. Besoins : ${r.needs}. ${r.mood}.`,
          `Objectifs : ${r.goals.join(' ; ')}.`,
          r.nextCommitment ? `Prochain engagement : ${r.nextCommitment}.` : 'Aucun engagement proche.',
          r.recentMemories.length ? `Souvenirs récents : ${r.recentMemories.join(' | ')}.` : '',
          r.relevantMemories?.length ? `Souvenirs liés à la situation : ${r.relevantMemories.join(' | ')}.` : '',
          r.precedents?.length ? `Précédents observés dans d’autres journées : ${r.precedents.join(' | ')}.` : '',
          r.stakes ? `Enjeu du jour : ${r.stakes}` : '',
          r.influences.length ? `Vient de vivre : ${r.influences.join(', ')}.` : '',
          `Options : ${r.candidates.map((c) => `${c.choice} = « ${c.label} » (score ${c.score}${c.components.length ? ' : ' + c.components.map((x) => `${x.label} ${x.value > 0 ? '+' : ''}${x.value}`).join(', ') : ''})`).join(' ; ')}. Choix utilitaire : ${r.baseline}.`,
        ].filter(Boolean).join('\n'))
        .join('\n\n');
      const common = {
        model: this.model,
        max_tokens: 6000,
        system: batch.some((r) => r.role === 'antagonist') ? SYSTEM_ANTAGONIST : SYSTEM,
        messages: [{ role: 'user' as const, content: user }],
        output_config: { effort: 'low' as const, format: { type: 'json_schema' as const, schema: ANSWERS_SCHEMA as unknown as Record<string, unknown> } },
      };
      const response = this.useFallbacks
        ? await this.client.beta.messages.create({ ...common, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        : await this.client.messages.create(common);
      if (response.stop_reason === 'refusal') continue;
      const block = response.content.find((b) => b.type === 'text');
      if (!block || block.type !== 'text') continue;
      try {
        const parsed = JSON.parse(block.text) as { answers: AdviceAnswer[] };
        out.push(...parsed.answers.filter((a) => typeof a.key === 'string' && typeof a.choice === 'string').map((a) => ({ key: a.key, choice: a.choice, reason: String(a.reason ?? '').slice(0, 120) })));
      } catch {
        /* malformed batch: the engine keeps its utility choices */
      }
    }
    return out;
  }
}
