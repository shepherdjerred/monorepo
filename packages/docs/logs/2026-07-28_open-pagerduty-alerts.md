---
id: log-2026-07-28-open-pagerduty-alerts
type: log
status: complete
board: false
---

# Open PagerDuty Alerts

## Scope

Read-only review of all currently triggered or acknowledged PagerDuty incidents.

## Snapshot

At 2026-07-28 12:41:48 PDT, PagerDuty had nine open incidents:

- Nine triggered, zero acknowledged.
- All were high urgency, on the Homelab service, and assigned to Jerred Shepherd.
- Five incidents described one `mcp-gateway` failure cluster: its internal probe
  was down and pod `mcp-gateway-5b8dcfd8f5-f4l26` was in
  `CrashLoopBackOff`, leaving the pod non-ready and the deployment with a
  replica mismatch and stuck rollout.
- The other four incidents were 73 unavailable or unknown Home Assistant
  entities, a Litter Robot waste drawer at 81%, a Glitter corpus snapshot more
  than 30 hours stale, and a Roborock third-floor vacuum reporting a stuck,
  robot, or dock error.

| Incident                                                        | Triggered    | Age     | Alert                                                        |
| --------------------------------------------------------------- | ------------ | ------- | ------------------------------------------------------------ |
| [#6868](https://sjerred.pagerduty.com/incidents/Q01E8M3QS01O6O) | 12:06 AM PDT | 12h 35m | Home Assistant entities unavailable (73 entities)            |
| [#6870](https://sjerred.pagerduty.com/incidents/Q2MH860DDHO8JD) | 12:43 AM PDT | 11h 58m | `mcp-gateway` internal probe down                            |
| [#6871](https://sjerred.pagerduty.com/incidents/Q0M3KPZKGWE65O) | 12:48 AM PDT | 11h 53m | `mcp-gateway` replica mismatch                               |
| [#6872](https://sjerred.pagerduty.com/incidents/Q0ZX5ZNIKL2D88) | 12:48 AM PDT | 11h 53m | `mcp-gateway` pod non-ready                                  |
| [#6873](https://sjerred.pagerduty.com/incidents/Q0N0QILH2PRNO5) | 12:48 AM PDT | 11h 53m | `mcp-gateway` pod crash looping                              |
| [#6874](https://sjerred.pagerduty.com/incidents/Q0ANF3JKKZ8R8B) | 12:51 AM PDT | 11h 49m | Litter Robot waste drawer at 81%                             |
| [#6875](https://sjerred.pagerduty.com/incidents/Q31VZS3RHZABZA) | 12:58 AM PDT | 11h 43m | `mcp-gateway` rollout stuck                                  |
| [#6876](https://sjerred.pagerduty.com/incidents/Q2W1BDOF1JJD5Y) | 5:58 AM PDT  | 6h 43m  | Glitter Discord corpus snapshot stale for more than 30 hours |
| [#6878](https://sjerred.pagerduty.com/incidents/Q3RPGP37T41KRA) | 12:16 PM PDT | 25m     | Roborock third-floor vacuum problem                          |

## Session Log — 2026-07-28

### Done

- Queried triggered and acknowledged incidents independently and confirmed nine
  triggered incidents with zero acknowledged incidents.
- Inspected the underlying PagerDuty alert payload and incident timeline for
  every open incident.
- Grouped the five `mcp-gateway` alerts into one failure cluster and recorded
  the point-in-time snapshot above.

### Remaining

- None.

### Caveats

- PagerDuty state is time-sensitive; this log records a point-in-time snapshot.
- This session reviewed PagerDuty data only and did not inspect or change the
  underlying Kubernetes, Home Assistant, Glitter, Litter Robot, or Roborock
  systems.
