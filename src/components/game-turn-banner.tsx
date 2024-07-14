import { useGameStore } from '@/store/game';

export function GameTurnBanner() {
	const turn = useGameStore((store) => store.turn);
	const sandbox = useGameStore((store) => store.sandbox);
	if (!sandbox) return null;
	return (
		<div className="fixed select-none p-2 bottom-2 left-2 rounded-lg border bg-card text-card-foreground shadow-sm">
			Turn: {turn}
		</div>
	);
}
