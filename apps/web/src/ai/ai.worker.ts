import init, { WasmGame } from 'rubrik-wasm';
import type { GameConfig, GameState, Move } from '@/types';

export type AiRequest =
	| { id: number; kind: 'move'; state: GameState; level: number }
	| { id: number; kind: 'analyse'; config: GameConfig; moves: Move[]; level: number };
export type Analysis = { move: Move; score: number };
export type AiResponse = { id: number; move: Move | null; analysis: Analysis | null };

const ready = init();

self.onmessage = async (e: MessageEvent<AiRequest>) => {
	await ready;
	const req = e.data;
	const seed = (Date.now() ^ (req.id * 7919)) >>> 0;
	const res: AiResponse = { id: req.id, move: null, analysis: null };
	if (req.kind === 'move') {
		const g = WasmGame.fromState(req.state);
		res.move = g.bestMove(req.level, seed) as Move | null;
		g.free();
	} else {
		const g = WasmGame.replay(req.config, req.moves);
		res.analysis = g.analyse(req.level, seed) as Analysis | null;
		g.free();
	}
	self.postMessage(res);
};
