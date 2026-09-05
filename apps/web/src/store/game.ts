import { C_S } from '@/settings';
import { useNetStore, send } from '@/net/ws';
import {
	CellId,
	Color,
	GameConfig,
	GameState,
	Layout,
	Move,
	Piece,
	RawCell,
	ServerMsg,
	Status,
	TCell,
	TCellState,
	User,
	V3,
	ClockState,
} from '@/types';
import { AXES } from '@/utils/consts';
import { CUBOIDS } from '@/utils/cuboids';
import { clamp, vec, vkey } from '@/utils/funcs';
import { notation } from '@/utils/notation';
import { stepCurves } from '@/utils/path';
import { play as playSound } from '@/utils/sound';
import { prefs, usePrefs } from './prefs';
import { WasmGame } from 'rubrik-wasm';
import { toast } from 'sonner';
import { Vector3 } from 'three';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { startAnimation } from './animation';
import { cancelAiMoves, requestAiMove } from '@/ai';

type Threat = [CellId, CellId[]];

/** Default config from the engine, so the setup string lives in one place (Rust). */
let defaultConfig: GameConfig | null = null;
export function baseConfig(): GameConfig {
	if (!defaultConfig) {
		const g = new WasmGame(undefined);
		defaultConfig = (g.state() as GameState).config;
		g.free();
	}
	return structuredClone(defaultConfig);
}

export const LAYOUTS: Record<Layout, number[]> = { standard: [0, 0, 1, 1, 0, 1], rubrik: [0, 1, 2, 3, 4, 5] };

export function layoutOf(config: GameConfig | null | undefined): Layout {
	return config && config.layout.some((c, i) => c !== LAYOUTS.standard[i]) ? 'rubrik' : 'standard';
}

/** Human label for a game's rules, e.g. "walled · rubrik" or "standard". */
export function variantLabel(walled: boolean, layout: Layout = 'standard') {
	const parts = [walled && 'walled', layout === 'rubrik' && 'rubrik'].filter(Boolean);
	return parts.length ? parts.join(' · ') : 'standard';
}

export function localConfig(walled: boolean, layout: Layout = 'standard'): GameConfig {
	const config = baseConfig();
	config.rules.walled = walled;
	config.layout = LAYOUTS[layout];
	return config;
}

/**
 * Readable notation per ply. Extends the previous list by replaying only the
 * new tail, so a full load costs one replay and a move costs one step.
 */
function sansFor(config: GameConfig, history: Move[], prev: string[]): string[] {
	if (prev.length === history.length) return prev;
	if (prev.length > history.length) return prev.slice(0, history.length);
	const g = WasmGame.replay(config, history.slice(0, prev.length));
	const out = [...prev];
	for (let i = prev.length; i < history.length; i++) {
		const kind = (g.state() as GameState).board.cells[history[i].from].piece?.kind;
		out.push(notation(history[i], kind));
		g.play(history[i]);
	}
	g.free();
	return out;
}

function moveSound(move: Move) {
	playSound(move.kind === 'rotate' ? 'rotate' : move.capture ? 'capture' : 'move');
}

const v3 = (v: V3) => vec(v.x, v.y, v.z);
const sameV3 = (a: Vector3, b: V3) => a.x === b.x && a.y === b.y && a.z === b.z;
const samePiece = (a: Piece | null, b: Piece | null | undefined) =>
	a === (b ?? null) || (!!a && !!b && a.id === b.id && a.kind === b.kind && a.color === b.color);

/**
 * Derive render cells from an engine snapshot + selection/threats.
 * Reuses unchanged cell objects so memoised meshes don't re-render.
 */
function computeCells(
	view: GameState,
	selected: CellId | null,
	legal: Move[],
	threats: Threat[],
	prev: TCell[],
): TCell[] {
	const raw = view.board.cells;
	const states: TCellState[] = raw.map(() => 'normal');
	const moves: (Move | undefined)[] = raw.map(() => undefined);

	const last = view.history[view.history.length - 1];
	if (last && prefs().highlightLastMove) {
		states[last.from] = 'lastmove';
		if (last.kind === 'step') states[last.path[last.path.length - 1]] = 'lastmove';
	}

	for (const [id, path] of threats) {
		for (const p of path) states[p] = 'targeted:path';
		states[id] = 'targeted';
	}

	if (selected !== null) {
		const byPos: Record<string, CellId> = {};
		raw.forEach((c, id) => (byPos[`${c.pos.x},${c.pos.y},${c.pos.z}`] = id));

		for (const move of legal) {
			if (move.kind !== 'step') continue;
			const to = move.path[move.path.length - 1];
			states[to] = move.capture ? 'capturable' : 'reachable';
			moves[to] = move;
		}
		// Rotations are picked by clicking where the tesseract lands.
		for (const move of legal) {
			if (move.kind !== 'rotate') continue;
			const from = v3(raw[move.from].pos);
			const landing = from.applyAxisAngle(AXES[move.axis], (move.sign * Math.PI) / 2).round();
			const to = byPos[vkey(landing)];
			if (to === undefined) continue;
			states[to] = 'reachable';
			moves[to] = move;
		}
		states[selected] = 'active';
		moves[selected] = undefined;
	}

	return raw.map((c: RawCell, id) => {
		const old = prev[id];
		if (
			old &&
			old.state === states[id] &&
			old.move === moves[id] &&
			old.color === c.color &&
			sameV3(old.pos, c.pos) &&
			sameV3(old.side, c.side) &&
			samePiece(old.piece, c.piece)
		) {
			return old;
		}
		return {
			id,
			pos: v3(c.pos),
			side: v3(c.side),
			color: c.color,
			piece: c.piece ?? null,
			state: states[id],
			move: moves[id],
		};
	});
}

interface IGameStore {
	engine: WasmGame | null;
	config: GameConfig | null;
	// board snapshot
	cells: TCell[];
	turn: Color;
	status: Status;
	history: Move[];
	sans: string[];
	cursor: number; // replay index, === history.length when live
	selected: CellId | null;
	legal: Move[];
	threats: Threat[];
	animating: boolean;
	endStatus: Status | null; // server-declared end (resign/timeout/...), engine can't know it
	// session
	mode: 'local' | 'online';
	gameId: string | null;
	myColor: Color | null;
	players: { white: User | null; black: User | null };
	/** Rating change per colour, known only when the game ends while we watch. */
	diffs: { white: number | null; black: number | null };
	clock: ClockState | null;
	drawOffer: Color | null;
	takebackOffer: Color | null;
	presence: { white: boolean; black: boolean };
	watchers: number;
	/** Board orientation; defaults to own colour online. */
	flipped: boolean;
	/** Local game against the engine: which colour it plays and how deep it looks. */
	ai: { color: Color; level: number } | null;
	tournamentId: string | null;
	/** Online move waiting for the player's confirmation (prefs.confirmMove). */
	pendingMove: Move | null;
	/** Hide everything but the board (key `z`). */
	zen: boolean;
	// settings
	walled: boolean;
	layout: Layout;
	debug: boolean;
	lowPerf: boolean;
	// actions
	render: () => void;
	newLocal: (config?: GameConfig, ai?: { color: Color; level: number } | null) => void;
	/** Ask the engine to move if it is its turn (local mode only). */
	pokeAi: () => void;
	/** Local board loaded from a finished/ongoing game's moves; branch anywhere. */
	loadAnalysis: (config: GameConfig, moves: Move[], players: { white: User | null; black: User | null }) => void;
	select: (id: CellId | null) => void;
	play: (move: Move) => void;
	undo: () => void;
	setCursor: (n: number) => void;
	loadOnline: (msg: Extract<ServerMsg, { t: 'game_state' }>) => void;
	applyRemoteMove: (msg: Extract<ServerMsg, { t: 'move' }>) => void;
	setEnd: (msg: Extract<ServerMsg, { t: 'game_end' }>) => void;
	setDrawOffer: (by: Color | null) => void;
	setSetting: (
		patch: Partial<
			Pick<IGameStore, 'walled' | 'layout' | 'debug' | 'lowPerf' | 'flipped' | 'takebackOffer' | 'presence' | 'watchers' | 'zen' | 'clock' | 'pendingMove'>
		>,
	) => void;
}

export const useGameStore = create(
	subscribeWithSelector<IGameStore>((set, get) => ({
		engine: null,
		config: null,
		cells: [],
		turn: 'white',
		status: { kind: 'playing' },
		history: [],
		sans: [],
		cursor: 0,
		selected: null,
		legal: [],
		threats: [],
		animating: false,
		endStatus: null,
		mode: 'local',
		gameId: null,
		myColor: null,
		players: { white: null, black: null },
		diffs: { white: null, black: null },
		clock: null,
		drawOffer: null,
		takebackOffer: null,
		presence: { white: true, black: true },
		watchers: 0,
		flipped: false,
		ai: null,
		tournamentId: null,
		pendingMove: null,
		zen: false,
		walled: false,
		layout: 'standard',
		debug: false,
		lowPerf: false,

		render: () => {
			const { engine, cursor, selected } = get();
			if (!engine) return;
			const head = engine.state() as GameState;
			const at = clamp(cursor, 0, head.history.length);
			const live = at === head.history.length;

			const replay = live ? null : WasmGame.replay(head.config, head.history.slice(0, at));
			const source = replay ?? engine;
			const view = live ? head : (replay!.state() as GameState);
			const threats = prefs().showThreats ? (source.threats() as Threat[]) : [];
			const pick = live || get().mode === 'local' ? selected : null; // local boards branch from history
			const legal = pick === null ? [] : (source.legalMoves(pick) as Move[]);
			replay?.free();

			set({
				config: head.config,
				cells: computeCells(view, pick, legal, threats, get().cells),
				turn: view.turn,
				status: live ? (get().endStatus ?? view.status) : view.status,
				history: head.history,
				sans: sansFor(head.config, head.history, get().sans),
				cursor: at,
				selected: pick,
				legal,
				threats,
			});
		},

		newLocal: (config, ai = null) => {
			loadLocal(new WasmGame(config ?? localConfig(get().walled, get().layout)), {
				ai,
				flipped: ai?.color === 'white',
			});
			get().pokeAi();
		},

		pokeAi: () => {
			const { ai, engine, mode, turn, status, animating } = get();
			if (!ai || !engine || mode !== 'local' || turn !== ai.color || status.kind !== 'playing' || animating) return;
			const asked = engine;
			const ply = engine.historyLen();
			const t0 = Date.now();
			void requestAiMove(engine.state() as GameState, ai.level).then((move) => {
				const g = get();
				if (!move || g.engine !== asked || g.engine.historyLen() !== ply || g.animating) return;
				// feel: never answer instantly; re-check the position when the timer fires (undo/restart may have run)
				setTimeout(
					() => {
						const g2 = get();
						if (g2.engine === asked && g2.engine.historyLen() === ply && !g2.animating) g2.play(move);
					},
					Math.max(0, 400 - (Date.now() - t0)),
				);
			});
		},

		loadAnalysis: (config, moves, players) => {
			loadLocal(WasmGame.replay(config, moves), { players });
		},

		select: (id) => {
			const { animating, cells, cursor, history, mode, myColor, turn, status } = get();
			if (animating) return;
			if (id !== null) {
				// online: only the live position is playable; local: branch from anywhere
				if (mode === 'online' && cursor !== history.length) return;
				if (status.kind !== 'playing') return;
				const piece = cells[id]?.piece;
				if (!piece || piece.color !== turn) return;
				if (mode === 'online' && myColor !== turn) return;
				if (mode === 'local' && get().ai?.color === turn) return;
			}
			set({ selected: id, pendingMove: null });
			get().render();
		},

		play: (move) => {
			const { animating, mode, gameId, engine, status } = get();
			if (animating || !engine || status.kind !== 'playing') return;

			if (mode === 'online') {
				if (!gameId) return;
				if (prefs().confirmMove && get().pendingMove !== move) {
					set({ pendingMove: move });
					return;
				}
				send({ t: 'move', game_id: gameId, move });
				set({ selected: null, pendingMove: null });
				get().render();
				return;
			}

			runMove(move, () => {
				let engine = get().engine!;
				const { cursor, history, config } = get();
				if (cursor < history.length && config) {
					// branching: the moves after the cursor are discarded
					engine.free();
					engine = WasmGame.replay(config, history.slice(0, cursor));
					set({ engine });
				}
				try {
					engine.play(move);
					moveSound(move);
				} catch (e) {
					toast.error(String(e));
				}
				set({ animating: false, selected: null, cursor: engine.historyLen() });
				get().render();
				get().pokeAi();
			});
		},

		undo: () => {
			const { engine, mode, animating, ai } = get();
			if (!engine || mode !== 'local' || animating) return;
			cancelAiMoves();
			engine.undo();
			// against the engine, take back the whole exchange so it is our move again
			if (ai && engine.historyLen() > 0 && (engine.state() as GameState).turn === ai.color) engine.undo();
			set({ selected: null, cursor: engine.historyLen() });
			get().render();
		},

		setCursor: (n) => {
			if (get().animating) return;
			set({ cursor: n, selected: null });
			get().render();
		},

		loadOnline: (msg) => {
			const me = useNetStore.getState().me;
			const sameGame = get().gameId === msg.game_id;
			get().engine?.free();
			const engine = WasmGame.fromState(msg.game);
			const myColor =
				me && msg.white.id === me.id ? 'white' : me && msg.black.id === me.id ? 'black' : null;
			set({
				engine,
				mode: 'online',
				gameId: msg.game_id,
				players: { white: msg.white, black: msg.black },
				diffs: sameGame ? get().diffs : { white: null, black: null },
				clock: msg.clock,
				drawOffer: msg.draw_offer,
				takebackOffer: msg.takeback_offer ?? null,
				presence: msg.presence ?? { white: true, black: true },
				watchers: msg.watchers ?? 0,
				tournamentId: msg.tournament_id ?? null,
				myColor,
				flipped: sameGame ? get().flipped : myColor === 'black',
				cursor: engine.historyLen(),
				sans: [],
				selected: null,
				cells: [],
				animating: false,
				endStatus: msg.game.status.kind === 'playing' ? null : msg.game.status,
			});
			get().render();
		},

		applyRemoteMove: (msg) => {
			const { engine, cursor, history, animating } = get();
			if (!engine) return;
			if (animating) {
				// a move landed mid-animation: apply it once the current one commits
				const unsub = useGameStore.subscribe(
					(s) => s.animating,
					(a) => {
						if (a) return;
						unsub();
						get().applyRemoteMove(msg);
					},
				);
				return;
			}
			// viewing history: apply silently, keep the cursor where it is
			const live = cursor === history.length;
			const commit = () => {
				try {
					engine.play(msg.move);
					moveSound(msg.move);
				} catch (e) {
					toast.error(`out of sync: ${String(e)}`);
				}
				set({
					animating: false,
					selected: null,
					clock: msg.clock,
					drawOffer: null,
					takebackOffer: null,
					pendingMove: null,
					cursor: live ? engine.historyLen() : cursor,
					endStatus: msg.status.kind === 'playing' ? null : msg.status,
				});
				get().render();
			};
			if (live) runMove(msg.move, commit);
			else commit();
		},

		setEnd: (msg) => {
			const clock = get().clock;
			set({
				endStatus: msg.status,
				diffs: { white: msg.white_diff, black: msg.black_diff },
				selected: null,
				drawOffer: null,
				takebackOffer: null,
				clock: clock && { ...clock, running: null },
			});
			get().render();
			playSound('end');
		},

		setDrawOffer: (by) => set({ drawOffer: by }),

		setSetting: (patch) => set(patch),
	})),
);

export function game() {
	return useGameStore.getState();
}

/** Swap in a local engine and reset every per-game field. */
function loadLocal(engine: WasmGame, patch: Partial<IGameStore>) {
	game().engine?.free();
	cancelAiMoves();
	useGameStore.setState({
		engine,
		ai: null,
		mode: 'local',
		gameId: null,
		myColor: null,
		players: { white: null, black: null },
		diffs: { white: null, black: null },
		clock: null,
		drawOffer: null,
		takebackOffer: null,
		watchers: 0,
		presence: { white: true, black: true },
		tournamentId: null,
		flipped: false,
		cursor: engine.historyLen(),
		sans: [],
		selected: null,
		cells: [],
		animating: false,
		endStatus: null,
		...patch,
	});
	game().render();
}

/** Run the move animation (or skip it) then `done()` commits it to the engine. */
function runMove(move: Move, done: () => void) {
	const { cells, engine } = game();
	if (!prefs().animate || prefs().view2d || !engine) return done(); // 2D net has nothing to animate

	if (move.kind === 'step') {
		const from = cells[move.from];
		const piece = from?.piece;
		const pathCells = move.path.map((id) => cells[id]);
		if (!piece || pathCells.some((c) => !c)) return done();
		useGameStore.setState({ animating: true, selected: null });
		game().render();
		const { path, zPath } = stepCurves(from, pathCells);
		startAnimation({
			pieces: [piece.id],
			config: { type: 'path', path, zPath },
			onEnd: done,
		});
		return;
	}

	// rotating cells come from the live engine; when branching from history skip the animation
	if (game().cursor !== game().history.length) return done();
	const axis = AXES[move.axis];
	const angle = (move.sign * Math.PI) / 2;
	const ids = engine.rotatingCells(move.from, move.axis) as CellId[];
	const pivot = cells[move.from].pos.dot(axis);
	const cuboids = CUBOIDS.filter((c) => {
		const d = c.pos.dot(axis);
		return d === pivot || Math.abs(d - pivot) === C_S / 2;
	}).map((c) => c.id);

	useGameStore.setState({ animating: true, selected: null });
	game().render();
	startAnimation({ cells: ids, cuboids, config: { type: 'rotate', axis, angle }, onEnd: done });
}

usePrefs.subscribe(
	(s, prev) => (s.showThreats !== prev.showThreats || s.highlightLastMove !== prev.highlightLastMove) && game().render(),
);

// Debug handle: `__game.getState()` in devtools.
(globalThis as unknown as { __game: typeof useGameStore }).__game = useGameStore;
