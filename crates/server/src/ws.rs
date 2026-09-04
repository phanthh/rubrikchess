use std::collections::{HashMap, VecDeque};
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
use crate::lobby::{ClockSpec, Seek};
use crate::room::{arm_timeout, persist, Clock, Room};
use crate::{now_ms, rand_id, AppState};

#[derive(Deserialize)]
#[serde(tag = "t", rename_all = "snake_case")]
enum ClientMsg {
    Seek {
        clock: ClockSpec,
        #[serde(default)]
        walled: bool,
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
    Ping,
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
    state
        .conns
        .lock()
        .entry(user.id.clone())
        .or_default()
        .push(out_tx.clone());

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
    // Chat rate limit: recent message timestamps per room.
    let mut chats: HashMap<String, VecDeque<i64>> = HashMap::new();
    while let Some(Ok(msg)) = stream.next().await {
        match msg {
            Message::Text(text) => match serde_json::from_str::<ClientMsg>(&text) {
                Ok(m) => handle(&state, &user, &out_tx, &mut subs, &mut chats, m),
                Err(e) => send(&out_tx, json!({"t": "error", "msg": e.to_string()})),
            },
            Message::Close(_) => break,
            _ => {}
        }
    }

    for (_, task) in subs {
        task.abort();
    }
    lobby_task.abort();
    drop(out_tx);
    writer.abort();
    state.lobby.lock().remove_user(&user.id);
    state.broadcast_lobby();
    let mut conns = state.conns.lock();
    if let Some(list) = conns.get_mut(&user.id) {
        list.retain(|tx| !tx.is_closed());
        if list.is_empty() {
            conns.remove(&user.id);
        }
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
    chats: &mut HashMap<String, VecDeque<i64>>,
    msg: ClientMsg,
) {
    match msg {
        ClientMsg::Ping => send(out, json!({"t": "pong"})),
        ClientMsg::Seek { clock, walled } => {
            state.lobby.lock().add(Seek {
                id: rand_id(8),
                user: user.clone(),
                clock,
                walled,
            });
            state.broadcast_lobby();
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
            start_game(state, seek, user);
        }
        ClientMsg::Watch { game_id } => {
            let Some(room) = room_of(state, &game_id) else {
                err(out, "no such game");
                return;
            };
            if !subs.contains_key(&game_id) {
                let mut rx = room.lock().tx.subscribe();
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
            let state_msg = room.lock().state_msg();
            send(out, state_msg);
        }
        ClientMsg::Unwatch { game_id } => {
            if let Some(task) = subs.remove(&game_id) {
                task.abort();
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
            let recent = chats.entry(game_id.clone()).or_default();
            while recent.front().is_some_and(|t| now - t >= 5000) {
                recent.pop_front();
            }
            if recent.len() >= 5 {
                return; // rate limited: drop silently
            }
            recent.push_back(now);
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
    }
}

/// Live room, loading a finished/idle game from the DB on demand.
fn room_of(state: &Arc<AppState>, game_id: &str) -> Option<Arc<Mutex<Room>>> {
    if let Some(room) = state.rooms.lock().get(game_id).cloned() {
        return Some(room);
    }
    let row = db::load_game(&state.db.lock(), game_id)?;
    let game = db::game_from_row(&row)?;
    let mut room = Room::new(
        row.id.clone(),
        game,
        row.white,
        row.black,
        row.clock,
        row.created_at,
    );
    room.white_diff = row.white_diff;
    room.black_diff = row.black_diff;
    let room = Arc::new(Mutex::new(room));
    Some(state.rooms.lock().entry(row.id).or_insert(room).clone())
}

fn start_game(state: &Arc<AppState>, seek: Seek, acceptor: &User) {
    let (white, black) = if rand::random::<bool>() {
        (seek.user.clone(), acceptor.clone())
    } else {
        (acceptor.clone(), seek.user.clone())
    };
    create_game(state, white, black, seek.clock, seek.walled);
    state.lobby.lock().remove_user(&acceptor.id);
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
