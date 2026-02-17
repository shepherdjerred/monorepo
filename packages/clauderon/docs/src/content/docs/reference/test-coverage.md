---
title: Test Coverage
description: Comprehensive test coverage analysis mapping all tests to features
---

# Test Coverage Analysis

This document provides an exhaustive analysis of test coverage across all Clauderon platforms and components.

## Test Inventory Summary

| Platform         | Test Files                 | Test Functions | Coverage Level       |
| ---------------- | -------------------------- | -------------- | -------------------- |
| **Rust Backend** | 24 integration + many unit | ~500+          | Comprehensive        |
| **Rust TUI**     | 1 (54KB)                   | 79             | Good                 |
| **Web Frontend** | 6                          | ~130+          | Partial (logic only) |
| **Mobile**       | 1                          | 21             | Minimal              |

---

## Rust Tests - Detailed Breakdown

### TUI Tests (79 tests in `tests/tui_tests.rs`)

#### State Transition Tests (11)

| Test                             | Purpose                      |
| -------------------------------- | ---------------------------- |
| `test_app_initial_state`         | Initial app mode             |
| `test_select_next_empty_list`    | Empty list navigation        |
| `test_select_next_boundary`      | Boundary navigation forward  |
| `test_select_previous_boundary`  | Boundary navigation backward |
| `test_open_create_dialog`        | Dialog opening               |
| `test_close_create_dialog`       | Dialog closing               |
| `test_open_delete_confirm`       | Delete confirmation opening  |
| `test_cancel_delete`             | Delete cancellation          |
| `test_create_dialog_focus_cycle` | Tab cycling through fields   |
| `test_toggle_help`               | Help mode toggle             |
| `test_quit`                      | Quit mode toggle             |

#### Event Handler Tests (20)

| Test                                                 | Purpose                  |
| ---------------------------------------------------- | ------------------------ |
| `test_ctrl_c_quits`                                  | Ctrl+C quit shortcut     |
| `test_session_list_q_quits`                          | Q key quit               |
| `test_session_list_n_opens_dialog`                   | N key opens dialog       |
| `test_session_list_question_mark_opens_help`         | ? key opens help         |
| `test_session_list_navigation`                       | Arrow key navigation     |
| `test_create_dialog_tab_navigation`                  | Tab navigation           |
| `test_create_dialog_backtab_navigation`              | BackTab navigation       |
| `test_create_dialog_text_input`                      | Text input handling      |
| `test_create_dialog_backspace`                       | Backspace handling       |
| `test_create_dialog_escape_closes`                   | Escape closes dialog     |
| `test_create_dialog_toggle_backend`                  | Backend toggle           |
| `test_create_dialog_toggle_skip_checks`              | Checkbox toggle          |
| `test_create_dialog_space_in_prompt_field`           | Space in prompt          |
| `test_create_dialog_space_in_prompt_field_multiword` | Multi-word prompt        |
| `test_create_dialog_space_in_repo_path_field`        | Directory picker trigger |
| `test_confirm_delete_y_confirms`                     | Y confirms delete        |
| `test_confirm_delete_n_cancels`                      | N cancels delete         |
| `test_confirm_delete_escape_cancels`                 | Escape cancels delete    |
| `test_help_escape_closes`                            | Escape closes help       |
| `test_help_q_closes`                                 | Q closes help            |

#### Rendering Tests (6)

| Test                                     | Purpose                  |
| ---------------------------------------- | ------------------------ |
| `test_render_empty_session_list`         | Empty list rendering     |
| `test_render_session_list_with_sessions` | Populated list rendering |
| `test_render_connection_error`           | Error state rendering    |
| `test_render_create_dialog`              | Dialog rendering         |
| `test_render_create_dialog_with_loading` | Loading indicator        |
| `test_render_help`                       | Help overlay rendering   |

#### API Integration Tests (14)

| Test                                          | Purpose                   |
| --------------------------------------------- | ------------------------- |
| `test_refresh_sessions_updates_list`          | Session refresh           |
| `test_refresh_sessions_handles_error`         | Refresh error handling    |
| `test_create_session_success`                 | Session creation          |
| `test_create_session_shows_loading_indicator` | Loading during create     |
| `test_create_session_failure`                 | Create failure handling   |
| `test_delete_session_success`                 | Session deletion          |
| `test_delete_error_handling`                  | Delete error handling     |
| `test_deletion_state_tracking`                | Deletion state tracking   |
| `test_delete_blocked_during_create`           | Blocking during create    |
| `test_create_blocked_during_delete`           | Blocking during delete    |
| `test_archive_selected_success`               | Archive operation         |
| `test_reconcile_success`                      | Reconciliation            |
| `test_attach_command_returns_command`         | Attach command generation |
| `test_selected_index_clamped_after_refresh`   | Index clamping            |

#### Directory Picker Tests (8)

| Test                                         | Purpose              |
| -------------------------------------------- | -------------------- |
| `test_directory_picker_opens_and_closes`     | Lifecycle            |
| `test_directory_picker_close_with_esc`       | Escape closing       |
| `test_directory_picker_navigation`           | Navigation           |
| `test_directory_picker_navigation_keys`      | Key bindings         |
| `test_directory_picker_search`               | Search functionality |
| `test_directory_picker_search_filtering`     | Search filtering     |
| `test_directory_picker_open_with_enter`      | Selection            |
| `test_render_directory_picker_without_panic` | Rendering            |

#### Signal Menu Tests (8)

| Test                                    | Purpose            |
| --------------------------------------- | ------------------ |
| `test_signal_menu_state_new`            | State creation     |
| `test_signal_menu_state_default`        | Default state      |
| `test_signal_menu_select_next`          | Next selection     |
| `test_signal_menu_select_previous`      | Previous selection |
| `test_signal_menu_selected_signal`      | Signal retrieval   |
| `test_open_signal_menu`                 | Menu opening       |
| `test_close_signal_menu`                | Menu closing       |
| `test_render_signal_menu_without_panic` | Rendering          |

#### Kubernetes UI Tests (12)

| Test                                              | Purpose                |
| ------------------------------------------------- | ---------------------- |
| `test_k8s_specific_fields_initialized`            | Field initialization   |
| `test_toggle_pull_policy`                         | Pull policy toggle     |
| `test_pull_policy_toggle_with_keyboard`           | Keyboard toggle        |
| `test_dangerous_copy_creds_toggle`                | Copy creds toggle      |
| `test_dangerous_copy_creds_toggle_with_keyboard`  | Keyboard toggle        |
| `test_k8s_navigation_with_k8s_backend`            | Navigation with K8s    |
| `test_k8s_navigation_skipped_without_k8s_backend` | Conditional navigation |
| `test_container_image_text_input`                 | Image text input       |
| `test_storage_class_text_input`                   | Storage class input    |
| `test_k8s_session_creation_passes_options`        | Session creation       |
| `test_k8s_backend_available_with_feature_flag`    | Feature flag           |
| `test_render_create_dialog_with_k8s_backend`      | K8s dialog rendering   |

#### TUI Not Tested

- Mouse interactions
- Window resize handling
- Scroll behavior in long lists
- Unicode/special character input
- Cursor positioning verification
- Visual layout/colors verification
- Performance/stress testing
- Copy mode
- Locked mode
- Session switching (Ctrl+P/N)
- External editor (Ctrl+E)

---

### Backend Tests - Docker (46 tests)

#### Unit Tests in `src/backends/docker.rs` (32)

**Build Arguments:**
| Test | Purpose |
|------|---------|
| `test_create_uses_dit_not_d` | Uses -dit for interactive TTY |
| `test_create_runs_as_non_root` | Uses --user flag |
| `test_initial_workdir_subdirectory` | Workdir subdirectory handling |
| `test_initial_workdir_empty` | Empty workdir handling |
| `test_container_name_prefixed` | clauderon- prefix |
| `test_attach_uses_bash_not_zsh` | Bash wrapper |
| `test_attach_starts_stopped_container` | Restart before attach |
| `test_print_mode_adds_flags` | Print mode flags |
| `test_interactive_mode_no_print_flag` | Interactive mode flags |

**Security:**
| Test | Purpose |
|------|---------|
| `test_sanitize_git_config_removes_newlines` | Newline injection prevention |
| `test_sanitize_git_config_removes_control_chars` | Control char removal |
| `test_sanitize_git_config_preserves_tabs` | Safe tab preservation |
| `test_sanitize_git_config_preserves_normal_chars` | Normal char preservation |
| `test_prompt_escaping` | Quote escaping |

**Caching:**
| Test | Purpose |
|------|---------|
| `test_rust_caching_configured` | Cargo/sccache volumes |

**Proxy:**
| Test | Purpose |
|------|---------|
| `test_proxy_config_adds_env_vars` | HTTPS_PROXY, SSL_CERT_FILE |
| `test_proxy_config_adds_volume_mounts` | CA cert mounting |
| `test_no_proxy_config` | No env vars without proxy |
| `test_host_docker_internal_always_added` | --add-host flag |

**Git Worktree:**
| Test | Purpose |
|------|---------|
| `test_git_worktree_mounts_parent_git` | Parent .git mount |
| `test_non_worktree_no_extra_mounts` | No extra mounts |
| `test_git_worktree_relative_path` | Relative path handling |
| `test_git_worktree_trailing_whitespace` | Trailing whitespace |
| `test_malformed_git_file_graceful_failure` | Graceful failure |
| `test_missing_parent_git_graceful_failure` | Missing parent handling |

**Uploads & History:**
| Test | Purpose |
|------|---------|
| `test_uploads_directory_mounted` | Uploads mount |
| `test_image_path_translation` | Path translation |
| `test_session_history_project_path_with_subdirectory` | Subdirectory paths |
| `test_session_history_project_path_at_root` | Root paths |

**Dangerous Mode:**
| Test | Purpose |
|------|---------|
| `test_dangerous_skip_checks_without_proxy` | Skip checks flag |
| `test_claude_json_without_dangerous_skip_checks` | Claude.json handling |

#### E2E Tests in `tests/e2e_docker.rs` (5, all IGNORED)

| Test                                 | Purpose                        |
| ------------------------------------ | ------------------------------ |
| `test_docker_container_lifecycle`    | Full create→verify→logs→delete |
| `test_docker_container_exists_check` | Existence check                |
| `test_docker_attach_command`         | Attach command generation      |
| `test_docker_delete_nonexistent`     | Delete non-existent            |
| `test_docker_is_running_check`       | Running check                  |

#### Integration Tests in `tests/integration_lifecycle.rs` (4, all IGNORED)

| Test                                     | Purpose                               |
| ---------------------------------------- | ------------------------------------- |
| `test_docker_full_lifecycle_with_attach` | Create→attach→detach→re-attach→delete |
| `test_worktree_and_container_together`   | Git + Docker integration              |
| `test_container_output_retrieval`        | get_output()                          |
| `test_reattach_stopped_container`        | Reattach stopped                      |

#### Smoke Tests in `tests/smoke_tests.rs` (5, all IGNORED)

| Test                              | Purpose              |
| --------------------------------- | -------------------- |
| `test_claude_starts_in_docker`    | Claude startup       |
| `test_claude_writes_debug_files`  | .claude writable     |
| `test_container_runs_as_non_root` | UID verification     |
| `test_initial_prompt_executed`    | Prompt delivery      |
| `test_claude_print_mode_e2e`      | Full OAuth proxy E2E |

#### Docker Not Tested

- CPU/memory limit enforcement
- Volume lifecycle management
- Network configuration beyond proxy
- Multi-container orchestration
- Crash detection/recovery

---

### Backend Tests - Kubernetes (6 tests)

#### Unit Tests in `src/backends/kubernetes.rs` (2)

| Test                         | Purpose               |
| ---------------------------- | --------------------- |
| `test_pod_name_generation`   | Pod naming            |
| `test_attach_command_format` | kubectl attach format |

#### E2E Tests in `tests/e2e_kubernetes.rs` (4, 3 IGNORED)

| Test                                 | Purpose             | Status  |
| ------------------------------------ | ------------------- | ------- |
| `test_kubernetes_pod_lifecycle`      | Pod lifecycle       | IGNORED |
| `test_kubernetes_pod_exists_check`   | Existence check     | IGNORED |
| `test_kubernetes_attach_command`     | Attach command      | Active  |
| `test_kubernetes_delete_nonexistent` | Delete non-existent | IGNORED |

#### Kubernetes Not Tested

- PVC creation and management
- Namespace configuration
- RBAC/ServiceAccount setup
- Resource quotas
- Storage class selection
- Pod logs streaming
- CrashLoopBackOff handling
- Multi-repo support

---

### Backend Tests - Zellij (15 tests)

#### Unit Tests in `src/backends/zellij.rs` (11)

| Test                                   | Purpose                |
| -------------------------------------- | ---------------------- |
| `test_create_uses_background_flag`     | Background mode        |
| `test_new_pane_has_cwd`                | Pane working directory |
| `test_new_pane_uses_action`            | Action usage           |
| `test_new_pane_uses_bash`              | Bash shell             |
| `test_new_pane_has_separator`          | Separator handling     |
| `test_prompt_escaping`                 | Quote escaping         |
| `test_attach_command_format`           | Attach format          |
| `test_command_includes_dangerous_flag` | Skip permissions       |
| `test_command_includes_images`         | Image handling         |
| `test_image_path_escaping`             | Path escaping          |
| `test_command_with_no_images`          | No images case         |

#### E2E Tests in `tests/e2e_zellij.rs` (4, 3 IGNORED)

| Test                               | Purpose             | Status  |
| ---------------------------------- | ------------------- | ------- |
| `test_zellij_session_lifecycle`    | Session lifecycle   | IGNORED |
| `test_zellij_session_exists_check` | Existence check     | IGNORED |
| `test_zellij_attach_command`       | Attach command      | Active  |
| `test_zellij_delete_nonexistent`   | Delete non-existent | IGNORED |

#### Zellij Not Tested

- Session layout configuration
- Window/pane management
- Scrollback buffers
- Codex agent support

---

### Backend Tests - Sprites (30 tests)

#### Unit Tests in `src/backends/sprites.rs` (4)

| Test                            | Purpose            |
| ------------------------------- | ------------------ |
| `test_sprite_name_from_session` | Sprite naming      |
| `test_attach_command`           | Console command    |
| `test_with_config`              | Config application |
| `test_default_backend`          | Default config     |

#### E2E Tests in `tests/e2e_sprites.rs` (26, all IGNORED)

**Core Lifecycle:**
| Test | Purpose |
|------|---------|
| `test_sprites_lifecycle` | Full lifecycle |
| `test_sprites_exists_check` | Existence check |
| `test_sprites_attach_command` | Attach command |
| `test_sprites_is_remote` | Remote detection |
| `test_sprites_delete_nonexistent` | Delete non-existent |

**PTY:**
| Test | Purpose |
|------|---------|
| `test_sprites_pty_attachment` | Full PTY flow |
| `test_sprites_pty_resize` | Terminal resize |

**Repository:**
| Test | Purpose |
|------|---------|
| `test_sprites_multi_repo_session` | Multi-repo |
| `test_sprites_new_branch_creation` | New branch |
| `test_sprites_existing_remote_branch_tracking` | Branch tracking |
| `test_sprites_base_branch_workflow` | Base branch |

**Clone:**
| Test | Purpose |
|------|---------|
| `test_sprites_shallow_clone_enabled` | Shallow clone on |
| `test_sprites_shallow_clone_disabled` | Shallow clone off |

**Installation:**
| Test | Purpose |
|------|---------|
| `test_sprites_claude_installation_verified` | Claude installed |
| `test_sprites_abduco_installation_verified` | Abduco installed |

**Output:**
| Test | Purpose |
|------|---------|
| `test_sprites_agent_produces_output` | Output production |
| `test_sprites_get_output_returns_log_content` | Log retrieval |
| `test_sprites_get_output_empty_when_no_log` | Empty log handling |

**Errors:**
| Test | Purpose |
|------|---------|
| `test_sprites_invalid_git_remote_fails` | Invalid remote |
| `test_sprites_missing_remote_fails` | Missing remote |

**Lifecycle Config:**
| Test | Purpose |
|------|---------|
| `test_sprites_auto_destroy_false_persists` | Persist on |
| `test_sprites_auto_destroy_true_destroys` | Auto-destroy |

**Edge Cases:**
| Test | Purpose |
|------|---------|
| `test_sprites_parallel_creation` | Concurrency |
| `test_sprites_special_characters_in_prompt` | Special chars |
| `test_sprites_empty_initial_prompt` | Empty prompt |

#### Sprites Not Tested

- Checkpoint functionality
- Wake from hibernation
- Model override
- Plan mode
- Build caching

---

### Backend Tests - Apple Container (0 tests)

:::caution[No Tests Exist]

- No unit tests in `src/backends/apple_container.rs`
- No E2E test file (`e2e_apple_container.rs` doesn't exist)
- All operations completely untested: CREATE, ATTACH, DELETE, EXISTS, HEALTH
  :::

---

### Health & Reconciliation Tests (67 tests)

#### Health Check Logic in `tests/e2e_health.rs` (28)

- ResourceState testing (Healthy, Stopped, Hibernated, Pending, Missing, Error, CrashLoop, DataLost, WorktreeMissing)
- Backend-specific health actions (Docker, K8s, Zellij, Sprites)
- Data safety per backend
- Startup health detection

#### API Serialization in `tests/api_health_tests.rs` (29)

- ResourceState serialization (11 states)
- AvailableAction serialization
- SessionHealthReport serialization
- HealthCheckResult serialization

#### Reconciliation in `tests/e2e_reconcile.rs` (5)

- Worktree detection/cleanup
- Docker container cleanup detection
- Stale session handling
- Healthy session verification

#### Backend Utilities in `tests/backend_tests.rs` (5)

- GitBackend instantiation
- Path generation utilities

---

### API Endpoint Test Coverage

| Endpoint                                 | Method | Tested | Notes                        |
| ---------------------------------------- | ------ | :----: | ---------------------------- |
| `/api/sessions`                          | GET    |   ✅   | Unit tests on SessionManager |
| `/api/sessions`                          | POST   |   ✅   | Unit tests on SessionManager |
| `/api/sessions/{id}`                     | GET    |   ✅   | Unit tests                   |
| `/api/sessions/{id}`                     | DELETE |   ✅   | Unit tests                   |
| `/api/sessions/{id}/archive`             | POST   |   ✅   | Unit tests                   |
| `/api/sessions/{id}/unarchive`           | POST   |   ✅   | Unit tests                   |
| `/api/sessions/{id}/refresh`             | POST   |   ❌   | No tests                     |
| `/api/sessions/{id}/start`               | POST   |   ⚠️   | Indirect via health          |
| `/api/sessions/{id}/wake`                | POST   |   ⚠️   | Indirect via health          |
| `/api/sessions/{id}/recreate`            | POST   |   ⚠️   | Indirect via health          |
| `/api/sessions/{id}/cleanup`             | POST   |   ⚠️   | Indirect via health          |
| `/api/sessions/{id}/metadata`            | POST   |   ✅   | Unit tests                   |
| `/api/sessions/{id}/regenerate-metadata` | POST   |   ⚠️   | Serialization only           |
| `/api/sessions/{id}/access-mode`         | POST   |   ❌   | No tests                     |
| `/api/sessions/{id}/history`             | GET    |   ❌   | No tests                     |
| `/api/sessions/{id}/upload`              | POST   |   ❌   | No tests                     |
| `/api/health`                            | GET    |   ✅   | Comprehensive                |
| `/api/sessions/{id}/health`              | GET    |   ✅   | Comprehensive                |
| `/api/recent-repos`                      | GET    |   ✅   | Unit tests                   |
| `/api/browse-directory`                  | POST   |   ❌   | No tests                     |
| `/api/credentials`                       | POST   |   ❌   | No tests                     |
| `/api/status`                            | GET    |   ❌   | No tests                     |
| `/api/storage-classes`                   | GET    |   ❌   | No tests                     |
| `/api/feature-flags`                     | GET    |   ❌   | No tests                     |
| `/api/hooks`                             | POST   |   ❌   | No tests                     |
| `/api/auth/*`                            | \*     |   ⚠️   | Logic tested, not HTTP       |
| `/ws/console/{id}`                       | WS     |   ❌   | No tests                     |
| `/ws/events`                             | WS     |   ❌   | No tests                     |

:::note[Key Gap]
**NO HTTP INTEGRATION TESTS** - All tests are unit tests on SessionManager, not actual HTTP request/response testing.
:::

---

## Web Frontend Tests

### Test Files (6 files, ~130+ tests)

| File                            | Tests | Coverage                                                 |
| ------------------------------- | ----- | -------------------------------------------------------- |
| `RecreateConfirmModal.test.tsx` | 21    | State display, action details, data safety by backend    |
| `RecreateBlockedModal.test.tsx` | 13    | Blocked detection, backend-specific blocking             |
| `ThemeToggle.test.tsx`          | 13    | localStorage, system preferences, persistence            |
| `StartupHealthModal.test.tsx`   | 8     | Health labels, colors, filtering                         |
| `claudeParser.test.ts`          | 30+   | ANSI stripping, code blocks, file paths, tools, messages |
| `codexHistoryParser.test.ts`    | 20+   | Format detection, message parsing, function calls        |

### Web Not Tested

- React component rendering (DOM output)
- User interactions (clicks, form submission)
- API calls / fetch mocking
- Hooks (useSession, useWebSocket, etc.)
- Terminal component (xterm.js)
- Form validation
- WebSocket connections
- Navigation/routing

---

## Mobile Tests

### Test Files (1 file, 21 tests)

| File                    | Tests | Coverage                                  |
| ----------------------- | ----- | ----------------------------------------- |
| `historyParser.test.ts` | 21    | Message parsing, tool use/result matching |

### Mobile Not Tested (Critical Gaps)

:::danger[Critical Coverage Gaps]
**All 6 screens untested:**

- ChatScreen
- SessionListScreen
- CreateSessionScreen
- EditSessionScreen
- SettingsScreen
- StatusScreen

**All 10 components untested:**

- MessageBubble
- SessionCard
- ConfirmDialog
- ConnectionStatus
- CredentialRow
- FilterTabs
- PlanView
- QuestionView
- RecentReposSelector
- UsageProgressBar

**All infrastructure untested:**

- Navigation: AppNavigator, stack navigation, deep linking
- Contexts: SessionContext, ThemeContext
- Hooks: useClauderonClient, useConsole, useSessionHistory, useSessionEvents, useSettings
- API Client: ClauderonClient (317 lines) - all methods untested
- WebSocket Clients: ConsoleClient (413 lines), EventsClient (252 lines)
- Error Handling: ApiError, NetworkError, SessionNotFoundError, ConsoleConnectionError
  :::

---

## Feature → Test Matrix

### Session Management

| Feature           | Rust Backend | TUI | Web | Mobile |
| ----------------- | :----------: | :-: | :-: | :----: |
| List sessions     |      ✅      | ✅  | ❌  |   ❌   |
| Create session    |      ✅      | ✅  | ❌  |   ❌   |
| Delete session    |      ✅      | ✅  | ❌  |   ❌   |
| Archive/Unarchive |      ✅      | ✅  | ❌  |   ❌   |
| Edit metadata     |      ✅      | N/A | ❌  |   ❌   |
| Status filtering  |      ✅      | ❌  | ❌  |   ❌   |
| Health status     |      ✅      | ✅  | ✅  |   ❌   |
| Workflow stage    |      ❌      | ❌  | ❌  |   ❌   |
| PR status         |      ❌      | ❌  | ❌  |   ❌   |
| Auto-refresh      |      ❌      | ✅  | ❌  |   ❌   |

### Terminal/Console

| Feature             | Rust Backend | TUI | Web | Mobile |
| ------------------- | :----------: | :-: | :-: | :----: |
| PTY creation        |      ✅      | ✅  | ❌  |  N/A   |
| WebSocket streaming |      ✅      | ❌  | ❌  |   ❌   |
| Scrollback buffer   |      ❌      | ❌  | ❌  |  N/A   |
| Terminal resize     | ✅ (Sprites) | ❌  | ❌  |  N/A   |
| Signal menu         |     N/A      | ✅  | N/A |  N/A   |
| Locked mode         |     N/A      | ❌  | N/A |  N/A   |

### Chat Interface

| Feature          | Rust Backend | TUI | Web | Mobile |
| ---------------- | :----------: | :-: | :-: | :----: |
| Message parsing  |      ✅      | N/A | ✅  |   ✅   |
| Claude format    |      ✅      | N/A | ✅  |   ✅   |
| Codex format     |      ❌      | N/A | ✅  |   ❌   |
| Tool use display |      ❌      | N/A | ✅  |   ✅   |
| Image upload     |      ❌      | ❌  | ❌  |   ❌   |

### Backend Operations

| Operation  | Docker | K8s | Zellij | Sprites | Apple |
| ---------- | :----: | :-: | :----: | :-----: | :---: |
| CREATE     | ✅✅✅ | ✅  |  ✅✅  |  ✅✅   |  ❌   |
| ATTACH     |  ✅✅  | ✅  |   ✅   |  ✅✅   |  ❌   |
| DELETE     |   ✅   | ✅  |   ✅   |   ✅    |  ❌   |
| EXISTS     |   ✅   | ✅  |   ✅   |   ✅    |  ❌   |
| GET_OUTPUT |   ✅   | ✅  |   ⚠️   |   ✅    |  ❌   |
| HEALTH     |   ✅   | ✅  |   ✅   |   ✅    |  ❌   |

---

## Priority Gaps

### P0 - Critical (Blocking Quality)

| Gap                              | Platform | Impact                            |
| -------------------------------- | -------- | --------------------------------- |
| **Apple Container: 0 tests**     | Rust     | macOS backend completely untested |
| **Mobile: No component tests**   | Mobile   | All UI untested                   |
| **Mobile: No API client tests**  | Mobile   | All API calls untested            |
| **WebSocket endpoints: 0 tests** | Rust     | Real-time features untested       |
| **No HTTP integration tests**    | Rust     | Only unit tests, no E2E           |

### P1 - High Priority

| Gap                         | Platform | Impact                    |
| --------------------------- | -------- | ------------------------- |
| K8s: Only 2 unit tests      | Rust     | Minimal K8s coverage      |
| Web: No component rendering | Web      | React components untested |
| Web: No hook tests          | Web      | State management untested |
| Mobile: No WebSocket tests  | Mobile   | Console/events untested   |
| PR/Workflow features        | All      | Completely untested       |

### P2 - Medium Priority

| Gap                       | Platform | Impact                      |
| ------------------------- | -------- | --------------------------- |
| TUI: No mouse tests       | Rust     | Mouse interactions untested |
| TUI: No resize tests      | Rust     | Window resize untested      |
| Web: No terminal tests    | Web      | xterm.js untested           |
| API: access-mode endpoint | Rust     | No tests                    |
| API: upload endpoint      | Rust     | No tests                    |

### P3 - Lower Priority

| Gap                         | Platform | Impact                  |
| --------------------------- | -------- | ----------------------- |
| TUI: No copy mode tests     | Rust     | Text selection untested |
| TUI: No locked mode tests   | Rust     | Locked mode untested    |
| Docker: No volume lifecycle | Rust     | Volume mgmt untested    |
| K8s: No PVC tests           | Rust     | Storage untested        |

---

## Running Tests

### Rust

```bash
# All tests
cargo test

# With nextest (faster parallel)
cargo nextest run

# Specific test file
cargo test --test tui_tests

# With output
cargo test -- --nocapture
```

### Web

```bash
cd web && bun test
```

### Mobile

```bash
cd mobile && bun test
```
