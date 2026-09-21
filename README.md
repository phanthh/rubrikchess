# Rubrik Chess

Chess on a Rubik's cube: 8×8×6 board, 11 piece types, slice rotations. Multiplayer server + React client.

<img width="675" height="620" alt="Rubrik Chess game board" src="https://github.com/user-attachments/assets/8a7c89d3-fe77-4aee-8776-239829117095" />

## Features

- Real-time games: quick pairing, seeks, challenge links, direct challenges, rated bot, custom positions
- Server-authoritative clocks, takebacks, draws, rematches, chat, spectators, correspondence games
- Arenas, ratings, profiles, game archive, follows, blocks, private messages, leaderboards
- Tutorials, local computer, puzzles, analysis, TV/watch page
- 3D cube or unfolded 2D net; dark/light themes, sound, keyboard navigation, mobile layout

## Layout

```text
crates/core     rules engine + AI; source of truth
crates/wasm     wasm-bindgen wrapper → packages/core-wasm (generated, ignored)
crates/server   Axum HTTP/WebSocket server + SQLite
apps/web        React + react-three-fiber Vite client
```

`NOTES.md` is developer design/protocol history, not a stable public API.

## Local development

Needs Rust stable, Node 22, pnpm 8, `wasm-pack` 0.13.1, and Rust's WASM target:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --version 0.13.1 --locked
corepack enable
pnpm install
pnpm build:wasm

cargo run -p rubrik-server                    # API + WebSocket on :3000
pnpm dev                                      # Vite on :5173; proxies /api and /ws
```

Production-like local static serving:

```sh
pnpm build
WEB_DIST=apps/web/dist cargo run -p rubrik-server
```

Checks:

```sh
cargo fmt --all -- --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
pnpm typecheck && pnpm lint
pnpm --filter @rubrikchess/web format:check
pnpm build
```

Browser flows need Playwright, Chromium, and both dev processes:

```sh
PW=<playwright/index.mjs> CHROME=<chrome> node apps/web/e2e/flow.mjs
```

Also available: `tournament.mjs`, `editor.mjs`, `selfplay.mjs`.

## Deploy on one VPS

This server keeps live games, sockets, seeks, challenges, and arena state in memory. Run **one replica**. SQLite data lives in Docker volume `rubrik-data`.

1. Install Docker Engine, Docker Compose plugin, Caddy; point DNS at VPS.
2. Copy `deploy/Caddyfile.example` to `/etc/caddy/Caddyfile`, replace `example.com`, then reload Caddy. Caddy obtains TLS and proxies WebSockets automatically.
3. Start app from clone:

   ```sh
   docker compose up -d --build
   docker compose ps
   curl -fsS http://127.0.0.1:3000/healthz
   ```

`compose.yaml` binds app only to `127.0.0.1`; Caddy is public TLS endpoint. `SECURE_COOKIES=1` and `TRUST_PROXY=1` are correct only in this topology. Never set `TRUST_PROXY=1` for a directly exposed container.

Before upgrades, back up SQLite. This uses SQLite's consistent backup command:

```sh
backup_dir="$HOME/rubrik-backups"
mkdir -p "$backup_dir"
stamp=$(date +%F-%H%M%S)
tmp="/tmp/rubrik-${stamp}.db"
docker compose exec -T rubrikchess sqlite3 /data/rubrik.db ".backup '$tmp'"
if ! docker compose cp "rubrikchess:$tmp" "$backup_dir/rubrik-${stamp}.db"; then
  docker compose exec -T rubrikchess rm -f "$tmp"
  exit 1
fi
docker compose exec -T rubrikchess rm -f "$tmp"
```

Test restore on a stopped instance before relying on it. Schema migrations run at server startup; retain a backup before every image update.

## Security and privacy

The service stores account names, password hashes, session identifiers, games, chats, follows, blocks, private messages, ratings, and IP-based rate-limit counters. Operators must publish their own privacy/retention policy before accepting public users. See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under [MIT](LICENSE).
