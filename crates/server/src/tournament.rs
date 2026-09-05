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
    /// False after leaving: keeps the score, no longer paired.
    pub joined: bool,
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
    /// Last `CHAT_HISTORY` chat lines (memory only).
    pub chat: std::collections::VecDeque<Value>,
}

/// Points for a win / draw.
const WIN: i64 = 2;
const DRAW: i64 = 1;

pub const TICK: std::time::Duration = std::time::Duration::from_secs(3);

const CHAT_HISTORY: usize = 50;

impl Arena {
    pub fn push_chat(&mut self, line: Value) {
        if self.chat.len() == CHAT_HISTORY {
            self.chat.pop_front();
        }
        self.chat.push_back(line);
    }

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

    /// Score desc, then wins desc, then whoever joined first. Capped at `MAX_STANDINGS`.
    pub fn standings(&self, conn: &rusqlite::Connection, busy: &HashSet<String>) -> Vec<Value> {
        let mut rows: Vec<(&String, &Player)> = self.players.iter().collect();
        rows.sort_by(|(_, a), (_, b)| {
            b.score
                .cmp(&a.score)
                .then(b.wins.cmp(&a.wins))
                .then(a.joined_at.cmp(&b.joined_at))
        });
        rows.truncate(MAX_STANDINGS);
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

    /// 1-based rank of `user_id` by the standings order, if they took part.
    pub fn rank_of(&self, user_id: &str) -> Option<usize> {
        let me = self.players.get(user_id)?;
        let key = |p: &Player| (-p.score, -p.wins, p.joined_at);
        Some(1 + self.players.values().filter(|p| key(p) < key(me)).count())
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
            out.push(if a_white { (a, b) } else { (b, a) });
        }
        out
    }

    /// Colour/opponent bookkeeping, applied once the game really exists.
    fn applied(&mut self, white: &str, black: &str) {
        if let Some(p) = self.players.get_mut(white) {
            p.whites += 1;
            p.last_opponent = Some(black.to_string());
        }
        if let Some(p) = self.players.get_mut(black) {
            p.last_opponent = Some(white.to_string());
        }
    }
}

/// Rows returned by `standings`; an arena may hold far more players.
const MAX_STANDINGS: usize = 200;

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
        // Leaving without ever joining must not create a standings row.
        if !joined && !arena.players.contains_key(&user.id) {
            return Ok(());
        }
        let p = arena
            .players
            .entry(user.id.clone())
            .or_insert_with(|| Player {
                joined_at: now_ms(),
                joined: false,
                ..Player::default()
            });
        let changed = p.joined != joined;
        if changed {
            p.joined = joined;
            db::upsert_tournament_player(&state.db.lock(), id, &user.id, p);
        }
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
    // A game paired before the end may finish after it; the table is closed.
    if arena.status == TourStatus::Finished {
        return;
    }
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

/// Everyone in a live game (`.0`, whatever the game is), and the subset playing a
/// tournament game per tournament id (`.1`, for the `playing` badge). A player busy in a
/// casual game must not be paired by an arena either, or they end up with two live games.
pub fn busy_players(state: &AppState) -> (HashSet<String>, HashMap<String, HashSet<String>>) {
    let rooms: Vec<_> = state.rooms.lock().values().cloned().collect();
    let mut all: HashSet<String> = HashSet::new();
    let mut by_tour: HashMap<String, HashSet<String>> = HashMap::new();
    for room in rooms {
        let r = room.lock();
        if r.game.status != Status::Playing {
            continue;
        }
        all.insert(r.white.id.clone());
        all.insert(r.black.id.clone());
        if let Some(tid) = &r.tournament_id {
            let set = by_tour.entry(tid.clone()).or_default();
            set.insert(r.white.id.clone());
            set.insert(r.black.id.clone());
        }
    }
    (all, by_tour)
}

/// Drop a player from the pairing pool (arena no-show); their score is kept.
pub fn unjoin(state: &AppState, tid: &str, user_id: &str) {
    let value = {
        let mut tours = state.tournaments.lock();
        let Some(arena) = tours.get_mut(tid) else {
            return;
        };
        let Some(p) = arena.players.get_mut(user_id).filter(|p| p.joined) else {
            return;
        };
        p.joined = false;
        let conn = state.db.lock();
        db::upsert_tournament_player(&conn, tid, user_id, p);
        arena.json(&conn)
    };
    state.send_to_user(
        user_id,
        &json!({"t": "tour", "tournament": value, "joined": false}),
    );
}

pub fn spawn_tick(state: Arc<AppState>) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(TICK).await;
            tick(&state);
        }
    });
}

/// Hourly system arenas so there is always something to join: one upcoming at a time,
/// starting on the next full hour (at least 5 minutes away), 30 minutes long.
const SCHEDULE: [(&str, i64, i64); 4] = [
    ("Hourly Blitz Arena", 3 * 60_000, 2_000),
    ("Hourly Bullet Arena", 60_000, 0),
    ("Hourly Blitz Arena", 5 * 60_000, 0),
    ("Hourly Rapid Arena", 10 * 60_000, 0),
];
const HOUR_MS: i64 = 3_600_000;

fn schedule(state: &Arc<AppState>, now: i64) -> Option<Value> {
    let mut tours = state.tournaments.lock();
    // Only *upcoming* ones count: while an arena runs there must still be a next one to join.
    let has_upcoming = tours
        .values()
        .any(|a| a.created_by == db::SYSTEM_USER_ID && a.status == TourStatus::Created);
    if has_upcoming {
        return None;
    }
    let mut starts_at = (now / HOUR_MS + 1) * HOUR_MS;
    if starts_at - now < 5 * 60_000 {
        starts_at += HOUR_MS;
    }
    let slot = ((starts_at / HOUR_MS) % SCHEDULE.len() as i64) as usize;
    let (name, initial_ms, increment_ms) = SCHEDULE[slot];
    let arena = Arena {
        id: crate::rand_id(8),
        name: name.into(),
        clock: ClockSpec {
            initial_ms,
            increment_ms,
        },
        walled: false,
        layout: Layout::Standard,
        starts_at,
        duration_ms: 30 * 60_000,
        created_by: db::SYSTEM_USER_ID.into(),
        status: TourStatus::Created,
        players: HashMap::new(),
        chat: Default::default(),
    };
    let conn = state.db.lock();
    db::insert_tournament(&conn, &arena);
    let value = arena.json(&conn);
    tours.insert(arena.id.clone(), arena);
    Some(value)
}

/// Advance statuses and pair whoever is free. Never holds the tournaments lock
/// while touching rooms: the busy set is gathered first, games are created after.
fn tick(state: &Arc<AppState>) {
    let now = now_ms();
    let (busy_anywhere, busy_by_tour) = busy_players(state);
    let online: HashSet<String> = state.conns.lock().keys().cloned().collect();
    let mut announce: Vec<Value> = Vec::new();
    announce.extend(schedule(state, now));
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
            // Lichess-style: no pairing that cannot be finished inside the arena.
            if now + arena.clock.initial_ms > arena.ends_at() {
                continue;
            }
            let free: Vec<String> = arena
                .players
                .iter()
                .filter(|(id, p)| p.joined && online.contains(*id) && !busy_anywhere.contains(*id))
                .map(|(id, _)| id)
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
        // Finished arenas are history in the DB; keep only the ones a live game still scores.
        tours.retain(|id, a| a.status != TourStatus::Finished || busy_by_tour.contains_key(id));
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
        let (white_id, black_id) = (white.id.clone(), black.id.clone());
        crate::ws::create_game(
            state,
            white,
            black,
            clock,
            crate::lobby::game_config(walled, layout, None),
            Some(tid.clone()),
        );
        if let Some(arena) = state.tournaments.lock().get_mut(&tid) {
            arena.applied(&white_id, &black_id);
        }
    }
}
