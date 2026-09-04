import { PerformanceMonitor, Stats } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import { INITAL_CAM_CORD } from '../settings';
import { game, useGameStore } from '../store/game';
import { Board } from './board';
import { Controls } from './controls';
import { CubeFrame } from './cube-frame';
import { Lights } from './lights';

export function GameCanvas() {
	const debug = useGameStore((store) => store.debug);
	const myColor = useGameStore((store) => store.myColor);

	return (
		<Canvas
			frameloop="demand"
			shadows={'soft'}
			onPointerMissed={() => game().select(null)}
			className="w-full flex-grow"
			camera={{ position: INITAL_CAM_CORD, fov: 50 }}
			dpr={[1, 1.5]}
		>
			<color attach="background" args={['#101010']} />
			<PerformanceMonitor onDecline={() => game().setSetting({ lowPerf: true })} />
			<Suspense fallback={<CubeFrame />}>
				<Lights />
				{/* black sees its own (-Y) face on top: flip the scene, not the camera */}
				<group rotation-z={myColor === 'black' ? Math.PI : 0}>
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
