/** Rating change, e.g. "+12" / "−12". Nothing when the game was not rated. */
export function RatingDiff({ diff }: { diff: number | null | undefined }) {
	if (diff === null || diff === undefined) return null;
	const label = diff >= 0 ? `+${diff}` : `−${-diff}`;
	return <span className={diff >= 0 ? 'text-green-500' : 'text-red-500'}>{label}</span>;
}
