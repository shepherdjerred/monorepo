//! Clauderon: Session management system for AI coding agents.

#![warn(missing_debug_implementations)]
#![warn(missing_docs)]
#![warn(rust_2018_idioms)]
#![warn(unreachable_pub)]
#![warn(elided_lifetimes_in_paths)]
#![warn(missing_copy_implementations)]
#![deny(unused_must_use)]
#![deny(unsafe_op_in_unsafe_fn)]

pub mod agents;
pub mod api;
pub mod auth;
pub mod backends;
pub mod ci;
pub mod config;
pub mod core;
pub mod feature_flags;
pub mod hooks;
pub mod observability;
pub mod plugins;
pub mod proxy;
pub mod store;
pub mod tui;
pub mod uploads;
pub mod utils;
