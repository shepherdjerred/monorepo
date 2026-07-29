import { describe, expect, test } from "bun:test";

import {
  batchManifestOverrides,
  completedOperationIdentity,
  requestedOperationIdentity,
  type ManifestOverride,
} from "./argocd-manifest-overrides.ts";

function override(name: string, payloadLength: number): ManifestOverride {
  return {
    manifest: JSON.stringify({
      apiVersion: "argoproj.io/v1alpha1",
      kind: "Application",
      metadata: { name },
      spec: { payload: "x".repeat(payloadLength) },
    }),
    resource: {
      group: "argoproj.io",
      kind: "Application",
      name,
    },
  };
}

describe("manifest override batching", () => {
  test("keeps matching manifests and resource selectors together", () => {
    const batches = batchManifestOverrides(
      [override("one", 400), override("two", 400)],
      1500,
    );

    expect(batches).toHaveLength(1);
    expect(batches[0]?.manifests).toHaveLength(2);
    expect(batches[0]?.resources.map(({ name }) => name)).toEqual([
      "one",
      "two",
    ]);
  });

  test("splits requests before the serialized budget is exceeded", () => {
    const batches = batchManifestOverrides(
      [override("one", 600), override("two", 600), override("three", 600)],
      1000,
    );

    expect(batches).toHaveLength(3);
    expect(batches.map(({ resources }) => resources[0]?.name)).toEqual([
      "one",
      "two",
      "three",
    ]);
  });

  test("fails when one manifest cannot fit", () => {
    expect(() => batchManifestOverrides([override("huge", 2000)], 500)).toThrow(
      "Application/huge exceeds the request budget",
    );
  });
});

describe("Argo operation identity", () => {
  test("matches the completed operation returned by the sync POST", () => {
    const requested = {
      operation: {
        initiatedBy: { username: "buildkite" },
        sync: { manifests: ["current"], prune: false },
      },
    };
    const completed = {
      status: {
        operationState: {
          finishedAt: "2026-07-29T10:00:00Z",
          phase: "Succeeded",
          operation: {
            sync: { prune: false, manifests: ["current"] },
            initiatedBy: { username: "buildkite" },
          },
        },
      },
    };

    expect(completedOperationIdentity(completed)).toBe(
      requestedOperationIdentity(requested),
    );
  });

  test("distinguishes an exact retry by its request ID", () => {
    const requested = {
      operation: {
        info: [{ name: "ci.sjer.red/request-id", value: "current" }],
        sync: { manifests: ["same"] },
      },
    };
    const previous = {
      status: {
        operationState: {
          finishedAt: "2026-07-29T10:00:00Z",
          phase: "Succeeded",
          operation: {
            info: [{ name: "ci.sjer.red/request-id", value: "previous" }],
            sync: { manifests: ["same"] },
          },
        },
      },
    };

    expect(completedOperationIdentity(previous)).not.toBe(
      requestedOperationIdentity(requested),
    );
  });

  test("returns null before an Application has an operation state", () => {
    expect(completedOperationIdentity({ status: {} })).toBeNull();
  });

  test("fails when the sync response does not identify its operation", () => {
    expect(() => requestedOperationIdentity({})).toThrow(
      "sync response is missing the requested operation",
    );
  });
});
