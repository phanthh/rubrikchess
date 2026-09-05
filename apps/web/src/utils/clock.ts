import { ClockSpec } from '@/types';

/** Lichess speed buckets on estimated game length (initial + 40 × increment). */
export const unlimited = (c: ClockSpec) => c.initial_ms === 0 && c.increment_ms === 0;

export function speedOf({ initial_ms, increment_ms }: ClockSpec) {
	if (initial_ms === 0 && increment_ms === 0) return 'Correspondence';
	const total = initial_ms / 1000 + (40 * increment_ms) / 1000;
	if (total < 30) return 'UltraBullet';
	if (total < 180) return 'Bullet';
	if (total < 480) return 'Blitz';
	if (total < 1500) return 'Rapid';
	return 'Classical';
}

export function clockLabel({ initial_ms, increment_ms }: ClockSpec) {
	if (initial_ms === 0 && increment_ms === 0) return '∞';
	const min = initial_ms / 60000;
	const m = min >= 1 || min === 0 ? String(Math.round(min * 10) / 10) : `${initial_ms / 1000}s`;
	return `${m}+${Math.round(increment_ms / 1000)}`;
}

export function timeAgo(unixMs: number) {
	const s = Math.max(0, Math.round((Date.now() - unixMs) / 1000));
	if (s < 60) return 'just now';
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	return `${Math.floor(h / 24)}d ago`;
}
