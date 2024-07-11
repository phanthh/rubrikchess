import { Vector3 } from 'three';
import { BOARD_SIZE, CELL_SIZE, CUBE_SIZE } from '../settings';
import { TBoardCord, TCell } from '../types';
import { SIDES } from './consts';

export function vec(x: number, y: number, z: number) {
	return new Vector3(x, y, z);
}

export function vkey(vec: Vector3) {
	return vec.toArray().toString();
}
export function zip<U, V>(a1: U[], a2: V[]) {
	return a1.map((_, i) => [a1[i], a2[i]]) as [U, V][];
}

export function bcordEq(b1: TBoardCord, b2: TBoardCord) {
	return b1.every((_, i) => b1[i] === b2[i]);
}

export function loopCells(cells: TCell[][][], callback: (cell: TCell) => void) {
	for (let c = 0; c < SIDES.length; c++) {
		for (let i = 0; i < BOARD_SIZE; i++) {
			for (let j = 0; j < BOARD_SIZE; j++) {
				callback(cells[c][i][j]);
			}
		}
	}
}

export function updateCell(cells: TCell[][][], bcord: TBoardCord, newCell: Partial<TCell>) {
	for (let c = 0; c < SIDES.length; c++) {
		for (let i = 0; i < BOARD_SIZE; i++) {
			for (let j = 0; j < BOARD_SIZE; j++) {
				if (bcordEq(bcord, [c, i, j])) {
					cells[c][i][j] = { ...cells[c][i][j], ...newCell };
				}
			}
		}
	}
}

// games
export function isCornerCord(cord: Vector3, normal: Vector3, offset = 0) {
	return cord.projectOnPlane(normal).lengthSq() === 2 * Math.pow(CUBE_SIZE / 2 + offset, 2);
}

export function isCornerCell(cell: TCell, offset = 0) {
	return isCornerCord(cell.cord, cell.side, offset - CELL_SIZE / 2);
}

export function isEdgeCord(cord: Vector3, normal: Vector3, offset = 0) {
	return (
		cord
			.projectOnPlane(normal)
			.toArray()
			.filter((component) => component !== 0 && component === CUBE_SIZE / 2 + offset).length === 1
	);
}

export function isEdgeCell(cell: TCell, offset = 0) {
	return isEdgeCord(cell.cord, cell.side, offset - CELL_SIZE / 2);
}

export function filterDiagonalAdjancentCells(target: TCell, cells: TCell[]) {
	return cells.filter((cell) => {
		if (target.side.equals(cell.side)) {
			return target.cord.manhattanDistanceTo(cell.cord) === 2 * CELL_SIZE;
		} else if (!target.side.dot(cell.side)) {
			return target.cord.distanceToSquared(cell.cord) === (3 * CELL_SIZE * CELL_SIZE) / 2;
		}
		return false;
	});
}

export function filterOrthogonalAdjancentCells(target: TCell, cells: TCell[]) {
	return cells.filter((cell) => {
		if (target.side.equals(cell.side)) {
			return target.cord.distanceToSquared(cell.cord) === CELL_SIZE * CELL_SIZE;
		} else if (!target.side.dot(cell.side)) {
			return target.cord.distanceToSquared(cell.cord) === (CELL_SIZE * CELL_SIZE) / 2;
		}
		return false;
	});
}

export function diagonalStep(cord: Vector3, normal: Vector3, direction: Vector3) {
	const normalizedDirection = direction.normalize();
	if (normal.dot(direction) !== 0) throw new Error('direction must be on the the same plane');
	const next = cord.add(normalizedDirection.multiplyScalar(Math.SQRT2 * CELL_SIZE));
	const clamped = next.clamp(
		vec(-CUBE_SIZE / 2, -CUBE_SIZE / 2, -CUBE_SIZE / 2),
		vec(CUBE_SIZE / 2, CUBE_SIZE / 2, CUBE_SIZE / 2),
	);
	if (isCornerCord(next, normal, CELL_SIZE)) {
		return [];
	} else if (isEdgeCord(next, normal, CELL_SIZE)) {
		const adjust = normal.negate().normalize();
		const newCord = clamped.add(adjust.multiplyScalar(CELL_SIZE / 2));
		const newNormal = clamped.sub(cord).normalize();
		const newDirection = normalizedDirection.projectOnPlane(newNormal).add(adjust);
		return [newCord, newNormal, newDirection];
	} else {
		return [clamped, normal, direction];
	}
}

export function filterOrthogonalCells(target: TCell, cells: TCell[]) {
	if (target.side.x !== 0) {
		return cells.filter((cell) => target.cord.y === cell.cord.y || target.cord.z === cell.cord.z);
	}
	if (target.side.y !== 0) {
		return cells.filter((cell) => target.cord.x === cell.cord.x || target.cord.z === cell.cord.z);
	}
	if (target.side.z !== 0) {
		return cells.filter((cell) => target.cord.x === cell.cord.x || target.cord.y === cell.cord.y);
	}
}

export function filterDiagonalCells(target: TCell, cells: TCell[]) {
	const stepAndFilter = (directions: Vector3[]) => {
		const diagonals: Vector3[] = [];
		for (const direction of directions) {
			const candidates: Vector3[] = [];
			let cursor = target.cord.clone();
			let normal = target.side.clone();
			let dir = direction;
			while (cursor) {
				[cursor, normal, dir] = diagonalStep(cursor, normal, dir);
				candidates.push(cursor);
			}
			diagonals.push(...candidates);
		}
		return cells.filter((cell) => diagonals.some((cord) => cord.equals(cell.cord)));
	};
	if (target.side.x !== 0) {
		const directions = [vec(0, 1.0, 1), vec(0, 1.0, -1), vec(0, -1.0, 1), vec(0, -1.0, -1)];
		return stepAndFilter(directions);
	} else if (target.side.y !== 0) {
		const directions = [vec(1.0, 0, 1), vec(1.0, 0, -1), vec(-1.0, 0, 1), vec(-1.0, 0, -1)];
		return stepAndFilter(directions);
	} else if (target.side.z !== 0) {
		const directions = [vec(1.0, 1.0, 0), vec(-1.0, 1.0, 0), vec(1.0, -1.0, 0), vec(-1.0, -1.0, 0)];
		return stepAndFilter(directions);
	}
}
