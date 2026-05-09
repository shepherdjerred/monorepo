import { workflowOutcomeTotal } from "#observability/metrics.ts";

export type WorkflowOutcome = "executed" | "skipped";

export type OutcomeRecord = {
  workflow: string;
  outcome: WorkflowOutcome;
  reason: string;
};

// Bumps `temporal_workflow_outcome_total{workflow,outcome,reason}` so dashboards
// can distinguish runs that actually performed their side effects from runs
// that gated out (e.g. vacuum: anyone home → skip). Cheap; no I/O beyond the
// in-process Prometheus registry.
export const outcomeActivities = {
  async recordWorkflowOutcome(record: OutcomeRecord): Promise<void> {
    workflowOutcomeTotal.inc({
      workflow: record.workflow,
      outcome: record.outcome,
      reason: record.reason,
    });
    await Promise.resolve();
  },
};

export type OutcomeActivities = typeof outcomeActivities;
