import { z } from "zod";
import { DeploymentSchema } from "#shared/contract.ts";
import {
  ActivityPageSchema,
  BuildPageSchema,
  DeploymentPageSchema,
  EnvironmentDetailSchema,
  ExecutionPageSchema,
  ExecutionTraceSchema,
  HubOverviewSchema,
  ServicePipelineSchema,
} from "#shared/hub/hub-contract.ts";
import type {
  ActivityQuery,
  BuildListQuery,
  DeploymentListQuery,
} from "#shared/hub/hub-contract.ts";
import {
  ArgoRuntimeIntegrationSchema,
  CiRunIntegrationSchema,
  SourceChangeIntegrationSchema,
} from "#shared/hub/integration-contract.ts";
import {
  createRequester,
  query,
  type RequestOptions,
} from "#shared/http-request.ts";

const segment = (value: string) => encodeURIComponent(value);

/** Reads behind the browser hub. */
export function createHubClient(options: RequestOptions) {
  const request = createRequester(options);
  return {
    hub: () => request("/hub", HubOverviewSchema),
    pipeline: (serviceId: string) =>
      request(
        `/services/${segment(serviceId)}/pipeline`,
        ServicePipelineSchema,
      ),
    executions: (serviceId: string, cursor?: string) =>
      request(
        `/services/${segment(serviceId)}/executions${query({ cursor })}`,
        ExecutionPageSchema,
      ),
    buildTrace: (buildId: string) =>
      request(`/builds/${segment(buildId)}`, ExecutionTraceSchema),
    versionTrace: (versionSetId: string) =>
      request(`/versions/${segment(versionSetId)}/trace`, ExecutionTraceSchema),
    ci: (buildId: string) =>
      request(`/builds/${segment(buildId)}/ci`, CiRunIntegrationSchema),
    source: (buildId: string) =>
      request(
        `/builds/${segment(buildId)}/source`,
        SourceChangeIntegrationSchema,
      ),
    runtime: (environmentId: string) =>
      request(
        `/environments/${segment(environmentId)}/runtime`,
        ArgoRuntimeIntegrationSchema,
      ),
    environment: (environmentId: string) =>
      request(
        `/environments/${segment(environmentId)}`,
        EnvironmentDetailSchema,
      ),
    deployments: (input: DeploymentListQuery) =>
      request(`/deployments${query(input)}`, DeploymentPageSchema),
    builds: (input: BuildListQuery) =>
      request(`/builds${query(input)}`, BuildPageSchema),
    approvals: () => request("/approvals", z.array(DeploymentSchema)),
    activity: (input: ActivityQuery) =>
      request(`/activity${query(input)}`, ActivityPageSchema),
  };
}
export type HubClient = ReturnType<typeof createHubClient>;
