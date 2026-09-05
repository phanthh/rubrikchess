import { Shell } from '@/components/shell';
import { liveGames } from '@/net/api';
import { LiveGame } from '@/types';
import { clockLabel } from '@/utils/clock';
import { Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

/** Single-channel TV: jump to the most watched / highest rated live game. */
export function TvPage() {
	const navigate = useNavigate();
	const [live, setLive] = useState<LiveGame[] | null>(null);

	useEffect(() => {
		let stop = false;
		const poll = () =>
			liveGames()
				.then((games) => {
					if (stop) return;
					if (games.length > 0) navigate(`/g/${games[0].id}`, { replace: true });
					else setLive(games);
				})
				.catch(() => !stop && setLive([]));
		poll();
		const t = setInterval(poll, 5000);
		return () => {
			stop = true;
			clearInterval(t);
		};
	}, [navigate]);

	return (
		<Shell>
			<div className="box max-w-lg mx-auto">
				<div className="box-title">Rubrik TV</div>
				{live === null ? (
					<div className="p-4 text-sm text-muted-foreground">Looking for a game…</div>
				) : live.length === 0 ? (
					<div className="p-4 text-sm text-muted-foreground flex flex-col gap-3">
						<span>No games are being played right now. We’ll tune in as soon as one starts.</span>
						<Link to="/">Start one yourself →</Link>
					</div>
				) : (
					live.map((g) => (
						<Link key={g.id} to={`/g/${g.id}`} className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent/50">
							<span className="flex-1">
								{g.white.name} vs {g.black.name} · {clockLabel(g.clock)}
							</span>
							<Users className="h-3 w-3" /> {g.watchers}
						</Link>
					))
				)}
			</div>
		</Shell>
	);
}
