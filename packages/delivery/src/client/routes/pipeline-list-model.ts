import type { ExecutionSummary, HubService } from "#shared/hub/hub-contract.ts";
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

/** Pipelines whose name or id contains the query and whose newest run matches. */
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
        (pipeline.latestExecution?.status ?? "not_started") === search.status),
  );
}
