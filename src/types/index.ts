import { Canvas, Object3DNode } from '@react-three/fiber';
import { Curve, Vector3 } from 'three';
import { TextGeometry } from 'three/examples/jsm/Addons.js';
import { EColor, EPiece } from '../utils/consts';
import { Tween } from '@tweenjs/tween.js';

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

export type TPathPoint = {
	cord: Vector3;
	zCord: Vector3;
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

export type TAnimationConfig = TAnimationRotateConfig | TAnimationPathConfig;
export type TAnimationRotateConfig = {
	type: 'rotate';
	axis: Vector3;
	angle: number;
};

export type TAnimationPathConfig = {
	type: 'path';
	path: Curve<Vector3>; // 0->path.length <=> start -> end
	zPath: Curve<Vector3>; // needed for rotating the z-axis of object,simply an offset path
	ease: 'quad' | 'quart' | 'exponential';
};

declare module '@react-three/fiber' {
	interface ThreeElements {
		textGeometry: Object3DNode<TextGeometry, typeof TextGeometry>;
	}
}

export type TCanvasEventFactory = NonNullable<Parameters<typeof Canvas>[0]['events']>;
export type TGraphic = 'low' | 'medium' | 'high';
