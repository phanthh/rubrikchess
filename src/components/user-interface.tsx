import { useGameStore } from '@/store/game';
import { GameHistoryController } from './game-history-controller';
import { GameStateBanner } from './game-state-banner';
import { GameTurnBanner } from './game-turn-banner';
import { Tooltip } from './tooltip';
import { Toaster } from './ui/sonner';

export function UserInterface() {
	const sandbox = useGameStore((store) => store.sandbox);
	const debug = useGameStore((store) => store.debug);
	return (
		<>
			<Tooltip />
			{debug && <GameStateBanner />}
			{!sandbox && <GameTurnBanner />}
			<GameHistoryController />
			<Toaster closeButton richColors />
		</>
	);
}
