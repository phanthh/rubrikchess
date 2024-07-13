import { bfs, walk } from '@/utils/path';
import { ThreeEvent } from '@react-three/fiber';
import { produce } from 'immer';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { Mesh, PlaneGeometry, Vector3 } from 'three';
import { C_S, DEBUG_BOARD_CORD } from '../settings';
import { game, useGameStore } from '../store/game';
import { TCell, TPlayer } from '../types';
import { EPiece, XPOS, YPOS, ZPOS } from '../utils/consts';
import {
	assert,
	bkeyinv,
	implyDirs,
	isCornerCell,
	isEdgeCell,
	preventProgagation,
	updateCellState,
	vkey,
} from '../utils/funcs';
import { CellIndicator } from './cell-indicator';
import { Text } from './text';
import { Piece } from './piece';

const cellGeometry = new PlaneGeometry(C_S, C_S);

type CellProps = {
	cell: TCell;
};

export const Cell = memo(({ cell }: CellProps) => {
	const ref = useRef<Mesh | null>(null);
	const dirs = useMemo(() => implyDirs(cell.side), [cell.cord]);
	const debug = useGameStore((store) => store.debug);

	useLayoutEffect(() => {
		if (!ref.current) return;
		ref.current.lookAt(cell.cord.clone().add(cell.side));
	}, [ref.current, cell.cord, cell.side]);

	const handlePickPiece = (turn: TPlayer, sandbox: boolean) => {
		const piece = cell.piece;
		if (!piece) return;
		if (turn !== cell.piece?.player && !sandbox) return;

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

	const handlePickCell = () => {
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
								// reset all cell state to normal
								if (c.state !== 'normal') c.state = 'normal';
								if (c.payload) delete c.payload;
								if (c.id === cell.id) {
									// intent to move piece to this cell
									c.piece = activeCell.piece;
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
						game().set((state) => {
							return produce(state, (draft) => {
								for (const c of draft.cells.flat(3)) {
									c.state = 'normal';
									delete c.payload;
									const cdot = c.cord.dot(axis);
									if (cdot === adot || Math.abs(cdot - adot) === C_S / 2) {
										c.cord = rotate(c.cord);
										c.side = rotate(c.side);
										draft.cords[vkey(c.cord)] = c.id;
									}
								}
							});
						});

						break;
					}
					default: {
						basicMove();
						break;
					}
				}

				// TURN COMPLETE
				game().set((state) => ({
					state: 'play:pick-piece',
					turn: state.sandbox ? state.turn : state.turn === 'white' ? 'black' : 'white',
				}));
			}

			default: {
				break;
			}
		}
	};

	const handleClick = (e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		const { state, turn, sandbox } = game();
		switch (state) {
			case 'play:pick-piece':
				handlePickPiece(turn, sandbox);
				break;
			case 'play:pick-cell':
				handlePickCell();
				break;
			default:
				break;
		}
	};

	const handleDoubleClick = (e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		const { turn, sandbox } = game();
		game().resetCellsState();
		game().set({ state: 'play:pick-piece' });
		handlePickPiece(turn, sandbox);
	};

	return (
		<>
			<mesh
				{...preventProgagation()}
				onClick={handleClick}
				onDoubleClick={handleDoubleClick}
				ref={ref}
				geometry={cellGeometry}
				position={cell.cord}
				receiveShadow
			>
				<meshStandardMaterial color={cell.color} roughness={0.9} metalness={0.1} />
				{DEBUG_BOARD_CORD && <Text position={[-C_S / 2, -C_S / 2, 0]} text={cell.id} />}
				<lineSegments>
					<edgesGeometry args={[cellGeometry]} />
					<lineBasicMaterial color={'black'} />
				</lineSegments>
				{(cell.state === 'reachable' || cell.state === 'capturable') && (
					<CellIndicator cell={cell} />
				)}
				{cell.piece && <Piece cell={cell} piece={cell.piece} />}
			</mesh>
			{debug &&
				cell.state === 'active' &&
				dirs.map((dir) => {
					return <arrowHelper key={vkey(dir)} args={[dir, cell.cord, 10, 'red']} />;
				})}
			{debug && <arrowHelper args={[cell.side, cell.cord, 10, 'green']} />}
		</>
	);
});
