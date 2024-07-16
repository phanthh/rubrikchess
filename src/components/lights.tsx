import { postprocessing } from '@/store/postprocessing';
import { useRef, useLayoutEffect } from 'react';
import { AmbientLight, PointLight } from 'three';

export function Lights() {
	const ambientLightRef = useRef<AmbientLight>(null);
	const pointLight1Ref = useRef<PointLight>(null);
	const pointLight2Ref = useRef<PointLight>(null);

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
			<ambientLight ref={ambientLightRef} color="white" intensity={0.7} />
			<pointLight
				ref={pointLight1Ref}
				position={[40, 40, 40]}
				color="white"
				intensity={5000}
				castShadow
			/>
			<pointLight
				ref={pointLight2Ref}
				position={[-40, -40, -40]}
				color="white"
				intensity={5000}
				castShadow
			/>
		</>
	);
}
