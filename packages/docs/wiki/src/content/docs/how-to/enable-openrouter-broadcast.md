---
title: Enable OpenRouter Broadcast
description: Point the OpenRouter Broadcast webhook at the ingest service and confirm the authoritative per-generation cost record is arriving.
sidebar:
  order: 15
---

The `openrouter-broadcast-ingest` service is deployed and reachable, but it only
receives anything once the webhook is configured in the OpenRouter dashboard.
Until then it looks healthy and delivers nothing, and the authoritative
per-generation cost record does not exist.

This guide configures the webhook and confirms delivery. You need access to the
OpenRouter dashboard and to the `openrouter-broadcast-ingest` 1Password item.

## 1. Confirm the service is up but silent

```bash
toolkit prom query 'up{namespace="openrouter-broadcast-ingest"}'
toolkit prom query 'openrouter_broadcast_last_success_timestamp_seconds'
```

`up` should be `1`. A `last_success` of `0` means no delivery has ever
completed, which is the state this guide fixes. A non-zero value means Broadcast
is already working and you are in the wrong guide.

## 2. Read the bearer token

```bash
op read "op://<vault>/openrouter-broadcast-ingest/OPENROUTER_BROADCAST_BEARER_TOKEN"
```

Do not paste the value anywhere except the OpenRouter dashboard field in step 3.

If `op whoami` says you are signed out, ignore it and run the `op read` anyway —
desktop-app integration authenticates each operation individually and does not
always create a shell session.

## 3. Configure the webhook

In the OpenRouter dashboard, add a Broadcast destination:

| Field  | Value                                             |
| ------ | ------------------------------------------------- |
| URL    | `https://openrouter-broadcast.sjer.red/v1/traces` |
| Method | `POST`                                            |
| Header | `Authorization: Bearer <token from step 2>`       |
| Format | OTLP/HTTP JSON                                    |

Run OpenRouter's built-in connection test. A `204` means the payload was both
archived and forwarded; any other status is a real failure, not a warm-up.

## 4. Send one real generation

Trigger any workload that calls OpenRouter — a Discord `/bb-ask`, or any Birmel
message — so a genuine payload flows rather than OpenRouter's synthetic test.

## 5. Verify all four outputs

Pod health is not acceptance. Confirm each of these separately:

```bash
# Deliveries are arriving and succeeding
toolkit prom query 'sum by (outcome) (openrouter_broadcast_requests_total)'
toolkit prom query 'sum by (operation, outcome) (openrouter_broadcast_operations_total)'

# The last success is recent rather than zero
toolkit prom query 'time() - max(openrouter_broadcast_last_success_timestamp_seconds)'

# A body-free correlated span reached Tempo
toolkit tempo query '{resource.service.name=~".*openrouter.*"}' --since 1h --limit 5
```

Then confirm the fourth output by hand: a payload object and its digest receipt
exist in the private SeaweedFS LLM archive bucket. The archive is the only one of
the four that Prometheus cannot answer for you.

The `OpenRouterBroadcastSilent` alert resolves within 30 minutes of the first
successful delivery. If it stays firing, work through
`OpenRouterBroadcastPipelineFailure` and the service logs rather than
re-running the connection test.

## Related

- [LLM stack](/explanation/llm-stack/) — why Broadcast is a second, correlated
  evidence source rather than the primary one.
- `packages/openrouter-broadcast-ingest/README.md` — the service's own
  configuration and canary notes.
