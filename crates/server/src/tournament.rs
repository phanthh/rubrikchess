//! Arena tournaments: players join at any time, the server keeps pairing the
//! free ones until the clock runs out. Live state lives in `AppState.tournaments`,
//! every mutation is mirrored into sqlite so a restart resumes.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use rand::seq::SliceRandom;
use rubrik_core::{Color, EndReason, Status};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::db;
use crate::db::User;
use crate::lobby::{ClockSpec, Layout};
use crate::{now_ms, AppState};

#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TourStatus {
    Created,
    Running,
    Finished,
}

/// A player's arena record. `whites`/`last_opponent` only steer pairing and are
/// not persisted.
#[derive(Clone, Debug, Default)]
pub struct Player {
    pub score: i64,
    pub games: i64,
    pub wins: i64,
    pub joined_at: i64,
    pub whites: i64,
    pub last_opponent: Option<String>,
}

pub struct Arena {
    pub id: String,
    pub name: String,
    pub clock: ClockSpec,
    pub walled: bool,
    pub layout: Layout,
    pub starts_at: i64,
    pub duration_ms: i64,
    pub created_by: String,
    pub status: TourStatus,
    pub players: HashMap<String, Player>,
}

/// Points for a win / draw.
const WIN: i64 = 2;
const DRAW: i64 = 1;

pub const TICK: std::time::Duration = std::time::Duration::from_secs(3);

impl Arena {
    pub fn ends_at(&self) -> i64 {
        self.starts_at + self.duration_ms
    }

    pub fn json(&self, conn: &rusqlite::Connection) -> Value {
        json!({
            "id": self.id,
            "name": self.name,
            "clock": self.clock,
            "walled": self.walled,
            "layout": self.layout,
            "starts_at": self.starts_at,
            "duration_ms": self.duration_ms,
            "status": self.status,
            "players": self.players.len(),
            "created_by": db::user(conn, &self.created_by),
        })
    }

    /// Score desc, then wins desc, then whoever joined first.
    pub fn standings(&self, conn: &rusqlite::Connection, busy: &HashSet<String>) -> Vec<Value> {
        let mut rows: Vec<(&String, &Player)> = self.players.iter().collect();
        rows.sort_by(|(_, a), (_, b)| {
            b.score
                .cmp(&a.score)
                .then(b.wins.cmp(&a.wins))
                .then(a.joined_at.cmp(&b.joined_at))
        });
        rows.into_iter()
            .filter_map(|(id, p)| {
                Some(json!({
                    "user": db::user(conn, id)?,
                    "score": p.score,
                    "games": p.games,
                    "wins": p.wins,
                    "playing": busy.contains(id),
                }))
            })
            .collect()
    }

    /// Pair the free players; returns (white, black) user ids. Repeats of the
    /// previous opponent are avoided while another partner is available.
    fn pair(&mut self, free: Vec<String>) -> Vec<(String, String)> {
        let mut free = free;
        free.shuffle(&mut rand::thread_rng());
        let mut out = Vec::new();
        while free.len() >= 2 {
            let a = free.remove(0);
            let last = self.players[&a].last_opponent.clone();
            let i = free
                .iter()
                .position(|b| Some(b) != last.as_ref())
                .unwrap_or(0);
            let b = free.remove(i);
            let (whites_a, whites_b) = (self.players[&a].whites, self.players[&b].whites);
            let a_white = match whites_a.cmp(&whites_b) {
                std::cmp::Ordering::Less => true,
                std::cmp::Ordering::Greater => false,
                std::cmp::Ordering::Equal => rand::random(),
            };
            let (white, black) = if a_white { (a, b) } else { (b, a) };
            if let Some(p) = self.players.get_mut(&white) {
                p.whites += 1;
                p.last_opponent = Some(black.clone());
            }
            if let Some(p) = self.players.get_mut(&black) {
                p.last_opponent = Some(white.clone());
            }
            out.push((white, black));
        }
        out
    }
}

/// Restore created/running tournaments; finished ones stay history in the DB.
pub fn rehydrate(state: &Arc<AppState>) {
    let arenas = db::load_tournaments(&state.db.lock(), false, 100);
    let mut tours = state.tournaments.lock();
    for arena in arenas {
        tours.insert(arena.id.clone(), arena);
    }
}

/// Join or leave an arena.
pub fn set_joined(state: &AppState, user: &User, id: &str, joined: bool) -> Result<(), String> {
    let value = {
        let mut tours = state.tournaments.lock();
        let arena = tours.get_mut(id).ok_or("unknown tournament")?;
        if arena.status == TourStatus::Finished {
            return Err("tournament is over".into());
        }
        let changed = if joined {
            let missing = !arena.players.contains_key(&user.id);
            if missing {
                let p = Player {
                    joined_at: now_ms(),
                    ..Player::default()
                };
                db::upsert_tournament_player(&state.db.lock(), id, &user.id, &p);
                arena.players.insert(user.id.clone(), p);
            }
            missing
        } else {
            let removed = arena.players.remove(&user.id).is_some();
            if removed {
                db::delete_tournament_player(&state.db.lock(), id, &user.id);
            }
            removed
        };
        let value = arena.json(&state.db.lock());
        if changed {
            let _ = state
                .lobby_tx
                .send(json!({"t": "tour", "tournament": value}).to_string());
        }
        value
    };
    state.send_to_user(
        &user.id,
        &json!({"t": "tour", "tournament": value, "joined": joined}),
    );
    Ok(())
}

/// Fold a finished tournament game into its players' scores.
pub fn record_result(state: &AppState, tid: &str, white: &str, black: &str, status: &Status) {
    let (white_score, black_score) = match status {
        Status::Won { winner, .. } if *winner == Color::White => (WIN, 0),
        Status::Won { .. } => (0, WIN),
        Status::Draw { reason } if *reason != EndReason::Abandoned => (DRAW, DRAW),
        // Aborted (unrated) games score nothing and do not count as played.
        _ => return,
    };
    let mut tours = state.tournaments.lock();
    let Some(arena) = tours.get_mut(tid) else {
        return;
    };
    let conn = state.db.lock();
    for (id, score) in [(white, white_score), (black, black_score)] {
        if let Some(p) = arena.players.get_mut(id) {
            p.score += score;
            p.games += 1;
            p.wins += (score == WIN) as i64;
            db::upsert_tournament_player(&conn, tid, id, p);
        }
    }
}

/// Players busy in an unfinished tournament game, per tournament id.
pub fn busy_players(state: &AppState) -> HashMap<String, HashSet<String>> {
    let rooms: Vec<_> = state.rooms.lock().values().cloned().collect();
    let mut busy: HashMap<String, HashSet<String>> = HashMap::new();
    for room in rooms {
        let r = room.lock();
        if r.game.status != Status::Playing {
            continue;
        }
        if let Some(tid) = &r.tournament_id {
            let set = busy.entry(tid.clone()).or_default();
            set.insert(r.white.id.clone());
            set.insert(r.black.id.clone());
        }
    }
    busy
}

pub fn spawn_tick(state: Arc<AppState>) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(TICK).await;
            tick(&state);
        }
    });
}

/// Advance statuses and pair whoever is free. Never holds the tournaments lock
/// while touching rooms: the busy set is gathered first, games are created after.
fn tick(state: &Arc<AppState>) {
    let now = now_ms();
    let busy = busy_players(state);
    let online: HashSet<String> = state.conns.lock().keys().cloned().collect();
    let mut announce: Vec<Value> = Vec::new();
    let mut pairings: Vec<(String, ClockSpec, bool, Layout, String, String)> = Vec::new();
    {
        let mut tours = state.tournaments.lock();
        for arena in tours.values_mut() {
            let status = if now >= arena.ends_at() {
                TourStatus::Finished
            } else if now >= arena.starts_at {
                TourStatus::Running
            } else {
                TourStatus::Created
            };
            if status != arena.status {
                arena.status = status;
                db::set_tournament_status(&state.db.lock(), &arena.id, status);
                announce.push(arena.json(&state.db.lock()));
            }
            if arena.status != TourStatus::Running {
                continue;
            }
            let empty = HashSet::new();
            let playing = busy.get(&arena.id).unwrap_or(&empty);
            let free: Vec<String> = arena
                .players
                .keys()
                .filter(|id| online.contains(*id) && !playing.contains(*id))
                .cloned()
                .collect();
            for (white, black) in arena.pair(free) {
                pairings.push((
                    arena.id.clone(),
                    arena.clock,
                    arena.walled,
                    arena.layout,
                    white,
                    black,
                ));
            }
        }
    }
    for value in announce {
        let _ = state
            .lobby_tx
            .send(json!({"t": "tour", "tournament": value}).to_string());
    }
    for (tid, clock, walled, layout, white, black) in pairings {
        let users = {
            let conn = state.db.lock();
            db::user(&conn, &white).zip(db::user(&conn, &black))
        };
        let Some((white, black)) = users else {
            continue;
        };
        crate::ws::create_game(state, white, black, clock, walled, layout, Some(tid));
    }
}
