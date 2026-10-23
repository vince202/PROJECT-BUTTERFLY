// Visual smoke test of the full demonstration flow: starts the Vite dev server,
// drives the app through the store in headless Chromium and saves screenshots.
// Usage: node scripts/screenshot.mjs [outDir]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const outDir = process.argv[2] ?? 'screenshots';
mkdirSync(outDir, { recursive: true });
const port = 5177;
const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let ready = false;
vite.stdout.on('data', (d) => { if (String(d).includes('Local:')) ready = true; });
vite.stderr.on('data', (d) => process.stderr.write(d));
const started = Date.now();
while (!ready && Date.now() - started < 30000) await new Promise((r) => setTimeout(r, 200));
const stop = (code) => { try { process.kill(-vite.pid, 'SIGTERM'); } catch { /* already gone */ } process.exit(code); };
if (!ready) { console.error('vite did not start'); stop(1); }

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('/api/ai')) errors.push(`console: ${m.text()}`); });
await page.goto(`http://localhost:${port}/`, { waitUntil: 'load', timeout: 60000 });
await page.waitForTimeout(4000);
const shot = async (name) => { await page.waitForTimeout(1200); await page.screenshot({ path: `${outDir}/${name}.png` }); console.log('shot', name); };
const act = (fn, arg) => page.evaluate(([f, a]) => { const s = window.__butterfly.getState(); return s[f](a); }, [fn, arg]);

await shot('01-start');
await act('seek', 8 * 60 + 25); await shot('02-morning');
await act('selectAgent', 'gerard'); await act('seek', 9 * 60 + 20); await shot('03-inspector-gerard');
// Demo: the bus arriving at Place du Marché at 09:25 (seed 51)
const busEvent = await page.evaluate(() => { const r = window.__butterfly.getState().realityA; const e = r.events.find((x) => x.type === 'bus_arrive' && x.t === 565); return e ? { id: e.id, busId: e.busId, t: e.t, loc: e.locationId } : null; });
console.log('bus event', busEvent);
if (busEvent) {
  await act('selectEvent', busEvent.id); await shot('04-event-card');
  await page.evaluate((b) => { window.__butterfly.getState().createRealityB({ id: 'demo_iv', kind: 'bus_delay', t: b.t - 1, minutes: 3, busId: b.busId, description: `Le bus ${b.busId} arrive avec 3 min de retard (prévu 09:25)` }); }, busEvent);
  await page.waitForTimeout(1500); await shot('05-compare');
  const cons = await page.evaluate(() => { const c = window.__butterfly.getState().comparison; const m = [...c.consequences].reverse().find((x) => x.b && x.b.importance >= 0.6); return m ? m.b.id : null; });
  console.log('consequence', cons);
  if (cons) { await act('selectEvent', cons); await act('setPanel', 'causal'); await shot('06-causal'); }
  await act('setPanel', 'report'); await shot('07-report');
  await act('setPanel', 'butterfly'); await shot('08-butterfly');
  await act('setPanel', 'butterfly'); await act('seek', 18 * 60 + 53); await act('selectAgent', 'martin'); await shot('09-reality-b-evening');
}
await act('seek', 21 * 60 + 30); await shot('10-night');
console.log(errors.length ? `Errors:\n${errors.join('\n')}` : 'No page errors');
await browser.close();
stop(0);
