import { Object3DNode } from '@react-three/fiber';
import { Vector3 } from 'three';
import { TextGeometry } from 'three/examples/jsm/Addons.js';
import { EColor, EPiece } from '../utils/consts';

export type TPlayer = 'black' | 'white'; // > 2 players?
export type TBoardCord = [number, number, number];

export type TCell = {
	cord: Vector3;
	bcord: TBoardCord;
	color: EColor;
	side: Vector3;
	piece?: TPiece;
	state: TCellState;
};

export type TPiece = {
	type: EPiece;
	player: TPlayer;
};

export type TGameState = 'play:pick-piece' | 'play:pick-cell';
export type TCellState = 'available' | 'capturable' | 'normal' | 'active';

declare module '@react-three/fiber' {
	interface ThreeElements {
		textGeometry: Object3DNode<TextGeometry, typeof TextGeometry>;
	}
}
