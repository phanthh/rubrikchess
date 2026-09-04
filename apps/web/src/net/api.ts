import { GameSummary, User } from '@/types';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`/api${path}`, {
		headers: { 'content-type': 'application/json' },
		...init,
	});
	if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path}: ${res.status}`);
	return res.json() as Promise<T>;
}

export const getMe = () => req<User>('/me');

export const setName = (name: string) =>
	req<User>('/me', { method: 'POST', body: JSON.stringify({ name }) });

export const listGames = (limit = 20) => req<GameSummary[]>(`/games?limit=${limit}`);
