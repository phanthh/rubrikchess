import { BoardPage } from '@/components/round/board-page';
import { EngineBox } from '@/components/round/engine-box';
import { EvalGraph } from '@/components/round/eval-graph';
import { MoveList } from '@/components/round/move-list';
import { Button } from '@/components/ui/button';
import { getGame } from '@/net/api';
import { game, useGameStore } from '@/store/game';
import { statusLabel } from '@/utils/ui';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';

/** Analysis board: a finished game's moves on a local engine; play from any position to branch. */
export function AnalysisPage() {
	const { id } = useParams();
	const [error, setError] = useState<string | null>(null);
	const { turn, status, players, flipped, history, cursor } = useGameStore(
		useShallow((s) => ({
			turn: s.turn,
			status: s.status,
			players: s.players,
			flipped: s.flipped,
			history: s.history,
			cursor: s.cursor,
		})),
	);

	useEffect(() => {
		if (!id) return;
		getGame(id)
			.then((g) => game().loadAnalysis(g.config, g.moves, { white: g.white, black: g.black }))
			.catch((e) => setError(String(e)));
	}, [id]);

	const banner = error ?? statusLabel(status) ?? `${turn === 'white' ? 'White' : 'Black'} to move`;

	return (
		<BoardPage
			banner={banner}
			right={
				<>
					<div className="box p-3 flex flex-col gap-2 text-sm">
						<div className="font-semibold">Analysis</div>
						<div className="text-xs text-muted-foreground">
							{players.white?.name ?? '?'} vs {players.black?.name ?? '?'} ·{' '}
							<Link to={`/g/${id}`}>back to game</Link>
						</div>
						<p className="text-xs text-muted-foreground">
							Step through with the arrow keys. Playing a move from an earlier position discards the
							moves after it.
						</p>
						<div className="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								className="flex-1"
								onClick={() => game().setSetting({ flipped: !flipped })}
							>
								Flip
							</Button>
							<Button
								variant="outline"
								size="sm"
								className="flex-1"
								disabled={cursor === history.length}
								onClick={() => game().setCursor(history.length)}
							>
								Latest
							</Button>
						</div>
					</div>
					<EngineBox />
					<EvalGraph />
					<MoveList className="flex-1 min-h-40 lg:min-h-0" />
				</>
			}
		/>
	);
}
