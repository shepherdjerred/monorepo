import { describe, expect, it, vi } from "vitest";
import { verifyArgoRelease, waitForForumArgoRelease } from "./argocd.ts";
import { DELIVERY_ENVIRONMENT_ANNOTATION } from "homelab/src/delivery-ownership.ts";
import { deliveryArgoParameters } from "homelab/scripts/argocd/argocd-delivery.ts";

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

function forumObservation(sync = "Synced", health = "Healthy") {
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

describe("Forum post-sync observation", () => {
  it("waits for genuine Synced Healthy without repeating sync or migration", async () => {
    const pending = forumObservation("OutOfSync", "Progressing");
    expect(() => verifyArgoRelease(pending, selection, requestId)).toThrow();
    let reads = 0;
    let fences = 0;
    const waits: number[] = [];
    const receipt = await waitForForumArgoRelease(selection, requestId, {
      read: async () => (++reads === 1 ? pending : forumObservation()),
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
  });

  it("bounds pending observations and retains cancellation/claim fencing", async () => {
    let reads = 0;
    let waits = 0;
    const effects = {
      read: async () => {
        reads++;
        return forumObservation("OutOfSync", "Progressing");
      },
      fence: vi.fn<() => Promise<void>>().mockResolvedValue(),
      wait: async () => {
        waits++;
      },
    };
    await expect(
      waitForForumArgoRelease(selection, requestId, effects),
    ).rejects.toThrow("Timed out");
    expect({ reads, waits }).toEqual({ reads: 60, waits: 59 });
    await expect(
      waitForForumArgoRelease(selection, requestId, {
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
        ...forumObservation(),
        status: {
          ...forumObservation().status,
          health: { status: "Degraded" },
        },
      },
      {
        ...forumObservation(),
        status: {
          ...forumObservation().status,
          operationState: {
            ...forumObservation().status.operationState,
            phase: "Failed",
          },
        },
      },
      {
        ...forumObservation(),
        spec: {
          ...forumObservation().spec,
          source: {
            ...forumObservation().spec.source,
            targetRevision: "2.0.0-41",
          },
        },
      },
      {
        ...forumObservation(),
        metadata: { ...forumObservation().metadata, annotations: {} },
      },
    ];
    for (const application of invalid)
      await expect(
        waitForForumArgoRelease(selection, requestId, {
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
      const replaced = forumObservation();
      if (replaceOperation)
        replaced.status.operationState.operation.info[1] = {
          name: "ci.sjer.red/operation-id",
          value: "33333333-3333-4333-8333-333333333333",
        };
      else replaced.metadata.uid = "foreign-uid";
      await expect(
        waitForForumArgoRelease(selection, requestId, {
          read: async () =>
            ++reads === 1
              ? forumObservation("OutOfSync", "Progressing")
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
