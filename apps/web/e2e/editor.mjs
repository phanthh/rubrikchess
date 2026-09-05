// Board editor flow. Same env as flow.mjs.
const { chromium } = await import(process.env.PW ?? 'playwright');
const BASE = process.env.BASE ?? 'http://localhost:5173';
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--disable-dev-shm-usage'] });
const c = await b.newContext({ viewport: { width: 1400, height: 900 } });
await c.addInitScript(() => localStorage.setItem('rubrik-prefs', JSON.stringify({ state: { sound: false, animate: false }, version: 0 })));
const p = await c.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.goto(BASE + '/editor');
await p.waitForTimeout(1000);
await p.getByRole('button', { name: 'Clear' }).click();
console.log('needs kings:', await p.getByText('exactly one king').count());
const groups = p.locator('svg[aria-label="Unfolded board"] g');
// white king on cell 10 (face U), black king on cell 3*64+10 (face D), white queen on cell 2*64+5 (face F)
await p.locator('button[title="King"]').nth(0).click(); await groups.nth(10).click();
await p.locator('button[title="King"]').nth(1).click(); await groups.nth(3 * 64 + 10).click();
await p.locator('button[title="Queen"]').nth(0).click(); await groups.nth(2 * 64 + 5).click();
await p.screenshot({ path: `${process.env.SHOTS ?? '/tmp/shots'}/editor.png` });
await p.getByRole('button', { name: 'Play in sandbox' }).click();
await p.waitForURL(/\/local\?setup=/, { timeout: 5000 });
await p.waitForTimeout(1200);
const pcs = await p.evaluate(() => window.__game.getState().cells.filter((c) => c.piece).map((c) => `${c.id}:${c.piece.color[0]}${c.piece.kind}`));
console.log('position loaded:', pcs.join(' '), pcs.length === 3 ? 'ok' : 'FAIL');
await p.screenshot({ path: `${process.env.SHOTS ?? '/tmp/shots'}/editor-play.png` });
await b.close();
