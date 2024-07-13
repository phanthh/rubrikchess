import { C_S } from '@/settings';
import { TCell } from '@/types';
import { useInteractiveMesh } from '@/utils/hooks';
import { memo } from 'react';

type CellIndicatorProps = {
	cell: TCell;
};

export const CellIndicator = memo(({ cell }: CellIndicatorProps) => {
	const [color, props] = useInteractiveMesh(
		{
			normal: cell.payload ? '#ffff00' : '#00ff00',
			hover: cell.payload ? '#ffffaa' : '#aaffaa',
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
			<meshStandardMaterial color={color} roughness={0.5} metalness={0.1} />
		</mesh>
	);
});
