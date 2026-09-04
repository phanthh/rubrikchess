import { formatDiff } from '@/utils/ui';

export function RatingDiff({ diff }: { diff: number | null | undefined }) {
	const label = formatDiff(diff);
	if (label === null) return null;
	return <span className={label.startsWith('+') ? 'text-green-500' : 'text-red-500'}>{label}</span>;
}
