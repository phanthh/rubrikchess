# Rubrik Chess

Chess, but on a Rubik's cube. 8×8×6 board, 11 piece types, slice rotations. A lichess-style multiplayer platform around it.

<img width="675" height="620" alt="image" src="https://github.com/user-attachments/assets/8a7c89d3-fe77-4aee-8776-239829117095" />

## Features

- **Play**: quick-pairing grid, custom seeks (bullet → classical, days-per-move correspondence, unlimited), walled + rubrik-colour variants, colour choice, challenge links and direct challenges by username, custom start positions (board editor) for friend games
- **Round**: server-authoritative clocks (tenths, low-time cues, per-second ticks), takeback / draw / resign / abort / +15s, rematch, chat with history, spectators + watcher count, opponent-gone claim, first-move expiry, 100-quiet-plies draw
- **Arena tournaments**: hourly system arenas + user-created ones, auto pairing, live standings, arena chat, results on profiles
- **Accounts**: anonymous first, register to keep your Glicko-2 rating (overall + per speed); profiles with rating chart, crosstable, tournament results, follow / friends-online box; leaderboard, games archive, player search
- **Learn & improve**: interactive piece tutorial, play vs computer (4 levels, off-thread), tactics puzzles mined from played games, analysis board with branching, engine eval, full-game computer analysis (eval graph, blunder marks, move times), TV / watch page with live mini-boards
- **UI**: 3D cube or unfolded 2D net, dark/light themes, board colour sets, sounds, desktop notifications, keyboard navigation, zen mode, mobile layout

## Layout

```
crates/core     rubrik-core   pure rules engine + AI (Rust) — single source of truth
crates/wasm     rubrik-wasm   wasm-bindgen wrapper → packages/core-wasm (built, gitignored)
crates/server   rubrik-server axum: HTTP + WebSocket lobby/rooms/clocks/tournaments, sqlite
apps/web        React + react-three-fiber client (vite 8, oxlint/oxfmt)
```

Rules + protocol: see [NOTES.md](NOTES.md).

## Dev

```sh
pnpm build:wasm                     # needs rustup target wasm32-unknown-unknown + wasm-pack
pnpm install
cargo run -p rubrik-server          # :3000 (api + ws)
pnpm dev                            # :5173, proxies /api and /ws → :3000
```

Checks: `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @rubrikchess/web format:check`.
Browser flows (need playwright + chromium, dev stack running): `PW=<playwright/index.mjs> CHROME=<chrome> node apps/web/e2e/flow.mjs` (also `tournament.mjs`, `editor.mjs`, `selfplay.mjs`).

## Deploy

`docker build -t rubrikchess . && docker run -p 3000:3000 -v rubrik-data:/data rubrikchess`

Env: `PORT`, `DATABASE_PATH`, `WEB_DIST`, `SECURE_COOKIES=1` (behind TLS).
