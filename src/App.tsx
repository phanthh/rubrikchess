import { GizmoHelper, GizmoViewport, OrbitControls, Stats } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useEffect } from 'react';
import { Cube } from './components/cube';
import { DEBUG, sampleConfig } from './settings';
import { useGameStore } from './store/game';
import { SIDES } from './utils/consts';
import { vkey } from './utils/funcs';
import { NavBar } from './components/nav-bar';

function App() {
	const [init] = useGameStore((store) => [store.init]);

	useEffect(() => {
		init(sampleConfig);

		if (DEBUG) {
			const unsub = useGameStore.subscribe((store) => {
				console.log('[GAME_STATE]: ', store.state);
			});
			return unsub;
		}
	}, []);

	return (
		<div className="w-screen h-screen relative">
			<Canvas
				className="w-full h-full"
				style={{ border: DEBUG ? '1px solid green' : 'none' }}
				camera={{
					position: [38, 50, 38],
					fov: 50,
				}}
			>
				<ambientLight color="white" intensity={0.8} />
				<Cube />
				{SIDES.map((side) => (
					<pointLight
						key={vkey(side)}
						position={side.clone().multiplyScalar(50)}
						color="white"
						intensity={1000}
					>
						{DEBUG && (
							<mesh>
								<sphereGeometry args={[0.5, 32, 32]} />
								<meshBasicMaterial color="white" />
							</mesh>
						)}
					</pointLight>
				))}
				{DEBUG && (
					<>
						<Stats />
						<axesHelper args={[1000]} />
						<GizmoHelper alignment="top-right" margin={[80, 80]}>
							<GizmoViewport axisColors={['red', 'green', 'blue']} labelColor="black" />
						</GizmoHelper>
					</>
				)}
				<OrbitControls enablePan={false} enableDamping={true} />
			</Canvas>
			<NavBar />
		</div>
	);
}

// function CubeMesh() {
// 	const geometry = useMemo(() => new BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE), []);
// 	return (
// 		<lineSegments position={[0, 0, 0]}>
// 			<edgesGeometry args={[geometry]} />
// 			<lineBasicMaterial color={'white'} linewidth={2} />
// 		</lineSegments>
// 	);
// }

export default App;
