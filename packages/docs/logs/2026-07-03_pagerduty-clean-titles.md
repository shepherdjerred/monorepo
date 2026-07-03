# PagerDuty — clean, correct incident titles

## Status

In Progress (code complete; awaiting deploy + live verification)

## Context

Audited PagerDuty incidents over the last 30 and then 365 days (all on the
**Homelab** service). ~5,900 incidents in the trailing year; every one is
`urgency=high`, `service=Homelab`, `escalation_policy=Default`,
`incident_type=incident_default`. The complaint: incidents show up in PagerDuty
unreadably.

### What the data showed (year, 5,886 incidents)

Title-defect timeline (by month) established that several defects were **already
fixed** and should not be touched:

- **Literal `\n`** (two-char escape) polluted ~100% of titles Jan–May 2026, then
  dropped 1186 → 10 → 0 in June. Fixed (real-newline change, see
  [2026-05-30 velero log](2026-05-30_pagerduty-velero-duplicate-alerts.md)).
- **`[FIRING:N]` raw default template** — 142 (Sep) then 87 (Dec), gone since.
- Noisy kube-prometheus defaults the team silenced and that **worked**:
  `NodeMemoryMajorPagesFaults` (→0 after Feb), CPU throttling (→0 after Dec),
  context switches (→0 after Jan). Verified the `→null` route at
  `prometheus.ts` is correct.

Still-live presentation defects (the target of this change):

| Defect                                                                       | Year count               | Cause                                                    |
| ---------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------- |
| Multi-line blob title truncated at 1024 chars                                | 243 (93 in Jun, growing) | title = full per-alert body, ranged over the whole group |
| `title == description` (redundant)                                           | 5886 (100%)              | receiver set only `description`                          |
| Metadata all dead (`priority`/`teams`/`incident_key`/`custom_details` empty) | 100%                     | receiver sent no structured fields                       |
| Blank-label leaks (`Device  ()`, `on cluster .`)                             | ~407                     | rule annotations interpolate absent labels               |
| Float noise (`35172.200000000004/s`)                                         | 350                      | rule annotations don't round                             |

The root cause of the unreadable titles is a **single receiver template**
(`prometheus.ts`, alertmanager `pagerduty_configs[0].description`):

```
{{ range .Alerts }}{{ .Annotations.summary }}{{ if .Labels.namespace }} ({{ .Labels.namespace }}){{ end }}: {{ if .Annotations.message }}{{ .Annotations.message }}{{ else }}{{ .Annotations.description }}{{ end }}\n{{ end }}
```

It ranges over every alert in the group and dumps each alert's full multi-line
body into the PagerDuty **title**, which PagerDuty then truncates mid-word.

## Change

Rewrote the `pagerduty_configs` receiver
(`src/cdk8s/src/resources/argo-applications/prometheus.ts`):

- **Title (`description`)** → one clean line: shared `CommonAnnotations.summary`
  (fallback `CommonLabels.alertname`) + `[namespace]` + `(xN)` firing count.
  Never the per-alert body → never truncated. Stays distinguishable per
  namespace/count (the original reason the body was inlined — preserved).
- **`details`** (PagerDuty Custom Details) → `alertname`, `namespace`,
  `severity`, `num_firing`, `num_resolved`, and `firing`/`resolved` lists that
  carry each alert's `message` (fallback `description`). This is where the
  per-alert specifics now live.
- **`client`/`client_url`** → link back to Alertmanager (`{{ .ExternalURL }}`).
- **`severity`** mapping switched from `GroupLabels.severity` (empty — severity
  isn't in `group_by`, so it always fell through to `error`) to
  `CommonLabels.severity`.

### Before / after (rendered with Go `text/template`, real Alertmanager data)

| Scenario                     | Old title (len)                | New title (len)                                          |
| ---------------------------- | ------------------------------ | -------------------------------------------------------- |
| Velero 3 large PVCs (immich) | 260-char blob, 3 lines w/ `\n` | `Large PVC may impact Velero backups [immich] (x3)` (49) |
| ZFS ARC eviction, 2 hosts    | 198-char blob                  | `High ZFS ARC eviction rate detected (x2)` (40)          |
| Single crash-loop pod        | 84-char, trailing `\n`         | `Pod is crash looping. [redlib]` (30)                    |

Full per-alert detail is retained under `custom_details.firing`.

## Verification

- `bun run --filter='./packages/homelab' typecheck` — passes.
- `helm template` of the apps chart — receiver renders correctly: real newlines
  in `firing`/`resolved` block scalars, no literal `\n`, no `{{ "{{" }}` escape
  artifacts.
- `bun test src/helm-template.test.ts` (PagerDuty + apps-chart escaping) and
  `shared.test.ts` — pass. Updated the PagerDuty regression test to the new
  contract (clean title via `CommonAnnotations.summary`/`alertname`; per-alert
  `message` still surfaced, now via `{{ range .Alerts.Firing }}` in `details`;
  title no longer ranges over `.Alerts`).
- Go render harness: `scratchpad/amrender/main.go` (mirrors Alertmanager's
  template data contract).

## Out of scope (follow-ups)

- **Rule-content polish** — blank-label guards (`{{ if }}` around
  device/cluster/instance in temp/node rules) and float rounding
  (`humanize`/`printf "%.1f"`) so the `details` body is as clean as the title.
  These flow into `custom_details`, not the title, so lower priority.
- **`scout.ts` epoch duration** — "has not run for 20636d" = now − Unix epoch
  when `lastSuccessfulRun` is null; add a "never run" branch.
- **Noise/routing** — `KubeDeploymentReplicasMismatch` is the one growing
  cluster-noise source (~60–100/mo, fires on every rollout). Consider longer
  `for:` or inhibit during Argo syncs.
- **Differentiated urgency** — everything pages `high`; map critical→high,
  warning→low. Behavior change, needs owner sign-off.
