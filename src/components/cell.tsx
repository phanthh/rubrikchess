import { ThreeEvent } from '@react-three/fiber';
import { produce } from 'immer';
import { useLayoutEffect, useRef } from 'react';
import { Mesh, PlaneGeometry } from 'three';
import { BOARD_SIZE, CELL_SIZE, DEBUG } from '../settings';
import { useGameStore } from '../store/game';
import { TBoardCord, TCell } from '../types';
import { EPiece } from '../utils/consts';
import { bcordEq, loopCells, updateCell, vkey } from '../utils/funcs';
import { Bishop } from './bishop';
import { Captain } from './captain';
import { King } from './king';
import { Knight } from './knight';
import { Pawn } from './pawn';
import { Queen } from './queen';
import { Rook } from './rook';
import { Scout } from './scout';
import { Text } from './text';

const cellGeometry = new PlaneGeometry(CELL_SIZE, CELL_SIZE);

type CellProps = {
	cell: TCell;
};

export function Cell({ cell }: CellProps) {
	const ref = useRef<Mesh | null>(null);

	useLayoutEffect(() => {
		if (!ref.current) return;
		ref.current.lookAt(cell.cord.clone().add(cell.side.clone()));
	}, [ref.current]);

	const handleMissedClick = () => {
		// const { state, resetCellsState } = useGameStore.getState();
		// switch (state) {
		// 	case 'play:pick-piece':
		// 		break;
		// 	case 'play:pick-cell':
		// 		resetCellsState();
		// 		useGameStore.setState({ state: 'play:pick-piece', activeCell: null });
		// 		break;
		// 	default:
		// 		break;
		// }
	};

	const handlePickPiece = () => {
		const piece = cell.piece;
		if (!piece) return;
		const [c, i, j] = cell.bcord;

		useGameStore.setState((state) => {
			return produce(state, (draft) => {
				// switch to next state
				draft.state = 'play:pick-cell';
				updateCell(draft.cells, cell.bcord, { state: 'active' });

				// different piece type
				switch (piece.type) {
					case EPiece.ROOK:
						break;
					case EPiece.QUEEN:
						break;
					case EPiece.KING:
						break;
					case EPiece.CAPTAIN:
						break;
					case EPiece.SCOUT:
						break;
					case EPiece.PAWN:
						// cands = candidates
						const cands: TBoardCord[] = [];

						if (i > 0) {
							cands.push([c, i - 1, j]);
						}
						if (i < BOARD_SIZE - 1) {
							cands.push([c, i + 1, j]);
						}
						if (j > 0) {
							cands.push([c, i, j - 1]);
						}
						if (j < BOARD_SIZE - 1) {
							cands.push([c, i, j + 1]);
						}
						for (const [cc, ci, cj] of cands) {
							draft.cells[cc][ci][cj].state = 'available';
						}
						break;
					case EPiece.KNIGHT:
						break;
					case EPiece.BISHOP:
						break;
					default:
						break;
				}
			});
		});
	};

	const handleClick = (e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();

		const { state, getActiveCell } = useGameStore.getState();
		const activeCell = getActiveCell();
		switch (state) {
			case 'play:pick-piece':
				handlePickPiece();
				break;
			case 'play:pick-cell':
				console.log('MOVE: ', activeCell, 'TO: ', cell);

				// move piece
				if (!activeCell) {
					throw new Error('no active cell');
				}

				useGameStore.setState((state) => {
					return produce(state, (draft) => {
						// move state back to play:pick-piece
						draft.state = 'play:pick-piece';

						loopCells(draft.cells, (c) => {
							// reset all cell state to normal
							c.state = 'normal';
							if (bcordEq(c.bcord, cell.bcord)) {
								// intent to move piece to this cell
								c.piece = activeCell.piece;
							} else if (bcordEq(c.bcord, activeCell.bcord)) {
								delete c.piece;
							}
						});
					});
				});

				break;
			default:
				break;
		}
	};

	const renderPiece = () => {
		if (!cell.piece) return;
		switch (cell.piece.type) {
			case EPiece.ROOK:
				return <Rook cell={cell} piece={cell.piece} />;
			case EPiece.QUEEN:
				return <Queen cell={cell} piece={cell.piece} />;
			case EPiece.KING:
				return <King cell={cell} piece={cell.piece} />;
			case EPiece.CAPTAIN:
				return <Captain cell={cell} piece={cell.piece} />;
			case EPiece.SCOUT:
				return <Scout cell={cell} piece={cell.piece} />;
			case EPiece.PAWN:
				return <Pawn cell={cell} piece={cell.piece} />;
			case EPiece.KNIGHT:
				return <Knight cell={cell} piece={cell.piece} />;
			case EPiece.BISHOP:
				return <Bishop cell={cell} piece={cell.piece} />;
			default:
				return null;
		}
	};

	return (
		<>
			<mesh
				renderOrder={1}
				onClick={handleClick}
				onPointerMissed={cell.state === 'available' ? handleMissedClick : undefined}
				ref={ref}
				geometry={cellGeometry}
				position={cell.cord}
			>
				{DEBUG && (
					<Text position={[-CELL_SIZE / 2, -CELL_SIZE / 2, 0]} text={cell.bcord.join(',')} />
				)}
				<meshStandardMaterial color={cell.color} />
				<lineSegments>
					<edgesGeometry args={[cellGeometry]} />
					<lineBasicMaterial color={'black'} />
				</lineSegments>
				{/* active state */}
				{cell.state === 'available' && (
					<mesh renderOrder={2} position={[0, 0, 0]}>
						<boxGeometry args={[CELL_SIZE - 1, CELL_SIZE - 1, CELL_SIZE - 1]} />
						<meshStandardMaterial color={'green'} />
					</mesh>
				)}
				{cell.piece && renderPiece()}
			</mesh>
			{/* {DEBUG && <arrowHelper args={[cell.side, cell.cord, 10, 'green']} />} */}
		</>
	);
}
