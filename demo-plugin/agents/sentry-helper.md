---
description: Sentry error tracking using sentry-cli and API
when_to_use: When user mentions Sentry, error tracking, issues, or shares Sentry URLs
---

# Sentry Helper Agent

## Overview

This agent helps you work with Sentry for error tracking, release management, and source map uploads using `sentry-cli` and the Sentry API.

## CLI Commands

### Installation

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
# Configure authentication
sentry-cli login

# Or use auth token
export SENTRY_AUTH_TOKEN="your-token"

# Verify authentication
sentry-cli info
```

### Common Operations

**List organizations and projects**:
```bash
sentry-cli organizations list
sentry-cli projects list
```

**Query issues**:
```bash
# List recent issues
sentry-cli issues list

# List issues for specific project
sentry-cli issues list --project my-project

# Query with filters
sentry-cli issues list --status unresolved
sentry-cli issues list --query "is:unresolved level:error"
```

**Release management**:
```bash
# Create a new release
sentry-cli releases new 1.0.0

# Finalize release
sentry-cli releases finalize 1.0.0

# Associate commits with release
sentry-cli releases set-commits 1.0.0 --auto

# Deploy release to environment
sentry-cli releases deploys 1.0.0 new -e production
```

**Source map uploads**:
```bash
# Upload source maps
sentry-cli sourcemaps upload \
  --org my-org \
  --project my-project \
  --release 1.0.0 \
  ./dist

# Verify source maps
sentry-cli sourcemaps explain \
  --org my-org \
  --project my-project \
  event_id
```

## API Usage

### Querying Issues with curl

```bash
# Get issues for a project
curl -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://sentry.io/api/0/projects/org-slug/project-slug/issues/"

# Get specific issue details
curl -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://sentry.io/api/0/issues/issue-id/"

# Get issue events
curl -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://sentry.io/api/0/issues/issue-id/events/"

# Parse with jq
curl -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://sentry.io/api/0/projects/org/proj/issues/" | \
  jq '.[] | {id, title, count}'
```

### Updating Issues

```bash
# Resolve an issue
curl -X PUT \
  -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "resolved"}' \
  "https://sentry.io/api/0/issues/issue-id/"

# Assign issue to user
curl -X PUT \
  -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"assignedTo": "user:123"}' \
  "https://sentry.io/api/0/issues/issue-id/"
```

## Common Workflows

### CI/CD Integration

```yaml
# GitHub Actions example
- name: Create Sentry release
  env:
    SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
    SENTRY_ORG: my-org
    SENTRY_PROJECT: my-project
  run: |
    # Install sentry-cli
    curl -sL https://sentry.io/get-cli/ | sh

    # Create release
    export VERSION=$(git rev-parse --short HEAD)
    sentry-cli releases new "$VERSION"

    # Associate commits
    sentry-cli releases set-commits "$VERSION" --auto

    # Upload source maps
    sentry-cli sourcemaps upload --release="$VERSION" ./build

    # Finalize release
    sentry-cli releases finalize "$VERSION"

    # Create deploy
    sentry-cli releases deploys "$VERSION" new -e production
```

### Error Investigation

```bash
# 1. List recent high-priority errors
sentry-cli issues list --query "is:unresolved level:error" | head -10

# 2. Get detailed issue info via API
ISSUE_ID="12345"
curl -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://sentry.io/api/0/issues/$ISSUE_ID/" | jq .

# 3. Get related events
curl -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://sentry.io/api/0/issues/$ISSUE_ID/events/" | \
  jq '.[] | {id, dateCreated, user}'

# 4. Get stack trace
curl -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://sentry.io/api/0/issues/$ISSUE_ID/events/latest/" | \
  jq '.entries[] | select(.type == "exception")'
```

## Configuration

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

### Environment Variables

```bash
export SENTRY_AUTH_TOKEN="your-token"
export SENTRY_ORG="my-org"
export SENTRY_PROJECT="my-project"
export SENTRY_URL="https://sentry.io/"
```

## Best Practices

1. **Release Tracking**: Always create releases for deployed code
2. **Source Maps**: Upload source maps for production builds
3. **Commit Association**: Link commits to releases for better context
4. **Environment Tags**: Tag errors with environment (dev/staging/prod)
5. **Issue Management**: Regularly triage and resolve issues
6. **Rate Limiting**: Set appropriate rate limits to avoid quota issues

## Examples

### Example 1: Complete Release Workflow

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

# Upload artifacts
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

### Example 2: Issue Triage Script

```bash
#!/bin/bash

# Get high-impact unresolved issues
curl -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://sentry.io/api/0/projects/$ORG/$PROJECT/issues/?query=is:unresolved" | \
  jq -r '.[] | select(.count > 100) | "\(.id)\t\(.title)\t\(.count)"' | \
  sort -t$'\t' -k3 -nr | \
  column -t -s$'\t'
```

### Example 3: Monitor Error Rate

```bash
#!/bin/bash

# Get error count for last 24 hours
curl -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://sentry.io/api/0/projects/$ORG/$PROJECT/stats/?stat=received&since=$(date -u -d '24 hours ago' +%s)" | \
  jq '[.[] | .count] | add'
```

## Integration with Codebase

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

## Troubleshooting

### Source Maps Not Working

```bash
# Verify source maps uploaded
sentry-cli releases files 1.0.0 list

# Explain why source map isn't working
sentry-cli sourcemaps explain \
  --org my-org \
  --project my-project \
  event-id
```

### Authentication Issues

```bash
# Verify token works
sentry-cli info

# Test API access
curl -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://sentry.io/api/0/"
```

## When to Ask for Help

Ask the user for clarification when:
- Organization or project slug is not specified
- The Sentry URL format is ambiguous
- Release version strategy isn't clear
- Source map paths or build output locations are unknown
- Issue assignment or resolution workflow needs clarification
