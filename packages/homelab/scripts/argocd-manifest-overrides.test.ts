import { describe, expect, test } from "bun:test";

import {
  batchManifestOverrides,
  completedOperationIdentity,
  completedOperationId,
  completedOperationRequestId,
  operationInfoRevision,
  requestedOperationIdentity,
  requestedOperationId,
  requestedOperationRequestId,
  requestedOperationRevision,
  type ManifestOverride,
} from "./argocd-manifest-overrides.ts";

function override(
  name: string,
  payloadLength: number,
  syncWave?: string,
): ManifestOverride {
  return {
    manifest: JSON.stringify({
      apiVersion: "argoproj.io/v1alpha1",
      kind: "Application",
      metadata: {
        name,
        ...(syncWave === undefined
          ? {}
          : { annotations: { "argocd.argoproj.io/sync-wave": syncWave } }),
      },
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
      { maxRequestBytes: 1500 },
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
      { maxRequestBytes: 1200 },
    );

    expect(batches).toHaveLength(3);
    expect(batches.map(({ resources }) => resources[0]?.name)).toEqual([
      "one",
      "two",
      "three",
    ]);
  });

  test("counts revision identity only for revisioned requests", () => {
    const overrides = [override("one", 400), override("two", 400)];

    expect(
      batchManifestOverrides(overrides, { maxRequestBytes: 1400 }),
    ).toHaveLength(1);
    expect(
      batchManifestOverrides(overrides, {
        maxRequestBytes: 1400,
        revision: "2.0.0-42",
      }),
    ).toHaveLength(2);
  });

  test("leaves room for Argo's duplicated operation-state envelope", () => {
    const batches = batchManifestOverrides([
      override("one", 500_000),
      override("two", 500_000),
    ]);

    expect(batches).toHaveLength(2);
    expect(batches.map(({ resources }) => resources[0]?.name)).toEqual([
      "one",
      "two",
    ]);
  });

  test("keeps sync waves in separate requests and Argo application order", () => {
    const batches = batchManifestOverrides(
      [
        override("later", 100, "3"),
        override("default-one", 100),
        override("earlier", 100, "-2"),
        override("default-two", 100, "0"),
      ],
      { maxRequestBytes: 5000 },
    );

    expect(
      batches.map(({ resources }) => resources.map(({ name }) => name)),
    ).toEqual([["earlier"], ["default-one", "default-two"], ["later"]]);
  });

  test("fails loudly for an invalid sync wave", () => {
    expect(() =>
      batchManifestOverrides([override("bad", 100, "next")]),
    ).toThrow('Application/bad has invalid Argo CD sync wave "next"');
  });

  test("fails when one manifest cannot fit", () => {
    expect(() =>
      batchManifestOverrides([override("huge", 2000)], {
        maxRequestBytes: 500,
      }),
    ).toThrow("Application/huge exceeds the request budget");
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
    expect(requestedOperationRequestId(requested)).toBe("current");
    expect(completedOperationRequestId(previous)).toBe("previous");
  });

  test("distinguishes separate attempts with the same retry identity", () => {
    const requested = {
      operation: {
        info: [
          { name: "ci.sjer.red/request-id", value: "same-request" },
          { name: "ci.sjer.red/operation-id", value: "current-operation" },
        ],
        sync: { revision: "same-revision" },
      },
    };
    const previous = {
      status: {
        operationState: {
          operation: {
            info: [
              { name: "ci.sjer.red/request-id", value: "same-request" },
              {
                name: "ci.sjer.red/operation-id",
                value: "previous-operation",
              },
            ],
            sync: { revision: "same-revision" },
          },
        },
      },
    };

    expect(completedOperationIdentity(previous)).not.toBe(
      requestedOperationIdentity(requested),
    );
    expect(requestedOperationId(requested)).toBe("current-operation");
    expect(completedOperationId(previous)).toBe("previous-operation");
  });

  test("reads the revision persisted in operation info", () => {
    const operation = {
      operation: {
        info: [{ name: "ci.sjer.red/revision", value: "2.0.0-42" }],
      },
    };

    expect(requestedOperationRevision(operation)).toBe("2.0.0-42");
    expect(operationInfoRevision(operation.operation)).toBe("2.0.0-42");
  });

  test("rejects a direct revision without persisted CI identity", () => {
    expect(() =>
      requestedOperationRevision({
        operation: { sync: { revision: "2.0.0-42" } },
      }),
    ).toThrow("missing the CI revision");
  });

  test("rejects disagreement with the direct revision", () => {
    expect(() =>
      requestedOperationRevision({
        operation: {
          info: [{ name: "ci.sjer.red/revision", value: "2.0.0-42" }],
          sync: { revision: "2.0.0-43" },
        },
      }),
    ).toThrow("Argo operation revision mismatch");
  });

  test("returns null before an Application has an operation state", () => {
    expect(completedOperationIdentity({ status: {} })).toBeNull();
  });

  test("fails when the sync response does not identify its operation", () => {
    expect(() => requestedOperationIdentity({})).toThrow(
      "sync response is missing the requested operation",
    );
  });

  test("fails when a requested operation omits its CI request ID", () => {
    expect(() => requestedOperationRequestId({ operation: {} })).toThrow(
      "missing the CI request ID",
    );
  });

  test("fails when a requested operation omits its CI operation ID", () => {
    expect(() => requestedOperationId({ operation: {} })).toThrow(
      "missing the CI operation ID",
    );
  });

  test("fails when an operation has duplicate CI request IDs", () => {
    expect(() =>
      requestedOperationRequestId({
        operation: {
          info: [
            { name: "ci.sjer.red/request-id", value: "one" },
            { name: "ci.sjer.red/request-id", value: "two" },
          ],
        },
      }),
    ).toThrow("multiple CI request IDs");
  });

  test("fails when an operation has duplicate CI operation IDs", () => {
    expect(() =>
      requestedOperationId({
        operation: {
          info: [
            { name: "ci.sjer.red/operation-id", value: "one" },
            { name: "ci.sjer.red/operation-id", value: "two" },
          ],
        },
      }),
    ).toThrow("multiple CI operation IDs");
  });

  test("fails when an operation has duplicate CI revisions", () => {
    expect(() =>
      operationInfoRevision({
        info: [
          { name: "ci.sjer.red/revision", value: "2.0.0-41" },
          { name: "ci.sjer.red/revision", value: "2.0.0-42" },
        ],
      }),
    ).toThrow("multiple CI revisions");
  });
});
