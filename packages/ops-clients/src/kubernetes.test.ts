import { describe, expect, test } from "vitest";
import { KubernetesClient } from "@shepherdjerred/ops-clients/kubernetes.ts";
import { sequence } from "@shepherdjerred/ops-clients/test-support/fake-fetch.ts";

function client(...bodies: unknown[]) {
  const fake = sequence(...bodies);
  return {
    ...fake,
    client: new KubernetesClient({
      baseUrl: "https://kubernetes.default.svc",
      token: () => Promise.resolve("sa-token"),
      fetch: fake.fetch,
    }),
  };
}

function pod(
  name: string,
  status: Record<string, unknown>,
): Record<string, unknown> {
  return {
    metadata: {
      name,
      namespace: "birmel",
      creationTimestamp: "2026-09-24T10:00:00Z",
      ownerReferences: [{ kind: "ReplicaSet" }],
    },
    status,
  };
}

describe("KubernetesClient", () => {
  test("lists nodes with their Ready condition and versions", async () => {
    const { client: kube, requests } = client({
      metadata: {},
      items: [
        {
          metadata: { name: "torvalds" },
          status: {
            conditions: [
              { type: "MemoryPressure", status: "False" },
              {
                type: "Ready",
                status: "True",
                lastTransitionTime: "2026-09-01T00:00:00Z",
              },
            ],
            nodeInfo: {
              osImage: "Talos (v1.11.2)",
              kubeletVersion: "v1.34.1",
            },
          },
        },
      ],
    });
    await expect(kube.listNodes()).resolves.toEqual([
      {
        name: "torvalds",
        ready: true,
        readySince: "2026-09-01T00:00:00Z",
        osImage: "Talos (v1.11.2)",
        kubeletVersion: "v1.34.1",
      },
    ]);
    expect(requests[0]?.url).toBe(
      "https://kubernetes.default.svc/api/v1/nodes?limit=500",
    );
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer sa-token");
  });

  test("follows continue tokens and classifies pod problems", async () => {
    const { client: kube, requests } = client(
      {
        metadata: { continue: "next-page" },
        items: [
          pod("healthy", {
            phase: "Running",
            containerStatuses: [
              {
                name: "app",
                ready: true,
                restartCount: 1,
                state: { running: {} },
              },
            ],
          }),
          pod("crashing", {
            phase: "Running",
            containerStatuses: [
              {
                name: "app",
                ready: false,
                restartCount: 12,
                state: { waiting: { reason: "CrashLoopBackOff" } },
              },
            ],
          }),
        ],
      },
      {
        metadata: {},
        items: [
          pod("evicted", { phase: "Failed", reason: "Evicted" }),
          pod("pending", { phase: "Pending" }),
        ],
      },
    );
    const pods = await kube.listPods();
    expect(
      pods.map((entry) => [
        entry.name,
        entry.problem,
        entry.restarts,
        entry.stuck,
      ]),
    ).toEqual([
      ["healthy", undefined, 1, false],
      ["crashing", "app: CrashLoopBackOff", 12, true],
      ["evicted", "Evicted", 0, false],
      ["pending", "Pending", 0, false],
    ]);
    expect(requests[1]?.url).toContain("continue=next-page");
    expect(requests[0]?.url).toContain(
      "fieldSelector=status.phase%21%3DSucceeded",
    );
  });

  test("maps Argo applications and rejects an unknown health enum", async () => {
    const app = {
      metadata: { name: "birmel", namespace: "argocd" },
      spec: { project: "default", destination: { namespace: "birmel" } },
      status: {
        sync: { status: "OutOfSync", revision: "abc" },
        health: { status: "Healthy" },
        history: [
          {
            id: 7,
            revision: "abc",
            deployedAt: "2026-09-24T11:00:00Z",
            deployStartedAt: "2026-09-24T10:59:00Z",
          },
        ],
        operationState: {
          phase: "Succeeded",
          startedAt: "2026-09-24T10:59:00Z",
          finishedAt: "2026-09-24T11:00:00Z",
        },
      },
    };
    const { client: kube } = client({ metadata: {}, items: [app] });
    await expect(kube.listArgoApplications()).resolves.toEqual([
      {
        name: "birmel",
        project: "default",
        destinationNamespace: "birmel",
        sync: "OutOfSync",
        health: "Healthy",
        revision: "abc",
        history: [
          {
            id: 7,
            revision: "abc",
            deployedAt: "2026-09-24T11:00:00Z",
            deployStartedAt: "2026-09-24T10:59:00Z",
          },
        ],
        operation: {
          phase: "Succeeded",
          message: undefined,
          startedAt: "2026-09-24T10:59:00Z",
          finishedAt: "2026-09-24T11:00:00Z",
        },
      },
    ]);

    const broken = client({
      metadata: {},
      items: [
        { ...app, status: { ...app.status, health: { status: "Sideways" } } },
      ],
    });
    await expect(broken.client.listArgoApplications()).rejects.toThrow(
      /kubernetes: response did not match schema/,
    );
  });
});
