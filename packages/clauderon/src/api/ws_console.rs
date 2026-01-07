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
    let mut output_rx = console_handle.subscribe();

    state
        .console_state
        .register_client(&session_id, client_id)
        .await;

    let (mut ws_sender, mut ws_receiver) = socket.split();

    loop {
        tokio::select! {
            output = output_rx.recv() => {
                match output {
                    Ok(bytes) => {
                        let data = base64::prelude::BASE64_STANDARD.encode(&bytes);
                        let message = ConsoleMessage::Output { data };
                        let payload = json!(message);
                        if let Err(e) = ws_sender.send(Message::Text(payload.to_string().into())).await {
                            tracing::debug!("Failed to send console output to WebSocket: {}", e);
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        continue;
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
                    Some(Ok(Message::Close(_))) => break,
                    Some(Ok(Message::Ping(data))) => {
                        tracing::trace!("Received ping: {} bytes", data.len());
                    }
                    Some(Err(e)) => {
                        tracing::error!("WebSocket error: {}", e);
                        break;
                    }
                    None => break,
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

// Add base64 to dependencies
use base64::prelude::*;
