//! The system user plays its own games: whenever it is on move, search on a
//! blocking thread and play the result after a short think.

use std::sync::Arc;

use parking_lot::Mutex;
use rubrik_core::{Color, Status};

use crate::db;
use crate::room::{arm_first_move_expiry, arm_timeout, persist, Room};
use crate::{now_ms, AppState};

/// Search level for `best_move` (two-ply); the same one the client offers.
const LEVEL: u8 = 3;

/// Think time before the bot's reply lands, so games are not instant.
const THINK_MS: u64 = 600;

pub fn is_bot(user_id: &str) -> bool {
    user_id == db::SYSTEM_USER_ID
}

/// Play the bot's move in `room` if it is on move; no-op otherwise. Re-pokes
/// itself afterwards so nothing else has to know the bot exists.
pub fn poke(state: Arc<AppState>, room: Arc<Mutex<Room>>) {
    let (game, ply) = {
        let r = room.lock();
        if r.game.status != Status::Playing {
            return;
        }
        let mover = match r.game.turn {
            Color::White => &r.white.id,
            Color::Black => &r.black.id,
        };
        if !is_bot(mover) {
            return;
        }
        (r.game.clone(), r.game.history.len())
    };
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(THINK_MS)).await;
        let seed = ply as u64 ^ now_ms() as u64;
        // The search must not run under the room lock: it is CPU-bound for tens of ms.
        let found = tokio::task::spawn_blocking(move || rubrik_core::best_move(&game, LEVEL, seed))
            .await
            .ok()
            .flatten();
        let Some(mv) = found else { return };
        {
            let mut r = room.lock();
            // The position moved on (takeback, abort, flag fall): the search is stale.
            if r.game.history.len() != ply || r.play(&state, db::SYSTEM_USER_ID, mv).is_err() {
                return;
            }
            persist(&state, &r);
        }
        arm_timeout(state.clone(), room.clone());
        arm_first_move_expiry(state.clone(), room.clone());
        poke(state, room);
    });
}
