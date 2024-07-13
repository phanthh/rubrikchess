import { sampleConfig } from '@/settings';
import { game, useGameStore } from '@/store/game';
import { useShallow } from 'zustand/react/shallow';
import { Button } from './ui/button';
import { Switch } from './ui/switch';

type NavBarProps = {};
export function NavBar(props: NavBarProps) {
	const [state, turn, walled, sandbox, debug] = useGameStore(
		useShallow((store) => [store.state, store.turn, store.walled, store.sandbox, store.debug]),
	);

	const handleReset = () => {
		game().init(sampleConfig);
	};

	const handleCancel = () => {
		game().resetCellsState();
		game().set({ state: 'play:pick-piece' });
	};

	return (
		<nav className="flex p-4 h-16 flex-row items-center gap-3 border-gray-500 border-2 bg-background">
			{/* {debug && <span className="text-foreground">State: {state}</span>} */}
			<Button variant="outline" onClick={handleReset}>
				Reset
			</Button>
			<span className="text-foreground">Walled:</span>
			<Switch
				checked={walled}
				onCheckedChange={() => {
					game().set({ walled: !walled });
				}}
			/>
			<span className="text-foreground">Sandbox:</span>
			<Switch
				checked={sandbox}
				onCheckedChange={() => {
					game().set({ sandbox: !sandbox });
				}}
			/>
			<span className="text-foreground">DEBUG:</span>
			<Switch
				checked={debug}
				onCheckedChange={() => {
					game().set({ debug: !debug });
				}}
			/>
			{!sandbox && <span className="text-foreground">Turn: {turn.toUpperCase()}</span>}
			{state === 'play:pick-cell' && (
				<Button style={{ marginLeft: 'auto' }} variant="destructive" onClick={handleCancel}>
					Cancel
				</Button>
			)}
		</nav>
	);
}
