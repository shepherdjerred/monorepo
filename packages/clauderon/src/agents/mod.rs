pub mod claude_code;
pub mod codex;
pub mod common;
pub mod gemini_code;
pub mod instructions;
pub mod traits;

pub use claude_code::ClaudeCodeAgent;
pub use codex::CodexAgent;
pub use common::CommonAgentLogic;
pub use gemini_code::GeminiCodeAgent;
pub use instructions::auto_code_instructions;
pub use traits::{Agent, AgentState};
