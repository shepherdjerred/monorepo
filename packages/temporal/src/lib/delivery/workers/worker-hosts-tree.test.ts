import { describe, expect, test } from "vitest";
import { workerApplicationResources } from "./worker-hosts.ts";

/** temporal's tree on 2026-11-07: a live host and one the stale body declared. */
function argo(nodes: unknown[]) {
  const reads: string[] = [];
  const read = async (path: string) => {
    reads.push(path);
    if (path.endsWith("/resource-tree")) return { nodes };
    const name = new URLSearchParams(path.split("?")[1]).get("resourceName");
    if (name === "temporal-delivery-wf-retained-a6d81228c306")
      throw new Error("Argo API returned HTTP 400");
    return { manifest: JSON.stringify({ metadata: { name } }) };
  };
  return { read, reads };
}

describe("worker hosts read from an Application's resource tree", () => {
  test("only live resources are read; a declared but Missing host is skipped", async () => {
    const { read, reads } = argo([
      {
        kind: "Deployment",
        name: "temporal-delivery-wf-retained-ebb3cb4ad8a3",
        namespace: "temporal",
        uid: "0f6b1c2e-live",
        health: { status: "Healthy" },
      },
      {
        kind: "Deployment",
        name: "temporal-delivery-wf-retained-a6d81228c306",
        namespace: "temporal",
        uid: null,
        health: { status: "Missing" },
      },
      { kind: "Pod", name: "temporal-worker-0", uid: "pod-uid" },
    ]);
    await expect(
      workerApplicationResources("temporal", "Deployment", read),
    ).resolves.toEqual([
      { metadata: { name: "temporal-delivery-wf-retained-ebb3cb4ad8a3" } },
    ]);
    expect(reads).toHaveLength(2);
  });

  test("a live resource Argo cannot read still fails the inspection", async () => {
    const { read } = argo([
      {
        kind: "Deployment",
        name: "temporal-delivery-wf-retained-a6d81228c306",
        namespace: "temporal",
        uid: "present",
      },
    ]);
    await expect(
      workerApplicationResources("temporal", "Deployment", read),
    ).rejects.toThrow("HTTP 400");
  });
});
