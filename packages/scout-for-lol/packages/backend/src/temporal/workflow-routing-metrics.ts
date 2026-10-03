import type { Client } from "@temporalio/client";
import { z } from "zod";
import {
  scoutWorkflowRoutingKnown,
  scoutWorkflowRoutingTimestamp,
  scoutWorkflowRoutedVersion,
} from "#src/metrics/platform/workflow-routing.ts";
import { registerDatabaseMetricSweep } from "#src/metrics/sweep-registry.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("workflow-routing-metrics");
const VersionSchema = z.object({
  deploymentName: z.literal("scout-beta-workflows"),
  buildId: z.string().regex(/^[a-f0-9]{40}$/),
});
const RoutingResponseSchema = z.object({
  workerDeploymentInfo: z.object({
    name: z.literal("scout-beta-workflows"),
    routingConfig: z.object({
      currentDeploymentVersion: VersionSchema,
      rampingDeploymentVersion: VersionSchema.nullish(),
      rampingVersionPercentage: z.number().min(0).max(100).default(0),
    }),
  }),
});

export function routedWorkflowVersions(response: unknown) {
  const { routingConfig } =
    RoutingResponseSchema.parse(response).workerDeploymentInfo;
  const current = routingConfig.currentDeploymentVersion;
  const versions = [{ ...current, routing: "current", percentage: 100 }];
  if (routingConfig.rampingVersionPercentage > 0) {
    const ramp = VersionSchema.parse(routingConfig.rampingDeploymentVersion);
    if (ramp.buildId === current.buildId) {
      throw new Error("Current and ramp Workflow builds must differ");
    }
    versions.push({
      ...ramp,
      routing: "ramp",
      percentage: routingConfig.rampingVersionPercentage,
    });
  }
  return versions;
}

/** Bounded read on the existing connection, once per application metrics scrape. */
export async function collectWorkflowRouting(
  readRouting: () => Promise<unknown>,
): Promise<void> {
  scoutWorkflowRoutedVersion.reset();
  scoutWorkflowRoutingKnown.set(0);
  try {
    const response = await readRouting();
    const versions = routedWorkflowVersions(response);
    for (const version of versions) {
      scoutWorkflowRoutedVersion.set(
        {
          temporal_namespace: "beta",
          worker_deployment_name: version.deploymentName,
          worker_build_id: version.buildId,
          routing: version.routing,
        },
        version.percentage,
      );
    }
    scoutWorkflowRoutingTimestamp.set(Date.now() / 1000);
    scoutWorkflowRoutingKnown.set(1);
  } catch (error) {
    logger.warn("Workflow routing evidence unavailable", error);
  }
}

export function registerWorkflowRoutingMetrics(
  client: () => Client | undefined,
): void {
  registerDatabaseMetricSweep("workflow-routing", () =>
    collectWorkflowRouting(async () => {
      const connected = client();
      if (connected?.options.namespace !== "beta") {
        throw new Error("Beta Temporal routing connection unavailable");
      }
      return await connected.connection.withDeadline(Date.now() + 3000, () =>
        connected.workflowService.describeWorkerDeployment({
          namespace: "beta",
          deploymentName: "scout-beta-workflows",
        }),
      );
    }),
  );
}
