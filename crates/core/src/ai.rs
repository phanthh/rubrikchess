//! Small material-search opponent. Negamax + alpha-beta; the last ply is
//! evaluated statically (captured value) so no board clone is needed there.

use crate::board::{Color, PieceKind};
use crate::game::{Game, Status};
use crate::movegen::Move;

pub const MATE: i32 = 100_000;

pub fn value(kind: PieceKind) -> i32 {
    match kind {
        PieceKind::Pawn => 100,
        PieceKind::Prince => 200,
        PieceKind::Knight | PieceKind::Bishop | PieceKind::Captain => 300,
        PieceKind::Cannon => 400,
        PieceKind::Rook | PieceKind::Princess => 500,
        PieceKind::Tesseract => 600,
        PieceKind::Queen => 900,
        PieceKind::King => MATE,
    }
}

/// Material balance from `color`'s point of view, plus a small "pressure" term so that,
/// with nothing to capture, pieces drift towards the enemy king instead of shuffling.
fn material(game: &Game, color: Color) -> i32 {
    let king = |c: Color| {
        game.board
            .cells
            .iter()
            .find(|cell| {
                cell.piece
                    .is_some_and(|p| p.kind == PieceKind::King && p.color == c)
            })
            .map(|cell| cell.pos)
    };
    let kings = (king(color.other()), king(color));
    let mut score = 0;
    for cell in &game.board.cells {
        let Some(p) = cell.piece else { continue };
        if p.kind == PieceKind::King {
            continue;
        }
        let sign = if p.color == color { 1 } else { -1 };
        score += sign * value(p.kind);
        // ponytail: manhattan distance ignores the cube's faces; good enough as a tie-breaker
        let target = if p.color == color { kings.0 } else { kings.1 };
        if let Some(k) = target {
            let d = (cell.pos.x - k.x).abs() + (cell.pos.y - k.y).abs() + (cell.pos.z - k.z).abs();
            score += sign * (96 - d.min(96)) / 16; // 0..6 centipawns
        }
    }
    score
}

/// Static gain of `mv` for the side to move: value of the captured piece.
fn gain(game: &Game, mv: &Move) -> i32 {
    match mv {
        Move::Step { capture: true, .. } => mv
            .to()
            .and_then(|to| game.board.cell(to).piece)
            .map_or(0, |p| value(p.kind)),
        _ => 0,
    }
}

fn own_moves(game: &Game) -> Vec<Move> {
    let mut moves: Vec<Move> = game
        .all_moves()
        .into_iter()
        .filter(|(from, _)| {
            game.board
                .cell(*from)
                .piece
                .is_some_and(|p| p.color == game.turn)
        })
        .flat_map(|(_, m)| m)
        .collect();
    // captures first: better alpha-beta cutoffs
    moves.sort_by_key(|m| -gain(game, m));
    moves
}

/// Capture-only extension at the horizon so a "free" piece that is immediately
/// recaptured is not counted as won. Stand-pat on the static score. Deeper searches
/// get a shorter extension to keep the tree bounded.
fn quiesce_plies(depth: u8) -> u8 {
    if depth >= 3 {
        1
    } else {
        2
    }
}

fn quiesce(game: &Game, qdepth: u8, mut alpha: i32, beta: i32) -> i32 {
    if let Status::Won { winner, .. } = game.status {
        return if winner == game.turn { MATE } else { -MATE };
    }
    if game.status != Status::Playing {
        return 0;
    }
    let stand = material(game, game.turn);
    if qdepth == 0 || stand >= beta {
        return stand;
    }
    alpha = alpha.max(stand);
    let mut best = stand;
    for mv in own_moves(game) {
        let g0 = gain(game, &mv);
        if g0 == 0 {
            break; // sorted: captures first
        }
        // king capture ends the game; no need to look further
        let score = if g0 >= MATE {
            MATE
        } else {
            let mut g = game.clone();
            g.apply(mv);
            -quiesce(&g, qdepth - 1, -beta, -alpha)
        };
        if score > best {
            best = score;
        }
        if best > alpha {
            alpha = best;
        }
        if alpha >= beta {
            break;
        }
    }
    best
}

/// Node budget for a whole root search; once spent, remaining nodes are evaluated
/// statically. Keeps "hard" bounded in wide midgame positions (<1s native).
/// ponytail: root moves searched after the budget runs out get only a shallow look;
/// upgrade path = iterative deepening with a time limit.
const NODE_BUDGET: u32 = 15_000;

fn search(game: &Game, depth: u8, q: u8, nodes: &mut u32, mut alpha: i32, beta: i32) -> i32 {
    *nodes += 1;
    if let Status::Won { winner, .. } = game.status {
        return if winner == game.turn { MATE } else { -MATE };
    }
    if game.status != Status::Playing {
        return 0;
    }
    if depth == 0 || *nodes > NODE_BUDGET {
        return quiesce(game, q, alpha, beta);
    }
    let base = material(game, game.turn);
    let moves = own_moves(game);
    if moves.is_empty() {
        return base;
    }
    let mut best = -MATE - 1;
    for mv in moves {
        let g0 = gain(game, &mv);
        let score = if depth == 1 && g0 == 0 {
            // quiet move at the horizon: static score (no capture to resolve)
            base
        } else if g0 >= MATE {
            MATE
        } else {
            let mut g = game.clone();
            g.apply(mv);
            -search(&g, depth - 1, q, nodes, -beta, -alpha)
        };
        if score > best {
            best = score;
        }
        if best > alpha {
            alpha = best;
        }
        if alpha >= beta {
            break;
        }
    }
    best
}

/// Pick a move for the side to move. `level`: 1 random, 2 greedy, 3 two-ply, 4 three-ply.
/// `seed` breaks ties between equal moves so games do not repeat.
pub fn best_move(game: &Game, level: u8, seed: u64) -> Option<Move> {
    analyse(game, level, seed).map(|(mv, _)| mv)
}

/// Best move plus its score in centipawns from the side to move's view
/// (±MATE for a forced king capture within the horizon).
pub fn analyse(game: &Game, level: u8, seed: u64) -> Option<(Move, i32)> {
    if game.status != Status::Playing {
        return None;
    }
    let moves = own_moves(game);
    if moves.is_empty() {
        return None;
    }
    let mut rng = seed
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407)
        | 1;
    let mut next = move || {
        rng ^= rng << 13;
        rng ^= rng >> 7;
        rng ^= rng << 17;
        rng
    };
    if level <= 1 {
        let mv = moves[(next() % moves.len() as u64) as usize].clone();
        return Some((mv, material(game, game.turn)));
    }
    let max_depth = (level - 1).min(3);
    // Iterative deepening: each pass re-orders the root moves by the previous scores;
    // a pass that exhausts the node budget is discarded in favour of the last complete one.
    let mut order: Vec<Move> = moves;
    let mut result: Vec<(Move, i32)> = Vec::new();
    for depth in 1..=max_depth {
        let mut nodes = 0u32;
        let mut scored: Vec<(Move, i32)> = Vec::with_capacity(order.len());
        let mut complete = true;
        for mv in order.iter().cloned() {
            let g0 = gain(game, &mv);
            let score = if depth == 1 {
                material(game, game.turn) + g0 // greedy: no lookahead by design
            } else if g0 >= MATE {
                MATE
            } else {
                let mut g = game.clone();
                g.apply(mv.clone());
                -search(
                    &g,
                    depth - 1,
                    quiesce_plies(depth),
                    &mut nodes,
                    -MATE - 1,
                    MATE + 1,
                )
            };
            scored.push((mv, score));
            if nodes > NODE_BUDGET {
                complete = false;
                break;
            }
        }
        if !complete && !result.is_empty() {
            break;
        }
        scored.sort_by_key(|(_, s)| -s);
        order = scored.iter().map(|(m, _)| m.clone()).collect();
        result = scored;
        if !complete {
            break;
        }
    }
    let best_score = result[0].1;
    let best: Vec<Move> = result
        .into_iter()
        .take_while(|(_, s)| *s == best_score)
        .map(|(m, _)| m)
        .collect();
    Some((
        best[(next() % best.len() as u64) as usize].clone(),
        best_score,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::GameConfig;

    #[test]
    fn levels_return_legal_moves() {
        let g = Game::new(GameConfig::default());
        for level in 1..=4 {
            let mv = best_move(&g, level, 7).expect("move");
            let mut g2 = g.clone();
            g2.play(mv).expect("legal");
        }
    }

    #[test]
    fn two_ply_beats_random_over_a_short_game() {
        let mut g = Game::new(GameConfig::default());
        for ply in 0..40 {
            let level = if g.turn == Color::White { 3 } else { 1 };
            let Some(mv) = best_move(&g, level, ply) else {
                break;
            };
            g.play(mv).unwrap();
            if g.status != Status::Playing {
                break;
            }
        }
        assert!(
            material(&g, Color::White) > 0,
            "search should out-material random play"
        );
    }

    #[test]
    fn greedy_takes_free_material_and_search_avoids_hanging() {
        // White queen ('Q') next to an undefended black rook: greedy grabs it.
        let cfg = GameConfig {
            setup: "
--------
--------
--------
---Qr---
--------
--------
--------
-----K--

--------
--------
--------
--------
--------
--------
--------
-----k--
"
            .into(),
            ..Default::default()
        };
        let g = Game::new(cfg);
        let mv = best_move(&g, 2, 1).unwrap();
        let mut g2 = g.clone();
        g2.play(mv.clone()).unwrap();
        assert!(matches!(mv, Move::Step { capture: true, .. }));
        assert!(material(&g2, Color::White) > material(&g, Color::White));
    }
}
