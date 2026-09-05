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
   reason = "kingcaptured"|"resign"|"timeout"|"agreement"|"abandoned"|"noprogress" (100 plies without a capture → draw, decided by the engine)
GameConfig = {layout: number[6], setup: string, rules: {walled: bool}}   // setup: 16 rows (faces 0,3) or 48 rows (all faces), '-' empty, upper=white
Game = {config, board: {cells: Cell[384], pos_index}, turn: Color, status, history: Move[]}
```
WasmGame (JS class): `new WasmGame(config?)`, `WasmGame.fromState(game)`, `WasmGame.replay(config, moves)`,
`state()`, `turn()`, `status()`, `legalMoves(from)`, `allMoves()` → [[CellId, Move[]]], `threats()` → [[CellId, path[]]],
`rotatingCells(from, axis)`, `play(move)` (throws on illegal), `undo()`, `historyLen()`.
Server accepts a step move by `from`+last of `path` only (path may be empty-ish? no: send path with at least dest). Rotate by from+axis+sign.

## Server (crates/server) — axum + tokio + rusqlite

HTTP (all JSON; anon session cookie `sid`, user auto-created "Anon-xxxx" — but *only* on `GET /ws` and
`GET /api/me`; every other endpoint without a valid session → 401 `{"error":"no session"}`).
Cookie: `sid=...; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`, plus `Secure` when env
`SECURE_COOKIES=1` (set in the Dockerfile; assumes TLS is terminated in front of the server):
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
server→client
  {t:"hello", me:{id,name}}
  {t:"lobby", seeks:[{id, user:{id,name}, clock, walled}]}        full list on connect + on any change
  {t:"game_start", game_id}
  {t:"game_state", game_id, game: Game, white:{id,name}, black:{id,name}, clock:{white_ms, black_ms, running: Color|null, at: unix_ms}, draw_offer: Color|null}
  {t:"move", game_id, move: Move, ply, turn, status, clock}
  {t:"game_end", game_id, status}
  {t:"draw_offer", game_id, by: Color|null}
  {t:"error", msg}
```
Clock object everywhere = {initial_ms, increment_ms, white_ms, black_ms, running, at}. Ended game → running:null.
Every clock the server *sends* (`game_state`, `moretime`'s `clock`) is normalized: the running colour's
elapsed time is folded into its remaining ms and `at = now`, so a client may read `at` as "now on arrival"
(`move` clocks are already fresh). Room-internal semantics are unchanged.
Color on accept: random. draw_offer broadcast to whole room; decline → by:null.
Clock: server authoritative. white_ms/black_ms = remaining at `at`; client extrapolates for `running` colour.
Timeout: on each move, spawn tokio timer for deadline; on fire, if ply unchanged → end game Won{other, Timeout}.
Persistence (sqlite `data/rubrik.db`, env DATABASE_PATH): users(id TEXT pk, name), games(id TEXT pk, white, black, config JSON, moves JSON, status JSON, clock JSON, created_at, updated_at). Write on every move (cheap).
Live rooms in memory: HashMap<game_id, Room{game: rubrik_core::Game, clock, subscribers broadcast}>. Load from DB on watch if not live and finished.
Ids: 8-char random alnum for game, uuid-ish for user. Env PORT default 3000.

## Accounts + ratings (phase 3)

Every user (anon included) has a Glicko-2 rating (r=1500, rd=350, vol=0.06, tau=0.5), updated per game on end
(Won → 1/0, Draw → 0.5; Abandoned games not rated). Anon users can *register* to claim their account.
Sessions: table `sessions(sid pk, user_id, created_at)`; cookie `sid` → session → user. Users: `+ password_hash (argon2, nullable), rating, rd, vol, games INT, wins INT`.
Games: `+ white_rating, black_rating (at start), white_diff, black_diff (nullable until rated)`.
Server startup: every game still `playing` in DB → status Draw{Abandoned} (rooms were in memory).

HTTP:
```
GET  /api/me                          → User = {id, name, rating, rd, games, registered: bool}
POST /api/me {name}                   → User          (rename; name unique, 3..32 chars [A-Za-z0-9_-]; 409 if taken)
POST /api/register {name, password}   → User          (claims current anon user; 409 if name taken / already registered)
POST /api/login {name, password}      → User          (new session bound to that user; 401 on fail)
POST /api/logout                      → User          (new anon user + session)
POST /api/password {old, new}         → User          (registered only; 401 on wrong old password; 5 / 10 min)
GET  /api/users/:name                 → {user: User, games: GameRow[]}   (404)
GET  /api/leaderboard?limit=20        → User[]  (registered users with ≥1 game; established (rd < 200) first, then provisional, by rating)
GET  /api/games, /api/games/:id       → GameRow = {id, white: User, black: User, status, clock, created_at, plies, white_diff, black_diff}
```
WS: `game_state.white/black` and lobby `seeks[].user` are `User` (with rating). `game_end` gains `white_diff, black_diff` (ints, null if unrated).
Web: lobby header shows name+rating, Register/Login/Logout; leaderboard on lobby; `/u/:name` profile; game page shows ratings + diff at end.

## Chat + rematch (phase 4)
WS additions:
```
client→server
  {t:"chat", game_id, text}            text trimmed, 1..300 chars; players + spectators may chat
  {t:"rematch", game_id, offer: bool}  only players, only when game ended; both offer → new game (colours swapped, same clock/rules) → game_start to both
server→client
  {t:"chat", game_id, user: User, text, at: unix_ms}   broadcast to room; not persisted
  {t:"rematch_offer", game_id, by: Color|null}         broadcast; null = withdrawn
```
Rate limits (per user, all tabs): chat 5 / 5s per room (dropped silently); seek+challenge 10 / 10s, move 30 / 5s,
offers (draw+takeback+rematch, shared budget) 10 / 10s per game, moretime 3 / 60s per game,
watch / join / cancel_challenge 20 / 10s (→ `error "slow down"`).
`AppState.gone` + `AppState.limits` are swept every 10 min (gone entries older than 1h, spent limit windows).
A user's lobby seek is dropped when their *last* socket closes, not on every tab close.

## Phase 5: pairing, takeback, challenges, tv, presence, rating history

Seek validation (server): live `0 <= initial_ms <= 180*60_000`, `0 <= increment_ms <= 180_000`; or correspondence `initial_ms == increment_ms == N days` (1..=14) → else `error`. Both zero = **unlimited** (correspondence): clock still reports `running`, but no flag-fall timer is armed.
Seek gains `color: "white"|"black"|"random"` (default random). **Quick pairing**: on `seek`, if lobby has a seek by another user with equal clock+walled and compatible colour (random matches anything; white matches black/random) → start game immediately (seeker's colour honoured, else random), no lobby entry. Otherwise seek is added as before. `accept` also honours the seek's colour.

Chat rate limit moves to `AppState` (per user+room, not per connection).

WS additions:
```
client→server
  {t:"takeback", game_id, offer: bool}   players only, game playing, history non-empty. Accept (offer:true when opponent has pending offer) →
                                         undo at least one ply, then until it is the *requester's* turn (1 or 2 plies),
                                         clock: running = new turn, at = now, times unchanged.
                                         Server broadcasts full `game_state` (clients reload). Any move clears pending takeback offer.
  {t:"challenge", clock, walled, color, to?: username}  creates in-memory challenge (with `to`: direct — only that user may join; they receive {t:"challenge_in", challenge}) {id (8 chars), user, clock, walled, color, created_at}; expires after 1h; **one public link + one direct challenge per user** (a new one replaces the previous of the *same kind*, so challenging a player no longer kills the public link being shared); `challenge_in` is sent after the challenge is in the map.
                                         reply {t:"challenge", challenge: Challenge}
  {t:"cancel_challenge"}
  {t:"join", challenge_id}               other user joins → game created (creator gets `color`, random resolved) → game_start to both. Error if missing/own.
  {t:"claim", game_id}                   opponent has been fully disconnected (no ws conns) >= 60s while game playing → claimer wins Won{Abandoned}.
                                         Won{Abandoned} IS rated (Draw{Abandoned} from restart is not). Error otherwise.
server→client
  {t:"takeback_offer", game_id, by: Color|null}
  {t:"challenge", challenge: Challenge}                      Challenge = {id, user: User, clock, walled, color}
  {t:"watchers", game_id, n}                                 broadcast on change (n = subscribed connections incl. players)
  {t:"presence", game_id, white: bool, black: bool}          broadcast when a player's connection count goes 0↔>0 (also included in game_state)
  game_state gains: watchers: n, presence: {white, black}, takeback_offer: Color|null, white_diff/black_diff (null until rated)
```
Presence: server tracks per room via `AppState.conns` (user has ≥1 socket) + `AppState.gone` (user id → ms of last socket close). On a player's last socket closing, spawn 60s timer; if still gone and game playing → broadcast `{t:"gone", game_id, color}` so opponent UI can show "claim victory". `claim` re-checks (gone ≥60s) server-side.

As implemented: `watchers` is a counter on `Room` (inc on `watch`, dec on `unwatch`/socket close) and the
broadcast includes the watcher who just joined (so a lone watcher first sees `n:1`). Pairing (quick pair,
`accept`, challenge `join`) all go through `ws::pair`, which drops both players' lobby seeks. `challenge`
replaces the sender's previous challenge and prunes expired ones. Takeback accept broadcasts `game_state`
and re-arms the flag-fall timer.

HTTP additions:
```
GET /api/tv                          → [{id, white: User, black: User, clock: ClockSpec, plies, watchers, created_at}]  live rooms with status playing, sorted by watchers desc, then max rating desc
GET /api/challenges/:id              → Challenge (404 if missing/expired)
GET /api/games?limit=20&before=<created_at>&user=<name>   pagination cursor, optional user filter; index games(created_at), games(white), games(black)
GET /api/users/:name                 → gains `history: [{at, rating}]` (last 100, asc) from table rating_history(user_id, game_id, at, rating) written in rate(); plus `user.wins` now serialized
```

## Phase 6: abort, moretime, online count, crosstable
WS:
```
client→server
  {t:"abort", game_id}        players only, while history.len() < 2 → game ends Draw{Abandoned} (unrated), game_end broadcast. Error otherwise.
  {t:"moretime", game_id}     players only, playing → opponent gets +15s: clock.{opp}_ms += 15000 (at unchanged), broadcast {t:"clock", game_id, clock}, re-arm timeout.
server→client
  {t:"clock", game_id, clock: Clock}
  lobby msg gains `online: n`   (distinct users with ≥1 socket) — sent whenever the lobby is broadcast; also broadcast on connect/disconnect (already happens via remove_user/broadcast_lobby; add on connect too).
```
HTTP:
```
GET /api/crosstable?a=<user_id>&b=<user_id>  → {a_score: f64, b_score: f64, games: n, recent: [{id, winner: "a"|"b"|null}] (last 10, asc)}  — decided games only (rated or not), draws 0.5.
```

## Phase 7: variants + chat history
Variant = `{walled: bool, layout: "standard"|"rubrik"}`. `rubrik` = 6 distinct face colours `[0,1,2,3,4,5]` (core `LAYOUT_RUBRIK`); affects Prince/Princess/Captain (same-colour rules).
- seek / challenge / rematch carry `layout` (default "standard"); quick pairing matches on walled+layout too. `Seek`, `Challenge`, GameRow/LiveGame expose `layout`.
- Chat history: room keeps last 50 chat lines in memory; `game_state` gains `chat: [{user, text, at}]` (not persisted across restarts).

First-move expiry: each side gets `clamp(2×inc + initial/5, 20s, 60s)` (1 day for days-per-move clocks) for its opening move (armed at start and after ply 1), unlimited (correspondence) clocks a flat **3 days**; a no-show aborts the game (`Draw{Abandoned}`, unrated). Unlimited games idle for 14 days are abandoned by the 10-min sweep. WS server sends a Ping frame every 25s of idle output.

## Phase 8: arena tournaments
In-memory `Arena` per tournament in `AppState.tournaments` + sqlite persistence (`tournaments(id, name, clock JSON, walled, layout, starts_at, duration_ms, created_by, status)`,
`tournament_players(tid, user_id, score, games, wins, joined_at)`; rows written on change, rehydrated on boot: running/created ones resume; finished ones are history).
Rules: anyone joins/leaves any time before the end. Pairing loop every 3s while `running`: players who are joined, connected (≥1 socket) and not in an unfinished tournament game are
shuffled and paired (avoid pairing the same two players twice in a row when another option exists). Colours: alternate per player (whoever has had more whites gets black). Games are
normal rated games with `tournament_id`. Score: win 2, draw 1, loss 0 (unrated aborts 0/0). Status: `created` → `running` at `starts_at` → `finished` at `starts_at + duration_ms`
(no new pairings; running games finish normally and still count). Standings sorted by score desc, then wins desc, then joined_at.

HTTP:
```
POST /api/tournaments {name (3..40 chars), clock: ClockSpec (valid, not unlimited), walled, layout, starts_in_ms (10_000..=3_600_000), duration_ms (300_000..=7_200_000)}
                                          → Tournament ; needs a session; max 3 unfinished tournaments per creator
GET  /api/tournaments                     → {upcoming: Tournament[], running: Tournament[], finished: Tournament[] (last 10)}
GET  /api/tournaments/:id                 → {tournament: Tournament, standings: Standing[], games: GameRow[] (last 20), joined: bool (for the current session)}
Tournament = {id, name, clock, walled, layout, starts_at, duration_ms, status, players: n, created_by: User}
Standing   = {user: User, score, games, wins, playing: bool}
```
WS:
```
client→server  {t:"tour_join", id}  {t:"tour_leave", id}                (errors: unknown / finished)
server→client  {t:"tour", tournament: Tournament, joined: bool}         sent to the acting user on join/leave and to everyone (lobby channel) when players count / status changes
               game_state gains `tournament_id: string|null`; GameRow / LiveGame gain `tournament_id`
               GameRow / LiveGame / game_state also carry `walled: bool` (mirror of `config.rules.walled`, so lists can label the variant)
```

As implemented: the lobby broadcast omits `joined` (it is per-user); it fires on create, join/leave and status
change, *not* on every score change (standings are polled over HTTP). Arenas that finish during a run stay in
`AppState.tournaments` (their running games still score); `GET /api/tournaments`'s `finished` list comes from the
DB, `GET /api/tournaments/:id` falls back to the DB for arenas from earlier runs. The 3-unfinished-per-creator cap
is counted with `SELECT COUNT(*)` (memory only holds this run's arenas). `tour_join`/`tour_leave` are rate limited
20 / 10s (shared budget); `POST /api/tournaments` 3 / hour per user (anonymous sessions may create arenas), name
3..40 chars with no control characters.

Pairing/scoring details:
- A player in *any* live game (casual, challenge, other arena) is not paired — never two live games at once.
- No pairing once `now + clock.initial_ms > ends_at` (lichess-style: a game that cannot finish inside the arena).
- `record_result` ignores games that finish after the arena is `finished`; the table is closed.
- A first-move abort of an arena game sets the no-show's `joined = false` (score kept), so the tick stops
  re-pairing an AFK player every 3s. They get a `tour` message with `joined: false`.
- `tour_leave` from a user who never joined creates no standings row.
- `standings` is capped at 200 rows.
- Finished arenas are dropped from `AppState.tournaments` by the tick once no live game references them
  (`GET /api/tournaments/:id` reads them back from the DB).

Lock order (`parking_lot`, no timeouts → an inversion is a hard deadlock): **`rooms` → `tournaments` → `db`**.
`GET /api/tournaments` takes `tournaments` before `db` like every other path.
Challenges (not lobby seeks) may carry `setup` (16- or 48-row board-editor position, validated: 8 chars/row, piece letters or `-`, exactly one king per side) → `GameConfig.setup`; rematches keep it.
Scheduled arenas: the tick keeps one system-owned (user `system`, name "Rubrik") tournament upcoming: next full hour (≥5 min away), 30 min, clock rotating Blitz 3+2 / Bullet 1+0 / Blitz 5+0 / Rapid 10+0 by hour. Only arenas with status `created` count, so a *running* system arena does not block the next one from being scheduled.

## Phase 9: hardening (review 3)

```
GET /api/me/games   → [{id, opponent: User, my_turn: bool, plies, clock}]   session's live games; 401 without a session
```
Cheap per-user "your turn" inbox: one pass over the live rooms, keeping only the ones the caller plays in
(`/api/tv` serialises *every* live game and is not meant to be polled per user).

Other behaviour changes:
- WS frames are capped at 64 KiB (`WebSocketUpgrade::max_message_size`); a bigger frame closes the socket.
- `valid_setup` rejects inputs over 1024 bytes (before splitting) and positions with more than 64 pieces per
  side — the server generates moves for a custom position on every ply.
- `POST /api/login` is rate limited 10 / 10 min per (lowercased) account name; over it → 429 `slow down`,
  correct password included. No session exists yet, so the name is the key.
- `POST /api/password` deletes the user's *other* sessions (the current `sid` survives): a stolen cookie dies
  with the password it was taken under.
- `POST /api/tournaments` validates name/clock/schedule *before* spending the 3-per-hour quota.
- Rate-limit windows are swept after 1h (was 1 min, i.e. shorter than the widest window).
- Rehydrated rooms arm the first-move expiry as well as the flag-fall timer.
- `Room.last_move_at` (persisted as `games.updated_at`, also exposed on `GameRow`) drives the 14-day idle sweep
  for unlimited games, so a restart no longer grants another 14 days.

## Phase 10: move times
Room keeps `times: Vec<i64>` = remaining ms of the mover *after* each ply (post-increment; unlimited clocks → 0). Persisted in `games.times` (JSON), included in `game_state` and `GET /api/games/:id` as `times`. Takeback truncates it with the history.

## Phase 11: follow / friends
Table `follows(user_id, target_id, created_at, PRIMARY KEY(user_id, target_id))`. Any session may follow (anon included); self-follow rejected.
```
POST   /api/follow/:name        → {following: true}    (404 unknown user, 400 self)
DELETE /api/follow/:name        → {following: false}
GET    /api/friends             → [{user: User, online: bool, playing: game_id|null}]   users I follow; playing = a live game they are in
GET    /api/users/:name         → gains `following: bool` (current session follows them), `followers: n`
```

As implemented: `POST`/`DELETE /api/follow/:name` share one budget of 30 / 10 min per user; `/api/friends` is
capped at 200 rows (newest follow first) and computes `playing` in one pass over the live rooms before touching
the db (lock order `rooms` → `db`). `GET /api/users/:name` reports `following: false` for a session-less request.

## Phase 12: per-speed ratings
Perf of a game from its clock: `ultrabullet` (<30s est.), `bullet` (<180s), `blitz` (<480s), `rapid` (<1500s), `classical`, `correspondence` (unlimited or days-per-move); est = initial + 40×increment (seconds), same as the client's `speedOf`.
Table `perfs(user_id, perf, rating, rd, vol, games, wins, PRIMARY KEY(user_id, perf))`. `Room::rate` updates the overall rating (unchanged, used for pairing/leaderboard) **and** the perf rating (own Glicko-2 state, default 1500/350/0.06).
`User` gains `perfs: {perf: {rating, rd, games}}` (only perfs with games > 0). `GET /api/leaderboard?perf=blitz` → ranks by that perf (registered, games > 0, established first). `rating_history` rows gain a `perf` column; `GET /api/users/:name` history stays overall.

Tournament chat: `{t:"tour_chat", id, text}` (participants only; 1..300 chars, 5 / 5s per arena) → `{t:"tour_chat", id, user, text, at}` fanned out on the lobby channel (clients filter by id); last 50 lines returned as `chat` by `GET /api/tournaments/:id`.

## Phase 13: private messages
Table `messages(id INTEGER PK, from_id, to_id, text, at, read INTEGER)`; index (to_id, at), (from_id, at).
```
POST /api/messages/:name {text}        → Message   (1..500 chars; 401 no session; 404 unknown; 400 self; 20 / 10 min)
GET  /api/messages                     → [{user: User, last: Message, unread: n}]   conversations of the current session, newest first (≤ 50)
GET  /api/messages/:name               → Message[] (last 100, asc); marks them read
Message = {id, from: user_id, to: user_id, text, at}
WS server→client {t:"pm", message: Message, from: User}   pushed to the recipient's sockets
```
Blocks: `POST/DELETE /api/block/:name` (30 / 10 min; blocking also unfollows). While either side blocks the other: `POST /api/messages/:name` → 403, direct challenges → "no such player". `GET /api/users/:name` gains `blocked: bool`.

## Phase 14: server bot
The system user (`system` / "Rubrik") plays: a direct challenge `to: "Rubrik"` is auto-accepted immediately (any clock except unlimited; colour per the challenge). After every ply where the bot is to move (and at game start when it is white), the server computes `rubrik_core::best_move(level 3)` on a blocking thread and plays it after ~600 ms (never less than 300 ms; never times out on sane clocks). Bot behaviour: declines draw and takeback offers instantly (`draw_offer`/`takeback_offer` broadcast with `by: null`), accepts rematches immediately, cannot be messaged/followed-back meaningfully (no-op). Lobby seeks never auto-match the bot. Games vs the bot are rated like any other; the bot never joins arenas.
`GET /api/bot` → `User` (so the client can show its rating). Client: lobby button "Play the bot".
Incoming challenges: `GET /api/challenges` → Challenge[] addressed to the session (open, unexpired). `{t:"decline", challenge_id}` (target only) removes it and sends the creator `{t:"challenge_declined", id, by: User}`.

## Phase 15: puzzle mining on the server
Table `puzzles(id INTEGER PK, game_id, ply, solution JSON, gain, created_at, UNIQUE(game_id, ply))` + `games.mined INTEGER DEFAULT 0`.
Background task (every 5 min, and once 30 s after boot): take up to 5 finished, unmined games with ≥ 8 plies; for each position from ply 4 on (≤ 120 plies): `base = analyse(1).score`, `greedy = analyse(2)`, `deep = analyse(3)`; a puzzle when `deep.score - base >= 300 && < 50_000 && deep.move != greedy.move` (same rule as the client). Store, mark the game mined. Runs on `spawn_blocking`; never holds locks across the search.
```
GET /api/puzzles/random?exclude=<id,id,...>   → {id, game_id, ply, solution: Move, gain, config, moves: Move[] (first `ply` plies), white: User, black: User}  or 404 when none
GET /api/puzzles/count                        → {count}
```
