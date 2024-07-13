import { GameStateBanner } from './game-state-banner';
import { Tooltip } from './tooltip';

export function UserInterface() {
	return (
		<>
			<Tooltip />
			<GameStateBanner />
		</>
	);
}
