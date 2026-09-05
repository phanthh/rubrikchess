import { C_S } from '@/settings';
import { useGameStore } from '@/store/game';
import { TCell } from '@/types';
import { MAX_INT } from '@/utils/funcs';
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
	const lowPerf = useGameStore((store) => store.lowPerf);
	if (cell.state === 'lastmove') return <LastMove />;
	return <Indicator cell={cell} lowPerf={lowPerf} />;
});

/** Flat translucent tint on the from/to cells of the last move (not interactive). */
function LastMove() {
	return (
		<mesh position={[0, 0, 0.05]}>
			<planeGeometry args={[C_S, C_S]} />
			<meshBasicMaterial color="#ccaa22" transparent opacity={0.45} depthWrite={false} />
		</mesh>
	);
}

function Indicator({ cell, lowPerf }: CellIndicatorProps & { lowPerf: boolean }) {
	const rotate = cell.move?.kind === 'rotate';
	const [color, props] = useInteractiveMesh(
		{
			normal: rotate
				? '#eab308'
				: cell.state === 'targeted:path' || cell.state === 'targeted'
					? '#f59e0b'
					: '#22c55e',
			hover: rotate
				? '#fde047'
				: cell.state === 'targeted:path' || cell.state === 'targeted'
					? '#fbbf24'
					: '#86efac',
			active: '#ef4444',
			tooltip:
				cell.state === 'reachable'
					? rotate
						? 'Rotate Here'
						: 'Move Here'
					: cell.state === 'capturable'
						? 'Capture Piece'
						: undefined,
		},
		cell.state === 'capturable',
	);

	const capture = cell.state === 'capturable';
	const threat = cell.state === 'targeted' || cell.state === 'targeted:path';
	return (
		// lichess-style: a dot for a quiet move, a ring around a capturable piece; a thin
		// invisible plate keeps the whole cell clickable
		<mesh {...props} position={[0, 0, 0.06]}>
			<planeGeometry args={[C_S, C_S]} />
			<meshBasicMaterial transparent opacity={0} depthWrite={false} />
			{capture || threat ? (
				<mesh position={[0, 0, 0.04]}>
					<ringGeometry args={[C_S * 0.34, C_S * 0.46, 32]} />
					<meshBasicMaterial color={color} transparent opacity={0.85} depthWrite={false} />
				</mesh>
			) : (
				<mesh position={[0, 0, 0.04]}>
					<circleGeometry args={[rotate ? C_S * 0.22 : C_S * 0.16, 24]} />
					<meshBasicMaterial color={color} transparent opacity={0.8} depthWrite={false} />
				</mesh>
			)}
			{cell.state === 'targeted' && !lowPerf && (
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
}
