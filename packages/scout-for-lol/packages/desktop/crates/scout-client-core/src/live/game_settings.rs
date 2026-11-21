//! The game's window mode, from the League client's game settings.
//!
//! The in-game overlay is a separate top-level window. It can draw over League
//! in windowed and borderless mode, but not over exclusive fullscreen, where
//! the game owns the display. `/lol-game-settings/v1/game-settings` holds the
//! game's `game.cfg`; its `General.WindowMode` says which mode the game will
//! start in, so Scout can warn during champion select.
//!
//! Only `General.WindowMode` is read. Nothing else in the settings is kept.

use serde::Deserialize;
use serde_json::Value;
use thiserror::Error;

/// How the game draws to the screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GameWindowMode {
    /// Exclusive fullscreen (`WindowMode=0`): no other window can draw over
    /// the game.
    Fullscreen,
    /// A normal window (`WindowMode=1`).
    Windowed,
    /// A borderless window the size of the screen (`WindowMode=2`).
    Borderless,
}

impl GameWindowMode {
    /// Whether the overlay can draw over the game in this mode.
    #[must_use]
    pub const fn overlay_can_draw(self) -> bool {
        !matches!(self, Self::Fullscreen)
    }
}

/// The settings did not state a window mode Scout knows.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum GameSettingsError {
    /// The payload has no integer `General.WindowMode`.
    #[error("the game settings were malformed: {0}")]
    Malformed(String),
    /// A mode League has not documented; not guessed at.
    #[error("the game settings name an unknown window mode {0}")]
    UnknownWindowMode(i64),
}

#[derive(Deserialize)]
struct RawSettings {
    #[serde(rename = "General")]
    general: RawGeneral,
}

#[derive(Deserialize)]
struct RawGeneral {
    #[serde(rename = "WindowMode")]
    window_mode: i64,
}

/// Read the window mode out of `/lol-game-settings/v1/game-settings`.
///
/// # Errors
///
/// [`GameSettingsError`] when `General.WindowMode` is missing, not an integer,
/// or not one of the three modes.
pub fn parse_window_mode(value: &Value) -> Result<GameWindowMode, GameSettingsError> {
    let raw = RawSettings::deserialize(value)
        .map_err(|error| GameSettingsError::Malformed(error.to_string()))?;
    match raw.general.window_mode {
        0 => Ok(GameWindowMode::Fullscreen),
        1 => Ok(GameWindowMode::Windowed),
        2 => Ok(GameWindowMode::Borderless),
        other => Err(GameSettingsError::UnknownWindowMode(other)),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{GameSettingsError, GameWindowMode, parse_window_mode};

    #[test]
    fn each_documented_mode_parses() -> Result<(), GameSettingsError> {
        for (raw, mode) in [
            (0, GameWindowMode::Fullscreen),
            (1, GameWindowMode::Windowed),
            (2, GameWindowMode::Borderless),
        ] {
            let settings = json!({
                "General": { "WindowMode": raw, "Width": 1920, "Height": 1080 },
                "HUD": { "MinimapScale": 1.0 }
            });
            assert_eq!(parse_window_mode(&settings)?, mode);
        }
        Ok(())
    }

    #[test]
    fn only_exclusive_fullscreen_blocks_the_overlay() {
        assert!(!GameWindowMode::Fullscreen.overlay_can_draw());
        assert!(GameWindowMode::Windowed.overlay_can_draw());
        assert!(GameWindowMode::Borderless.overlay_can_draw());
    }

    #[test]
    fn an_unknown_or_missing_mode_fails_loudly() {
        assert_eq!(
            parse_window_mode(&json!({ "General": { "WindowMode": 7 } })),
            Err(GameSettingsError::UnknownWindowMode(7))
        );
        for malformed in [
            json!({}),
            json!({ "General": {} }),
            json!({ "General": { "WindowMode": "2" } }),
        ] {
            assert!(matches!(
                parse_window_mode(&malformed),
                Err(GameSettingsError::Malformed(_))
            ));
        }
    }
}
