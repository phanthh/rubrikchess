use std::sync::Arc;

use parking_lot::Mutex;

use rubrik_core::{Color, EndReason, Game, Move, Status};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::broadcast;

use crate::db;
use crate::db::User;
use crate::lobby::ClockSpec;
use crate::{now_ms, AppState};

/// Server-authoritative clock. `white_ms`/`black_ms` are the remaining times as
/// of `at`; the client extrapolates for the `running` colour.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Clock {
    pub initial_ms: i64,
    pub increment_ms: i64,
    pub white_ms: i64,
    pub black_ms: i64,
    pub running: Option<Color>,
    pub at: i64,
}

impl Clock {
    pub fn new(spec: ClockSpec, at: i64) -> Clock {
        Clock {
            initial_ms: spec.initial_ms,
            increment_ms: spec.increment_ms,
            white_ms: spec.initial_ms,
            black_ms: spec.initial_ms,
            running: Some(Color::White),
            at,
        }
    }

    fn base(&self, color: Color) -> i64 {
        match color {
            Color::White => self.white_ms,
            Color::Black => self.black_ms,
        }
    }

    fn set(&mut self, color: Color, ms: i64) {
        match color {
            Color::White => self.white_ms = ms,
            Color::Black => self.black_ms = ms,
        }
    }

    /// Remaining ms for `color` right now.
    pub fn remaining(&self, color: Color, now: i64) -> i64 {
        if self.running == Some(color) {
            self.base(color) - (now - self.at)
        } else {
            self.base(color)
        }
    }

    fn on_move(&mut self, mover: Color, now: i64) {
        let left = self.remaining(mover, now).max(0) + self.increment_ms;
        self.set(mover, left);
        self.running = Some(mover.other());
        self.at = now;
    }

    fn stop(&mut self, now: i64) {
        if let Some(c) = self.running {
            let left = self.remaining(c, now).max(0);
            self.set(c, left);
        }
        self.running = None;
        self.at = now;
    }
}

pub struct Room {
    pub id: String,
    pub game: Game,
    pub white: User,
    pub black: User,
    pub clock: Clock,
    pub draw_offer: Option<Color>,
    pub created_at: i64,
    pub tx: broadcast::Sender<String>,
}

impl Room {
    pub fn new(
        id: String,
        game: Game,
        white: User,
        black: User,
        clock: Clock,
        created_at: i64,
    ) -> Room {
        Room {
            id,
            game,
            white,
            black,
            clock,
            draw_offer: None,
            created_at,
            tx: broadcast::channel(64).0,
        }
    }

    pub fn color_of(&self, user_id: &str) -> Option<Color> {
        if self.white.id == user_id {
            Some(Color::White)
        } else if self.black.id == user_id {
            Some(Color::Black)
        } else {
            None
        }
    }

    pub fn broadcast(&self, msg: Value) {
        let _ = self.tx.send(msg.to_string());
    }

    pub fn state_msg(&self) -> Value {
        json!({
            "t": "game_state",
            "game_id": self.id,
            "game": self.game,
            "white": self.white,
            "black": self.black,
            "clock": self.clock,
            "draw_offer": self.draw_offer,
        })
    }

    pub fn play(&mut self, user_id: &str, mv: Move) -> Result<(), String> {
        if self.game.status != Status::Playing {
            return Err("game is over".into());
        }
        let color = self.color_of(user_id).ok_or("not a player")?;
        if color != self.game.turn {
            return Err("not your turn".into());
        }
        self.game.play(mv).map_err(|e| e.to_string())?;
        let now = now_ms();
        self.clock.on_move(color, now);
        self.draw_offer = None;
        let mv = self.game.history.last().expect("just played");
        self.broadcast(json!({
            "t": "move",
            "game_id": self.id,
            "move": mv,
            "ply": self.game.history.len(),
            "turn": self.game.turn,
            "status": self.game.status,
            "clock": self.clock,
        }));
        if self.game.status != Status::Playing {
            self.finish();
        }
        Ok(())
    }

    pub fn end(&mut self, status: Status) {
        if self.game.status != Status::Playing {
            return;
        }
        self.game.end(status);
        self.finish();
    }

    fn finish(&mut self) {
        self.clock.stop(now_ms());
        self.draw_offer = None;
        self.broadcast(json!({
            "t": "game_end",
            "game_id": self.id,
            "status": self.game.status,
        }));
    }
}

pub fn persist(state: &AppState, room: &Room) {
    let conn = state.db.lock();
    db::update_game(
        &conn,
        &room.id,
        &room.game.history,
        &room.game.status,
        &room.clock,
        now_ms(),
    );
}

/// Arm the flag-fall timer for whoever is on move. Fires once; if the ply is
/// unchanged and the game is still running, the player on move loses on time.
pub fn arm_timeout(state: Arc<AppState>, room: Arc<Mutex<Room>>) {
    let (ply, color, delay) = {
        let r = room.lock();
        if r.game.status != Status::Playing {
            return;
        }
        let Some(color) = r.clock.running else { return };
        (
            r.game.history.len(),
            color,
            r.clock.remaining(color, now_ms()).max(0) as u64,
        )
    };
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
        let mut r = room.lock();
        if r.game.status != Status::Playing || r.game.history.len() != ply {
            return;
        }
        if r.clock.remaining(color, now_ms()) > 0 {
            return;
        }
        r.end(Status::Won {
            winner: color.other(),
            reason: EndReason::Timeout,
        });
        persist(&state, &r);
    });
}
