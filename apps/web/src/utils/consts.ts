import { Vector3 } from 'three';
import { PieceKind } from '@/types';
import { vec } from './funcs';

/** Cell palette index -> hex (matches rubrik-core palette). */
export const PALETTE = ['#aaaaaa', '#444444', '#aa0000', '#0000aa', '#aaaa00', '#00aa00'];

export const WHITE = PALETTE[0];
export const BLACK = PALETTE[1];
/** Piece colours, offset from the face colours so pieces stay visible on same-colour faces. */
export const PIECE_WHITE = '#f2ead8';
export const PIECE_BLACK = '#1a1a1a';

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

export const AXES: Record<'x' | 'y' | 'z', Vector3> = {
	x: vec(1, 0, 0),
	y: vec(0, 1, 0),
	z: vec(0, 0, 1),
};

export const MAX_INT = 99999;
