/**
 * Regenerate the data part of the French `story` catalogue (src/i18n/fr/story.ts) from the French literals
 * kept in the data files:
 *   - src/sim/population.ts : AGENTS (occupation, bio, goals), COMMITMENT_SEEDS (label)
 *   - src/sim/drama.ts      : ARC_SEEDS (title, desire, secret, tension, fate[].description), ARC_KIND_LABELS_FR, ARC_STATUS_LABELS_FR
 *   - src/sim/game.ts       : DIFFICULTY_LABELS_FR
 *   - src/sim/quest.ts      : QUEST_LINK_LABELS_FR
 *
 * The block between `// @generated:data begin` and `// @generated:data end` is replaced; keys are sorted and the
 * output is idempotent. Everything above the block (the hand-written mechanics texts) is left untouched.
 *
 * Usage:
 *   npx tsx scripts/i18n-sync-story.ts          # rewrite src/i18n/fr/story.ts
 *   npx tsx scripts/i18n-sync-story.ts --check  # exit 1 when the file is out of date (no write)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AGENTS, COMMITMENT_SEEDS } from '../src/sim/population';
import { ARC_KIND_LABELS_FR, ARC_SEEDS, ARC_STATUS_LABELS_FR } from '../src/sim/drama';
import { DIFFICULTY_LABELS_FR } from '../src/sim/game';
import { QUEST_LINK_LABELS_FR } from '../src/sim/quest';

const BEGIN = '  // @generated:data begin';
const END = '  // @generated:data end';

/** Collect the data entries (key → French text). */
export function collectStoryData(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of AGENTS) {
    out[`agent.${a.id}.occupation`] = a.occupation;
    out[`agent.${a.id}.bio`] = a.bio;
    a.goals.forEach((g, i) => (out[`agent.${a.id}.goal.${i}`] = g));
  }
  for (const c of COMMITMENT_SEEDS) out[`commitment.${c.id}`] = c.label;
  for (const s of ARC_SEEDS) {
    out[`arc.${s.id}.title`] = s.title;
    out[`arc.${s.id}.desire`] = s.desire;
    if (s.secret !== undefined) out[`arc.${s.id}.secret`] = s.secret;
    out[`arc.${s.id}.tension`] = s.tension;
    (s.fate ?? []).forEach((f, i) => (out[`arc.${s.id}.fate.${i}`] = f.description));
  }
  for (const [k, v] of Object.entries(ARC_KIND_LABELS_FR)) out[`arc_kind.${k}`] = v;
  for (const [k, v] of Object.entries(ARC_STATUS_LABELS_FR)) out[`arc_status.${k}`] = v;
  for (const [k, v] of Object.entries(DIFFICULTY_LABELS_FR)) out[`difficulty.${k}`] = v;
  for (const [k, v] of Object.entries(QUEST_LINK_LABELS_FR)) out[`quest_link.${k}`] = v;
  // Empty texts (the `none` link) stay out of the catalogue: the accessors fall back to the empty literal.
  for (const k of Object.keys(out)) if (out[k] === '') delete out[k];
  return out;
}

const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

/** The generated block (marker lines included). */
export function renderBlock(data: Record<string, string>): string {
  const keys = Object.keys(data).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const lines = keys.map((k) => `  ${quote(k)}: ${quote(data[k])},`);
  return [`${BEGIN} — scripts/i18n-sync-story.ts (do not edit by hand)`, ...lines, END].join('\n');
}

/** Replace the generated block of a catalogue source. */
export function syncSource(source: string, data: Record<string, string>): string {
  const start = source.indexOf(BEGIN);
  const end = source.indexOf(END);
  if (start < 0 || end < start) throw new Error('story.ts: generated block markers not found');
  return source.slice(0, start) + renderBlock(data) + source.slice(end + END.length);
}

const target = fileURLToPath(new URL('../src/i18n/fr/story.ts', import.meta.url));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const current = readFileSync(target, 'utf8');
  const next = syncSource(current, collectStoryData());
  if (process.argv.includes('--check')) {
    if (next !== current) {
      console.error('src/i18n/fr/story.ts is out of date: run `npx tsx scripts/i18n-sync-story.ts`');
      process.exit(1);
    }
    console.log('story catalogue up to date');
  } else if (next === current) {
    console.log('story catalogue already up to date');
  } else {
    writeFileSync(target, next);
    console.log(`story catalogue rewritten (${Object.keys(collectStoryData()).length} data entries)`);
  }
}
