import { RatingDiff } from '@/components/rating-diff';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { leaderboard, listGames, login, logout, register, setName } from '@/net/api';
import { connect, onServerMsg, reconnect, send, useNetStore } from '@/net/ws';
import { GameRow, User } from '@/types';
import { statusLabel } from '@/utils/ui';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

export function LobbyPage() {
	const navigate = useNavigate();
	const { me, seeks, connected } = useNetStore();
	const [name, setNameInput] = useState('');
	const [minutes, setMinutes] = useState(5);
	const [increment, setIncrement] = useState(3);
	const [walled, setWalled] = useState(false);
	const [games, setGames] = useState<GameRow[]>([]);
	const [top, setTop] = useState<User[]>([]);
	const [authMode, setAuthMode] = useState<'register' | 'login' | null>(null);
	const [authName, setAuthName] = useState('');
	const [authPassword, setAuthPassword] = useState('');

	useEffect(() => {
		connect();
		listGames()
			.then(setGames)
			.catch(() => undefined);
		leaderboard()
			.then(setTop)
			.catch(() => undefined);
		return onServerMsg((msg) => {
			if (msg.t === 'game_start') navigate(`/g/${msg.game_id}`);
		});
	}, [navigate]);

	useEffect(() => {
		if (me) setNameInput(me.name);
	}, [me]);

	const mySeek = seeks.find((s) => s.user.id === me?.id);

	const rename = async () => {
		try {
			useNetStore.setState({ me: await setName(name) });
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		}
	};

	// The server session changes on register/login/logout, so the socket must be redialled.
	const auth = async (run: () => Promise<User>) => {
		try {
			useNetStore.setState({ me: await run() });
			setAuthMode(null);
			setAuthName('');
			setAuthPassword('');
			reconnect();
			leaderboard()
				.then(setTop)
				.catch(() => undefined);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		}
	};

	return (
		<div className="min-h-screen bg-background text-foreground p-6 flex flex-col gap-6">
			<header className="flex items-center gap-3 flex-wrap">
				<h1 className="text-2xl font-bold mr-auto">Rubrik Chess</h1>
				{me && (
					<span>
						{me.registered ? (
							<Link to={`/u/${me.name}`} className="hover:underline">
								{me.name}
							</Link>
						) : (
							me.name
						)}{' '}
						<span className="text-muted-foreground">({Math.round(me.rating)})</span>
					</span>
				)}
				{me?.registered ? (
					<Button variant="outline" onClick={() => auth(logout)}>
						Logout
					</Button>
				) : (
					<>
						<input
							className="rounded border bg-background px-2 py-1"
							value={name}
							onChange={(e) => setNameInput(e.target.value)}
							placeholder="name"
						/>
						<Button variant="outline" onClick={rename} disabled={!name || name === me?.name}>
							Rename
						</Button>
						<Button
							variant="outline"
							onClick={() => setAuthMode(authMode === 'register' ? null : 'register')}
						>
							Register
						</Button>
						<Button
							variant="outline"
							onClick={() => setAuthMode(authMode === 'login' ? null : 'login')}
						>
							Login
						</Button>
					</>
				)}
				<Link to="/local" className="underline">
					Play locally
				</Link>
				<span className="text-muted-foreground">{connected ? 'online' : 'offline'}</span>
			</header>

			{authMode && (
				<form
					className="flex flex-wrap items-center gap-3 p-3 rounded border"
					onSubmit={(e) => {
						e.preventDefault();
						auth(() =>
							authMode === 'register'
								? register(authName, authPassword)
								: login(authName, authPassword),
						);
					}}
				>
					<span className="font-semibold">{authMode === 'register' ? 'Register' : 'Login'}</span>
					<input
						className="rounded border bg-background px-2 py-1"
						value={authName}
						onChange={(e) => setAuthName(e.target.value)}
						placeholder="name"
						autoComplete="username"
					/>
					<input
						className="rounded border bg-background px-2 py-1"
						type="password"
						value={authPassword}
						onChange={(e) => setAuthPassword(e.target.value)}
						placeholder="password"
						autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
					/>
					<Button type="submit" disabled={!authName || !authPassword}>
						{authMode === 'register' ? 'Create account' : 'Log in'}
					</Button>
					<Button type="button" variant="outline" onClick={() => setAuthMode(null)}>
						Cancel
					</Button>
				</form>
			)}

			<section className="flex flex-wrap items-center gap-3 p-3 rounded border">
				<label className="flex items-center gap-2">
					Minutes
					<input
						type="number"
						min={0}
						className="w-16 rounded border bg-background px-2 py-1"
						value={minutes}
						onChange={(e) => setMinutes(Number(e.target.value))}
					/>
				</label>
				<label className="flex items-center gap-2">
					Increment (s)
					<input
						type="number"
						min={0}
						className="w-16 rounded border bg-background px-2 py-1"
						value={increment}
						onChange={(e) => setIncrement(Number(e.target.value))}
					/>
				</label>
				<label className="flex items-center gap-2">
					Walled
					<Switch checked={walled} onCheckedChange={setWalled} />
				</label>
				<Button
					onClick={() =>
						send({
							t: 'seek',
							clock: { initial_ms: minutes * 60_000, increment_ms: increment * 1000 },
							walled,
						})
					}
				>
					Create seek
				</Button>
				{mySeek && (
					<Button variant="destructive" onClick={() => send({ t: 'unseek' })}>
						Cancel my seek
					</Button>
				)}
			</section>

			<section className="flex flex-col gap-2">
				<h2 className="text-lg font-semibold">Open seeks</h2>
				{seeks.length === 0 && <span className="text-muted-foreground">no seeks</span>}
				{seeks.map((seek) => (
					<div key={seek.id} className="flex items-center gap-3 p-2 rounded border">
						<span className="font-medium">
							{seek.user.name}{' '}
							<span className="text-muted-foreground">({Math.round(seek.user.rating)})</span>
						</span>
						<span className="text-muted-foreground">
							{Math.round(seek.clock.initial_ms / 60000)}+{Math.round(seek.clock.increment_ms / 1000)}
							{seek.walled ? ' · walled' : ''}
						</span>
						{seek.user.id !== me?.id && (
							<Button
								className="ml-auto"
								variant="outline"
								onClick={() => send({ t: 'accept', seek_id: seek.id })}
							>
								Accept
							</Button>
						)}
					</div>
				))}
			</section>

			<section className="flex flex-col gap-2">
				<h2 className="text-lg font-semibold">Leaderboard</h2>
				{top.length === 0 && <span className="text-muted-foreground">no rated players yet</span>}
				{top.map((user, i) => (
					<div key={user.id} className="flex items-center gap-3 p-2 rounded border">
						<span className="text-muted-foreground w-6">{i + 1}</span>
						<Link to={`/u/${user.name}`} className="underline">
							{user.name}
						</Link>
						<span className="ml-auto">{Math.round(user.rating)}</span>
					</div>
				))}
			</section>

			<section className="flex flex-col gap-2">
				<h2 className="text-lg font-semibold">Recent games</h2>
				{games.map((g) => (
					<Link key={g.id} to={`/g/${g.id}`} className="flex items-center gap-3 p-2 rounded border">
						<span className="font-mono">{g.id}</span>
						<span className="flex items-center gap-1">
							{g.white.name} ({Math.round(g.white.rating)}
							<RatingDiff diff={g.white_diff} />) vs {g.black.name} ({Math.round(g.black.rating)}
							<RatingDiff diff={g.black_diff} />)
						</span>
						<span className="ml-auto text-muted-foreground">
							{statusLabel(g.status) ?? `${g.plies} plies`}
						</span>
					</Link>
				))}
			</section>
		</div>
	);
}
