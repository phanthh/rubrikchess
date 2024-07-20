import { C_S, STANDARD_CONFIG } from '@/settings';
import { animation } from '@/store/animation';
import { TAction, TCell, TCuboid } from '@/types';
import { EPiece, XPOS, YPOS, ZPOS } from '@/utils/consts';
import { assert, nkeyinv, vkey } from '@/utils/funcs';
import { move } from '@/utils/path';
import { produce } from 'immer';
import { useEffect } from 'react';
import { Vector3 } from 'three';
import { game, useGameState } from '../store/game';
import { Animator } from './animator';
import { Cell } from './cell';
import { CubeFrame } from './cube-frame';
import { Cuboid } from './cuboid';

type CubeProps = {};

export function Cube({}: CubeProps) {
	const [cells] = useGameState('cells');
	const [cuboids] = useGameState('cuboids');
	const [walled] = useGameState('walled');
	const [animate] = useGameState('animate');

	useEffect(() => {
		game().initCube();
		game().initConfigPieces(STANDARD_CONFIG);
	}, []);

	// when user clicking a cell, lokoing for a piece to move
	const handlePickPiece = (cell: TCell) => {
		const piece = cell.piece;

		// return if there are no pieces in this cell
		if (!piece) return;

		const { turn, sandbox } = game();

		// disregard turn if it is currently in sandbox mode
		if (turn !== cell.piece?.player && !sandbox) return;

		const moves = piece.moves;
		assert(moves, 'no moves');

		// TODO neighborhood function for better perf, so rather than looping through all cells
		// only looking for cells satisfies some conditions
		//
		// update cells' state based on the piece's available moves
		game().set((state) =>
			produce(state, (draft) => {
				const cords = draft.cords;
				assert(cords, 'no cords');

				// a function to update the cells's state, given available moves of the chosen piece
				const updateCellStatesFromPieceMoves = () => {
					for (const move of moves) {
						// the final element in `path` is the target
						const target = move.path.at(-1);
						assert(target, 'path is too short');

						const [c, i, j] = nkeyinv(target);

						// mark the cell based on the move type
						switch (move.type) {
							case 'capturing':
								draft.cells[c][i][j].state = 'capturable';
								break;
							case 'normal':
								draft.cells[c][i][j].state = 'reachable';
								break;
							default:
								break;
						}
					}
				};

				// move additional logics for different piece type
				switch (piece.type) {
					case EPiece.TESSERACT: {
						// TESSERACT
						for (const angle of [
							Math.PI / 2,
							-Math.PI / 2,
							// NOTE: allowing 180 turn seems a bit too OP for Tesseract
							// Math.PI
						]) {
							for (const axis of [XPOS, YPOS, ZPOS]) {
								const rotated = cell.cord.clone().applyAxisAngle(axis, angle).round();
								const id = cords[vkey(rotated)];
								assert(id);
								const [cc, ci, cj] = nkeyinv(id);
								const c = draft.cells[cc][ci][cj];

								// mark cells that are additionally 'clickable' by the Tesseract piece
								c.state = 'reachable';

								// the payload also includes
								c.payload = { angle, axis };
							}
						}

						updateCellStatesFromPieceMoves();
						break;
					}
					default:
						updateCellStatesFromPieceMoves();
						break;
				}

				const [c, i, j] = nkeyinv(cell.id);
				draft.cells[c][i][j].state = 'active';

				// SWITCH TO NEXT STATE
				draft.state = 'play:pick-cell';
			}),
		);
	};

	const handlePickCell = (cell: TCell) => {
		const activeCell = game().getActiveCell();
		const activePiece = activeCell?.piece;

		assert(activeCell, 'no active cell');
		assert(activePiece, 'no active piece');

		let action: TAction | undefined;

		switch (cell.state) {
			case 'reachable':
			case 'capturable': {
				// MOVE PIECE
				switch (activePiece.type) {
					// TESSERACT
					case EPiece.TESSERACT: {
						const payload = cell.payload;
						if (!payload) {
							// no payload means no rotate
							action = move(activeCell, cell, cells, animate);
							break;
						}

						// SPECIAL TESSERACT MOVE: ROTATE
						const { axis, angle } = payload as { axis: Vector3; angle: number };
						action = {
							cell: {
								id: activeCell.id,
								piece: {
									id: activePiece.id,
									type: EPiece.TESSERACT,
									player: activePiece.player,
								},
							},
							payload: {
								axis: axis.clone(),
								angle,
							},
						};
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

						const executeRotationMove = () => {
							game().set((state) => {
								return produce(state, (draft) => {
									for (const c of getRotating(draft.cells.flat(3))) {
										c.cord = rotate(c.cord);
										c.side = rotate(c.side);
										// TODO: fix rotating angle bug (see Knight + Tesseract)
										// c.angle += angle * axis.dot(c.side);
										draft.cords[vkey(c.cord)] = c.id;
									}

									for (const c of getRotating(draft.cuboids.flat(3))) {
										c.cord = rotate(c.cord);
									}
								});
							});
							game().updatePieceMoves();
							game().updateIdleCellStates();
						};

						if (animate) {
							// WITH ANIMATION: update on animation end;
							animation().start({
								cells: getRotating(cells.flat(3)),
								cuboids: getRotating(cuboids.flat(3)),
								onEnd: executeRotationMove,
								config: { type: 'rotate', axis, angle },
							});
						} else {
							// NO ANIMATION: update straightaway
							executeRotationMove();
						}

						break;
					}
					default: {
						action = move(activeCell, cell, cells, animate);
						break;
					}
				}

				// TURN COMPLETE
				assert(action);
				const newAction = action;

				const { cursor, sandbox } = game();
				game().setState('turn', (turn) => {
					return sandbox ? turn : turn === 'white' ? 'black' : 'white';
				});
				game().set((state) => ({
					state: animate ? 'play:animate' : 'play:pick-piece',
					cursor: state.cursor + 1,
					history: [...state.history.slice(0, cursor), newAction],
				}));
			}

			default: {
				break;
			}
		}
	};

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
			{cuboids.flat(3).map((cuboid) => {
				return <Cuboid key={'cc' + cuboid.id} cuboid={cuboid} />;
			})}
			{walled && <CubeFrame />}
			{animate && <Animator />}
		</>
	);
}
