import { useGameStore } from '@/store/game';

export function GameStateBanner() {
	const state = useGameStore((store) => store.state);
	return (
		<div className="fixed select-none p-2 bottom-2 right-2 rounded-lg border bg-card text-card-foreground shadow-sm">
			State: {state}
		</div>
	);
}
