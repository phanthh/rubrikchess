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

#[tokio::test]
async fn seek_accept_move() {
    let server = start_server().await;
    let mut a = connect(server.port).await;
    let mut b = connect(server.port).await;

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
}
