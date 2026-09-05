use rubrik_core::*;
use serde::Serialize;
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

fn js<T: Serialize>(v: &T) -> Result<JsValue, JsValue> {
    to_value(v).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub struct WasmGame(Game);

#[wasm_bindgen]
impl WasmGame {
    /// `config`: optional GameConfig JSON value (defaults to standard).
    #[wasm_bindgen(constructor)]
    pub fn new(config: JsValue) -> Result<WasmGame, JsValue> {
        let config = if config.is_undefined() || config.is_null() {
            GameConfig::default()
        } else {
            from_value(config).map_err(|e| JsValue::from_str(&e.to_string()))?
        };
        Ok(WasmGame(Game::new(config)))
    }

    /// Rebuild from full Game JSON (as produced by `state()` / server).
    #[wasm_bindgen(js_name = fromState)]
    pub fn from_state(state: JsValue) -> Result<WasmGame, JsValue> {
        let g: Game = from_value(state).map_err(|e| JsValue::from_str(&e.to_string()))?;
        Ok(WasmGame(g))
    }

    /// Rebuild from config + move list, validating.
    pub fn replay(config: JsValue, moves: JsValue) -> Result<WasmGame, JsValue> {
        let config: GameConfig =
            from_value(config).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let moves: Vec<Move> = from_value(moves).map_err(|e| JsValue::from_str(&e.to_string()))?;
        Game::replay(config, &moves)
            .map(WasmGame)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn state(&self) -> Result<JsValue, JsValue> {
        js(&self.0)
    }

    #[wasm_bindgen(js_name = legalMoves)]
    pub fn legal_moves(&self, from: u16) -> Result<JsValue, JsValue> {
        js(&self.0.legal_moves(from))
    }

    /// Attacked king/prince cells with attack paths → [[cellId, path[]], ...]
    pub fn threats(&self) -> Result<JsValue, JsValue> {
        js(&self.0.threats())
    }

    #[wasm_bindgen(js_name = rotatingCells)]
    pub fn rotating_cells(&self, from: u16, axis: JsValue) -> Result<JsValue, JsValue> {
        let axis: Axis = from_value(axis).map_err(|e| JsValue::from_str(&e.to_string()))?;
        js(&self.0.rotating_cells(from, axis))
    }

    pub fn play(&mut self, mv: JsValue) -> Result<(), JsValue> {
        let mv: Move = from_value(mv).map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.0
            .play(mv)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn undo(&mut self) {
        self.0.undo()
    }

    /// Computer move for the side to move; `level` 1..=4. Null when the game is over.
    #[wasm_bindgen(js_name = bestMove)]
    pub fn best_move(&self, level: u8, seed: u32) -> Result<JsValue, JsValue> {
        js(&best_move(&self.0, level, seed as u64))
    }

    /// `{move, score}` for the side to move (score in centipawns, ±100000 = king capture). Null when over.
    pub fn analyse(&self, level: u8, seed: u32) -> Result<JsValue, JsValue> {
        #[derive(Serialize)]
        struct Analysis {
            #[serde(rename = "move")]
            mv: Move,
            score: i32,
        }
        js(&analyse(&self.0, level, seed as u64).map(|(mv, score)| Analysis { mv, score }))
    }

    /// "white" | "black"
    pub fn turn(&self) -> String {
        match self.0.turn {
            Color::White => "white".into(),
            Color::Black => "black".into(),
        }
    }

    #[wasm_bindgen(js_name = historyLen)]
    pub fn history_len(&self) -> usize {
        self.0.history.len()
    }
}
