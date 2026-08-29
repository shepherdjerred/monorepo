import { describe, expect, test } from "vitest";
import { createTemporalDashboard } from "./temporal-dashboard.ts";

describe("Temporal dashboard", () => {
  const dashboard = JSON.stringify(createTemporalDashboard());

  test("filters traces and logs by the execution metadata dimensions", () => {
    expect(dashboard).toContain('"name":"environment"');
    expect(dashboard).toContain('"name":"domain"');
    expect(dashboard).toContain("resource.deployment.environment.name");
    expect(dashboard).toContain("resource.temporal.domain");
    expect(dashboard).toContain("deployment_environment_name");
    expect(dashboard).toContain("temporal_domain");
  });

  test("links the dashboard, logs, and traces to native diagnostic surfaces", () => {
    expect(dashboard).toContain("Temporal UI");
    expect(dashboard).toContain("Tempo Explore");
    expect(dashboard).toContain("Loki Explore");
    expect(dashboard).toContain("Trace in Tempo");
    expect(decodeURIComponent(dashboard)).toContain(
      "${__data.fields.trace_id}",
    );
  });

  test("covers schedule delay, Workflow Task failures, and retry exhaustion", () => {
    expect(dashboard).toContain("schedule_action_delay_bucket");
    expect(dashboard).toContain(
      "temporal_worker_workflow_task_execution_failed",
    );
    expect(dashboard).toContain("activity_fail");
    expect(dashboard).toContain("Schedule to Workflow to Activity traces");
  });
});
