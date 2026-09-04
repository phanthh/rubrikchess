# TODOS

Done: monorepo, rust rules engine (parity-verified vs old TS), wasm, axum server (lobby/rooms/clocks/sqlite/accounts/glicko-2/chat/rematch/restart-rehydrate), web client (lobby, online game w/ flip for black, local sandbox, profiles, leaderboard, rules panel), CI, Dockerfile.

## Next
- [ ] disconnect handling: abandon after grace period (clock timeout covers it for now)
- [ ] rate limit seeks/moves per user (chat has one)
- [ ] variants: rubrik colour layout + custom setups as seek options (core supports `GameConfig.layout/setup`)
- [ ] analysis board: branch from a history cursor in local mode
- [ ] mobile layout for game page
- [ ] server: paginate /api/games; index games(white, black, created_at)
- [ ] react-hooks eslint 7 (react-compiler rules) — needs hooks.ts/user.tsx rewrites
