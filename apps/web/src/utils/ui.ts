import { Status } from '@/types';
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

const REASONS: Record<string, string> = {
	kingcaptured: 'king captured',
	resign: 'resignation',
	timeout: 'timeout',
	agreement: 'agreement',
	abandoned: 'abandonment',
};

export function statusLabel(status: Status) {
	switch (status.kind) {
		case 'playing':
			return null;
		case 'won':
			return `${status.winner === 'white' ? 'White' : 'Black'} won by ${REASONS[status.reason] ?? status.reason}`;
		case 'draw':
			return status.reason === 'abandoned'
				? 'Game aborted'
				: `Draw by ${REASONS[status.reason] ?? status.reason}`;
	}
}

export function formatClock(ms: number) {
	const total = Math.max(0, Math.round(ms / 1000));
	const m = Math.floor(total / 60);
	const s = total % 60;
	return `${m}:${String(s).padStart(2, '0')}`;
}
