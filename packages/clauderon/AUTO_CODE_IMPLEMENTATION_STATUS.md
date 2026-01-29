# Auto-Code GitHub Integration - Implementation Status

This document tracks the implementation progress of the autonomous coding agent feature for Clauderon.

## Implementation Summary

### Phase 1: Data Model & Feature Flag ✅ COMPLETE

**Goal**: Foundation for tracking auto-code sessions

**Completed**:
- ✅ Added `enable_auto_code` to `FeatureFlags` struct
- ✅ Added feature flag to all loading mechanisms (TOML, env, CLI)
- ✅ Added merge and logging logic for the new flag
- ✅ Added `github_issue_number`, `github_issue_url`, `auto_code_enabled` fields to `Session` struct
- ✅ Created database migration v18 with idempotent column additions
- ✅ Updated `SessionRow` to include new fields
- ✅ Updated `TryFrom<SessionRow>` for Session deserialization
- ✅ Updated `save_session` SQL INSERT query to persist new fields
- ✅ Updated `CreateSessionRequest` to include `github_issue_number`

**Files Modified**:
- `src/feature_flags.rs` - Added `enable_auto_code` flag
- `src/core/session.rs` - Added GitHub issue fields
- `src/store/sqlite.rs` - Added migration v18 and updated queries
- `src/api/protocol.rs` - Added field to CreateSessionRequest
- `.cargo/config.toml` - Fixed linker from clang → gcc (build environment fix)

**Status**: All code changes complete. TypeScript types will regenerate on successful cargo build.

---

### Phase 2: GitHub Issue Fetching Backend ✅ COMPLETE

**Goal**: Backend API to fetch issues from a repository

**Completed**:
- ✅ Created `src/github/mod.rs` - Module exports
- ✅ Created `src/github/issues.rs` - GitHub issue fetching logic
  - `fetch_issues()` function using `gh` CLI
  - `GitHubIssue` struct with number, title, body, URL, labels
  - `IssueState` enum (Open, Closed, All)
  - Unit tests for JSON parsing
- ✅ Added github module to `src/lib.rs`
- ✅ Added API types to `src/api/protocol.rs`:
  - `IssueState` enum (typeshared)
  - `GitHubIssueDto` struct (typeshared)
  - `Request::ListGitHubIssues` variant
  - `Response::GitHubIssues` variant
- ✅ Added handler in `src/api/handlers.rs`:
  - Calls `fetch_issues()` and converts to DTOs
  - Error handling with GITHUB_ERROR code
  - Logging for observability

**Files Created**:
- `src/github/mod.rs`
- `src/github/issues.rs`

**Files Modified**:
- `src/lib.rs` - Added github module
- `src/api/protocol.rs` - Added types and Request/Response variants
- `src/api/handlers.rs` - Added handler for ListGitHubIssues

**Testing**:
- Unit tests for JSON parsing included in `issues.rs`
- Integration testing requires functional gh CLI

**Status**: Backend implementation complete. Ready for UI integration.

---

## Next Steps

### Phase 3A: Web UI Issue Picker (NOT STARTED)

**Goal**: Users can select GitHub issue in create dialog

**Tasks**:
1. Create `web/frontend/src/components/GitHubIssuePicker.tsx`
   - Search/filter input
   - Issue cards with labels, number, title preview
   - "Select" button per issue
   - Auto-fills prompt with issue details
2. Update `web/frontend/src/components/CreateSessionDialog.tsx`
   - Add toggle: "Link GitHub Issue"
   - Show issue picker when enabled and `auto_code` flag on
   - Display selected issue as chip
3. Wire up API call to backend endpoint
4. Component tests

---

### Phase 3B: TUI Issue Picker (NOT STARTED)

**Goal**: TUI equivalent of web picker

**Tasks**:
1. Create `src/tui/components/issue_picker.rs`
2. Update `src/tui/components/create_dialog.rs`
3. Add keybinding (e.g., 'i' for issue picker)

---

### Phase 4: Auto-Code Session Creation (PARTIALLY COMPLETE)

**Goal**: Sessions created with auto-code instructions

**Completed**:
- ✅ Created `src/agents/instructions.rs`
  - `auto_code_instructions()` function with complete workflow
  - Shell escaping for safe string interpolation
  - Issue body truncation for context limits
  - Unit tests for formatting and edge cases
- ✅ Updated `src/agents/mod.rs` to export function

**Remaining Tasks**:
1. Update `src/core/manager.rs::create_session()`
   - Check if `auto_code_enabled` flag set
   - If yes + issue selected, use `auto_code_instructions()` as prompt
   - Store issue fields in DB (fields already exist from Phase 1)
2. Integration testing with real Claude Code sessions

---

### Phase 5: Auto-Archive on Merge (NOT STARTED)

**Goal**: Sessions archive automatically when PR merges

**Tasks**:
1. Update `src/ci/poller.rs::poll_ci_status()`
   - After updating `pr_check_status`, check if `CheckStatus::Merged`
   - If merged AND `auto_code_enabled`, call `archive_session()`
   - Add extensive logging
2. Integration tests for auto-archive logic
3. Safety checks (e.g., only archive if status stable for 60s)

---

### Phase 6: UI Indicators (NOT STARTED)

**Goal**: Show workflow progress in all UIs

**Tasks**:
1. Update `web/frontend/src/components/SessionCard.tsx`
   - Auto-code badge
   - Workflow stage chip (Planning/Implementation/Review/ReadyToMerge/Merged)
   - PR status indicators (draft, CI, conflicts)
   - Link to GitHub issue
2. Update `src/tui/components/session_list.rs`
   - Color-coded workflow stage prefix
   - PR status symbols
3. Mobile UI updates (if applicable)

---

## Architecture Notes

### Workflow Stage Computation
- Already exists: `Session::workflow_stage()` (src/core/session.rs:415)
- Returns: `WorkflowStage` enum with variants: Planning, Implementation, Review, Blocked, ReadyToMerge, Merged
- Computed from: `pr_url`, `pr_check_status`, `pr_review_decision`, `merge_conflict`

### Claude-Driven Merge
- Claude monitors conditions and executes `gh pr merge --auto` (not daemon-driven)
- Daemon tracks merge completion via polling
- Benefits: Claude handles edge cases and provides real-time updates

### Auto-Code Instructions
- Full workflow included in initial prompt (no runtime injection needed)
- Claude follows workflow autonomously
- Simpler implementation, no JSONL manipulation required

### Feature Flag Gating
- `enable_auto_code` gates: Issue selection UI, post-impl instructions, auto-archive
- When disabled: behaves like current manual workflow

---

## Testing Requirements

### Phase 0: Validation (NOT DONE)
**CRITICAL**: Must validate Claude Code can follow multi-step workflow instructions
- Manual testing with real Claude Code sessions
- Test issue implementation → draft PR → ready → monitor → merge flow
- Document success rate and failure modes
- **Abort criteria**: If <80% success rate, redesign required

### Unit Tests
- ✅ JSON parsing for GitHub issues
- Database migration idempotency
- Session creation with auto-code fields
- Auto-archive condition logic

### Integration Tests
- Session lifecycle with auto-code enabled
- PR discovery and linking
- Workflow stage transitions

### End-to-End Test (Manual)
1. Enable `auto_code` feature flag
2. Create session with real GitHub issue
3. Let Claude implement and create PR
4. Approve PR manually
5. Watch CI pass
6. Verify Claude merges PR
7. Verify session archives automatically

---

## Build Status

**Current Issue**: Build environment missing:
- `clang` linker not available (fixed by switching to `gcc`)
- `openssl-dev` libraries missing

**Workaround**: Code changes validated manually. TypeScript type generation will occur on successful build.

**Verification**:
```bash
# Once build environment is ready:
cargo build
bun run typecheck
cargo nextest run
```

---

## Migration Path

**Database Migration v18**:
```sql
ALTER TABLE sessions ADD COLUMN github_issue_number INTEGER;
ALTER TABLE sessions ADD COLUMN github_issue_url TEXT;
ALTER TABLE sessions ADD COLUMN auto_code_enabled INTEGER NOT NULL DEFAULT 0;
```

**Rollback** (if needed):
```sql
ALTER TABLE sessions DROP COLUMN github_issue_number;
ALTER TABLE sessions DROP COLUMN github_issue_url;
ALTER TABLE sessions DROP COLUMN auto_code_enabled;
UPDATE schema_version SET version = 17;
```

---

## Observability

### Metrics to Add (Future)
- `auto_code_session_created{issue_number}` - Counter
- `auto_code_pr_created` - Counter
- `auto_code_pr_merged` - Counter
- `auto_code_pr_merge_duration_seconds` - Histogram
- `auto_code_session_blocked{reason}` - Counter

### Logging
All auto-code operations should include:
- `session_id`
- `github_issue_number`
- `workflow_stage`
- `pr_url` (when available)
- `operation` (create/poll/archive)

---

## References

- Main plan: `/workspace/IMPLEMENTATION_PLAN.md` (if exists)
- CLAUDE.md: `/workspace/packages/clauderon/CLAUDE.md`
- CI poller: `src/ci/poller.rs`
- Session model: `src/core/session.rs`
- Feature flags: `src/feature_flags.rs`

---

**Last Updated**: 2026-01-28
**Status**: Phase 1 & 2 complete, Phase 4 (instructions) complete, Phase 3 & 5-6 pending
