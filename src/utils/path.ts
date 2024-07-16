import { B_D, C_S, Z_GS } from '@/settings';
import { animation } from '@/store/animation';
import { game } from '@/store/game';
import { TCell, TMove, TPathPoint } from '@/types';
import { produce } from 'immer';
import { CatmullRomCurve3, Vector3 } from 'three';
import { SIDES } from './consts';
import { assert, clampCube, implyCenter, implyDirs, implyPathPoint, nkeyinv, vkey } from './funcs';
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
			const [cc, ci, cj] = nkeyinv(id);
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
				const [cc, ci, cj] = nkeyinv(id);
				return cells[cc][ci][cj];
			})
			.filter(Boolean) as TCell[];
	};

	// BFS
	const tree: Record<string, string> = {};
	const queue = createQueue<TCell>();
	queue.push(initCell);
	const visited = [initCell.id];
	while (queue.length > 0) {
		const popped = queue.shift();
		assert(popped);
		const neighbors = getNeighbors(popped, cells);
		for (const neighbor of neighbors) {
			if (!visited.includes(neighbor.id)) {
				tree[neighbor.id] = popped.id;
				if (callback) {
					const result = callback(neighbor);
					if (!result) continue;
				}
				queue.push(neighbor);
				visited.push(neighbor.id);
			}
		}
	}

	return tree;
}

export function move(activeCell: TCell, chosenCell: TCell, cells: TCell[][][], animate: boolean) {
	const activePiece = activeCell?.piece;
	const moves = activePiece?.moves;
	assert(activeCell, 'no active cell');
	assert(activePiece, 'no active piece');
	assert(moves, 'no moves');

	const moveCell = () => {
		game().set((state) => {
			return produce(state, (draft) => {
				for (const c of draft.cells.flat(3)) {
					if (c.id === chosenCell.id) {
						// intent to move piece to this cell
						c.piece = activePiece;
					} else if (c.id === activeCell.id) {
						delete c.piece;
					}
				}
			});
		});
		game().updatePieceMoves();
		game().updateIdleCellStates();
	};

	if (animate) {
		const possibleMoves = moves.filter((move) => move.path[move.path.length - 1] === chosenCell.id);

		// EXECUTE PATH ANIMATION
		let chosenMove: TMove | null = null;
		let step = 0;
		const currPaths: string[][] = [];
		while (!chosenMove) {
			for (const [i, { path }] of possibleMoves.entries()) {
				if (!currPaths[i]) {
					currPaths[i] = [];
				}
				if (step >= path.length) continue;
				const curr = path[step];
				currPaths[i].push(curr);
				if (curr === chosenCell.id) {
					chosenMove = possibleMoves[i];
					break;
				}
			}
			step += 1;
		}

		assert(chosenMove);

		const getMiddlePointPath = (c: TCell, nc: TCell) => {
			const cc = implyCenter(c);
			const ncc = implyCenter(nc);
			const ccc = ncc.add(cc).multiplyScalar(0.5);
			const newPointSide = c.side.clone().add(nc.side).normalize();
			const newPoint = ccc.add(newPointSide.clone().multiplyScalar(Math.SQRT1_2 * C_S));
			return {
				cord: newPoint.clone(),
				zCord: newPoint.clone().add(newPointSide.clone().multiplyScalar(Z_GS)),
			};
		};

		// modify animation path for smoother animation (adding additional points)
		const cellPath: TCell[] = chosenMove.path.map((id) => {
			const [c, i, j] = nkeyinv(id);
			return cells[c][i][j];
		});
		const path: TPathPoint[] = [implyPathPoint(activeCell)];

		if (cellPath[0].side.dot(activeCell.side) === 0) {
			path.push(getMiddlePointPath(activeCell, cellPath[0]));
		}

		for (const [i, c] of cellPath.entries()) {
			path.push(implyPathPoint(c));
			if (i < cellPath.length - 1) {
				const nc = cellPath[i + 1];
				if (nc.side.dot(c.side) === 0) {
					path.push(getMiddlePointPath(c, nc));
				}
			}
		}

		animation().start({
			pieces: [activePiece],
			onEnd: moveCell,
			config: {
				ease: 'quart',
				type: 'path',
				path: new CatmullRomCurve3(path.map((c) => c.cord)),
				zPath: new CatmullRomCurve3(path.map((c) => c.zCord)),
			},
		});
	} else {
		moveCell();
	}
}
