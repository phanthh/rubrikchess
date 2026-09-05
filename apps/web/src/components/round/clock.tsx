import { usePrefs } from '@/store/prefs';
import { cn } from '@/utils/ui';
import { emergMs } from './use-clock';

function pad(n: number) {
	return String(n).padStart(2, '0');
}

export function Clock({
	ms,
	running,
	initial,
	over,
}: {
	ms: number;
	running: boolean;
	initial: number;
	over: boolean;
}) {
	const tenths = usePrefs((s) => s.clockTenths);
	const bar = usePrefs((s) => s.clockBar);
	const emerg = ms < emergMs(initial);
	const showTenths = tenths === 'always' || (tenths === 'lowtime' && ms < 10_000);
	const total = Math.floor(ms / 1000);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const sep = <span className="sep">:</span>;

	return (
		<div
			className={cn(
				'relative overflow-hidden rounded font-mono text-2xl sm:text-[1.75rem] leading-none px-3 py-2 tabular-nums select-none transition-colors',
				running
					? 'clock-running bg-accent text-accent-foreground'
					: 'bg-muted/60 text-muted-foreground',
				running && emerg && 'bg-destructive text-destructive-foreground',
				over && 'line-through decoration-muted-foreground/60 decoration-1',
			)}
		>
			{h > 0 && (
				<>
					{h}
					{sep}
				</>
			)}
			{h > 0 ? pad(m) : m}
			{sep}
			{pad(s)}
			{showTenths && <span className="text-base opacity-70">.{Math.floor((ms % 1000) / 100)}</span>}
			{bar && initial > 0 && (
				<div
					className={cn(
						'absolute left-0 bottom-0 h-0.5 bg-primary/70',
						emerg && 'bg-destructive-foreground',
					)}
					style={{ width: `${Math.min(100, (ms / initial) * 100)}%` }}
				/>
			)}
		</div>
	);
}
