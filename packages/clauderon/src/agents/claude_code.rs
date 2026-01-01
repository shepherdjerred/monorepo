use std::time::{Duration, Instant};

use super::traits::{Agent, AgentState};

/// Patterns that indicate Claude is actively working
const WORKING_PATTERNS: &[&str] = &[
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

/// Patterns that indicate Claude is waiting for input
const IDLE_PATTERNS: &[&str] = &[
    ">", // Claude's input prompt
    "What would you like",
    "Is there anything else",
    "Let me know",
    "How can I help",
    "Do you want me to",
    "Shall I",
];

/// Claude Code agent adapter
pub struct ClaudeCodeAgent {
    /// Timestamp of last detected activity
    last_activity: Instant,

    /// Last known state
    last_known_state: AgentState,

    /// Timeout for considering agent idle (no activity)
    idle_timeout: Duration,
}

impl ClaudeCodeAgent {
    /// Create a new Claude Code agent adapter
    #[must_use]
    pub fn new() -> Self {
        Self {
            last_activity: Instant::now(),
            last_known_state: AgentState::Unknown,
            idle_timeout: Duration::from_secs(30),
        }
    }

    /// Update state based on terminal output
    pub fn process_output(&mut self, output: &str) -> AgentState {
        let state = self.detect_state(output);

        if state == AgentState::Working {
            self.last_activity = Instant::now();
            self.last_known_state = state;
        } else if state == AgentState::Idle {
            self.last_known_state = state;
        } else if self.last_activity.elapsed() > self.idle_timeout {
            // No activity for a while, probably idle
            self.last_known_state = AgentState::Idle;
        }

        self.last_known_state
    }

    /// Get the current inferred state
    #[must_use]
    pub const fn current_state(&self) -> AgentState {
        self.last_known_state
    }
}

impl Default for ClaudeCodeAgent {
    fn default() -> Self {
        Self::new()
    }
}

impl Agent for ClaudeCodeAgent {
    fn detect_state(&self, output: &str) -> AgentState {
        // Check for working patterns first (higher priority)
        if WORKING_PATTERNS.iter().any(|p| output.contains(p)) {
            return AgentState::Working;
        }

        // Check for idle patterns
        if IDLE_PATTERNS.iter().any(|p| output.contains(p)) {
            return AgentState::Idle;
        }

        AgentState::Unknown
    }

    fn start_command(&self, prompt: &str, images: &[String]) -> Vec<String> {
        let mut cmd = vec![
            "claude".to_string(),
            "--dangerously-skip-permissions".to_string(),
        ];

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

    // ========== detect_state tests ==========

    #[test]
    fn test_detect_state_working_thinking() {
        let agent = ClaudeCodeAgent::new();
        assert_eq!(agent.detect_state("Thinking..."), AgentState::Working);
    }

    #[test]
    fn test_detect_state_working_reading_file() {
        let agent = ClaudeCodeAgent::new();
        assert_eq!(agent.detect_state("Reading file"), AgentState::Working);
    }

    #[test]
    fn test_detect_state_working_writing_file() {
        let agent = ClaudeCodeAgent::new();
        assert_eq!(agent.detect_state("Writing file"), AgentState::Working);
    }

    #[test]
    fn test_detect_state_working_running_command() {
        let agent = ClaudeCodeAgent::new();
        assert_eq!(agent.detect_state("Running command"), AgentState::Working);
    }

    #[test]
    fn test_detect_state_working_searching() {
        let agent = ClaudeCodeAgent::new();
        assert_eq!(agent.detect_state("Searching"), AgentState::Working);
    }

    #[test]
    fn test_detect_state_working_analyzing() {
        let agent = ClaudeCodeAgent::new();
        assert_eq!(agent.detect_state("Analyzing"), AgentState::Working);
    }

    #[test]
    fn test_detect_state_working_processing() {
        let agent = ClaudeCodeAgent::new();
        assert_eq!(agent.detect_state("Processing"), AgentState::Working);
    }

    #[test]
    fn test_detect_state_working_updating() {
        let agent = ClaudeCodeAgent::new();
        assert_eq!(agent.detect_state("Updating"), AgentState::Working);
    }

    #[test]
    fn test_detect_state_working_creating() {
        let agent = ClaudeCodeAgent::new();
        assert_eq!(agent.detect_state("Creating"), AgentState::Working);
    }

    #[test]
    fn test_detect_state_working_modifying() {
        let agent = ClaudeCodeAgent::new();
        assert_eq!(agent.detect_state("Modifying"), AgentState::Working);
    }

    #[test]
    fn test_detect_state_all_working_patterns() {
        let agent = ClaudeCodeAgent::new();
        for pattern in WORKING_PATTERNS {
            assert_eq!(
                agent.detect_state(pattern),
                AgentState::Working,
                "Pattern '{}' should be detected as Working",
                pattern
            );
        }
    }

    #[test]
    fn test_detect_state_idle_prompt() {
        let agent = ClaudeCodeAgent::new();
        assert_eq!(agent.detect_state(">"), AgentState::Idle);
    }

    #[test]
    fn test_detect_state_idle_what_would_you_like() {
        let agent = ClaudeCodeAgent::new();
        assert_eq!(
            agent.detect_state("What would you like"),
            AgentState::Idle
        );
    }

    #[test]
    fn test_detect_state_idle_is_there_anything_else() {
        let agent = ClaudeCodeAgent::new();
        assert_eq!(
            agent.detect_state("Is there anything else"),
            AgentState::Idle
        );
    }

    #[test]
    fn test_detect_state_idle_let_me_know() {
        let agent = ClaudeCodeAgent::new();
        assert_eq!(agent.detect_state("Let me know"), AgentState::Idle);
    }

    #[test]
    fn test_detect_state_idle_how_can_i_help() {
        let agent = ClaudeCodeAgent::new();
        assert_eq!(agent.detect_state("How can I help"), AgentState::Idle);
    }

    #[test]
    fn test_detect_state_idle_do_you_want_me_to() {
        let agent = ClaudeCodeAgent::new();
        assert_eq!(agent.detect_state("Do you want me to"), AgentState::Idle);
    }

    #[test]
    fn test_detect_state_idle_shall_i() {
        let agent = ClaudeCodeAgent::new();
        assert_eq!(agent.detect_state("Shall I"), AgentState::Idle);
    }

    #[test]
    fn test_detect_state_all_idle_patterns() {
        let agent = ClaudeCodeAgent::new();
        for pattern in IDLE_PATTERNS {
            assert_eq!(
                agent.detect_state(pattern),
                AgentState::Idle,
                "Pattern '{}' should be detected as Idle",
                pattern
            );
        }
    }

    #[test]
    fn test_detect_state_unknown_random_text() {
        let agent = ClaudeCodeAgent::new();
        assert_eq!(
            agent.detect_state("some random output text"),
            AgentState::Unknown
        );
    }

    #[test]
    fn test_detect_state_unknown_empty_string() {
        let agent = ClaudeCodeAgent::new();
        assert_eq!(agent.detect_state(""), AgentState::Unknown);
    }

    #[test]
    fn test_detect_state_unknown_whitespace() {
        let agent = ClaudeCodeAgent::new();
        assert_eq!(agent.detect_state("   \n\t  "), AgentState::Unknown);
    }

    // ========== Pattern priority tests ==========

    #[test]
    fn test_detect_state_working_takes_priority_over_idle() {
        let agent = ClaudeCodeAgent::new();
        // Output contains both working and idle patterns
        let output = "Thinking... What would you like me to do?";
        assert_eq!(
            agent.detect_state(output),
            AgentState::Working,
            "Working patterns should take priority over idle patterns"
        );
    }

    // ========== Pattern embedded in text tests ==========

    #[test]
    fn test_detect_state_working_embedded_in_sentence() {
        let agent = ClaudeCodeAgent::new();
        assert_eq!(
            agent.detect_state("I am currently Thinking... about the problem"),
            AgentState::Working
        );
    }

    #[test]
    fn test_detect_state_idle_embedded_in_sentence() {
        let agent = ClaudeCodeAgent::new();
        assert_eq!(
            agent.detect_state("Is there anything else I can help with?"),
            AgentState::Idle
        );
    }

    #[test]
    fn test_detect_state_prompt_embedded_in_line() {
        let agent = ClaudeCodeAgent::new();
        // The > pattern is very short and can match in many contexts
        assert_eq!(agent.detect_state("user@host:~/dir> "), AgentState::Idle);
    }

    // ========== Case sensitivity tests ==========

    #[test]
    fn test_detect_state_case_sensitive_working() {
        let agent = ClaudeCodeAgent::new();
        // "thinking..." (lowercase) should NOT match "Thinking..."
        assert_eq!(agent.detect_state("thinking..."), AgentState::Unknown);
    }

    #[test]
    fn test_detect_state_case_sensitive_idle() {
        let agent = ClaudeCodeAgent::new();
        // "what would you like" (lowercase) should NOT match "What would you like"
        assert_eq!(
            agent.detect_state("what would you like"),
            AgentState::Unknown
        );
    }

    // ========== start_command tests ==========

    #[test]
    fn test_start_command_basic() {
        let agent = ClaudeCodeAgent::new();
        let cmd = agent.start_command("Fix the bug", &[]);
        assert_eq!(cmd.len(), 3);
        assert_eq!(cmd[0], "claude");
        assert_eq!(cmd[1], "--dangerously-skip-permissions");
        assert_eq!(cmd[2], "Fix the bug");
    }

    #[test]
    fn test_start_command_empty_prompt() {
        let agent = ClaudeCodeAgent::new();
        let cmd = agent.start_command("", &[]);
        assert_eq!(cmd.len(), 3);
        assert_eq!(cmd[0], "claude");
        assert_eq!(cmd[1], "--dangerously-skip-permissions");
        assert_eq!(cmd[2], "");
    }

    #[test]
    fn test_start_command_prompt_with_special_chars() {
        let agent = ClaudeCodeAgent::new();
        let prompt = "Fix the bug in 'login.ts' && run tests";
        let cmd = agent.start_command(prompt, &[]);
        assert_eq!(cmd[2], prompt);
    }

    #[test]
    fn test_start_command_multiline_prompt() {
        let agent = ClaudeCodeAgent::new();
        let prompt = "Fix the bug\nThen run tests\nAnd update docs";
        let cmd = agent.start_command(prompt, &[]);
        assert_eq!(cmd[2], prompt);
    }

    #[test]
    fn test_start_command_with_images() {
        let agent = ClaudeCodeAgent::new();
        let images = vec!["/path/to/image1.png".to_string(), "/path/to/image2.jpg".to_string()];
        let cmd = agent.start_command("Analyze these images", &images);
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

    #[test]
    fn test_process_output_unknown_keeps_previous_state() {
        let mut agent = ClaudeCodeAgent::new();
        // First set to working
        agent.process_output("Thinking...");
        assert_eq!(agent.current_state(), AgentState::Working);
        // Then process unknown output - should stay working (until timeout)
        let state = agent.process_output("some random text");
        // State returned might still be Working if timeout hasn't elapsed
        assert_eq!(agent.current_state(), AgentState::Working);
        assert_eq!(state, AgentState::Working);
    }

    #[test]
    fn test_process_output_working_to_idle() {
        let mut agent = ClaudeCodeAgent::new();
        agent.process_output("Thinking...");
        assert_eq!(agent.current_state(), AgentState::Working);
        agent.process_output("What would you like");
        assert_eq!(agent.current_state(), AgentState::Idle);
    }

    #[test]
    fn test_process_output_idle_to_working() {
        let mut agent = ClaudeCodeAgent::new();
        agent.process_output("What would you like");
        assert_eq!(agent.current_state(), AgentState::Idle);
        agent.process_output("Thinking...");
        assert_eq!(agent.current_state(), AgentState::Working);
    }
}
