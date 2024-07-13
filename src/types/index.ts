import { Object3DNode } from '@react-three/fiber';
import { Vector3 } from 'three';
import { TextGeometry } from 'three/examples/jsm/Addons.js';
import { EColor, EPiece } from '../utils/consts';

export type TPlayer = 'black' | 'white'; // > 2 players?
export type TCell = {
	id: string;
	cord: Vector3;
	color: EColor;
	side: Vector3;
	piece?: TPiece;
	state: TCellState;
	payload?: Record<any, any>;
};

export type TPiece = {
	id: string;
	type: EPiece;
	player: TPlayer;
	path?: Vector3[];
};

export type TGameState = 'play:pick-piece' | 'play:pick-cell';
export type TCellState = 'reachable' | 'capturable' | 'normal' | 'active';

declare module '@react-three/fiber' {
	interface ThreeElements {
		textGeometry: Object3DNode<TextGeometry, typeof TextGeometry>;
	}
}
