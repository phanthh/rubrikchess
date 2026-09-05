# TODOS

Done: monorepo, rust rules engine (parity-verified vs old TS), wasm, axum server (lobby/rooms/clocks/sqlite/accounts/glicko-2/chat/rematch/restart-rehydrate), web client (lobby, online game w/ flip for black, local sandbox, profiles, leaderboard, rules panel), CI, Dockerfile.

## Roadmap: lichess parity (see LILA_FEATURES.md, WEB_AUDIT.md)

P1 UI shell + theme (web)
- [ ] dark lichess-like theme, typography, shared `Shell` (top nav: Play / Watch / Leaderboard / user menu / prefs)
- [ ] lobby: quick-pairing grid + custom seek dialog + seeks table + sidebar (live games, leaderboard, recent)
- [ ] game page: lichess round layout (opp bar+clock / move list / controls / my bar+clock), low-time clock style, nav buttons + arrow keys, result box, chat tabs, spectator count

P2 prefs + sound (web)
- [ ] persisted prefs store (sound, animation, confirm resign/draw, palette, auto-flip)
- [ ] synthesized sounds: move, capture, low time, game end, challenge

P3 server features
- [ ] quick pairing: seek auto-matches identical seek from other user
- [ ] takeback request/accept
- [ ] challenge link (create → /c/:id → join)
- [ ] live games list (GET /api/tv) + watcher count in room
- [ ] rating history → profile chart
- [ ] disconnect grace → abandon
- [ ] rate limit seeks/moves
- [ ] paginate /api/games; index games(white, black, created_at)

P4 play vs computer (core: material search; wasm export; local page)
P5 mobile layout
P6 variants: rubrik colour layout + custom setups as seek options
P7 analysis board: branch from history cursor in local mode
- [ ] react-hooks eslint 7 (react-compiler rules) — needs hooks.ts/user.tsx rewrites
