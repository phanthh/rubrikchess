//! Small material-search opponent. Negamax + alpha-beta; the last ply is
//! evaluated statically (captured value) so no board clone is needed there.

use crate::board::{Color, PieceKind};
use crate::game::{Game, Status};
use crate::movegen::Move;

const MATE: i32 = 100_000;

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

fn search(game: &Game, depth: u8, mut alpha: i32, beta: i32) -> i32 {
    if let Status::Won { winner, .. } = game.status {
        return if winner == game.turn { MATE } else { -MATE };
    }
    if game.status != Status::Playing {
        return 0;
    }
    let base = material(game, game.turn);
    if depth == 0 {
        return base;
    }
    let moves = own_moves(game);
    if moves.is_empty() {
        return base;
    }
    let mut best = -MATE - 1;
    for mv in moves {
        let score = if depth == 1 {
            base + gain(game, &mv)
        } else {
            let mut g = game.clone();
            g.apply(mv);
            -search(&g, depth - 1, -beta, -alpha)
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
        return Some(moves[(next() % moves.len() as u64) as usize].clone());
    }
    let depth = (level - 1).min(3);
    let mut best: Vec<Move> = Vec::new();
    let mut best_score = -MATE - 1;
    for mv in moves {
        let score = if depth == 1 {
            material(game, game.turn) + gain(game, &mv)
        } else {
            let mut g = game.clone();
            g.apply(mv.clone());
            -search(&g, depth - 1, -MATE - 1, MATE + 1)
        };
        if score > best_score {
            best_score = score;
            best.clear();
        }
        if score == best_score {
            best.push(mv);
        }
    }
    Some(best[(next() % best.len() as u64) as usize].clone())
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
            let Some(mv) = best_move(&g, level, ply) else { break };
            g.play(mv).unwrap();
            if g.status != Status::Playing {
                break;
            }
        }
        assert!(material(&g, Color::White) > 0, "search should out-material random play");
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
