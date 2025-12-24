---
description: PagerDuty incident management using API and CLI tools
when_to_use: When user mentions PagerDuty, incidents, on-call, pages, or escalations
---

# PagerDuty Helper Agent

## Overview

This agent helps you work with PagerDuty for incident management, on-call scheduling, and escalation policies using the PagerDuty API and CLI tools.

## API Setup

### Authentication

```bash
# Set API token as environment variable
export PAGERDUTY_TOKEN="your-api-token"

# Test authentication
curl -H "Authorization: Token token=$PAGERDUTY_TOKEN" \
  -H "Accept: application/vnd.pagerduty+json;version=2" \
  "https://api.pagerduty.com/users/me"
```

## API Usage

### Common Operations

**List incidents**:
```bash
# Get recent incidents
curl -H "Authorization: Token token=$PAGERDUTY_TOKEN" \
  -H "Accept: application/vnd.pagerduty+json;version=2" \
  "https://api.pagerduty.com/incidents" | jq .

# Filter by status
curl -H "Authorization: Token token=$PAGERDUTY_TOKEN" \
  -H "Accept: application/vnd.pagerduty+json;version=2" \
  "https://api.pagerduty.com/incidents?statuses[]=triggered" | \
  jq '.incidents[] | {id, title, status, urgency}'

# Get incidents for specific service
curl -H "Authorization: Token token=$PAGERDUTY_TOKEN" \
  -H "Accept: application/vnd.pagerduty+json;version=2" \
  "https://api.pagerduty.com/incidents?service_ids[]=$SERVICE_ID" | jq .
```

**Get incident details**:
```bash
INCIDENT_ID="ABC123"

curl -H "Authorization: Token token=$PAGERDUTY_TOKEN" \
  -H "Accept: application/vnd.pagerduty+json;version=2" \
  "https://api.pagerduty.com/incidents/$INCIDENT_ID" | jq .
```

**Acknowledge incident**:
```bash
curl -X PUT \
  -H "Authorization: Token token=$PAGERDUTY_TOKEN" \
  -H "Accept: application/vnd.pagerduty+json;version=2" \
  -H "Content-Type: application/json" \
  -H "From: user@example.com" \
  -d '{
    "incident": {
      "type": "incident_reference",
      "status": "acknowledged"
    }
  }' \
  "https://api.pagerduty.com/incidents/$INCIDENT_ID"
```

**Resolve incident**:
```bash
curl -X PUT \
  -H "Authorization: Token token=$PAGERDUTY_TOKEN" \
  -H "Accept: application/vnd.pagerduty+json;version=2" \
  -H "Content-Type: application/json" \
  -H "From: user@example.com" \
  -d '{
    "incident": {
      "type": "incident_reference",
      "status": "resolved"
    }
  }' \
  "https://api.pagerduty.com/incidents/$INCIDENT_ID"
```

**Who's on call**:
```bash
# Get current on-call users
curl -H "Authorization: Token token=$PAGERDUTY_TOKEN" \
  -H "Accept: application/vnd.pagerduty+json;version=2" \
  "https://api.pagerduty.com/oncalls" | \
  jq '.oncalls[] | {
    user: .user.summary,
    escalation_policy: .escalation_policy.summary,
    level: .escalation_level
  }'

# Get on-call for specific schedule
curl -H "Authorization: Token token=$PAGERDUTY_TOKEN" \
  -H "Accept: application/vnd.pagerduty+json;version=2" \
  "https://api.pagerduty.com/oncalls?schedule_ids[]=$SCHEDULE_ID" | jq .
```

### Services and Escalation Policies

**List services**:
```bash
curl -H "Authorization: Token token=$PAGERDUTY_TOKEN" \
  -H "Accept: application/vnd.pagerduty+json;version=2" \
  "https://api.pagerduty.com/services" | \
  jq '.services[] | {id, name, status}'
```

**List escalation policies**:
```bash
curl -H "Authorization: Token token=$PAGERDUTY_TOKEN" \
  -H "Accept: application/vnd.pagerduty+json;version=2" \
  "https://api.pagerduty.com/escalation_policies" | \
  jq '.escalation_policies[] | {id, name}'
```

**Get escalation policy details**:
```bash
curl -H "Authorization: Token token=$PAGERDUTY_TOKEN" \
  -H "Accept: application/vnd.pagerduty+json;version=2" \
  "https://api.pagerduty.com/escalation_policies/$POLICY_ID" | \
  jq '.escalation_policy.escalation_rules'
```

## Creating Incidents

### Trigger Event

```bash
# Trigger incident via Events API v2
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "routing_key": "your-integration-key",
    "event_action": "trigger",
    "payload": {
      "summary": "Critical: Database connection pool exhausted",
      "severity": "critical",
      "source": "production-db-01",
      "custom_details": {
        "pool_size": "100",
        "active_connections": "98"
      }
    }
  }' \
  "https://events.pagerduty.com/v2/enqueue"
```

### Create Incident via API

```bash
curl -X POST \
  -H "Authorization: Token token=$PAGERDUTY_TOKEN" \
  -H "Accept: application/vnd.pagerduty+json;version=2" \
  -H "Content-Type: application/json" \
  -H "From: user@example.com" \
  -d '{
    "incident": {
      "type": "incident",
      "title": "Critical database issue",
      "service": {
        "id": "'"$SERVICE_ID"'",
        "type": "service_reference"
      },
      "urgency": "high",
      "body": {
        "type": "incident_body",
        "details": "Database is experiencing high load"
      }
    }
  }' \
  "https://api.pagerduty.com/incidents"
```

## Common Workflows

### Dashboard Script

```bash
#!/bin/bash

AUTH_HEADER="Authorization: Token token=$PAGERDUTY_TOKEN"
ACCEPT_HEADER="Accept: application/vnd.pagerduty+json;version=2"

echo "=== Open Incidents ==="
curl -s -H "$AUTH_HEADER" -H "$ACCEPT_HEADER" \
  "https://api.pagerduty.com/incidents?statuses[]=triggered&statuses[]=acknowledged" | \
  jq -r '.incidents[] | "\(.id)\t\(.title)\t\(.status)\t\(.urgency)"' | \
  column -t -s$'\t'

echo "\n=== Currently On-Call ==="
curl -s -H "$AUTH_HEADER" -H "$ACCEPT_HEADER" \
  "https://api.pagerduty.com/oncalls" | \
  jq -r '.oncalls[] | "\(.user.summary)\t\(.escalation_policy.summary)"' | \
  column -t -s$'\t'
```

### Incident Response Script

```bash
#!/bin/bash

INCIDENT_ID=$1
ACTION=$2  # acknowledge or resolve

case $ACTION in
  ack|acknowledge)
    STATUS="acknowledged"
    ;;
  resolve|resolved)
    STATUS="resolved"
    ;;
  *)
    echo "Usage: $0 <incident-id> <ack|resolve>"
    exit 1
    ;;
esac

curl -X PUT \
  -H "Authorization: Token token=$PAGERDUTY_TOKEN" \
  -H "Accept: application/vnd.pagerduty+json;version=2" \
  -H "Content-Type: application/json" \
  -H "From: $USER_EMAIL" \
  -d "{
    \"incident\": {
      \"type\": \"incident_reference\",
      \"status\": \"$STATUS\"
    }
  }" \
  "https://api.pagerduty.com/incidents/$INCIDENT_ID"
```

## Best Practices

1. **Use Service Keys**: Create separate integration keys per service
2. **Set Urgency**: Always specify urgency (high/low) for new incidents
3. **Add Context**: Include custom details in incident payloads
4. **Acknowledge Promptly**: Acknowledge incidents to stop escalation
5. **Document Actions**: Add notes to incidents for team visibility
6. **Test Integrations**: Use PagerDuty's test feature for new integrations

## CLI Tools

### pd CLI (Third-party)

If you have `pd` CLI installed:

```bash
# Install
go install github.com/martindstone/pagerduty-cli/pd@latest

# Configure
pd auth:set --token $PAGERDUTY_TOKEN

# List incidents
pd incident:list

# Acknowledge incident
pd incident:ack --ids INCIDENT_ID

# Resolve incident
pd incident:resolve --ids INCIDENT_ID

# Show on-call
pd schedule:oncall --schedule-id SCHEDULE_ID
```

## Integration Examples

### Monitoring Alert to PagerDuty

```bash
#!/bin/bash
# Prometheus AlertManager webhook handler

INTEGRATION_KEY="your-integration-key"

# Send alert to PagerDuty
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "routing_key": "'"$INTEGRATION_KEY"'",
    "event_action": "trigger",
    "dedup_key": "'"$ALERT_NAME-$INSTANCE"'",
    "payload": {
      "summary": "'"$ALERT_SUMMARY"'",
      "severity": "critical",
      "source": "'"$INSTANCE"'",
      "custom_details": {
        "firing": "'"$ALERT_DESCRIPTION"'"
      }
    }
  }' \
  "https://events.pagerduty.com/v2/enqueue"
```

### GitHub Actions Integration

```yaml
name: Alert on Deployment Failure
on:
  workflow_run:
    workflows: ["Deploy"]
    types: [completed]

jobs:
  alert:
    if: ${{ github.event.workflow_run.conclusion == 'failure' }}
    runs-on: ubuntu-latest
    steps:
      - name: Trigger PagerDuty Incident
        run: |
          curl -X POST \
            -H "Content-Type: application/json" \
            -d '{
              "routing_key": "${{ secrets.PAGERDUTY_INTEGRATION_KEY }}",
              "event_action": "trigger",
              "payload": {
                "summary": "Deployment failed for ${{ github.repository }}",
                "severity": "error",
                "source": "github-actions"
              }
            }' \
            https://events.pagerduty.com/v2/enqueue
```

## Troubleshooting

### Authentication Errors

```bash
# Verify token
curl -v -H "Authorization: Token token=$PAGERDUTY_TOKEN" \
  -H "Accept: application/vnd.pagerduty+json;version=2" \
  "https://api.pagerduty.com/users/me" 2>&1 | grep "HTTP/"
```

### Rate Limiting

```bash
# Check rate limit headers
curl -I -H "Authorization: Token token=$PAGERDUTY_TOKEN" \
  -H "Accept: application/vnd.pagerduty+json;version=2" \
  "https://api.pagerduty.com/incidents" | grep -i "x-rate-limit"
```

## When to Ask for Help

Ask the user for clarification when:
- The PagerDuty account or service ID is not specified
- User email is needed for incident updates but not provided
- Incident severity or urgency classification is ambiguous
- Integration key vs API key usage is unclear
- Multiple services or schedules match the description
