import { MiniBoard } from '@/components/mini-board';
import { Shell } from '@/components/shell';
import { Button } from '@/components/ui/button';
import { GameDetail, getGame, liveGames } from '@/net/api';
import { LiveGame } from '@/types';
import { clockLabel } from '@/utils/clock';
import { variantLabel } from '@/utils/variant';
import { Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

/** Current games with live thumbnails; "Watch TV" jumps to the featured one. */
export function TvPage() {
	const [live, setLive] = useState<LiveGame[] | null>(null);
	const [boards, setBoards] = useState<Record<string, GameDetail>>({});

	useEffect(() => {
		let stop = false;
		const poll = async () => {
			const games = await liveGames().catch(() => [] as LiveGame[]);
			if (stop) return;
			setLive(games);
			const details = await Promise.all(
				games.slice(0, 12).map((g) => getGame(g.id).catch(() => null)),
			);
			if (stop) return;
			setBoards(
				Object.fromEntries(details.filter((d): d is GameDetail => !!d).map((d) => [d.id, d])),
			);
		};
		void poll();
		const t = setInterval(poll, 5000);
		return () => {
			stop = true;
			clearInterval(t);
		};
	}, []);

	return (
		<Shell>
			<div className="flex items-center mb-4">
				<h1 className="text-xl font-bold mr-auto">Current games</h1>
				{live && live.length > 0 && (
					<Button variant="secondary" asChild>
						<Link to={`/g/${live[0].id}`} className="hover:no-underline">
							Watch TV
						</Link>
					</Button>
				)}
			</div>
			{live === null && <div className="text-sm text-muted-foreground">Loading…</div>}
			{live && live.length === 0 && (
				<div className="box p-6 text-sm text-muted-foreground flex flex-col gap-2 items-start">
					<span>No games are being played right now.</span>
					<Link to="/">Start one yourself →</Link>
				</div>
			)}
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{live?.map((g) => {
					const d = boards[g.id];
					const turn = g.plies % 2 === 0 ? 'white' : 'black';
					return (
						<Link
							key={g.id}
							to={`/g/${g.id}`}
							className="box overflow-hidden hover:border-primary/50 hover:no-underline text-foreground"
						>
							<div className="bg-[#101010] p-2 aspect-[4/3] flex items-center justify-center">
								{d ? (
									<MiniBoard config={d.config} moves={d.moves} className="max-h-full" />
								) : (
									<span className="text-xs text-muted-foreground">…</span>
								)}
							</div>
							<div className="px-3 py-2 text-sm">
								<div className="flex items-center gap-1.5 truncate">
									<span className={turn === 'white' ? 'font-semibold' : ''}>{g.white.name}</span>
									<span className="text-brag text-xs">{Math.round(g.white.rating)}</span>
									<span className="text-muted-foreground text-xs">vs</span>
									<span className={turn === 'black' ? 'font-semibold' : ''}>{g.black.name}</span>
									<span className="text-brag text-xs">{Math.round(g.black.rating)}</span>
								</div>
								<div className="flex items-center text-xs text-muted-foreground">
									<span className="mr-auto">
										{clockLabel(g.clock)} · {variantLabel(g.walled ?? false, g.layout)} · ply{' '}
										{g.plies}
									</span>
									<Users className="h-3 w-3 mr-1" />
									{g.watchers}
								</div>
							</div>
						</Link>
					);
				})}
			</div>
		</Shell>
	);
}
