import { Vector3 } from 'three';
import { C_S, Z_GS } from '../settings';
import { TCell, TPathPoint } from '../types';

export function vec(x: number, y: number, z: number) {
	return new Vector3(x, y, z);
}

export function vkey(vec: Vector3) {
	return `${vec.x},${vec.y},${vec.z}`;
}

export function assert<T>(value: T, msg?: string): asserts value is NonNullable<T> {
	if (!value) throw new Error(msg ?? 'assertion failed');
}

export function clamp(x: number, min: number, max: number) {
	return Math.min(Math.max(x, min), max);
}

/** Centre of the cube-side cell body (cell centre pushed inwards by half a cell). */
export function implyCenter(cell: TCell): Vector3 {
	return cell.pos.clone().sub(
		cell.side
			.clone()
			.normalize()
			.multiplyScalar(C_S / 2),
	);
}

export function implyPathPoint(cell: TCell): TPathPoint {
	return {
		pos: cell.pos,
		zPos: cell.pos.clone().add(cell.side.clone().multiplyScalar(Z_GS)),
	};
}
