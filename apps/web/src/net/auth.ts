import { reconnect, useNetStore } from '@/net/ws';
import { User } from '@/types';

/** The server session changes on register/login/logout, so the socket must be redialled. */
export async function applyAuth(run: () => Promise<User>) {
	useNetStore.setState({ me: await run() });
	reconnect();
}
