//! Integer cube geometry. Cube side = 32, cell = 4, so every cell centre is an
//! integer vector with exactly one component equal to ±16 (face normal) and the
//! other two in {-14, -10, ..., 14}.

use serde::{Deserialize, Serialize};

pub const C_S: i32 = 4; // cell size
pub const B_D: i32 = 8; // board dimension (cells per face edge)
pub const CU_S: i32 = C_S * B_D; // cube size
pub const HALF: i32 = CU_S / 2;
pub const N_FACES: usize = 6;
pub const N_CELLS: usize = N_FACES * (B_D * B_D) as usize;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default, Serialize, Deserialize)]
pub struct V3 {
    pub x: i32,
    pub y: i32,
    pub z: i32,
}

pub const fn v(x: i32, y: i32, z: i32) -> V3 {
    V3 { x, y, z }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Axis {
    X,
    Y,
    Z,
}

impl Axis {
    pub const ALL: [Axis; 3] = [Axis::X, Axis::Y, Axis::Z];
    pub fn unit(self) -> V3 {
        match self {
            Axis::X => v(1, 0, 0),
            Axis::Y => v(0, 1, 0),
            Axis::Z => v(0, 0, 1),
        }
    }
}

/// Face order matches original client: +Y, +X, +Z, -Y, -X, -Z.
pub const SIDES: [V3; 6] = [
    v(0, 1, 0),
    v(1, 0, 0),
    v(0, 0, 1),
    v(0, -1, 0),
    v(-1, 0, 0),
    v(0, 0, -1),
];

#[allow(clippy::should_implement_trait)]
impl V3 {
    pub const ZERO: V3 = v(0, 0, 0);

    pub fn comp(self, i: usize) -> i32 {
        match i {
            0 => self.x,
            1 => self.y,
            _ => self.z,
        }
    }
    pub fn set_comp(mut self, i: usize, val: i32) -> V3 {
        match i {
            0 => self.x = val,
            1 => self.y = val,
            _ => self.z = val,
        }
        self
    }
    pub fn add(self, o: V3) -> V3 {
        v(self.x + o.x, self.y + o.y, self.z + o.z)
    }
    pub fn sub(self, o: V3) -> V3 {
        v(self.x - o.x, self.y - o.y, self.z - o.z)
    }
    pub fn scale(self, k: i32) -> V3 {
        v(self.x * k, self.y * k, self.z * k)
    }
    pub fn neg(self) -> V3 {
        self.scale(-1)
    }
    pub fn dot(self, o: V3) -> i32 {
        self.x * o.x + self.y * o.y + self.z * o.z
    }
    pub fn len_sq(self) -> i32 {
        self.dot(self)
    }
    pub fn dist_sq(self, o: V3) -> i32 {
        self.sub(o).len_sq()
    }
    pub fn clamp_cube(self) -> V3 {
        v(
            self.x.clamp(-HALF, HALF),
            self.y.clamp(-HALF, HALF),
            self.z.clamp(-HALF, HALF),
        )
    }
    /// Rotate by `sign` * 90° around `axis` (right-hand rule, same as three.js).
    pub fn rot90(self, axis: Axis, sign: i8) -> V3 {
        let s = sign.signum() as i32;
        match axis {
            Axis::X => v(self.x, -s * self.z, s * self.y),
            Axis::Y => v(s * self.z, self.y, -s * self.x),
            Axis::Z => v(-s * self.y, s * self.x, self.z),
        }
    }
    /// Index of the single non-zero component of a unit axis vector.
    pub fn axis_index(self) -> usize {
        if self.x != 0 {
            0
        } else if self.y != 0 {
            1
        } else {
            2
        }
    }
    /// Zero the component along `n` (n is a unit axis vector).
    pub fn drop_axis(self, n: V3) -> V3 {
        self.set_comp(n.axis_index(), 0)
    }
}

/// 4 orthogonal + 4 diagonal unit direction vectors tangent to `side`.
/// Components ∈ {-1,0,1}; a step along a direction is `dir * C_S`.
pub fn tangent_dirs(side: V3) -> [V3; 8] {
    let n = side.axis_index();
    let (a, b) = match n {
        0 => (1, 2),
        1 => (0, 2),
        _ => (0, 1),
    };
    let ua = V3::ZERO.set_comp(a, 1);
    let ub = V3::ZERO.set_comp(b, 1);
    [
        ua,
        ub,
        ua.neg(),
        ub.neg(),
        ua.add(ub),
        ua.sub(ub),
        ub.sub(ua),
        ua.neg().sub(ub),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rot90_matches_right_hand_rule() {
        assert_eq!(v(0, 1, 0).rot90(Axis::X, 1), v(0, 0, 1));
        assert_eq!(v(0, 0, 1).rot90(Axis::Y, 1), v(1, 0, 0));
        assert_eq!(v(1, 0, 0).rot90(Axis::Z, 1), v(0, 1, 0));
        let p = v(14, 16, -6);
        assert_eq!(p.rot90(Axis::X, 1).rot90(Axis::X, -1), p);
    }

    #[test]
    fn tangent_dirs_are_perpendicular() {
        for s in SIDES {
            for d in tangent_dirs(s) {
                assert_eq!(d.dot(s), 0);
                assert!(d.len_sq() == 1 || d.len_sq() == 2);
            }
        }
    }
}
