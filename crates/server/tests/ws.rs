//! End-to-end: two clients, seek → accept → game_start → white moves → black sees it.

use std::process::{Child, Command};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

struct Server {
    child: Child,
    port: u16,
    _dir: std::path::PathBuf,
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = std::fs::remove_dir_all(&self._dir);
    }
}

impl Server {
    /// Simulate a crash + restart: same port, same DB file.
    async fn restart(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        self.child = spawn_server(self.port, &self._dir);
        wait_ready(self.port).await;
    }
}

fn spawn_server(port: u16, dir: &std::path::Path) -> Child {
    Command::new(env!("CARGO_BIN_EXE_rubrik-server"))
        .env("PORT", port.to_string())
        .env("DATABASE_PATH", dir.join("test.db"))
        .env("WEB_DIST", dir.join("dist"))
        .spawn()
        .expect("spawn server")
}

async fn wait_ready(port: u16) {
    for _ in 0..100 {
        if TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn start_server() -> Server {
    let port = {
        let l = std::net::TcpListener::bind("127.0.0.1:0").expect("free port");
        l.local_addr().expect("addr").port()
    };
    let dir = std::env::temp_dir().join(format!("rubrik-test-{port}"));
    std::fs::create_dir_all(&dir).expect("tmp dir");
    let child = spawn_server(port, &dir);
    wait_ready(port).await;
    Server {
        child,
        port,
        _dir: dir,
    }
}

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

async fn connect(port: u16) -> Ws {
    connect_sid(port).await.0
}

/// Connect anonymously, also returning the `sid=...` cookie of the new user.
async fn connect_sid(port: u16) -> (Ws, String) {
    let (ws, res) = tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{port}/ws"))
        .await
        .expect("ws connect");
    let sid = res
        .headers()
        .get("set-cookie")
        .and_then(|v| v.to_str().ok())
        .and_then(|c| c.split(';').next())
        .expect("sid cookie")
        .to_string();
    (ws, sid)
}

/// Reconnect as an existing user by replaying its session cookie.
async fn connect_as(port: u16, sid: &str) -> Ws {
    let mut req = format!("ws://127.0.0.1:{port}/ws")
        .into_client_request()
        .expect("request");
    req.headers_mut()
        .insert("cookie", sid.parse().expect("cookie value"));
    let (ws, _) = tokio_tungstenite::connect_async(req)
        .await
        .expect("ws connect");
    ws
}

async fn send(ws: &mut Ws, v: Value) {
    ws.send(Message::text(v.to_string())).await.expect("send");
}

/// Read messages until one has `t == want`, panicking on timeout.
async fn wait_for(ws: &mut Ws, want: &str) -> Value {
    wait_for_within(ws, want, 5).await
}

async fn wait_for_within(ws: &mut Ws, want: &str, secs: u64) -> Value {
    let fut = async {
        while let Some(msg) = ws.next().await {
            if let Message::Text(t) = msg.expect("ws msg") {
                let v: Value = serde_json::from_str(&t).expect("json");
                if v["t"] == want {
                    return v;
                }
            }
        }
        panic!("stream closed while waiting for {want}");
    };
    tokio::time::timeout(Duration::from_secs(secs), fut)
        .await
        .unwrap_or_else(|_| panic!("timeout waiting for {want}"))
}

/// Two fresh clients that seek/accept into a game: (a, b, a's id, game id).
async fn seek_accept(port: u16) -> (Ws, Ws, String, String) {
    let (mut a, mut b) = (connect(port).await, connect(port).await);
    let a_id = hello_id(&mut a).await;
    wait_for(&mut b, "hello").await;
    seek_accept_with(a, b, a_id).await
}

/// Own user id from the `hello` greeting.
async fn hello_id(ws: &mut Ws) -> String {
    wait_for(ws, "hello").await["me"]["id"]
        .as_str()
        .expect("id")
        .to_string()
}

/// Both `hello` greetings must already be consumed.
async fn seek_accept_with(mut a: Ws, mut b: Ws, a_id: String) -> (Ws, Ws, String, String) {
    send(
        &mut a,
        json!({"t":"seek","clock":{"initial_ms":60000,"increment_ms":1000},"walled":false}),
    )
    .await;

    // b sees the seek in a lobby broadcast
    let seek_id = loop {
        let lobby = wait_for(&mut b, "lobby").await;
        if let Some(s) = lobby["seeks"].as_array().and_then(|v| v.first()) {
            break s["id"].as_str().expect("seek id").to_string();
        }
    };

    send(&mut b, json!({"t":"accept","seek_id":seek_id})).await;

    let game_id = wait_for(&mut a, "game_start").await["game_id"]
        .as_str()
        .expect("game id")
        .to_string();
    assert_eq!(wait_for(&mut b, "game_start").await["game_id"], game_id);
    (a, b, a_id, game_id)
}

#[tokio::test]
async fn seek_accept_move() {
    let server = start_server().await;
    let (mut a, mut b, a_id, game_id) = seek_accept(server.port).await;

    send(&mut a, json!({"t":"watch","game_id":game_id})).await;
    send(&mut b, json!({"t":"watch","game_id":game_id})).await;
    let state = wait_for(&mut a, "game_state").await;
    wait_for(&mut b, "game_state").await;

    // whichever client is white plays a legal opening move; the other must see it
    let a_is_white = state["white"]["id"] == a_id.as_str();
    let (white, black) = if a_is_white {
        (&mut a, &mut b)
    } else {
        (&mut b, &mut a)
    };

    let game = rubrik_core::Game::new(rubrik_core::GameConfig::default());
    let mv = game.legal_moves(9).first().expect("legal move").clone();
    send(white, json!({"t":"move","game_id":game_id,"move":mv})).await;

    let seen = wait_for(black, "move").await;
    assert_eq!(seen["game_id"], game_id.as_str());
    assert_eq!(seen["ply"], 1);
    assert_eq!(seen["turn"], "black");
    assert_eq!(seen["move"], serde_json::to_value(&mv).expect("json"));
    assert!(seen["clock"]["white_ms"].as_i64().expect("white_ms") <= 61000);

    // white resigns: both sides get rated, with opposite diffs
    send(white, json!({"t":"resign","game_id":game_id})).await;
    let end = wait_for(black, "game_end").await;
    let wd = end["white_diff"].as_i64().expect("white_diff");
    let bd = end["black_diff"].as_i64().expect("black_diff");
    assert!(wd < 0 && bd > 0, "diffs {wd} {bd}");

    let http = reqwest::Client::new();
    let base = format!("http://127.0.0.1:{}", server.port);
    let row: Value = http
        .get(format!("{base}/api/games/{game_id}"))
        .send()
        .await
        .expect("get game")
        .json()
        .await
        .expect("json");
    assert_eq!(row["white_diff"], wd);
    assert_eq!(row["black_diff"], bd);

    let loser = row["white"]["name"].as_str().expect("name").to_string();
    let profile: Value = http
        .get(format!("{base}/api/users/{loser}"))
        .send()
        .await
        .expect("get user")
        .json()
        .await
        .expect("json");
    assert_eq!(profile["user"]["games"], 1);
    assert!(profile["user"]["rating"].as_f64().expect("rating") < 1500.0);
    assert_eq!(profile["games"][0]["id"], game_id.as_str());
}

#[tokio::test]
async fn chat_and_rematch() {
    let server = start_server().await;
    let (mut a, mut b, a_id, game_id) = seek_accept(server.port).await;

    send(&mut a, json!({"t":"watch","game_id":game_id})).await;
    send(&mut b, json!({"t":"watch","game_id":game_id})).await;
    let state = wait_for(&mut a, "game_state").await;
    wait_for(&mut b, "game_state").await;
    let white_id = state["white"]["id"].as_str().expect("white").to_string();
    let black_id = state["black"]["id"].as_str().expect("black").to_string();

    // chat reaches the other player
    send(
        &mut a,
        json!({"t":"chat","game_id":game_id,"text":"  gg  "}),
    )
    .await;
    let chat = wait_for(&mut b, "chat").await;
    assert_eq!(chat["game_id"], game_id.as_str());
    assert_eq!(chat["text"], "gg");
    assert_eq!(chat["user"]["id"], a_id.as_str());

    // a resigns, then both offer a rematch
    send(&mut a, json!({"t":"resign","game_id":game_id})).await;
    wait_for(&mut b, "game_end").await;

    send(
        &mut a,
        json!({"t":"rematch","game_id":game_id,"offer":true}),
    )
    .await;
    let offer = wait_for(&mut b, "rematch_offer").await;
    assert!(offer["by"].is_string());
    send(
        &mut b,
        json!({"t":"rematch","game_id":game_id,"offer":true}),
    )
    .await;

    let new_id = wait_for(&mut a, "game_start").await["game_id"]
        .as_str()
        .expect("game id")
        .to_string();
    assert_ne!(new_id, game_id);
    assert_eq!(wait_for(&mut b, "game_start").await["game_id"], new_id);

    // colours swapped, same clock and rules
    send(&mut a, json!({"t":"watch","game_id":new_id})).await;
    let state2 = wait_for(&mut a, "game_state").await;
    assert_eq!(state2["white"]["id"], black_id.as_str());
    assert_eq!(state2["black"]["id"], white_id.as_str());
    assert_eq!(state2["clock"]["initial_ms"], 60000);
    assert_eq!(state2["game"]["config"]["rules"]["walled"], false);
}

#[tokio::test]
async fn register_logout_login() {
    let server = start_server().await;
    let base = format!("http://127.0.0.1:{}", server.port);
    let http = reqwest::Client::builder()
        .cookie_store(true)
        .build()
        .expect("client");

    let me: Value = http
        .get(format!("{base}/api/me"))
        .send()
        .await
        .expect("me")
        .json()
        .await
        .expect("json");
    let id = me["id"].as_str().expect("id").to_string();
    assert_eq!(me["registered"], false);
    assert_eq!(me["rating"], 1500.0);

    let creds = json!({"name": "Kasparov", "password": "hunter22"});
    let reg: Value = http
        .post(format!("{base}/api/register"))
        .json(&creds)
        .send()
        .await
        .expect("register")
        .json()
        .await
        .expect("json");
    assert_eq!(reg["id"], id.as_str());
    assert_eq!(reg["name"], "Kasparov");
    assert_eq!(reg["registered"], true);

    let out: Value = http
        .post(format!("{base}/api/logout"))
        .send()
        .await
        .expect("logout")
        .json()
        .await
        .expect("json");
    assert_ne!(out["id"], id.as_str());

    // the freed name is now taken by the registered account
    let taken = http
        .post(format!("{base}/api/register"))
        .json(&creds)
        .send()
        .await
        .expect("register twice");
    assert_eq!(taken.status(), reqwest::StatusCode::CONFLICT);

    let bad = http
        .post(format!("{base}/api/login"))
        .json(&json!({"name": "Kasparov", "password": "wrong!!"}))
        .send()
        .await
        .expect("login");
    assert_eq!(bad.status(), reqwest::StatusCode::UNAUTHORIZED);

    let back: Value = http
        .post(format!("{base}/api/login"))
        .json(&creds)
        .send()
        .await
        .expect("login")
        .json()
        .await
        .expect("json");
    assert_eq!(back["id"], id.as_str());

    let me2: Value = http
        .get(format!("{base}/api/me"))
        .send()
        .await
        .expect("me")
        .json()
        .await
        .expect("json");
    assert_eq!(me2["id"], id.as_str());
}

/// A crashed server rehydrates in-flight games from the DB: state, clock and
/// move handling all survive the restart.
#[tokio::test]
async fn restart_rehydrates_game() {
    let mut server = start_server().await;
    let (mut a, a_sid) = connect_sid(server.port).await;
    let (mut b, b_sid) = connect_sid(server.port).await;
    let a_id = hello_id(&mut a).await;
    wait_for(&mut b, "hello").await;
    let (mut a, mut b, a_id, game_id) = seek_accept_with(a, b, a_id).await;

    send(&mut a, json!({"t":"watch","game_id":game_id})).await;
    wait_for(&mut a, "game_state").await;
    send(&mut b, json!({"t":"watch","game_id":game_id})).await;
    let state = wait_for(&mut b, "game_state").await;
    let a_is_white = state["white"]["id"] == a_id.as_str();
    let (white_sid, black_sid) = if a_is_white {
        (a_sid, b_sid)
    } else {
        (b_sid, a_sid)
    };

    let mut game = rubrik_core::Game::new(rubrik_core::GameConfig::default());
    let mv = game.legal_moves(9).first().expect("legal move").clone();
    let white = if a_is_white { &mut a } else { &mut b };
    send(white, json!({"t":"move","game_id":game_id,"move":mv})).await;
    wait_for(white, "move").await;
    game.play(mv).expect("replay white move");

    let restart_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("epoch")
        .as_millis() as i64;
    server.restart().await;

    // the rehydrated room keeps the position and hands the clock to black
    let mut spectator = connect(server.port).await;
    wait_for(&mut spectator, "hello").await;
    send(&mut spectator, json!({"t":"watch","game_id":game_id})).await;
    let state = wait_for(&mut spectator, "game_state").await;
    assert_eq!(state["game"]["status"]["kind"], "playing");
    assert_eq!(
        state["game"]["history"].as_array().expect("history").len(),
        1
    );
    assert_eq!(state["game"]["turn"], "black");
    assert_eq!(state["clock"]["running"], "black");
    // downtime is not charged: black's budget is intact and its clock restarts now
    let black_ms = state["clock"]["black_ms"].as_i64().expect("black_ms");
    assert!((59000..=60000).contains(&black_ms), "black_ms {black_ms}");
    assert!(state["clock"]["at"].as_i64().expect("at") >= restart_at);
    let white_ms = state["clock"]["white_ms"].as_i64().expect("white_ms");
    assert!((60000..=61000).contains(&white_ms), "white_ms {white_ms}");

    // ...and still accepts moves
    let reply = (0..game.board.cells.len() as u16)
        .find_map(|c| game.legal_moves(c).into_iter().next())
        .expect("black move");
    let mut black = connect_as(server.port, &black_sid).await;
    send(
        &mut black,
        json!({"t":"move","game_id":game_id,"move":reply}),
    )
    .await;
    let seen = wait_for(&mut spectator, "move").await;
    assert_eq!(seen["ply"], 2);
    assert_eq!(seen["turn"], "white");

    // the white player can still resign from a reconnected session
    let mut white = connect_as(server.port, &white_sid).await;
    send(&mut white, json!({"t":"resign","game_id":game_id})).await;
    wait_for(&mut spectator, "game_end").await;
}

/// Two compatible seeks pair without an explicit `accept`, and the live game
/// shows up on TV with its watcher count.
#[tokio::test]
async fn quick_pairing_and_tv() {
    let server = start_server().await;
    let mut a = connect(server.port).await;
    let mut b = connect(server.port).await;
    let a_id = wait_for(&mut a, "hello").await["me"]["id"]
        .as_str()
        .expect("id")
        .to_string();
    wait_for(&mut b, "hello").await;

    // an out-of-range clock is rejected (0+0 is unlimited and allowed)
    send(
        &mut a,
        json!({"t":"seek","clock":{"initial_ms":-1,"increment_ms":0}}),
    )
    .await;
    wait_for(&mut a, "error").await;

    let clock = json!({"initial_ms":60000,"increment_ms":1000});
    send(
        &mut a,
        json!({"t":"seek","clock":clock,"walled":false,"color":"white"}),
    )
    .await;
    // wait until b sees a's seek, so the second seek can match it
    loop {
        let lobby = wait_for(&mut b, "lobby").await;
        if lobby["seeks"].as_array().is_some_and(|v| !v.is_empty()) {
            break;
        }
    }
    send(
        &mut b,
        json!({"t":"seek","clock":clock,"walled":false,"color":"random"}),
    )
    .await;

    let game_id = wait_for(&mut a, "game_start").await["game_id"]
        .as_str()
        .expect("game id")
        .to_string();
    assert_eq!(wait_for(&mut b, "game_start").await["game_id"], game_id);

    send(&mut a, json!({"t":"watch","game_id":game_id})).await;
    let state = wait_for(&mut a, "game_state").await;
    // the seeker asked for white and got it
    assert_eq!(state["white"]["id"], a_id.as_str());
    assert_eq!(state["watchers"], 1);
    assert_eq!(state["presence"], json!({"white": true, "black": true}));
    assert!(state["takeback_offer"].is_null());

    send(&mut b, json!({"t":"watch","game_id":game_id})).await;
    loop {
        let n = wait_for(&mut a, "watchers").await;
        assert_eq!(n["game_id"], game_id.as_str());
        if n["n"] == 2 {
            break;
        }
    }

    let base = format!("http://127.0.0.1:{}", server.port);
    let tv: Value = reqwest::get(format!("{base}/api/tv"))
        .await
        .expect("tv")
        .json()
        .await
        .expect("json");
    let tv = tv.as_array().expect("array");
    assert_eq!(tv.len(), 1);
    assert_eq!(tv[0]["id"], game_id.as_str());
    assert_eq!(tv[0]["plies"], 0);
    assert_eq!(tv[0]["watchers"], 2);
    assert_eq!(tv[0]["clock"]["initial_ms"], 60000);
}

/// Move times: remaining ms of the mover after each ply, in `game_state` and the API row.
#[tokio::test]
async fn move_times() {
    let server = start_server().await;
    let (mut a, mut b, a_id, game_id) = seek_accept(server.port).await;
    send(&mut a, json!({"t":"watch","game_id":game_id})).await;
    send(&mut b, json!({"t":"watch","game_id":game_id})).await;
    let state = wait_for(&mut a, "game_state").await;
    wait_for(&mut b, "game_state").await;
    assert_eq!(state["times"].as_array().expect("times").len(), 0);
    let (white, black) = if state["white"]["id"] == a_id.as_str() {
        (&mut a, &mut b)
    } else {
        (&mut b, &mut a)
    };

    let mut game = rubrik_core::Game::new(rubrik_core::GameConfig::default());
    let mv = game.legal_moves(9).first().expect("legal move").clone();
    send(white, json!({"t":"move","game_id":game_id,"move":mv})).await;
    wait_for(black, "move").await;
    game.play(mv).expect("replay white move");
    let reply = (0..game.board.cells.len() as u16)
        .find_map(|c| game.legal_moves(c).into_iter().next())
        .expect("black move");
    send(black, json!({"t":"move","game_id":game_id,"move":reply})).await;
    wait_for(white, "move").await;

    // a late spectator sees both times (clock is 60s + 1s increment)
    let mut c = connect(server.port).await;
    wait_for(&mut c, "hello").await;
    send(&mut c, json!({"t":"watch","game_id":game_id})).await;
    let times = wait_for(&mut c, "game_state").await["times"]
        .as_array()
        .expect("times")
        .iter()
        .map(|t| t.as_i64().expect("ms"))
        .collect::<Vec<_>>();
    assert_eq!(times.len(), 2);
    assert!(
        times.iter().all(|&t| (0..=61_000).contains(&t)),
        "{times:?}"
    );

    let row: Value = reqwest::get(format!(
        "http://127.0.0.1:{}/api/games/{game_id}",
        server.port
    ))
    .await
    .expect("get game")
    .json()
    .await
    .expect("json");
    assert_eq!(row["times"], json!(times));
}

/// Offer + accept a takeback: the move is rewound and everyone is resynced.
#[tokio::test]
async fn takeback() {
    let server = start_server().await;
    let (mut a, mut b, a_id, game_id) = seek_accept(server.port).await;
    send(&mut a, json!({"t":"watch","game_id":game_id})).await;
    send(&mut b, json!({"t":"watch","game_id":game_id})).await;
    let state = wait_for(&mut a, "game_state").await;
    wait_for(&mut b, "game_state").await;
    let (white, black) = if state["white"]["id"] == a_id.as_str() {
        (&mut a, &mut b)
    } else {
        (&mut b, &mut a)
    };

    let mut game = rubrik_core::Game::new(rubrik_core::GameConfig::default());
    let mv = game.legal_moves(9).first().expect("legal move").clone();
    send(white, json!({"t":"move","game_id":game_id,"move":mv})).await;
    wait_for(black, "move").await;
    game.play(mv.clone()).expect("replay white move");

    send(
        white,
        json!({"t":"takeback","game_id":game_id,"offer":true}),
    )
    .await;
    let offer = wait_for(black, "takeback_offer").await;
    assert_eq!(offer["by"], "white");

    send(
        black,
        json!({"t":"takeback","game_id":game_id,"offer":true}),
    )
    .await;
    let state = wait_for(black, "game_state").await;
    assert_eq!(
        state["game"]["history"].as_array().expect("history").len(),
        0
    );
    assert_eq!(state["game"]["turn"], "white");
    assert_eq!(state["clock"]["running"], "white");
    assert!(state["takeback_offer"].is_null());
    assert_eq!(state["times"].as_array().expect("times").len(), 0);

    // Two plies: white asks once black has already replied, so both moves go.
    send(white, json!({"t":"move","game_id":game_id,"move":mv})).await;
    wait_for(black, "move").await;
    let reply = (0..game.board.cells.len() as u16)
        .find_map(|c| game.legal_moves(c).into_iter().next())
        .expect("black move");
    send(black, json!({"t":"move","game_id":game_id,"move":reply})).await;
    wait_for(white, "move").await;

    send(
        white,
        json!({"t":"takeback","game_id":game_id,"offer":true}),
    )
    .await;
    assert_eq!(wait_for(black, "takeback_offer").await["by"], "white");
    send(
        black,
        json!({"t":"takeback","game_id":game_id,"offer":true}),
    )
    .await;
    let state = wait_for(white, "game_state").await;
    assert_eq!(
        state["game"]["history"].as_array().expect("history").len(),
        0
    );
    assert_eq!(state["game"]["turn"], "white");
    assert_eq!(state["clock"]["running"], "white");
}

/// `moretime` gifts the opponent 15s; `abort` ends an unplayed game unrated.
#[tokio::test]
async fn moretime_and_abort() {
    let server = start_server().await;
    let (mut a, mut b, a_id, game_id) = seek_accept(server.port).await;
    send(&mut a, json!({"t":"watch","game_id":game_id})).await;
    send(&mut b, json!({"t":"watch","game_id":game_id})).await;
    let state = wait_for(&mut a, "game_state").await;
    wait_for(&mut b, "game_state").await;
    let (white, black) = if state["white"]["id"] == a_id.as_str() {
        (&mut a, &mut b)
    } else {
        (&mut b, &mut a)
    };

    send(white, json!({"t":"moretime","game_id":game_id})).await;
    let clock = wait_for(black, "clock").await;
    assert_eq!(clock["game_id"], game_id.as_str());
    assert_eq!(clock["clock"]["black_ms"], 75000);
    // white is running, so its remaining time is re-based on `at`
    let white_ms = clock["clock"]["white_ms"].as_i64().expect("white_ms");
    assert!((59000..=60000).contains(&white_ms), "white_ms {white_ms}");
    assert_eq!(clock["clock"]["running"], "white");

    // nothing played yet, so either player may abort; the game stays unrated
    send(black, json!({"t":"abort","game_id":game_id})).await;
    let end = wait_for(white, "game_end").await;
    assert_eq!(end["status"], json!({"kind":"draw","reason":"abandoned"}));
    assert!(end["white_diff"].is_null());

    // ...and a second abort is refused
    send(black, json!({"t":"abort","game_id":game_id})).await;
    assert_eq!(wait_for(black, "error").await["msg"], "cannot abort");
}

/// The lobby carries the count of connected users; finished games between two
/// players add up in the crosstable.
#[tokio::test]
async fn online_count_and_crosstable() {
    let server = start_server().await;
    let mut a = connect(server.port).await;
    let a_id = hello_id(&mut a).await;
    assert_eq!(wait_for(&mut a, "lobby").await["online"], 1);

    let mut b = connect(server.port).await;
    wait_for(&mut b, "hello").await;
    loop {
        if wait_for(&mut a, "lobby").await["online"] == 2 {
            break;
        }
    }

    let (mut a, mut b, a_id, game_id) = seek_accept_with(a, b, a_id).await;
    send(&mut a, json!({"t":"watch","game_id":game_id})).await;
    send(&mut b, json!({"t":"watch","game_id":game_id})).await;
    let state = wait_for(&mut a, "game_state").await;
    wait_for(&mut b, "game_state").await;
    let b_id = if state["white"]["id"] == a_id.as_str() {
        state["black"]["id"].as_str().expect("id").to_string()
    } else {
        state["white"]["id"].as_str().expect("id").to_string()
    };

    send(&mut a, json!({"t":"resign","game_id":game_id})).await;
    wait_for(&mut b, "game_end").await;

    let base = format!("http://127.0.0.1:{}", server.port);
    let cross: Value = reqwest::get(format!("{base}/api/crosstable?a={a_id}&b={b_id}"))
        .await
        .expect("crosstable")
        .json()
        .await
        .expect("json");
    assert_eq!(cross["games"], 1);
    assert_eq!(cross["a_score"], 0.0);
    assert_eq!(cross["b_score"], 1.0);
    assert_eq!(cross["recent"], json!([{"id": game_id, "winner": "b"}]));

    // a disconnects: the remaining client sees the online count drop
    drop(a);
    loop {
        if wait_for(&mut b, "lobby").await["online"] == 1 {
            break;
        }
    }
}

/// A challenge link is fetchable over HTTP and starts a game when joined.
#[tokio::test]
async fn challenge_join() {
    let server = start_server().await;
    let mut a = connect(server.port).await;
    let mut b = connect(server.port).await;
    wait_for(&mut a, "hello").await;
    let b_id = wait_for(&mut b, "hello").await["me"]["id"]
        .as_str()
        .expect("id")
        .to_string();

    send(
        &mut a,
        json!({"t":"challenge","clock":{"initial_ms":120000,"increment_ms":0},
               "walled":true,"color":"black"}),
    )
    .await;
    let ch = wait_for(&mut a, "challenge").await["challenge"].clone();
    let ch_id = ch["id"].as_str().expect("id").to_string();
    assert_eq!(ch["color"], "black");

    let base = format!("http://127.0.0.1:{}", server.port);
    let fetched: Value = reqwest::get(format!("{base}/api/challenges/{ch_id}"))
        .await
        .expect("challenge")
        .json()
        .await
        .expect("json");
    assert_eq!(fetched["id"], ch_id.as_str());
    assert_eq!(fetched["clock"]["initial_ms"], 120000);

    send(&mut b, json!({"t":"join","challenge_id":ch_id})).await;
    let game_id = wait_for(&mut b, "game_start").await["game_id"]
        .as_str()
        .expect("game id")
        .to_string();
    assert_eq!(wait_for(&mut a, "game_start").await["game_id"], game_id);

    send(&mut b, json!({"t":"watch","game_id":game_id})).await;
    let state = wait_for(&mut b, "game_state").await;
    // creator asked for black, so the joiner is white
    assert_eq!(state["white"]["id"], b_id.as_str());
    assert_eq!(state["game"]["config"]["rules"]["walled"], true);
    assert_eq!(state["clock"]["initial_ms"], 120000);

    // game rows and tv items carry `walled` so lists can label the variant
    let row: Value = reqwest::get(format!("{base}/api/games/{game_id}"))
        .await
        .expect("game")
        .json()
        .await
        .expect("json");
    assert_eq!(row["walled"], true);
    let tv: Value = reqwest::get(format!("{base}/api/tv"))
        .await
        .expect("tv")
        .json()
        .await
        .expect("json");
    assert_eq!(tv[0]["walled"], true);

    // the challenge is consumed
    let gone = reqwest::get(format!("{base}/api/challenges/{ch_id}"))
        .await
        .expect("challenge");
    assert_eq!(gone.status(), reqwest::StatusCode::NOT_FOUND);
}

/// A rubrik-layout seek pairs only with another rubrik seek, and a spectator
/// joining later gets the room's chat history.
#[tokio::test]
async fn rubrik_layout_and_chat_history() {
    let server = start_server().await;
    let mut a = connect(server.port).await;
    let mut b = connect(server.port).await;
    let a_id = hello_id(&mut a).await;
    wait_for(&mut b, "hello").await;

    let clock = json!({"initial_ms":60000,"increment_ms":0});
    send(&mut a, json!({"t":"seek","clock":clock,"layout":"rubrik"})).await;
    // wait until b sees the seek, so its own seek can match it
    loop {
        let lobby = wait_for(&mut b, "lobby").await;
        if let Some(s) = lobby["seeks"].as_array().and_then(|v| v.first()) {
            assert_eq!(s["layout"], "rubrik");
            break;
        }
    }
    send(&mut b, json!({"t":"seek","clock":clock,"layout":"rubrik"})).await;

    let game_id = wait_for(&mut a, "game_start").await["game_id"]
        .as_str()
        .expect("game id")
        .to_string();
    assert_eq!(wait_for(&mut b, "game_start").await["game_id"], game_id);

    send(&mut a, json!({"t":"watch","game_id":game_id})).await;
    let state = wait_for(&mut a, "game_state").await;
    assert_eq!(state["game"]["config"]["layout"], json!([0, 1, 2, 3, 4, 5]));
    assert_eq!(state["chat"], json!([]));

    send(&mut a, json!({"t":"chat","game_id":game_id,"text":"hi"})).await;
    wait_for(&mut a, "chat").await;

    // a late spectator replays the conversation from `game_state`
    let mut c = connect(server.port).await;
    wait_for(&mut c, "hello").await;
    send(&mut c, json!({"t":"watch","game_id":game_id})).await;
    let seen = wait_for(&mut c, "game_state").await;
    assert_eq!(seen["chat"].as_array().expect("chat").len(), 1);
    assert_eq!(seen["chat"][0]["text"], "hi");
    assert_eq!(seen["chat"][0]["user"]["id"], a_id.as_str());

    let base = format!("http://127.0.0.1:{}", server.port);
    let tv: Value = reqwest::get(format!("{base}/api/tv"))
        .await
        .expect("tv")
        .json()
        .await
        .expect("json");
    assert_eq!(tv[0]["layout"], "rubrik");

    // the stored row exposes the layout too
    let row: Value = reqwest::get(format!("{base}/api/games/{game_id}"))
        .await
        .expect("game")
        .json()
        .await
        .expect("json");
    assert_eq!(row["layout"], "rubrik");
}

/// Arena: two players join, get paired automatically once it starts, and the
/// finished game feeds the standings.
#[tokio::test]
async fn arena_tournament() {
    let server = start_server().await;
    let base = format!("http://127.0.0.1:{}", server.port);
    let (mut a, a_sid) = connect_sid(server.port).await;
    let (mut b, _b_sid) = connect_sid(server.port).await;
    let a_id = hello_id(&mut a).await;
    wait_for(&mut b, "hello").await;

    let http = reqwest::Client::new();
    let created: Value = http
        .post(format!("{base}/api/tournaments"))
        .header("cookie", &a_sid)
        .json(
            &json!({"name":"Test Arena","clock":{"initial_ms":60000,"increment_ms":0},
                      "walled":false,"layout":"standard",
                      "starts_in_ms":10000,"duration_ms":300000}),
        )
        .send()
        .await
        .expect("create tournament")
        .json()
        .await
        .expect("json");
    assert_eq!(created["status"], "created");
    assert_eq!(created["name"], "Test Arena");
    assert_eq!(created["created_by"]["id"], a_id.as_str());
    let tid = created["id"].as_str().expect("id").to_string();

    // a session is required to create one
    let anon = http
        .post(format!("{base}/api/tournaments"))
        .json(
            &json!({"name":"No Session","clock":{"initial_ms":60000,"increment_ms":0},
                      "starts_in_ms":10000,"duration_ms":300000}),
        )
        .send()
        .await
        .expect("create tournament");
    assert_eq!(anon.status(), reqwest::StatusCode::UNAUTHORIZED);

    send(&mut a, json!({"t":"tour_join","id":tid})).await;
    send(&mut b, json!({"t":"tour_join","id":tid})).await;
    loop {
        let msg = wait_for(&mut a, "tour").await;
        if msg["joined"] == json!(true) {
            assert_eq!(msg["tournament"]["id"], tid.as_str());
            break;
        }
    }

    // the arena starts on its own and pairs the two joined, connected players
    let game_id = wait_for_within(&mut a, "game_start", 30).await["game_id"]
        .as_str()
        .expect("game id")
        .to_string();
    assert_eq!(
        wait_for_within(&mut b, "game_start", 30).await["game_id"],
        game_id
    );

    send(&mut a, json!({"t":"watch","game_id":game_id})).await;
    send(&mut b, json!({"t":"watch","game_id":game_id})).await;
    let state = wait_for(&mut a, "game_state").await;
    wait_for(&mut b, "game_state").await;
    assert_eq!(state["tournament_id"], tid.as_str());
    assert_eq!(state["clock"]["initial_ms"], 60000);
    let a_is_white = state["white"]["id"] == a_id.as_str();
    let (white, black) = if a_is_white {
        (&mut a, &mut b)
    } else {
        (&mut b, &mut a)
    };

    send(white, json!({"t":"resign","game_id":game_id})).await;
    wait_for(black, "game_end").await;

    let view: Value = reqwest::get(format!("{base}/api/tournaments/{tid}"))
        .await
        .expect("tournament")
        .json()
        .await
        .expect("json");
    assert_eq!(view["tournament"]["status"], "running");
    assert_eq!(view["tournament"]["players"], 2);
    let standings = view["standings"].as_array().expect("standings");
    assert_eq!(standings.len(), 2);
    assert_eq!(standings[0]["score"], 2);
    assert_eq!(standings[0]["wins"], 1);
    assert_eq!(standings[1]["score"], 0);
    assert_eq!(standings[1]["games"], 1);
    assert_eq!(view["games"][0]["tournament_id"], tid.as_str());

    // it also shows up as running in the index
    let index: Value = reqwest::get(format!("{base}/api/tournaments"))
        .await
        .expect("tournaments")
        .json()
        .await
        .expect("json");
    assert_eq!(index["running"][0]["id"], tid.as_str());
    // the scheduler keeps one system arena upcoming at all times
    let upcoming = index["upcoming"].as_array().expect("upcoming");
    assert_eq!(upcoming.len(), 1);
    assert_eq!(upcoming[0]["created_by"]["name"], "Rubrik");
}

/// A leave from a user who never joined must not create a standings row, and the
/// index must stay responsive while players join (lock order tournaments → db).
#[tokio::test]
async fn tour_leave_without_join_and_index_under_load() {
    let server = start_server().await;
    let base = format!("http://127.0.0.1:{}", server.port);
    let (mut a, a_sid) = connect_sid(server.port).await;
    let (mut b, _b_sid) = connect_sid(server.port).await;
    wait_for(&mut a, "hello").await;
    wait_for(&mut b, "hello").await;

    let http = reqwest::Client::new();
    let created: Value = http
        .post(format!("{base}/api/tournaments"))
        .header("cookie", &a_sid)
        .json(
            &json!({"name":"Lock Arena","clock":{"initial_ms":60000,"increment_ms":0},
                      "starts_in_ms":600000,"duration_ms":300000}),
        )
        .send()
        .await
        .expect("create tournament")
        .json()
        .await
        .expect("json");
    let tid = created["id"].as_str().expect("id").to_string();

    // b leaves without ever joining; the follow-up error proves it was handled
    send(&mut b, json!({"t":"tour_leave","id":tid})).await;
    send(&mut b, json!({"t":"tour_leave","id":"nosuchtour"})).await;
    wait_for(&mut b, "error").await;

    let view: Value = reqwest::get(format!("{base}/api/tournaments/{tid}"))
        .await
        .expect("tournament")
        .json()
        .await
        .expect("json");
    assert_eq!(view["tournament"]["players"], 0);
    assert_eq!(view["standings"], json!([]));

    // interleave joins/leaves with index fetches: an inverted lock order deadlocks here
    for i in 0..20 {
        let t = if i % 2 == 0 {
            "tour_join"
        } else {
            "tour_leave"
        };
        send(&mut a, json!({"t":t,"id":tid})).await;
        let index: Value = reqwest::get(format!("{base}/api/tournaments"))
            .await
            .expect("tournaments")
            .json()
            .await
            .expect("json");
        assert_eq!(index["upcoming"][0]["id"], tid.as_str());
    }
    send(&mut a, json!({"t":"tour_leave","id":"nosuchtour"})).await;
    wait_for(&mut a, "error").await;

    let view: Value = http
        .get(format!("{base}/api/tournaments/{tid}"))
        .header("cookie", &a_sid)
        .send()
        .await
        .expect("tournament")
        .json()
        .await
        .expect("json");
    assert_eq!(view["tournament"]["players"], 1);
    assert_eq!(view["joined"], json!(false));
}

/// Password guessing is capped per account name: argon2 verification is expensive.
#[tokio::test]
async fn login_is_rate_limited() {
    let server = start_server().await;
    let base = format!("http://127.0.0.1:{}", server.port);
    let http = reqwest::Client::builder()
        .cookie_store(true)
        .build()
        .expect("client");
    http.get(format!("{base}/api/me")).send().await.expect("me");
    http.post(format!("{base}/api/register"))
        .json(&json!({"name": "Fischer", "password": "hunter22"}))
        .send()
        .await
        .expect("register");

    let wrong = json!({"name": "fischer", "password": "guessing"});
    for _ in 0..10 {
        let res = http
            .post(format!("{base}/api/login"))
            .json(&wrong)
            .send()
            .await
            .expect("login");
        assert_eq!(res.status(), reqwest::StatusCode::UNAUTHORIZED);
    }
    let res = http
        .post(format!("{base}/api/login"))
        .json(&wrong)
        .send()
        .await
        .expect("login");
    assert_eq!(res.status(), reqwest::StatusCode::TOO_MANY_REQUESTS);
    // the correct password is refused too while the window lasts
    let res = http
        .post(format!("{base}/api/login"))
        .json(&json!({"name": "Fischer", "password": "hunter22"}))
        .send()
        .await
        .expect("login");
    assert_eq!(res.status(), reqwest::StatusCode::TOO_MANY_REQUESTS);
}

/// `/api/me/games` lists only the session's own live games; oversized custom
/// positions never become one.
#[tokio::test]
async fn my_games_and_setup_limits() {
    let server = start_server().await;
    let base = format!("http://127.0.0.1:{}", server.port);
    let http = reqwest::Client::new();

    let (mut a, a_sid) = connect_sid(server.port).await;
    let mut b = connect(server.port).await;
    let a_id = hello_id(&mut a).await;
    wait_for(&mut b, "hello").await;

    // 72 white queens: rejected before any game exists
    let mut rows = vec!["--------"; 48];
    rows[0] = "K-------";
    rows[1..10].fill("QQQQQQQQ");
    rows[47] = "-------k";
    send(
        &mut a,
        json!({"t":"challenge","clock":{"initial_ms":60000,"increment_ms":0},
               "setup": rows.join("\n")}),
    )
    .await;
    assert_eq!(wait_for(&mut a, "error").await["msg"], "invalid position");

    // `_b` stays connected: dropping it would end the game.
    let (mut a, _b, a_id, game_id) = seek_accept_with(a, b, a_id).await;
    send(&mut a, json!({"t":"watch","game_id":game_id})).await;
    let state = wait_for(&mut a, "game_state").await;
    let a_is_white = state["white"]["id"] == a_id.as_str();

    let mine: Value = http
        .get(format!("{base}/api/me/games"))
        .header("cookie", &a_sid)
        .send()
        .await
        .expect("my games")
        .json()
        .await
        .expect("json");
    let mine = mine.as_array().expect("array");
    assert_eq!(mine.len(), 1);
    assert_eq!(mine[0]["id"], game_id.as_str());
    assert_eq!(mine[0]["my_turn"], a_is_white);
    assert_eq!(mine[0]["plies"], 0);
    assert_eq!(mine[0]["clock"]["initial_ms"], 60000);
    let opponent = if a_is_white {
        &state["black"]["id"]
    } else {
        &state["white"]["id"]
    };
    assert_eq!(&mine[0]["opponent"]["id"], opponent);

    // no session → 401
    let res = http
        .get(format!("{base}/api/me/games"))
        .send()
        .await
        .expect("my games");
    assert_eq!(res.status(), reqwest::StatusCode::UNAUTHORIZED);
}

/// follow → the target shows up in `/api/friends` (online, in their live game)
/// and in `/api/users/:name`; unfollow empties the list again.
#[tokio::test]
async fn follow_and_friends() {
    let server = start_server().await;
    let base = format!("http://127.0.0.1:{}", server.port);
    let http = reqwest::Client::new();

    let (mut a, a_sid) = connect_sid(server.port).await;
    let mut b = connect(server.port).await;
    let a_id = hello_id(&mut a).await;
    wait_for(&mut b, "hello").await;
    let (mut a, _b, a_id, game_id) = seek_accept_with(a, b, a_id).await;
    send(&mut a, json!({"t":"watch","game_id":game_id})).await;
    let state = wait_for(&mut a, "game_state").await;
    let a_is_white = state["white"]["id"] == a_id.as_str();
    let (me, opponent) = match a_is_white {
        true => (&state["white"], &state["black"]),
        false => (&state["black"], &state["white"]),
    };
    let name = opponent["name"].as_str().expect("name").to_string();
    let my_name = me["name"].as_str().expect("name").to_string();

    let res: Value = http
        .post(format!("{base}/api/follow/{name}"))
        .header("cookie", &a_sid)
        .send()
        .await
        .expect("follow")
        .json()
        .await
        .expect("json");
    assert_eq!(res["following"], json!(true));

    let friends: Value = http
        .get(format!("{base}/api/friends"))
        .header("cookie", &a_sid)
        .send()
        .await
        .expect("friends")
        .json()
        .await
        .expect("json");
    let friends = friends.as_array().expect("array");
    assert_eq!(friends.len(), 1);
    assert_eq!(friends[0]["user"]["name"], name.as_str());
    assert_eq!(friends[0]["online"], json!(true));
    assert_eq!(friends[0]["playing"], game_id.as_str());

    let view: Value = http
        .get(format!("{base}/api/users/{name}"))
        .header("cookie", &a_sid)
        .send()
        .await
        .expect("user")
        .json()
        .await
        .expect("json");
    assert_eq!(view["following"], json!(true));
    assert_eq!(view["followers"], json!(1));
    // no session → not following
    let anon: Value = reqwest::get(format!("{base}/api/users/{name}"))
        .await
        .expect("user")
        .json()
        .await
        .expect("json");
    assert_eq!(anon["following"], json!(false));

    // self-follow is refused
    let res = http
        .post(format!("{base}/api/follow/{my_name}"))
        .header("cookie", &a_sid)
        .send()
        .await
        .expect("self follow");
    assert_eq!(res.status(), reqwest::StatusCode::BAD_REQUEST);

    let res: Value = http
        .delete(format!("{base}/api/follow/{name}"))
        .header("cookie", &a_sid)
        .send()
        .await
        .expect("unfollow")
        .json()
        .await
        .expect("json");
    assert_eq!(res["following"], json!(false));
    let friends: Value = http
        .get(format!("{base}/api/friends"))
        .header("cookie", &a_sid)
        .send()
        .await
        .expect("friends")
        .json()
        .await
        .expect("json");
    assert!(friends.as_array().expect("array").is_empty());
}

/// A finished bullet game rates the bullet perf as well as the overall rating,
/// and `/api/leaderboard?perf=bullet` ranks registered players by it.
#[tokio::test]
async fn per_speed_ratings() {
    let server = start_server().await;
    let base = format!("http://127.0.0.1:{}", server.port);
    let http = reqwest::Client::new();

    let (mut a, a_sid) = connect_sid(server.port).await;
    let mut b = connect(server.port).await;
    let a_id = hello_id(&mut a).await;
    wait_for(&mut b, "hello").await;
    let registered: Value = http
        .post(format!("{base}/api/register"))
        .header("cookie", &a_sid)
        .json(&json!({"name": "Anderssen", "password": "hunter22"}))
        .send()
        .await
        .expect("register")
        .json()
        .await
        .expect("json");
    assert_eq!(registered["registered"], json!(true));

    // 1+1 = 60 + 40 × 1 s estimated → bullet
    let (mut a, mut b, a_id, game_id) = seek_accept_with(a, b, a_id).await;
    send(&mut a, json!({"t":"watch","game_id":game_id})).await;
    send(&mut b, json!({"t":"watch","game_id":game_id})).await;
    let state = wait_for(&mut a, "game_state").await;
    wait_for(&mut b, "game_state").await;
    let a_is_white = state["white"]["id"] == a_id.as_str();
    let (winner, loser) = match a_is_white {
        true => (&mut b, &mut a),
        false => (&mut a, &mut b),
    };
    send(loser, json!({"t":"resign","game_id":game_id})).await;
    wait_for(winner, "game_end").await;

    let opponent = match a_is_white {
        true => state["black"]["name"].as_str().expect("name"),
        false => state["white"]["name"].as_str().expect("name"),
    };
    for name in ["Anderssen", opponent] {
        let profile: Value = http
            .get(format!("{base}/api/users/{name}"))
            .send()
            .await
            .expect("get user")
            .json()
            .await
            .expect("json");
        let bullet = &profile["user"]["perfs"]["bullet"];
        assert_eq!(bullet["games"], 1, "{name}: {profile}");
        let rating = bullet["rating"].as_f64().expect("perf rating");
        assert!(
            (rating - 1500.0).abs() > 1.0,
            "{name} bullet rating {rating}"
        );
        assert!(profile["user"]["perfs"]["blitz"].is_null());
    }

    // the overall board must answer too (regression: param-count panic)
    let overall = http
        .get(format!("{base}/api/leaderboard?limit=10"))
        .send()
        .await
        .expect("overall leaderboard");
    assert_eq!(overall.status(), 200);

    let board: Value = http
        .get(format!("{base}/api/leaderboard?perf=bullet"))
        .send()
        .await
        .expect("leaderboard")
        .json()
        .await
        .expect("json");
    let board = board.as_array().expect("array");
    assert_eq!(board.len(), 1); // only the registered player
    assert_eq!(board[0]["name"], "Anderssen");
    assert!(board[0]["perfs"]["bullet"]["games"] == 1);
    // an unplayed perf ranks nobody
    let empty: Value = http
        .get(format!("{base}/api/leaderboard?perf=blitz"))
        .send()
        .await
        .expect("leaderboard")
        .json()
        .await
        .expect("json");
    assert!(empty.as_array().expect("array").is_empty());
}

/// A messages B: B's socket gets `pm`, the conversation lists A as unread,
/// and reading it returns the text and clears the unread count.
#[tokio::test]
async fn private_messages() {
    let server = start_server().await;
    let base = format!("http://127.0.0.1:{}", server.port);
    let http = reqwest::Client::new();

    let (mut a, a_sid) = connect_sid(server.port).await;
    let (mut b, b_sid) = connect_sid(server.port).await;
    let a_hello = wait_for(&mut a, "hello").await;
    let b_hello = wait_for(&mut b, "hello").await;
    let a_name = a_hello["me"]["name"].as_str().expect("name").to_string();
    let b_name = b_hello["me"]["name"].as_str().expect("name").to_string();

    let sent: Value = http
        .post(format!("{base}/api/messages/{b_name}"))
        .header("cookie", &a_sid)
        .json(&json!({"text": "good game"}))
        .send()
        .await
        .expect("post message")
        .json()
        .await
        .expect("json");
    assert_eq!(sent["text"], "good game");

    let pm = wait_for(&mut b, "pm").await;
    assert_eq!(pm["message"]["text"], "good game");
    assert_eq!(pm["from"]["name"], a_name.as_str());

    let convs: Value = http
        .get(format!("{base}/api/messages"))
        .header("cookie", &b_sid)
        .send()
        .await
        .expect("conversations")
        .json()
        .await
        .expect("json");
    let convs = convs.as_array().expect("array");
    assert_eq!(convs.len(), 1);
    assert_eq!(convs[0]["user"]["name"], a_name.as_str());
    assert_eq!(convs[0]["last"]["text"], "good game");
    assert_eq!(convs[0]["unread"], json!(1));

    let thread: Value = http
        .get(format!("{base}/api/messages/{a_name}"))
        .header("cookie", &b_sid)
        .send()
        .await
        .expect("conversation")
        .json()
        .await
        .expect("json");
    let thread = thread.as_array().expect("array");
    assert_eq!(thread.len(), 1);
    assert_eq!(thread[0]["text"], "good game");

    let convs: Value = http
        .get(format!("{base}/api/messages"))
        .header("cookie", &b_sid)
        .send()
        .await
        .expect("conversations")
        .json()
        .await
        .expect("json");
    assert_eq!(convs[0]["unread"], json!(0));

    // messaging yourself is refused; no session at all is a 401
    let res = http
        .post(format!("{base}/api/messages/{b_name}"))
        .header("cookie", &b_sid)
        .json(&json!({"text": "hi me"}))
        .send()
        .await
        .expect("self message");
    assert_eq!(res.status(), reqwest::StatusCode::BAD_REQUEST);
    let res = http
        .post(format!("{base}/api/messages/{b_name}"))
        .json(&json!({"text": "hi"}))
        .send()
        .await
        .expect("anon message");
    assert_eq!(res.status(), reqwest::StatusCode::UNAUTHORIZED);
}

/// Blocking cuts messages and direct challenges both ways — and must not wedge the server
/// (regression: a db guard held across a match once deadlocked the challenge path).
#[tokio::test]
async fn blocks_gate_contact() {
    let server = start_server().await;
    let base = format!("http://127.0.0.1:{}", server.port);
    let http = reqwest::Client::new();

    let (mut a, a_sid) = connect_sid(server.port).await;
    let (mut b, b_sid) = connect_sid(server.port).await;
    let a_name = wait_for(&mut a, "hello").await["me"]["name"]
        .as_str()
        .expect("name")
        .to_string();
    let b_name = wait_for(&mut b, "hello").await["me"]["name"]
        .as_str()
        .expect("name")
        .to_string();

    let res = http
        .post(format!("{base}/api/block/{b_name}"))
        .header("cookie", &a_sid)
        .send()
        .await
        .expect("block");
    assert_eq!(res.status(), 200);

    // b cannot message a
    let res = http
        .post(format!("{base}/api/messages/{a_name}"))
        .header("cookie", &b_sid)
        .json(&json!({"text": "hi"}))
        .send()
        .await
        .expect("post message");
    assert_eq!(res.status(), 403);

    // b cannot challenge a directly; a still gets served afterwards
    send(
        &mut b,
        json!({"t":"challenge","clock":{"initial_ms":60000,"increment_ms":0},"to": a_name}),
    )
    .await;
    let e = wait_for(&mut b, "error").await;
    assert_eq!(e["msg"], "no such player");
    let res = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        http.get(format!("{base}/api/me"))
            .header("cookie", &a_sid)
            .send(),
    )
    .await
    .expect("server responsive")
    .expect("me");
    assert_eq!(res.status(), 200);

    // unblock restores messaging
    http.delete(format!("{base}/api/block/{b_name}"))
        .header("cookie", &a_sid)
        .send()
        .await
        .expect("unblock");
    let res = http
        .post(format!("{base}/api/messages/{a_name}"))
        .header("cookie", &b_sid)
        .json(&json!({"text": "hi"}))
        .send()
        .await
        .expect("post message");
    assert_eq!(res.status(), 200);
}

/// Challenging the system user pairs immediately and the bot answers on its own.
#[tokio::test]
async fn play_the_bot() {
    let server = start_server().await;
    let base = format!("http://127.0.0.1:{}", server.port);
    let bot: Value = reqwest::get(format!("{base}/api/bot"))
        .await
        .expect("bot")
        .json()
        .await
        .expect("json");
    assert_eq!(bot["name"], "Rubrik");

    let mut a = connect(server.port).await;
    let a_id = hello_id(&mut a).await;
    send(
        &mut a,
        json!({"t":"challenge","clock":{"initial_ms":60000,"increment_ms":0},
               "to":"Rubrik","color":"white"}),
    )
    .await;
    let game_id = wait_for(&mut a, "game_start").await["game_id"]
        .as_str()
        .expect("game id")
        .to_string();

    send(&mut a, json!({"t":"watch","game_id":game_id})).await;
    let state = wait_for(&mut a, "game_state").await;
    assert_eq!(state["white"]["id"], a_id.as_str());
    assert_eq!(state["black"]["name"], "Rubrik");

    let game = rubrik_core::Game::new(rubrik_core::GameConfig::default());
    let mv = game.legal_moves(9).first().expect("legal move").clone();
    send(&mut a, json!({"t":"move","game_id":game_id,"move":mv})).await;
    assert_eq!(wait_for(&mut a, "move").await["ply"], 1);
    // the bot replies by itself
    let reply = wait_for_within(&mut a, "move", 3).await;
    assert_eq!(reply["ply"], 2);
    assert_eq!(reply["turn"], "white");

    // it declines draw offers instantly
    send(&mut a, json!({"t":"draw","game_id":game_id,"offer":true})).await;
    let offer = wait_for(&mut a, "draw_offer").await;
    assert!(offer["by"].is_null(), "draw offer {offer}");
}
