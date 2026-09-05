import init, { WasmGame } from 'rubrik-wasm';
import type { GameConfig, GameState, Move } from '@/types';

export type AiRequest =
	| { id: number; kind: 'move'; state: GameState; level: number }
	| { id: number; kind: 'analyse'; config: GameConfig; moves: Move[]; level: number }
	| { id: number; kind: 'scan'; config: GameConfig; moves: Move[] };
export type Analysis = { move: Move; score: number };
/** A position where the two-ply best move wins ≥ `gain` centipawns and greedy play would miss it. */
export type Puzzle = { ply: number; solution: Move; gain: number };
export type AiResponse = {
	id: number;
	move: Move | null;
	analysis: Analysis | null;
	puzzles: Puzzle[];
};

const ready = init();

self.onmessage = async (e: MessageEvent<AiRequest>) => {
	await ready;
	const req = e.data;
	const seed = (Date.now() ^ (req.id * 7919)) >>> 0;
	const res: AiResponse = { id: req.id, move: null, analysis: null, puzzles: [] };
	if (req.kind === 'move') {
		const g = WasmGame.fromState(req.state);
		res.move = g.bestMove(req.level, seed) as Move | null;
		g.free();
	} else if (req.kind === 'analyse') {
		const g = WasmGame.replay(req.config, req.moves);
		res.analysis = g.analyse(req.level, seed) as Analysis | null;
		g.free();
	} else {
		const g = new WasmGame(req.config);
		// bounded: the worker is shared with live play; ≤ 80 plies, stop after a few hits
		const limit = Math.min(req.moves.length, 80);
		for (let ply = 0; ply < limit && res.puzzles.length < 4; ply++) {
			if (ply >= 4) {
				const base = (g.analyse(1, seed) as Analysis | null)?.score ?? 0;
				const greedy = g.analyse(2, seed) as Analysis | null;
				const deep = g.analyse(3, seed) as Analysis | null;
				if (deep && greedy) {
					const gain = deep.score - base;
					const same = JSON.stringify(greedy.move) === JSON.stringify(deep.move);
					if (gain >= 300 && gain < 50_000 && !same)
						res.puzzles.push({ ply, solution: deep.move, gain });
				}
			}
			g.play(req.moves[ply]);
		}
		g.free();
	}
	self.postMessage(res);
};
