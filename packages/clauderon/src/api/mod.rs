/// Anthropic API client for Claude usage tracking.
pub mod claude_client;
/// WebSocket/HTTP API client for daemon communication.
pub mod client;
/// Console WebSocket protocol messages.
pub mod console_protocol;
/// Console WebSocket connection handler.
pub mod console_socket;
/// Console client tracking and active session state.
pub mod console_state;
/// HTTP route handler implementations.
pub mod handlers;
/// HTTP server setup and router configuration.
pub mod http_server;
/// Auth and correlation ID middleware.
pub mod middleware;
/// Mock API client for testing.
pub mod mock;
/// Request/response/event protocol types (TypeShare).
pub mod protocol;
/// Daemon server lifecycle management.
pub mod server;
/// Embedded static file serving (web UI, docs).
pub mod static_files;
/// API client trait definition.
pub mod traits;
/// Shared DTO types for API responses.
pub mod types;
/// WebSocket handler for console terminal access.
pub mod ws_console;
/// WebSocket handler for real-time event streaming.
pub mod ws_events;

pub use client::Client;
pub use mock::MockApiClient;
pub use protocol::{CreateSessionRequest, Request, Response};
pub use traits::ApiClient;
