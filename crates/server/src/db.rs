use rubrik_core::{EndReason, Game, GameConfig, Move, Status};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;

use crate::lobby::Layout;
use crate::rating::{Rating, DEFAULT_RATING, DEFAULT_RD, DEFAULT_VOL};
use crate::room::Clock;
use crate::tournament::{Arena, Player, TourStatus};

#[derive(Clone, Debug, Serialize)]
pub struct User {
    pub id: String,
    pub name: String,
    pub rating: f64,
    pub rd: f64,
    #[serde(skip)]
    pub vol: f64,
    pub games: i64,
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
    pub layout: Layout,
    /// Mirror of `config.rules.walled`, so game lists need not parse the config.
    pub walled: bool,
    pub moves: Vec<Move>,
    /// Remaining ms of the mover after each ply (0 for unlimited clocks).
    pub times: Vec<i64>,
    pub status: Status,
    pub clock: Clock,
    pub created_at: i64,
    /// Last write (last move, or game end); the idle sweep reads it across restarts.
    pub updated_at: i64,
    pub plies: usize,
    pub white_diff: Option<i64>,
    pub black_diff: Option<i64>,
    pub tournament_id: Option<String>,
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
         );
         CREATE TABLE IF NOT EXISTS tournaments(
           id TEXT PRIMARY KEY,
           name TEXT NOT NULL,
           clock TEXT NOT NULL,
           walled INTEGER NOT NULL,
           layout TEXT NOT NULL,
           starts_at INTEGER NOT NULL,
           duration_ms INTEGER NOT NULL,
           created_by TEXT NOT NULL,
           status TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS tournament_players(
           tid TEXT NOT NULL,
           user_id TEXT NOT NULL,
           score INTEGER NOT NULL,
           games INTEGER NOT NULL,
           wins INTEGER NOT NULL,
           joined_at INTEGER NOT NULL,
           PRIMARY KEY (tid, user_id)
         );
         CREATE TABLE IF NOT EXISTS rating_history(
           user_id TEXT NOT NULL,
           game_id TEXT NOT NULL,
           at INTEGER NOT NULL,
           rating REAL NOT NULL
         );
         CREATE INDEX IF NOT EXISTS games_created_at ON games(created_at);
         CREATE INDEX IF NOT EXISTS games_white ON games(white);
         CREATE INDEX IF NOT EXISTS games_black ON games(black);
         CREATE INDEX IF NOT EXISTS rating_history_user ON rating_history(user_id, at);",
    )
    .expect("migrate");
    add_column(&conn, "users", "password_hash", "TEXT");
    add_column(
        &conn,
        "tournament_players",
        "joined",
        "INTEGER NOT NULL DEFAULT 1",
    );
    add_column(&conn, "users", "rating", "REAL NOT NULL DEFAULT 1500");
    add_column(&conn, "users", "rd", "REAL NOT NULL DEFAULT 350");
    add_column(&conn, "users", "vol", "REAL NOT NULL DEFAULT 0.06");
    add_column(&conn, "users", "games", "INTEGER NOT NULL DEFAULT 0");
    add_column(&conn, "users", "wins", "INTEGER NOT NULL DEFAULT 0");
    add_column(&conn, "games", "white_rating", "REAL NOT NULL DEFAULT 1500");
    add_column(&conn, "games", "black_rating", "REAL NOT NULL DEFAULT 1500");
    add_column(&conn, "games", "white_diff", "INTEGER");
    add_column(&conn, "games", "black_diff", "INTEGER");
    add_column(&conn, "games", "tournament_id", "TEXT");
    add_column(&conn, "games", "times", "TEXT NOT NULL DEFAULT '[]'");
    // Owner of the auto-scheduled arenas; cannot log in (no password), never plays.
    if user(&conn, SYSTEM_USER_ID).is_none() {
        create_user(&conn, &User::anon(SYSTEM_USER_ID.into(), "Rubrik".into()));
    }
    conn
}

pub const SYSTEM_USER_ID: &str = "system";

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

/// Ids of games still `playing`, oldest first (rehydrated into rooms on boot).
pub fn playing_games(conn: &Connection) -> Vec<String> {
    let mut stmt = conn
        .prepare(
            "SELECT id FROM games WHERE json_extract(status, '$.kind') = 'playing'
             ORDER BY created_at",
        )
        .expect("prepare playing");
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .expect("playing games");
    rows.filter_map(|r| r.ok()).collect()
}

pub fn abandon_game(conn: &Connection, id: &str) {
    conn.execute(
        "UPDATE games SET status = ?1 WHERE id = ?2",
        params![
            json(&Status::Draw {
                reason: EndReason::Abandoned
            }),
            id
        ],
    )
    .expect("abandon game");
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
            "SELECT {USER_COLS} WHERE password_hash IS NOT NULL AND games > 0
             ORDER BY (rd < 200) DESC, rating DESC LIMIT ?1"
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

pub fn set_password(conn: &Connection, id: &str, password_hash: &str) {
    conn.execute(
        "UPDATE users SET password_hash = ?1 WHERE id = ?2",
        params![password_hash, id],
    )
    .expect("set password");
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

pub fn add_rating_history(conn: &Connection, user_id: &str, game_id: &str, at: i64, rating: f64) {
    conn.execute(
        "INSERT INTO rating_history(user_id, game_id, at, rating) VALUES (?1, ?2, ?3, ?4)",
        params![user_id, game_id, at, rating],
    )
    .expect("insert rating history");
}

/// Last 100 rating points for a user, oldest first.
pub fn rating_history(conn: &Connection, user_id: &str) -> Vec<serde_json::Value> {
    let mut stmt = conn
        .prepare(
            "SELECT at, rating FROM rating_history WHERE user_id = ?1
             ORDER BY at DESC LIMIT 100",
        )
        .expect("prepare history");
    let mut rows: Vec<serde_json::Value> = stmt
        .query_map(params![user_id], |r| {
            Ok(serde_json::json!({"at": r.get::<_, i64>(0)?, "rating": r.get::<_, f64>(1)?}))
        })
        .expect("rating history")
        .filter_map(|r| r.ok())
        .collect();
    rows.reverse();
    rows
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

/// Log every other device out (after a password change).
pub fn delete_other_sessions(conn: &Connection, user_id: &str, keep_sid: &str) {
    conn.execute(
        "DELETE FROM sessions WHERE user_id = ?1 AND sid <> ?2",
        params![user_id, keep_sid],
    )
    .expect("delete other sessions");
}

pub fn delete_session(conn: &Connection, sid: &str) {
    conn.execute("DELETE FROM sessions WHERE sid = ?1", params![sid])
        .expect("delete session");
}

#[allow(clippy::too_many_arguments)]
pub fn insert_game(
    conn: &Connection,
    id: &str,
    white: &User,
    black: &User,
    config: &GameConfig,
    clock: &Clock,
    created_at: i64,
    tournament_id: Option<&str>,
) {
    conn.execute(
        "INSERT INTO games(id, white, black, config, moves, status, clock, created_at, updated_at,
                           white_rating, black_rating, tournament_id)
         VALUES (?1, ?2, ?3, ?4, '[]', ?5, ?6, ?7, ?7, ?8, ?9, ?10)",
        params![
            id,
            white.id,
            black.id,
            json(config),
            json(&Status::Playing),
            json(clock),
            created_at,
            white.rating,
            black.rating,
            tournament_id
        ],
    )
    .expect("insert game");
}

#[allow(clippy::too_many_arguments)]
pub fn update_game(
    conn: &Connection,
    id: &str,
    moves: &[Move],
    times: &[i64],
    status: &Status,
    clock: &Clock,
    now: i64,
) {
    conn.execute(
        "UPDATE games SET moves = ?1, times = ?2, status = ?3, clock = ?4, updated_at = ?5
         WHERE id = ?6",
        params![
            json(&moves),
            json(&times),
            json(status),
            json(clock),
            now,
            id
        ],
    )
    .expect("update game");
}

pub fn load_game(conn: &Connection, id: &str) -> Option<GameRow> {
    #[allow(clippy::type_complexity)]
    let (
        white_id,
        black_id,
        config,
        moves,
        times,
        status,
        clock,
        created_at,
        updated_at,
        white_diff,
        black_diff,
        tournament_id,
    ): (
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        i64,
        i64,
        Option<i64>,
        Option<i64>,
        Option<String>,
    ) = conn
        .query_row(
            "SELECT white, black, config, moves, times, status, clock, created_at, updated_at,
                    white_diff, black_diff, tournament_id
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
                    r.get(9)?,
                    r.get(10)?,
                    r.get(11)?,
                ))
            },
        )
        .optional()
        .expect("query game")?;
    let moves: Vec<Move> = serde_json::from_str(&moves).ok()?;
    let config: GameConfig = serde_json::from_str(&config).ok()?;
    Some(GameRow {
        id: id.to_string(),
        white: user(conn, &white_id)?,
        black: user(conn, &black_id)?,
        layout: Layout::of(config.layout),
        walled: config.rules.walled,
        config,
        plies: moves.len(),
        moves,
        times: serde_json::from_str(&times).unwrap_or_default(),
        status: serde_json::from_str(&status).ok()?,
        clock: serde_json::from_str(&clock).ok()?,
        created_at,
        updated_at,
        white_diff,
        black_diff,
        tournament_id,
    })
}

/// Recent games, newest first. `user_id` restricts to that player's games,
/// `before` is a `created_at` cursor (exclusive).
/// ponytail: N+1 queries; fine for sqlite at limit ≤ 100.
pub fn list_games(
    conn: &Connection,
    limit: i64,
    user_id: Option<&str>,
    before: Option<i64>,
) -> Vec<GameRow> {
    let mut stmt = conn
        .prepare(
            "SELECT id FROM games
             WHERE (?2 IS NULL OR white = ?2 OR black = ?2)
               AND (?3 IS NULL OR created_at < ?3)
             ORDER BY created_at DESC LIMIT ?1",
        )
        .expect("prepare list");
    let ids: Vec<String> = stmt
        .query_map(params![limit, user_id, before], |r| r.get(0))
        .expect("list games")
        .filter_map(|r| r.ok())
        .collect();
    ids.iter().filter_map(|id| load_game(conn, id)).collect()
}

/// Games of a tournament, newest first.
pub fn tournament_games(conn: &Connection, tid: &str, limit: i64) -> Vec<GameRow> {
    let mut stmt = conn
        .prepare(
            "SELECT id FROM games WHERE tournament_id = ?1
             ORDER BY created_at DESC LIMIT ?2",
        )
        .expect("prepare tournament games");
    let ids: Vec<String> = stmt
        .query_map(params![tid, limit], |r| r.get(0))
        .expect("tournament games")
        .filter_map(|r| r.ok())
        .collect();
    ids.iter().filter_map(|id| load_game(conn, id)).collect()
}

pub fn insert_tournament(conn: &Connection, a: &Arena) {
    conn.execute(
        "INSERT INTO tournaments(id, name, clock, walled, layout, starts_at, duration_ms,
                                 created_by, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            a.id,
            a.name,
            json(&a.clock),
            a.walled,
            json(&a.layout),
            a.starts_at,
            a.duration_ms,
            a.created_by,
            json(&a.status)
        ],
    )
    .expect("insert tournament");
}

/// Arenas this user created that are not over yet (the per-creator cap).
pub fn unfinished_tournaments_by(conn: &Connection, user_id: &str) -> usize {
    conn.query_row(
        "SELECT COUNT(*) FROM tournaments WHERE created_by = ?1 AND status != '\"finished\"'",
        params![user_id],
        |r| r.get::<_, i64>(0),
    )
    .expect("count tournaments") as usize
}

pub fn set_tournament_status(conn: &Connection, id: &str, status: TourStatus) {
    conn.execute(
        "UPDATE tournaments SET status = ?1 WHERE id = ?2",
        params![json(&status), id],
    )
    .expect("set tournament status");
}

pub fn upsert_tournament_player(conn: &Connection, tid: &str, user_id: &str, p: &Player) {
    conn.execute(
        "INSERT OR REPLACE INTO tournament_players(tid, user_id, score, games, wins, joined_at, joined)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![tid, user_id, p.score, p.games, p.wins, p.joined_at, p.joined],
    )
    .expect("upsert tournament player");
}

const TOUR_COLS: &str =
    "id, name, clock, walled, layout, starts_at, duration_ms, created_by, status FROM tournaments";

fn arena_from_row(r: &Row) -> rusqlite::Result<Arena> {
    fn de<T: serde::de::DeserializeOwned>(s: String) -> rusqlite::Result<T> {
        serde_json::from_str(&s).map_err(|_| rusqlite::Error::InvalidQuery)
    }
    Ok(Arena {
        id: r.get(0)?,
        name: r.get(1)?,
        clock: de(r.get(2)?)?,
        walled: r.get(3)?,
        layout: de(r.get(4)?)?,
        starts_at: r.get(5)?,
        duration_ms: r.get(6)?,
        created_by: r.get(7)?,
        status: de(r.get(8)?)?,
        players: Default::default(),
    })
}

pub fn load_tournament(conn: &Connection, id: &str) -> Option<Arena> {
    let mut arena = conn
        .query_row(
            &format!("SELECT {TOUR_COLS} WHERE id = ?1"),
            params![id],
            arena_from_row,
        )
        .optional()
        .expect("query tournament")?;
    arena.players = tournament_players(conn, id);
    Some(arena)
}

/// Tournaments by finished-ness, newest start first.
pub fn load_tournaments(conn: &Connection, finished: bool, limit: i64) -> Vec<Arena> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {TOUR_COLS} WHERE (status = '\"finished\"') = ?1
             ORDER BY starts_at DESC LIMIT ?2"
        ))
        .expect("prepare tournaments");
    let mut arenas: Vec<Arena> = stmt
        .query_map(params![finished, limit], arena_from_row)
        .expect("tournaments")
        .filter_map(|r| r.ok())
        .collect();
    for a in &mut arenas {
        a.players = tournament_players(conn, &a.id);
    }
    arenas
}

fn tournament_players(conn: &Connection, tid: &str) -> std::collections::HashMap<String, Player> {
    let mut stmt = conn
        .prepare(
            "SELECT user_id, score, games, wins, joined_at, joined FROM tournament_players WHERE tid = ?1",
        )
        .expect("prepare tournament players");
    stmt.query_map(params![tid], |r| {
        Ok((
            r.get::<_, String>(0)?,
            Player {
                score: r.get(1)?,
                games: r.get(2)?,
                wins: r.get(3)?,
                joined_at: r.get(4)?,
                joined: r.get(5)?,
                ..Player::default()
            },
        ))
    })
    .expect("tournament players")
    .filter_map(|r| r.ok())
    .collect()
}

/// Finished games between two players, oldest first:
/// (id, `a` played white, winning colour if any).
pub fn head_to_head(conn: &Connection, a: &str, b: &str) -> Vec<(String, bool, Option<String>)> {
    let mut stmt = conn
        .prepare(
            "SELECT id, white = ?1, json_extract(status, '$.winner') FROM games
             WHERE ((white = ?1 AND black = ?2) OR (white = ?2 AND black = ?1))
               AND json_extract(status, '$.kind') != 'playing'
             ORDER BY created_at",
        )
        .expect("prepare head to head");
    stmt.query_map(params![a, b], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .expect("head to head")
        .filter_map(|r| r.ok())
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
