import { PerformanceMonitor, Stats } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense, useEffect } from 'react';
import { Controls } from './components/controls';
import { Cube } from './components/cube';
import { CubeFrame } from './components/cube-frame';
import { Lights } from './components/lights';
import { NavBar } from './components/nav-bar';
import { UserInterface } from './components/user-interface';
import { INITAL_CAM_CORD } from './settings';
import { game, useGameState } from './store/game';

function App() {
	const [debug] = useGameState('debug');

	useEffect(() => {
		if (debug) {
			const unsub = game().subscribe((store) => {
				console.log('STATE CHANGED', store);
			});
			return unsub;
		}
	}, [debug]);

	// If clicking without hitting any objects
	const handleMissedClick = () => {
		switch (game().state) {
			case 'play:pick-piece':
				break;
			case 'play:pick-cell':
				game().updatePieceMoves();
				game().updateIdleCellStates();
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
				frameloop="demand"
				shadows={'soft'}
				onPointerMissed={handleMissedClick}
				className="w-full flex-grow"
				style={{ border: debug ? '1px solid green' : 'none' }}
				camera={{ position: INITAL_CAM_CORD, fov: 50 }}
				dpr={[1, 1.5]}
			>
				<color attach="background" args={['#101010']} />
				<PerformanceMonitor
					// onDecline={() => {
					// 	game().set({ lowPerf: true });
					// }}
					onIncline={() => {
						game().set({ lowPerf: false });
					}}
				/>
				<Suspense fallback={<CubeFrame />}>
					<Lights />
					<Cube />
					{debug && (
						<>
							<Stats />
							<axesHelper args={[1000]} />
							{/* <GizmoHelper alignment="top-right" margin={[80, 80]}> */}
							{/* 	<GizmoViewport axisColors={['red', 'green', 'blue']} labelColor="black" /> */}
							{/* </GizmoHelper> */}
						</>
					)}
					{/* <PostProcessing /> */}
				</Suspense>
				<Controls controlStyle="arcball" />
			</Canvas>

			<UserInterface />
		</div>
	);
}

export default App;
