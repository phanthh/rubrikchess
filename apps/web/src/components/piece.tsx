import { useAnimationStore } from '@/store/animation';
import { useGameStore } from '@/store/game';
import { Piece as TPiece, PieceKind, TCell } from '@/types';
import { PIECE_BLACK, PIECE_NAMES, PIECE_RULES, PIECE_WHITE } from '@/utils/consts';
import { useInteractiveMesh } from '@/utils/hooks';
import { GroupProps, MeshProps, useLoader } from '@react-three/fiber';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { Group } from 'three';
import { STLLoader } from 'three/examples/jsm/Addons.js';
import { AxisHelper } from './axis';

const ASSET_CONFIGS: Record<PieceKind, { path: string; meshProps?: MeshProps }> = {
	queen: { path: '/models/queen.stl' },
	rook: { path: '/models/rook.stl' },
	king: { path: '/models/king.stl' },
	captain: { path: '/models/captain.stl' },
	tesseract: { path: '/models/tesseract.stl' },
	pawn: { path: '/models/pawn.stl' },
	knight: { path: '/models/knight.stl' },
	bishop: { path: '/models/bishop.stl' },
	princess: { path: '/models/princess.stl', meshProps: { scale: 0.1 } },
	prince: { path: '/models/prince.stl' },
	cannon: { path: '/models/cannon.stl', meshProps: { scale: 0.105 } },
};

type PieceProps = {
	piece: TPiece;
	cell: TCell;
} & GroupProps;

export const Piece = memo(({ piece, cell, ...props }: PieceProps) => {
	const { path, meshProps } = useMemo(() => ASSET_CONFIGS[piece.kind], [piece.kind]);
	const ref = useRef<Group>(null);
	const geometry = useLoader(STLLoader, path);
	const debug = useGameStore((store) => store.debug);

	const [color, interactiveProps] = useInteractiveMesh(
		{
			normal: piece.color === 'white' ? PIECE_WHITE : PIECE_BLACK,
			hover: '#aaffaa',
			active: '#aaffaa',
			tooltip: `${PIECE_NAMES[piece.kind]} — ${PIECE_RULES[piece.kind]}`,
		},
		cell.state === 'active',
	);

	useLayoutEffect(() => {
		geometry.center();
		geometry.computeBoundingBox();
		geometry.translate(0, 0, geometry.boundingBox?.max.z ?? 0);
	}, [geometry]);

	useLayoutEffect(() => {
		useAnimationStore.getState().registerPieceRef(piece.id, ref);
		return () => {
			useAnimationStore.getState().unregisterPieceRef(piece.id);
		};
	}, [piece.id]);

	return (
		<group ref={ref} {...props}>
			<mesh
				rotation={[0, 0, 0]}
				position={[0, 0, 0]}
				scale={0.08}
				geometry={geometry}
				{...meshProps}
				{...interactiveProps}
				castShadow
				receiveShadow
			>
				<meshStandardMaterial roughness={0.35} metalness={0.25} color={color} />
			</mesh>
			{debug && <AxisHelper />}
		</group>
	);
});
