import { useAnimationStore } from '@/store/animation';
import { useGameStore } from '@/store/game';
import { BLACK, MAX_INT, PALETTE, WHITE } from '@/utils/consts';
import { usePreventPropagation } from '@/utils/hooks';
import { ThreeEvent } from '@react-three/fiber';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { BackSide, DoubleSide, Mesh, PlaneGeometry, Texture } from 'three';
import { C_S } from '../settings';
import { TCell } from '../types';
import { CellIndicator } from './cell-indicator';
import { Piece } from './piece';

const cellGeometry = new PlaneGeometry(C_S, C_S);

type CellProps = {
	cell: TCell;
	onPick: (cell: TCell) => void;
};

const cache = new Map<string, Texture>();

const INDICATED = ['reachable', 'capturable', 'targeted', 'targeted:path'];

export const Cell = memo(({ cell, onPick }: CellProps) => {
	const ref = useRef<Mesh>(null);
	const debug = useGameStore((store) => store.debug);
	const flipped = useGameStore((store) => store.myColor === 'black');
	const preventProgagationProps = usePreventPropagation();

	useLayoutEffect(() => {
		const mesh = ref.current;
		if (!mesh?.parent) return;
		// lookAt wants world coords; the board group may be flipped for black
		mesh.parent.updateWorldMatrix(true, false);
		mesh.lookAt(mesh.parent.localToWorld(cell.pos.clone().add(cell.side.clone().multiplyScalar(MAX_INT))));
	}, [cell.side, cell.pos, flipped]);

	useLayoutEffect(() => {
		useAnimationStore.getState().registerCellRef(cell.id, ref);
		return () => {
			useAnimationStore.getState().unregisterCellRef(cell.id);
		};
	}, [cell.id]);

	const handleClick = (e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		onPick(cell);
	};

	const texture = useMemo(() => {
		const color = PALETTE[cell.color];
		const cacheKey = `${cell.id}-${color}-${debug}`;
		const cached = cache.get(cacheKey);
		if (cached) {
			cached.needsUpdate = true;
			return cached;
		}
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d')!;
		canvas.width = 500;
		canvas.height = 500;
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		if (debug) {
			const fontSize = 70;
			ctx.font = `Bold ${fontSize}px Arial`;
			ctx.fillStyle = color === BLACK ? WHITE : BLACK;
			ctx.fillText(String(cell.id), 0, fontSize);
		}
		const texture = new Texture(canvas);
		texture.needsUpdate = true;
		cache.set(cacheKey, texture);
		return texture;
	}, [cell.id, cell.color, debug]);

	return (
		<mesh
			{...preventProgagationProps}
			onClick={handleClick}
			ref={ref}
			geometry={cellGeometry}
			position={cell.pos}
			receiveShadow
		>
			<meshStandardMaterial
				side={DoubleSide}
				shadowSide={BackSide}
				map={texture}
				roughness={0.9}
				metalness={0.1}
			/>
			<lineSegments>
				<edgesGeometry args={[cellGeometry]} />
				<lineBasicMaterial color={'black'} />
			</lineSegments>
			{cell.piece && <Piece cell={cell} piece={cell.piece} />}
			{INDICATED.includes(cell.state) && <CellIndicator cell={cell} />}
		</mesh>
	);
});
