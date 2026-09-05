import { Color, PieceKind } from '@/types';

/**
 * Flat piece silhouettes in a 100×100 box. Standard pieces follow the usual
 * staunton outlines; the fairy pieces get distinct shapes so they read at 10px:
 * prince = small crown, princess = crowned mitre, captain = star, cannon = disc
 * with a barrel, tesseract = a cube.
 */
const PATHS: Record<PieceKind, string> = {
	pawn: 'M50 16a13 13 0 1 1-.1 0zM39 44h22l7 26H32zM26 76h48v12H26z',
	rook: 'M24 16h13v11h9V16h8v11h9V16h13v24l-8 8v26l8 8v8H24v-8l8-8V48l-8-8z',
	knight:
		'M28 90h46v-7c0-22-7-38-19-48l5-11-11 3-7-11-5 9c-15 7-19 20-14 27l11-3-5 11c-9 6-12 15-3 22z',
	bishop:
		'M50 10a7 7 0 1 1-.1 0zM50 26c-15 11-21 27-15 42h30c6-15 0-31-15-42zM31 74h38v8H31zM25 86h50v6H25z',
	queen:
		'M50 8a6 6 0 1 1-.1 0zM20 24a6 6 0 1 1-.1 0zM80 24a6 6 0 1 1-.1 0zM20 36l12 34h36l12-34-15 14-7-26-8 20-8-20-7 26zM29 76h42v10H29z',
	king: 'M46 6h8v8h8v8h-8v10h-8V22h-8v-8h8zM30 38h40l7 32H23zM26 76h48v12H26z',
	prince: 'M32 40l7-16 11 10 11-10 7 16zM31 46h38l5 26H26zM27 78h46v10H27z',
	princess:
		'M50 8l9 16H41zM50 28c-13 11-17 25-12 38h24c5-13 1-27-12-38zM31 72h38v8H31zM25 86h50v6H25z',
	captain: 'M50 8l11 27 29 2-22 19 8 28-26-16-26 16 8-28L10 37l29-2zM26 86h48v6H26z',
	cannon: 'M50 30l14-22h12L60 40zM50 34a22 22 0 1 0 .1 0zM20 82h60v10H20z',
	tesseract: 'M38 14h48L66 32H16zM14 36h48v48H14zM66 36l20-18v46L66 84z',
};

export const GLYPH_ID = (kind: PieceKind) => `pg-${kind}`;

/** `<defs>` for every piece; put once inside an `<svg>` and `<PieceUse>` it. */
export function PieceDefs() {
	return (
		<defs>
			{(Object.keys(PATHS) as PieceKind[]).map((kind) => (
				<symbol key={kind} id={GLYPH_ID(kind)} viewBox="0 0 100 100">
					<path d={PATHS[kind]} strokeWidth={7} strokeLinejoin="round" paintOrder="stroke" />
				</symbol>
			))}
		</defs>
	);
}

const FILL: Record<Color, string> = { white: '#f4f4f4', black: '#1c1c1c' };
const EDGE: Record<Color, string> = { white: '#1c1c1c', black: '#e8e8e8' };

/** A piece at (x, y) with the given size, inside an svg that rendered `<PieceDefs>`. */
export function PieceUse({
	kind,
	color,
	x = 0,
	y = 0,
	size,
}: {
	kind: PieceKind;
	color: Color;
	x?: number;
	y?: number;
	size: number;
}) {
	return (
		<use
			href={`#${GLYPH_ID(kind)}`}
			x={x}
			y={y}
			width={size}
			height={size}
			fill={FILL[color]}
			stroke={EDGE[color]}
		/>
	);
}

/** Standalone inline icon (menus, palettes, rules). */
export function PieceIcon({
	kind,
	color,
	className,
}: {
	kind: PieceKind;
	color: Color;
	className?: string;
}) {
	return (
		<svg viewBox="0 0 100 100" className={className} aria-label={kind}>
			<path
				d={PATHS[kind]}
				fill={FILL[color]}
				stroke={EDGE[color]}
				strokeWidth={6}
				strokeLinejoin="round"
				paintOrder="stroke"
			/>
		</svg>
	);
}
