//! End-to-end: two clients, seek → accept → game_start → white moves → black sees it.

use std::process::{Child, Command};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpStream;
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

async fn start_server() -> Server {
    let port = {
        let l = std::net::TcpListener::bind("127.0.0.1:0").expect("free port");
        l.local_addr().expect("addr").port()
    };
    let dir = std::env::temp_dir().join(format!("rubrik-test-{port}"));
    std::fs::create_dir_all(&dir).expect("tmp dir");
    let child = Command::new(env!("CARGO_BIN_EXE_rubrik-server"))
        .env("PORT", port.to_string())
        .env("DATABASE_PATH", dir.join("test.db"))
        .env("WEB_DIST", dir.join("dist"))
        .spawn()
        .expect("spawn server");
    for _ in 0..100 {
        if TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Server {
        child,
        port,
        _dir: dir,
    }
}

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

async fn connect(port: u16) -> Ws {
    let (ws, _) = tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{port}/ws"))
        .await
        .expect("ws connect");
    ws
}

async fn send(ws: &mut Ws, v: Value) {
    ws.send(Message::text(v.to_string())).await.expect("send");
}

/// Read messages until one has `t == want`, panicking on timeout.
async fn wait_for(ws: &mut Ws, want: &str) -> Value {
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
    tokio::time::timeout(Duration::from_secs(5), fut)
        .await
        .unwrap_or_else(|_| panic!("timeout waiting for {want}"))
}

/// Two fresh clients that seek/accept into a game: (a, b, a's id, game id).
async fn seek_accept(port: u16) -> (Ws, Ws, String, String) {
    let mut a = connect(port).await;
    let mut b = connect(port).await;

    let a_id = wait_for(&mut a, "hello").await["me"]["id"]
        .as_str()
        .expect("id")
        .to_string();
    wait_for(&mut b, "hello").await;

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
