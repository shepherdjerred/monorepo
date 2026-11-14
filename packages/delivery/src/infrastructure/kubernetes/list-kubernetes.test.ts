import { afterEach, describe, expect, test, vi } from "vitest";
import { listKubernetes, projectedReader } from "./projected-reader.ts";
import {
  KUBERNETES_RESPONSE_BOUND,
  KubernetesReadBoundError,
} from "./projected-identity.ts";
import { pagedKubernetes, retainedDeployment } from "./paged-fixture.ts";

const reader = { name: "worker-recovery", directory: "/unused" };
const DEPLOYMENTS = "/apis/apps/v1/namespaces/temporal/deployments";
const hosts = Array.from({ length: 400 }, (_, index) =>
  retainedDeployment(index),
);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a collection larger than one bounded response", () => {
  test("is the incident: 400 worker hosts do not fit one read", async () => {
    vi.spyOn(console, "error").mockReturnValue();
    expect(Buffer.byteLength(JSON.stringify({ items: hosts }))).toBeGreaterThan(
      4 * KUBERNETES_RESPONSE_BOUND,
    );
    const cluster = pagedKubernetes({ [DEPLOYMENTS]: hosts });
    await expect(
      projectedReader(reader, cluster.read)(DEPLOYMENTS),
    ).rejects.toMatchObject({ code: "PAUSED" });
  });

  test("is listed whole, in order, in pages that each fit the bound", async () => {
    const cluster = pagedKubernetes({ [DEPLOYMENTS]: hosts });
    const listed = await listKubernetes(
      projectedReader(reader, cluster.read),
      DEPLOYMENTS,
      { maxItems: 500 },
    );
    expect(listed).toEqual(hosts);
    expect(cluster.requests).toHaveLength(20);
    expect(cluster.requests[0]).toBe(`${DEPLOYMENTS}?limit=20`);
    expect(cluster.requests[1]).toBe(`${DEPLOYMENTS}?limit=20&continue=20`);
  });

  test("keeps a label selector on every page", async () => {
    const path = "/api/v1/namespaces/temporal/pods?labelSelector=worker-family";
    const cluster = pagedKubernetes({ [path]: hosts.slice(0, 45) });
    expect(
      await listKubernetes(cluster.read, path, { maxItems: 2000 }),
    ).toHaveLength(45);
    expect(cluster.requests).toEqual([
      `${path}&limit=20`,
      `${path}&limit=20&continue=20`,
      `${path}&limit=20&continue=40`,
    ]);
  });

  test("is refused, never truncated, past its item bound", async () => {
    const cluster = pagedKubernetes({ [DEPLOYMENTS]: hosts });
    await expect(
      listKubernetes(cluster.read, DEPLOYMENTS, { maxItems: 100 }),
    ).rejects.toMatchObject({
      code: "PAUSED",
      message: `Independent readback is unavailable; ${DEPLOYMENTS} lists more than 100 objects`,
    });
  });
});

describe("a response over its bound", () => {
  test("says which read and how large, in the refusal and the log, without its query", async () => {
    const logged = vi.spyOn(console, "error").mockReturnValue();
    const read = projectedReader(reader, (path) =>
      Promise.reject(new KubernetesReadBoundError(path, 1_048_576, 1_052_000)),
    );
    await expect(
      read(`${DEPLOYMENTS}?limit=20&continue=opaque-token`),
    ).rejects.toMatchObject({
      code: "PAUSED",
      message: `Independent readback is unavailable; the projected worker-recovery read of ${DEPLOYMENTS} exceeded its 1048576-byte bound (stopped after 1052000 bytes)`,
    });
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({
        message: "delivery_kubernetes_read_failed",
        reader: "worker-recovery",
        path: DEPLOYMENTS,
        errorType: "KubernetesReadBoundError",
        bound: 1_048_576,
        received: 1_052_000,
      }),
    );
  });

  test("reports the declared size when the API server sent one", () => {
    expect(
      new KubernetesReadBoundError("/apis/x?continue=t", 10, 0, 1_197_825)
        .message,
    ).toBe(
      "Kubernetes identity read of /apis/x exceeded its 10-byte bound: the response declares 1197825 bytes",
    );
  });
});
