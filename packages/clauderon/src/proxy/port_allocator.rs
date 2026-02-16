//! Port allocation for per-session HTTP proxies.

use std::collections::HashMap;
use std::net::TcpListener;
use tokio::sync::RwLock;
use uuid::Uuid;

/// Allocates unique proxy ports for sessions
pub struct PortAllocator {
    state: RwLock<AllocatorState>,
}

impl std::fmt::Debug for PortAllocator {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PortAllocator").finish_non_exhaustive()
    }
}

struct AllocatorState {
    base_port: u16,
    next_port: u16,
    allocated: HashMap<u16, Uuid>,
}

impl PortAllocator {
    const BASE_PORT: u16 = 18100;
    const MAX_SESSIONS: u16 = 500;

    /// Create a new port allocator
    #[must_use]
    pub fn new(start_port: Option<u16>) -> Self {
        let base_port = start_port.unwrap_or(Self::BASE_PORT);
        Self {
            state: RwLock::new(AllocatorState {
                base_port,
                next_port: 0,
                allocated: HashMap::new(),
            }),
        }
    }

    /// Check if a port is actually available in the OS by trying to bind to it.
    fn is_port_available(port: u16) -> bool {
        TcpListener::bind(("127.0.0.1", port)).is_ok()
    }

    /// Allocate a port for a session
    pub async fn allocate(&self, session_id: Uuid) -> anyhow::Result<u16> {
        let mut state = self.state.write().await;

        for _ in 0..Self::MAX_SESSIONS {
            let port = state.base_port + (state.next_port % Self::MAX_SESSIONS);

            // Check if port is not already allocated internally AND is actually available in the OS
            if !state.allocated.contains_key(&port) && Self::is_port_available(port) {
                state.allocated.insert(port, session_id);
                state.next_port = state.next_port.wrapping_add(1);
                tracing::info!(port, session_id = %session_id, "Allocated proxy port");
                return Ok(port);
            }

            // Port already allocated or in use by another process, try next one
            state.next_port = state.next_port.wrapping_add(1);
        }

        anyhow::bail!(
            "No available proxy ports (all {} in use)",
            Self::MAX_SESSIONS
        )
    }

    /// Release a port
    pub async fn release(&self, port: u16) {
        self.state.write().await.allocated.remove(&port);
        tracing::info!(port, "Released proxy port");
    }

    /// Get the session ID for a port
    pub async fn get_session_id(&self, port: u16) -> Option<Uuid> {
        self.state.read().await.allocated.get(&port).copied()
    }

    /// Restore port allocations from database
    ///
    /// Called on daemon startup to restore in-memory state from persistent storage.
    /// Prevents port conflicts and maintains session-to-port mappings across restarts.
    pub async fn restore_allocations(&self, allocations: Vec<(u16, Uuid)>) -> anyhow::Result<()> {
        let mut state = self.state.write().await;

        for (port, session_id) in allocations {
            // Validate port is in our range
            if port < state.base_port || port >= state.base_port + Self::MAX_SESSIONS {
                tracing::warn!(
                    port,
                    session_id = %session_id,
                    "Skipping invalid port allocation from database (out of range)"
                );
                continue;
            }

            state.allocated.insert(port, session_id);
            tracing::debug!(port, session_id = %session_id, "Restored port allocation");
        }

        // Update next_port to avoid collisions with restored allocations
        if let Some(&max_port) = state.allocated.keys().max() {
            state.next_port = (max_port - state.base_port + 1) % Self::MAX_SESSIONS;
        }

        tracing::info!(
            count = state.allocated.len(),
            "Restored {} port allocations from database",
            state.allocated.len()
        );

        Ok(())
    }
}

impl Default for PortAllocator {
    fn default() -> Self {
        Self::new(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_allocation() {
        let allocator = PortAllocator::new(None);
        let session1 = Uuid::new_v4();
        let session2 = Uuid::new_v4();

        let port1 = allocator.allocate(session1).await.unwrap();
        let port2 = allocator.allocate(session2).await.unwrap();

        assert_ne!(port1, port2);
        assert_eq!(allocator.get_session_id(port1).await, Some(session1));
        assert_eq!(allocator.get_session_id(port2).await, Some(session2));
    }

    #[tokio::test]
    async fn test_release() {
        let allocator = PortAllocator::new(None);
        let session = Uuid::new_v4();

        let port = allocator.allocate(session).await.unwrap();
        assert_eq!(allocator.get_session_id(port).await, Some(session));

        allocator.release(port).await;
        assert_eq!(allocator.get_session_id(port).await, None);
    }

    #[tokio::test]
    async fn test_wraparound() {
        let allocator = PortAllocator::new(None);

        // Allocate many ports
        for _ in 0..10 {
            let session = Uuid::new_v4();
            allocator.allocate(session).await.unwrap();
        }

        // Should still work (wraparound)
        let session = Uuid::new_v4();
        let result = allocator.allocate(session).await;
        assert!(result.is_ok());
    }
}
