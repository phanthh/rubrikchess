import { C_S } from '@/settings';
import { animation } from '@/store/animation';
import { TCell } from '@/types';
import { EPiece, XPOS, YPOS, ZPOS } from '@/utils/consts';
import {
	assert,
	bkeyinv,
	implyDirs,
	isCornerCell,
	isEdgeCell,
	updateCellState,
	vkey,
} from '@/utils/funcs';
import { bfs, walk } from '@/utils/path';
import { produce } from 'immer';
import { Vector3 } from 'three';
import { game, useGameStore } from '../store/game';
import { Animator } from './animator';
import { Cell } from './cell';
import { CubeFrame } from './cube-frame';

type CubeProps = {};

export function Cube({}: CubeProps) {
	const cells = useGameStore((store) => store.cells);
	const walled = useGameStore((store) => store.walled);
	const animate = useGameStore((store) => store.animate);

	const handlePickPiece = (cell: TCell) => {
		const piece = cell.piece;
		if (!piece) return;
		const { turn, sandbox } = game();
		if (turn !== cell.piece?.player && !sandbox) return;
		const dirs = implyDirs(cell.side);

		// TODO neightbord hood function for better perf;
		game().set((state) => {
			const cords = state.cords;
			if (!cords) {
				throw new Error('no cords');
			}
			return produce(state, (draft) => {
				const center = cell.cord.clone().sub(
					cell.side
						.clone()
						.normalize()
						.multiplyScalar(C_S / 2),
				);

				const walkCallback = (c: TCell) => {
					updateCellState(cell, c);
					return !c.piece;
				};

				const walled = draft.walled;

				// different piece type
				switch (piece.type) {
					case EPiece.ROOK: {
						for (const initDir of dirs.slice(0, 4)) {
							walk({
								initDir,
								initSide: cell.side,
								start: cell.cord,
								end: cell.cord,
								mode: 'rook',
								walled,
								cords,
								cells: draft.cells,
								callback: walkCallback,
							});
						}
						break;
					}
					case EPiece.BISHOP: {
						for (const initDir of dirs.slice(4)) {
							walk({
								initDir,
								initSide: cell.side,
								start: cell.cord,
								end: cell.cord,
								mode: 'bishop',
								walled,
								cords,
								cells: draft.cells,
								callback: walkCallback,
							});
						}
						break;
					}
					case EPiece.QUEEN:
						for (const initDir of dirs.slice(0, 4)) {
							walk({
								initDir,
								initSide: cell.side,
								start: cell.cord,
								end: cell.cord,
								mode: 'rook',
								walled,
								cords,
								cells: draft.cells,
								callback: walkCallback,
							});
						}

						for (const initDir of dirs.slice(4)) {
							walk({
								initDir,
								initSide: cell.side,
								start: cell.cord,
								end: cell.cord,
								walled,
								mode: 'bishop',
								cords,
								cells: draft.cells,
								callback: walkCallback,
							});
						}
						break;
					case EPiece.KNIGHT:
						for (const c of draft.cells.flat(3)) {
							const distSq = c.cord.distanceToSquared(cell.cord);
							let reachable;
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
									updateCellState(cell, c);
								}
							}
						}
						break;
					case EPiece.CAPTAIN: {
						bfs({
							initCell: cell,
							cords,
							cells: draft.cells,
							walled,
							callback: (c: TCell) => {
								if (c.color !== cell.color || !!c.piece) {
									return false;
								} else {
									c.state = 'reachable';
									return true;
								}
							},
						});

						// KING-mode
						for (const c of draft.cells.flat(3)) {
							const distSq = c.cord.distanceToSquared(cell.cord);
							if (
								(!walled && (distSq === 0.5 * C_S * C_S || distSq === 1.5 * C_S * C_S)) ||
								distSq === C_S * C_S ||
								distSq === 2 * C_S * C_S
							) {
								updateCellState(cell, c);
							}
						}
						break;
					}

					case EPiece.TESSERACT: {
						for (const angle of [
							Math.PI / 2,
							-Math.PI / 2,
							// Math.PI // NOTE: allowing 180 turn seems a bit too OP
						]) {
							for (const axis of [XPOS, YPOS, ZPOS]) {
								const rotated = cell.cord.clone().applyAxisAngle(axis, angle).round();
								const id = cords[vkey(rotated)];
								assert(id);
								const [cc, ci, cj] = bkeyinv(id);
								const c = draft.cells[cc][ci][cj];
								c.state = 'reachable';
								c.payload = { angle, axis };
							}
						}

						// KING-mode
						for (const c of draft.cells.flat(3)) {
							const distSq = c.cord.distanceToSquared(cell.cord);
							if (
								(!walled && (distSq === 0.5 * C_S * C_S || distSq === 1.5 * C_S * C_S)) ||
								distSq === C_S * C_S ||
								distSq === 2 * C_S * C_S
							) {
								updateCellState(cell, c);
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
								updateCellState(cell, c);
							}
						}

						break;
					}

					case EPiece.PAWN: {
						for (const c of draft.cells.flat(3)) {
							const distSq = c.cord.distanceToSquared(cell.cord);
							if ((!walled && distSq === 0.5 * C_S * C_S) || distSq === C_S * C_S) {
								if (!c.piece) {
									c.state = 'reachable';
								}
							}
							if ((!walled && distSq === 1.5 * C_S * C_S) || distSq === 2 * C_S * C_S) {
								assert(cell.piece);
								if (c.piece && c.piece.player !== cell.piece.player) {
									c.state = 'capturable';
								}
							}
						}
						break;
					}
					default:
						break;
				}

				const [c, i, j] = bkeyinv(cell.id);
				draft.cells[c][i][j].state = 'active';

				// SWITCH TO NEXT STATE
				draft.state = 'play:pick-cell';
			});
		});
	};

	const handlePickCell = (cell: TCell) => {
		const activeCell = game().getActiveCell();
		const activePiece = activeCell?.piece;

		switch (cell.state) {
			case 'reachable':
			case 'capturable': {
				// MOVE PIECE
				assert(activeCell, 'no active cell');
				assert(activePiece, 'no active piece');

				const basicMove = () => {
					game().set((state) => {
						return produce(state, (draft) => {
							for (const c of draft.cells.flat(3)) {
								if (c.id === cell.id) {
									// intent to move piece to this cell
									c.piece = activePiece;
								} else if (c.id === activeCell.id) {
									delete c.piece;
								}
							}
						});
					});
				};

				switch (activePiece.type) {
					case EPiece.TESSERACT: {
						const payload = cell.payload;
						if (!payload) {
							basicMove();
							break;
						}

						// SPECIAL TESSERACT MOVE: ROTATE
						const { axis, angle } = payload as { axis: Vector3; angle: number };
						const rotate = (cord: Vector3) => {
							return cord.clone().applyAxisAngle(axis, angle).round();
						};
						const adot = activeCell.cord.dot(axis);

						const getRotatingCells = (cells: TCell[]) => {
							return cells.filter((c) => {
								const cdot = c.cord.dot(axis);
								return cdot === adot || Math.abs(cdot - adot) === C_S / 2;
							});
						};

						const rotateCells = () => {
							game().set((state) => {
								return produce(state, (draft) => {
									for (const c of getRotatingCells(draft.cells.flat(3))) {
										c.cord = rotate(c.cord);
										c.side = rotate(c.side);
										// TODO: fix rotating angle bug (see Knight + Tesseract)
										c.angle += angle * axis.dot(c.side);
										draft.cords[vkey(c.cord)] = c.id;
									}
								});
							});
						};

						if (animate) {
							// WITH ANIMATION: update on animation end;
							animation().set({
								progress: 0,
								cells: getRotatingCells(cells.flat(3)),
								onEnd: rotateCells,
								animation: { type: 'rotate', axis, angle },
							});
						} else {
							// NO ANIMATION: update straightaway
							rotateCells();
						}

						break;
					}
					default: {
						basicMove();
						break;
					}
				}

				// TURN COMPLETE
				game().set((state) => ({
					turn: state.sandbox ? state.turn : state.turn === 'white' ? 'black' : 'white',
					state: animate ? 'play:animate' : 'play:pick-piece',
				}));

				game().resetCellsState();
			}

			default: {
				break;
			}
		}
	};

	// useLayoutEffect(() => {
	// 	switch (state) {
	// 		case 'play:pick-cell':
	// 			break;
	// 		case 'play:pick-piece':
	// 			break;
	// 		case 'play:animate':
	// 			// pending animation
	// 			break;
	// 		default:
	// 			break;
	// 	}
	// }, [state]);

	return (
		<>
			{cells.flat(3).map((cell) => {
				return (
					<Cell
						onPickCell={handlePickCell}
						onPickPiece={handlePickPiece}
						key={'c' + cell.id}
						cell={cell}
					/>
				);
			})}
			{walled && <CubeFrame />}
			{animate && <Animator />}
		</>
	);
}
