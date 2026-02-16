/// Claude Code agent implementation.
pub mod claude_code;
/// OpenAI Codex agent implementation.
pub mod codex;
/// Shared agent logic (prompt injection, credential setup).
pub mod common;
/// Google Gemini Code agent implementation.
pub mod gemini_code;
/// Agent trait definition and state types.
pub mod traits;

pub use claude_code::ClaudeCodeAgent;
pub use codex::CodexAgent;
pub use common::CommonAgentLogic;
pub use gemini_code::GeminiCodeAgent;
pub use traits::{Agent, AgentState};
