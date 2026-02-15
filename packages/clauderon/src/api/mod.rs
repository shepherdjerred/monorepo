/// Claude.ai API client for usage and account operations.
pub mod claude_client;
/// Unix socket client for communicating with the clauderon daemon.
pub mod client;
/// WebSocket console protocol messages.
pub mod console_protocol;
/// WebSocket console for terminal session management.
pub mod console_socket;
/// Shared console state for tracking active clients per session.
pub mod console_state;
/// HTTP request handlers for the REST API.
pub mod handlers;
/// HTTP server setup and router configuration.
pub mod http_server;
/// HTTP middleware (correlation IDs, etc).
pub mod middleware;
/// Mock API client for testing.
pub mod mock;
/// API request/response protocol types.
pub mod protocol;
/// Unix socket server for the daemon.
pub mod server;
/// Embedded static file serving for frontend and docs.
pub mod static_files;
/// API client trait definition.
pub mod traits;
/// Shared DTO types for the API.
pub mod types;
/// WebSocket console handler.
pub mod ws_console;
/// WebSocket event broadcasting.
pub mod ws_events;

pub use client::Client;
pub use mock::MockApiClient;
pub use protocol::{CreateSessionRequest, Request, Response};
pub use traits::ApiClient;
