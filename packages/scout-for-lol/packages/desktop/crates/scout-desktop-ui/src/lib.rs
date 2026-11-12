//! The gpui-kit window for Scout Desktop.
//!
//! The supervisor (`scout-client`) runs this as its `--window` child when the
//! gpui window is selected. It renders the supervisor's IPC state and sends
//! every action back as a command; it holds no collector, outbox, or lock.
//!
//! This is the only crate that depends on gpui-kit and GPUI, and only on
//! Windows and macOS. Inside it, [`kit`] is the only module that names
//! gpui-kit. The view models, IPC link and theme tokens build on every
//! target, so Linux CI still builds and tests them.

#[cfg(any(windows, target_os = "macos"))]
mod kit;
pub mod link;
pub mod tokens;
pub mod view_model;
#[cfg(any(windows, target_os = "macos"))]
mod views;
#[cfg(any(windows, target_os = "macos"))]
mod window;

#[cfg(test)]
#[path = "token_source.rs"]
mod token_source;

pub use view_model::BuildInfo;
#[cfg(any(windows, target_os = "macos"))]
pub use window::{preview, run};

/// Whether this build contains the gpui window.
pub const AVAILABLE: bool = cfg!(any(windows, target_os = "macos"));
