import { RatingDiff } from '@/components/rating-diff';
import { variantLabel } from '@/store/game';
import { GameRow } from '@/types';
import { clockLabel, timeAgo } from '@/utils/clock';
import { cn, statusLabel } from '@/utils/ui';
import { Link } from 'react-router-dom';

/** One finished/ongoing game line; `perspective` colours the result for that user. */
export function GameRowItem({ g, perspective }: { g: GameRow; perspective?: string }) {
	const won = g.status.kind === 'won' ? g.status.winner : null;
	const mine = perspective ? (g.white.id === perspective ? 'white' : g.black.id === perspective ? 'black' : null) : null;
	const bar =
		g.status.kind === 'playing'
			? 'bg-primary'
			: mine && won
				? won === mine
					? 'bg-secondary'
					: 'bg-destructive'
				: 'bg-muted-foreground/40';
	return (
		<Link
			to={`/g/${g.id}`}
			className="flex items-stretch gap-3 px-3 py-2 hover:bg-accent/50 hover:no-underline text-foreground text-sm"
		>
			<span className={cn('w-1 rounded-full shrink-0', bar)} />
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-1.5 truncate">
					<span className={cn(won === 'white' && 'font-semibold')}>{g.white.name}</span>
					<span className="text-brag text-xs">{Math.round(g.white.rating)}</span>
					<RatingDiff diff={g.white_diff} />
					<span className="text-muted-foreground text-xs px-0.5">vs</span>
					<span className={cn(won === 'black' && 'font-semibold')}>{g.black.name}</span>
					<span className="text-brag text-xs">{Math.round(g.black.rating)}</span>
					<RatingDiff diff={g.black_diff} />
				</div>
				<div className="text-xs text-muted-foreground truncate">
					{clockLabel(g.clock)} · {variantLabel(false, g.layout)} · {statusLabel(g.status) ?? `in progress, ${g.plies} plies`} · {timeAgo(g.created_at)}
				</div>
			</div>
		</Link>
	);
}
