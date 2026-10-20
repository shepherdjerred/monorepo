import { queryOptions } from "@tanstack/react-query";
import type {
  ActivityQuery,
  BuildListQuery,
  DeploymentListQuery,
} from "#shared/hub/hub-contract.ts";
import { delivery, hub } from "./api.ts";

/** A running CI pipeline is not a Delivery change, so it is polled. */
const RUNNING_CI_POLL_MS = 10_000;

export const queries = {
  identity: () =>
    queryOptions({
      queryKey: ["identity"],
      queryFn: () => delivery.identity(),
      staleTime: Infinity,
    }),
  hub: () => queryOptions({ queryKey: ["hub"], queryFn: () => hub.hub() }),
  pipeline: (serviceId: string) =>
    queryOptions({
      queryKey: ["service", serviceId, "pipeline"],
      queryFn: () => hub.pipeline(serviceId),
    }),
  executions: (serviceId: string, cursor: string | undefined) =>
    queryOptions({
      queryKey: ["service", serviceId, "executions", cursor ?? null],
      queryFn: () => hub.executions(serviceId, cursor),
    }),
  buildTrace: (buildId: string) =>
    queryOptions({
      queryKey: ["trace", "build", buildId],
      queryFn: () => hub.buildTrace(buildId),
    }),
  versionTrace: (versionSetId: string) =>
    queryOptions({
      queryKey: ["trace", "version", versionSetId],
      queryFn: () => hub.versionTrace(versionSetId),
    }),
  ci: (buildId: string) =>
    queryOptions({
      queryKey: ["integration", "ci", buildId],
      queryFn: () => hub.ci(buildId),
      refetchInterval: (query) =>
        query.state.data?.state === "available" &&
        ["running", "pending"].includes(query.state.data.data.status)
          ? RUNNING_CI_POLL_MS
          : false,
    }),
  source: (buildId: string) =>
    queryOptions({
      queryKey: ["integration", "source", buildId],
      queryFn: () => hub.source(buildId),
    }),
  runtime: (environmentId: string) =>
    queryOptions({
      queryKey: ["integration", "runtime", environmentId],
      queryFn: () => hub.runtime(environmentId),
    }),
  deployment: (deploymentId: string) =>
    queryOptions({
      queryKey: ["deployment", deploymentId],
      queryFn: () => delivery.deployment(deploymentId),
    }),
  deployments: (input: DeploymentListQuery) =>
    queryOptions({
      queryKey: ["deployments", input],
      queryFn: () => hub.deployments(input),
    }),
  approvals: () =>
    queryOptions({ queryKey: ["approvals"], queryFn: () => hub.approvals() }),
  activity: (input: ActivityQuery) =>
    queryOptions({
      queryKey: ["activity", input],
      queryFn: () => hub.activity(input),
    }),
  builds: (input: BuildListQuery) =>
    queryOptions({
      queryKey: ["builds", input],
      queryFn: () => hub.builds(input),
    }),
  environment: (environmentId: string) =>
    queryOptions({
      queryKey: ["environment", environmentId],
      queryFn: () => hub.environment(environmentId),
    }),
  overview: () =>
    queryOptions({
      queryKey: ["overview"],
      queryFn: () => delivery.overview(),
    }),
  versions: (serviceId: string) =>
    queryOptions({
      queryKey: ["versions", serviceId],
      queryFn: () => delivery.versions(serviceId),
    }),
};
