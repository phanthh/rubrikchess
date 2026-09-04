# TODOS

## Phase 1 — foundation
- [x] Monorepo: apps/web, pnpm + cargo workspaces
- [x] crates/core: rules engine, 19 tests, parity vs old TS engine verified (2832 piece-positions, 0 diff)
- [x] crates/wasm bindings
- [ ] apps/web: use wasm core instead of TS movegen; drop playroomkit

## Phase 2 — server
- [ ] crates/server: axum, WS protocol, lobby (seeks), game rooms, clocks, anon sessions
- [ ] sqlite persistence (games, moves)
- [ ] apps/web: lobby page, game page over WS, spectate

## Phase 3 — platform
- [ ] accounts (username/password), ratings (glicko2)
- [ ] game list / replay / analysis board
- [ ] docker compose deploy
