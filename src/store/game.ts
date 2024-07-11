import { Vector3 } from 'three';
import { create } from 'zustand';
import { BOARD_SIZE, CELL_SIZE, CUBE_SIZE } from '../settings';
import { TBoardCord, TCell, TGameState, TPiece, TPlayer } from '../types';
import { EColor, EPiece, SIDES, SIDES_COLOR } from '../utils/consts';
import { bcordEq, loopCells, vec, zip } from '../utils/funcs';
import { produce } from 'immer';

interface IGameStore {
	cells: TCell[][][];
	state: TGameState;
	turn: TPlayer;
	getActiveCell: () => TCell | undefined;
	getPieces: () => TPiece[];
	getNextTurn: (turn: TPlayer) => TPlayer;
	getFlattenCells: () => TCell[];
	updateCell: (bcord: TBoardCord, newCell: TCell) => void;
	init: (config: string) => void;
	clear: () => void;
	resetCellsState: () => void;
}

export const useGameStore = create<IGameStore>((set, get) => ({
	cells: [],
	turn: 'white',
	state: 'play:pick-piece',
	getActiveCell: () => {
		return get()
			.getFlattenCells()
			.find((cell) => cell.state === 'active');
	},
	resetCellsState: () => {
		set((state) => ({
			cells: produce(state.cells, (draft) => {
				loopCells(draft, (cell) => {
					cell.state = 'normal';
				});
			}),
		}));
	},
	getPieces: () =>
		get()
			.cells.flat(3)
			.map((c) => c.piece)
			.filter(Boolean) as TPiece[],
	getNextTurn: () => {
		const turn = get().turn;
		if (turn === 'black') return 'white';
		return 'black';
	},
	getFlattenCells: () => get().cells.flat(3),
	clear: () => {
		set({ cells: [] });
	},
	init: (config: string) => {
		const cells: TCell[][][] = [];
		const pieces: TPiece[] = [];

		// init cells
		for (const [c, [_side, color]] of zip(SIDES, SIDES_COLOR).entries()) {
			cells[c] = [];
			for (let i = 0; i < BOARD_SIZE; ++i) {
				cells[c][i] = [];
				for (let j = 0; j < BOARD_SIZE; ++j) {
					const adjust = vec(
						CUBE_SIZE / 2 - CELL_SIZE / 2,
						CUBE_SIZE / 2 - CELL_SIZE / 2,
						CUBE_SIZE / 2 - CELL_SIZE / 2,
					);
					const normal = (_side as Vector3).clone();
					adjust.setComponent(normal.toArray().findIndex((i) => i !== 0)!, 0);

					let baseCord: Vector3 | null;
					if (normal.x !== 0) {
						baseCord = vec(0, i * CELL_SIZE, j * CELL_SIZE);
					} else if (normal.y !== 0) {
						baseCord = vec(i * CELL_SIZE, 0, j * CELL_SIZE);
					} else if (normal.z !== 0) {
						baseCord = vec(i * CELL_SIZE, j * CELL_SIZE, 0);
					} else {
						throw new Error('bad side');
					}

					baseCord.sub(adjust).add(normal.multiplyScalar(CUBE_SIZE / 2));

					cells[c][i][j] = {
						cord: baseCord,
						bcord: [c, i, j],
						side: normal.clone().normalize(),
						color: color as EColor,
						state: 'normal',
					};
				}
			}
		}

		// place pieces based on config
		// config is a raw string
		// - is empty cell
		// letters for pieces
		// only setup for two sides: white and black.
		const whiteC = SIDES_COLOR.findIndex((c) => c === EColor.WHITE);
		const blackC = SIDES_COLOR.findIndex((c) => c === EColor.BLACK);

		const lines = config
			.split(/\r?\n|\r| |\n/g)
			.map((s) => s.trim())
			.filter(Boolean)
			.map((s) => s.split(''));

		const whiteSide = lines.slice(0, BOARD_SIZE);
		const blackSide = lines.slice(BOARD_SIZE);
		const zipped = zip([whiteSide, blackSide], [whiteC, blackC]);

		for (const [side, c] of zipped) {
			for (let i = 0; i < BOARD_SIZE; ++i) {
				for (let j = 0; j < BOARD_SIZE; ++j) {
					const cell = cells[c as number][i][j];
					const type = side[i][j];
					if (type === '-') continue;
					cell.piece = {
						type: type.toLowerCase() as EPiece,
						player: type === type.toLowerCase() ? 'black' : 'white',
					};
					pieces.push(cell.piece);
				}
			}
		}

		set({ cells });
	},

	updateCell: (bcord, newCell) => {
		set((state) => ({
			cells: produce(state.cells, (draft) => {
				for (let c = 0; c < SIDES.length; c++) {
					for (let i = 0; i < BOARD_SIZE; i++) {
						for (let j = 0; j < BOARD_SIZE; j++) {
							if (bcordEq([c, i, j], bcord)) {
								draft[c][i][j] = newCell;
							}
						}
					}
				}
			}),
		}));
	},
}));
