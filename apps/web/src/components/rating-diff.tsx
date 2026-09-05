/** Rating change, e.g. "+12" / "−12". Nothing when the game was not rated. */
export function RatingDiff({ diff }: { diff: number | null | undefined }) {
	if (diff === null || diff === undefined) return null;
	const label = diff >= 0 ? `+${diff}` : `−${-diff}`;
	return (
		<span className={`text-xs ${diff >= 0 ? 'text-secondary' : 'text-destructive'}`}>{label}</span>
	);
}
