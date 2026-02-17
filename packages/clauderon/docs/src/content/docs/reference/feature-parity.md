---
title: Feature Parity
description: Comprehensive tracking of feature implementation across platforms and backends
---

This document tracks feature implementation status across all Clauderon platforms (TUI, Web, Mobile) and backend capabilities (Docker, Kubernetes, Zellij, Sprites, AppleContainer).

## Legend

| Symbol | Meaning                                 |
| ------ | --------------------------------------- |
| ✅     | Fully implemented                       |
| ❌     | Not implemented                         |
| ⚠️     | Partially implemented or limited        |
| N/A    | Not applicable to this platform/backend |

---

## Platform Feature Matrix

### Session Management

| Feature                                                | TUI | Web | Mobile | Notes                   |
| ------------------------------------------------------ | :-: | :-: | :----: | ----------------------- |
| Session list view                                      | ✅  | ✅  |   ✅   |                         |
| Status filtering (All/Running/Idle/Completed/Archived) | ✅  | ✅  |   ✅   |                         |
| Create session                                         | ✅  | ✅  |   ✅   |                         |
| Delete session                                         | ✅  | ✅  |   ✅   |                         |
| Archive/Unarchive                                      | ✅  | ✅  |   ✅   |                         |
| Edit metadata (title/description)                      | ❌  | ✅  |   ✅   | TUI missing             |
| Regenerate metadata (AI)                               | ❌  | ✅  |   ✅   | TUI missing             |
| Refresh/Recreate container                             | ✅  | ✅  |   ✅   | Docker only             |
| Health status display                                  | ✅  | ✅  |   ❌   | Mobile missing          |
| Workflow stage display                                 | ✅  | ✅  |   ✅   |                         |
| PR status display                                      | ✅  | ✅  |   ✅   |                         |
| PR check status (CI)                                   | ✅  | ✅  |   ✅   |                         |
| PR review decision                                     | ✅  | ✅  |   ✅   |                         |
| Merge conflict indicator                               | ✅  | ✅  |   ✅   |                         |
| Worktree dirty indicator                               | ✅  | ✅  |   ✅   |                         |
| Changed files list                                     | ❌  | ✅  |   ❌   | Web only (tooltip)      |
| Claude working status                                  | ✅  | ✅  |   ✅   | Via hooks               |
| Copy-creds warning                                     | ✅  | ✅  |   ❌   | Mobile missing          |
| Auto-refresh                                           | ✅  | ✅  |   ❌   | Mobile: pull-to-refresh |

### Session Creation

| Feature                     | TUI | Web | Mobile | Notes                    |
| --------------------------- | :-: | :-: | :----: | ------------------------ |
| Repository path selection   | ✅  | ✅  |   ✅   |                          |
| Recent repos picker         | ✅  | ✅  |   ✅   |                          |
| Directory browser           | ✅  | ✅  |   ❌   | Mobile: text input only  |
| Initial prompt              | ✅  | ✅  |   ✅   |                          |
| Multiline prompt editing    | ✅  | ✅  |   ✅   |                          |
| External editor (Ctrl+E)    | ✅  | ❌  |   ❌   | TUI only                 |
| Backend selection           | ✅  | ✅  |   ✅   |                          |
| Agent selection             | ✅  | ✅  |   ✅   |                          |
| Model selection             | ✅  | ✅  |   ❌   | Mobile missing           |
| Access mode toggle          | ✅  | ✅  |   ✅   |                          |
| Plan mode toggle            | ✅  | ✅  |   ✅   |                          |
| Skip safety checks toggle   | ✅  | ✅  |   ✅   |                          |
| Dangerous copy_creds toggle | ✅  | ✅  |   ❌   | Mobile missing           |
| Multi-repository support    | ❌  | ✅  |   ❌   | Web only (up to 5 repos) |
| Mount name configuration    | ❌  | ✅  |   ❌   | Web only                 |
| Primary repo selection      | ❌  | ✅  |   ❌   | Web only                 |
| Base branch selection       | ✅  | ✅  |   ❌   | Mobile missing           |
| Custom container image      | ❌  | ✅  |   ❌   | Web only                 |
| Image pull policy           | ❌  | ✅  |   ❌   | Web only                 |
| CPU limit                   | ❌  | ✅  |   ❌   | Web only                 |
| Memory limit                | ❌  | ✅  |   ❌   | Web only                 |
| Storage class (K8s)         | ❌  | ✅  |   ❌   | Web only                 |
| Image attachments on create | ✅  | ✅  |   ❌   | TUI: drag-drop only      |
| Agent capabilities display  | ❌  | ✅  |   ❌   | Web only                 |

### Terminal/Console

| Feature                              | TUI | Web | Mobile | Notes                       |
| ------------------------------------ | :-: | :-: | :----: | --------------------------- |
| Terminal emulation                   | ✅  | ✅  |   ❌   | Mobile: WebSocket text only |
| Full PTY support                     | ✅  | ✅  |   ❌   |                             |
| VT100 escape sequences               | ✅  | ✅  |   ❌   |                             |
| Full keyboard input                  | ✅  | ✅  |   ❌   | Mobile: limited             |
| Scrollback buffer                    | ✅  | ✅  |   ❌   | TUI: 10k lines, Web: 10k    |
| Copy mode / text selection           | ✅  | ✅  |   ❌   | TUI: disabled by default    |
| Scroll mode                          | ✅  | ✅  |   ❌   |                             |
| Locked mode                          | ✅  | ❌  |   ❌   | TUI only                    |
| Signal menu (SIGINT/SIGTSTP/SIGQUIT) | ✅  | ❌  |   ❌   | TUI only (Ctrl+M)           |
| Direct signal keys (Ctrl+C/Z/\)      | ✅  | ✅  |   ❌   |                             |
| Session switching while attached     | ✅  | ❌  |   ❌   | TUI only (Ctrl+P/N)         |
| Connection status indicator          | ✅  | ✅  |   ✅   |                             |
| Terminal themes (light/dark)         | ❌  | ✅  |   ❌   | Web only                    |
| Terminal resize                      | ✅  | ✅  |   ❌   |                             |

### Chat Interface

| Feature                         | TUI | Web | Mobile | Notes                           |
| ------------------------------- | :-: | :-: | :----: | ------------------------------- |
| Message history display         | ❌  | ✅  |   ✅   | TUI missing entirely            |
| Markdown rendering              | ❌  | ✅  |   ✅   |                                 |
| Code syntax highlighting        | ❌  | ✅  |   ✅   | Web: Shiki, Mobile: atomOneDark |
| Tool use display                | ❌  | ✅  |   ✅   |                                 |
| Plan display (PlanView)         | ❌  | ✅  |   ✅   |                                 |
| Question display (QuestionView) | ❌  | ✅  |   ✅   |                                 |
| Image upload in chat            | ❌  | ✅  |   ✅   |                                 |
| Image preview                   | ❌  | ✅  |   ✅   |                                 |
| Send message                    | ❌  | ✅  |   ✅   |                                 |
| Auto-scroll to latest           | ❌  | ✅  |   ✅   |                                 |
| Claude/Codex format detection   | ❌  | ✅  |   ✅   | Auto-detects JSONL format       |
| Image path translation          | ❌  | ✅  |   ✅   | Host → container paths          |

### Health & Recovery

| Feature                        | TUI | Web | Mobile | Notes                   |
| ------------------------------ | :-: | :-: | :----: | ----------------------- |
| Startup health modal           | ✅  | ✅  |   ❌   | Mobile missing          |
| Health status per session      | ✅  | ✅  |   ❌   | Mobile missing          |
| Recreate confirm dialog        | ✅  | ✅  |   ❌   | Mobile missing          |
| Recreate blocked warning       | ✅  | ✅  |   ❌   | Mobile missing          |
| Available actions display      | ✅  | ✅  |   ❌   | Start/Wake/Recreate/etc |
| Recommended action highlight   | ✅  | ✅  |   ❌   |                         |
| Data safety indicator          | ✅  | ✅  |   ❌   |                         |
| Expandable details             | ✅  | ✅  |   ❌   |                         |
| Reconcile errors display       | ✅  | ✅  |   ❌   | Mobile missing          |
| Retry reconciliation           | ✅  | ❌  |   ❌   | TUI only                |
| Health actions: Start          | ✅  | ✅  |   ❌   |                         |
| Health actions: Wake           | ✅  | ✅  |   ❌   |                         |
| Health actions: Recreate       | ✅  | ✅  |   ❌   |                         |
| Health actions: Recreate Fresh | ✅  | ✅  |   ❌   |                         |
| Health actions: Update Image   | ✅  | ✅  |   ❌   |                         |
| Health actions: Cleanup        | ✅  | ✅  |   ❌   |                         |

### Settings & Configuration

| Feature                             | TUI | Web | Mobile | Notes       |
| ----------------------------------- | :-: | :-: | :----: | ----------- |
| Theme selection (Light/Dark/System) | ❌  | ✅  |   ✅   | TUI missing |
| Daemon URL configuration            | ❌  | ❌  |   ✅   | Mobile only |
| Test connection                     | ❌  | ❌  |   ✅   | Mobile only |
| Help screen                         | ✅  | ❌  |   ❌   | TUI only    |
| Keyboard shortcuts reference        | ✅  | ❌  |   ❌   | TUI only    |
| About section                       | ❌  | ❌  |   ✅   | Mobile only |

### System Status

| Feature                           | TUI | Web | Mobile | Notes       |
| --------------------------------- | :-: | :-: | :----: | ----------- |
| Credentials list                  | ❌  | ✅  |   ✅   | TUI missing |
| Credential status (found/missing) | ❌  | ✅  |   ✅   |             |
| Credential source (env/file)      | ❌  | ✅  |   ✅   |             |
| Masked credential preview         | ❌  | ✅  |   ✅   |             |
| Add/Update credentials            | ❌  | ✅  |   ✅   |             |
| Readonly indicator                | ❌  | ✅  |   ✅   |             |
| Usage tracking (5-hour window)    | ❌  | ✅  |   ✅   |             |
| Usage tracking (7-day window)     | ❌  | ✅  |   ✅   |             |
| Usage tracking (7-day Sonnet)     | ❌  | ✅  |   ✅   |             |
| Usage progress bars               | ❌  | ✅  |   ✅   |             |
| Usage reset time                  | ❌  | ✅  |   ✅   |             |
| Usage error display               | ❌  | ✅  |   ✅   |             |
| Proxy status list                 | ❌  | ✅  |   ✅   |             |
| Active session proxies count      | ❌  | ✅  |   ✅   |             |

### Authentication

| Feature                   | TUI | Web | Mobile | Notes    |
| ------------------------- | :-: | :-: | :----: | -------- |
| WebAuthn/Passkey login    | ❌  | ✅  |   ❌   | Web only |
| User registration         | ❌  | ✅  |   ❌   | Web only |
| Session cookie management | ❌  | ✅  |   ❌   | Web only |
| Auth guard/redirect       | ❌  | ✅  |   ❌   | Web only |
| Localhost bypass          | ❌  | ✅  |   ❌   | Web only |

### Real-time Updates

| Feature                     | TUI | Web | Mobile | Notes                        |
| --------------------------- | :-: | :-: | :----: | ---------------------------- |
| WebSocket console streaming | ✅  | ✅  |   ✅   |                              |
| WebSocket session events    | ✅  | ✅  |   ✅   |                              |
| SessionCreated event        | ✅  | ✅  |   ✅   |                              |
| SessionUpdated event        | ✅  | ✅  |   ✅   |                              |
| SessionDeleted event        | ✅  | ✅  |   ✅   |                              |
| StatusChanged event         | ✅  | ✅  |   ❌   |                              |
| Progress events             | ✅  | ✅  |   ❌   |                              |
| Auto-refresh polling        | ✅  | ✅  |   ❌   | Mobile: manual               |
| App state reconnection      | ❌  | ❌  |   ✅   | Mobile: foreground reconnect |

---

## Backend Capabilities Matrix

### Environment & Scope

| Feature             |     Docker      |     K8s     |     Zellij     |       Sprites       |   Apple    |
| ------------------- | :-------------: | :---------: | :------------: | :-----------------: | :--------: |
| Environment type    | Local container | Remote pods | Local terminal |     Remote VMs      | Local VMs  |
| OS Support          | Linux/macOS/Win | Any cluster |      Any       |         Any         | macOS only |
| Requires daemon     |       ✅        |     ✅      |       ✅       |         ✅          |     ✅     |
| PTY Support         |     ✅ Full     |   ✅ Full   |    ✅ Full     | ⚠️ Partial (abduco) |  ✅ Full   |
| Container isolation |       ✅        |     ✅      |       ❌       |         ✅          |     ✅     |

### Data Persistence

| Feature                    |     Docker      |      K8s      |    Zellij    |      Sprites      |      Apple      |
| -------------------------- | :-------------: | :-----------: | :----------: | :---------------: | :-------------: |
| Code preserved on recreate |       ✅        |      ✅       |      ✅      | ⚠️ (auto_destroy) |       ✅        |
| Mount strategy             |   Bind/Volume   |   PVC clone   | Git worktree |   Remote clone    |   Bind mount    |
| Multi-repo support         |       ✅        |    ❌ TODO    |      ❌      |        ✅         |       ❌        |
| Volume mode option         |       ✅        |      N/A      |     N/A      |        N/A        |       N/A       |
| Shared cargo cache         | ✅ Named volume | ✅ Shared PVC |   ✅ Host    |        ❌         | ✅ Named volume |
| Shared sccache             |       ✅        |      ✅       |   ✅ Host    |        ❌         |       ✅        |

### Resource Configuration

| Feature                 |   Docker    |        K8s         |  Zellij  | Sprites  |    Apple    |
| ----------------------- | :---------: | :----------------: | :------: | :------: | :---------: |
| CPU limits              |  ✅ --cpus  | ✅ requests/limits |    ❌    |    ❌    |  ✅ --cpus  |
| Memory limits           | ✅ --memory | ✅ requests/limits |    ❌    |    ❌    | ✅ --memory |
| Storage size            |  Implicit   |    ✅ PVC size     | Implicit | Implicit |  Implicit   |
| Custom container image  |     ✅      |         ✅         |   N/A    |   N/A    |     ✅      |
| Image pull policy       |     ✅      |         ✅         |   N/A    |   N/A    |     ✅      |
| Storage class selection |     N/A     |         ✅         |   N/A    |   N/A    |     N/A     |

### Credential Handling

| Feature               |    Docker    |       K8s       | Zellij |   Sprites   |    Apple     |
| --------------------- | :----------: | :-------------: | :----: | :---------: | :----------: |
| Is remote             |      ❌      |       ✅        |   ❌   |     ✅      |      ❌      |
| Zero-credential proxy | ✅ Optional  |   ✅ Optional   |  N/A   | Conditional | ✅ Optional  |
| copy_creds option     | N/A (local)  |       ✅        |  N/A   |     ✅      | N/A (local)  |
| Git config passing    | ✅ sanitized |  ✅ sanitized   |  N/A   | ✅ escaped  | ✅ sanitized |
| Proxy gateway IP      |  localhost   | service/gateway |  N/A   |     N/A     | 192.168.64.1 |

### Agent Support

| Feature        | Docker | K8s | Zellij | Sprites | Apple |
| -------------- | :----: | :-: | :----: | :-----: | :---: |
| Claude Code    |   ✅   | ✅  |   ✅   |   ✅    |  ✅   |
| Codex          |   ✅   | ✅  |   ❌   |   ✅    |  ✅   |
| Gemini         |   ✅   | ✅  |   ✅   |   ✅    |  ✅   |
| Model override |   ✅   | ✅  |   ✅   |   ❌    |  ✅   |
| Plan mode      |   ✅   | ✅  |   ✅   |   ❌    |  ✅   |
| Print mode     |   ✅   | ✅  |   ❌   |   ❌    |  ✅   |

### Lifecycle Management

| Feature           |   Docker    |         K8s         |     Zellij      |     Sprites     |       Apple       |
| ----------------- | :---------: | :-----------------: | :-------------: | :-------------: | :---------------: |
| Health check      | ✅ exists() |    ✅ pod phase     | ✅ session list | ✅ sprite list  | ✅ container list |
| Crash detection   |     ❌      | ✅ CrashLoopBackOff |       N/A       |       N/A       |        ✅         |
| Start (stopped)   |     N/A     |  ❌ (auto-restart)  |       N/A       |       ❌        |        ✅         |
| Wake (hibernated) |     ❌      |         ❌          |       ❌        |       ✅        |        ❌         |
| Plugin support    |  ✅ mount   | ⚠️ discovered only  |     ✅ host     |       ❌        |     ✅ mount      |
| Auto-destroy      |   Always    |       Always        |       N/A       | ⚠️ configurable |      Always       |
| Checkpoint        |     ❌      |         ❌          |       N/A       |      TODO       |        ❌         |

### Session Features

| Feature                | Docker  |      K8s      | Zellij |   Sprites   |       Apple       |
| ---------------------- | :-----: | :-----------: | :----: | :---------: | :---------------: |
| session_id persistence |   ✅    |      ✅       |   ✅   | ✅ (abduco) |        ✅         |
| Hooks support          | ✅ HTTP |      ❌       |   ❌   |     ❌      |      ✅ HTTP      |
| Image attachments      |   ✅    | ✅ translated |   ✅   |     ✅      |   ✅ translated   |
| get_output support     |   ✅    |      ✅       |   ✅   |     ✅      | ❌ platform limit |

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
| `/api/sessions/{id}/wake`                | POST   | ✅  | ✅  |   ❌   | ❌  |
| `/api/sessions/{id}/recreate`            | POST   | ✅  | ✅  |   ❌   | ❌  |
| `/api/sessions/{id}/cleanup`             | POST   | ✅  | ✅  |   ❌   | ❌  |
| `/api/sessions/{id}/metadata`            | POST   | ❌  | ✅  |   ✅   | ❌  |
| `/api/sessions/{id}/regenerate-metadata` | POST   | ❌  | ✅  |   ✅   | ❌  |
| `/api/sessions/{id}/access-mode`         | POST   | ✅  | ✅  |   ✅   | ✅  |
| `/api/sessions/{id}/history`             | GET    | ❌  | ✅  |   ✅   | ❌  |
| `/api/sessions/{id}/upload`              | POST   | ❌  | ✅  |   ✅   | ❌  |
| `/api/health`                            | GET    | ✅  | ✅  |   ❌   | ❌  |
| `/api/sessions/{id}/health`              | GET    | ✅  | ✅  |   ❌   | ❌  |
| `/api/recent-repos`                      | GET    | ✅  | ✅  |   ✅   | ❌  |
| `/api/browse-directory`                  | POST   | ✅  | ✅  |   ❌   | ❌  |
| `/api/credentials`                       | POST   | ❌  | ✅  |   ✅   | ❌  |
| `/api/status`                            | GET    | ❌  | ✅  |   ✅   | ❌  |
| `/api/storage-classes`                   | GET    | ❌  | ✅  |   ❌   | ❌  |
| `/api/feature-flags`                     | GET    | ✅  | ✅  |   ❌   | ✅  |
| `/api/hooks`                             | POST   | N/A | N/A |  N/A   | N/A |
| `/api/auth/*` (5 endpoints)              | \*     | ❌  | ✅  |   ❌   | ❌  |

### WebSocket Endpoints

| Endpoint                  | TUI | Web | Mobile |
| ------------------------- | :-: | :-: | :----: |
| `/ws/console/{sessionId}` | ✅  | ✅  |   ✅   |
| `/ws/events`              | ✅  | ✅  |   ✅   |

---

## CLI Command Coverage

| Command              | Purpose                 | Platforms Using       |
| -------------------- | ----------------------- | --------------------- |
| `daemon`             | Start background daemon | All (auto-spawn)      |
| `tui`                | Terminal UI             | TUI only              |
| `create`             | Create session          | CLI, TUI              |
| `list`               | List sessions           | CLI                   |
| `attach`             | Attach to session       | CLI, TUI              |
| `archive`            | Archive session         | CLI, TUI, Web, Mobile |
| `delete`             | Delete session          | CLI, TUI, Web, Mobile |
| `refresh`            | Refresh container       | CLI, TUI, Web, Mobile |
| `set-access-mode`    | Update access mode      | CLI                   |
| `reconcile`          | Fix state mismatches    | CLI                   |
| `clean-cache`        | Clean cargo volumes     | CLI                   |
| `config show`        | Show configuration      | CLI                   |
| `config paths`       | List file paths         | CLI                   |
| `config env`         | Show env vars           | CLI                   |
| `config credentials` | Show credentials        | CLI                   |

---

## Feature Flags

| Flag                        | Default | TUI | Web | Mobile | CLI |
| --------------------------- | ------- | :-: | :-: | :----: | :-: |
| `enable_webauthn_auth`      | false   | ❌  | ✅  |   ❌   | ✅  |
| `enable_ai_metadata`        | true    | ❌  | ✅  |   ✅   | ❌  |
| `enable_auto_reconcile`     | true    | ✅  | ✅  |   ❌   | ✅  |
| `enable_proxy_port_reuse`   | false   | ✅  | ✅  |   ✅   | ✅  |
| `enable_usage_tracking`     | false   | ❌  | ✅  |   ✅   | ✅  |
| `enable_kubernetes_backend` | false   | ✅  | ✅  |   ✅   | ✅  |

---

## Priority Gaps to Address

### Critical (Core Functionality Missing)

| Priority | Gap                            | Affected        | Impact                           |
| -------- | ------------------------------ | --------------- | -------------------------------- |
| P0       | **TUI: No chat interface**     | TUI             | Cannot view conversation history |
| P0       | **Mobile: No health/recovery** | Mobile          | Cannot fix broken sessions       |
| P0       | **K8s: No multi-repo**         | K8s backend     | Limited to single repo           |
| P1       | **Mobile: No model selection** | Mobile          | Cannot choose specific models    |
| P1       | **Sprites: No plan mode**      | Sprites backend | Cannot use plan workflow         |
| P1       | **Zellij: No Codex agent**     | Zellij backend  | Cannot use Codex                 |

### High (Major Feature Gaps)

| Priority | Gap                         | Affected    | Impact                          |
| -------- | --------------------------- | ----------- | ------------------------------- |
| P2       | TUI: No metadata editing    | TUI         | Cannot update title/description |
| P2       | TUI: No system status       | TUI         | Cannot view credentials/usage   |
| P2       | Mobile: No terminal         | Mobile      | Text-only console, no PTY       |
| P2       | Mobile: No container config | Mobile      | Cannot set CPU/memory/image     |
| P2       | K8s: Plugin discovery only  | K8s backend | Plugins not mounted             |

### Medium (Enhanced UX)

| Priority | Gap                          | Affected        | Impact                    |
| -------- | ---------------------------- | --------------- | ------------------------- |
| P3       | Mobile: No directory browser | Mobile          | Text input only for paths |
| P3       | Mobile: No auto-refresh      | Mobile          | Manual pull-to-refresh    |
| P3       | Sprites: No build caching    | Sprites backend | Slower rebuilds           |
| P3       | Sprites: No model override   | Sprites backend | Uses default model        |
| P3       | TUI: No theme selection      | TUI             | No dark/light toggle      |

### Low (Nice to Have)

| Priority | Gap                        | Affected        | Impact                  |
| -------- | -------------------------- | --------------- | ----------------------- |
| P4       | Web: No locked mode        | Web             | TUI-only feature        |
| P4       | Web: No signal menu        | Web             | TUI-only feature        |
| P4       | Docker: No crash detection | Docker          | No CrashLoop equivalent |
| P4       | Sprites: No checkpoint     | Sprites backend | TODO for hibernation    |

---

## Platform-Specific Features

### TUI-Only Features

| Feature           | Description                           |
| ----------------- | ------------------------------------- |
| Locked mode       | All keys forwarded except Ctrl+L      |
| Signal menu       | Ctrl+M to send SIGINT/SIGTSTP/SIGQUIT |
| Session switching | Ctrl+P/N while attached               |
| External editor   | Ctrl+E to edit prompt in $EDITOR      |
| Copy mode         | Text selection with vim-like keys     |
| Scroll mode       | Dedicated scroll navigation           |
| Help overlay      | Context-sensitive keyboard reference  |
| Spinner animation | Braille-based loading indicator       |

### Web-Only Features

| Feature                    | Description                       |
| -------------------------- | --------------------------------- |
| Multi-repo support         | Up to 5 repos with mount names    |
| Container customization    | Image, CPU, memory, storage class |
| WebAuthn authentication    | Passkey-based login               |
| Agent capabilities display | Feature matrix per agent          |
| Terminal themes            | Light/dark Ghostty themes         |
| Brutalist design system    | Bold borders, high contrast       |

### Mobile-Only Features

| Feature                      | Description                  |
| ---------------------------- | ---------------------------- |
| Daemon URL configuration     | Connect to remote daemon     |
| Test connection button       | Validate daemon connectivity |
| App state reconnection       | Auto-reconnect on foreground |
| Camera image capture         | Take photos for context      |
| Platform-specific navigation | Native stack on iOS/Android  |

---

## Maintainer Notes

### Updating This Document

When adding new features:

1. Update the relevant platform matrix table
2. If backend-specific, update the backend capabilities matrix
3. If it's a new API endpoint, add to the API coverage table
4. If it creates a gap, add to the priority gaps section
5. If it's platform-specific, add to the platform-specific features section

### Verification Checklist

Before releasing, verify:

- [ ] All new features documented in this matrix
- [ ] Priority gaps updated based on current state
- [ ] API endpoints match actual implementation
- [ ] Feature flags documented with current defaults
