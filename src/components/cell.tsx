import { animation } from '@/store/animation';
import { EColor, MAX_INT } from '@/utils/consts';
import { ThreeEvent } from '@react-three/fiber';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import {
	BackSide,
	BoxGeometry,
	DoubleSide,
	FrontSide,
	Mesh,
	MeshStandardMaterial,
	PlaneGeometry,
	Texture,
} from 'three';
import { C_S, DEBUG_BOARD_CORD } from '../settings';
import { game, useGameStore } from '../store/game';
import { TCell } from '../types';
import { implyDirs, vec, vkey } from '../utils/funcs';
import { CellIndicator } from './cell-indicator';
import { Piece } from './piece';
import { Text } from './text';
import { usePreventPropagation } from '@/utils/hooks';

const cellGeometry = new BoxGeometry(C_S, C_S, 0.2);

type CellProps = {
	cell: TCell;
	onPickCell: (cell: TCell) => void;
	onPickPiece: (cell: TCell) => void;
};

const cache = new Map<string, Texture>();

export const Cell = memo(({ cell, onPickCell, onPickPiece }: CellProps) => {
	const ref = useRef<Mesh>(null);
	const materialRef = useRef<MeshStandardMaterial>(null);
	const dirs = useMemo(() => implyDirs(cell.side), [cell.cord]);
	const debug = useGameStore((store) => store.debug);
	const inverted = useGameStore((store) => store.inverted);
	const preventProgagationProps = usePreventPropagation();

	useLayoutEffect(() => {
		ref.current?.lookAt(
			cell.cord.clone().add(cell.side.clone().multiplyScalar(inverted ? -MAX_INT : MAX_INT)),
		);
		ref.current?.rotateOnAxis(vec(0, 0, 1), cell.angle);
	}, [ref.current, cell.side, cell.angle, cell.cord, inverted]);

	useLayoutEffect(() => {
		animation().registerCellRef(cell.id, ref);
		return () => {
			animation().unregisterCellRef(cell.id);
		};
	}, [cell.id, ref.current]);

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

	const position = useMemo(() => {
		if (inverted) {
			return cell.cord.clone().add(cell.side.clone().multiplyScalar(10));
		}
		return cell.cord;
	}, [cell.cord, cell.side, inverted]);

	const texture = useMemo(() => {
		const debug = true;
		const cacheKey = `${cell.id}-${cell.color}-${debug}`;
		const cached = cache.get(cacheKey);
		if (cached) {
			cached.needsUpdate = true;
			return cached;
		}
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d')!;
		canvas.width = 500;
		canvas.height = 500;
		ctx.fillStyle = cell.color;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		const opposite = cell.color === EColor.BLACK ? EColor.WHITE : EColor.BLACK;
		if (debug) {
			const fontSize = 70;
			ctx.font = `Bold ${fontSize}px Arial`;
			ctx.fillStyle = opposite;
			ctx.fillText(cell.id, 0, fontSize);
		}
		const texture = new Texture(canvas);
		texture.needsUpdate = true;
		cache.set(cacheKey, texture);
		return texture;
	}, [cell.id, cell.color, debug]);

	return (
		<>
			<mesh
				{...preventProgagationProps}
				onClick={handleClick}
				onDoubleClick={handleDoubleClick}
				ref={ref}
				geometry={cellGeometry}
				position={position}
				receiveShadow
			>
				<meshStandardMaterial
					side={DoubleSide}
					shadowSide={BackSide}
					ref={materialRef}
					map={texture}
					roughness={0.9}
					metalness={0.1}
				/>
				{DEBUG_BOARD_CORD && <Text position={[-C_S / 2, -C_S / 2, 0]} text={cell.id} />}
				<lineSegments>
					<edgesGeometry args={[cellGeometry]} />
					<lineBasicMaterial color={'black'} />
				</lineSegments>
				{(cell.state === 'reachable' || cell.state === 'capturable') && (
					<CellIndicator cell={cell} />
				)}
				{cell.piece && <Piece cell={cell} piece={cell.piece} />}
				{/* <arrowHelper args={[vec(0, 0, 1), vec(0, 0, 0), 1, 'blue']} /> */}
				{/* <arrowHelper args={[vec(0, 1, 0), vec(0, 0, 0), 1, 'green']} /> */}
				{/* <arrowHelper args={[vec(1, 0, 0), vec(0, 0, 0), 1, 'red']} /> */}
			</mesh>
			{debug &&
				cell.state === 'active' &&
				dirs.map((dir) => {
					return <arrowHelper key={vkey(dir)} args={[dir, cell.cord, 10, 'red']} />;
				})}
			{/* {debug && <arrowHelper args={[cell.side, cell.cord, 10, 'green']} />} */}
		</>
	);
});
