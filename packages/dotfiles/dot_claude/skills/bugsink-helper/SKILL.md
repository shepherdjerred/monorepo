---
name: bugsink-helper
description: |
  Bugsink self-hosted error tracking via REST API - teams, projects, issues, events, releases, stacktraces
  When user mentions Bugsink, self-hosted error tracking, or needs to query Bugsink API for issues, events, stacktraces, or releases
---

# Bugsink Helper Agent

## Overview

Bugsink is a self-hosted error tracking service compatible with Sentry SDKs. It provides a REST API for managing teams, projects, issues, events, and releases. There is no CLI tool; all operations use `curl` against the REST API.

## Authentication

```bash
# Set environment variables
export BUGSINK_URL="https://your-bugsink-instance.example.com"
export BUGSINK_TOKEN="your-api-token"
export API="$BUGSINK_URL/api/canonical/0"

# Auth header used in all requests
AUTH="Authorization: Bearer $BUGSINK_TOKEN"

# Verify authentication by listing teams
curl -s -H "$AUTH" "$API/teams/" | jq .
```

## API Endpoints Reference

| Resource | Method | Path | Required Params |
|----------|--------|------|-----------------|
| Teams | GET | `/api/canonical/0/teams/` | — |
| Teams | POST | `/api/canonical/0/teams/` | name (body) |
| Team | GET | `/api/canonical/0/teams/{uuid}/` | — |
| Team | PATCH | `/api/canonical/0/teams/{uuid}/` | — |
| Projects | GET | `/api/canonical/0/projects/` | — (optional `?team=<uuid>`) |
| Projects | POST | `/api/canonical/0/projects/` | team, name (body) |
| Project | GET | `/api/canonical/0/projects/{id}/` | — |
| Project | PATCH | `/api/canonical/0/projects/{id}/` | — |
| Issues | GET | `/api/canonical/0/issues/` | `?project=<id>` |
| Issue | GET | `/api/canonical/0/issues/{uuid}/` | — |
| Events | GET | `/api/canonical/0/events/` | `?issue=<uuid>` |
| Event | GET | `/api/canonical/0/events/{uuid}/` | — |
| Stacktrace | GET | `/api/canonical/0/events/{uuid}/stacktrace/` | — |
| Releases | GET | `/api/canonical/0/releases/` | `?project=<id>` |
| Releases | POST | `/api/canonical/0/releases/` | project, version (body) |
| Release | GET | `/api/canonical/0/releases/{uuid}/` | — |

**Notes:**
- Team IDs and issue IDs are UUIDs. Project IDs are integers.
- DELETE is not supported (returns 405) on teams and projects.
- All list endpoints use cursor-based pagination.

---

## Team Operations

### List Teams

```bash
curl -s -H "$AUTH" "$API/teams/" | jq '.results'

# Summary output
curl -s -H "$AUTH" "$API/teams/" | \
  jq -r '.results[] | "\(.id)\t\(.name)\t\(.visibility)"'
```

### Create Team

```bash
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$API/teams/" \
  -d '{
    "name": "Backend Team",
    "visibility": "joinable"
  }' | jq .
```

**Required fields:** `name` (string, max 255 chars)
**Optional fields:** `visibility` (enum: `joinable`, `discoverable`, `hidden`)

### Get Team Detail

```bash
curl -s -H "$AUTH" "$API/teams/$TEAM_UUID/" | jq .
```

### Update Team

```bash
curl -s -X PATCH -H "$AUTH" -H "Content-Type: application/json" \
  "$API/teams/$TEAM_UUID/" \
  -d '{
    "name": "Renamed Team",
    "visibility": "hidden"
  }' | jq .
```

---

## Project Operations

### List Projects

```bash
curl -s -H "$AUTH" "$API/projects/" | jq '.results'

# Filter by team
curl -s -H "$AUTH" "$API/projects/?team=$TEAM_UUID" | jq '.results'

# Summary output
curl -s -H "$AUTH" "$API/projects/" | \
  jq -r '.results[] | "\(.id)\t\(.name)\t\(.slug)\t\(.visibility)"'
```

### Create Project

```bash
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$API/projects/" \
  -d '{
    "team": "'$TEAM_UUID'",
    "name": "My App",
    "visibility": "team_members"
  }' | jq .
```

**Required fields:** `team` (UUID), `name` (string, max 255 chars)
**Optional fields:** `visibility` (enum: `joinable`, `discoverable`, `team_members`), `alert_on_new_issue` (bool), `alert_on_regression` (bool), `alert_on_unmute` (bool), `retention_max_event_count` (int, >= 0)

### Get Project Detail (includes DSN)

```bash
curl -s -H "$AUTH" "$API/projects/$PROJECT_ID/" | jq .

# Get just the DSN
curl -s -H "$AUTH" "$API/projects/$PROJECT_ID/" | jq -r '.dsn'
```

The project detail response includes `dsn`, `slug`, `digested_event_count`, and `stored_event_count` fields not present in the create/update schema.

### Update Project

```bash
curl -s -X PATCH -H "$AUTH" -H "Content-Type: application/json" \
  "$API/projects/$PROJECT_ID/" \
  -d '{
    "name": "Renamed App",
    "alert_on_new_issue": true,
    "alert_on_regression": true
  }' | jq .
```

---

## Issue Operations

### List Issues (requires project filter)

```bash
# List issues for a project (required)
curl -s -H "$AUTH" "$API/issues/?project=$PROJECT_ID" | jq '.results'

# With sort and order
curl -s -H "$AUTH" "$API/issues/?project=$PROJECT_ID&sort=last_seen&order=desc" | jq '.results'

# Summary output
curl -s -H "$AUTH" "$API/issues/?project=$PROJECT_ID" | \
  jq -r '.results[:10][] | "\(.id)\t\(.calculated_type): \(.calculated_value)\t\(.digested_event_count) events\t\(.last_seen)"'
```

**Required query param:** `project` (integer project ID)
**Optional query params:**
- `sort`: `digest_order` (default) or `last_seen`
- `order`: `asc` (default) or `desc`
- `cursor`: pagination cursor

### Get Issue Detail

```bash
curl -s -H "$AUTH" "$API/issues/$ISSUE_UUID/" | jq .

# Formatted output
curl -s -H "$AUTH" "$API/issues/$ISSUE_UUID/" | \
  jq '{
    id,
    calculated_type,
    calculated_value,
    transaction,
    digested_event_count,
    stored_event_count,
    first_seen,
    last_seen,
    is_resolved,
    is_muted
  }'
```

---

## Event Operations

### List Events (requires issue filter)

```bash
# List events for an issue (required)
curl -s -H "$AUTH" "$API/events/?issue=$ISSUE_UUID" | jq '.results'

# Ascending order (oldest first)
curl -s -H "$AUTH" "$API/events/?issue=$ISSUE_UUID&order=asc" | jq '.results'

# Summary output
curl -s -H "$AUTH" "$API/events/?issue=$ISSUE_UUID" | \
  jq -r '.results[] | "\(.id)\t\(.event_id)\t\(.timestamp)"'
```

**Required query param:** `issue` (UUID)
**Optional query params:** `order` (`asc` or `desc`, default `desc`), `cursor`

**Note:** The list view omits the `data` field for performance. Use the detail endpoint for the full event payload.

### Get Event Detail

```bash
curl -s -H "$AUTH" "$API/events/$EVENT_UUID/" | jq .

# The detail view includes the full `data` payload and `stacktrace_md`
curl -s -H "$AUTH" "$API/events/$EVENT_UUID/" | jq '.data'
```

### Get Event Stacktrace (Markdown)

```bash
# Returns rendered stacktrace as Markdown text (text/markdown content type)
curl -s -H "$AUTH" "$API/events/$EVENT_UUID/stacktrace/"
```

This is the most useful endpoint for debugging. It returns a human-readable markdown rendering of the event's stacktrace including frames, source context, and local variables.

---

## Release Operations

### List Releases (requires project filter)

```bash
# List releases for a project (required)
curl -s -H "$AUTH" "$API/releases/?project=$PROJECT_ID" | jq '.results'

# Summary output
curl -s -H "$AUTH" "$API/releases/?project=$PROJECT_ID" | \
  jq -r '.results[] | "\(.id)\t\(.version)\t\(.date_released)"'
```

**Required query param:** `project` (integer project ID)

### Create Release

```bash
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$API/releases/" \
  -d '{
    "project": '$PROJECT_ID',
    "version": "1.2.3",
    "timestamp": "2025-01-15T12:00:00Z"
  }' | jq .
```

**Required fields:** `project` (integer), `version` (string)
**Optional fields:** `timestamp` (datetime)

### Get Release Detail

```bash
curl -s -H "$AUTH" "$API/releases/$RELEASE_UUID/" | jq .

# Detail includes additional fields: semver, is_semver, sort_epoch
curl -s -H "$AUTH" "$API/releases/$RELEASE_UUID/" | \
  jq '{id, version, date_released, semver, is_semver, sort_epoch}'
```

---

## Pagination

All list endpoints use cursor-based pagination. The response shape is:

```json
{
  "next": "http://bugsink.example.com/api/canonical/0/issues/?cursor=cD00ODY%3D&project=1",
  "previous": null,
  "results": [...]
}
```

To paginate through results:

```bash
# First page
RESPONSE=$(curl -s -H "$AUTH" "$API/issues/?project=$PROJECT_ID")
echo "$RESPONSE" | jq '.results'

# Get next page URL
NEXT=$(echo "$RESPONSE" | jq -r '.next // empty')

# Fetch next page (if exists)
if [ -n "$NEXT" ]; then
  curl -s -H "$AUTH" "$NEXT" | jq '.results'
fi
```

Loop through all pages:

```bash
URL="$API/issues/?project=$PROJECT_ID"
while [ -n "$URL" ] && [ "$URL" != "null" ]; do
  RESPONSE=$(curl -s -H "$AUTH" "$URL")
  echo "$RESPONSE" | jq '.results[]'
  URL=$(echo "$RESPONSE" | jq -r '.next // empty')
done
```

---

## SDK Integration

Bugsink is compatible with Sentry SDKs. Use the DSN from the project detail endpoint.

### Python

```python
import sentry_sdk

sentry_sdk.init(
    dsn="http://key@your-bugsink-instance.example.com/1",
    send_default_pii=True,
    traces_sample_rate=0,  # Bugsink does not support tracing
)
```

### JavaScript/TypeScript

```javascript
import * as Sentry from "@sentry/browser";

Sentry.init({
  dsn: "http://key@your-bugsink-instance.example.com/1",
  sendDefaultPii: true,
  tracesSampleRate: 0, // Bugsink does not support tracing
});
```

### Node.js

```javascript
const Sentry = require("@sentry/node");

Sentry.init({
  dsn: "http://key@your-bugsink-instance.example.com/1",
  sendDefaultPii: true,
  tracesSampleRate: 0, // Bugsink does not support tracing
});
```

**Important:** Set `traces_sample_rate=0` (or `tracesSampleRate: 0`) because Bugsink does not support performance tracing. Set `send_default_pii=True` to include user context in error reports.

---

## Common Workflows

### Error Investigation

```bash
#!/bin/bash
# Investigate errors in a Bugsink project

# 1. List recent issues sorted by last_seen
echo "=== Recent Issues ==="
curl -s -H "$AUTH" "$API/issues/?project=$PROJECT_ID&sort=last_seen&order=desc" | \
  jq -r '.results[:10][] | "\(.id)\t\(.calculated_type): \(.calculated_value)\t\(.digested_event_count) events"'

# 2. Get details for a specific issue
echo -e "\n=== Issue Details ==="
ISSUE_UUID="${1:-}"
if [ -n "$ISSUE_UUID" ]; then
  curl -s -H "$AUTH" "$API/issues/$ISSUE_UUID/" | \
    jq '{calculated_type, calculated_value, transaction, digested_event_count, first_seen, last_seen, is_resolved}'

  # 3. Get the most recent event
  echo -e "\n=== Latest Event ==="
  EVENT_UUID=$(curl -s -H "$AUTH" "$API/events/?issue=$ISSUE_UUID&order=desc" | jq -r '.results[0].id')

  if [ -n "$EVENT_UUID" ] && [ "$EVENT_UUID" != "null" ]; then
    # 4. Get the stacktrace
    echo -e "\n=== Stacktrace ==="
    curl -s -H "$AUTH" "$API/events/$EVENT_UUID/stacktrace/"
  fi
fi
```

### Issue Triage

```bash
#!/bin/bash
# Triage unresolved issues by event count

curl -s -H "$AUTH" "$API/issues/?project=$PROJECT_ID&sort=last_seen&order=desc" | \
  jq -r '.results[] | select(.is_resolved == false and .is_muted == false) | "\(.digested_event_count)\t\(.calculated_type): \(.calculated_value)\t\(.last_seen)"' | \
  sort -t$'\t' -k1 -nr | \
  column -t -s$'\t'
```

### Get DSN for SDK Setup

```bash
# Get the DSN for a project to configure Sentry SDKs
curl -s -H "$AUTH" "$API/projects/$PROJECT_ID/" | jq -r '.dsn'
```

---

## API Schema Reference

### Enums

**ProjectVisibilityEnum:** `joinable` | `discoverable` | `team_members`

**TeamVisibilityEnum:** `joinable` | `discoverable` | `hidden`

### TeamList / TeamDetail

```
{
  id:         UUID (read-only)
  name:       string (max 255, required)
  visibility: TeamVisibilityEnum (required in detail)
}
```

### TeamCreateUpdate

```
{
  id:         UUID (read-only)
  name:       string (max 255, required)
  visibility: TeamVisibilityEnum (optional)
}
```

### ProjectList

```
{
  id:                       integer (read-only)
  team:                     UUID | null
  name:                     string (max 255, required)
  slug:                     string (max 50, pattern: ^[-a-zA-Z0-9_]+$, required)
  dsn:                      string (read-only, required)
  digested_event_count:     integer (read-only, required)
  stored_event_count:       integer (read-only, required)
  alert_on_new_issue:       boolean
  alert_on_regression:      boolean
  alert_on_unmute:          boolean
  visibility:               ProjectVisibilityEnum (required)
  retention_max_event_count: integer (>= 0)
}
```

### ProjectDetail

Same fields as ProjectList.

### ProjectCreateUpdate

```
{
  id:                       UUID (read-only, required in response)
  team:                     UUID (required)
  name:                     string (max 255, required)
  visibility:               ProjectVisibilityEnum (optional)
  alert_on_new_issue:       boolean (optional)
  alert_on_regression:      boolean (optional)
  alert_on_unmute:          boolean (optional)
  retention_max_event_count: integer (>= 0, optional)
}
```

**Note:** The create/update schema uses UUID for `id`, while ProjectList/Detail uses integer for `id`. The `team` field in create/update is UUID (required), while in list/detail it is UUID | null.

### Issue

```
{
  id:                       UUID (read-only)
  project:                  integer
  digest_order:             integer (0..2147483647)
  last_seen:                datetime
  first_seen:               datetime
  digested_event_count:     integer
  stored_event_count:       integer (read-only)
  calculated_type:          string (max 128)
  calculated_value:         string (max 1024)
  transaction:              string (max 200)
  is_resolved:              boolean
  is_resolved_by_next_release: boolean
  is_muted:                 boolean
}
```

**Required:** id, project, digest_order, last_seen, first_seen, digested_event_count, stored_event_count

### EventList

Lightweight list view (excludes the `data` field):

```
{
  id:            UUID (read-only, Bugsink-internal)
  ingested_at:   datetime
  digested_at:   datetime
  issue:         UUID
  grouping:      integer
  event_id:      UUID (read-only, as per the sent data)
  project:       integer
  timestamp:     datetime
  digest_order:  integer (0..2147483647)
}
```

All fields are required.

### EventDetail

Full detail view (includes `data` payload):

```
{
  id:            UUID (read-only, Bugsink-internal)
  ingested_at:   datetime
  digested_at:   datetime
  issue:         UUID
  grouping:      integer
  event_id:      UUID (read-only, as per the sent data)
  project:       integer
  timestamp:     datetime
  digest_order:  integer (0..2147483647)
  data:          object (read-only, full event payload)
  stacktrace_md: string (read-only)
}
```

All fields are required.

### ReleaseList

```
{
  id:            UUID (read-only)
  project:       integer (required)
  version:       string (max 250, required)
  date_released: datetime
}
```

### ReleaseDetail

```
{
  id:            UUID (read-only)
  project:       integer (required)
  version:       string (max 250, required)
  date_released: datetime
  semver:        string (read-only)
  is_semver:     boolean (read-only)
  sort_epoch:    integer (read-only)
}
```

### ReleaseCreate

```
{
  project:   integer (required)
  version:   string (required)
  timestamp: datetime (optional)
}
```

### Pagination Envelope

All list endpoints return:

```
{
  next:     string | null (URI, cursor-based)
  previous: string | null (URI, cursor-based)
  results:  array of resource objects
}
```

### Authentication

All endpoints require Bearer token authentication:

```
Authorization: Bearer <token>
```

---

## When to Ask for Help

Ask the user for clarification when:
- The Bugsink server URL is not known
- The API token is not available or authentication fails
- The project ID (integer) or team UUID is needed but not specified
- It's unclear which issue or event to investigate
- The user needs help setting up SDK integration and the DSN is unknown
