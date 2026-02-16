---
name: sentry-helper
description: |
  Complete Sentry operations via sentry-cli and REST API - issues, releases, source maps, traces, events
  When user mentions Sentry, errors, issues, releases, source maps, error tracking, stack traces
---

# Sentry Helper Agent

## Overview

Complete Sentry operations via `sentry-cli` and REST API. This skill replaces Sentry MCP server functionality, providing CLI/API equivalents for all operations.

## MCP Tool Equivalents Reference

| MCP Tool | CLI/API Equivalent |
|----------|-------------------|
| `whoami` | `sentry-cli info` or `curl "$API/"` |
| `find_organizations` | `sentry-cli organizations list` or `curl "$API/organizations/"` |
| `find_teams` | `curl "$API/organizations/{org}/teams/"` |
| `find_projects` | `sentry-cli projects list` or `curl "$API/organizations/{org}/projects/"` |
| `find_releases` | `sentry-cli releases list` or `curl "$API/organizations/{org}/releases/"` |
| `get_issue_details` | `curl "$API/issues/{id}/"` |
| `get_trace_details` | `curl "$API/organizations/{org}/events-trace/{trace_id}/"` |
| `get_event_attachment` | `curl "$API/projects/{org}/{project}/events/{event_id}/attachments/"` |
| `search_events` | `curl "$API/organizations/{org}/events/"` |
| `search_issues` | `sentry-cli issues list` or `curl "$API/projects/{org}/{project}/issues/"` |
| `search_issue_events` | `curl "$API/issues/{id}/events/"` |
| `find_dsns` | `curl "$API/projects/{org}/{project}/keys/"` |
| `update_issue` | `curl -X PUT "$API/issues/{id}/"` |
| `create_team` | `curl -X POST "$API/organizations/{org}/teams/"` |
| `create_project` | `curl -X POST "$API/teams/{org}/{team}/projects/"` |
| `update_project` | `curl -X PUT "$API/projects/{org}/{project}/"` |
| `create_dsn` | `curl -X POST "$API/projects/{org}/{project}/keys/"` |
| `search_docs` | WebSearch or https://docs.sentry.io |
| `get_doc` | WebFetch from docs.sentry.io |
| `analyze_issue_with_seer` | Manual analysis + get_issue_details |

## Configuration

### CLI Installation

```bash
# macOS
brew install getsentry/tools/sentry-cli

# Linux/Windows
curl -sL https://sentry.io/get-cli/ | sh

# npm
npm install -g @sentry/cli
```

### Authentication

```bash
# Set environment variables
export SENTRY_AUTH_TOKEN="your-auth-token"
export SENTRY_ORG="your-org"
export SENTRY_PROJECT="your-project"
export API="https://sentry.io/api/0"

# Auth header
AUTH="Authorization: Bearer $SENTRY_AUTH_TOKEN"

# CLI login (interactive)
sentry-cli login

# Verify authentication
sentry-cli info
curl -H "$AUTH" "$API/"
```

### .sentryclirc File

```ini
[defaults]
url=https://sentry.io/
org=my-organization
project=my-project

[auth]
token=your-auth-token

[log]
level=info
```

---

## Organization Operations

### Get Current User (whoami)

```bash
# Via CLI
sentry-cli info

# Via API
curl -H "$AUTH" "$API/"

# Get user details
curl -H "$AUTH" "$API/users/me/"
```

### List Organizations

```bash
# Via CLI
sentry-cli organizations list

# Via API
curl -H "$AUTH" "$API/organizations/"

# JSON output
curl -H "$AUTH" "$API/organizations/" | \
  jq '.[] | {slug, name, status}'
```

---

## Team Operations

### List Teams

```bash
curl -H "$AUTH" "$API/organizations/$ORG/teams/"

# JSON output
curl -H "$AUTH" "$API/organizations/$ORG/teams/" | \
  jq '.[] | {slug, name, memberCount}'
```

### Create Team

```bash
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$API/organizations/$ORG/teams/" \
  -d '{
    "name": "My Team",
    "slug": "my-team"
  }'
```

---

## Project Operations

### List Projects

```bash
# Via CLI
sentry-cli projects list

# Via API
curl -H "$AUTH" "$API/organizations/$ORG/projects/"

# JSON output
curl -H "$AUTH" "$API/organizations/$ORG/projects/" | \
  jq '.[] | {slug, name, platform}'
```

### Create Project

```bash
# Create project under a team
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$API/teams/$ORG/$TEAM/projects/" \
  -d '{
    "name": "My Project",
    "slug": "my-project",
    "platform": "javascript"
  }'
```

### Update Project

```bash
curl -X PUT -H "$AUTH" -H "Content-Type: application/json" \
  "$API/projects/$ORG/$PROJECT/" \
  -d '{
    "name": "Updated Project Name",
    "slug": "updated-slug",
    "platform": "python"
  }'
```

---

## Issue Operations

### Search Issues

```bash
# Via CLI
sentry-cli issues list
sentry-cli issues list --query "is:unresolved"

# Via API
curl -H "$AUTH" "$API/projects/$ORG/$PROJECT/issues/"

# With query filters
curl -G -H "$AUTH" \
  --data-urlencode "query=is:unresolved level:error" \
  "$API/projects/$ORG/$PROJECT/issues/"

# Search across organization
curl -G -H "$AUTH" \
  --data-urlencode "query=is:unresolved" \
  "$API/organizations/$ORG/issues/"

# JSON output
curl -H "$AUTH" "$API/projects/$ORG/$PROJECT/issues/" | \
  jq '.[] | {id, shortId, title, count, userCount}'
```

### Get Issue Details

```bash
# By issue ID
curl -H "$AUTH" "$API/issues/$ISSUE_ID/"

# With full details
curl -H "$AUTH" "$API/issues/$ISSUE_ID/" | \
  jq '{
    id,
    shortId,
    title,
    status,
    level,
    count,
    userCount,
    firstSeen,
    lastSeen,
    platform,
    project: .project.slug
  }'

# Get latest event with stacktrace
curl -H "$AUTH" "$API/issues/$ISSUE_ID/events/latest/" | \
  jq '.entries[] | select(.type == "exception")'
```

### Update Issue

```bash
# Resolve issue
curl -X PUT -H "$AUTH" -H "Content-Type: application/json" \
  "$API/issues/$ISSUE_ID/" \
  -d '{"status": "resolved"}'

# Ignore issue
curl -X PUT -H "$AUTH" -H "Content-Type: application/json" \
  "$API/issues/$ISSUE_ID/" \
  -d '{"status": "ignored"}'

# Assign to user
curl -X PUT -H "$AUTH" -H "Content-Type: application/json" \
  "$API/issues/$ISSUE_ID/" \
  -d '{"assignedTo": "user:123456"}'

# Assign to team
curl -X PUT -H "$AUTH" -H "Content-Type: application/json" \
  "$API/issues/$ISSUE_ID/" \
  -d '{"assignedTo": "team:789"}'
```

### Search Issue Events

```bash
# Get events for an issue
curl -H "$AUTH" "$API/issues/$ISSUE_ID/events/"

# With pagination
curl -H "$AUTH" "$API/issues/$ISSUE_ID/events/?cursor=0:0:1"

# Get specific event
curl -H "$AUTH" "$API/issues/$ISSUE_ID/events/$EVENT_ID/"
```

---

## Event Operations

### Search Events

```bash
# Events in organization (Discover)
curl -G -H "$AUTH" \
  --data-urlencode "field=title" \
  --data-urlencode "field=event.type" \
  --data-urlencode "field=project" \
  --data-urlencode "field=timestamp" \
  --data-urlencode "query=level:error" \
  --data-urlencode "statsPeriod=24h" \
  "$API/organizations/$ORG/events/"

# Count events
curl -G -H "$AUTH" \
  --data-urlencode "field=count()" \
  --data-urlencode "query=level:error" \
  --data-urlencode "statsPeriod=24h" \
  "$API/organizations/$ORG/events/"
```

### Get Event Attachments

```bash
# List attachments for an event
curl -H "$AUTH" \
  "$API/projects/$ORG/$PROJECT/events/$EVENT_ID/attachments/"

# Download specific attachment
curl -H "$AUTH" \
  "$API/projects/$ORG/$PROJECT/events/$EVENT_ID/attachments/$ATTACHMENT_ID/?download=1"
```

---

## Trace Operations

### Get Trace Details

```bash
# Get full trace
curl -H "$AUTH" \
  "$API/organizations/$ORG/events-trace/$TRACE_ID/"

# With specific project
curl -H "$AUTH" \
  "$API/organizations/$ORG/events-trace/$TRACE_ID/?project=$PROJECT_ID"
```

---

## Release Operations

### List Releases

```bash
# Via CLI
sentry-cli releases list

# Via API
curl -H "$AUTH" "$API/organizations/$ORG/releases/"

# Filter by project
curl -H "$AUTH" "$API/projects/$ORG/$PROJECT/releases/"

# Search by version
curl -G -H "$AUTH" \
  --data-urlencode "query=2.0" \
  "$API/organizations/$ORG/releases/"

# JSON output
curl -H "$AUTH" "$API/organizations/$ORG/releases/" | \
  jq '.[] | {version, dateCreated, newGroups, projects: [.projects[].slug]}'
```

### Create Release

```bash
# Via CLI
sentry-cli releases new $VERSION

# Via API
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$API/organizations/$ORG/releases/" \
  -d '{
    "version": "1.0.0",
    "projects": ["my-project"]
  }'
```

### Finalize Release

```bash
sentry-cli releases finalize $VERSION
```

### Associate Commits

```bash
# Automatic (from git)
sentry-cli releases set-commits $VERSION --auto

# Manual
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$API/organizations/$ORG/releases/$VERSION/commits/" \
  -d '{
    "commits": [{
      "id": "abc123",
      "repository": "org/repo",
      "message": "Fix bug",
      "author_name": "John Doe",
      "author_email": "john@example.com"
    }]
  }'
```

### Deploy Release

```bash
# Via CLI
sentry-cli releases deploys $VERSION new -e production

# Via API
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$API/organizations/$ORG/releases/$VERSION/deploys/" \
  -d '{
    "environment": "production",
    "name": "Deploy to production"
  }'
```

---

## Source Map Operations

### Upload Source Maps

```bash
# Upload source maps
sentry-cli sourcemaps upload \
  --org $ORG \
  --project $PROJECT \
  --release $VERSION \
  ./dist

# With URL prefix
sentry-cli sourcemaps upload \
  --org $ORG \
  --project $PROJECT \
  --release $VERSION \
  --url-prefix "~/static/js" \
  ./dist

# Validate source maps
sentry-cli sourcemaps explain \
  --org $ORG \
  --project $PROJECT \
  $EVENT_ID
```

### List Release Files

```bash
sentry-cli releases files $VERSION list
```

---

## DSN Operations

### List DSNs (Project Keys)

```bash
curl -H "$AUTH" "$API/projects/$ORG/$PROJECT/keys/"

# JSON output
curl -H "$AUTH" "$API/projects/$ORG/$PROJECT/keys/" | \
  jq '.[] | {id, name, dsn: .dsn.public}'
```

### Create DSN

```bash
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$API/projects/$ORG/$PROJECT/keys/" \
  -d '{
    "name": "Production Key"
  }'
```

---

## Common Workflows

### Complete Release Workflow

```bash
#!/bin/bash
set -e

ORG="my-org"
PROJECT="my-project"
VERSION="$(git describe --tags)"

echo "Creating release $VERSION"

# Create release
sentry-cli releases new -p "$PROJECT" "$VERSION"

# Associate commits
sentry-cli releases set-commits "$VERSION" --auto

# Upload source maps
echo "Uploading source maps..."
sentry-cli sourcemaps upload \
  --org "$ORG" \
  --project "$PROJECT" \
  --release "$VERSION" \
  ./dist

# Finalize
sentry-cli releases finalize "$VERSION"

# Create deployment
sentry-cli releases deploys "$VERSION" new \
  -e production \
  -n "$(git rev-parse HEAD)"

echo "Release $VERSION created successfully"
```

### Error Investigation

```bash
#!/bin/bash

# 1. List recent high-priority errors
echo "=== Recent Errors ==="
curl -sG -H "$AUTH" \
  --data-urlencode "query=is:unresolved level:error" \
  "$API/projects/$ORG/$PROJECT/issues/" | \
  jq -r '.[] | "\(.shortId)\t\(.count)\t\(.title)"' | head -10

# 2. Get detailed issue info
echo -e "\n=== Issue Details ==="
ISSUE_ID="${1:-}"
if [ -n "$ISSUE_ID" ]; then
  curl -sH "$AUTH" "$API/issues/$ISSUE_ID/" | \
    jq '{shortId, title, status, level, count, userCount, lastSeen}'

  # 3. Get stack trace
  echo -e "\n=== Stack Trace ==="
  curl -sH "$AUTH" "$API/issues/$ISSUE_ID/events/latest/" | \
    jq '.entries[] | select(.type == "exception") | .data.values[0].stacktrace.frames[-5:]'
fi
```

### Issue Triage Script

```bash
#!/bin/bash

# Get high-impact unresolved issues
curl -sH "$AUTH" "$API/projects/$ORG/$PROJECT/issues/?query=is:unresolved" | \
  jq -r '.[] | select(.count > 100) | "\(.shortId)\t\(.title)\t\(.count)"' | \
  sort -t$'\t' -k3 -nr | \
  column -t -s$'\t'
```

### Monitor Error Rate

```bash
#!/bin/bash

# Get error count for last 24 hours
curl -sG -H "$AUTH" \
  --data-urlencode "field=count()" \
  --data-urlencode "query=level:error" \
  --data-urlencode "statsPeriod=24h" \
  "$API/organizations/$ORG/events/" | \
  jq '.data[0]."count()"'
```

---

## CI/CD Integration

### GitHub Actions Example

```yaml
- name: Create Sentry release
  env:
    SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
    SENTRY_ORG: my-org
    SENTRY_PROJECT: my-project
  run: |
    curl -sL https://sentry.io/get-cli/ | sh

    export VERSION=$(git rev-parse --short HEAD)
    sentry-cli releases new "$VERSION"
    sentry-cli releases set-commits "$VERSION" --auto
    sentry-cli sourcemaps upload --release="$VERSION" ./build
    sentry-cli releases finalize "$VERSION"
    sentry-cli releases deploys "$VERSION" new -e production
```

---

## SDK Integration

### JavaScript/TypeScript

```javascript
import * as Sentry from "@sentry/browser";

Sentry.init({
  dsn: "your-dsn",
  release: process.env.SENTRY_RELEASE,
  environment: process.env.NODE_ENV,
  integrations: [new Sentry.BrowserTracing()],
  tracesSampleRate: 1.0,
});
```

### Python

```python
import sentry_sdk

sentry_sdk.init(
    dsn="your-dsn",
    release=os.getenv("SENTRY_RELEASE"),
    environment=os.getenv("ENVIRONMENT"),
    traces_sample_rate=1.0,
)
```

---

## Troubleshooting

### Source Maps Not Working

```bash
# Verify source maps uploaded
sentry-cli releases files $VERSION list

# Explain why source map isn't working
sentry-cli sourcemaps explain \
  --org $ORG \
  --project $PROJECT \
  $EVENT_ID
```

### Authentication Issues

```bash
# Verify token works
sentry-cli info

# Test API access
curl -H "$AUTH" "$API/"
```

---

## Query Syntax

Common issue search queries:

```bash
# Unresolved errors
is:unresolved level:error

# High frequency issues
is:unresolved count:>100

# Issues affecting many users
is:unresolved users:>10

# Recent issues
is:unresolved firstSeen:-24h

# Specific browser
browser.name:Chrome

# Specific release
release:1.0.0

# Assigned to me
assigned:me

# Not assigned
!is:assigned

# Has specific tag
myTag:value
```

---

## When to Ask for Help

Ask the user for clarification when:
- Organization or project slug is not specified
- Sentry URL format is ambiguous (self-hosted vs SaaS)
- Release version strategy isn't clear
- Source map paths or build output locations are unknown
- Issue assignment or resolution workflow needs clarification
- DSN vs API token usage is unclear
