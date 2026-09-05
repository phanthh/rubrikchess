import { evalGame } from '@/ai';
import { Button } from '@/components/ui/button';
import { game, useGameStore } from '@/store/game';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

const MATE = 100_000;
/** Squash centipawns into -1..1 for the graph. */
const squash = (cp: number) => Math.tanh(Math.max(-3000, Math.min(3000, cp)) / 800);

/** Blunder marks from eval swings, from the mover's point of view. */
function annotate(evals: number[]): Record<number, string> {
	const marks: Record<number, string> = {};
	for (let ply = 1; ply < evals.length; ply++) {
		const white = ply % 2 === 1; // ply 1 is white's move
		const before = white ? evals[ply - 1] : -evals[ply - 1];
		const after = white ? evals[ply] : -evals[ply];
		const swing = after - before;
		if (Math.abs(before) >= MATE) continue;
		if (swing <= -600) marks[ply] = '??';
		else if (swing <= -250) marks[ply] = '?';
		else if (swing >= 250) marks[ply] = '!';
	}
	return marks;
}

/** "Request computer analysis": eval per position + blunder marks in the move list. */
export function EvalGraph() {
	const { config, history, cursor } = useGameStore(
		useShallow((s) => ({ config: s.config, history: s.history, cursor: s.cursor })),
	);
	const [evals, setEvals] = useState<number[] | null>(null);
	const [busy, setBusy] = useState(false);

	const run = async () => {
		if (!config) return;
		setBusy(true);
		const e = await evalGame(config, history);
		setEvals(e);
		game().setSetting({ marks: annotate(e) });
		setBusy(false);
	};

	const W = 300;
	const H = 60;
	const n = evals?.length ?? 0;
	const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : 0);
	const y = (cp: number) => (H / 2) * (1 - squash(cp));
	const marks = evals ? annotate(evals) : {};
	const blunders = Object.values(marks).filter((m) => m === '??').length;
	const mistakes = Object.values(marks).filter((m) => m === '?').length;

	return (
		<div className="box p-3 text-sm flex flex-col gap-2">
			<div className="flex items-center justify-between">
				<span className="text-xs text-muted-foreground uppercase tracking-wider">
					Computer analysis
				</span>
				{evals && (
					<span className="text-xs text-muted-foreground">
						{blunders} blunders · {mistakes} mistakes
					</span>
				)}
			</div>
			{!evals ? (
				<Button size="sm" variant="outline" disabled={busy || history.length === 0} onClick={run}>
					{busy ? 'Analysing…' : 'Request computer analysis'}
				</Button>
			) : (
				<svg
					viewBox={`0 0 ${W} ${H}`}
					className="w-full h-16 cursor-pointer"
					onClick={(e) => {
						const rect = e.currentTarget.getBoundingClientRect();
						const i = Math.round(((e.clientX - rect.left) / rect.width) * (n - 1));
						game().setCursor(Math.max(0, Math.min(history.length, i)));
					}}
				>
					<rect width={W} height={H} fill="#1a1a1a" />
					<rect width={W} height={H / 2} fill="#e5e5e5" fillOpacity={0.9} />
					<path
						d={`M0,${H / 2} ${evals.map((cp, i) => `L${x(i).toFixed(1)},${y(cp).toFixed(1)}`).join(' ')} L${W},${H / 2} Z`}
						fill="#2c2c2c"
					/>
					<line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="#888" strokeWidth={0.5} />
					{Object.entries(marks).map(([ply, m]) => (
						<circle
							key={ply}
							cx={x(Number(ply))}
							cy={y(evals[Number(ply)])}
							r={2.5}
							fill={m === '??' ? '#dc2626' : m === '?' ? '#f59e0b' : '#16a34a'}
						/>
					))}
					<line x1={x(cursor)} x2={x(cursor)} y1={0} y2={H} stroke="#3b82f6" strokeWidth={1} />
				</svg>
			)}
		</div>
	);
}
