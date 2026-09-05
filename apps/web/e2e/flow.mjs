// Browser flow against a running dev stack (server :3000 + vite :5173).
// Needs playwright: `PW=/path/to/node_modules/playwright/index.mjs CHROME=/path/to/chrome node e2e/flow.mjs`
// Screenshots land in $SHOTS (default /tmp/shots).
import fs from 'node:fs';

const { chromium } = await import(process.env.PW ?? 'playwright');
const SHOTS = process.env.SHOTS ?? '/tmp/shots';
fs.mkdirSync(SHOTS, { recursive: true });

const BASE = process.env.BASE ?? 'http://localhost:5173';
const b = await chromium.launch({
	executablePath: process.env.CHROME,
	args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = async () => {
	const c = await b.newContext({ viewport: { width: 1400, height: 900 } });
	await c.addInitScript(() => localStorage.setItem('rubrik-prefs', JSON.stringify({ state: { animate: false, sound: false }, version: 0 })));
	const p = await c.newPage();
	p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
	p.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()));
	return p;
};
const shot = (p, name) => p.screenshot({ path: `${SHOTS}/${name}.png` });
const state = (p) => p.evaluate(() => {
	const g = window.__game.getState();
	return { myColor: g.myColor, turn: g.turn, plies: g.history.length, status: g.status, sans: g.sans, clock: g.clock, watchers: g.watchers, presence: g.presence, drawOffer: g.drawOffer, takebackOffer: g.takebackOffer };
});
const playAny = (p) => p.evaluate(() => {
	const g = window.__game.getState();
	const moves = g.cells.filter((c) => c.piece && c.piece.color === g.turn).flatMap((c) => g.engine.legalMoves(c.id));
	const mv = moves.find((m) => m.kind === 'step' && m.capture) ?? moves.find((m) => m.kind === 'step');
	g.play(mv);
	return mv;
});
const assert = (cond, msg) => { if (!cond) { console.log('FAIL:', msg); process.exitCode = 1; } else console.log('ok:', msg); };

const A = await ctx();
const B = await ctx();
await A.goto(BASE);
await B.goto(BASE);
await A.waitForTimeout(800);
await A.getByRole('button', { name: /5\+3/ }).click();
await A.waitForTimeout(400);
await shot(A, 'lobby-seeking');
const seekRows = await B.locator('table tbody tr').count();
assert(seekRows === 1, 'B sees A seek in lobby table');
await B.getByRole('button', { name: /5\+3/ }).click();
await A.waitForURL(/\/g\//, { timeout: 5000 });
await B.waitForURL(/\/g\//, { timeout: 5000 });
const gameUrl = A.url();
console.log('game', gameUrl);
await A.waitForTimeout(1500);
let sa = await state(A), sb = await state(B);
assert(sa.myColor && sb.myColor && sa.myColor !== sb.myColor, 'colours assigned');
const W = sa.myColor === 'white' ? A : B;
const Bl = W === A ? B : A;

for (let i = 0; i < 6; i++) {
	const p = i % 2 === 0 ? W : Bl;
	await playAny(p);
	await p.waitForTimeout(500);
}
sa = await state(W);
assert(sa.plies === 6, `6 plies played (${sa.plies}) sans=${sa.sans.join(' ')}`);
assert(sa.watchers === 2, `watchers=2 (${sa.watchers})`);
await shot(W, 'game-white');
await shot(Bl, 'game-black');

// spectator
const S = await ctx();
await S.goto(gameUrl);
await S.waitForTimeout(1500);
await shot(S, 'game-spectator');
const ss = await state(S);
assert(ss.myColor === null && ss.plies === 6, 'spectator sees game');
assert(ss.watchers === 3, `watchers=3 (${ss.watchers})`);
await S.goto(BASE + '/tv');
await S.waitForURL(/\/g\//, { timeout: 5000 });
assert(S.url() === gameUrl, 'tv redirects to live game');
await S.goto(BASE);
await S.waitForTimeout(800);
await shot(S, 'lobby-live');

// history navigation
await W.keyboard.press('ArrowLeft');
await W.waitForTimeout(300);
await W.keyboard.press('ArrowLeft');
await W.waitForTimeout(300);
let cur = await W.evaluate(() => window.__game.getState().cursor);
assert(cur === 4, `arrow keys move cursor (${cur})`);
await shot(W, 'game-replay');
await W.keyboard.press('ArrowDown');
await W.waitForTimeout(300);

// chat
await W.locator('input[placeholder="Type a message…"]').first().fill('gg hf');
await W.locator('input[placeholder="Type a message…"]').first().press('Enter');
await Bl.waitForTimeout(500);
assert((await Bl.getByText('gg hf').count()) > 0, 'chat delivered');

// draw offer + decline
await W.getByTitle('Offer a draw').click();
await W.getByTitle('Accept').click(); // confirm
await Bl.waitForTimeout(500);
await shot(Bl, 'game-draw-offer');
assert((await Bl.getByText('Opponent offers a draw').count()) === 1, 'black sees draw offer');
await Bl.getByTitle('Decline').click();
await W.waitForTimeout(500);
assert((await state(W)).drawOffer === null, 'draw declined');

// takeback: black (just moved? no: white to move after 6 plies) — black asks, white accepts → undo to black's turn = 1 ply
await Bl.getByTitle('Propose a takeback').click();
await W.waitForTimeout(500);
assert((await W.getByText('Opponent asks for a takeback').count()) === 1, 'white sees takeback');
await W.getByTitle('Accept').click();
await W.waitForTimeout(1200);
sa = await state(W);
assert(sa.plies === 5 && sa.turn === 'black', `takeback rewound to 5 plies, black to move (${sa.plies}, ${sa.turn})`);

// resign (white), rematch offer by black
await W.getByTitle('Resign').click();
await W.getByTitle('Accept').click();
await W.waitForTimeout(800);
sa = await state(W);
assert(sa.status.kind === 'won' && sa.status.winner === 'black', 'white resigned');
await shot(W, 'game-over-loser');
await Bl.getByRole('button', { name: 'Rematch' }).click();
await W.waitForTimeout(500);
await shot(W, 'game-over-rematch-offer');
assert((await W.getByText('Opponent wants a rematch').count()) === 1, 'rematch offer shown');
await W.getByTitle('Accept').click();
await W.waitForURL((u) => u.toString() !== gameUrl && /\/g\//.test(u.toString()), { timeout: 5000 });
await Bl.waitForURL((u) => u.toString() !== gameUrl && /\/g\//.test(u.toString()), { timeout: 5000 });
await W.waitForTimeout(1200);
const s2 = await state(W);
assert(s2.myColor === 'black' && s2.plies === 0, `rematch started with swapped colours (${s2.myColor})`);

// challenge flow
const C = await ctx();
await C.goto(BASE);
await C.waitForTimeout(600);
await C.getByRole('button', { name: 'Play with a friend' }).click();
await C.getByRole('button', { name: 'Create challenge link' }).click();
await C.waitForURL(/\/c\//, { timeout: 5000 });
await C.waitForTimeout(500);
await shot(C, 'challenge-owner');
const D = await ctx();
await D.goto(C.url());
await D.waitForTimeout(600);
await shot(D, 'challenge-guest');
await D.getByRole('button', { name: 'Accept' }).click();
await C.waitForURL(/\/g\//, { timeout: 5000 });
await D.waitForURL(/\/g\//, { timeout: 5000 });
assert(true, 'challenge link started a game');

// prefs + profile + players pages
await S.goto(BASE + '/u/' + encodeURIComponent((await W.evaluate(() => window.__game.getState().players.white.name))));
await S.waitForTimeout(800);
await shot(S, 'profile');
await S.getByTitle('Preferences').click();
await S.waitForTimeout(300);
await shot(S, 'prefs');
await S.setViewportSize({ width: 420, height: 860 });
await S.goto(gameUrl);
await S.waitForTimeout(1500);
await shot(S, 'game-mobile');

await b.close();
console.log('done');
