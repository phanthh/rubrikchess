import { useGameState, useGameStore } from '@/store/game';
import { GameHistoryController } from './game-history-controller';
import { GameStateBanner } from './game-state-banner';
import { GameTurnBanner } from './game-turn-banner';
import { Tooltip } from './tooltip';
import { Toaster } from './ui/sonner';

export function UserInterface() {
	const [sandbox] = useGameState('sandbox');
	const [debug] = useGameState('debug');
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
