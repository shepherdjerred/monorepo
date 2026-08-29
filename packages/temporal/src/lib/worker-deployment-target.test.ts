import { describe, expect, test } from "vitest";
import { resolveWorkerDeploymentRolloutTarget } from "./worker-deployment-target.ts";

describe("resolveWorkerDeploymentRolloutTarget", () => {
  test("maps the central target", () => {
    expect(
      resolveWorkerDeploymentRolloutTarget("central", "temporal:7233"),
    ).toMatchObject({
      deploymentName: "monorepo-central-workflows",
      taskQueue: "monorepo-workflows",
    });
  });

  test.each(["beta", "prod"] as const)("maps Scout %s", (stage) => {
    expect(
      resolveWorkerDeploymentRolloutTarget(`scout-${stage}`, "temporal:7233"),
    ).toMatchObject({
      deploymentName: `scout-${stage}-workflows`,
      taskQueue: `scout-${stage}`,
      candidatePinName: `shepherdjerred/scout-for-lol/${stage}/workflows/candidate`,
      stablePinName: `shepherdjerred/scout-for-lol/${stage}/workflows/stable`,
      canaryCommand: expect.arrayContaining([
        "--stage",
        stage,
        "--address",
        "temporal:7233",
      ]),
    });
  });

  test("requires Scout beta acceptance for the production target", () => {
    expect(
      resolveWorkerDeploymentRolloutTarget("scout-prod", "temporal:7233"),
    ).toMatchObject({
      acceptancePrerequisite: {
        deploymentName: "scout-beta-workflows",
        taskQueue: "scout-beta",
      },
    });
    expect(
      resolveWorkerDeploymentRolloutTarget("scout-beta", "temporal:7233"),
    ).not.toHaveProperty("acceptancePrerequisite");
  });

  test("rejects an unknown target", () => {
    expect(() =>
      resolveWorkerDeploymentRolloutTarget("scout-dev", "temporal:7233"),
    ).toThrow();
  });
});
