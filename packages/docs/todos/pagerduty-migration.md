---
id: pagerduty-migration
status: active
origin: packages/docs/logs/2026-06-13_new-todos-batch.md
source_marker: false
---

# Migrate off PagerDuty to another alerting/on-call platform

## What

Move alerting + on-call + incident querying off PagerDuty. Candidates: Grafana
OnCall (we already run Grafana), Opsgenie, or a self-hosted webhook flow (the
Sentinel POC already handles incident webhooks).

## Integration points to migrate

| #   | Surface                                                          | Path                                                                                  |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | Alertmanager PagerDuty receiver + routing (critical/warning)     | `packages/homelab/src/cdk8s/src/resources/argo-applications/prometheus.ts` (~184–274) |
| 2   | Toolkit CLI (`toolkit pd incidents` / `incident <id>`)           | `packages/toolkit/src/handlers/pagerduty.ts`                                          |
| 3   | Homelab audit incident summary                                   | `packages/temporal/src/activities/homelab-audit-prompts.ts`                           |
| 4   | Temporal worker `PAGERDUTY_TOKEN` injection                      | `packages/homelab/src/cdk8s/src/resources/temporal/worker.ts`                         |
| 5   | TRMNL dashboard incident/on-call widget                          | `packages/trmnl-dashboard/src/clients/pagerduty.ts`                                   |
| 6   | Sentinel POC webhook + triager                                   | `poc/sentinel/src/adapters/webhook.ts`, `poc/sentinel/src/agents/pd-triager.ts`       |
| 7   | `pagerduty-helper` skill + `PAGERDUTY_TOKEN` secret in 1Password | skill dir; secret resource in `prometheus.ts`                                         |

## Why it's open

PagerDuty is wired into alert routing, the CLI, a Temporal activity (homelab
audit), the TRMNL dashboard, and a POC. A migration must replace each
integration, not just the Alertmanager receiver.

## Done when

- Alert routing, on-call schedules/escalation, and incident query are all served
  by the chosen platform.
- All 7 integration points above migrated (or retired). (An 8th, the Temporal
  alert-remediation incident collection, was retired outright — the workflow was
  removed; see logs/2026-07-02_gut-alert-remediation.md.)
- PagerDuty decommissioned and its token removed from 1Password.

## Related

- [pagerduty-velero-alert-formatting.md](pagerduty-velero-alert-formatting.md)
  — fold into / re-validate against the new platform's templating.
