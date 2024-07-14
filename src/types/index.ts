import { Canvas, Object3DNode } from '@react-three/fiber';
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
	angle: number;
	// meshRef?: RefObject<Mesh>;
};

export type TPiece = {
	id: string;
	type: EPiece;
	player: TPlayer;
};

export type TCuboid = {
	id: string;
	cord: Vector3;
};

export type TGameState = 'play:pick-piece' | 'play:pick-cell' | 'play:animate';
export type TCellState = 'reachable' | 'capturable' | 'normal' | 'active';

export type TAnimation = TAnimationRotate | TAnimationPath;
export type TAnimationRotate = {
	type: 'rotate';
	axis: Vector3;
	angle: number;
};
export type TAnimationPath = {
	type: 'path';
	path: Vector3[]; // 0->path.length <=> start -> end
};

declare module '@react-three/fiber' {
	interface ThreeElements {
		textGeometry: Object3DNode<TextGeometry, typeof TextGeometry>;
	}
}

export type TCanvasEventFactory = NonNullable<Parameters<typeof Canvas>[0]['events']>
