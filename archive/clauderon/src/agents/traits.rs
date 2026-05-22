use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use typeshare::typeshare;

/// Current state of an AI agent
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AgentState {
    /// Agent is actively working on a task
    Working,

    /// Agent is waiting for user input
    Idle,

    /// Agent state is unknown
    Unknown,
}

/// Trait for AI agent adapters
#[async_trait]
pub trait Agent: Send + Sync {
    /// Get the current state of the agent by analyzing output
    fn detect_state(&self, output: &str) -> AgentState;

    /// Get the command to start the agent with a prompt and optional images
    ///
    /// # Arguments
    /// * `prompt` - The initial prompt for the agent
    /// * `images` - List of image paths to include
    /// * `dangerous_skip_checks` - Whether to skip permission checks
    /// * `session_id` - Optional session ID for resuming
    /// * `model` - Optional model CLI flag value (e.g., "sonnet", "gpt-4o", "gemini-2.5-pro")
    fn start_command(
        &self,
        prompt: &str,
        images: &[String],
        dangerous_skip_checks: bool,
        session_id: Option<&uuid::Uuid>,
        model: Option<&str>,
    ) -> Vec<String>;
}
