use async_trait::async_trait;
use std::path::Path;

/// Trait for execution backends
#[async_trait]
pub trait Backend: Send + Sync {
    /// Create a new session/container
    async fn create(&self, name: &str, workdir: &Path, initial_prompt: &str)
        -> anyhow::Result<String>;

    /// Check if a session/container exists
    async fn exists(&self, id: &str) -> anyhow::Result<bool>;

    /// Delete a session/container
    async fn delete(&self, id: &str) -> anyhow::Result<()>;

    /// Get the command to attach to a session/container
    fn attach_command(&self, id: &str) -> Vec<String>;

    /// Get recent output from the session/container
    async fn get_output(&self, id: &str, lines: usize) -> anyhow::Result<String>;
}
