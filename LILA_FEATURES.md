# Lila features worth stealing for rubrikchess

Scope: small self-hosted 3D variant site. Excluded by design: puzzles, tournaments/swiss/simul,
teams, streamers, insights, bots/AI, coordinate trainer, crazyhouse/atomic bits, i18n, mod tools.
Lila paths are relative to the lila repo (`ui/*` = client, `modules/*` = scala server).

Current rubrikchess baseline (do not rebuild): lobby+seeks, live game w/ server clocks, accounts,
glicko-2, profile page, leaderboard, chat, rematch, draw offer, resign, move list w/ click cursor,
local sandbox. **No sound, no prefs, no spectator UI, no challenge links, no keyboard nav.**

## P0 — biggest UX gap per unit of work

### 1. Sound
`ui/site/src/sound.ts`, called from `ui/round/src/ctrl.ts` (`site.sound.move(...)`, `play('lowTime')`).
Sample set used: `move`, `capture`, `check`, `checkmate`, `lowTime`, `countDown`, `confirmation`,
`genericNotify`, `select`, `error`, `explosion`.
UX: move sound only on *forward* step (not on history scrub); capture ≠ move sample; game-end sound
keyed by result; `lowTime` fires once at threshold, then per-second `countDown` ticks 10→0.
rubrik map: move / rotate (own sample — tesseract turn deserves a distinct clunk) / capture / check-ish
(king attacked) / game end / opponent-joined. Volume slider + mute in prefs. Web Audio, preloaded.

### 2. Clock UI (`ui/lib/src/game/clock/clockView.ts`, `ui/round/css/_clock.scss`)
- `mm:ss`, switches to `mm:ss.t` **tenths under 10s**, `hh:mm:ss` over an hour.
- Colon separator dims for the running clock every 500ms → visible "ticking".
- Classes drive styling: `.running` (bright bg), `.emerg` (red, `millis < emergMs`, default 10% of
  initial), `.outoftime` (grey/struck).
- Optional depleting **bar** under the clock via `el.animate([scale(1)→scale(0,1)])`, `currentTime`
  synced to remaining ms → smooth, no per-frame JS.
- Clock of the player to move is the visually dominant element; opponent's is dimmed.
rubrik already extrapolates ms client-side; only the *view* is missing.

### 3. Move list: nav + keyboard (`ui/round/src/view/replay.ts`, `ui/round/src/keyboard.ts`)
- Two-column `index | white | black` grid, current move highlighted, **auto-scroll** to keep current
  ply centered (throttled 100ms, rAF).
- Buttons: |< < > >| under the list; keys `left/k` prev, `right/j` next, `up/0/home` start,
  `down/$/end` live, `f` flip, `z` zen, `?` keyboard-help dialog.
- Draw offers rendered inline as `½?` at the ply they happened.
- Result line at the bottom of the list: `1-0` / `0-1` / `½-½` + status text ("White resigned").
rubrik has cursor+click only → add keys + buttons + autoscroll; cheap.

### 4. Confirm + prompt row (`ui/round/src/view/table.ts`, `view/button.ts`)
Single `.rcontrols` icon row: takeback | draw | resign | analysis | board-menu. Clicking resign/draw
**replaces the row in place** with a ✓/✗ confirm pair (`resignConfirm`, `drawConfirm`) — no modal, no
misclick resigns. Incoming offers render as a `.question` banner with yes/no on either side of the text.
Preference gates the confirm step (`confirmResign`).

### 5. Preferences (`modules/pref/src/main/Pref.scala`, dasher UI `ui/dasher`)
Lila's list, filtered to what rubrik can honour: `soundSet`/volume, `animation` (none/fast/normal/slow),
`clockTenths` (never/lowtime/always), `clockBar`, `clockSound`, `confirmResign`, `highlight` (last move),
`destination` (legal-move dots), `coords`, `takeback` (never/always/friend), `moretime`, `zen`, `bg`
(light/dark/system), `theme`/`pieceSet`.
rubrik-specific extras: cube colour palette, camera auto-rotate on flip, show-threats overlay,
rotate-animation speed. Store in localStorage first; server-side only if cross-device matters (YAGNI).

## P1 — social / discovery

### 6. Quick-pairing grid (`ui/lobby/src/view/pools.ts`, `modules/pool/src/main/PoolList.scala`)
Grid of one-click time controls; lila's set: 1+0, 2+1, 3+0, 3+2, 5+0, 5+3, 10+0, 10+5, 15+10, 30+0, 30+20.
Each tile = big `lim+inc` + small perf name below; active tile shows a spinner + your rating range,
other tiles go `.transp` (faded) while you're queued. Last tile = **"Custom"** → opens setup dialog.
Replaces rubrik's two number inputs. Highest visual payoff in the lobby.

### 7. Setup dialog (`ui/lobby/src/view/setup/modal.ts` + `components/`)
Modal, three modes (`hook` = public seek, `friend` = challenge, `ai` — skip ai):
variant picker → time control (slider pair, non-linear steps) → rated/casual → rating-range sliders →
**colour buttons white/random/black**. Footer has one big submit. rubrik needs: variant = `walled` +
colour layout (`standard`/`rubrik`) + setup, colour choice, rated toggle.

### 8. Challenge a friend by link (`modules/challenge`, `ui/challenge`)
Create a challenge with no target → shareable URL, "waiting for opponent" page w/ copy button; or
target a username. Challenges live in a header dropdown w/ accept/decline + mini board preview,
declined state, out/in direction. rubrik: a `challenges` table + 2 WS msgs; big win for a private site
where the lobby is empty most of the time.

### 9. Spectating (`modules/round` watchers, `ui/round/src/view/user.ts`)
Watcher count badge on the game page; spectator gets the same board but the control row is replaced by
"watcher follow-up" (rematch/next-game links). rubrik server already lets non-players `watch` — only the
count broadcast + UI badge missing.

### 10. TV / featured game (`modules/tv/src/main/Tv.scala`, channels enum)
Auto-selects the "best" ongoing game (rating × speed heuristic) and streams it; auto-advances when it
ends. Single-channel version for rubrik = `/tv` picking the highest-rated live game → makes an empty
site look alive. Cheap: reuse the watch path + a picker query.

### 11. Now-playing / correspondence (`ui/lobby/src/view/playing.ts`, `correspondence.ts`)
Grid of mini-boards of your ongoing games with "your turn" highlight. Only worth it once
correspondence/unlimited time controls exist (`Pref.Clock.UNLIMITED/CORRESPONDENCE`).

### 12. Crosstable (`modules/game/src/main/Crosstable.scala`, `ui/lib/css/component/_crosstable.scss`)
Head-to-head score vs this opponent (`3½ - 1½`) with a strip of past result dots, shown next to the
rematch button. One SQL aggregate over `games(white,black)`.

## P2 — polish

### 13. Result dialog / follow-up (`ui/round/src/view/button.ts` `followUp`)
On game end the control row becomes: rematch (glows when opponent offered, spinner while you wait,
decline ✗ button when they offered) | new opponent | analysis. rubrik has rematch, missing the
glow/decline/next-opponent affordances.

### 14. Opponent-gone (`ui/round/src/view/button.ts` `opponentGone`)
When the opponent's socket drops: countdown banner "opponent left, claim victory in Ns", then
**Force resignation / Force draw** buttons. Matches rubrik TODO "disconnect handling"; better UX than
waiting for the flag.

### 15. First-move expiration (`ui/round/src/view/expiration.ts`)
Fixed budget for move 1 (lila ~20s/30s), shown as a `.bar-glider` bar; `lowTime` sound at 8s left;
expiry aborts the game unrated. Prevents zombie games from seek-and-run.

### 16. Takeback (`takebackable`, socket `takeback-yes`)
Request → opponent's row becomes a yes/no question → both agree → ply rewind. rubrik replays history
from the initial state anyway (NOTES: "Undo = replay history"), so server cost is ~nil.

### 17. Add-time / "moretime" (`moretime` button, +15s)
One click gives the opponent 15s. Trivial with the existing clock object; nice for slow 3D interaction.

### 18. Board menu + zen (`ui/round/src/view/boardMenu.ts`)
Dropdown from the control row: flip board, zen mode (hides all chrome except the board, key `z`),
board/piece prefs inline. Zen is a strong fit for a 3D board that wants screen space.

### 19. Notifications (`ui/notify`, `ui/lib/src/notification.ts`)
In-app bell dropdown + `Notification` API + tab-title flash ("Your turn") when the tab is hidden
(`ui/round/src/title.ts`). For correspondence/challenges this is what makes async play usable.

### 20. Game export + import
`GET /game/export/:id.pgn` + JSON. rubrik has no PGN; export `{config, moves[]}` JSON + a plain-text
move list. Enables sharing, bug reports, and a future analysis board.

### 21. Rating chart on profile (`ui/chart`, `modules/history`)
Line chart of rating over time per perf, plus recent-games list with result colour bars (green/red/grey)
and rating deltas. rubrik profile already lists games + diffs → only the chart + a `rating_history`
table are missing.

### 22. Mini-board previews (`initMiniBoard`, `ui/lib/src/view`)
Static thumbnails used in game lists, challenges, now-playing. 3D equivalent = cached canvas snapshot or
a cheap unfolded-cube 2D net. The unfolded net is probably the better rubrik-native answer and also
doubles as an accessibility/overview view.

### 23. Premove (`ui/round/src/premove.ts`)
Queue a move during the opponent's turn, highlighted square, auto-plays on their move; `autoQueen` pref.
In 3D with tesseract rotations the premove may be invalidated by a rotate — either restrict premoves to
positions where no rotation occurred, or drop the feature. Lower priority than everything above.

## Visual language (`ui/lib/css/theme/_theme.default.scss`)
Dark theme is HSL-derived from a single hue token — worth copying wholesale:
```
---site-hue: 37deg            /* warm brown-grey, not blue-grey */
--c-bg:       hsl(hue 7% 14%) /* boxes */
--c-bg-page:  hsl(hue 10% 8%) /* page behind boxes */
--c-bg-low:   hsl(hue 7% 22%) /* raised / popups */
--c-bg-zebra: hsl(hue 5% 19%) /* table stripes */
--c-font:     hsl(0 0% 73%)   /* dim by default; -clear/-clearer for emphasis */
--c-border:   hsl(0 0% 25%)
--c-primary:  hsl(209 79% 56%)  /* blue: links, primary buttons */
--c-secondary:hsl(88 62% 37%)   /* green: confirm / play */
--c-brag:     hsl(37 74% 43%)   /* gold: ratings, trophies */
--c-fancy:    hsl(294 62% 48%)  /* purple: accents */
```
Derived shades use `color-mix(in oklab, ...)` and `hsl(from var(--x) h s l)` — one hue swap re-themes the
whole site. Buttons are a metal gradient (`--c-metal-top/bottom` + hover variants), not flat.
Layout: fixed 3-column game page (left meta | board | right table); the board is the only element that
scales with viewport; everything else is a fixed-width column that scrolls internally.
rubrik uses tailwind + shadcn → map these to CSS vars in `index.css`; the hue-token trick still applies.

## Deliberate skips
Puzzles, storm/racer, study/analysis trees (rubrik TODO already has a local analysis board — keep it
local), broadcasts, opening book, insights, teams, forums, blogs, coaches, DGT, voice/keyboard move
input, i18n, mod/report tooling, ads for lila-specific perf types.

## Uncertainty
- Lila's scala modules were skimmed for feature shape, not for implementation detail; clock/pool
  server semantics above come from the TS views + `PoolList.scala`, not from `modules/round`.
- Premove/mini-board feasibility in 3D is a guess; both need a spike before committing.
