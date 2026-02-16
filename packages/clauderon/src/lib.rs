//! Clauderon: Session management system for AI coding agents.

#![warn(missing_debug_implementations)]
#![warn(missing_docs)]
#![warn(rust_2018_idioms)]
#![warn(unreachable_pub)]
#![warn(elided_lifetimes_in_paths)]
#![warn(missing_copy_implementations)]
#![deny(unused_must_use)]
#![deny(unsafe_op_in_unsafe_fn)]

/// AI coding agent implementations (Claude Code, Codex, Gemini).
pub mod agents;
/// HTTP/WebSocket API server and protocol types.
pub mod api;
/// WebAuthn-based authentication system.
pub mod auth;
/// Execution backend implementations (Docker, K8s, Sprites, Zellij).
pub mod backends;
/// CI status polling for pull requests.
pub mod ci;
/// Application configuration and settings.
pub mod config;
/// Core session management, events, and health monitoring.
pub mod core;
/// Runtime feature flag system with env/config/CLI layering.
pub mod feature_flags;
/// Claude Code hook integration for status tracking.
pub mod hooks;
/// Observability and tracing setup.
pub mod observability;
/// Claude Code plugin discovery and inheritance.
pub mod plugins;
/// Zero-credential proxy for injecting API tokens.
pub mod proxy;
/// Persistent storage backends (SQLite).
pub mod store;
/// Terminal user interface built with ratatui.
pub mod tui;
/// File upload handling for image attachments.
pub mod uploads;
/// Shared utilities (paths, git, daemon, names, etc.).
pub mod utils;
