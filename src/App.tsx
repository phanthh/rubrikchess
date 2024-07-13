import { GizmoHelper, GizmoViewport, Stats, TrackballControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense, useLayoutEffect } from 'react';
import { Color } from 'three';
import { Cube } from './components/cube';
import { CubeFrame } from './components/cube-frame';
import { NavBar } from './components/nav-bar';
import { sampleConfig } from './settings';
import { game, useGameStore } from './store/game';
import { UserInterface } from './components/user-interface';

function App() {
	const debug = useGameStore((store) => store.debug);
	useLayoutEffect(() => {
		game().init(sampleConfig);
		if (debug) {
			const unsub = useGameStore.subscribe((store) => {
				console.log('[GAME_STATE]: ', store.state);
			});
			return unsub;
		}
	}, [debug]);

	const handleMissedClick = () => {
		switch (game().state) {
			case 'play:pick-piece':
				break;
			case 'play:pick-cell':
				game().resetCellsState();
				game().set({ state: 'play:pick-piece' });
				break;
			default:
				break;
		}
	};

	return (
		<div className="w-screen overflow-hidden h-screen flex flex-col">
			<NavBar />
			<Canvas
				shadows="soft"
				onPointerMissed={handleMissedClick}
				className="w-full flex-grow"
				// style={{ border: DEBUG ? '1px solid green' : 'none' }}
				scene={{ background: new Color('#101010') }}
				camera={{ position: [38, 50, 38], fov: 50 }}
			>
				<Suspense fallback={<CubeFrame />}>
					<ambientLight color="white" intensity={0.7} />
					<Cube />
					<pointLight position={[40, 40, 40]} color="white" intensity={5000} castShadow />
					<pointLight position={[-40, -40, -40]} color="white" intensity={5000} castShadow />
					{/* {SIDES.map((side) => ( */}
					{/* 	<pointLight */}
					{/* 		key={vkey(side)} */}
					{/* 		position={side.clone().multiplyScalar(50)} */}
					{/* 		color="white" */}
					{/* 		intensity={2000} */}
					{/* 		castShadow */}
					{/* 	> */}
					{/* 		{DEBUG && ( */}
					{/* 			<mesh> */}
					{/* 				<sphereGeometry args={[0.5, 32, 32]} /> */}
					{/* 				<meshBasicMaterial color="white" /> */}
					{/* 			</mesh> */}
					{/* 		)} */}
					{/* 	</pointLight> */}
					{/* ))} */}
					{debug && (
						<>
							<Stats />
							<axesHelper args={[1000]} />
							<GizmoHelper alignment="top-right" margin={[80, 80]}>
								<GizmoViewport axisColors={['red', 'green', 'blue']} labelColor="black" />
							</GizmoHelper>
						</>
					)}
					{/* <OrbitControls enablePan={false} enableDamping={true} /> */}
					<TrackballControls noPan dynamicDampingFactor={0.1} />
				</Suspense>
			</Canvas>
			<UserInterface />
		</div>
	);
}

export default App;
