import { CellId, Move, PieceKind } from '@/types';

/** Face letters in engine face order: +Y +X +Z -Y -X -Z. */
export const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];

export const PIECE_LETTER: Record<PieceKind, string> = {
	pawn: '',
	knight: 'N',
	bishop: 'B',
	rook: 'R',
	queen: 'Q',
	king: 'K',
	prince: 'X',
	princess: 'S',
	captain: 'C',
	cannon: 'O',
	tesseract: 'T',
};

/** `Ua1` … `Bh8`: face letter, file (j), rank (i). */
export function cellName(id: CellId): string {
	const face = Math.floor(id / 64);
	const i = Math.floor((id % 64) / 8);
	const j = id % 8;
	return `${FACES[face]}${'abcdefgh'[j]}${i + 1}`;
}

/** `NUb1-Fc3`, `Qxd4`-style capture `NUb1xFc3`, rotation `TUb1@y+`. */
export function notation(move: Move, kind?: PieceKind): string {
	const p = kind ? PIECE_LETTER[kind] : '';
	const from = cellName(move.from);
	if (move.kind === 'rotate') return `${p || 'T'}${from}@${move.axis}${move.sign > 0 ? '+' : '-'}`;
	const to = cellName(move.path[move.path.length - 1]);
	return `${p}${from}${move.capture ? 'x' : '-'}${to}`;
}

/** Plain-text move list, `1. w b 2. w b …`. */
export function moveText(sans: string[]): string {
	const out: string[] = [];
	for (let i = 0; i < sans.length; i += 2) {
		out.push(`${i / 2 + 1}. ${sans[i]}${sans[i + 1] ? ' ' + sans[i + 1] : ''}`);
	}
	return out.join(' ');
}
