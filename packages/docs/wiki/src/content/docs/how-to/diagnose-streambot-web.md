---
title: Diagnose Streambot web remote failures
description: Follow a failing web remote request from its reference id to its trace, logs, metrics, dashboard, and alerts.
sidebar:
  order: 14
---

Use this procedure when someone reports an error in the Streambot web remote, a
play command that starts slowly, or search that returns nothing. You need
Grafana access with the `homelab` context in `toolkit grafana`.

Every signal below uses closed label sets. Do not ask for, or search by, a
Discord id, username, guild or channel name, search text, media title, or URL.
The reference id is enough to find the request.

## 1. Get the reference id

The web remote shows a reference id next to an error. It is the trace id of the
request, which the API also returns in the `x-trace-id` response header
(`packages/streambot/src/web/server/api.ts`). If the user cannot copy it, open
the browser's network panel, select the failed `/api/` request, and read the
`x-trace-id` response header.

## 2. Find the request in Loki

Look up the request log by trace id. Every API request logs one `web request`
record with its closed route, status, error code, outcome, and duration:

```bash
toolkit loki query \
  '{namespace="media",app="streambot"} | json | message="web request" | traceId="<reference-id>"' \
  --since 24h
```

A play or control action also logs one `web command` record in the same trace.
It carries the action, transport, outcome, error code, and duration:

```bash
toolkit loki query \
  '{namespace="media",app="streambot"} | json | message="web command" | traceId="<reference-id>"' \
  --since 24h
```

Without a reference id, list recent failures instead. Server-side failures log
at warning level:

```bash
toolkit loki query \
  '{namespace="media",app="streambot"} | json | message="web request" | status >= 500' \
  --since 1h --limit 50
```

Read `code` first. It names the failure from a closed list in
`packages/streambot/src/observability/web-metrics.ts`. `outcome` separates
`denied`, `invalid`, and `conflict` (the caller's problem) from `unavailable`
and `error` (Streambot's problem).

## 3. Open the trace in Tempo

Fetch the trace with the same id:

```bash
toolkit tempo get <reference-id> --since 24h
```

The root span is `streambot.web.request`. Its attributes include the route,
code, and outcome; its children show where the time went. Read every log
written inside the trace with the same id:

```bash
toolkit loki query '{namespace="media",app="streambot"} | json | traceId="<reference-id>"' --since 24h
```

## 4. Check the metrics

Run these in `toolkit prom query` or Grafana Explore. Series carry
`namespace="media"` and `app="streambot"`.

| Question                               | Series                                                             |
| -------------------------------------- | ------------------------------------------------------------------ |
| Are requests failing, and with what?   | `streambot_web_requests_total` by `code` and `status_class`        |
| Which routes are slow?                 | `streambot_web_request_duration_seconds_bucket` by `route`         |
| Which commands fail?                   | `streambot_web_commands_total` by `action`, `transport`, `outcome` |
| Does playback start promptly?          | `streambot_web_time_to_playback_seconds_bucket` by `transport`     |
| Do plays succeed on every entry point? | `streambot_play_requests_total` by `surface` and `outcome`         |
| Are sign-ins failing?                  | `streambot_web_logins_total` by `outcome`                          |
| Are room streams connecting?           | `streambot_web_sse_connections`, `streambot_web_sse_closed_total`  |
| Is search returning results?           | `streambot_web_search_total` by `kind`, `provider`, `outcome`      |
| Is a music provider failing?           | `streambot_music_provider_requests_total` by `provider`, `outcome` |
| Is usage capture dropping events?      | `streambot_analytics_events_total` by `event` and `outcome`        |

For example, the share of requests failing with a server error:

```promql
sum(rate(streambot_web_requests_total{status_class="5xx"}[15m]))
  / sum(rate(streambot_web_requests_total{status_class!="aborted"}[15m]))
```

## 5. Read the dashboard

Open the Grafana dashboard with UID `streambot-web`
(`packages/homelab/src/cdk8s/grafana/streambot/streambot-web-dashboard.ts`).
Work from top to bottom:

1. **Web API requests** shows request rate, error rate by code, and duration by
   route.
2. **Remote commands** splits outcomes by action and transport.
3. **Playback and sign-in** shows time to playback, play success by surface,
   and sign-in outcomes.
4. **Room event streams (SSE)** shows open connections, events, dropped
   snapshots, and close reasons.
5. **Search** and **Music providers and analytics** show search outcomes,
   latency, provider calls, and capture outcomes.

Match the time of the user's report against the panel that moved, then return
to step 2 with a failing request from that window.

## 6. Respond to an alert

The rules live in
`packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/streambot.ts`.
Each has a minimum-volume floor, so a quiet evening cannot fire it.

| Alert                                 | Fires when                                                                     | Start at                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `StreambotWebServerErrors`            | More than 5% of at least 50 requests in 15 minutes were 5xx or `unavailable`   | Step 2, filtered to `status >= 500`, then the **Error rate** panel |
| `StreambotWebTimeToPlaybackSlow`      | p95 time to playback exceeds 20 seconds, with at least 10 starts in 30 minutes | The **Time to playback** panel and the encoder alerts              |
| `StreambotMusicSearchProviderFailing` | A provider failed more than half of at least 20 calls in 30 minutes            | The **Music provider requests** panel, then upstream status        |

## Related

- [Streambot web remote](/explanation/streambot-web-remote/) — architecture and privacy boundaries
- [How to enable the Streambot web remote](/how-to/enable-streambot-web-remote/) — provision and activate the remote
- [Diagnose Streambot voice](/how-to/diagnose-streambot-voice/) — the voice assistant's equivalent procedure
- [Diagnose Streambot sports playback](/how-to/diagnose-streambot-sports/) — provider, decode, and delivery failures
