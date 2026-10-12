import { describe, expect, test } from "vitest";
import {
  collectWorkflowRouting,
  routedWorkflowVersions,
} from "#src/temporal/workflow-routing-metrics.ts";
import {
  scoutWorkflowRoutingKnown,
  scoutWorkflowRoutedVersion,
} from "#src/metrics/platform/workflow-routing.ts";

const current = {
  deploymentName: "scout-beta-workflows",
  buildId: "a".repeat(40),
};
const ramp = { ...current, buildId: "b".repeat(40) };
function response(routingConfig: Record<string, unknown>) {
  return {
    workerDeploymentInfo: { name: current.deploymentName, routingConfig },
  };
}

describe("Workflow routing evidence", () => {
  test("uses only the routed current build, ignoring unrouted candidates", () => {
    expect(
      routedWorkflowVersions(response({ currentDeploymentVersion: current })),
    ).toEqual([{ ...current, routing: "current", percentage: 100 }]);
  });
  test.each([1, 50, 100])(
    "requires current and nonzero %s%% ramp",
    (percentage) => {
      expect(
        routedWorkflowVersions(
          response({
            currentDeploymentVersion: current,
            rampingDeploymentVersion: ramp,
            rampingVersionPercentage: percentage,
          }),
        ),
      ).toEqual([
        { ...current, routing: "current", percentage: 100 },
        { ...ramp, routing: "ramp", percentage },
      ]);
    },
  );
  test("zero ramp imposes no candidate requirement", () => {
    expect(
      routedWorkflowVersions(
        response({
          currentDeploymentVersion: current,
          rampingDeploymentVersion: ramp,
          rampingVersionPercentage: 0,
        }),
      ),
    ).toHaveLength(1);
  });
  test.each([
    {},
    { currentDeploymentVersion: { ...current, deploymentName: "other" } },
    { currentDeploymentVersion: current, rampingVersionPercentage: 10 },
    {
      currentDeploymentVersion: current,
      rampingDeploymentVersion: current,
      rampingVersionPercentage: 10,
    },
    { currentDeploymentVersion: current, rampingVersionPercentage: 101 },
  ])("rejects unknown or invalid routing %j", (config) => {
    expect(() => routedWorkflowVersions(response(config))).toThrow();
  });
  test("lookup failure clears prior routing and marks evidence unknown", async () => {
    await collectWorkflowRouting(async () =>
      response({ currentDeploymentVersion: current }),
    );
    const initialKnown = await scoutWorkflowRoutingKnown.get();
    const initialVersions = await scoutWorkflowRoutedVersion.get();
    expect(initialKnown.values[0]?.value).toBe(1);
    expect(initialVersions.values).toHaveLength(1);
    await collectWorkflowRouting(async () => {
      throw new Error("lookup unavailable");
    });
    const failedKnown = await scoutWorkflowRoutingKnown.get();
    const failedVersions = await scoutWorkflowRoutedVersion.get();
    expect(failedKnown.values[0]?.value).toBe(0);
    expect(failedVersions.values).toEqual([]);
    await collectWorkflowRouting(async () =>
      response({ currentDeploymentVersion: ramp }),
    );
    const recoveredVersions = await scoutWorkflowRoutedVersion.get();
    expect(recoveredVersions.values[0]?.labels.worker_build_id).toBe(
      ramp.buildId,
    );
  });
});
