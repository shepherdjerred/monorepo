import { describe, expect, test } from "vitest";
import {
  parseTemporalBootstrap,
  requireWorkerDeployment,
} from "./temporal-bootstrap.ts";

const SHA = "a".repeat(40);

describe("Temporal bootstrap configuration", () => {
  test("keeps the current default namespace without enabling versioning", () => {
    expect(parseTemporalBootstrap({})).toEqual({
      namespace: "default",
      workerDeployment: undefined,
    });
  });

  test("parses an exact deployment identity", () => {
    expect(
      parseTemporalBootstrap({
        TEMPORAL_NAMESPACE: "beta",
        TEMPORAL_WORKER_DEPLOYMENT_NAME: "monorepo-central-workflows",
        TEMPORAL_WORKER_BUILD_ID: SHA,
      }),
    ).toEqual({
      namespace: "beta",
      workerDeployment: {
        deploymentName: "monorepo-central-workflows",
        buildId: SHA,
      },
    });
  });

  test("uses immutable image provenance for a configured Workflow Deployment", () => {
    expect(
      parseTemporalBootstrap({
        TEMPORAL_WORKER_DEPLOYMENT_NAME: "monorepo-central-workflows",
        GIT_SHA: SHA,
      }).workerDeployment,
    ).toEqual({
      deploymentName: "monorepo-central-workflows",
      buildId: SHA,
    });
  });

  test("does not opt Activity workers into versioning from image provenance", () => {
    expect(parseTemporalBootstrap({ GIT_SHA: SHA }).workerDeployment).toBe(
      undefined,
    );
  });

  test.each([
    { TEMPORAL_WORKER_DEPLOYMENT_NAME: "central" },
    { TEMPORAL_WORKER_BUILD_ID: SHA },
    {
      TEMPORAL_WORKER_DEPLOYMENT_NAME: "central",
      GIT_SHA: "unknown",
    },
    {
      TEMPORAL_WORKER_DEPLOYMENT_NAME: "central",
      TEMPORAL_WORKER_BUILD_ID: "release-42",
    },
  ])("rejects partial or non-SHA identity: %o", (environment) => {
    expect(() => parseTemporalBootstrap(environment)).toThrow();
  });

  test("requires deployment identity only at the workflow-worker boundary", () => {
    expect(() => requireWorkerDeployment(parseTemporalBootstrap({}))).toThrow(
      "Workflow workers require",
    );
  });
});
