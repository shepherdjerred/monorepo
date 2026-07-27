---
id: 2026-07-27-pagerduty-alerts-last-24-hours
type: log
status: complete
board: false
---

# PagerDuty alerts opened in the last 24 hours

Read-only review of PagerDuty incidents created between
2026-07-26 10:47:11 PDT (2026-07-26T17:47:11.580Z) and
2026-07-27 10:47:11 PDT (2026-07-27T17:47:11.580Z), including resolved incidents.

The final status-separated PagerDuty query returned six incidents:

- Triggered: 6
- Acknowledged: 0
- Resolved: 0

The resolved query returned 100 incidents as far back as 2026-06-27, so the
zero resolved count in the requested window was not caused by the combined
query's result limit.

## Findings

### Actionable

- [#6830: velero-orphan-audit workflow has not run successfully recently](https://sjerred.pagerduty.com/incidents/Q0GAZ9WG89D30L)
  opened at 2026-07-27 00:27 PDT and is still triggered.
  - The daily 03:30 PDT workflow completed through July 25, then failed on both
    July 26 and July 27 after exhausting three activity attempts.
  - The activity selects the first Running OpenEBS ZFS node pod. It now selects
    `openebs-zfs-localpv-node-4f2zk` on liskov, where
    `zfspv-pool-hdd` does not exist. That pool exists only on torvalds.
  - The failure is therefore a multi-node assumption in
    `packages/temporal/src/activities/velero-orphan-audit.ts`, introduced when
    the OpenEBS node DaemonSet gained a liskov pod. The durable fix is to
    enumerate node pods and inspect the pools present on each node rather than
    choosing one arbitrary pod and assuming both pools exist there.
  - The backup schedules themselves continue to run: the latest 6-hourly,
    daily, and weekly Backup CRs are `Completed`. This alert is a real orphan
    detection blind spot, not evidence that backup scheduling stopped.
- [#6826: Home Assistant entities unavailable](https://sjerred.pagerduty.com/incidents/Q0ZRDE7BTMYCX6)
  opened at 2026-07-26 22:10 PDT and is still triggered.
  - The current value is 70 unavailable/unknown entities.
  - Over the sampled 48 hours the count never fell below 70 and peaked at 192,
    so this is a sustained Home Assistant entity/integration cleanup problem,
    not a new 70-entity outage at the incident creation time.
  - The payload spans several integrations and devices, including water-heater,
    Sonos, Roborock maintenance, Samsung TV, Reolink, Sonoff, mobile/kiosk, and
    feeder entities.

### Expected maintenance

- [#6825: Granary feeder desiccant remaining days](https://sjerred.pagerduty.com/incidents/Q1ZEUYPADFXPZ4)
  opened at 2026-07-26 21:46 PDT and is still triggered. The sensor remains at
  -10 days; replace/reset the feeder desiccant.
- [#6829: Litter Robot waste high](https://sjerred.pagerduty.com/incidents/Q2LZ0ANCIK1V5Z)
  opened at 2026-07-26 23:52 PDT and is still triggered. The waste drawer
  remains at 80%; empty/reset it.

### Backup-policy review noise

- [#6827: Large PVC may impact Velero backups [buildkitd]](https://sjerred.pagerduty.com/incidents/Q0461BFMFB9KMT)
  opened at 2026-07-26 22:34 PDT and is still triggered.
- [#6828: Large PVC may impact Velero backups [turbo-cache]](https://sjerred.pagerduty.com/incidents/Q21JHBJBHV6ZO9)
  opened at 2026-07-26 22:58 PDT and is still triggered.
- Live Kubernetes state confirms both PVCs are Bound and intentionally excluded:
  - `buildkitd/buildkitd-cache-liskov`: 300 GiB,
    `velero.io/backup=disabled`,
    `velero.io/exclude-from-backup=true`
  - `turbo-cache/turbo-cache-liskov`: 256 GiB,
    `velero.io/backup=disabled`,
    `velero.io/exclude-from-backup=true`
- Source declares both as rebuildable CI caches with the same exclusion labels.
  The alert rule fires because kube-state-metrics does not export those custom
  labels and explicitly asks for manual policy review. Backup coverage is
  correct; the paging signal cannot self-clear from the policy it is trying to
  verify.

## Session Log — 2026-07-27

### Done

- Queried triggered, acknowledged, and resolved PagerDuty incidents separately
  for the final rolling 24-hour window.
- Inspected the underlying alert payload and current Prometheus signal for all
  six incidents.
- Verified the two large-cache PVC backup labels against live Kubernetes state
  and source.
- Traced the Velero orphan-audit alert through Temporal schedule history to the
  exact failed command and multi-node pod-selection assumption.

### Remaining

- None requested. Candidate follow-up work is to fix the Velero orphan-audit
  node/pool enumeration and improve or reroute the large-PVC policy-review
  signal.

### Caveats

- This was read-only. No PagerDuty incident was acknowledged/resolved and no
  cluster, Home Assistant, Temporal, or repository configuration was changed.
- The latest Velero Backup CRs are `Completed` but contain warnings; this review
  did not expand into a full R2 object-size/backup-content audit.
