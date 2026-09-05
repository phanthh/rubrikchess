import { Net, NetCell } from '@/components/round/net';
import { GameConfig, GameState, Move } from '@/types';
import { vec } from '@/utils/funcs';
import { WasmGame } from 'rubrik-wasm';
import { useMemo } from 'react';

/** Static unfolded-net thumbnail of a position (config + moves), last move tinted. */
export function MiniBoard({ config, moves, className }: { config: GameConfig; moves: Move[]; className?: string }) {
	const cells = useMemo<NetCell[]>(() => {
		const g = WasmGame.replay(config, moves);
		const state = g.state() as GameState;
		g.free();
		const last = moves[moves.length - 1];
		const lit = new Set<number>();
		if (last) {
			lit.add(last.from);
			if (last.kind === 'step') lit.add(last.path[last.path.length - 1]);
		}
		return state.board.cells.map((c, id) => ({
			id,
			pos: vec(c.pos.x, c.pos.y, c.pos.z),
			color: c.color,
			piece: c.piece ?? null,
			state: lit.has(id) ? 'lastmove' : 'normal',
		}));
	}, [config, moves]);
	return <Net cells={cells} className={className} />;
}
