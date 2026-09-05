import { game } from '@/store/game';
import { useEffect } from 'react';

/** Arrow keys walk the move list; `f` flips the board. */
export function useReplayKeys() {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
			const g = game();
			switch (e.key) {
				case 'ArrowLeft':
					g.setCursor(g.cursor - 1);
					break;
				case 'ArrowRight':
					g.setCursor(g.cursor + 1);
					break;
				case 'ArrowUp':
				case 'Home':
					g.setCursor(0);
					break;
				case 'ArrowDown':
				case 'End':
					g.setCursor(g.history.length);
					break;
				case 'f':
					g.setSetting({ flipped: !g.flipped });
					break;
				default:
					return;
			}
			e.preventDefault();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);
}

