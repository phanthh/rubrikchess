use crate::board::*;
use crate::geom::*;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Move {
    /// Move piece at `from` along `path` (cell ids, last = destination).
    Step {
        from: CellId,
        path: Vec<CellId>,
        capture: bool,
    },
    /// Tesseract at `from` rotates its slice `sign`*90° about `axis`.
    Rotate { from: CellId, axis: Axis, sign: i8 },
}

impl Move {
    pub fn from(&self) -> CellId {
        match self {
            Move::Step { from, .. } | Move::Rotate { from, .. } => *from,
        }
    }
    pub fn to(&self) -> Option<CellId> {
        match self {
            Move::Step { path, .. } => path.last().copied(),
            Move::Rotate { .. } => None,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub struct Rules {
    /// No movement across cube edges.
    pub walled: bool,
}

const MAX_ITER: usize = N_CELLS;

/// Outcome of probing a target cell for `mover`.
enum Probe {
    Blocked,
    Empty,
    Enemy,
}

fn probe(mover: Color, target: &Cell) -> Probe {
    match target.piece {
        None => Probe::Empty,
        Some(p) if p.color != mover => Probe::Enemy,
        Some(_) => Probe::Blocked,
    }
}

struct Gen<'a> {
    board: &'a Board,
    rules: Rules,
    from: CellId,
    piece: Piece,
    cell: &'a Cell,
    moves: Vec<Move>,
}

impl<'a> Gen<'a> {
    fn push(&mut self, path: Vec<CellId>, capture: bool) {
        self.moves.push(Move::Step {
            from: self.from,
            path,
            capture,
        });
    }

    /// Single-target probe honouring `same_color` (target face colour must
    /// match) and `can_capture`. Returns whether a move was added.
    fn try_target(&mut self, id: CellId, same_color: bool, can_capture: bool) -> bool {
        let t = self.board.cell(id);
        if same_color && t.color != self.cell.color {
            return false;
        }
        match probe(self.piece.color, t) {
            Probe::Empty => self.push(vec![id], false),
            Probe::Enemy if can_capture => self.push(vec![id], true),
            _ => return false,
        }
        true
    }

    /// Sliding walk from own cell along `dir`, climbing edges unless walled.
    /// `bishop` = diagonal step (dir has two non-zero comps).
    fn walk(&mut self, dir0: V3, bishop: bool, same_color: bool) {
        let start = self.cell.pos;
        let mut dir = dir0;
        let mut side = self.cell.side;
        let mut cursor = start.add(dir.scale(C_S));
        let mut path: Vec<CellId> = Vec::new();

        for _ in 0..MAX_ITER {
            if let Some(id) = self.board.at(cursor) {
                let t = self.board.cell(id);
                path.push(id);
                if same_color && t.color != self.cell.color {
                    break;
                }
                match probe(self.piece.color, t) {
                    Probe::Blocked => break,
                    Probe::Enemy => {
                        self.push(path.clone(), true);
                        break;
                    }
                    Probe::Empty => self.push(path.clone(), false),
                }
                side = t.side;
                cursor = cursor.add(dir.scale(C_S));
            } else if self.rules.walled {
                break;
            } else if bishop {
                let clamped = cursor.clamp_cube();
                let over = cursor.sub(clamped);
                // Diagonally off a corner: no cell to land on.
                if over.len_sq() != (C_S / 2) * (C_S / 2) {
                    break;
                }
                dir = dir.drop_axis(over).sub(side);
                cursor = clamped.sub(side.scale(C_S / 2));
            } else {
                let new_dir = side.neg();
                cursor = cursor.sub(dir.scale(C_S / 2)).add(new_dir.scale(C_S / 2));
                dir = new_dir;
            }
            if cursor == start {
                break;
            }
        }
    }

    fn slide(&mut self, rook: bool, bishop: bool, same_color: bool) {
        let dirs = tangent_dirs(self.cell.side);
        if rook {
            for d in &dirs[..4] {
                self.walk(*d, false, same_color);
            }
        }
        if bishop {
            for d in &dirs[4..] {
                self.walk(*d, true, same_color);
            }
        }
    }

    /// King neighbourhood: 8 cells on face, plus across edges unless walled.
    fn king_targets(&self) -> Vec<CellId> {
        let p = self.cell.pos;
        let walled = self.rules.walled;
        (0..N_CELLS as CellId)
            .filter(|&id| {
                let d = self.board.cell(id).pos.dist_sq(p);
                d == 16 || d == 32 || (!walled && (d == 8 || d == 24))
            })
            .collect()
    }

    fn king_like(&mut self, same_color: bool, can_capture: bool) {
        for id in self.king_targets() {
            self.try_target(id, same_color, can_capture);
        }
    }

    fn knight(&mut self) {
        let p = self.cell.pos;
        let center = self.board.center_under(self.from);
        let from_corner = self.board.is_corner(self.from);
        for id in 0..N_CELLS as CellId {
            let t = self.board.cell(id);
            let d = t.pos.dist_sq(p);
            let reachable = d == 80
                || d == 56
                || (d == 72
                    && (self.board.is_edge(id) || self.board.is_corner(id))
                    && t.pos.dist_sq(center) != 52)
                || (d == 40 && (from_corner || self.board.is_corner(id)));
            if reachable && (!self.rules.walled || t.side.dot(self.cell.side) != 0) {
                self.try_target(id, false, true);
            }
        }
    }

    fn orth_neighbors(&self, id: CellId) -> Vec<CellId> {
        let c = self.board.cell(id);
        tangent_dirs(c.side)[..4]
            .iter()
            .filter_map(|d| {
                let mut cand = c.pos.add(d.scale(C_S));
                let clamped = cand.clamp_cube();
                if clamped != cand {
                    if self.rules.walled {
                        return None;
                    }
                    cand = clamped.sub(c.side.scale(C_S / 2));
                }
                self.board.at(cand)
            })
            .collect()
    }

    /// BFS over empty same-colour cells; each reached cell = one move with shortest path.
    fn captain_flood(&mut self) {
        let mut parent = vec![CellId::MAX; N_CELLS];
        let mut visited = vec![false; N_CELLS];
        let mut order: Vec<CellId> = Vec::new();
        let mut q = VecDeque::new();
        visited[self.from as usize] = true;
        q.push_back(self.from);
        while let Some(cur) = q.pop_front() {
            for n in self.orth_neighbors(cur) {
                if visited[n as usize] {
                    continue;
                }
                let t = self.board.cell(n);
                if t.color != self.cell.color || t.piece.is_some() {
                    continue;
                }
                visited[n as usize] = true;
                parent[n as usize] = cur;
                order.push(n);
                q.push_back(n);
            }
        }
        for id in order {
            let mut path = vec![id];
            let mut cur = parent[id as usize];
            while cur != self.from {
                path.push(cur);
                cur = parent[cur as usize];
            }
            path.reverse();
            self.push(path, false);
        }
    }

    fn cannon(&mut self) {
        for sign in [1i8, -1] {
            for axis in Axis::ALL {
                if axis.unit().dot(self.cell.side) != 0 {
                    continue;
                }
                let target = self
                    .board
                    .at(self.cell.pos.rot90(axis, sign))
                    .expect("rotated cell");
                self.try_target(target, false, true);
            }
        }
        self.king_like(false, false);
    }

    fn pawn(&mut self) {
        let p = self.cell.pos;
        let walled = self.rules.walled;
        for id in 0..N_CELLS as CellId {
            let t = self.board.cell(id);
            let d = t.pos.dist_sq(p);
            if d == 16 || (!walled && d == 8) {
                if t.piece.is_none() {
                    self.push(vec![id], false);
                }
            } else if (d == 32 || (!walled && d == 24))
                && matches!(probe(self.piece.color, t), Probe::Enemy)
            {
                self.push(vec![id], true);
            }
        }
    }

    fn run(mut self) -> Vec<Move> {
        match self.piece.kind {
            PieceKind::Rook => self.slide(true, false, false),
            PieceKind::Bishop => self.slide(false, true, false),
            PieceKind::Queen => self.slide(true, true, false),
            PieceKind::Princess => self.slide(true, true, true),
            PieceKind::King => self.king_like(false, true),
            PieceKind::Prince => self.king_like(true, true),
            PieceKind::Knight => self.knight(),
            PieceKind::Pawn => self.pawn(),
            PieceKind::Cannon => self.cannon(),
            PieceKind::Captain => {
                self.captain_flood();
                self.king_like(false, true);
            }
            PieceKind::Tesseract => {
                self.king_like(false, true);
                for sign in [1i8, -1] {
                    for axis in Axis::ALL {
                        self.moves.push(Move::Rotate {
                            from: self.from,
                            axis,
                            sign,
                        });
                    }
                }
            }
        }
        self.moves
    }
}

/// Pseudo-legal moves for the piece on `from` (empty if no piece).
pub fn moves_for(board: &Board, rules: Rules, from: CellId) -> Vec<Move> {
    let cell = board.cell(from);
    let Some(piece) = cell.piece else {
        return vec![];
    };
    Gen {
        board,
        rules,
        from,
        piece,
        cell,
        moves: Vec::new(),
    }
    .run()
}

/// Moves for every piece on the board, keyed by origin cell.
pub fn all_moves(board: &Board, rules: Rules) -> Vec<(CellId, Vec<Move>)> {
    (0..N_CELLS as CellId)
        .filter(|&id| board.cell(id).piece.is_some())
        .map(|id| (id, moves_for(board, rules, id)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty_with(kind: PieceKind, color: Color, id: CellId) -> Board {
        let mut b = Board::new(LAYOUT_STANDARD);
        b.cells[id as usize].piece = Some(Piece { kind, color, id });
        b
    }

    fn targets(moves: &[Move]) -> Vec<CellId> {
        let mut t: Vec<CellId> = moves.iter().filter_map(|m| m.to()).collect();
        t.sort();
        t.dedup();
        t
    }

    #[test]
    fn rook_on_empty_cube_loops_around() {
        // face 0 (+Y), cell (0,3,3). Rook orthogonal in 4 dirs; each dir wraps
        // around 4 faces = 31 other cells, 4 dirs → 4*31 but cells overlap? No:
        // the 4 rings share only the start cell.
        let b = empty_with(PieceKind::Rook, Color::White, 3 * 8 + 3);
        let m = moves_for(&b, Rules::default(), 27);
        assert_eq!(m.len(), 4 * 31);
        assert!(m
            .iter()
            .all(|m| matches!(m, Move::Step { capture: false, .. })));
    }

    #[test]
    fn rook_walled_stays_on_face() {
        let b = empty_with(PieceKind::Rook, Color::White, 27);
        let m = moves_for(&b, Rules { walled: true }, 27);
        assert_eq!(m.len(), 14);
    }

    #[test]
    fn bishop_walled_on_face() {
        let b = empty_with(PieceKind::Bishop, Color::White, 27);
        let m = moves_for(&b, Rules { walled: true }, 27);
        assert_eq!(m.len(), 13); // (3,3): 3+4+3+3
    }

    #[test]
    fn bishop_climbs_edge() {
        // corner cell (0,0,0): diagonals toward (1,1) on face; the other three
        // diagonals go off corner or edge.
        let b = empty_with(PieceKind::Bishop, Color::White, 0);
        let m = moves_for(&b, Rules::default(), 0);
        assert!(m.len() > 7, "expected edge climbing, got {}", m.len());
        // every path cell adjacent to previous (dist 16/32 on face or 8/24 across edge)
        for mv in &m {
            if let Move::Step { path, .. } = mv {
                let mut prev = 0;
                for &id in path {
                    let d = b.cell(prev).pos.dist_sq(b.cell(id).pos);
                    assert!(
                        [24, 32].contains(&d),
                        "bad diag step {} from {} to {}",
                        d,
                        prev,
                        id
                    );
                    prev = id;
                }
            }
        }
    }

    #[test]
    fn king_center_and_edge_counts() {
        let b = empty_with(PieceKind::King, Color::White, 27);
        assert_eq!(moves_for(&b, Rules::default(), 27).len(), 8);
        let b = empty_with(PieceKind::King, Color::White, 0); // corner
        assert_eq!(moves_for(&b, Rules { walled: true }, 0).len(), 3);
        let m = moves_for(&b, Rules::default(), 0);
        // corner: 3 on face + 2 orth across edge + diag across each edge (2)
        assert_eq!(m.len(), 7, "{:?}", targets(&m));
    }

    #[test]
    fn pawn_moves_and_captures() {
        let mut b = empty_with(PieceKind::Pawn, Color::White, 27);
        b.cells[36].piece = Some(Piece {
            kind: PieceKind::Pawn,
            color: Color::Black,
            id: 36,
        }); // (4,4) diag
        b.cells[28].piece = Some(Piece {
            kind: PieceKind::Pawn,
            color: Color::Black,
            id: 28,
        }); // (3,4) orth
        let m = moves_for(&b, Rules::default(), 27);
        let caps: Vec<_> = m
            .iter()
            .filter(|m| matches!(m, Move::Step { capture: true, .. }))
            .collect();
        assert_eq!(caps.len(), 1);
        assert_eq!(caps[0].to(), Some(36));
        assert_eq!(m.len(), 1 + 3); // 4 orth, one blocked
    }

    #[test]
    fn knight_on_face_center() {
        let b = empty_with(PieceKind::Knight, Color::White, 27);
        let m = moves_for(&b, Rules { walled: true }, 27);
        assert_eq!(m.len(), 8);
    }

    #[test]
    fn tesseract_has_six_rotations() {
        let b = empty_with(PieceKind::Tesseract, Color::White, 27);
        let m = moves_for(&b, Rules::default(), 27);
        assert_eq!(
            m.iter()
                .filter(|m| matches!(m, Move::Rotate { .. }))
                .count(),
            6
        );
    }

    #[test]
    fn cannon_shoots_across_edges() {
        let mut b = empty_with(PieceKind::Cannon, Color::White, 27);
        let target = b.at(b.cell(27).pos.rot90(Axis::X, 1)).unwrap();
        b.cells[target as usize].piece = Some(Piece {
            kind: PieceKind::King,
            color: Color::Black,
            id: target,
        });
        let m = moves_for(&b, Rules::default(), 27);
        let caps: Vec<_> = m
            .iter()
            .filter(|m| matches!(m, Move::Step { capture: true, .. }))
            .collect();
        assert_eq!(caps.len(), 1);
        assert_eq!(caps[0].to(), Some(target));
    }

    #[test]
    fn captain_floods_same_color() {
        let b = empty_with(PieceKind::Captain, Color::White, 27);
        let m = moves_for(&b, Rules::default(), 27);
        // standard layout: faces 0,1,4 white = 3*64-1 reachable via flood, plus king moves overlap
        let t = targets(&m);
        assert_eq!(t.len(), 3 * 64 - 1);
    }

    #[test]
    fn standard_position_all_moves_nonempty() {
        let mut b = Board::new(LAYOUT_STANDARD);
        b.setup(SETUP_STANDARD);
        let all = all_moves(&b, Rules::default());
        assert_eq!(all.len(), 72);
        let total: usize = all.iter().map(|(_, m)| m.len()).sum();
        assert!(total > 100);
    }
}
