//! Clauderon: Session management system for AI coding agents.

#![warn(missing_debug_implementations)]
#![warn(missing_docs)]
#![warn(rust_2018_idioms)]
#![warn(unreachable_pub)]
#![warn(elided_lifetimes_in_paths)]
#![warn(missing_copy_implementations)]
#![deny(unused_must_use)]
#![deny(unsafe_op_in_unsafe_fn)]

/// AI coding agent adapters (Claude Code, Gemini, Codex).
pub mod agents;
/// HTTP API client for GitHub and daemon communication.
pub mod api;
/// Authentication (WebAuthn, tokens).
pub mod auth;
/// Execution backends (Docker, Kubernetes, local, sprites).
pub mod backends;
/// CI status polling and PR discovery.
pub mod ci;
/// Application configuration loading.
pub mod config;
/// Core session management and domain types.
pub mod core;
/// Feature flag configuration and loading.
pub mod feature_flags;
/// Claude Code hook installation for containers.
pub mod hooks;
/// Observability, tracing, and metrics.
pub mod observability;
/// Plugin system for extending functionality.
pub mod plugins;
/// Zero-credential proxy for injecting tokens.
pub mod proxy;
/// Persistent storage (SQLite).
pub mod store;
/// Terminal UI (ratatui).
pub mod tui;
/// File upload handling.
pub mod uploads;
/// Shared utilities (git, paths, daemon, etc.).
pub mod utils;
