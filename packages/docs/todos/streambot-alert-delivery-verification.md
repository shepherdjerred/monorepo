---
id: streambot-alert-delivery-verification
type: todo
status: in-progress
board: true
verification: agent
disposition: active
origin: packages/docs/archive/superseded/streambot-stutter-observability-followup.md
---

# Verify Streambot critical-alert delivery

`StreambotEncoderFallingBehind` should have fired during the documented
Avengers incident, but no notification was observed. The newer
`StreambotPlaybackBehindSchedule` alert must not be trusted until the shared
routing path is proven.

## Remaining

- [ ] Trace both rules through rendered PrometheusRule, Alertmanager routes,
      inhibition, silences, and contact-point configuration; record where the
      historical alert was dropped.
- [ ] Correct the routing/configuration defect and exercise a bounded synthetic
      alert that reaches the intended notification destination.
- [ ] Confirm the synthetic alert resolves cleanly and add a regression check
      for the rendered route or alert labels that caused the miss.

## Comment Log

### 2026-07-27 — split from stutter follow-up

- Retained as active because this is a distinct delivery failure, not playback
  tuning work.
