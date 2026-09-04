import { C_S } from '@/settings';
import { useNetStore, send } from '@/net/ws';
import {
	CellId,
	Color,
	GameConfig,
	GameState,
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
import { stepCurves } from '@/utils/path';
import { WasmGame } from 'rubrik-wasm';
import { toast } from 'sonner';
import { Vector3 } from 'three';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { startAnimation } from './animation';

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

export function localConfig(walled: boolean): GameConfig {
	const config = baseConfig();
	config.rules.walled = walled;
	return config;
}

export function notation(move: Move): string {
	return move.kind === 'step'
		? `${move.from}>${move.path[move.path.length - 1]}${move.capture ? 'x' : ''}`
		: `${move.from}@${move.axis}${move.sign > 0 ? '+' : '-'}`;
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
	// settings
	animate: boolean;
	walled: boolean;
	debug: boolean;
	lowPerf: boolean;
	// actions
	render: () => void;
	newLocal: (config?: GameConfig) => void;
	select: (id: CellId | null) => void;
	play: (move: Move) => void;
	undo: () => void;
	setCursor: (n: number) => void;
	loadOnline: (msg: Extract<ServerMsg, { t: 'game_state' }>) => void;
	applyRemoteMove: (msg: Extract<ServerMsg, { t: 'move' }>) => void;
	setEnd: (msg: Extract<ServerMsg, { t: 'game_end' }>) => void;
	setDrawOffer: (by: Color | null) => void;
	setSetting: (patch: Partial<Pick<IGameStore, 'animate' | 'walled' | 'debug' | 'lowPerf'>>) => void;
}

export const useGameStore = create(
	subscribeWithSelector<IGameStore>((set, get) => ({
		engine: null,
		config: null,
		cells: [],
		turn: 'white',
		status: { kind: 'playing' },
		history: [],
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
		animate: true,
		walled: false,
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
			const threats = source.threats() as Threat[];
			const pick = live ? selected : null;
			const legal = pick === null ? [] : (source.legalMoves(pick) as Move[]);
			replay?.free();

			set({
				config: head.config,
				cells: computeCells(view, pick, legal, threats, get().cells),
				turn: view.turn,
				status: live ? (get().endStatus ?? view.status) : view.status,
				history: head.history,
				cursor: at,
				selected: pick,
				legal,
				threats,
			});
		},

		newLocal: (config) => {
			get().engine?.free();
			set({
				engine: new WasmGame(config ?? localConfig(get().walled)),
				mode: 'local',
				gameId: null,
				myColor: null,
				players: { white: null, black: null },
				diffs: { white: null, black: null },
				clock: null,
				drawOffer: null,
				cursor: 0,
				selected: null,
				cells: [],
				animating: false,
				endStatus: null,
			});
			get().render();
		},

		select: (id) => {
			const { animating, cells, cursor, history, mode, myColor, turn, status } = get();
			if (animating) return;
			if (id !== null) {
				if (cursor !== history.length || status.kind !== 'playing') return;
				const piece = cells[id]?.piece;
				if (!piece || piece.color !== turn) return;
				if (mode === 'online' && myColor !== turn) return;
			}
			set({ selected: id });
			get().render();
		},

		play: (move) => {
			const { animating, mode, gameId, engine, status } = get();
			if (animating || !engine || status.kind !== 'playing') return;

			if (mode === 'online') {
				if (!gameId) return;
				send({ t: 'move', game_id: gameId, move });
				set({ selected: null });
				get().render();
				return;
			}

			runMove(move, () => {
				try {
					engine.play(move);
				} catch (e) {
					toast.error(String(e));
				}
				set({ animating: false, selected: null, cursor: engine.historyLen() });
				get().render();
			});
		},

		undo: () => {
			const { engine, mode, animating } = get();
			if (!engine || mode !== 'local' || animating) return;
			engine.undo();
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
			get().engine?.free();
			const engine = WasmGame.fromState(msg.game);
			set({
				engine,
				mode: 'online',
				gameId: msg.game_id,
				players: { white: msg.white, black: msg.black },
				diffs: { white: null, black: null },
				clock: msg.clock,
				drawOffer: msg.draw_offer,
				myColor:
					me && msg.white.id === me.id ? 'white' : me && msg.black.id === me.id ? 'black' : null,
				cursor: engine.historyLen(),
				selected: null,
				cells: [],
				animating: false,
				endStatus: msg.game.status.kind === 'playing' ? null : msg.game.status,
			});
			get().render();
		},

		applyRemoteMove: (msg) => {
			const { engine, cursor, history } = get();
			if (!engine) return;
			// viewing history: apply silently, keep the cursor where it is
			const live = cursor === history.length;
			const commit = () => {
				try {
					engine.play(msg.move);
				} catch (e) {
					toast.error(`out of sync: ${String(e)}`);
				}
				set({
					animating: false,
					selected: null,
					clock: msg.clock,
					drawOffer: null,
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
				clock: clock && { ...clock, running: null },
			});
			get().render();
		},

		setDrawOffer: (by) => set({ drawOffer: by }),

		setSetting: (patch) => set(patch),
	})),
);

export function game() {
	return useGameStore.getState();
}

/** Run the move animation (or skip it) then `done()` commits it to the engine. */
function runMove(move: Move, done: () => void) {
	const { animate, cells, engine } = game();
	if (!animate || !engine) return done();

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

// Debug handle: `__game.getState()` in devtools.
(globalThis as unknown as { __game: typeof useGameStore }).__game = useGameStore;
