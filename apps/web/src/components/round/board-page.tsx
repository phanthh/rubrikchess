import { GameCanvas } from '@/components/game-canvas';
import { Shell } from '@/components/shell';
import { useGameStore } from '@/store/game';
import { cn } from '@/utils/ui';
import { ReactNode } from 'react';

/**
 * Three-column round layout: optional left meta column, board, right table.
 * Below `lg` it stacks and scrolls. Zen (key `z`) hides both columns.
 */
export function BoardPage({ banner, left, right, below }: { banner: ReactNode; left?: ReactNode; right: ReactNode; below?: ReactNode }) {
	const zen = useGameStore((s) => s.zen);
	const cursor = useGameStore((s) => s.cursor);
	const plies = useGameStore((s) => s.history.length);
	return (
		<Shell fill>
			<div className="h-full flex flex-col lg:flex-row lg:gap-3 lg:p-3 overflow-y-auto lg:overflow-hidden">
				{left && !zen && <aside className="hidden lg:flex w-64 shrink-0 flex-col gap-3 min-h-0">{left}</aside>}
				<div className="relative flex-1 min-h-[55vh] shrink-0 lg:shrink lg:min-h-0 lg:rounded-md overflow-hidden">
					<GameCanvas />
					<div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/50 text-xs text-white/90 backdrop-blur whitespace-nowrap">
						{banner}
						{cursor !== plies && ` · viewing move ${cursor}/${plies}`}
					</div>
				</div>
				<aside className={cn('w-full lg:w-72 shrink-0 flex flex-col gap-2 p-2 lg:p-0 min-h-0', zen && 'hidden')}>
					{right}
					{below && <div className="lg:hidden">{below}</div>}
				</aside>
			</div>
		</Shell>
	);
}
