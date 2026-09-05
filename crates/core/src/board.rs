use crate::geom::*;
use serde::{Deserialize, Serialize};

pub type CellId = u16;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Color {
    White,
    Black,
}

impl Color {
    pub fn other(self) -> Color {
        match self {
            Color::White => Color::Black,
            Color::Black => Color::White,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PieceKind {
    Pawn,
    Knight,
    Bishop,
    Rook,
    Queen,
    King,
    Captain,
    Tesseract,
    Princess,
    Prince,
    Cannon,
}

impl PieceKind {
    pub fn from_char(c: char) -> Option<PieceKind> {
        Some(match c.to_ascii_lowercase() {
            'p' => PieceKind::Pawn,
            'n' => PieceKind::Knight,
            'b' => PieceKind::Bishop,
            'r' => PieceKind::Rook,
            'q' => PieceKind::Queen,
            'k' => PieceKind::King,
            'c' => PieceKind::Captain,
            't' => PieceKind::Tesseract,
            's' => PieceKind::Princess,
            'x' => PieceKind::Prince,
            'o' => PieceKind::Cannon,
            _ => return None,
        })
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct Piece {
    pub kind: PieceKind,
    pub color: Color,
    /// Stable identity (origin cell id). Used by clients for animation keys.
    pub id: CellId,
}

#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct Cell {
    pub pos: V3,
    pub side: V3,
    /// Palette index, fixed per cell for its lifetime (moves with rotations).
    pub color: u8,
    pub piece: Option<Piece>,
}

/// Face colour layouts, palette indices: 0 white, 1 black, 2 red, 3 blue, 4 yellow, 5 green.
pub const LAYOUT_STANDARD: [u8; 6] = [0, 0, 1, 1, 0, 1];

/// Six distinct face colours: same-colour rules (Prince/Princess/Captain) bite harder.
pub const LAYOUT_RUBRIK: [u8; 6] = [0, 1, 2, 3, 4, 5];

pub const SETUP_STANDARD: &str = "
--------
-NPPPPN-
-PTRBTP-
-PCKSOP-
-POXQCP-
-PTBRTP-
-NPPPPN-
--------

--------
-nppppn-
-ptrbtp-
-pcksop-
-poxqcp-
-ptbrtp-
-nppppn-
--------
";

#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct Board {
    pub cells: Vec<Cell>,
    /// pos slot -> cell id. Serialized so deserialized boards stay usable.
    pos_index: Vec<CellId>,
}

/// Maps a valid cell position to a dense slot in 0..N_CELLS.
fn pos_slot(p: V3) -> Option<usize> {
    let mut axis = None;
    for i in 0..3 {
        if p.comp(i).abs() == HALF {
            if axis.is_some() {
                return None;
            }
            axis = Some(i);
        }
    }
    let a = axis?;
    let face = a * 2 + (p.comp(a) < 0) as usize;
    let mut ij = [0usize; 2];
    let mut k = 0;
    for i in 0..3 {
        if i == a {
            continue;
        }
        let c = p.comp(i);
        if (c + HALF - C_S / 2) % C_S != 0 || c.abs() > HALF - C_S / 2 {
            return None;
        }
        ij[k] = ((c + HALF - C_S / 2) / C_S) as usize;
        k += 1;
    }
    Some((face * B_D as usize + ij[0]) * B_D as usize + ij[1])
}

impl Board {
    pub fn new(layout: [u8; 6]) -> Board {
        let mut cells = Vec::with_capacity(N_CELLS);
        for (c, side) in SIDES.iter().enumerate() {
            let n = side.axis_index();
            let (a, b) = match n {
                0 => (1, 2),
                1 => (0, 2),
                _ => (0, 1),
            };
            for i in 0..B_D {
                for j in 0..B_D {
                    let pos = side
                        .scale(HALF)
                        .set_comp(a, i * C_S - HALF + C_S / 2)
                        .set_comp(b, j * C_S - HALF + C_S / 2);
                    cells.push(Cell {
                        pos,
                        side: *side,
                        color: layout[c],
                        piece: None,
                    });
                }
            }
        }
        let mut b = Board {
            cells,
            pos_index: vec![0; N_CELLS],
        };
        b.reindex();
        b
    }

    pub fn reindex(&mut self) {
        if self.pos_index.len() != N_CELLS {
            self.pos_index = vec![0; N_CELLS];
        }
        for (id, cell) in self.cells.iter().enumerate() {
            self.pos_index[pos_slot(cell.pos).expect("cell off grid")] = id as CellId;
        }
    }

    /// Place pieces from a setup string: 8 rows for face 0 (white, +Y) then 8
    /// rows for face 3 (black, -Y). Uppercase = white, `-` = empty.
    pub fn setup(&mut self, setup: &str) {
        let rows: Vec<&str> = setup.split_whitespace().collect();
        for cell in &mut self.cells {
            cell.piece = None;
        }
        for (face, row_off) in [(0usize, 0usize), (3, B_D as usize)] {
            for i in 0..B_D as usize {
                let row = rows.get(row_off + i).copied().unwrap_or("");
                for (j, ch) in row.chars().take(B_D as usize).enumerate() {
                    if let Some(kind) = PieceKind::from_char(ch) {
                        let id = (face * 64 + i * 8 + j) as CellId;
                        self.cells[id as usize].piece = Some(Piece {
                            kind,
                            color: if ch.is_ascii_uppercase() {
                                Color::White
                            } else {
                                Color::Black
                            },
                            id,
                        });
                    }
                }
            }
        }
    }

    pub fn cell(&self, id: CellId) -> &Cell {
        &self.cells[id as usize]
    }

    pub fn at(&self, pos: V3) -> Option<CellId> {
        pos_slot(pos).map(|s| self.pos_index[s])
    }

    /// Cells (and thus pieces) affected by a slice rotation through `pivot`.
    pub fn rotating_cells(&self, pivot: V3, axis: Axis) -> Vec<CellId> {
        let adot = pivot.dot(axis.unit());
        self.cells
            .iter()
            .enumerate()
            .filter(|(_, c)| {
                let d = c.pos.dot(axis.unit());
                d == adot || (d - adot).abs() == C_S / 2
            })
            .map(|(i, _)| i as CellId)
            .collect()
    }

    pub fn rotate(&mut self, pivot: V3, axis: Axis, sign: i8) {
        for id in self.rotating_cells(pivot, axis) {
            let c = &mut self.cells[id as usize];
            c.pos = c.pos.rot90(axis, sign);
            c.side = c.side.rot90(axis, sign);
        }
        self.reindex();
    }

    pub fn is_edge(&self, id: CellId) -> bool {
        self.edge_count(id) == 1
    }
    pub fn is_corner(&self, id: CellId) -> bool {
        self.edge_count(id) == 2
    }
    fn edge_count(&self, id: CellId) -> usize {
        let c = self.cell(id);
        let t = c.pos.drop_axis(c.side);
        [t.x, t.y, t.z]
            .iter()
            .filter(|v| v.abs() == HALF - C_S / 2)
            .count()
    }
    /// Centre of the cuboid directly under the cell.
    pub fn center_under(&self, id: CellId) -> V3 {
        let c = self.cell(id);
        c.pos.sub(c.side.scale(C_S / 2))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_cells_indexed_uniquely() {
        let b = Board::new(LAYOUT_STANDARD);
        assert_eq!(b.cells.len(), N_CELLS);
        let mut seen = vec![false; N_CELLS];
        for (id, c) in b.cells.iter().enumerate() {
            assert_eq!(b.at(c.pos), Some(id as CellId));
            let s = pos_slot(c.pos).unwrap();
            assert!(!seen[s]);
            seen[s] = true;
        }
    }

    #[test]
    fn setup_places_pieces() {
        let mut b = Board::new(LAYOUT_STANDARD);
        b.setup(SETUP_STANDARD);
        let white = b
            .cells
            .iter()
            .filter(|c| matches!(c.piece, Some(p) if p.color == Color::White))
            .count();
        let black = b
            .cells
            .iter()
            .filter(|c| matches!(c.piece, Some(p) if p.color == Color::Black))
            .count();
        assert_eq!(white, 36);
        assert_eq!(black, 36);
        assert_eq!(b.cell(27).piece.unwrap().kind, PieceKind::King);
    }

    #[test]
    fn rotation_keeps_index_consistent() {
        let mut b = Board::new(LAYOUT_STANDARD);
        let pivot = b.cell(0).pos;
        b.rotate(pivot, Axis::Y, 1);
        for (id, c) in b.cells.iter().enumerate() {
            assert_eq!(b.at(c.pos), Some(id as CellId));
        }
        b.rotate(pivot, Axis::Y, -1);
        assert_eq!(b, Board::new(LAYOUT_STANDARD));
    }
}
