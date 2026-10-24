// Prints draw calls, triangles and the heaviest objects of the scene (overview + street level).
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const port = 5180;
const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let ready = false;
vite.stdout.on('data', (d) => { if (String(d).includes('Local:')) ready = true; });
const t0 = Date.now();
while (!ready && Date.now() - t0 < 40000) await new Promise((r) => setTimeout(r, 200));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => !!window.__butterflyCamera, null, { timeout: 90000 });
await page.waitForFunction(() => { let n = 0; window.__butterflyRender.scene.traverse((o) => { if (o.name.startsWith('character:') || o.name.startsWith('batch:roof')) n++; }); return n >= 21; }, null, { timeout: 120000 });
await page.waitForTimeout(3000);
await page.evaluate(() => { const s = window.__butterfly.getState(); s.pause(); s.seek(12 * 60 + 30); });
for (const [name, v] of [
  ['overview', { target: { x: 360, y: 0, z: 240 }, distance: 900, azimuth: 0.36, polar: 0.92 }],
  ['medium', { target: { x: 300, y: 0, z: 150 }, distance: 110, azimuth: Math.PI - 0.5, polar: 1.08 }],
  ['street', { target: { x: 300, y: 2, z: 143 }, distance: 34, azimuth: Math.PI + 0.45, polar: 1.3 }],
]) {
  await page.evaluate((view) => window.__butterflyCamera.setView({ ...view, instant: true }), v);
  await page.waitForTimeout(2500);
  const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res((n * 1000) / (performance.now() - t0)); }; requestAnimationFrame(f); }));
  const info = await page.evaluate(() => window.__butterflyRender.info());
  console.log(name, JSON.stringify(info), `fps(swiftshader)=${fps.toFixed(1)}`);
  if (process.env.BREAKDOWN || name === 'overview') console.log((await page.evaluate(() => window.__butterflyRender.breakdown())).map(([k, n]) => `${k}=${Math.round(n)}`).join('\n'));
}
await browser.close();
try { process.kill(-vite.pid, 'SIGTERM'); } catch { /* gone */ }
