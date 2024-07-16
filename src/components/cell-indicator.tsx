import { C_S } from '@/settings';
import { TCell } from '@/types';
import { MAX_INT } from '@/utils/consts';
import { vec } from '@/utils/funcs';
import { useInteractiveMesh } from '@/utils/hooks';
import { memo } from 'react';
import { AdditiveBlending } from 'three';

type CellIndicatorProps = {
	cell: TCell;
};

const CL_H = MAX_INT;
const CL_R = C_S / 2;

export const CellIndicator = memo(({ cell }: CellIndicatorProps) => {
	const [color, props] = useInteractiveMesh(
		{
			normal: cell.payload
				? '#ffff00'
				: cell.state === 'targeted:path' || cell.state === 'targeted'
					? '#ffbb00'
					: '#00ff00',
			hover: cell.payload
				? '#ffffaa'
				: cell.state === 'targeted:path' || cell.state === 'targeted'
					? '#eecc11'
					: '#aaffaa',
			active: '#ff0000',
			tooltip:
				cell.state === 'reachable'
					? 'Move Here'
					: cell.state === 'capturable'
						? 'Capture Piece'
						: undefined,
		},
		cell.state === 'capturable',
	);

	return (
		<mesh {...props} position={[0, 0, 0]} receiveShadow castShadow>
			<boxGeometry args={[C_S - 1, C_S - 1, 0.5]} />
			<meshStandardMaterial color={color} roughness={0.9} metalness={0.1} />
			{cell.state === 'targeted' && (
				<>
					<mesh position={[0, 0, CL_H / 2]} rotation={[Math.PI / 2, 0, 0]}>
						<cylinderGeometry args={[CL_R, CL_R, CL_H, 32]} />
						<meshStandardMaterial
							emissiveIntensity={1}
							opacity={0.5}
							emissive={'#ffbb00'}
							blending={AdditiveBlending}
						/>
					</mesh>
					<pointLight position={vec(0, 0, 20)} color="#ffbb00" intensity={200} castShadow />
				</>
			)}
		</mesh>
	);
});
