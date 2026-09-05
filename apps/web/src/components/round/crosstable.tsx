import { crosstable } from '@/net/api';
import { Crosstable as TCrosstable, User } from '@/types';
import { cn } from '@/utils/ui';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const half = (n: number) => (Number.isInteger(n) ? String(n) : `${Math.floor(n)}½`.replace(/^0½$/, '½'));

/** Head-to-head score between the two players, with a strip of recent results (white's view). */
export function Crosstable({ white, black, gameId }: { white: User; black: User; gameId: string }) {
	const [data, setData] = useState<TCrosstable | null>(null);
	useEffect(() => {
		crosstable(white.id, black.id).then(setData).catch(() => undefined);
	}, [white.id, black.id, gameId]);
	if (!data || data.games === 0) return null;
	return (
		<div className="box p-3 text-sm flex flex-col gap-2">
			<div className="flex items-center justify-between">
				<span className="text-xs text-muted-foreground uppercase tracking-wider">Head to head</span>
				<span className="text-xs text-muted-foreground">{data.games} games</span>
			</div>
			<div className="flex items-center justify-between font-semibold">
				<span className="truncate">{white.name}</span>
				<span className="font-mono tabular-nums px-2">
					{half(data.a_score)} – {half(data.b_score)}
				</span>
				<span className="truncate text-right">{black.name}</span>
			</div>
			<div className="flex gap-1 justify-center">
				{data.recent.map((r) => (
					<Link
						key={r.id}
						to={`/g/${r.id}`}
						title={r.winner === 'a' ? `${white.name} won` : r.winner === 'b' ? `${black.name} won` : 'draw'}
						className={cn(
							'h-2.5 w-2.5 rounded-sm',
							r.winner === 'a' ? 'bg-secondary' : r.winner === 'b' ? 'bg-destructive' : 'bg-muted-foreground/50',
							r.id === gameId && 'ring-1 ring-foreground',
						)}
					/>
				))}
			</div>
		</div>
	);
}
