# TODOS

Done: monorepo, rust rules engine, wasm, axum server (lobby/quick pairing/rooms/clocks/sqlite/accounts/glicko-2/chat/rematch/takeback/
challenges/tv/presence+claim/abort/moretime/crosstable/rating history/restart-rehydrate), core AI, web client (lichess-style shell +
lobby, round page, prefs, sounds, analysis board, vs computer, profiles, tv, challenge pages), CI, Dockerfile, e2e flow script.

## Next
- [ ] engine: iterative deepening with a time limit instead of the fixed node budget; per-speed ratings (bullet/blitz/rapid/correspondence)
- [ ] oxlint: re-enable react/set-state-in-effect + react/purity + exhaustive-effect-dependencies (React Compiler rules) and refactor use-clock/tournament countdown/hooks.ts
