---
id: parameterized-sleep-automations
type: plan
status: awaiting-human
board: true
verification: human
disposition: active
---

# Parameterized sleep automations

## Summary

Add two manually triggered Temporal workflows whose durations come from iOS
Shortcuts:

- `sleepMusic`: bedroom sleep audio at 10%, default 180 minutes.
- `sleepAc`: bedroom AC at 24°C in cooling mode, default 120 minutes.

## Design

An authenticated Temporal HTTP webhook exposes `/sleep/music` and `/sleep/ac`
through `https://temporal-sleep.sjer.red` on worker port `9469`. The Shortcut
sends `duration_hours` with a dedicated `SLEEP_WEBHOOK_TOKEN` bearer token; the
webhook rounds hours to minutes, validates 1–1440 minutes, starts the fixed
workflow ID, and terminates an active run when a new invocation restarts the
timer. The workflow execution timeout is the requested duration plus a
60-minute cleanup buffer. Accepted requests return `202`; authentication,
payload, and workflow-start failures return `401`, `400`, and `500`
respectively.

Home Assistant is only the downstream service target for Temporal activities; no
sleep scripts or custom sleep events are required in HA.

## Verification

- Workflow tests cover media/AC service calls, cleanup, defaults, and invalid
  durations.
- Sleep webhook tests cover authentication, malformed payloads, hours-to-minutes
  conversion, rounding, dynamic timeouts, restart policy, and invalid values.
- Wiki typecheck/tests, docs validation, and Home Assistant cdk8s synthesis
  pass. The package-wide Temporal typecheck remains blocked by unrelated
  missing Glitter/LLM workspace modules.
- Shortcut setup uses Ask for Input → Get Contents of URL, with the raw hours
  value sent to the dedicated Temporal webhook.

## Human Verification

- [ ] Create the “Sleep music” Shortcut with the documented actions and test a
      short duration such as `0.5` hours; verify the bedroom speaker starts at
      10% and stops after 30 minutes.
- [ ] Create the “Sleep AC” Shortcut with the documented actions and test a
      short duration; verify `climate.bedroom` reaches 24°C/cool and turns off
      at the requested deadline.
- [ ] Invoke either Shortcut again with a different duration and verify the
      active timer is replaced.

Accept the implementation if each request reaches the authenticated webhook,
the requested device setting is applied, and the device is stopped or turned
off at the requested deadline, including after a retrigger. Reject it and keep
the plan open if authentication, device application, retrigger replacement, or
deadline cleanup fails.
