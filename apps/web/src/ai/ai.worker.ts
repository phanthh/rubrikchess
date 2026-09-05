import init, { WasmGame } from 'rubrik-wasm';
import type { GameState, Move } from '@/types';

export type AiRequest = { id: number; state: GameState; level: number };
export type AiResponse = { id: number; move: Move | null };

const ready = init();

self.onmessage = async (e: MessageEvent<AiRequest>) => {
	await ready;
	const { id, state, level } = e.data;
	const g = WasmGame.fromState(state);
	const move = g.bestMove(level, (Date.now() ^ (state.history.length * 7919)) >>> 0) as Move | null;
	g.free();
	const res: AiResponse = { id, move };
	self.postMessage(res);
};
