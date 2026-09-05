import { game, useGameStore } from '@/store/game';
import { usePrefs } from '@/store/prefs';
import { TCell } from '@/types';
import { palette } from '@/utils/consts';
import { PieceDefs, PieceUse } from '@/components/piece-glyph';
import { cn } from '@/utils/ui';
import { memo } from 'react';

/**
 * Unfolded cube (cross net) drawn from the live cells, so every face is visible at once.
 *
 *      U
 *   L  F  R  B
 *      D
 *
 * Each face lists its normal, its screen-right and screen-up vectors (world axes, before flip),
 * and its column/row in the net grid.
 */
const FACES: {
	n: [number, number, number];
	r: [number, number, number];
	u: [number, number, number];
	col: number;
	row: number;
	label: string;
}[] = [
	{ n: [0, 1, 0], r: [1, 0, 0], u: [0, 0, -1], col: 1, row: 0, label: 'U' },
	{ n: [-1, 0, 0], r: [0, 0, 1], u: [0, 1, 0], col: 0, row: 1, label: 'L' },
	{ n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0], col: 1, row: 1, label: 'F' },
	{ n: [1, 0, 0], r: [0, 0, -1], u: [0, 1, 0], col: 2, row: 1, label: 'R' },
	{ n: [0, 0, -1], r: [-1, 0, 0], u: [0, 1, 0], col: 3, row: 1, label: 'B' },
	{ n: [0, -1, 0], r: [1, 0, 0], u: [0, 0, 1], col: 1, row: 2, label: 'D' },
];

const HALF = 16;
const STEP = 4;
const S = 10; // cell size in viewBox units
const GAP = 3;
const FACE = 8 * S;

const dot = (a: [number, number, number], b: [number, number, number]) =>
	a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function place(cell: NetCell, flipped: boolean): { x: number; y: number } | null {
	// black's view = scene rotated 180° about Z
	const p: [number, number, number] = flipped
		? [-cell.pos.x, -cell.pos.y, cell.pos.z]
		: [cell.pos.x, cell.pos.y, cell.pos.z];
	const face = FACES.find((f) => dot(f.n, p) === HALF);
	if (!face) return null;
	const c = (dot(face.r, p) + HALF - STEP / 2) / STEP;
	const r = 7 - (dot(face.u, p) + HALF - STEP / 2) / STEP;
	return { x: face.col * (FACE + GAP) + c * S, y: face.row * (FACE + GAP) + r * S };
}

const STATE_FILL: Partial<Record<TCell['state'], string>> = {
	active: '#3b82f6',
	reachable: '#22c55e',
	capturable: '#ef4444',
	targeted: '#f59e0b',
	'targeted:path': '#f59e0b',
	lastmove: '#ccaa22',
};

export type NetCell = Pick<TCell, 'id' | 'pos' | 'color' | 'piece' | 'state' | 'move'>;

export const Net = memo(function Net({
	interactive,
	className,
	cells: given,
	onCell,
}: {
	interactive?: boolean;
	className?: string;
	/** Render these instead of the game store's cells (board editor). */
	cells?: NetCell[];
	/** Editor click handler; replaces the select/play behaviour. */
	onCell?: (id: number) => void;
}) {
	const storeCells = useGameStore((s) => s.cells);
	const flipped = useGameStore((s) => s.flipped);
	const cells = given ?? storeCells;
	const theme = usePrefs((s) => s.boardTheme);
	const colors = palette(theme);
	const W = 4 * FACE + 3 * GAP;
	const H = 3 * FACE + 2 * GAP;

	return (
		<svg
			viewBox={`0 0 ${W} ${H}`}
			className={cn('w-full h-auto select-none', className)}
			aria-label="Unfolded board"
		>
			<PieceDefs />
			{FACES.map((f) => (
				<text
					key={f.label}
					x={f.col * (FACE + GAP) + FACE / 2}
					y={f.row * (FACE + GAP) + FACE / 2 + 8}
					textAnchor="middle"
					fontSize={24}
					fontWeight={700}
					fill="#888"
					fillOpacity={0.4}
				>
					{f.label}
				</text>
			))}
			{cells.map((cell) => {
				const at = place(cell, flipped);
				if (!at) return null;
				const hl = STATE_FILL[cell.state];
				return (
					<g
						key={cell.id}
						transform={`translate(${at.x} ${at.y})`}
						onClick={
							onCell
								? () => onCell(cell.id)
								: interactive
									? (e) => {
											e.stopPropagation();
											if (cell.move) game().play(cell.move);
											else game().select(cell.state === 'active' ? null : cell.id);
										}
									: undefined
						}
						className={
							onCell || (interactive && (cell.move || cell.piece)) ? 'cursor-pointer' : undefined
						}
					>
						<rect
							width={S}
							height={S}
							fill={colors[cell.color]}
							stroke="#000"
							strokeOpacity={0.25}
							strokeWidth={0.3}
						/>
						{hl && (
							<rect
								width={S}
								height={S}
								fill={hl}
								fillOpacity={cell.state === 'lastmove' ? 0.5 : 0.65}
							/>
						)}
						{cell.piece && (
							<PieceUse
								kind={cell.piece.kind}
								color={cell.piece.color}
								x={S * 0.08}
								y={S * 0.08}
								size={S * 0.84}
							/>
						)}
					</g>
				);
			})}
		</svg>
	);
});
