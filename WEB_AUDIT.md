# Web + server audit (read-only scout)

## 1. Map

```
main.tsx  init(rubrik-wasm) → App
App.tsx   BrowserRouter + GameStartNav(onServerMsg game_start → /g/:id) + <Toaster/>
 ├ /        pages/lobby.tsx     seek form, seeks list, auth (register/login/logout/rename),
 │                              leaderboard, recent games. reads useNetStore (whole store).
 ├ /local   pages/local.tsx     local sandbox: newLocal(localConfig(walled)), undo, cursor
 │                              slider, walled/animate/debug switches.
 ├ /g/:id   pages/game.tsx      watch/unwatch, seats+clocks, resign/draw/rematch, move list,
 │                              chat (local state, not persisted).
 └ /u/:name pages/user.tsx      GET /api/users/:name → profile + games.

state:
  net/ws.ts    module-singleton WebSocket + backoff reconnect + outbox queue.
               useNetStore{connected, me, seeks}; onServerMsg(handler) fan-out.
  net/api.ts   fetch wrapper /api/* (me,register,login,logout,users,leaderboard,games).
  store/game.ts  ~400 LOC, the brain. WasmGame engine + snapshot(cells,turn,status,history,
               cursor,selected,legal,threats), session(mode,gameId,myColor,players,diffs,
               clock,drawOffer), settings(animate,walled,debug,lowPerf).
               render() recomputes cells (object reuse for memo); replay via WasmGame.replay
               when cursor<history.len.
  store/animation.ts  ref registry (cells/pieces/cuboids) + current animation config/progress.
  store/tooltip.ts    hovered-piece tooltip text.

r3f tree: GameCanvas(Canvas frameloop="demand", bg #101010, PerformanceMonitor→lowPerf,
  group rotation-z=PI when myColor==='black')
    → Lights, Board → Cell×384 (PlaneGeometry + canvas texture) → Piece (STL, useLoader)
                                            → CellIndicator (reachable/capturable/threat)
                     → Cuboid×N (cube body), CubeFrame (walled), Animator (useFrame lerp)
    → Controls = ArcballControls(enablePan=false)

flow: click Cell → Board.handlePick → game().play(move) | game().select(id)
      online: play → send({t:'move'}) → server → {t:'move'} → applyRemoteMove → runMove
              (animate) → engine.play → render()
      local:  runMove → engine.play → render()
```

## 2. UI/UX weaknesses

- **Theme dead**: `index.css` defines full shadcn light+`.dark` palettes; nothing ever adds
  class `dark` (rg: no occurrence). App is always light while canvas bg is `#101010` → harsh
  contrast band. No theme toggle. Tailwind config is stock shadcn (no font, no extra colors).
- **No settings persistence**: `animate/walled/debug/lowPerf` live only in zustand; no
  localStorage. Board orientation, clock presets, chat state all reset on reload.
- **Move list unreadable**: `notation()` emits raw cell ids `123>456x`, `12@y+`. No piece
  letters, no face/file-rank coords, no white/black pairing, no scroll-to-current.
- **No game-over affordance**: result only as a nav string + move-list stays; no result
  dialog/modal, no confetti/sound, no "new game" CTA (rematch button only for players).
- **No sounds at all** (no audio anywhere in src).
- **Clock UI thin**: mono-ish text `m:ss`, no low-time emphasis (<10 s tenths), no colour
  change, no progress bar, no "your turn" cue besides bold text.
- **Not responsive**: game page is `w-screen h-screen` flex-row with fixed `w-72` aside; on
  mobile canvas gets squeezed, chat+move list+seats all stacked in 288 px. Local page nav is
  a wide flex-wrap that eats vertical space. (TODOS confirms "mobile layout" pending.)
- **Lobby is a raw list stack**: no time-control presets (bullet/blitz/rapid buttons), no seek
  filters, no rating range, no colour choice, no "play vs friend" link, no live-games/TV
  section (recent games mixes finished+ongoing, only distinguished by "N plies").
- **Local page missing** rules toggles beyond walled (core supports `layout`/`setup`), no
  clock, no side-flip, no export.
- **Spectating**: no viewer count, no board flip control for spectators (flip is bound to
  `myColor` only), no watch list.
- **Accessibility**: board is canvas only, zero keyboard interaction, no focus states, no aria.
  `title`-only labels on icon buttons.
- **Chat**: no timestamps rendered, no own-message styling, no scrollback after reload, no
  spectator/player distinction, cleared on unmount/reconnect.
- **Profile page** shows rating/rd/games but no win/loss split (server tracks `wins` but
  `#[serde(skip)]`s it), no rating chart, no per-variant stats.

## 3. Server surface

HTTP (`main.rs::router`): `GET/POST /api/me`, `POST /api/register|login|logout`,
`GET /api/users/{name}`, `GET /api/leaderboard`, `GET /api/games`, `GET /api/games/{id}`,
`GET /ws`, static `WEB_DIST` w/ SPA fallback. CORS permissive, TraceLayer.

WS (`ws.rs::ClientMsg/handle`): seek, unseek, accept, watch, unwatch, move, resign, draw,
chat, rematch. Server→client: hello, lobby, game_start, game_state, move, game_end,
draw_offer, chat, rematch_offer, error. **No ping/pong** despite NOTES.md claiming it (both
sides lack it) → NOTES stale; no app-level keepalive.

Modules:
- `lobby.rs` — `Lobby{seeks: Vec<Seek>}`, one seek per user (add replaces), `msg()` full-list
  broadcast via `AppState.lobby_tx`.
- `room.rs` — `Clock` (authoritative, `on_move`/`stop`/`remaining`), `Room{game, white, black,
  clock, draw_offer, rematch_offer, diffs, tx: broadcast}`; `play/end/finish/rate`,
  `persist`, `rehydrate` on boot, `arm_timeout` (per-ply tokio timer), `evict_when_idle`.
- `rating.rs` — Glicko-2; `db.rs` — sqlite, ad-hoc `add_column` migrations.

Schema: `users(id pk, name, password_hash, rating, rd, vol, games, wins)`,
`sessions(sid pk, user_id, created_at)`,
`games(id pk, white, black, config, moves, status, clock, created_at, updated_at,
white_rating, black_rating, white_diff, black_diff)`. No indexes beyond PKs.

Hooks for new features:
- **Challenge links**: extend `lobby::Seek` with `target_user`/`private: bool` (or a separate
  `challenges` map in `AppState`), skip lobby broadcast, accept path already exists
  (`ws.rs::start_game`). Client: `/c/:id` route → send `{t:"accept"}`.
- **Preferences**: `db::add_column(conn,"users","prefs","TEXT")` + `GET/POST /api/prefs`;
  client reads on `hello` (extend `User`) — cheapest is client-side localStorage first.
- **Takeback**: mirror draw-offer machinery in `room.rs` (`takeback_offer: Option<Color>`) +
  `ClientMsg::Takeback`; needs `Game::undo` in core (WasmGame exposes `undo()`), then
  broadcast a fresh `game_state` (clients have no "unmove" path today).
- **Game export**: `db::load_game` already returns config+moves → add
  `GET /api/games/{id}/export` returning JSON/text; client button on game page.
- **TV / watch list**: `AppState.rooms` is the live set → add `GET /api/live` (map rooms →
  {id, players, plies}) or a lobby broadcast field; "TV" = pick room with most subscribers
  (`tx.receiver_count()`) and auto-`watch`.

## 4. Bugs / smells

- **Clock spec unvalidated** (`ws.rs::Seek` → `Clock::new`): client may send
  `initial_ms: 0` (lobby allows minutes=0) or negative/huge values; `arm_timeout` then flags
  instantly or sleeps ~forever. Needs clamping server-side.
- **Chat rate limit is per-connection** (`chats` HashMap lives in `session_loop`) → multiple
  tabs multiply the allowance. NOTES says "per user per room".
- **Session cookie lacks `Secure`** (`main.rs::set_cookie`) — fine behind dev http, should be
  set in prod TLS deployments.
- **Cell textures**: one 500×500 canvas `Texture` per cell, cached in a module `Map` keyed
  `id-color-debug`, never evicted → ~384 textures alive (+384 more when debug toggled).
  Big VRAM for what could be 2–6 shared textures / vertex colours.
- `useInteractiveMesh` cleanup sets `document.body.style.cursor='auto'` on *every* dep change;
  overlapping hovers fight → cursor flicker. Also `setColor` state duplicating derivable value.
- `LobbyPage` subscribes to whole `useNetStore()` → re-renders on every lobby broadcast.
- Unmount `send({t:'unwatch'})` while socket down gets queued in `outbox` and replayed after
  reconnect → can unsubscribe a room you just re-entered.
- No pagination on `/api/games`, no index on `games(white,black,created_at)` (TODOS notes).
- `evict_when_idle` may be armed twice for a finished room (`finish()` + `room_of`) → two
  10-min loops; harmless but redundant.
- `Room::from_row` resets `clock.at = now_ms()` → server downtime is free time (documented).
- Leaderboard hides `rd >= 200` and anon users; new registered players silently absent with
  no explanation in UI ("no rated players yet" is the only copy).
- `wins` is `serde(skip)` in `db::User` → client cannot show W/L though it is stored.
- Chat is never persisted → reload loses room chat entirely.
