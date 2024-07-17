import { Stats } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense, useEffect, useLayoutEffect } from 'react';
import { Controls } from './components/controls';
import { Cube } from './components/cube';
import { CubeFrame } from './components/cube-frame';
import { Lights } from './components/lights';
import { NavBar } from './components/nav-bar';
import { UserInterface } from './components/user-interface';
import { game, useGameStore } from './store/game';

function App() {
	const debug = useGameStore((store) => store.debug);

	useEffect(() => {
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
				camera={{ position: [38, 50, 38], fov: 50 }}
				dpr={[1, 1.5]}
			>
				<color attach="background" args={['#101010']} />
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
				<Controls controlStyle="orbit" />
			</Canvas>
			<UserInterface />
		</div>
	);
}

export default App;
