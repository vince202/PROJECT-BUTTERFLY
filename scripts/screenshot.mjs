// Visual smoke test: starts the Vite dev server, loads the app in headless Chromium
// and saves screenshots at a few simulated times. Usage: node scripts/screenshot.mjs [outDir]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const outDir = process.argv[2] ?? 'screenshots';
mkdirSync(outDir, { recursive: true });
const port = 5177;
const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
let ready = false;
vite.stdout.on('data', (d) => { if (String(d).includes('Local:')) ready = true; });
vite.stderr.on('data', (d) => process.stderr.write(d));
const started = Date.now();
while (!ready && Date.now() - started < 30000) await new Promise((r) => setTimeout(r, 200));
if (!ready) { console.error('vite did not start'); vite.kill(); process.exit(1); }

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);
await page.screenshot({ path: `${outDir}/01-start.png` });
// Seek via the store exposed on window if available, else use the UI.
const seekTo = async (minutes) => {
  await page.evaluate((m) => { const s = window.__butterfly; if (s) s.getState().seek(m); }, minutes);
  await page.waitForTimeout(1500);
};
await seekTo(8 * 60 + 25);
await page.screenshot({ path: `${outDir}/02-morning.png` });
await seekTo(13 * 60);
await page.screenshot({ path: `${outDir}/03-noon.png` });
await seekTo(21 * 60 + 30);
await page.screenshot({ path: `${outDir}/04-night.png` });
console.log(errors.length ? `Errors:\n${errors.join('\n')}` : 'No page errors');
await browser.close();
vite.kill();
