import { game, useGameStore } from '@/store/game';
import { cn, statusLabel } from '@/utils/ui';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useReplayKeys } from './use-replay-keys';

export function MoveList({ className }: { className?: string }) {
	const sans = useGameStore((s) => s.sans);
	const marks = useGameStore((s) => s.marks);
	const times = useGameStore((s) => s.times);
	const clock = useGameStore((s) => s.clock);
	const cursor = useGameStore((s) => s.cursor);
	const status = useGameStore((s) => s.status);
	const animating = useGameStore((s) => s.animating);
	// keeps the active ply in view: the ref moves to another button when the cursor changes
	const active = useCallback((el: HTMLButtonElement | null) => {
		el?.scrollIntoView({ block: 'nearest' });
	}, []);
	const [auto, setAuto] = useState(false);
	const playing = auto && cursor < sans.length;
	useReplayKeys();

	// autoplay: one ply per second until the end
	useEffect(() => {
		if (!playing) return;
		const t = setTimeout(() => game().setCursor(game().cursor + 1), 1000);
		return () => clearTimeout(t);
	}, [playing]);

	// seconds spent on each ply from the server clock trail (undefined when unknown)
	const inc = clock?.increment_ms ?? 0;
	const spent = times.map((left, i) => {
		const prev = i >= 2 ? times[i - 2] : (clock?.initial_ms ?? 0);
		return Math.max(0, (prev + inc - left) / 1000);
	});
	const maxSpent = Math.max(1, ...spent);
	const rows: [number, string, string | undefined][] = [];
	for (let i = 0; i < sans.length; i += 2) rows.push([i, sans[i], sans[i + 1]]);
	const result =
		status.kind === 'won'
			? status.winner === 'white'
				? '1-0'
				: '0-1'
			: status.kind === 'draw'
				? '½-½'
				: null;

	const nav = (to: number, Icon: typeof ChevronLeft, title: string, disabled: boolean) => (
		<button
			title={title}
			disabled={disabled || animating}
			onClick={() => game().setCursor(to)}
			className="flex-1 flex justify-center py-1 text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:hover:bg-transparent"
		>
			<Icon className="h-4 w-4" />
		</button>
	);

	return (
		<div className={cn('box flex flex-col min-h-0', className)}>
			<div className="flex border-b border-border/60">
				{nav(0, ChevronFirst, 'First (↑)', cursor === 0)}
				{nav(cursor - 1, ChevronLeft, 'Previous (←)', cursor === 0)}
				<button
					title={playing ? 'Pause' : 'Autoplay'}
					disabled={sans.length === 0}
					onClick={() => {
						if (!playing && cursor >= sans.length) game().setCursor(0);
						setAuto(!playing);
					}}
					className="flex-1 flex justify-center py-1 text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30"
				>
					{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
				</button>
				{nav(cursor + 1, ChevronRight, 'Next (→)', cursor >= sans.length)}
				{nav(sans.length, ChevronLast, 'Last (↓)', cursor >= sans.length)}
			</div>
			<div className="flex-1 overflow-auto font-mono text-[13px]">
				{sans.length === 0 && (
					<div className="p-3 text-xs text-muted-foreground font-sans">No moves yet</div>
				)}
				<div className="grid grid-cols-[2.25rem_1fr_1fr]">
					{rows.map(([i, w, b]) => (
						<div key={i} className="contents">
							<span className="px-2 py-0.5 text-muted-foreground bg-muted/30 text-right">
								{i / 2 + 1}
							</span>
							<Ply
								n={i + 1}
								san={w + (marks[i + 1] ?? '')}
								cursor={cursor}
								active={active}
								spent={spent[i]}
								max={maxSpent}
							/>
							{b !== undefined ? (
								<Ply
									n={i + 2}
									san={b + (marks[i + 2] ?? '')}
									cursor={cursor}
									active={active}
									spent={spent[i + 1]}
									max={maxSpent}
								/>
							) : (
								<span />
							)}
						</div>
					))}
				</div>
				{result && (
					<div className="p-2 text-center font-sans border-t border-border/60">
						<div className="font-bold">{result}</div>
						<div className="text-xs text-muted-foreground">{statusLabel(status)}</div>
					</div>
				)}
			</div>
		</div>
	);
}

function Ply({
	n,
	san,
	cursor,
	active,
	spent,
	max,
}: {
	n: number;
	san: string;
	cursor: number;
	active: (el: HTMLButtonElement | null) => void;
	spent?: number;
	max: number;
}) {
	const current = cursor === n;
	return (
		<button
			ref={current ? active : undefined}
			onClick={() => game().setCursor(n)}
			title={spent !== undefined ? `${spent.toFixed(1)}s` : undefined}
			className={cn(
				'relative text-left px-2 py-0.5 hover:bg-accent/60 truncate',
				current && 'bg-primary/25 text-foreground font-semibold',
			)}
		>
			{spent !== undefined && (
				// time bar: how long this move took, relative to the slowest move of the game
				<span
					className="absolute left-0 bottom-0 h-0.5 bg-brag/60"
					style={{ width: `${Math.min(100, (spent / max) * 100)}%` }}
				/>
			)}
			{san}
		</button>
	);
}
