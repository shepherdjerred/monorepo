use super::common::CommonAgentLogic;
use super::traits::{Agent, AgentState};

/// Codex agent adapter
pub struct CodexAgent {
    /// Common agent logic
    common_logic: CommonAgentLogic,
}

impl CodexAgent {
    /// Create a new Codex agent adapter
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

impl Default for CodexAgent {
    fn default() -> Self {
        Self::new()
    }
}

impl Agent for CodexAgent {
    fn detect_state(&self, output: &str) -> AgentState {
        self.common_logic.detect_state(output)
    }

    fn start_command(
        &self,
        prompt: &str,
        images: &[String],
        dangerous_skip_checks: bool,
        session_id: Option<&uuid::Uuid>,
        model: Option<&str>,
    ) -> Vec<String> {
        let mut cmd = vec!["codex".to_string()];

        // Add session ID first if provided
        if let Some(id) = session_id {
            cmd.push("--session-id".to_string());
            cmd.push(id.to_string());
        }

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

#[cfg(test)]
mod tests {
    use super::*;

    // ========== start_command tests ==========

    #[test]
    fn test_start_command_basic_with_full_auto() {
        let agent = CodexAgent::new();
        let cmd = agent.start_command("Fix the bug", &[], true, None);
        assert_eq!(cmd.len(), 3);
        assert_eq!(cmd[0], "codex");
        assert_eq!(cmd[1], "--full-auto");
        assert_eq!(cmd[2], "Fix the bug");
    }

    #[test]
    fn test_start_command_basic_without_full_auto() {
        let agent = CodexAgent::new();
        let cmd = agent.start_command("Fix the bug", &[], false, None);
        assert_eq!(cmd.len(), 2);
        assert_eq!(cmd[0], "codex");
        assert_eq!(cmd[1], "Fix the bug");
    }

    #[test]
    fn test_start_command_with_images_and_full_auto() {
        let agent = CodexAgent::new();
        let images = vec![
            "/path/to/image1.png".to_string(),
            "/path/to/image2.jpg".to_string(),
        ];
        let cmd = agent.start_command("Analyze these images", &images, true, None);
        assert_eq!(cmd.len(), 7); // codex, --full-auto, --image, path1, --image, path2, prompt
        assert_eq!(cmd[0], "codex");
        assert_eq!(cmd[1], "--full-auto");
        assert_eq!(cmd[2], "--image");
        assert_eq!(cmd[3], "/path/to/image1.png");
        assert_eq!(cmd[4], "--image");
        assert_eq!(cmd[5], "/path/to/image2.jpg");
        assert_eq!(cmd[6], "Analyze these images");
    }

    #[test]
    fn test_start_command_with_session_id() {
        let agent = CodexAgent::new();
        let session_id = uuid::Uuid::new_v4();
        let cmd = agent.start_command("Test prompt", &[], false, Some(&session_id));
        assert_eq!(cmd.len(), 4); // codex, --session-id, <uuid>, prompt
        assert_eq!(cmd[0], "codex");
        assert_eq!(cmd[1], "--session-id");
        assert_eq!(cmd[2], session_id.to_string());
        assert_eq!(cmd[3], "Test prompt");
    }

    #[test]
    fn test_start_command_with_session_id_and_full_auto() {
        let agent = CodexAgent::new();
        let session_id = uuid::Uuid::new_v4();
        let cmd = agent.start_command("Test prompt", &[], true, Some(&session_id));
        assert_eq!(cmd.len(), 5); // codex, --session-id, <uuid>, --full-auto, prompt
        assert_eq!(cmd[0], "codex");
        assert_eq!(cmd[1], "--session-id");
        assert_eq!(cmd[2], session_id.to_string());
        assert_eq!(cmd[3], "--full-auto");
        assert_eq!(cmd[4], "Test prompt");
    }

    #[test]
    fn test_start_command_empty_prompt() {
        let agent = CodexAgent::new();
        let cmd = agent.start_command("", &[], false, None);
        assert_eq!(cmd.len(), 1); // Just "codex", no prompt
        assert_eq!(cmd[0], "codex");
    }

    // ========== new and default tests ==========

    #[test]
    fn test_new_initial_state() {
        let agent = CodexAgent::new();
        assert_eq!(agent.current_state(), AgentState::Unknown);
    }

    #[test]
    fn test_default_same_as_new() {
        let agent1 = CodexAgent::new();
        let agent2 = CodexAgent::default();
        assert_eq!(agent1.current_state(), agent2.current_state());
    }

    // ========== process_output state transitions ==========

    #[test]
    fn test_process_output_working_updates_state() {
        let mut agent = CodexAgent::new();
        let state = agent.process_output("Thinking...");
        assert_eq!(state, AgentState::Working);
        assert_eq!(agent.current_state(), AgentState::Working);
    }

    #[test]
    fn test_process_output_idle_updates_state() {
        let mut agent = CodexAgent::new();
        let state = agent.process_output("What would you like");
        assert_eq!(state, AgentState::Idle);
        assert_eq!(agent.current_state(), AgentState::Idle);
    }

    #[test]
    fn test_process_output_unknown_maintains_state() {
        let mut agent = CodexAgent::new();
        let state = agent.process_output("some random text");
        assert_eq!(state, AgentState::Unknown);
        assert_eq!(agent.current_state(), AgentState::Unknown);
    }

    // ========== detect_state tests ==========

    #[test]
    fn test_detect_state_working_patterns() {
        let agent = CodexAgent::new();
        let working_patterns = [
            "Thinking...",
            "Reading file",
            "Writing file",
            "Running command",
            "Searching",
            "Analyzing",
            "Processing",
            "Updating",
            "Creating",
            "Modifying",
        ];

        for pattern in &working_patterns {
            assert_eq!(
                agent.detect_state(pattern),
                AgentState::Working,
                "Pattern '{}' should be detected as Working",
                pattern
            );
        }
    }

    #[test]
    fn test_detect_state_idle_patterns() {
        let agent = CodexAgent::new();
        let idle_patterns = [
            ">",
            "What would you like",
            "Is there anything else",
            "Let me know",
            "How can I help",
            "Do you want me to",
            "Shall I",
        ];

        for pattern in &idle_patterns {
            assert_eq!(
                agent.detect_state(pattern),
                AgentState::Idle,
                "Pattern '{}' should be detected as Idle",
                pattern
            );
        }
    }

    #[test]
    fn test_detect_state_unknown() {
        let agent = CodexAgent::new();
        assert_eq!(agent.detect_state("random text"), AgentState::Unknown);
        assert_eq!(agent.detect_state(""), AgentState::Unknown);
    }

    #[test]
    fn test_detect_state_working_takes_priority() {
        let agent = CodexAgent::new();
        // Output contains both working and idle patterns
        let output = "Thinking... What would you like me to do?";
        assert_eq!(
            agent.detect_state(output),
            AgentState::Working,
            "Working patterns should take priority over idle patterns"
        );
    }
}
