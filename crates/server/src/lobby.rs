use rubrik_core::{GameConfig, Rules, LAYOUT_RUBRIK, LAYOUT_STANDARD};
use serde::{Deserialize, Serialize};

use crate::db::User;

#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClockSpec {
    pub initial_ms: i64,
    pub increment_ms: i64,
}

impl ClockSpec {
    /// Sane bounds: up to 3h base, 3min increment, not both zero.
    /// Both zero = unlimited (correspondence): no flag fall.
    pub fn valid(&self) -> bool {
        (0..=180 * 60_000).contains(&self.initial_ms) && (0..=180_000).contains(&self.increment_ms)
    }

    pub fn unlimited(&self) -> bool {
        self.initial_ms == 0 && self.increment_ms == 0
    }
}

#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SeekColor {
    White,
    Black,
    #[default]
    Random,
}

impl SeekColor {
    /// Random pairs with anything; a fixed colour only with its opposite.
    pub fn compatible(self, other: SeekColor) -> bool {
        self == SeekColor::Random || other == SeekColor::Random || self != other
    }

    /// Is `self` white when paired against `other`? Random is coin-flipped.
    pub fn is_white_against(self, other: SeekColor) -> bool {
        match (self, other) {
            (SeekColor::White, _) => true,
            (SeekColor::Black, _) => false,
            (_, SeekColor::White) => false,
            (_, SeekColor::Black) => true,
            _ => rand::random(),
        }
    }
}

/// Face colouring of the board.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Layout {
    #[default]
    Standard,
    Rubrik,
}

impl Layout {
    pub fn faces(self) -> [u8; 6] {
        match self {
            Layout::Standard => LAYOUT_STANDARD,
            Layout::Rubrik => LAYOUT_RUBRIK,
        }
    }

    pub fn of(faces: [u8; 6]) -> Layout {
        if faces == LAYOUT_RUBRIK {
            Layout::Rubrik
        } else {
            Layout::Standard
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Seek {
    pub id: String,
    pub user: User,
    pub clock: ClockSpec,
    pub walled: bool,
    pub layout: Layout,
    pub color: SeekColor,
    /// Custom start position (board-editor challenges only; lobby seeks never carry one).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup: Option<String>,
}

/// Engine config for a variant choice; `setup` None = standard start position.
pub fn game_config(walled: bool, layout: Layout, setup: Option<String>) -> GameConfig {
    let default = GameConfig::default();
    GameConfig {
        rules: Rules { walled },
        layout: layout.faces(),
        setup: setup.unwrap_or(default.setup),
    }
}

/// A board-editor setup: 16 or 48 rows of 8 piece letters / `-`, exactly one king per side.
pub fn valid_setup(setup: &str) -> bool {
    let rows: Vec<&str> = setup.split_whitespace().collect();
    if rows.len() != 16 && rows.len() != 48 {
        return false;
    }
    let mut kings = (0, 0);
    for row in &rows {
        if row.chars().count() != 8 {
            return false;
        }
        for ch in row.chars() {
            match ch {
                '-' => {}
                'K' => kings.0 += 1,
                'k' => kings.1 += 1,
                c if "pnbrqxscotPNBRQXSCOT".contains(c) => {}
                _ => return false,
            }
        }
    }
    kings == (1, 1)
}

/// Private invite: not in the lobby, joined by link.
#[derive(Clone, Debug, Serialize)]
pub struct Challenge {
    pub id: String,
    pub user: User,
    pub clock: ClockSpec,
    pub walled: bool,
    pub layout: Layout,
    pub color: SeekColor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup: Option<String>,
    /// Direct challenge: only this user may join.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<User>,
    #[serde(skip)]
    pub created_at: i64,
}

pub const CHALLENGE_TTL_MS: i64 = 60 * 60 * 1000;

#[derive(Default)]
pub struct Lobby {
    pub seeks: Vec<Seek>,
}

impl Lobby {
    /// One seek per user: adding replaces the previous one.
    pub fn add(&mut self, seek: Seek) {
        self.remove_user(&seek.user.id);
        self.seeks.push(seek);
    }

    pub fn remove_user(&mut self, user_id: &str) {
        self.seeks.retain(|s| s.user.id != user_id);
    }

    /// A seek by another user this one can be paired with immediately.
    pub fn match_for(&self, seek: &Seek) -> Option<String> {
        self.seeks
            .iter()
            .find(|s| {
                s.user.id != seek.user.id
                    && s.clock == seek.clock
                    && s.walled == seek.walled
                    && s.layout == seek.layout
                    && s.color.compatible(seek.color)
            })
            .map(|s| s.id.clone())
    }

    pub fn take(&mut self, seek_id: &str) -> Option<Seek> {
        let i = self.seeks.iter().position(|s| s.id == seek_id)?;
        Some(self.seeks.remove(i))
    }

    /// `online` = users with at least one open socket.
    pub fn msg(&self, online: usize) -> serde_json::Value {
        serde_json::json!({ "t": "lobby", "seeks": self.seeks, "online": online })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setup_validation() {
        let mut rows = vec!["--------"; 48];
        rows[0] = "K-------";
        rows[47] = "-------k";
        assert!(valid_setup(&rows.join("\n")));
        rows[1] = "K-------"; // two white kings
        assert!(!valid_setup(&rows.join("\n")));
        rows[1] = "--------";
        rows[2] = "Z-------"; // unknown piece
        assert!(!valid_setup(&rows.join("\n")));
        rows[2] = "--------";
        assert!(!valid_setup(&rows[..47].join("\n"))); // wrong row count
        assert!(valid_setup(rubrik_core::SETUP_STANDARD));
    }
}
