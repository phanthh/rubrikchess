mod bot;
mod db;
mod lobby;
mod rating;
mod room;
mod tournament;
mod ws;

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use parking_lot::Mutex;
use rand::Rng;
use serde::Deserialize;
use serde_json::json;
use tokio::sync::{broadcast, mpsc};
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use crate::db::User;
use crate::lobby::{Challenge, Layout, Lobby, CHALLENGE_TTL_MS};
use crate::room::Room;
use crate::tournament::{Arena, TourStatus};

/// Lock order, taken by every path that needs more than one: `rooms` → `tournaments` →
/// `db`. `parking_lot` mutexes never time out, so an inversion is a hard deadlock.
pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub lobby: Mutex<Lobby>,
    pub rooms: Mutex<HashMap<String, Arc<Mutex<Room>>>>,
    /// Live websocket connections per user id (a user may have several tabs).
    pub conns: Mutex<HashMap<String, Vec<mpsc::UnboundedSender<String>>>>,
    /// When each user's last socket closed (absent = currently connected).
    pub gone: Mutex<HashMap<String, i64>>,
    /// Open challenge links, one per user.
    pub challenges: Mutex<HashMap<String, Challenge>>,
    /// Live arenas: created + running, plus finished ones a live game still scores.
    pub tournaments: Mutex<HashMap<String, Arena>>,
    /// Sliding-window rate limits: recent event times per (user, key).
    pub limits: Mutex<HashMap<(String, String), VecDeque<i64>>>,
    pub lobby_tx: broadcast::Sender<String>,
}

impl AppState {
    pub fn new(db_path: &str) -> AppState {
        AppState {
            db: Mutex::new(db::open(db_path)),
            lobby: Mutex::new(Lobby::default()),
            rooms: Mutex::new(HashMap::new()),
            conns: Mutex::new(HashMap::new()),
            gone: Mutex::new(HashMap::new()),
            challenges: Mutex::new(HashMap::new()),
            tournaments: Mutex::new(HashMap::new()),
            limits: Mutex::new(HashMap::new()),
            lobby_tx: broadcast::channel(64).0,
        }
    }

    /// Allow at most `max` events per `window_ms` for (user, key); counts across all tabs.
    pub fn allow(&self, user_id: &str, key: &str, max: usize, window_ms: i64) -> bool {
        let now = now_ms();
        let mut limits = self.limits.lock();
        let recent = limits
            .entry((user_id.to_string(), key.to_string()))
            .or_default();
        while recent.front().is_some_and(|t| now - t >= window_ms) {
            recent.pop_front();
        }
        if recent.len() >= max {
            return false;
        }
        recent.push_back(now);
        true
    }

    /// Drop bookkeeping nobody can read any more: long-gone users and spent
    /// rate-limit windows. Called periodically; both maps are driven by
    /// anonymous clients and would grow without bound otherwise.
    pub fn sweep(self: &Arc<Self>) {
        let now = now_ms();
        self.gone
            .lock()
            .retain(|_, since| now - *since < GONE_KEEP_MS);
        self.limits.lock().retain(|_, recent| {
            while recent.front().is_some_and(|t| now - t >= LIMIT_KEEP_MS) {
                recent.pop_front();
            }
            !recent.is_empty()
        });
        // Correspondence games nobody touches any more.
        let rooms: Vec<_> = self.rooms.lock().values().cloned().collect();
        for room in rooms {
            let mut r = room.lock();
            if r.game.status == rubrik_core::Status::Playing
                && r.clock.unlimited()
                && now - r.last_move_at > room::IDLE_UNLIMITED_MS
            {
                r.end(
                    self,
                    rubrik_core::Status::Draw {
                        reason: rubrik_core::EndReason::Abandoned,
                    },
                );
                room::persist(self, &r);
            }
        }
    }

    pub fn broadcast_lobby(&self) {
        let online = self.conns.lock().len();
        let msg = self.lobby.lock().msg(online).to_string();
        let _ = self.lobby_tx.send(msg);
    }

    pub fn send_to_user(&self, user_id: &str, msg: &serde_json::Value) {
        let text = msg.to_string();
        let mut conns = self.conns.lock();
        if let Some(list) = conns.get_mut(user_id) {
            list.retain(|tx| tx.send(text.clone()).is_ok());
        }
    }
}

const SWEEP_EVERY: std::time::Duration = std::time::Duration::from_secs(600);
/// `gone` entries this old are past any claim window.
const GONE_KEEP_MS: i64 = 3_600_000;
/// Longer than the widest rate-limit window (`tour_create`, 1h), so the sweep never
/// hands out a fresh budget.
const LIMIT_KEEP_MS: i64 = 3_600_000;

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock before epoch")
        .as_millis() as i64
}

pub fn rand_id(n: usize) -> String {
    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    (0..n)
        .map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char)
        .collect()
}

fn sid_cookie(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|c| c.split(';').find_map(|kv| kv.trim().strip_prefix("sid=")))
        .map(str::to_string)
}

fn set_cookie(sid: &str) -> String {
    // Behind TLS (SECURE_COOKIES=1) the session id must never travel in clear.
    let secure = match std::env::var("SECURE_COOKIES").as_deref() {
        Ok("1") => "; Secure",
        _ => "",
    };
    format!("sid={sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000{secure}")
}

/// Fresh session bound to `user_id`; returns the `Set-Cookie` value.
fn new_session(conn: &rusqlite::Connection, user_id: &str) -> String {
    let sid = rand_id(32);
    db::create_session(conn, &sid, user_id, now_ms());
    set_cookie(&sid)
}

/// Resolve the `sid` cookie to a user; `None` when there is no valid session.
pub fn current_user(state: &AppState, headers: &HeaderMap) -> Option<User> {
    let conn = state.db.lock();
    let sid = sid_cookie(headers)?;
    db::session_user(&conn, &sid)
}

/// As `current_user`, but minting an anonymous user when there is none. Only
/// for `GET /ws` and `GET /api/me`: every other endpoint must not let an
/// unauthenticated request write user + session rows.
/// Returns the `Set-Cookie` value when a new session was minted.
pub fn session(state: &AppState, headers: &HeaderMap) -> (User, Option<String>) {
    if let Some(u) = current_user(state, headers) {
        return (u, None);
    }
    let conn = state.db.lock();
    let user = User::anon(rand_id(16), format!("Anon-{}", rand_id(4)));
    db::create_user(&conn, &user);
    let cookie = new_session(&conn, &user.id);
    (user, Some(cookie))
}

/// 3..32 chars of `[A-Za-z0-9_-]`.
fn valid_name(name: &str) -> bool {
    (3..=32).contains(&name.chars().count())
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn error(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({ "error": msg }))).into_response()
}

fn with_cookie(cookie: Option<String>, body: serde_json::Value) -> Response {
    let mut res = Json(body).into_response();
    if let Some(c) = cookie {
        if let Ok(v) = c.parse() {
            res.headers_mut().insert(header::SET_COOKIE, v);
        }
    }
    res
}

async fn get_me(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let (user, cookie) = session(&state, &headers);
    with_cookie(cookie, json!(user))
}

#[derive(Deserialize)]
struct NameBody {
    name: String,
}

async fn post_me(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<NameBody>,
) -> Response {
    let Some(mut user) = current_user(&state, &headers) else {
        return error(StatusCode::UNAUTHORIZED, "no session");
    };
    let name = body.name.trim().to_string();
    if !valid_name(&name) {
        return error(StatusCode::BAD_REQUEST, "invalid name");
    }
    let conn = state.db.lock();
    match db::user_by_name(&conn, &name) {
        Some(u) if u.id != user.id => return error(StatusCode::CONFLICT, "name taken"),
        _ => db::rename_user(&conn, &user.id, &name),
    }
    user.name = name;
    Json(json!(user)).into_response()
}

#[derive(Deserialize)]
struct CredsBody {
    name: String,
    password: String,
}

fn hash_password(password: &str) -> Option<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .ok()
        .map(|h| h.to_string())
}

fn verify_password(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash)
        .map(|h| {
            Argon2::default()
                .verify_password(password.as_bytes(), &h)
                .is_ok()
        })
        .unwrap_or(false)
}

/// Claim the current anonymous account with a name + password.
async fn post_register(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CredsBody>,
) -> Response {
    let Some(mut user) = current_user(&state, &headers) else {
        return error(StatusCode::UNAUTHORIZED, "no session");
    };
    let name = body.name.trim().to_string();
    if !valid_name(&name) {
        return error(StatusCode::BAD_REQUEST, "invalid name");
    }
    if body.password.chars().count() < 6 {
        return error(StatusCode::BAD_REQUEST, "password too short");
    }
    if user.registered {
        return error(StatusCode::CONFLICT, "already registered");
    }
    let Some(hash) = hash_password(&body.password) else {
        return error(StatusCode::INTERNAL_SERVER_ERROR, "hash failed");
    };
    let conn = state.db.lock();
    if db::user_by_name(&conn, &name).is_some_and(|u| u.id != user.id) {
        return error(StatusCode::CONFLICT, "name taken");
    }
    db::register_user(&conn, &user.id, &name, &hash);
    user.name = name;
    user.registered = true;
    Json(json!(user)).into_response()
}

#[derive(Deserialize)]
struct PasswordBody {
    old: String,
    new: String,
}

async fn post_password(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<PasswordBody>,
) -> Response {
    let Some(user) = current_user(&state, &headers) else {
        return error(StatusCode::UNAUTHORIZED, "no session");
    };
    if !user.registered {
        return error(StatusCode::BAD_REQUEST, "not registered");
    }
    if body.new.chars().count() < 6 {
        return error(StatusCode::BAD_REQUEST, "password too short");
    }
    if !state.allow(&user.id, "password", 5, 600_000) {
        return error(StatusCode::TOO_MANY_REQUESTS, "slow down");
    }
    let conn = state.db.lock();
    let ok = db::password_hash(&conn, &user.id).is_some_and(|h| verify_password(&body.old, &h));
    if !ok {
        return error(StatusCode::UNAUTHORIZED, "wrong password");
    }
    let Some(hash) = hash_password(&body.new) else {
        return error(StatusCode::INTERNAL_SERVER_ERROR, "hash failed");
    };
    db::set_password(&conn, &user.id, &hash);
    // A stolen session must not outlive the password it was obtained with.
    db::delete_other_sessions(&conn, &user.id, &sid_cookie(&headers).unwrap_or_default());
    Json(json!(user)).into_response()
}

async fn post_login(State(state): State<Arc<AppState>>, Json(body): Json<CredsBody>) -> Response {
    // No session yet, so the limit is keyed by the account being guessed at: 10 argon2
    // verifications per 10 minutes and account.
    let name = body.name.trim().to_lowercase();
    if !state.allow(&format!("login:{name}"), "login", 10, 600_000) {
        return error(StatusCode::TOO_MANY_REQUESTS, "slow down");
    }
    let conn = state.db.lock();
    let user = db::user_by_name(&conn, body.name.trim());
    let ok = user.as_ref().is_some_and(|u| {
        db::password_hash(&conn, &u.id).is_some_and(|h| verify_password(&body.password, &h))
    });
    let Some(user) = user.filter(|_| ok) else {
        return error(StatusCode::UNAUTHORIZED, "bad credentials");
    };
    let cookie = new_session(&conn, &user.id);
    with_cookie(Some(cookie), json!(user))
}

/// Drop the session and hand out a fresh anonymous one.
async fn post_logout(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if current_user(&state, &headers).is_none() {
        return error(StatusCode::UNAUTHORIZED, "no session");
    }
    let conn = state.db.lock();
    if let Some(sid) = sid_cookie(&headers) {
        db::delete_session(&conn, &sid);
    }
    let user = User::anon(rand_id(16), format!("Anon-{}", rand_id(4)));
    db::create_user(&conn, &user);
    let cookie = new_session(&conn, &user.id);
    with_cookie(Some(cookie), json!(user))
}

async fn get_user(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> Response {
    let conn = state.db.lock();
    let Some(user) = db::user_by_name(&conn, &name) else {
        return error(StatusCode::NOT_FOUND, "not found");
    };
    let games = db::list_games(&conn, 20, Some(&user.id), None);
    let history = db::rating_history(&conn, &user.id);
    let tournaments: Vec<serde_json::Value> = db::user_tournaments(&conn, &user.id, 10)
        .into_iter()
        .filter_map(|tid| {
            let arena = db::load_tournament(&conn, &tid)?;
            let me = arena.players.get(&user.id)?;
            Some(json!({
                "id": arena.id,
                "name": arena.name,
                "status": arena.status,
                "players": arena.players.len(),
                "rank": arena.rank_of(&user.id),
                "score": me.score,
                "games": me.games,
            }))
        })
        .collect();
    let followers = db::follower_count(&conn, &user.id);
    drop(conn);
    let me = current_user(&state, &headers);
    let following = me
        .as_ref()
        .is_some_and(|me| db::is_following(&state.db.lock(), &me.id, &user.id));
    let blocked = me
        .as_ref()
        .is_some_and(|me| db::is_blocked(&state.db.lock(), &me.id, &user.id));
    let online = state.conns.lock().contains_key(&user.id);
    Json(json!({
        "user": user,
        "games": games,
        "history": history,
        "online": online,
        "tournaments": tournaments,
        "following": following,
        "followers": followers,
        "blocked": blocked,
    }))
    .into_response()
}

fn set_block(state: &AppState, headers: &HeaderMap, name: &str, on: bool) -> Response {
    let Some(me) = current_user(state, headers) else {
        return error(StatusCode::UNAUTHORIZED, "no session");
    };
    if !state.allow(&me.id, "follow", 30, 600_000) {
        return error(StatusCode::TOO_MANY_REQUESTS, "slow down");
    }
    let conn = state.db.lock();
    let Some(target) = db::user_by_name(&conn, name) else {
        return error(StatusCode::NOT_FOUND, "not found");
    };
    if target.id == me.id {
        return error(StatusCode::BAD_REQUEST, "cannot block yourself");
    }
    db::set_block(&conn, &me.id, &target.id, on, now_ms());
    if on {
        db::unfollow(&conn, &me.id, &target.id);
    }
    Json(json!({ "blocked": on })).into_response()
}

async fn post_block(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> Response {
    set_block(&state, &headers, &name, true)
}

async fn delete_block(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> Response {
    set_block(&state, &headers, &name, false)
}

async fn post_follow(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> Response {
    set_follow(&state, &headers, &name, true)
}

async fn delete_follow(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> Response {
    set_follow(&state, &headers, &name, false)
}

fn set_follow(state: &AppState, headers: &HeaderMap, name: &str, on: bool) -> Response {
    let Some(me) = current_user(state, headers) else {
        return error(StatusCode::UNAUTHORIZED, "no session");
    };
    if !state.allow(&me.id, "follow", 30, 600_000) {
        return error(StatusCode::TOO_MANY_REQUESTS, "slow down");
    }
    let conn = state.db.lock();
    let Some(target) = db::user_by_name(&conn, name) else {
        return error(StatusCode::NOT_FOUND, "not found");
    };
    if target.id == me.id {
        return error(StatusCode::BAD_REQUEST, "cannot follow yourself");
    }
    match on {
        true => db::follow(&conn, &me.id, &target.id, now_ms()),
        false => db::unfollow(&conn, &me.id, &target.id),
    }
    Json(json!({ "following": on })).into_response()
}

/// Users the session follows, with presence and the live game they are in.
async fn get_friends(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let Some(me) = current_user(&state, &headers) else {
        return error(StatusCode::UNAUTHORIZED, "no session");
    };
    // One pass over the live rooms: user id → the game they play right now.
    let rooms: Vec<_> = state.rooms.lock().values().cloned().collect();
    let mut playing: HashMap<String, String> = HashMap::new();
    for room in &rooms {
        let r = room.lock();
        if r.game.status != rubrik_core::Status::Playing {
            continue;
        }
        playing.insert(r.white.id.clone(), r.id.clone());
        playing.insert(r.black.id.clone(), r.id.clone());
    }
    let follows = db::following(&state.db.lock(), &me.id);
    let conns = state.conns.lock();
    let friends: Vec<serde_json::Value> = follows
        .into_iter()
        .map(|user| {
            json!({
                "online": conns.contains_key(&user.id),
                "playing": playing.get(&user.id),
                "user": user,
            })
        })
        .collect();
    Json(friends).into_response()
}

#[derive(Deserialize)]
struct TextBody {
    text: String,
}

async fn post_message(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Json(body): Json<TextBody>,
) -> Response {
    let Some(me) = current_user(&state, &headers) else {
        return error(StatusCode::UNAUTHORIZED, "no session");
    };
    let text = body.text.trim().to_string();
    if !(1..=500).contains(&text.chars().count()) {
        return error(StatusCode::BAD_REQUEST, "invalid text");
    }
    if !state.allow(&me.id, "message", 20, 600_000) {
        return error(StatusCode::TOO_MANY_REQUESTS, "slow down");
    }
    let conn = state.db.lock();
    let Some(target) = db::user_by_name(&conn, &name) else {
        return error(StatusCode::NOT_FOUND, "not found");
    };
    if target.id == me.id {
        return error(StatusCode::BAD_REQUEST, "cannot message yourself");
    }
    if db::contact_blocked(&conn, &me.id, &target.id) {
        return error(StatusCode::FORBIDDEN, "blocked");
    }
    let message = db::send_message(&conn, &me.id, &target.id, &text, now_ms());
    drop(conn);
    state.send_to_user(
        &target.id,
        &json!({"t": "pm", "message": message, "from": me}),
    );
    Json(json!(message)).into_response()
}

/// The session's conversations, newest first.
async fn get_messages(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let Some(me) = current_user(&state, &headers) else {
        return error(StatusCode::UNAUTHORIZED, "no session");
    };
    Json(db::conversations(&state.db.lock(), &me.id)).into_response()
}

/// One conversation, oldest first; reading it clears the unread count.
async fn get_conversation(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> Response {
    let Some(me) = current_user(&state, &headers) else {
        return error(StatusCode::UNAUTHORIZED, "no session");
    };
    let conn = state.db.lock();
    let Some(other) = db::user_by_name(&conn, &name) else {
        return error(StatusCode::NOT_FOUND, "not found");
    };
    let messages = db::conversation(&conn, &me.id, &other.id);
    db::mark_read(&conn, &me.id, &other.id);
    Json(messages).into_response()
}

/// The bot's user row, so a client can show its rating next to "play the bot".
async fn get_bot(State(state): State<Arc<AppState>>) -> Response {
    match db::user(&state.db.lock(), db::SYSTEM_USER_ID) {
        Some(user) => Json(user).into_response(),
        None => error(StatusCode::NOT_FOUND, "not found"),
    }
}

async fn get_leaderboard(
    State(state): State<Arc<AppState>>,
    Query(q): Query<LeaderQuery>,
) -> Response {
    let limit = q.limit.unwrap_or(20).clamp(1, 200);
    Json(db::leaderboard(&state.db.lock(), limit, q.perf.as_deref())).into_response()
}

#[derive(Deserialize)]
struct LeaderQuery {
    limit: Option<i64>,
    /// Rank by this speed bucket instead of the overall rating.
    perf: Option<String>,
}

#[derive(Deserialize)]
struct ListQuery {
    limit: Option<i64>,
    /// `created_at` cursor: only older games.
    before: Option<i64>,
}

async fn get_games(State(state): State<Arc<AppState>>, Query(q): Query<ListQuery>) -> Response {
    let limit = q.limit.unwrap_or(20).clamp(1, 200);
    let games = db::list_games(&state.db.lock(), limit, None, q.before);
    Json(games).into_response()
}

/// The current session's live games, so a client can badge "your turn" without
/// polling every live game on the server (`/api/tv`).
async fn get_my_games(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let Some(user) = current_user(&state, &headers) else {
        return error(StatusCode::UNAUTHORIZED, "no session");
    };
    let rooms: Vec<_> = state.rooms.lock().values().cloned().collect();
    let now = now_ms();
    let mine: Vec<serde_json::Value> = rooms
        .iter()
        .filter_map(|room| {
            let r = room.lock();
            let color = r.color_of(&user.id)?;
            if r.game.status != rubrik_core::Status::Playing {
                return None;
            }
            let opponent = match color {
                rubrik_core::Color::White => &r.black,
                rubrik_core::Color::Black => &r.white,
            };
            Some(json!({
                "id": r.id,
                "opponent": opponent,
                "my_turn": r.game.turn == color,
                "plies": r.game.history.len(),
                "clock": r.clock.normalized(now),
            }))
        })
        .collect();
    Json(mine).into_response()
}

/// Games in progress right now, most watched first.
async fn get_tv(State(state): State<Arc<AppState>>) -> Response {
    let rooms: Vec<_> = state.rooms.lock().values().cloned().collect();
    // TV order: most watched, then games that have actually started, then strongest players.
    let mut live: Vec<((usize, bool, i64), serde_json::Value)> = rooms
        .iter()
        .filter_map(|room| {
            let r = room.lock();
            if r.game.status != rubrik_core::Status::Playing {
                return None;
            }
            let top = r.white.rating.max(r.black.rating).round() as i64;
            let row = json!({
                "id": r.id,
                "white": r.white,
                "black": r.black,
                "clock": {
                    "initial_ms": r.clock.initial_ms,
                    "increment_ms": r.clock.increment_ms,
                },
                "layout": Layout::of(r.game.config.layout),
                "walled": r.game.config.rules.walled,
                "plies": r.game.history.len(),
                "watchers": r.watchers,
                "created_at": r.created_at,
                "tournament_id": r.tournament_id,
            });
            Some(((r.watchers, !r.game.history.is_empty(), top), row))
        })
        .collect();
    live.sort_by_key(|(k, _)| std::cmp::Reverse(*k));
    Json(live.into_iter().map(|(_, v)| v).collect::<Vec<_>>()).into_response()
}

#[derive(Deserialize)]
struct PairQuery {
    a: String,
    b: String,
}

/// Head-to-head record between two players (draws count a half).
async fn get_crosstable(
    State(state): State<Arc<AppState>>,
    Query(q): Query<PairQuery>,
) -> Response {
    let games = db::head_to_head(&state.db.lock(), &q.a, &q.b);
    let a_won = |a_white: bool, winner: &Option<String>| {
        winner.as_deref().map(|w| (w == "white") == a_white)
    };
    let a_score: f64 = games
        .iter()
        .map(|(_, a_white, winner)| match a_won(*a_white, winner) {
            Some(true) => 1.0,
            Some(false) => 0.0,
            None => 0.5,
        })
        .sum();
    let recent: Vec<serde_json::Value> = games[games.len().saturating_sub(10)..]
        .iter()
        .map(|(id, a_white, winner)| {
            json!({"id": id, "winner": a_won(*a_white, winner).map(|a| if a { "a" } else { "b" })})
        })
        .collect();
    Json(json!({
        "a_score": a_score,
        "b_score": games.len() as f64 - a_score,
        "games": games.len(),
        "recent": recent,
    }))
    .into_response()
}

async fn get_challenge(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    let challenges = state.challenges.lock();
    match challenges
        .get(&id)
        .filter(|c| now_ms() - c.created_at < CHALLENGE_TTL_MS)
    {
        Some(c) => Json(json!(c)).into_response(),
        None => error(StatusCode::NOT_FOUND, "not found"),
    }
}

#[derive(Deserialize)]
struct TournamentBody {
    name: String,
    clock: lobby::ClockSpec,
    #[serde(default)]
    walled: bool,
    #[serde(default)]
    layout: Layout,
    starts_in_ms: i64,
    duration_ms: i64,
}

/// Unfinished arenas one user may have open at a time.
const MAX_TOURNAMENTS_PER_USER: usize = 3;

async fn post_tournament(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<TournamentBody>,
) -> Response {
    let Some(user) = current_user(&state, &headers) else {
        return error(StatusCode::UNAUTHORIZED, "no session");
    };
    let name = body.name.trim().to_string();
    if !(3..=40).contains(&name.chars().count()) || name.chars().any(char::is_control) {
        return error(StatusCode::BAD_REQUEST, "invalid name");
    }
    if !body.clock.valid() || body.clock.unlimited() {
        return error(StatusCode::BAD_REQUEST, "invalid clock");
    }
    if !(10_000..=3_600_000).contains(&body.starts_in_ms)
        || !(300_000..=7_200_000).contains(&body.duration_ms)
    {
        return error(StatusCode::BAD_REQUEST, "invalid schedule");
    }
    // Anonymous creators are fine, but only a few arenas an hour each. After validation:
    // typos must not burn the quota.
    if !state.allow(&user.id, "tour_create", 3, 3_600_000) {
        return error(StatusCode::TOO_MANY_REQUESTS, "slow down");
    }
    let arena = Arena {
        id: rand_id(8),
        name,
        clock: body.clock,
        walled: body.walled,
        layout: body.layout,
        starts_at: now_ms() + body.starts_in_ms,
        duration_ms: body.duration_ms,
        created_by: user.id.clone(),
        status: TourStatus::Created,
        players: HashMap::new(),
        chat: Default::default(),
    };
    let value = {
        let mut tours = state.tournaments.lock();
        // From the DB: memory only holds the arenas of this run.
        let mine = db::unfinished_tournaments_by(&state.db.lock(), &user.id);
        if mine >= MAX_TOURNAMENTS_PER_USER {
            return error(StatusCode::CONFLICT, "too many tournaments");
        }
        db::insert_tournament(&state.db.lock(), &arena);
        let value = arena.json(&state.db.lock());
        tours.insert(arena.id.clone(), arena);
        value
    };
    let _ = state
        .lobby_tx
        .send(json!({"t": "tour", "tournament": value}).to_string());
    Json(value).into_response()
}

async fn get_tournaments(State(state): State<Arc<AppState>>) -> Response {
    // tournaments before db, like every other path (see AppState).
    let tours = state.tournaments.lock();
    let conn = state.db.lock();
    let (mut upcoming, mut running) = (Vec::new(), Vec::new());
    for arena in tours.values() {
        match arena.status {
            TourStatus::Created => upcoming.push((arena.starts_at, arena.json(&conn))),
            TourStatus::Running => running.push((arena.starts_at, arena.json(&conn))),
            TourStatus::Finished => {}
        }
    }
    upcoming.sort_by_key(|(at, _)| *at);
    running.sort_by_key(|(at, _)| *at);
    let strip =
        |v: Vec<(i64, serde_json::Value)>| v.into_iter().map(|(_, j)| j).collect::<Vec<_>>();
    let finished: Vec<serde_json::Value> = db::load_tournaments(&conn, true, 10)
        .iter()
        .map(|a| a.json(&conn))
        .collect();
    Json(json!({
        "upcoming": strip(upcoming),
        "running": strip(running),
        "finished": finished,
    }))
    .into_response()
}

async fn get_tournament(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let me = current_user(&state, &headers);
    // Rooms before tournaments: the tick loop takes the locks in that order too.
    let busy = tournament::busy_players(&state)
        .1
        .remove(&id)
        .unwrap_or_default();
    let tours = state.tournaments.lock();
    let conn = state.db.lock();
    let stored = match tours.contains_key(&id) {
        true => None,
        false => db::load_tournament(&conn, &id),
    };
    let Some(arena) = tours.get(&id).or(stored.as_ref()) else {
        return error(StatusCode::NOT_FOUND, "not found");
    };
    let joined = me.is_some_and(|u| arena.players.get(&u.id).is_some_and(|p| p.joined));
    Json(json!({
        "tournament": arena.json(&conn),
        "standings": arena.standings(&conn, &busy),
        "games": db::tournament_games(&conn, &id, 20),
        "joined": joined,
        "chat": arena.chat,
    }))
    .into_response()
}

async fn get_game(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    // Live room wins: it has the freshest clock/moves.
    let live = state.rooms.lock().get(&id).cloned();
    if let Some(room) = live {
        let r = room.lock();
        return Json(json!({
            "id": r.id,
            "white": r.white,
            "black": r.black,
            "config": r.game.config,
            "layout": Layout::of(r.game.config.layout),
            "walled": r.game.config.rules.walled,
            "moves": r.game.history,
            "times": r.times,
            "status": r.game.status,
            "clock": r.clock,
            "created_at": r.created_at,
            "plies": r.game.history.len(),
            "white_diff": r.white_diff,
            "black_diff": r.black_diff,
            "tournament_id": r.tournament_id,
        }))
        .into_response();
    }
    match db::load_game(&state.db.lock(), &id) {
        Some(row) => Json(row).into_response(),
        None => (StatusCode::NOT_FOUND, Json(json!({"error": "not found"}))).into_response(),
    }
}

pub fn router(state: Arc<AppState>) -> Router {
    let dist = std::env::var("WEB_DIST").unwrap_or_else(|_| "../../apps/web/dist".to_string());
    let index = std::path::Path::new(&dist).join("index.html");
    let static_files = ServeDir::new(&dist).fallback(ServeFile::new(index));
    Router::new()
        .route("/api/me", get(get_me).post(post_me))
        .route("/api/me/games", get(get_my_games))
        .route("/api/register", post(post_register))
        .route("/api/password", post(post_password))
        .route("/api/login", post(post_login))
        .route("/api/logout", post(post_logout))
        .route("/api/users/{name}", get(get_user))
        .route(
            "/api/follow/{name}",
            post(post_follow).delete(delete_follow),
        )
        .route("/api/friends", get(get_friends))
        .route("/api/block/{name}", post(post_block).delete(delete_block))
        .route("/api/messages", get(get_messages))
        .route(
            "/api/messages/{name}",
            get(get_conversation).post(post_message),
        )
        .route("/api/bot", get(get_bot))
        .route("/api/leaderboard", get(get_leaderboard))
        .route("/api/games", get(get_games))
        .route("/api/tv", get(get_tv))
        .route("/api/crosstable", get(get_crosstable))
        .route("/api/challenges/{id}", get(get_challenge))
        .route(
            "/api/tournaments",
            get(get_tournaments).post(post_tournament),
        )
        .route("/api/tournaments/{id}", get(get_tournament))
        .route("/api/games/{id}", get(get_game))
        .route("/ws", get(ws::handler))
        .fallback_service(static_files)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "rubrik_server=info,tower_http=warn".into()),
        )
        .init();

    let db_path = std::env::var("DATABASE_PATH").unwrap_or_else(|_| "data/rubrik.db".to_string());
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3000);
    let state = Arc::new(AppState::new(&db_path));
    room::rehydrate(&state);
    tournament::rehydrate(&state);
    tournament::spawn_tick(state.clone());
    tokio::spawn({
        let state = state.clone();
        async move {
            loop {
                tokio::time::sleep(SWEEP_EVERY).await;
                state.sweep();
            }
        }
    });
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .expect("bind");
    tracing::info!("listening on {}", listener.local_addr().expect("addr"));
    axum::serve(listener, router(state)).await.expect("serve");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sweep_drops_stale_bookkeeping() {
        let state = Arc::new(AppState::new(":memory:"));
        let now = now_ms();
        {
            let mut gone = state.gone.lock();
            gone.insert("old".into(), now - GONE_KEEP_MS - 1);
            gone.insert("fresh".into(), now);
        }
        state
            .limits
            .lock()
            .insert(("u".into(), "k".into()), [now - LIMIT_KEEP_MS - 1].into());
        assert!(state.allow("v", "k", 5, 10_000));

        state.sweep();

        let gone = state.gone.lock();
        assert!(!gone.contains_key("old"));
        assert!(gone.contains_key("fresh"));
        let limits = state.limits.lock();
        assert!(!limits.contains_key(&("u".into(), "k".into())));
        assert_eq!(limits.len(), 1);
    }
}
