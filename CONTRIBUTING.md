# Contributing

## Before opening a pull request

```sh
cargo fmt --all -- --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
pnpm build:wasm
pnpm typecheck && pnpm lint
pnpm --filter @rubrikchess/web format:check
pnpm build
```

Keep changes focused. Add a regression test for non-trivial server or rules changes. Do not commit generated WASM, `node_modules`, SQLite data, credentials, or `.env` files.

## Reporting bugs

Use a GitHub issue with expected behavior, actual behavior, reproduction steps, browser/OS, and screenshots or logs when useful. Report security issues through [SECURITY.md](SECURITY.md), not public issues.
