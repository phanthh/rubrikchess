import { RatingPoint } from '@/types';

/** Plain SVG line chart of rating over time. */
export function RatingChart({ points }: { points: RatingPoint[] }) {
	if (points.length < 2) {
		return <div className="p-4 text-xs text-muted-foreground">Play a few rated games to see a chart.</div>;
	}
	const W = 600;
	const H = 160;
	const P = 24;
	const xs = points.map((p) => p.at);
	const ys = points.map((p) => p.rating);
	const x0 = Math.min(...xs);
	const x1 = Math.max(...xs);
	const lo = Math.floor((Math.min(...ys) - 20) / 50) * 50;
	const hi = Math.ceil((Math.max(...ys) + 20) / 50) * 50;
	const X = (t: number) => P + ((t - x0) / Math.max(1, x1 - x0)) * (W - 2 * P);
	const Y = (r: number) => H - P - ((r - lo) / Math.max(1, hi - lo)) * (H - 2 * P);
	const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.at).toFixed(1)},${Y(p.rating).toFixed(1)}`).join(' ');
	const ticks = [lo, (lo + hi) / 2, hi];
	return (
		<svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40 text-primary">
			{ticks.map((r) => (
				<g key={r}>
					<line x1={P} x2={W - P} y1={Y(r)} y2={Y(r)} stroke="currentColor" strokeOpacity="0.12" />
					<text x={4} y={Y(r) + 3} fontSize="9" fill="currentColor" fillOpacity="0.6">
						{r}
					</text>
				</g>
			))}
			<path d={`${d} L${X(x1)},${H - P} L${X(x0)},${H - P} Z`} fill="currentColor" fillOpacity="0.12" />
			<path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
			<circle cx={X(x1)} cy={Y(ys[ys.length - 1])} r="3" fill="currentColor" />
		</svg>
	);
}
