import { Vector3 } from 'three';
import { PieceKind } from '@/types';
import { vec } from './funcs';

/** Light/dark face colours per board theme; indices 2..5 (rubrik layout) are fixed. */
export const BOARD_THEMES = {
	grey: ['#aaaaaa', '#444444'],
	wood: ['#d5b48a', '#6e4a2c'],
	blue: ['#9db5c2', '#3b5566'],
	green: ['#b7c4a1', '#4b6b45'],
} as const;
export type BoardTheme = keyof typeof BOARD_THEMES;

/** Cell palette index -> hex (matches rubrik-core palette). */
export function palette(theme: BoardTheme): string[] {
	return [...BOARD_THEMES[theme], '#b8433a', '#3b6fb6', '#d3a72e', '#4a9a4f'];
}
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
