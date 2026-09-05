use serde::{Deserialize, Serialize};

use crate::db::User;

#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClockSpec {
    pub initial_ms: i64,
    pub increment_ms: i64,
}

impl ClockSpec {
    /// Sane bounds: up to 3h base, 3min increment, not both zero.
    pub fn valid(&self) -> bool {
        (0..=180 * 60_000).contains(&self.initial_ms)
            && (0..=180_000).contains(&self.increment_ms)
            && (self.initial_ms > 0 || self.increment_ms > 0)
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

#[derive(Clone, Debug, Serialize)]
pub struct Seek {
    pub id: String,
    pub user: User,
    pub clock: ClockSpec,
    pub walled: bool,
    pub color: SeekColor,
}

/// Private invite: not in the lobby, joined by link.
#[derive(Clone, Debug, Serialize)]
pub struct Challenge {
    pub id: String,
    pub user: User,
    pub clock: ClockSpec,
    pub walled: bool,
    pub color: SeekColor,
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
