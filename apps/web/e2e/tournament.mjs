// Arena flow: create (10s start) → two players join → auto-paired → resign → standings.
// Same env as flow.mjs: PW, CHROME, BASE, SHOTS.
import fs from 'node:fs';

const { chromium } = await import(process.env.PW ?? 'playwright');
const BASE = process.env.BASE ?? 'http://localhost:5173';
const SHOTS = process.env.SHOTS ?? '/tmp/shots';
fs.mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({
	executablePath: process.env.CHROME,
	args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const ctx = async () => {
	const c = await b.newContext({ viewport: { width: 1400, height: 900 } });
	await c.addInitScript(() => localStorage.setItem('rubrik-prefs', JSON.stringify({ state: { animate: false, sound: false }, version: 0 })));
	const p = await c.newPage();
	p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
	return p;
};
const assert = (cond, msg) => { if (!cond) { console.log('FAIL:', msg); process.exitCode = 1; } else console.log('ok:', msg); };

const A = await ctx();
const B = await ctx();
await A.goto(BASE + '/tournaments');
await B.goto(BASE);
await A.waitForTimeout(800);
// the dialog's shortest start is 1 min; create via the API from A's session with a 10s start
const tour = await A.evaluate(async () => {
	const r = await fetch('/api/tournaments', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name: 'e2e arena', clock: { initial_ms: 60_000, increment_ms: 0 }, walled: false, layout: 'standard', starts_in_ms: 10_000, duration_ms: 300_000 }),
	});
	return r.json();
});
assert(tour.id && tour.status === 'created', `tournament created (${tour.status})`);
await A.goto(`${BASE}/tournament/${tour.id}`);
await B.goto(`${BASE}/tournament/${tour.id}`);
await A.waitForTimeout(600);
await A.getByRole('button', { name: 'Join' }).click();
await B.getByRole('button', { name: 'Join' }).click();
await A.waitForTimeout(600);
assert((await A.getByRole('button', { name: 'Leave' }).count()) === 1, 'join toggles to leave');
assert((await A.locator('table tbody tr').count()) === 2, 'both in standings');
// arena chat reaches the other page and survives a reload
await A.locator('input[placeholder="Type a message…"]').fill('good luck all');
await A.locator('input[placeholder="Type a message…"]').press('Enter');
await B.waitForTimeout(600);
assert((await B.getByText('good luck all').count()) === 1, 'tournament chat delivered');
await B.reload();
await B.waitForTimeout(1000);
assert((await B.getByText('good luck all').count()) === 1, 'tournament chat history on reload');
await A.screenshot({ path: `${SHOTS}/tournament-created.png` });
await A.waitForURL(/\/g\//, { timeout: 25_000 });
await B.waitForURL(/\/g\//, { timeout: 25_000 });
await A.waitForTimeout(1200);
const tid = await A.evaluate(() => window.__game.getState().tournamentId);
assert(tid === tour.id, 'game carries tournament_id');
// two plies so that resign (not abort) is offered
const playAny = (p) => p.evaluate(() => {
	const g = window.__game.getState();
	const moves = g.cells.filter((c) => c.piece && c.piece.color === g.turn).flatMap((c) => g.engine.legalMoves(c.id));
	g.play(moves.find((m) => m.kind === 'step'));
});
const W = (await A.evaluate(() => window.__game.getState().myColor)) === 'white' ? A : B;
const Bl = W === A ? B : A;
await playAny(W);
await W.waitForTimeout(600);
await playAny(Bl);
await Bl.waitForTimeout(600);
await A.getByTitle('Resign').click();
await A.getByTitle('Accept').click();
await A.waitForTimeout(800);
assert((await A.getByRole('link', { name: 'Back to tournament' }).count()) === 1, 'back-to-tournament link');
await A.screenshot({ path: `${SHOTS}/tournament-game-over.png` });
await A.getByRole('link', { name: 'Back to tournament' }).click();
await A.waitForURL(/\/tournament\//, { timeout: 5000 });
// the arena re-pairs free players every 3s, so leave right away (B keeps waiting alone)
await A.getByRole('button', { name: 'Leave' }).click();
await A.waitForTimeout(500);
assert((await A.getByRole('button', { name: 'Join' }).count()) === 1, 'left tournament');
await A.waitForTimeout(1500);
const rows = await A.locator('table tbody tr').allInnerTexts();
assert(rows.some((r) => /\b2$/.test(r.trim())) && rows.some((r) => /\b0$/.test(r.trim())), `standings 2 / 0 (${rows.map((r) => r.replace(/\s+/g, ' ')).join(' | ')})`);
await B.goto(`${BASE}/tournament/${tour.id}`);
await B.waitForTimeout(1000);
assert((await B.getByText('Waiting for an opponent').count()) === 1, 'B waits for an opponent');
await A.screenshot({ path: `${SHOTS}/tournament-standings.png` });
// profile lists the arena result
const winner = (await A.locator('table tbody tr').first().innerText()).split(/\s+/)[1];
await A.goto(`${BASE}/u/${winner}`);
await A.waitForTimeout(1000);
assert((await A.getByText('e2e arena').count()) >= 1, 'profile shows tournament result');
await A.screenshot({ path: `${SHOTS}/profile-tournaments.png` });

await b.close();
console.log('done');
