import { describe, expect, test } from "vitest";
import { createEndpointDrainObserver } from "./endpoint-reader.ts";

const pod = "delivery-7845c769c9-rz24q";
const replacement = "delivery-87c47f8f5-zkr4w";

const endpoint = (name: string, ready: boolean) => ({
  conditions: { ready, serving: true, terminating: !ready },
  targetRef: { kind: "Pod", name },
});

function observer(items: unknown[]) {
  const paths: string[] = [];
  const unrouted = createEndpointDrainObserver(pod, async (path) => {
    paths.push(path);
    return { items };
  });
  return { unrouted, paths };
}

describe("whether proxies have stopped routing to this pod", () => {
  test("reads only the delivery Service's EndpointSlices", async () => {
    const { unrouted, paths } = observer([]);
    await unrouted();
    expect(paths).toEqual([
      "/apis/discovery.k8s.io/v1/namespaces/delivery/endpointslices?labelSelector=kubernetes.io%2Fservice-name%3Ddelivery",
    ]);
  });

  test("still routed while its own endpoint is ready", async () => {
    const { unrouted } = observer([
      { endpoints: [endpoint(pod, true), endpoint(replacement, true)] },
    ]);
    expect(await unrouted()).toBe(false);
  });

  test("moved once its endpoint is not ready and the replacement's is", async () => {
    const { unrouted } = observer([
      { endpoints: [endpoint(pod, false)] },
      { endpoints: [endpoint(replacement, true)] },
    ]);
    expect(await unrouted()).toBe(true);
  });

  test("moved once its endpoint is gone and another is ready", async () => {
    const { unrouted } = observer([
      { endpoints: [endpoint(replacement, true)] },
    ]);
    expect(await unrouted()).toBe(true);
  });

  test("not moved while no other endpoint is ready to take the traffic", async () => {
    const { unrouted } = observer([
      { endpoints: [endpoint(pod, false), endpoint(replacement, false)] },
      { endpoints: null },
    ]);
    expect(await unrouted()).toBe(false);
  });

  test("a refused read is refused, never an answer", async () => {
    const unrouted = createEndpointDrainObserver(pod, async () => {
      throw new Error("forbidden");
    });
    await expect(unrouted()).rejects.toThrow(
      "the projected delivery-endpoint-reader identity is required",
    );
  });
});
