import { vec } from './funcs';

export enum EPiece {
	PAWN = 'p',
	KNIGHT = 'n',
	BISHOP = 'b',
	ROOK = 'r',
	QUEEN = 'q',
	KING = 'k',
	CAPTAIN = 'c',
	SCOUT = 's',
}

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

export const SIDES = [YPOS, YNEG, XPOS, XNEG, ZPOS, ZNEG];
export const SIDES_COLOR = [
	EColor.WHITE,
	EColor.BLACK,
	EColor.RED,
	EColor.BLUE,
	EColor.YELLOW,
	EColor.GREEN,
];
