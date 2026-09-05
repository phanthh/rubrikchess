import { GameCanvas } from '@/components/game-canvas';
import { Net } from '@/components/round/net';
import { Shell } from '@/components/shell';
import { game, useGameStore } from '@/store/game';
import { usePrefs } from '@/store/prefs';
import { useUi } from '@/store/ui';
import { cn } from '@/utils/ui';
import { Box, Focus, LayoutGrid } from 'lucide-react';
import { RESET_CAMERA_EVENT } from '@/components/controls';
import { ReactNode, useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';

const KEYS: [string, string][] = [
	['← →', 'Previous / next move'],
	['↑ ↓', 'First / last move'],
	['f', 'Flip the board'],
	['z', 'Zen mode'],
	['?', 'This help'],
];

/**
 * Three-column round layout: optional left meta column, board, right table.
 * Below `lg` it stacks and scrolls. Zen (key `z`) hides both columns.
 */
export function BoardPage({
	banner,
	left,
	right,
	below,
}: {
	banner: ReactNode;
	left?: ReactNode;
	right: ReactNode;
	below?: ReactNode;
}) {
	const zen = useUi((s) => s.zen);
	const cursor = useGameStore((s) => s.cursor);
	const plies = useGameStore((s) => s.history.length);
	const view2d = usePrefs((s) => s.view2d);
	const [keys, setKeys] = useState(false);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === '?' && (e.target as HTMLElement)?.tagName !== 'INPUT') setKeys((k) => !k);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);
	return (
		<Shell fill>
			<div className="h-full flex flex-col lg:flex-row lg:gap-3 lg:p-3 overflow-y-auto lg:overflow-hidden">
				{left && !zen && (
					<aside className="hidden lg:flex w-64 shrink-0 flex-col gap-3 min-h-0">{left}</aside>
				)}
				<div className="relative flex-1 min-h-[55vh] shrink-0 lg:shrink lg:min-h-0 lg:rounded-md overflow-hidden">
					{view2d ? (
						<div
							className="h-full w-full flex items-center justify-center bg-[#101010] p-4"
							onClick={() => game().select(null)}
						>
							<Net interactive className="max-h-full max-w-full" />
						</div>
					) : (
						<GameCanvas />
					)}
					<div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/50 text-xs text-white/90 backdrop-blur whitespace-nowrap">
						{banner}
						{cursor !== plies && ` · viewing move ${cursor}/${plies}`}
					</div>
					{!view2d && (
						<button
							title="Reset camera"
							onClick={() => window.dispatchEvent(new Event(RESET_CAMERA_EVENT))}
							className="absolute top-2 right-11 p-1.5 rounded-full bg-black/50 text-white/80 hover:text-white backdrop-blur"
						>
							<Focus className="h-4 w-4" />
						</button>
					)}
					<button
						title={view2d ? 'Switch to 3D cube' : 'Switch to 2D net'}
						onClick={() => usePrefs.getState().set({ view2d: !view2d })}
						className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50 text-white/80 hover:text-white backdrop-blur"
					>
						{view2d ? <Box className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
					</button>
				</div>
				<aside
					className={cn(
						'w-full lg:w-72 shrink-0 flex flex-col gap-2 p-2 lg:p-0 min-h-0',
						zen && 'hidden',
					)}
				>
					{right}
					{below && <div className="lg:hidden">{below}</div>}
				</aside>
			</div>
			<Dialog open={keys} onClose={() => setKeys(false)} title="Keyboard shortcuts">
				<table className="text-sm">
					<tbody>
						{KEYS.map(([k, what]) => (
							<tr key={k}>
								<td className="pr-4 py-0.5">
									<kbd className="font-mono bg-muted px-1.5 py-0.5 rounded">{k}</kbd>
								</td>
								<td>{what}</td>
							</tr>
						))}
					</tbody>
				</table>
			</Dialog>
		</Shell>
	);
}
