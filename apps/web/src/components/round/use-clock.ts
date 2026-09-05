import { useGameStore } from '@/store/game';
import { Color } from '@/types';
import { unlimited } from '@/utils/clock';
import { play } from '@/utils/sound';
import { useEffect, useRef, useState } from 'react';

/** Low-time threshold, lichess-style: 12.5% of initial time, clamped to 10s..60s. */
export const emergMs = (initial: number) => Math.min(60_000, Math.max(10_000, initial * 0.125));

/**
 * Remaining ms per colour, extrapolated locally from the last server clock.
 * Ticks 10×/s while a clock runs; plays the low-time cue once for our own clock.
 */
export function useClock() {
	const clock = useGameStore((s) => s.clock);
	const myColor = useGameStore((s) => s.myColor);
	const received = useRef(Date.now());
	const [, tick] = useState(0);
	const warned = useRef(false);

	useEffect(() => {
		received.current = Date.now();
		tick((n) => n + 1);
		if (!clock?.running || unlimited(clock)) return;
		const t = setInterval(() => tick((n) => n + 1), 100);
		return () => clearInterval(t);
	}, [clock]);

	const remaining = (color: Color) => {
		if (!clock) return null;
		const base = color === 'white' ? clock.white_ms : clock.black_ms;
		return Math.max(0, clock.running === color ? base - (Date.now() - received.current) : base);
	};

	// final ten seconds of our own clock: one tick per second
	const lastTick = useRef(-1);
	useEffect(() => {
		if (!clock || !myColor || clock.running !== myColor || unlimited(clock)) return;
		const left = remaining(myColor);
		if (left === null || left >= 10_000) return;
		const sec = Math.ceil(left / 1000);
		if (sec !== lastTick.current) {
			lastTick.current = sec;
			play('tick');
		}
	});

	useEffect(() => {
		if (!clock || !myColor) return;
		if (clock.running !== myColor || unlimited(clock)) return;
		const left = remaining(myColor);
		if (left === null) return;
		if (left > emergMs(clock.initial_ms)) {
			warned.current = false;
		} else if (!warned.current) {
			warned.current = true;
			play('lowtime');
		}
	});

	return { clock, remaining };
}
