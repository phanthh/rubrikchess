import { B_D, CU_S } from '@/settings';
import { useGameState, useGameStore } from '@/store/game';
import { postprocessing } from '@/store/postprocessing';
import { useRef, useLayoutEffect } from 'react';
import { AmbientLight, PointLight } from 'three';

const DIST = Math.sqrt(3) * CU_S;
export function Lights() {
	const ambientLightRef = useRef<AmbientLight>(null);
	const pointLight1Ref = useRef<PointLight>(null);
	const pointLight2Ref = useRef<PointLight>(null);
	const [lowPerf] = useGameState('lowPerf');

	useLayoutEffect(() => {
		if (!ambientLightRef.current) return;
		if (!pointLight1Ref.current) return;
		if (!pointLight2Ref.current) return;
		postprocessing().registerLightRef('a', ambientLightRef);
		postprocessing().registerLightRef('p1', pointLight1Ref);
		postprocessing().registerLightRef('p2', pointLight2Ref);
		return () => {
			postprocessing().unregisterLightRef('a');
			postprocessing().unregisterLightRef('p1');
			postprocessing().unregisterLightRef('p2');
		};
	}, [ambientLightRef.current, pointLight1Ref.current, pointLight2Ref.current]);
	return (
		<>
			<ambientLight ref={ambientLightRef} color="white" intensity={B_D / 8} />
			<pointLight
				ref={pointLight1Ref}
				position={[DIST, DIST, DIST]}
				color="white"
				intensity={(10000 * B_D) / 8}
				castShadow={!lowPerf}
			/>
			<pointLight
				ref={pointLight2Ref}
				position={[-DIST, -DIST, -DIST]}
				color="white"
				intensity={(10000 * B_D) / 8}
				castShadow={!lowPerf}
			/>
		</>
	);
}
