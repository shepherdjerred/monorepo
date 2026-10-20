import type { WoodpeckerPipelineDetail } from "@shepherdjerred/ops-clients/woodpecker.ts";
import { ciStage, woodpeckerStatus } from "#domain/ci-stage-classification.ts";
import { CiRunSchema } from "#shared/hub/integration-contract.ts";
import type { CiRun } from "#shared/hub/integration-contract.ts";

const TERMINAL = new Set(["succeeded", "failed", "canceled", "not_started"]);

/** Map a Woodpecker pipeline into the hub CI run; order workflows by pid. */
export function ciRun(pipeline: WoodpeckerPipelineDetail): CiRun {
  return CiRunSchema.parse({
    number: pipeline.number,
    status: woodpeckerStatus(pipeline.status),
    event: pipeline.event,
    branch: pipeline.branch,
    author: pipeline.author,
    message: pipeline.message,
    createdAt: pipeline.createdAt,
    startedAt: pipeline.startedAt ?? null,
    finishedAt: pipeline.finishedAt ?? null,
    url: pipeline.url,
    workflows: pipeline.workflows
      .toSorted((left, right) => left.pid - right.pid)
      .map((workflow) => ({
        pid: workflow.pid,
        name: workflow.name,
        stage: ciStage(workflow.name),
        status: woodpeckerStatus(workflow.state),
        startedAt: workflow.startedAt ?? null,
        finishedAt: workflow.finishedAt ?? null,
        steps: workflow.steps
          .toSorted((left, right) => left.pid - right.pid)
          .map((step) => ({
            pid: step.pid,
            name: step.name,
            status: woodpeckerStatus(step.state),
            exitCode: step.exitCode,
            startedAt: step.startedAt ?? null,
            finishedAt: step.finishedAt ?? null,
            url: step.url,
          })),
      })),
  });
}

/** A finished pipeline never changes again, so its snapshot is final. */
export function isFinalRun(run: CiRun) {
  return TERMINAL.has(run.status) && run.finishedAt !== null;
}
