/// Claude Code agent adapter.
pub mod claude_code;
/// OpenAI Codex agent adapter.
pub mod codex;
/// Shared agent logic for state detection.
pub mod common;
/// Gemini Code agent adapter.
pub mod gemini_code;
/// Agent trait and state definitions.
pub mod traits;

pub use claude_code::ClaudeCodeAgent;
pub use codex::CodexAgent;
pub use common::CommonAgentLogic;
pub use gemini_code::GeminiCodeAgent;
pub use traits::{Agent, AgentState};
