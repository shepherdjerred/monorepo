//! PTY-based session attachment with terminal emulation.
//!
//! This module provides:
//! - PTY session management with persistent background readers
//! - Terminal emulation via vt100 with scroll-back support
//! - Terminal rendering to ratatui widgets
//! - Keyboard input encoding for PTY

pub mod input;
pub mod pty_session;
pub mod renderer;
pub mod terminal_buffer;

pub use input::encode_key;
pub use pty_session::{PtyEvent, PtySession, SessionStatus};
pub use renderer::render_terminal;
pub use terminal_buffer::TerminalBuffer;
