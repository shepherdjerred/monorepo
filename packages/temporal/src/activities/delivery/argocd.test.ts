import { describe, expect, it } from "vitest";
import { verifyArgoRelease } from "./argocd.ts";

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
describe("Delivery Argo operation evidence", () => {
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
