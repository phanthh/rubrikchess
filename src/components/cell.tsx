import { animation } from '@/store/animation';
import { EColor, MAX_INT } from '@/utils/consts';
import { usePreventPropagation } from '@/utils/hooks';
import { ThreeEvent } from '@react-three/fiber';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { BackSide, DoubleSide, Mesh, MeshStandardMaterial, PlaneGeometry, Texture } from 'three';
import { C_S } from '../settings';
import { game, useGameState } from '../store/game';
import { TCell, TCellState } from '../types';
import { implyDirs } from '../utils/funcs';
import { CellIndicator } from './cell-indicator';
import { Piece } from './piece';

const cellGeometry = new PlaneGeometry(C_S, C_S);

type CellProps = {
	cell: TCell;
	onPickCell: (cell: TCell) => void;
	onPickPiece: (cell: TCell) => void;
};

const cache = new Map<string, Texture>();

export const Cell = memo(({ cell, onPickCell, onPickPiece }: CellProps) => {
	const ref = useRef<Mesh>(null);
	const materialRef = useRef<MeshStandardMaterial>(null);
	const [debug] = useGameState('debug');
	const preventProgagationProps = usePreventPropagation();
	const [checkTarget] = useGameState('checkTarget');

	useLayoutEffect(() => {
		ref.current?.lookAt(cell.pos.clone().add(cell.side.clone().multiplyScalar(MAX_INT)));
	}, [ref.current, cell.side, cell.pos]);

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
		game().updatePieceMoves();
		game().updateIdleCellStates();
		game().set({ state: 'play:pick-piece' });
		onPickPiece(cell);
	};

	const texture = useMemo(() => {
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

	const indicatedCellStates = useMemo(() => {
		return [
			'reachable',
			'capturable',
			...(checkTarget ? ['targeted', 'targeted:path'] : []),
		] as TCellState[];
	}, [checkTarget]);

	return (
		<>
			<mesh
				{...preventProgagationProps}
				onClick={handleClick}
				onDoubleClick={handleDoubleClick}
				ref={ref}
				geometry={cellGeometry}
				position={cell.pos}
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
				<lineSegments>
					<edgesGeometry args={[cellGeometry]} />
					<lineBasicMaterial color={'black'} />
				</lineSegments>
				{cell.piece && <Piece cell={cell} piece={cell.piece} />}
				{indicatedCellStates.includes(cell.state) && <CellIndicator cell={cell} />}
			</mesh>
		</>
	);
});
