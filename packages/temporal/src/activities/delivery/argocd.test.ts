import { describe, expect, it, vi } from "vitest";
import { verifyArgoRelease, waitForArgoRelease } from "./argocd.ts";
import { DELIVERY_ENVIRONMENT_ANNOTATION } from "homelab/src/delivery-ownership.ts";
import { deliveryArgoParameters } from "homelab/scripts/argocd/argocd-delivery.ts";
import { acknowledgeReconciledRelease } from "./reconcile-ack.ts";
import { ApplicationFailure } from "@temporalio/common";

const requestId = "11111111-1111-4111-8111-111111111111";
const operationId = "22222222-2222-4222-8222-222222222222";
const selection = {
  application: "arcade",
  environmentId: "arcade/prod",
  repository: "https://chartmuseum.sjer.red",
  chart: "arcade",
  revision: "2.0.0-42",
  parameters: { "delivery.image": "image@sha256:digest" },
};

function acknowledgementFixture() {
  const expected: Parameters<typeof acknowledgeReconciledRelease>[0] = {
    deployment: {
      id: "deployment/ack",
      status: "running",
      cancelRequested: false,
    },
    environment: {
      id: "delivery/prod",
      generation: 4,
      activeDeploymentId: "deployment/ack",
    },
    selection: "exact-frozen-selection",
    stages: [
      {
        key: "reconcile",
        status: "running",
        operationId,
        message: "reconcile: running",
      },
    ],
    evidence: [],
  };
  const fresh = structuredClone(expected);
  const read = vi.fn(async () => structuredClone(fresh));
  const post = vi.fn(
    async (body: {
      message: string;
      evidence: {
        kind: "reconciliation";
        summary: string;
        operationId: string;
      }[];
    }) => {
      fresh.stages[0]!.status = "succeeded";
      fresh.stages[0]!.message = body.message;
      fresh.evidence = body.evidence.map((item, offset) => ({
        ...item,
        id: `deployment/ack/stage/reconcile/${String(offset)}`,
        url: undefined,
      }));
    },
  );
  return {
    expected,
    fresh,
    effects: {
      read,
      post,
      heartbeat: vi.fn(),
      wait: vi.fn(async () => 0),
    },
  };
}
const acknowledgementTimeout = () =>
  new DOMException("The operation timed out.", "TimeoutError");

describe("post-native-success reconciliation acknowledgement", () => {
  it("reads a committed lost acknowledgement without posting again", async () => {
    const f = acknowledgementFixture(),
      commit = f.effects.post.getMockImplementation()!;
    f.effects.post.mockImplementationOnce(async (body) => {
      await commit(body);
      throw acknowledgementTimeout();
    });
    await acknowledgeReconciledRelease(f.expected, operationId, f.effects);
    expect(f.effects.post).toHaveBeenCalledTimes(1);
    expect(f.effects.read).toHaveBeenCalledTimes(2);
    expect(f.effects.heartbeat).toHaveBeenCalledTimes(3);
  });
  it("retries only the identical stage POST after a transport timeout", async () => {
    const f = acknowledgementFixture();
    f.effects.post.mockRejectedValueOnce(acknowledgementTimeout());
    await acknowledgeReconciledRelease(f.expected, operationId, f.effects);
    expect(f.effects.post).toHaveBeenCalledTimes(2);
    expect(f.effects.post.mock.calls[1]).toEqual(f.effects.post.mock.calls[0]);
    expect(f.effects.post.mock.calls[0]?.[0]).toMatchObject({
      key: "reconcile",
      status: "succeeded",
      operationId,
    });
  });
  it("waits for a fresh claim read before writing after an API outage", async () => {
    const f = acknowledgementFixture();
    f.effects.read.mockRejectedValueOnce(acknowledgementTimeout());
    await acknowledgeReconciledRelease(f.expected, operationId, f.effects);
    expect(f.effects.read).toHaveBeenCalledTimes(2);
    expect(f.effects.post).toHaveBeenCalledTimes(1);
  });
  it.each([
    "claim",
    "generation",
    "operation",
    "selection",
    "cancellation",
    "status",
  ])("refuses changed %s before another write", async (change) => {
    const f = acknowledgementFixture();
    f.effects.post.mockRejectedValueOnce(acknowledgementTimeout());
    f.effects.wait.mockImplementationOnce(async () => {
      if (change === "claim")
        f.fresh.environment.activeDeploymentId = "foreign";
      if (change === "generation") f.fresh.environment.generation++;
      if (change === "operation") f.fresh.stages[0]!.operationId = "foreign";
      if (change === "selection") f.fresh.selection = "foreign";
      if (change === "cancellation") f.fresh.deployment.cancelRequested = true;
      if (change === "status") f.fresh.deployment.status = "failed";
      return 0;
    });
    await expect(
      acknowledgeReconciledRelease(f.expected, operationId, f.effects),
    ).rejects.toThrow();
    expect(f.effects.post).toHaveBeenCalledTimes(1);
  });
  it.each(["message", "evidence"])(
    "never accepts changed completed %s",
    async (change) => {
      const f = acknowledgementFixture(),
        commit = f.effects.post.getMockImplementation()!;
      f.effects.post.mockImplementationOnce(async (body) => {
        await commit(body);
        if (change === "message") f.fresh.stages[0]!.message = "different";
        else f.fresh.evidence[0]!.operationId = "different";
        throw acknowledgementTimeout();
      });
      await expect(
        acknowledgeReconciledRelease(f.expected, operationId, f.effects),
      ).rejects.toThrow("evidence differs");
      expect(f.effects.post).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    ApplicationFailure.nonRetryable("HTTP409", "DeliveryApi:CONFLICT"),
    new Error("Native operation failed"),
    new TypeError("Unknown transport failure"),
  ])("does not retry non-timeout failures: %s", async (error) => {
    const f = acknowledgementFixture();
    f.effects.post.mockRejectedValue(error);
    await expect(
      acknowledgeReconciledRelease(f.expected, operationId, f.effects),
    ).rejects.toBe(error);
    expect(f.effects.post).toHaveBeenCalledTimes(1);
    expect(f.effects.wait).not.toHaveBeenCalled();
  });
  it("bounds writes and keeps the original timeout when no acknowledgement committed", async () => {
    const f = acknowledgementFixture(),
      error = acknowledgementTimeout();
    f.effects.post.mockRejectedValue(error);
    await expect(
      acknowledgeReconciledRelease(f.expected, operationId, f.effects),
    ).rejects.toBe(error);
    expect(f.effects.post).toHaveBeenCalledTimes(3);
    expect(f.effects.read).toHaveBeenCalledTimes(4);
  });
  it("reads the final committed write after the last lost response", async () => {
    const f = acknowledgementFixture(),
      commit = f.effects.post.getMockImplementation()!;
    f.effects.post
      .mockRejectedValueOnce(acknowledgementTimeout())
      .mockRejectedValueOnce(acknowledgementTimeout())
      .mockImplementationOnce(async (body) => {
        await commit(body);
        throw acknowledgementTimeout();
      });
    await acknowledgeReconciledRelease(f.expected, operationId, f.effects);
    expect(f.effects.post).toHaveBeenCalledTimes(3);
    expect(f.effects.read).toHaveBeenCalledTimes(4);
  });
});
function observation() {
  const source = {
    repoURL: selection.repository,
    chart: selection.chart,
    targetRevision: selection.revision,
    helm: {
      parameters: [
        {
          name: "delivery.image",
          value: selection.parameters["delivery.image"],
          forceString: true,
        },
      ],
    },
  };
  return {
    spec: { source },
    status: {
      sync: { status: "Synced", revision: selection.revision },
      health: { status: "Healthy" },
      operationState: {
        phase: "Succeeded",
        finishedAt: "2026-10-17T01:00:00Z",
        operation: {
          info: [
            { name: "ci.sjer.red/request-id", value: requestId },
            { name: "ci.sjer.red/operation-id", value: operationId },
          ],
        },
        syncResult: { revision: selection.revision },
      },
      history: [
        {
          id: 1,
          revision: selection.revision,
          source: structuredClone(source),
        },
      ],
    },
  };
}

function releaseObservation(sync = "Synced", health = "Healthy") {
  const current = observation();
  return {
    ...current,
    metadata: {
      name: selection.application,
      uid: "forum-application-uid",
      resourceVersion: "1",
      annotations: {
        [DELIVERY_ENVIRONMENT_ANNOTATION]: selection.environmentId,
      },
    },
    spec: {
      ...current.spec,
      destination: { namespace: "storm-forum" },
      syncPolicy: { automated: { enabled: false } },
    },
    status: {
      ...current.status,
      sync: { ...current.status.sync, status: sync },
      health: { status: health },
    },
  };
}

describe("owned release post-sync observation", () => {
  it.each(["Synced", "OutOfSync"] as const)(
    "waits through %s Progressing without repeating native effects",
    async (sync) => {
      const pending = releaseObservation(sync, "Progressing");
      expect(() => verifyArgoRelease(pending, selection, requestId)).toThrow();
      let reads = 0;
      let fences = 0;
      const waits: number[] = [];
      const receipt = await waitForArgoRelease(selection, requestId, {
        read: async () => (++reads === 1 ? pending : releaseObservation()),
        fence: async () => {
          fences++;
        },
        wait: async (milliseconds) => {
          waits.push(milliseconds);
        },
      });
      expect(receipt.operationId).toBe(operationId);
      expect({ reads, fences, waits }).toEqual({
        reads: 2,
        fences: 2,
        waits: [5000],
      });
    },
  );

  it("bounds pending observations and retains cancellation/claim fencing", async () => {
    let reads = 0;
    let waits = 0;
    const effects = {
      read: async () => {
        reads++;
        return releaseObservation("OutOfSync", "Progressing");
      },
      fence: vi.fn<() => Promise<void>>().mockResolvedValue(),
      wait: async () => {
        waits++;
      },
    };
    await expect(
      waitForArgoRelease(selection, requestId, effects),
    ).rejects.toThrow("Timed out");
    expect({ reads, waits }).toEqual({ reads: 60, waits: 59 });
    await expect(
      waitForArgoRelease(selection, requestId, {
        ...effects,
        fence: async () => {
          throw new Error("claim changed");
        },
      }),
    ).rejects.toThrow("claim changed");
    expect(reads).toBe(60);
  });

  it("refuses unhealthy, failed, foreign source and missing ownership immediately", async () => {
    const invalid = [
      {
        ...releaseObservation(),
        status: {
          ...releaseObservation().status,
          health: { status: "Degraded" },
        },
      },
      {
        ...releaseObservation(),
        status: {
          ...releaseObservation().status,
          operationState: {
            ...releaseObservation().status.operationState,
            phase: "Failed",
          },
        },
      },
      {
        ...releaseObservation(),
        spec: {
          ...releaseObservation().spec,
          source: {
            ...releaseObservation().spec.source,
            targetRevision: "2.0.0-41",
          },
        },
      },
      {
        ...releaseObservation(),
        metadata: { ...releaseObservation().metadata, annotations: {} },
      },
    ];
    for (const application of invalid)
      await expect(
        waitForArgoRelease(selection, requestId, {
          read: async () => application,
          fence: vi.fn<() => Promise<void>>().mockResolvedValue(),
          wait: async () => {
            throw new Error("must not wait");
          },
        }),
      ).rejects.not.toThrow("must not wait");
  });

  it("refuses replacement Application or operation while waiting", async () => {
    for (const replaceOperation of [false, true]) {
      let reads = 0;
      const replaced = releaseObservation();
      if (replaceOperation)
        replaced.status.operationState.operation.info[1] = {
          name: "ci.sjer.red/operation-id",
          value: "33333333-3333-4333-8333-333333333333",
        };
      else replaced.metadata.uid = "foreign-uid";
      await expect(
        waitForArgoRelease(selection, requestId, {
          read: async () =>
            ++reads === 1
              ? releaseObservation("OutOfSync", "Progressing")
              : replaced,
          fence: vi.fn<() => Promise<void>>().mockResolvedValue(),
          wait: vi.fn<() => Promise<void>>().mockResolvedValue(),
        }),
      ).rejects.toThrow("changed while waiting");
    }
  });
});
describe("Delivery Argo operation evidence", () => {
  it("proves exact wire parameters without changing the frozen logical JSON", () => {
    const logical = JSON.stringify({
      versions: [
        { id: "old", note: String.raw`comma,slash\braces{}` },
        { id: "new" },
      ],
    });
    const selected = {
      ...selection,
      parameters: { "delivery.workerPool": logical },
    };
    const current = observation();
    const parameters = deliveryArgoParameters(selected.parameters);
    current.spec.source.helm.parameters = parameters;
    const history = current.status.history[0];
    if (history === undefined) throw new Error("Fixture history missing");
    history.source.helm.parameters = structuredClone(parameters);
    expect(verifyArgoRelease(current, selected, requestId).operationId).toBe(
      operationId,
    );
    expect(() =>
      verifyArgoRelease(
        current,
        { ...selected, parameters: { "delivery.workerPool": "{}" } },
        requestId,
      ),
    ).toThrow("exact owned");
    const parameter = history.source.helm.parameters[0];
    if (parameter === undefined) throw new Error("Fixture parameter missing");
    parameter.value = logical;
    expect(() => verifyArgoRelease(current, selected, requestId)).toThrow(
      "exact owned",
    );
  });
  it("returns the exact request and external operation receipt", () => {
    expect(verifyArgoRelease(observation(), selection, requestId)).toEqual({
      requestId,
      operationId,
      revision: selection.revision,
    });
  });
  it("rejects queued operations and missing terminal completion proof despite prior green status", () => {
    expect(() =>
      verifyArgoRelease(
        { ...observation(), operation: { sync: { revision: "2.0.0-43" } } },
        selection,
        requestId,
      ),
    ).toThrow();
    const unfinished = observation();
    expect(() =>
      verifyArgoRelease(
        {
          ...unfinished,
          status: {
            ...unfinished.status,
            operationState: {
              ...unfinished.status.operationState,
              finishedAt: undefined,
            },
          },
        },
        selection,
        requestId,
      ),
    ).toThrow();
    expect(() =>
      verifyArgoRelease(
        { ...observation(), operation: null },
        selection,
        requestId,
      ),
    ).not.toThrow();
  });
  it("requires explicit string typing in both current selection and deployment history", () => {
    for (const forceString of [false, undefined]) {
      const current = observation();
      const source = {
        ...current.spec.source,
        helm: {
          parameters: [
            {
              name: "delivery.image",
              value: selection.parameters["delivery.image"],
              forceString,
            },
          ],
        },
      };
      expect(() =>
        verifyArgoRelease(
          { ...current, spec: { source } },
          selection,
          requestId,
        ),
      ).toThrow("force string");
      expect(() =>
        verifyArgoRelease(
          {
            ...current,
            status: {
              ...current.status,
              history: current.status.history.map((entry) => ({
                ...entry,
                source,
              })),
            },
          },
          selection,
          requestId,
        ),
      ).toThrow("force string");
    }
  });
  it("rejects comparison-only green while history still points at an older deployment", () => {
    const current = observation();
    const deployed = current.status.history[0];
    if (deployed === undefined) throw new Error("Fixture history is missing");
    deployed.revision = "2.0.0-41";
    expect(() => verifyArgoRelease(current, selection, requestId)).toThrow(
      "exact owned",
    );
  });
  it("rejects foreign operations and changed Helm values at the same chart version", () => {
    expect(() =>
      verifyArgoRelease(observation(), selection, operationId),
    ).toThrow("exact owned");
    const current = observation();
    const parameter = current.status.history[0]?.source.helm.parameters[0];
    if (parameter === undefined)
      throw new Error("Fixture parameter is missing");
    parameter.value = "old-image";
    expect(() => verifyArgoRelease(current, selection, requestId)).toThrow(
      "exact owned",
    );
  });
});
