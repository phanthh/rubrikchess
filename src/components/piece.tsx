import { registerPieceRef } from '@/store/animation';
import { TCell, TPiece } from '@/types';
import { EColor, EPiece } from '@/utils/consts';
import { useInteractiveMesh } from '@/utils/hooks';
import { GroupProps, MeshProps, useLoader } from '@react-three/fiber';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { Group } from 'three';
import { STLLoader } from 'three/examples/jsm/Addons.js';

const ASSET_CONFIGS: Record<EPiece, { path: string; meshProps?: MeshProps; tooltip?: string }> = {
	[EPiece.QUEEN]: {
		path: '/models/queen.stl',
		tooltip: 'Queen',
	},
	[EPiece.ROOK]: {
		path: '/models/rook.stl',
		tooltip: 'Rook',
	},
	[EPiece.KING]: {
		path: '/models/king.stl',
		tooltip: 'King',
	},
	[EPiece.CAPTAIN]: {
		path: '/models/captain.stl',
		tooltip: 'Captain',
	},
	[EPiece.TESSERACT]: {
		path: '/models/tesseract.stl',
		tooltip: 'Tesseract',
	},
	[EPiece.PAWN]: {
		path: '/models/pawn.stl',
		tooltip: 'Pawn',
	},
	[EPiece.KNIGHT]: {
		path: '/models/knight.stl',
		tooltip: 'Knight',
	},
	[EPiece.BISHOP]: {
		path: '/models/bishop.stl',
		tooltip: 'Bishop',
	},
};

type PieceProps = {
	piece: TPiece;
	cell: TCell;
} & GroupProps;

export const Piece = memo(({ piece, cell, ...props }: PieceProps) => {
	const ref = useRef<Group>(null);
	const { path, meshProps, tooltip } = useMemo(() => ASSET_CONFIGS[piece.type], [piece.type]);
	const geometry = useLoader(STLLoader, path);

	const [color, interactiveProps] = useInteractiveMesh(
		{
			normal: piece?.player === 'white' ? EColor.WHITE : EColor.BLACK,
			hover: '#aaffaa',
			active: '#aaffaa',
			tooltip,
		},
		cell.state === 'active',
	);

	useLayoutEffect(() => {
		geometry.center();
		geometry.computeBoundingBox();
		geometry.translate(0, 0, geometry.boundingBox?.max.z ?? 0);
	}, []);

	useLayoutEffect(() => {
		if (!ref.current) return;
		registerPieceRef(piece.id, ref);
	}, [ref.current]);

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
				<meshStandardMaterial roughness={0.5} metalness={0.1} color={color} />
			</mesh>
		</group>
	);
});
