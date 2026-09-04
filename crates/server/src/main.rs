mod db;
mod lobby;
mod rating;
mod room;
mod ws;

use std::collections::HashMap;
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
use crate::lobby::Lobby;
use crate::room::Room;

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub lobby: Mutex<Lobby>,
    pub rooms: Mutex<HashMap<String, Arc<Mutex<Room>>>>,
    /// Live websocket connections per user id (a user may have several tabs).
    pub conns: Mutex<HashMap<String, Vec<mpsc::UnboundedSender<String>>>>,
    pub lobby_tx: broadcast::Sender<String>,
}

impl AppState {
    pub fn new(db_path: &str) -> AppState {
        AppState {
            db: Mutex::new(db::open(db_path)),
            lobby: Mutex::new(Lobby::default()),
            rooms: Mutex::new(HashMap::new()),
            conns: Mutex::new(HashMap::new()),
            lobby_tx: broadcast::channel(64).0,
        }
    }

    pub fn broadcast_lobby(&self) {
        let msg = self.lobby.lock().msg().to_string();
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
    format!("sid={sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000")
}

/// Fresh session bound to `user_id`; returns the `Set-Cookie` value.
fn new_session(conn: &rusqlite::Connection, user_id: &str) -> String {
    let sid = rand_id(32);
    db::create_session(conn, &sid, user_id, now_ms());
    set_cookie(&sid)
}

/// Resolve the `sid` cookie to a user, creating an anonymous one if needed.
/// Returns the `Set-Cookie` value when a new session was minted.
pub fn session(state: &AppState, headers: &HeaderMap) -> (User, Option<String>) {
    let conn = state.db.lock();
    if let Some(sid) = sid_cookie(headers) {
        if let Some(u) = db::session_user(&conn, &sid) {
            return (u, None);
        }
    }
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
    let (mut user, cookie) = session(&state, &headers);
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
    with_cookie(cookie, json!(user))
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
    let (mut user, cookie) = session(&state, &headers);
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
    with_cookie(cookie, json!(user))
}

async fn post_login(State(state): State<Arc<AppState>>, Json(body): Json<CredsBody>) -> Response {
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
    let conn = state.db.lock();
    if let Some(sid) = sid_cookie(&headers) {
        db::delete_session(&conn, &sid);
    }
    let user = User::anon(rand_id(16), format!("Anon-{}", rand_id(4)));
    db::create_user(&conn, &user);
    let cookie = new_session(&conn, &user.id);
    with_cookie(Some(cookie), json!(user))
}

async fn get_user(State(state): State<Arc<AppState>>, Path(name): Path<String>) -> Response {
    let conn = state.db.lock();
    let Some(user) = db::user_by_name(&conn, &name) else {
        return error(StatusCode::NOT_FOUND, "not found");
    };
    let games = db::list_games(&conn, 20, Some(&user.id));
    Json(json!({"user": user, "games": games})).into_response()
}

async fn get_leaderboard(
    State(state): State<Arc<AppState>>,
    Query(q): Query<ListQuery>,
) -> Response {
    let limit = q.limit.unwrap_or(20).clamp(1, 200);
    Json(db::leaderboard(&state.db.lock(), limit)).into_response()
}

#[derive(Deserialize)]
struct ListQuery {
    limit: Option<i64>,
}

async fn get_games(State(state): State<Arc<AppState>>, Query(q): Query<ListQuery>) -> Response {
    let limit = q.limit.unwrap_or(20).clamp(1, 200);
    let games = db::list_games(&state.db.lock(), limit, None);
    Json(games).into_response()
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
            "moves": r.game.history,
            "status": r.game.status,
            "clock": r.clock,
            "created_at": r.created_at,
            "plies": r.game.history.len(),
            "white_diff": r.white_diff,
            "black_diff": r.black_diff,
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
        .route("/api/register", post(post_register))
        .route("/api/login", post(post_login))
        .route("/api/logout", post(post_logout))
        .route("/api/users/{name}", get(get_user))
        .route("/api/leaderboard", get(get_leaderboard))
        .route("/api/games", get(get_games))
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
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .expect("bind");
    tracing::info!("listening on {}", listener.local_addr().expect("addr"));
    axum::serve(listener, router(state)).await.expect("serve");
}
