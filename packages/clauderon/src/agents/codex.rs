use super::traits::{Agent, AgentState};

/// Codex agent adapter
pub struct CodexAgent;

impl CodexAgent {
    /// Create a new Codex agent adapter
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

impl Default for CodexAgent {
    fn default() -> Self {
        Self::new()
    }
}

impl Agent for CodexAgent {
    fn detect_state(&self, _output: &str) -> AgentState {
        // TODO: Add Codex-specific output patterns when available
        AgentState::Unknown
    }

    fn start_command(
        &self,
        prompt: &str,
        images: &[String],
        dangerous_skip_checks: bool,
        _session_id: Option<&uuid::Uuid>,
        model: Option<&str>,
    ) -> Vec<String> {
        let mut cmd = vec!["codex".to_string()];

        // Add model flag if provided
        if let Some(model_name) = model {
            cmd.push("--model".to_string());
            cmd.push(model_name.to_string());
        }

        // Use full auto mode when dangerous skip checks is enabled
        if dangerous_skip_checks {
            cmd.push("--full-auto".to_string());
        }

        // Add image arguments
        for image in images {
            cmd.push("--image".to_string());
            cmd.push(image.clone());
        }

        // Add prompt last
        if !prompt.is_empty() {
            cmd.push(prompt.to_string());
        }

        cmd
    }
}
