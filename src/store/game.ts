import { bfs, walk } from '@/utils/path';
import { produce } from 'immer';
import {
	getState,
	onPlayerJoin,
	insertCoin,
	setState,
	useMultiplayerState,
	PlayerState,
} from 'playroomkit';
import { useCallback } from 'react';
import { Vector3 } from 'three';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { B_D, C_S, CU_S, SIDES_COLOR, TARGETED_PIECES } from '../settings';
import {
	TAction,
	TCell,
	TCuboid,
	TGameMode,
	TGameState,
	TMove,
	TMoveType,
	TPiece,
	TPlayer,
} from '../types';
import { EColor, EPiece, SIDES, XPOS, YPOS, ZPOS } from '../utils/consts';
import {
	assert,
	implyCenter,
	implyDirs,
	isCornerCell,
	isEdgeCell,
	nkey,
	nkeyinv,
	randChoice,
	vec,
	vkey,
	zip,
} from '../utils/funcs';

interface IGameStore {
	cells: TCell[][][];
	cuboids: TCuboid[][][];
	state: TGameState;
	turn: TPlayer;
	history: TAction[];
	cursor: number; // for indexing history
	inverted: boolean;
	animate: boolean;
	cords: Record<string, string>; // Vector3 -> cell id
	walled: boolean;
	sandbox: boolean;
	debug: boolean;
	shadow: boolean;
	lowPerf: boolean;
	checkTarget: boolean;
	mode: TGameMode;
	players: PlayerState[];
	getActiveCell: () => TCell | undefined;
	clearCellStates: () => void;
	updateIdleCellStates: () => void;
	updatePieceMoves: (pieceId?: string) => void;
	resetHistory: () => void;
	initCube: () => void;
	initRandomPieces: (density?: number) => void;
	initConfigPieces: (config: string) => void;
	initPlayroom: () => Promise<void>;
}

export const useGameStore = create(
	subscribeWithSelector<IGameStore>((set, get) => ({
		cells: [],
		cuboids: [],
		turn: 'white',
		state: 'play:pick-piece',
		cords: {},
		shadow: false,
		history: [],
		cursor: 0,
		animate: true,
		inverted: false,
		walled: false,
		sandbox: true,
		debug: false,
		checkTarget: false,
		lowPerf: false,
		mode: 'local',
		players: [],
		getActiveCell: () => {
			return get()
				.cells.flat(3)
				.find((cell) => cell.state === 'active');
		},
		clearCellStates: () => {
			set((state) => {
				return produce(state, (draft) => {
					for (const cell of draft.cells.flat(3)) {
						cell.state = 'normal';
						delete cell.payload;
					}
				});
			});
		},
		updateIdleCellStates: () => {
			set((state) => ({
				cells: produce(state.cells, (cells) => {
					const flatted = cells.flat(3);
					const allCapturingMoves = (
						flatted
							.map((c) => c.piece?.moves)
							.filter(Boolean)
							.flat(2) as TMove[]
					).filter((m) => m.type === 'capturing');
					// base
					for (const cell of flatted) {
						cell.state = 'normal';
						delete cell.payload;
					}
					// if king is targeted: highlight path and that king
					for (const move of allCapturingMoves) {
						const id = move.path.at(-1)!;
						const [c, i, j] = nkeyinv(id);
						const cell = cells[c][i][j];
						if (cell.piece && TARGETED_PIECES.includes(cell.piece.type)) {
							for (const id of move.path) {
								const [pc, pi, pj] = nkeyinv(id);
								const pcell = cells[pc][pi][pj];
								pcell.state = 'targeted:path';
							}
							cell.state = 'targeted';
						}
					}
				}),
			}));
		},
		initCube: () => {
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

			set({ cells, cords, cuboids });
		},
		initRandomPieces: (density = 0.2) => {
			set((state) => {
				return produce(state, (draft) => {
					for (let c = 0; c < SIDES.length; ++c) {
						for (let i = 0; i < B_D; ++i) {
							for (let j = 0; j < B_D; ++j) {
								const cell = draft.cells[c][i][j];
								delete cell.piece;
								if (Math.random() >= density) continue;
								const piece: TPiece = {
									id: nkey(c, i, j),
									type: randChoice([
										EPiece.QUEEN,
										EPiece.ROOK,
										EPiece.KNIGHT,
										EPiece.PAWN,
										EPiece.CANNON,
										EPiece.TESSERACT,
										EPiece.BISHOP,
										EPiece.CAPTAIN,
										EPiece.PRINCESS,
										EPiece.PRINCE,
										EPiece.KING,
									]),
									player: randChoice(['black', 'white']),
								};
								cell.piece = piece;
							}
						}
					}
				});
			});
			get().updatePieceMoves();
			get().updateIdleCellStates();
			get().resetHistory();
		},
		initConfigPieces: (config) => {
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

			set((state) => {
				return produce(state, (draft) => {
					for (let c = 0; c < SIDES.length; ++c) {
						for (let i = 0; i < B_D; ++i) {
							for (let j = 0; j < B_D; ++j) {
								const cell = draft.cells[c][i][j];
								delete cell.piece;
								if (c === whiteC || c === blackC) {
									const side = c === whiteC ? whiteSide : blackSide;
									const type = side[i][j];
									if (type === '-') continue;
									const piece: TPiece = {
										id: nkey(c, i, j),
										type: type.toLowerCase() as EPiece,
										player: type === type.toLowerCase() ? 'black' : 'white',
									};
									cell.piece = piece;
								}
							}
						}
					}
				});
			});
			get().updatePieceMoves();
			get().updateIdleCellStates();
			get().resetHistory();
		},
		resetHistory: () => {
			set({ history: [], cursor: 0 });
		},
		updatePieceMoves: (pieceId) => {
			set((state) => {
				return produce(state, (draft) => {
					const cords = draft.cords;
					const walled = draft.walled;

					for (const cell of draft.cells.flat(3)) {
						const piece = cell.piece;
						// HAVE A PIECE IN THIS CELL
						if (!piece) continue;
						if (pieceId && piece.id !== piece.id) continue;

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
							case EPiece.PRINCESS:
								const princessUpdateCellState = (cell: TCell, other: TCell): TMoveType | false => {
									const otherPiece = other.piece;
									const thisPiece = cell.piece;
									assert(thisPiece);
									if (other.color !== cell.color) {
										return false;
									}
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

								const getPrincessWalkCallBack = (curMoves: TMove[], curPath: TCell[]) => {
									return (c: TCell) => {
										curPath.push(c);
										const type = princessUpdateCellState(cell, c);
										if (!type) return false;
										curMoves.push({
											path: curPath.map((c) => c.id),
											type: type,
										});
										return !c.piece;
									};
								};

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
										callback: getPrincessWalkCallBack(curMoves, curPath),
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
										callback: getPrincessWalkCallBack(curMoves, curPath),
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
									} else if (
										distSq === 2.5 * C_S * C_S &&
										(isCornerCell(c) || isCornerCell(cell))
									) {
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

							case EPiece.CANNON: {
								// CANNON-mode
								for (const angle of [
									Math.PI / 2,
									-Math.PI / 2,
									// Math.PI // NERF 180 degree range shot;
								]) {
									for (const axis of [XPOS, YPOS, ZPOS]) {
										if (axis.dot(cell.side) !== 0) continue;
										const rotated = cell.cord.clone().applyAxisAngle(axis, angle).round();
										const id = cords[vkey(rotated)];
										assert(id);
										const [cc, ci, cj] = nkeyinv(id);
										const c = draft.cells[cc][ci][cj];
										const type = updateCellState(cell, c);
										if (type) {
											moves.push({
												type,
												path: [c.id],
											});
										}
									}
								}

								// KING-mode, but cuffed (only move, cannot capture)
								const cannonUpdateCellState = (cell: TCell, other: TCell): TMoveType | false => {
									const otherPiece = other.piece;
									const thisPiece = cell.piece;
									assert(thisPiece);
									if (otherPiece) {
										return false;
									} else {
										return 'normal';
									}
								};

								for (const c of draft.cells.flat(3)) {
									const distSq = c.cord.distanceToSquared(cell.cord);
									if (
										(!walled && (distSq === 0.5 * C_S * C_S || distSq === 1.5 * C_S * C_S)) ||
										distSq === C_S * C_S ||
										distSq === 2 * C_S * C_S
									) {
										const type = cannonUpdateCellState(cell, c);
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
							case EPiece.PRINCE: {
								for (const c of draft.cells.flat(3)) {
									if (c.color !== cell.color) continue;
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
		initPlayroom: async () => {
			// Start the game
			await insertCoin({
				maxPlayersPerRoom: 2,
			});

			// Create a joystick controller for each joining player
			onPlayerJoin((newPlayer) => {
				const players = game().players;
				// Joystick will only create UI for current player (myPlayer)
				// For others, it will only sync their state
				newPlayer.setState('player', players.length === 0 ? 'white' : 'black');
				game().set({ players: [...players, newPlayer] });
				newPlayer.onQuit(() => {
					game().set((state) => ({ players: state.players.filter((p) => p.id !== newPlayer.id) }));
				});
			});

			console.log('INIT PLAYROOM COMPLETE');
		},
	})),
);

const NETWORK_STATES = ['turn'] as const;

export function game() {
	const state = useGameStore.getState();
	const shallowClone = { ...state };
	for (const key of NETWORK_STATES) {
		shallowClone[key] = state.mode === 'local' ? state[key] : getState(key) ?? state[key];
	}

	return Object.assign(shallowClone, {
		set: useGameStore.setState,
		setState: <T extends IGameStoreMutableKey>(key: T, setter: (value: IGameStore[T]) => void) => {
			const baseState = useGameStore.getState();
			if (baseState.mode === 'local') {
				useGameStore.setState((state) => ({ [key]: setter(state[key]) }));
			} else {
				setState(key, setter(getState(key) ?? baseState[key]), true);
			}
		},
		subscribe: useGameStore.subscribe,
	});
}

type IGameStoreMutableKey = keyof {
	[K in keyof IGameStore as IGameStore[K] extends Function ? never : K]: IGameStore[K];
};

export function useGameState<T extends IGameStoreMutableKey>(key: T) {
	const localState = useGameStore((store) => store[key]);
	const setLocalState = useCallback((value: IGameStore[typeof key]) => {
		useGameStore.setState({ [key]: value });
	}, []);
	const returnVal = [localState, setLocalState] as const;

	if (NETWORK_STATES.includes(key as any)) {
		const mode = useGameStore((store) => store.mode);
		const network = useMultiplayerState(key, localState);
		if (mode === 'local') {
			return returnVal;
		} else {
			return network as typeof returnVal;
		}
	}
	return returnVal;
}
