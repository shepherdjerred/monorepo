# Agent Feature Parity Audit & Implementation Plan

## Executive Summary

After comprehensive audit of all agents in Clauderon, I found **three critical feature parity gaps in the Codex agent**:
1. **No state detection** - Always returns `Unknown` instead of Working/Idle
2. **No session ID support** - Parameter ignored (prefixed with `_`)
3. **No CommonAgentLogic** - Unit struct with no internal state tracking

Additionally, **feature limitations are not documented in the web UI**, making it unclear to users which capabilities each agent supports.

This plan addresses both the technical implementation gaps and the user-facing documentation needs.

## Current State Analysis

### Agents in Clauderon

Three AI coding agents exist in `/workspace/packages/clauderon/src/agents/`:

1. **ClaudeCodeAgent** (claude_code.rs) - ✅ Full feature set
2. **GeminiCodeAgent** (gemini_code.rs) - ✅ Full feature set
3. **CodexAgent** (codex.rs) - ⚠️ **Missing features**

### Comprehensive Feature Comparison Matrix

| Feature Category | Feature | Claude Code | Gemini Code | Codex | Status |
|------------------|---------|-------------|-------------|-------|--------|
| **Core Features** | State detection | ✅ Yes | ✅ Yes | ❌ No | **GAP** |
| | Session ID support | ✅ Yes | ✅ Yes | ❌ No | **GAP** |
| | CommonAgentLogic | ✅ Yes | ✅ Yes | ❌ No | **GAP** |
| | Process output tracking | ✅ Yes | ✅ Yes | ❌ No | **GAP** |
| **Input/Output** | Image/screenshot support | ✅ Yes | ✅ Yes | ✅ Yes | ✅ OK |
| | Multi-image support | ✅ Yes | ✅ Yes | ✅ Yes | ✅ OK |
| **Safety** | Dangerous skip permissions | ✅ Yes | ✅ Yes | ✅ Yes (--full-auto) | ✅ OK |
| **State Patterns** | Working state detection | ✅ Yes | ✅ Yes | ❌ No | **GAP** |
| | Idle state detection | ✅ Yes | ✅ Yes | ❌ No | **GAP** |
| | Timeout-based idle detection | ✅ Yes | ✅ Yes | ❌ No | **GAP** |
| **CLI Support** | `--session-id` flag | ✅ Yes | ✅ Yes | ❓ Unknown | **RESEARCH NEEDED** |
| | `--image` flag | ✅ Yes | ✅ Yes | ✅ Yes | ✅ OK |
| | Permissions bypass flag | ✅ Yes | ✅ Yes | ✅ Yes | ✅ OK |

### Critical Gaps Identified

#### 1. Codex State Detection (codex.rs:21-24)

**Current code:**
```rust
fn detect_state(&self, _output: &str) -> AgentState {
    // TODO: Add Codex-specific output patterns when available
    AgentState::Unknown
}
```

**Impact**:
- Codex sessions always report `Unknown` state
- No Working/Idle detection
- Affects UIs that display session status
- Hook system can't properly track agent activity

**Root cause**: Codex agent doesn't use `CommonAgentLogic`

#### 2. Codex Session ID Support (codex.rs:31)

**Current code:**
```rust
fn start_command(
    &self,
    prompt: &str,
    images: &[String],
    dangerous_skip_checks: bool,
    _session_id: Option<&uuid::Uuid>,  // ← Ignored!
) -> Vec<String>
```

**Impact**:
- Session ID is ignored (parameter prefixed with `_`)
- Multi-session scenarios may not work correctly
- History/context not properly isolated

#### 3. Missing Process Output Tracking

**Current implementation**: Codex agent is a unit struct with no internal state:
```rust
pub struct CodexAgent;
```

**Claude and Gemini have**:
```rust
pub struct ClaudeCodeAgent {
    common_logic: CommonAgentLogic,
}
```

**Impact**: Can't track state changes over time

## Web UI Documentation Gap

### Current State
- Agent badges shown in SessionCard but no explanation of capabilities
- CreateSessionDialog shows agent dropdown with no feature details
- No documentation about what each agent supports
- Users cannot see limitations before creating a session

### Where Documentation Will Be Added
1. **CreateSessionDialog** - Capability info during agent selection (highest priority)
2. **SessionCard** - Tooltips on agent badges
3. **New agent-features.ts** - Centralized agent capabilities configuration

## Implementation Plan

### Phase 1: Add CommonAgentLogic to Codex Agent

**File**: `packages/clauderon/src/agents/codex.rs`

**Changes**:
1. Convert `CodexAgent` from unit struct to struct with `common_logic` field
2. Add `new()` constructor
3. Add `process_output()` and `current_state()` methods matching Claude/Gemini pattern
4. Update `detect_state()` to delegate to `common_logic.detect_state()`

**Code changes**:
```rust
pub struct CodexAgent {
    common_logic: CommonAgentLogic,
}

impl CodexAgent {
    #[must_use]
    pub fn new() -> Self {
        Self {
            common_logic: CommonAgentLogic::new(),
        }
    }

    pub fn process_output(&mut self, output: &str) -> AgentState {
        self.common_logic.process_output(output)
    }

    #[must_use]
    pub const fn current_state(&self) -> AgentState {
        self.common_logic.current_state()
    }
}

impl Agent for CodexAgent {
    fn detect_state(&self, output: &str) -> AgentState {
        self.common_logic.detect_state(output)
    }
    // ... rest unchanged
}
```

### Phase 2: Add Session ID Support to Codex

**File**: `packages/clauderon/src/agents/codex.rs`

**Changes**:
1. Remove `_` prefix from `session_id` parameter
2. Add session ID to command if provided (matching Claude/Gemini pattern)

**Code changes**:
```rust
fn start_command(
    &self,
    prompt: &str,
    images: &[String],
    dangerous_skip_checks: bool,
    session_id: Option<&uuid::Uuid>,  // ← Remove underscore
) -> Vec<String> {
    let mut cmd = vec!["codex".to_string()];

    // Add session ID first if provided
    if let Some(id) = session_id {
        cmd.push("--session-id".to_string());
        cmd.push(id.to_string());
    }

    // ... rest of implementation
}
```

**Note**: Need to verify if `codex` CLI actually supports `--session-id` flag. If not, we'll log the session ID but not pass it to the CLI.

### Phase 3: Add Tests

**File**: `packages/clauderon/src/agents/codex.rs`

**Add test module** matching claude_code.rs tests:
- `test_start_command_basic_with_full_auto`
- `test_start_command_basic_without_full_auto`
- `test_start_command_with_images_and_full_auto`
- `test_start_command_with_session_id`
- `test_new_initial_state`
- `test_default_same_as_new`
- `test_process_output_working_updates_state`
- `test_process_output_idle_updates_state`
- `test_detect_state_working_patterns`
- `test_detect_state_idle_patterns`

### Phase 4: Verification

**Steps**:
1. Run unit tests: `cargo test agents::codex`
2. Run all agent tests: `cargo test agents`
3. Build project: `cargo build`
4. Manual test with Codex session if available:
   - Create Codex session
   - Verify state detection works
   - Verify session ID is passed correctly

## Critical Files

- `/workspace/packages/clauderon/src/agents/codex.rs` - Main implementation
- `/workspace/packages/clauderon/src/agents/claude_code.rs` - Reference implementation
- `/workspace/packages/clauderon/src/agents/gemini_code.rs` - Reference implementation
- `/workspace/packages/clauderon/src/agents/common.rs` - Shared logic
- `/workspace/packages/clauderon/src/agents/traits.rs` - Agent trait definition

## Open Questions & Approach

1. **Does `codex` CLI support `--session-id` flag?**
   - **User response**: Not sure / needs testing
   - **Approach**: Implement it conditionally - test during implementation
   - If supported: pass the flag like Claude/Gemini
   - If not supported: accept the parameter but don't pass to CLI (for API consistency)

2. **Are Codex output patterns compatible with CommonAgentLogic?**
   - Current patterns in `common.rs` are: "Thinking...", "Reading file", etc.
   - **Approach**: Start with existing patterns, verify during testing
   - If Codex uses different patterns, we can extend `common.rs` or add Codex-specific logic

## Risk Assessment

**Low Risk**:
- Changes are localized to one file
- Following established patterns from Claude/Gemini
- Extensive test coverage exists in reference implementations
- No breaking changes to public API

## Success Criteria

✅ Codex agent uses CommonAgentLogic for state detection
✅ Codex agent properly detects Working/Idle states
✅ Codex agent accepts and uses session IDs
✅ All existing tests pass
✅ New tests added for Codex agent
✅ Build succeeds without warnings
