import { C_S, Z_GS } from '@/settings';
import { TCell, TPathPoint } from '@/types';
import { CatmullRomCurve3 } from 'three';
import { implyCenter, implyPathPoint } from './funcs';

/**
 * Extra point above the shared edge of two cells lying on different cube sides,
 * so a piece climbing an edge flies over it instead of through the cube.
 */
function edgePoint(c: TCell, nc: TCell): TPathPoint {
	const middle = implyCenter(nc).add(implyCenter(c)).multiplyScalar(0.5);
	const side = c.side.clone().add(nc.side).normalize();
	const point = middle.add(side.clone().multiplyScalar(Math.SQRT1_2 * C_S));
	return {
		pos: point.clone(),
		zPos: point.clone().add(side.multiplyScalar(Z_GS)),
	};
}

/** Smooth curves for a step move: `from` cell followed by the move's path cells. */
export function stepCurves(from: TCell, pathCells: TCell[]) {
	const points: TPathPoint[] = [implyPathPoint(from)];

	if (pathCells[0].side.dot(from.side) === 0) {
		points.push(edgePoint(from, pathCells[0]));
	}

	for (const [i, c] of pathCells.entries()) {
		points.push(implyPathPoint(c));
		const nc = pathCells[i + 1];
		if (nc && nc.side.dot(c.side) === 0) {
			points.push(edgePoint(c, nc));
		}
	}

	return {
		path: new CatmullRomCurve3(points.map((p) => p.pos)),
		zPath: new CatmullRomCurve3(points.map((p) => p.zPos)),
	};
}
