use axum::{
    extract::{
        Path, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::Response,
};
use base64::Engine;
use futures::{sink::SinkExt, stream::StreamExt};
use serde_json::json;
use uuid::Uuid;

use super::http_server::AppState;
use crate::api::console_protocol::ConsoleMessage;

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
    let client_id = Uuid::new_v4();

    let session = match state.session_manager.get_session(&session_id).await {
        Some(s) => s,
        None => {
            tracing::error!("Session not found: {}", session_id);
            return;
        }
    };

    let backend_id = match &session.backend_id {
        Some(id) => id.clone(),
        None => {
            tracing::error!("Session {} has no backend_id", session_id);
            return;
        }
    };

    let console_handle = match state
        .session_manager
        .console_manager()
        .ensure_session(session.id, session.backend, &backend_id)
        .await
    {
        Ok(handle) => handle,
        Err(e) => {
            tracing::error!("Failed to start console session {}: {}", session_id, e);
            return;
        }
    };

    // Atomically get snapshot and subscribe to prevent race conditions
    let (snapshot_bytes, snap_rows, snap_cols, cursor_row, cursor_col, output_rx) =
        console_handle.snapshot_and_subscribe().await;
    let mut output_rx = output_rx;

    state
        .console_state
        .register_client(&session_id, client_id)
        .await;

    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Send snapshot to client so they see current terminal state
    let snapshot_data = base64::prelude::BASE64_STANDARD.encode(&snapshot_bytes);
    let snapshot = ConsoleMessage::Snapshot {
        data: snapshot_data,
        rows: snap_rows,
        cols: snap_cols,
        cursor_row,
        cursor_col,
    };
    let payload = json!(snapshot);
    if let Err(e) = ws_sender
        .send(Message::Text(payload.to_string().into()))
        .await
    {
        tracing::debug!("Failed to send snapshot to WebSocket: {}", e);
        return;
    }

    loop {
        tokio::select! {
            output = output_rx.recv() => {
                match output {
                    Ok(bytes) => {
                        // Validate read size is reasonable
                        if bytes.len() > 1_048_576 {
                            tracing::warn!(
                                session_id = %session_id,
                                bytes_read = bytes.len(),
                                "Unusually large console output, may cause client issues"
                            );
                        }

                        // Convert bytes to base64 for binary-safe transmission
                        let data = base64::prelude::BASE64_STANDARD.encode(&bytes);

                        // Log encoding details for debugging
                        tracing::debug!(
                            session_id = %session_id,
                            bytes_len = bytes.len(),
                            encoded_len = data.len(),
                            is_valid_utf8 = std::str::from_utf8(&bytes).is_ok(),
                            "Encoded console output"
                        );

                        // Validate encoded data
                        if data.is_empty() && !bytes.is_empty() {
                            tracing::error!(
                                session_id = %session_id,
                                bytes_read = bytes.len(),
                                bytes_sample = format!("{:?}", &bytes[..bytes.len().min(32)]),
                                "Base64 encoding produced empty string from non-empty input"
                            );
                            continue;
                        }

                        // Validate base64 roundtrip
                        if let Err(e) = base64::prelude::BASE64_STANDARD.decode(&data) {
                            tracing::error!(
                                session_id = %session_id,
                                error = %e,
                                encoded_len = data.len(),
                                encoded_sample = &data[..data.len().min(100)],
                                "Generated invalid base64 that cannot be decoded"
                            );
                            continue;
                        }

                        tracing::trace!(
                            session_id = %session_id,
                            bytes_read = bytes.len(),
                            encoded_length = data.len(),
                            "Sent console output to client"
                        );

                        let message = ConsoleMessage::Output { data };
                        let payload = json!(message);
                        if let Err(e) = ws_sender.send(Message::Text(payload.to_string().into())).await {
                            tracing::debug!("Failed to send console output to WebSocket: {}", e);
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(dropped)) => {
                        tracing::warn!(
                            session_id = %session_id,
                            dropped_messages = dropped,
                            "Broadcast channel lagged, console output dropped"
                        );
                        // Continue processing - don't break
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            ws_msg = ws_receiver.next() => {
                match ws_msg {
                    Some(Ok(Message::Text(text))) => {
                        let message: ConsoleMessage = match serde_json::from_str(&text) {
                            Ok(m) => m,
                            Err(e) => {
                                tracing::error!("Invalid JSON from WebSocket: {}", e);
                                continue;
                            }
                        };

                        match message {
                            ConsoleMessage::Input { data } => {
                                if let Ok(bytes) = base64::prelude::BASE64_STANDARD.decode(data) {
                                    tracing::debug!(
                                        "Received input bytes: {:?} (string: {:?})",
                                        bytes,
                                        String::from_utf8_lossy(&bytes)
                                    );
                                    state
                                        .console_state
                                        .set_active(&session_id, client_id)
                                        .await;
                                    if let Err(e) = console_handle.send_input(bytes).await {
                                        tracing::error!("Failed to write to console session: {}", e);
                                        break;
                                    }
                                }
                            }
                            ConsoleMessage::Resize { rows, cols } => {
                                let is_active = state
                                    .console_state
                                    .is_active(&session_id, client_id)
                                    .await
                                    || state
                                        .console_state
                                        .set_active_if_none(&session_id, client_id)
                                        .await;
                                if is_active {
                                    console_handle.resize(rows, cols).await;
                                }
                            }
                            _ => {
                                tracing::warn!("Unexpected console message from WebSocket: {:?}", message);
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(data))) => {
                        tracing::trace!("Received ping: {} bytes", data.len());
                    }
                    Some(Err(e)) => {
                        tracing::error!("WebSocket error: {}", e);
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    state
        .console_state
        .unregister_client(&session_id, client_id)
        .await;
    tracing::info!("Console WebSocket disconnected for session: {}", session_id);
}
