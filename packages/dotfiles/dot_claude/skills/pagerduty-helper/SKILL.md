---
name: pagerduty-helper
description: |
  Complete PagerDuty operations via REST API - incidents, schedules, oncall, services, orchestrations
  When user mentions PagerDuty, incidents, oncall, schedules, escalation, pages, alerts
---

# PagerDuty Helper Agent

## Overview

Complete PagerDuty operations via REST API. This skill replaces PagerDuty MCP server functionality, providing API equivalents for all operations.

## MCP Tool Equivalents Reference

| MCP Tool | API Equivalent |
|----------|---------------|
| `list_incidents` | `curl "$API/incidents"` |
| `get_incident` | `curl "$API/incidents/{id}"` |
| `get_outlier_incident` | `curl "$API/incidents/{id}/outlier_incident"` |
| `get_past_incidents` | `curl "$API/incidents/{id}/past_incidents"` |
| `get_related_incidents` | `curl "$API/incidents/{id}/related_incidents"` |
| `list_incident_notes` | `curl "$API/incidents/{id}/notes"` |
| `list_incident_workflows` | `curl "$API/incident_workflows"` |
| `get_incident_workflow` | `curl "$API/incident_workflows/{id}"` |
| `list_services` | `curl "$API/services"` |
| `get_service` | `curl "$API/services/{id}"` |
| `list_teams` | `curl "$API/teams"` |
| `get_team` | `curl "$API/teams/{id}"` |
| `list_team_members` | `curl "$API/teams/{id}/members"` |
| `list_users` | `curl "$API/users"` |
| `get_user_data` | `curl "$API/users/me"` |
| `list_schedules` | `curl "$API/schedules"` |
| `get_schedule` | `curl "$API/schedules/{id}"` |
| `list_schedule_users` | `curl "$API/schedules/{id}/users"` |
| `list_oncalls` | `curl "$API/oncalls"` |
| `list_escalation_policies` | `curl "$API/escalation_policies"` |
| `get_escalation_policy` | `curl "$API/escalation_policies/{id}"` |
| `list_event_orchestrations` | `curl "$API/event_orchestrations"` |
| `get_event_orchestration` | `curl "$API/event_orchestrations/{id}"` |
| `get_event_orchestration_router` | `curl "$API/event_orchestrations/{id}/router"` |
| `get_event_orchestration_service` | `curl "$API/event_orchestrations/services/{service_id}"` |
| `get_event_orchestration_global` | `curl "$API/event_orchestrations/{id}/global"` |
| `list_alert_grouping_settings` | `curl "$API/alert_grouping_settings"` |
| `get_alert_grouping_setting` | `curl "$API/alert_grouping_settings/{id}"` |
| `list_change_events` | `curl "$API/change_events"` |
| `get_change_event` | `curl "$API/change_events/{id}"` |
| `list_service_change_events` | `curl "$API/services/{id}/change_events"` |
| `list_incident_change_events` | `curl "$API/incidents/{id}/related_change_events"` |
| `list_status_pages` | `curl "$API/status_pages"` |
| `list_status_page_severities` | `curl "$API/status_pages/{id}/severities"` |
| `list_status_page_impacts` | `curl "$API/status_pages/{id}/impacts"` |
| `list_status_page_statuses` | `curl "$API/status_pages/{id}/statuses"` |
| `get_status_page_post` | `curl "$API/status_pages/{id}/posts/{post_id}"` |
| `list_status_page_post_updates` | `curl "$API/status_pages/{id}/posts/{post_id}/post_updates"` |

## Configuration

```bash
# Set environment variables
export PAGERDUTY_TOKEN="your-api-token"
export API="https://api.pagerduty.com"

# Standard headers
AUTH="Authorization: Token token=$PAGERDUTY_TOKEN"
ACCEPT="Accept: application/vnd.pagerduty+json;version=2"
CONTENT="Content-Type: application/json"

# Test connection
curl -H "$AUTH" -H "$ACCEPT" "$API/users/me"
```

---

## Incident Operations

### List Incidents

```bash
# All incidents
curl -H "$AUTH" -H "$ACCEPT" "$API/incidents"

# Filter by status
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/incidents?statuses[]=triggered&statuses[]=acknowledged"

# Filter by service
curl -H "$AUTH" -H "$ACCEPT" "$API/incidents?service_ids[]=$SERVICE_ID"

# Filter by team
curl -H "$AUTH" -H "$ACCEPT" "$API/incidents?team_ids[]=$TEAM_ID"

# Filter by date range
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/incidents?since=2024-01-01T00:00:00Z&until=2024-01-31T23:59:59Z"

# Filter by urgency
curl -H "$AUTH" -H "$ACCEPT" "$API/incidents?urgencies[]=high"

# Sort and limit
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/incidents?sort_by=created_at:desc&limit=10"

# JSON output
curl -H "$AUTH" -H "$ACCEPT" "$API/incidents" | \
  jq '.incidents[] | {id, title, status, urgency, created_at}'
```

### Get Incident Details

```bash
curl -H "$AUTH" -H "$ACCEPT" "$API/incidents/$INCIDENT_ID"

# With additional info
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/incidents/$INCIDENT_ID?include[]=acknowledgers&include[]=assignees"
```

### Get Outlier Incident

```bash
# Get outlier analysis for an incident
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/incidents/$INCIDENT_ID/outlier_incident"

# With time range
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/incidents/$INCIDENT_ID/outlier_incident?since=2024-01-01T00:00:00Z"
```

### Get Past Incidents

```bash
# Get similar past incidents
curl -H "$AUTH" -H "$ACCEPT" "$API/incidents/$INCIDENT_ID/past_incidents"

# With limit
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/incidents/$INCIDENT_ID/past_incidents?limit=5"
```

### Get Related Incidents

```bash
curl -H "$AUTH" -H "$ACCEPT" "$API/incidents/$INCIDENT_ID/related_incidents"

# With additional details
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/incidents/$INCIDENT_ID/related_incidents?additional_details[]=incident"
```

### List Incident Notes

```bash
curl -H "$AUTH" -H "$ACCEPT" "$API/incidents/$INCIDENT_ID/notes"

# Add a note
curl -X POST -H "$AUTH" -H "$ACCEPT" -H "$CONTENT" \
  -H "From: user@example.com" \
  "$API/incidents/$INCIDENT_ID/notes" \
  -d '{
    "note": {
      "content": "Investigation update: found the root cause"
    }
  }'
```

### Acknowledge/Resolve Incident

```bash
# Acknowledge
curl -X PUT -H "$AUTH" -H "$ACCEPT" -H "$CONTENT" \
  -H "From: user@example.com" \
  "$API/incidents/$INCIDENT_ID" \
  -d '{
    "incident": {
      "type": "incident_reference",
      "status": "acknowledged"
    }
  }'

# Resolve
curl -X PUT -H "$AUTH" -H "$ACCEPT" -H "$CONTENT" \
  -H "From: user@example.com" \
  "$API/incidents/$INCIDENT_ID" \
  -d '{
    "incident": {
      "type": "incident_reference",
      "status": "resolved"
    }
  }'
```

---

## Service Operations

### List Services

```bash
# All services
curl -H "$AUTH" -H "$ACCEPT" "$API/services"

# Search by name
curl -H "$AUTH" -H "$ACCEPT" "$API/services?query=production"

# Filter by team
curl -H "$AUTH" -H "$ACCEPT" "$API/services?team_ids[]=$TEAM_ID"

# Include integrations
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/services?include[]=integrations&include[]=escalation_policies"

# JSON output
curl -H "$AUTH" -H "$ACCEPT" "$API/services" | \
  jq '.services[] | {id, name, status, description}'
```

### Get Service Details

```bash
curl -H "$AUTH" -H "$ACCEPT" "$API/services/$SERVICE_ID"

# With integrations
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/services/$SERVICE_ID?include[]=integrations"
```

### List Service Change Events

```bash
curl -H "$AUTH" -H "$ACCEPT" "$API/services/$SERVICE_ID/change_events"

# With time range
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/services/$SERVICE_ID/change_events?since=2024-01-01T00:00:00Z"
```

---

## Team Operations

### List Teams

```bash
# All teams
curl -H "$AUTH" -H "$ACCEPT" "$API/teams"

# Search by name
curl -H "$AUTH" -H "$ACCEPT" "$API/teams?query=platform"

# JSON output
curl -H "$AUTH" -H "$ACCEPT" "$API/teams" | \
  jq '.teams[] | {id, name, description}'
```

### Get Team Details

```bash
curl -H "$AUTH" -H "$ACCEPT" "$API/teams/$TEAM_ID"
```

### List Team Members

```bash
curl -H "$AUTH" -H "$ACCEPT" "$API/teams/$TEAM_ID/members"

# JSON output
curl -H "$AUTH" -H "$ACCEPT" "$API/teams/$TEAM_ID/members" | \
  jq '.members[] | {user: .user.summary, role: .role}'
```

---

## User Operations

### List Users

```bash
# All users
curl -H "$AUTH" -H "$ACCEPT" "$API/users"

# Search by name/email
curl -H "$AUTH" -H "$ACCEPT" "$API/users?query=john"

# Filter by team
curl -H "$AUTH" -H "$ACCEPT" "$API/users?team_ids[]=$TEAM_ID"

# JSON output
curl -H "$AUTH" -H "$ACCEPT" "$API/users" | \
  jq '.users[] | {id, name, email, role}'
```

### Get Current User

```bash
curl -H "$AUTH" -H "$ACCEPT" "$API/users/me"

# With contact methods
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/users/me?include[]=contact_methods&include[]=notification_rules"
```

---

## Schedule Operations

### List Schedules

```bash
# All schedules
curl -H "$AUTH" -H "$ACCEPT" "$API/schedules"

# Search by name
curl -H "$AUTH" -H "$ACCEPT" "$API/schedules?query=primary"

# Include schedule layers
curl -H "$AUTH" -H "$ACCEPT" "$API/schedules?include[]=schedule_layers"

# JSON output
curl -H "$AUTH" -H "$ACCEPT" "$API/schedules" | \
  jq '.schedules[] | {id, name, time_zone}'
```

### Get Schedule Details

```bash
curl -H "$AUTH" -H "$ACCEPT" "$API/schedules/$SCHEDULE_ID"

# For specific time range
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/schedules/$SCHEDULE_ID?since=2024-01-01&until=2024-01-07"
```

### List Schedule Users

```bash
curl -H "$AUTH" -H "$ACCEPT" "$API/schedules/$SCHEDULE_ID/users"

# For specific time range
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/schedules/$SCHEDULE_ID/users?since=2024-01-01&until=2024-01-07"
```

---

## On-Call Operations

### List On-Calls

```bash
# Current on-call
curl -H "$AUTH" -H "$ACCEPT" "$API/oncalls"

# Filter by schedule
curl -H "$AUTH" -H "$ACCEPT" "$API/oncalls?schedule_ids[]=$SCHEDULE_ID"

# Filter by escalation policy
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/oncalls?escalation_policy_ids[]=$POLICY_ID"

# Filter by user
curl -H "$AUTH" -H "$ACCEPT" "$API/oncalls?user_ids[]=$USER_ID"

# Only earliest on-call per combination
curl -H "$AUTH" -H "$ACCEPT" "$API/oncalls?earliest=true"

# With time range
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/oncalls?since=2024-01-01T00:00:00Z&until=2024-01-07T00:00:00Z"

# JSON output
curl -H "$AUTH" -H "$ACCEPT" "$API/oncalls" | \
  jq '.oncalls[] | {
    user: .user.summary,
    schedule: .schedule.summary,
    escalation_policy: .escalation_policy.summary,
    level: .escalation_level,
    start: .start,
    end: .end
  }'
```

---

## Escalation Policy Operations

### List Escalation Policies

```bash
# All policies
curl -H "$AUTH" -H "$ACCEPT" "$API/escalation_policies"

# Search by name
curl -H "$AUTH" -H "$ACCEPT" "$API/escalation_policies?query=engineering"

# Filter by team
curl -H "$AUTH" -H "$ACCEPT" "$API/escalation_policies?team_ids[]=$TEAM_ID"

# Include services and teams
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/escalation_policies?include[]=services&include[]=teams"

# JSON output
curl -H "$AUTH" -H "$ACCEPT" "$API/escalation_policies" | \
  jq '.escalation_policies[] | {id, name, num_loops}'
```

### Get Escalation Policy Details

```bash
curl -H "$AUTH" -H "$ACCEPT" "$API/escalation_policies/$POLICY_ID"

# Get escalation rules
curl -H "$AUTH" -H "$ACCEPT" "$API/escalation_policies/$POLICY_ID" | \
  jq '.escalation_policy.escalation_rules[] | {
    level: .escalation_delay_in_minutes,
    targets: [.targets[].summary]
  }'
```

---

## Event Orchestration Operations

### List Event Orchestrations

```bash
# All orchestrations
curl -H "$AUTH" -H "$ACCEPT" "$API/event_orchestrations"

# Sort by name
curl -H "$AUTH" -H "$ACCEPT" "$API/event_orchestrations?sort_by=name:asc"

# JSON output
curl -H "$AUTH" -H "$ACCEPT" "$API/event_orchestrations" | \
  jq '.orchestrations[] | {id, name, routes: .routes}'
```

### Get Event Orchestration

```bash
curl -H "$AUTH" -H "$ACCEPT" "$API/event_orchestrations/$ORCHESTRATION_ID"
```

### Get Event Orchestration Router

```bash
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/event_orchestrations/$ORCHESTRATION_ID/router"
```

### Get Event Orchestration Service

```bash
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/event_orchestrations/services/$SERVICE_ID"
```

### Get Event Orchestration Global

```bash
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/event_orchestrations/$ORCHESTRATION_ID/global"
```

---

## Alert Grouping Settings

### List Alert Grouping Settings

```bash
# All settings
curl -H "$AUTH" -H "$ACCEPT" "$API/alert_grouping_settings"

# Filter by service
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/alert_grouping_settings?service_ids[]=$SERVICE_ID"
```

### Get Alert Grouping Setting

```bash
curl -H "$AUTH" -H "$ACCEPT" "$API/alert_grouping_settings/$SETTING_ID"
```

---

## Change Events Operations

### List Change Events

```bash
# All change events
curl -H "$AUTH" -H "$ACCEPT" "$API/change_events"

# Filter by time range
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/change_events?since=2024-01-01T00:00:00Z&until=2024-01-31T23:59:59Z"

# Filter by team
curl -H "$AUTH" -H "$ACCEPT" "$API/change_events?team_ids[]=$TEAM_ID"

# Filter by integration
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/change_events?integration_ids[]=$INTEGRATION_ID"
```

### Get Change Event

```bash
curl -H "$AUTH" -H "$ACCEPT" "$API/change_events/$CHANGE_EVENT_ID"
```

### List Incident Change Events

```bash
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/incidents/$INCIDENT_ID/related_change_events"
```

---

## Incident Workflow Operations

### List Incident Workflows

```bash
# All workflows
curl -H "$AUTH" -H "$ACCEPT" "$API/incident_workflows"

# Search by name
curl -H "$AUTH" -H "$ACCEPT" "$API/incident_workflows?query=triage"

# Include steps and team
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/incident_workflows?include[]=steps&include[]=team"
```

### Get Incident Workflow

```bash
curl -H "$AUTH" -H "$ACCEPT" "$API/incident_workflows/$WORKFLOW_ID"
```

---

## Status Page Operations

### List Status Pages

```bash
# All status pages
curl -H "$AUTH" -H "$ACCEPT" "$API/status_pages"

# Filter by type
curl -H "$AUTH" -H "$ACCEPT" "$API/status_pages?status_page_type=public"
```

### List Status Page Severities

```bash
curl -H "$AUTH" -H "$ACCEPT" "$API/status_pages/$STATUS_PAGE_ID/severities"

# Filter by post type
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/status_pages/$STATUS_PAGE_ID/severities?post_type=incident"
```

### List Status Page Impacts

```bash
curl -H "$AUTH" -H "$ACCEPT" "$API/status_pages/$STATUS_PAGE_ID/impacts"

# Filter by post type
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/status_pages/$STATUS_PAGE_ID/impacts?post_type=maintenance"
```

### List Status Page Statuses

```bash
curl -H "$AUTH" -H "$ACCEPT" "$API/status_pages/$STATUS_PAGE_ID/statuses"
```

### Get Status Page Post

```bash
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/status_pages/$STATUS_PAGE_ID/posts/$POST_ID"

# Include updates
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/status_pages/$STATUS_PAGE_ID/posts/$POST_ID?include[]=status_page_post_update"
```

### List Status Page Post Updates

```bash
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/status_pages/$STATUS_PAGE_ID/posts/$POST_ID/post_updates"

# Filter by review status
curl -H "$AUTH" -H "$ACCEPT" \
  "$API/status_pages/$STATUS_PAGE_ID/posts/$POST_ID/post_updates?reviewed_status=approved"
```

---

## Creating Incidents

### Trigger via Events API v2

```bash
curl -X POST -H "Content-Type: application/json" \
  "https://events.pagerduty.com/v2/enqueue" \
  -d '{
    "routing_key": "your-integration-key",
    "event_action": "trigger",
    "dedup_key": "unique-incident-key",
    "payload": {
      "summary": "Critical: Database connection pool exhausted",
      "severity": "critical",
      "source": "production-db-01",
      "custom_details": {
        "pool_size": "100",
        "active_connections": "98"
      }
    },
    "links": [{
      "href": "https://monitoring.example.com/dashboard",
      "text": "View Dashboard"
    }]
  }'
```

### Create via REST API

```bash
curl -X POST -H "$AUTH" -H "$ACCEPT" -H "$CONTENT" \
  -H "From: user@example.com" \
  "$API/incidents" \
  -d '{
    "incident": {
      "type": "incident",
      "title": "Critical database issue",
      "service": {
        "id": "SERVICE_ID",
        "type": "service_reference"
      },
      "urgency": "high",
      "body": {
        "type": "incident_body",
        "details": "Database is experiencing high load"
      }
    }
  }'
```

---

## Common Workflows

### Dashboard Script

```bash
#!/bin/bash
echo "=== Open Incidents ==="
curl -sH "$AUTH" -H "$ACCEPT" \
  "$API/incidents?statuses[]=triggered&statuses[]=acknowledged" | \
  jq -r '.incidents[] | "\(.id)\t\(.title)\t\(.status)\t\(.urgency)"' | \
  column -t -s$'\t'

echo ""
echo "=== Currently On-Call ==="
curl -sH "$AUTH" -H "$ACCEPT" "$API/oncalls?earliest=true" | \
  jq -r '.oncalls[] | "\(.user.summary)\t\(.escalation_policy.summary)"' | \
  column -t -s$'\t'
```

### Who's On-Call Script

```bash
#!/bin/bash
# Show who's on-call for each escalation policy

curl -sH "$AUTH" -H "$ACCEPT" "$API/oncalls?earliest=true" | \
  jq -r '.oncalls[] | [
    .escalation_policy.summary,
    .user.summary,
    .schedule.summary // "Direct",
    .escalation_level
  ] | @tsv' | \
  sort | \
  column -t -s$'\t'
```

### Incident Response Script

```bash
#!/bin/bash
INCIDENT_ID=$1
ACTION=$2

case $ACTION in
  ack)     STATUS="acknowledged" ;;
  resolve) STATUS="resolved" ;;
  *)       echo "Usage: $0 <incident-id> <ack|resolve>"; exit 1 ;;
esac

curl -X PUT -H "$AUTH" -H "$ACCEPT" -H "$CONTENT" \
  -H "From: $USER_EMAIL" \
  "$API/incidents/$INCIDENT_ID" \
  -d "{\"incident\":{\"type\":\"incident_reference\",\"status\":\"$STATUS\"}}"
```

---

## CLI Tools

### pd CLI (Third-party)

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

---

## When to Ask for Help

Ask the user for clarification when:
- PagerDuty account or service ID is not specified
- User email is needed for incident updates but not provided
- Incident severity or urgency classification is ambiguous
- Integration key vs API key usage is unclear
- Multiple services, schedules, or teams match the description
