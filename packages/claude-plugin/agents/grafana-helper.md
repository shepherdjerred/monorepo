---
description: Grafana observability using API and grafana-cli
when_to_use: When user mentions Grafana, metrics, dashboards, PromQL, LogQL, or observability
---

# Grafana Helper Agent

## Overview

This agent helps you work with Grafana for observability, dashboard management, and metrics/logs querying using the Grafana API and `grafana-cli`.

## API Setup

### Authentication

```bash
# Set API key
export GRAFANA_URL="https://your-grafana.com"
export GRAFANA_API_KEY="your-api-key"

# Or use basic auth
export GRAFANA_USER="admin"
export GRAFANA_PASSWORD="password"

# Test connection
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "$GRAFANA_URL/api/health"
```

## API Usage

### Dashboards

**List dashboards**:
```bash
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "$GRAFANA_URL/api/search?type=dash-db" | jq .

# Search dashboards
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "$GRAFANA_URL/api/search?query=kubernetes" | jq .
```

**Get dashboard**:
```bash
# Get by UID
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "$GRAFANA_URL/api/dashboards/uid/dashboard-uid" | jq .

# Get dashboard JSON
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "$GRAFANA_URL/api/dashboards/uid/dashboard-uid" | \
  jq '.dashboard'
```

**Create/Update dashboard**:
```bash
curl -X POST \
  -H "Authorization: Bearer $GRAFANA_API_KEY" \
  -H "Content-Type: application/json" \
  -d @dashboard.json \
  "$GRAFANA_URL/api/dashboards/db"

# Example dashboard.json structure
cat > dashboard.json <<'EOF'
{
  "dashboard": {
    "title": "My Dashboard",
    "tags": ["monitoring"],
    "timezone": "browser",
    "panels": [],
    "schemaVersion": 16,
    "version": 0
  },
  "folderUid": "folder-uid",
  "overwrite": false
}
EOF
```

**Delete dashboard**:
```bash
curl -X DELETE \
  -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "$GRAFANA_URL/api/dashboards/uid/dashboard-uid"
```

### Data Sources

**List data sources**:
```bash
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "$GRAFANA_URL/api/datasources" | \
  jq '.[] | {id, name, type, url}'
```

**Get data source**:
```bash
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "$GRAFANA_URL/api/datasources/$DATASOURCE_ID" | jq .
```

**Create data source**:
```bash
curl -X POST \
  -H "Authorization: Bearer $GRAFANA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Prometheus",
    "type": "prometheus",
    "url": "http://localhost:9090",
    "access": "proxy",
    "isDefault": true
  }' \
  "$GRAFANA_URL/api/datasources"
```

### Querying Metrics (Prometheus)

**Query Prometheus data**:
```bash
# PromQL query
QUERY="up"
START=$(date -u -d '1 hour ago' +%s)
END=$(date -u +%s)

curl -G \
  -H "Authorization: Bearer $GRAFANA_API_KEY" \
  --data-urlencode "query=$QUERY" \
  --data-urlencode "start=$START" \
  --data-urlencode "end=$END" \
  --data-urlencode "step=60" \
  "$GRAFANA_URL/api/datasources/proxy/$DATASOURCE_ID/api/v1/query_range" | \
  jq '.data.result'
```

**Instant query**:
```bash
curl -G \
  -H "Authorization: Bearer $GRAFANA_API_KEY" \
  --data-urlencode "query=up" \
  "$GRAFANA_URL/api/datasources/proxy/$DATASOURCE_ID/api/v1/query" | \
  jq '.data.result'
```

### Querying Logs (Loki)

**LogQL query**:
```bash
# Query logs
QUERY='{job="varlogs"} |= "error"'
START=$(date -u -d '1 hour ago' +%s)000000000
END=$(date -u +%s)000000000

curl -G \
  -H "Authorization: Bearer $GRAFANA_API_KEY" \
  --data-urlencode "query=$QUERY" \
  --data-urlencode "start=$START" \
  --data-urlencode "end=$END" \
  --data-urlencode "limit=100" \
  "$GRAFANA_URL/api/datasources/proxy/$LOKI_DATASOURCE_ID/loki/api/v1/query_range" | \
  jq '.data.result'
```

### Alerts

**List alert rules**:
```bash
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "$GRAFANA_URL/api/ruler/grafana/api/v1/rules" | jq .

# List alerts by folder
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "$GRAFANA_URL/api/ruler/grafana/api/v1/rules/folder-name" | jq .
```

**Get alert notifications**:
```bash
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "$GRAFANA_URL/api/alert-notifications" | jq .
```

### Users and Organizations

**List users**:
```bash
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "$GRAFANA_URL/api/users" | jq .
```

**Get current user**:
```bash
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "$GRAFANA_URL/api/user" | jq .
```

**List organizations**:
```bash
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "$GRAFANA_URL/api/orgs" | jq .
```

## grafana-cli

### Common Commands

```bash
# Install plugin
grafana-cli plugins install grafana-piechart-panel

# List installed plugins
grafana-cli plugins ls

# Update plugin
grafana-cli plugins update grafana-piechart-panel

# Remove plugin
grafana-cli plugins remove grafana-piechart-panel

# Reset admin password
grafana-cli admin reset-admin-password newpassword
```

## Common Workflows

### Dashboard Backup

```bash
#!/bin/bash
# Backup all dashboards

mkdir -p dashboards-backup

# Get all dashboards
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "$GRAFANA_URL/api/search?type=dash-db" | \
  jq -r '.[] | .uid' | \
  while read uid; do
    echo "Backing up dashboard: $uid"
    curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
      "$GRAFANA_URL/api/dashboards/uid/$uid" | \
      jq '.dashboard' > "dashboards-backup/${uid}.json"
  done
```

### Dashboard Provisioning

```bash
#!/bin/bash
# Restore dashboards from backup

for dashboard_file in dashboards-backup/*.json; do
  dashboard_json=$(cat "$dashboard_file")

  curl -X POST \
    -H "Authorization: Bearer $GRAFANA_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"dashboard\": $dashboard_json,
      \"overwrite\": true
    }" \
    "$GRAFANA_URL/api/dashboards/db"
done
```

### Metrics Dashboard

```bash
#!/bin/bash
# Query and display key metrics

echo "=== System Health ==="

# CPU usage
curl -sG -H "Authorization: Bearer $GRAFANA_API_KEY" \
  --data-urlencode 'query=100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)' \
  "$GRAFANA_URL/api/datasources/proxy/$DATASOURCE_ID/api/v1/query" | \
  jq -r '.data.result[] | "\(.metric.instance): \(.value[1])%"'

echo "\n=== Memory Usage ==="
curl -sG -H "Authorization: Bearer $GRAFANA_API_KEY" \
  --data-urlencode 'query=100 * (1 - ((node_memory_MemAvailable_bytes) / (node_memory_MemTotal_bytes)))' \
  "$GRAFANA_URL/api/datasources/proxy/$DATASOURCE_ID/api/v1/query" | \
  jq -r '.data.result[] | "\(.metric.instance): \(.value[1])%"'
```

## Best Practices

1. **Use API Keys**: Create service account tokens instead of admin credentials
2. **Version Control**: Store dashboard JSON in git
3. **Organize**: Use folders to organize dashboards
4. **Template Variables**: Make dashboards reusable with variables
5. **Alerting**: Set up alerts for critical metrics
6. **Retention**: Configure appropriate data retention policies

## PromQL Examples

```bash
# CPU usage
rate(node_cpu_seconds_total{mode!="idle"}[5m])

# Memory usage
node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes

# HTTP request rate
rate(http_requests_total[5m])

# Error rate
rate(http_requests_total{status=~"5.."}[5m])

# Latency p95
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))
```

## LogQL Examples

```bash
# Errors in last hour
{job="app"} |= "error"

# Filter by level
{job="app"} | json | level="error"

# Count by service
sum by (service) (count_over_time({job="app"}[1h]))

# Rate of errors
rate({job="app"} |= "error" [5m])
```

## Configuration Files

### Data Source Provisioning

```yaml
# /etc/grafana/provisioning/datasources/prometheus.yaml
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: false
```

### Dashboard Provisioning

```yaml
# /etc/grafana/provisioning/dashboards/default.yaml
apiVersion: 1

providers:
  - name: 'default'
    orgId: 1
    folder: ''
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10
    options:
      path: /var/lib/grafana/dashboards
```

## Examples

### Example 1: Health Check Script

```bash
#!/bin/bash

# Check Grafana health
status=$(curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "$GRAFANA_URL/api/health" | jq -r '.database')

if [ "$status" = "ok" ]; then
  echo "Grafana is healthy"
else
  echo "Grafana health check failed"
  exit 1
fi
```

### Example 2: Alert Status Check

```bash
#!/bin/bash

# Get firing alerts
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "$GRAFANA_URL/api/alerts" | \
  jq '.[] | select(.state == "alerting") | {name, state, message}'
```

### Example 3: Create Dashboard from Template

```bash
#!/bin/bash

# Create dashboard with panels
cat > dashboard.json <<'EOF'
{
  "dashboard": {
    "title": "Service Dashboard",
    "panels": [
      {
        "id": 1,
        "title": "Request Rate",
        "type": "graph",
        "datasource": "Prometheus",
        "targets": [
          {
            "expr": "rate(http_requests_total[5m])"
          }
        ]
      }
    ]
  },
  "overwrite": true
}
EOF

curl -X POST \
  -H "Authorization: Bearer $GRAFANA_API_KEY" \
  -H "Content-Type: application/json" \
  -d @dashboard.json \
  "$GRAFANA_URL/api/dashboards/db"
```

## When to Ask for Help

Ask the user for clarification when:
- Grafana URL or API key is not specified
- Data source ID or name is ambiguous
- Dashboard UID or folder location is unclear
- PromQL/LogQL query syntax needs validation
- Time range format or timezone considerations are uncertain
