# TODOS

## Phase 1 — foundation
- [ ] Monorepo: move web to apps/web, pnpm workspace, Cargo workspace
- [ ] crates/core: board, movegen (all pieces), apply, status, tests vs rules in NOTES.md
- [ ] crates/wasm: bindings (new game, legal moves, apply, state json)
- [ ] apps/web: use wasm core instead of TS movegen; drop playroomkit

## Phase 2 — server
- [ ] crates/server: axum, WS protocol, lobby (seeks), game rooms, clocks, anon sessions
- [ ] sqlite persistence (games, moves)
- [ ] apps/web: lobby page, game page over WS, spectate

## Phase 3 — platform
- [ ] accounts (username/password), ratings (glicko2)
- [ ] game list / replay / analysis board
- [ ] docker compose deploy
