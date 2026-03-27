---
title: Test Coverage
description: Comprehensive test coverage analysis mapping all tests to features
---

## Summary

| Platform         | Test Files                 | Tests | Coverage Level |
| ---------------- | -------------------------- | ----- | -------------- |
| **Rust Backend** | 24 integration + many unit | ~500+ | Comprehensive  |
| **Rust TUI**     | 1 (54KB)                   | 79    | Good           |
| **Web Frontend** | 6                          | ~130+ | Partial        |
| **Mobile**       | 1                          | 21    | Minimal        |

---

## Rust TUI Tests (79)

| Category          | Count | Coverage                                            |
| ----------------- | ----- | --------------------------------------------------- |
| State transitions | 11    | Initial state, navigation, dialog open/close, quit  |
| Event handlers    | 20    | Shortcuts, text input, toggles, delete confirmation |
| Rendering         | 6     | Empty/populated lists, error, loading, help         |
| API integration   | 14    | CRUD, archive, reconcile, blocking, state tracking  |
| Directory picker  | 8     | Lifecycle, navigation, search, selection            |
| Signal menu       | 8     | State, selection, open/close, rendering             |

**Not tested:** Mouse, resize, scroll, unicode, copy mode, locked mode, session switching, external editor.

---

## Docker Backend Tests (46)

| Category              | Count | Key Coverage                                        |
| --------------------- | ----- | --------------------------------------------------- |
| Build args            | 9     | -dit, non-root, workdir, prefix, attach, print mode |
| Security              | 5     | Git config sanitization, prompt escaping            |
| Caching               | 1     | Cargo/sccache volumes                               |
| Proxy                 | 4     | Env vars, volume mounts, host.docker.internal       |
| Git worktree          | 6     | Parent .git mount, relative paths, error handling   |
| Uploads/history       | 4     | Mount, path translation, subdirectory paths         |
| Dangerous mode        | 2     | Skip checks, claude.json handling                   |
| E2E (IGNORED)         | 5     | Full lifecycle, exists, attach, running check       |
| Integration (IGNORED) | 4     | Full lifecycle with attach, worktree+container      |
| Smoke (IGNORED)       | 5     | Claude startup, non-root, prompt, print mode        |

**Not tested:** CPU/memory limits, volume lifecycle, multi-container, crash detection.

---

## Zellij Tests (15)

| Category        | Count | Key Coverage                                   |
| --------------- | ----- | ---------------------------------------------- |
| Unit            | 11    | Background flag, CWD, bash, escaping, images   |
| E2E (3 IGNORED) | 4     | Lifecycle, exists, attach, delete non-existent |

---

## Health & Reconciliation Tests (67)

- Health check logic (28): All ResourceStates, backend-specific actions, startup detection
- API serialization (29): State/action/report serialization
- Reconciliation (5): Worktree/container cleanup, stale sessions
- Backend utilities (5): GitBackend, path generation

---

## API Endpoint Coverage

| Endpoint                    | Tested | Endpoint                     | Tested |
| --------------------------- | :----: | ---------------------------- | :----: |
| `GET /api/sessions`         |   ✅   | `POST .../refresh`           |   ❌   |
| `POST /api/sessions`        |   ✅   | `POST .../start/wake`        |   ⚠️   |
| `GET /api/sessions/{id}`    |   ✅   | `POST .../recreate/cleanup`  |   ⚠️   |
| `DELETE /api/sessions/{id}` |   ✅   | `POST .../access-mode`       |   ❌   |
| `POST .../archive`          |   ✅   | `GET .../history`            |   ❌   |
| `POST .../unarchive`        |   ✅   | `POST .../upload`            |   ❌   |
| `POST .../metadata`         |   ✅   | `POST /api/browse-directory` |   ❌   |
| `GET /api/health`           |   ✅   | `WS /ws/console`             |   ❌   |
| `GET .../health`            |   ✅   | `WS /ws/events`              |   ❌   |

:::note[Key Gap]
**NO HTTP INTEGRATION TESTS** -- All tests are unit tests on SessionManager, not actual HTTP request/response testing.
:::

---

## Web Frontend Tests (6 files, ~130+ tests)

| File                            | Tests | Coverage                                  |
| ------------------------------- | ----- | ----------------------------------------- |
| `RecreateConfirmModal.test.tsx` | 21    | State display, actions, data safety       |
| `RecreateBlockedModal.test.tsx` | 13    | Blocked detection, backend-specific       |
| `ThemeToggle.test.tsx`          | 13    | localStorage, system prefs, persistence   |
| `StartupHealthModal.test.tsx`   | 8     | Health labels, colors, filtering          |
| `claudeParser.test.ts`          | 30+   | ANSI, code blocks, paths, tools, messages |
| `codexHistoryParser.test.ts`    | 20+   | Format detection, parsing, function calls |

**Not tested:** Component rendering, user interactions, API calls, hooks, terminal, WebSocket, routing.

---

## Mobile Tests (1 file, 21 tests)

`historyParser.test.ts`: Message parsing, tool use/result matching.

:::danger[Critical Coverage Gaps]
All 6 screens, 10 components, navigation, contexts, hooks, API client (317 lines), WebSocket clients (665 lines), and error handling are untested.
:::

---

## Feature Test Matrix

| Feature         | Rust Backend | TUI | Web | Mobile |
| --------------- | :----------: | :-: | :-: | :----: |
| List sessions   |      ✅      | ✅  | ❌  |   ❌   |
| Create session  |      ✅      | ✅  | ❌  |   ❌   |
| Delete session  |      ✅      | ✅  | ❌  |   ❌   |
| Health status   |      ✅      | ✅  | ✅  |   ❌   |
| Message parsing |      ✅      | N/A | ✅  |   ✅   |
| PTY creation    |      ✅      | ✅  | ❌  |  N/A   |
| Signal menu     |     N/A      | ✅  | N/A |  N/A   |

## Priority Gaps

| Priority | Gap                          | Impact                      |
| -------- | ---------------------------- | --------------------------- |
| P0       | Mobile: No component tests   | All UI untested             |
| P0       | WebSocket endpoints: 0 tests | Real-time features untested |
| P0       | No HTTP integration tests    | Only unit tests             |
| P1       | Web: No component rendering  | React components untested   |
| P1       | Web: No hook tests           | State management untested   |

## Running Tests

```bash
cargo nextest run                 # Rust (all)
cargo nextest run --run-ignored all  # Rust (including E2E)
cd web && bun test                # Web
cd mobile && bun test             # Mobile
```
