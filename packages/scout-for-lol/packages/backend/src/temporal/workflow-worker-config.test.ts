import { describe, expect, test } from "vitest";
import { parseScoutWorkflowWorkerConfiguration } from "./workflow-worker-config.ts";

const SHA = "a".repeat(40);

describe("parseScoutWorkflowWorkerConfiguration", () => {
  test("derives the build ID from the image Git SHA", () => {
    expect(
      parseScoutWorkflowWorkerConfiguration({
        ENVIRONMENT: "beta",
        GIT_SHA: SHA,
        TEMPORAL_ADDRESS: "temporal:7233",
        TEMPORAL_WORKER_DEPLOYMENT_NAME: "scout-beta-workflows",
      }),
    ).toEqual({
      stage: "beta",
      address: "temporal:7233",
      metricsAddress: "0.0.0.0:9464",
      namespace: "default",
      deploymentName: "scout-beta-workflows",
      buildId: SHA,
    });
  });

  test("accepts an explicit exact build ID", () => {
    expect(
      parseScoutWorkflowWorkerConfiguration({
        ENVIRONMENT: "prod",
        GIT_SHA: SHA,
        TEMPORAL_ADDRESS: "temporal:7233",
        TEMPORAL_WORKER_BUILD_ID: SHA,
        TEMPORAL_WORKER_DEPLOYMENT_NAME: "scout-prod-workflows",
      }).buildId,
    ).toBe(SHA);
  });

  test("rejects a build ID that differs from the baked image Git SHA", () => {
    expect(() =>
      parseScoutWorkflowWorkerConfiguration({
        ENVIRONMENT: "prod",
        GIT_SHA: SHA,
        TEMPORAL_ADDRESS: "temporal:7233",
        TEMPORAL_WORKER_BUILD_ID: "b".repeat(40),
        TEMPORAL_WORKER_DEPLOYMENT_NAME: "scout-prod-workflows",
      }),
    ).toThrow("must match the baked GIT_SHA");
  });

  test("rejects a stage/deployment mismatch", () => {
    expect(() =>
      parseScoutWorkflowWorkerConfiguration({
        ENVIRONMENT: "beta",
        GIT_SHA: SHA,
        TEMPORAL_ADDRESS: "temporal:7233",
        TEMPORAL_WORKER_DEPLOYMENT_NAME: "scout-prod-workflows",
      }),
    ).toThrow("must use deployment scout-beta-workflows");
  });

  test("rejects a non-exact image Git SHA", () => {
    expect(() =>
      parseScoutWorkflowWorkerConfiguration({
        ENVIRONMENT: "beta",
        GIT_SHA: "unknown",
        TEMPORAL_ADDRESS: "temporal:7233",
        TEMPORAL_WORKER_DEPLOYMENT_NAME: "scout-beta-workflows",
      }),
    ).toThrow("exact lowercase Git SHA");
  });
});
