use axum::{
    extract::{
        ws::{Message, WebSocket},
        State, WebSocketUpgrade,
    },
    response::Response,
};
use futures::{sink::SinkExt, stream::StreamExt};
use serde_json::json;
use tokio::sync::broadcast;

use crate::core::events::Event;

use super::http_server::AppState;

/// Broadcast channel for session events
/// Multiple WebSocket clients can subscribe to receive real-time updates
pub type EventBroadcaster = broadcast::Sender<Event>;

/// WebSocket handler for /ws/events endpoint
/// Clients connect here to receive real-time session updates
pub async fn ws_events_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> Response {
    ws.on_upgrade(|socket| handle_events_socket(socket, state))
}

/// Handle an individual WebSocket connection for events
async fn handle_events_socket(socket: WebSocket, _state: AppState) {
    let (mut sender, mut receiver) = socket.split();

    // Send initial connection message
    if let Err(e) = sender
        .send(Message::Text(
            json!({
                "type": "connected",
                "message": "Subscribed to session events"
            })
            .to_string(),
        ))
        .await
    {
        tracing::error!("Failed to send connection message: {}", e);
        return;
    }

    // TODO: Subscribe to event broadcaster
    // For now, we'll just keep the connection open
    // In a complete implementation, we would:
    // 1. Get a broadcast receiver from the session manager
    // 2. Listen for events and forward them to the WebSocket
    // 3. Handle client disconnection gracefully

    // Keep connection alive until client disconnects
    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Close(_)) => {
                tracing::debug!("Client disconnected from events WebSocket");
                break;
            }
            Ok(Message::Ping(data)) => {
                if let Err(e) = sender.send(Message::Pong(data)).await {
                    tracing::error!("Failed to send pong: {}", e);
                    break;
                }
            }
            Err(e) => {
                tracing::error!("WebSocket error: {}", e);
                break;
            }
            _ => {}
        }
    }

    tracing::debug!("Events WebSocket connection closed");
}

/// Helper function to broadcast an event to all connected clients
/// This would be called by the SessionManager when events occur
pub async fn broadcast_event(broadcaster: &EventBroadcaster, event: Event) {
    let message = json!({
        "type": "event",
        "event": event,
    });

    // send() returns Err if there are no active receivers, which is fine
    let _ = broadcaster.send(event);

    tracing::debug!("Broadcasted event: {:?}", message);
}
