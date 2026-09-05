import { CellId, Color, PieceKind } from '@/types';

const KIND_BY_LETTER: Record<string, PieceKind> = {
	p: 'pawn',
	n: 'knight',
	b: 'bishop',
	r: 'rook',
	q: 'queen',
	k: 'king',
	x: 'prince',
	s: 'princess',
	c: 'captain',
	o: 'cannon',
	t: 'tesseract',
};
const LETTER_BY_KIND = Object.fromEntries(Object.entries(KIND_BY_LETTER).map(([l, k]) => [k, l])) as Record<PieceKind, string>;

export type Placement = { kind: PieceKind; color: Color };

/** 48-row setup string (8 rows per face, face order) from a sparse placement map. */
export function toSetup(pieces: Map<CellId, Placement>): string {
	const rows: string[] = [];
	for (let id = 0; id < 384; id += 8) {
		let row = '';
		for (let j = 0; j < 8; j++) {
			const p = pieces.get(id + j);
			const l = p ? LETTER_BY_KIND[p.kind] : '-';
			row += p?.color === 'white' ? l.toUpperCase() : l;
		}
		rows.push(row);
	}
	return rows.join('\n');
}

/** Inverse of `toSetup`; accepts the short 16-row form too (faces 0 and 3). */
export function fromSetup(setup: string): Map<CellId, Placement> {
	const rows = setup.split(/\s+/).filter(Boolean);
	const faces = rows.length >= 48 ? [0, 1, 2, 3, 4, 5] : [0, 3];
	const out = new Map<CellId, Placement>();
	faces.forEach((face, fi) => {
		for (let i = 0; i < 8; i++) {
			const row = rows[fi * 8 + i] ?? '';
			for (let j = 0; j < 8; j++) {
				const ch = row[j];
				const kind = ch && KIND_BY_LETTER[ch.toLowerCase()];
				if (kind) out.set(face * 64 + i * 8 + j, { kind, color: ch === ch.toUpperCase() ? 'white' : 'black' });
			}
		}
	});
	return out;
}

/** URL-safe: rows joined by "/" (newlines are ugly in query strings). */
export const encodeSetup = (setup: string) => setup.replace(/\n/g, '/');
export const decodeSetup = (s: string) => s.replace(/\//g, '\n');
