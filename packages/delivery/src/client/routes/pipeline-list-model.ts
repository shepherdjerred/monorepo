import type {
  BuildView,
  ExecutionSummary,
  HubService,
  PipelineStatus,
} from "#shared/hub/hub-contract.ts";
import type { PipelineSearch } from "./search-schemas.ts";

/** The newest moment anything in the execution started or finished. */
export function lastExecuted(execution: ExecutionSummary): string {
  const moments = [
    execution.createdAt,
    ...execution.deployments.map(
      (deployment) => deployment.finishedAt ?? deployment.createdAt,
    ),
  ];
  return moments.toSorted().at(-1) ?? execution.createdAt;
}

/** A CI run's result in the pipeline vocabulary: a verified build passed. */
export function ciStatus(build: BuildView): PipelineStatus {
  return build.status === "verified" ? "succeeded" : build.status;
}

/**
 * Every stage's current status: the newest CI run, then each environment's
 * newest deployment. A pipeline with neither has not started.
 */
export function stageStatuses(pipeline: HubService): PipelineStatus[] {
  const statuses = [
    ...(pipeline.latestBuild === null ? [] : [ciStatus(pipeline.latestBuild)]),
    ...pipeline.environments.map((environment) => environment.status),
  ];
  return statuses.length === 0 ? ["not_started"] : statuses;
}

/** Pipelines whose name or id contains the query and with a stage in the chosen status. */
export function filterPipelines(
  pipelines: HubService[],
  search: PipelineSearch,
): HubService[] {
  const query = search.q?.toLowerCase();
  return pipelines.filter(
    (pipeline) =>
      (query === undefined ||
        pipeline.title.toLowerCase().includes(query) ||
        pipeline.id.includes(query)) &&
      (search.status === undefined ||
        stageStatuses(pipeline).includes(search.status)),
  );
}
