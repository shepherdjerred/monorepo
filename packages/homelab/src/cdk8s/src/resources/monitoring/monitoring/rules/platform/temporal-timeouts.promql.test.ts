import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { getTemporalRuleGroups } from "./temporal.ts";

test("ScheduleToStart alerts distinguish Activity and Workflow Task operations", async () => {
  const rules = new Map(
    getTemporalRuleGroups().flatMap((group) =>
      (group.rules ?? []).map((rule) => [rule.alert, rule.expr.value] as const),
    ),
  );
  const activity = rules.get("TemporalActivitiesNeverStarting");
  const workflow = rules.get("TemporalWorkflowTasksNeverStarting");
  if (typeof activity !== "string" || typeof workflow !== "string") {
    throw new TypeError("Missing Temporal timeout rule expressions");
  }
  const directory = await mkdtemp(path.join(tmpdir(), "temporal-timeouts-"));
  try {
    const filename = path.join(directory, "tests.json");
    await Bun.write(
      filename,
      JSON.stringify({
        evaluation_interval: "1m",
        tests: [
          { operations: ["WorkflowTask"], activities: false, workflows: true },
          { operations: ["Activity"], activities: true, workflows: false },
          {
            operations: ["WorkflowTask", "Activity"],
            activities: true,
            workflows: true,
          },
        ].map((entry) => ({
          interval: "1m",
          input_series: entry.operations.flatMap((operation) =>
            ["prod", "dev"].map((namespace) => ({
              series: `schedule_to_start_timeout{exported_namespace="${namespace}",operation="TimerActiveTask${operation}Timeout"}`,
              values: "0+1x60",
            })),
          ),
          promql_expr_test: [
            {
              expr: `count(${activity})`,
              eval_time: "30m",
              exp_samples: entry.activities ? [{ labels: "{}", value: 1 }] : [],
            },
            {
              expr: `count(${workflow})`,
              eval_time: "30m",
              exp_samples: entry.workflows ? [{ labels: "{}", value: 1 }] : [],
            },
          ],
        })),
      }),
    );
    const process = Bun.spawn(["promtool", "test", "rules", filename], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    expect(exitCode, stdout + stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
