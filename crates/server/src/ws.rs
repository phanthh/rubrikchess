use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::{header, HeaderMap};
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use parking_lot::Mutex;
use rubrik_core::{EndReason, Game, GameConfig, Rules, Status};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::db;
use crate::db::User;
use crate::lobby::{Challenge, ClockSpec, Seek, SeekColor, CHALLENGE_TTL_MS};
use crate::room::{arm_timeout, evict_when_idle, persist, Clock, Room};
use crate::{now_ms, rand_id, AppState};

/// A player fully disconnected for this long can be claimed against.
pub const GONE_MS: i64 = 60_000;

#[derive(Deserialize)]
#[serde(tag = "t", rename_all = "snake_case")]
enum ClientMsg {
    Seek {
        clock: ClockSpec,
        #[serde(default)]
        walled: bool,
        #[serde(default)]
        color: SeekColor,
    },
    Unseek,
    Accept {
        seek_id: String,
    },
    Watch {
        game_id: String,
    },
    Unwatch {
        game_id: String,
    },
    Move {
        game_id: String,
        #[serde(rename = "move")]
        mv: rubrik_core::Move,
    },
    Resign {
        game_id: String,
    },
    Draw {
        game_id: String,
        offer: bool,
    },
    Chat {
        game_id: String,
        text: String,
    },
    Rematch {
        game_id: String,
        offer: bool,
    },
    Takeback {
        game_id: String,
        offer: bool,
    },
    Challenge {
        clock: ClockSpec,
        #[serde(default)]
        walled: bool,
        #[serde(default)]
        color: SeekColor,
    },
    CancelChallenge,
    Join {
        challenge_id: String,
    },
    Claim {
        game_id: String,
    },
}

pub async fn handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    let (user, cookie) = crate::session(&state, &headers);
    let mut res = ws.on_upgrade(move |socket| session_loop(state, user, socket));
    if let Some(c) = cookie {
        if let Ok(v) = c.parse() {
            res.headers_mut().insert(header::SET_COOKIE, v);
        }
    }
    res
}

async fn session_loop(state: Arc<AppState>, user: User, socket: WebSocket) {
    let (mut sink, mut stream) = socket.split();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();

    let writer = tokio::spawn(async move {
        while let Some(m) = out_rx.recv().await {
            if sink.send(Message::Text(m.into())).await.is_err() {
                break;
            }
        }
    });
    let first_conn = {
        let mut conns = state.conns.lock();
        let list = conns.entry(user.id.clone()).or_default();
        list.push(out_tx.clone());
        list.len() == 1
    };
    if first_conn {
        state.gone.lock().remove(&user.id);
        broadcast_presence(&state, &user.id);
    }

    let mut lobby_rx = state.lobby_tx.subscribe();
    let lobby_task = tokio::spawn({
        let out = out_tx.clone();
        async move {
            while let Ok(m) = lobby_rx.recv().await {
                if out.send(m).is_err() {
                    break;
                }
            }
        }
    });

    send(&out_tx, json!({"t": "hello", "me": user}));
    let lobby = state.lobby.lock().msg();
    send(&out_tx, lobby);

    let mut subs: HashMap<String, JoinHandle<()>> = HashMap::new();
    while let Some(Ok(msg)) = stream.next().await {
        match msg {
            Message::Text(text) => match serde_json::from_str::<ClientMsg>(&text) {
                Ok(m) => handle(&state, &user, &out_tx, &mut subs, m),
                Err(e) => send(&out_tx, json!({"t": "error", "msg": e.to_string()})),
            },
            Message::Close(_) => break,
            _ => {}
        }
    }

    for (game_id, task) in subs {
        task.abort();
        unwatch(&state, &game_id);
    }
    lobby_task.abort();
    drop(out_tx);
    writer.abort();
    state.lobby.lock().remove_user(&user.id);
    state.broadcast_lobby();
    let last_conn = {
        let mut conns = state.conns.lock();
        let gone = match conns.get_mut(&user.id) {
            Some(list) => {
                list.retain(|tx| !tx.is_closed());
                list.is_empty()
            }
            None => false,
        };
        if gone {
            conns.remove(&user.id);
        }
        gone
    };
    if last_conn {
        state.gone.lock().insert(user.id.clone(), now_ms());
        broadcast_presence(&state, &user.id);
        arm_gone(state.clone(), user.id.clone());
    }
}

/// Rooms with a running game this user is playing.
fn playing_rooms(state: &AppState, user_id: &str) -> Vec<Arc<Mutex<Room>>> {
    state
        .rooms
        .lock()
        .values()
        .filter(|r| {
            let r = r.lock();
            r.color_of(user_id).is_some() && r.game.status == Status::Playing
        })
        .cloned()
        .collect()
}

fn broadcast_presence(state: &AppState, user_id: &str) {
    for room in playing_rooms(state, user_id) {
        let r = room.lock();
        let msg = r.presence_msg(state);
        r.broadcast(msg);
    }
}

/// After `GONE_MS` of full disconnection, tell the opponent they may claim.
fn arm_gone(state: Arc<AppState>, user_id: String) {
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(GONE_MS as u64)).await;
        if !is_gone(&state, &user_id) {
            return;
        }
        for room in playing_rooms(&state, &user_id) {
            let r = room.lock();
            let color = r.color_of(&user_id).expect("player");
            r.broadcast(json!({"t": "gone", "game_id": r.id, "color": color}));
        }
    });
}

/// No open socket, and none for at least `GONE_MS`.
fn is_gone(state: &AppState, user_id: &str) -> bool {
    !state.conns.lock().contains_key(user_id)
        && state
            .gone
            .lock()
            .get(user_id)
            .is_some_and(|since| now_ms() - since >= GONE_MS)
}

/// Drop one watcher from a room and broadcast the new count.
fn unwatch(state: &AppState, game_id: &str) {
    let room = state.rooms.lock().get(game_id).cloned();
    if let Some(room) = room {
        let mut r = room.lock();
        r.watchers = r.watchers.saturating_sub(1);
        r.broadcast(json!({"t": "watchers", "game_id": r.id, "n": r.watchers}));
    }
}

fn send(out: &mpsc::UnboundedSender<String>, msg: Value) {
    let _ = out.send(msg.to_string());
}

fn err(out: &mpsc::UnboundedSender<String>, msg: &str) {
    send(out, json!({"t": "error", "msg": msg}));
}

fn handle(
    state: &Arc<AppState>,
    user: &User,
    out: &mpsc::UnboundedSender<String>,
    subs: &mut HashMap<String, JoinHandle<()>>,
    msg: ClientMsg,
) {
    match msg {
        ClientMsg::Seek {
            clock,
            walled,
            color,
        } => {
            if !clock.valid() {
                err(out, "invalid clock");
                return;
            }
            let seek = Seek {
                id: rand_id(8),
                user: user.clone(),
                clock,
                walled,
                color,
            };
            // Quick pairing: an open compatible seek starts a game right away.
            let paired = {
                let mut lobby = state.lobby.lock();
                match lobby.match_for(&seek) {
                    Some(id) => lobby.take(&id),
                    None => {
                        lobby.add(seek);
                        None
                    }
                }
            };
            match paired {
                Some(other) => {
                    state.lobby.lock().remove_user(&user.id);
                    pair(state, other, user.clone(), color);
                }
                None => state.broadcast_lobby(),
            }
        }
        ClientMsg::Unseek => {
            state.lobby.lock().remove_user(&user.id);
            state.broadcast_lobby();
        }
        ClientMsg::Accept { seek_id } => {
            let seek = {
                let mut lobby = state.lobby.lock();
                match lobby.seeks.iter().find(|s| s.id == seek_id) {
                    Some(s) if s.user.id == user.id => None,
                    Some(_) => lobby.take(&seek_id),
                    None => None,
                }
            };
            let Some(seek) = seek else {
                err(out, "seek not available");
                return;
            };
            pair(state, seek, user.clone(), SeekColor::Random);
        }
        ClientMsg::Watch { game_id } => {
            let Some(room) = room_of(state, &game_id) else {
                err(out, "no such game");
                return;
            };
            if !subs.contains_key(&game_id) {
                let mut rx = room.lock().tx.subscribe();
                {
                    let mut r = room.lock();
                    r.watchers += 1;
                    r.broadcast(json!({"t": "watchers", "game_id": r.id, "n": r.watchers}));
                }
                let out2 = out.clone();
                subs.insert(
                    game_id.clone(),
                    tokio::spawn(async move {
                        while let Ok(m) = rx.recv().await {
                            if out2.send(m).is_err() {
                                break;
                            }
                        }
                    }),
                );
            }
            let state_msg = room.lock().state_msg(state);
            send(out, state_msg);
        }
        ClientMsg::Unwatch { game_id } => {
            if let Some(task) = subs.remove(&game_id) {
                task.abort();
                unwatch(state, &game_id);
            }
        }
        ClientMsg::Move { game_id, mv } => {
            let Some(room) = room_of(state, &game_id) else {
                err(out, "no such game");
                return;
            };
            {
                let mut r = room.lock();
                if let Err(e) = r.play(state, &user.id, mv) {
                    err(out, &e);
                    return;
                }
                persist(state, &r);
            }
            arm_timeout(state.clone(), room);
        }
        ClientMsg::Resign { game_id } => {
            let Some(room) = room_of(state, &game_id) else {
                err(out, "no such game");
                return;
            };
            let mut r = room.lock();
            let Some(color) = r.color_of(&user.id) else {
                err(out, "not a player");
                return;
            };
            r.end(
                state,
                Status::Won {
                    winner: color.other(),
                    reason: EndReason::Resign,
                },
            );
            persist(state, &r);
        }
        ClientMsg::Draw { game_id, offer } => {
            let Some(room) = room_of(state, &game_id) else {
                err(out, "no such game");
                return;
            };
            let mut r = room.lock();
            let Some(color) = r.color_of(&user.id) else {
                err(out, "not a player");
                return;
            };
            if r.game.status != Status::Playing {
                err(out, "game is over");
                return;
            }
            if offer && r.draw_offer == Some(color.other()) {
                r.end(
                    state,
                    Status::Draw {
                        reason: EndReason::Agreement,
                    },
                );
            } else {
                r.draw_offer = if offer { Some(color) } else { None };
                r.broadcast(json!({"t": "draw_offer", "game_id": r.id, "by": r.draw_offer}));
            }
            persist(state, &r);
        }
        ClientMsg::Chat { game_id, text } => {
            let text = text.trim();
            if text.is_empty() || text.chars().count() > 300 {
                err(out, "invalid chat");
                return;
            }
            let Some(room) = room_of(state, &game_id) else {
                err(out, "no such game");
                return;
            };
            let now = now_ms();
            {
                // Rate limit per user + room, across all their tabs.
                let mut chats = state.chats.lock();
                let recent = chats.entry((user.id.clone(), game_id.clone())).or_default();
                while recent.front().is_some_and(|t| now - t >= 5000) {
                    recent.pop_front();
                }
                if recent.len() >= 5 {
                    return; // rate limited: drop silently
                }
                recent.push_back(now);
            }
            room.lock().broadcast(json!({
                "t": "chat",
                "game_id": game_id,
                "user": user,
                "text": text,
                "at": now,
            }));
        }
        ClientMsg::Rematch { game_id, offer } => {
            let Some(room) = room_of(state, &game_id) else {
                err(out, "no such game");
                return;
            };
            let accepted = {
                let mut r = room.lock();
                let Some(color) = r.color_of(&user.id) else {
                    err(out, "not a player");
                    return;
                };
                if r.game.status == Status::Playing {
                    err(out, "game in progress");
                    return;
                }
                if offer && r.rematch_offer == Some(color.other()) {
                    r.rematch_offer = None;
                    // Colours swapped, same clock and rules.
                    Some((
                        r.black.clone(),
                        r.white.clone(),
                        ClockSpec {
                            initial_ms: r.clock.initial_ms,
                            increment_ms: r.clock.increment_ms,
                        },
                        r.game.config.rules.walled,
                    ))
                } else {
                    r.rematch_offer = if offer { Some(color) } else { None };
                    r.broadcast(
                        json!({"t": "rematch_offer", "game_id": r.id, "by": r.rematch_offer}),
                    );
                    None
                }
            };
            if let Some((white, black, clock, walled)) = accepted {
                create_game(state, white, black, clock, walled);
            }
        }
        ClientMsg::Takeback { game_id, offer } => {
            let Some(room) = room_of(state, &game_id) else {
                err(out, "no such game");
                return;
            };
            {
                let mut r = room.lock();
                let Some(color) = r.color_of(&user.id) else {
                    err(out, "not a player");
                    return;
                };
                if r.game.status != Status::Playing || r.game.history.is_empty() {
                    err(out, "no takeback");
                    return;
                }
                if offer && r.takeback_offer == Some(color.other()) {
                    // Accepting: rewind to the requester's turn, then resync everyone.
                    r.takeback(color.other());
                    let msg = r.state_msg(state);
                    r.broadcast(msg);
                } else {
                    r.takeback_offer = if offer { Some(color) } else { None };
                    r.broadcast(
                        json!({"t": "takeback_offer", "game_id": r.id, "by": r.takeback_offer}),
                    );
                }
                persist(state, &r);
            }
            arm_timeout(state.clone(), room);
        }
        ClientMsg::Challenge {
            clock,
            walled,
            color,
        } => {
            if !clock.valid() {
                err(out, "invalid clock");
                return;
            }
            let challenge = Challenge {
                id: rand_id(8),
                user: user.clone(),
                clock,
                walled,
                color,
                created_at: now_ms(),
            };
            {
                let mut challenges = state.challenges.lock();
                let now = now_ms();
                challenges
                    .retain(|_, c| c.user.id != user.id && now - c.created_at < CHALLENGE_TTL_MS);
                challenges.insert(challenge.id.clone(), challenge.clone());
            }
            send(out, json!({"t": "challenge", "challenge": challenge}));
        }
        ClientMsg::CancelChallenge => {
            state.challenges.lock().retain(|_, c| c.user.id != user.id);
        }
        ClientMsg::Join { challenge_id } => {
            let challenge = {
                let mut challenges = state.challenges.lock();
                match challenges.get(&challenge_id) {
                    Some(c) if c.user.id == user.id => None,
                    Some(c) if now_ms() - c.created_at >= CHALLENGE_TTL_MS => None,
                    Some(_) => challenges.remove(&challenge_id),
                    None => None,
                }
            };
            let Some(c) = challenge else {
                err(out, "challenge not available");
                return;
            };
            pair(
                state,
                Seek {
                    id: c.id,
                    user: c.user,
                    clock: c.clock,
                    walled: c.walled,
                    color: c.color,
                },
                user.clone(),
                SeekColor::Random,
            );
        }
        ClientMsg::Claim { game_id } => {
            let Some(room) = room_of(state, &game_id) else {
                err(out, "no such game");
                return;
            };
            let mut r = room.lock();
            let Some(color) = r.color_of(&user.id) else {
                err(out, "not a player");
                return;
            };
            if r.game.status != Status::Playing {
                err(out, "game is over");
                return;
            }
            let opponent = match color {
                rubrik_core::Color::White => r.black.id.clone(),
                rubrik_core::Color::Black => r.white.id.clone(),
            };
            if !is_gone(state, &opponent) {
                err(out, "opponent is present");
                return;
            }
            r.end(
                state,
                Status::Won {
                    winner: color,
                    reason: EndReason::Abandoned,
                },
            );
            persist(state, &r);
        }
    }
}

/// Live room, loading a finished/idle game from the DB on demand.
fn room_of(state: &Arc<AppState>, game_id: &str) -> Option<Arc<Mutex<Room>>> {
    if let Some(room) = state.rooms.lock().get(game_id).cloned() {
        return Some(room);
    }
    let row = db::load_game(&state.db.lock(), game_id)?;
    let finished = row.status != Status::Playing;
    let room = Arc::new(Mutex::new(Room::from_row(row)?));
    let mut rooms = state.rooms.lock();
    if let Some(live) = rooms.get(game_id) {
        return Some(live.clone());
    }
    rooms.insert(game_id.to_string(), room.clone());
    drop(rooms);
    if finished {
        // Nothing will finish this room again, so arm its eviction here.
        evict_when_idle(state.clone(), &mut room.lock());
    }
    Some(room)
}

/// Start the game a seek (or challenge) and its joiner agreed on.
fn pair(state: &Arc<AppState>, seek: Seek, joiner: User, joiner_color: SeekColor) {
    let (white, black) = if joiner_color.is_white_against(seek.color) {
        (joiner.clone(), seek.user.clone())
    } else {
        (seek.user.clone(), joiner.clone())
    };
    {
        let mut lobby = state.lobby.lock();
        lobby.remove_user(&seek.user.id);
        lobby.remove_user(&joiner.id);
    }
    create_game(state, white, black, seek.clock, seek.walled);
    state.broadcast_lobby();
}

/// Create + persist a game, put it live and tell both players.
fn create_game(state: &Arc<AppState>, white: User, black: User, clock: ClockSpec, walled: bool) {
    let config = GameConfig {
        rules: Rules { walled },
        ..Default::default()
    };
    let now = now_ms();
    let clock = Clock::new(clock, now);
    let id = rand_id(8);
    db::insert_game(&state.db.lock(), &id, &white, &black, &config, &clock, now);
    let room = Arc::new(Mutex::new(Room::new(
        id.clone(),
        Game::new(config),
        white.clone(),
        black.clone(),
        clock,
        now,
    )));
    state.rooms.lock().insert(id.clone(), room.clone());

    let msg = json!({"t": "game_start", "game_id": id});
    state.send_to_user(&white.id, &msg);
    state.send_to_user(&black.id, &msg);
    arm_timeout(state.clone(), room);
}
