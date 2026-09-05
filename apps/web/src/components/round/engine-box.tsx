import { Analysis, requestAnalysis } from '@/ai';
import { Button } from '@/components/ui/button';
import { game, useGameStore } from '@/store/game';
import { notation } from '@/utils/notation';
import { cn } from '@/utils/ui';
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

const MATE = 100_000;

/** Engine verdict for the position under the cursor (three-ply search in the worker). */
export function EngineBox() {
	const { config, history, cursor, turn, status, cells } = useGameStore(
		useShallow((s) => ({
			config: s.config,
			history: s.history,
			cursor: s.cursor,
			turn: s.turn,
			status: s.status,
			cells: s.cells,
		})),
	);
	const [result, setResult] = useState<{ key: string; analysis: Analysis | null } | null>(null);
	const key = `${cursor}:${history.length}:${history[cursor - 1] ? notation(history[cursor - 1]) : ''}`;

	// `key` already encodes cursor + history; re-running on every history object would spam the worker
	// oxlint-disable-next-line react-hooks/exhaustive-deps
	useEffect(() => {
		if (!config || status.kind !== 'playing') return;
		let stale = false;
		const t = setTimeout(() => {
			requestAnalysis(config, history.slice(0, cursor), 4).then(
				(analysis) => !stale && setResult({ key, analysis }),
			);
		}, 250);
		return () => {
			stale = true;
			clearTimeout(t);
		};
	}, [key, config, status.kind]);

	const a = result?.key === key ? result.analysis : null;
	// score is from the side to move; show it from white's view like an eval bar
	const white = a ? (turn === 'white' ? a.score : -a.score) : 0;
	const label = !a
		? '…'
		: Math.abs(white) >= MATE
			? white > 0
				? 'White wins'
				: 'Black wins'
			: `${white >= 0 ? '+' : '−'}${(Math.abs(white) / 100).toFixed(1)}`;
	const pct = a ? 50 + 50 * Math.tanh(white / 600) : 50;

	return (
		<div className="box p-3 text-sm flex flex-col gap-2">
			<div className="flex items-center justify-between">
				<span className="text-xs text-muted-foreground uppercase tracking-wider">Engine</span>
				<span
					className={cn(
						'font-mono font-semibold',
						status.kind !== 'playing' && 'text-muted-foreground',
					)}
				>
					{status.kind === 'playing' ? label : '—'}
				</span>
			</div>
			<div className="h-1.5 rounded bg-neutral-900 overflow-hidden">
				<div className="h-full bg-neutral-100 transition-all" style={{ width: `${pct}%` }} />
			</div>
			{a && status.kind === 'playing' && (
				<div className="flex items-center justify-between gap-2">
					<span className="text-xs text-muted-foreground">
						Best:{' '}
						<span className="font-mono text-foreground">
							{notation(a.move, cells[a.move.from]?.piece?.kind)}
						</span>
					</span>
					<Button size="sm" variant="outline" onClick={() => game().play(a.move)}>
						Play it
					</Button>
				</div>
			)}
		</div>
	);
}
