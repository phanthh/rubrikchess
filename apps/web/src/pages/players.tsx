import { Shell } from '@/components/shell';
import { leaderboard } from '@/net/api';
import { User } from '@/types';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

export function PlayersPage() {
	const [top, setTop] = useState<User[]>([]);
	useEffect(() => {
		leaderboard(100).then(setTop).catch(() => undefined);
	}, []);
	return (
		<Shell>
			<div className="box max-w-2xl mx-auto">
				<div className="box-title">Leaderboard</div>
				{top.length === 0 ? (
					<div className="p-4 text-sm text-muted-foreground">
						Nobody has an established rating yet. Registered players with a rating deviation under 200 appear here.
					</div>
				) : (
					<table className="w-full text-sm">
						<tbody>
							{top.map((u, i) => (
								<tr key={u.id} className="border-t border-border/40 first:border-0 [&>td]:px-3 [&>td]:py-2">
									<td className="w-10 text-muted-foreground">{i + 1}</td>
									<td>
										<Link to={`/u/${u.name}`} className="text-foreground font-medium">
											{u.name}
										</Link>
									</td>
									<td className="text-muted-foreground text-xs">{u.games} games</td>
									<td className="text-right text-brag font-medium">{Math.round(u.rating)}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>
		</Shell>
	);
}
