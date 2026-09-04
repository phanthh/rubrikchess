import { Vector3 } from 'three';
import { vec } from './funcs';

export enum EPiece {
	PAWN = 'p',
	KNIGHT = 'n',
	BISHOP = 'b',
	ROOK = 'r',
	QUEEN = 'q',
	KING = 'k',
	CAPTAIN = 'c',
	TESSERACT = 't',
	PRINCESS = 's',
	PRINCE = 'x',
	CANNON = 'o',
}

export const PIECE_NAMES: Record<EPiece, string> = {
	[EPiece.PAWN]: 'Pawn',
	[EPiece.KNIGHT]: 'Knight',
	[EPiece.BISHOP]: 'Bishop',
	[EPiece.ROOK]: 'Rook',
	[EPiece.QUEEN]: 'Queen',
	[EPiece.KING]: 'King',
	[EPiece.CAPTAIN]: 'Captain',
	[EPiece.TESSERACT]: 'Tesseract',
	[EPiece.PRINCE]: 'Prince',
	[EPiece.PRINCESS]: 'Princess',
	[EPiece.CANNON]: 'Cannon',
};

export const PIECES_TYPES = Object.keys(EPiece) as EPiece[];

export enum EColor {
	WHITE = '#aaaaaa',
	BLACK = '#444444',
	RED = '#aa0000',
	BLUE = '#0000aa',
	YELLOW = '#aaaa00',
	GREEN = '#00aa00',
}

export const XPOS = vec(1, 0, 0);
export const YPOS = vec(0, 1, 0);
export const ZPOS = vec(0, 0, 1);
export const XNEG = vec(-1, 0, 0);
export const YNEG = vec(0, -1, 0);
export const ZNEG = vec(0, 0, -1);

export const SIDES = [YPOS, XPOS, ZPOS, YNEG, XNEG, ZNEG];
export const ANGLES = [Math.PI / 2, Math.PI, -Math.PI / 2];
export const DIRS2D = [
	// adjancents
	vec(1, 0, 0),
	vec(0, 1, 0),
	vec(-1, 0, 0),
	vec(0, -1, 0),
	// diagonals
	vec(1, 1, 0).normalize(),
	vec(1, -1, 0).normalize(),
	vec(-1, 1, 0).normalize(),
	vec(-1, -1, 0).normalize(),
];

//  low i, high i, low j, high j,
export const ADJ_SIDE_MATRIX = [
	[4, 1, 5, 2],
	[3, 0, 5, 2],
	[4, 1, 3, 0],
	[4, 1, 5, 2],
	[3, 0, 5, 2],
	[4, 1, 3, 0],
];

export const MAX_INT = 99999;
export const zvec = () => {
	return new Vector3(0, 0, 0);
};
