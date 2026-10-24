// Visual smoke test of the full demonstration flow: starts the Vite dev server,
// drives the app through the store in headless Chromium and saves screenshots.
// Usage: node scripts/screenshot.mjs [outDir] [--drama]   (--drama: only the dramaturgy views, under <outDir>/drama/)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const dramaOnly = process.argv.includes('--drama');
const outDir = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'screenshots';
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

// Dramaturgy views (screenshots/drama/): arc section, similarity recall, destinies,
// narration styles (with a stubbed narration endpoint), spectator drama feed, timeline lane.
async function dramaShots() {
  const dir = `${outDir}/drama`;
  mkdirSync(dir, { recursive: true });
  // DOM clicks: Playwright's own click waits for the (busy, software-WebGL) main thread after the action.
  const clickButton = (text) => page.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(t)); b?.click(); return !!b; }, text);
  const dshot = async (name, locator) => {
    await page.waitForTimeout(900);
    if (locator) await page.locator(locator).first().scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/${name}.png` });
    console.log('shot drama/' + name);
  };
  await act('switchReality', 'A'); await act('selectEvent', null);
  await act('seek', 20 * 60 + 30); await act('selectAgent', 'ines'); await dshot('01-ines-arc', '.arc-section');
  await dshot('02-ines-recall', '.recall');
  await act('selectAgent', 'antoine'); await dshot('03-antoine-arc-A', '.arc-section');
  await act('switchReality', 'B'); await dshot('04-antoine-arc-B', '.arc-section');
  const changes = await page.evaluate(() => window.__butterfly.getState().comparison.arcChanges.map((c) => `${c.text}${c.verified ? ' [vérifié]' : ''}`));
  console.log('arcChanges', changes);
  await act('setPanel', 'compare'); await dshot('05-destinies', '.destinies');
  // Stub the narration endpoint so that the narration UI can be seen without an API key.
  const posted = {};
  await page.route('**/api/ai/narrate', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    posted[body.style] = body.facts;
    const text = body.style === 'dialogue' ? 'Scène imaginée à partir des faits enregistrés\n\n(texte de démonstration renvoyé par le script de captures — aucun modèle appelé)' : `(texte de démonstration du style « ${body.style} » renvoyé par le script de captures — aucun modèle appelé)`;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, text }) });
  });
  await page.evaluate(() => { const s = window.__butterfly.getState(); s.setAi({ ...s.ai, checked: true, enabled: true }); });
  await act('setPanel', 'report');
  await clickButton('Ce matin, dans la ville');
  await dshot('06-report-morning');
  await clickButton('Ce qui aurait pu arriver');
  await dshot('07-report-counterfactual');
  const conv = await page.evaluate(() => { const r = window.__butterfly.getState().activeReality(); const e = r.events.find((x) => (x.type === 'revelation' || x.type === 'conversation') && x.actors.length >= 2 && x.t >= 600); return e ? { id: e.id, t: e.t } : null; });
  if (conv) {
    await act('setPanel', 'report'); await act('seek', conv.t); await act('selectEvent', conv.id);
    await page.waitForTimeout(600); await clickButton('Mettre en scène');
    await dshot('08-dialogue', '.narration');
  }
  for (const [style, facts] of Object.entries(posted)) writeFileSync(`${dir}/facts-${style}.txt`, facts);
  await page.unroute('**/api/ai/narrate');
  await page.evaluate(() => { const s = window.__butterfly.getState(); s.setAi({ ...s.ai, enabled: false }); });
  await act('selectEvent', null);
  // Timeline: hover the first drama marker to show its tooltip.
  const marker = page.locator('.tl-marker.fam-drama').first();
  if (await marker.count()) { await marker.hover(); await page.waitForTimeout(300); await page.screenshot({ path: `${dir}/09-timeline.png`, clip: { x: 0, y: 950 - 200, width: 1600, height: 200 } }); console.log('shot drama/09-timeline'); }
  // Spectator: play across a drama highlight at ×60 and watch the feed.
  const hl = await page.evaluate(() => { const r = window.__butterfly.getState().activeReality(); const e = r.events.find((x) => x.t >= 9 * 60 && (x.type === 'arc_resolved' || x.type === 'revelation' || x.type === 'dilemma' || (x.type === 'gossip' && x.data?.reachesTarget))); return e ? { t: e.t, agent: e.actors[0] } : null; });
  if (hl) {
    await act('setUiMode', 'spectator'); await act('selectAgent', hl.agent); await act('seek', hl.t - 0.3); await act('setSpeed', 60);
    await page.waitForTimeout(800); await act('play');
    // The software renderer is slow: wait until the playhead has actually crossed the highlight.
    await page.waitForFunction((t) => window.__butterfly.getState().time >= t + 0.05, hl.t, { timeout: 60000 }).catch(() => console.log('playhead did not reach the highlight'));
    await act('pause');
    // A full-page capture takes many seconds with software WebGL: hover the feed so that the toast is held.
    await page.waitForSelector('.drama-toast', { timeout: 10000 }).catch(() => console.log('no drama toast'));
    const box = await page.locator('.drama-toast').first().boundingBox().catch(() => null);
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/10-spectator-feed.png` }); console.log('shot drama/10-spectator-feed');
    await act('pause'); await act('setUiMode', 'lab'); await act('setSpeed', 20);
  }
  await act('setPanel', null);
}

if (dramaOnly) {
  const b = await page.evaluate(() => { const r = window.__butterfly.getState().realityA; const e = r.events.find((x) => x.type === 'bus_arrive' && x.t === 565); return e ? { busId: e.busId, t: e.t } : null; });
  if (b) await page.evaluate((x) => { window.__butterfly.getState().createRealityB({ id: 'demo_iv', kind: 'bus_delay', t: x.t - 1, minutes: 3, busId: x.busId, description: `Le bus ${x.busId} arrive avec 3 min de retard (prévu 09:25)` }); }, b);
  await page.evaluate(() => { const s = window.__butterfly.getState(); if (s.panel) s.setPanel(s.panel); });
  await dramaShots();
  console.log(errors.length ? `Errors:\n${errors.join('\n')}` : 'No page errors');
  await browser.close();
  stop(0);
}

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
  await dramaShots();
}
await act('seek', 21 * 60 + 30); await shot('10-night');
// Chained days: start day 2 from the end of the displayed reality.
await page.evaluate(() => { window.confirm = () => true; window.__butterfly.getState().nextDay(); });
await act('seek', 12 * 60 + 30); await act('selectAgent', 'alice'); await shot('11-day2');
// Advised decision policy (mock advisor when no API key).
await page.evaluate(() => window.__butterfly.getState().setPolicyMode('advised'));
await page.waitForFunction(() => !window.__butterfly.getState().advising, null, { timeout: 60000 });
const advised = await page.evaluate(() => { const r = window.__butterfly.getState().realityA; const e = r.events.find((x) => x.type === 'decision' && String(x.description).includes('Arbitrage')); return e ? { id: e.id, t: e.t, agent: e.actors[0] } : null; });
console.log('advised decision', advised, await page.evaluate(() => window.__butterfly.getState().advisorInfo));
if (advised) { await act('seek', advised.t + 1); await act('selectAgent', advised.agent); await shot('12-advised'); }
console.log(errors.length ? `Errors:\n${errors.join('\n')}` : 'No page errors');
await browser.close();
stop(0);
