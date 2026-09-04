use rubrik_core::{Game, GameConfig, Move, Status};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::room::Clock;

#[derive(Clone, Debug, Serialize)]
pub struct User {
    pub id: String,
    pub name: String,
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
    conn
}

pub fn user(conn: &Connection, id: &str) -> Option<User> {
    conn.query_row(
        "SELECT id, name FROM users WHERE id = ?1",
        params![id],
        |r| {
            Ok(User {
                id: r.get(0)?,
                name: r.get(1)?,
            })
        },
    )
    .optional()
    .expect("query user")
}

pub fn create_user(conn: &Connection, user: &User) {
    conn.execute(
        "INSERT OR REPLACE INTO users(id, name) VALUES (?1, ?2)",
        params![user.id, user.name],
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
        "INSERT INTO games(id, white, black, config, moves, status, clock, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, '[]', ?5, ?6, ?7, ?7)",
        params![
            id,
            white.id,
            black.id,
            json(config),
            json(&Status::Playing),
            json(clock),
            created_at
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
    let (white_id, black_id, config, moves, status, clock, created_at): (
        String,
        String,
        String,
        String,
        String,
        String,
        i64,
    ) = conn
        .query_row(
            "SELECT white, black, config, moves, status, clock, created_at FROM games WHERE id = ?1",
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
                ))
            },
        )
        .optional()
        .expect("query game")?;
    Some(GameRow {
        id: id.to_string(),
        white: user(conn, &white_id)?,
        black: user(conn, &black_id)?,
        config: serde_json::from_str(&config).ok()?,
        moves: serde_json::from_str(&moves).ok()?,
        status: serde_json::from_str(&status).ok()?,
        clock: serde_json::from_str(&clock).ok()?,
        created_at,
    })
}

/// Recent games, newest first: `[{id, white, black, status, created_at, plies}]`.
pub fn list_games(conn: &Connection, limit: i64) -> Vec<serde_json::Value> {
    let mut stmt = conn
        .prepare(
            "SELECT g.id, wu.id, wu.name, bu.id, bu.name, g.status, g.moves, g.created_at
             FROM games g
             JOIN users wu ON wu.id = g.white
             JOIN users bu ON bu.id = g.black
             ORDER BY g.created_at DESC LIMIT ?1",
        )
        .expect("prepare list");
    let rows = stmt
        .query_map(params![limit], |r| {
            let moves: String = r.get(6)?;
            let status: String = r.get(5)?;
            let plies = serde_json::from_str::<Vec<Move>>(&moves)
                .map(|m| m.len())
                .unwrap_or(0);
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "white": {"id": r.get::<_, String>(1)?, "name": r.get::<_, String>(2)?},
                "black": {"id": r.get::<_, String>(3)?, "name": r.get::<_, String>(4)?},
                "status": serde_json::from_str::<serde_json::Value>(&status).unwrap_or(serde_json::Value::Null),
                "created_at": r.get::<_, i64>(7)?,
                "plies": plies,
            }))
        })
        .expect("list games");
    rows.filter_map(|r| r.ok()).collect()
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
