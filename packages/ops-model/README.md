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
| `metric-ids.ts`                | Headline metric ids that producers emit and renderers read.                                                                                              |
| `catalog.ts` + `services.json` | The service catalog. It joins namespaces, ArgoCD apps, Bugsink projects, analytics sites, Grafana dashboards, and deploy variants under one service id.  |

`services.json` is language-neutral and validated by `services.schema.json`
and `CatalogSchema`. A name may belong to only one service. The homelab
drift test requires every ArgoCD Application to belong to exactly one service,
and this package's test requires the same of every analytics site.

`temporal` is a separate source feeding Maintenance. Schedule health uses
scheduled occurrence order and described Workflow outcomes: a running successor
does not clear a terminal failure, while a later completed occurrence does.
Missing, expired, or stale execution evidence is unknown. Consumers must accept
the source enum before deploying the patched collector Workflow.

Velero freshness uses the monitoring annotations declared on each Schedule.
Its `status.lastBackup` describes a created backup and is never completion proof.
Missing successful-backup telemetry is unknown, including a new Schedule during
its initial grace window; paused schedules are explicitly informational.

```bash
bunx turbo run typecheck test lint --filter=@shepherdjerred/ops-model
```
