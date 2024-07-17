import { C_S } from '@/settings';
import { game, useGameStore } from '@/store/game';
import { TAction, TCell, TCuboid } from '@/types';
import { EPiece } from '@/utils/consts';
import { assert, nkeyinv, vkey } from '@/utils/funcs';
import { move } from '@/utils/path';
import { produce } from 'immer';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import { Vector3 } from 'three';
import { Button } from './ui/button';
import { Slider } from './ui/slider';

export function GameHistoryController() {
	const cells = useGameStore((store) => store.cells);
	const history = useGameStore((store) => store.history);
	const state = useGameStore((store) => store.state);
	const cursor = useGameStore((store) => store.cursor);

	const available = useMemo(() => {
		return state !== 'play:animate';
	}, [state]);

	const handleForward = () => {
		// apply change here
		assert(cursor < history.length);
		const action = history.at(cursor);
		assert(action);

		const [ac, ai, aj] = nkeyinv(action.cell.id);
		const activeCell = cells[ac][ai][aj];
		const activePiece = activeCell.piece;
		assert(activePiece);

		// MOVE PIECE
		switch (activePiece.type) {
			case EPiece.TESSERACT: {
				const payload = action.payload;
				if (!payload) {
					// no payload means no rotate
					const targetCellId = action.target?.id;
					assert(targetCellId);
					const [tc, ti, tj] = nkeyinv(targetCellId);
					const cell = cells[tc][ti][tj];
					move(activeCell, cell, cells, false);
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

				executeRotationMove();

				break;
			}
			default: {
				const targetCellId = action.target?.id;

				assert(targetCellId);
				const [tc, ti, tj] = nkeyinv(targetCellId);
				const cell = cells[tc][ti][tj];

				move(activeCell, cell, cells, false);
				break;
			}
		}

		// TURN COMPLETE
		game().set((state) => ({
			turn: state.sandbox ? state.turn : state.turn === 'white' ? 'black' : 'white',
			state: 'play:pick-piece',
			// CHANGE CURSOR
			cursor: Math.min(cursor + 1, history.length),
		}));
	};

	const handleBackward = () => {
		assert(cursor > 0);
		// apply change here
		const action = history.at(cursor - 1);
		assert(action);

		const revertMove = (action: TAction) => {
			const targetId = action.target?.id;
			assert(targetId);
			const [ac, ai, aj] = nkeyinv(action.cell.id);
			const [tc, ti, tj] = nkeyinv(targetId);

			const activeCell = cells[ac][ai][aj]; // target cell is the previous active cell
			const targetCell = cells[tc][ti][tj];

			// REVERSE ROLE
			move(targetCell, activeCell, cells, false);

			// IF CAPTURING, restore?
			const targetPiece = action.target?.piece;
			if (targetPiece) {
				game().set((state) => {
					return produce(state, (draft) => {
						draft.cells[tc][ti][tj].piece = {
							id: targetPiece.id,
							player: targetPiece.player,
							type: targetPiece.type,
						};
					});
				});

				game().updatePieceMoves(targetPiece.id);
			}
		};

		switch (action.cell.piece.type) {
			case EPiece.TESSERACT: {
				const payload = action.payload;
				if (!payload) {
					// no payload means no rotate
					revertMove(action);
					break;
				}

				// SPECIAL TESSERACT MOVE: ROTATE
				const { axis: oriAxis, angle } = payload as { axis: Vector3; angle: number };

				// REVERT ROTATION
				const axis = oriAxis.clone().negate();
				const [ac, ai, aj] = nkeyinv(action.cell.id);
				const activeCell = cells[ac][ai][aj];

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

				executeRotationMove();

				break;
			}
			default: {
				revertMove(action);
				break;
			}
		}

		// TURN COMPLETE
		game().set((state) => ({
			turn: state.sandbox ? state.turn : state.turn === 'white' ? 'black' : 'white',
			state: 'play:pick-piece',
			// CHANGE CURSOR
			cursor: Math.max(cursor - 1, 0),
		}));
	};

	return (
		<div className="fixed select-none p-2 bottom-2 left-1/2 translate-x-[-50%] rounded-lg border bg-card text-card-foreground shadow-sm">
			<div className="flex items-center px-2 gap-2">
				<Button
					onClick={handleBackward}
					disabled={!available || cursor === 0}
					variant="outline"
					size="icon"
				>
					<ChevronLeft className="h-4 w-4" />
				</Button>
				<Button
					onClick={handleForward}
					disabled={!available || cursor === history.length}
					variant="outline"
					size="icon"
				>
					<ChevronRight className="h-4 w-4" />
				</Button>

				<Slider
					min={0}
					max={history.length}
					step={1}
					value={[cursor]}
					onValueChange={(v) => {
						if (v[0] > cursor) {
							handleForward();
						} else if (v[0] < cursor) {
							handleBackward();
						}
					}}
					className="w-[200px]"
				/>
				<span>
					{cursor} / {history.length}
				</span>
			</div>
		</div>
	);
}
