# Rubrikchess platform — architecture notes

Goal: lichess-like multiplayer platform for Rubrik Chess (chess on 8x8x6 cube).

## Layout (target)

```
rubrikchess/
  Cargo.toml              # rust workspace
  pnpm-workspace.yaml
  package.json            # root scripts only
  crates/
    core/                 # rubrik-core: pure rules engine (board, movegen, apply, game status). No IO.
    wasm/                 # rubrik-wasm: wasm-bindgen wrapper of core for browser
    server/               # rubrik-server: axum HTTP+WS. lobby, seeks, game rooms, clocks, sqlite
  apps/
    web/                  # vite + react + r3f client (moved from repo root)
  packages/
    core-wasm/            # wasm-pack output (gitignored); npm name `rubrik-wasm`
```

## Game rules (as implemented in original TS `src/store/game.ts`)

Geometry: cube side CU_S=32, cell C_S=4, 8x8 per face, 6 faces = 384 cells.
Cell pos = integer vec; one comp = ±16 (face normal), others ∈ {-14,-10,...,14}.
Cells have fixed id (face,i,j) + fixed color; pos/side change under Tesseract rotation.
Face order (SIDES): +Y, +X, +Z, -Y, -X, -Z. White pieces start face 0 (+Y), black face 3 (-Y).
Layout `standard`: colors [W,W,B,B,W,B] per face. `rubrik`: 6 distinct colors.

distSq units (C_S²=16): 0.5→8 (orth across edge), 1→16 (orth), 1.5→24 (diag across edge), 2→32 (diag).
`walled` flag: no movement across edges.

Pieces (letter):
- p Pawn: move to empty at dist 8/16 (8 only if !walled); capture enemy at 24/32. Any direction. No promotion.
- n Knight: distSq ∈ {80, 56} or (72 & target edge/corner & distToCenter≠52) or (40 & either corner). walled → same face only.
- b Bishop: diagonal walk (climbs edges unless walled).
- r Rook: orthogonal walk.
- q Queen: rook+bishop.
- k King: dist {8,24 (!walled), 16, 32}. Capturing king = win.
- x Prince: king moves but only onto same-color cells.
- s Princess: queen walk but only over same-color cells.
- c Captain: BFS over same-color empty cells (orth adjacency) = normal moves; plus king moves (capture ok).
- o Cannon: capture/move to pos rotated ±90° about tangential axes (4 targets); plus king-moves non-capturing.
- t Tesseract: king moves; plus ROTATE: rotate slice/face (cells where pos·axis == own pos·axis, ± C_S/2) by ±90° about X/Y/Z.

Walk climb (rook): off-edge → newDir = -side, cursor = cursor - dir*2 + newDir*2.
Walk climb (bishop): clamped=clamp(cursor,±16); newSide = norm(cursor-clamped); dir = norm(norm(proj(dir, plane newSide)) - side); cursor = clamped - side*2.
  Off a corner diagonally → never lands on cell → stops.
Walk stops when cursor == start (looped around cube) or maxIter 384.

Win: king captured (original had no end condition; highlighted attacked king/prince only).

## Decisions
- Rust core is single source of truth; wasm for client movegen/highlight; server validates.
- Undo = replay history from initial state (cheap; 384 cells).
- Anonymous players first (cookie session), accounts later.

## Core API (crates/core, exposed via crates/wasm → packages/core-wasm, npm name `rubrik-wasm`)

Build wasm: `pnpm build:wasm` (wasm-pack, target web, out packages/core-wasm — gitignored, build artifact).

Types (JSON, serde):
```
CellId = number (0..384) = face*64 + i*8 + j ; face order +Y,+X,+Z,-Y,-X,-Z
V3 = {x,y,z}  (ints; cell centres: one comp ±16, others in -14..14 step 4)
Color = "white"|"black"
PieceKind = "pawn"|"knight"|"bishop"|"rook"|"queen"|"king"|"captain"|"tesseract"|"princess"|"prince"|"cannon"
Piece = {kind, color, id: CellId}            // id = origin cell, stable identity for animation
Cell = {pos: V3, side: V3, color: 0..5, piece: Piece|null}   // color palette idx: 0 white 1 black 2 red 3 blue 4 yellow 5 green
Move = {kind:"step", from, path: CellId[], capture: bool}
     | {kind:"rotate", from, axis:"x"|"y"|"z", sign: 1|-1}
Status = {kind:"playing"} | {kind:"won", winner: Color, reason} | {kind:"draw", reason}
   reason = "kingcaptured"|"resign"|"timeout"|"agreement"|"abandoned"
GameConfig = {layout: number[6], setup: string, rules: {walled: bool}}
Game = {config, board: {cells: Cell[384], pos_index}, turn: Color, status, history: Move[]}
```
WasmGame (JS class): `new WasmGame(config?)`, `WasmGame.fromState(game)`, `WasmGame.replay(config, moves)`,
`state()`, `turn()`, `status()`, `legalMoves(from)`, `allMoves()` → [[CellId, Move[]]], `threats()` → [[CellId, path[]]],
`rotatingCells(from, axis)`, `play(move)` (throws on illegal), `undo()`, `historyLen()`.
Server accepts a step move by `from`+last of `path` only (path may be empty-ish? no: send path with at least dest). Rotate by from+axis+sign.

## Server (crates/server) — axum + tokio + rusqlite

HTTP (all JSON; anon session cookie `sid` set on first request, user auto-created "Anon-xxxx"):
```
GET  /api/me                → {id, name}
POST /api/me  {name}        → {id, name}
GET  /api/games?limit=20    → [{id, white:{id,name}, black:{id,name}, status, created_at, plies}]
GET  /api/games/:id         → {id, white, black, config, moves: Move[], status, clock:{initial_ms, increment_ms}, created_at}
GET  /ws                    → websocket (session from cookie)
static: serve apps/web/dist at / with SPA fallback (env WEB_DIST, default ../../apps/web/dist)
```
WS messages `{t: "...", ...}`:
```
client→server
  {t:"seek", clock:{initial_ms, increment_ms}, walled: bool}   one seek per user; replaces existing
  {t:"unseek"}
  {t:"accept", seek_id}                                          creates game, both get game_start
  {t:"watch", game_id}                                           subscribe (player or spectator); replies game_state
  {t:"unwatch", game_id}
  {t:"move", game_id, move: Move}
  {t:"resign", game_id}
  {t:"draw", game_id, offer: bool}                               offer true = offer/accept, false = decline/withdraw
  {t:"ping"}
server→client
  {t:"hello", me:{id,name}}
  {t:"lobby", seeks:[{id, user:{id,name}, clock, walled}]}        full list on connect + on any change
  {t:"game_start", game_id}
  {t:"game_state", game_id, game: Game, white:{id,name}, black:{id,name}, clock:{white_ms, black_ms, running: Color|null, at: unix_ms}, draw_offer: Color|null}
  {t:"move", game_id, move: Move, ply, turn, status, clock}
  {t:"game_end", game_id, status}
  {t:"draw_offer", game_id, by: Color|null}
  {t:"error", msg}
  {t:"pong"}
```
Clock object everywhere = {initial_ms, increment_ms, white_ms, black_ms, running, at}. Ended game → running:null.
Color on accept: random. draw_offer broadcast to whole room; decline → by:null.
Clock: server authoritative. white_ms/black_ms = remaining at `at`; client extrapolates for `running` colour.
Timeout: on each move, spawn tokio timer for deadline; on fire, if ply unchanged → end game Won{other, Timeout}.
Persistence (sqlite `data/rubrik.db`, env DATABASE_PATH): users(id TEXT pk, name), games(id TEXT pk, white, black, config JSON, moves JSON, status JSON, clock JSON, created_at, updated_at). Write on every move (cheap).
Live rooms in memory: HashMap<game_id, Room{game: rubrik_core::Game, clock, subscribers broadcast}>. Load from DB on watch if not live and finished.
Ids: 8-char random alnum for game, uuid-ish for user. Env PORT default 3000.
