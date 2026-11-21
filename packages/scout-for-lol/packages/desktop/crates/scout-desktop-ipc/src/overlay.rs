//! The in-game overlay's link: the supervisor and the overlay process.
//!
//! The supervisor starts the overlay as its own child (`--overlay`) when a game
//! reaches `InProgress` and closes it when the game ends. It owns the
//! [`scout_overlay::OverlayController`] and the hotkeys, and sends the overlay
//! only what to draw. The overlay never takes input, so it sends nothing but
//! its hello and whether its window could be made click-through.
//!
//! The framing is the main window's: one JSON object per line, tagged by
//! `type`, strict, opening with `hello` and [`crate::PROTOCOL_VERSION`].

use scout_overlay::OverlayCard;
use serde::{Deserialize, Serialize};

/// A message from the supervisor to the overlay process.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum OverlayCommand {
    /// The first message on every connection.
    Hello {
        /// The supervisor's [`crate::PROTOCOL_VERSION`].
        protocol: u32,
    },
    /// What to draw now. None draws nothing; the window stays, empty and
    /// click-through, until the game ends.
    Frame {
        /// The card on screen.
        frame: Option<OverlayFrame>,
    },
    /// The game ended or Scout is quitting: close the overlay and exit.
    Close,
}

/// A message from the overlay process to the supervisor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum OverlayReport {
    /// The first message on every connection.
    Hello {
        /// The overlay's [`crate::PROTOCOL_VERSION`].
        protocol: u32,
    },
    /// The window is open, on top, and lets every click through.
    Ready,
    /// The overlay cannot be drawn on this computer; the process exits after
    /// sending this. The cards stay in the main window, where they always
    /// are. Safe to record in diagnostics.
    Unavailable {
        /// Why, such as the platform refusing click-through.
        reason: String,
    },
}

/// The card the overlay shows and how.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OverlayFrame {
    /// The card, as the contract defines it.
    pub card: OverlayCard,
    /// Whether every line shows, or only the first.
    pub expanded: bool,
    /// Cards queued, this one included.
    pub queued: u32,
    /// The keys that act on the overlay, as the hint under the card names
    /// them.
    pub keys: OverlayKeys,
}

/// The overlay's hotkeys, as accelerators such as `F7` or `Shift+F7`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OverlayKeys {
    /// Removes the shown card.
    pub dismiss: String,
    /// Shows the next queued card.
    pub next: String,
    /// Shows or hides the rest of the card.
    pub expand: String,
}
