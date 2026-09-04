# Rubrikchess platform — architecture notes

Goal: lichess-like multiplayer platform for Rubrik Chess (chess on 8x8x6 cube).

## Layout (target)

```
rubrikchess/
  Cargo.toml              # rust workspace
  pnpm-workspace.yaml
  package.json            # root scripts only
  crates/
    core/                 # rubrik-core: pure rules engine (board, movegen, apply, game status). No IO.
    wasm/                 # rubrik-wasm: wasm-bindgen wrapper of core for browser
    server/               # rubrik-server: axum HTTP+WS. lobby, seeks, game rooms, clocks, sqlite
  apps/
    web/                  # vite + react + r3f client (moved from repo root)
  packages/
    protocol/             # TS types for WS/HTTP messages (mirror of server/src/protocol.rs)
```

## Game rules (as implemented in original TS `src/store/game.ts`)

Geometry: cube side CU_S=32, cell C_S=4, 8x8 per face, 6 faces = 384 cells.
Cell pos = integer vec; one comp = ±16 (face normal), others ∈ {-14,-10,...,14}.
Cells have fixed id (face,i,j) + fixed color; pos/side change under Tesseract rotation.
Face order (SIDES): +Y, +X, +Z, -Y, -X, -Z. White pieces start face 0 (+Y), black face 3 (-Y).
Layout `standard`: colors [W,W,B,B,W,B] per face. `rubrik`: 6 distinct colors.

distSq units (C_S²=16): 0.5→8 (orth across edge), 1→16 (orth), 1.5→24 (diag across edge), 2→32 (diag).
`walled` flag: no movement across edges.

Pieces (letter):
- p Pawn: move to empty at dist 8/16 (8 only if !walled); capture enemy at 24/32. Any direction. No promotion.
- n Knight: distSq ∈ {80, 56} or (72 & target edge/corner & distToCenter≠52) or (40 & either corner). walled → same face only.
- b Bishop: diagonal walk (climbs edges unless walled).
- r Rook: orthogonal walk.
- q Queen: rook+bishop.
- k King: dist {8,24 (!walled), 16, 32}. Capturing king = win.
- x Prince: king moves but only onto same-color cells.
- s Princess: queen walk but only over same-color cells.
- c Captain: BFS over same-color empty cells (orth adjacency) = normal moves; plus king moves (capture ok).
- o Cannon: capture/move to pos rotated ±90° about tangential axes (4 targets); plus king-moves non-capturing.
- t Tesseract: king moves; plus ROTATE: rotate slice/face (cells where pos·axis == own pos·axis, ± C_S/2) by ±90° about X/Y/Z.

Walk climb (rook): off-edge → newDir = -side, cursor = cursor - dir*2 + newDir*2.
Walk climb (bishop): clamped=clamp(cursor,±16); newSide = norm(cursor-clamped); dir = norm(norm(proj(dir, plane newSide)) - side); cursor = clamped - side*2.
  Off a corner diagonally → never lands on cell → stops.
Walk stops when cursor == start (looped around cube) or maxIter 384.

Win: king captured (original had no end condition; highlighted attacked king/prince only).

## Decisions
- Rust core is single source of truth; wasm for client movegen/highlight; server validates.
- Undo = replay history from initial state (cheap; 384 cells).
- Anonymous players first (cookie session), accounts later.
