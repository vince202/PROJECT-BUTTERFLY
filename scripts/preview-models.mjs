// Dev helper: renders glTF models side by side (native scale) to a PNG.
// Usage: node scripts/preview-models.mjs out.png "quaternius/medieval/House_1,quaternius/characters/Casual_Male" [az] [anim] [t]
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const [out, models, az = '0.5', anim = 'Idle', t = '0.3'] = process.argv.slice(2);
const port = 5179;
const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let ready = false;
vite.stdout.on('data', (d) => { if (String(d).includes('Local:')) ready = true; });
const t0 = Date.now();
while (!ready && Date.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 200));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 700 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`http://localhost:${port}/scripts/preview/models.html?m=${models}&az=${az}&anim=${anim}&t=${t}`);
await page.waitForFunction(() => window.__done, null, { timeout: 60000 });
await page.screenshot({ path: out });
await browser.close();
try { process.kill(-vite.pid, 'SIGTERM'); } catch { /* gone */ }
