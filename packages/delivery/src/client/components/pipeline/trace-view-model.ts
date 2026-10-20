import type {
  BuildView,
  ExecutionTrace,
  PipelineAction,
  PipelineStage,
  PipelineStatus,
  TraceDeployment,
} from "#shared/hub/hub-contract.ts";
import { githubCommitLink } from "@shepherdjerred/ops-model/tool-links.ts";

export function buildPipelineStatus(
  status: BuildView["status"],
): PipelineStatus {
  switch (status) {
    case "verified": {
      return "succeeded";
    }
    case "failed": {
      return "failed";
    }
    case "pending": {
      return "pending";
    }
  }
}

function deploymentAction(deployment: TraceDeployment): PipelineAction {
  return {
    key: deployment.id,
    title: deployment.kind,
    status: deployment.status,
    detail: deployment.message ?? `Requested by ${deployment.requestedBy}`,
    startedAt: deployment.startedAt ?? deployment.createdAt,
    finishedAt: deployment.finishedAt,
    target: { kind: "deployment", id: deployment.id },
    links: deployment.links,
  };
}

function stageActions(deployment: TraceDeployment): PipelineAction[] {
  return deployment.stages.map((stage) => ({
    key: `${deployment.id}:${stage.key}`,
    title: stage.key,
    status: stage.status,
    detail: stage.message === "" ? null : stage.message,
    startedAt: stage.startedAt,
    finishedAt: stage.status === "running" ? null : stage.updatedAt,
    target: { kind: "deployment", id: deployment.id },
    links: [],
  }));
}

/** One change's journey: its source, build, version set, then environments. */
export function traceStages(trace: ExecutionTrace): PipelineStage[] {
  const build = trace.build;
  const execution = {
    buildId: build?.id ?? null,
    versionSetId: trace.versionSet?.id ?? null,
    revision: trace.versionSet?.revision ?? null,
    sourceRevision: build?.sourceRevision ?? null,
  };
  const stages: PipelineStage[] = [];
  if (build !== null) {
    stages.push(
      {
        key: "source",
        kind: "source",
        title: "Source",
        status: "succeeded",
        execution,
        environmentId: null,
        transition: null,
        actions: [
          {
            key: "commit",
            title: `Commit ${build.sourceRevision.slice(0, 7)}`,
            status: "succeeded",
            detail: build.sourceKind,
            startedAt: null,
            finishedAt: build.createdAt,
            target: null,
            links:
              build.sourceKind === "ci"
                ? [githubCommitLink(build.sourceRevision)]
                : [],
          },
        ],
      },
      {
        key: "build",
        kind: "build",
        title: "Build",
        status: buildPipelineStatus(build.status),
        execution,
        environmentId: null,
        transition: null,
        actions: [
          {
            key: "qualification",
            title:
              build.pipelineNumber === null
                ? "Qualification"
                : `Woodpecker #${String(build.pipelineNumber)}`,
            status: buildPipelineStatus(build.status),
            detail: build.qualificationReason,
            startedAt: null,
            finishedAt: build.createdAt,
            target: null,
            links: build.links,
          },
        ],
      },
    );
  }
  stages.push({
    key: "version",
    kind: "version",
    title: "Version set",
    status: trace.versionSet === null ? "not_started" : "succeeded",
    execution,
    environmentId: null,
    transition: null,
    actions: Object.values(trace.versionSet?.components ?? {}).map(
      (artifact) => ({
        key: artifact.component,
        title: artifact.component,
        status: "succeeded",
        detail: artifact.version,
        startedAt: null,
        finishedAt: artifact.createdAt,
        target: null,
        links: [],
      }),
    ),
  });
  for (const environment of trace.environments) {
    const deployments = trace.deployments.filter(
      (deployment) => deployment.environmentId === environment.id,
    );
    const latest = deployments.at(-1);
    stages.push({
      key: `environment:${environment.id}`,
      kind: "environment",
      title: environment.name,
      status: latest?.status ?? "not_started",
      execution,
      environmentId: environment.id,
      transition: null,
      actions:
        latest === undefined
          ? []
          : [
              ...deployments.map((deployment) => deploymentAction(deployment)),
              ...stageActions(latest),
            ],
    });
  }
  return stages;
}
