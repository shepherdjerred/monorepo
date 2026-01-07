use std::collections::{HashMap, HashSet};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Debug, Default)]
struct SessionConsoleState {
    active_client_id: Option<Uuid>,
    clients: HashSet<Uuid>,
}

/// Shared console state for tracking active clients per session.
#[derive(Debug, Default)]
pub struct ConsoleState {
    sessions: Mutex<HashMap<String, SessionConsoleState>>,
}

impl ConsoleState {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a client and return whether it became active.
    pub async fn register_client(&self, session_id: &str, client_id: Uuid) -> bool {
        let mut sessions = self.sessions.lock().await;
        let session = sessions
            .entry(session_id.to_string())
            .or_insert_with(SessionConsoleState::default);
        session.clients.insert(client_id);
        if session.active_client_id.is_none() {
            session.active_client_id = Some(client_id);
            return true;
        }
        false
    }

    /// Mark a client as active for the session.
    pub async fn set_active(&self, session_id: &str, client_id: Uuid) {
        let mut sessions = self.sessions.lock().await;
        let session = sessions
            .entry(session_id.to_string())
            .or_insert_with(SessionConsoleState::default);
        session.clients.insert(client_id);
        session.active_client_id = Some(client_id);
    }

    /// If no active client exists, promote this client.
    pub async fn set_active_if_none(&self, session_id: &str, client_id: Uuid) -> bool {
        let mut sessions = self.sessions.lock().await;
        let session = sessions
            .entry(session_id.to_string())
            .or_insert_with(SessionConsoleState::default);
        session.clients.insert(client_id);
        if session.active_client_id.is_none() {
            session.active_client_id = Some(client_id);
            return true;
        }
        false
    }

    /// Check whether a client is currently active.
    pub async fn is_active(&self, session_id: &str, client_id: Uuid) -> bool {
        let sessions = self.sessions.lock().await;
        sessions
            .get(session_id)
            .and_then(|session| session.active_client_id)
            .map_or(false, |active| active == client_id)
    }

    /// Unregister a client and clear active if needed.
    pub async fn unregister_client(&self, session_id: &str, client_id: Uuid) {
        let mut sessions = self.sessions.lock().await;
        let Some(session) = sessions.get_mut(session_id) else {
            return;
        };

        session.clients.remove(&client_id);
        if session.active_client_id == Some(client_id) {
            session.active_client_id = session.clients.iter().copied().next();
        }

        if session.clients.is_empty() {
            sessions.remove(session_id);
        }
    }
}
