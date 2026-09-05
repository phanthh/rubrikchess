import { GameRowItem } from '@/components/game-row';
import { SetupDialog, SetupMode } from '@/components/setup-dialog';
import { Shell } from '@/components/shell';
import { Button } from '@/components/ui/button';
import { leaderboard, listGames, liveGames } from '@/net/api';
import { send, useNetStore } from '@/net/ws';
import { variantLabel } from '@/utils/variant';
import { GameRow, LiveGame, Seek, Tournament, User } from '@/types';
import { TourList } from './tournaments';
import { bot, Friend, friends, listTournaments } from '@/net/api';
import { onServerMsg } from '@/net/ws';
import { clockLabel, perfOf, speedOf } from '@/utils/clock';
import { requestNotifyPermission } from '@/utils/notify';
import { cn } from '@/utils/ui';
import { Loader2, Users } from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const POOLS: [minutes: number, inc: number][] = [
	[1, 0],
	[2, 1],
	[3, 0],
	[3, 2],
	[5, 0],
	[5, 3],
	[10, 0],
	[10, 5],
	[15, 10],
	[30, 0],
	[30, 20],
];

function Box({
	title,
	children,
	action,
}: {
	title: string;
	children: ReactNode;
	action?: ReactNode;
}) {
	return (
		<section className="box flex flex-col overflow-hidden">
			<div className="box-title flex items-center">
				<span className="mr-auto">{title}</span>
				{action}
			</div>
			{children}
		</section>
	);
}

const Empty = ({ children }: { children: ReactNode }) => (
	<div className="px-3 py-4 text-sm text-muted-foreground text-center">{children}</div>
);

export function LobbyPage() {
	const me = useNetStore((s) => s.me);
	const seeks = useNetStore((s) => s.seeks);
	const [games, setGames] = useState<GameRow[]>([]);
	const [live, setLive] = useState<LiveGame[]>([]);
	const [top, setTop] = useState<User[]>([]);
	const [setup, setSetup] = useState<SetupMode | null>(null);
	const [challengeTo, setChallengeTo] = useState<string | null>(null);
	const [tours, setTours] = useState<Tournament[]>([]);
	const [pals, setPals] = useState<Friend[]>([]);
	const [botUser, setBotUser] = useState<User | null>(null);

	useEffect(() => {
		const refresh = () => {
			listGames(12)
				.then(setGames)
				.catch(() => undefined);
			if (me)
				friends()
					.then(setPals)
					.catch(() => undefined);
			liveGames()
				.then(setLive)
				.catch(() => undefined);
		};
		refresh();
		leaderboard(10)
			.then(setTop)
			.catch(() => undefined);
		const loadTours = () =>
			listTournaments()
				.then((d) => setTours([...d.running, ...d.upcoming]))
				.catch(() => undefined);
		loadTours();
		bot()
			.then(setBotUser)
			.catch(() => undefined);
		let debounce = 0;
		const unsub = onServerMsg((m) => {
			if (m.t !== 'tour') return;
			clearTimeout(debounce);
			debounce = window.setTimeout(loadTours, 800);
		});
		const t = setInterval(refresh, 10_000);
		return () => {
			clearInterval(t);
			clearTimeout(debounce);
			unsub();
		};
	}, [me]);

	const mySeek = seeks.find((s) => s.user.id === me?.id);
	const isPool = (s: Seek | undefined, m: number, i: number) =>
		!!s &&
		s.clock.initial_ms === m * 60_000 &&
		s.clock.increment_ms === i * 1000 &&
		!s.walled &&
		(s.layout ?? 'standard') === 'standard' &&
		(s.color ?? 'random') === 'random';
	const myPool = POOLS.find(([m, i]) => isPool(mySeek, m, i));

	const mine = live.filter((g) => g.white.id === me?.id || g.black.id === me?.id);

	return (
		<Shell>
			<div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
				<div className="flex flex-col gap-4 min-w-0">
					{mine.map((g) => (
						<Link
							key={g.id}
							to={`/g/${g.id}`}
							className="box flex items-center gap-3 px-4 py-3 border-primary/50 bg-primary/10 text-foreground hover:no-underline hover:bg-primary/20"
						>
							<span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
							<span className="flex-1 text-sm">
								Game in progress against <b>{(g.white.id === me?.id ? g.black : g.white).name}</b> ·{' '}
								{clockLabel(g.clock)} · ply {g.plies}
							</span>
							<span className="text-sm font-semibold text-primary">Resume →</span>
						</Link>
					))}
					<Box title="Quick pairing">
						<div className="grid grid-cols-3 sm:grid-cols-4 gap-2 p-3">
							{POOLS.map(([m, i]) => {
								const active = myPool?.[0] === m && myPool?.[1] === i;
								const clock = { initial_ms: m * 60_000, increment_ms: i * 1000 };
								return (
									<button
										key={`${m}+${i}`}
										onClick={() => {
											requestNotifyPermission();
											if (active) send({ t: 'unseek' });
											else send({ t: 'seek', clock, walled: false, color: 'random' });
										}}
										className={cn(
											'relative flex flex-col items-center justify-center h-20 rounded-md border border-border bg-background/40 hover:bg-accent hover:border-primary/40 transition-colors',
											mySeek && !active && 'opacity-40',
											active && 'border-primary bg-primary/10',
										)}
									>
										{active ? (
											<>
												<Loader2 className="h-6 w-6 animate-spin text-primary" />
												<span className="text-[11px] text-muted-foreground mt-1">
													Waiting… click to cancel
												</span>
											</>
										) : (
											<>
												<span className="text-2xl font-semibold font-mono leading-none">
													{clockLabel(clock)}
												</span>
												<span className="text-[11px] text-muted-foreground mt-1.5">
													{speedOf(clock)}
												</span>
											</>
										)}
									</button>
								);
							})}
							<button
								onClick={() => setSetup('seek')}
								className="flex flex-col items-center justify-center h-20 rounded-md border border-dashed border-border hover:bg-accent hover:border-primary/40"
							>
								<span className="text-lg font-semibold">Custom</span>
								<span className="text-[11px] text-muted-foreground">time · variant · colour</span>
							</button>
						</div>
					</Box>

					<div className="flex flex-wrap gap-2">
						<Button
							variant="secondary"
							size="lg"
							className="flex-1"
							onClick={() => setSetup('seek')}
						>
							Create a game
						</Button>
						<Button
							variant="outline"
							size="lg"
							className="flex-1"
							onClick={() => setSetup('friend')}
						>
							Play with a friend
						</Button>
						<Button variant="outline" size="lg" className="flex-1" asChild>
							<Link to="/local?ai=3" className="text-foreground hover:no-underline">
								Play with the computer
							</Link>
						</Button>
						{botUser && (
							<Button
								variant="outline"
								size="lg"
								className="flex-1"
								title="A rated online game against the server bot"
								onClick={() => setChallengeTo(botUser.name)}
							>
								Play the bot{' '}
								<span className="text-brag text-xs ml-1.5">{Math.round(botUser.rating)}</span>
							</Button>
						)}
					</div>

					<Box title={`Open seeks (${seeks.length})`}>
						{seeks.length === 0 ? (
							<Empty>Nobody is waiting. Pick a time control above and someone will find you.</Empty>
						) : (
							<table className="w-full text-sm">
								<thead className="text-xs text-muted-foreground">
									<tr className="[&>th]:px-3 [&>th]:py-1.5 [&>th]:font-normal [&>th]:text-left">
										<th>Player</th>
										<th>Rating</th>
										<th>Time</th>
										<th>Mode</th>
										<th />
									</tr>
								</thead>
								<tbody>
									{seeks.map((seek) => {
										const own = seek.user.id === me?.id;
										return (
											<tr
												key={seek.id}
												onClick={() =>
													own ? send({ t: 'unseek' }) : send({ t: 'accept', seek_id: seek.id })
												}
												className={cn(
													'cursor-pointer border-t border-border/40 hover:bg-accent/60 [&>td]:px-3 [&>td]:py-2',
													own && 'bg-primary/10',
												)}
											>
												<td className="font-medium">{seek.user.name}</td>
												<td className="text-brag" title={`${speedOf(seek.clock)} rating`}>
													{Math.round(
														seek.user.perfs?.[perfOf(seek.clock)]?.rating ?? seek.user.rating,
													)}
												</td>
												<td className="font-mono">
													{clockLabel(seek.clock)}{' '}
													<span className="text-xs text-muted-foreground font-sans">
														{speedOf(seek.clock)}
													</span>
												</td>
												<td className="text-muted-foreground capitalize">
													{variantLabel(seek.walled, seek.layout)}
													{seek.color && seek.color !== 'random' ? ` · plays ${seek.color}` : ''}
												</td>
												<td className="text-right text-xs text-muted-foreground">
													{own ? 'cancel' : 'join'}
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						)}
					</Box>

					<Box
						title="Recent games"
						action={
							<Link to="/games" className="text-xs normal-case tracking-normal font-normal">
								All
							</Link>
						}
					>
						{games.length === 0 ? (
							<Empty>No games yet.</Empty>
						) : (
							games.map((g) => <GameRowItem key={g.id} g={g} />)
						)}
					</Box>
				</div>

				<div className="flex flex-col gap-4 min-w-0">
					<Box
						title="Live games"
						action={
							live.length > 0 && (
								<Link to="/tv" className="text-xs normal-case tracking-normal font-normal">
									Watch TV
								</Link>
							)
						}
					>
						{live.length === 0 ? (
							<Empty>No games in progress.</Empty>
						) : (
							live.slice(0, 8).map((g) => (
								<Link
									key={g.id}
									to={`/g/${g.id}`}
									className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent/50 hover:no-underline"
								>
									<div className="min-w-0 flex-1">
										<div className="truncate">
											{g.white.name}{' '}
											<span className="text-brag text-xs">{Math.round(g.white.rating)}</span>
											<span className="text-muted-foreground text-xs px-1">vs</span>
											{g.black.name}{' '}
											<span className="text-brag text-xs">{Math.round(g.black.rating)}</span>
										</div>
										<div className="text-xs text-muted-foreground">
											{clockLabel(g.clock)} · {variantLabel(g.walled ?? false, g.layout)} · ply{' '}
											{g.plies}
										</div>
									</div>
									<span className="flex items-center gap-1 text-xs text-muted-foreground">
										<Users className="h-3 w-3" />
										{g.watchers}
									</span>
								</Link>
							))
						)}
					</Box>

					{pals.length > 0 && (
						<Box title="Friends">
							{pals.map((f) => (
								<div key={f.user.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
									<span
										className={cn(
											'h-1.5 w-1.5 rounded-full',
											f.online ? 'bg-secondary' : 'bg-muted-foreground/40',
										)}
									/>
									<Link to={`/u/${f.user.name}`} className="text-foreground truncate flex-1">
										{f.user.name}
									</Link>
									<span className="text-brag text-xs">{Math.round(f.user.rating)}</span>
									{f.playing ? (
										<Link to={`/g/${f.playing}`} className="text-xs">
											watch
										</Link>
									) : (
										f.online && (
											<button
												className="text-xs text-primary hover:underline"
												onClick={() => setChallengeTo(f.user.name)}
											>
												challenge
											</button>
										)
									)}
								</div>
							))}
						</Box>
					)}

					<Box
						title="Tournaments"
						action={
							<Link to="/tournaments" className="text-xs normal-case tracking-normal font-normal">
								All
							</Link>
						}
					>
						<TourList items={tours.slice(0, 5)} empty="No arena scheduled." />
					</Box>

					<Box
						title="Leaderboard"
						action={
							<Link to="/players" className="text-xs normal-case tracking-normal font-normal">
								All
							</Link>
						}
					>
						{top.length === 0 ? (
							<Empty>No rated registered players yet. Register and play a game.</Empty>
						) : (
							<ol className="text-sm">
								{top.map((u, i) => (
									<li
										key={u.id}
										className="flex items-center gap-2 px-3 py-1.5 border-t border-border/40 first:border-0"
									>
										<span className="w-5 text-xs text-muted-foreground">{i + 1}</span>
										<Link to={`/u/${u.name}`} className="flex-1 truncate text-foreground">
											{u.name}
										</Link>
										<span className="text-brag font-medium">
											{Math.round(u.rating)}
											{u.rd >= 200 && (
												<span className="text-muted-foreground" title="provisional">
													?
												</span>
											)}
										</span>
									</li>
								))}
							</ol>
						)}
					</Box>
				</div>
			</div>
			<SetupDialog mode={setup} onClose={() => setSetup(null)} />
			<SetupDialog
				key={challengeTo ?? ''}
				mode={challengeTo ? 'friend' : null}
				onClose={() => setChallengeTo(null)}
				opponent={challengeTo ?? undefined}
			/>
		</Shell>
	);
}
