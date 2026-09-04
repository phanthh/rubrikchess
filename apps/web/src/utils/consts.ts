import { Vector3 } from 'three';
import { PieceKind } from '@/types';
import { vec } from './funcs';

/** Cell palette index -> hex (matches rubrik-core palette). */
export const PALETTE = ['#aaaaaa', '#444444', '#aa0000', '#0000aa', '#aaaa00', '#00aa00'];

export const WHITE = PALETTE[0];
export const BLACK = PALETTE[1];

export const PIECE_NAMES: Record<PieceKind, string> = {
	pawn: 'Pawn',
	knight: 'Knight',
	bishop: 'Bishop',
	rook: 'Rook',
	queen: 'Queen',
	king: 'King',
	captain: 'Captain',
	tesseract: 'Tesseract',
	princess: 'Princess',
	prince: 'Prince',
	cannon: 'Cannon',
};

export const XPOS = vec(1, 0, 0);
export const YPOS = vec(0, 1, 0);
export const ZPOS = vec(0, 0, 1);

export const AXES: Record<'x' | 'y' | 'z', Vector3> = { x: XPOS, y: YPOS, z: ZPOS };

export const MAX_INT = 99999;

export const zvec = () => new Vector3(0, 0, 0);
