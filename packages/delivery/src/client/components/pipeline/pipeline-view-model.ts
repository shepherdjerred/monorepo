import type {
  PipelineAction,
  PipelineStage,
  PipelineStatus,
} from "#shared/hub/hub-contract.ts";
import type {
  CiRun,
  CiRunIntegration,
  CiWorkflow,
} from "#shared/hub/integration-contract.ts";

const PRIORITY: PipelineStatus[] = [
  "failed",
  "running",
  "awaiting_approval",
  "queued",
  "pending",
  "canceled",
  "succeeded",
  "not_started",
];

function rollup(statuses: PipelineStatus[]): PipelineStatus {
  return PRIORITY.find((status) => statuses.includes(status)) ?? "not_started";
}

function workflowAction(workflow: CiWorkflow, run: CiRun): PipelineAction {
  const failed = workflow.steps.find((step) => step.status === "failed");
  return {
    key: `workflow:${String(workflow.pid)}`,
    title: workflow.name,
    status: workflow.status,
    detail:
      failed === undefined
        ? `${String(workflow.steps.length)} ${workflow.steps.length === 1 ? "step" : "steps"}`
        : `Step ${failed.name} exited ${String(failed.exitCode)}`,
    startedAt: workflow.startedAt,
    finishedAt: workflow.finishedAt,
    target: null,
    links: [
      {
        kind: "woodpecker",
        label: `Woodpecker ${workflow.name}`,
        url: (failed ?? workflow.steps[0])?.url ?? run.url,
      },
    ],
  };
}

/**
 * Split the server's Build stage into Build and Test using the latest CI run.
 * Without CI enrichment the server's single Build stage stands as is.
 */
export function pipelineStages(
  stages: PipelineStage[],
  ci: CiRunIntegration | undefined,
): PipelineStage[] {
  if (ci?.state !== "available") return stages;
  const run = ci.data;
  return stages.flatMap((stage) => {
    if (stage.kind !== "build") return [stage];
    const tests = run.workflows.filter((workflow) => workflow.stage === "test");
    const builds = run.workflows.filter(
      (workflow) => workflow.stage !== "test",
    );
    const buildActions = [
      ...builds.map((workflow) => workflowAction(workflow, run)),
      ...stage.actions,
    ];
    const testActions = tests.map((workflow) => workflowAction(workflow, run));
    return [
      {
        ...stage,
        status: rollup(buildActions.map((action) => action.status)),
        actions: buildActions,
      },
      {
        ...stage,
        key: "test",
        title: "Test",
        status: rollup(testActions.map((action) => action.status)),
        actions: testActions,
      },
    ];
  });
}

/** Stage-level progress for a compact strip: counts by outcome. */
export function stageSummary(stage: PipelineStage) {
  const done = stage.actions.filter(
    (action) => action.status === "succeeded",
  ).length;
  if (stage.actions.length === 0) return "No runs yet";
  return stage.status === "succeeded"
    ? "All actions succeeded"
    : `${String(done)} of ${String(stage.actions.length)} actions succeeded`;
}
