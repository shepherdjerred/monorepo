---
title: PagerDuty Open Alerts
date: 2026-06-02
---

## Status

Partially Complete

## Summary

Queried current open PagerDuty incidents via `toolkit pd incidents --json` using the configured `PAGERDUTY_TOKEN`.

PagerDuty initially returned 10 open incidents, all `triggered`, high urgency, assigned to Jerred Shepherd, under the `Homelab` service. The remediation pass later refreshed PagerDuty and found 12 open incidents: the original 10 plus Temporal Anthropic rate limit incident #5353 and ZFS hash-collision incident #5354. After resolving cleared Roomba no-missions incident #5346, the final refresh returned 10 open incidents; #5354 was no longer open in that final list.

Alert groups:

- Home Assistant / Roomba presence and entity health: incidents 5332, 5333, 5346, 5351
- Large PVC / Velero backup policy review: incidents 5335, 5336, 5337, 5338, 5339
- Granary feeder maintenance: incident 5345

## Session Log - 2026-06-02 Initial Triage

### Done

- Loaded the PagerDuty helper skill and used local `toolkit pd incidents --json` to list open PagerDuty incidents.
- Retried the query with approved network access after sandbox networking blocked the first attempt.
- Summarized the 10 open incidents and grouped them by likely remediation area.

### Remaining

- No remediation was requested yet.

### Caveats

- This was a read-only PagerDuty check. No incidents were acknowledged, resolved, or modified.

## Session Log - 2026-06-02 Remediation

### Done

- Added a monitoring suppression allowlist for reviewed large PVCs in `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/velero.ts` so `VeleroLargePVCMayImpactBackups` stops paging for PVCs whose backup policy was reviewed but whose Velero labels are invisible to kube-state-metrics.
- Added focused rule coverage in `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/velero.test.ts`.
- Updated `packages/temporal/src/activities/pr-review/specialists.ts` so Anthropic provider-limit failures stop remaining PR-review specialist fanout instead of continuing all 15 passes.
- Added focused Temporal tests in `packages/temporal/src/activities/pr-review/specialists.test.ts`.
- Verified the existing specialist success path already clears both Anthropic `pr_review_specialist` provider issue gauges after a successful SDK call.
- Corrected ZFS ARC config drift in `packages/homelab/src/talos/patches/zfs.yaml` and `packages/homelab/src/talos/patches/image.yaml`, moving the configured max from 48 GB to the documented 62.5 GiB remediation for high ZFS hash collisions.
- Refreshed live Grafana/PagerDuty/Kubernetes evidence. Current evidence still shows Home Assistant unavailable entities around 51, Roomba bin full at 1, Granary desiccant at -9 days, Temporal `ai_provider_issue_active{source="pr_review_specialist",kind="rate_limit"}` at 1, and ZFS hash collisions still above the alert threshold. Roomba missions are now greater than 0 over 48h.
- Added an evidence note to PagerDuty incident #5346 and resolved it because the fresh Roomba mission-count metric was green.
- Refreshed PagerDuty after resolving #5346; the remaining open incident list contains #5332, #5333, #5335-#5339, #5345, #5351, and #5353.
- Verified with `bunx eslint --fix` on changed TypeScript files, `bun run typecheck` in `packages/homelab/src/cdk8s`, `bun run typecheck` in `packages/temporal`, focused homelab Velero rule tests, and focused Temporal specialist/runner tests.

### Remaining

- Physical Home Assistant fixes remain: empty the Roomba bin, replace the Granary desiccant, and repair unavailable HA entity clusters.
- Deploy the homelab monitoring rule change before resolving large-PVC PagerDuty incidents #5335-#5339.
- Deploy the Temporal specialist fanout change and confirm the provider gauge clears before resolving PagerDuty incident #5353.
- Apply the Talos ZFS ARC config to `torvalds` through a controlled Talos patch/reboot window, then verify #5354 clears.
- Re-run `toolkit pd incidents --json` after more evidence clears and resolve only incidents whose backing condition is green.

### Caveats

- Only PagerDuty incident #5346 was modified. No other incidents were acknowledged or resolved because fresh evidence still showed active backing conditions or undeployed code/config remediation.
- The large-PVC rule can only stop paging after the updated Prometheus rule is rendered and applied.
- The ZFS ARC repo fix is not live until Talos machine config is patched and the node is rebooted.
