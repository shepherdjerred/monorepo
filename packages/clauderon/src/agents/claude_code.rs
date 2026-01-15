use super::common::CommonAgentLogic;
use super::traits::{Agent, AgentState};

/// Claude Code agent adapter
pub struct ClaudeCodeAgent {
    /// Common agent logic
    common_logic: CommonAgentLogic,
}

impl ClaudeCodeAgent {
    /// Create a new Claude Code agent adapter
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

impl Default for ClaudeCodeAgent {
    fn default() -> Self {
        Self::new()
    }
}

impl Agent for ClaudeCodeAgent {
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
        let mut cmd = vec!["claude".to_string()];

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

#[cfg(test)]
mod tests {
    use super::*;

    // ========== start_command tests ==========

    #[test]
    fn test_start_command_basic_with_dangerous_skip() {
        let agent = ClaudeCodeAgent::new();
        let cmd = agent.start_command("Fix the bug", &[], true, None);
        assert_eq!(cmd.len(), 3);
        assert_eq!(cmd[0], "claude");
        assert_eq!(cmd[1], "--dangerously-skip-permissions");
        assert_eq!(cmd[2], "Fix the bug");
    }

    #[test]
    fn test_start_command_basic_without_dangerous_skip() {
        let agent = ClaudeCodeAgent::new();
        let cmd = agent.start_command("Fix the bug", &[], false, None);
        assert_eq!(cmd.len(), 2);
        assert_eq!(cmd[0], "claude");
        assert_eq!(cmd[1], "Fix the bug");
    }

    #[test]
    fn test_start_command_with_images_and_dangerous_skip() {
        let agent = ClaudeCodeAgent::new();
        let images = vec![
            "/path/to/image1.png".to_string(),
            "/path/to/image2.jpg".to_string(),
        ];
        let cmd = agent.start_command("Analyze these images", &images, true, None);
        assert_eq!(cmd.len(), 7); // claude, --dangerously-skip-permissions, --image, path1, --image, path2, prompt
        assert_eq!(cmd[0], "claude");
        assert_eq!(cmd[1], "--dangerously-skip-permissions");
        assert_eq!(cmd[2], "--image");
        assert_eq!(cmd[3], "/path/to/image1.png");
        assert_eq!(cmd[4], "--image");
        assert_eq!(cmd[5], "/path/to/image2.jpg");
        assert_eq!(cmd[6], "Analyze these images");
    }

    // ========== new and default tests ==========

    #[test]
    fn test_new_initial_state() {
        let agent = ClaudeCodeAgent::new();
        assert_eq!(agent.current_state(), AgentState::Unknown);
    }

    #[test]
    fn test_default_same_as_new() {
        let agent1 = ClaudeCodeAgent::new();
        let agent2 = ClaudeCodeAgent::default();
        assert_eq!(agent1.current_state(), agent2.current_state());
    }

    // ========== process_output state transitions ==========

    #[test]
    fn test_process_output_working_updates_state() {
        let mut agent = ClaudeCodeAgent::new();
        let state = agent.process_output("Thinking...");
        assert_eq!(state, AgentState::Working);
        assert_eq!(agent.current_state(), AgentState::Working);
    }

    #[test]
    fn test_process_output_idle_updates_state() {
        let mut agent = ClaudeCodeAgent::new();
        let state = agent.process_output("What would you like");
        assert_eq!(state, AgentState::Idle);
        assert_eq!(agent.current_state(), AgentState::Idle);
    }
}
