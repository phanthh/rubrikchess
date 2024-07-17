import { Canvas, Object3DNode } from '@react-three/fiber';
import { Curve, Vector3 } from 'three';
import { TextGeometry } from 'three/examples/jsm/Addons.js';
import { EColor, EPiece } from '../utils/consts';

type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;

export type TPlayer = 'black' | 'white';

export type TCell = {
	id: string;
	cord: Vector3;
	color: EColor;
	side: Vector3;
	piece?: TPiece;
	state: TCellState;
	payload?: Record<string, any>;
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
	moves?: TMove[]; // if moves is undefined, then it the calculating state has not been executed
};

export type TMove = {
	path: string[]; // cell ids, final id is the target
	type: TMoveType;
};

export type TMoveType = 'capturing' | 'normal';

export type TCuboid = {
	id: string;
	cord: Vector3;
};

export type TGameState = 'play:pick-piece' | 'play:pick-cell' | 'play:animate';
export type TCellState =
	| 'reachable'
	| 'capturable'
	| 'normal'
	| 'active'
	| 'targeted'
	| 'targeted:path';

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

export type TActionCell = {
	id: string;
	piece: {
		id: string;
		type: EPiece;
		player: TPlayer;
	};
};
export type TAction = {
	cell: TActionCell;
	target?: Optional<TActionCell, 'piece'>;
	payload?: Record<string, any>;
};
