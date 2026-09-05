# TODOS

Done: see README features. Verified by cargo tests, clippy, oxlint/oxfmt, tsc, vite build, Playwright flows (`apps/web/e2e`), Docker smoke test.

## Next (ideas, none blocking)
- [ ] oxlint: re-enable react/set-state-in-effect + react/purity + exhaustive-effect-dependencies (React Compiler rules); refactor use-clock / TourClock / hooks.ts
- [ ] Glicko-2 RD inflation for inactivity (rating periods); currently only updated per game
- [ ] server-side puzzle cache (scan finished games once, serve `/api/puzzles`) instead of per-visitor scanning
- [ ] IP-level rate limiting in front of login / anon session minting (proxy or tower layer)
- [ ] per-arena broadcast channel for tournament chat (now fanned out on the lobby channel)
- [ ] studies / shared annotated analyses; teams; i18n
