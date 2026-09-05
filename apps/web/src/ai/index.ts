import type { GameConfig, GameState, Move } from '@/types';
import type { AiRequest, AiResponse, Analysis } from './ai.worker';

export type { Analysis };
export const AI_LEVELS = ['Random', 'Greedy', 'Two-ply', 'Three-ply'] as const;

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: AiResponse) => void>();

type Req = AiRequest extends infer R ? (R extends AiRequest ? Omit<R, 'id'> : never) : never;

function ask(req: Req): Promise<AiResponse> {
	if (!worker) {
		worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
		worker.onmessage = (e: MessageEvent<AiResponse>) => {
			pending.get(e.data.id)?.(e.data);
			pending.delete(e.data.id);
		};
	}
	const id = ++seq;
	return new Promise((resolve) => {
		pending.set(id, resolve);
		worker!.postMessage({ ...req, id } as AiRequest);
	});
}

/** Off-thread engine search; resolves with the move (or null when the game is over). */
export const requestAiMove = (state: GameState, level: number) =>
	ask({ kind: 'move', state, level }).then((r) => r.move);

/** Best move + score for the position after `moves`. */
export const requestAnalysis = (config: GameConfig, moves: Move[], level: number) =>
	ask({ kind: 'analyse', config, moves, level }).then((r) => r.analysis);

/** Drop answers for moves requested before now (new game / undo). */
export function cancelAiMoves() {
	for (const resolve of pending.values()) resolve({ id: 0, move: null, analysis: null });
	pending.clear();
}
