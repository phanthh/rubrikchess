import { Shell } from '@/components/shell';
import { leaderboard } from '@/net/api';
import { User } from '@/types';
import { PERFS } from '@/utils/clock';
import { cn } from '@/utils/ui';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

export function PlayersPage() {
	const [top, setTop] = useState<User[]>([]);
	const [perf, setPerf] = useState<string>('');
	const [q, setQ] = useState('');
	const navigate = useNavigate();
	useEffect(() => {
		leaderboard(100)
			.then(setTop)
			.catch(() => undefined);
	}, []);
	return (
		<Shell>
			<form
				className="max-w-2xl mx-auto mb-4 flex gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					if (q.trim()) navigate(`/u/${encodeURIComponent(q.trim())}`);
				}}
			>
				<input
					className="field flex-1"
					placeholder="Find a player by name"
					value={q}
					onChange={(e) => setQ(e.target.value)}
				/>
				<button className="field px-3 hover:bg-accent" type="submit">
					Go
				</button>
			</form>
			<div className="box max-w-2xl mx-auto">
				<div className="box-title flex items-center gap-1 flex-wrap">
					<span className="mr-auto">Leaderboard</span>
					{['', ...PERFS].map((p) => (
						<button
							key={p}
							onClick={() => setPerf(p)}
							className={cn(
								'px-2 py-0.5 rounded normal-case tracking-normal font-normal capitalize hover:bg-accent',
								perf === p && 'bg-accent text-foreground',
							)}
						>
							{p || 'Overall'}
						</button>
					))}
				</div>
				{top.length === 0 ? (
					<div className="p-4 text-sm text-muted-foreground">
						Nobody has played a rated game as a registered player yet. A ? marks a provisional
						rating.
					</div>
				) : (
					<table className="w-full text-sm">
						<tbody>
							{top.map((u, i) => (
								<tr
									key={u.id}
									className="border-t border-border/40 first:border-0 [&>td]:px-3 [&>td]:py-2"
								>
									<td className="w-10 text-muted-foreground">{i + 1}</td>
									<td>
										<Link to={`/u/${u.name}`} className="text-foreground font-medium">
											{u.name}
										</Link>
									</td>
									<td className="text-muted-foreground text-xs">{u.games} games</td>
									<td className="text-right text-brag font-medium">
										{Math.round(perf ? (u.perfs?.[perf]?.rating ?? u.rating) : u.rating)}
										{(perf ? (u.perfs?.[perf]?.rd ?? u.rd) : u.rd) >= 200 && (
											<span className="text-muted-foreground" title="provisional">
												?
											</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>
		</Shell>
	);
}
