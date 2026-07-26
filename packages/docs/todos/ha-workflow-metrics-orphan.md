---
id: ha-workflow-metrics-orphan
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: packages/docs/plans/2026-07-25_roborock-saros-fleet-migration.md
---

# Dead `ha_workflow_*` Prometheus metric family — orphaned alerts + dashboard

The `ha_workflow_*` metric family (`ha_workflow_executions_total`,
`ha_workflow_last_execution_timestamp`, `ha_workflow_last_success_timestamp_max`,
`ha_workflows_in_progress`, `ha_workflow_errors_total`,
`ha_workflow_duration_seconds_bucket`) was emitted by the **pre-Temporal** standalone
HA automation app. That app is gone; the Temporal worker now emits
`temporal_workflow_outcome_total` plus the standard SDK `temporal_*` /
`activity_task_fail` metrics (`src/observability/metrics.ts`). Nothing in the repo
produces `ha_workflow_*` anymore, so every rule/panel keyed on it is dead (fires
never / shows no data).

Discovered during the Roborock Saros fleet migration (2026-07-25), which removed the
two **vacuum-specific** dead rules (`HaRoombaVerificationFailed`,
`HaVacuumWorkflowMissing`). The rest of the family is non-vacuum and was left in place
as out of scope for that change.

## Remaining

- [ ] Audit `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/ha-workflows.ts`
      — every rule keys on `ha_workflow_*` (`HaWorkflowFailed`, `HaWorkflowTimeout`,
      `HaDscVerificationFailed`, `HaWorkflowHighFailureRate`, `HaWorkflowSlowExecution`,
      `HaGoodMorningWorkflowMissing`, `HaWorkflowStuck`, `HaApplicationDown`). Decide
      per rule: delete, or re-express against the live `temporal_workflow_outcome_total`
      / `activity_task_fail` signals. Note `temporal.ts` already covers the
      check-and-skip "never executed" case via `TemporalCheckAndSkipNeverExecuted`.
- [ ] Same for `packages/homelab/src/cdk8s/grafana/ha-workflow-dashboard.ts` — repoint
      or retire the panels.
- [ ] Confirm no Alertmanager/PagerDuty routing depends on the removed alert names.
