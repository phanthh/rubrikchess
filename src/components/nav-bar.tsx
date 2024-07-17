import { STANDARD_CONFIG } from '@/settings';
import { game, useGameStore } from '@/store/game';
import { useShallow } from 'zustand/react/shallow';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { useAnimationStore } from '@/store/animation';

type NavBarProps = {};
export function NavBar(props: NavBarProps) {
	const [state, walled, sandbox, debug, animate, checkTarget] = useGameStore(
		useShallow((store) => [
			store.state,
			store.walled,
			store.sandbox,
			store.debug,
			store.animate,
			store.checkTarget,
		]),
	);

	const handleNewStandardGame = () => {
		game().initCube();
		game().initConfigPieces(STANDARD_CONFIG);
	};

	const handleNewRandomGame = () => {
		game().initCube();
		game().initRandomPieces();
	};

	const handleCancel = () => {
		game().updatePieceMoves();
		game().updateIdleCellStates();
		game().set({ state: 'play:pick-piece' });
	};

	const handleUpdateMoves = () => {
		game().updatePieceMoves();
	};

	return (
		<nav className="flex p-4 h-16 flex-row items-center gap-3 border-gray-500 border-2 bg-background">
			{/* {debug && <span className="text-foreground">State: {state}</span>} */}
			<Button variant="outline" onClick={handleNewStandardGame}>
				New Standard Game
			</Button>
			{/* <Button variant="outline" onClick={handleUpdateMoves}> */}
			{/* 	Update Moves */}
			{/* </Button> */}
			<Button variant="outline" onClick={handleNewRandomGame}>
				New Randomize Game
			</Button>
			<Button
				style={{ opacity: state === 'play:pick-cell' ? 1 : 0 }}
				variant="destructive"
				className="mr-auto transition-opacity"
				onClick={handleCancel}
			>
				Cancel
			</Button>
			<span className="text-foreground">Walled:</span>
			<Switch
				checked={walled}
				onCheckedChange={() => {
					game().set({ walled: !walled });
					game().updatePieceMoves();
					game().updateIdleCellStates();
				}}
			/>
			<span className="text-foreground">Sandbox:</span>
			<Switch
				checked={sandbox}
				onCheckedChange={() => {
					game().set({ sandbox: !sandbox });
				}}
			/>
			<span className="text-foreground">Debug:</span>
			<Switch
				checked={debug}
				onCheckedChange={() => {
					game().set({ debug: !debug });
				}}
			/>
			<span className="text-foreground">Animate:</span>
			<Switch
				checked={animate}
				onCheckedChange={() => {
					game().set({ animate: !animate });
				}}
			/>
			<span className="text-foreground">Check Target:</span>
			<Switch
				checked={checkTarget}
				onCheckedChange={() => {
					game().set({ checkTarget: !checkTarget });
				}}
			/>
		</nav>
	);
}
