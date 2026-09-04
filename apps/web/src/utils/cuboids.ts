import { B_D, C_S, CU_S } from '@/settings';
import { TCuboid } from '@/types';
import { vec } from './funcs';

/**
 * Inner blocks of the cube. Purely decorative: a slice rotation permutes them
 * among themselves, so their positions are constant and only animated.
 */
export const CUBOIDS: TCuboid[] = (() => {
	const offset = C_S / 2 - CU_S / 2;
	const out: TCuboid[] = [];
	for (let i = 0; i < B_D; ++i) {
		for (let j = 0; j < B_D; ++j) {
			for (let k = 0; k < B_D; ++k) {
				out.push({
					id: `${i},${j},${k}`,
					pos: vec(i * C_S + offset, j * C_S + offset, k * C_S + offset),
				});
			}
		}
	}
	return out;
})();

export const CUBOID_BY_ID: Record<string, TCuboid> = Object.fromEntries(
	CUBOIDS.map((c) => [c.id, c]),
);
