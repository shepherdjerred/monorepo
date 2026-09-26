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
| `metric-ids.ts`                | Headline metric ids that producers emit and renderers read.                                                                                              |
| `catalog.ts` + `services.json` | The service catalog. It joins namespaces, ArgoCD apps, Bugsink projects, analytics sites, Grafana dashboards, and deploy variants under one service id.  |

`services.json` is language-neutral and validated by `services.schema.json`
and `CatalogSchema`. A name may belong to only one service. The homelab
drift test requires every ArgoCD Application to belong to exactly one service,
and this package's test requires the same of every analytics site.

```bash
bunx turbo run typecheck test lint --filter=@shepherdjerred/ops-model
```
