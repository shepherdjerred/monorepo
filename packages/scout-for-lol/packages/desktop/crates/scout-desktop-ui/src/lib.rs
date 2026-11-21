//! The gpui-kit window for Scout Desktop.
//!
//! The supervisor (`scout-client`) runs this as its `--window` child when the
//! gpui window is selected. It renders the supervisor's IPC state and sends
//! every action back as a command; it holds no collector, outbox, or lock.
//!
//! The same executable started as `--overlay` runs [`run_overlay`]: the
//! in-game overlay, a click-through card window the supervisor opens for the
//! length of a game.
//!
//! This is the only crate that depends on gpui-kit and GPUI, and only on
//! Windows and macOS. Inside it, [`kit`] is the only module that names
//! gpui-kit, and `native` is the only module in the workspace that may use
//! `unsafe`. The view models, IPC link and theme tokens build on every
//! target, so Linux CI still builds and tests them.

pub mod chat_model;
#[cfg(any(windows, target_os = "macos"))]
mod chat_view;
#[cfg(any(windows, target_os = "macos"))]
mod kit;
pub mod link;
#[cfg(any(windows, target_os = "macos"))]
mod native;
#[cfg(any(windows, target_os = "macos"))]
mod overlay;
pub mod overlay_model;
pub mod tokens;
pub mod view_model;
#[cfg(any(windows, target_os = "macos"))]
mod views;
pub mod voice_model;
#[cfg(any(windows, target_os = "macos"))]
mod window;

#[cfg(test)]
#[path = "token_source.rs"]
mod token_source;

#[cfg(any(windows, target_os = "macos"))]
pub use overlay::run_overlay;
pub use view_model::BuildInfo;
#[cfg(any(windows, target_os = "macos"))]
pub use window::{preview, run};

/// Whether this build contains the gpui window.
pub const AVAILABLE: bool = cfg!(any(windows, target_os = "macos"));
