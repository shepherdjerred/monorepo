---
title: API Reference
description: REST and WebSocket API for clauderon
---

Base URL: `http://localhost:3030`

## REST API

### Health Check

```http
GET /health
```

```json
{ "status": "healthy", "version": "0.1.0" }
```

### List Sessions

```http
GET /api/sessions?include_archived=false
```

```json
{
  "sessions": [
    {
      "id": "uuid",
      "name": "session-name",
      "backend": "docker",
      "agent": "claude",
      "access_mode": "read-write",
      "status": "running",
      "repo_path": "/home/user/project",
      "created_at": "2024-01-15T10:30:00Z",
      "archived": false
    }
  ]
}
```

### Get Session

```http
GET /api/sessions/:id
```

Returns full session including `chat_history`, `prompt`, `worktree_path`.

### Create Session

```http
POST /api/sessions
```

**Single repo:**

```json
{
  "repo_path": "/home/user/project",
  "prompt": "Fix the login bug",
  "backend": "docker",
  "agent": "claude",
  "access_mode": "read-write",
  "model": "claude-sonnet-4-5"
}
```

**Multi-repo:**

```json
{
  "name": "multi-repo-session",
  "repositories": [
    { "path": "/home/user/project1", "mount_name": "main" },
    { "path": "/home/user/project2", "mount_name": "lib" }
  ],
  "prompt": "Refactor shared code",
  "backend": "docker",
  "agent": "claude"
}
```

| Field          | Type    | Required | Description                    |
| -------------- | ------- | -------- | ------------------------------ |
| `repo_path`    | string  | Yes\*    | Single repository path         |
| `repositories` | array   | Yes\*    | Multi-repo array (max 5)       |
| `prompt`       | string  | Yes      | Initial prompt                 |
| `backend`      | string  | No       | Backend type                   |
| `agent`        | string  | No       | Agent type (default: "claude") |
| `access_mode`  | string  | No       | "read-only" or "read-write"    |
| `no_plan_mode` | boolean | No       | Disable plan mode              |
| `model`        | string  | No       | Model override                 |
| `name`         | string  | No       | Custom session name            |
| `base_branch`  | string  | No       | Git base branch                |
| `image_paths`  | array   | No       | Image attachments              |

\* Either `repo_path` or `repositories` required

### Delete Session

```http
DELETE /api/sessions/:id?force=false
```

### Archive / Unarchive

```http
POST /api/sessions/:id/archive
POST /api/sessions/:id/unarchive
```

### Set Access Mode

```http
PUT /api/sessions/:id/access-mode
```

```json
{ "access_mode": "read-only" }
```

### Refresh Session

```http
POST /api/sessions/:id/refresh
```

Pulls latest image and recreates container (Docker only).

### Start / Wake / Recreate / Cleanup

```http
POST /api/sessions/:id/start
POST /api/sessions/:id/wake
POST /api/sessions/:id/recreate          # body: { "fresh": false }
POST /api/sessions/:id/recreate-fresh
POST /api/sessions/:id/cleanup
```

### Get Session Health

```http
GET /api/sessions/:id/health
```

```json
{
  "session_id": "uuid",
  "health": "Error",
  "details": {
    "container_status": "exited",
    "exit_code": 1,
    "error_message": "OCI runtime error"
  },
  "available_actions": ["recreate", "recreate_fresh", "cleanup"],
  "data_preservation": {
    "recreate": true,
    "recreate_fresh": false,
    "cleanup": false
  },
  "reconciliation": { "attempts": 2, "last_attempt": "2025-01-28T12:30:00Z" }
}
```

### Update / Regenerate Metadata

```http
POST /api/sessions/:id/metadata
```

```json
{ "name": "new-name", "description": "...", "tags": ["feature-x"] }
```

```http
POST /api/sessions/:id/regenerate-metadata
```

AI-generated metadata from chat history. Requires `ai_metadata = true`.

### Upload Files

```http
POST /api/sessions/:id/upload
```

Multipart form data. Files uploaded to session working directory.

### Browse Directory

```http
POST /api/browse-directory
```

```json
{ "path": "/home/user/projects", "show_hidden": false }
```

### Get Config / Credentials

```http
GET /api/config
GET /api/credentials
```

## WebSocket API

### Event Stream

```
ws://localhost:3030/ws/events
```

**Subscribe/Unsubscribe:**

```json
{ "type": "subscribe", "session_id": "uuid" }
{ "type": "unsubscribe", "session_id": "uuid" }
```

**Events received:** `session_status`, `chat_message`, `tool_call`, `tool_result`

**Send message:**

```json
{ "type": "send_message", "session_id": "uuid", "content": "..." }
```

**Keep-alive:** `{ "type": "ping" }` / `{ "type": "pong" }`

### Terminal Console

```
ws://localhost:3030/ws/console/{sessionId}?cols=120&rows=40
```

Binary protocol for terminal I/O. JSON for resize/error messages:

```json
{ "type": "resize", "cols": 120, "rows": 40 }
{ "type": "error", "message": "Session not found" }
```

**xterm.js example:**

```javascript
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";

const term = new Terminal();
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById("terminal"));
fitAddon.fit();

const ws = new WebSocket(`ws://localhost:3030/ws/console/${sessionId}`);
ws.onopen = () =>
  ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
term.onData((data) => ws.send(data));
ws.onmessage = (event) => {
  if (event.data instanceof Blob)
    event.data.text().then((text) => term.write(text));
  else term.write(event.data);
};
```

PTY remains attached on disconnect (session continues running).

## Error Responses

```json
{
  "error": {
    "code": "SESSION_NOT_FOUND",
    "message": "Session with ID 'xyz' not found"
  }
}
```

| Code                | HTTP | Description              |
| ------------------- | ---- | ------------------------ |
| `SESSION_NOT_FOUND` | 404  | Session doesn't exist    |
| `BACKEND_ERROR`     | 500  | Backend operation failed |
| `INVALID_REQUEST`   | 400  | Invalid request body     |
| `UNAUTHORIZED`      | 401  | Authentication required  |
| `FORBIDDEN`         | 403  | Operation not allowed    |
| `CONFLICT`          | 409  | Resource already exists  |

## Authentication

Default: none (localhost only). With WebAuthn:

```http
Authorization: Bearer <token>
Cookie: clauderon_session=<token>
```

CORS allows same origin and `localhost:*` / `127.0.0.1:*`.
