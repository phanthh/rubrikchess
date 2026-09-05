# Rubrik Chess

Chess, but on a Rubik's cube. 8×8×6 board, 11 piece types, slice rotations. Multiplayer platform à la lichess.

Features: quick pairing + custom seeks (time incl. unlimited/correspondence, walled + rubrik-colour variants, colour), challenge-a-friend links,
arena tournaments, server clocks w/ low-time cues, takeback / draw / resign / abort / +15s, rematch, chat w/ history, spectating + watcher count, TV,
opponent-gone claim, first-move expiry, accounts + Glicko-2, profiles w/ rating chart, head-to-head crosstable, leaderboard, games archive,
analysis board with branching, engine eval + full-game computer analysis (eval graph, blunder marks), board editor (custom positions, also for friend challenges), interactive piece tutorial, tactics puzzles mined from played games, play vs computer (4 levels, in a worker), 3D cube or unfolded 2D net, move list w/ keyboard nav, zen mode,
board colour themes, sounds, desktop notifications, mobile layout.

<img width="675" height="620" alt="image" src="https://github.com/user-attachments/assets/8a7c89d3-fe77-4aee-8776-239829117095" />

## Layout

```
crates/core     rubrik-core   pure rules engine (Rust) — single source of truth
crates/wasm     rubrik-wasm   wasm-bindgen wrapper → packages/core-wasm (built, gitignored)
crates/server   rubrik-server axum: HTTP + WebSocket lobby/rooms/clocks, sqlite
apps/web        React + react-three-fiber client
```

Rules + protocol: see [NOTES.md](NOTES.md).

## Dev

```sh
pnpm build:wasm                     # needs rustup target wasm32-unknown-unknown + wasm-pack
pnpm install
cargo run -p rubrik-server          # :3000 (api + ws)
pnpm dev                            # :5173, proxies /api and /ws → :3000
```

Tests: `cargo test --workspace` (engine unit tests + server ws integration test). `pnpm typecheck`, `pnpm lint` (oxlint), `pnpm --filter @rubrikchess/web format:check` (oxfmt).
Browser flows (need playwright + chromium, dev stack running): `PW=<playwright/index.mjs> CHROME=<chrome> node apps/web/e2e/flow.mjs` (also `e2e/tournament.mjs`, `e2e/editor.mjs`, `e2e/selfplay.mjs`).

## Deploy

`docker build -t rubrikchess . && docker run -p 3000:3000 -v rubrik-data:/data rubrikchess`
