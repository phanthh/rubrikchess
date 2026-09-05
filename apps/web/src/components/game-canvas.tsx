import { PerformanceMonitor, Stats } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import { INITAL_CAM_CORD } from '../settings';

/** Portrait viewports (phones) need to back off so the cube is not clipped horizontally. */
function initialCamera() {
	const aspect = window.innerWidth / Math.max(1, window.innerHeight * 0.55);
	return aspect < 1 ? INITAL_CAM_CORD.clone().multiplyScalar(aspect ** -0.7) : INITAL_CAM_CORD;
}
import { game, useGameStore } from '../store/game';
import { Board } from './board';
import { Controls } from './controls';
import { CubeFrame } from './cube-frame';
import { Lights } from './lights';

export function GameCanvas() {
	const debug = useGameStore((store) => store.debug);
	const flipped = useGameStore((store) => store.flipped);

	return (
		<Canvas
			frameloop="demand"
			shadows={'soft'}
			onPointerMissed={() => game().select(null)}
			className="w-full flex-grow"
			camera={{ position: initialCamera(), fov: 50 }}
			dpr={[1, 1.5]}
		>
			<color attach="background" args={['#101010']} />
			<PerformanceMonitor onDecline={() => game().setSetting({ lowPerf: true })} />
			<Suspense fallback={<CubeFrame />}>
				<Lights />
				{/* black sees its own (-Y) face on top: flip the scene, not the camera */}
				<group rotation-z={flipped ? Math.PI : 0}>
					<Board />
				</group>
				{debug && (
					<>
						<Stats />
						<axesHelper args={[1000]} />
					</>
				)}
			</Suspense>
			<Controls />
		</Canvas>
	);
}
