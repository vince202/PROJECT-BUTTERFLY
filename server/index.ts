/**
 * BUTTERFLY — optional AI adapter (server side).
 *
 * Runs next to the Vite dev server (proxied under /api). It is the only place
 * that talks to an LLM provider, so API keys never reach the browser. When no
 * credentials are configured the endpoints report `enabled: false` and the
 * application uses its deterministic local fallbacks.
 *
 * Endpoints
 *   GET  /api/ai/status     -> { enabled, model, message }
 *   POST /api/ai/interpret  -> { ok, intervention?, explanation, issues }
 *   POST /api/ai/narrate    -> { ok, text }
 *   POST /api/ai/decide     -> { ok, answers }   (advisor for open decisions, see src/sim/advisor.ts)
 *
 * The LLM never writes to the simulation: `interpret` returns a validated
 * structured intervention and `narrate` only rephrases recorded facts.
 */

import http from 'node:http';
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { AGENTS } from '../src/sim/population';
import { LOCATIONS } from '../src/sim/city';
import { busDelayFor, newInterventionId, validateIntervention } from '../src/sim/interventions';
import { fmtTime } from '../src/sim/time';
import { AnthropicAdvisor } from './advisor';
import { JevAdvisor } from './jev';
import type { DecisionAdvisor } from '../src/sim/advisor';
import type { AdviceRequest } from '../src/sim/advisor';
import { DAY_END, DAY_START, type ActionType, type Intervention, type SimEvent } from '../src/sim/types';

const PORT = Number(process.env.BUTTERFLY_AI_PORT ?? 8787);
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5-5';
const USE_FALLBACKS = process.env.ANTHROPIC_FALLBACKS !== 'off';

// ---------------------------------------------------------------------------
// Provider abstraction: a second provider (or a specialised decision model) can
// implement this interface without touching the rest of the application.
// ---------------------------------------------------------------------------

interface InterpretContext {
  t: number;
  selectedEvent?: SimEvent | null;
  recentEvents?: SimEvent[];
}

interface StructuredInterpretation {
  kind: 'bus_delay' | 'stay_home' | 'force_action' | 'agent_delay' | 'location_hours' | 'weather' | 'cancel_commitment' | 'encounter' | 'unknown';
  agentId: string | null;
  agentB: string | null;
  locationId: string | null;
  time: string | null;
  until: string | null;
  minutes: number | null;
  action: string | null;
  condition: 'rain' | 'clear' | null;
  busEventId: string | null;
  explanation: string;
  confidence: number;
}

interface AiProvider {
  readonly name: string;
  readonly model: string;
  interpret(text: string, ctx: InterpretContext): Promise<StructuredInterpretation>;
  narrate(facts: string, style: string): Promise<string>;
}

const INTERPRET_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'agentId', 'agentB', 'locationId', 'time', 'until', 'minutes', 'action', 'condition', 'busEventId', 'explanation', 'confidence'],
  properties: {
    kind: { type: 'string', enum: ['bus_delay', 'stay_home', 'force_action', 'agent_delay', 'location_hours', 'weather', 'cancel_commitment', 'encounter', 'unknown'] },
    agentId: { type: ['string', 'null'] },
    agentB: { type: ['string', 'null'] },
    locationId: { type: ['string', 'null'] },
    time: { type: ['string', 'null'], description: 'HH:MM between 06:00 and 24:00' },
    until: { type: ['string', 'null'], description: 'HH:MM' },
    minutes: { type: ['integer', 'null'] },
    action: { type: ['string', 'null'], enum: ['coffee', 'relax_park', 'read_library', 'eat_restaurant', 'eat_bakery', 'shop_groceries', 'workout', 'rest_home', 'eat_cafe', 'visit', null] },
    condition: { type: ['string', 'null'], enum: ['rain', 'clear', null] },
    busEventId: { type: ['string', 'null'] },
    explanation: { type: 'string' },
    confidence: { type: 'number' },
  },
} as const;

class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  readonly model = MODEL;
  private client = new Anthropic();

  private systemForInterpret(ctx: InterpretContext): string {
    const agents = AGENTS.map((a) => `${a.id} (${a.firstName} ${a.name.split(' ')[1]}, ${a.occupation}; relations: ${a.relationships.map((r) => `${r.kind}:${r.to}`).join(', ')})`).join('\n');
    const locations = LOCATIONS.filter((l) => l.kind !== 'bus_stop').map((l) => `${l.id} (${l.name})`).join(', ');
    const buses = (ctx.recentEvents ?? [])
      .filter((e) => e.type === 'bus_arrive')
      .slice(0, 40)
      .map((e) => `${e.id}: bus ${e.busId} arrive à ${e.locationId} à ${fmtTime(e.t)}`)
      .join('\n');
    return [
      'Tu traduis une demande en français de type « Et si… » en une intervention structurée pour une simulation de ville miniature (journée 06:00–24:00).',
      `Heure courante : ${fmtTime(ctx.t)}.${ctx.selectedEvent ? ` Événement sélectionné : ${ctx.selectedEvent.id} (${ctx.selectedEvent.type}) ${ctx.selectedEvent.label} à ${fmtTime(ctx.selectedEvent.t)}.` : ''}`,
      'Habitants :\n' + agents,
      'Lieux : ' + locations,
      'Arrivées de bus connues :\n' + (buses || '(aucune)'),
      'Règles : kind=bus_delay → minutes et busEventId (l’arrivée visée ; par défaut l’événement sélectionné ou la prochaine arrivée après l’heure courante). kind=stay_home → agentId, until (par défaut 12:00 pour « ce matin », 24:00 sinon). kind=force_action → agentId, action, locationId, time. kind=location_hours → locationId, time (= heure de fermeture). kind=weather → condition, time. kind=cancel_commitment → agentId. kind=encounter → agentId, agentB, locationId, time. kind=agent_delay → agentId, minutes. Si la demande ne correspond à rien, kind=unknown avec une explication. Ne jamais inventer d’habitant ou de lieu absent des listes.',
    ].join('\n\n');
  }

  async interpret(text: string, ctx: InterpretContext): Promise<StructuredInterpretation> {
    const common = {
      model: this.model,
      max_tokens: 2000,
      system: this.systemForInterpret(ctx),
      messages: [{ role: 'user' as const, content: text }],
      output_config: { effort: 'low' as const, format: { type: 'json_schema' as const, schema: INTERPRET_SCHEMA as unknown as Record<string, unknown> } },
    };
    const response = USE_FALLBACKS
      ? await this.client.beta.messages.create({ ...common, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : await this.client.messages.create(common);
    if (response.stop_reason === 'refusal') throw new Error('La demande a été refusée par le modèle.');
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') throw new Error('Réponse vide du modèle.');
    return JSON.parse(textBlock.text) as StructuredInterpretation;
  }

  async narrate(facts: string, style: string): Promise<string> {
    const system = [
      'Tu es le narrateur de BUTTERFLY, une simulation de ville miniature. On te donne des faits enregistrés par le moteur de simulation (heures, lieux, personnes, événements).',
      'Réécris-les en français, en prose élégante, vivante et sobre, à la troisième personne, au passé. Garde toutes les heures et tous les noms exacts.',
      'Interdiction absolue d’inventer un événement, une rencontre, un dialogue, un lieu ou une motivation qui ne figure pas dans les faits. Si un élément manque, n’en parle pas.',
      style === 'agent' ? 'Format : un portrait de 2 à 4 paragraphes.' : style === 'causal' ? 'Format : explique la chaîne de causes et d’effets pas à pas, en soulignant ce qui est prouvé et ce qui est seulement probable.' : style === 'compare' ? 'Format : raconte ce qui a changé entre les deux réalités, en distinguant conséquences vérifiées et simples différences.' : 'Format : un récit de la journée en sections courtes avec titres, puis un paragraphe par habitant cité.',
    ].join('\n');
    const common = {
      model: this.model,
      max_tokens: 12000,
      system,
      messages: [{ role: 'user' as const, content: facts }],
      output_config: { effort: 'medium' as const },
    };
    const stream = USE_FALLBACKS
      ? this.client.beta.messages.stream({ ...common, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : this.client.messages.stream(common);
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') throw new Error('La narration a été refusée par le modèle.');
    const blocks = final.content as unknown as Array<{ type: string; text?: string }>;
    return blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n');
  }
}

function createProvider(): AiProvider | null {
  if (process.env.BUTTERFLY_AI_DISABLED === '1') return null;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  return new AnthropicProvider();
}

// ---------------------------------------------------------------------------
// Turn the LLM's structured answer into a validated Intervention.
// ---------------------------------------------------------------------------

function parseClock(s: string | null): number | null {
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const t = Number(m[1]) * 60 + Number(m[2]);
  return t >= DAY_START && t <= DAY_END ? t : null;
}

function toIntervention(r: StructuredInterpretation, ctx: InterpretContext): { intervention?: Intervention; issues: string[] } {
  const issues: string[] = [];
  const t = parseClock(r.time) ?? ctx.t;
  const name = (id: string | null) => AGENTS.find((a) => a.id === id)?.firstName ?? id ?? '?';
  const locName = (id: string | null) => LOCATIONS.find((l) => l.id === id)?.name ?? id ?? '?';
  let iv: Intervention | undefined;
  switch (r.kind) {
    case 'bus_delay': {
      const events = ctx.recentEvents ?? [];
      const arrival = events.find((e) => e.id === r.busEventId && e.type === 'bus_arrive') ?? (ctx.selectedEvent?.type === 'bus_arrive' ? ctx.selectedEvent : undefined) ?? events.find((e) => e.type === 'bus_arrive' && e.t >= ctx.t);
      if (!arrival) issues.push('Aucune arrivée de bus trouvée pour appliquer le retard.');
      else iv = busDelayFor(arrival, r.minutes ?? 3);
      break;
    }
    case 'stay_home':
      if (!r.agentId) issues.push('Habitant manquant.');
      else iv = { id: newInterventionId(), kind: 'stay_home', agentId: r.agentId, t: Math.min(t, (parseClock(r.until) ?? DAY_END) - 1), until: parseClock(r.until) ?? DAY_END, description: `${name(r.agentId)} reste à la maison jusqu’à ${fmtTime(parseClock(r.until) ?? DAY_END)}` };
      break;
    case 'force_action':
      if (!r.agentId || !r.action) issues.push('Habitant ou action manquant.');
      else iv = { id: newInterventionId(), kind: 'force_action', agentId: r.agentId, t, action: r.action as ActionType, locationId: r.locationId ?? undefined, description: `${name(r.agentId)} décide : ${r.action}${r.locationId ? ` (${locName(r.locationId)})` : ''} à ${fmtTime(t)}` };
      break;
    case 'agent_delay':
      if (!r.agentId) issues.push('Habitant manquant.');
      else iv = { id: newInterventionId(), kind: 'agent_delay', agentId: r.agentId, t, minutes: r.minutes ?? 10, description: `${name(r.agentId)} s’attarde ${r.minutes ?? 10} min` };
      break;
    case 'location_hours':
      if (!r.locationId) issues.push('Lieu manquant.');
      else iv = { id: newInterventionId(), kind: 'location_hours', locationId: r.locationId, t: Math.min(ctx.t, t), closes: t, description: `${locName(r.locationId)} ferme à ${fmtTime(t)}` };
      break;
    case 'weather':
      iv = { id: newInterventionId(), kind: 'weather', t, condition: r.condition ?? 'rain', until: r.condition === 'clear' ? undefined : Math.min(DAY_END, t + 90), description: r.condition === 'clear' ? `La pluie cesse à ${fmtTime(t)}` : `La pluie commence à ${fmtTime(t)}` };
      break;
    case 'cancel_commitment':
      if (!r.agentId) issues.push('Habitant manquant.');
      else iv = { id: newInterventionId(), kind: 'cancel_commitment', agentId: r.agentId, t: ctx.t, description: `${name(r.agentId)} ne se rend pas à son prochain rendez-vous` };
      break;
    case 'encounter':
      if (!r.agentId || !r.agentB) issues.push('Il faut deux habitants pour une rencontre.');
      else iv = { id: newInterventionId(), kind: 'encounter', agentA: r.agentId, agentB: r.agentB, locationId: r.locationId ?? 'park', t, description: `${name(r.agentId)} et ${name(r.agentB)} se retrouvent à ${locName(r.locationId ?? 'park')} à partir de ${fmtTime(t)}` };
      break;
    default:
      issues.push(r.explanation || 'Demande non comprise.');
  }
  if (iv) {
    const errors = validateIntervention(iv);
    if (errors.length) {
      issues.push(...errors);
      iv = undefined;
    }
  }
  return { intervention: iv, issues };
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

const provider = createProvider();

/**
 * Decision advisor selection. BUTTERFLY_ADVISOR=jev|anthropic|none forces one;
 * otherwise Jev is preferred when TYPESAFE_API_KEY is set (fast, typed, cheap),
 * then the Anthropic provider, else none (the browser falls back to the mock).
 */
function createAdvisor(): DecisionAdvisor | null {
  const forced = process.env.BUTTERFLY_ADVISOR;
  if (forced === 'none') return null;
  if (process.env.TYPESAFE_API_KEY && forced !== 'anthropic') return new JevAdvisor({ apiKey: process.env.TYPESAFE_API_KEY, model: process.env.TYPESAFE_MODEL ?? 'jev-latest' });
  if (provider && forced !== 'jev') return new AnthropicAdvisor(MODEL, USE_FALLBACKS);
  return null;
}
const advisor = createAdvisor();
const cache = new Map<string, unknown>();
const cacheKey = (...parts: unknown[]) => createHash('sha1').update(JSON.stringify(parts)).digest('hex');

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 2_000_000) reject(new Error('Corps de requête trop volumineux'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function describeError(err: unknown): { status: number; message: string } {
  if (err instanceof Anthropic.AuthenticationError) return { status: 401, message: 'Clé API invalide.' };
  if (err instanceof Anthropic.RateLimitError) return { status: 429, message: 'Limite de débit atteinte, réessayez dans un instant.' };
  if (err instanceof Anthropic.BadRequestError) return { status: 400, message: `Requête refusée par l’API : ${err.message}` };
  if (err instanceof Anthropic.APIError) return { status: 502, message: `Erreur de l’API (${err.status}) : ${err.message}` };
  return { status: 500, message: err instanceof Error ? err.message : String(err) };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname === '/api/ai/status') {
      const advisorInfo = advisor ? { advisor: advisor.name, advisorModel: 'model' in advisor ? (advisor as { model: string }).model : undefined } : { advisor: null };
      return json(res, 200, provider ? { enabled: true, model: provider.model, provider: provider.name, fallbacks: USE_FALLBACKS, message: `Narration IA activée (${provider.model})`, ...advisorInfo } : { enabled: false, message: advisor ? `Narration IA désactivée (aucune clé Anthropic) — conseiller de décision ${advisor.name} actif.` : 'Aucune clé API configurée — narration IA désactivée, repli déterministe local.', ...advisorInfo });
    }
    if (req.method !== 'POST') return json(res, 405, { ok: false, explanation: 'Méthode non autorisée', issues: [] });
    const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
    if (url.pathname === '/api/ai/decide') {
      if (!advisor) return json(res, 503, { ok: false, answers: [], explanation: 'Aucun conseiller de décision configuré (TYPESAFE_API_KEY ou ANTHROPIC_API_KEY).' });
      const requests = (Array.isArray(body.requests) ? body.requests : []).slice(0, 120) as AdviceRequest[];
      const key = cacheKey('decide', advisor.name, requests.map((r) => [r.key, r.candidates.map((c) => c.choice)]));
      if (!cache.has(key)) cache.set(key, { ok: true, answers: await advisor.advise(requests), source: advisor.name });
      return json(res, 200, cache.get(key));
    }
    if (!provider) return json(res, 503, { ok: false, explanation: 'IA désactivée (aucune clé API).', issues: ['Configurez ANTHROPIC_API_KEY côté serveur.'], text: '' });
    if (url.pathname === '/api/ai/interpret') {
      const text = String(body.text ?? '').slice(0, 2000);
      const ctx = (body.context ?? { t: DAY_START }) as InterpretContext;
      const key = cacheKey('interpret', text, ctx.t, ctx.selectedEvent?.id);
      if (!cache.has(key)) {
        const structured = await provider.interpret(text, ctx);
        const { intervention, issues } = toIntervention(structured, ctx);
        cache.set(key, { ok: !!intervention, intervention, explanation: structured.explanation, issues, confidence: structured.confidence, source: provider.name });
      }
      return json(res, 200, cache.get(key));
    }
    if (url.pathname === '/api/ai/narrate') {
      const facts = String(body.facts ?? '').slice(0, 60000);
      const style = String(body.style ?? 'day');
      const key = cacheKey('narrate', facts, style);
      if (!cache.has(key)) cache.set(key, { ok: true, text: await provider.narrate(facts, style), source: provider.name });
      return json(res, 200, cache.get(key));
    }
    return json(res, 404, { ok: false, explanation: 'Route inconnue', issues: [] });
  } catch (err) {
    const { status, message } = describeError(err);
    return json(res, status, { ok: false, explanation: message, issues: [message], text: '' });
  }
});

server.listen(PORT, () => {
  console.log(`BUTTERFLY AI adapter on http://localhost:${PORT} — narration: ${provider ? `${provider.name} (${provider.model}${USE_FALLBACKS ? ', fallbacks on' : ''})` : 'disabled'}; decision advisor: ${advisor ? advisor.name : 'none (browser mock)'}`);
});
