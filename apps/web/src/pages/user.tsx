import { RatingDiff } from '@/components/rating-diff';
import { getUser } from '@/net/api';
import { GameRow, User } from '@/types';
import { statusLabel } from '@/utils/ui';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

export function UserPage() {
	const { name } = useParams();
	const [data, setData] = useState<{ user: User; games: GameRow[] } | null>(null);
	const [missing, setMissing] = useState(false);

	useEffect(() => {
		if (!name) return;
		setData(null);
		setMissing(false);
		getUser(name)
			.then(setData)
			.catch(() => setMissing(true));
	}, [name]);

	return (
		<div className="min-h-screen bg-background text-foreground p-6 flex flex-col gap-6">
			<nav className="flex items-center gap-3">
				<Link to="/" className="underline">
					Lobby
				</Link>
			</nav>

			{missing && <span className="text-muted-foreground">no such user</span>}
			{!missing && !data && <span className="text-muted-foreground">loading…</span>}

			{data && (
				<>
					<section className="flex flex-wrap items-center gap-4 p-4 rounded border">
						<h1 className="text-2xl font-bold">{data.user.name}</h1>
						<span>
							{Math.round(data.user.rating)}{' '}
							<span className="text-muted-foreground">± {Math.round(data.user.rd)}</span>
						</span>
						<span className="text-muted-foreground">{data.user.games} games</span>
						{!data.user.registered && <span className="text-muted-foreground">(anonymous)</span>}
					</section>

					<section className="flex flex-col gap-2">
						<h2 className="text-lg font-semibold">Games</h2>
						{data.games.length === 0 && <span className="text-muted-foreground">no games</span>}
						{data.games.map((g) => (
							<Link
								key={g.id}
								to={`/g/${g.id}`}
								className="flex items-center gap-3 p-2 rounded border"
							>
								<span className="font-mono">{g.id}</span>
								<span className="flex items-center gap-1">
									{g.white.name} ({Math.round(g.white.rating)}
									<RatingDiff diff={g.white_diff} />) vs {g.black.name} (
									{Math.round(g.black.rating)}
									<RatingDiff diff={g.black_diff} />)
								</span>
								<span className="ml-auto text-muted-foreground">
									{statusLabel(g.status) ?? `${g.plies} plies`}
								</span>
							</Link>
						))}
					</section>
				</>
			)}
		</div>
	);
}
