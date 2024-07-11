import { useGLTF } from '@react-three/drei';
import { GroupProps } from '@react-three/fiber';
import { useMemo } from 'react';
import { Color, MeshStandardMaterial } from 'three';
import { TCell, TPiece } from '../types';
import { EColor } from '../utils/consts';

const path = '/models/pawn.glb';

type ScoutProps = {
	piece: TPiece;
	cell: TCell;
} & GroupProps;

export function Scout({ piece, cell, ...props }: ScoutProps) {
	const { nodes, materials } = useGLTF(path);
	const geometry = (nodes.Scout as any).geometry;
	const material = useMemo(() => {
		const cloned = materials['Material.003'].clone() as MeshStandardMaterial;
		cloned.color = piece?.player === 'white' ? new Color(EColor.WHITE) : new Color(EColor.BLACK);
		return cloned;
	}, [piece]);
	return (
		<group {...props}>
			<mesh
				rotation={[Math.PI / 2, 0, 0]}
				position={[0, 0, 1.7]}
				geometry={geometry}
				material={material}
				castShadow
				receiveShadow
			/>
		</group>
	);
}

useGLTF.preload(path);
