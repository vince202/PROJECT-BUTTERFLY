// Visual check loop for the 3D city (src/render): starts Vite on its own port,
// opens the app in headless Chromium (software GL), seeks to key moments of the
// day and frames scripted camera views through window.__butterflyCamera.
// Usage: node scripts/render-check.mjs [outDir] [--only=08h,12h] [--views=overview,medium]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith('--')) ?? 'screenshots/render-check';
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]?.split(',');
const onlyTimes = opt('only');
const onlyViews = opt('views');
const width = Number(opt('w')?.[0] ?? 1280);
const height = Number(opt('h')?.[0] ?? 760);
mkdirSync(outDir, { recursive: true });

const port = 5178;
const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let ready = false;
vite.stdout.on('data', (d) => { if (String(d).includes('Local:')) ready = true; });
vite.stderr.on('data', (d) => process.stderr.write(d));
const started = Date.now();
while (!ready && Date.now() - started < 40000) await new Promise((r) => setTimeout(r, 200));
const stop = (code) => { try { process.kill(-vite.pid, 'SIGTERM'); } catch { /* gone */ } process.exit(code); };
if (!ready) { console.error('vite did not start'); stop(1); }

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width, height } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('/api/ai')) errors.push(`console: ${m.text()}`); });
await page.goto(`http://localhost:${port}/`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => !!window.__butterfly, null, { timeout: 90000 });
await page.waitForTimeout(6000);
// Make the 3D view fill the viewport (UI panels hidden for the screenshots only).
await page.addStyleTag({ content: '.city-scene{position:fixed!important;inset:0!important;z-index:9999!important}' });
await page.evaluate(() => { const s = window.__butterfly.getState(); s.pause(); s.selectAgent(null); s.followAgent(null); if (s.setUiMode) s.setUiMode('lab'); });
await page.waitForTimeout(1500);
const hasCam = await page.evaluate(() => !!window.__butterflyCamera);

// Rainy minute in the displayed reality, if any.
const rainMinute = await page.evaluate(() => {
  const r = window.__butterfly.getState().realityA;
  for (let t = 420; t < 1380; t += 5) if (r.frameAt(t)?.weather === 'rain') return t + 10;
  return null;
});
console.log('rain minute:', rainMinute, 'camera api:', hasCam);

const C = { x: 360, y: 0, z: 240 };
const VIEWS = {
  overview: { target: C, distance: 900, azimuth: 0.36, polar: 0.92 },
  hero: { target: { x: 320, y: 0, z: 190 }, distance: 420, azimuth: 0.5, polar: 0.95 },
  medium: { target: { x: 330, y: 0, z: 170 }, distance: 200, azimuth: 0.7, polar: 1.0 },
  cafe: { target: { x: 300, y: 3, z: 132 }, distance: 58, azimuth: Math.PI + 0.55, polar: 1.28 },
  marche: { target: { x: 425, y: 3, z: 132 }, distance: 62, azimuth: Math.PI - 0.6, polar: 1.25 },
  bakery: { target: { x: 128, y: 3, z: 185 }, distance: 55, azimuth: -Math.PI / 2 - 0.5, polar: 1.28 },
  park: { target: { x: 360, y: 2, z: 270 }, distance: 75, azimuth: 0.3, polar: 1.15 },
  school: { target: { x: 360, y: 3, z: 105 }, distance: 70, azimuth: 0.25, polar: 1.25 },
};
const TIMES = [
  { key: '08h', t: 8 * 60, views: ['overview', 'hero', 'medium', 'bakery', 'cafe', 'school'] },
  { key: '12h', t: 12 * 60 + 30, views: ['hero', 'medium', 'cafe', 'park', 'marche'] },
  { key: '18h', t: 18 * 60 + 30, views: ['hero', 'medium'] },
  { key: '21h', t: 21 * 60 + 30, views: ['hero', 'medium', 'cafe', 'park'] },
  { key: '23h', t: 23 * 60 + 15, views: ['medium', 'marche'] },
  { key: '06h', t: 6 * 60 + 30, views: ['hero'] },
];
if (rainMinute) TIMES.push({ key: 'rain', t: rainMinute, views: ['medium', 'cafe'] });

const stats = [];
for (const T of TIMES) {
  if (onlyTimes && !onlyTimes.includes(T.key)) continue;
  await page.evaluate((t) => window.__butterfly.getState().seek(t), T.t);
  for (const v of T.views) {
    if (onlyViews && !onlyViews.includes(v)) continue;
    if (hasCam) await page.evaluate((view) => window.__butterflyCamera.setView({ ...view, instant: true }), VIEWS[v]);
    await page.waitForTimeout(2500);
    const file = `${outDir}/${T.key}-${v}.png`;
    await page.screenshot({ path: file });
    const info = await page.evaluate(() => window.__butterflyRender?.info?.() ?? null);
    stats.push({ file, ...info });
    console.log('shot', file, info ? `calls=${info.calls} tris=${info.triangles}` : '');
  }
}
writeFileSync(`${outDir}/stats.json`, JSON.stringify(stats, null, 2));
console.log(errors.length ? `Errors:\n${errors.slice(0, 20).join('\n')}` : 'No page errors');
await browser.close();
stop(0);
