import { GameStateBanner } from './game-state-banner';
import { GameTurnBanner } from './game-turn-banner';
import { Tooltip } from './tooltip';
import { Toaster } from './ui/sonner';

export function UserInterface() {
	return (
		<>
			<Tooltip />
			<GameStateBanner />
			<GameTurnBanner />
			<Toaster />
		</>
	);
}
