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

export type EndReason =
	| 'kingcaptured'
	| 'resign'
	| 'timeout'
	| 'agreement'
	| 'abandoned'
	| 'noprogress';

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
	| 'targeted:path'
	| 'lastmove';

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
};

// ---------------------------------------------------------------------------
// Server protocol (see NOTES.md)
// ---------------------------------------------------------------------------

export type User = {
	id: string;
	name: string;
	rating: number;
	rd: number;
	games: number;
	wins?: number;
	registered: boolean;
};
export type ClockSpec = { initial_ms: number; increment_ms: number };
/** Server clock: remaining times as of `at`, extrapolate for `running`. */
export type ClockState = ClockSpec & {
	white_ms: number;
	black_ms: number;
	running: Color | null;
	at: number; // unix ms
};
export type SeekColor = 'white' | 'black' | 'random';
export type Layout = 'standard' | 'rubrik';
export type Seek = {
	id: string;
	user: User;
	clock: ClockSpec;
	walled: boolean;
	color?: SeekColor;
	layout?: Layout;
};
export type Challenge = {
	id: string;
	user: User;
	clock: ClockSpec;
	walled: boolean;
	color: SeekColor;
	layout?: Layout;
	to?: User;
	setup?: string;
};
export type Presence = { white: boolean; black: boolean };
export type LiveGame = {
	id: string;
	white: User;
	black: User;
	clock: ClockSpec;
	plies: number;
	watchers: number;
	layout?: Layout;
	walled?: boolean;
	created_at: number;
};
export type RatingPoint = { at: number; rating: number };
export type Tournament = {
	id: string;
	name: string;
	clock: ClockSpec;
	walled: boolean;
	layout: Layout;
	starts_at: number;
	duration_ms: number;
	status: 'created' | 'running' | 'finished';
	players: number;
	created_by: User;
};
export type Standing = { user: User; score: number; games: number; wins: number; playing: boolean };
export type Crosstable = {
	a_score: number;
	b_score: number;
	games: number;
	recent: { id: string; winner: 'a' | 'b' | null }[];
};

export type GameRow = {
	id: string;
	white: User;
	black: User;
	status: Status;
	clock: ClockSpec;
	created_at: number;
	plies: number;
	layout?: Layout;
	walled?: boolean;
	tournament_id?: string | null;
	white_diff: number | null;
	black_diff: number | null;
};

export type ClientMsg =
	| { t: 'seek'; clock: ClockSpec; walled: boolean; color?: SeekColor; layout?: Layout }
	| { t: 'unseek' }
	| { t: 'takeback'; game_id: string; offer: boolean }
	| {
			t: 'challenge';
			clock: ClockSpec;
			walled: boolean;
			color: SeekColor;
			layout?: Layout;
			to?: string;
			setup?: string;
	  }
	| { t: 'cancel_challenge' }
	| { t: 'join'; challenge_id: string }
	| { t: 'claim'; game_id: string }
	| { t: 'abort'; game_id: string }
	| { t: 'tour_join'; id: string }
	| { t: 'tour_leave'; id: string }
	| { t: 'moretime'; game_id: string }
	| { t: 'accept'; seek_id: string }
	| { t: 'watch'; game_id: string }
	| { t: 'unwatch'; game_id: string }
	| { t: 'move'; game_id: string; move: Move }
	| { t: 'resign'; game_id: string }
	| { t: 'draw'; game_id: string; offer: boolean }
	| { t: 'chat'; game_id: string; text: string }
	| { t: 'rematch'; game_id: string; offer: boolean };

export type ServerMsg =
	| { t: 'hello'; me: User }
	| { t: 'lobby'; seeks: Seek[]; online?: number }
	| { t: 'game_start'; game_id: string }
	| {
			t: 'game_state';
			game_id: string;
			game: GameState;
			white: User;
			black: User;
			clock: ClockState;
			draw_offer: Color | null;
			takeback_offer?: Color | null;
			presence?: Presence;
			watchers?: number;
			chat?: { user: User; text: string; at: number }[];
			tournament_id?: string | null;
			white_diff?: number | null;
			black_diff?: number | null;
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
	| {
			t: 'game_end';
			game_id: string;
			status: Status;
			white_diff: number | null;
			black_diff: number | null;
	  }
	| { t: 'draw_offer'; game_id: string; by: Color | null }
	| { t: 'chat'; game_id: string; user: User; text: string; at: number }
	| { t: 'rematch_offer'; game_id: string; by: Color | null }
	| { t: 'takeback_offer'; game_id: string; by: Color | null }
	| { t: 'challenge'; challenge: Challenge }
	| { t: 'challenge_in'; challenge: Challenge }
	| { t: 'watchers'; game_id: string; n: number }
	| { t: 'presence'; game_id: string; white: boolean; black: boolean }
	| { t: 'gone'; game_id: string; color: Color }
	| { t: 'clock'; game_id: string; clock: ClockState }
	| { t: 'tour'; tournament: Tournament; joined?: boolean }
	| { t: 'error'; msg: string };
