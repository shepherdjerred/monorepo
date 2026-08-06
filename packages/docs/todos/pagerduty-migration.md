---
id: pagerduty-migration
type: todo
status: in-progress
board: true
verification: agent
disposition: active
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

## Remaining

- [ ] Select the replacement and record how it provides Alertmanager delivery,
      escalation/on-call ownership, acknowledgement, and incident queries.
- [ ] Migrate or retire each of the seven inventoried integrations with tests or
      rendered configuration proving the replacement path.
- [ ] Verify a test alert reaches the replacement and can be queried by the
      toolkit/dashboard consumers before removing PagerDuty routing.
- [ ] Remove PagerDuty credentials and resources from code and 1Password only
      after the replacement has carried production alerts successfully.

## Related

- [PagerDuty Velero alert formatting](../archive/completed/pagerduty-velero-alert-formatting.md)
  is production-verified; preserve its title and Custom Details behavior in any
  replacement platform.

## Comment Log

### 2026-07-27 — board audit reconciliation

- Consolidated the Postal/Alertmanager design from the superseded migration plan here; this TODO is the sole active owner for removing all current PagerDuty integrations.
- Current-tree audit found the Alertmanager receiver, toolkit handler, Temporal
  audit input, worker secret, TRMNL client, and helper surface still present;
  this remains genuine migration work.
