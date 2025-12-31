//! Port allocation for per-session HTTP proxies.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU16, Ordering};
use tokio::sync::RwLock;
use uuid::Uuid;

/// Allocates unique proxy ports for sessions
pub struct PortAllocator {
    next_port: AtomicU16,
    allocated: RwLock<HashMap<u16, Uuid>>,
}

impl PortAllocator {
    const BASE_PORT: u16 = 18100;
    const MAX_SESSIONS: u16 = 500;

    /// Create a new port allocator
    pub fn new() -> Self {
        Self {
            next_port: AtomicU16::new(0),
            allocated: RwLock::new(HashMap::new()),
        }
    }

    /// Allocate a port for a session
    pub async fn allocate(&self, session_id: Uuid) -> anyhow::Result<u16> {
        let mut allocated = self.allocated.write().await;

        for _ in 0..Self::MAX_SESSIONS {
            let idx = self.next_port.fetch_add(1, Ordering::SeqCst);
            let port = Self::BASE_PORT + (idx % Self::MAX_SESSIONS);

            if !allocated.contains_key(&port) {
                allocated.insert(port, session_id);
                tracing::info!(port, session_id = %session_id, "Allocated proxy port");
                return Ok(port);
            }
        }

        anyhow::bail!("No available proxy ports (all {} in use)", Self::MAX_SESSIONS)
    }

    /// Release a port
    pub async fn release(&self, port: u16) {
        self.allocated.write().await.remove(&port);
        tracing::info!(port, "Released proxy port");
    }

    /// Get the session ID for a port
    pub async fn get_session_id(&self, port: u16) -> Option<Uuid> {
        self.allocated.read().await.get(&port).copied()
    }
}

impl Default for PortAllocator {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_allocation() {
        let allocator = PortAllocator::new();
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
        let allocator = PortAllocator::new();
        let session = Uuid::new_v4();

        let port = allocator.allocate(session).await.unwrap();
        assert_eq!(allocator.get_session_id(port).await, Some(session));

        allocator.release(port).await;
        assert_eq!(allocator.get_session_id(port).await, None);
    }

    #[tokio::test]
    async fn test_wraparound() {
        let allocator = PortAllocator::new();

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
