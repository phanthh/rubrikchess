import type { GameState, Move } from '@/types';
import type { AiRequest, AiResponse } from './ai.worker';

export const AI_LEVELS = ['Random', 'Greedy', 'Two-ply', 'Three-ply'] as const;

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (m: Move | null) => void>();

/** Off-thread engine search; resolves with the move (or null when the game is over). */
export function requestAiMove(state: GameState, level: number): Promise<Move | null> {
	if (!worker) {
		worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
		worker.onmessage = (e: MessageEvent<AiResponse>) => {
			pending.get(e.data.id)?.(e.data.move);
			pending.delete(e.data.id);
		};
	}
	const id = ++seq;
	const req: AiRequest = { id, state, level };
	return new Promise((resolve) => {
		pending.set(id, resolve);
		worker!.postMessage(req);
	});
}

/** Drop answers for moves requested before now (new game / undo). */
export function cancelAiMoves() {
	pending.clear();
}
