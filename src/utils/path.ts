import { B_D, C_S } from '@/settings';
import { TCell } from '@/types';
import { Vector3 } from 'three';
import { SIDES } from './consts';
import { assert, bkey, bkeyinv, clampCube, implyDirs, vkey } from './funcs';
import { createQueue } from './queue';

const MAX_ITER = B_D * B_D * SIDES.length;

export function walk({
	initDir,
	initSide,
	start,
	end,
	mode,
	cords,
	cells,
	walled,
	maxIter = MAX_ITER,
	callback,
}: {
	initDir: Vector3;
	initSide: Vector3;
	start: Vector3;
	end: Vector3;
	mode: 'rook' | 'bishop';
	cords: Record<string, string>;
	cells: TCell[][][];
	walled: boolean;
	maxIter?: number;
	callback?: (cell: TCell) => boolean;
}) {
	const step = mode === 'bishop' ? Math.SQRT2 * C_S : C_S;

	let dir = initDir.clone();
	let cursor = start.clone().add(dir.clone().multiplyScalar(step)).round();
	let side = initSide.clone();
	let iter = 0;

	const path: TCell[] = [];

	while (iter < maxIter) {
		const id = cords[vkey(cursor)];
		if (id) {
			const [cc, ci, cj] = bkeyinv(id);
			const cell = cells[cc][ci][cj];
			path.push(cell);
			if (callback) {
				const cont = callback(cell);
				if (!cont) {
					break;
				}
			}
			side = cells[cc][ci][cj].side.clone();
			cursor = cursor.clone().add(dir.clone().multiplyScalar(step)).round();
		} else if (walled) {
			break;
		} else {
			// CLIMB OVER EDGE
			// TODO: refractor climb over edge logic
			switch (mode) {
				// ROOK MODE
				case 'rook': {
					const newDir = side.clone().negate();
					cursor = cursor
						.clone()
						.add(
							dir
								.clone()
								.negate()
								.multiplyScalar(C_S / 2),
						)
						.add(newDir.clone().multiplyScalar(C_S / 2))
						.round();
					dir = newDir.clone();
					break;
				}

				// BISHOP MODE
				case 'bishop': {
					const clamped = clampCube(cursor);
					const newSide = cursor.clone().sub(clamped).normalize();
					dir = dir
						.clone()
						.projectOnPlane(newSide)
						.normalize()
						.add(side.clone().negate())
						.normalize();
					cursor = clamped
						.clone()
						.add(
							side
								.clone()
								.negate()
								.multiplyScalar(C_S / 2),
						)
						.round();
				}
			}
		}
		if (cursor.equals(end)) {
			break;
		}
		iter++;
	}

	return path;
}

export function bfs({
	cords,
	initCell,
	cells,
	walled,
	callback,
}: {
	cords: Record<string, string>;
	initCell: TCell;
	cells: TCell[][][];
	walled: boolean;
	callback?: (cell: TCell) => boolean;
}) {
	// GET NEIGHBORS
	const getNeighbors = (cell: TCell, cells: TCell[][][]) => {
		return implyDirs(cell.side)
			.slice(0, 4)
			.map((dir) => {
				let cand = cell.cord.clone().add(dir.clone().multiplyScalar(C_S));
				const clamped = clampCube(cand);
				if (!clamped.equals(cand)) {
					if (walled) return false;
					cand = clamped.clone().sub(cell.side.clone().multiplyScalar(C_S / 2));
				}
				cand = cand.round();
				const id = cords[vkey(cand)];
				assert(id);
				const [cc, ci, cj] = bkeyinv(id);
				return cells[cc][ci][cj];
			})
			.filter(Boolean) as TCell[];
	};

	// BFS
	const queue = createQueue<TCell>();
	queue.push(initCell);
	const visited = [initCell.id];
	while (queue.length > 0) {
		const popped = queue.shift();
		assert(popped);
		const neighbors = getNeighbors(popped, cells);
		for (const neighbor of neighbors) {
			if (!visited.includes(neighbor.id)) {
				if (callback) {
					const result = callback(neighbor);
					if (!result) continue;
				}
				queue.push(neighbor);
				visited.push(neighbor.id);
			}
		}
	}
}
