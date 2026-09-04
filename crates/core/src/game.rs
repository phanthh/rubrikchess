use crate::board::*;
use crate::geom::*;
use crate::movegen::*;
use serde::{Deserialize, Serialize};

#[derive(Copy, Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Status {
    Playing,
    Won { winner: Color, reason: EndReason },
    Draw { reason: EndReason },
}

#[derive(Copy, Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EndReason {
    KingCaptured,
    Resign,
    Timeout,
    Agreement,
    Abandoned,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PlayError {
    #[error("game is over")]
    GameOver,
    #[error("no piece on source cell")]
    NoPiece,
    #[error("not your turn")]
    WrongTurn,
    #[error("illegal move")]
    Illegal,
}

#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct GameConfig {
    pub layout: [u8; 6],
    pub setup: String,
    pub rules: Rules,
}

impl Default for GameConfig {
    fn default() -> Self {
        GameConfig {
            layout: LAYOUT_STANDARD,
            setup: SETUP_STANDARD.to_string(),
            rules: Rules::default(),
        }
    }
}

#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct Game {
    pub config: GameConfig,
    pub board: Board,
    pub turn: Color,
    pub status: Status,
    pub history: Vec<Move>,
}

impl Game {
    pub fn new(config: GameConfig) -> Game {
        let mut board = Board::new(config.layout);
        board.setup(&config.setup);
        Game {
            config,
            board,
            turn: Color::White,
            status: Status::Playing,
            history: Vec::new(),
        }
    }

    /// Rebuild from a config and move list, validating every move.
    pub fn replay(config: GameConfig, moves: &[Move]) -> Result<Game, PlayError> {
        let mut g = Game::new(config);
        for m in moves {
            g.play(m.clone())?;
        }
        Ok(g)
    }

    pub fn legal_moves(&self, from: CellId) -> Vec<Move> {
        match self.board.cell(from).piece {
            Some(p) if p.color == self.turn && self.status == Status::Playing => {
                moves_for(&self.board, self.config.rules, from)
            }
            _ => vec![],
        }
    }

    /// Moves for every piece regardless of turn (for threat highlighting).
    pub fn all_moves(&self) -> Vec<(CellId, Vec<Move>)> {
        all_moves(&self.board, self.config.rules)
    }

    pub fn play(&mut self, mv: Move) -> Result<(), PlayError> {
        if self.status != Status::Playing {
            return Err(PlayError::GameOver);
        }
        let from = mv.from();
        let piece = self.board.cell(from).piece.ok_or(PlayError::NoPiece)?;
        if piece.color != self.turn {
            return Err(PlayError::WrongTurn);
        }
        let candidates = moves_for(&self.board, self.config.rules, from);
        // Accept a Step if same destination (client may omit/alter path).
        let matched = candidates
            .into_iter()
            .find(|c| match (&c, &mv) {
                (Move::Step { .. }, Move::Step { .. }) => c.to() == mv.to(),
                (
                    Move::Rotate {
                        axis: a1, sign: s1, ..
                    },
                    Move::Rotate {
                        axis: a2, sign: s2, ..
                    },
                ) => a1 == a2 && s1 == s2,
                _ => false,
            })
            .ok_or(PlayError::Illegal)?;

        match &matched {
            Move::Step { path, .. } => {
                let to = *path.last().unwrap();
                let captured = self.board.cells[to as usize].piece.take();
                self.board.cells[to as usize].piece = Some(piece);
                self.board.cells[from as usize].piece = None;
                if let Some(c) = captured {
                    if c.kind == PieceKind::King {
                        self.status = Status::Won {
                            winner: self.turn,
                            reason: EndReason::KingCaptured,
                        };
                    }
                }
            }
            Move::Rotate { axis, sign, .. } => {
                let pivot = self.board.cell(from).pos;
                self.board.rotate(pivot, *axis, *sign);
            }
        }
        self.history.push(matched);
        self.turn = self.turn.other();
        Ok(())
    }

    /// Undo last move by replaying history. ponytail: O(n) replay, fine at 384 cells.
    pub fn undo(&mut self) {
        let mut hist = std::mem::take(&mut self.history);
        hist.pop();
        *self = Game::replay(self.config.clone(), &hist).expect("history was valid");
    }

    pub fn end(&mut self, status: Status) {
        self.status = status;
    }

    /// Cells whose piece is a king/prince currently attacked by an enemy piece,
    /// with the attacking paths (for UI highlighting).
    pub fn threats(&self) -> Vec<(CellId, Vec<CellId>)> {
        let mut out = Vec::new();
        for (_, moves) in self.all_moves() {
            for m in moves {
                if let Move::Step {
                    path,
                    capture: true,
                    ..
                } = m
                {
                    let to = *path.last().unwrap();
                    if matches!(
                        self.board.cell(to).piece,
                        Some(Piece {
                            kind: PieceKind::King | PieceKind::Prince,
                            ..
                        })
                    ) {
                        out.push((to, path));
                    }
                }
            }
        }
        out
    }

    pub fn rotating_cells(&self, from: CellId, axis: Axis) -> Vec<CellId> {
        self.board.rotating_cells(self.board.cell(from).pos, axis)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn play_validates_turn_and_legality() {
        let mut g = Game::new(GameConfig::default());
        // black piece first → wrong turn
        let black_pawn = 3 * 64 + 8 + 1;
        let m = g
            .all_moves()
            .into_iter()
            .find(|(id, _)| *id == black_pawn)
            .unwrap()
            .1[0]
            .clone();
        assert_eq!(g.play(m), Err(PlayError::WrongTurn));
        // white pawn at (0,1,1)
        let from = 9;
        let legal = g.legal_moves(from);
        assert!(!legal.is_empty());
        let bogus = Move::Step {
            from,
            path: vec![200],
            capture: false,
        };
        assert_eq!(g.play(bogus), Err(PlayError::Illegal));
        g.play(legal[0].clone()).unwrap();
        assert_eq!(g.turn, Color::Black);
        assert_eq!(g.history.len(), 1);
        let before = g.clone();
        let bm = g.legal_moves(black_pawn)[0].clone();
        g.play(bm).unwrap();
        g.undo();
        assert_eq!(g, before);
    }

    #[test]
    fn king_capture_ends_game() {
        let mut g = Game::new(GameConfig::default());
        g.board.cells.iter_mut().for_each(|c| c.piece = None);
        g.board.cells[27].piece = Some(Piece {
            kind: PieceKind::Rook,
            color: Color::White,
            id: 27,
        });
        g.board.cells[29].piece = Some(Piece {
            kind: PieceKind::King,
            color: Color::Black,
            id: 29,
        });
        let m = g
            .legal_moves(27)
            .into_iter()
            .find(|m| m.to() == Some(29))
            .unwrap();
        g.play(m).unwrap();
        assert_eq!(
            g.status,
            Status::Won {
                winner: Color::White,
                reason: EndReason::KingCaptured
            }
        );
        assert_eq!(
            g.play(Move::Rotate {
                from: 29,
                axis: Axis::X,
                sign: 1
            }),
            Err(PlayError::GameOver)
        );
    }

    #[test]
    fn tesseract_rotation_moves_pieces_and_replays() {
        let mut g = Game::new(GameConfig::default());
        let t = 2 * 8 + 2; // (0,2,2) white tesseract
        assert_eq!(g.board.cell(t).piece.unwrap().kind, PieceKind::Tesseract);
        g.play(Move::Rotate {
            from: t,
            axis: Axis::Y,
            sign: 1,
        })
        .unwrap();
        // Tesseract's cell rotated; piece still on same cell id but new pos.
        assert_eq!(g.board.cell(t).piece.unwrap().kind, PieceKind::Tesseract);
        let replayed = Game::replay(g.config.clone(), &g.history).unwrap();
        assert_eq!(replayed, g);
        let json = serde_json::to_string(&g).unwrap();
        let back: Game = serde_json::from_str(&json).unwrap();
        assert_eq!(back.board.cells, g.board.cells);
    }
}
