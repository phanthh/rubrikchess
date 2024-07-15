import { C_S } from '@/settings';
import { animation } from '@/store/animation';
import { TCell, TCuboid } from '@/types';
import { EPiece, XPOS, YPOS, ZPOS } from '@/utils/consts';
import {
	assert,
	implyCenter,
	implyDirs,
	isCornerCell,
	isEdgeCell,
	nkeyinv,
	updateCellState,
	vkey,
} from '@/utils/funcs';
import { bfs, move, walk } from '@/utils/path';
import { produce } from 'immer';
import { Vector3 } from 'three';
import { game, useGameStore } from '../store/game';
import { Animator } from './animator';
import { Cell } from './cell';
import { CubeFrame } from './cube-frame';
import { Cuboid } from './cuboid';

type CubeProps = {};

export function Cube({}: CubeProps) {
	const cells = useGameStore((store) => store.cells);
	const cuboids = useGameStore((store) => store.cuboids);
	const walled = useGameStore((store) => store.walled);
	const animate = useGameStore((store) => store.animate);
	const inverted = useGameStore((store) => store.inverted);

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
				let paths: TCell[][] = [];
				const center = implyCenter(cell);
				const walkCallback = (c: TCell) => {
					updateCellState(cell, c);
					return !c.piece;
				};

				const walled = draft.walled;

				// different piece type
				switch (piece.type) {
					case EPiece.ROOK: {
						for (const initDir of dirs.slice(0, 4)) {
							const dirPath = walk({
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
							paths.push(dirPath);
						}
						break;
					}
					case EPiece.BISHOP: {
						for (const initDir of dirs.slice(4)) {
							const dirPath = walk({
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
							paths.push(dirPath);
						}
						break;
					}
					case EPiece.QUEEN:
						for (const initDir of dirs.slice(0, 4)) {
							const dirPath = walk({
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
							paths.push(dirPath);
						}

						for (const initDir of dirs.slice(4)) {
							const dirPath = walk({
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
							paths.push(dirPath);
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
									paths.push([c]);
									updateCellState(cell, c);
								}
							}
						}
						break;
					case EPiece.CAPTAIN: {
						draft.tree = bfs({
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
								paths.push([c]);
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
								const [cc, ci, cj] = nkeyinv(id);
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
								paths.push([c]);
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
								paths.push([c]);
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
									paths.push([c]);
									c.state = 'reachable';
								}
							}
							if ((!walled && distSq === 1.5 * C_S * C_S) || distSq === 2 * C_S * C_S) {
								assert(cell.piece);
								if (c.piece && c.piece.player !== cell.piece.player) {
									paths.push([c]);
									c.state = 'capturable';
								}
							}
						}
						break;
					}
					default:
						break;
				}
				draft.paths = paths.sort((a, b) => a.length - b.length);
				const [c, i, j] = nkeyinv(cell.id);
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

				const { paths, tree } = game();

				switch (activePiece.type) {
					case EPiece.CAPTAIN: {
						assert(tree);

						if (paths.flat(2).find((c) => c.id === cell.id)) {
							move(activeCell, cell, paths, animate);
							break;
						}

						// SPECIAL CAPTAIN MOVE: SAILING

						const shortestPath: TCell[] = [];
						let cursor = cell;
						while (cursor.id !== activeCell.id) {
							shortestPath.push(cursor);
							const [c, i, j] = nkeyinv(tree[cursor.id]);
							cursor = cells[c][i][j];
						}
						shortestPath.reverse();
						move(activeCell, cell, [shortestPath], animate);
						game().set({ tree: null });
						break;
					}
					case EPiece.TESSERACT: {
						const payload = cell.payload;
						if (!payload) {
							move(activeCell, cell, paths, animate);
							break;
						}

						// SPECIAL TESSERACT MOVE: ROTATE
						const { axis, angle } = payload as { axis: Vector3; angle: number };
						const rotate = (cord: Vector3) => {
							return cord.clone().applyAxisAngle(axis, angle).round();
						};
						const adot = activeCell.cord.dot(axis);

						const getRotating = <T extends TCell | TCuboid>(objs: T[]) => {
							return objs.filter((c) => {
								const cdot = c.cord.dot(axis);
								return cdot === adot || Math.abs(cdot - adot) === C_S / 2;
							});
						};

						const rotateAllSync = () => {
							game().set((state) => {
								return produce(state, (draft) => {
									for (const c of getRotating(draft.cells.flat(3))) {
										c.cord = rotate(c.cord);
										c.side = rotate(c.side);
										// TODO: fix rotating angle bug (see Knight + Tesseract)
										c.angle += angle * axis.dot(c.side);
										draft.cords[vkey(c.cord)] = c.id;
									}

									for (const c of getRotating(draft.cuboids.flat(3))) {
										c.cord = rotate(c.cord);
									}
								});
							});
						};

						if (animate) {
							// WITH ANIMATION: update on animation end;
							animation().set({
								progress: 0,
								cells: getRotating(cells.flat(3)),
								cuboids: getRotating(cuboids.flat(3)),
								onEnd: rotateAllSync,
								config: { type: 'rotate', axis, angle },
							});
						} else {
							// NO ANIMATION: update straightaway
							rotateAllSync();
						}

						break;
					}
					default: {
						move(activeCell, cell, paths, animate);
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
			{!inverted &&
				cuboids.flat(3).map((cuboid) => {
					return <Cuboid key={'cc' + cuboid.id} cuboid={cuboid} />;
				})}
			{walled && <CubeFrame />}
			{animate && <Animator />}
		</>
	);
}
