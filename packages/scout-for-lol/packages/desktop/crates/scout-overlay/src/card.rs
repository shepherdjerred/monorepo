//! The overlay card contract.
//!
//! The wire contract is `data/src/scout-client/overlay-card.schema.json`, and
//! `overlay-card.fixtures.json` beside it holds the accept and reject bodies.
//! The backend validates the same files with Zod; the tests here hold these
//! strict serde types to them, so either side drifting fails its own suite.

use serde::{Deserialize, Serialize};
use thiserror::Error;

const ID_MAX: usize = 64;
const TITLE_MAX: usize = 80;
const LINES_MAX: usize = 5;
const LINE_MAX: usize = 160;
const TTL_MAX_SECS: u32 = 600;

/// What a card is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CardKind {
    /// The pre-game plan from champion select or the loading screen.
    PregamePlan,
    /// The answer to a question the player asked.
    Answer,
    /// A short status line.
    Status,
    /// An unprompted popup; shown only when the overlay's policy allows it.
    Proactive,
    /// The post-game review is ready in the main window.
    ReviewReady,
}

/// How urgently a card wants the screen. Higher shows first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CardPriority {
    /// Background information.
    Low,
    /// The default.
    Normal,
    /// Wants the screen now.
    High,
}

/// One card, as the contract defines it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OverlayCard {
    /// Stable per card; offering the same id again replaces the card.
    pub id: String,
    /// What the card is for.
    pub kind: CardKind,
    /// The heading.
    pub title: String,
    /// One to five short lines.
    pub lines: Vec<String>,
    /// How urgently the card wants the screen.
    pub priority: CardPriority,
    /// Seconds the card stays queued before it expires.
    pub ttl_secs: u32,
}

/// A card the contract refuses.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum CardError {
    /// The JSON did not parse into the typed card.
    #[error("not an overlay card: {0}")]
    Malformed(String),
    /// A field is outside the contract's bounds.
    #[error("overlay card {field} is out of bounds")]
    OutOfBounds {
        /// The offending field.
        field: &'static str,
    },
}

fn bounded(text: &str, max: usize) -> bool {
    (1..=max).contains(&text.chars().count())
}

impl OverlayCard {
    /// Parse and validate a card from its wire JSON.
    ///
    /// # Errors
    /// [`CardError::Malformed`] for a shape the types refuse and
    /// [`CardError::OutOfBounds`] for a value outside the schema's limits.
    pub fn from_json(value: &serde_json::Value) -> Result<Self, CardError> {
        let card =
            Self::deserialize(value).map_err(|error| CardError::Malformed(error.to_string()))?;
        card.validate()?;
        Ok(card)
    }

    /// Check the bounds serde cannot express.
    ///
    /// # Errors
    /// [`CardError::OutOfBounds`] naming the first offending field.
    pub fn validate(&self) -> Result<(), CardError> {
        let out = |field| Err(CardError::OutOfBounds { field });
        if !bounded(&self.id, ID_MAX) {
            return out("id");
        }
        if !bounded(&self.title, TITLE_MAX) {
            return out("title");
        }
        if self.lines.is_empty() || self.lines.len() > LINES_MAX {
            return out("lines");
        }
        if self.lines.iter().any(|line| !bounded(line, LINE_MAX)) {
            return out("lines");
        }
        if !(1..=TTL_MAX_SECS).contains(&self.ttl_secs) {
            return out("ttlSecs");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    const FIXTURES: &str =
        include_str!("../../../../data/src/scout-client/overlay-card.fixtures.json");
    const SCHEMA: &str = include_str!("../../../../data/src/scout-client/overlay-card.schema.json");

    #[test]
    fn every_accept_fixture_parses_and_round_trips() -> TestResult {
        let fixtures: Value = serde_json::from_str(FIXTURES)?;
        for case in fixtures["valid"].as_array().ok_or("valid fixtures")? {
            let name = case["name"].as_str().unwrap_or("?");
            let card = OverlayCard::from_json(&case["body"]).map_err(|e| format!("{name}: {e}"))?;
            assert_eq!(
                OverlayCard::from_json(&serde_json::to_value(&card)?)?,
                card,
                "{name}"
            );
            assert_eq!(serde_json::to_value(&card)?, case["body"], "{name}");
        }
        Ok(())
    }

    #[test]
    fn every_reject_fixture_is_refused() -> TestResult {
        let fixtures: Value = serde_json::from_str(FIXTURES)?;
        for case in fixtures["invalid"].as_array().ok_or("invalid fixtures")? {
            let reason = case["reason"].as_str().unwrap_or("?");
            assert!(
                OverlayCard::from_json(&case["body"]).is_err(),
                "must refuse {reason}"
            );
        }
        Ok(())
    }

    #[test]
    fn the_kinds_match_the_schema() -> TestResult {
        let schema: Value = serde_json::from_str(SCHEMA)?;
        let kinds = schema["properties"]["kind"]["enum"]
            .as_array()
            .ok_or("kind enum")?;
        let all = [
            CardKind::PregamePlan,
            CardKind::Answer,
            CardKind::Status,
            CardKind::Proactive,
            CardKind::ReviewReady,
        ];
        let wire = all
            .iter()
            .map(serde_json::to_value)
            .collect::<Result<Vec<_>, _>>()?;
        assert_eq!(&wire, kinds);
        Ok(())
    }
}
