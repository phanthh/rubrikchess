// Two engine-driven online games (seeds tactics for /puzzle). Same env as flow.mjs.
const { chromium } = await import(process.env.PW ?? 'playwright');
const BASE = process.env.BASE ?? 'http://localhost:5173';
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--disable-gpu'] });
const ctx = async () => { const c = await b.newContext({ viewport: { width: 800, height: 600 } }); await c.addInitScript(() => localStorage.setItem('rubrik-prefs', JSON.stringify({ state: { animate: false, sound: false, view2d: true }, version: 0 }))); return c.newPage(); };
for (let gnum = 0; gnum < 2; gnum++) {
  const A = await ctx(), B = await ctx();
  await A.goto(BASE + '/'); await B.goto(BASE + '/');
  await A.waitForTimeout(700);
  await A.getByRole('button', { name: /10\+5/ }).click(); await A.waitForTimeout(300);
  await B.getByRole('button', { name: /10\+5/ }).click();
  await A.waitForURL(/\/g\//); await B.waitForURL(/\/g\//); await A.waitForTimeout(1000);
  const W = (await A.evaluate(() => window.__game.getState().myColor)) === 'white' ? A : B; const Bl = W === A ? B : A;
  for (let ply = 0; ply < 60; ply++) {
    const p = ply % 2 === 0 ? W : Bl;
    const over = await p.evaluate((lvl) => { const g = window.__game.getState(); if (g.status.kind !== 'playing') return true; const mv = g.engine.bestMove(lvl, Date.now() % 100000); if (!mv) return true; g.play(mv); return false; }, ply % 2 === 0 ? 3 : 2);
    if (over) break;
    await p.waitForTimeout(350);
  }
  const st = await W.evaluate(() => ({ plies: window.__game.getState().history.length, status: window.__game.getState().status }));
  console.log('game', gnum, st);
  if (st.status.kind === 'playing') { await W.getByTitle('Resign').click(); await W.getByTitle('Accept').click(); await W.waitForTimeout(500); }
  await A.context().close(); await B.context().close();
}
await b.close();
