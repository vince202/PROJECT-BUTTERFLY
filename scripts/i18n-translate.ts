/**
 * Translate the French catalogues into English with a fast model (Haiku by
 * default), namespace by namespace, in batches, with a fixed glossary. Writes
 * src/i18n/en/<ns>.ts (and the index) — review the lines marked REVIEW.
 *
 *   npm run i18n:translate                 # all namespaces, only missing keys
 *   npm run i18n:translate -- --ns story   # one namespace
 *   npm run i18n:translate -- --all        # retranslate everything
 *   npm run i18n:translate -- --dry        # show batches, call nothing
 * Needs ANTHROPIC_API_KEY in .env (model: I18N_MODEL or claude-haiku-5-5).
 */
import Anthropic from '@anthropic-ai/sdk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { GLOSSARY, flatten, loadCatalogue, renderNamespaceFile, sourceSnippets } from './i18n-tools';

const MODEL = process.env.I18N_MODEL ?? 'claude-haiku-5-5';
const BATCH = 60;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['translations'],
  properties: {
    translations: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['key', 'text'], properties: { key: { type: 'string' }, text: { type: 'string' } } },
    },
  },
} as const;

const SYSTEM = [
  'You translate the user-facing strings of BUTTERFLY, a French time-loop game about a small town, from French to natural British English.',
  'Rules: keep every {placeholder} exactly as written (same name, same braces); do not add or remove placeholders. Keep proper nouns (first names, place names like « Café Le Papillon », « Parc des Tilleuls »). Keep times, numbers and units. Replace « » with “ ” and ’ with ’. Keep the tone: short, concrete, slightly literary for story texts, plain for interface texts. No explanations: return only the JSON.',
  'A string is one complete sentence or label; translate it as a whole, idiomatically, not word for word.',
  `Glossary (French → English): ${Object.entries(GLOSSARY)
    .map(([f, e]) => `${f} → ${e}`)
    .join('; ')}.`,
].join('\n');

async function main() {
  const args = process.argv.slice(2);
  const opt = (n: string) => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : undefined);
  const only = opt('ns');
  const all = args.includes('--all');
  const dry = args.includes('--dry');
  if (!dry && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) throw new Error('ANTHROPIC_API_KEY manquante (voir .env.example)');
  const client = dry ? null : new Anthropic();
  const fr = await loadCatalogue('fr');
  const en = await loadCatalogue('en');
  mkdirSync('src/i18n/en', { recursive: true });
  const written: string[] = [];
  let totalIn = 0;
  let totalOut = 0;
  for (const ns of Object.keys(fr).sort()) {
    if (only && ns !== only) continue;
    const frFlat = flatten(ns, fr[ns], sourceSnippets(`src/i18n/fr/${ns}.ts`));
    const existing = new Map(flatten(ns, en[ns] ?? {}).map((m) => [m.key, m]));
    const todo = all ? frFlat : frFlat.filter((m) => !existing.has(m.key));
    console.log(`${ns}: ${frFlat.length} clés, ${todo.length} à traduire`);
    const translated = new Map<string, string>();
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      if (dry) {
        console.log(`  lot ${i / BATCH + 1}: ${batch.map((b) => b.key).join(', ')}`);
        continue;
      }
      const user = JSON.stringify({ strings: batch.map((b) => ({ key: b.key, french: b.text, placeholders: b.params })) });
      const res = await client!.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system: SYSTEM,
        messages: [{ role: 'user', content: user }],
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA as unknown as Record<string, unknown> } },
      });
      totalIn += res.usage.input_tokens;
      totalOut += res.usage.output_tokens;
      const block = res.content.find((b) => b.type === 'text');
      if (!block || block.type !== 'text') throw new Error('Réponse vide');
      const parsed = JSON.parse(block.text) as { translations: { key: string; text: string }[] };
      for (const tr of parsed.translations) {
        const src = batch.find((b) => b.key === tr.key);
        if (!src) continue;
        const missingParam = src.params.find((p) => !tr.text.includes(`{${p}}`));
        if (missingParam) {
          console.warn(`  ! ${tr.key}: placeholder {${missingParam}} perdu, conservé en français`);
          continue;
        }
        translated.set(tr.key, tr.text);
      }
      console.log(`  lot ${i / BATCH + 1}: ${batch.length} chaînes`);
    }
    if (dry) continue;
    const merged = frFlat.map((m) => {
      const id = m.key.slice(ns.length + 1);
      const text = translated.get(m.key) ?? existing.get(m.key)?.text ?? m.text;
      const fromFrench = !translated.has(m.key) && !existing.has(m.key);
      return { id, text, params: m.params, review: m.review || fromFrench };
    });
    writeFileSync(`src/i18n/en/${ns}.ts`, renderNamespaceFile(ns, merged));
    written.push(ns);
  }
  if (!dry) {
    // Keep the English index in sync with the French one.
    const frIndex = readFileSync('src/i18n/fr/index.ts', 'utf8');
    const lines = frIndex.split('\n').filter((l) => l.startsWith('export {'));
    const present = lines.filter((l) => {
      const m = /from '\.\/([a-z]+)'/.exec(l);
      return m && existsSync(`src/i18n/en/${m[1]}.ts`);
    });
    writeFileSync('src/i18n/en/index.ts', `/** English catalogue. Files mirror src/i18n/fr; a missing key falls back to French. */\n${present.join('\n')}\n`);
    console.log(`\nÉcrit : ${written.join(', ')} — ${totalIn} jetons en entrée, ${totalOut} en sortie (${MODEL}).`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
