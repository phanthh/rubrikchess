import { Curve, Vector3 } from 'three';

// ---------------------------------------------------------------------------
// Engine types (mirror crates/core serde output, see NOTES.md)
// ---------------------------------------------------------------------------

export type CellId = number;
export type Color = 'white' | 'black';
export type Axis = 'x' | 'y' | 'z';

export type V3 = { x: number; y: number; z: number };

export type PieceKind =
	| 'pawn'
	| 'knight'
	| 'bishop'
	| 'rook'
	| 'queen'
	| 'king'
	| 'captain'
	| 'tesseract'
	| 'princess'
	| 'prince'
	| 'cannon';

export type Piece = {
	kind: PieceKind;
	color: Color;
	id: CellId; // origin cell, stable identity for animation
};

export type RawCell = {
	pos: V3;
	side: V3;
	color: number; // palette index
	piece?: Piece | null;
};

export type Move =
	| { kind: 'step'; from: CellId; path: CellId[]; capture: boolean }
	| { kind: 'rotate'; from: CellId; axis: Axis; sign: number };

export type EndReason = 'kingcaptured' | 'resign' | 'timeout' | 'agreement' | 'abandoned';

export type Status =
	| { kind: 'playing' }
	| { kind: 'won'; winner: Color; reason: EndReason }
	| { kind: 'draw'; reason: EndReason };

export type GameConfig = {
	layout: number[];
	setup: string;
	rules: { walled: boolean };
};

export type GameState = {
	config: GameConfig;
	board: { cells: RawCell[] };
	turn: Color;
	status: Status;
	history: Move[];
};

// ---------------------------------------------------------------------------
// Render types
// ---------------------------------------------------------------------------

export type TCellState =
	| 'normal'
	| 'reachable'
	| 'capturable'
	| 'active'
	| 'targeted'
	| 'targeted:path';

export type TCell = {
	id: CellId;
	pos: Vector3;
	side: Vector3;
	color: number;
	piece: Piece | null;
	state: TCellState;
	move?: Move; // move played when this cell is picked
};

export type TPathPoint = {
	pos: Vector3;
	zPos: Vector3;
};

export type TCuboid = {
	id: string;
	pos: Vector3;
};

export type TAnimationConfig = TAnimationRotateConfig | TAnimationPathConfig;

export type TAnimationRotateConfig = {
	type: 'rotate';
	axis: Vector3;
	angle: number;
};

export type TAnimationPathConfig = {
	type: 'path';
	path: Curve<Vector3>; // 0->1 <=> start -> end
	zPath: Curve<Vector3>; // offset path, orients the piece
	ease: 'quad' | 'quart' | 'exponential';
};

// ---------------------------------------------------------------------------
// Server protocol (see NOTES.md)
// ---------------------------------------------------------------------------

export type User = { id: string; name: string };
export type ClockSpec = { initial_ms: number; increment_ms: number };
/** Server clock: remaining times as of `at`, extrapolate for `running`. */
export type ClockState = ClockSpec & {
	white_ms: number;
	black_ms: number;
	running: Color | null;
	at: number; // unix ms
};
export type Seek = { id: string; user: User; clock: ClockSpec; walled: boolean };

export type GameSummary = {
	id: string;
	white: User;
	black: User;
	status: Status;
	created_at: number;
	plies: number;
};

export type ClientMsg =
	| { t: 'seek'; clock: ClockSpec; walled: boolean }
	| { t: 'unseek' }
	| { t: 'accept'; seek_id: string }
	| { t: 'watch'; game_id: string }
	| { t: 'unwatch'; game_id: string }
	| { t: 'move'; game_id: string; move: Move }
	| { t: 'resign'; game_id: string }
	| { t: 'draw'; game_id: string; offer: boolean }
	| { t: 'ping' };

export type ServerMsg =
	| { t: 'hello'; me: User }
	| { t: 'lobby'; seeks: Seek[] }
	| { t: 'game_start'; game_id: string }
	| {
			t: 'game_state';
			game_id: string;
			game: GameState;
			white: User;
			black: User;
			clock: ClockState;
			draw_offer: Color | null;
		}
	| {
			t: 'move';
			game_id: string;
			move: Move;
			ply: number;
			turn: Color;
			status: Status;
			clock: ClockState;
		}
	| { t: 'game_end'; game_id: string; status: Status }
	| { t: 'draw_offer'; game_id: string; by: Color | null }
	| { t: 'error'; msg: string }
	| { t: 'pong' };
