---
id: log-2026-07-26-pagerduty-liskov-alert-resolution
type: log
status: complete
board: false
---

# PagerDuty liskov alert resolution

## Context

Opened 10 Homelab PD incidents (plus Litter Robot, left alone). Root-caused to
liskov joining as a CI-only worker (~27h earlier) plus Retain PV cleanup debt.

| Alerts                                       | Root cause                                           |
| -------------------------------------------- | ---------------------------------------------------- |
| DaemonSet misscheduled ×3 + rollout stuck ×3 | Leftover pods on liskov without `ci=only` toleration |
| NodeExporterDown + TargetDown                | Tailscale ACL missing `tag:k8s→tag:k8s:9100`         |
| ReleasedPVsAccumulating                      | 7 Released Retain PVs (`sum > 5` for 24h)            |

## What already landed before this session finished

PR **#1686** (`CI observability overhaul`) shipped the durable code fixes:

- `acl.tf`: grant `tag:k8s → tag:k8s:9100`
- promtail / loki-canary / nfd worker: `CI_NODE_TOLERATION`
- Live verify after merge: both `up{job="node-exporter"}=1`, all three DS
  `misscheduled=0`, only `ReleasedPVsAccumulating` still firing

## This session

1. Confirmed #1686 coverage; ACL **test** still omitted `:9100` — fixed.
2. Documented the multi-node `:9100` gotcha in the Tailscale ACL runbook.
3. Operator cleanup of all 7 Released PVs (CI/Dagger orphans + overseerr +
   pokemon-rom after Bound-replacement checks).

## Session Log — 2026-07-26

### Done

- Root-caused all non–Litter-Robot PD incidents
- Confirmed #1686 already fixed ACL grant + DS tolerations (live green)
- ACL test + runbook gotcha for `:9100` — PR #1705
- Pre-checked PV delete safety (replacements Bound, seerr/overseerr redirect OK)

### Remaining

- Operator must run the 7 Released PV deletes (agent sandbox blocks `kubectl delete pv`)
- Litter Robot is physical waste drawer

### Caveats

- ACL test change is belt-and-suspenders; live grant already applied via #1686
- PV alert has `for: 24h` — PD may lag until Alertmanager clears after count drops
