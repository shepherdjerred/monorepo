use axum::{
    extract::{
        Path, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::Response,
};
use futures::{sink::SinkExt, stream::StreamExt};
use serde_json::json;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

use super::http_server::AppState;

/// WebSocket handler for /ws/console/{sessionId} endpoint
/// Clients connect here to stream terminal I/O for a specific session
pub async fn ws_console_handler(
    ws: WebSocketUpgrade,
    Path(session_id): Path<String>,
    State(state): State<AppState>,
) -> Response {
    ws.on_upgrade(move |socket| handle_console_socket(socket, session_id, state))
}

/// Handle an individual WebSocket connection for console streaming
async fn handle_console_socket(socket: WebSocket, session_id: String, state: AppState) {
    tracing::info!("Console WebSocket connected for session: {}", session_id);

    // Get the session to find its backend ID (container ID or Zellij session)
    let session = match state.session_manager.get_session(&session_id).await {
        Some(s) => s,
        None => {
            tracing::error!("Session not found: {}", session_id);
            return;
        }
    };

    let backend_id: String = match &session.backend_id {
        Some(id) => id.clone(),
        None => {
            tracing::error!("Session {} has no backend_id", session_id);
            return;
        }
    };

    // Spawn PTY process (docker attach or zellij attach)
    let pty_result = match session.backend {
        crate::core::session::BackendType::Docker => spawn_docker_attach(&backend_id).await,
        crate::core::session::BackendType::Zellij => spawn_zellij_attach(&backend_id).await,
        crate::core::session::BackendType::Kubernetes => {
            // TODO: Implement Kubernetes attach
            tracing::error!("Kubernetes attach not yet implemented");
            return;
        }
    };

    let (pty_reader, pty_writer) = match pty_result {
        Ok(pty) => pty,
        Err(e) => {
            tracing::error!("Failed to spawn PTY for session {}: {}", session_id, e);
            return;
        }
    };

    // PTY handles are already wrapped in Arc<Mutex<>> from spawn functions
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Create buffer for PTY reading
    let mut pty_buffer = vec![0u8; 4096];

    // Main event loop - handles both directions in single loop to avoid race conditions
    loop {
        tokio::select! {
            // Read from PTY and send to WebSocket
            read_result = async {
                let mut reader = pty_reader.lock().await;
                reader.read(&mut pty_buffer).await
            } => {
                match read_result {
                    Ok(0) => {
                        // EOF - PTY closed
                        tracing::debug!("PTY EOF for session {}", session_id);
                        break;
                    }
                    Ok(n) => {
                        // Convert bytes to base64 for binary-safe transmission
                        let data = base64::prelude::BASE64_STANDARD.encode(&pty_buffer[..n]);
                        let message = json!({
                            "type": "output",
                            "data": data,
                        });

                        if let Err(e) = ws_sender.send(Message::Text(message.to_string().into())).await {
                            tracing::debug!("Failed to send PTY output to WebSocket: {}", e);
                            break;
                        }
                    }
                    Err(e) => {
                        tracing::error!("PTY read error: {}", e);
                        break;
                    }
                }
            }

            // Read from WebSocket and send to PTY
            ws_msg = ws_receiver.next() => {
                match ws_msg {
                    Some(Ok(Message::Text(text))) => {
                        // Parse JSON message
                        let message: serde_json::Value = match serde_json::from_str(&text) {
                            Ok(m) => m,
                            Err(e) => {
                                tracing::error!("Invalid JSON from WebSocket: {}", e);
                                continue;
                            }
                        };

                        match message["type"].as_str() {
                            Some("input") => {
                                // Client is sending input to PTY
                                if let Some(data) = message["data"].as_str() {
                                    // Data is base64-encoded
                                    if let Ok(bytes) = base64::prelude::BASE64_STANDARD.decode(data) {
                                        let mut writer = pty_writer.lock().await;
                                        if let Err(e) = writer.write_all(&bytes).await {
                                            tracing::error!("Failed to write to PTY: {}", e);
                                            break;
                                        }
                                        // Flush immediately to ensure data is sent to PTY
                                        if let Err(e) = writer.flush().await {
                                            tracing::error!("Failed to flush PTY: {}", e);
                                            break;
                                        }
                                    }
                                }
                            }
                            Some("resize") => {
                                // Client is resizing terminal
                                if let (Some(rows), Some(cols)) =
                                    (message["rows"].as_u64(), message["cols"].as_u64())
                                {
                                    let size = pty_process::Size::new(rows as u16, cols as u16);
                                    let writer = pty_writer.lock().await;
                                    if let Err(e) = writer.resize(size) {
                                        tracing::error!("Failed to resize PTY: {}", e);
                                    } else {
                                        tracing::debug!("Resized PTY to {}x{}", rows, cols);
                                    }
                                } else {
                                    tracing::warn!("Invalid resize message: {:?}", message);
                                }
                            }
                            _ => {
                                tracing::warn!("Unknown message type from WebSocket: {:?}", message);
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) => {
                        tracing::debug!("WebSocket closed by client");
                        break;
                    }
                    Some(Ok(Message::Ping(data))) => {
                        // WebSocket will auto-respond to pings
                        tracing::trace!("Received ping: {} bytes", data.len());
                    }
                    Some(Err(e)) => {
                        tracing::error!("WebSocket error: {}", e);
                        break;
                    }
                    None => {
                        tracing::debug!("WebSocket stream ended");
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    tracing::info!("Console WebSocket disconnected for session: {}", session_id);
}

/// Wrapper type for PTY that can be used as both reader and writer
///
/// Note: We use Arc<Mutex<>> instead of splitting the PTY because:
/// 1. pty_process::Pty is a single file descriptor that cannot be split
/// 2. Both read and write operations require mutable access
/// 3. Resize operations also need mutable access
/// The mutex contention is minimal because we only hold the lock during individual I/O operations
type PtyHandle = Arc<Mutex<pty_process::Pty>>;

/// Spawn docker attach command and return reader/writer handles
async fn spawn_docker_attach(container_id: &str) -> anyhow::Result<(PtyHandle, PtyHandle)> {
    use pty_process::Command;

    // Create PTY
    let (pty, pts) = pty_process::open()?;

    // Spawn docker attach
    let cmd = Command::new("docker").args(["attach", container_id]);
    cmd.spawn(pts)?;

    // Wrap in Arc<Mutex<>> and return two clones
    let pty = Arc::new(Mutex::new(pty));
    Ok((Arc::clone(&pty), pty))
}

/// Spawn zellij attach command and return reader/writer handles
async fn spawn_zellij_attach(session_name: &str) -> anyhow::Result<(PtyHandle, PtyHandle)> {
    use pty_process::Command;

    // Create PTY
    let (pty, pts) = pty_process::open()?;

    // Spawn zellij attach
    let cmd = Command::new("zellij").args(["attach", session_name]);
    cmd.spawn(pts)?;

    // Wrap in Arc<Mutex<>> and return two clones
    let pty = Arc::new(Mutex::new(pty));
    Ok((Arc::clone(&pty), pty))
}

// Add base64 to dependencies
use base64::prelude::*;
