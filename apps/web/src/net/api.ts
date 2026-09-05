import {
	Challenge,
	ClockSpec,
	Crosstable,
	Layout,
	Standing,
	Tournament,
	GameConfig,
	GameRow,
	LiveGame,
	Move,
	RatingPoint,
	Status,
	User,
} from '@/types';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`/api${path}`, {
		headers: { 'content-type': 'application/json' },
		...init,
	});
	if (!res.ok) {
		// server errors carry a message; fall back to the status line
		const body = await res.text();
		let msg = body;
		try {
			const parsed = JSON.parse(body) as { error?: string; msg?: string };
			msg = parsed.error ?? parsed.msg ?? body;
		} catch {
			/* not json */
		}
		throw new Error(msg || `${init?.method ?? 'GET'} ${path}: ${res.status}`);
	}
	return res.json() as Promise<T>;
}

const post = <T>(path: string, body: unknown) =>
	req<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const getMe = () => req<User>('/me');

export const setName = (name: string) => post<User>('/me', { name });

export const register = (name: string, password: string) =>
	post<User>('/register', { name, password });

export const login = (name: string, password: string) => post<User>('/login', { name, password });

export const logout = () => post<User>('/logout', {});

export const changePassword = (old: string, next: string) =>
	post<User>('/password', { old, new: next });

export const getUser = (name: string) =>
	req<{ user: User; games: GameRow[]; history?: RatingPoint[]; online?: boolean }>(
		`/users/${encodeURIComponent(name)}`,
	);

export const leaderboard = (limit = 20) => req<User[]>(`/leaderboard?limit=${limit}`);

export const listGames = (limit = 20) => req<GameRow[]>(`/games?limit=${limit}`);

export const listGamesBefore = (before: number, limit = 20) =>
	req<GameRow[]>(`/games?limit=${limit}&before=${before}`);

export const liveGames = () => req<LiveGame[]>('/tv');

export const getChallenge = (id: string) => req<Challenge>(`/challenges/${encodeURIComponent(id)}`);

export type GameDetail = {
	id: string;
	white: User;
	black: User;
	config: GameConfig;
	moves: Move[];
	status: Status;
	clock: ClockSpec;
	created_at: number;
	times?: number[];
};
export const getGame = (id: string) => req<GameDetail>(`/games/${encodeURIComponent(id)}`);

export const crosstable = (a: string, b: string) =>
	req<Crosstable>(`/crosstable?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);

export const listTournaments = () =>
	req<{ upcoming: Tournament[]; running: Tournament[]; finished: Tournament[] }>('/tournaments');
export const getTournament = (id: string) =>
	req<{ tournament: Tournament; standings: Standing[]; games: GameRow[]; joined: boolean }>(
		`/tournaments/${encodeURIComponent(id)}`,
	);
export const createTournament = (body: {
	name: string;
	clock: ClockSpec;
	walled: boolean;
	layout: Layout;
	starts_in_ms: number;
	duration_ms: number;
}) => post<Tournament>('/tournaments', body);

export type MyGame = {
	id: string;
	opponent: User;
	my_turn: boolean;
	plies: number;
	clock: ClockSpec;
};
export const myGames = () => req<MyGame[]>('/me/games');
