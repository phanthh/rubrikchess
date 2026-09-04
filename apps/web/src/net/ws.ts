import { ClientMsg, Seek, ServerMsg, User } from '@/types';
import { toast } from 'sonner';
import { create } from 'zustand';

interface INetStore {
	connected: boolean;
	me: User | null;
	seeks: Seek[];
}

export const useNetStore = create<INetStore>(() => ({
	connected: false,
	me: null,
	seeks: [],
}));

type Handler = (msg: ServerMsg) => void;

const handlers = new Set<Handler>();
const outbox: ClientMsg[] = [];

let socket: WebSocket | null = null;
let backoff = 500;

function url() {
	const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
	return `${proto}//${location.host}/ws`;
}

export function connect() {
	if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING))
		return;

	const ws = new WebSocket(url());
	socket = ws;

	ws.onopen = () => {
		backoff = 500;
		useNetStore.setState({ connected: true });
		while (outbox.length > 0) ws.send(JSON.stringify(outbox.shift()));
	};

	ws.onmessage = (e) => {
		let msg: ServerMsg;
		try {
			msg = JSON.parse(e.data as string);
		} catch {
			return;
		}
		switch (msg.t) {
			case 'hello':
				useNetStore.setState({ me: msg.me });
				break;
			case 'lobby':
				useNetStore.setState({ seeks: msg.seeks });
				break;
			case 'error':
				toast.error(msg.msg);
				break;
		}
		for (const h of handlers) h(msg);
	};

	ws.onclose = () => {
		if (socket === ws) socket = null;
		useNetStore.setState({ connected: false });
		setTimeout(connect, backoff);
		backoff = Math.min(backoff * 2, 10000);
	};

	ws.onerror = () => ws.close();
}

export function send(msg: ClientMsg) {
	if (socket && socket.readyState === WebSocket.OPEN) {
		socket.send(JSON.stringify(msg));
	} else {
		outbox.push(msg);
		connect();
	}
}

export function onServerMsg(handler: Handler) {
	handlers.add(handler);
	return () => {
		handlers.delete(handler);
	};
}
