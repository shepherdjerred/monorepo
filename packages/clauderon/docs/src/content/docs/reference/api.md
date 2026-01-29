---
title: API Reference
description: REST and WebSocket API for clauderon
---

clauderon provides HTTP REST and WebSocket APIs for programmatic session management.

## Base URL

```
http://localhost:3030
```

## REST API

### Health Check

Check if the daemon is running.

```http
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "version": "0.1.0"
}
```

### List Sessions

Get all sessions.

```http
GET /api/sessions
```

**Query Parameters:**
- `include_archived` - Include archived sessions (default: false)

**Response:**
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
      "worktree_path": "/home/user/.clauderon/worktrees/session-name",
      "created_at": "2024-01-15T10:30:00Z",
      "archived": false
    }
  ]
}
```

### Get Session

Get a specific session.

```http
GET /api/sessions/:id
```

**Response:**
```json
{
  "id": "uuid",
  "name": "session-name",
  "backend": "docker",
  "agent": "claude",
  "access_mode": "read-write",
  "status": "running",
  "repo_path": "/home/user/project",
  "worktree_path": "/home/user/.clauderon/worktrees/session-name",
  "prompt": "Fix the login bug",
  "created_at": "2024-01-15T10:30:00Z",
  "archived": false,
  "chat_history": [
    {
      "role": "user",
      "content": "Fix the login bug"
    },
    {
      "role": "assistant",
      "content": "I'll analyze the login code..."
    }
  ]
}
```

### Create Session

Create a new session.

```http
POST /api/sessions
```

**Request Body (Single Repository):**
```json
{
  "repo_path": "/home/user/project",
  "prompt": "Fix the login bug",
  "backend": "docker",
  "agent": "claude",
  "access_mode": "read-write",
  "no_plan_mode": false,
  "model": "claude-sonnet-4-5"
}
```

**Request Body (Multi-Repository):**
```json
{
  "name": "multi-repo-session",
  "repositories": [
    {
      "path": "/home/user/project1",
      "mount_name": "main"
    },
    {
      "path": "/home/user/project2",
      "mount_name": "lib"
    }
  ],
  "prompt": "Refactor shared code",
  "backend": "docker",
  "agent": "claude",
  "access_mode": "read-write"
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `repo_path` | string | Yes* | Path to single repository |
| `repositories` | array | Yes* | Array of repositories (multi-repo) |
| `prompt` | string | Yes | Initial prompt for agent |
| `backend` | string | No | Backend type (default: configured default) |
| `agent` | string | No | Agent type (default: "claude") |
| `access_mode` | string | No | Access mode (default: "read-write") |
| `no_plan_mode` | boolean | No | Disable plan mode (default: false) |
| `model` | string | No | AI model override (default: "claude-sonnet-4-5") |
| `name` | string | No | Custom session name |
| `base_branch` | string | No | Git base branch |
| `image_paths` | array | No | Paths to images to attach |

\* Either `repo_path` or `repositories` required (not both)

**Repository object:**
- `path` - Absolute path to repository
- `mount_name` - Unique mount name (alphanumeric, hyphens, underscores)

**Model options:**

See [Model Selection Guide](/guides/model-selection/) for full list. Examples:
- `claude-opus-4-5` - Most capable Claude
- `claude-sonnet-4-5` - Default balanced Claude
- `claude-haiku-4-5` - Fastest Claude
- `gpt-5.2-codex` - GPT optimized for code
- `gemini-3-pro` - Gemini with 1M context

**Access mode options:**
- `read-only` - Agent can read files only
- `read-write` - Agent can read and write files
- `full-access` - Agent has full system access

**Response:**
```json
{
  "id": "uuid",
  "name": "generated-session-name",
  "status": "starting",
  "repositories": [
    {
      "path": "/home/user/project1",
      "mount_name": "main",
      "mount_point": "/workspace/main"
    }
  ],
  "model": "claude-sonnet-4-5"
}
```

**Multi-Repository Limitations:**
- Maximum 5 repositories per session
- Kubernetes backend not fully supported (TODO)
- Mount names must be unique
- Only available via Web UI and API (not CLI/TUI)

See [Multi-Repository Guide](/guides/multi-repo/) for details.

### Delete Session

Delete a session permanently.

```http
DELETE /api/sessions/:id
```

**Query Parameters:**
- `force` - Force delete without confirmation (default: false)

**Response:**
```json
{
  "success": true
}
```

### Archive Session

Archive a session.

```http
POST /api/sessions/:id/archive
```

**Response:**
```json
{
  "success": true
}
```

### Unarchive Session

Restore an archived session.

```http
POST /api/sessions/:id/unarchive
```

**Response:**
```json
{
  "success": true
}
```

### Set Access Mode

Change a session's access mode.

```http
PUT /api/sessions/:id/access-mode
```

**Request Body:**
```json
{
  "access_mode": "read-only"
}
```

**Response:**
```json
{
  "success": true,
  "access_mode": "read-only"
}
```

### Refresh Session

Refresh a Docker session (pull latest image, recreate container).

```http
POST /api/sessions/:id/refresh
```

**Response:**
```json
{
  "success": true
}
```

### Start Session

Start a stopped session.

```http
POST /api/sessions/:id/start
```

**Response:**
```json
{
  "success": true,
  "status": "starting"
}
```

**Use cases:**
- Resume stopped Docker container
- Restart session after manual stop
- Wake from non-hibernated stop state

### Wake Session

Wake a hibernated session (Sprites backend).

```http
POST /api/sessions/:id/wake
```

**Response:**
```json
{
  "success": true,
  "status": "waking",
  "estimated_time": "5-10s"
}
```

**Backend support:**
- ✅ Sprites (hibernation/wake)
- ❌ Other backends (use start instead)

### Recreate Session

Recreate session container while preserving data.

```http
POST /api/sessions/:id/recreate
```

**Request Body (optional):**
```json
{
  "fresh": false,
  "reason": "Container failed to start"
}
```

**Response:**
```json
{
  "success": true,
  "status": "recreating",
  "data_preservation": {
    "git_state": true,
    "chat_history": true,
    "uncommitted_changes": true
  }
}
```

**Preserves:**
- Session metadata and chat history
- Git repository (committed and uncommitted changes)
- Configuration

**Rebuilds:**
- Container
- Environment
- Running processes

### Recreate Session (Fresh)

Recreate session with fresh git clone.

```http
POST /api/sessions/:id/recreate-fresh
```

**Response:**
```json
{
  "success": true,
  "status": "recreating",
  "data_preservation": {
    "git_state": false,
    "chat_history": true,
    "uncommitted_changes": false
  }
}
```

**Preserves:**
- Session metadata and chat history
- Configuration

**Rebuilds:**
- Container
- Git repository (fresh clone, uncommitted changes lost)

### Cleanup Session

Cleanup session resources without deleting session record.

```http
POST /api/sessions/:id/cleanup
```

**Response:**
```json
{
  "success": true,
  "resources_cleaned": [
    "container",
    "volumes",
    "worktree"
  ]
}
```

**Use cases:**
- Remove orphaned resources
- Free disk space while keeping metadata
- Prepare for recreation

### Get Session Health

Check session health status and available recovery actions.

```http
GET /api/sessions/:id/health
```

**Response:**
```json
{
  "session_id": "uuid",
  "health": "Error",
  "details": {
    "container_status": "exited",
    "exit_code": 1,
    "error_message": "OCI runtime error",
    "backend": "docker"
  },
  "available_actions": [
    "recreate",
    "recreate_fresh",
    "cleanup"
  ],
  "data_preservation": {
    "recreate": true,
    "recreate_fresh": false,
    "cleanup": false
  },
  "reconciliation": {
    "attempts": 2,
    "last_attempt": "2025-01-28T12:30:00Z",
    "next_attempt": "2025-01-28T12:35:00Z",
    "error": "Container failed to start"
  },
  "last_check": "2025-01-28T12:34:56Z"
}
```

**Health states:**
- `Healthy` - Session running normally
- `Stopped` - Container stopped
- `Hibernated` - Session suspended (Sprites)
- `Pending` - Resource creation in progress
- `Error` - Container failed
- `CrashLoop` - Container repeatedly crashing (K8s)
- `Missing` - Resource deleted externally

See [Health & Reconciliation Guide](/guides/health-reconciliation/) for details.

### Update Session Metadata

Update session metadata (name, description, tags).

```http
POST /api/sessions/:id/metadata
```

**Request Body:**
```json
{
  "name": "new-session-name",
  "description": "Updated description",
  "tags": ["feature-x", "backend"]
}
```

**Response:**
```json
{
  "success": true,
  "metadata": {
    "name": "new-session-name",
    "description": "Updated description",
    "tags": ["feature-x", "backend"]
  }
}
```

### Regenerate Metadata (AI)

Use AI to regenerate session metadata based on chat history.

```http
POST /api/sessions/:id/regenerate-metadata
```

**Response:**
```json
{
  "success": true,
  "metadata": {
    "name": "auth-bug-fix",
    "description": "Fixed authentication bug in login flow",
    "tags": ["bugfix", "authentication", "security"]
  }
}
```

**Requirements:**
- AI metadata feature enabled (`ai_metadata = true`)
- Session has chat history
- AI API credentials configured

### Upload Files

Upload files to a running session.

```http
POST /api/sessions/:id/upload
```

**Request:** Multipart form data

```http
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary

------WebKitFormBoundary
Content-Disposition: form-data; name="file"; filename="data.json"
Content-Type: application/json

{ "key": "value" }
------WebKitFormBoundary--
```

**Response:**
```json
{
  "success": true,
  "files": [
    {
      "name": "data.json",
      "path": "/workspace/data.json",
      "size": 18
    }
  ]
}
```

**Upload destination:** Files uploaded to session's working directory.

### Browse Directory

Browse directories for session creation (Web UI helper endpoint).

```http
POST /api/browse-directory
```

**Request Body:**
```json
{
  "path": "/home/user/projects",
  "show_hidden": false
}
```

**Response:**
```json
{
  "current_path": "/home/user/projects",
  "parent": "/home/user",
  "entries": [
    {
      "name": "project1",
      "path": "/home/user/projects/project1",
      "is_dir": true,
      "is_git_repo": true,
      "size": null
    },
    {
      "name": "README.md",
      "path": "/home/user/projects/README.md",
      "is_dir": false,
      "is_git_repo": false,
      "size": 1024
    }
  ]
}
```

**Use cases:**
- Directory picker in Web UI
- Repository selection
- Git repository discovery

### Get Storage Classes (Kubernetes)

Get available Kubernetes storage classes.

```http
GET /api/storage-classes
```

**Response:**
```json
{
  "storage_classes": [
    {
      "name": "standard",
      "provisioner": "kubernetes.io/gce-pd",
      "is_default": true
    },
    {
      "name": "fast-ssd",
      "provisioner": "kubernetes.io/gce-pd",
      "is_default": false
    }
  ]
}
```

**Backend:** Kubernetes only. Returns empty for other backends.

### Get Configuration

Get current configuration.

```http
GET /api/config
```

**Response:**
```json
{
  "default_backend": "zellij",
  "default_agent": "claude",
  "features": {
    "webauthn_auth": false,
    "ai_metadata": false
  }
}
```

### Get Credentials Status

Get status of configured credentials.

```http
GET /api/credentials
```

**Response:**
```json
{
  "credentials": {
    "github_token": {
      "configured": true,
      "source": "1password"
    },
    "anthropic_oauth_token": {
      "configured": true,
      "source": "file"
    },
    "openai_api_key": {
      "configured": false,
      "source": null
    }
  }
}
```

## WebSocket API

Clauderon provides two WebSocket endpoints:

1. **Event Stream** - `/ws/events` - Session events and updates
2. **Terminal Console** - `/ws/console/{sessionId}` - Interactive terminal access

### Event Stream (`/ws/events`)

Real-time session events, status changes, and chat updates.

#### Connect

```
ws://localhost:3030/ws/events
```

#### Message Format

All messages are JSON:

```json
{
  "type": "message_type",
  "data": { ... }
}
```

### Subscribe to Session

Subscribe to session updates.

**Send:**
```json
{
  "type": "subscribe",
  "session_id": "uuid"
}
```

**Receive (acknowledgment):**
```json
{
  "type": "subscribed",
  "session_id": "uuid"
}
```

### Session Updates

Receive real-time session updates.

**Status Change:**
```json
{
  "type": "session_status",
  "session_id": "uuid",
  "status": "running"
}
```

**Chat Message:**
```json
{
  "type": "chat_message",
  "session_id": "uuid",
  "message": {
    "role": "assistant",
    "content": "I've found the bug..."
  }
}
```

**Tool Call:**
```json
{
  "type": "tool_call",
  "session_id": "uuid",
  "tool": {
    "name": "read_file",
    "input": {
      "path": "/workspace/src/auth.ts"
    }
  }
}
```

**Tool Result:**
```json
{
  "type": "tool_result",
  "session_id": "uuid",
  "tool": {
    "name": "read_file",
    "output": "file contents..."
  }
}
```

### Unsubscribe

**Send:**
```json
{
  "type": "unsubscribe",
  "session_id": "uuid"
}
```

### Send Message

Send a message to an active session.

**Send:**
```json
{
  "type": "send_message",
  "session_id": "uuid",
  "content": "Now fix the logout bug"
}
```

### Ping/Pong

Keep the connection alive.

**Send:**
```json
{
  "type": "ping"
}
```

**Receive:**
```json
{
  "type": "pong"
}
```

### Terminal Console (`/ws/console/{sessionId}`)

Interactive terminal access to session container.

#### Connect

```
ws://localhost:3030/ws/console/{sessionId}
```

#### Protocol

The terminal console uses a binary protocol for terminal data:

**Client to Server (Input):**
```
Binary data (user input keystrokes)
```

**Server to Client (Output):**
```
Binary data (terminal output, escape sequences)
```

#### Terminal Resize

Send terminal resize events:

**Send:**
```json
{
  "type": "resize",
  "cols": 120,
  "rows": 40
}
```

#### Attach Options

Include options in connection URL:

```
ws://localhost:3030/ws/console/{sessionId}?cols=120&rows=40
```

**Query parameters:**
- `cols` - Initial terminal columns (default: 80)
- `rows` - Initial terminal rows (default: 24)

#### Example (JavaScript with xterm.js)

```javascript
import { Terminal } from 'xterm';
import { WebglAddon } from 'xterm-addon-webgl';
import { FitAddon } from 'xterm-addon-fit';

const term = new Terminal();
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById('terminal'));
fitAddon.fit();

const ws = new WebSocket(`ws://localhost:3030/ws/console/${sessionId}`);

ws.onopen = () => {
  // Send initial terminal size
  ws.send(JSON.stringify({
    type: 'resize',
    cols: term.cols,
    rows: term.rows
  }));
};

// Forward terminal input to WebSocket
term.onData((data) => {
  ws.send(data);
});

// Forward WebSocket output to terminal
ws.onmessage = (event) => {
  if (event.data instanceof Blob) {
    event.data.text().then((text) => {
      term.write(text);
    });
  } else {
    term.write(event.data);
  }
};

// Handle terminal resize
window.addEventListener('resize', () => {
  fitAddon.fit();
  ws.send(JSON.stringify({
    type: 'resize',
    cols: term.cols,
    rows: term.rows
  }));
});
```

#### Protocol Details

**Message types:**

1. **Data (Binary)** - Terminal I/O
   - Client → Server: User input (keystrokes, paste)
   - Server → Client: Terminal output (text, ANSI escape codes)

2. **Resize (JSON)** - Terminal size change
   ```json
   {
     "type": "resize",
     "cols": 120,
     "rows": 40
   }
   ```

3. **Error (JSON)** - Error messages
   ```json
   {
     "type": "error",
     "message": "Session not found"
   }
   ```

**Connection lifecycle:**

1. Client connects to `/ws/console/{sessionId}`
2. Server validates session exists and is running
3. Server attaches to session's PTY (pseudo-terminal)
4. Bidirectional data flow begins
5. On disconnect, PTY remains attached (session continues running)

**Security:**

- Same authentication as REST API (token or cookie)
- Session must belong to authenticated user
- PTY access is exclusive (one console connection per session recommended)

## Error Responses

All errors follow this format:

```json
{
  "error": {
    "code": "SESSION_NOT_FOUND",
    "message": "Session with ID 'xyz' not found"
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `SESSION_NOT_FOUND` | 404 | Session doesn't exist |
| `BACKEND_ERROR` | 500 | Backend operation failed |
| `INVALID_REQUEST` | 400 | Invalid request body |
| `UNAUTHORIZED` | 401 | Authentication required |
| `FORBIDDEN` | 403 | Operation not allowed |
| `CONFLICT` | 409 | Resource already exists |

## Authentication

By default, no authentication is required (localhost only).

With WebAuthn enabled, include the session token:

```http
Authorization: Bearer <token>
```

Or as a cookie:

```http
Cookie: clauderon_session=<token>
```

## Rate Limiting

No rate limiting is applied by default. For production deployments behind a reverse proxy, configure rate limiting there.

## CORS

The API allows requests from:
- Same origin
- `http://localhost:*`
- `http://127.0.0.1:*`

For custom origins, configure via reverse proxy.

## Examples

### Create Session (curl)

```bash
curl -X POST http://localhost:3030/api/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "repo_path": "/home/user/project",
    "prompt": "Fix the login bug",
    "backend": "docker",
    "agent": "claude"
  }'
```

### List Sessions (JavaScript)

```javascript
const response = await fetch('http://localhost:3030/api/sessions');
const data = await response.json();
console.log(data.sessions);
```

### WebSocket Connection (JavaScript)

```javascript
const ws = new WebSocket('ws://localhost:3030/ws');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'subscribe',
    session_id: 'uuid'
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received:', message);
};
```

## See Also

- [Web Interface](/guides/web-ui/) - Browser-based UI
- [CLI Reference](/reference/cli/) - Command-line interface
