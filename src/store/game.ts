import { produce } from 'immer';
import { Vector3 } from 'three';
import { create } from 'zustand';
import { B_D, C_S, CU_S } from '../settings';
import { TCell, TCuboid, TGameState, TPiece, TPlayer } from '../types';
import { EColor, EPiece, SIDES, SIDES_COLOR } from '../utils/consts';
import { nkey, vec, vkey, zip } from '../utils/funcs';

interface IGameStore {
	cells: TCell[][][];
	cuboids: TCuboid[][][];
	state: TGameState;
	paths: TCell[][];
	tree: Record<string, string> | null; // needed for bfs
	turn: TPlayer;
	inverted: boolean;
	animate: boolean;
	cords: Record<string, string>; // Vector3 -> cell id
	locs: Record<string, string>; // Vector3 -> piece id
	walled: boolean;
	sandbox: boolean;
	debug: boolean;
	shadow: boolean;
	getActiveCell: () => TCell | undefined;
	resetCellsState: () => void;
	init: (config: string) => void;
}

export const useGameStore = create<IGameStore>((set, get) => ({
	cells: [],
	cuboids: [],
	pieces: [],
	paths: [],
	tree: null,
	turn: 'white',
	state: 'play:pick-piece',
	cords: {},
	shadow: false,
	locs: {},
	animate: true,
	inverted: false,
	walled: false,
	sandbox: true,
	debug: false,
	getActiveCell: () => {
		return get()
			.cells.flat(3)
			.find((cell) => cell.state === 'active');
	},
	resetCellsState: () => {
		set((state) => ({
			cells: produce(state.cells, (draft) => {
				for (const cell of draft.flat(3)) {
					cell.state = 'normal';
					delete cell.payload;
				}
			}),
		}));
	},
	init: (config: string) => {
		const cells: TCell[][][] = [];
		const cords: Record<string, string> = {};

		// init cells
		for (const [c, [_side, color]] of zip(SIDES, SIDES_COLOR).entries()) {
			cells[c] = [];
			for (let i = 0; i < B_D; ++i) {
				cells[c][i] = [];
				for (let j = 0; j < B_D; ++j) {
					const adjust = vec(CU_S / 2 - C_S / 2, CU_S / 2 - C_S / 2, CU_S / 2 - C_S / 2);
					const normal = (_side as Vector3).clone();
					adjust.setComponent(normal.toArray().findIndex((i) => i !== 0)!, 0);

					let baseCord: Vector3 | null;
					if (normal.x !== 0) {
						baseCord = vec(0, i * C_S, j * C_S);
					} else if (normal.y !== 0) {
						baseCord = vec(i * C_S, 0, j * C_S);
					} else if (normal.z !== 0) {
						baseCord = vec(i * C_S, j * C_S, 0);
					} else {
						throw new Error('bad side');
					}

					baseCord.sub(adjust).add(normal.multiplyScalar(CU_S / 2));

					const cellId = nkey(c, i, j);

					cells[c][i][j] = {
						cord: baseCord,
						id: nkey(c, i, j),
						angle: 0,
						side: normal.clone().normalize(),
						color: color as EColor,
						state: 'normal',
					};
					cords[vkey(baseCord)] = cellId;
				}
			}
		}

		const cuboids: TCuboid[][][] = [];
		const offset = C_S / 2 - CU_S / 2;
		// init inner cuboids
		for (let i = 0; i < B_D; ++i) {
			cuboids[i] = [];
			for (let j = 0; j < B_D; ++j) {
				cuboids[i][j] = [];
				for (let k = 0; k < B_D; ++k) {
					cuboids[i][j][k] = {
						id: nkey(i, j, k),
						cord: vec(i * C_S + offset, j * C_S + offset, k * C_S + offset),
					};
				}
			}
		}

		// place pieces based on config
		// config is a raw string
		// - is empty cell
		// letters for pieces
		// only setup for two sides: white and black.
		const whiteC = 0;
		const blackC = 3;

		const lines = config
			.split(/\r?\n|\r| |\n/g)
			.map((s) => s.trim())
			.filter(Boolean)
			.map((s) => s.split(''));

		const whiteSide = lines.slice(0, B_D);
		const blackSide = lines.slice(B_D);
		const zipped = zip([whiteSide, blackSide], [whiteC, blackC]);

		const locs: Record<string, string> = {};

		for (const [side, c] of zipped) {
			for (let i = 0; i < B_D; ++i) {
				for (let j = 0; j < B_D; ++j) {
					const cell = cells[c as number][i][j];
					const type = side[i][j];
					if (type === '-') continue;
					const piece: TPiece = {
						id: nkey(c, i, j),
						type: type.toLowerCase() as EPiece,
						player: type === type.toLowerCase() ? 'black' : 'white',
					};
					cell.piece = piece;
					locs[vkey(cell.cord)] = piece.id;
				}
			}
		}

		set({ cells, cords, locs, cuboids });
	},
}));

export function game() {
	return Object.assign(useGameStore.getState(), {
		set: useGameStore.setState,
	});
}
