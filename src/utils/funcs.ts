import { MeshProps } from '@react-three/fiber';
import { Vector3 } from 'three';
import { C_S, CU_S } from '../settings';
import { TCell } from '../types';
import { DIRS2D, SIDES } from './consts';

export function vec(x: number, y: number, z: number) {
	return new Vector3(x, y, z);
}

export function vkey(vec: Vector3) {
	return `${vec.x},${vec.y},${vec.z}`;
}

export function nkey(c: number, i: number, j: number) {
	return `${c},${i},${j}`;
}

export function nkeyinv(key: string) {
	return key.split(',').map((i) => Number(i));
}

export function zip<U, V>(a1: U[], a2: V[]) {
	return a1.map((_, i) => [a1[i], a2[i]]) as [U, V][];
}

export function distToPlane(vector: Vector3, planeNormal: Vector3) {
	const projected = vector.clone().projectOnPlane(planeNormal);
	return vector.clone().sub(projected).length();
}

export function implySide(cord: Vector3) {
	return SIDES.find((side) => {
		const projected = cord.clone().projectOnPlane(side);
		const dir = cord.clone().sub(projected);
		return dir.dot(side) === CU_S / 2;
	})?.clone();
}

export function isEdgeCell(cell: TCell) {
	return (
		cell.cord
			.clone()
			.projectOnPlane(cell.side)
			.toArray()
			.filter((c) => Math.abs(c) === CU_S / 2 - C_S / 2).length === 1
	);
}

export function assert<T>(value: T, msg?: string): asserts value is NonNullable<T> {
	if (!value) throw new Error(msg ?? 'assertion failed');
}

export function isCornerCell(cell: TCell) {
	return (
		cell.cord
			.clone()
			.projectOnPlane(cell.side)
			.toArray()
			.filter((c) => Math.abs(c) === CU_S / 2 - C_S / 2).length === 2
	);
}

export function implyDirs(side: Vector3) {
	const cross = vec(0, 0, 1).cross(side);
	return DIRS2D.map((dir) => dir.clone().applyAxisAngle(cross, Math.PI / 2));
}

export function clampCube(vector: Vector3) {
	return vector
		.clone()
		.clamp(vec(-CU_S / 2, -CU_S / 2, -CU_S / 2), vec(CU_S / 2, CU_S / 2, CU_S / 2));
}

export const preventProgagation = () => {
	return {
		onPointerDown: (e) => e.stopPropagation(),
		onPointerEnter: (e) => e.stopPropagation(),
		onPointerLeave: (e) => e.stopPropagation(),
		onPointerOver: (e) => e.stopPropagation(),
		onPointerUp: (e) => e.stopPropagation(),
		onClick: (e) => e.stopPropagation(),
	} as MeshProps as any;
};

export function updateCellState(cell: TCell, other: TCell) {
	const otherPiece = other.piece;
	const thisPiece = cell.piece;
	assert(thisPiece);
	if (otherPiece) {
		if (otherPiece.player !== thisPiece.player) {
			other.state = 'capturable';
		}
	} else {
		other.state = 'reachable';
	}
}
