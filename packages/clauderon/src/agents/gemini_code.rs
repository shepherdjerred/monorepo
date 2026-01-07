use super::common::CommonAgentLogic;
use super::traits::{Agent, AgentState};

/// Gemini Code agent adapter
pub struct GeminiCodeAgent {
    /// Common agent logic
    common_logic: CommonAgentLogic,
}

impl GeminiCodeAgent {
    /// Create a new Gemini Code agent adapter
    #[must_use]
    pub fn new() -> Self {
        Self {
            common_logic: CommonAgentLogic::new(),
        }
    }

    /// Update state based on terminal output
    pub fn process_output(&mut self, output: &str) -> AgentState {
        self.common_logic.process_output(output)
    }

    /// Get the current inferred state
    #[must_use]
    pub const fn current_state(&self) -> AgentState {
        self.common_logic.current_state()
    }
}

impl Default for GeminiCodeAgent {
    fn default() -> Self {
        Self::new()
    }
}

impl Agent for GeminiCodeAgent {
    fn detect_state(&self, output: &str) -> AgentState {
        self.common_logic.detect_state(output)
    }

    fn start_command(
        &self,
        prompt: &str,
        images: &[String],
        dangerous_skip_checks: bool,
        session_id: Option<&uuid::Uuid>,
    ) -> Vec<String> {
        let mut cmd = vec!["gemini".to_string()];

        // Add session ID first if provided
        if let Some(id) = session_id {
            cmd.push("--session-id".to_string());
            cmd.push(id.to_string());
        }

        // Only add flag if dangerous_skip_checks is enabled
        if dangerous_skip_checks {
            cmd.push("--dangerously-skip-permissions".to_string());
        }

        // Add image arguments
        for image in images {
            cmd.push("--image".to_string());
            cmd.push(image.clone());
        }

        // Add prompt last
        cmd.push(prompt.to_string());

        cmd
    }
}
