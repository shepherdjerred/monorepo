---
title: Feature Parity
description: Comprehensive tracking of feature implementation across platforms and backends
---

## Legend

| Symbol | Meaning                          |
| ------ | -------------------------------- |
| ✅     | Fully implemented                |
| ❌     | Not implemented                  |
| ⚠️     | Partially implemented or limited |
| N/A    | Not applicable                   |

---

## Platform Feature Matrix

### Session Management

| Feature                                                | TUI | Web | Mobile |
| ------------------------------------------------------ | :-: | :-: | :----: |
| Session list view                                      | ✅  | ✅  |   ✅   |
| Status filtering (All/Running/Idle/Completed/Archived) | ✅  | ✅  |   ✅   |
| Create session                                         | ✅  | ✅  |   ✅   |
| Delete session                                         | ✅  | ✅  |   ✅   |
| Archive/Unarchive                                      | ✅  | ✅  |   ✅   |
| Edit metadata (title/description)                      | ❌  | ✅  |   ✅   |
| Regenerate metadata (AI)                               | ❌  | ✅  |   ✅   |
| Refresh/Recreate container                             | ✅  | ✅  |   ✅   |
| Health status display                                  | ✅  | ✅  |   ❌   |
| Workflow stage / PR status / CI / review               | ✅  | ✅  |   ✅   |
| Changed files list                                     | ❌  | ✅  |   ❌   |
| Auto-refresh                                           | ✅  | ✅  |   ❌   |

### Session Creation

| Feature                             | TUI | Web | Mobile |
| ----------------------------------- | :-: | :-: | :----: |
| Repository path selection           | ✅  | ✅  |   ✅   |
| Directory browser                   | ✅  | ✅  |   ❌   |
| External editor (Ctrl+E)            | ✅  | ❌  |   ❌   |
| Backend/Agent selection             | ✅  | ✅  |   ✅   |
| Model selection                     | ✅  | ✅  |   ❌   |
| Plan mode                           | ✅  | ✅  |   ✅   |
| Multi-repository support            | ❌  | ✅  |   ❌   |
| Container config (image/CPU/memory) | ❌  | ✅  |   ❌   |
| Image attachments                   | ✅  | ✅  |   ❌   |

### Terminal/Console

| Feature                       | TUI | Web | Mobile |
| ----------------------------- | :-: | :-: | :----: |
| Full PTY / terminal emulation | ✅  | ✅  |   ❌   |
| Scrollback buffer (10k lines) | ✅  | ✅  |   ❌   |
| Copy mode / text selection    | ✅  | ✅  |   ❌   |
| Locked mode                   | ✅  | ❌  |   ❌   |
| Signal menu (Ctrl+M)          | ✅  | ❌  |   ❌   |
| Session switching (Ctrl+P/N)  | ✅  | ❌  |   ❌   |

### Chat Interface

| Feature                         | TUI | Web | Mobile |
| ------------------------------- | :-: | :-: | :----: |
| Message history display         | ❌  | ✅  |   ✅   |
| Markdown / code highlighting    | ❌  | ✅  |   ✅   |
| Tool use / Plan / Question view | ❌  | ✅  |   ✅   |
| Image upload / Send message     | ❌  | ✅  |   ✅   |

### Health & Recovery

| Feature                                      | TUI | Web | Mobile |
| -------------------------------------------- | :-: | :-: | :----: |
| Health status per session                    | ✅  | ✅  |   ❌   |
| Health actions (Start/Recreate/Cleanup)      | ✅  | ✅  |   ❌   |
| Data safety indicator                        | ✅  | ✅  |   ❌   |
| Retry reconciliation                         | ✅  | ❌  |   ❌   |

### Settings & Authentication

| Feature                             | TUI | Web | Mobile |
| ----------------------------------- | :-: | :-: | :----: |
| Theme selection (Light/Dark/System) | ❌  | ✅  |   ✅   |
| WebAuthn/Passkey login              | ❌  | ✅  |   ❌   |
| Daemon URL configuration            | ❌  | ❌  |   ✅   |
| Help / keyboard shortcuts           | ✅  | ❌  |   ❌   |
| System status                       | ❌  | ✅  |   ✅   |
| Usage tracking                      | ❌  | ✅  |   ✅   |

---

## Backend Capabilities Matrix

| Feature                |     Docker      |     Zellij     |
| ---------------------- | :-------------: | :------------: |
| Environment type       | Local container | Local terminal |
| Container isolation    |       ✅        |       ❌       |
| Multi-repo support     |       ✅        |       ❌       |
| CPU/Memory limits      |       ✅        |       ❌       |
| Custom container image |       ✅        |      N/A       |
| Volume mode option     |       ✅        |      N/A       |
| Shared cargo/sccache   | ✅ Named volume |    ✅ Host     |
| Claude Code            |       ✅        |       ✅       |
| Codex                  |       ✅        |       ❌       |
| Gemini                 |       ✅        |       ✅       |
| Plan mode / Print mode |     ✅ / ✅     |    ✅ / ❌     |
| Hooks support          |     ✅ HTTP     |       ❌       |

---

## API Endpoint Coverage

### HTTP Endpoints

| Endpoint                                 | Method | TUI | Web | Mobile | CLI |
| ---------------------------------------- | ------ | :-: | :-: | :----: | :-: |
| `/api/sessions`                          | GET    | ✅  | ✅  |   ✅   | ✅  |
| `/api/sessions`                          | POST   | ✅  | ✅  |   ✅   | ✅  |
| `/api/sessions/{id}`                     | GET    | ✅  | ✅  |   ✅   | ✅  |
| `/api/sessions/{id}`                     | DELETE | ✅  | ✅  |   ✅   | ✅  |
| `/api/sessions/{id}/archive`             | POST   | ✅  | ✅  |   ✅   | ✅  |
| `/api/sessions/{id}/unarchive`           | POST   | ✅  | ✅  |   ✅   | ✅  |
| `/api/sessions/{id}/refresh`             | POST   | ✅  | ✅  |   ✅   | ✅  |
| `/api/sessions/{id}/start`               | POST   | ✅  | ✅  |   ❌   | ❌  |
| `/api/sessions/{id}/recreate`            | POST   | ✅  | ✅  |   ❌   | ❌  |
| `/api/sessions/{id}/cleanup`             | POST   | ✅  | ✅  |   ❌   | ❌  |
| `/api/sessions/{id}/metadata`            | POST   | ❌  | ✅  |   ✅   | ❌  |
| `/api/sessions/{id}/regenerate-metadata` | POST   | ❌  | ✅  |   ✅   | ❌  |
| `/api/sessions/{id}/history`             | GET    | ❌  | ✅  |   ✅   | ❌  |
| `/api/sessions/{id}/upload`              | POST   | ❌  | ✅  |   ✅   | ❌  |
| `/api/health`                            | GET    | ✅  | ✅  |   ❌   | ❌  |
| `/api/sessions/{id}/health`              | GET    | ✅  | ✅  |   ❌   | ❌  |
| `/api/auth/*` (5 endpoints)              | \*     | ❌  | ✅  |   ❌   | ❌  |

### WebSocket Endpoints

| Endpoint                  | TUI | Web | Mobile |
| ------------------------- | :-: | :-: | :----: |
| `/ws/console/{sessionId}` | ✅  | ✅  |   ✅   |
| `/ws/events`              | ✅  | ✅  |   ✅   |

---

## Priority Gaps

### Critical

| Gap                            | Affected | Impact                           |
| ------------------------------ | -------- | -------------------------------- |
| **TUI: No chat interface**     | TUI      | Cannot view conversation history |
| **Mobile: No health/recovery** | Mobile   | Cannot fix broken sessions       |
| **Mobile: No model selection** | Mobile   | Cannot choose specific models    |
| **Zellij: No Codex agent**     | Zellij   | Cannot use Codex                 |

### Medium

| Gap                         | Affected | Impact                          |
| --------------------------- | -------- | ------------------------------- |
| TUI: No metadata editing    | TUI      | Cannot update title/description |
| TUI: No system status       | TUI      | Cannot view usage stats         |
| Mobile: No terminal         | Mobile   | Text-only, no PTY               |
| Mobile: No container config | Mobile   | Cannot set CPU/memory/image     |

---

## Platform-Specific Features

**TUI-Only:** Locked mode, signal menu, session switching (Ctrl+P/N), external editor, copy mode, scroll mode, help overlay.

**Web-Only:** Multi-repo, container customization, WebAuthn, agent capabilities display, terminal themes.

**Mobile-Only:** Daemon URL config, test connection, app state reconnection, camera capture.
