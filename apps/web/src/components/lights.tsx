import { B_D, CU_S } from '@/settings';
import { useGameStore } from '@/store/game';

const DIST = Math.sqrt(3) * CU_S;

export function Lights() {
	const lowPerf = useGameStore((store) => store.lowPerf);
	return (
		<>
			<ambientLight color="white" intensity={B_D / 8} />
			<pointLight
				position={[DIST, DIST, DIST]}
				color="white"
				intensity={(10000 * B_D) / 8}
				castShadow={!lowPerf}
			/>
			<pointLight
				position={[-DIST, -DIST, -DIST]}
				color="white"
				intensity={(10000 * B_D) / 8}
				castShadow={!lowPerf}
			/>
		</>
	);
}
