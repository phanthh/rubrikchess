# Rubrik Chess

Chess, but on a Rubik's cube. 8×8×6 board, 11 piece types, slice rotations. Multiplayer platform (lobby, clocks, spectating) à la lichess.

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

Tests: `cargo test --workspace` (engine unit tests + server ws integration test). `pnpm typecheck`, `pnpm lint`.
Browser flow (needs playwright + chromium, dev stack running): `PW=<playwright/index.mjs> CHROME=<chrome> node apps/web/e2e/flow.mjs`.

## Deploy

`docker build -t rubrikchess . && docker run -p 3000:3000 -v rubrik-data:/data rubrikchess`
