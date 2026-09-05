use std::collections::VecDeque;
use std::sync::Arc;

use parking_lot::Mutex;

use rubrik_core::{Color, EndReason, Game, Move, Status};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::broadcast;

use crate::db;
use crate::db::User;
use crate::lobby::ClockSpec;
use crate::rating;
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

    /// Same clock re-based on `now`: the running colour's elapsed time is folded
    /// into its remaining ms, so a client may read `at` as "now on arrival".
    pub fn normalized(&self, now: i64) -> Clock {
        let mut c = self.clone();
        if let Some(color) = self.running {
            c.set(color, self.remaining(color, now).max(0));
        }
        c.at = now;
        c
    }

    fn on_move(&mut self, mover: Color, now: i64) {
        let left = self.remaining(mover, now).max(0) + self.increment_ms;
        self.set(mover, left);
        self.running = Some(mover.other());
        self.at = now;
    }

    /// Gift time to a player; `at` is unchanged so a running clock keeps ticking.
    pub fn add_time(&mut self, color: Color, ms: i64) {
        self.set(color, self.base(color) + ms);
    }

    pub fn unlimited(&self) -> bool {
        self.initial_ms == 0 && self.increment_ms == 0
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
    pub rematch_offer: Option<Color>,
    pub takeback_offer: Option<Color>,
    pub created_at: i64,
    pub white_diff: Option<i64>,
    pub black_diff: Option<i64>,
    /// Connections currently subscribed to this room (players included).
    pub watchers: usize,
    /// Recent chat lines, oldest first; memory only.
    pub chat: VecDeque<Value>,
    /// Identity of this in-memory instance; a re-loaded room gets a new one.
    instance: u64,
    /// Eviction loop already armed.
    evicting: bool,
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
            rematch_offer: None,
            takeback_offer: None,
            created_at,
            white_diff: None,
            black_diff: None,
            watchers: 0,
            chat: VecDeque::new(),
            instance: NEXT_INSTANCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            evicting: false,
            tx: broadcast::channel(64).0,
        }
    }

    /// Rebuild a room from a stored game. Downtime is not charged: the running
    /// clock restarts from now.
    pub fn from_row(row: db::GameRow) -> Option<Room> {
        let game = db::game_from_row(&row)?;
        let mut clock = row.clock;
        clock.at = now_ms();
        let mut room = Room::new(row.id, game, row.white, row.black, clock, row.created_at);
        room.white_diff = row.white_diff;
        room.black_diff = row.black_diff;
        Some(room)
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

    pub fn state_msg(&self, state: &AppState) -> Value {
        let (white_on, black_on) = self.presence(state);
        json!({
            "t": "game_state",
            "game_id": self.id,
            "game": self.game,
            "white": self.white,
            "black": self.black,
            "clock": self.clock.normalized(now_ms()),
            "draw_offer": self.draw_offer,
            "takeback_offer": self.takeback_offer,
            "watchers": self.watchers,
            "presence": {"white": white_on, "black": black_on},
            "chat": self.chat,
        })
    }

    /// Keep the tail of the conversation for clients joining later.
    pub fn push_chat(&mut self, line: Value) {
        if self.chat.len() == CHAT_HISTORY {
            self.chat.pop_front();
        }
        self.chat.push_back(line);
    }

    /// Whether each player currently has at least one websocket open.
    pub fn presence(&self, state: &AppState) -> (bool, bool) {
        let conns = state.conns.lock();
        (
            conns.contains_key(&self.white.id),
            conns.contains_key(&self.black.id),
        )
    }

    pub fn presence_msg(&self, state: &AppState) -> Value {
        let (white, black) = self.presence(state);
        json!({"t": "presence", "game_id": self.id, "white": white, "black": black})
    }

    pub fn play(&mut self, state: &Arc<AppState>, user_id: &str, mv: Move) -> Result<(), String> {
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
        self.takeback_offer = None;
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
            self.finish(state);
        }
        Ok(())
    }

    pub fn end(&mut self, state: &Arc<AppState>, status: Status) {
        if self.game.status != Status::Playing {
            return;
        }
        self.game.end(status);
        self.finish(state);
    }

    /// Undo plies until it is `color`'s turn again (1 or 2). The clock keeps its
    /// times and restarts for whoever is now on move.
    pub fn takeback(&mut self, color: Color) {
        while !self.game.history.is_empty() {
            self.game.undo();
            if self.game.turn == color {
                break;
            }
        }
        self.takeback_offer = None;
        self.draw_offer = None;
        self.clock.running = Some(self.game.turn);
        self.clock.at = now_ms();
    }

    fn finish(&mut self, state: &Arc<AppState>) {
        self.clock.stop(now_ms());
        self.draw_offer = None;
        self.takeback_offer = None;
        let (white_diff, black_diff) = self.rate(state);
        self.broadcast(json!({
            "t": "game_end",
            "game_id": self.id,
            "status": self.game.status,
            "white_diff": white_diff,
            "black_diff": black_diff,
        }));
        evict_when_idle(state.clone(), self);
    }

    /// Glicko-2 update for a decided game; only abandoned *draws* (server
    /// restart) stay unrated — a claimed win counts.
    fn rate(&mut self, state: &AppState) -> (Option<i64>, Option<i64>) {
        let score = match self.game.status {
            Status::Won { winner, .. } => {
                if winner == Color::White {
                    1.0
                } else {
                    0.0
                }
            }
            Status::Draw { reason } if reason != EndReason::Abandoned => 0.5,
            _ => return (None, None),
        };
        let conn = state.db.lock();
        // Re-read: both players may have finished other games since this room started.
        let (Some(mut white), Some(mut black)) = (
            db::user(&conn, &self.white.id),
            db::user(&conn, &self.black.id),
        ) else {
            return (None, None);
        };
        let (wr, br) = rating::update(&white.glicko(), &black.glicko(), score);
        let white_diff = wr.r.round() as i64 - white.rating.round() as i64;
        let black_diff = br.r.round() as i64 - black.rating.round() as i64;
        db::set_rating(
            &conn,
            &white.id,
            &wr,
            white.games + 1,
            white.wins + (score == 1.0) as i64,
        );
        db::set_rating(
            &conn,
            &black.id,
            &br,
            black.games + 1,
            black.wins + (score == 0.0) as i64,
        );
        db::set_game_diffs(&conn, &self.id, white_diff, black_diff);
        let at = now_ms();
        db::add_rating_history(&conn, &white.id, &self.id, at, wr.r);
        db::add_rating_history(&conn, &black.id, &self.id, at, br.r);
        white.rating = wr.r;
        white.rd = wr.rd;
        white.vol = wr.vol;
        white.games += 1;
        black.rating = br.r;
        black.rd = br.rd;
        black.vol = br.vol;
        black.games += 1;
        self.white = white;
        self.black = black;
        self.white_diff = Some(white_diff);
        self.black_diff = Some(black_diff);
        (Some(white_diff), Some(black_diff))
    }
}

/// Chat lines kept per room.
const CHAT_HISTORY: usize = 50;

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

/// Restore rooms for games a previous run left `playing`; games whose moves no
/// longer replay are abandoned.
pub fn rehydrate(state: &Arc<AppState>) {
    let ids = db::playing_games(&state.db.lock());
    for id in ids {
        let row = db::load_game(&state.db.lock(), &id);
        let Some(room) = row.and_then(Room::from_row) else {
            tracing::warn!("game {id}: replay failed, abandoning");
            db::abandon_game(&state.db.lock(), &id);
            continue;
        };
        let room = Arc::new(Mutex::new(room));
        state.rooms.lock().insert(id, room.clone());
        arm_timeout(state.clone(), room);
    }
}

const EVICT_EVERY: std::time::Duration = std::time::Duration::from_secs(600);

static NEXT_INSTANCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Drop `id` from the room map, but only while it still holds *this* instance:
/// an evicted room may have been re-loaded meanwhile (new instance, live
/// subscribers). Returns whether it was removed.
fn evict(state: &AppState, id: &str, instance: u64) -> bool {
    let mut rooms = state.rooms.lock();
    if rooms.get(id).is_some_and(|r| r.lock().instance == instance) {
        rooms.remove(id);
        return true;
    }
    false
}

/// Drop a finished room from memory once nobody is subscribed to it; a later
/// `watch` reloads it from the DB. One task per room instance.
pub fn evict_when_idle(state: Arc<AppState>, room: &mut Room) {
    if room.evicting {
        return;
    }
    room.evicting = true;
    let (id, tx, instance) = (room.id.clone(), room.tx.clone(), room.instance);
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(EVICT_EVERY).await;
            if tx.receiver_count() == 0 {
                evict(&state, &id, instance);
                return;
            }
        }
    });
}

/// Arm the flag-fall timer for whoever is on move. Fires once; if the ply is
/// unchanged and the game is still running, the player on move loses on time.
pub fn arm_timeout(state: Arc<AppState>, room: Arc<Mutex<Room>>) {
    let (ply, at, color, delay) = {
        let r = room.lock();
        if r.game.status != Status::Playing || r.clock.unlimited() {
            return;
        }
        let Some(color) = r.clock.running else { return };
        (
            r.game.history.len(),
            r.clock.at,
            color,
            r.clock.remaining(color, now_ms()).max(0) as u64,
        )
    };
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
        let mut r = room.lock();
        if r.game.status != Status::Playing || r.game.history.len() != ply || r.clock.at != at {
            return;
        }
        if r.clock.remaining(color, now_ms()) > 0 {
            return;
        }
        r.end(
            &state,
            Status::Won {
                winner: color.other(),
                reason: EndReason::Timeout,
            },
        );
        persist(&state, &r);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use rubrik_core::GameConfig;

    fn test_room(id: &str) -> Arc<Mutex<Room>> {
        let user = User::anon("u".into(), "U".into());
        let spec = ClockSpec {
            initial_ms: 60_000,
            increment_ms: 0,
        };
        Arc::new(Mutex::new(Room::new(
            id.into(),
            Game::new(GameConfig::default()),
            user.clone(),
            user,
            Clock::new(spec, 0),
            0,
        )))
    }

    /// A stale eviction task must not drop a re-loaded room with the same id.
    #[test]
    fn evict_only_removes_its_own_instance() {
        let state = AppState::new(":memory:");
        let (old, new) = (test_room("g"), test_room("g"));
        let (old_i, new_i) = (old.lock().instance, new.lock().instance);
        assert_ne!(old_i, new_i);
        state.rooms.lock().insert("g".into(), new);
        assert!(!evict(&state, "g", old_i));
        assert!(state.rooms.lock().contains_key("g"));
        assert!(evict(&state, "g", new_i));
        assert!(!state.rooms.lock().contains_key("g"));
    }

    #[test]
    fn normalized_rebases_the_running_clock() {
        let clock = Clock::new(
            ClockSpec {
                initial_ms: 60_000,
                increment_ms: 0,
            },
            1_000,
        );
        let n = clock.normalized(6_000);
        assert_eq!(n.at, 6_000);
        assert_eq!(n.white_ms, 55_000);
        assert_eq!(n.black_ms, 60_000);
        assert_eq!(n.remaining(Color::White, 6_000), 55_000);
    }
}
