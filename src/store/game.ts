import { produce } from 'immer';
import { Vector3 } from 'three';
import { create } from 'zustand';
import { B_D, C_S, CU_S } from '../settings';
import { TCell, TCuboid, TGameState, TMove, TMoveType, TPiece, TPlayer } from '../types';
import { EColor, EPiece, SIDES, SIDES_COLOR, ZPOS, YPOS, XPOS } from '../utils/consts';
import {
	isEdgeCell,
	isCornerCell,
	implyCenter,
	assert,
	nkey,
	updateCellState,
	nkeyinv,
	vec,
	vkey,
	zip,
	implyDirs,
} from '../utils/funcs';
import { walk, bfs } from '@/utils/path';

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
	updatePieceMoves: () => void;
	init: (config: string) => void;
}

export const useGameStore = create<IGameStore>((set, get) => ({
	cells: [],
	cuboids: [],
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
	updatePieceMoves: () => {
		set((state) => {
			return produce(state, (draft) => {
				const cords = draft.cords;
				const walled = draft.walled;

				for (const cell of draft.cells.flat(3)) {
					const piece = cell.piece;
					// HAVE A PIECE IN THIS CELL
					if (!piece) continue;

					const dirs = implyDirs(cell.side);
					const center = implyCenter(cell);

					// WE WILL CALCULATE THIS
					const moves: TMove[] = [];

					const updateCellState = (cell: TCell, other: TCell): TMoveType | false => {
						const otherPiece = other.piece;
						const thisPiece = cell.piece;
						assert(thisPiece);
						if (otherPiece) {
							if (otherPiece.player !== thisPiece.player) {
								return 'capturing';
							} else {
								return false;
							}
						} else {
							return 'normal';
						}
					};

					const getWalkCallback = (curMoves: TMove[], curPath: TCell[]) => {
						return (c: TCell) => {
							curPath.push(c);
							const type = updateCellState(cell, c);
							if (!type) return false;
							curMoves.push({
								path: curPath.map((c) => c.id),
								type: type,
							});
							return !c.piece;
						};
					};

					// different piece type
					switch (piece.type) {
						case EPiece.ROOK: {
							for (const initDir of dirs.slice(0, 4)) {
								const curMoves: TMove[] = [];
								const curPath: TCell[] = [];

								walk({
									initDir,
									initSide: cell.side,
									start: cell.cord,
									end: cell.cord,
									mode: 'rook',
									walled,
									cords,
									cells: draft.cells,
									callback: getWalkCallback(curMoves, curPath),
								});
								moves.push(...curMoves);
							}
							break;
						}
						case EPiece.BISHOP: {
							for (const initDir of dirs.slice(4)) {
								const curMoves: TMove[] = [];
								const curPath: TCell[] = [];
								walk({
									initDir,
									initSide: cell.side,
									start: cell.cord,
									end: cell.cord,
									mode: 'bishop',
									walled,
									cords,
									cells: draft.cells,
									callback: getWalkCallback(curMoves, curPath),
								});
								moves.push(...curMoves);
							}
							break;
						}
						case EPiece.QUEEN:
							for (const initDir of dirs.slice(0, 4)) {
								const curMoves: TMove[] = [];
								const curPath: TCell[] = [];

								walk({
									initDir,
									initSide: cell.side,
									start: cell.cord,
									end: cell.cord,
									mode: 'rook',
									walled,
									cords,
									cells: draft.cells,
									callback: getWalkCallback(curMoves, curPath),
								});
								moves.push(...curMoves);
							}

							for (const initDir of dirs.slice(4)) {
								const curMoves: TMove[] = [];
								const curPath: TCell[] = [];

								walk({
									initDir,
									initSide: cell.side,
									start: cell.cord,
									end: cell.cord,
									walled,
									mode: 'bishop',
									cords,
									cells: draft.cells,
									callback: getWalkCallback(curMoves, curPath),
								});
								moves.push(...curMoves);
							}
							break;
						case EPiece.KNIGHT:
							for (const c of draft.cells.flat(3)) {
								const distSq = c.cord.distanceToSquared(cell.cord);
								let reachable = false;
								if (distSq === 5 * C_S * C_S || distSq === 3.5 * C_S * C_S) {
									reachable = true;
								} else if (distSq === 4.5 * C_S * C_S && (isEdgeCell(c) || isCornerCell(c))) {
									if (c.cord.distanceToSquared(center) !== 3.25 * C_S * C_S) {
										reachable = true;
									}
								} else if (distSq === 2.5 * C_S * C_S && (isCornerCell(c) || isCornerCell(cell))) {
									reachable = true;
								}
								if (reachable) {
									if (!walled || c.side.dot(cell.side) !== 0) {
										// TODO: More concrete path
										const type = updateCellState(cell, c);
										if (type) {
											moves.push({
												type,
												path: [c.id],
											});
										}
									}
								}
							}
							break;
						case EPiece.CAPTAIN: {
							const currCellIds: string[] = [];
							const walkCallback = (c: TCell) => {
								if (c.color !== cell.color || !!c.piece) {
									return false;
								} else {
									currCellIds.push(c.id);
									return true;
								}
							};

							const tree = bfs({
								initCell: cell,
								cords,
								cells: draft.cells,
								walled,
								callback: walkCallback,
							});

							// FIND MOVES FROM TREE
							const currMoves: TMove[] = currCellIds.map((id) => {
								const shortestPath: string[] = [];
								let cursor = id;
								while (cursor !== cell.id) {
									shortestPath.push(cursor);
									cursor = tree[cursor];
								}
								return { path: shortestPath.reverse(), type: 'normal' };
							});

							moves.push(...currMoves);

							// KING-mode
							for (const c of draft.cells.flat(3)) {
								const distSq = c.cord.distanceToSquared(cell.cord);
								if (
									(!walled && (distSq === 0.5 * C_S * C_S || distSq === 1.5 * C_S * C_S)) ||
									distSq === C_S * C_S ||
									distSq === 2 * C_S * C_S
								) {
									const type = updateCellState(cell, c);
									if (type) {
										moves.push({
											type,
											path: [c.id],
										});
									}
								}
							}
							break;
						}

						case EPiece.TESSERACT: {
							// KING-mode
							for (const c of draft.cells.flat(3)) {
								const distSq = c.cord.distanceToSquared(cell.cord);
								if (
									(!walled && (distSq === 0.5 * C_S * C_S || distSq === 1.5 * C_S * C_S)) ||
									distSq === C_S * C_S ||
									distSq === 2 * C_S * C_S
								) {
									const type = updateCellState(cell, c);
									if (type) {
										moves.push({
											type,
											path: [c.id],
										});
									}
								}
							}

							break;
						}
						case EPiece.KING: {
							for (const c of draft.cells.flat(3)) {
								const distSq = c.cord.distanceToSquared(cell.cord);
								if (
									(!walled && (distSq === 0.5 * C_S * C_S || distSq === 1.5 * C_S * C_S)) ||
									distSq === C_S * C_S ||
									distSq === 2 * C_S * C_S
								) {
									const type = updateCellState(cell, c);
									if (type) {
										moves.push({
											type,
											path: [c.id],
										});
									}
								}
							}

							break;
						}

						case EPiece.PAWN: {
							for (const c of draft.cells.flat(3)) {
								const distSq = c.cord.distanceToSquared(cell.cord);
								if ((!walled && distSq === 0.5 * C_S * C_S) || distSq === C_S * C_S) {
									if (!c.piece) {
										moves.push({
											type: 'normal',
											path: [c.id],
										});
									}
								}
								if ((!walled && distSq === 1.5 * C_S * C_S) || distSq === 2 * C_S * C_S) {
									assert(cell.piece);
									if (c.piece && c.piece.player !== cell.piece.player) {
										moves.push({
											type: 'capturing',
											path: [c.id],
										});
									}
								}
							}
							break;
						}
						default:
							break;
					}

					// UPDATE
					piece.moves = moves;
				}
			});
		});
	},
}));

export function game() {
	return Object.assign(useGameStore.getState(), {
		set: useGameStore.setState,
	});
}
