/**
 * Coverage of the English catalogue against the French reference.
 *   npx tsx scripts/i18n-check.ts            → summary + missing keys
 *   npx tsx scripts/i18n-check.ts --strict   → exit code 1 when keys are missing or stale
 */
import { flatten, loadCatalogue } from './i18n-tools';

async function main() {
  const strict = process.argv.includes('--strict');
  const fr = await loadCatalogue('fr');
  const en = await loadCatalogue('en');
  let missing = 0;
  let stale = 0;
  let total = 0;
  for (const ns of Object.keys(fr).sort()) {
    const frFlat = flatten(ns, fr[ns]);
    const enNs = en[ns] ?? {};
    const enFlat = new Map(flatten(ns, enNs).map((m) => [m.key, m]));
    const miss = frFlat.filter((m) => !enFlat.has(m.key));
    const extra = Object.keys(enNs).filter((id) => !(id in fr[ns]));
    const badParams = frFlat.filter((m) => enFlat.has(m.key) && m.params.some((p) => !enFlat.get(m.key)!.params.includes(p)));
    total += frFlat.length;
    missing += miss.length;
    stale += extra.length;
    console.log(`${ns.padEnd(8)} ${String(frFlat.length).padStart(4)} clés FR · ${String(frFlat.length - miss.length).padStart(4)} traduites · ${miss.length} manquantes · ${extra.length} orphelines EN · ${badParams.length} paramètres divergents`);
    for (const m of miss.slice(0, 15)) console.log(`   manque ${m.key} — ${m.text.slice(0, 80)}`);
    if (miss.length > 15) console.log(`   … et ${miss.length - 15} autres`);
    for (const m of badParams.slice(0, 10)) console.log(`   paramètres ${m.key} : FR ${m.params.join(',')} / EN ${enFlat.get(m.key)!.params.join(',')}`);
  }
  console.log(`\n${total} clés françaises, ${total - missing} traduites (${Math.round(((total - missing) / Math.max(1, total)) * 100)} %), ${stale} orphelines.`);
  if (strict && (missing || stale)) process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
