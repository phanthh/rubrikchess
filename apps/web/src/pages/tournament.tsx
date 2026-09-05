import { GameRowItem } from '@/components/game-row';
import { Shell } from '@/components/shell';
import { Button } from '@/components/ui/button';
import { getTournament } from '@/net/api';
import { onServerMsg, send, useNetStore } from '@/net/ws';
import { variantLabel } from '@/store/game';
import { GameRow, Standing, Tournament } from '@/types';
import { clockLabel, speedOf } from '@/utils/clock';
import { cn } from '@/utils/ui';
import { Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

function fmt(ms: number) {
	const s = Math.max(0, Math.floor(ms / 1000));
	const m = Math.floor(s / 60);
	return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Countdown to start / to end, driven by the tournament's server timestamps. */
export function TourClock({ t }: { t: Tournament }) {
	const [, tick] = useState(0);
	useEffect(() => {
		const i = setInterval(() => tick((n) => n + 1), 1000);
		return () => clearInterval(i);
	}, []);
	const now = Date.now();
	if (t.status === 'finished') return <span className="text-muted-foreground">finished</span>;
	if (now < t.starts_at) return <span>starts in {fmt(t.starts_at - now)}</span>;
	return <span className="text-secondary">{fmt(t.starts_at + t.duration_ms - now)} left</span>;
}

export function TournamentPage() {
	const { id } = useParams();
	const me = useNetStore((s) => s.me);
	const [data, setData] = useState<{ tournament: Tournament; standings: Standing[]; games: GameRow[]; joined: boolean } | null>(null);
	const [joined, setJoined] = useState(false);
	const [missing, setMissing] = useState(false);

	useEffect(() => {
		if (!id) return;
		const load = () =>
			getTournament(id)
				.then((d) => {
					setData(d);
					setJoined(d.joined);
				})
				.catch(() => setMissing(true));
		load();
		const i = setInterval(load, 5000);
		const unsub = onServerMsg((msg) => {
			if (msg.t !== 'tour' || msg.tournament.id !== id) return;
			load();
		});
		return () => {
			clearInterval(i);
			unsub();
		};
	}, [id]);

	const t = data?.tournament;
	const mine = data?.standings.find((s) => s.user.id === me?.id);

	return (
		<Shell>
			{missing && <div className="text-muted-foreground">No such tournament.</div>}
			{t && (
				<div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
					<div className="flex flex-col gap-4 min-w-0">
						<section className="box p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
							<Trophy className="h-8 w-8 text-brag" />
							<div className="mr-auto">
								<h1 className="text-xl font-bold leading-tight">{t.name}</h1>
								<div className="text-xs text-muted-foreground">
									{clockLabel(t.clock)} {speedOf(t.clock)} · {variantLabel(t.walled, t.layout)} · {t.duration_ms / 60000} min arena · by{' '}
									<Link to={`/u/${t.created_by.name}`}>{t.created_by.name}</Link>
								</div>
							</div>
							<div className="text-sm font-semibold">
								<TourClock t={t} />
							</div>
							{t.status !== 'finished' && (
								<Button
									variant={joined ? 'outline' : 'secondary'}
									onClick={() => id && send({ t: joined ? 'tour_leave' : 'tour_join', id })}
								>
									{joined ? 'Leave' : 'Join'}
								</Button>
							)}
						</section>
						{joined && t.status === 'created' && (
							<div className="box p-3 text-sm text-muted-foreground">You are in. Stay on this site — your games will open automatically once it starts.</div>
						)}
						{joined && t.status === 'running' && !mine?.playing && (
							<div className="box p-3 text-sm flex items-center gap-2">
								<span className="h-2 w-2 rounded-full bg-primary animate-pulse" /> Waiting for an opponent…
							</div>
						)}
						<section className="box">
							<div className="box-title">Standings ({data.standings.length})</div>
							{data.standings.length === 0 && <div className="p-4 text-sm text-muted-foreground">Nobody has joined yet.</div>}
							<table className="w-full text-sm">
								<tbody>
									{data.standings.map((s, i) => (
										<tr key={s.user.id} className={cn('border-t border-border/40 [&>td]:px-3 [&>td]:py-1.5', s.user.id === me?.id && 'bg-primary/10')}>
											<td className="w-8 text-muted-foreground">
												{t.status === 'finished' && i === 0 ? <Trophy className="h-4 w-4 text-brag" /> : i + 1}
											</td>
											<td>
												<Link to={`/u/${s.user.name}`} className="text-foreground font-medium">
													{s.user.name}
												</Link>{' '}
												<span className="text-brag text-xs">{Math.round(s.user.rating)}</span>
												{s.playing && <span className="ml-2 text-[10px] uppercase text-primary">playing</span>}
											</td>
											<td className="text-xs text-muted-foreground text-right">
												{s.wins}W / {s.games}G
											</td>
											<td className="w-12 text-right font-bold">{s.score}</td>
										</tr>
									))}
								</tbody>
							</table>
						</section>
					</div>
					<section className="box self-start">
						<div className="box-title">Games</div>
						{data.games.length === 0 && <div className="p-4 text-sm text-muted-foreground">No games yet.</div>}
						{data.games.map((g) => (
							<GameRowItem key={g.id} g={g} perspective={me?.id} />
						))}
					</section>
				</div>
			)}
		</Shell>
	);
}
