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

    /// Get the command to start the agent with a prompt
    fn start_command(&self, prompt: &str) -> Vec<String>;
}
