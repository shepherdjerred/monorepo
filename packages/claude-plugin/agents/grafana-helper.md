---
description: Complete Grafana operations via REST API - dashboards, Prometheus/Loki queries, alerting, annotations, Sift
when_to_use: When user mentions Grafana, dashboards, Prometheus, Loki, metrics, logs, alerts, PromQL, LogQL
---

# Grafana Helper Agent

## Overview

Complete Grafana operations via REST API. This skill replaces Grafana MCP server functionality, providing API equivalents for all operations.

## MCP Tool Equivalents Reference

| MCP Tool | API Equivalent |
|----------|---------------|
| `search_dashboards` | `curl "$URL/api/search?query=..."` |
| `get_dashboard_by_uid` | `curl "$URL/api/dashboards/uid/{uid}"` |
| `get_dashboard_summary` | Parse dashboard JSON response |
| `get_dashboard_property` | jq on dashboard JSON |
| `get_dashboard_panel_queries` | Extract from dashboard JSON |
| `update_dashboard` | `curl -X POST "$URL/api/dashboards/db"` |
| `list_datasources` | `curl "$URL/api/datasources"` |
| `get_datasource_by_uid` | `curl "$URL/api/datasources/uid/{uid}"` |
| `get_datasource_by_name` | `curl "$URL/api/datasources/name/{name}"` |
| `query_prometheus` | `curl "$URL/api/ds/query"` |
| `list_prometheus_metric_names` | `curl "$URL/api/datasources/proxy/{id}/api/v1/label/__name__/values"` |
| `list_prometheus_label_names` | `curl "$URL/api/datasources/proxy/{id}/api/v1/labels"` |
| `list_prometheus_label_values` | `curl "$URL/api/datasources/proxy/{id}/api/v1/label/{name}/values"` |
| `list_prometheus_metric_metadata` | `curl "$URL/api/datasources/proxy/{id}/api/v1/metadata"` |
| `query_loki_logs` | `curl "$URL/api/ds/query"` |
| `query_loki_stats` | `curl "$URL/api/datasources/proxy/{id}/loki/api/v1/index/stats"` |
| `list_loki_label_names` | `curl "$URL/api/datasources/proxy/{id}/loki/api/v1/labels"` |
| `list_loki_label_values` | `curl "$URL/api/datasources/proxy/{id}/loki/api/v1/label/{name}/values"` |
| `list_alert_rules` | `curl "$URL/api/v1/provisioning/alert-rules"` |
| `get_alert_rule_by_uid` | `curl "$URL/api/v1/provisioning/alert-rules/{uid}"` |
| `create_alert_rule` | `curl -X POST "$URL/api/v1/provisioning/alert-rules"` |
| `update_alert_rule` | `curl -X PUT "$URL/api/v1/provisioning/alert-rules/{uid}"` |
| `delete_alert_rule` | `curl -X DELETE "$URL/api/v1/provisioning/alert-rules/{uid}"` |
| `list_contact_points` | `curl "$URL/api/v1/provisioning/contact-points"` |
| `get_annotations` | `curl "$URL/api/annotations"` |
| `create_annotation` | `curl -X POST "$URL/api/annotations"` |
| `update_annotation` | `curl -X PUT "$URL/api/annotations/{id}"` |
| `patch_annotation` | `curl -X PATCH "$URL/api/annotations/{id}"` |
| `create_graphite_annotation` | `curl -X POST "$URL/api/annotations/graphite"` |
| `get_annotation_tags` | `curl "$URL/api/annotations/tags"` |
| `create_folder` | `curl -X POST "$URL/api/folders"` |
| `search_folders` | `curl "$URL/api/search?type=dash-folder"` |
| `list_sift_investigations` | `curl "$URL/api/plugins/grafana-sift-app/resources/investigations"` |
| `get_sift_investigation` | `curl "$URL/api/plugins/grafana-sift-app/resources/investigations/{id}"` |
| `get_sift_analysis` | `curl "$URL/api/plugins/grafana-sift-app/resources/investigations/{id}/analyses/{id}"` |
| `find_error_pattern_logs` | Via Sift plugin API |
| `find_slow_requests` | Via Sift plugin API |
| `get_assertions` | Via Asserts plugin API |

## Configuration

```bash
# Set environment variables
export GRAFANA_URL="https://your-grafana.com"
export GRAFANA_API_KEY="your-api-key"

# Or use service account token
export GRAFANA_TOKEN="glsa_..."

# Auth header helper
AUTH="Authorization: Bearer $GRAFANA_API_KEY"

# Test connection
curl -H "$AUTH" "$GRAFANA_URL/api/health"
```

---

## Dashboard Operations

### Search Dashboards

```bash
# Search all dashboards
curl -H "$AUTH" "$GRAFANA_URL/api/search?type=dash-db"

# Search by query
curl -H "$AUTH" "$GRAFANA_URL/api/search?query=kubernetes"

# Search by tag
curl -H "$AUTH" "$GRAFANA_URL/api/search?tag=monitoring"

# Search in folder
curl -H "$AUTH" "$GRAFANA_URL/api/search?folderIds=1,2"

# Search starred dashboards
curl -H "$AUTH" "$GRAFANA_URL/api/search?starred=true"

# JSON output with jq
curl -H "$AUTH" "$GRAFANA_URL/api/search?query=api" | \
  jq '.[] | {uid, title, folderTitle}'
```

### Get Dashboard by UID

```bash
# Get full dashboard
curl -H "$AUTH" "$GRAFANA_URL/api/dashboards/uid/{uid}"

# Extract just the dashboard JSON
curl -H "$AUTH" "$GRAFANA_URL/api/dashboards/uid/{uid}" | jq '.dashboard'

# Get dashboard metadata
curl -H "$AUTH" "$GRAFANA_URL/api/dashboards/uid/{uid}" | jq '.meta'
```

### Get Dashboard Summary

```bash
# Get summary info (title, panel count, etc.)
curl -H "$AUTH" "$GRAFANA_URL/api/dashboards/uid/{uid}" | \
  jq '{
    title: .dashboard.title,
    uid: .dashboard.uid,
    panelCount: (.dashboard.panels | length),
    tags: .dashboard.tags,
    folder: .meta.folderTitle,
    url: .meta.url
  }'
```

### Get Dashboard Property (JSONPath)

```bash
# Get title
curl -H "$AUTH" "$GRAFANA_URL/api/dashboards/uid/{uid}" | jq '.dashboard.title'

# Get all panel titles
curl -H "$AUTH" "$GRAFANA_URL/api/dashboards/uid/{uid}" | jq '.dashboard.panels[].title'

# Get first panel
curl -H "$AUTH" "$GRAFANA_URL/api/dashboards/uid/{uid}" | jq '.dashboard.panels[0]'

# Get templating variables
curl -H "$AUTH" "$GRAFANA_URL/api/dashboards/uid/{uid}" | jq '.dashboard.templating.list'

# Get all queries from panels
curl -H "$AUTH" "$GRAFANA_URL/api/dashboards/uid/{uid}" | \
  jq '.dashboard.panels[].targets[]?.expr // empty'
```

### Get Dashboard Panel Queries

```bash
# Extract panel queries with datasource info
curl -H "$AUTH" "$GRAFANA_URL/api/dashboards/uid/{uid}" | \
  jq '.dashboard.panels[] | {
    title: .title,
    type: .type,
    datasource: .datasource,
    queries: [.targets[]? | {expr: .expr, refId: .refId}]
  }'
```

### Update/Create Dashboard

```bash
# Create/update dashboard
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$GRAFANA_URL/api/dashboards/db" \
  -d '{
    "dashboard": {
      "title": "My Dashboard",
      "tags": ["monitoring"],
      "panels": [],
      "schemaVersion": 36,
      "version": 0
    },
    "folderUid": "folder-uid",
    "message": "Initial version",
    "overwrite": false
  }'

# Update existing (with overwrite)
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$GRAFANA_URL/api/dashboards/db" \
  -d '{
    "dashboard": {...},
    "overwrite": true
  }'
```

### Delete Dashboard

```bash
curl -X DELETE -H "$AUTH" "$GRAFANA_URL/api/dashboards/uid/{uid}"
```

---

## Folder Operations

### Search Folders

```bash
# List all folders
curl -H "$AUTH" "$GRAFANA_URL/api/search?type=dash-folder"

# Get folder by UID
curl -H "$AUTH" "$GRAFANA_URL/api/folders/{uid}"

# List folders
curl -H "$AUTH" "$GRAFANA_URL/api/folders"
```

### Create Folder

```bash
# Create folder
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$GRAFANA_URL/api/folders" \
  -d '{
    "title": "My Folder"
  }'

# Create with custom UID
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$GRAFANA_URL/api/folders" \
  -d '{
    "uid": "my-folder-uid",
    "title": "My Folder"
  }'

# Create nested folder (under parent)
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$GRAFANA_URL/api/folders" \
  -d '{
    "title": "Child Folder",
    "parentUid": "parent-folder-uid"
  }'
```

---

## Datasource Operations

### List Datasources

```bash
# List all datasources
curl -H "$AUTH" "$GRAFANA_URL/api/datasources"

# List with details
curl -H "$AUTH" "$GRAFANA_URL/api/datasources" | \
  jq '.[] | {id, uid, name, type, url, isDefault}'

# Filter by type
curl -H "$AUTH" "$GRAFANA_URL/api/datasources" | \
  jq '.[] | select(.type == "prometheus")'
```

### Get Datasource by UID

```bash
curl -H "$AUTH" "$GRAFANA_URL/api/datasources/uid/{uid}"
```

### Get Datasource by Name

```bash
curl -H "$AUTH" "$GRAFANA_URL/api/datasources/name/{name}"
```

### Get Datasource by ID

```bash
curl -H "$AUTH" "$GRAFANA_URL/api/datasources/{id}"
```

---

## Prometheus Queries

### Query Prometheus

```bash
# Using unified query API (recommended)
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$GRAFANA_URL/api/ds/query" \
  -d '{
    "queries": [{
      "refId": "A",
      "datasource": {"type": "prometheus", "uid": "datasource-uid"},
      "expr": "up",
      "instant": false,
      "range": true,
      "intervalMs": 15000,
      "maxDataPoints": 1000
    }],
    "from": "now-1h",
    "to": "now"
  }'

# Instant query
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$GRAFANA_URL/api/ds/query" \
  -d '{
    "queries": [{
      "refId": "A",
      "datasource": {"type": "prometheus", "uid": "datasource-uid"},
      "expr": "up",
      "instant": true
    }],
    "from": "now",
    "to": "now"
  }'

# Via datasource proxy
DATASOURCE_ID=1
curl -G -H "$AUTH" \
  --data-urlencode "query=up" \
  --data-urlencode "start=$(date -d '1 hour ago' +%s)" \
  --data-urlencode "end=$(date +%s)" \
  --data-urlencode "step=60" \
  "$GRAFANA_URL/api/datasources/proxy/$DATASOURCE_ID/api/v1/query_range"
```

### List Prometheus Metric Names

```bash
# Get all metric names
curl -H "$AUTH" \
  "$GRAFANA_URL/api/datasources/proxy/$DATASOURCE_ID/api/v1/label/__name__/values"

# Filter by regex (use match[] param)
curl -G -H "$AUTH" \
  --data-urlencode 'match[]={__name__=~"http.*"}' \
  "$GRAFANA_URL/api/datasources/proxy/$DATASOURCE_ID/api/v1/label/__name__/values"
```

### List Prometheus Label Names

```bash
# All label names
curl -H "$AUTH" \
  "$GRAFANA_URL/api/datasources/proxy/$DATASOURCE_ID/api/v1/labels"

# Labels for specific metric
curl -G -H "$AUTH" \
  --data-urlencode 'match[]={__name__="http_requests_total"}' \
  "$GRAFANA_URL/api/datasources/proxy/$DATASOURCE_ID/api/v1/labels"
```

### List Prometheus Label Values

```bash
# Values for specific label
curl -H "$AUTH" \
  "$GRAFANA_URL/api/datasources/proxy/$DATASOURCE_ID/api/v1/label/job/values"

# Values with filter
curl -G -H "$AUTH" \
  --data-urlencode 'match[]={__name__="http_requests_total"}' \
  "$GRAFANA_URL/api/datasources/proxy/$DATASOURCE_ID/api/v1/label/status/values"
```

### List Prometheus Metric Metadata

```bash
# All metadata
curl -H "$AUTH" \
  "$GRAFANA_URL/api/datasources/proxy/$DATASOURCE_ID/api/v1/metadata"

# Specific metric
curl -G -H "$AUTH" \
  --data-urlencode "metric=http_requests_total" \
  "$GRAFANA_URL/api/datasources/proxy/$DATASOURCE_ID/api/v1/metadata"
```

---

## Loki Queries

### Query Loki Logs

```bash
# Using unified query API
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$GRAFANA_URL/api/ds/query" \
  -d '{
    "queries": [{
      "refId": "A",
      "datasource": {"type": "loki", "uid": "loki-uid"},
      "expr": "{job=\"app\"} |= \"error\"",
      "queryType": "range",
      "maxLines": 100
    }],
    "from": "now-1h",
    "to": "now"
  }'

# Via datasource proxy
LOKI_ID=2
curl -G -H "$AUTH" \
  --data-urlencode 'query={job="app"} |= "error"' \
  --data-urlencode "start=$(date -d '1 hour ago' +%s)000000000" \
  --data-urlencode "end=$(date +%s)000000000" \
  --data-urlencode "limit=100" \
  "$GRAFANA_URL/api/datasources/proxy/$LOKI_ID/loki/api/v1/query_range"
```

### Query Loki Stats

```bash
# Get stream stats
curl -G -H "$AUTH" \
  --data-urlencode 'query={job="app"}' \
  --data-urlencode "start=$(date -d '1 hour ago' +%s)000000000" \
  --data-urlencode "end=$(date +%s)000000000" \
  "$GRAFANA_URL/api/datasources/proxy/$LOKI_ID/loki/api/v1/index/stats"
```

### List Loki Label Names

```bash
curl -H "$AUTH" \
  "$GRAFANA_URL/api/datasources/proxy/$LOKI_ID/loki/api/v1/labels"

# With time range
curl -G -H "$AUTH" \
  --data-urlencode "start=$(date -d '1 hour ago' +%s)000000000" \
  --data-urlencode "end=$(date +%s)000000000" \
  "$GRAFANA_URL/api/datasources/proxy/$LOKI_ID/loki/api/v1/labels"
```

### List Loki Label Values

```bash
# Values for label
curl -H "$AUTH" \
  "$GRAFANA_URL/api/datasources/proxy/$LOKI_ID/loki/api/v1/label/job/values"

# With time range
curl -G -H "$AUTH" \
  --data-urlencode "start=$(date -d '1 hour ago' +%s)000000000" \
  --data-urlencode "end=$(date +%s)000000000" \
  "$GRAFANA_URL/api/datasources/proxy/$LOKI_ID/loki/api/v1/label/job/values"
```

---

## Alerting

### List Alert Rules

```bash
# All alert rules
curl -H "$AUTH" "$GRAFANA_URL/api/v1/provisioning/alert-rules"

# Legacy alerting API
curl -H "$AUTH" "$GRAFANA_URL/api/ruler/grafana/api/v1/rules"

# By folder
curl -H "$AUTH" "$GRAFANA_URL/api/ruler/grafana/api/v1/rules/{folderName}"
```

### Get Alert Rule by UID

```bash
curl -H "$AUTH" "$GRAFANA_URL/api/v1/provisioning/alert-rules/{uid}"
```

### Create Alert Rule

```bash
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$GRAFANA_URL/api/v1/provisioning/alert-rules" \
  -d '{
    "title": "High CPU Usage",
    "ruleGroup": "my-group",
    "folderUID": "folder-uid",
    "condition": "A",
    "data": [{
      "refId": "A",
      "datasourceUid": "prometheus-uid",
      "model": {
        "expr": "avg(rate(node_cpu_seconds_total{mode!=\"idle\"}[5m])) > 0.8",
        "instant": true
      }
    }],
    "noDataState": "NoData",
    "execErrState": "Error",
    "for": "5m",
    "labels": {"severity": "warning"},
    "annotations": {"summary": "CPU usage above 80%"}
  }'
```

### Update Alert Rule

```bash
curl -X PUT -H "$AUTH" -H "Content-Type: application/json" \
  "$GRAFANA_URL/api/v1/provisioning/alert-rules/{uid}" \
  -d '{...}'
```

### Delete Alert Rule

```bash
curl -X DELETE -H "$AUTH" "$GRAFANA_URL/api/v1/provisioning/alert-rules/{uid}"
```

### List Contact Points

```bash
curl -H "$AUTH" "$GRAFANA_URL/api/v1/provisioning/contact-points"

# Filter by name
curl -H "$AUTH" "$GRAFANA_URL/api/v1/provisioning/contact-points?name=slack"
```

---

## Annotations

### Get Annotations

```bash
# All annotations
curl -H "$AUTH" "$GRAFANA_URL/api/annotations"

# With filters
curl -G -H "$AUTH" \
  --data-urlencode "dashboardUID=dashboard-uid" \
  --data-urlencode "from=$(date -d '24 hours ago' +%s)000" \
  --data-urlencode "to=$(date +%s)000" \
  "$GRAFANA_URL/api/annotations"

# By tags
curl -G -H "$AUTH" \
  --data-urlencode "tags=deployment" \
  "$GRAFANA_URL/api/annotations"

# Limit results
curl -H "$AUTH" "$GRAFANA_URL/api/annotations?limit=100"
```

### Create Annotation

```bash
# Dashboard annotation
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$GRAFANA_URL/api/annotations" \
  -d '{
    "dashboardUID": "dashboard-uid",
    "panelId": 1,
    "time": 1234567890000,
    "timeEnd": 1234567900000,
    "text": "Deployment started",
    "tags": ["deployment", "v1.2.0"]
  }'

# Global annotation (no dashboard)
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$GRAFANA_URL/api/annotations" \
  -d '{
    "time": '$(date +%s)000',
    "text": "System maintenance",
    "tags": ["maintenance"]
  }'
```

### Update Annotation

```bash
curl -X PUT -H "$AUTH" -H "Content-Type: application/json" \
  "$GRAFANA_URL/api/annotations/{id}" \
  -d '{
    "text": "Updated annotation text",
    "tags": ["updated", "tag"]
  }'
```

### Patch Annotation

```bash
curl -X PATCH -H "$AUTH" -H "Content-Type: application/json" \
  "$GRAFANA_URL/api/annotations/{id}" \
  -d '{
    "text": "Partially updated text"
  }'
```

### Create Graphite Annotation

```bash
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$GRAFANA_URL/api/annotations/graphite" \
  -d '{
    "what": "Deployment",
    "tags": ["deploy", "production"],
    "when": 1234567890,
    "data": "v1.2.0"
  }'
```

### Get Annotation Tags

```bash
curl -H "$AUTH" "$GRAFANA_URL/api/annotations/tags"

# Filter by tag prefix
curl -H "$AUTH" "$GRAFANA_URL/api/annotations/tags?tag=deploy"
```

### Delete Annotation

```bash
curl -X DELETE -H "$AUTH" "$GRAFANA_URL/api/annotations/{id}"
```

---

## Sift Investigations (Grafana Cloud)

### List Sift Investigations

```bash
curl -H "$AUTH" \
  "$GRAFANA_URL/api/plugins/grafana-sift-app/resources/investigations"

# With limit
curl -H "$AUTH" \
  "$GRAFANA_URL/api/plugins/grafana-sift-app/resources/investigations?limit=10"
```

### Get Sift Investigation

```bash
curl -H "$AUTH" \
  "$GRAFANA_URL/api/plugins/grafana-sift-app/resources/investigations/{id}"
```

### Get Sift Analysis

```bash
curl -H "$AUTH" \
  "$GRAFANA_URL/api/plugins/grafana-sift-app/resources/investigations/{investigationId}/analyses/{analysisId}"
```

### Find Error Pattern Logs

```bash
# Create investigation for error patterns
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$GRAFANA_URL/api/plugins/grafana-sift-app/resources/investigations" \
  -d '{
    "name": "Error Pattern Analysis",
    "type": "error-patterns",
    "labels": {"app": "my-app", "env": "production"},
    "start": "2024-01-01T00:00:00Z",
    "end": "2024-01-01T01:00:00Z"
  }'
```

### Find Slow Requests

```bash
# Create investigation for slow requests
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$GRAFANA_URL/api/plugins/grafana-sift-app/resources/investigations" \
  -d '{
    "name": "Slow Request Analysis",
    "type": "slow-requests",
    "labels": {"service": "api-gateway"},
    "start": "2024-01-01T00:00:00Z",
    "end": "2024-01-01T01:00:00Z"
  }'
```

---

## Asserts (Grafana Cloud)

### Get Assertions

```bash
curl -G -H "$AUTH" \
  --data-urlencode "entityType=Service" \
  --data-urlencode "entityName=my-service" \
  --data-urlencode "startTime=2024-01-01T00:00:00Z" \
  --data-urlencode "endTime=2024-01-01T01:00:00Z" \
  "$GRAFANA_URL/api/plugins/grafana-asserts-app/resources/assertions"
```

---

## Common Workflows

### Dashboard Backup Script

```bash
#!/bin/bash
mkdir -p dashboards-backup

curl -H "$AUTH" "$GRAFANA_URL/api/search?type=dash-db" | \
  jq -r '.[] | .uid' | \
  while read uid; do
    echo "Backing up: $uid"
    curl -H "$AUTH" "$GRAFANA_URL/api/dashboards/uid/$uid" | \
      jq '.dashboard' > "dashboards-backup/${uid}.json"
  done
```

### Metrics Health Check

```bash
#!/bin/bash
echo "=== System Health ==="

# CPU usage
curl -sG -H "$AUTH" \
  --data-urlencode 'query=100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)' \
  "$GRAFANA_URL/api/datasources/proxy/$DATASOURCE_ID/api/v1/query" | \
  jq -r '.data.result[0].value[1] | "CPU: \(.)%"'

# Memory usage
curl -sG -H "$AUTH" \
  --data-urlencode 'query=100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)' \
  "$GRAFANA_URL/api/datasources/proxy/$DATASOURCE_ID/api/v1/query" | \
  jq -r '.data.result[0].value[1] | "Memory: \(.)%"'
```

### Deployment Annotation

```bash
#!/bin/bash
VERSION=$1
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$GRAFANA_URL/api/annotations" \
  -d "{
    \"time\": $(date +%s)000,
    \"text\": \"Deployed version $VERSION\",
    \"tags\": [\"deployment\", \"$VERSION\"]
  }"
```

---

## PromQL Examples

```promql
# CPU usage
rate(node_cpu_seconds_total{mode!="idle"}[5m])

# Memory usage
node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes

# HTTP request rate
rate(http_requests_total[5m])

# Error rate percentage
rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) * 100

# Latency p95
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# Up/down status
up{job="my-service"}
```

## LogQL Examples

```logql
# Errors in last hour
{job="app"} |= "error"

# JSON parsing
{job="app"} | json | level="error"

# Regex match
{job="app"} |~ "failed.*connection"

# Count by service
sum by (service) (count_over_time({job="app"}[1h]))

# Rate of errors
rate({job="app"} |= "error" [5m])

# Label filtering
{namespace="production", app=~"api-.*"}
```

---

## When to Ask for Help

Ask the user for clarification when:
- Grafana URL or API key is not specified
- Datasource UID or ID is ambiguous
- Dashboard UID or folder location is unclear
- PromQL/LogQL query syntax needs validation
- Time range format or timezone considerations are uncertain
- Sift/Asserts features require Grafana Cloud
