use serde::{Deserialize, Serialize};

use crate::db::User;

#[derive(Copy, Clone, Debug, Serialize, Deserialize)]
pub struct ClockSpec {
    pub initial_ms: i64,
    pub increment_ms: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct Seek {
    pub id: String,
    pub user: User,
    pub clock: ClockSpec,
    pub walled: bool,
}

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

    pub fn take(&mut self, seek_id: &str) -> Option<Seek> {
        let i = self.seeks.iter().position(|s| s.id == seek_id)?;
        Some(self.seeks.remove(i))
    }

    pub fn msg(&self) -> serde_json::Value {
        serde_json::json!({ "t": "lobby", "seeks": self.seeks })
    }
}
