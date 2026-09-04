use rubrik_core::{EndReason, Game, GameConfig, Move, Status};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;

use crate::rating::{Rating, DEFAULT_RATING, DEFAULT_RD, DEFAULT_VOL};
use crate::room::Clock;

#[derive(Clone, Debug, Serialize)]
pub struct User {
    pub id: String,
    pub name: String,
    pub rating: f64,
    pub rd: f64,
    #[serde(skip)]
    pub vol: f64,
    pub games: i64,
    #[serde(skip)]
    pub wins: i64,
    pub registered: bool,
}

impl User {
    pub fn anon(id: String, name: String) -> User {
        User {
            id,
            name,
            rating: DEFAULT_RATING,
            rd: DEFAULT_RD,
            vol: DEFAULT_VOL,
            games: 0,
            wins: 0,
            registered: false,
        }
    }

    pub fn glicko(&self) -> Rating {
        Rating {
            r: self.rating,
            rd: self.rd,
            vol: self.vol,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct GameRow {
    pub id: String,
    pub white: User,
    pub black: User,
    pub config: GameConfig,
    pub moves: Vec<Move>,
    pub status: Status,
    pub clock: Clock,
    pub created_at: i64,
    pub plies: usize,
    pub white_diff: Option<i64>,
    pub black_diff: Option<i64>,
}

pub fn open(path: &str) -> Connection {
    if let Some(dir) = std::path::Path::new(path).parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let conn = Connection::open(path).expect("open sqlite");
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS users(
           id TEXT PRIMARY KEY,
           name TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS sessions(
           sid TEXT PRIMARY KEY,
           user_id TEXT NOT NULL,
           created_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS games(
           id TEXT PRIMARY KEY,
           white TEXT NOT NULL,
           black TEXT NOT NULL,
           config TEXT NOT NULL,
           moves TEXT NOT NULL,
           status TEXT NOT NULL,
           clock TEXT NOT NULL,
           created_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL
         );",
    )
    .expect("migrate");
    add_column(&conn, "users", "password_hash", "TEXT");
    add_column(&conn, "users", "rating", "REAL NOT NULL DEFAULT 1500");
    add_column(&conn, "users", "rd", "REAL NOT NULL DEFAULT 350");
    add_column(&conn, "users", "vol", "REAL NOT NULL DEFAULT 0.06");
    add_column(&conn, "users", "games", "INTEGER NOT NULL DEFAULT 0");
    add_column(&conn, "users", "wins", "INTEGER NOT NULL DEFAULT 0");
    add_column(&conn, "games", "white_rating", "REAL NOT NULL DEFAULT 1500");
    add_column(&conn, "games", "black_rating", "REAL NOT NULL DEFAULT 1500");
    add_column(&conn, "games", "white_diff", "INTEGER");
    add_column(&conn, "games", "black_diff", "INTEGER");
    conn
}

fn add_column(conn: &Connection, table: &str, column: &str, decl: &str) {
    let exists = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .expect("pragma")
        .query_map([], |r| r.get::<_, String>(1))
        .expect("pragma rows")
        .any(|c| c.as_deref() == Ok(column));
    if !exists {
        conn.execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {decl}"),
            [],
        )
        .expect("add column");
    }
}

/// Rooms live in memory: anything still `playing` after a restart is lost.
pub fn abandon_playing(conn: &Connection) {
    conn.execute(
        "UPDATE games SET status = ?1 WHERE json_extract(status, '$.kind') = 'playing'",
        params![json(&Status::Draw {
            reason: EndReason::Abandoned
        })],
    )
    .expect("abandon playing");
}

const USER_COLS: &str =
    "id, name, rating, rd, vol, games, wins, password_hash IS NOT NULL FROM users";

fn user_from_row(r: &Row) -> rusqlite::Result<User> {
    Ok(User {
        id: r.get(0)?,
        name: r.get(1)?,
        rating: r.get(2)?,
        rd: r.get(3)?,
        vol: r.get(4)?,
        games: r.get(5)?,
        wins: r.get(6)?,
        registered: r.get(7)?,
    })
}

pub fn user(conn: &Connection, id: &str) -> Option<User> {
    conn.query_row(
        &format!("SELECT {USER_COLS} WHERE id = ?1"),
        params![id],
        user_from_row,
    )
    .optional()
    .expect("query user")
}

pub fn user_by_name(conn: &Connection, name: &str) -> Option<User> {
    conn.query_row(
        &format!("SELECT {USER_COLS} WHERE name = ?1 COLLATE NOCASE"),
        params![name],
        user_from_row,
    )
    .optional()
    .expect("query user by name")
}

/// Registered users with a settled rating, best first.
pub fn leaderboard(conn: &Connection, limit: i64) -> Vec<User> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {USER_COLS} WHERE password_hash IS NOT NULL AND rd < 200
             ORDER BY rating DESC LIMIT ?1"
        ))
        .expect("prepare leaderboard");
    let rows = stmt
        .query_map(params![limit], user_from_row)
        .expect("leaderboard");
    rows.filter_map(|r| r.ok()).collect()
}

pub fn create_user(conn: &Connection, user: &User) {
    conn.execute(
        "INSERT OR REPLACE INTO users(id, name, rating, rd, vol, games, wins)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            user.id,
            user.name,
            user.rating,
            user.rd,
            user.vol,
            user.games,
            user.wins
        ],
    )
    .expect("insert user");
}

pub fn rename_user(conn: &Connection, id: &str, name: &str) {
    conn.execute(
        "UPDATE users SET name = ?1 WHERE id = ?2",
        params![name, id],
    )
    .expect("rename user");
}

/// Claim an anonymous account: set its name and password.
pub fn register_user(conn: &Connection, id: &str, name: &str, password_hash: &str) {
    conn.execute(
        "UPDATE users SET name = ?1, password_hash = ?2 WHERE id = ?3",
        params![name, password_hash, id],
    )
    .expect("register user");
}

pub fn password_hash(conn: &Connection, id: &str) -> Option<String> {
    conn.query_row(
        "SELECT password_hash FROM users WHERE id = ?1",
        params![id],
        |r| r.get::<_, Option<String>>(0),
    )
    .optional()
    .expect("query password")
    .flatten()
}

pub fn set_rating(conn: &Connection, id: &str, rating: &Rating, games: i64, wins: i64) {
    conn.execute(
        "UPDATE users SET rating = ?1, rd = ?2, vol = ?3, games = ?4, wins = ?5 WHERE id = ?6",
        params![rating.r, rating.rd, rating.vol, games, wins, id],
    )
    .expect("set rating");
}

pub fn set_game_diffs(conn: &Connection, game_id: &str, white: i64, black: i64) {
    conn.execute(
        "UPDATE games SET white_diff = ?1, black_diff = ?2 WHERE id = ?3",
        params![white, black, game_id],
    )
    .expect("set diffs");
}

pub fn create_session(conn: &Connection, sid: &str, user_id: &str, now: i64) {
    conn.execute(
        "INSERT OR REPLACE INTO sessions(sid, user_id, created_at) VALUES (?1, ?2, ?3)",
        params![sid, user_id, now],
    )
    .expect("insert session");
}

pub fn session_user(conn: &Connection, sid: &str) -> Option<User> {
    conn.query_row(
        &format!("SELECT {USER_COLS} WHERE id = (SELECT user_id FROM sessions WHERE sid = ?1)"),
        params![sid],
        user_from_row,
    )
    .optional()
    .expect("query session")
}

pub fn delete_session(conn: &Connection, sid: &str) {
    conn.execute("DELETE FROM sessions WHERE sid = ?1", params![sid])
        .expect("delete session");
}

pub fn insert_game(
    conn: &Connection,
    id: &str,
    white: &User,
    black: &User,
    config: &GameConfig,
    clock: &Clock,
    created_at: i64,
) {
    conn.execute(
        "INSERT INTO games(id, white, black, config, moves, status, clock, created_at, updated_at,
                           white_rating, black_rating)
         VALUES (?1, ?2, ?3, ?4, '[]', ?5, ?6, ?7, ?7, ?8, ?9)",
        params![
            id,
            white.id,
            black.id,
            json(config),
            json(&Status::Playing),
            json(clock),
            created_at,
            white.rating,
            black.rating
        ],
    )
    .expect("insert game");
}

pub fn update_game(
    conn: &Connection,
    id: &str,
    moves: &[Move],
    status: &Status,
    clock: &Clock,
    now: i64,
) {
    conn.execute(
        "UPDATE games SET moves = ?1, status = ?2, clock = ?3, updated_at = ?4 WHERE id = ?5",
        params![json(&moves), json(status), json(clock), now, id],
    )
    .expect("update game");
}

pub fn load_game(conn: &Connection, id: &str) -> Option<GameRow> {
    #[allow(clippy::type_complexity)]
    let (white_id, black_id, config, moves, status, clock, created_at, white_diff, black_diff): (
        String,
        String,
        String,
        String,
        String,
        String,
        i64,
        Option<i64>,
        Option<i64>,
    ) = conn
        .query_row(
            "SELECT white, black, config, moves, status, clock, created_at, white_diff, black_diff
             FROM games WHERE id = ?1",
            params![id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                ))
            },
        )
        .optional()
        .expect("query game")?;
    let moves: Vec<Move> = serde_json::from_str(&moves).ok()?;
    Some(GameRow {
        id: id.to_string(),
        white: user(conn, &white_id)?,
        black: user(conn, &black_id)?,
        config: serde_json::from_str(&config).ok()?,
        plies: moves.len(),
        moves,
        status: serde_json::from_str(&status).ok()?,
        clock: serde_json::from_str(&clock).ok()?,
        created_at,
        white_diff,
        black_diff,
    })
}

/// Recent games, newest first. `user_id` restricts to that player's games.
pub fn list_games(conn: &Connection, limit: i64, user_id: Option<&str>) -> Vec<serde_json::Value> {
    let mut stmt = conn
        .prepare(
            "SELECT g.id, g.white, g.black, g.status, g.clock, g.moves, g.created_at,
                    g.white_diff, g.black_diff
             FROM games g
             WHERE ?2 IS NULL OR g.white = ?2 OR g.black = ?2
             ORDER BY g.created_at DESC LIMIT ?1",
        )
        .expect("prepare list");
    let rows = stmt
        .query_map(params![limit, user_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, Option<i64>>(7)?,
                r.get::<_, Option<i64>>(8)?,
            ))
        })
        .expect("list games")
        .filter_map(|r| r.ok())
        .collect::<Vec<_>>();
    rows.into_iter()
        .filter_map(
            |(id, white, black, status, clock, moves, created_at, white_diff, black_diff)| {
                let plies = serde_json::from_str::<Vec<Move>>(&moves)
                    .map(|m| m.len())
                    .unwrap_or(0);
                Some(serde_json::json!({
                    "id": id,
                    "white": user(conn, &white)?,
                    "black": user(conn, &black)?,
                    "status": serde_json::from_str::<serde_json::Value>(&status).unwrap_or(serde_json::Value::Null),
                    "clock": serde_json::from_str::<serde_json::Value>(&clock).unwrap_or(serde_json::Value::Null),
                    "created_at": created_at,
                    "plies": plies,
                    "white_diff": white_diff,
                    "black_diff": black_diff,
                }))
            },
        )
        .collect()
}

/// Rebuild a playable game from a stored row (validating every move).
pub fn game_from_row(row: &GameRow) -> Option<Game> {
    let mut g = Game::replay(row.config.clone(), &row.moves).ok()?;
    if row.status != Status::Playing {
        g.end(row.status);
    }
    Some(g)
}

fn json<T: Serialize>(v: &T) -> String {
    serde_json::to_string(v).expect("serialize")
}
