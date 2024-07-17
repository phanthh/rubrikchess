import { useGameStore } from '@/store/game';

export function GameTurnBanner() {
	const turn = useGameStore((store) => store.turn);
	return (
		<div className="fixed select-none p-2 top-20 left-1/2 translate-x-[-50%] rounded-lg border bg-card text-card-foreground shadow-sm items-center flex gap-2">
			<span>Turn:</span>
			<div
				className="rounded-full w-8 h-8 border-gray-200 border-2"
				style={{ backgroundColor: turn }}
			></div>
		</div>
	);
}
