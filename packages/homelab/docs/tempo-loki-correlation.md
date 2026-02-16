# Tempo to Loki Trace Correlation Setup

This document explains how to manually configure Tempo-to-Loki trace correlation in Grafana.

## Why Manual Configuration?

Grafana 12.1.0+ has a bug where datasource provisioning fails when a `uid` field is specified:

- **Issue**: https://github.com/grafana/grafana/issues/110740
- **Status**: Open as of Dec 2025

Until this is fixed, the `tracesToLogsV2` configuration cannot be provisioned via YAML and must be configured
manually in the Grafana UI.

## Configuration Steps

### 1. Navigate to Tempo Datasource Settings

1. Open Grafana
2. Go to **Connections** > **Data sources**
3. Click on the **tempo** datasource

### 2. Configure Trace to Logs

Scroll down to the **Trace to logs** section and configure:

| Setting                   | Value                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------- |
| **Data source**           | `loki`                                                                             |
| **Span start time shift** | `-1h`                                                                              |
| **Span end time shift**   | `1h`                                                                               |
| **Filter by trace ID**    | Disabled                                                                           |
| **Filter by span ID**     | Disabled                                                                           |
| **Use custom query**      | Enabled                                                                            |
| **Query**                 | `{namespace=~"dagger\|arc-runners"} \| logfmt \| traceID=\`${\_\_trace.traceId}\`` |

### 3. Save & Test

Click **Save & test** to apply the configuration.

## How It Works

- **Dagger engine** emits logs in logfmt format containing `traceID=<hex32>`
- **Promtail** ships these logs to Loki
- When viewing a trace in Grafana, clicking "Logs for this trace" runs the custom query
- The query filters Loki logs by the trace ID from the current trace span

## References

- [Grafana Tempo Datasource Configuration](https://grafana.com/docs/grafana/latest/datasources/tempo/configure-tempo-data-source/)
- [Trace to Logs Documentation](https://grafana.com/docs/grafana/latest/datasources/tempo/configure-tempo-data-source/#trace-to-logs)
- [Grafana Issue #110740 - UID provisioning bug](https://github.com/grafana/grafana/issues/110740)

## Future: Automated Provisioning

Once the Grafana bug is fixed, restore the provisioned configuration in `prometheus.ts`:

```typescript
{
  name: "loki",
  uid: "loki",
  editable: false,
  type: "loki",
  url: "http://loki-gateway.loki",
  version: 1,
},
{
  name: "tempo",
  uid: "tempo",
  editable: false,
  type: "tempo",
  url: "http://tempo.tempo.svc:3200",
  version: 1,
  jsonData: {
    tracesToLogsV2: {
      datasourceUid: "loki",
      spanStartTimeShift: "-1h",
      spanEndTimeShift: "1h",
      filterByTraceID: false,
      filterBySpanID: false,
      customQuery: true,
      query: '{namespace=~"dagger|arc-runners"} | logfmt | traceID=`${__trace.traceId}`',
    },
  },
},
```
