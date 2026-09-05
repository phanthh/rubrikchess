import { RatingDiff } from '@/components/rating-diff';
import { Clock } from '@/components/round/clock';
import { useGameStore } from '@/store/game';
import { Color, User } from '@/types';
import { cn } from '@/utils/ui';
import { Link } from 'react-router-dom';

export function PlayerBar({
	color,
	player,
	ms,
}: {
	color: Color;
	player: User | null;
	ms: number | null;
}) {
	const turn = useGameStore((s) => s.turn);
	const status = useGameStore((s) => s.status);
	const myColor = useGameStore((s) => s.myColor);
	const diff = useGameStore((s) => s.diffs[color]);
	const online = useGameStore((s) => s.presence[color]);
	const initial = useGameStore((s) => s.clock?.initial_ms ?? 0);
	const over = status.kind !== 'playing';
	const toMove = turn === color && !over;

	return (
		<div
			className={cn(
				'flex items-center gap-2 px-2 py-1.5 rounded box',
				toMove && 'ring-1 ring-primary/50',
			)}
		>
			<span
				className={cn(
					'h-3 w-3 rounded-sm border shrink-0',
					color === 'white' ? 'bg-white border-neutral-400' : 'bg-neutral-900 border-neutral-600',
				)}
			/>
			<div className="min-w-0 flex-1 leading-tight">
				<div className="flex items-center gap-1.5 text-sm">
					{player ? (
						<Link to={`/u/${player.name}`} className="truncate text-foreground font-medium">
							{player.name}
						</Link>
					) : (
						<span className="text-muted-foreground">—</span>
					)}
					{player && <span className="text-brag text-xs">{Math.round(player.rating)}</span>}
					<RatingDiff diff={diff} />
					{myColor === color && <span className="text-xs text-muted-foreground">(you)</span>}
				</div>
				{!over && (
					<div className="text-[11px] text-muted-foreground flex items-center gap-1">
						<span
							className={cn('h-1.5 w-1.5 rounded-full', online ? 'bg-secondary' : 'bg-destructive')}
						/>
						{online ? (toMove ? 'thinking…' : 'online') : 'disconnected'}
					</div>
				)}
			</div>
			{ms !== null && <Clock ms={ms} running={toMove} initial={initial} over={over} />}
		</div>
	);
}
