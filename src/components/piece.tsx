import { animation } from '@/store/animation';
import { useGameStore } from '@/store/game';
import { TCell, TPiece } from '@/types';
import { EColor, EPiece } from '@/utils/consts';
import { useInteractiveMesh } from '@/utils/hooks';
import { GroupProps, MeshProps, useLoader } from '@react-three/fiber';
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
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
	[EPiece.PRINCESS]: {
		path: '/models/princess.stl',
		tooltip: 'Princess',
		meshProps: {
			scale: 0.1,
		},
	},
	[EPiece.PRINCE]: {
		path: '/models/prince.stl',
		tooltip: 'Prince',
	},
	[EPiece.CANNON]: {
		path: '/models/cannon.stl',
		tooltip: 'Cannon',
		meshProps: {
			scale: 0.105,
		},
	},
};

type PieceProps = {
	piece: TPiece;
	cell: TCell;
} & GroupProps;

export const Piece = memo(({ piece, cell, ...props }: PieceProps) => {
	const { path, meshProps, tooltip } = useMemo(() => ASSET_CONFIGS[piece.type], [piece.type]);
	const ref = useRef<Group>(null);
	const geometry = useLoader(STLLoader, path);
	const inverted = useGameStore((store) => store.inverted);

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
		geometry.translate(0, 0, (geometry.boundingBox?.max.z ?? 0) + (inverted ? 0.9 : 0));
	}, [inverted]);

	useLayoutEffect(() => {
		animation().registerPieceRef(piece.id, ref);
		return () => {
			animation().unregisterPieceRef(piece.id);
		};
	}, [ref.current, piece.id]);

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
				<meshStandardMaterial roughness={0.6} metalness={0.1} color={color} />
			</mesh>

			{/* <arrowHelper args={[vec(0, 0, 1), vec(0, 0, 0), 8, 'blue']} /> */}
			{/* <arrowHelper args={[vec(0, 1, 0), vec(0, 0, 0), 8, 'green']} /> */}
			{/* <arrowHelper args={[vec(1, 0, 0), vec(0, 0, 0), 8, 'red']} /> */}
		</group>
	);
});
