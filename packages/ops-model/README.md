# @shepherdjerred/ops-model

The contract behind the ops overview. The Temporal `ops-snapshot` collector
produces an `OpsIngest` payload. The ops dashboard (`packages/alert-dashboard`)
stores it. The web UI, the TRMNL screen, the email digest, and
`toolkit ops summary` all render it.

| Module                         | What it owns                                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `severity.ts`                  | The `ok < info < unknown < warning < error` scale and its rollup helpers.                                                                                |
| `snapshot.ts`                  | Zod schemas for `Signal`, `Metric`, `Section`, `SourceStatus`, `Snapshot`, the public `SnapshotResponse`, `ChangeEvent`, and `OpsIngest`.                |
| `assemble.ts`                  | `assembleSnapshot` (section rollup: a failed source makes its section `unknown`), `applyFreshness` (a stale snapshot is never green), and query helpers. |
| `policy.ts`                    | `OPS_POLICY` thresholds and budgets shared by the collector and renderers.                                                                               |
| `backup-policy.ts`             | Owner-published Velero monitoring annotation keys and SeaweedFS backup freshness windows.                                                                |
| `argocd-release-receipt.ts`    | Exact-operation root release receipt validation shared by the release producer and Ops collector.                                                        |
| `digest.ts`                    | Shared daily/weekly digest trigger response: period, sent/skipped status, and duplicate handling.                                                        |
| `metric-ids.ts`                | Headline metric ids that producers emit and renderers read.                                                                                              |
| `catalog.ts` + `services.json` | The service catalog. It joins namespaces, ArgoCD apps, Bugsink projects, analytics sites, Grafana dashboards, and deploy variants under one service id.  |

`services.json` is language-neutral and validated by `services.schema.json`
and `CatalogSchema`. A name may belong to only one service. The homelab
drift test requires every ArgoCD Application to belong to exactly one service,
and this package's tests require the same of every analytics site and registered
first-party image. The `images` entries use image registry base names;
`charts` adds ownership for packaged charts without an active Application.
Charts sharing an existing `argoApps` name inherit that service owner.
`ServiceIndex.byImage` resolves build outputs without guessing from package or
Application names. Delivery records release selections separately in PostgreSQL.

`bootstrapImages` references another service's canonical image without taking
ownership of its artifacts. Legacy shared image pins remain owned until every
consumer Application transfers. The Delivery execution control plane owns its
separate chart/Application while its runtime image remains a Temporal output.
`static-release-targets.ts` gives CI and homelab registration the same reviewed
bucket-to-environment ownership, with no selected archive versions.

`ServiceIndex.rootReleaseCharts()` derives the active first-party root inventory
from these owners. `rootReleaseExclusions` identifies upstream and inactive
charts explicitly; current Delivery delegations are excluded as well. A rendered
homelab check compares this inventory with actual repository-chart Applications.
The language-neutral `platform-policy.json` preserves automatic, reviewed-plan,
operator-only and validation-only OpenTofu boundaries and their release ordering.
Its policy is shared by Delivery and the existing infrastructure tooling; it
contains no selected artifact, environment version or deployment result.

Prepared services still own their declared inventory. The launcher has no
`deploy` variant while its chart renders no workload and its image pin is an
unpublished bootstrap marker. Its prepared chart has an inactive marker and no
ArgoCD Application. Register its Application and deploy variant during activation.

`temporal` is a separate source feeding Maintenance. Schedule health uses
scheduled occurrence order and described Workflow outcomes: a running successor
does not clear a terminal failure, while a later completed occurrence does.
Missing, expired, or stale execution evidence is unknown. Consumers must accept
the source enum before deploying the patched collector Workflow.

Velero freshness uses the monitoring annotations declared on each Schedule.
Its `status.lastBackup` describes a created backup and is never completion proof.
Missing successful-backup telemetry is unknown, including a new Schedule during
its initial grace window; paused schedules are explicitly informational.
The Maintenance collector also reads persisted Velero Backup resources: a failed,
invalid, or partially failed latest terminal backup remains an issue until a
later backup completes. Controller-startup aborts can bypass Velero counters,
so counter-based freshness alone does not establish a successful outcome.

Informational signals and metrics remain visible in section summaries. They do
not require attention, but are not described as an all-clear section.

A verified root-release receipt exempts only the matching CI-owned prune
termination from failed-operation severity. It must match request and operation
UUIDs, revision, timestamps, initiator and successful resource results. Current
health and sync status remain independent signals; a later or manual operation
cannot inherit the receipt.

```bash
bunx turbo run typecheck test lint --filter=@shepherdjerred/ops-model
```
