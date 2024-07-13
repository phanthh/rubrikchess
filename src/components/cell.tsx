import { registerCellRef } from '@/store/animation';
import { ThreeEvent, useFrame } from '@react-three/fiber';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { BoxGeometry, Mesh, PlaneGeometry } from 'three';
import { C_S, DEBUG_BOARD_CORD } from '../settings';
import { game, useGameStore } from '../store/game';
import { TCell } from '../types';
import { implyDirs, preventProgagation, vec, vkey } from '../utils/funcs';
import { CellIndicator } from './cell-indicator';
import { Piece } from './piece';
import { Text } from './text';

const cellGeometry = new BoxGeometry(C_S, C_S, 0.1);

type CellProps = {
	cell: TCell;
	onPickCell: (cell: TCell) => void;
	onPickPiece: (cell: TCell) => void;
};

export const Cell = memo(({ cell, onPickCell, onPickPiece }: CellProps) => {
	const ref = useRef<Mesh>(null);
	const dirs = useMemo(() => implyDirs(cell.side), [cell.cord]);
	const debug = useGameStore((store) => store.debug);

	useLayoutEffect(() => {
		if (!ref.current) return;
		ref.current.lookAt(cell.cord.clone().add(cell.side));
		ref.current.rotateOnAxis(vec(0, 0, 1), cell.angle);
		registerCellRef(cell.id, ref);
	}, [ref.current, cell]);

	const handleClick = (e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		switch (game().state) {
			case 'play:pick-piece':
				onPickPiece(cell);
				break;
			case 'play:pick-cell':
				onPickCell(cell);
				break;
			default:
				break;
		}
	};

	const handleDoubleClick = (e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		game().resetCellsState();
		game().set({ state: 'play:pick-piece' });
		onPickPiece(cell);
	};

	useFrame(({ clock }) => {
		// if (!ref.current) return;
		// if (bkeyinv(cell.id)[0] === 2) {
		// 	const axis = vec(1, 0, 0);
		// 	const angle = 0.001 * clock.getElapsedTime();
		// 	ref.current.position.applyAxisAngle(axis, angle);
		// 	ref.current.rotateOnAxis(axis, angle);
		// }
	});

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
