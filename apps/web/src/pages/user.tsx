import { GameRowItem } from '@/components/game-row';
import { RatingChart } from '@/components/rating-chart';
import { Shell } from '@/components/shell';
import { getUser } from '@/net/api';
import { GameRow, RatingPoint, User } from '@/types';
import { useEffect, useState } from 'react';
import { SetupDialog } from '@/components/setup-dialog';
import { Button } from '@/components/ui/button';
import { useNetStore } from '@/net/ws';
import { Swords } from 'lucide-react';
import { useParams } from 'react-router-dom';

export function UserPage() {
	const { name } = useParams();
	const [data, setData] = useState<{ user: User; games: GameRow[]; history?: RatingPoint[] } | null>(null);
	const [missing, setMissing] = useState(false);
	const [challenge, setChallenge] = useState(false);
	const me = useNetStore((s) => s.me);

	useEffect(() => {
		if (!name) return;
		setData(null);
		setMissing(false);
		getUser(name)
			.then(setData)
			.catch(() => setMissing(true));
	}, [name]);

	const u = data?.user;
	const losses = u ? u.games - (u.wins ?? 0) : 0;

	return (
		<Shell>
			{missing && <div className="text-muted-foreground">No such player.</div>}
			{!missing && !data && <div className="text-muted-foreground">Loading…</div>}
			{u && (
				<div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
					<div className="flex flex-col gap-4 min-w-0">
						<section className="box p-4 flex flex-wrap items-end gap-x-6 gap-y-2">
							<div>
								<h1 className="text-2xl font-bold leading-tight">{u.name}</h1>
								<div className="text-xs text-muted-foreground">
									{u.registered ? 'Registered player' : 'Anonymous player'}
								</div>
							</div>
							{me && me.id !== u.id && (
								<Button variant="secondary" size="sm" onClick={() => setChallenge(true)}>
									<Swords className="h-4 w-4 mr-1.5" /> Challenge
								</Button>
							)}
							<div className="ml-auto text-right">
								<div className="text-3xl font-bold text-brag leading-none">
									{Math.round(u.rating)}
									{u.rd >= 200 && <span className="text-base align-top">?</span>}
								</div>
								<div className="text-xs text-muted-foreground">± {Math.round(u.rd)} deviation</div>
							</div>
						</section>
						<section className="box">
							<div className="box-title">Rating history</div>
							<RatingChart points={data.history ?? []} />
						</section>
						<section className="box">
							<div className="box-title">Games ({data.games.length})</div>
							{data.games.length === 0 && <div className="p-4 text-sm text-muted-foreground">No games yet.</div>}
							{data.games.map((g) => (
								<GameRowItem key={g.id} g={g} perspective={u.id} />
							))}
						</section>
					</div>
					<aside className="box p-4 text-sm flex flex-col gap-2 self-start">
						<div className="flex justify-between">
							<span className="text-muted-foreground">Games</span>
							<b>{u.games}</b>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">Wins</span>
							<b className="text-secondary">{u.wins ?? 0}</b>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">Losses / draws</span>
							<b className="text-destructive">{losses}</b>
						</div>
						{u.games > 0 && (
							<div className="h-1.5 rounded bg-destructive/60 overflow-hidden mt-1">
								<div className="h-full bg-secondary" style={{ width: `${((u.wins ?? 0) / u.games) * 100}%` }} />
							</div>
						)}
					</aside>
				</div>
			)}
			{u && <SetupDialog key={u.name} mode={challenge ? 'friend' : null} onClose={() => setChallenge(false)} opponent={u.name} />}
		</Shell>
	);
}
