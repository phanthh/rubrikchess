# TODOS

## Phase 1 — foundation
- [x] Monorepo: apps/web, pnpm + cargo workspaces
- [x] crates/core: rules engine, 19 tests, parity vs old TS engine verified (2832 piece-positions, 0 diff)
- [x] crates/wasm bindings
- [x] apps/web: use wasm core instead of TS movegen; drop playroomkit

## Phase 2 — server
- [x] crates/server: axum, WS protocol, lobby (seeks), game rooms, clocks, anon sessions
- [x] sqlite persistence (games, moves)
- [x] apps/web: lobby page, game page over WS, spectate
- [x] camera oriented to player's own face
- [ ] disconnect handling: abandon after grace period
- [ ] rate limits on seeks/moves

## Phase 3 — platform
- [x] accounts (username/password), ratings (glicko2), profiles, leaderboard
- [x] game list / replay (cursor stepping on game page)
- [ ] rematch button
- [ ] in-game chat
- [ ] piece move-rule help panel (11 piece types)
- [x] Dockerfile + CI
