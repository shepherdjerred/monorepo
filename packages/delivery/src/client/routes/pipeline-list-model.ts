import type {
  BuildView,
  HubService,
  PipelineStatus,
} from "#shared/hub/hub-contract.ts";
import type { PipelineSearch } from "./search-schemas.ts";

/**
 * When any environment of the pipeline last saw a deployment move: the
 * newest of each environment's newest deployment, finished or requested.
 * Deployments of an older build or a composed release count, so a pipeline
 * whose build is a month old still reads as deployed minutes ago. Null when
 * no environment has a deployment.
 */
export function lastDeployment(pipeline: HubService): string | null {
  return (
    pipeline.environments
      .flatMap((environment) =>
        environment.lastDeploymentAt == null
          ? []
          : [environment.lastDeploymentAt],
      )
      .toSorted()
      .at(-1) ?? null
  );
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
  search: Pick<PipelineSearch, "q"> & { status?: PipelineStatus | undefined },
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
