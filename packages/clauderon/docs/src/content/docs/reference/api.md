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

**Request Body:**
```json
{
  "repo_path": "/home/user/project",
  "prompt": "Fix the login bug",
  "backend": "docker",
  "agent": "claude",
  "access_mode": "read-write",
  "no_plan_mode": false
}
```

**Response:**
```json
{
  "id": "uuid",
  "name": "generated-session-name",
  "status": "starting"
}
```

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

### Connect

```
ws://localhost:3030/ws
```

### Message Format

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
