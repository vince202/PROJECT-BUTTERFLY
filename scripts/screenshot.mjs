// Visual smoke test of the full demonstration flow: starts the Vite dev server,
// drives the app through the store in headless Chromium and saves screenshots.
// Usage: node scripts/screenshot.mjs [outDir] [--drama] [--game]
//   --drama: only the dramaturgy views, under <outDir>/drama/
//   --game:  only the player mode (time loop), under <outDir>/game/
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const dramaOnly = process.argv.includes('--drama');
const gameOnly = process.argv.includes('--game');
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
  const hovered = await page.evaluate(() => { const m = document.querySelector('.tl-marker.fam-drama'); m?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })); return !!m; });
  if (hovered) { await page.waitForTimeout(600); await page.screenshot({ path: `${dir}/09-timeline.png`, clip: { x: 0, y: 950 - 200, width: 1600, height: 200 } }); console.log('shot drama/09-timeline'); }
  // Spectator: play across a drama highlight at ×60 and watch the feed.
  const hl = await page.evaluate(() => { const r = window.__butterfly.getState().activeReality(); const e = r.events.find((x) => x.t >= 9 * 60 && (x.type === 'arc_resolved' || x.type === 'revelation' || x.type === 'dilemma' || (x.type === 'gossip' && x.data?.reachesTarget))); return e ? { t: e.t, agent: e.actors[0] } : null; });
  if (hl) {
    await act('setUiMode', 'spectator'); await act('selectAgent', hl.agent); await act('seek', hl.t - 0.3); await act('setSpeed', 60);
    // A full-page capture takes many seconds with software WebGL: hold the first toast as soon as it appears
    // (a synthetic mouseover, which React turns into the feed's onMouseEnter — the same as hovering it).
    await page.evaluate(() => {
      const mo = new MutationObserver(() => {
        const t = document.querySelector('.drama-toast');
        if (t && !t.dataset.held) { t.dataset.held = '1'; t.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })); }
      });
      mo.observe(document.body, { childList: true, subtree: true });
      window.__dramaObserver = mo;
    });
    await page.waitForTimeout(800); await act('play');
    // The software renderer is slow: wait until the playhead has actually crossed the highlight.
    await page.waitForFunction((t) => window.__butterfly.getState().time >= t + 0.05, hl.t, { timeout: 60000 }).catch(() => console.log('playhead did not reach the highlight'));
    await act('pause');
    await page.waitForSelector('.drama-toast', { state: 'attached', timeout: 10000 }).catch(() => console.log('no drama toast'));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/10-spectator-feed.png` }); console.log('shot drama/10-spectator-feed');
    await page.evaluate(() => window.__dramaObserver?.disconnect());
    await act('pause'); await act('setUiMode', 'lab'); await act('setSpeed', 20);
  }
  await act('setPanel', null);
}

// Player mode (screenshots/game/): start screen → follow Léa → a gesture at 08:40 → bubbles →
// midnight summary → rewind → loop 2 with the notebook → a winning gesture → victory summary.
async function gameShots() {
  const dir = `${outDir}/game`;
  mkdirSync(dir, { recursive: true });
  const clickButton = (text, sel = 'button') => page.evaluate(([t, q]) => { const b = [...document.querySelectorAll(q)].find((x) => x.textContent.includes(t)); b?.click(); return !!b; }, [text, sel]);
  // Software WebGL renders ~1 frame per second here: a full-page capture can take more than 30 s.
  const gshot = async (name, wait = 900) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${dir}/${name}.png`, timeout: 180000 }); console.log('shot game/' + name); };
  const ui = (fn, arg) => page.evaluate(([f, a]) => window.__butterflyGameUi.getState()[f](a), [fn, arg]);
  const state = () => page.evaluate(() => { const s = window.__butterfly.getState(); return { time: s.time, phase: s.game?.phase, loop: s.game?.loop, active: s.activeRealityId, b: s.realityB?.def.interventions.length ?? 0 }; });
  // Play at ×60 until the clock reaches `t` (software WebGL is slow: wait on the store, not on wall time).
  const playTo = async (t) => {
    await act('setSpeed', 60); await act('play');
    await page.waitForFunction((x) => window.__butterfly.getState().time >= x || !window.__butterfly.getState().playing, t, { timeout: 180000 }).catch(() => console.log('playTo timeout', t));
    await act('pause');
  };
  // Hold the live alerts (as hovering the feed does) so that a slow capture still shows them.
  const hold = (v) => ui('setHeld', v);

  await act('setUiMode', 'spectator');
  await gshot('01-start-screen', 1500);
  await clickButton('Léa', '.quest-card');
  await page.waitForTimeout(1500);
  console.log('game', await state());
  await gshot('02-hud-loop1', 1200);

  // Forward only: jump to 08:34, then play to 08:40.
  await act('seek', 8 * 60 + 34);
  await playTo(8 * 60 + 40);
  await gshot('03-0840', 600);

  // Composer: a French sentence, interpreted locally at the current minute.
  await page.keyboard.press('g');
  await page.waitForTimeout(600);
  await page.fill('.composer-input', 'Et si le bus avait trois minutes de retard ?');
  await page.press('.composer-input', 'Enter');
  await gshot('04-composer', 800);
  await clickButton('Appliquer ce geste');
  await page.waitForTimeout(1500);
  console.log('after gesture', await state());
  await gshot('05-gesture-applied', 400);
  // The same sentence again: refused inline (already in place in this loop).
  await page.keyboard.press('g');
  await page.waitForTimeout(600);
  await page.fill('.composer-input', 'Et si le bus avait trois minutes de retard ?');
  await page.press('.composer-input', 'Enter');
  await gshot('05b-refusal', 700);
  await page.keyboard.press('Escape');

  // Bubbles: hold the live alerts as soon as `n` are on screen (a slow capture still shows them).
  const holdWhen = (n) => page.evaluate((k) => {
    clearInterval(window.__holdTimer);
    window.__holdTimer = setInterval(() => { const g = window.__butterflyGameUi.getState(); if (g.alerts.length >= k && !g.held) g.setHeld(true); }, 50);
  }, n);
  const alertsOnScreen = () => page.evaluate(() => window.__butterflyGameUi.getState().alerts.map((a) => `${a.alert.event.t} g${a.alert.gravity} ${a.alert.link} ${a.alert.event.label}`));
  await holdWhen(3);
  await playTo(8 * 60 + 43);
  await hold(true);
  console.log('alerts 08:41', await alertsOnScreen());
  await gshot('06-bubbles-0841', 600);
  await hold(false);
  await act('seek', 9 * 60 + 40);
  await holdWhen(2);
  await playTo(9 * 60 + 48);
  await hold(true);
  console.log('alerts 09:46', await alertsOnScreen());
  await gshot('06b-bubbles-0946', 600);
  await page.evaluate(() => clearInterval(window.__holdTimer));
  await hold(false);

  // Planning with reality A: markers on the scrub bar (click = pinned label), then the A view.
  await page.evaluate(() => { const m = [...document.querySelectorAll('.scrub-marker')].find((x) => !x.classList.contains('past')); m?.click(); });
  await gshot('07-scrub-markers', 600);
  await page.evaluate(() => { const m = document.querySelector('.scrub-marker.past'); m?.click(); });
  await page.screenshot({ path: `${dir}/07b-scrub-past.png`, clip: { x: 400, y: 950 - 220, width: 800, height: 220 }, timeout: 180000 }); console.log('shot game/07b-scrub-past');
  await page.evaluate(() => { const m = document.querySelector('.scrub-marker.past'); m?.click(); });
  await clickButton('Voir la journée', 'label');
  await gshot('08-view-A', 900);
  await page.evaluate(() => window.__butterfly.getState().switchReality('B'));

  // Midnight: seek to 23:59 and let the clock close the loop.
  await act('seek', 23 * 60 + 59);
  await playTo(24 * 60);
  await page.waitForFunction(() => window.__butterfly.getState().game?.phase !== 'playing', null, { timeout: 60000 }).catch(() => console.log('loop did not close'));
  console.log('loop closed', await state());
  await gshot('09-bilan', 1200);

  // Rewind (the clock spins back to 06:00), then loop 2 with the notebook open.
  await clickButton('Rejouer');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/10-rewind.png`, timeout: 180000 }); console.log('shot game/10-rewind');
  await page.waitForFunction(() => !window.__butterflyGameUi.getState().rewinding, null, { timeout: 120000 }).catch(() => console.log('rewind did not finish'));
  console.log('loop 2', await state());
  await act('seek', 7 * 60 + 20);
  await page.keyboard.press('n');
  await gshot('11-loop2-notebook', 1200);
  await page.keyboard.press('Escape');

  // Loop 2: the quick « Imposer une décision » (defaults: Léa goes to school now) saves the quest.
  await page.keyboard.press('g');
  await page.waitForTimeout(600);
  await clickButton('Imposer une décision', '.composer-kind');
  await gshot('12-composer-quick', 800);
  await clickButton('Appliquer ce geste');
  await page.waitForTimeout(1500);
  console.log('loop 2 gesture', await state(), await page.evaluate(() => { const s = window.__butterfly.getState(); return s.realityB?.def.interventions.map((i) => i.description); }));
  await holdWhen(1);
  await playTo(7 * 60 + 45);
  await hold(true);
  console.log('alerts loop 2', await alertsOnScreen());
  await gshot('13-loop2-success-bubble', 600);
  await page.evaluate(() => clearInterval(window.__holdTimer));
  await hold(false);
  await act('seek', 23 * 60 + 59);
  await playTo(24 * 60);
  await page.waitForFunction(() => window.__butterfly.getState().game?.phase !== 'playing', null, { timeout: 60000 }).catch(() => console.log('loop 2 did not close'));
  console.log('loop 2 closed', await state());
  await gshot('14-bilan-won', 1500);
  await clickButton('Choisir une autre quête');
  await gshot('15-back-to-start', 1200);
}

if (gameOnly) {
  await gameShots().catch((e) => errors.push(`game: ${e.message.split('\n')[0]}`));
  console.log(errors.length ? `Errors:\n${errors.join('\n')}` : 'No page errors');
  await browser.close();
  stop(0);
}

if (dramaOnly) {
  const b = await page.evaluate(() => { const r = window.__butterfly.getState().realityA; const e = r.events.find((x) => x.type === 'bus_arrive' && x.t === 565); return e ? { busId: e.busId, t: e.t } : null; });
  if (b) await page.evaluate((x) => { window.__butterfly.getState().createRealityB({ id: 'demo_iv', kind: 'bus_delay', t: x.t - 1, minutes: 3, busId: x.busId, description: `Le bus ${x.busId} arrive avec 3 min de retard (prévu 09:25)` }); }, b);
  await page.evaluate(() => { const s = window.__butterfly.getState(); if (s.panel) s.setPanel(s.panel); });
  await dramaShots().catch((e) => errors.push(`drama: ${e.message.split('\n')[0]}`));
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
  await dramaShots().catch((e) => errors.push(`drama: ${e.message.split('\n')[0]}`));
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
