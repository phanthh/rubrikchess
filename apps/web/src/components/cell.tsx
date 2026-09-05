import { useAnimationStore } from '@/store/animation';
import { useGameStore } from '@/store/game';
import { MAX_INT, palette } from '@/utils/consts';
import { usePrefs } from '@/store/prefs';
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

const INDICATED = ['reachable', 'capturable', 'targeted', 'targeted:path', 'lastmove'];

export const Cell = memo(({ cell, onPick }: CellProps) => {
	const ref = useRef<Mesh>(null);
	const debug = useGameStore((store) => store.debug);
	const flipped = useGameStore((store) => store.flipped);
	const theme = usePrefs((s) => s.boardTheme);
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
		const color = palette(theme)[cell.color];
		// plain cells share one texture per colour; debug labels need one per cell
		const cacheKey = debug ? `${cell.id}-${color}-debug` : color;
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
			ctx.fillStyle = cell.color === 1 ? '#ffffff' : '#000000';
			ctx.fillText(String(cell.id), 0, fontSize);
		}
		const texture = new Texture(canvas);
		texture.needsUpdate = true;
		cache.set(cacheKey, texture);
		return texture;
	}, [cell.id, cell.color, debug, theme]);

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
