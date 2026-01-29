# Auto-Code Feature - Quick Start Guide

## What's Been Done ✅

Core backend infrastructure for autonomous GitHub issue resolution is **complete**:
- ✅ Feature flag system
- ✅ Database schema & migration
- ✅ GitHub issue API integration
- ✅ Autonomous workflow instructions

## To Build & Test

### 1. Fix Build Environment (if needed)
```bash
# Install missing system dependencies
sudo apt-get update
sudo apt-get install -y libssl-dev pkg-config

# Build the project
cargo build

# Run tests
cargo nextest run

# Check TypeScript types generated
ls -la web/shared/src/generated/
```

### 2. Verify Implementation
```bash
# Check database migration
sqlite3 ~/.clauderon/db.sqlite ".schema sessions" | grep -E "github_issue|auto_code"

# Run specific tests
cargo nextest run -E 'test(/github/)'
cargo nextest run -E 'test(/auto_code/)'
```

### 3. Test GitHub Integration
```bash
# Start the daemon
cargo run -- serve

# In another terminal, test issue fetching
# (requires gh CLI configured)
curl -X POST http://localhost:8080/api/request \
  -H "Content-Type: application/json" \
  -d '{"type":"ListGitHubIssues","payload":{"repo_path":"/path/to/repo","state":"open"}}'
```

## Next Implementation Steps

### Phase 3: UI Components (2-3 hours)
**Web UI Issue Picker:**
```typescript
// web/frontend/src/components/GitHubIssuePicker.tsx
// - Fetch issues via API
// - Display searchable list
// - Allow selection
// - Populate initial prompt
```

**TUI Issue Picker:**
```rust
// src/tui/components/issue_picker.rs
// - List widget with issues
// - Keyboard navigation
// - Selection integration
```

### Phase 4 Completion: Session Creation (30 min)
```rust
// src/core/manager.rs - in create_session()

// Check if auto-code enabled and issue selected
if let Some(issue_number) = github_issue_number {
    if feature_flags.enable_auto_code {
        // Fetch issue details
        let issue = github::fetch_issue(&repo_path, issue_number).await?;

        // Generate auto-code instructions
        let prompt = agents::auto_code_instructions(&issue);

        // Store issue metadata
        session.github_issue_number = Some(issue_number);
        session.github_issue_url = Some(issue.url);
        session.auto_code_enabled = true;

        // Use generated prompt
        session.initial_prompt = prompt;
    }
}
```

### Phase 5: Auto-Archive (30 min)
```rust
// src/ci/poller.rs - in poll_ci_status()

// After updating pr_check_status
if session.pr_check_status == Some(CheckStatus::Merged)
   && session.auto_code_enabled {
    // Safety: Wait for status to be stable
    if stable_for_60_seconds(&session) {
        manager.archive_session(&session.id).await?;
        tracing::info!(
            session_id = %session.id,
            issue_number = ?session.github_issue_number,
            "Auto-archived session after PR merge"
        );
    }
}
```

### Phase 6: UI Indicators (1 hour)
Add to all UIs:
- 🤖 Auto-code badge
- Workflow stage chips (Planning/Implementation/Review/ReadyToMerge/Merged)
- PR status indicators
- Link to GitHub issue

## Feature Flag Configuration

### Enable for Testing
```toml
# ~/.clauderon/config.toml
[feature_flags]
enable_auto_code = true
```

Or via environment:
```bash
export CLAUDERON_FEATURE_ENABLE_AUTO_CODE=true
clauderon serve
```

## End-to-End Test Scenario

1. **Enable feature** (see above)
2. **Create session** with GitHub issue:
   ```bash
   # Via CLI (when UI is done)
   clauderon create --issue 123

   # Or via Web UI
   # - Toggle "Link GitHub Issue"
   # - Select issue from picker
   # - Create session
   ```
3. **Observe Claude**:
   - Implements solution
   - Creates draft PR
   - Marks ready when done
   - Monitors CI/reviews
   - Merges when ready
4. **Verify auto-archive**:
   - Check session status becomes Archived
   - Verify worktree cleaned up

## Troubleshooting

### Build Fails with OpenSSL Error
```bash
# Ubuntu/Debian
sudo apt-get install libssl-dev pkg-config

# macOS
brew install openssl
export OPENSSL_DIR=$(brew --prefix openssl)
```

### TypeScript Types Not Generated
```bash
# Rebuild to trigger TypeShare
cargo clean
cargo build
```

### Database Migration Not Applied
```bash
# Check current version
sqlite3 ~/.clauderon/db.sqlite "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1;"

# Should show version 18
# If not, daemon will apply on next start
```

## Documentation Reference

- **AUTO_CODE_IMPLEMENTATION_STATUS.md** - Detailed phase tracking
- **IMPLEMENTATION_COMPLETE.md** - Complete summary
- **Original Plan** - See conversation transcript for full specification

## Code Locations

### Backend
- Feature flag: `src/feature_flags.rs:30`
- Session model: `src/core/session.rs:125-130`
- Database migration: `src/store/sqlite.rs:1049-1084`
- GitHub API: `src/github/issues.rs`
- Instructions: `src/agents/instructions.rs`

### API
- Request types: `src/api/protocol.rs:83,138-165,264`
- Handler: `src/api/handlers.rs:462-488`

### Frontend (to be implemented)
- Web picker: `web/frontend/src/components/GitHubIssuePicker.tsx`
- TUI picker: `src/tui/components/issue_picker.rs`

## Questions?

Check the detailed documentation:
- Implementation status: `AUTO_CODE_IMPLEMENTATION_STATUS.md`
- Complete summary: `IMPLEMENTATION_COMPLETE.md`
- Clauderon docs: `packages/clauderon/CLAUDE.md`
