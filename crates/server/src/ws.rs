use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, State};
use axum::http::{header, HeaderMap};
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use parking_lot::Mutex;
use rubrik_core::{EndReason, Game, GameConfig, Status};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::bot;
use crate::db;
use crate::db::User;
use crate::lobby::{
    game_config, valid_setup, Challenge, ClockSpec, Layout, Seek, SeekColor, CHALLENGE_TTL_MS,
};
use crate::room::{arm_first_move_expiry, arm_timeout, evict_when_idle, persist, Clock, Room};
use crate::tournament;
use crate::{now_ms, rand_id, AppState};

/// A player fully disconnected for this long can be claimed against.
pub const GONE_MS: i64 = 60_000;

/// Time handed to the opponent by `moretime`.
pub const MORETIME_MS: i64 = 15_000;

#[derive(Deserialize)]
#[serde(tag = "t", rename_all = "snake_case")]
enum ClientMsg {
    Seek {
        clock: ClockSpec,
        #[serde(default)]
        walled: bool,
        #[serde(default)]
        layout: Layout,
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
        layout: Layout,
        #[serde(default)]
        color: SeekColor,
        /// Username of a specific opponent (direct challenge).
        #[serde(default)]
        to: Option<String>,
        /// Board-editor start position (see `lobby::valid_setup`).
        #[serde(default)]
        setup: Option<String>,
    },
    CancelChallenge,
    Decline {
        challenge_id: String,
    },
    Join {
        challenge_id: String,
    },
    Claim {
        game_id: String,
    },
    Abort {
        game_id: String,
    },
    Moretime {
        game_id: String,
    },
    TourJoin {
        id: String,
    },
    TourLeave {
        id: String,
    },
    TourChat {
        id: String,
        text: String,
    },
    /// Follow one arena's chat (replaces any previous subscription).
    TourSub {
        id: String,
    },
    TourUnsub,
}

pub async fn handler(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<std::net::SocketAddr>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    let ip = crate::client_ip(&headers, peer);
    let Some((user, cookie)) = crate::session(&state, &headers, &ip) else {
        return crate::error(axum::http::StatusCode::TOO_MANY_REQUESTS, "slow down");
    };
    // No client message is near this; without a cap an anon socket can make us buffer
    // (and parse) megabytes.
    let mut res = ws
        .max_message_size(64 * 1024)
        .on_upgrade(move |socket| session_loop(state, user, socket));
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

    // Periodic pings keep idle sockets alive through proxies (nginx drops after 60s by default).
    let writer = tokio::spawn(async move {
        let mut ping = tokio::time::interval(std::time::Duration::from_secs(25));
        ping.tick().await;
        loop {
            let msg = tokio::select! {
                m = out_rx.recv() => match m {
                    Some(m) => Message::Text(m.into()),
                    None => break,
                },
                _ = ping.tick() => Message::Ping(Vec::new().into()),
            };
            if sink.send(msg).await.is_err() {
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
        state.broadcast_lobby(); // the online count changed
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
    let online = state.conns.lock().len();
    let lobby = state.lobby.lock().msg(online);
    send(&out_tx, lobby);

    let mut subs: HashMap<String, JoinHandle<()>> = HashMap::new();
    // At most one arena chat per socket.
    let mut tour_sub: Option<JoinHandle<()>> = None;
    while let Some(Ok(msg)) = stream.next().await {
        match msg {
            Message::Text(text) => match serde_json::from_str::<ClientMsg>(&text) {
                Ok(m) => handle(&state, &user, &out_tx, &mut subs, &mut tour_sub, m),
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
    if let Some(task) = tour_sub {
        task.abort();
    }
    lobby_task.abort();
    writer.abort();
    let last_conn = {
        let mut conns = state.conns.lock();
        let gone = match conns.get_mut(&user.id) {
            Some(list) => {
                list.retain(|tx| !tx.same_channel(&out_tx));
                list.is_empty()
            }
            None => false,
        };
        if gone {
            conns.remove(&user.id);
        }
        gone
    };
    drop(out_tx);
    if last_conn {
        // Other tabs of the same user keep their seek alive.
        state.lobby.lock().remove_user(&user.id);
    }
    state.broadcast_lobby();
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

/// Shared budget for the room-wide offers (draw, takeback, rematch).
fn offer_allowed(state: &AppState, user_id: &str, game_id: &str) -> bool {
    state.allow(user_id, &format!("offer:{game_id}"), 10, 10_000)
}

fn handle(
    state: &Arc<AppState>,
    user: &User,
    out: &mpsc::UnboundedSender<String>,
    subs: &mut HashMap<String, JoinHandle<()>>,
    tour_sub: &mut Option<JoinHandle<()>>,
    msg: ClientMsg,
) {
    match msg {
        ClientMsg::Seek {
            clock,
            walled,
            layout,
            color,
        } => {
            if !clock.valid() {
                err(out, "invalid clock");
                return;
            }
            if !state.allow(&user.id, "seek", 10, 10_000) {
                err(out, "slow down");
                return;
            }
            let seek = Seek {
                id: rand_id(8),
                user: user.clone(),
                setup: None,
                clock,
                walled,
                layout,
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
            if !state.allow(&user.id, "watch", 20, 10_000) {
                err(out, "slow down");
                return;
            }
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
            if !state.allow(&user.id, "move", 30, 5000) {
                err(out, "slow down");
                return;
            }
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
            arm_timeout(state.clone(), room.clone());
            arm_first_move_expiry(state.clone(), room.clone());
            bot::poke(state.clone(), room);
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
            if !offer_allowed(state, &user.id, &game_id) {
                err(out, "slow down");
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
                // The bot declines instantly: the offer never stands.
                r.draw_offer = if offer && !bot_game(&r) {
                    Some(color)
                } else {
                    None
                };
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
            if !state.allow(&user.id, &format!("chat:{game_id}"), 5, 5000) {
                return; // rate limited: drop silently
            }
            let mut r = room.lock();
            r.push_chat(json!({"user": user, "text": text, "at": now}));
            r.broadcast(json!({
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
                if !offer_allowed(state, &user.id, &game_id) {
                    err(out, "slow down");
                    return;
                }
                if offer && (r.rematch_offer == Some(color.other()) || bot_game(&r)) {
                    r.rematch_offer = None;
                    // Colours swapped, same clock and rules.
                    Some((
                        r.black.clone(),
                        r.white.clone(),
                        r.clock.spec(),
                        r.game.config.clone(),
                    ))
                } else {
                    r.rematch_offer = if offer { Some(color) } else { None };
                    r.broadcast(
                        json!({"t": "rematch_offer", "game_id": r.id, "by": r.rematch_offer}),
                    );
                    None
                }
            };
            if let Some((white, black, clock, config)) = accepted {
                create_game(state, white, black, clock, config, None);
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
                if !offer_allowed(state, &user.id, &game_id) {
                    err(out, "slow down");
                    return;
                }
                if offer && r.takeback_offer == Some(color.other()) {
                    // Accepting: rewind to the requester's turn, then resync everyone.
                    r.takeback(color.other());
                    let msg = r.state_msg(state);
                    r.broadcast(msg);
                } else {
                    r.takeback_offer = if offer && !bot_game(&r) {
                        Some(color)
                    } else {
                        None
                    };
                    r.broadcast(
                        json!({"t": "takeback_offer", "game_id": r.id, "by": r.takeback_offer}),
                    );
                }
                persist(state, &r);
            }
            arm_timeout(state.clone(), room.clone());
            bot::poke(state.clone(), room);
        }
        ClientMsg::Challenge {
            clock,
            walled,
            layout,
            color,
            to,
            setup,
        } => {
            if !clock.valid() {
                err(out, "invalid clock");
                return;
            }
            let setup = setup.filter(|s| !s.trim().is_empty());
            if setup.as_deref().is_some_and(|s| !valid_setup(s)) {
                err(out, "invalid position");
                return;
            }
            if !state.allow(&user.id, "seek", 10, 10_000) {
                err(out, "slow down");
                return;
            }
            let to = match to.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                None => None,
                Some(name) => {
                    // single lock scope: a guard in a match scrutinee lives through the arms
                    let found = {
                        let conn = state.db.lock();
                        db::user_by_name(&conn, name)
                            .map(|u| (db::contact_blocked(&conn, &user.id, &u.id), u))
                    };
                    match found {
                        // blocked either way: indistinguishable from an unknown player
                        Some((true, u)) if u.id != user.id => {
                            err(out, "no such player");
                            return;
                        }
                        Some((_, u)) if u.id != user.id => Some(u),
                        Some(_) => {
                            err(out, "you cannot challenge yourself");
                            return;
                        }
                        None => {
                            err(out, "no such player");
                            return;
                        }
                    }
                }
            };
            // Challenging the bot pairs immediately; it has no client to accept with.
            if to.as_ref().is_some_and(|u| bot::is_bot(&u.id)) {
                if clock.unlimited() {
                    err(out, "the bot needs a clock");
                    return;
                }
                let opponent = to.expect("bot");
                pair(
                    state,
                    Seek {
                        id: rand_id(8),
                        user: user.clone(),
                        clock,
                        walled,
                        layout,
                        color,
                        setup,
                    },
                    opponent,
                    SeekColor::Random,
                );
                return;
            }
            let challenge = Challenge {
                id: rand_id(8),
                user: user.clone(),
                clock,
                walled,
                layout,
                color,
                setup,
                to,
                created_at: now_ms(),
            };
            {
                let mut challenges = state.challenges.lock();
                let now = now_ms();
                // One public link + one direct challenge per user: a direct challenge must
                // not silently kill the link its creator is sharing.
                let direct = challenge.to.is_some();
                challenges.retain(|_, c| {
                    (c.user.id != user.id || c.to.is_some() != direct)
                        && now - c.created_at < CHALLENGE_TTL_MS
                });
                challenges.insert(challenge.id.clone(), challenge.clone());
            }
            // After the insert: the target may accept immediately.
            if let Some(target) = &challenge.to {
                state.send_to_user(
                    &target.id,
                    &json!({"t": "challenge_in", "challenge": challenge}),
                );
            }
            send(out, json!({"t": "challenge", "challenge": challenge}));
        }
        ClientMsg::CancelChallenge => {
            if !state.allow(&user.id, "cancel_challenge", 20, 10_000) {
                err(out, "slow down");
                return;
            }
            state.challenges.lock().retain(|_, c| c.user.id != user.id);
        }
        ClientMsg::Decline { challenge_id } => {
            if !state.allow(&user.id, "cancel_challenge", 20, 10_000) {
                err(out, "slow down");
                return;
            }
            let removed = {
                let mut challenges = state.challenges.lock();
                match challenges.get(&challenge_id) {
                    Some(c) if c.to.as_ref().is_some_and(|t| t.id == user.id) => {
                        challenges.remove(&challenge_id)
                    }
                    _ => None,
                }
            };
            if let Some(c) = removed {
                state.send_to_user(
                    &c.user.id,
                    &json!({"t": "challenge_declined", "id": c.id, "by": user}),
                );
            }
        }
        ClientMsg::Join { challenge_id } => {
            if !state.allow(&user.id, "join", 20, 10_000) {
                err(out, "slow down");
                return;
            }
            let challenge = {
                let mut challenges = state.challenges.lock();
                match challenges.get(&challenge_id) {
                    Some(c) if c.user.id == user.id => None,
                    Some(c) if c.to.as_ref().is_some_and(|t| t.id != user.id) => None,
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
                    layout: c.layout,
                    color: c.color,
                    setup: c.setup,
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
        ClientMsg::Abort { game_id } => {
            let Some(room) = room_of(state, &game_id) else {
                err(out, "no such game");
                return;
            };
            let mut r = room.lock();
            if r.color_of(&user.id).is_none() {
                err(out, "not a player");
                return;
            }
            // Only before both sides have played: an aborted game stays unrated.
            if r.game.status != Status::Playing || r.game.history.len() >= 2 {
                err(out, "cannot abort");
                return;
            }
            r.end(
                state,
                Status::Draw {
                    reason: EndReason::Abandoned,
                },
            );
            persist(state, &r);
        }
        ClientMsg::Moretime { game_id } => {
            if !state.allow(&user.id, &format!("moretime:{game_id}"), 3, 60_000) {
                err(out, "slow down");
                return;
            }
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
                if r.game.status != Status::Playing {
                    err(out, "game is over");
                    return;
                }
                r.clock.add_time(color.other(), MORETIME_MS);
                // Re-base on now (same remaining times) so clients can read `at` as "now".
                r.clock = r.clock.normalized(now_ms());
                r.broadcast(json!({"t": "clock", "game_id": r.id, "clock": r.clock}));
                persist(state, &r);
            }
            arm_timeout(state.clone(), room);
        }
        ClientMsg::TourJoin { id } => {
            if !state.allow(&user.id, "tour", 20, 10_000) {
                err(out, "slow down");
                return;
            }
            if let Err(e) = tournament::set_joined(state, user, &id, true) {
                err(out, &e);
            }
        }
        ClientMsg::TourLeave { id } => {
            if !state.allow(&user.id, "tour", 20, 10_000) {
                err(out, "slow down");
                return;
            }
            if let Err(e) = tournament::set_joined(state, user, &id, false) {
                err(out, &e);
            }
        }
        ClientMsg::TourChat { id, text } => {
            let text = text.trim();
            if text.is_empty() || text.chars().count() > 300 {
                err(out, "invalid chat");
                return;
            }
            let line =
                json!({"t": "tour_chat", "id": id, "user": user, "text": text, "at": now_ms()});
            let mut tours = state.tournaments.lock();
            let Some(arena) = tours.get_mut(&id) else {
                err(out, "unknown tournament");
                return;
            };
            // participants only (joined or already scored): keeps the shared fan-out honest
            if !arena.players.contains_key(&user.id) {
                err(out, "join the tournament to chat");
                return;
            }
            if !state.allow(&user.id, &format!("chat:{id}"), 5, 5000) {
                return; // rate limited: drop silently
            }
            arena.push_chat(line.clone());
            // Only the sockets watching this arena, like a room's channel.
            let _ = arena.tx.send(line.to_string());
        }
        ClientMsg::TourSub { id } => {
            if !state.allow(&user.id, "tour", 20, 10_000) {
                err(out, "slow down");
                return;
            }
            let Some(mut rx) = state.tournaments.lock().get(&id).map(|a| a.tx.subscribe()) else {
                err(out, "unknown tournament");
                return;
            };
            if let Some(task) = tour_sub.take() {
                task.abort();
            }
            let out2 = out.clone();
            *tour_sub = Some(tokio::spawn(async move {
                while let Ok(m) = rx.recv().await {
                    if out2.send(m).is_err() {
                        break;
                    }
                }
            }));
        }
        ClientMsg::TourUnsub => {
            if let Some(task) = tour_sub.take() {
                task.abort();
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
    create_game(
        state,
        white,
        black,
        seek.clock,
        game_config(seek.walled, seek.layout, seek.setup),
        None,
    );
    state.broadcast_lobby();
}

/// Create + persist a game, put it live and tell both players.
pub fn create_game(
    state: &Arc<AppState>,
    white: User,
    black: User,
    clock: ClockSpec,
    config: GameConfig,
    tournament_id: Option<String>,
) {
    let now = now_ms();
    let clock = Clock::new(clock, now);
    let id = rand_id(8);
    db::insert_game(
        &state.db.lock(),
        &id,
        &white,
        &black,
        &config,
        &clock,
        now,
        tournament_id.as_deref(),
    );
    let mut room = Room::new(
        id.clone(),
        Game::new(config),
        white.clone(),
        black.clone(),
        clock,
        now,
    );
    room.tournament_id = tournament_id;
    let room = Arc::new(Mutex::new(room));
    state.rooms.lock().insert(id.clone(), room.clone());

    let msg = json!({"t": "game_start", "game_id": id});
    state.send_to_user(&white.id, &msg);
    state.send_to_user(&black.id, &msg);
    arm_timeout(state.clone(), room.clone());
    arm_first_move_expiry(state.clone(), room.clone());
    bot::poke(state.clone(), room);
}

/// Is the bot one of the players? Its offers are answered by the server.
fn bot_game(room: &Room) -> bool {
    bot::is_bot(&room.white.id) || bot::is_bot(&room.black.id)
}
