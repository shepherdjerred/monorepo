use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::traits::AgentState;

/// Patterns that indicate the agent is actively working
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

/// Patterns that indicate the agent is waiting for input
const IDLE_PATTERNS: &[&str] = &[
    ">", // Agent's input prompt
    "What would you like",
    "Is there anything else",
    "Let me know",
    "How can I help",
    "Do you want me to",
    "Shall I",
];

/// Common logic for AI agent adapters
#[derive(Debug, Copy, Clone)]
pub struct CommonAgentLogic {
    /// Timestamp of last detected activity
    last_activity: Instant,

    /// Last known state
    last_known_state: AgentState,

    /// Timeout for considering agent idle (no activity)
    idle_timeout: Duration,
}

impl CommonAgentLogic {
    /// Create a new CommonAgentLogic instance
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

    /// Detect the state of the agent based on the output.
    #[must_use]
    pub fn detect_state(&self, output: &str) -> AgentState {
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
}

impl Default for CommonAgentLogic {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ========== detect_state tests ==========

    #[test]
    fn test_detect_state_working_thinking() {
        let logic = CommonAgentLogic::new();
        assert_eq!(logic.detect_state("Thinking..."), AgentState::Working);
    }

    #[test]
    fn test_detect_state_working_reading_file() {
        let logic = CommonAgentLogic::new();
        assert_eq!(logic.detect_state("Reading file"), AgentState::Working);
    }

    #[test]
    fn test_detect_state_working_writing_file() {
        let logic = CommonAgentLogic::new();
        assert_eq!(logic.detect_state("Writing file"), AgentState::Working);
    }

    #[test]
    fn test_detect_state_working_running_command() {
        let logic = CommonAgentLogic::new();
        assert_eq!(logic.detect_state("Running command"), AgentState::Working);
    }

    #[test]
    fn test_detect_state_working_searching() {
        let logic = CommonAgentLogic::new();
        assert_eq!(logic.detect_state("Searching"), AgentState::Working);
    }

    #[test]
    fn test_detect_state_working_analyzing() {
        let logic = CommonAgentLogic::new();
        assert_eq!(logic.detect_state("Analyzing"), AgentState::Working);
    }

    #[test]
    fn test_detect_state_working_processing() {
        let logic = CommonAgentLogic::new();
        assert_eq!(logic.detect_state("Processing"), AgentState::Working);
    }

    #[test]
    fn test_detect_state_working_updating() {
        let logic = CommonAgentLogic::new();
        assert_eq!(logic.detect_state("Updating"), AgentState::Working);
    }

    #[test]
    fn test_detect_state_working_creating() {
        let logic = CommonAgentLogic::new();
        assert_eq!(logic.detect_state("Creating"), AgentState::Working);
    }

    #[test]
    fn test_detect_state_working_modifying() {
        let logic = CommonAgentLogic::new();
        assert_eq!(logic.detect_state("Modifying"), AgentState::Working);
    }

    #[test]
    fn test_detect_state_all_working_patterns() {
        let logic = CommonAgentLogic::new();
        for pattern in WORKING_PATTERNS {
            assert_eq!(
                logic.detect_state(pattern),
                AgentState::Working,
                "Pattern '{pattern}' should be detected as Working"
            );
        }
    }

    #[test]
    fn test_detect_state_idle_prompt() {
        let logic = CommonAgentLogic::new();
        assert_eq!(logic.detect_state(">"), AgentState::Idle);
    }

    #[test]
    fn test_detect_state_idle_what_would_you_like() {
        let logic = CommonAgentLogic::new();
        assert_eq!(logic.detect_state("What would you like"), AgentState::Idle);
    }

    #[test]
    fn test_detect_state_idle_is_there_anything_else() {
        let logic = CommonAgentLogic::new();
        assert_eq!(
            logic.detect_state("Is there anything else"),
            AgentState::Idle
        );
    }

    #[test]
    fn test_detect_state_idle_let_me_know() {
        let logic = CommonAgentLogic::new();
        assert_eq!(logic.detect_state("Let me know"), AgentState::Idle);
    }

    #[test]
    fn test_detect_state_idle_how_can_i_help() {
        let logic = CommonAgentLogic::new();
        assert_eq!(logic.detect_state("How can I help"), AgentState::Idle);
    }

    #[test]
    fn test_detect_state_idle_do_you_want_me_to() {
        let logic = CommonAgentLogic::new();
        assert_eq!(logic.detect_state("Do you want me to"), AgentState::Idle);
    }

    #[test]
    fn test_detect_state_idle_shall_i() {
        let logic = CommonAgentLogic::new();
        assert_eq!(logic.detect_state("Shall I"), AgentState::Idle);
    }

    #[test]
    fn test_detect_state_all_idle_patterns() {
        let logic = CommonAgentLogic::new();
        for pattern in IDLE_PATTERNS {
            assert_eq!(
                logic.detect_state(pattern),
                AgentState::Idle,
                "Pattern '{pattern}' should be detected as Idle"
            );
        }
    }

    #[test]
    fn test_detect_state_unknown_random_text() {
        let logic = CommonAgentLogic::new();
        assert_eq!(
            logic.detect_state("some random output text"),
            AgentState::Unknown
        );
    }

    #[test]
    fn test_detect_state_unknown_empty_string() {
        let logic = CommonAgentLogic::new();
        assert_eq!(logic.detect_state(""), AgentState::Unknown);
    }

    #[test]
    fn test_detect_state_unknown_whitespace() {
        let logic = CommonAgentLogic::new();
        assert_eq!(logic.detect_state("   \n\t  "), AgentState::Unknown);
    }

    // ========== Pattern priority tests ==========

    #[test]
    fn test_detect_state_working_takes_priority_over_idle() {
        let logic = CommonAgentLogic::new();
        // Output contains both working and idle patterns
        let output = "Thinking... What would you like me to do?";
        assert_eq!(
            logic.detect_state(output),
            AgentState::Working,
            "Working patterns should take priority over idle patterns"
        );
    }

    // ========== Pattern embedded in text tests ==========

    #[test]
    fn test_detect_state_working_embedded_in_sentence() {
        let logic = CommonAgentLogic::new();
        assert_eq!(
            logic.detect_state("I am currently Thinking... about the problem"),
            AgentState::Working
        );
    }

    #[test]
    fn test_detect_state_idle_embedded_in_sentence() {
        let logic = CommonAgentLogic::new();
        assert_eq!(
            logic.detect_state("Is there anything else I can help with?"),
            AgentState::Idle
        );
    }

    #[test]
    fn test_detect_state_prompt_embedded_in_line() {
        let logic = CommonAgentLogic::new();
        // The > pattern is very short and can match in many contexts
        assert_eq!(logic.detect_state("user@host:~/dir> "), AgentState::Idle);
    }

    // ========== Case sensitivity tests ==========

    #[test]
    fn test_detect_state_case_sensitive_working() {
        let logic = CommonAgentLogic::new();
        // "thinking..." (lowercase) should NOT match "Thinking..."
        assert_eq!(logic.detect_state("thinking..."), AgentState::Unknown);
    }

    #[test]
    fn test_detect_state_case_sensitive_idle() {
        let logic = CommonAgentLogic::new();
        // "what would you like" (lowercase) should NOT match "What would you like"
        assert_eq!(
            logic.detect_state("what would you like"),
            AgentState::Unknown
        );
    }
}
