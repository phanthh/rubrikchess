//! Tactics mined from finished games: positions where a two-ply search wins
//! material that greedy play misses. The same rule the client's scanner uses.

use std::sync::Arc;
use std::time::Duration;

use rubrik_core::{Game, GameConfig, Move};

use crate::db;
use crate::AppState;

/// Wait after boot before the first batch: rehydration and reconnects come first.
const BOOT_DELAY: Duration = Duration::from_secs(30);
const EVERY: Duration = Duration::from_secs(300);
/// Games per batch; each one is a few hundred searches.
const BATCH: i64 = 5;
/// Openings are noise, and a long game is not worth the search budget.
const FIRST_PLY: usize = 4;
const MAX_PLIES: usize = 120;
/// Material the solution must win over the static score, in centipawns.
const MIN_GAIN: i32 = 300;
/// Above this the position is already decided (a king capture, not a tactic).
const MAX_GAIN: i32 = 50_000;

pub fn spawn_miner(state: Arc<AppState>) {
    tokio::spawn(async move {
        // PUZZLE_BOOT_DELAY_SECS overrides the delay (dev / e2e).
        let boot = std::env::var("PUZZLE_BOOT_DELAY_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .map_or(BOOT_DELAY, Duration::from_secs);
        tokio::time::sleep(boot).await;
        loop {
            mine_batch(&state).await;
            tokio::time::sleep(EVERY).await;
        }
    });
}

async fn mine_batch(state: &Arc<AppState>) {
    let games = db::unmined_games(&state.db.lock(), BATCH);
    for game in games {
        let (config, moves) = (game.config.clone(), game.moves.clone());
        // CPU-bound for seconds: off the runtime, and never under the db lock.
        let Ok(found) = tokio::task::spawn_blocking(move || mine(&config, &moves)).await else {
            return;
        };
        let db = state.db.lock();
        for (ply, solution, gain) in found {
            db::insert_puzzle(&db, &game.id, ply, &solution, gain as i64);
        }
        // Also on an empty result, so the game is not re-searched every 5 minutes.
        db::mark_mined(&db, &game.id);
    }
}

/// Puzzles in one game: `(ply, solution, gain)` per position where the deep move
/// wins material and the greedy move is a different one.
pub fn mine(config: &GameConfig, moves: &[Move]) -> Vec<(usize, Move, i32)> {
    let mut game = Game::new(config.clone());
    let mut found = Vec::new();
    for (ply, mv) in moves.iter().take(MAX_PLIES).enumerate() {
        if ply >= FIRST_PLY {
            let seed = ply as u64;
            if let (Some((_, base)), Some((greedy, _)), Some((deep, score))) = (
                rubrik_core::analyse(&game, 1, seed),
                rubrik_core::analyse(&game, 2, seed),
                rubrik_core::analyse(&game, 3, seed),
            ) {
                let gain = score - base;
                if (MIN_GAIN..MAX_GAIN).contains(&gain) && deep != greedy {
                    found.push((ply, deep, gain));
                }
            }
        }
        if game.play(mv.clone()).is_err() {
            break;
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    use rubrik_core::best_move;

    /// A random-ish game is mined without panicking, and every hit is a legal move
    /// in the position it claims.
    #[test]
    fn mines_a_played_game() {
        let config = GameConfig::default();
        let mut game = Game::new(config.clone());
        for ply in 0..12u64 {
            let Some(mv) = best_move(&game, 2, ply) else {
                break;
            };
            game.play(mv).expect("play");
        }
        let moves = game.history.clone();
        assert!(moves.len() >= 8);

        for (ply, solution, gain) in mine(&config, &moves) {
            assert!(ply >= FIRST_PLY && ply < moves.len());
            assert!((MIN_GAIN..MAX_GAIN).contains(&gain));
            let mut g = Game::replay(config.clone(), &moves[..ply]).expect("replay");
            g.play(solution).expect("solution is legal");
        }
    }
}
