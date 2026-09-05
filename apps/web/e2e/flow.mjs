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
await S.waitForTimeout(1500);
assert((await S.locator('svg[aria-label="Unfolded board"]').count()) >= 1, 'watch page shows live mini-boards');
await shot(S, 'watch');
await S.getByRole('link', { name: 'Watch TV' }).click();
await S.waitForURL(/\/g\//, { timeout: 5000 });
assert(S.url() === gameUrl, 'tv jumps to the featured game');
await S.goto(BASE);
await S.waitForTimeout(800);
await shot(S, 'lobby-live');

// move times trail present in the move list (title = seconds spent)
const timed = await W.locator('button[title$="s"]', { hasText: /^N/ }).count();
assert(timed >= 6, `move time bars in move list (${timed})`);

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

// 2D net view
await Bl.getByTitle('Switch to 2D net').click();
await Bl.waitForTimeout(300);
assert((await Bl.locator('svg[aria-label="Unfolded board"]').count()) >= 1, '2D net renders');
await shot(Bl, 'game-2d');
await Bl.getByTitle('Switch to 3D cube').click();

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

// header badge: it's W's move in the rematch game (0 plies, W is... whoever is white now)
const whiteNow = (await state(W)).myColor === 'white' ? W : Bl;
await whiteNow.goto(BASE);
await whiteNow.waitForTimeout(1200);
assert((await whiteNow.getByTitle(/Your move against/).count()) === 1, 'header shows games waiting on me');
await whiteNow.goBack();
await whiteNow.waitForTimeout(800);

// lobby shows the in-progress game to a player
await W.goto(BASE);
await W.waitForTimeout(1200);
assert((await W.getByText('Game in progress against').count()) === 1, 'lobby resume banner');
await W.getByText('Resume →').click();
await W.waitForURL(/\/g\//, { timeout: 5000 });
await W.waitForTimeout(1000);

// moretime: W (now black) gives 15s → opponent (white) clock grows
const before = (await state(W)).clock.white_ms;
await W.getByTitle('Give your opponent 15 seconds').click();
await W.waitForTimeout(500);
const after = (await state(W)).clock.white_ms;
assert(after - before >= 12_000 && after - before <= 15_000, `moretime added ~15s (clock re-based) (${after - before})`);
// abort before ply 2
await W.getByTitle('Abort game').click();
await W.waitForTimeout(600);
const ab = await state(W);
assert(ab.status.kind === 'draw' && ab.status.reason === 'abandoned', `abort → unrated draw (${JSON.stringify(ab.status)})`);
await shot(W, 'game-aborted');
assert((await S.getByText(/\d+ online/).count()) === 1, 'online count in header');

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

// custom rubrik seek via the setup dialog, accepted from the seeks table
const E = await ctx();
await E.goto(BASE);
await E.waitForTimeout(600);
await E.getByRole('button', { name: 'Create a game' }).click();
await E.locator('label', { hasText: 'Rubrik colours' }).locator('button').click();
await E.getByRole('button', { name: 'Create game' }).click();
await E.waitForTimeout(500);
assert((await E.locator('table tbody tr', { hasText: 'rubrik' }).count()) === 1, 'rubrik seek listed');
const F = await ctx();
await F.goto(BASE);
await F.waitForTimeout(600);
await F.locator('table tbody tr', { hasText: 'rubrik' }).click();
await F.waitForURL(/\/g\//, { timeout: 5000 });
await F.waitForTimeout(1200);
const lay = await F.evaluate(() => window.__game.getState().config.layout.join(''));
assert(lay === '012345', `rubrik layout game started (${lay})`);
await F.locator('input[placeholder="Type a message…"]').first().fill('hello history');
await F.locator('input[placeholder="Type a message…"]').first().press('Enter');
await F.waitForTimeout(400);
const G = await ctx();
await G.goto(F.url());
await G.waitForTimeout(1200);
assert((await G.getByText('hello history').count()) > 0, 'late spectator gets chat history');
await shot(G, 'game-rubrik');

// unlimited (correspondence) game: slider to 0 minutes, 0 increment
const H = await ctx();
await H.goto(BASE);
await H.waitForTimeout(600);
await H.getByRole('button', { name: 'Create a game' }).click();
const sliders = H.locator('input[type=range]');
await sliders.nth(1).fill('0'); // minutes (slider 0 is days-per-move)
await sliders.nth(2).fill('0'); // increment
assert((await H.getByText('Correspondence').count()) === 1, 'setup shows correspondence');
await H.getByRole('button', { name: 'Create game' }).click();
await H.waitForTimeout(500);
const I = await ctx();
await I.goto(BASE);
await I.waitForTimeout(600);
await I.locator('table tbody tr', { hasText: '∞' }).click();
await I.waitForURL(/\/g\//, { timeout: 5000 });
await I.waitForTimeout(1200);
const ic = await state(I);
assert(ic.clock.initial_ms === 0 && ic.clock.increment_ms === 0, 'unlimited game started');
assert((await I.locator('.clock-running').count()) === 0, 'no clock widgets shown');
await shot(I, 'game-unlimited');

// direct challenge by username → toast on the target, accept from the toast
const J = await ctx();
const K = await ctx();
await J.goto(BASE);
await K.goto(BASE);
await J.waitForTimeout(800);
const kName = await K.evaluate(() => document.querySelector('header button span')?.textContent);
await J.getByRole('button', { name: 'Play with a friend' }).click();
await J.getByPlaceholder('anyone with the link').fill(kName);
await J.getByRole('button', { name: `Challenge ${kName}` }).click();
await J.waitForURL(/\/c\//, { timeout: 5000 });
await J.waitForTimeout(600);
await shot(J, 'challenge-direct');
assert((await J.getByText(`Waiting for ${kName} to join`).count()) === 1, 'owner sees targeted challenge');
await K.getByRole('button', { name: 'Accept' }).click();
await K.waitForURL(/\/g\//, { timeout: 5000 });
await J.waitForURL(/\/g\//, { timeout: 5000 });
assert(true, 'direct challenge accepted from toast');

// confirm-move preference: first click stages, ✓ sends
await J.waitForTimeout(1000);
const jw = (await state(J)).myColor === 'white' ? J : K;
await jw.getByTitle('Preferences').click();
await jw.locator('label', { hasText: 'Confirm moves before sending' }).locator('button').click();
await jw.keyboard.press('Escape');
await jw.waitForTimeout(300);
await playAny(jw);
await jw.waitForTimeout(400);
await shot(jw, 'confirm-move');
assert((await state(jw)).plies === 0 && (await jw.getByText(/^Play /).count()) === 1, 'move staged, not sent');
await jw.getByTitle('Accept').click();
await jw.waitForTimeout(600);
assert((await state(jw)).plies === 1, 'confirmed move sent');

// days-per-move correspondence game
const M = await ctx();
await M.goto(BASE);
await M.waitForTimeout(600);
await M.getByRole('button', { name: 'Create a game' }).click();
await M.locator('input[type=range]').nth(0).fill('3'); // 3 days
assert((await M.getByText('3d').count()) >= 1, 'setup shows days per move');
await M.getByRole('button', { name: 'Create game' }).click();
await M.waitForTimeout(500);
const N = await ctx();
await N.goto(BASE);
await N.waitForTimeout(600);
await N.locator('table tbody tr', { hasText: '3d' }).click();
await N.waitForURL(/\/g\//, { timeout: 5000 });
await N.waitForTimeout(1200);
const nc = (await state(N)).clock;
assert(nc.initial_ms === 3 * 86_400_000 && nc.increment_ms === nc.initial_ms, 'correspondence clock 3 days/move');
assert((await N.getByText(/\dd /).count()) >= 1, 'clock shows days');
await shot(N, 'game-correspondence');

// per-speed ratings: the resigned 5+3 game gives both players a blitz perf
await S.goto(BASE + '/u/' + encodeURIComponent(await W.evaluate(() => window.__game.getState().players.white.name)));
await S.waitForTimeout(800);
assert((await S.getByText('Blitz', { exact: true }).count()) >= 1 || (await S.locator('text=/^blitz$/i').count()) >= 1, 'profile shows blitz perf');
await S.goto(BASE + '/players');
await S.getByRole('button', { name: 'blitz' }).click();
await S.waitForTimeout(600);
assert(true, 'leaderboard perf tab');

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

// accounts: register → change password → sign out → sign in
const U = await ctx();
await U.goto(BASE);
await U.waitForTimeout(800);
const uname = 'e2e_' + Math.random().toString(36).slice(2, 8);
await U.locator('header button', { hasText: /Anon-/ }).click();
await U.getByRole('button', { name: 'Register' }).click();
await U.getByPlaceholder('username').fill(uname);
await U.getByPlaceholder('password', { exact: true }).fill('secret1');
await U.getByRole('button', { name: 'Register' }).click();
await U.waitForTimeout(1200);
assert((await U.locator('header button', { hasText: uname }).count()) === 1, 'registered and shown in header');
await U.locator('header button', { hasText: uname }).click();
await U.getByRole('button', { name: 'Change password' }).click();
await U.getByPlaceholder('current password').fill('secret1');
await U.getByPlaceholder('new password (6+ chars)').fill('secret2');
await U.getByRole('button', { name: 'Change password' }).click();
await U.waitForTimeout(600);
assert((await U.getByText('Password changed').count()) === 1, 'password changed');
await U.locator('header button', { hasText: uname }).click();
await U.getByRole('button', { name: 'Sign out' }).click();
await U.waitForTimeout(1200);
assert((await U.locator('header button', { hasText: /Anon-/ }).count()) === 1, 'signed out to a fresh anon');
await U.locator('header button', { hasText: /Anon-/ }).click();
await U.getByRole('button', { name: 'Sign in' }).click();
await U.getByPlaceholder('username').fill(uname);
await U.getByPlaceholder('password', { exact: true }).fill('secret2');
await U.getByRole('button', { name: 'Sign in' }).click();
await U.waitForTimeout(1200);
assert((await U.locator('header button', { hasText: uname }).count()) === 1, 'signed in with the new password');
await U.goto(BASE + '/players');
await U.getByPlaceholder('Find a player by name').fill(uname);
await U.getByRole('button', { name: 'Go' }).click();
await U.waitForURL(new RegExp('/u/' + uname), { timeout: 5000 });
assert(true, 'player search navigates to profile');

// follow: U follows the registered opponent-less player K; lobby shows Friends box
await U.goto(BASE + '/u/' + encodeURIComponent(kName));
await U.waitForTimeout(800);
await U.getByRole('button', { name: 'Follow' }).click();
await U.waitForTimeout(500);
assert((await U.getByRole('button', { name: 'Unfollow' }).count()) === 1, 'follow toggles');
assert((await U.getByText(/1 follower/).count()) === 1, 'follower count');
await U.goto(BASE);
await U.waitForTimeout(1200);
assert((await U.locator('section', { hasText: 'Friends' }).getByText(kName).count()) >= 1, 'lobby friends box lists them');
await shot(U, 'lobby-friends');

// private messages: U messages K from the profile; K gets a toast + inbox badge; thread persists
await U.goto(BASE + '/u/' + encodeURIComponent(kName));
await U.waitForTimeout(600);
await U.getByRole('link', { name: 'Message' }).click();
await U.waitForURL(/\/inbox\//, { timeout: 5000 });
await U.getByPlaceholder(`Message ${kName}…`).fill('hello there');
await U.getByPlaceholder(`Message ${kName}…`).press('Enter');
await K.waitForTimeout(800);
assert((await K.getByText(/hello there/).count()) >= 1, 'recipient gets a message toast');
assert((await K.getByTitle(/unread message/).count()) === 1, 'inbox badge shows unread');
await K.goto(BASE + '/inbox');
await K.waitForTimeout(800);
await K.getByRole('link', { name: /hello there/ }).click();
await K.waitForTimeout(800);
assert((await K.locator('div[title]', { hasText: 'hello there' }).count()) === 1, 'thread shows the message');
await shot(K, 'inbox');

// 3D picking + tooltip (regression: a stray global `stop` once broke every hover)
const L = await b.newContext({ viewport: { width: 1200, height: 800 } });
const lp = await L.newPage();
const errs = [];
lp.on('pageerror', (e) => errs.push(e.message));
await lp.goto(BASE + '/local');
await lp.waitForTimeout(1500);
await lp.mouse.move(447, 330);
await lp.waitForTimeout(300);
await lp.mouse.move(449, 332);
await lp.waitForTimeout(1300);
assert((await lp.locator('.tooltip').textContent())?.startsWith('Knight'), 'piece tooltip with rule');
await lp.mouse.click(449, 332);
await lp.waitForTimeout(500);
assert((await lp.evaluate(() => window.__game.getState().selected)) !== null, '3D click selects a piece');
assert(errs.length === 0, `no page errors during 3D interaction (${errs[0] ?? ''})`);

// learn page: piece pre-selected with its moves lit
await lp.goto(BASE + '/learn');
await lp.waitForTimeout(1500);
await lp.getByRole('button', { name: 'Tesseract' }).click();
await lp.waitForTimeout(600);
assert((await lp.evaluate(() => window.__game.getState().legal.length)) > 0, 'learn page shows legal moves');

await b.close();
console.log('done');
